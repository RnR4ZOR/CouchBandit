// Live fight stats: /api/fightstats
// Finds the UFC fight that is live right now on ESPN's public scoreboard and returns both fighters' running totals
// (strikes, takedowns, knockdowns, control time) plus the round and clock.
// Spoiler-safe: only a fight in progress is ever returned. Finished fights, winners and methods are never sent.
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

export async function onRequest() {
  try {
    const sb = await get(SB, 15);
    for (const ev of sb.events || []) {
      for (const c of ev.competitions || []) {
        const st = c.status || {};
        if ((st.type || {}).state !== "in") continue; // live fights only, never finished ones
        const sides = (c.competitors || []).slice(0, 2);
        const stats = await Promise.all(sides.map(x => statsFor(ev.id, c.id, x.id)));
        return new Response(JSON.stringify({
          live: true, event: ev.name || "", round: st.period || 0, clock: st.displayClock || "",
          detail: (st.type || {}).shortDetail || "",
          fighters: sides.map((x, i) => ({ name: x.athlete?.displayName || "", stats: stats[i] }))
        }), { headers });
      }
    }
    return new Response(JSON.stringify({ live: false }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ live: false, error: "Stats feed unavailable" }), { status: 200, headers });
  }
}
