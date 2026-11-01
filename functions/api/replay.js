// Replay fight links: /api/replay?yt=<YouTube video id>
// When a YouTube live stream has finished, the same link plays the replay from the start of the broadcast. This finds when
// that broadcast started and ended, then gives each UFC bout that went LIVE inside it as seconds into the replay.
// Nothing is returned while the stream is still live. Only names and start points: no results.
import { LOG_KEY } from "./_fightlog.js";
const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
const LEAD = 90; // start a little early so the jump lands on the walkout, never mid-fight (the log is up to ~2 min late)
export async function onRequestGet({ request, env }) {
  const id = (new URL(request.url).searchParams.get("yt") || "").match(/^[\w-]{11}$/)?.[0];
  const out = (body, age) => new Response(JSON.stringify(body), { headers: { ...headers, "cache-control": `public, max-age=${age}` } });
  if (!id || !env.ROOMS) return out({ fights: [] }, 300);
  let d = null;
  try {
    const html = await (await fetch("https://www.youtube.com/watch?v=" + id, { headers: { "accept-language": "en" }, cf: { cacheTtl: 300, cacheEverything: true }, signal: AbortSignal.timeout(6000) })).text();
    const m = html.match(/"liveBroadcastDetails":(\{[^}]*\})/); if (m) d = JSON.parse(m[1]);
  } catch (e) {}
  if (!d || !d.startTimestamp) return out({ fights: [] }, 600);              // not a live broadcast
  if (d.isLiveNow || !d.endTimestamp) return out({ live: true, fights: [] }, 120); // still live: links come once it ends
  const s = Date.parse(d.startTimestamp), e = Date.parse(d.endTimestamp);
  const log = (await env.ROOMS.get(LOG_KEY, "json")) || [];
  const fights = log.filter(f => { const t = Date.parse(f.live); return t >= s && t <= e; })
    .sort((x, y) => x.live.localeCompare(y.live))
    .map(f => ({ a: f.a, b: f.b, card: f.card, at: Math.max(0, Math.round((Date.parse(f.live) - s) / 1000) - LEAD) }));
  return out({ live: false, fights }, 3600);
}
