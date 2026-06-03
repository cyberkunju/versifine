// The Python SDK uses reasoning_effort=None to disable. Over raw REST, JSON null
// may be dropped/ignored. Test which wire value ACTUALLY disables reasoning.
import { readFileSync } from 'node:fs';
const KEY = readFileSync(new URL('./.sarvam.key', import.meta.url), 'utf8').trim();
const CHAT_SYS =
  'You are a concise financial assistant for WhatsApp. Reply in 2-3 sentences, plain language, no markdown.';

async function run(label, extra) {
  const body = {
    model: 'sarvam-30b',
    stream: false,
    temperature: 0.2,
    max_tokens: 256,
    messages: [
      { role: 'system', content: CHAT_SYS },
      { role: 'user', content: 'how do I start an emergency fund' },
    ],
    ...extra,
  };
  const t0 = performance.now();
  const r = await fetch('https://api.sarvam.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const ms = Math.round(performance.now() - t0);
  const j = await r.json();
  const msg = j.choices?.[0]?.message;
  const reasoning = msg?.reasoning_content;
  const content = msg?.content;
  console.log(
    `[${label}] ${ms}ms finish=${j.choices?.[0]?.finish_reason} reasoning=${reasoning ? reasoning.length : 0}ch comp=${j.usage?.completion_tokens} err=${j.error?.message || ''} -> ${content ? JSON.stringify(content).slice(0, 80) : '(NULL)'}`,
  );
}

console.log('=== which wire value disables Sarvam reasoning? (sarvam-30b, max_tokens 256) ===\n');
await run('reasoning_effort: null (json)', { reasoning_effort: null });
await run('reasoning_effort: "none" (string)', { reasoning_effort: 'none' });
await run('reasoning_effort: "" (empty)', { reasoning_effort: '' });
await run('reasoning_effort: "low"', { reasoning_effort: 'low' });
await run('omitted entirely (default)', {});
// Some gateways use a separate flag:
await run('chat_template_kwargs enable_thinking:false', {
  chat_template_kwargs: { enable_thinking: false },
});
await run('extra_body enable_thinking:false', { enable_thinking: false });
