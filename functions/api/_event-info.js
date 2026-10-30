// Fills in event details (official name, sport, start time, venue) from TheSportsDB's free public API.
const CAT = [[/ufc/i, "UFC"], [/\bone\b|one championship/i, "ONE"], [/box/i, "Boxing"], [/afl|australian football/i, "AFL"], [/nba|basketball/i, "NBA"], [/nfl|american football/i, "NFL"], [/atp|wta|tennis|open/i, "Tennis"]];
export const catFor = (...t) => { const s = t.filter(Boolean).join(" "); for (const [re, c] of CAT) if (re.test(s)) return c; return ""; };

export async function eventInfo(q, env) {
  try {
    const r = await fetch("https://www.thesportsdb.com/api/v1/json/" + (env?.SPORTSDB_KEY || "123") + "/searchevents.php?e=" + encodeURIComponent(String(q).trim().replace(/\s+/g, "_")), { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const list = ((await r.json()).event || []).filter(Boolean);
    if (!list.length) return null;
    const t = e => new Date((e.strTimestamp || (e.dateEvent + "T" + (e.strTime || "00:00:00"))).replace(/(Z|[+-]\d\d:?\d\d)?$/, "Z")).getTime();
    const soon = list.filter(e => t(e) > Date.now() - 2 * 864e5).sort((a, b) => t(a) - t(b));
    const e = soon[0] || list.sort((a, b) => t(b) - t(a))[0];
    const start = isNaN(t(e)) ? "" : new Date(t(e)).toISOString().slice(0, 19) + "Z";
    return { name: String(e.strEvent || q).slice(0, 60), league: String(e.strLeague || "").slice(0, 40), venue: [e.strVenue, e.strCity, e.strCountry].filter(Boolean).join(", ").slice(0, 80), start, cat: catFor(e.strLeague, e.strEvent, e.strSport) };
  } catch { return null; }
}
