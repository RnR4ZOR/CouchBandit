// Owner sign-in for Couch Bandit on Cloudflare.
// The owner username and password live only in Cloudflare as encrypted settings (OWNER_USER, OWNER_PASS),
// never in this public code. A successful login gets a signed pass that lasts 30 days on that device.
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(secret, text) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(text)));
}
// Compare without leaking timing
function same(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
// The signing secret is derived from the password, so changing the password logs every device out
const secretOf = env => (env.SESSION_SECRET || "") + "|" + env.OWNER_USER + "|" + env.OWNER_PASS;

export const ownerReady = env => !!(env.OWNER_USER && env.OWNER_PASS);
export const checkLogin = (env, user, pass) => ownerReady(env) && same(user, env.OWNER_USER) && same(pass, env.OWNER_PASS);

export async function makePass(env) {
  const exp = Date.now() + 30 * 24 * 3600e3;
  const body = "owner." + exp;
  return body + "." + await hmac(secretOf(env), body);
}
export async function isOwner(request, env) {
  if (!ownerReady(env)) return false;
  const m = /^Bearer (owner\.(\d+))\.([\w-]+)$/.exec(request.headers.get("authorization") || "");
  if (!m || Date.now() > +m[2]) return false;
  return same(m[3], await hmac(secretOf(env), m[1]));
}
export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
