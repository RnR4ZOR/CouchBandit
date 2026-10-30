// Event requests: /api/requests
// POST  {text, cat, when, extra}              anyone (5 an hour per visitor). Event details are filled in straight away
//                                             from TheSportsDB; the event sync then looks for an official stream.
// GET                                          anyone: the request board (owner/sync also see drafts)
// PATCH {id, status, note, info, draft}        owner or event sync: update one request
// DELETE ?id=                                  owner: remove a request
// status: new -> found (official stream drafted) | info (details found, no free official stream yet) | none
//         -> done (room made) | declined
import { isOwner, json } from "./_auth.js";
import { eventInfo, catFor } from "./_event-info.js";
import { clean } from "./_rooms.js";
const KEY = "requests";
const STATUS = ["new", "found", "info", "none", "done", "declined"];
const sameKey = (a, b) => { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };
const s = (v, n) => String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
const canManage = async (request, env) => (await isOwner(request, env)) || (!!(env.SYNC_KEY || env.OWNER_PASS) && sameKey(request.headers.get("x-sync-key") || "", env.SYNC_KEY || env.OWNER_PASS));
const cleanInfo = i => i && typeof i === "object" ? Object.fromEntries(["name", "start", "cat", "league", "venue", "source"].filter(k => i[k]).map(k => [k, s(i[k], 80)])) : null;

export async function onRequest({ request, env }) {
  const kv = env.ROOMS; if (!kv) return json({ error: "Storage isn't connected." }, 503);
  const list = (await kv.get(KEY, "json")) || [];
  const m = request.method;
  if (m === "GET") return json((await canManage(request, env)) ? list : list.map(({ extra, draft, ...r }) => r));
  if (m === "POST") {
    const ip = request.headers.get("cf-connecting-ip") || "x", rk = "rl:" + ip, n = +(await kv.get(rk)) || 0;
    if (n >= 5) return json({ error: "That's a lot of requests. Try again in an hour." }, 429);
    let b; try { b = await request.json(); } catch { return json({ error: "bad body" }, 400); }
    const text = s(b.text, 80); if (text.length < 3) return json({ error: "Name the event." }, 400);
    const dup = list.find(r => r.text.toLowerCase() === text.toLowerCase() && !["done", "declined"].includes(r.status));
    if (dup) return json({ ok: true, request: dup, duplicate: true });
    const when = s(b.when, 20), cat = s(b.cat, 24);
    const found = await eventInfo(text, env);
    const info = found || { name: text, cat: cat || catFor(text), start: when && !isNaN(new Date(when)) ? new Date(when).toISOString().slice(0, 19) + "Z" : "" };
    if (!info.cat) info.cat = cat;
    const r = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created: Date.now(), text, cat: cat || info.cat || "", extra: s(b.extra, 200), status: "new",
      note: found ? "Event details found. Checking official channels for a stream." : "Checking official channels for this event.", info: cleanInfo(info) };
    await kv.put(KEY, JSON.stringify([r, ...list].slice(0, 150)));
    await kv.put(rk, String(n + 1), { expirationTtl: 3600 });
    return json({ ok: true, request: r });
  }
  if (!(await canManage(request, env))) return json({ error: "Owner only." }, 401);
  if (m === "PATCH") {
    let u; try { u = await request.json(); } catch { return json({ error: "bad body" }, 400); }
    const r = list.find(x => x.id === u.id); if (!r) return json({ error: "not found" }, 404);
    if (STATUS.includes(u.status)) r.status = u.status;
    if (u.note) r.note = s(u.note, 200);
    if (u.info) r.info = { ...(r.info || {}), ...cleanInfo(u.info) };
    if ("draft" in u) r.draft = u.draft ? clean([{ ...u.draft, auto: true }])[0] || null : null;
    if (u.roomId) r.roomId = s(u.roomId, 16);
    r.checked = Date.now();
    await kv.put(KEY, JSON.stringify(list)); return json({ ok: true });
  }
  if (m === "DELETE") {
    const id = new URL(request.url).searchParams.get("id");
    await kv.put(KEY, JSON.stringify(list.filter(r => r.id !== id))); return json({ ok: true });
  }
  return json({ error: "method" }, 405);
}
