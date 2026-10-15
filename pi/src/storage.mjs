import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export async function command(file, args, cwd, timeout = 20000) {
  const { stdout } = await exec(file, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}
export function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export function atomicJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
export function writeNew(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, text, { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
}
export async function repository(cwd) {
  const text = await command('git', ['worktree', 'list', '--porcelain'], cwd);
  const root = text.match(/^worktree (.+)$/m)?.[1];
  if (!root) throw new Error('Foreman needs a Git repository with a main checkout.');
  const common = await command('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  const exclude = path.join(common, 'info/exclude');
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  const old = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  const missing = ['/.foreman/', '/handovers/', '/HANDOVER.md'].filter(x => !old.split('\n').includes(x));
  if (missing.length) fs.appendFileSync(exclude, `${old.endsWith('\n') || !old ? '' : '\n'}${missing.join('\n')}\n`);
  return fs.realpathSync(root);
}

// One local process owns each topic. Never replace a live owner's lease.
export function acquireLease(dir, sessionId) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'owner.json');
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, sessionId, token }), { flag: 'wx', mode: 0o600 });
      return () => { if (readJSON(file, {})?.token === token) fs.unlinkSync(file); };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const owner = readJSON(file, {});
      let alive = true;
      if (!Number.isInteger(owner.pid)) throw new Error(`Invalid owner lease: ${file}`);
      try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      if (alive) throw new Error(`Topic is already owned by session ${owner.sessionId} (PID ${owner.pid}).`);
      // Serialize stale-owner reclamation. Do not race two new owners.
      const reclaim = `${file}.reclaim`;
      fs.mkdirSync(reclaim);
      try { if (readJSON(file, {})?.token === owner.token) fs.unlinkSync(file); }
      finally { fs.rmdirSync(reclaim); }
    }
  }
  throw new Error('Could not acquire topic lease.');
}

export function parseBrief(text, role) {
  if (Buffer.byteLength(text) > 100000) throw new Error('Brief exceeds 100 KB.');
  const fields = {};
  for (const line of text.split('\n')) {
    const m = /^(Task ID|Branch|Base|Effort):\s*(\S.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim();
  }
  const required = role === 'builder'
    ? ['Task', 'Rule or cause', 'Start here', 'Done when', 'Tests', 'Out of scope']
    : ['Task', 'Start here', 'Done when'];
  for (const heading of required) {
    const re = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm');
    if (!re.exec(text)?.[1]?.trim()) throw new Error(`Brief needs a nonempty "## ${heading}" section.`);
  }
  if (fields.Effort && !['medium', 'high'].includes(fields.Effort)) throw new Error('Effort must be medium or high.');
  return fields;
}
export const ROLES = ['builder', 'investigator', 'clerk', 'scout', 'responder'];
export const TERMINAL = new Set(['completed', 'failed', 'stopped', 'cancelled']);
