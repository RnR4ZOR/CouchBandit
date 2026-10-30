// Approved sources the event sync may search and use: /api/sources
// GET  -> {categories: {Sport: {channels: ["@Handle" | "UC…"], alts: ["https://…"]}}, days_ahead, skip_titles} or null (use tools/channels.json)
// PUT  -> replace it (owner only)
import { isOwner, json } from "./_auth.js";
const KEY = "sources";
const s = (v, n) => String(v || "").replace(/[\u0000-\u001f<>"]/g, "").trim().slice(0, n);
const chan = v => { v = s(v, 200); const m = v.match(/(UC[\w-]{22})/) || v.match(/(@[\w.-]{3,40})/); return m ? m[1] : /^[\w.-]{3,40}$/.test(v) ? "@" + v : ""; };
export const cleanSources = b => {
  const cats = {};
  for (const [k, v] of Object.entries(b?.categories || {}).slice(0, 20)) {
    const name = s(k, 24).replace(/[^\w &+-]/g, ""); if (!name) continue;
    cats[name] = { channels: [...new Set((v?.channels || []).map(chan).filter(Boolean))].slice(0, 15),
      alts: [...new Set((v?.alts || []).map(u => s(u, 500)).filter(u => /^https:\/\//i.test(u)))].slice(0, 5) };
  }
  return { categories: cats, days_ahead: Math.min(30, Math.max(1, +b?.days_ahead || 14)), skip_titles: s(b?.skip_titles, 300) };
};
export async function onRequest({ request, env }) {
  const kv = env.ROOMS; if (!kv) return json({ error: "Storage isn't connected." }, 503);
  if (request.method === "GET") return json(await kv.get(KEY, "json"));
  if (request.method !== "PUT") return json({ error: "method" }, 405);
  if (!(await isOwner(request, env))) return json({ error: "Log in as owner again." }, 401);
  let b; try { b = await request.json(); } catch { return json({ error: "bad body" }, 400); }
  const clean = cleanSources(b);
  await kv.put(KEY, JSON.stringify(clean));
  return json({ ok: true, sources: clean });
}
