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
    // Nothing live: for a past event (date = the room's US event date) send the finished card.
    // The page keeps it behind a spoiler cover until the viewer taps to reveal.
    const date = q.get("date") || "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const d = date.replace(/-/g, ""), j = await get(`${SB}?dates=${d}`, 300);
      const ev = (j.events || []).find(e => (e.competitions || []).some(c => (c.status?.type || {}).state === "post"));
      if (ev) return out({ live: false, results: { event: ev.name || "", ev: ev.id,
        fights: (ev.competitions || []).filter(c => (c.status?.type || {}).state === "post").reverse().map(c => {
          const [a, b] = (c.competitors || []).map(side);
          return { comp: c.id, a, b, round: c.status?.period || 0, clock: c.status?.displayClock || "" };
        }).filter(f => f.a && f.b) } });
    }
    return out({ live: false });
  } catch (e) {
    return out({ live: false, error: "Stats feed unavailable" });
  }
}
