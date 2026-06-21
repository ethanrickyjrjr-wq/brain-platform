# cloud-secrets — encrypted key vault for phone / cloud Claude sessions

`vault.enc` is an **AES-256-GCM-encrypted** bundle of this repo's local secret files.
Only the ciphertext is committed — useless without the passphrase, which is **never**
stored in git. It lets a Claude Code **cloud session** (claude.ai/code, e.g. from a phone)
materialize the real keys on boot without pasting them every time.

Crypto is pure Node (`vault.mjs`) — no openssl/bash/tar — so it runs identically on
Windows (PowerShell) and the Linux cloud box.

## Inside the vault
`.env`, `.env.local`, `ingest/.env`, `ingest/.env.local`, `.dlt/secrets.toml`, `.dlt/config.toml`

**Skipped:** `BLS_API_KEY`, `FBI_CDE_API_KEY` — gh-Actions-vault-only (write-only, unretrievable),
not needed for phone dev. To add later: put the values in `.env.local`, then rebuild.

## Build / rebuild the vault (local — Windows PowerShell, or anywhere with Node)
```
node cloud-secrets/vault.mjs build
```
Bundles + encrypts the files, commits `vault.enc`, pushes, and prints the passphrase **last**.
Save that passphrase to your phone — it is the ONLY copy, stored nowhere else.
(Set `$env:SECRETS_PASSPHRASE` first to reuse the same passphrase on a rebuild instead of a new one.)

## Cloud-session setup (one time, on phone/web)
In the Claude Code cloud environment for this repo:
1. **Env var:** `SECRETS_PASSPHRASE` = the passphrase from `build`
2. **Setup command:** `node cloud-secrets/vault.mjs unlock`  (or `bash cloud-secrets/setup.sh`)
3. **Network access:** `Full` (Trusted may not reach the Supabase Postgres host on :5432)

On boot the secret files are written into place. Then just talk to Claude.

## Rotate
- Rotate a **key**: edit the local file, run `node cloud-secrets/vault.mjs build`.
- Each `build` mints a NEW passphrase unless `$env:SECRETS_PASSPHRASE` is set; update
  `SECRETS_PASSPHRASE` in the cloud env to match whatever `build` prints.
