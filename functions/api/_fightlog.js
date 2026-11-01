// Fight log: the moment each UFC bout was first seen LIVE on Sportsbet, kept in KV ("fight-log").
// Written during the event (Worker cron every 2 min, plus every viewer's Matchday refresh), read after it to put
// "jump to this fight" links on the replay. Only names and start moments are stored: never results.
import { sportsbetUfc } from "./_sportsbet.js";
export const LOG_KEY = "fight-log";
export async function logLive(env, fights) {
  const kv = env && env.ROOMS; if (!kv) return;
  const live = (fights || []).filter(f => f.live); if (!live.length) return;
  const log = (await kv.get(LOG_KEY, "json")) || [];
  const have = new Set(log.map(x => x.id)), now = new Date().toISOString();
  const add = live.filter(f => !have.has(f.id)).map(f => ({ id: f.id, a: f.a, b: f.b, card: f.card, live: now }));
  if (add.length) await kv.put(LOG_KEY, JSON.stringify([...log, ...add].slice(-400)));
}
// Cron: only touches Sportsbet while a UFC event is on (one cached ESPN check otherwise).
export async function cronLog(env) {
  try {
    const j = await (await fetch("https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard", { cf: { cacheTtl: 120 }, signal: AbortSignal.timeout(6000) })).json();
    const on = (j.events || []).some(ev => (ev.competitions || []).some(c => ((c.status || {}).type || {}).state === "in")
      || Math.abs(Date.now() - new Date(ev.date)) < 10 * 36e5);
    if (on) await logLive(env, await sportsbetUfc());
  } catch (e) {}
}
