// Real Pi + the complete Aliou package, with a deterministic provider and real
// local commands. No provider API, user repository, or global Pi config touched.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { command, atomicJSON } from '../src/storage.mjs';

const pkg = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-process-smoke-'));
const subagents = process.env.PI_SUBAGENTS_PATH || path.join(os.homedir(), '.pi/agent/npm/node_modules/pi-subagents/index.js');
await command('git', ['init', '-q'], root);
await command('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '--allow-empty', '-qm', 'init'], root);
const agentDir = path.join(root, 'pi-config'); fs.mkdirSync(agentDir);
atomicJSON(path.join(agentDir, 'settings.json'), { packages: [] });
const child = spawn(process.env.PI_BIN || 'pi', ['--mode', 'rpc', '--no-extensions', '--no-mcp', '--no-skills',
  '-e', subagents, '-e', path.join(pkg, 'extensions/foreman.ts'), '-e', path.join(pkg, 'tests/mock-provider.ts'),
  '--provider', 'foreman-test', '--model', 'mock'], {
  cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, FOREMAN_SMOKE_ROOT: root, FOREMAN_PROCESS_SMOKE: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const log = fs.createWriteStream(path.join(root, 'pi.log'));
let buffer = '', serial = 0, idle = true;
const replies = new Map();
child.stdout.on('data', chunk => {
  log.write(chunk); buffer += chunk;
  for (;;) {
    const end = buffer.indexOf('\n'); if (end < 0) break;
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    try {
      const event = JSON.parse(line);
      if (event.type === 'agent_start') idle = false;
      if (event.type === 'agent_settled') idle = true;
      if (event.type === 'response') replies.set(event.id, event);
    } catch {}
  }
});
child.stderr.on('data', chunk => log.write(chunk));
const stateFile = path.join(root, '.foreman/pi/main/state.json');
const state = () => fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
const calls = () => {
  const file = path.join(root, 'lead-calls.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
};
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Pi exited ${child.exitCode}: ${description}`);
    if (predicate()) return;
    await wait(100);
  }
  throw new Error(`Timed out: ${description}`);
}
async function send(message) {
  const id = `r${++serial}`;
  child.stdin.write(JSON.stringify({ id, type: 'prompt', message }) + '\n');
  await until(() => replies.has(id), `response for ${message.slice(0, 60)}`);
  assert.notEqual(replies.get(id).success, false, JSON.stringify(replies.get(id)));
}
async function processTool(params) {
  const before = calls().length;
  await send(`PROCESS_TEST ${JSON.stringify(params)}`);
  await until(() => calls().length > before + 1 && idle, `tool result ${params.action}`);
}
async function start(name, cmd = 'sleep 1') {
  await processTool({ action: 'start', name, command: cmd, cwd: root });
  const record = Object.values(state().processes).find(p => p.name === name);
  assert.ok(record, `missing ${name}`); return record;
}
function terminal(record) { return Object.values(state().events).find(e => e.kind === 'process_terminal' && e.details.id === record.id); }
async function wake(record, expected) {
  await until(() => terminal(record)?.delivered && calls().some(c => c.wake && c.text.includes(terminal(record).id)) && idle, `wake for ${record.name}`);
  assert.equal(terminal(record).details.outcome, expected);
  await wait(300);
  assert.equal(calls().filter(c => c.wake && c.text.includes(terminal(record).id)).length, 1, 'duplicate wake');
}
try {
  const id = 'ready'; child.stdin.write(JSON.stringify({ id, type: 'get_state' }) + '\n');
  await until(() => replies.has(id), 'Pi startup');
  await send('/foreman');
  await until(() => state()?.mode === 'active' && calls().length && idle, 'Foreman activation');
  const success = await start('success', 'sleep 1; printf "completed\\n"');
  await wake(success, 'completed'); assert.equal(terminal(success).details.exitCode, 0);
  assert.match(fs.readFileSync(success.stdoutFile, 'utf8'), /completed/);
  const failure = await start('failure', 'sleep 1; printf "failure evidence\\n" >&2; exit 7');
  await wake(failure, 'failed'); assert.equal(terminal(failure).details.exitCode, 7);
  const intentional = await start('intentional-stop', 'sleep 30');
  await processTool({ action: 'stop', id: intentional.id }); await wake(intentional, 'stopped');
  const external = await start('external-stop', 'sleep 30');
  process.kill(-external.pid, 'SIGTERM'); await wake(external, 'stopped');
  const slash = await start('slash-stop', 'sleep 30');
  await send(`/ps:kill ${slash.id}`); await wake(slash, 'stopped');
  const busy = await start('busy-completion', 'sleep 1');
  await send('PROCESS_TEST_WAIT'); await wake(busy, 'completed');
  const paused = await start('paused-completion', 'sleep 2');
  await send('/foreman-pause'); await until(() => state().mode === 'paused' && idle, 'pause');
  const before = calls().length;
  await until(() => terminal(paused), 'completion while paused'); await wait(1300);
  assert.equal(calls().length, before, 'model called while paused'); assert.equal(terminal(paused).delivered, false);
  await send('/foreman-continue'); await wake(paused, 'completed');
  const stopped = await start('foreman-stop', 'sleep 30');
  await send('/foreman-stop'); await until(() => state().mode === 'stopped' && terminal(stopped), 'Foreman stop');
  assert.equal(terminal(stopped).delivered, false);
  const afterStop = calls().length; await wait(1300); assert.equal(calls().length, afterStop, 'stop restarted lead');
  console.log(`PASS: success, exit 7, tool stop, external SIGTERM, /ps:kill, busy completion, paused completion, continue, and Foreman stop. No duplicate wakes. Artifacts: ${root}`);
} catch (error) { console.error(`FAIL: ${error.message}\nArtifacts: ${root}`); process.exitCode = 1; }
finally {
  // Scope cleanup to the process groups created by this test, with identity from
  // the dedicated temporary repo. Never touch processes from another session.
  for (const p of Object.values(state()?.processes || {})) {
    if (['running', 'terminating', 'terminate_timeout'].includes(p.status) && p.pid > 1) {
      try { process.kill(-p.pid, 'SIGTERM'); } catch {}
    }
  }
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), wait(3000)]);
  log.end();
}
