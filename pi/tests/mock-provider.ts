// Test-only provider: no network requests or paid model calls.
import fs from 'node:fs';
import path from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

export default function mockProvider(pi: any) {
  pi.registerProvider('foreman-test', {
    api: 'foreman-test-api', baseUrl: 'https://example.invalid', apiKey: 'test-only',
    models: [{ id: 'mock', name: 'Foreman deterministic test', reasoning: false, input: ['text'],
      cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.25 }, contextWindow: 100000, maxTokens: 1024 }],
    streamSimple(model: any, context: any, options: any) {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        try {
          await options?.onPayload?.({ test: true });
          const text = JSON.stringify(context);
          const root = process.env.FOREMAN_SMOKE_ROOT!;
          const worker = text.includes('## Runtime assignment');
          let content: any[] = [{ type: 'text', text: worker ? 'Worker finished the assigned smoke test. No files changed.' : 'Waiting for the worker report.' }];
          let reason = 'stop';
          if (process.env.FOREMAN_PROCESS_SMOKE === '1') {
            const messages = context.messages || [];
            const last = messages.at(-1);
            const lastText = typeof last?.content === 'string' ? last.content : (last?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
            if (last?.role === 'user' && lastText.startsWith('PROCESS_TEST ')) {
              content = [{ type: 'toolCall', id: `call-${Date.now()}`, name: 'process', arguments: JSON.parse(lastText.slice('PROCESS_TEST '.length)) }]; reason = 'toolUse';
            }
            if (lastText === 'PROCESS_TEST_WAIT') await new Promise(resolve => setTimeout(resolve, 3000));
            const wake = last?.role === 'user' && lastText.startsWith('[Foreman event]');
            fs.appendFileSync(path.join(root, 'lead-calls.jsonl'), JSON.stringify({ reason, wake, text: lastText.slice(0, 16000), time: Date.now() }) + '\n');
          }
          else if (worker) await new Promise(resolve => setTimeout(resolve, 2500));
          else {
            const statePath = path.join(root, '.foreman/pi/main/state.json');
            const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
            const count = Object.keys(state?.jobs || {}).length;
            if (state && count === 0) {
              content = [{ type: 'toolCall', id: `call-${Date.now()}`, name: 'foreman_dispatch', arguments: { role: 'scout', briefPath: path.join(root, 'first.md') } }]; reason = 'toolUse';
            } else if (state && count === 1 && /Background task completed|Background tasks completed/.test(text)) {
              content = [{ type: 'toolCall', id: `call-${Date.now()}`, name: 'foreman_dispatch', arguments: { role: 'scout', briefPath: path.join(root, 'second.md') } }]; reason = 'toolUse';
            }
            fs.appendFileSync(path.join(root, 'lead-calls.jsonl'), JSON.stringify({ count, reason, time: Date.now() }) + '\n');
          }
          const message: any = { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id,
            stopReason: reason, timestamp: Date.now(), usage: { input: 10, output: 5, cacheRead: 20, cacheWrite: 2, totalTokens: 37,
              cost: { input: 0.00001, output: 0.000005, cacheRead: 0.000002, cacheWrite: 0.0000025, total: 0.0000195 } } };
          stream.push({ type: 'done', reason, message }); stream.end();
        } catch (error: any) { stream.push({ type: 'error', reason: 'error', error: { role: 'assistant', content: [], stopReason: 'error', errorMessage: error.message } } as any); stream.end(); }
      })();
      return stream;
    },
  });
}
