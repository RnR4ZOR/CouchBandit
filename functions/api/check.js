// Couchside link checker: /api/check?url=<link>
// Confirms a link will play, or pulls the playable video out of a page.
import { checkLink } from "../../lib/videos.js";
const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
export async function onRequest({ request }) {
  const url = new URL(request.url).searchParams.get("url") || "";
  return new Response(JSON.stringify(await checkLink(url)), { headers });
}
