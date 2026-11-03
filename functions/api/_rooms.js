// Shared room-list helpers for /api/rooms and /api/sync.
export const KEY = "room-list";
export const SKIP_KEY = "auto-skip"; // auto event rooms the owner deleted, so the sync never re-adds them
export const MAX_AUTO_BACKUPS = 5;
const CATS = /^[\w &+-]{1,24}$/;

// Up to 600 rooms. If the list is ever over that, the furthest-away empty draft events go first; real rooms are never dropped.
const CAP = 600;
const capped = list => { if (list.length <= CAP) return list;
  const drop = new Set(list.filter(r => r.auto && r.draft).sort((a, b) => String(b.start).localeCompare(String(a.start))).slice(0, list.length - CAP).map(r => r.id));
  return list.filter(r => !drop.has(r.id)).slice(0, CAP); };
export const clean = list => capped((Array.isArray(list) ? list : []).filter(r => r && typeof r.id === "string" && /^[a-z0-9]{4,16}$/.test(r.id) && Array.isArray(r.items) && r.items.length))
  .map(r => ({ r, d: !!(r.auto && r.draft) })).map(({ r, d }) => ({
    id: r.id, created: +r.created || Date.now(), featured: !!r.featured,
    ...(r.auto ? { auto: true } : {}), ...(d ? { draft: true } : {}), ...(CATS.test(r.cat || "") ? { cat: r.cat } : {}),
    name: String(r.name || "Room").slice(0, 60), topic: String(r.topic || "").slice(0, 80), start: String(r.start || "").slice(0, 20),
    items: r.items.slice(0, 30).map((it, j) => ({
      title: String(it.title || "Stream " + (j + 1)).slice(0, 60),
      url: String(it.url || "").slice(0, 2000),
      backups: (Array.isArray(it.backups) ? it.backups : []).slice(0, r.auto ? MAX_AUTO_BACKUPS : 15).map(u => String(u).slice(0, 2000))
    })).filter(it => /^https?:\/\//i.test(it.url) || (d && it.url === ""))
  })).filter(r => r.items.length);
