// Probe Sarvam connectivity + correct auth header. No secrets printed.
import { readFileSync } from 'node:fs';
const KEY = readFileSync(new URL('./.sarvam.key', import.meta.url), 'utf8').trim();

const body = {
  model: 'sarvam-30b',
  messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
  max_tokens: 10,
  temperature: 0,
};

async function tryAuth(label, headers) {
  try {
    const r = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    console.log(`[${label}] status=${r.status} body=${txt.slice(0, 300)}`);
  } catch (e) {
    console.log(`[${label}] ERROR ${e.message}`);
  }
}

await tryAuth('Bearer', { authorization: `Bearer ${KEY}` });
await tryAuth('api-subscription-key', { 'api-subscription-key': KEY });
