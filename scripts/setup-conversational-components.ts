/**
 * setup-conversational-components.ts
 *
 * Registers Versifine's WhatsApp "conversational components" on the business
 * phone number via the Meta Graph API:
 *   - Ice breakers   (tappable prompts shown to new / empty chats, ≤4, ≤80 chars)
 *   - Commands       (slash menu shown when the user types "/")
 *   - Welcome message (Meta sends a `request_welcome` webhook on first contact)
 *
 * Idempotent: POSTing replaces the whole config, so re-running just re-applies
 * the canonical set below. Inbound taps need NO special handling — ice breakers
 * and commands arrive as normal text and flow through the conversation engine
 * (slash commands like "/help" are matched after stripping the "/").
 *
 * Usage (from repo root):
 *   bun run scripts/setup-conversational-components.ts          # apply config
 *   bun run scripts/setup-conversational-components.ts --get    # read current config
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadEnv() {
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const parts = trimmed.split('=');
        const key = parts[0]?.trim();
        const value = parts.slice(1).join('=').trim();
        if (key && value && !process.env[key]) {
          process.env[key] = value.replace(/(^["']|["']$)/g, '');
        }
      }
    }
  }
}

// ---- Canonical Versifine configuration ----
// Ice breakers are PLAIN TEXT — Meta strips emoji and stores U+FFFD.
const ICE_BREAKERS = [
  'Log an expense',
  "See this month's spending",
  'Set a budget',
  'What can Versifine do?',
];

const COMMANDS = [
  { command_name: 'help', command_description: 'See everything Versifine can do' },
  { command_name: 'summary', command_description: "This month's spending summary" },
  { command_name: 'budget', command_description: 'Set or check a budget' },
  { command_name: 'language', command_description: 'Change your reply language' },
];

const ENABLE_WELCOME_MESSAGE = true;

function assertValid() {
  if (ICE_BREAKERS.length > 4) throw new Error('Max 4 ice breakers allowed.');
  for (const p of ICE_BREAKERS) {
    if ([...p].length > 80) throw new Error(`Ice breaker over 80 chars: "${p}"`);
  }
  for (const c of COMMANDS) {
    if (!/^[a-z0-9_]{1,32}$/.test(c.command_name)) {
      throw new Error(`Invalid command_name: "${c.command_name}" (lowercase/_/digits only).`);
    }
    if (c.command_description.length > 256) throw new Error('Command description too long.');
  }
}

async function main() {
  loadEnv();
  const token = process.env.WHATSAPP_TOKEN || process.env.META_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v23.0';

  if (!token || !phoneNumberId) {
    console.error('Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env first.');
    process.exit(1);
  }

  const base = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;

  // --get : read current config and exit.
  if (process.argv.includes('--get')) {
    const res = await fetch(`${base}?fields=conversational_automation`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    console.log(`HTTP ${res.status}`);
    console.log(JSON.stringify(data, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  assertValid();

  // Meta expects arrays as JSON-encoded form fields on this endpoint.
  const form = new URLSearchParams();
  form.set('enable_welcome_message', String(ENABLE_WELCOME_MESSAGE));
  form.set('prompts', JSON.stringify(ICE_BREAKERS));
  form.set('commands', JSON.stringify(COMMANDS));

  console.log('Applying conversational components to phone number', phoneNumberId);
  console.log('  ice breakers :', ICE_BREAKERS.join(' | '));
  console.log('  commands     :', COMMANDS.map((c) => '/' + c.command_name).join(' '));
  console.log('  welcome msg  :', ENABLE_WELCOME_MESSAGE);

  const res = await fetch(`${base}/conversational_automation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const data = await res.json().catch(() => ({}));

  if (res.ok) {
    console.log('\n✔ SUCCESS — conversational components applied.');
    console.log(JSON.stringify(data, null, 2));
    console.log('\nVerify with: bun run scripts/setup-conversational-components.ts --get');
  } else {
    console.error(`\n❌ FAILED (HTTP ${res.status}):`);
    console.error(JSON.stringify(data, null, 2));
    console.error(
      '\nTips: token needs whatsapp_business_management; phone number must be on Cloud API; ' +
        'ice breakers ≤4 and ≤80 chars; command names lowercase.',
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
