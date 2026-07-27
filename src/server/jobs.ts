import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type { JobRecord } from "../shared/types.js";
import { getJob, upsertJob } from "./db.js";

const events = new EventEmitter();
events.setMaxListeners(100);

function persist(job: JobRecord): JobRecord {
  upsertJob(job);
  events.emit(job.id, job);
  return job;
}

export function updateJob(
  id: string,
  patch: Partial<Pick<JobRecord, "status" | "progress" | "message" | "result" | "error">>
): JobRecord {
  const current = getJob(id);
  if (!current) throw new Error(`任务不存在：${id}`);
  return persist({ ...current, ...patch, updatedAt: new Date().toISOString() });
}

export function createJob(
  kind: JobRecord["kind"],
  action: (update: (progress: number, message: string) => void) => Promise<unknown>
): JobRecord {
  const now = new Date().toISOString();
  const job: JobRecord = {
    id: crypto.randomUUID(),
    kind,
    status: "queued",
    progress: 0,
    message: "等待执行",
    createdAt: now,
    updatedAt: now
  };
  persist(job);
  setImmediate(async () => {
    updateJob(job.id, { status: "running", progress: 1, message: "开始执行" });
    try {
      const result = await action((progress, message) =>
        updateJob(job.id, {
          status: "running",
          progress: Math.max(1, Math.min(99, Math.round(progress))),
          message
        })
      );
      updateJob(job.id, {
        status: "completed",
        progress: 100,
        message: "执行完成",
        result
      });
    } catch (error) {
      updateJob(job.id, {
        status: "failed",
        progress: 100,
        message: "执行失败",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  return job;
}

export function subscribeJob(id: string, listener: (job: JobRecord) => void): () => void {
  events.on(id, listener);
  return () => events.off(id, listener);
}
