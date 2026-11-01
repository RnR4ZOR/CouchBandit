// Couch Bandit on Cloudflare Workers (couchbandit.<you>.workers.dev).
// Serves the same site and API as the Pages deploy, sharing the same room storage (KV), so both addresses show the
// same rooms and the hourly event sync fills both. Static files come from public/ via Workers assets.
import * as check from "../functions/api/check.js";
import * as extract from "../functions/api/extract.js";
import * as login from "../functions/api/login.js";
import * as matchday from "../functions/api/matchday.js";
import * as requests from "../functions/api/requests.js";
import * as rooms from "../functions/api/rooms.js";
import * as sources from "../functions/api/sources.js";
import * as stream from "../functions/api/stream.js";
import * as sync from "../functions/api/sync.js";

const routes = { check, extract, login, matchday, requests, rooms, sources, stream, sync };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/([a-z]+)\/?$/);
    if (m && routes[m[1]]) {
      const mod = routes[m[1]];
      const method = request.method[0] + request.method.slice(1).toLowerCase();
      const fn = mod["onRequest" + method] || mod.onRequest;
      if (!fn) return new Response(JSON.stringify({ error: "method" }), { status: 405, headers: { "content-type": "application/json" } });
      return fn({ request, env, ctx, waitUntil: p => ctx.waitUntil(p), params: {}, next: () => env.ASSETS.fetch(request) });
    }
    if (url.pathname.startsWith("/api/")) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
    return env.ASSETS.fetch(request);
  },
};
