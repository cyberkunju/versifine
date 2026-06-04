import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
            process.env[key] = value.replace(/(^["']|["']$)/g, '');
          }
        }
      }
    });
  }
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const recipient = args[0];
  const token = args[1] || process.env.WHATSAPP_TOKEN || 'EAAk2Ec8hbRIBRtmx1CRCqvlhYfAbZBdKJSfkWZBQGqrbPcar3zIFJ1ZBwuomExs8RyZBg4V6liDT7AJAmTKNVL0Tuj890cV9roUft0f6WfG70KqfHx9zumYUoaHtvR3dwb4dgYMXXUlRkcDZBfckK6jfNECAgYZCv5n90Xk3EPTLxCXmwllv8yK9qSh5LF9wZDZD';
  const phoneNumberId = '1079257601947704';
  const apiVersion = 'v23.0';

  console.log(`==================================================`);
  console.log(` WhatsApp Business Cloud API Message Sender Tool`);
  console.log(`==================================================`);

  if (!recipient) {
    console.error(`\nError: Recipient phone number is required!`);
    console.log(`\nUsage:`);
    console.log(`  bun run scripts/test-send-whatsapp.ts <RECIPIENT_PHONE_NUMBER> [TOKEN]`);
    console.log(`  (Note: Include country code, e.g., 919037931435)`);
    process.exit(1);
  }

  const obfuscatedToken = token.length > 15 
    ? `${token.slice(0, 8)}...${token.slice(-8)}` 
    : '***';

  console.log(`Sender Phone ID:      ${phoneNumberId}`);
  console.log(`Recipient Number:     ${recipient}`);
  console.log(`Token:                Bearer ${obfuscatedToken}`);
  console.log(`API Version:          ${apiVersion}`);
  console.log(`--------------------------------------------------`);

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  
  const payload = {
    messaging_product: 'whatsapp',
    to: recipient,
    type: 'template',
    template: {
      name: 'hello_world',
      language: {
        code: 'en_US'
      }
    }
  };

  try {
    console.log(`Sending 'hello_world' template message...`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json() as any;

    if (response.ok) {
      console.log(`\n\x1b[32m✔ SUCCESS: Message sent successfully!\x1b[0m`);
      console.log(JSON.stringify(data, null, 2));
      console.log(`==================================================`);
    } else {
      console.error(`\n\x1b[31m❌ FAILURE: Meta API returned an error:\x1b[0m`);
      console.error(JSON.stringify(data, null, 2));
      console.log(`\nTroubleshooting tips:`);
      console.log(`- Since you are in test/development mode, the recipient phone number`);
      console.log(`  MUST be added and verified in the 'To' dropdown in your App Dashboard.`);
      console.log(`- Make sure you included the country code in the recipient number (e.g. 919400245958).`);
      console.log(`==================================================`);
    }
  } catch (error) {
    console.error(`\n\x1b[31m❌ Error contacting Meta Graph API:\x1b[0m`, error);
  }
}

main().catch(console.error);
