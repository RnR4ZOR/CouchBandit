// POST /api/sync {rooms:[...]} from the event sync job (tools/events-sync.mjs).
// Adds new event rooms, updates times/titles/backups of existing auto rooms (keeping the owner's stars and edits to
// manual rooms), never re-adds an auto room the owner deleted, and clears auto rooms 30 days after they start.
// Auth: header x-sync-key = SYNC_KEY (or OWNER_PASS if SYNC_KEY isn't set).
import { json } from "./_auth.js";
import { KEY, SKIP_KEY, clean } from "./_rooms.js";

const same = (a, b) => { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  const kv = env.ROOMS, secret = env.SYNC_KEY || env.OWNER_PASS;
  if (!kv || !secret) return json({ error: "Room storage or owner login isn't set up." }, 503);
  if (!same(request.headers.get("x-sync-key") || "", secret)) { await new Promise(r => setTimeout(r, 400)); return json({ error: "bad key" }, 401); }
  let body; try { body = await request.json(); } catch { return json({ error: "bad body" }, 400); }
  const incoming = clean((body.rooms || []).map(r => ({ ...r, auto: true })));
  const skip = new Set((await kv.get(SKIP_KEY, "json")) || []);
  const list = clean((await kv.get(KEY, "json")) || []);
  const byId = new Map(list.map(r => [r.id, r]));
  let added = 0, updated = 0;
  for (const r of incoming) {
    if (skip.has(r.id)) continue;
    const old = byId.get(r.id);
    if (!old) { list.push({ ...r, created: Date.now() }); added++; }
    else if (old.auto) {
      Object.assign(old, { name: r.name, topic: r.topic, start: r.start, cat: r.cat });
      if (!r.draft) { old.items = r.items; delete old.draft; } // a draft never wipes links already found
      updated++;
    }
  }
  const cutoff = Date.now() - 30 * 24 * 3600e3;
  const stale = Date.now() - 12 * 3600e3; // drafts that never got links are cleared 12 hours after they start
  const kept = list.filter(r => !(r.auto && r.start && new Date(r.start).getTime() < (r.draft ? stale : cutoff)));
  await kv.put(KEY, JSON.stringify(clean(kept)));
  return json({ ok: true, added, updated, removedOld: list.length - kept.length, total: kept.length });
}
