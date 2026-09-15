import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";

import type {AppConfig} from "../config.js";
import type {JobRecord, JobRepository} from "../db/repositories/jobRepository.js";

interface WorkerEvent {contractVersion: 1; jobId: string; sequence: number; type: string; payload: Record<string, unknown>}
export interface WorkerExecutionResult {sequence: number; resultFile?: string}

export class MediaWorkerSupervisor {
  constructor(private readonly config: AppConfig, private readonly jobs: JobRepository, private readonly workerId: string) {}

  async execute(job: JobRecord, credentials: Record<string, string> = {}): Promise<WorkerExecutionResult | undefined> {
    const jobRoot = path.resolve(this.config.workerRoot, job.id); await mkdir(jobRoot, {recursive: true});
    const requestPath = path.join(jobRoot, "request.json");
    await writeFile(requestPath, JSON.stringify({contractVersion: 1, jobId: job.id, storyId: job.storyId, operation: job.type, storageRoot: jobRoot, input: job.payload, settings: {}, credentialEnvironment: Object.keys(credentials)}), {encoding: "utf8", flag: "w"});
    const child = spawn(process.execPath, ["scripts/run-python.mjs", "-m", "storyvideogen.worker_cli", job.type, "--request", requestPath], {cwd: process.cwd(), env: allowedEnvironment(credentials), shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"]});
    child.stdin.end();
    return this.monitor(job, child, jobRoot);
  }

  private monitor(job: JobRecord, child: ChildProcessWithoutNullStreams, jobRoot: string): Promise<WorkerExecutionResult | undefined> {
    return new Promise((resolve) => {
      let stdoutBuffer = ""; let stderrBuffer = ""; let totalOutput = 0; let sequence = 0; let completed = false; let resultFile: string | undefined; let settled = false; let terminationRequested = false; let lastOutput = Date.now(); let contractError: Error | undefined;
      const finish = (work: () => WorkerExecutionResult | undefined) => { if (settled) return; settled = true; clearInterval(controlTimer); clearTimeout(wallTimer); resolve(work()); };
      const stop = () => { if (child.exitCode !== null || terminationRequested) return; terminationRequested = true; try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM"); } catch { child.kill("SIGTERM"); } const forceTimer = setTimeout(() => { if (child.exitCode === null) { try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { child.kill("SIGKILL"); } } }, 3_000); forceTimer.unref(); };
      const accept = (line: string) => {
        if (!line.trim()) return;
        let event: WorkerEvent;
        try { event = validateEvent(JSON.parse(line), job.id, sequence + 1, jobRoot); } catch (error) { contractError = error as Error; stop(); return; }
        sequence = event.sequence; lastOutput = Date.now(); const now = new Date().toISOString();
        if (event.type === "progress") this.jobs.updateProgress(job.id, this.workerId, progressValue(event.payload.progress), "progress", event.payload, now);
        else if (event.type === "asset_created") this.jobs.updateProgress(job.id, this.workerId, 0, "asset_created", event.payload, now);
        else if (event.type === "stage_started") this.jobs.updateProgress(job.id, this.workerId, 0, "stage_started", event.payload, now);
        else if (event.type === "completed") { if (completed) { contractError = new Error("Worker emitted duplicate completion."); stop(); } else { completed = true; resultFile = optionalSafeResultFile(event.payload.resultFile, jobRoot); } }
      };
      child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk: string) => { lastOutput = Date.now(); totalOutput += Buffer.byteLength(chunk); if (totalOutput > 2_000_000) { contractError = new Error("Worker output exceeded the limit."); stop(); return; } stdoutBuffer += chunk; let index; while ((index = stdoutBuffer.indexOf("\n")) >= 0) { const line = stdoutBuffer.slice(0, index); stdoutBuffer = stdoutBuffer.slice(index + 1); if (Buffer.byteLength(line) > 65_536) { contractError = new Error("Worker event exceeded the line limit."); stop(); return; } accept(line); } });
      child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk: string) => { lastOutput = Date.now(); stderrBuffer = `${stderrBuffer}${chunk}`.slice(-8_192); });
      child.once("error", (error) => finish(() => { this.fail(job, "WORKER_START_FAILED", error.message); return undefined; }));
      child.once("exit", (code, signal) => finish(() => { const current = this.jobs.findById(job.id); if (current?.state === "cancel_requested") { this.jobs.acknowledgeCancellation(job.id, this.workerId, new Date().toISOString()); return undefined; } if (contractError) { this.fail(job, "WORKER_CONTRACT_INVALID", contractError.message); return undefined; } if (code !== 0 || signal) { if (stderrBuffer) console.error(`Media worker ${job.id} failed: ${sanitizeStderr(stderrBuffer)}`); this.fail(job, "WORKER_EXITED", "The media worker exited unexpectedly."); return undefined; } if (!completed) { this.fail(job, "WORKER_INCOMPLETE", "Media worker exited without completion."); return undefined; } return resultFile ? {sequence, resultFile} : {sequence}; }));
      const controlTimer = setInterval(() => { const current = this.jobs.findById(job.id); if (current?.state === "cancel_requested") { stop(); return; } const now = new Date(); this.jobs.heartbeat(job.id, this.workerId, now.toISOString(), new Date(now.getTime() + this.config.workerLeaseSeconds * 1000).toISOString()); if (Date.now() - lastOutput > this.config.workerSilenceSeconds * 1000) { contractError = new Error("Media worker became unresponsive."); stop(); } }, Math.max(500, Math.floor(this.config.workerLeaseSeconds * 1000 / 3))); controlTimer.unref();
      const wallTimer = setTimeout(() => { contractError = new Error("Media worker exceeded its time limit."); stop(); }, this.config.workerTimeoutSeconds * 1000); wallTimer.unref();
    });
  }

  private fail(job: JobRecord, code: string, detail: string): void { const now = new Date(); this.jobs.fail(job.id, this.workerId, code, safeFailureMessage(code, detail), now.toISOString(), new Date(now.getTime() + Math.min(60, 2 ** job.attempt) * 1000).toISOString()); }
}

function validateEvent(value: unknown, jobId: string, sequence: number, storageRoot: string): WorkerEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Worker event must be an object."); const event = value as Partial<WorkerEvent>;
  if (event.contractVersion !== 1 || event.jobId !== jobId || event.sequence !== sequence || typeof event.type !== "string" || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) throw new Error("Worker event envelope is invalid.");
  if (!["stage_started", "progress", "asset_created", "completed"].includes(event.type)) throw new Error("Worker event type is unsupported.");
  if (event.type === "asset_created") { const key = event.payload.storageKey; if (typeof key !== "string" || path.isAbsolute(key) || key.split(/[\\/]/).includes("..")) throw new Error("Worker asset key is unsafe."); const candidate = path.resolve(storageRoot, key); if (path.relative(storageRoot, candidate).startsWith("..")) throw new Error("Worker asset escaped its storage root."); }
  if (event.type === "progress") progressValue(event.payload.progress);
  return event as WorkerEvent;
}
function progressValue(value: unknown): number { if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 10_000) throw new Error("Worker progress is invalid."); return value as number; }
function allowedEnvironment(credentials: Record<string, string>): NodeJS.ProcessEnv { const names = ["PATH", "Path", "SystemRoot", "WINDIR", "PATHEXT", "ComSpec", "TEMP", "TMP", "STORYVIDEOGEN_PYTHON", "PYTHON"]; const env: NodeJS.ProcessEnv = {PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1"}; for (const name of names) if (process.env[name]) env[name] = process.env[name]; const allowedCredentials = new Set(["ZAI_API_KEY", "SILICONFLOW_API_KEY", "PEXELS_API_KEY", "PIXABAY_API_KEY"]); for (const [name, value] of Object.entries(credentials)) { if (!allowedCredentials.has(name)) throw new Error("Worker credential environment name is not allowed."); env[name] = value; } return env; }
function optionalSafeResultFile(value: unknown, storageRoot: string): string | undefined { if (value === undefined) return undefined; if (typeof value !== "string" || path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) throw new Error("Worker result file is unsafe."); const candidate = path.resolve(storageRoot, value); if (path.relative(storageRoot, candidate).startsWith("..")) throw new Error("Worker result escaped its storage root."); return value; }
function sanitizeStderr(value: string): string { return value.replace(/(api[_-]?key|authorization|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]").replace(/[\r\n]+/g, " ").trim().slice(0, 500); }
function safeFailureMessage(code: string, detail: string): string { if (code === "WORKER_CONTRACT_INVALID") return `The media worker returned invalid data: ${detail.slice(0, 160)}`; if (code === "WORKER_START_FAILED") return "The media worker could not be started."; if (code === "WORKER_EXITED") return "The media worker exited unexpectedly."; return detail.slice(0, 500); }
