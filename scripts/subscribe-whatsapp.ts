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
  const wabaId = '2306127019919794';
  const apiVersion = 'v20.0';

  console.log(`==================================================`);
  console.log(` WhatsApp Business Subscribed Apps Tool`);
  console.log(`==================================================`);
  console.log(`Target WABA ID:         ${wabaId}`);
  console.log(`Graph API Version:      ${apiVersion}`);

  if (!token) {
    console.error(`Error: WHATSAPP_TOKEN not found in environment!`);
    process.exit(1);
  }

  // Subscribe the app to the WABA ID
  console.log(`\nSubscribing Meta App to WABA ID ${wabaId}...`);
  const subscribeUrl = `https://graph.facebook.com/${apiVersion}/${wabaId}/subscribed_apps`;

  try {
    const response = await fetch(subscribeUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    });

    const data = await response.json() as any;

    if (response.ok) {
      console.log(`\n\x1b[32m✔ SUCCESS: App successfully subscribed to WABA ID ${wabaId}!\x1b[0m`);
      console.log(JSON.stringify(data, null, 2));
      console.log(`==================================================`);
    } else {
      console.error(`\n\x1b[31m❌ FAILURE subscribing to WABA:\x1b[0m`);
      console.error(JSON.stringify(data, null, 2));
      console.log(`--------------------------------------------------`);
    }
  } catch (error) {
    console.error(`\n\x1b[31m❌ Error subscribing to WABA:\x1b[0m`, error);
  }
}

main().catch(console.error);
