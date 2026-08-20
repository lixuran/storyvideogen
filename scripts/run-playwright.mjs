import {spawn} from "node:child_process";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(workspaceRoot, "node_modules", "@playwright", "test", "cli.js");
const runId = process.env.STORYVIDEOGEN_E2E_RUN_ID || `${Date.now()}-${process.pid}`;
const child = spawn(process.execPath, [cli, "test", ...process.argv.slice(2)], {cwd: workspaceRoot, env: {...process.env, STORYVIDEOGEN_E2E_RUN_ID: runId}, shell: false, stdio: "inherit", windowsHide: true});
child.once("error", (error) => { process.stderr.write(`Unable to start Playwright: ${error.message}\n`); process.exitCode = 1; });
child.once("exit", (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
