// Couch Bandit event sync: finds scheduled/live streams on official YouTube channels (tools/channels.json),
// turns each into a room with its category, start time and up to 5 backups of the same event,
// and sends them to the site (/api/sync). Run by .github/workflows/events-sync.yml every 3 hours.
//
// Env: SITE (e.g. https://couchbandit.pages.dev), SYNC_KEY (the master code), YT_API_KEY (optional, more reliable).
// DRY=1 prints the rooms instead of sending them.
import { readFile } from "node:fs/promises";

let cfg = JSON.parse(await readFile(new URL("./channels.json", import.meta.url), "utf8"));
// The owner's approved list (edited on the site's Sources page) wins over channels.json when it's been saved
try {
  const live = await (await fetch((process.env.SITE || "").replace(/\/+$/, "") + "/api/sources", { signal: AbortSignal.timeout(10000) })).json();
  if (live && live.categories && Object.keys(live.categories).length) {
    cfg = { days_ahead: live.days_ahead, skip_titles: live.skip_titles || cfg.skip_titles,
      categories: Object.fromEntries(Object.entries(live.categories).map(([c, v]) => [c, (v.channels || []).map(h => ({ handle: h, alts: v.alts || [] }))])) };
    console.log("Using the approved sources list from the site.");
  }
} catch (e) { console.log("Using tools/channels.json (site sources not available)."); }
const KEY = process.env.YT_API_KEY || "";
const DAYS = cfg.days_ahead || 14, MAX_BACKUPS = 5, HOUR = 3600e3;
const SKIP = cfg.skip_titles ? new RegExp(cfg.skip_titles, "i") : null;
const UA = { "user-agent": "Mozilla/5.0 (CouchBandit event sync)", "accept-language": "en-AU,en;q=0.8", cookie: "CONSENT=YES+1" };
const log = (...a) => console.log(...a);

async function get(url, type = "text") {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(r.status + " " + url.replace(KEY, "KEY"));
  return type === "json" ? r.json() : r.text();
}
const api = (path, q) => get(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...q, key: KEY })}`, "json");

async function channelId(handle) {
  if (/^UC[\w-]{22}$/.test(handle)) return { id: handle, name: handle };
  if (KEY) {
    const j = await api("channels", { part: "snippet", forHandle: handle });
    if (j.items?.[0]) return { id: j.items[0].id, name: j.items[0].snippet.title };
  }
  const html = await get("https://www.youtube.com/" + handle);
  const id = (html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/) || [])[1];
  const name = (html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] || handle;
  if (!id) throw new Error("not found");
  return { id, name };
}

// Recent upload ids (scheduled streams sit at the top of a channel's uploads)
async function recentIds(cid) {
  if (KEY) {
    const j = await api("playlistItems", { part: "contentDetails", playlistId: "UU" + cid.slice(2), maxResults: 15 });
    return (j.items || []).map(i => i.contentDetails.videoId);
  }
  const xml = await get("https://www.youtube.com/feeds/videos.xml?channel_id=" + cid);
  return [...xml.matchAll(/<yt:videoId>([\w-]{11})<\/yt:videoId>/g)].map(m => m[1]).slice(0, 15);
}

// { id, title, start, live } for videos that are scheduled or live
async function liveInfo(ids) {
  if (!ids.length) return [];
  if (KEY) {
    const j = await api("videos", { part: "snippet,liveStreamingDetails", id: ids.join(",") });
    return (j.items || []).filter(v => v.liveStreamingDetails && !v.liveStreamingDetails.actualEndTime && v.snippet.liveBroadcastContent !== "none")
      .map(v => ({ id: v.id, title: v.snippet.title, start: v.liveStreamingDetails.actualStartTime || v.liveStreamingDetails.scheduledStartTime, live: v.snippet.liveBroadcastContent === "live" }));
  }
  const out = [];
  for (const id of ids) {
    try {
      const html = await get("https://www.youtube.com/watch?v=" + id);
      const d = (html.match(/"liveBroadcastDetails":\{([^}]*)\}/) || [])[1];
      if (!d || /"endTimestamp"/.test(d)) continue;
      const start = (d.match(/"startTimestamp":"([^"]+)"/) || [])[1];
      const title = JSON.parse('"' + ((html.match(/"videoDetails":\{"videoId":"[\w-]{11}","title":"((?:[^"\\]|\\.)*)"/) || [])[1] || "Live stream") + '"');
      if (start) out.push({ id, title, start, live: /"isLiveNow":true/.test(d) });
    } catch (e) {}
  }
  return out;
}

const words = t => new Set(String(t).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2));
const alike = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, Math.min(A.size, B.size)) >= 0.5; };
const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h.toString(36); };
const iso = t => new Date(t).toISOString().slice(0, 19) + "Z";

const roomOf = e => ({ id: "a" + hash(e.id).slice(0, 12), auto: true, cat: e.cat, name: e.title.slice(0, 60), topic: `${e.cat} · ${e.channel}`.slice(0, 80), start: iso(e.start),
  items: [{ title: e.channel.slice(0, 60), url: "https://www.youtube.com/watch?v=" + e.id, backups: e.alts.slice(0, MAX_BACKUPS) }] });
const found = [], misses = [], official = new Map(); // channelId -> {cat, name, alts}
for (const [cat, chans] of Object.entries(cfg.categories)) {
  for (const ch of chans) {
    try {
      const c = await channelId(ch.handle); official.set(c.id, { cat, name: c.name, alts: ch.alts || [] });
      const evs = (await liveInfo(await recentIds(c.id)))
        .filter(e => !(SKIP && SKIP.test(e.title)))
        .filter(e => { const t = new Date(e.start).getTime(); return e.live || (t > Date.now() - 6 * HOUR && t < Date.now() + DAYS * 24 * HOUR); });
      for (const e of evs) found.push({ ...e, cat, channel: c.name, alts: ch.alts || [] });
      log(`${cat} · ${c.name}: ${evs.length} scheduled`);
    } catch (e) { misses.push(`${cat} ${ch.handle}: ${e.message}`); }
  }
}

// Same event on several channels (same category, within 2 hours, similar title) -> one room, others as backups
const rooms = [];
for (const e of found.sort((a, b) => new Date(a.start) - new Date(b.start))) {
  const url = "https://www.youtube.com/watch?v=" + e.id;
  const r = rooms.find(r => r.cat === e.cat && Math.abs(new Date(r.start) - new Date(e.start)) < 2 * HOUR && alike(r.name, e.title));
  if (r) { const b = r.items[0].backups; if (b.length < MAX_BACKUPS && !b.includes(url)) b.push(url); continue; }
  rooms.push(roomOf(e));
}
for (const r of rooms) r.items[0].backups = r.items[0].backups.slice(0, MAX_BACKUPS);

// ===== Schedule: every UFC, ONE and Boxing event, AFL / NBA / NFL game and ATP / WTA tournament in the next 7 days =====
// Events with no official stream yet become draft rooms: named, timed and categorised, with empty stream slots the owner
// fills in. Drafts are only shown to the owner until links are added. An event that already has an official stream
// room above isn't drafted twice.
const SCHED_DAYS = 7;
const SCHED = [["UFC", "mma/ufc"], ["AFL", "australian-football/afl"], ["NBA", "basketball/nba"], ["NFL", "football/nfl"]];
const ymd = t => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
let drafts = 0;
for (const [cat, path] of SCHED) {
  try {
    const j = await get(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${ymd(Date.now())}-${ymd(Date.now() + SCHED_DAYS * 24 * HOUR)}&limit=200`, "json");
    let n = 0;
    for (const ev of j.events || []) {
      const c0 = (ev.competitions || [])[0] || {}, start = ev.date || c0.date, t = new Date(start).getTime();
      if (isNaN(t) || t < Date.now() - 3 * HOUR || t > Date.now() + SCHED_DAYS * 24 * HOUR || (ev.status?.type?.state || c0.status?.type?.state) === "post") continue;
      const fights = cat === "UFC";
      const side = k => (c0.competitors || []).find(x => x.homeAway === k)?.team?.displayName;
      const name = (fights ? ev.name : side("away") && side("home") ? `${side("away")} v ${side("home")}` : ev.name || ev.shortName || cat + " game").slice(0, 60);
      if (rooms.some(r => r.cat === cat && Math.abs(new Date(r.start) - t) < 6 * HOUR && alike(r.name, name))) continue;
      const venue = c0.venue?.fullName || c0.venue?.address?.city || "";
      rooms.push({ id: "s" + hash(cat + ev.id).slice(0, 12), auto: true, draft: true, cat, name, topic: [cat, venue].filter(Boolean).join(" · ").slice(0, 80), start: iso(t),
        items: (fights ? ["Main card", "Prelims"] : ["Full game"]).map(title => ({ title, url: "", backups: [] })) });
      n++;
    }
    drafts += n; log(`Schedule · ${cat}: ${n} upcoming without a stream yet`);
  } catch (e) { misses.push(`Schedule ${cat}: ${e.message}`); }
}
// Tennis (ESPN): one room per ATP/WTA tournament running in the next 7 days. While it's on, its start rolls forward to
// today so the draft isn't cleared mid-tournament; it drops off after the final.
for (const tour of ["atp", "wta"]) {
  try {
    const j = await get(`https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/scoreboard?dates=${ymd(Date.now())}-${ymd(Date.now() + SCHED_DAYS * 24 * HOUR)}`, "json");
    let n = 0;
    for (const ev of j.events || []) {
      const s = new Date(ev.date).getTime(), end = new Date(ev.endDate || ev.date).getTime();
      if (isNaN(s) || end < Date.now() || s > Date.now() + SCHED_DAYS * 24 * HOUR) continue;
      const name = `${ev.name || ev.shortName} (${tour.toUpperCase()})`.slice(0, 60);
      if (rooms.some(r => r.cat === "Tennis" && alike(r.name, name))) continue;
      const venue = ev.groupings?.[0]?.competitions?.[0]?.venue?.address?.city || "";
      rooms.push({ id: "s" + hash("Tennis" + tour + ev.id).slice(0, 12), auto: true, draft: true, cat: "Tennis", name,
        topic: ["Tennis", tour.toUpperCase(), venue].filter(Boolean).join(" · ").slice(0, 80), start: iso(Math.max(s, Date.now() - HOUR)),
        items: ["Centre court", "Outside courts"].map(title => ({ title, url: "", backups: [] })) });
      n++;
    }
    drafts += n; log(`Schedule · Tennis ${tour.toUpperCase()}: ${n} tournaments`);
  } catch (e) { misses.push(`Schedule Tennis ${tour}: ${e.message}`); }
}

// ONE and Boxing (TheSportsDB). The free key only returns the next event per league; a SPORTSDB_KEY returns more.
for (const [cat, league] of [["ONE", 4495], ["Boxing", 4445]]) {
  try {
    const j = await get(`https://www.thesportsdb.com/api/v1/json/${process.env.SPORTSDB_KEY || "123"}/eventsnextleague.php?id=${league}`, "json");
    let n = 0;
    for (const ev of j.events || []) {
      const ts = ev.strTimestamp || (ev.dateEvent && `${ev.dateEvent}T${ev.strTime || "00:00:00"}`);
      const t = ts ? new Date(ts + (/Z|[+-]\d\d:?\d\d$/.test(ts) ? "" : "Z")).getTime() : NaN;
      if (isNaN(t) || t < Date.now() - 3 * HOUR || t > Date.now() + SCHED_DAYS * 24 * HOUR) continue;
      const name = String(ev.strEvent || cat + " event").slice(0, 60);
      if (rooms.some(r => r.cat === cat && Math.abs(new Date(r.start) - t) < 12 * HOUR && alike(r.name, name))) continue;
      const venue = [ev.strVenue, ev.strCity].filter(Boolean).join(", ");
      rooms.push({ id: "s" + hash(cat + ev.idEvent).slice(0, 12), auto: true, draft: true, cat, name, topic: [cat, venue].filter(Boolean).join(" · ").slice(0, 80), start: iso(t),
        items: ["Main card", "Prelims"].map(title => ({ title, url: "", backups: [] })) });
      n++;
    }
    drafts += n; log(`Schedule · ${cat}: ${n} upcoming`);
  } catch (e) { misses.push(`Schedule ${cat}: ${e.message}`); }
}
log(`${drafts} draft rooms ready for links.`);

log(`\n${rooms.length} event rooms from ${found.length} streams.`);
if (misses.length) log("Channels that couldn't be read (check the handle in tools/channels.json):\n  " + misses.join("\n  "));
if (process.env.DRY) { log(JSON.stringify(rooms, null, 2)); process.exit(0); }

const site = (process.env.SITE || "").replace(/\/+$/, "");
if (!site || !process.env.SYNC_KEY) { log("SITE or SYNC_KEY missing, not sending."); process.exit(1); }
const hdr = { "content-type": "application/json", "x-sync-key": process.env.SYNC_KEY };

// ===== Event requests from visitors: official sources only =====
// 1) match against what the official channels already have scheduled, 2) with a YouTube key, search YouTube and keep
// results from the official channel list only, 3) look up the event's details (name, date/time, venue) on TheSportsDB.
const SPORTSDB = process.env.SPORTSDB_KEY || "123";
const catGuess = (...t) => { const s = t.join(" ").toLowerCase();
  return /\bufc\b/.test(s) ? "UFC" : /\bone (championship|friday|fight)|\bone \d/.test(s) ? "ONE" : /boxing|matchroom|top rank|golden boy|queensberry/.test(s) ? "Boxing"
    : /\bafl\b|aussie rules|australian football/.test(s) ? "AFL" : /\bnba\b|basketball/.test(s) ? "NBA" : /\bnfl\b|american football/.test(s) ? "NFL" : /tennis|\batp\b|\bwta\b|open/.test(s) ? "Tennis" : ""; };
async function eventInfo(q) {
  try {
    const j = await get(`https://www.thesportsdb.com/api/v1/json/${SPORTSDB}/searchevents.php?e=${encodeURIComponent(q.replace(/\s+/g, "_"))}`, "json");
    const evs = (j.event || []).filter(e => e.strTimestamp).map(e => ({ e, t: new Date(e.strTimestamp + (/Z|[+-]\d\d:?\d\d$/.test(e.strTimestamp) ? "" : "Z")).getTime() })).filter(x => !isNaN(x.t));
    if (!evs.length) return null;
    const up = evs.filter(x => x.t > Date.now() - 12 * HOUR).sort((a, b) => a.t - b.t);
    const { e, t } = up[0] || evs.sort((a, b) => b.t - a.t)[0];
    return { name: e.strEvent, start: iso(t), cat: catGuess(e.strLeague, e.strSport, e.strEvent), venue: [e.strVenue, e.strCity, e.strCountry].filter(Boolean).join(", "), league: e.strLeague || "", source: "TheSportsDB" };
  } catch (err) { return null; }
}
async function officialSearch(q) {
  if (!KEY) return [];
  const out = [];
  for (const type of ["upcoming", "live"]) {
    try {
      const j = await api("search", { part: "snippet", q, type: "video", eventType: type, maxResults: 25 });
      for (const it of j.items || []) { const o = official.get(it.snippet.channelId); if (o) out.push({ id: it.id.videoId, title: it.snippet.title, channel: o.name, cat: o.cat, alts: o.alts }); }
    } catch (err) {}
  }
  if (!out.length) return [];
  const det = new Map((await liveInfo(out.map(o => o.id))).map(d => [d.id, d]));
  return out.filter(o => det.has(o.id)).map(o => ({ ...o, start: det.get(o.id).start }));
}
try {
  const all = await (await fetch(site + "/api/requests", { headers: hdr })).json();
  const due = (Array.isArray(all) ? all : []).filter(r => r.status === "new" || (["info", "none"].includes(r.status) && Date.now() - r.created < 7 * 24 * HOUR && Date.now() - (r.checked || 0) > 6 * HOUR)).slice(0, 3);
  for (const r of due) {
    const info = await eventInfo(r.text);
    const cat = r.cat || info?.cat || catGuess(r.text);
    const near = s => !info?.start || Math.abs(new Date(s) - new Date(info.start)) < 36 * HOUR;
    const pool = [...found, ...(await officialSearch(r.text))];
    const hits = pool.filter(e => (alike(r.text, e.title) || (info && alike(info.name, e.title))) && (!cat || e.cat === cat) && near(e.start));
    let draft = null;
    if (hits.length) {
      const seen = new Set(); const uniq = hits.filter(h => !seen.has(h.id) && seen.add(h.id));
      draft = roomOf(uniq[0]); draft.items[0].backups = [...uniq.slice(1).map(h => "https://www.youtube.com/watch?v=" + h.id), ...draft.items[0].backups].slice(0, MAX_BACKUPS);
      if (info?.name) draft.name = info.name.slice(0, 60);
    }
    const status = draft ? "found" : info ? "info" : "none";
    const note = draft ? `Official stream found on ${draft.topic.split(" · ")[1]}${draft.items[0].backups.length ? ` + ${draft.items[0].backups.length} backup(s)` : ""}.`
      : info ? "Event details found. No free official stream yet, will keep checking for 7 days." : "Couldn't find this event yet. Check the name or add more detail.";
    await fetch(site + "/api/requests", { method: "PATCH", headers: hdr, body: JSON.stringify({ id: r.id, status, note, info: info || (cat ? { name: r.text, cat } : null), draft }) });
    log(`Request "${r.text}": ${status}`);
  }
} catch (err) { log("Requests step skipped:", err.message); }
const res = await fetch(site + "/api/sync", { method: "POST", headers: hdr, body: JSON.stringify({ rooms }) });
log("Site says:", res.status, await res.text());
if (!res.ok) process.exit(1);
