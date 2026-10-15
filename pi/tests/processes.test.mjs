import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { processBridge, processExtensionHost, processOutcome, CHANNELS } from '../src/processes.mjs';

const info = overrides => ({ id: 'p1', name: 'test', pid: 101, command: 'sleep 1', cwd: '/repo', startTime: 10,
  endTime: null, status: 'running', success: null, exitCode: null, endReason: null,
  stdoutFile: '/logs/out', stderrFile: '/logs/err', ...overrides });
function fixture() {
  const emitter = new EventEmitter();
  const pi = { events: { on(name, fn) { emitter.on(name, fn); return () => emitter.off(name, fn); }, emit: emitter.emit.bind(emitter) } };
  const wakes = [];
  const runtime = { sessionId: 's1', topic: 'main', state: { mode: 'active', events: {}, processes: {} }, save() {},
    event(id, kind, details) {
      if (this.state.events[id]) return;
      this.state.events[id] = { id, kind, details, delivered: false };
      if (this.state.mode === 'active') wakes.push(id);
    } };
  let current = runtime;
  const bridge = processBridge(pi, () => current);
  return { pi, runtime, bridge, wakes, switchRuntime: r => { current = r; } };
}
test('success, failure and killed process each create one terminal event', () => {
  for (const [state, expected] of [[{ status: 'exited', success: true, exitCode: 0 }, 'completed'],
    [{ status: 'exited', success: false, exitCode: 7 }, 'failed'], [{ status: 'killed', endReason: 'signal' }, 'stopped']]) {
    const { pi, bridge, runtime, wakes } = fixture();
    pi.events.emit(CHANNELS.started, info());
    pi.events.emit(CHANNELS.ended, info({ ...state, endTime: 20 }));
    pi.events.emit(CHANNELS.ended, info({ ...state, endTime: 20 }));
    assert.equal(wakes.length, 1); assert.equal(runtime.state.processes.p1.outcome, expected); bridge.dispose();
  }
});
test('intentional stop context notification is handled without a duplicate native wake', () => {
  const { pi, bridge, wakes } = fixture(); const native = [];
  processExtensionHost(pi).events.on(CHANNELS.notification, payload => native.push(payload));
  pi.events.emit(CHANNELS.started, info());
  pi.events.emit(CHANNELS.ended, info({ status: 'killed', endTime: 20 }));
  pi.events.emit(CHANNELS.notification, { processId: 'p1', kind: 'killed', attention: 'context' });
  assert.equal(wakes.length, 1); assert.equal(native.length, 0); bridge.dispose();
});
test('paused endings are persisted and leave native wake suppressed', () => {
  const { pi, bridge, runtime, wakes } = fixture(); const native = [];
  processExtensionHost(pi).events.on(CHANNELS.notification, p => native.push(p));
  pi.events.emit(CHANNELS.started, info()); runtime.state.mode = 'paused';
  pi.events.emit(CHANNELS.ended, info({ status: 'exited', endTime: 20, success: true, exitCode: 0 }));
  pi.events.emit(CHANNELS.notification, { processId: 'p1', kind: 'success', attention: 'turn' });
  assert.equal(Object.keys(runtime.state.events).length, 1); assert.equal(wakes.length, 0); assert.equal(native.length, 0); bridge.dispose();
});
test('unowned processes retain native behavior and do not enter Foreman state', () => {
  const { pi, bridge, runtime, switchRuntime } = fixture(); const native = [];
  processExtensionHost(pi).events.on(CHANNELS.notification, p => native.push(p));
  switchRuntime(undefined); pi.events.emit(CHANNELS.started, info());
  switchRuntime(runtime); pi.events.emit(CHANNELS.ended, info({ status: 'exited', endTime: 20 }));
  pi.events.emit(CHANNELS.notification, { processId: 'p1', kind: 'failure', attention: 'turn' });
  assert.equal(native.length, 1); assert.equal(Object.keys(runtime.state.events).length, 0); bridge.dispose();
});
test('same ID with a different start identity cannot overwrite or stop another process', async () => {
  const { pi, bridge, runtime } = fixture(); let stopped = false;
  pi.events.emit(CHANNELS.started, info());
  pi.events.emit(CHANNELS.ended, info({ pid: 202, startTime: 30, status: 'exited', endTime: 40 }));
  assert.equal(runtime.state.processes.p1.status, 'running');
  pi.events.on(CHANNELS.list, ({ reply }) => reply([info({ pid: 202, startTime: 30 })]));
  pi.events.on(CHANNELS.kill, () => { stopped = true; });
  await bridge.stopOwned(runtime); assert.equal(stopped, false); assert.equal(runtime.state.processes.p1.outcome, 'unknown'); bridge.dispose();
});
test('missing manager record on restore is unknown, not completed or automatically restarted', () => {
  const { pi, bridge, runtime } = fixture();
  runtime.state.processes.p1 = info(); pi.events.on(CHANNELS.list, ({ reply }) => reply([]));
  bridge.attach(runtime); assert.equal(runtime.state.processes.p1.outcome, 'unknown');
  assert.equal(Object.values(runtime.state.events)[0].kind, 'process_terminal'); bridge.dispose();
});
test('failed stop is attention, not a terminal success', () => {
  const { pi, bridge, runtime, wakes } = fixture();
  pi.events.emit(CHANNELS.started, info());
  bridge.toolResult({ toolName: 'process', details: { action: 'stop', result: { ok: false, reason: 'timeout', info: info({ status: 'terminate_timeout' }) } } });
  assert.equal(runtime.state.processes.p1.outcome, 'terminate_timeout'); assert.equal(wakes.length, 1);
  assert.equal(Object.values(runtime.state.events)[0].kind, 'process_stop_failed'); bridge.dispose();
});
test('immediate spawn error from start receipt gets a terminal event', () => {
  const { bridge, runtime, wakes } = fixture();
  bridge.toolResult({ toolName: 'process', details: { action: 'start', process: info({ status: 'exited', endReason: 'spawn_error', exitCode: null, success: false }) } });
  assert.equal(runtime.state.processes.p1.outcome, 'failed'); assert.equal(wakes.length, 1); bridge.dispose();
});
test('lost and termination-timeout are not treated as success', () => {
  assert.equal(processOutcome(info({ status: 'exited', endReason: 'lost' })), 'unknown');
  assert.equal(processOutcome(info({ status: 'terminate_timeout' })), 'terminate_timeout');
});
