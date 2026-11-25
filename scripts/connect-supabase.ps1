<#
.SYNOPSIS
  Menghubungkan project ini ke Supabase: link project, push migrasi, deploy Edge Functions, dan set secrets.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\connect-supabase.ps1 -ProjectRef abcdefghijklmnop

.NOTES
  Prasyarat:
    npx supabase login
    Isi .env.local dengan VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.
    Isi .env dengan nilai secret server yang asli (bukan placeholder).
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9]{20}$')]
  [string]$ProjectRef,

  [string]$EnvFile = '.env',
  [switch]$SkipSecrets,
  [switch]$SkipFunctions
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

function Invoke-Supabase {
  param([string[]]$Arguments)
  Write-Host "`n> npx supabase $($Arguments -join ' ')" -ForegroundColor Cyan
  & npx --yes supabase @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Perintah supabase gagal (exit $LASTEXITCODE)." }
}

Write-Host '== 1/4 Link project ==' -ForegroundColor Green
Invoke-Supabase @('link', '--project-ref', $ProjectRef)

Write-Host '== 2/4 Push migrasi database ==' -ForegroundColor Green
Invoke-Supabase @('db', 'push', '--include-all')

if (-not $SkipFunctions) {
  Write-Host '== 3/4 Deploy Edge Functions ==' -ForegroundColor Green
  $functions = @('get-catalog', 'create-qris-order', 'sync-otp', 'cancel-order', 'admin-api')
  foreach ($fn in $functions) {
    Invoke-Supabase @('functions', 'deploy', $fn)
  }
  Invoke-Supabase @('functions', 'deploy', 'midtrans-webhook', '--no-verify-jwt')
}

if (-not $SkipSecrets) {
  Write-Host '== 4/4 Set Edge Function secrets ==' -ForegroundColor Green
  $envPath = Join-Path $root $EnvFile
  if (-not (Test-Path -LiteralPath $envPath)) { throw "File env '$EnvFile' tidak ditemukan." }

  $serverLines = New-Object System.Collections.Generic.List[string]
  $missing = New-Object System.Collections.Generic.List[string]
  foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$') { continue }
    $key = $Matches[1]
    $value = $Matches[2].Trim()
    if ($key.StartsWith('VITE_') -or $key -eq 'APP_ORIGIN' -or $key -eq 'SMS_ACTIVATE_CURRENCY_TO_IDR') { continue }
    if ($value -match 'YOUR_|SET_IN_|CHANGE_ME') {
      $missing.Add($key)
      continue
    }
    $serverLines.Add("$key=$value")
  }

  if ($missing.Count -gt 0) {
    Write-Warning "Secret berikut masih placeholder dan tidak diunggah: $($missing -join ', ')"
  }
  if ($serverLines.Count -eq 0) {
    Write-Warning 'Tidak ada secret valid untuk diunggah.'
  } else {
    $tempFile = Join-Path ([System.IO.Path]::GetTempPath()) "vns-secrets-$([guid]::NewGuid().ToString('N')).env"
    try {
      Set-Content -LiteralPath $tempFile -Value $serverLines -NoNewline
      Invoke-Supabase @('secrets', 'set', '--env-file', $tempFile)
    } finally {
      Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
    }
  }
}

Write-Host "`nSelesai. Langkah manual yang tersisa:" -ForegroundColor Green
Write-Host "  1. Buat user admin di Supabase Auth (Dashboard > Authentication > Users)."
Write-Host "  2. Jalankan SQL: insert into public.admin_users (user_id) values ('<uuid-user>');"
Write-Host "  3. Isi CATALOG_PAIRS_JSON dengan pasangan service/negara supplier yang valid."
Write-Host "  4. Set URL notifikasi Midtrans ke https://$ProjectRef.supabase.co/functions/v1/midtrans-webhook"
Write-Host "  5. Verifikasi koneksi: npm run check:supabase"
