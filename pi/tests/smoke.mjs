// Run manually: node pi/tests/smoke.mjs. Uses a deterministic provider and real Pi
// plus pi-subagents in a temporary Git repository, never a provider credential.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { command, atomicJSON } from '../src/storage.mjs';
const pkg = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-smoke-'));
const subagents = process.env.PI_SUBAGENTS_PATH || path.join(os.homedir(), '.pi/agent/npm/node_modules/pi-subagents/index.js');
if (!fs.existsSync(subagents)) throw new Error('Set PI_SUBAGENTS_PATH to the installed pi-subagents/index.js.');
await command('git', ['init', '-q'], root);
await command('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '--allow-empty', '-qm', 'init'], root);
for (const name of ['first', 'second']) fs.writeFileSync(path.join(root, `${name}.md`), '# Smoke\n\n## Task\nReport completion without editing files.\n\n## Start here\nThe assigned worktree.\n\n## Done when\nA short final report is returned.\n');
atomicJSON(path.join(root, '.foreman/config.json'), { maxWorkers: 1, workerExtensions: [path.join(pkg, 'tests/mock-provider.ts')] });
const agentDir = path.join(root, 'pi-config'); fs.mkdirSync(agentDir);
atomicJSON(path.join(agentDir, 'settings.json'), { packages: [], defaultProvider: 'foreman-test', defaultModel: 'mock' });
const child = spawn(process.env.PI_BIN || 'pi', ['--mode', 'rpc', '--no-extensions', '--no-mcp', '--no-skills',
  '-e', subagents, '-e', path.join(pkg, 'extensions/foreman.ts'), '-e', path.join(pkg, 'tests/mock-provider.ts'),
  '--provider', 'foreman-test', '--model', 'mock'], { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, FOREMAN_SMOKE_ROOT: root }, stdio: ['pipe', 'pipe', 'pipe'] });
const log = fs.createWriteStream(path.join(root, 'pi.log'));
let buffer = ''; let ready = false; let firstEnded = false;
let pauseSent = false; let continueSent = false; let callsAtPause = null;
child.stdout.on('data', chunk => {
  log.write(chunk); buffer += chunk;
  for (;;) {
    const pos = buffer.indexOf('\n'); if (pos < 0) break;
    const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
    try {
      const event = JSON.parse(line);
      if (event.type === 'agent_end') firstEnded = true;
      if (event.id === 'state' && !ready) { ready = true; child.stdin.write(JSON.stringify({ id: 'start', type: 'prompt', message: '/foreman' }) + '\n'); }
    } catch {}
  }
});
child.stderr.on('data', chunk => log.write(chunk));
child.stdin.write(JSON.stringify({ id: 'state', type: 'get_state' }) + '\n');
try {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (child.exitCode !== null) throw new Error(`Pi exited ${child.exitCode}`);
    const file = path.join(root, '.foreman/pi/main/state.json');
    if (!fs.existsSync(file)) continue;
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const jobs = Object.values(state.jobs);
    if (process.env.FOREMAN_SMOKE_PAUSE === '1' && jobs.length === 1 && firstEnded && !pauseSent) {
      pauseSent = true;
      child.stdin.write(JSON.stringify({ id: 'pause', type: 'prompt', message: '/foreman-pause' }) + '\n');
    }
    if (pauseSent && state.mode === 'paused' && callsAtPause === null) {
      callsAtPause = fs.readFileSync(path.join(root, 'lead-calls.jsonl'), 'utf8').trim().split('\n').length;
    }
    if (pauseSent && state.mode === 'paused' && jobs[0]?.state === 'completed' && !continueSent) {
      const calls = fs.readFileSync(path.join(root, 'lead-calls.jsonl'), 'utf8').trim().split('\n').length;
      if (calls !== callsAtPause || jobs.length !== 1) throw new Error('Paused Foreman made a model call or dispatched work.');
      continueSent = true;
      child.stdin.write(JSON.stringify({ id: 'continue', type: 'prompt', message: '/foreman-continue' }) + '\n');
    }
    if (jobs.some(j => ['failed', 'unknown'].includes(j.state))) throw new Error(JSON.stringify(jobs));
    if (jobs.length === 2 && jobs.every(j => j.state === 'completed')) {
      if (!firstEnded) throw new Error('No lead turn ending was observed.');
      if (!jobs.every(j => fs.existsSync(j.readyPath) && fs.existsSync(j.telemetryPath))) throw new Error('Worker policy or telemetry missing.');
      console.log(`PASS: idle lead woke and dispatched a second worker; both completed with telemetry.${pauseSent ? ' Pause suppressed model calls until continue.' : ''} Artifacts: ${root}`);
      process.exitCode = 0; break;
    }
  }
  if (process.exitCode !== 0) throw new Error('Timed out waiting for two completed workers.');
} catch (e) { console.error(`FAIL: ${e.message}\nArtifacts: ${root}`); process.exitCode = 1; }
finally { child.kill('SIGTERM'); log.end(); }
