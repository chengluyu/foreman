import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function rpc(pi, method, params = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const off = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, reply => {
      clearTimeout(timer); off?.();
      if (!reply.success) reject(new Error(reply.error?.message || 'Subagent RPC failed'));
      else resolve(reply.data);
    });
    const timer = setTimeout(() => { off?.(); reject(new Error(`Subagent ${method} timed out. Dispatch outcome may be unknown; do not retry blindly.`)); }, timeoutMs);
    pi.events.emit('subagents:rpc:v1:request', { version: 1, requestId, method, params, source: { extension: 'pi-foreman' } });
  });
}
// Tool calls per worker, matching the step limits in the role profiles. At the
// soft limit pi-subagents blocks further exploration; at the hard limit it stops.
export const BUDGETS = {
  builder: { soft: 150, hard: 250 },
  investigator: { soft: 80, hard: 120 },
  clerk: { soft: 60, hard: 120 },
  responder: { soft: 50, hard: 80 },
  scout: { soft: 20, hard: 40 },
};
export function subagentAdapter(pi, packageRoot) {
  const registrations = [];
  return {
    async ready() { return rpc(pi, 'ping', {}, 3000); },
    async spawn(job, extension, task, workerExtensions = []) {
      const name = `foreman-${job.role}-${job.id}`;
      const request = { version: 1, name, definition: {
        description: `Foreman ${job.role}: ${job.taskId}`,
        systemPrompt: fs.readFileSync(path.join(packageRoot, 'agents', `${job.role}.md`), 'utf8').trim(),
        model: job.model, thinking: job.effort,
        tools: [...(['scout', 'investigator'].includes(job.role) ? ['read', 'bash', 'grep', 'find', 'ls'] : ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']), 'contact_supervisor'],
        extensions: [extension, ...workerExtensions], inheritProjectContext: true, inheritGlobalContext: false,
        inheritSkills: false, defaultContext: 'fresh', allowNestedSubagents: false,
        systemPromptMode: 'append', defaultTimeoutMs: 3600000,
      } };
      pi.events.emit('pi-subagents:runtime-agent-register:v1', request);
      if (!request.result?.ok) throw new Error(request.result?.error?.message || 'pi-subagents 0.77.0 is required.');
      registrations.push(request.result.registration);
      return rpc(pi, 'spawn', { agent: name, task, cwd: job.worktree, model: job.model,
        thinking: job.effort, context: 'fresh', async: true, timeoutMs: 3600000,
        toolBudget: BUDGETS[job.role] }, 90000);
    },
    stop(id) { return rpc(pi, 'stop', { id }); },
    close() { for (const registration of registrations) registration.dispose(); },
  };
}
