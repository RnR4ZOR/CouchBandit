// Shared room-list helpers for /api/rooms and /api/sync.
export const KEY = "room-list";
export const SKIP_KEY = "auto-skip"; // auto event rooms the owner deleted, so the sync never re-adds them
export const MAX_AUTO_BACKUPS = 5;
const CATS = /^[\w &+-]{1,24}$/;

export const clean = list => (Array.isArray(list) ? list : []).filter(r => r && typeof r.id === "string" && /^[a-z0-9]{4,16}$/.test(r.id) && Array.isArray(r.items) && r.items.length)
  .slice(0, 300).map(r => ({
    id: r.id, created: +r.created || Date.now(), featured: !!r.featured,
    ...(r.auto ? { auto: true } : {}), ...(CATS.test(r.cat || "") ? { cat: r.cat } : {}),
    name: String(r.name || "Room").slice(0, 60), topic: String(r.topic || "").slice(0, 80), start: String(r.start || "").slice(0, 20),
    items: r.items.slice(0, 30).map((it, j) => ({
      title: String(it.title || "Stream " + (j + 1)).slice(0, 60),
      url: String(it.url || "").slice(0, 2000),
      backups: (Array.isArray(it.backups) ? it.backups : []).slice(0, r.auto ? MAX_AUTO_BACKUPS : 15).map(u => String(u).slice(0, 2000))
    })).filter(it => /^https?:\/\//i.test(it.url))
  })).filter(r => r.items.length);
