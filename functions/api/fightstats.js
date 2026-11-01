// Live fight stats: /api/fightstats
// Finds the UFC fight that is live right now on ESPN's public scoreboard and returns both fighters' running totals
// (strikes, takedowns, knockdowns, control time) plus the round and clock.
// Spoiler-safe: live fights come back without results. A past event's results (?date=) are only fetched when the
// viewer asks, and the page keeps them behind a tap-to-reveal cover.
const headers = { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" };
const SB = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard";
const CORE = "https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc/events";
const get = async (url, ttl) => {
  const r = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(r.status);
  return r.json();
};
const PICK = ["sigStrikesLanded", "sigStrikesAttempted", "totalStrikesLanded", "knockDowns", "takedownsLanded", "takedownsAttempted", "submissions", "timeInControl"];

async function statsFor(evId, compId, athId) {
  try {
    const j = await get(`${CORE}/${evId}/competitions/${compId}/competitors/${athId}/statistics`, 15);
    const all = (j.splits?.categories || []).flatMap(c => c.stats || []);
    return Object.fromEntries(PICK.map(n => [n, all.find(s => s.name === n)?.displayValue ?? ""]));
  } catch { return null; }
}


// ===== UFC's official stats (UFCStats.com): the finished card with method, round, time and per-fight totals.
// One page per event, read server-side and cached; ESPN is the fallback if it can't be read.
const UFCSTATS = "http://ufcstats.com/statistics/events/completed";
const txt = h => h.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const getText = async (url, ttl) => {
  const r = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true }, headers: { "user-agent": "Mozilla/5.0 CouchBandit" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(r.status);
  return r.text();
};
async function ufcOfficial(date) {
  const want = Date.parse(date + "T12:00:00Z"), list = await getText(UFCSTATS, 1800);
  let link = "", name = "";
  for (const m of list.matchAll(/href="(http:\/\/ufcstats\.com\/event-details\/[0-9a-f]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?b-statistics__date[^>]*>([\s\S]*?)<\/span>/g)) {
    const t = Date.parse(txt(m[3]) + " 12:00 UTC");
    if (!isNaN(t) && Math.abs(t - want) <= 36 * 3600e3) { link = m[1]; name = txt(m[2]); break; }
  }
  if (!link) return null;
  const page = await getText(link, 1800), fights = [];
  for (const row of page.split(/<tr[^>]*b-fight-details__table-row/).slice(1)) {
    if (!/fight-details\//.test(row)) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => [...c[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(p => txt(p[1])));
    if (cells.length < 10 || cells[1].length < 2) continue;
    const flag = (cells[0][0] || "").toLowerCase(), two = i => [cells[i][0] || "", cells[i][1] || ""];
    const [kd, st, td, sub] = [2, 3, 4, 5].map(two);
    const stats = k => ({ knockDowns: kd[k], sigStrikesLanded: st[k], takedownsLanded: td[k], submissions: sub[k] });
    fights.push({ a: { name: cells[1][0], winner: flag === "win" }, b: { name: cells[1][1], winner: false },
      method: cells[7].filter(Boolean).join(" · "), round: +cells[8][0] || 0, clock: cells[9][0] || "",
      weight: cells[6][0] || "", stats: [stats(0), stats(1)] });
  }
  return fights.length ? { event: name, source: "UFC official stats", fights: fights.reverse() } : null;
}

const out = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const side = x => ({ id: x.id, name: x.athlete?.displayName || "", winner: !!x.winner });

export async function onRequest({ request }) {
  const q = new URL(request.url).searchParams;
  try {
    // One finished fight's final totals, asked for only after the viewer chose to see results
    if (q.get("comp")) {
      const ev = q.get("ev"), comp = q.get("comp"), ids = [q.get("a"), q.get("b")];
      if (![ev, comp, ...ids].every(v => /^\d{1,12}$/.test(v || ""))) return out({ error: "bad ids" }, 400);
      return out({ stats: await Promise.all(ids.map(id => statsFor(ev, comp, id))) });
    }
    const sb = await get(SB, 15);
    for (const ev of sb.events || []) {
      for (const c of ev.competitions || []) {
        const st = c.status || {};
        if ((st.type || {}).state !== "in") continue; // live fights only here
        const sides = (c.competitors || []).slice(0, 2);
        const stats = await Promise.all(sides.map(x => statsFor(ev.id, c.id, x.id)));
        return out({
          live: true, event: ev.name || "", round: st.period || 0, clock: st.displayClock || "",
          detail: (st.type || {}).shortDetail || "",
          fighters: sides.map((x, i) => ({ name: x.athlete?.displayName || "", stats: stats[i] }))
        });
      }
    }
    // Nothing live: for a past event (date = the room's US event date) send the finished card, earliest fight first,
    // from UFC's official stats when they can be read, else ESPN.
    // The page keeps it behind a spoiler cover until the viewer taps to reveal.
    const date = q.get("date") || "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      try { const off = await ufcOfficial(date); if (off) return out({ live: false, results: off }); } catch (e) {}
      const d = date.replace(/-/g, ""), j = await get(`${SB}?dates=${d}`, 300);
      const ev = (j.events || []).find(e => (e.competitions || []).some(c => (c.status?.type || {}).state === "post"));
      if (ev) return out({ live: false, results: { event: ev.name || "", ev: ev.id, source: "ESPN",
        fights: (ev.competitions || []).filter(c => (c.status?.type || {}).state === "post").map(c => {
          const [a, b] = (c.competitors || []).map(side);
          return { comp: c.id, a, b, round: c.status?.period || 0, clock: c.status?.displayClock || "" };
        }).filter(f => f.a && f.b) } });
    }
    return out({ live: false });
  } catch (e) {
    return out({ live: false, error: "Stats feed unavailable" });
  }
}
