// scripts/verify-storage-rls.mjs
// Session-8 prod-evidence verify for `storage_rls_scope_verify`.
//
// Proves the live `project-uploads` Storage RLS against the PRODUCTION Storage API
// with two real user JWTs — not dev attestation. Asserts:
//   1. owner CAN read own object             (positive control)
//   2. account B CANNOT read account A object (cross-user SELECT denied)
//   3. account B CANNOT sign account A object (cross-user signed-URL denied)
//   4. account B CANNOT write to A's prefix   (cross-user INSERT denied)
//   5. anonymous CANNOT read a private object (no auth.uid())
//   6. a 1s signed URL 403s after it expires  (expiry enforced)
// Cleans up the test object + both ephemeral users via service role.
//
// Run: node scripts/verify-storage-rls.mjs   (reads keys from .env.local)

import { readFileSync } from "node:fs";

function loadEnv() {
  const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_KEY;
const BUCKET = "project-uploads";
if (!URL_ || !ANON || !SERVICE) throw new Error("missing URL/ANON/SERVICE in .env.local");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2, 10);

async function adminCreateUser(email, password) {
  const res = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`createUser ${email}: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

async function adminDeleteUser(id) {
  await fetch(`${URL_}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  }).catch(() => {});
}

async function signIn(email, password) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`signIn ${email}: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return { jwt: j.access_token, uid: j.user.id };
}

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function upload(jwt, path, body) {
  return fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "content-type": "image/png" },
    body,
  });
}
async function download(jwt, path) {
  const headers = { apikey: ANON };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  return fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, { headers });
}
async function sign(jwt, path, expiresIn = 3600) {
  return fetch(`${URL_}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ expiresIn }),
  });
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

let aId, bId, aObj;
try {
  const pw = "Test-" + rid() + "-" + rid();
  const aEmail = `s8rls-a-${rid()}@example.com`;
  const bEmail = `s8rls-b-${rid()}@example.com`;
  aId = await adminCreateUser(aEmail, pw);
  bId = await adminCreateUser(bEmail, pw);
  const A = await signIn(aEmail, pw);
  const B = await signIn(bEmail, pw);

  aObj = `${A.uid}/proj-${rid()}/${rid()}.png`;
  const bIntoA = `${A.uid}/proj-${rid()}/${rid()}.png`; // B writing under A's prefix

  // A uploads own object
  const up = await upload(A.jwt, aObj, PNG);
  check("A uploads to own uid prefix → 200", up.ok, `status ${up.status}`);

  // 1. owner reads own (positive control)
  const aRead = await download(A.jwt, aObj);
  check("A reads own object → 200", aRead.ok, `status ${aRead.status}`);

  // 2. B reads A's object → DENIED
  const bRead = await download(B.jwt, aObj);
  check("B reads A's object → DENIED", !bRead.ok, `status ${bRead.status}`);

  // 3. B signs A's object → DENIED
  const bSign = await sign(B.jwt, aObj);
  check("B signs A's object → DENIED", !bSign.ok, `status ${bSign.status}`);

  // 4. B writes into A's prefix → DENIED
  const bWrite = await upload(B.jwt, bIntoA, PNG);
  check("B writes under A's uid prefix → DENIED", !bWrite.ok, `status ${bWrite.status}`);

  // 5. anonymous reads A's private object → DENIED
  const anonRead = await download(null, aObj);
  check("anonymous reads private object → DENIED", !anonRead.ok, `status ${anonRead.status}`);

  // 6. signed-URL expiry: A mints a 1s URL, wait, then fetch it → expired
  const s = await sign(A.jwt, aObj, 1);
  if (s.ok) {
    const signedPath = (await s.json()).signedURL || (await Promise.resolve("")).toString();
    const signedUrl = `${URL_}/storage/v1${signedPath}`;
    const fresh = await fetch(signedUrl);
    check("A's signed URL works immediately → 200", fresh.ok, `status ${fresh.status}`);
    await sleep(2500);
    const expired = await fetch(signedUrl);
    check("signed URL 403s after 1s expiry", !expired.ok, `status ${expired.status}`);
  } else {
    check("A mints signed URL", false, `status ${s.status}`);
  }
} catch (e) {
  check("script completed without throwing", false, String(e));
} finally {
  // cleanup object + users via service role
  if (aObj) {
    await fetch(`${URL_}/storage/v1/object/${BUCKET}/${aObj}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    }).catch(() => {});
  }
  if (aId) await adminDeleteUser(aId);
  if (bId) await adminDeleteUser(bId);
}

const allPass = results.length > 0 && results.every((r) => r.pass);
console.log(
  `\n${allPass ? "ALL PASS" : "FAILURES PRESENT"} — ${results.filter((r) => r.pass).length}/${results.length}`,
);
process.exit(allPass ? 0 : 1);
