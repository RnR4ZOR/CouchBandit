# Couchside

Watch-party rooms: name a room, paste a stream link (YouTube, Twitch, Kick, Vimeo, .m3u8, .mp4 or any embed code), add backups and share the link with friends.

## Hosting on Netlify
1. In Netlify choose **Add new site → Import an existing project → GitHub** and pick this repo.
2. Leave the build settings as they are (`netlify.toml` sets them) and deploy.

The video finder (`netlify/functions/extract.js`) pulls embedded videos out of normal web pages. It only runs on Netlify.

Only share streams you have the right to share.
