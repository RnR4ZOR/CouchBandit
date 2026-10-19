// Shared helpers for Couchside's video finder and link checker.

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?f[cd])/i;
const UA = "Mozilla/5.0 (compatible; CouchsideChecker/1.0)";
const SKIP = /(googletagmanager|doubleclick|facebook\.com\/plugins|platform\.twitter|disqus|recaptcha|adservice|analytics|\/ads?\/|chat|comments)/i;
const isHost = (host, domain) => host === domain || host.endsWith("." + domain);

function safeUrl(raw) {
  let u; try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || PRIVATE.test(u.hostname)) return null;
  return u;
}

async function get(url, opts = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), opts.timeout || 7000);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": UA, accept: "*/*", referer: new URL(url).origin + "/", ...(opts.headers || {}) } });
  } finally { clearTimeout(t); }
}

function kindOf(u) {
  const h = u.hostname.replace(/^www\.|^m\./, "");
  if (h === "youtu.be") return { kind: "youtube", id: u.pathname.slice(1) };
  if (isHost(h, "youtube.com") || isHost(h, "youtube-nocookie.com")) {
    const id = u.searchParams.get("v") || (u.pathname.match(/\/(live|embed|shorts)\/([\w-]+)/) || [])[2];
    if (id) return { kind: "youtube", id };
    if (u.searchParams.get("list")) return { kind: "hosted", name: "YouTube playlist" };
  }
  if (h === "drive.google.com" || h === "docs.google.com") return { kind: "hosted", name: "Google Drive video" };
  if (isHost(h, "dropbox.com")) return { kind: "hosted", name: "Dropbox video" };
  if (isHost(h, "dailymotion.com") || h === "dai.ly") return { kind: "hosted", name: "Dailymotion video" };
  if (h === "streamable.com") return { kind: "hosted", name: "Streamable video" };
  if ((isHost(h, "facebook.com") && /\/(videos|watch|reel)/.test(u.pathname + u.search)) || h === "fb.watch") return { kind: "hosted", name: "Facebook video" };
  if (isHost(h, "twitch.tv")) return { kind: "twitch" };
  if (isHost(h, "kick.com")) return { kind: "kick" };
  if (isHost(h, "vimeo.com")) return { kind: "vimeo" };
  if (/\.m3u8($|\?)/i.test(u.pathname + u.search)) return { kind: "hls" };
  if (/\.mpd($|\?)/i.test(u.pathname + u.search)) return { kind: "dash" };
  if (/\.flv($|\?)/i.test(u.pathname)) return { kind: "flv" };
  if (/\.ts($|\?)/i.test(u.pathname)) return { kind: "mpegts" };
  if (/\.(mp4|m4v|webm|ogg|ogv|mov|mkv)($|\?)/i.test(u.pathname)) return { kind: "file" };
  return { kind: "page" };
}

function rank(u) {
  if (/youtube(-nocookie)?\.com|youtu\.be|twitch\.tv/.test(u)) return 1;
  if (/kick\.com|vimeo\.com/.test(u)) return 2;
  if (/\.m3u8(\?|$)/i.test(u)) return 3;
  if (/\.(mp4|webm)(\?|$)/i.test(u)) return 4;
  return 5;
}

// Pull video players and stream links out of a page's HTML.
function findInHtml(html, base, self) {
  const out = new Map();
  const add = (raw, from) => {
    if (!raw) return;
    raw = raw.replace(/&amp;/g, "&").replace(/\\\//g, "/").trim();
    if (raw.startsWith("//")) raw = "https:" + raw;
    let u; try { u = new URL(raw, base); } catch { return; }
    if (!/^https?:$/.test(u.protocol) || SKIP.test(u.href) || u.href === self) return;
    if (!out.has(u.href)) out.set(u.href, from);
  };
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](og:video(?::secure_url|:url)?|twitter:player(?::stream)?)["'][^>]*>/gi)) add((m[0].match(/content=["']([^"']+)/i) || [])[1], "page's main video");
  for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) add(m[1], "embedded player");
  for (const m of html.matchAll(/<(?:video|source)[^>]+src=["']([^"']+)["']/gi)) add(m[1], "video file");
  for (const m of html.matchAll(/https?:\\?\/\\?\/[^"'\s<>]+?\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/gi)) add(m[0], "stream link");
  return [...out.entries()].map(([url, from]) => ({ url, from }))
    .filter(f => rank(f.url) < 5 || f.from !== "stream link")
    .sort((a, b) => (b.from === "page's main video") - (a.from === "page's main video") || rank(a.url) - rank(b.url))
    .slice(0, 10);
}

async function findVideos(pageUrl) {
  const u = safeUrl(pageUrl); if (!u) throw new Error("That link can't be checked.");
  const res = await get(u.href, { timeout: 8000, headers: { accept: "text/html,*/*" } });
  const type = res.headers.get("content-type") || "";
  if (/video|mpegurl/i.test(type)) return [{ url: u.href, from: "direct" }];
  const html = (await res.text()).slice(0, 2_000_000);
  return findInHtml(html, res.url || u.href, u.href);
}

// Can this page be shown inside another site's player frame?
function frameAllowed(res) {
  const xfo = (res.headers.get("x-frame-options") || "").toLowerCase();
  if (xfo.includes("deny") || xfo.includes("sameorigin")) return false;
  const csp = (res.headers.get("content-security-policy") || "").toLowerCase();
  const fa = (csp.match(/frame-ancestors([^;]*)/) || [])[1];
  if (fa !== undefined && !fa.includes("*")) return false;
  return true;
}

/*
  Check one link. Returns:
  { ok, status: "plays" | "live-only" | "embed" | "blocked" | "missing", url, note, alternatives }
  url is the link that should actually go into the player (may be the video pulled out of a page).
*/
async function checkLink(raw, depth = 0) {
  if (/^(rtmps?|rtsp|rtp|udp|srt|mms):\/\//i.test(String(raw).trim())) return { ok: false, status: "blocked", url: String(raw).trim(), note: "Browsers can't play this type of stream (RTMP, RTSP and similar)." };
  const u = safeUrl(raw);
  if (!u) return { ok: false, status: "missing", url: raw, note: "Not a valid web link." };
  const k = kindOf(u);
  try {
    if (k.kind === "youtube") {
      const r = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + k.id)}`);
      if (r.ok) return { ok: true, status: "plays", url: u.href, note: "YouTube video allows embedding." };
      return { ok: false, status: r.status === 401 || r.status === 403 ? "blocked" : "missing", url: u.href, note: r.status === 401 || r.status === 403 ? "The owner has turned off embedding for this video." : "This video is private, removed or the link is wrong." };
    }
    // Sites with their own player: the room builds the right embed, so keep the link as it is
    if (k.kind === "hosted") {
      const r = await get(u.href, { headers: { accept: "text/html" } });
      if (r.status === 404 || r.status === 410) return { ok: false, status: "missing", url: u.href, note: `That ${k.name.toLowerCase()} doesn't exist or was removed.` };
      return { ok: true, status: "plays", url: u.href, note: `${k.name}. Plays if it's shared publicly.` };
    }
    if (k.kind === "vimeo") {
      const r = await get(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u.href)}`);
      return r.ok ? { ok: true, status: "plays", url: u.href, note: "Vimeo video allows embedding." } : { ok: false, status: "blocked", url: u.href, note: "Vimeo won't let this video be embedded." };
    }
    if (k.kind === "twitch" || k.kind === "kick") {
      const r = await get(u.href, { headers: { accept: "text/html" } });
      if (r.status === 404) return { ok: false, status: "missing", url: u.href, note: "That channel or video doesn't exist." };
      return { ok: true, status: "live-only", url: u.href, note: "Channel found. It plays when the channel is live." };
    }
    if (k.kind === "hls") {
      const r = await get(u.href);
      const txt = r.ok ? (await r.text()).slice(0, 2000) : "";
      return txt.trimStart().startsWith("#EXTM3U") ? { ok: true, status: "plays", url: u.href, note: "Stream is online." } : { ok: false, status: "missing", url: u.href, note: r.ok ? "This isn't a working stream playlist." : `Stream didn't answer (error ${r.status}). It may be offline.` };
    }
    if (k.kind === "dash") {
      const r = await get(u.href);
      const txt = r.ok ? (await r.text()).slice(0, 4000) : "";
      return /<MPD[\s>]/.test(txt) ? { ok: true, status: "plays", url: u.href, note: "DASH stream is online." } : { ok: false, status: "missing", url: u.href, note: r.ok ? "This isn't a working DASH stream." : `Stream didn't answer (error ${r.status}).` };
    }
    if (k.kind === "flv" || k.kind === "mpegts") {
      const r = await get(u.href, { headers: { range: "bytes=0-187" } });
      if (!r.ok) return { ok: false, status: "missing", url: u.href, note: `Stream didn't answer (error ${r.status}).` };
      const head = new Uint8Array(await r.arrayBuffer()).subarray(0, 4);
      const looksRight = k.kind === "flv" ? head.toString("latin1", 0, 3) === "FLV" : head[0] === 0x47;
      return looksRight ? { ok: true, status: "plays", url: u.href, note: (k.kind === "flv" ? "FLV" : "TS") + " stream is online." } : { ok: false, status: "missing", url: u.href, note: "The link answered but isn't a video stream." };
    }
    if (k.kind === "file") {
      const r = await get(u.href, { headers: { range: "bytes=0-1023" } });
      const type = r.headers.get("content-type") || "";
      return r.ok && /video|octet-stream|mp4|webm|matroska|quicktime/i.test(type) ? { ok: true, status: "plays", url: u.href, note: "Video file is reachable." } : { ok: false, status: "missing", url: u.href, note: `Video file didn't load (${r.ok ? type || "unknown type" : "error " + r.status}).` };
    }
    // A normal page or an embed player page
    const r = await get(u.href, { timeout: 8000, headers: { accept: "text/html,*/*" } });
    if (!r.ok) return { ok: false, status: "missing", url: u.href, note: `Page didn't load (error ${r.status}).` };
    const type = r.headers.get("content-type") || "";
    if (/video|mpegurl/i.test(type)) return { ok: true, status: "plays", url: u.href, note: "Link goes straight to a video." };
    const framable = frameAllowed(r);
    if (depth > 0) return framable ? { ok: true, status: "embed", url: u.href, note: "Player allows embedding." } : { ok: false, status: "blocked", url: u.href, note: "This player blocks other sites." };
    const html = (await r.text()).slice(0, 2_000_000);
    const found = findInHtml(html, r.url || u.href, u.href).slice(0, 6);
    const checked = await Promise.all(found.map(f => checkLink(f.url, depth + 1).catch(() => ({ ok: false }))));
    const good = checked.filter(c => c.ok);
    if (good.length) {
      return { ok: true, status: good[0].status, url: good[0].url, note: `Pulled ${good.length === 1 ? "a playable video" : good.length + " playable videos"} out of the page.`, alternatives: good.slice(1).map(g => g.url) };
    }
    if (framable) return { ok: true, status: "embed", url: u.href, note: found.length ? "Videos in the page wouldn't play, so the whole page will show as an embed." : "No video found inside, but the page can show as an embed." };
    return { ok: false, status: "blocked", url: u.href, note: "This page blocks other sites and no playable video was found inside it." };
  } catch (e) {
    return { ok: false, status: "missing", url: u.href, note: "Couldn't reach that link. It may be down or slow." };
  }
}

export { safeUrl, findVideos, checkLink };
