// Couch Bandit room list on Cloudflare: /api/rooms
// GET  -> the room list (anyone). Draft event rooms (no links yet) are only sent to the owner.
// PUT  [rooms] -> replace the room list (owner only, signed pass from /api/login)
// The list is kept in the ROOMS KV namespace under one key.
import { isOwner, json } from "./_auth.js";
import { KEY, SKIP_KEY, clean } from "./_rooms.js";
export async function onRequest({ request, env }) {
  const kv = env.ROOMS;
  if (!kv) return json({ error: "Room storage isn't connected. Bind a KV namespace named ROOMS in Cloudflare." }, 503);
  if (request.method === "GET") { // null = never saved, [] = all rooms deleted
    const list = await kv.get(KEY, "json");
    return json(Array.isArray(list) && !(await isOwner(request, env)) ? list.filter(r => !r.draft) : list);
  }
  if (request.method === "PUT") {
    if (!(await isOwner(request, env))) return json({ error: "Log in as owner again." }, 401);
    let list; try { list = await request.json(); } catch { return json({ error: "bad body" }, 400); }
    const rooms = clean(list);
    const text = JSON.stringify(rooms); if (text.length > 900000) return json({ error: "too big" }, 413);
    // remember auto event rooms the owner deleted so the event sync doesn't bring them back
    const before = (await kv.get(KEY, "json")) || [], now = new Set(rooms.map(r => r.id));
    const gone = before.filter(r => r && r.auto && !now.has(r.id)).map(r => r.id);
    if (gone.length) { const skip = (await kv.get(SKIP_KEY, "json")) || []; await kv.put(SKIP_KEY, JSON.stringify([...new Set([...skip, ...gone])].slice(-1000))); }
    await kv.put(KEY, text);
    return json({ ok: true, count: rooms.length });
  }
  return json({ error: "method" }, 405);
}
