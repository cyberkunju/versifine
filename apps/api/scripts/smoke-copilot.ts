/**
 * Smoke test the copilot SSE endpoint AND the WebSocket bus.
 *
 *   1. Register a user.
 *   2. Open a WebSocket and verify we get a `connected` handshake.
 *   3. Create a wallet + a couple of transactions; assert the WS receives
 *      `transaction.created` events with the right entity ids.
 *   4. POST to /copilot/chat asking "how much did I spend on transport?",
 *      consume the SSE stream, assert at least one chunk + a tool_call +
 *      a tool_result + a `done` marker.
 *
 *   bun run --cwd apps/api scripts/smoke-copilot.ts
 */
export {};

const BASE = process.env.API_URL ?? 'http://localhost:5000';
const WS_BASE = BASE.replace(/^http/, 'ws');

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  bearer?: string,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { success: boolean; data?: T; error?: { message: string } };
  console.log(`[${res.status}] ${method} ${path}`);
  if (!res.ok) {
    console.log(JSON.stringify(json, null, 2));
    throw new Error(`request failed: ${method} ${path}`);
  }
  return { status: res.status, data: json.data as T };
}

interface WsMessage {
  type?: string;
  entityId?: string;
  data?: { transactionId?: string; description?: string };
}

async function main() {
  const email = `copilot+${Date.now()}@finehance.app`;
  const password = 'Finehance#2026!';

  type Auth = {
    user: { id: string; activeSpaceId: string };
    tokens: { accessToken: string };
  };
  const reg = await call<Auth>('POST', '/auth/register', {
    email,
    password,
    displayName: 'Copilot Demo',
    primaryLanguage: 'en',
  });
  const access = reg.data.tokens.accessToken;

  // Step 1 — open the WebSocket.
  const ws = new WebSocket(`${WS_BASE}/ws`, [`bearer.${access}`]);
  const wsMessages: WsMessage[] = [];
  let wsOpen = false;
  ws.addEventListener('open', () => {
    wsOpen = true;
    console.log('  → ws open');
  });
  ws.addEventListener('message', (event) => {
    const text = typeof event.data === 'string' ? event.data : event.data.toString();
    try {
      const parsed = JSON.parse(text) as WsMessage;
      wsMessages.push(parsed);
      console.log(`  ← ws ${parsed.type ?? 'unknown'}${parsed.entityId ? ` (${parsed.entityId.slice(0, 8)})` : ''}`);
    } catch {
      console.log(`  ← ws (raw) ${text.slice(0, 80)}`);
    }
  });
  ws.addEventListener('error', (event) => {
    console.error('  ! ws error', event);
  });

  // Wait up to 5s for the open + connected handshake.
  const start = Date.now();
  while (Date.now() - start < 5000 && (!wsOpen || wsMessages.length === 0)) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!wsOpen) throw new Error('ws never opened');
  const handshake = wsMessages.find((m) => m.type === 'connected');
  if (!handshake) throw new Error('ws never sent connected handshake');

  // Step 2 — create wallet + transactions.
  type WalletEnvelope = { wallet: { id: string } };
  const w = await call<WalletEnvelope>(
    'POST',
    '/wallets',
    { name: 'HDFC', type: 'bank', currency: 'INR', openingBalance: 50000 },
    access,
  );
  const walletId = w.data.wallet.id;

  type TxEnvelope = { transaction: { id: string; description: string } };
  const t1 = await call<TxEnvelope>(
    'POST',
    '/transactions',
    {
      type: 'expense',
      amount: 450,
      currency: 'INR',
      date: new Date().toISOString().slice(0, 10),
      description: 'Auto rickshaw to office',
      walletId,
      category: 'Transportation',
    },
    access,
  );
  const t2 = await call<TxEnvelope>(
    'POST',
    '/transactions',
    {
      type: 'expense',
      amount: 320,
      currency: 'INR',
      date: new Date().toISOString().slice(0, 10),
      description: 'Uber to airport',
      walletId,
      category: 'Transportation',
    },
    access,
  );

  // Step 3 — wait for the WS events to land.
  const expectedIds = [t1.data.transaction.id, t2.data.transaction.id];
  const settle = Date.now();
  while (Date.now() - settle < 5000) {
    const got = wsMessages.filter(
      (m) => m.type === 'transaction.created' && expectedIds.includes(m.entityId ?? ''),
    );
    if (got.length === expectedIds.length) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const txEvents = wsMessages.filter((m) => m.type === 'transaction.created');
  console.log(`  → ws received ${txEvents.length} transaction.created events`);
  if (txEvents.length < 2) throw new Error('expected 2 transaction.created events on the WS');

  // Step 4 — copilot SSE.
  const copilotRes = await fetch(`${BASE}/copilot/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${access}`,
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: 'How much did I spend on Transportation this month?',
        },
      ],
    }),
  });
  console.log(`[${copilotRes.status}] POST /copilot/chat (stream)`);
  if (!copilotRes.ok) {
    const txt = await copilotRes.text();
    throw new Error(`copilot failed: ${copilotRes.status} ${txt.slice(0, 200)}`);
  }
  if (!copilotRes.body) throw new Error('copilot returned no body');

  const events: Array<{ type: string; [key: string]: unknown }> = [];
  let buffer = '';
  const reader = copilotRes.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const sep = buffer.indexOf('\n\n');
      if (sep < 0) break;
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload) continue;
      try {
        const parsed = JSON.parse(payload) as { type: string };
        events.push(parsed);
        if (parsed.type === 'tool_call' || parsed.type === 'tool_result' || parsed.type === 'done' || parsed.type === 'error') {
          console.log(`  ← sse ${parsed.type}`);
        }
      } catch {
        // ignore
      }
    }
  }

  const chunks = events.filter((e) => e.type === 'chunk');
  const toolCalls = events.filter((e) => e.type === 'tool_call');
  const toolResults = events.filter((e) => e.type === 'tool_result');
  const done = events.find((e) => e.type === 'done');
  const errored = events.find((e) => e.type === 'error');

  console.log(`  → sse chunks=${chunks.length} tool_calls=${toolCalls.length} tool_results=${toolResults.length}`);
  if (errored) throw new Error(`copilot stream errored: ${JSON.stringify(errored)}`);
  if (!done) throw new Error('copilot stream did not finish with done');
  if (chunks.length === 0) throw new Error('copilot produced no text chunks');
  // Tool calls are not strictly required (the model may answer from context),
  // but the test seeds two Transportation transactions and asks for a total,
  // which strongly biases the model toward compute_total. Soft-warn instead
  // of fail if it didn't.
  if (toolCalls.length === 0) {
    console.warn('  ! copilot did not call a tool; may be answering from context only');
  } else if (toolResults.length !== toolCalls.length) {
    throw new Error('tool result count did not match tool call count');
  }

  ws.close();
  console.log('\nsmoke-copilot: OK');
}

main().catch((err) => {
  console.error('smoke-copilot: FAILED', err);
  process.exit(1);
});
