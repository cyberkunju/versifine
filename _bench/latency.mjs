// Latency deep-dive for Sarvam chat. Tests every lever:
//  - reasoning_effort: null vs 'low'   (does null truly suppress thinking?)
//  - stream: true                       (time-to-first-token = what users feel)
//  - shorter max_tokens                 (cap the answer)
// Measures TTFT (first content byte) and total time. Compares to gpt-4o-mini.
import { readFileSync } from 'node:fs';
const SARVAM_KEY = readFileSync(new URL('./.sarvam.key', import.meta.url), 'utf8').trim();
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.error('Set OPENAI_API_KEY');
  process.exit(1);
}

const CHAT_SYS = `You are Vivien, a personal-finance copilot. Answer ONLY personal-finance questions, briefly (2-3 sentences) and warmly. Reply in the user's language.`;
const PROMPTS = [
  'how do I start an emergency fund',
  'how can I save money on a tight budget',
  'mujhe paise bachane ke tips do',
];

// Stream a chat completion, measuring time-to-first-content-token and total.
async function streamCall({ vendor, id, effort, maxTokens }, system, user) {
  const url =
    vendor === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.sarvam.ai/v1/chat/completions';
  const key = vendor === 'openai' ? OPENAI_KEY : SARVAM_KEY;
  const payload = {
    model: id,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    max_tokens: maxTokens,
    stream: true,
  };
  if (vendor === 'sarvam') payload.reasoning_effort = effort;

  const t0 = performance.now();
  let ttft = null,
    contentTtft = null,
    chars = 0,
    sawReasoning = false;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    return { err: `HTTP ${res.status} ${t.slice(0, 120)}` };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (ttft === null) ttft = Math.round(performance.now() - t0);
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const data = s.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const delta = j.choices?.[0]?.delta ?? {};
        if (delta.reasoning_content) sawReasoning = true;
        if (delta.content) {
          if (contentTtft === null) contentTtft = Math.round(performance.now() - t0);
          chars += delta.content.length;
        }
      } catch {
        /* partial */
      }
    }
  }
  const total = Math.round(performance.now() - t0);
  return { ttft, contentTtft, total, chars, sawReasoning };
}

const CONFIGS = [
  { label: 'gpt-4o-mini (stream)', vendor: 'openai', id: 'gpt-4o-mini', maxTokens: 300 },
  {
    label: 'sarvam-105b null+stream',
    vendor: 'sarvam',
    id: 'sarvam-105b',
    effort: null,
    maxTokens: 300,
  },
  {
    label: 'sarvam-105b low+stream',
    vendor: 'sarvam',
    id: 'sarvam-105b',
    effort: 'low',
    maxTokens: 300,
  },
  {
    label: 'sarvam-30b null+stream',
    vendor: 'sarvam',
    id: 'sarvam-30b',
    effort: null,
    maxTokens: 300,
  },
  {
    label: 'sarvam-30b low+stream',
    vendor: 'sarvam',
    id: 'sarvam-30b',
    effort: 'low',
    maxTokens: 300,
  },
];

const agg = {};
for (const c of CONFIGS) agg[c.label] = { contentTtft: [], total: [], reasoning: 0, n: 0, errs: 0 };

for (const p of PROMPTS) {
  console.log(`\nPROMPT: "${p}"`);
  for (const c of CONFIGS) {
    const r = await streamCall(c, CHAT_SYS, p);
    if (r.err) {
      console.log(`  [${c.label}] ERR ${r.err}`);
      agg[c.label].errs++;
      continue;
    }
    agg[c.label].n++;
    agg[c.label].contentTtft.push(r.contentTtft ?? r.total);
    agg[c.label].total.push(r.total);
    if (r.sawReasoning) agg[c.label].reasoning++;
    console.log(
      `  [${c.label}] firstWord=${r.contentTtft}ms total=${r.total}ms chars=${r.chars} thinking=${r.sawReasoning}`,
    );
  }
}

const med = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
console.log('\n\n==== LATENCY SUMMARY (streaming) ====');
console.log(
  'Key metric = "first word" (time-to-first-content-token) — what the user actually feels.',
);
for (const c of CONFIGS) {
  const a = agg[c.label];
  console.log(`\n${c.label}`);
  console.log(
    `  first-word median: ${med(a.contentTtft)}ms | total median: ${med(a.total)}ms | thinking fired: ${a.reasoning}/${a.n} | errs: ${a.errs}`,
  );
}
