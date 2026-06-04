import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadEnv() {
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const text = readFileSync(envPath, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const parts = trimmed.split('=');
        const key = parts[0]?.trim();
        const value = parts.slice(1).join('=').trim();
        if (key && value && !process.env[key]) {
          process.env[key] = value.replace(/(^["']|["']$)/g, ''); // strip quotes
        }
      }
    }
  }
}

async function main() {
  loadEnv();
  
  const token = process.env.WHATSAPP_TOKEN || process.env.META_ACCESS_TOKEN;
  const apiVersion = 'v20.0';

  if (!token) {
    console.error(`Error: WHATSAPP_TOKEN not found in environment!`);
    process.exit(1);
  }

  // 1. Query /me?fields=whatsapp_business_accounts
  console.log(`Querying /me?fields=whatsapp_business_accounts ...`);
  try {
    const response = await fetch(`https://graph.facebook.com/${apiVersion}/me?fields=whatsapp_business_accounts`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    const data = await response.json() as any;
    console.log(`Response:`, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`Error:`, e);
  }

  // 2. Query /122103244479347616/whatsapp_business_accounts
  console.log(`\nQuerying /122103244479347616/whatsapp_business_accounts ...`);
  try {
    const response = await fetch(`https://graph.facebook.com/${apiVersion}/122103244479347616/whatsapp_business_accounts`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    const data = await response.json() as any;
    console.log(`Response:`, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`Error:`, e);
  }
}

main().catch(console.error);
