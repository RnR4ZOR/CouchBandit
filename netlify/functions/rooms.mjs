// Couchside saved rooms: /.netlify/functions/rooms
// GET lists saved rooms, POST {room} saves one (room.id required), DELETE ?id= removes one.
import { getStore } from "@netlify/blobs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const HOUR = 3600e3;
// Delete 48 hours after the event ends (start + 6 h), or 48 hours after creation if there is no start time
const expiresAt = r => r.start && !isNaN(new Date(r.start)) ? new Date(r.start).getTime() + 54 * HOUR : (r.created || r.saved || 0) + 48 * HOUR;
const okId = id => typeof id === "string" && /^[a-z0-9]{6,16}$/.test(id);

export default async (req) => {
  const store = getStore({ name: "rooms", consistency: "strong" });
  if (req.method === "GET") {
    const { blobs } = await store.list();
    const all = (await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })))).filter(Boolean);
    const now = Date.now(), rooms = [];
    for (const r of all) { if (now > expiresAt(r)) await store.delete(r.id); else rooms.push(r); }
    rooms.sort((a, b) => (b.saved || 0) - (a.saved || 0));
    return json(rooms.slice(0, 100));
  }
  if (req.method === "POST") {
    let room; try { ({ room } = await req.json()); } catch { return json({ error: "bad body" }, 400); }
    if (!room || !okId(room.id) || !Array.isArray(room.items) || !room.items.length) return json({ error: "bad room" }, 400);
    const text = JSON.stringify(room); if (text.length > 20000) return json({ error: "too big" }, 413);
    await store.setJSON(room.id, { ...room, saved: Date.now() });
    return json({ ok: true, id: room.id });
  }
  if (req.method === "DELETE") {
    const id = new URL(req.url).searchParams.get("id");
    if (!okId(id)) return json({ error: "bad id" }, 400);
    await store.delete(id);
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
};
