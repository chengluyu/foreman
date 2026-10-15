import { createHash } from 'node:crypto';

// Public event protocol of @aliou/pi-processes 0.13.2. No process implementation
// is duplicated here. The wrapper delegates normal behavior outside Foreman.
export const PROCESS_ROUTE = 'foreman:process-notification:v1';
export const CHANNELS = {
  started: 'processes:started', ended: 'processes:ended', notification: 'processes:notification',
  list: 'processes:request:list', kill: 'processes:command:kill',
};
const liveStates = new Set(['running', 'terminating', 'terminate_timeout']);
export function processExtensionHost(pi) {
  return {
    ...pi,
    events: {
      ...pi.events,
      emit: pi.events.emit.bind(pi.events),
      on(channel, handler) {
        if (channel !== CHANNELS.notification) return pi.events.on(channel, handler);
        return pi.events.on(channel, payload => {
          const request = { payload, handled: false };
          pi.events.emit(PROCESS_ROUTE, request);
          if (!request.handled) handler(payload);
        });
      },
    },
  };
}
export function processOutcome(info) {
  if (liveStates.has(info.status)) return info.status;
  if (info.endReason === 'lost') return 'unknown';
  if (info.status === 'killed') return 'stopped';
  if (info.status === 'exited') return info.success === true && info.exitCode === 0 ? 'completed' : 'failed';
  return 'unknown';
}
function valid(info) {
  return info && typeof info.id === 'string' && Number.isFinite(info.startTime) && Number.isInteger(info.pid);
}
function same(a, b) { return a.id === b.id && a.pid === b.pid && a.startTime === b.startTime && a.command === b.command && a.cwd === b.cwd; }
function compact(info) {
  return { id: info.id, name: info.name, command: info.command, cwd: info.cwd, pid: info.pid,
    startTime: info.startTime, endTime: info.endTime, status: info.status, outcome: processOutcome(info),
    exitCode: info.exitCode, endReason: info.endReason, signal: info.signal,
    stdoutFile: info.stdoutFile, stderrFile: info.stderrFile, errorMessage: info.errorMessage };
}

export function processBridge(pi, getRuntime) {
  // The session's package owns a single process manager. Capture ownership only
  // on starts while Foreman is active, never by adopting everything in its list.
  const owners = new Map();
  const routes = new Map();
  const current = () => { const r = getRuntime(); return r && !r.closed ? r : undefined; };
  const findOwner = info => {
    const owner = owners.get(info?.id);
    if (owner && !owner.runtime.closed && same(owner.info, info)) return owner;
  };
  function attach(runtime) {
    runtime.state.processes ||= {};
    runtime.save();
    let list; let replies = 0;
    pi.events.emit(CHANNELS.list, { reply: value => { replies++; list = value; } });
    if (replies > 1) throw new Error('Multiple process managers loaded. Disable standalone @aliou/pi-processes; Foreman already includes it.');
    runtime.processesAvailable = Array.isArray(list);
    if (!list) return;
    for (const record of Object.values(runtime.state.processes)) {
      const info = list.find(item => same(record, item));
      if (info) {
        owners.set(info.id, { runtime, info });
        routes.set(info.id, { runtime, startTime: info.startTime });
        if (!liveStates.has(info.status)) ended(info);
      } else if (liveStates.has(record.status)) {
        record.status = 'unknown'; record.outcome = 'unknown'; record.endReason = 'manager_unavailable_after_restart';
        runtime.save();
        runtime.event(`process:${record.id}:${record.startTime}:unknown`, 'process_terminal', { ...record });
      }
    }
  }
  function started(info) {
    const runtime = current();
    if (!runtime || runtime.state.mode !== 'active' || !valid(info)) return;
    runtime.state.processes ||= {};
    runtime.state.processes[info.id] = { ...compact(info), ownerSessionId: runtime.sessionId, ownerTopic: runtime.topic };
    runtime.save();
    owners.set(info.id, { runtime, info });
    routes.set(info.id, { runtime, startTime: info.startTime });
  }
  function ended(info) {
    if (!valid(info)) return;
    const owner = findOwner(info);
    if (!owner) return;
    const runtime = owner.runtime;
    const record = runtime.state.processes[info.id];
    Object.assign(record, compact(info)); runtime.save();
    if (liveStates.has(info.status)) return;
    runtime.event(`process:${info.id}:${info.startTime}:terminal`, 'process_terminal', { ...record });
  }
  function route(request) {
    const payload = request?.payload;
    const owner = routes.get(payload?.processId);
    if (!owner || owner.runtime.closed) return;
    // Foreman wakes from ENDED for every terminal outcome, including intentional
    // stop. Suppress Aliou's separate wake, but leave notifications to its UI.
    request.handled = true;
    if (payload.kind === 'log_match' && payload.attention === 'turn') {
      const hash = createHash('sha256').update(JSON.stringify([payload.timestamp, payload.logMatch])).digest('hex').slice(0, 16);
      owner.runtime.event(`process-log:${payload.processId}:${hash}`, 'process_log', {
        processId: payload.processId, processName: payload.processName,
        summary: String(payload.summary || '').slice(0, 1000),
        match: payload.logMatch ? { ...payload.logMatch, line: String(payload.logMatch.line || '').slice(0, 2000) } : undefined,
      });
    }
  }
  const off = [pi.events.on(CHANNELS.started, started), pi.events.on(CHANNELS.ended, ended), pi.events.on(PROCESS_ROUTE, route)];

  return {
    attach,
    reconcile() {
      const runtime = current();
      if (!runtime) return;
      let list;
      pi.events.emit(CHANNELS.list, { reply: value => { list = value; } });
      if (!Array.isArray(list)) return;
      for (const info of list) if (findOwner(info)) ended(info);
    },
    toolResult(event) {
      if (event.toolName !== 'process') return;
      const details = event.details;
      // Covers an immediate spawn failure that emits ENDED before STARTED.
      if (details?.action === 'start' && valid(details.process)) {
        if (!owners.has(details.process.id)) started(details.process);
        ended(details.process);
      }
      if (details?.action === 'stop' && valid(details.result?.info)) {
        const info = details.result.info;
        const owner = findOwner(info);
        if (owner && details.result.ok === false) {
          const record = owner.runtime.state.processes[info.id];
          Object.assign(record, compact(info)); owner.runtime.save();
          owner.runtime.event(`process-stop:${info.id}:${info.startTime}:${details.result.reason}`, 'process_stop_failed', { ...record, reason: details.result.reason });
        }
      }
    },
    async stopOwned(runtime) {
      const records = Object.values(runtime.state.processes || {}).filter(r => liveStates.has(r.status));
      return Promise.all(records.map(record => new Promise(resolve => {
        let currentList;
        pi.events.emit(CHANNELS.list, { reply: list => { currentList = list; } });
        if (!currentList?.some(info => same(record, info))) {
          record.status = 'unknown'; record.outcome = 'unknown'; runtime.save();
          runtime.event(`process-stop:${record.id}:${record.startTime}:missing`, 'process_stop_failed', { processId: record.id, reason: 'No matching live process identity; no stop sent.' });
          resolve(false); return;
        }
        const timer = setTimeout(() => {
          runtime.event(`process-stop:${record.id}:${record.startTime}:rpc-timeout`, 'process_stop_failed', { processId: record.id, reason: 'No confirmed response to stop request.' });
          resolve(false);
        }, 8000);
        pi.events.emit(CHANNELS.kill, { id: record.id, timeoutMs: 5000, reply: result => {
          clearTimeout(timer);
          if (runtime.closed) { resolve(false); return; }
          if (result?.info && same(record, result.info)) {
            ended(result.info);
            this.toolResult({ toolName: 'process', details: { action: 'stop', result } });
          }
          resolve(result?.ok === true);
        } });
      })));
    },
    detach(runtime) {
      for (const [id, owner] of owners) if (owner.runtime === runtime) owners.delete(id);
      for (const [id, owner] of routes) if (owner.runtime === runtime) routes.delete(id);
    },
    dispose() { for (const dispose of off) dispose?.(); owners.clear(); routes.clear(); },
  };
}
