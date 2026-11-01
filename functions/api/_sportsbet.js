// Live UFC fight times from Sportsbet. Every bout is read on its own: each fight link (…/betting/ufc-mma/<card>/<a>-v-<b>-<id>)
// carries that bout's time and a LIVE flag. Sportsbet moves the times as the night runs long or short, so this is a better
// clock than the scheduled card. The hub plus the Main Card, Prelims and UFC Matches lists are read together so no bout is
// missed. Only names, times and LIVE are used: no odds, and finished bouts drop off, so no results.
// Times on the page are Sydney/Melbourne time (AEST/AEDT) and are turned into real ISO times. Any failure returns [] and
// the card falls back to the ESPN schedule.
const BASE = "https://www.sportsbet.com.au/betting/ufc-mma";
const PAGES = ["", "/ufc-main-card", "/ufc-prelims", "/ufc-matches"];
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Sydney wall clock -> ISO, using the real Sydney offset for that day.
function sydney(y, m, d, hh, mm) {
  const guess = Date.UTC(y, m, d, hh, mm);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
    .formatToParts(guess).map(x => [x.type, +x.value]));
  return new Date(guess - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess)).toISOString();
}
function sydDay(add = 0) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(Date.now() + add * 864e5).map(x => [x.type, +x.value]));
  return [p.year, p.month - 1, p.day];
}
const txt = h => h.replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&").replace(/&#x27;|&#39;|&rsquo;/g, "'").replace(/&nbsp;/g, " ")
  .split("\n").map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
const title = s => s.split("-").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ").replace(/\bUfc\b/g, "UFC");

export function parse(html) {
  // Day headings ("Today, 1 Nov", "Tomorrow, 2 Nov", "Sunday, 15 Nov") with where they sit on the page.
  const heads = [];
  for (const m of html.matchAll(/>\s*(Today|Tomorrow|[A-Z][a-z]+day),?\s+(\d{1,2})\s+([A-Z][a-z]{2})[a-z]*\.?\s*</g)) {
    const mo = MON[m[3].toLowerCase()]; if (mo === undefined) continue;
    const [ty, tm] = sydDay();
    heads.push({ at: m.index, day: m[1] === "Today" ? sydDay() : m[1] === "Tomorrow" ? sydDay(1) : [ty + (mo < tm - 6 ? 1 : 0), mo, +m[2]] });
  }
  const out = [];
  const re = /<a\b[^>]*href="(?:https:\/\/www\.sportsbet\.com\.au)?\/betting\/ufc-mma\/([a-z0-9-]+)\/([a-z0-9-]+?)-v-([a-z0-9-]+?)-(\d{6,})"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const [, card, sa, sb, id, inner] = m, lines = txt(inner);
    const t = lines.join(" ").match(/\b(\d{1,2}):(\d{2})\b/); if (!t) continue;
    const live = lines.some(l => /^live\b/i.test(l));
    // Names: the text left after the time, LIVE, card name and market count; else the link's slug.
    const names = lines.filter(l => !/\d{1,2}:\d{2}|^live$|^\|$|markets?$|^ufc\b|^v$/i.test(l) && /[a-z]{2}/i.test(l) && l.length <= 40);
    const h = heads.filter(x => x.at < m.index).pop(), day = h ? h.day : sydDay();
    out.push({ id, card: title(card), a: names.length === 2 ? names[0] : title(sa), b: names.length === 2 ? names[1] : title(sb), start: sydney(day[0], day[1], day[2], +t[1], +t[2]), live });
  }
  return out;
}

export async function sportsbetUfc() {
  const pages = await Promise.allSettled(PAGES.map(p => fetch(BASE + p, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; CouchBandit/1.0)", accept: "text/html", "accept-language": "en-AU" },
    cf: { cacheTtl: 60, cacheEverything: true }, signal: AbortSignal.timeout(6000)
  }).then(r => r.ok ? r.text() : "")));
  // One entry per Sportsbet fight ID. The hub is read first and carries the LIVE flag; the card lists fill in the rest.
  const byId = new Map();
  for (const p of pages) if (p.status === "fulfilled" && p.value) for (const f of parse(p.value)) {
    const had = byId.get(f.id);
    byId.set(f.id, had ? { ...had, live: had.live || f.live } : f);
  }
  const now = Date.now();
  return [...byId.values()].filter(f => f.live || new Date(f.start) > now - 6 * 36e5).sort((x, y) => x.start.localeCompare(y.start)).slice(0, 40);
}

// Same bout? Compare surnames either way round ("C Durden" still matches "Cody Durden").
const last = n => String(n).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, " ").trim().split(/\s+/).pop();
export const sameFight = (sides, f) => {
  const s = sides.map(x => last(x.name)), t = [last(f.a), last(f.b)];
  return s.length === 2 && ((s[0] === t[0] && s[1] === t[1]) || (s[0] === t[1] && s[1] === t[0]));
};
