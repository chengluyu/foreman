import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { atomicJSON, readJSON, writeNew, acquireLease, command, parseBrief, ROLES, TERMINAL } from './storage.mjs';
import { checkReview, githubAPI, validateTarget, tickWatches } from './watch.mjs';
import { usageTotal } from './policy.mjs';
import { currentStatus } from './status.mjs';

const digest = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
const template = topic => `# Foreman ${topic}\n\n## Goal\n\n## Standing rules\n\n- Worker rules: follow repository instructions; preserve unrelated changes.\n- Review requests: ask the user unless already authorized.\n- Merges: explicit user approval required.\n\n## Running\n\n## Open PRs\n\n## Queue\n\n## Waiting on the user\n\n## Decisions\n`;

export class ForemanRuntime {
  constructor({ root, topic, sessionId, adapter, packageRoot, onEvent = () => {}, model, mode = 'single' }) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(topic)) throw new Error('Invalid topic name.');
    this.root = root; this.topic = topic; this.sessionId = sessionId; this.adapter = adapter;
    this.packageRoot = packageRoot; this.onEvent = onEvent; this.model = model;
    this.dir = path.join(root, '.foreman/pi', topic);
    this.release = acquireLease(this.dir, sessionId);
    try {
      this.file = path.join(this.dir, 'state.json');
      this.state = readJSON(this.file, { version: 1, mode: 'active', jobs: {}, watches: {}, events: {} });
      if (this.state.version !== 1) throw new Error('Unsupported Foreman state version.');
      this.config = { maxWorkers: 3, ...readJSON(path.join(root, '.foreman/config.json'), {}) };
      if (!Number.isInteger(this.config.maxWorkers) || this.config.maxWorkers < 1 || this.config.maxWorkers > 20) throw new Error('maxWorkers must be 1–20.');
      this.handover = mode === 'single' ? path.join(root, 'HANDOVER.md') : path.join(root, 'handovers', `${topic}.md`);
      this.shared = mode === 'single' ? this.handover : path.join(root, 'handovers/_shared.md');
      writeNew(this.handover, template(topic));
      writeNew(this.shared, '# Shared Foreman rules\n\nFollow repository instructions. Merges require explicit user approval.\n');
      fs.mkdirSync(path.join(this.dir, 'briefs'), { recursive: true });
      this.save();
    } catch (e) { this.release(); throw e; }
  }
  save() { atomicJSON(this.file, this.state); }
  close() { this.closed = true; if (!this.draining && !this.ticking) this.release(); }
  rules() {
    return [...new Set([this.shared, this.handover])].map(file => {
      const text = fs.readFileSync(file, 'utf8');
      const section = /^## Standing rules\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(text)?.[1];
      return `Source: ${file}\n${section || (file === this.shared && file !== this.handover ? text : 'Follow repository instructions.')}`;
    }).join('\n\n');
  }
  event(id, kind, details) {
    if (this.state.events[id]) return;
    const event = { id, kind, details, createdAt: Date.now(), delivered: false };
    this.state.events[id] = event; this.save();
    if (!this.closed && this.state.mode === 'active') this.onEvent(event);
  }
  summary(taskId) {
    const jobs = Object.values(this.state.jobs).filter(j => !taskId || j.taskId === taskId);
    const workers = jobs.map(j => {
      const usage = usageTotal(readJSON(j.telemetryPath, {}));
      return { ...j, usage, telemetryAvailable: fs.existsSync(j.telemetryPath),
        childReady: readJSON(j.readyPath, null) };
    });
    return { topic: this.topic, mode: this.state.mode, handover: this.handover, shared: this.shared,
      briefs: path.join(this.dir, 'briefs'), cache: this.model?.provider === 'anthropic' ? '1h enforced' : 'provider-managed (no one-hour guarantee)',
      maxWorkers: this.config.maxWorkers, workers, watches: Object.values(this.state.watches),
      processesAvailable: this.processesAvailable === true, processes: Object.values(this.state.processes || {}),
      events: Object.values(this.state.events).slice(-30) };
  }
  status(taskId) {
    return currentStatus(this.state, { topic: this.topic, maxWorkers: this.config.maxWorkers, taskId,
      workerInfo: job => {
        let task;
        try { task = /^#\s+(.+)$/m.exec(fs.readFileSync(job.snapshot, 'utf8'))?.[1]?.slice(0, 160); } catch {}
        const available = !!job.telemetryPath && fs.existsSync(job.telemetryPath);
        const info = { ...(task ? { task } : {}), costUSD: available ? Number(usageTotal(readJSON(job.telemetryPath, {})).cost.total.toFixed(4)) : null };
        return info;
      },
    });
  }
  dispatch(role, briefPath) {
    const pending = (this.dispatchTail || Promise.resolve()).then(() => this.dispatchOnce(role, briefPath));
    this.dispatchTail = pending.catch(() => {});
    return pending;
  }
  async dispatchOnce(role, briefPath) {
    if (this.closed || this.state.mode !== 'active') throw new Error('Foreman is paused or stopped.');
    if (!ROLES.includes(role) || !path.isAbsolute(briefPath)) throw new Error('Choose a supported role and absolute Markdown brief path.');
    const canonical = fs.realpathSync(briefPath);
    const id = digest(canonical);
    if (this.state.jobs[id]) return this.state.jobs[id];
    const text = fs.readFileSync(canonical, 'utf8');
    const fields = parseBrief(text, role);
    const prior = fields['Task ID'] && Object.values(this.state.jobs).find(j => j.taskId === fields['Task ID']);
    if (fields['Task ID'] && !prior) throw new Error('Unknown Task ID in brief.');
    const branch = prior?.branch || fields.Branch || `foreman/${this.topic}-${id.slice(0, 8)}`;
    await command('git', ['check-ref-format', '--branch', branch], this.root);
    const baseRef = fields.Base || this.config.baseRef || 'HEAD';
    const baseCommit = await command('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], this.root);
    const model = this.model ? `${this.model.provider}/${this.model.id}` : undefined;
    if (!model) throw new Error('Select a lead model before dispatching.');
    const jobDir = path.join(this.dir, 'runs', id);
    fs.mkdirSync(jobDir, { recursive: true });
    const taskId = prior?.taskId || `${this.topic}-${id.slice(0, 8)}`;
    const worktree = prior?.worktree || path.join(this.root, '.foreman/worktrees', taskId);
    const effective = `${text}\n\n## Runtime assignment\nTask ID: ${taskId}\nRepository: ${this.root}\nWorktree: ${worktree}\nBranch: ${branch}\nBase commit: ${baseCommit}\n\n## Standing worker rules (verbatim)\n${this.rules()}\n`;
    const snapshot = path.join(jobDir, 'brief.md');
    writeNew(snapshot, effective);
    const job = { id, taskId, role, briefPath: canonical, snapshot, branch, worktree, baseCommit, model,
      effort: fields.Effort || (['investigator', 'responder'].includes(role) ? 'high' : 'medium'),
      state: 'queued', createdAt: Date.now(), existingWorktree: !!prior,
      telemetryPath: path.join(jobDir, 'usage.json'), readyPath: path.join(jobDir, 'ready.json') };
    this.state.jobs[id] = job; this.save();
    await this.drain();
    return job;
  }
  async drain() {
    if (this.draining || this.closed || this.state.mode !== 'active') return;
    this.draining = true;
    try {
      for (const job of Object.values(this.state.jobs)) {
        if (this.state.mode !== 'active' || this.closed) break;
        const busy = Object.values(this.state.jobs).filter(j => ['launching', 'running', 'stopping', 'unknown', 'blocked'].includes(j.state));
        if (busy.length >= this.config.maxWorkers) break;
        if (job.state !== 'queued' || busy.some(j => j.worktree === job.worktree)) continue;
        job.state = 'launching'; this.save();
        let invoked = false;
        try {
          if (!job.existingWorktree) {
            fs.mkdirSync(path.dirname(job.worktree), { recursive: true });
            await command('git', ['worktree', 'add', '-b', job.branch, job.worktree, job.baseCommit], this.root, 60000);
          }
          const current = await command('git', ['branch', '--show-current'], job.worktree);
          if (current !== job.branch) throw new Error('Assigned worktree is on a different branch.');
          const modulePath = path.join(path.dirname(job.snapshot), 'policy.mjs');
          fs.writeFileSync(modulePath, `import { childExtension } from ${JSON.stringify(pathToFileURL(path.join(this.packageRoot, 'src/policy.mjs')).href)};\nexport default pi => childExtension(pi, ${JSON.stringify({ telemetryPath: job.telemetryPath, readyPath: job.readyPath })});\n`);
          invoked = true;
          const receipt = await this.adapter.spawn(job, modulePath, fs.readFileSync(job.snapshot, 'utf8'), this.config.workerExtensions || []);
          const details = receipt.details || receipt;
          const runId = details.runId || details.asyncId;
          if (!runId) throw new Error('No run ID in dispatch receipt; reconcile before retrying.');
          job.runId = runId; job.asyncDir = details.asyncDir; job.state = 'running';
          job.startedAt = Date.now(); this.save();
          this.event(`started:${job.id}`, 'worker_started', { taskId: job.taskId, runId, worktree: job.worktree });
        } catch (error) {
          job.state = invoked ? 'unknown' : 'failed';
          job.error = error.message; this.save();
          this.event(`launch:${job.id}`, 'dispatch_problem', { taskId: job.taskId, state: job.state, error: job.error });
        }
      }
    } finally { this.draining = false; if (this.closed && !this.ticking) this.release(); }
  }
  async reconcile() {
    if (this.closed) return;
    for (const job of Object.values(this.state.jobs)) {
      if (!job.asyncDir || !['running', 'stopping', 'blocked'].includes(job.state)) continue;
      const state = readJSON(path.join(job.asyncDir, 'status.json'), null);
      if (!state) continue;
      const value = state.state || state.status;
      const mapped = { complete: 'completed', completed: 'completed', failed: 'failed', stopped: 'stopped', paused: 'blocked' }[value];
      if (mapped && mapped !== job.state) {
        job.state = mapped; job.endedAt = Date.now(); job.report = path.join(job.asyncDir, 'status.json'); this.save();
        this.event(`terminal:${job.id}:${mapped}`, 'worker_terminal', { taskId: job.taskId, runId: job.runId, state: mapped, artifacts: job.asyncDir });
      }
    }
    await this.drain();
  }
  async stop() {
    this.state.mode = 'stopped';
    for (const w of Object.values(this.state.watches)) if (w.state === 'pending') w.state = 'cancelled';
    this.save();
    for (const job of Object.values(this.state.jobs)) {
      if (job.state === 'queued') job.state = 'cancelled';
      else if (job.runId && ['running', 'blocked'].includes(job.state)) {
        try { await this.adapter.stop(job.runId); job.state = 'stopping'; }
        catch (e) { job.error = `Stop not confirmed: ${e.message}`; }
      }
    }
    this.save();
  }
  async watch(input, api = githubAPI(this.root)) {
    if (input.action === 'list') return Object.values(this.state.watches);
    if (['get', 'cancel'].includes(input.action)) {
      const watch = this.state.watches[input.watchId];
      if (!watch) throw new Error('Unknown watch ID.');
      if (input.action === 'cancel') { watch.state = 'cancelled'; this.save(); }
      return watch;
    }
    if (input.action !== 'create' || input.kind !== 'github-review') throw new Error('Unknown watch action or kind.');
    if (this.state.mode !== 'active') throw new Error('Foreman is paused or stopped.');
    validateTarget(input.target);
    const target = { repo: input.target.repo, pr: input.target.pr, headSha: input.target.headSha, requestId: input.target.requestId };
    const id = digest(JSON.stringify(target));
    if (this.state.watches[id]) return this.state.watches[id];
    const minutes = input.timeoutMinutes ?? 30;
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) throw new Error('Watch timeout must be 1–120 minutes.');
    const initial = await checkReview(target, api, this.config.reviewBots);
    if (this.closed) throw new Error('Foreman session closed during watch registration.');
    if (this.state.watches[id]) return this.state.watches[id];
    const watch = { id, kind: input.kind, target, state: initial.state, createdAt: Date.now(), deadline: Date.now() + minutes * 60000, nextCheck: Date.now() + 60000, ...initial };
    this.state.watches[id] = watch; this.save();
    if (watch.state !== 'pending') this.event(`watch:${id}`, 'review', watch);
    return watch;
  }
  deadlines() {
    for (const watch of Object.values(this.state.watches)) {
      if (watch.state === 'pending' && Date.now() >= watch.deadline) {
        watch.state = 'timeout'; this.save(); this.event(`watch:${watch.id}`, 'review', watch);
      }
    }
  }
  async tick() {
    if (this.closed || this.ticking) return;
    this.ticking = true;
    try {
      await this.reconcile();
      if (this.state.mode !== 'active') return;
      const api = githubAPI(this.root);
      await tickWatches(this.state.watches, { check: t => checkReview(t, api, this.config.reviewBots),
        emit: w => this.event(`watch:${w.id}`, 'review', w), save: () => this.save() });
    } finally { this.ticking = false; if (this.closed && !this.draining) this.release(); }
  }
}
