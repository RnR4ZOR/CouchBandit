// Matchday: /api/matchday?cat=AFL
// Other games on now (or today) in that sport, plus the league ladder, from ESPN's public scoreboard and standings feeds.
// Combat sports (UFC) return the card only: fighter names and Live / Upcoming. Results are never sent, so nothing is spoiled.
// UFC bout times and the LIVE flag come from Sportsbet, bout by bout (live-adjusted), with ESPN's schedule as the fallback.
import { sportsbetUfc, sameFight } from "./_sportsbet.js";
const LEAGUES = {
  AFL: { path: "australian-football/afl", table: true },
  NBA: { path: "basketball/nba", table: true },
  NFL: { path: "football/nfl", table: true },
  UFC: { path: "mma/ufc", fights: true }
};
const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
const get = async (url, ttl) => { const r = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true }, signal: AbortSignal.timeout(6000) }); if (!r.ok) throw new Error(r.status); return r.json(); };
const stat = (e, n) => (e.stats || []).find(s => s.name === n)?.displayValue ?? "";

function games(j, fights) {
  const out = [];
  for (const ev of j.events || []) {
    for (const c of fights ? ev.competitions || [] : [(ev.competitions || [])[0]].filter(Boolean)) {
      const st = (c.status || ev.status || {}).type || {};
      const state = st.state === "in" ? "live" : st.state === "post" ? "done" : "soon";
      const sides = (c.competitors || []).map(x => ({ name: (x.team || x.athlete || {}).displayName || "", abbr: (x.team || {}).abbreviation || "", score: fights ? "" : String(x.score ?? "") }));
      /* fights: no winner, no method, no round it ended in */
      out.push({ event: fights ? ev.name || "" : "", start: c.date || ev.date || "", state, detail: fights ? (state === "live" ? "Live" : state === "done" ? "Finished" : "") : st.shortDetail || "", sides });
    }
  }
  return out.slice(0, 30);
}
function table(j) {
  const groups = j.children && j.children.length ? j.children : [j];
  return groups.map(g => ({ group: g.children ? "" : (g.name || g.abbreviation || ""), rows: ((g.standings || {}).entries || []).map(e => ({ team: e.team?.displayName || "", abbr: e.team?.abbreviation || "", p: stat(e, "gamesPlayed"), w: stat(e, "wins"), l: stat(e, "losses"), pts: stat(e, "points") || stat(e, "winPercent"), rank: +stat(e, "rank") || 0 })).sort((a, b) => (a.rank || 99) - (b.rank || 99) || (+b.pts || 0) - (+a.pts || 0)) })).filter(g => g.rows.length);
}

// Each bout on the card takes its own Sportsbet time; Sportsbet's LIVE wins over ESPN. Bouts only Sportsbet lists are added.
function withSportsbet(list, sb) {
  if (!sb.length) return list;
  const used = new Set();
  const out = list.map(x => {
    const f = sb.find(f => !used.has(f.id) && sameFight(x.sides, f)); if (!f) return x;
    used.add(f.id);
    const state = x.state === "done" ? "done" : f.live ? "live" : x.state;
    return { ...x, start: f.start, state, detail: state === "live" ? "Live" : x.detail, times: "sportsbet" };
  });
  for (const f of sb) if (!used.has(f.id)) out.push({ event: "UFC · " + f.card, start: f.start, state: f.live ? "live" : "soon", detail: f.live ? "Live" : "", sides: [{ name: f.a }, { name: f.b }], times: "sportsbet" });
  return out.sort((a, b) => String(a.start).localeCompare(String(b.start))).slice(0, 40);
}

export async function onRequestGet({ request }) {
  const cat = (new URL(request.url).searchParams.get("cat") || "").toUpperCase();
  const lg = LEAGUES[cat];
  if (!lg) return new Response(JSON.stringify({ cat, games: [], table: [] }), { headers: { ...headers, "cache-control": "public, max-age=3600" } });
  const base = "https://site.api.espn.com/apis";
  const [g, t] = await Promise.allSettled([
    get(`${base}/site/v2/sports/${lg.path}/scoreboard`, 60),
    lg.table ? get(`${base}/v2/sports/${lg.path}/standings`, 1800) : Promise.resolve(null)
  ]);
  const body = { cat, fights: !!lg.fights, games: g.status === "fulfilled" ? games(g.value, lg.fights) : [], table: t.status === "fulfilled" && t.value ? table(t.value) : [] };
  if (cat === "UFC") body.games = withSportsbet(body.games, await sportsbetUfc());
  return new Response(JSON.stringify(body), { headers: { ...headers, "cache-control": "public, max-age=60" } });
}
