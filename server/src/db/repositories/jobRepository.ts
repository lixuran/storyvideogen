import {randomUUID} from "node:crypto";

import type {SqliteDatabase} from "../database.js";
import {runInTransaction} from "../transaction.js";

export type JobState = "queued" | "running" | "cancel_requested" | "succeeded" | "failed" | "cancelled";
export interface JobRecord {id: string; userId: string; storyId: string | null; type: string; state: JobState; progress: number; attempt: number; maxAttempts: number; leaseOwner: string | null; leaseExpiresAt: string | null; idempotencyKey: string | null; payload: Record<string, unknown>; result: Record<string, unknown> | null; errorCode: string | null; errorMessage: string | null; runAfter: string; createdAt: string; updatedAt: string}
export interface JobEventRecord {id: number; jobId: string; eventType: string; payload: Record<string, unknown>; createdAt: string}
interface JobRow {id: string; user_id: string; story_id: string | null; type: string; state: JobState; progress: number; attempt: number; max_attempts: number; lease_owner: string | null; lease_expires_at: string | null; idempotency_key: string | null; payload_json: string; result_json: string | null; error_code: string | null; error_message: string | null; run_after: string; created_at: string; updated_at: string}
interface EventRow {id: number; job_id: string; event_type: string; payload_json: string; created_at: string}

export class JobRepository {
  constructor(private readonly database: SqliteDatabase) {}

  enqueue(values: {userId: string; storyId: string; type: string; idempotencyKey: string; payload: Record<string, unknown>; maxAttempts?: number}, now: string): {job: JobRecord; created: boolean} {
    return runInTransaction(this.database, () => {
      const existing = this.findByIdempotency(values.userId, values.idempotencyKey);
      if (existing) return {job: existing, created: false};
      const id = randomUUID();
      this.database.prepare("INSERT INTO jobs (id, user_id, story_id, type, idempotency_key, payload_json, max_attempts, run_after, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, values.userId, values.storyId, values.type, values.idempotencyKey, JSON.stringify(values.payload), values.maxAttempts ?? 3, now, now, now);
      this.appendEvent(id, "queued", {attempt: 0}, now);
      return {job: this.findById(id)!, created: true};
    });
  }

  findOwned(userId: string, id: string): JobRecord | undefined { const row = this.database.prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?").get(id, userId) as JobRow | undefined; return row && mapJob(row); }
  findById(id: string): JobRecord | undefined { const row = this.database.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined; return row && mapJob(row); }
  findByIdempotency(userId: string, key: string): JobRecord | undefined { const row = this.database.prepare("SELECT * FROM jobs WHERE user_id = ? AND idempotency_key = ?").get(userId, key) as JobRow | undefined; return row && mapJob(row); }
  listForStory(userId: string, storyId: string): JobRecord[] { return (this.database.prepare("SELECT * FROM jobs WHERE user_id = ? AND story_id = ? ORDER BY created_at DESC, id DESC").all(userId, storyId) as JobRow[]).map(mapJob); }
  listAutomaticRecovery(limit = 500): JobRecord[] { return (this.database.prepare("SELECT jobs.* FROM jobs JOIN stories ON stories.id = jobs.story_id WHERE stories.status NOT IN ('completed', 'failed', 'archived') AND jobs.state IN ('succeeded', 'failed') AND jobs.type IN ('plan_story', 'generate_images') ORDER BY jobs.updated_at DESC, jobs.id DESC LIMIT ?").all(limit) as JobRow[]).map(mapJob).filter((job) => job.payload.autoMode === true); }

  claim(workerId: string, now: string, leaseExpiresAt: string): JobRecord | undefined {
    return runInTransaction(this.database, () => {
      this.database.prepare("UPDATE jobs SET state = 'failed', error_code = 'LEASE_EXHAUSTED', error_message = 'The job exhausted its retry attempts after worker interruption.', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, completed_at = ? WHERE state = 'running' AND lease_expires_at <= ? AND attempt >= max_attempts").run(now, now, now);
      const candidate = this.database.prepare("SELECT id FROM jobs WHERE (state = 'queued' AND run_after <= ? AND attempt < max_attempts) OR (state = 'running' AND lease_expires_at <= ? AND attempt < max_attempts) ORDER BY created_at, id LIMIT 1").get(now, now) as {id: string} | undefined;
      if (!candidate) return undefined;
      this.database.prepare("UPDATE jobs SET state = 'running', attempt = attempt + 1, lease_owner = ?, lease_expires_at = ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?").run(workerId, leaseExpiresAt, now, now, candidate.id);
      const job = this.findById(candidate.id)!; this.appendEvent(job.id, job.attempt === 1 ? "started" : "recovered", {attempt: job.attempt, workerId}, now); return job;
    });
  }

  heartbeat(jobId: string, workerId: string, now: string, leaseExpiresAt: string): boolean { return this.database.prepare("UPDATE jobs SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND state = 'running' AND lease_owner = ?").run(leaseExpiresAt, now, jobId, workerId).changes === 1; }
  updateProgress(jobId: string, workerId: string, progress: number, eventType: string, payload: Record<string, unknown>, now: string): boolean { return runInTransaction(this.database, () => { const changed = this.database.prepare("UPDATE jobs SET progress = MAX(progress, ?), updated_at = ? WHERE id = ? AND state = 'running' AND lease_owner = ?").run(progress, now, jobId, workerId).changes === 1; if (changed) this.appendEvent(jobId, eventType, payload, now); return changed; }); }
  complete(jobId: string, workerId: string, result: Record<string, unknown>, now: string): boolean { return runInTransaction(this.database, () => { const changed = this.database.prepare("UPDATE jobs SET state = 'succeeded', progress = 10000, result_json = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, completed_at = ? WHERE id = ? AND state = 'running' AND lease_owner = ?").run(JSON.stringify(result), now, now, jobId, workerId).changes === 1; if (changed) this.appendEvent(jobId, "completed", result, now); return changed; }); }
  fail(jobId: string, workerId: string, code: string, message: string, now: string, retryAfter: string): JobState | undefined { return runInTransaction(this.database, () => { const job = this.findById(jobId); if (!job || job.state !== "running" || job.leaseOwner !== workerId) return undefined; const retry = job.attempt < job.maxAttempts; const state: JobState = retry ? "queued" : "failed"; this.database.prepare("UPDATE jobs SET state = ?, error_code = ?, error_message = ?, run_after = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, completed_at = ? WHERE id = ?").run(state, code, message, retryAfter, now, retry ? null : now, jobId); this.appendEvent(jobId, retry ? "retry_scheduled" : "failed", {code, attempt: job.attempt}, now); return state; }); }
  requestCancel(userId: string, jobId: string, now: string): JobRecord | undefined { return runInTransaction(this.database, () => { const job = this.findOwned(userId, jobId); if (!job) return undefined; if (job.state === "queued") this.database.prepare("UPDATE jobs SET state = 'cancelled', updated_at = ?, completed_at = ? WHERE id = ?").run(now, now, jobId); else if (job.state === "running") this.database.prepare("UPDATE jobs SET state = 'cancel_requested', updated_at = ? WHERE id = ?").run(now, jobId); const updated = this.findOwned(userId, jobId)!; if (updated.state !== job.state) this.appendEvent(jobId, updated.state, {}, now); return updated; }); }
  acknowledgeCancellation(jobId: string, workerId: string, now: string): boolean { return runInTransaction(this.database, () => { const changed = this.database.prepare("UPDATE jobs SET state = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, completed_at = ? WHERE id = ? AND state = 'cancel_requested' AND lease_owner = ?").run(now, now, jobId, workerId).changes === 1; if (changed) this.appendEvent(jobId, "cancelled", {}, now); return changed; }); }

  eventsOwned(userId: string, afterId: number, limit = 200): JobEventRecord[] { const rows = this.database.prepare("SELECT job_events.* FROM job_events JOIN jobs ON jobs.id = job_events.job_id WHERE jobs.user_id = ? AND job_events.id > ? ORDER BY job_events.id LIMIT ?").all(userId, afterId, limit) as EventRow[]; return rows.map(mapEvent); }
  eventsForOwnedJob(userId: string, jobId: string, afterId = 0): JobEventRecord[] { const rows = this.database.prepare("SELECT job_events.* FROM job_events JOIN jobs ON jobs.id = job_events.job_id WHERE jobs.user_id = ? AND jobs.id = ? AND job_events.id > ? ORDER BY job_events.id LIMIT 500").all(userId, jobId, afterId) as EventRow[]; return rows.map(mapEvent); }

  private appendEvent(jobId: string, eventType: string, payload: Record<string, unknown>, now: string): void { this.database.prepare("INSERT INTO job_events (job_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)").run(jobId, eventType, JSON.stringify(payload), now); }
}

function mapJob(row: JobRow): JobRecord { return {id: row.id, userId: row.user_id, storyId: row.story_id, type: row.type, state: row.state, progress: row.progress, attempt: row.attempt, maxAttempts: row.max_attempts, leaseOwner: row.lease_owner, leaseExpiresAt: row.lease_expires_at, idempotencyKey: row.idempotency_key, payload: JSON.parse(row.payload_json) as Record<string, unknown>, result: row.result_json ? JSON.parse(row.result_json) as Record<string, unknown> : null, errorCode: row.error_code, errorMessage: row.error_message, runAfter: row.run_after, createdAt: row.created_at, updatedAt: row.updated_at}; }
function mapEvent(row: EventRow): JobEventRecord { return {id: row.id, jobId: row.job_id, eventType: row.event_type, payload: JSON.parse(row.payload_json) as Record<string, unknown>, createdAt: row.created_at}; }
