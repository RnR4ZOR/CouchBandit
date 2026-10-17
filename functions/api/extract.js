// Couchside video finder: /api/extract?url=<page link>
import { safeUrl, findVideos } from "../../lib/videos.js";
const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
const out = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
export async function onRequest({ request }) {
  const url = new URL(request.url).searchParams.get("url") || "";
  if (!safeUrl(url)) return out({ error: "That link can't be checked." }, 400);
  try { return out({ found: await findVideos(url) }); }
  catch (e) { return out({ error: "Couldn't open that page. It may be down or blocking visitors." }, 502); }
}
