# Couchside

Watch-party rooms: name a room, paste a stream link (YouTube, Twitch, Kick, Vimeo, .m3u8, .mp4 or any embed code), add backups and share the link with friends.

## Hosting on Netlify
1. In Netlify choose **Add new site → Import an existing project → GitHub** and pick this repo.
2. Leave the build settings as they are (`netlify.toml` sets them) and deploy.

Two small server functions run on Netlify:
- `check` tests every link added to a room, pulls the playable video out of normal web pages, adds other playable videos from the page as backups, and moves links that won't play to the end.
- `extract` lists the videos found in a page.

In a room, each source shows a dot: green plays, yellow plays when the channel is live, red won't play. Direct streams that drop or don't start within 20 seconds switch to the next backup automatically.

Playback engines (loaded only when needed): YouTube, Twitch, Kick and Vimeo embeds; hls.js for .m3u8; Shaka Player for DASH (.mpd); mpegts.js for .flv and .ts; the browser's own player for .mp4 and .webm. RTMP and RTSP links can't play in browsers and are flagged as won't play.

Only share streams you have the right to share.
