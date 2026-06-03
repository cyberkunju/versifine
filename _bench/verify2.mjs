// Find the real workable Sarvam config: with reasoning_effort:null, how much
// max_tokens do we need before content is non-null, and what's the latency?
import { readFileSync } from 'node:fs';
const KEY = readFileSync(new URL('./.sarvam.key', import.meta.url), 'utf8').trim();

const INTENT_SYS =
  'You are an intent classifier for a WhatsApp finance assistant. Respond ONLY with strict minified JSON like {"intent":"expense"}, no prose. Allowed intents: expense, income, transfer, set_budget, query_summary, query_spending, ask_advice, chat, unknown.';
const CHAT_SYS =
  'You are a concise financial assistant for WhatsApp. Reply in 2-3 sentences, plain language, no markdown.';

async function run(label, body) {
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
    `[${label}] ${ms}ms finish=${j.choices?.[0]?.finish_reason} reasoning=${reasoning ? reasoning.length : 0}ch completion=${j.usage?.completion_tokens} -> ${content ? JSON.stringify(content).slice(0, 90) : '(NULL)'}`,
  );
}

const model = 'sarvam-30b';
console.log('=== sarvam-30b, reasoning_effort:null, sweeping max_tokens ===\n');
for (const mt of [256, 384, 512, 768]) {
  await run(`intent mt=${mt}: spent 450 on auto`, {
    model,
    stream: false,
    temperature: 0,
    max_tokens: mt,
    reasoning_effort: null,
    messages: [
      { role: 'system', content: INTENT_SYS },
      { role: 'user', content: 'spent 450 on auto' },
    ],
  });
}
console.log('');
for (const mt of [384, 512, 768]) {
  await run(`chat mt=${mt}: emergency fund`, {
    model,
    stream: false,
    temperature: 0.2,
    max_tokens: mt,
    reasoning_effort: null,
    messages: [
      { role: 'system', content: CHAT_SYS },
      { role: 'user', content: 'how do I start an emergency fund' },
    ],
  });
}
console.log('\n=== sarvam-105b for comparison ===\n');
for (const mt of [384, 512]) {
  await run(`105b chat mt=${mt}: emergency fund`, {
    model: 'sarvam-105b',
    stream: false,
    temperature: 0.2,
    max_tokens: mt,
    reasoning_effort: null,
    messages: [
      { role: 'system', content: CHAT_SYS },
      { role: 'user', content: 'how do I start an emergency fund' },
    ],
  });
}
