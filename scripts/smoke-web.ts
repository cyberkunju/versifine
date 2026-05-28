/**
 * Tiny script to verify the web app is reachable. Used during the demo
 * checks; not part of CI.
 */
const url = process.env.WEB_URL ?? 'http://127.0.0.1:5173/';
try {
  const res = await fetch(url);
  console.log(`status=${res.status} ${res.statusText}`);
  const text = await res.text();
  const head = text.slice(0, 400);
  console.log(head);
} catch (err) {
  console.error('fetch failed:', err);
  process.exit(1);
}
