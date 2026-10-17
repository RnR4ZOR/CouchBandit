// Couchside link checker: /.netlify/functions/check?url=<link>
// Confirms a link will play, or pulls the playable video out of a page.
const { checkLink } = require("../lib/videos");
const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
exports.handler = async (event) => {
  const url = (event.queryStringParameters || {}).url || "";
  const result = await checkLink(url);
  return { statusCode: 200, headers, body: JSON.stringify(result) };
};
