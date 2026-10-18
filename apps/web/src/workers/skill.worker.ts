/// <reference lib="webworker" />
import {
  runSkill,
  SkillError,
  SkillRegistry,
  type DocumentFile,
  type LogEntry,
  type RunResult,
  type SerializedSkillError,
} from '@folio/skills-core';
import { localSkills } from '@folio/skills-local';

const registry = new SkillRegistry().registerAll(localSkills);
const activeControllers = new Map<string, AbortController>();

export type WorkerRequest =
  | {
      type: 'run';
      jobId: string;
      skillId: string;
      files: DocumentFile[];
      options: Record<string, unknown>;
    }
  | {
      type: 'abort';
      jobId: string;
    };

export type WorkerResponse =
  | { type: 'progress'; jobId: string; fraction: number; label?: string }
  | { type: 'log'; jobId: string; entry: LogEntry }
  | { type: 'result'; jobId: string; result: RunResult }
  | { type: 'error'; jobId: string; error: SerializedSkillError };

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'abort') {
    activeControllers.get(msg.jobId)?.abort();
    activeControllers.delete(msg.jobId);
    return;
  }

  if (msg.type === 'run') {
    const controller = new AbortController();
    activeControllers.set(msg.jobId, controller);

    try {
      const skill = registry.get(msg.skillId);
      const result = await runSkill(skill, msg.files, msg.options, {
        signal: controller.signal,
        onProgress: (fraction, label) => {
          ctx.postMessage({ type: 'progress', jobId: msg.jobId, fraction, ...(label ? { label } : {}) } satisfies WorkerResponse);
        },
        onLog: (entry) => {
          ctx.postMessage({ type: 'log', jobId: msg.jobId, entry } satisfies WorkerResponse);
        },
      });

      const transferables: Transferable[] = result.files
        .map((f) => f.bytes.buffer)
        .filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);

      ctx.postMessage({ type: 'result', jobId: msg.jobId, result } satisfies WorkerResponse, transferables);
    } catch (err) {
      const skillErr = SkillError.from(err);
      ctx.postMessage({ type: 'error', jobId: msg.jobId, error: skillErr.toJSON() } satisfies WorkerResponse);
    } finally {
      activeControllers.delete(msg.jobId);
    }
  }
});
