// Couch Bandit room list on Cloudflare: /api/rooms
// GET  -> the room list (anyone)
// PUT  [rooms] -> replace the room list (owner only, signed pass from /api/login)
// The list is kept in the ROOMS KV namespace under one key.
import { isOwner, json } from "./_auth.js";
const KEY = "room-list";

const clean = list => (Array.isArray(list) ? list : []).filter(r => r && typeof r.id === "string" && /^[a-z0-9]{4,16}$/.test(r.id) && Array.isArray(r.items) && r.items.length)
  .slice(0, 200).map(r => ({
    id: r.id, created: +r.created || Date.now(), featured: !!r.featured,
    name: String(r.name || "Room").slice(0, 60), topic: String(r.topic || "").slice(0, 80), start: String(r.start || "").slice(0, 20),
    items: r.items.slice(0, 30).map((it, j) => ({
      title: String(it.title || "Stream " + (j + 1)).slice(0, 60),
      url: String(it.url || "").slice(0, 2000),
      backups: (Array.isArray(it.backups) ? it.backups : []).slice(0, 15).map(u => String(u).slice(0, 2000))
    })).filter(it => /^https?:\/\//i.test(it.url))
  })).filter(r => r.items.length);

export async function onRequest({ request, env }) {
  const kv = env.ROOMS;
  if (!kv) return json({ error: "Room storage isn't connected. Bind a KV namespace named ROOMS in Cloudflare." }, 503);
  if (request.method === "GET") return json(await kv.get(KEY, "json")); // null = never saved, [] = all rooms deleted
  if (request.method === "PUT") {
    if (!(await isOwner(request, env))) return json({ error: "Log in as owner again." }, 401);
    let list; try { list = await request.json(); } catch { return json({ error: "bad body" }, 400); }
    const rooms = clean(list);
    const text = JSON.stringify(rooms); if (text.length > 900000) return json({ error: "too big" }, 413);
    await kv.put(KEY, text);
    return json({ ok: true, count: rooms.length });
  }
  return json({ error: "method" }, 405);
}
