# Nomor Virtual — QRIS

Aplikasi React/Vite untuk storefront nomor OTP sekali pakai dengan Supabase Edge Functions, Midtrans Core API QRIS, dan supplier 5sim. Browser hanya mengakses Edge Functions; tabel transaksi tidak tersedia langsung melalui Supabase client.

## Menjalankan frontend

1. Gunakan Node.js 20 atau lebih baru.
2. Salin `.env.example` menjadi `.env.local`, lalu isi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`.
3. Jalankan `npm install`, lalu `npm run dev`. Untuk pemeriksaan produksi jalankan `npm run build`.
4. Deploy folder frontend ke Vercel. Jangan menaruh secret server dalam variabel `VITE_*`.

## Mode demo vs mode live

Aplikasi memilih mode secara otomatis:

- **Mode demo** aktif bila `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` masih placeholder, atau `VITE_DEMO_MODE=true`. Semua data (katalog, order, QRIS, OTP, admin) memakai mock `sessionStorage` dan tidak ada request jaringan. Voucher demo: `DEMO100` atau `GRATIS`. Login admin demo memakai tombol 1-klik.
- **Mode live** aktif bila kedua kredensial publik terisi valid dan `VITE_DEMO_MODE` tidak `true`. Login admin diverifikasi Supabase Auth + `public.admin_users`, dan tombol simulasi pembayaran otomatis disembunyikan.

Verifikasi koneksi backend setelah mengisi env:

```bash
npm run check:supabase
```

## Menghubungkan project ke Supabase

Prasyarat: `npx supabase login` (sekali saja) dan nilai secret server yang asli di `.env`.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\connect-supabase.ps1 -ProjectRef <project-ref>
```

Skrip melakukan: link project, `db push` untuk migrasi + RLS, deploy semua Edge Functions (termasuk `midtrans-webhook` tanpa JWT), lalu mengunggah secret server yang valid dari `.env`. Secret placeholder dilewati dengan peringatan.


## Menyiapkan Supabase

1. Terapkan `supabase/migrations/20260101000000_init_secure_schema.sql` melalui Supabase CLI atau SQL Editor.
2. Atur Edge Function secrets berikut di Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MIDTRANS_SERVER_KEY`, `SUPPLIER_API_KEY`, `SUPPLIER_CURRENCY_TO_IDR`, `SUPPLIER_MIN_BALANCE_IDR`, dan `SELLER_MARGIN_BPS`.
3. Atur `MIDTRANS_IS_PRODUCTION` (`false` untuk sandbox), `QRIS_EXPIRY_MINUTES`, `APP_ORIGIN` (origin frontend), serta `CATALOG_PAIRS_JSON`. Nilai konversi supplier harus mengikuti mata uang dan saldo akun supplier Anda.
4. Deploy semua direktori di `supabase/functions/`. `midtrans-webhook` sengaja memakai `verify_jwt = false`; signature Midtrans diverifikasi di kode fungsi.
5. Atur URL notifikasi Midtrans ke `https://<project-ref>.supabase.co/functions/v1/midtrans-webhook` dan aktifkan metode QRIS di akun Midtrans.
6. Untuk admin, buat akun di Supabase Auth lalu tambahkan UUID-nya ke `public.admin_users` melalui SQL Editor. Jangan memberikan akses SQL langsung kepada pengguna admin.

Contoh `CATALOG_PAIRS_JSON`:

```json
[
  {
    "serviceId": "telegram",
    "serviceName": "Telegram",
    "countryCode": "indonesia",
    "countryName": "Indonesia"
  }
]
```

Katalog default hanya contoh awal. Pastikan ID produk/negara dan format harga dikonfirmasi terhadap akun serta API supplier yang digunakan sebelum menerima pembayaran produksi. Harga jual dihitung server dengan markup `SELLER_MARGIN_BPS`, penggantian MDR 0,7%, lalu pembulatan ke atas Rp100.

## Batas akses dan operasional

- `orders`, `financial_ledger`, `refund_vouchers`, `webhook_logs`, `rate_limits`, dan `admin_users` memakai RLS tanpa akses browser. RPC transaksi hanya diberikan kepada `service_role`; data pembeli melalui `get_order_secure` di Edge Function.
- PIN pesanan di-hash dengan bcrypt di PostgreSQL. Kode order acak dan PIN harus disimpan oleh pembeli.
- Limit QRIS adalah 5 permintaan per menit per IP yang di-HMAC sebelum disimpan.
- Webhook memeriksa signature SHA-512 dan nilai pembayaran sebelum memproses event unik. Fulfillment supplier menggunakan klaim baris agar webhook paralel tidak membuat pesanan supplier ganda.
- Voucher kompensasi disimpan privat dan dapat digunakan sebagian pada pesanan baru; sisa saldo tetap tersedia. Pembatalan invoice mengembalikan saldo voucher yang telah dicadangkan.
- Bila panggilan supplier berakhir dengan hasil jaringan yang ambigu, klaim pemenuhan mencegah pembelian ulang otomatis dan pesanan tetap `processing` untuk rekonsiliasi. API supplier tidak menyediakan jaminan idempotensi universal; periksa status supplier sebelum melakukan tindakan manual agar nomor tidak terbeli dua kali.
- Catatkan secret, webhook URL, identitas admin, dan nilai konversi supplier di lingkungan deployment yang terpisah. Rotasi secret jika pernah terekspos.

Adapter SMS-Activate tersedia di `_shared/supplier5sim.ts`; aktifkan melalui `SUPPLIER_PROVIDER=sms-activate` dan `SMS_ACTIVATE_API_KEY` hanya setelah ID negara/service serta mata uang akun dipetakan dan diuji di lingkungan sandbox.
