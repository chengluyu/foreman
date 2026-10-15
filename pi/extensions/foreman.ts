import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { Text, Container } from '@earendil-works/pi-tui';
import { collapsibleEditRenderer } from '../src/edit-renderer.mjs';
import { ForemanRuntime } from '../src/runtime.mjs';
import { repository, ROLES } from '../src/storage.mjs';
import { subagentAdapter } from '../src/adapter.mjs';
import { enforceCache, usageTotal } from '../src/policy.mjs';
import processesExtension from '@aliou/pi-processes/extensions/processes/index.ts';
import processesLogsExtension from '@aliou/pi-processes/extensions/processes-logs/index.ts';
import processesDockExtension from '@aliou/pi-processes/extensions/processes-dock/index.ts';
import { processBridge, processExtensionHost } from '../src/processes.mjs';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const result = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], details: value });
const WAKE = '[Foreman event]';

export default async function foreman(pi: any) {
  pi.registerToolRenderer(collapsibleEditRenderer({ Text, Container }));
  let runtime: any;
  let adapter: any;
  let context: any;
  let timer: any;
  let deadlineTimer: any;
  let wakePending = false;
  let wakeRequestedAt = 0;
  let live = false;
  let lastError = '';
  let savedRetention: string | undefined;
  let retentionOwned = false;
  const processes = processBridge(pi, () => runtime);

  function requireRuntime() { if (!runtime) throw new Error('Start with /foreman or /foreman-resume TOPIC.'); return runtime; }
  function recordSession() {
    pi.appendEntry('foreman-session', runtime ? { root: runtime.root, topic: runtime.topic, single: runtime.handover === runtime.shared } : { inactive: true });
  }
  function observeWake(text: string) {
    if (!runtime || runtime.state.mode !== 'active' || !text?.startsWith(`${WAKE}\n`)) return;
    try {
      for (const delivered of JSON.parse(text.split('\n')[1])) {
        const event = runtime.state.events[delivered.id];
        if (event) { event.delivered = true; event.deliveredAt = Date.now(); delete event.deliveryError; }
      }
      runtime.save();
    } catch { /* Keep malformed or unobserved batches pending for reconciliation. */ }
  }
  function flush() {
    if (wakePending && context?.isIdle() && Date.now() - wakeRequestedAt > 10000) wakePending = false;
    if (!live || !runtime || runtime.closed || runtime.state.mode !== 'active' || wakePending) return;
    // pi-subagents owns worker completion wakes. Foreman owns process and watch
    // events; do not send a second notification for the same worker completion.
    const pending = Object.values(runtime.state.events).filter((e: any) => !e.delivered && (e.deliveryAttempts || 0) < 3 && !['worker_started', 'worker_terminal'].includes(e.kind)) as any[];
    if (!pending.length) return;
    const batch = pending.slice(0, 10);
    wakePending = true;
    wakeRequestedAt = Date.now();
    try {
      for (const e of batch) { e.deliveryAttempts = (e.deliveryAttempts || 0) + 1; e.queuedAt = Date.now(); }
      runtime.save();
      pi.sendUserMessage(`${WAKE}\n${JSON.stringify(batch)}\nProcess these events and continue authorized work. Update the handover yourself.`, { deliverAs: 'steer' });
    } catch (error: any) {
      wakePending = false;
      for (const e of batch) e.deliveryError = error.message;
      runtime.save();
      context?.ui.notify(`Foreman event delivery failed: ${error.message}. Events remain in status.`, 'error');
    }
  }
  function footer() {
    if (!context?.hasUI || !runtime) return;
    const s = runtime.summary();
    const workers = s.workers;
    const cost = workers.reduce((sum: number, j: any) => sum + j.usage.cost.total, 0);
    const missing = workers.filter((j: any) => j.runId && !j.telemetryAvailable).length;
    const records: any = {};
    for (const e of context.sessionManager.getBranch()) if (e.message?.usage) records[e.id] = { usage: e.message.usage };
    const lead = usageTotal(records).cost.total;
    const active = workers.filter((j: any) => ['running', 'launching', 'stopping', 'unknown', 'blocked'].includes(j.state)).length;
    context.ui.setStatus('foreman', `Foreman ${s.mode} · ${active} workers · lead $${lead.toFixed(3)} · workers $${cost.toFixed(3)}${missing ? ` (+${missing} awaiting telemetry)` : ''} · total $${(lead + cost).toFixed(3)}`);
  }
  async function shutdown() {
    live = false; clearInterval(timer); clearInterval(deadlineTimer);
    if (runtime) {
      // Record actual process endings while ownership and the manager still exist.
      // No automatic turn is allowed while the session shuts down.
      await processes.stopOwned(runtime);
      processes.detach(runtime);
    }
    runtime?.close(); adapter?.close(); runtime = undefined; adapter = undefined;
    if (retentionOwned) {
      if (savedRetention === undefined) delete process.env.PI_CACHE_RETENTION;
      else process.env.PI_CACHE_RETENTION = savedRetention;
      retentionOwned = false;
    }
  }
  async function start(ctx: any, root: string, topic: string, mode: string, restore = false) {
    if (runtime && !runtime.closed && runtime.root === root && runtime.topic === topic) return runtime.summary();
    if (runtime && Object.values(runtime.state.processes || {}).some((p: any) => ['running', 'terminating', 'terminate_timeout'].includes(p.status))) {
      throw new Error('Stop the current topic’s background commands before switching Foreman topics.');
    }
    await shutdown(); context = ctx;
    adapter = subagentAdapter(pi, packageRoot);
    await adapter.ready();
    runtime = new ForemanRuntime({ root, topic, mode, sessionId: ctx.sessionManager.getSessionId(),
      packageRoot, adapter, model: ctx.model, onEvent: () => { /* flushed outside dispatch */ } });
    live = true; wakePending = false;
    savedRetention = process.env.PI_CACHE_RETENTION; process.env.PI_CACHE_RETENTION = 'long'; retentionOwned = true;
    // A crash during dispatch has an ambiguous outcome. Never blindly replay it.
    for (const j of Object.values(runtime.state.jobs) as any[]) if (j.state === 'launching') {
      j.state = 'unknown'; j.error = 'Lead stopped during launch; inspect pi-subagents status before retrying.';
    }
    runtime.save();
    try { processes.attach(runtime); }
    catch (error) { await shutdown(); throw error; }
    const tick = async () => {
      try { processes.reconcile(); await runtime?.tick(); flush(); footer(); }
      catch (error: any) {
        if (error.message !== lastError) ctx.ui.notify(`Foreman: ${error.message}`, 'error');
        lastError = error.message;
      }
    };
    timer = setInterval(tick, 2000); timer.unref?.();
    deadlineTimer = setInterval(() => { if (runtime && live) { runtime.deadlines(); flush(); } }, 1000); deadlineTimer.unref?.();
    if (!restore) recordSession();
    footer();
    return runtime.summary();
  }
  const activation = (mode: string) => async (args: string, ctx: any) => {
    const root = await repository(ctx.cwd);
    const topic = mode === 'single' ? 'main' : args.trim().split(/\s+/)[0];
    if (mode === 'single' && fs.existsSync(path.join(root, 'handovers'))) throw new Error('Topics exist; use /foreman-resume TOPIC.');
    if (!topic || !/^[a-z0-9][a-z0-9-]*$/.test(topic)) throw new Error('Supply a topic using lowercase letters, digits, and dashes.');
    const handover = path.join(root, 'handovers', `${topic}.md`);
    if (mode === 'create' && fs.existsSync(handover)) throw new Error('Topic exists; use /foreman-resume.');
    if (mode === 'resume' && !fs.existsSync(handover)) throw new Error('No such topic; use /foreman-create.');
    const summary = await start(ctx, root, topic, mode);
    if (runtime.state.mode !== 'active') {
      ctx.ui.notify(`Foreman is ${runtime.state.mode}; use /foreman-continue when ready.`, 'info'); return;
    }
    pi.sendUserMessage(`Foreman activated. Read the handover and shared rules.\n${JSON.stringify(summary)}\n${mode === 'single' ? args : args.slice(topic.length).trim()}`);
  };
  pi.registerCommand('foreman', { description: 'Start Foreman in a single-handover repository', handler: activation('single') });
  pi.registerCommand('foreman-create', { description: 'Create a Foreman topic', handler: activation('create') });
  pi.registerCommand('foreman-resume', { description: 'Resume a Foreman topic', handler: activation('resume') });
  pi.registerCommand('foreman-status', { description: 'Show Foreman state', handler: async (_: string, ctx: any) => ctx.ui.notify(JSON.stringify(requireRuntime().status(), null, 2), 'info') });
  pi.registerCommand('foreman-pause', { description: 'Pause automatic management; workers keep running', handler: async (_: string, ctx: any) => {
    const r = requireRuntime(); r.state.mode = 'paused'; r.save(); ctx.abort(); footer(); ctx.ui.notify('Foreman paused. Workers may finish; results remain available.', 'info');
  } });
  pi.registerCommand('foreman-continue', { description: 'Continue paused Foreman work', handler: async (_: string, ctx: any) => {
    const r = requireRuntime(); r.state.mode = 'active'; r.save(); wakePending = false;
    for (const event of Object.values(r.state.events) as any[]) if (!event.delivered) event.deliveryAttempts = 0;
    r.save();
    pi.sendUserMessage(`Continue authorized Foreman work. Reconcile status and the handover first.\n${JSON.stringify(r.summary())}`);
  } });
  pi.registerCommand('foreman-stop', { description: 'Stop management and request worker cancellation', handler: async (_: string, ctx: any) => {
    const r = requireRuntime();
    // Disable wakes first; stop is not a request to restart the lead.
    r.state.mode = 'stopped'; r.save();
    await Promise.all([r.stop(), processes.stopOwned(r)]);
    ctx.abort(); footer(); ctx.ui.notify('Foreman stopped. Check status for confirmed worker and process exits. Worktrees retained.', 'info');
  } });

  pi.registerTool({ name: 'foreman_dispatch', label: 'Foreman dispatch', description: 'Launch or queue one worker from a saved Markdown brief. Repeated paths return the original receipt.',
    parameters: Type.Object({ role: Type.Union(ROLES.map((r: string) => Type.Literal(r))), briefPath: Type.String() }),
    async execute(_id: string, args: any, _signal: any, _update: any, ctx: any) {
      const r = requireRuntime(); r.model = ctx.model;
      return result(await r.dispatch(args.role, args.briefPath));
    } });
  pi.registerTool({ name: 'foreman_watch', label: 'Foreman watch', description: 'Create/list/get/cancel runtime GitHub review watches. No subprocess or model polling. Never posts a review request.',
    parameters: Type.Object({ action: Type.Union(['create', 'list', 'get', 'cancel'].map(x => Type.Literal(x))),
      kind: Type.Optional(Type.Literal('github-review')), target: Type.Optional(Type.Object({ repo: Type.String(), pr: Type.Integer({ minimum: 1 }), headSha: Type.String(), requestId: Type.String() })),
      timeoutMinutes: Type.Optional(Type.Number({ minimum: 1, maximum: 120 })), watchId: Type.Optional(Type.String()) }),
    async execute(_id: string, args: any) { return result(await requireRuntime().watch(args)); } });
  pi.registerTool({ name: 'foreman_status', label: 'Foreman status', description: 'Read current-topic runtime facts, watches, and worker usage. Plans live in the handover.',
    parameters: Type.Object({ taskId: Type.Optional(Type.String()) }),
    async execute(_id: string, args: any) { const r = requireRuntime(); await r.reconcile(); return result(r.status(args.taskId)); } });

  pi.on('before_agent_start', (_event: any, ctx: any) => {
    if (!runtime) return;
    if (runtime.state.mode !== 'active') { ctx.abort(); return; }
    observeWake(_event.prompt);
    return { systemPrompt: `${_event.systemPrompt}\n\n${fs.readFileSync(path.join(packageRoot, 'LEAD.md'), 'utf8')}\n\nRuntime paths: ${JSON.stringify({ root: runtime.root, handover: runtime.handover, shared: runtime.shared, briefs: path.join(runtime.dir, 'briefs') })}` };
  });
  pi.on('before_provider_request', (event: any, ctx: any) => {
    if (!runtime) return;
    if (runtime.state.mode !== 'active') { ctx.abort(); throw new Error('Foreman paused: automatic model request suppressed.'); }
    return enforceCache(event.payload, ctx.model);
  });
  pi.on('input', (event: any) => {
    if (runtime?.state.mode !== 'active' && runtime && event.source === 'extension') return { action: 'handled' };
  });
  pi.on('tool_call', (event: any) => {
    if (runtime && event.toolName === 'subagent' && !event.input?.action) return { block: true, reason: 'Use foreman_dispatch with a Markdown brief for new workers.' };
    if (runtime && event.toolName === 'process' && runtime.state.mode !== 'active' && ['start', 'write', 'update'].includes(event.input?.action)) {
      return { block: true, reason: 'Foreman is paused or stopped; use /foreman-continue before changing background work.' };
    }
  });
  pi.on('tool_result', (event: any) => { processes.toolResult(event); });
  pi.on('agent_start', () => { wakePending = false; });
  pi.on('message_start', (event: any) => {
    // Steering can enter an already-running agent without before_agent_start.
    const message = event.message;
    if (message?.role === 'user') observeWake(typeof message.content === 'string' ? message.content :
      (message.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n'));
  });
  pi.on('agent_settled', (event: any) => {
    if (runtime && event.aborted && runtime.state.mode === 'active') { runtime.state.mode = 'paused'; runtime.save(); }
    wakePending = false; footer();
  });
  pi.on('session_start', async (_event: any, ctx: any) => {
    context = ctx;
    const saved = ctx.sessionManager.getBranch().findLast((e: any) => e.type === 'custom' && e.customType === 'foreman-session')?.data;
    if (saved && !saved.inactive) {
      try { await start(ctx, saved.root, saved.topic, saved.single ? 'single' : 'resume', true); }
      catch (e: any) { ctx.ui.notify(`Foreman restore failed: ${e.message}`, 'error'); }
    }
  });
  pi.on('session_shutdown', async () => { await shutdown(); processes.dispose(); });
  // Reuse the upstream tool, manager, logging, /ps UI, and controls. Route only
  // Foreman-owned notification delivery through the durable Foreman inbox.
  await processesExtension(processExtensionHost(pi));
  await processesLogsExtension(pi);
  await processesDockExtension(pi);
}
