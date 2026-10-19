// POST /api/login {user, pass} -> {pass: "<signed 30-day owner pass>"}
// GET  /api/login -> {server: true, ready} so the page knows it's on Cloudflare
import { checkLogin, makePass, ownerReady, json } from "./_auth.js";

export async function onRequest({ request, env }) {
  if (request.method === "GET") return json({ server: true, ready: ownerReady(env) });
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (!ownerReady(env)) return json({ error: "Owner login isn't set up. Add OWNER_USER and OWNER_PASS in Cloudflare." }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: "bad body" }, 400); }
  // small fixed delay slows down password guessing
  await new Promise(r => setTimeout(r, 400));
  if (!checkLogin(env, String(b.user || ""), String(b.pass || ""))) return json({ error: "That username or password isn't right." }, 401);
  return json({ pass: await makePass(env) });
}
