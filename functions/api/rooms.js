// Couchside saved rooms: /api/rooms (Cloudflare Pages Function, rooms kept in the ROOMS KV namespace)
// GET lists saved rooms, POST {room} saves one (room.id required), DELETE ?id= removes one.
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const HOUR = 3600e3;
// Delete 48 hours after the event ends (start + 6 h), or 48 hours after creation if there is no start time
const expiresAt = r => r.start && !isNaN(new Date(r.start)) ? new Date(r.start).getTime() + 54 * HOUR : (r.created || r.saved || 0) + 48 * HOUR;
const okId = id => typeof id === "string" && /^[a-z0-9]{6,16}$/.test(id);

export async function onRequest({ request, env }) {
  const kv = env.ROOMS;
  if (!kv) return json({ error: "Room storage isn't connected. Bind a KV namespace named ROOMS in Cloudflare." }, 503);
  if (request.method === "GET") {
    const keys = [];
    let cursor;
    do { const page = await kv.list({ cursor }); keys.push(...page.keys); cursor = page.list_complete ? null : page.cursor; } while (cursor);
    const all = (await Promise.all(keys.map(k => kv.get(k.name, "json")))).filter(Boolean);
    const now = Date.now(), rooms = [];
    for (const r of all) { if (now > expiresAt(r)) await kv.delete(r.id); else rooms.push(r); }
    rooms.sort((a, b) => (b.saved || 0) - (a.saved || 0));
    return json(rooms.slice(0, 100));
  }
  if (request.method === "POST") {
    let room; try { ({ room } = await request.json()); } catch { return json({ error: "bad body" }, 400); }
    if (!room || !okId(room.id) || !Array.isArray(room.items) || !room.items.length) return json({ error: "bad room" }, 400);
    const text = JSON.stringify(room); if (text.length > 20000) return json({ error: "too big" }, 413);
    const saved = { ...room, saved: Date.now() };
    // KV removes the room by itself once it expires (at least a minute from now)
    const expiration = Math.max(Math.floor(expiresAt(saved) / 1000), Math.floor(Date.now() / 1000) + 120);
    await kv.put(room.id, JSON.stringify(saved), { expiration });
    return json({ ok: true, id: room.id });
  }
  if (request.method === "DELETE") {
    const id = new URL(request.url).searchParams.get("id");
    if (!okId(id)) return json({ error: "bad id" }, 400);
    await kv.delete(id);
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
}
