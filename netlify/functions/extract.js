// Couchside video finder: /.netlify/functions/extract?url=<page link>
const { safeUrl, findVideos } = require("../lib/videos");
const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
exports.handler = async (event) => {
  const url = (event.queryStringParameters || {}).url || "";
  if (!safeUrl(url)) return { statusCode: 400, headers, body: JSON.stringify({ error: "That link can't be checked." }) };
  try { return { statusCode: 200, headers, body: JSON.stringify({ found: await findVideos(url) }) }; }
  catch (e) { return { statusCode: 502, headers, body: JSON.stringify({ error: "Couldn't open that page. It may be down or blocking visitors." }) }; }
};
