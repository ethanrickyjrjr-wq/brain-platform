#!/usr/bin/env node
// cloud-secrets vault — encrypt/decrypt this repo's local secret files so a
// cloud / phone Claude session can materialize them on boot.
//
//   node cloud-secrets/vault.mjs build    bundle + encrypt -> vault.enc, commit, push, print passphrase
//   node cloud-secrets/vault.mjs unlock   decrypt vault.enc back into place (needs $SECRETS_PASSPHRASE)
//
// Pure Node crypto (AES-256-GCM) — no openssl/bash/tar — identical on Windows + the Linux cloud box.
// ONLY cloud-secrets/vault.enc (ciphertext) is committed. The passphrase is NEVER stored in git.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";

const FILES = [
  ".env",
  ".env.local",
  "ingest/.env",
  "ingest/.env.local",
  ".dlt/secrets.toml",
  ".dlt/config.toml",
];
const ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const VAULT = join(ROOT, "cloud-secrets", "vault.enc");
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: "inherit" });

function build() {
  const bundle = {};
  for (const rel of FILES) {
    const abs = join(ROOT, rel);
    if (existsSync(abs)) bundle[rel] = readFileSync(abs, "utf8");
    else console.warn(`  skip (missing): ${rel}`);
  }
  const pass = process.env.SECRETS_PASSPHRASE || randomBytes(32).toString("hex");
  const reused = Boolean(process.env.SECRETS_PASSPHRASE);
  const salt = randomBytes(16),
    iv = randomBytes(12),
    key = scryptSync(pass, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(bundle), "utf8")),
    cipher.final(),
  ]);
  mkdirSync(dirname(VAULT), { recursive: true });
  writeFileSync(VAULT, Buffer.concat([salt, iv, cipher.getAuthTag(), ct]));
  console.log(
    `\nWrote cloud-secrets/vault.enc — ${Object.keys(bundle).length} files, ${ct.length} bytes ciphertext.`,
  );
  // self-check: prove it decrypts back before committing anything
  {
    const chk = readFileSync(VAULT);
    const d = createDecipheriv(
      "aes-256-gcm",
      scryptSync(pass, chk.subarray(0, 16), 32),
      chk.subarray(16, 28),
    );
    d.setAuthTag(chk.subarray(28, 44));
    JSON.parse(Buffer.concat([d.update(chk.subarray(44)), d.final()]).toString("utf8"));
    console.log("Round-trip verified.");
  }
  try {
    run("git add cloud-secrets/ SESSION_LOG.md");
    run(
      'git commit cloud-secrets/ SESSION_LOG.md -m "feat(cloud-secrets): node vault tool + encrypted vault.enc"',
    );
    run("node scripts/safe-push.mjs");
  } catch {
    console.error(
      "\n(git step failed — commit cloud-secrets/ + SESSION_LOG.md and push manually; the vault is built.)",
    );
  }
  console.log("\n========================================");
  console.log(
    reused
      ? "Reused SECRETS_PASSPHRASE from your env."
      : "PASSPHRASE — save to your phone, NEVER commit:",
  );
  if (!reused) console.log(pass);
  console.log("========================================\n");
}

function unlock() {
  const pass = process.env.SECRETS_PASSPHRASE;
  if (!pass) {
    console.error("cloud-secrets: SECRETS_PASSPHRASE not set — nothing unlocked.");
    return;
  }
  const blob = readFileSync(VAULT);
  const key = scryptSync(pass, blob.subarray(0, 16), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(16, 28));
  decipher.setAuthTag(blob.subarray(28, 44));
  const bundle = JSON.parse(
    Buffer.concat([decipher.update(blob.subarray(44)), decipher.final()]).toString("utf8"),
  );
  for (const [rel, content] of Object.entries(bundle)) {
    const abs = join(ROOT, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  console.log(`cloud-secrets: unlocked ${Object.keys(bundle).length} secret file(s).`);
}

const cmd = process.argv[2];
if (cmd === "build") build();
else if (cmd === "unlock") unlock();
else {
  console.error("usage: node cloud-secrets/vault.mjs [build|unlock]");
  process.exit(1);
}
