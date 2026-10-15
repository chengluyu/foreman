import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ForemanRuntime } from '../src/runtime.mjs';
import { command, atomicJSON, parseBrief, acquireLease } from '../src/storage.mjs';
import { enforceCache, usageTotal } from '../src/policy.mjs';
import { checkReview, tickWatches } from '../src/watch.mjs';
const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const brief = (extra = '') => `# Task\n${extra}\n## Task\nDo one thing.\n## Rule or cause\nA reproduced bug.\n## Start here\nREADME.md\n## Done when\nThe check passes.\n## Tests\nRun the named test.\n## Out of scope\nEverything else.\n`;
async function fixture(t, maxWorkers = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-test-'));
  await command('git', ['init', '-q'], root);
  await command('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'initial'], root);
  atomicJSON(path.join(root, '.foreman/config.json'), { maxWorkers });
  const launches = [];
  const adapter = { async spawn(job) {
    launches.push(job.id);
    const asyncDir = path.join(root, 'artifacts', job.id); fs.mkdirSync(asyncDir, { recursive: true });
    atomicJSON(path.join(asyncDir, 'status.json'), { state: 'running' });
    return { details: { runId: job.id, asyncDir } };
  }, async stop() {} };
  const r = new ForemanRuntime({ root, topic: 'test', sessionId: 'session', packageRoot, adapter, model: { provider: 'kimi-coding', id: 'k3' } });
  t.after(() => { r.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const write = (name, text = brief()) => { const file = path.join(root, name + '.md'); fs.writeFileSync(file, text); return file; };
  return { r, root, launches, adapter, write };
}
test('Markdown validation rejects missing or empty sections', () => {
  assert.equal(parseBrief(brief('Effort: high'), 'builder').Effort, 'high');
  assert.throws(() => parseBrief('## Task\n\n## Start here\nx\n## Done when\ny', 'scout'), /nonempty/);
  assert.throws(() => parseBrief('## Task\nx', 'builder'), /Rule or cause/);
});
test('dispatch snapshots Markdown, inherits K3, and repeated paths never relaunch', async t => {
  const { r, write, launches } = await fixture(t);
  const file = write('one');
  const job = await r.dispatch('builder', file);
  assert.equal(job.state, 'running'); assert.equal(job.model, 'kimi-coding/k3');
  assert.equal(await command('git', ['branch', '--show-current'], job.worktree), job.branch);
  fs.writeFileSync(file, 'changed');
  assert.equal((await r.dispatch('builder', file)).runId, job.runId);
  assert.equal(launches.length, 1); assert.match(fs.readFileSync(job.snapshot, 'utf8'), /Do one thing/);
});
test('terminal event releases capacity and starts the next authorized brief', async t => {
  const { r, write, launches } = await fixture(t);
  const a = await r.dispatch('builder', write('a'));
  const b = await r.dispatch('builder', write('b'));
  assert.equal(b.state, 'queued');
  atomicJSON(path.join(a.asyncDir, 'status.json'), { state: 'complete' });
  await r.reconcile(); await r.reconcile();
  assert.equal(a.state, 'completed'); assert.equal(b.state, 'running'); assert.equal(launches.length, 2);
});
test('parallel calls for the same brief produce only one launch', async t => {
  const { r, write, launches } = await fixture(t, 2);
  const file = write('one');
  const [a, b] = await Promise.all([r.dispatch('scout', file), r.dispatch('scout', file)]);
  assert.equal(a.runId, b.runId); assert.equal(launches.length, 1);
});
test('late GitHub result cannot overwrite timeout', async () => {
  const watch = { id: 'x', state: 'pending', deadline: Date.now() + 10000, nextCheck: 0 };
  const events = [];
  await tickWatches({ x: watch }, { check: async () => { watch.state = 'timeout'; return { state: 'passed' }; }, emit: w => events.push(w.state), save() {} });
  assert.equal(watch.state, 'timeout'); assert.deepEqual(events, []);
});
test('pause prevents queued dispatch; follow-up reuses task worktree', async t => {
  const { r, write, launches } = await fixture(t);
  const a = await r.dispatch('builder', write('a'));
  const b = await r.dispatch('responder', write('b', brief(`Task ID: ${a.taskId}`)));
  r.state.mode = 'paused'; r.save();
  atomicJSON(path.join(a.asyncDir, 'status.json'), { state: 'complete' });
  await r.reconcile(); assert.equal(launches.length, 1);
  r.state.mode = 'active'; await r.drain();
  assert.equal(b.worktree, a.worktree); assert.equal(b.state, 'running');
});
test('ambiguous launch reserves capacity and is not retried', async t => {
  const { r, write, adapter } = await fixture(t);
  adapter.spawn = async () => { throw new Error('RPC timeout'); };
  const job = await r.dispatch('builder', write('a'));
  assert.equal(job.state, 'unknown');
  await r.drain(); assert.equal(job.state, 'unknown');
});
test('live topic lease refuses another owner', async t => {
  const { r } = await fixture(t);
  assert.throws(() => acquireLease(r.dir, 'other'), /already owned/);
});
test('a paused child remains an owner until its later completion', async t => {
  const { r, write } = await fixture(t);
  const a = await r.dispatch('builder', write('a'));
  const b = await r.dispatch('builder', write('b'));
  atomicJSON(path.join(a.asyncDir, 'status.json'), { state: 'paused' });
  await r.reconcile(); assert.equal(a.state, 'blocked'); assert.equal(b.state, 'queued');
  atomicJSON(path.join(a.asyncDir, 'status.json'), { state: 'complete' });
  await r.reconcile(); assert.equal(a.state, 'completed'); assert.equal(b.state, 'running');
});
test('cache enforcement changes every Anthropic breakpoint and leaves Kimi unchanged', () => {
  const p = { system: [{ text: 'x', cache_control: { type: 'ephemeral' } }], messages: [{ content: [{ cache_control: { type: 'ephemeral', ttl: '5m' } }] }] };
  const out = enforceCache(p, { api: 'anthropic-messages', provider: 'anthropic' });
  assert.equal(out.system[0].cache_control.ttl, '1h'); assert.equal(out.messages[0].content[0].cache_control.ttl, '1h');
  assert.equal(p.system[0].cache_control.ttl, undefined);
  assert.equal(enforceCache(p, { api: 'openai-completions', provider: 'kimi-coding' }), p);
  assert.equal(enforceCache(p, { api: 'anthropic-messages', provider: 'kimi-coding' }), p);
  assert.throws(() => enforceCache(p, { api: 'other', provider: 'anthropic' }), /Unsupported/);
});
test('usage keeps cache prices and counts a keyed message only once', () => {
  const usage = { input: 1, cacheRead: 500, cacheWrite: 50, cacheWrite1h: 20, cost: { input: 0.01, cacheRead: 0.02, cacheWrite: 0.03, total: 0.06 } };
  const records = { a: { usage } }; records.a = { usage };
  const total = usageTotal(records);
  assert.equal(total.responses, 1); assert.equal(total.cacheRead, 500); assert.equal(total.cost.cacheWrite, 0.03);
});
const sha = 'a'.repeat(40);
const target = { repo: 'owner/repo', pr: 1, headSha: sha, requestId: '2' };
function fakeAPI({ head = sha, review, reaction = false, marker = false, finalHead } = {}) {
  let reads = 0;
  return async endpoint => {
    if (endpoint.endsWith('/pulls/1')) return { head: { sha: ++reads > 1 && finalHead ? finalHead : head }, state: 'open' };
    if (endpoint.endsWith('/issues/comments/2')) return { issue_url: 'https://api.github.com/repos/owner/repo/issues/1', body: '@codex review' + (marker ? `\n<!-- foreman-head: ${sha} -->` : ''), created_at: '2026-10-13T00:00:00Z' };
    if (endpoint.endsWith('/reviews')) return review ? [review] : [];
    if (endpoint.endsWith('/reactions')) return reaction ? [{ id: 1, user: { login: 'chatgpt-codex-connector[bot]' }, content: '+1', created_at: '2026-10-13T00:01:00Z' }] : [];
    if (endpoint.endsWith('/comments')) return [];
    throw new Error(endpoint);
  };
}
test('review ignores old heads and unbound thumbs-up', async () => {
  assert.equal((await checkReview(target, fakeAPI({ reaction: true }))).state, 'pending');
  assert.equal((await checkReview(target, fakeAPI({ reaction: true, marker: true }))).state, 'passed');
  const review = { id: 3, commit_id: 'b'.repeat(40), state: 'APPROVED', submitted_at: '2026-10-13T00:01:00Z', user: { login: 'codex[bot]' } };
  assert.equal((await checkReview(target, fakeAPI({ review }))).state, 'pending');
  review.commit_id = sha;
  assert.equal((await checkReview(target, fakeAPI({ review, finalHead: 'b'.repeat(40) }))).state, 'head_changed');
});
test('watch deadlines work without any GitHub response and fire once', async () => {
  const watches = { x: { id: 'x', state: 'pending', deadline: Date.now() - 1, nextCheck: 0 } };
  const events = [];
  const opts = { check: () => { throw new Error('must not poll after deadline'); }, emit: w => events.push(w.id), save() {} };
  await tickWatches(watches, opts); await tickWatches(watches, opts);
  assert.deepEqual(events, ['x']); assert.equal(watches.x.state, 'timeout');
});
test('repeated unavailable checks produce one unavailable event', async () => {
  const watches = { x: { id: 'x', state: 'pending', deadline: Date.now() + 999999, nextCheck: 0 } };
  const events = [];
  for (let i = 0; i < 3; i++) {
    watches.x.nextCheck = 0;
    await tickWatches(watches, { check: async () => { throw new Error('offline'); }, emit: w => events.push(w.state), save() {} });
  }
  assert.deepEqual(events, ['unavailable']);
});
test('watch deduplicates without extending deadline and cancel persists', async t => {
  const { r } = await fixture(t);
  const a = await r.watch({ action: 'create', kind: 'github-review', target }, fakeAPI());
  const deadline = a.deadline;
  const b = await r.watch({ action: 'create', kind: 'github-review', target, timeoutMinutes: 120 }, fakeAPI());
  assert.equal(b.id, a.id); assert.equal(b.deadline, deadline);
  await r.watch({ action: 'cancel', watchId: a.id });
  assert.equal(r.state.watches[a.id].state, 'cancelled');
});
