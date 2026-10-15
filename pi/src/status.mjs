const active = new Set(['queued', 'launching', 'running', 'stopping', 'blocked', 'unknown']);
const liveProcesses = new Set(['running', 'terminating', 'terminate_timeout', 'unknown']);
const short = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').slice(0, 240) : undefined;

// A presentation only: never retire jobs, acknowledge events, or rewrite history.
export function currentStatus(state, { topic, maxWorkers, taskId, workerInfo = () => ({}) }) {
  const jobs = Object.values(state.jobs);
  const latest = new Map();
  for (const job of jobs) {
    const previous = latest.get(job.taskId);
    if (!previous || job.createdAt >= previous.createdAt) latest.set(job.taskId, job);
  }
  const events = Object.values(state.events);
  const pendingFailure = job => events.some(e => !e.delivered && e.kind === 'dispatch_problem' && e.details?.taskId === job.taskId);
  const selected = jobs.filter(job => (!taskId || job.taskId === taskId) && (
    active.has(job.state) || (latest.get(job.taskId) === job && (
      taskId || (job.state === 'failed' && (job.runId || pendingFailure(job)))
    ))
  ));
  const workers = selected.map(job => ({
    taskId: job.taskId, runId: job.runId, role: job.role, state: job.state,
    ...workerInfo(job),
    ...(job.error ? { problem: short(job.error) } : {}),
  }));

  const latestWatches = new Map();
  for (const watch of Object.values(state.watches)) {
    const key = `${watch.target.repo}#${watch.target.pr}`;
    const previous = latestWatches.get(key);
    if (!previous || watch.createdAt >= previous.createdAt) latestWatches.set(key, watch);
  }
  const watches = taskId ? [] : [...latestWatches.values()].filter(w => !['closed', 'cancelled'].includes(w.state)).map(w => ({
    watchId: w.id, pr: `${w.target.repo}#${w.target.pr}`, state: w.state,
    ...(w.state === 'pending' ? { deadline: new Date(w.deadline).toISOString() } : {}),
    ...(w.error ? { problem: short(w.error) } : {}),
  }));
  const pending = events.filter(e => !e.delivered && !['worker_started', 'worker_terminal'].includes(e.kind))
    .filter(e => !taskId || e.details?.taskId === taskId)
    .filter(e => e.kind !== 'review' || [...latestWatches.values()].some(w => w.id === e.details?.id));
  const processes = taskId ? [] : Object.values(state.processes || {})
    .filter(p => liveProcesses.has(p.status) || pending.some(e => e.details?.id === p.id || e.details?.processId === p.id))
    .map(p => ({ processId: p.id, name: p.name, state: p.outcome || p.status, ...(p.exitCode != null ? { exitCode: p.exitCode } : {}) }));
  const attention = pending.map(e => ({
    eventId: e.id, kind: e.kind,
    ...(e.details?.taskId ? { taskId: e.details.taskId } : {}),
    ...(e.details?.runId ? { runId: e.details.runId } : {}),
    ...(e.details?.processId || (e.kind.startsWith('process') && e.details?.id)
      ? { processId: e.details.processId || e.details.id } : {}),
    ...(e.details?.state || e.details?.outcome ? { state: e.details.state || e.details.outcome } : {}),
    ...(e.details?.error || e.details?.reason ? { problem: short(e.details.error || e.details.reason) } : {}),
    ...(e.deliveryError ? { deliveryError: short(e.deliveryError) } : {}),
  }));
  const lists = { workers, watches, processes, attention };
  const omitted = {};
  for (const [name, rows] of Object.entries(lists)) {
    if (rows.length > 20) { omitted[name] = rows.length - 20; lists[name] = rows.slice(0, 20); }
  }
  return { topic, mode: state.mode, ...(taskId ? { taskId } : {}),
    capacity: { occupied: jobs.filter(j => active.has(j.state) && j.state !== 'queued').length, limit: maxWorkers },
    ...lists, ...(Object.keys(omitted).length ? { omitted } : {}) };
}
