import type { JobRecord } from "../shared/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败：${response.status}`);
  return payload as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body: unknown = {}) =>
    request<T>(url, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "PATCH", body: JSON.stringify(body) })
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

async function pollJob(
  id: string,
  onUpdate: (job: JobRecord) => void
): Promise<JobRecord> {
  let consecutiveErrors = 0;
  while (consecutiveErrors < 40) {
    try {
      const next = await api.get<JobRecord>(`/api/jobs/${id}`);
      consecutiveErrors = 0;
      onUpdate(next);
      if (next.status === "completed") return next;
      if (next.status === "failed") throw new Error(next.error || "任务执行失败");
    } catch (error) {
      if (error instanceof Error && error.message !== "Failed to fetch") throw error;
      consecutiveErrors += 1;
    }
    await wait(1500);
  }
  throw new Error("任务进度连接长时间中断，请刷新页面查看结果。");
}

export function waitForJob(job: JobRecord, onUpdate: (job: JobRecord) => void): Promise<JobRecord> {
  return new Promise((resolve, reject) => {
    const stream = new EventSource(`/api/jobs/${job.id}/events`);
    let polling = false;
    stream.onmessage = (event) => {
      const next = JSON.parse(event.data) as JobRecord;
      onUpdate(next);
      if (next.status === "completed") {
        stream.close();
        resolve(next);
      } else if (next.status === "failed") {
        stream.close();
        reject(new Error(next.error || "任务执行失败"));
      }
    };
    stream.onerror = () => {
      if (polling) return;
      polling = true;
      stream.close();
      void pollJob(job.id, onUpdate).then(resolve, reject);
    };
  });
}
