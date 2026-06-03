// Verify the research's recommended low-latency config actually disables reasoning.
// Tests sarvam-30b with the EXACT bodies the research recommended, and inspects
// whether reasoning_content is still present + measures total latency.
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
  console.log(`\n[${label}] ${ms}ms  finish=${j.choices?.[0]?.finish_reason}`);
  console.log(
    `  reasoning_content present: ${Boolean(reasoning)} ${reasoning ? `(len ${reasoning.length})` : ''}`,
  );
  console.log(`  content: ${content ? JSON.stringify(content).slice(0, 160) : '(null/empty)'}`);
  console.log(`  usage: prompt=${j.usage?.prompt_tokens} completion=${j.usage?.completion_tokens}`);
}

// INTENT config from research
const intentBody = (text) => ({
  model: 'sarvam-30b',
  stream: false,
  temperature: 0,
  top_p: 1,
  max_tokens: 64,
  reasoning_effort: null,
  n: 1,
  stop: ['}'],
  messages: [
    { role: 'system', content: INTENT_SYS },
    { role: 'user', content: text },
  ],
});
// CHAT config from research
const chatBody = (text) => ({
  model: 'sarvam-30b',
  stream: false,
  temperature: 0.2,
  top_p: 1,
  max_tokens: 192,
  reasoning_effort: null,
  n: 1,
  messages: [
    { role: 'system', content: CHAT_SYS },
    { role: 'user', content: text },
  ],
});

console.log('=== VERIFY: research low-latency config on sarvam-30b ===');
console.log('Confirming reasoning_effort:null is on the wire and checking if reasoning stops.');

await run('intent: spent 450 on auto', intentBody('spent 450 on auto'));
await run('intent: how much today', intentBody('how much did I spend today'));
await run('intent: chai', intentBody('chai'));
await run('chat: emergency fund', chatBody('how do I start an emergency fund'));
await run('chat: save on tight budget', chatBody('how can I save money on a tight budget'));
await run('chat: hindi tips', chatBody('mujhe paise bachane ke tips do'));

// Control: same chat WITH reasoning explicitly medium, to compare latency delta.
console.log('\n--- CONTROL: same chat prompt with reasoning_effort omitted (default medium) ---');
await run('chat(default medium): emergency fund', {
  model: 'sarvam-30b',
  stream: false,
  temperature: 0.5,
  max_tokens: 800,
  messages: [
    { role: 'system', content: CHAT_SYS },
    { role: 'user', content: 'how do I start an emergency fund' },
  ],
});
