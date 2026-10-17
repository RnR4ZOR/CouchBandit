// Couchside stream relay: /api/stream?url=<video or playlist link>
// Lets the room player load streams the browser can't fetch directly: plain http:// links on the
// secure site, servers that don't allow other sites (no CORS), and hosts that only serve their own pages.
// HLS playlists are rewritten so every segment, key and sub-playlist also goes through the relay.
import { safeUrl } from "../../lib/videos.js";

const CHUNK = 8 * 1024 * 1024; // serve big files in pieces the player asks for in turn
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "range", "access-control-expose-headers": "content-length, content-range, accept-ranges" };

const isPlaylist = (type, url) => /mpegurl/i.test(type) || /\.m3u8($|\?)/i.test(url);

export async function onRequest({ request: req }) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const self = new URL(req.url);
  const target = safeUrl(self.searchParams.get("url") || "");
  if (!target) return new Response("That link can't be relayed.", { status: 400, headers: CORS });

  // Open-ended ranges ("bytes=0-") are capped so big files arrive in pieces the player asks for in turn
  let range = req.headers.get("range");
  const m = range && range.match(/^bytes=(\d+)-(\d*)$/);
  if (m && (!m[2] || +m[2] - +m[1] >= CHUNK)) range = `bytes=${m[1]}-${+m[1] + CHUNK - 1}`;

  const ref = safeUrl(self.searchParams.get("ref") || "") || target;
  let up, finalUrl = target.href;
  try {
    // follow redirects by hand so they can't point the relay at private addresses
    let at = target;
    for (let hop = 0; ; hop++) {
      up = await fetch(at.href, { redirect: "manual", headers: { "user-agent": UA, accept: "*/*", referer: ref.origin + "/", origin: ref.origin, ...(range ? { range } : {}) } });
      const next = up.status >= 300 && up.status < 400 && up.headers.get("location");
      if (!next) break;
      at = safeUrl(new URL(next, at.href).href);
      if (!at || hop >= 5) return new Response("That link redirects somewhere it can't be relayed.", { status: 400, headers: CORS });
    }
    finalUrl = at.href;
  } catch (e) {
    return new Response("The stream didn't answer.", { status: 502, headers: CORS });
  }
  const type = up.headers.get("content-type") || "";
  if (/text\/html/i.test(type)) return new Response("That link is a web page, not a video.", { status: 415, headers: CORS });

  if (up.ok && isPlaylist(type, finalUrl)) {
    const base = finalUrl;
    const via = u => { try { const abs = new URL(u, base).href; return `${self.pathname}?url=${encodeURIComponent(abs)}${ref !== target ? "&ref=" + encodeURIComponent(ref.href) : ""}`; } catch (e) { return u; } };
    const text = (await up.text()).split(/\r?\n/).map(line => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${via(u)}"`);
      return via(t);
    }).join("\n");
    return new Response(text, { status: 200, headers: { ...CORS, "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-cache" } });
  }

  const headers = { ...CORS, "content-type": type || "application/octet-stream", "cache-control": "no-cache" };
  for (const h of ["content-length", "content-range", "accept-ranges"]) { const v = up.headers.get(h); if (v) headers[h] = v; }
  return new Response(up.body, { status: up.status, headers });
}
