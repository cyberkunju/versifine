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

  if (!token) {
    console.error(`Error: WHATSAPP_TOKEN not found in environment!`);
    process.exit(1);
  }

  console.log(`Fetching data for Phone Number ID ${phoneNumberId}...`);
  const queryUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;

  try {
    const response = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const data = await response.json() as any;
    console.log(`Raw Response:`);
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error:`, error);
  }
}

main().catch(console.error);
