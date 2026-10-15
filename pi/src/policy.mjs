import fs from 'node:fs';
import { atomicJSON, readJSON } from './storage.mjs';

export function enforceCache(payload, model) {
  // Kimi Coding also uses the Anthropic wire format, but does not inherit
  // Anthropic's cache TTL contract.
  if (model?.provider !== 'anthropic') return payload;
  if (model.api !== 'anthropic-messages') throw new Error('Unsupported Anthropic API for one-hour cache enforcement.');
  const copy = structuredClone(payload);
  let count = 0;
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.cache_control?.type === 'ephemeral') { value.cache_control.ttl = '1h'; count++; }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(copy);
  if (!count) copy.cache_control = { type: 'ephemeral', ttl: '1h' };
  return copy;
}
export function usageTotal(records) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, responses: 0 };
  for (const { usage } of Object.values(records)) {
    if (!usage) continue;
    total.responses++;
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h'])
      total[key] += Number.isFinite(usage[key]) ? usage[key] : 0;
    for (const key of Object.keys(total.cost)) total.cost[key] += Number.isFinite(usage.cost?.[key]) ? usage.cost[key] : 0;
  }
  return total;
}
export function childExtension(pi, config) {
  // Also covers provider calls such as compaction that may not use the normal
  // extension payload hook. The child is a dedicated background process.
  process.env.PI_CACHE_RETENTION = 'long';
  let records = readJSON(config.telemetryPath, {});
  let sequence = Object.keys(records).length;
  const update = (message, id) => {
    if (message?.role !== 'assistant' || !message.usage) return;
    const key = id || `${message.timestamp}:${sequence++}`;
    records[key] = { usage: message.usage, model: message.model };
    atomicJSON(config.telemetryPath, records);
  };
  pi.on('before_provider_request', (event, ctx) => enforceCache(event.payload, ctx.model));
  pi.on('session_start', (_event, ctx) => {
    fs.writeFileSync(config.readyPath, JSON.stringify({ sessionId: ctx.sessionManager.getSessionId(), cache: ctx.model?.provider === 'anthropic' ? '1h' : 'provider-managed' }));
    for (const entry of ctx.sessionManager.getBranch()) update(entry.message, entry.id);
  });
  pi.on('message_end', (event, ctx) => {
    // Read persisted entry identity when available; reload reconstruction uses it too.
    const entries = ctx.sessionManager.getBranch();
    const entry = entries.findLast(e => e.message?.role === 'assistant' && e.message.timestamp === event.message?.timestamp);
    update(event.message, entry?.id || `message:${event.message?.timestamp}`);
  });
}
