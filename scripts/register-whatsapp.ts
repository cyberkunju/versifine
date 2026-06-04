import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Helper to load environment variables from root .env manually if needed
function loadEnv() {
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const content = Bun.file(envPath).text();
    content.then((text) => {
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
    });
  }
}

async function main() {
  loadEnv();
  
  const args = process.argv.slice(2);
  const action = args[0] || 'verify'; // 'verify' or 'register'
  
  // Try to find the token and pin
  const token = args[1] || process.env.WHATSAPP_TOKEN || process.env.META_ACCESS_TOKEN;
  const pin = args[2] || process.env.WHATSAPP_PIN || '123456';
  const phoneNumberId = '1079257601947704';
  const apiVersion = 'v23.0';

  console.log(`==================================================`);
  console.log(` WhatsApp Business Cloud API Debugger/Register Tool`);
  console.log(`==================================================`);
  console.log(`Target Phone Number ID: ${phoneNumberId}`);
  console.log(`Graph API Version:      ${apiVersion}`);
  console.log(`Action:                 ${action.toUpperCase()}`);
  
  if (!token) {
    console.error(`\nError: Meta Access Token not found!`);
    console.log(`\nPlease provide the token using one of the following methods:`);
    console.log(`1. Pass it as a command line argument:`);
    console.log(`   bun run scripts/register-whatsapp.ts ${action} <YOUR_TOKEN> [PIN]`);
    console.log(`2. Add it to your root .env file:`);
    console.log(`   WHATSAPP_TOKEN=your_token_here`);
    process.exit(1);
  }

  // Obfuscate token for logs
  const obfuscatedToken = token.length > 15 
    ? `${token.slice(0, 8)}...${token.slice(-8)}` 
    : '***';
  console.log(`Authorization Token:    Bearer ${obfuscatedToken}`);
  console.log(`PIN (used if registering): ${pin}`);
  console.log(`--------------------------------------------------`);

  if (action === 'verify') {
    await verifyToken(phoneNumberId, token, apiVersion);
  } else if (action === 'register') {
    await verifyToken(phoneNumberId, token, apiVersion);
    await registerPhoneNumber(phoneNumberId, token, pin, apiVersion);
  } else {
    console.error(`Unknown action: ${action}. Use 'verify' or 'register'.`);
  }
}

async function verifyToken(phoneNumberId: string, token: string, apiVersion: string) {
  console.log(`[1/2] Verifying token access for Phone Number ID ${phoneNumberId}...`);
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const data = await response.json() as any;

    if (response.ok) {
      console.log(`\n\x1b[32m✔ SUCCESS: The token has access to this phone number!\x1b[0m`);
      console.log(`Display Name / Verified Name: ${data.verified_name || 'N/A'}`);
      console.log(`Display Phone Number:        ${data.display_phone_number || 'N/A'}`);
      console.log(`Quality Rating:              ${data.quality_rating || 'N/A'}`);
      console.log(`Status:                      ${data.status || 'N/A'}`);
      console.log(`Code Verification Status:    ${data.code_verification_status || 'N/A'}`);
      console.log(`--------------------------------------------------`);
    } else {
      console.error(`\n\x1b[31m❌ FAILURE: Meta API returned an error verifying token access:\x1b[0m`);
      console.error(JSON.stringify(data, null, 2));
      console.log(`\nTroubleshooting tips:`);
      console.log(`- Ensure the token belongs to the same Business Manager as the WABA.`);
      console.log(`- Verify the token has permissions like 'whatsapp_business_management' and 'whatsapp_business_messaging'.`);
      console.log(`- Make sure you copied the entire token (they can be very long).`);
      console.log(`- Double-check the Phone Number ID is correct.`);
      console.log(`--------------------------------------------------`);
      if (process.argv[2] !== 'force') {
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(`\n\x1b[31m❌ Error contacting Meta Graph API:\x1b[0m`, error);
    process.exit(1);
  }
}

async function registerPhoneNumber(phoneNumberId: string, token: string, pin: string, apiVersion: string) {
  console.log(`[2/2] Attempting to register phone number...`);
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/register`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        pin: pin,
      }),
    });

    const data = await response.json() as any;

    if (response.ok) {
      console.log(`\n\x1b[32m✔ SUCCESS: Phone number successfully registered/activated on Meta Cloud API!\x1b[0m`);
      console.log(JSON.stringify(data, null, 2));
      console.log(`==================================================`);
    } else {
      console.error(`\n\x1b[31m❌ FAILURE: Meta API returned an error registering the number:\x1b[0m`);
      console.error(JSON.stringify(data, null, 2));
      console.log(`--------------------------------------------------`);
    }
  } catch (error) {
    console.error(`\n\x1b[31m❌ Error contacting Meta Graph API:\x1b[0m`, error);
  }
}

main().catch(console.error);
