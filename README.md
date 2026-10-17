# Couchside

Watch-party rooms: name a room, paste a stream link (YouTube videos and playlists, Twitch, Kick, Vimeo, Google Drive, Dropbox, Dailymotion, Streamable, Facebook, .m3u8, .mp4 or any embed code), add backups and share the link with friends.

## Hosting on Cloudflare Pages
1. In the Cloudflare dashboard go to **Workers & Pages → Create → Pages → Connect to Git** and pick this repo.
2. Build settings: Framework preset **None**, build command empty, build output directory **public**. Save and deploy.
3. Room storage: **Storage & Databases → KV → Create namespace** named `couchside-rooms`. Then in the Pages project go to **Settings → Bindings → Add → KV namespace**, variable name `ROOMS`, pick `couchside-rooms`, save, and redeploy.

The site lives at `https://<project>.pages.dev`. Every push to `main` redeploys it.

Server functions (in `functions/api/`) run on Cloudflare:
- `rooms` saves rooms so anyone with the site link sees them under **Open rooms**. Rooms delete themselves 48 hours after they end.
- `check` tests every link added to a room, pulls the playable video out of normal web pages, adds other playable videos from the page as backups, and moves links that won't play to the end.
- `extract` lists the videos found in a page.
- `stream` relays direct video links (.m3u8, .mp4, .mpd and so on) that the browser can't load on its own: plain `http://` links, servers that block other sites, and HLS playlists whose segments need the same treatment. The player tries each link directly first and only uses the relay if that fails.

In a room, each source shows a dot: green plays, yellow plays when the channel is live, red won't play. Direct streams that drop or don't start within 20 seconds switch to the next backup automatically.

Playback engines (loaded only when needed): YouTube, Twitch, Kick and Vimeo embeds; hls.js for .m3u8; Shaka Player for DASH (.mpd); mpegts.js for .flv and .ts; the browser's own player for .mp4 and .webm. RTMP and RTSP links can't play in browsers and are flagged as won't play.

Only share streams you have the right to share.
