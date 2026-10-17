// Couchside video finder: opens a web page and returns the video players and stream links it contains.
// Runs as a Netlify Function at /.netlify/functions/extract?url=<page link>

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?f[cd])/i;

function rank(u) {
  if (/youtube(-nocookie)?\.com|youtu\.be/.test(u)) return 1;
  if (/twitch\.tv/.test(u)) return 1;
  if (/kick\.com|vimeo\.com/.test(u)) return 2;
  if (/\.m3u8(\?|$)/i.test(u)) return 3;
  if (/\.(mp4|webm)(\?|$)/i.test(u)) return 4;
  return 5;
}
const SKIP = /(googletagmanager|doubleclick|facebook\.com\/plugins|platform\.twitter|disqus|recaptcha|adservice|analytics|\/ads?\/|chat|comments)/i;

exports.handler = async (event) => {
  const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
  const page = (event.queryStringParameters || {}).url || "";
  let target;
  try { target = new URL(page); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "That isn't a full link." }) }; }
  if (!/^https?:$/.test(target.protocol) || PRIVATE.test(target.hostname)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "That link can't be checked." }) };
  }
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(target.href, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; CouchsideVideoFinder/1.0)", accept: "text/html,*/*" } });
    clearTimeout(t);
    const type = res.headers.get("content-type") || "";
    if (/video|mpegurl/i.test(type)) return { statusCode: 200, headers, body: JSON.stringify({ found: [{ url: target.href, from: "direct" }] }) };
    const html = (await res.text()).slice(0, 2_000_000);
    const base = res.url || target.href;
    const out = new Map();
    const add = (raw, from) => {
      if (!raw) return;
      raw = raw.replace(/&amp;/g, "&").replace(/\\\//g, "/").trim();
      if (raw.startsWith("//")) raw = "https:" + raw;
      let u; try { u = new URL(raw, base); } catch { return; }
      if (!/^https?:$/.test(u.protocol) || SKIP.test(u.href) || u.href === target.href) return;
      if (!out.has(u.href)) out.set(u.href, from);
    };
    // 1. what the page says its main video is
    for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](og:video(?::secure_url|:url)?|twitter:player(?::stream)?)["'][^>]*>/gi)) add((m[0].match(/content=["']([^"']+)/i) || [])[1], "page's main video");
    // 2. embedded players
    for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) add(m[1], "embedded player");
    // 3. video tags
    for (const m of html.matchAll(/<(?:video|source)[^>]+src=["']([^"']+)["']/gi)) add(m[1], "video file");
    // 4. stream links written into the page's code
    for (const m of html.matchAll(/https?:\\?\/\\?\/[^"'\s<>]+?\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/gi)) add(m[0], "stream link");
    const found = [...out.entries()].map(([url, from]) => ({ url, from }))
      .filter(f => rank(f.url) < 5 || f.from !== "stream link")
      .sort((a, b) => (a.from === "page's main video" ? -1 : 0) - (b.from === "page's main video" ? -1 : 0) || rank(a.url) - rank(b.url))
      .slice(0, 10);
    return { statusCode: 200, headers, body: JSON.stringify({ found }) };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Couldn't open that page. It may be down or blocking visitors." }) };
  }
};
