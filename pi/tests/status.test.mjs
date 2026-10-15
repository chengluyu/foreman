import test from 'node:test';
import assert from 'node:assert/strict';
import { currentStatus } from '../src/status.mjs';

const state = () => ({ mode: 'active', jobs: {}, watches: {}, processes: {}, events: {} });
const view = (s, taskId) => currentStatus(s, { topic: 'browser', maxWorkers: 3, taskId });
const job = (taskId, state, extra = {}) => ({ taskId, state, id: taskId, role: 'clerk', createdAt: 1, ...extra });

test('progress view omits the acknowledged failed launch from the reported session pattern', () => {
  const s = state();
  s.jobs.old = job('old', 'failed', { error: 'branch already exists', worktree: '/old', snapshot: '/old/brief.md' });
  s.jobs.current = job('current', 'running', { runId: 'r1', createdAt: 2, model: 'kimi-coding/k3', telemetryPath: '/usage.json' });
  s.events.old = { id: 'launch:old', kind: 'dispatch_problem', delivered: true, details: { taskId: 'old', error: s.jobs.old.error } };
  s.events.start = { id: 'started:current', kind: 'worker_started', delivered: false, details: { taskId: 'current', worktree: '/current' } };
  const before = JSON.stringify(s);
  const result = view(s);
  assert.deepEqual(result.workers, [{ taskId: 'current', runId: 'r1', role: 'clerk', state: 'running' }]);
  assert.deepEqual(result.attention, []);
  assert.deepEqual(result.capacity, { occupied: 1, limit: 3 });
  assert.doesNotMatch(JSON.stringify(result), /already exists|telemetryPath|snapshot|model|old/);
  assert.equal(JSON.stringify(s), before, 'presentation must not alter runtime history');
});
test('unreported failure and ambiguous launch remain visible', () => {
  const s = state();
  s.jobs.failed = job('failed', 'failed', { error: 'could not allocate' });
  s.jobs.unknown = job('unknown', 'unknown', { error: 'dispatch outcome uncertain' });
  s.events.fail = { id: 'launch:failed', kind: 'dispatch_problem', delivered: false, details: { taskId: 'failed', error: 'could not allocate' } };
  assert.equal(view(s).workers.length, 2); assert.equal(view(s).attention.length, 1);
});
test('current worker failure is retained, but an older attempt on the same task is hidden', () => {
  const s = state();
  s.jobs.a = job('task', 'failed', { runId: 'r1' });
  assert.equal(view(s).workers[0].runId, 'r1');
  s.jobs.b = job('task', 'running', { createdAt: 2, runId: 'r2' });
  assert.deepEqual(view(s).workers.map(w => w.runId), ['r2']);
});
test('finished history is hidden by default but the latest task outcome can be requested', () => {
  const s = state(); s.jobs.a = job('task', 'completed', { runId: 'r1' });
  assert.deepEqual(view(s).workers, []);
  assert.equal(view(s, 'task').workers[0].state, 'completed');
  s.watches.w = { id: 'w', target: { repo: 'o/r', pr: 1 }, state: 'pending', deadline: Date.now(), createdAt: 1 };
  s.processes.p = { id: 'p', name: 'server', status: 'running' };
  assert.deepEqual(view(s, 'task').watches, []); assert.deepEqual(view(s, 'task').processes, []);
});
test('only latest review per PR and live or unreported processes appear', () => {
  const s = state();
  s.watches.a = { id: 'a', target: { repo: 'o/r', pr: 1 }, state: 'timeout', createdAt: 1 };
  s.watches.b = { id: 'b', target: { repo: 'o/r', pr: 1 }, state: 'pending', createdAt: 2, deadline: 60000 };
  s.watches.c = { id: 'c', target: { repo: 'o/r', pr: 2 }, state: 'closed', createdAt: 1 };
  s.events.old = { id: 'watch:a', kind: 'review', delivered: false, details: { id: 'a', state: 'timeout' } };
  s.processes.old = { id: 'old', name: 'old tests', status: 'exited', outcome: 'completed', exitCode: 0 };
  s.processes.live = { id: 'live', name: 'server', status: 'running' };
  s.processes.new = { id: 'new', name: 'new tests', status: 'exited', outcome: 'failed', exitCode: 7 };
  s.events.new = { id: 'process:new', kind: 'process_terminal', delivered: false, details: { id: 'new', outcome: 'failed', stdoutFile: '/logs/out' } };
  const result = view(s);
  assert.deepEqual(result.watches, [{ watchId: 'b', pr: 'o/r#1', state: 'pending', deadline: '1970-01-01T00:01:00.000Z' }]);
  assert.deepEqual(result.processes.map(p => p.processId), ['live', 'new']);
  assert.equal(result.attention.length, 1); assert.doesNotMatch(JSON.stringify(result), /stdoutFile|old tests/);
});
test('large queues and errors have bounded output with an omission count', () => {
  const s = state();
  for (let i = 0; i < 30; i++) s.jobs[i] = job(`task-${i}`, 'unknown', { error: 'x'.repeat(10000) });
  const result = view(s);
  assert.equal(result.workers.length, 20); assert.equal(result.omitted.workers, 10);
  assert.equal(result.workers[0].problem.length, 240);
  assert.equal(result.capacity.occupied, 30);
});
