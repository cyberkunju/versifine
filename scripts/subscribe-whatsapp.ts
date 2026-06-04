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
  const phoneNumberId = '1079257601947704';
  const apiVersion = 'v20.0';

  console.log(`==================================================`);
  console.log(` WhatsApp Business Subscribed Apps Tool`);
  console.log(`==================================================`);
  console.log(`Target Phone Number ID: ${phoneNumberId}`);
  console.log(`Graph API Version:      ${apiVersion}`);

  if (!token) {
    console.error(`Error: WHATSAPP_TOKEN not found in environment!`);
    process.exit(1);
  }

  // Step 1: Query the phone number to get the WABA ID
  console.log(`\n[1/2] Fetching WhatsApp Business Account ID (WABA ID)...`);
  const queryUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}?fields=whatsapp_business_account`;
  let wabaId = '';

  try {
    const response = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const data = await response.json() as any;

    if (response.ok && data.whatsapp_business_account?.id) {
      wabaId = data.whatsapp_business_account.id;
      console.log(`\x1b[32m✔ SUCCESS: Found WABA ID: ${wabaId}\x1b[0m`);
    } else {
      console.error(`\x1b[31m❌ FAILURE fetching WABA ID:\x1b[0m`);
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }
  } catch (error) {
    console.error(`\x1b[31m❌ Error contacting Meta Graph API:\x1b[0m`, error);
    process.exit(1);
  }

  // Step 2: Subscribe the app to the WABA ID
  console.log(`\n[2/2] Subscribing Meta App to WABA ID ${wabaId}...`);
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
