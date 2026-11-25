/**
 * Verifikasi koneksi frontend ke Supabase.
 * Jalankan: npm run check:supabase
 *
 * Skrip ini hanya membaca env VITE_* yang publik dan memanggil
 * Edge Function get-catalog. Tidak pernah mencetak secret.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile(name) {
  try {
    const raw = readFileSync(resolve(process.cwd(), name), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // file opsional
  }
}

for (const file of ['.env', '.env.local']) loadEnvFile(file);

const url = (process.env.VITE_SUPABASE_URL ?? '').trim();
const anonKey = (process.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const looksPlaceholder = (value) =>
  /^(YOUR_|SET_|CHANGE_ME|xxx)/i.test(value) || value.includes('YOUR_PROJECT');

function fail(message) {
  console.error(`\n[GAGAL] ${message}\n`);
  process.exit(1);
}

console.log('== Pemeriksaan koneksi Supabase ==');
if (!url || looksPlaceholder(url)) {
  fail('VITE_SUPABASE_URL belum diisi kredensial asli di .env.local.');
}
if (!anonKey || looksPlaceholder(anonKey)) {
  fail('VITE_SUPABASE_ANON_KEY belum diisi kredensial asli di .env.local.');
}
try {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('protocol');
} catch {
  fail('VITE_SUPABASE_URL bukan URL https yang valid.');
}
console.log(`Project URL : ${url}`);
console.log(`Anon key    : ${anonKey.slice(0, 8)}… (${anonKey.length} karakter)`);

const endpoint = `${url.replace(/\/$/, '')}/functions/v1/get-catalog`;
let response;
try {
  response = await fetch(endpoint, {
    method: 'GET',
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    signal: AbortSignal.timeout(20_000),
  });
} catch (error) {
  fail(`Tidak dapat menghubungi ${endpoint}: ${error.message}`);
}

const text = await response.text();
let payload;
try {
  payload = JSON.parse(text);
} catch {
  payload = null;
}

if (!response.ok) {
  fail(`Edge Function get-catalog merespons ${response.status}: ${payload?.error ?? text.slice(0, 300)}`);
}

const offers = payload?.offers;
if (!Array.isArray(offers)) {
  fail('Respons get-catalog tidak memiliki array "offers". Pastikan fungsi sudah dideploy.');
}

console.log(`[OK] get-catalog ${response.status} — ${offers.length} penawaran.`);
offers.slice(0, 5).forEach((offer) => {
  console.log(`     • ${offer.serviceName} / ${offer.countryName} — Rp${offer.sellPriceIdr} (stok ${offer.stock})`);
});
if (offers.length === 0) {
  console.warn('\n[PERINGATAN] Katalog kosong. Cek CATALOG_PAIRS_JSON dan kredensial supplier.\n');
}
console.log('\nFrontend siap memakai mode live (VITE_DEMO_MODE tidak diset).\n');
