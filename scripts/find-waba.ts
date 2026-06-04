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

  // 1. Query /debug_token to get WABA info
  console.log(`Checking token details...`);
  try {
    const response = await fetch(`https://graph.facebook.com/${apiVersion}/debug_token?input_token=${token}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    const data = await response.json() as any;
    console.log(`Debug Token response:`, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`Error debug_token:`, e);
  }

  // 2. Query /me
  console.log(`\nQuerying /me ...`);
  try {
    const response = await fetch(`https://graph.facebook.com/${apiVersion}/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    const data = await response.json() as any;
    console.log(`/me response:`, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`Error /me:`, e);
  }

  // 3. Query /me/accounts
  console.log(`\nQuerying /me/accounts ...`);
  try {
    const response = await fetch(`https://graph.facebook.com/${apiVersion}/me/accounts`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    const data = await response.json() as any;
    console.log(`/me/accounts response:`, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`Error /me/accounts:`, e);
  }
}

main().catch(console.error);
