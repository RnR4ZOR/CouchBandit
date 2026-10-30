# Couchside

Watch-party rooms: name a room, paste a stream link (YouTube videos and playlists, Twitch, Kick, Vimeo, Google Drive, Dropbox, Dailymotion, Streamable, Facebook, .m3u8, .mp4 or any embed code), add backups and share the link with friends. all rooms created are public and shown on the home page

## Hosting on Cloudflare Pages
1. In the Cloudflare dashboard go to **Workers & Pages → Create → Pages → Connect to Git** and pick this repo.
2. Build settings: Framework preset **None**, build command empty, build output directory **public**. Save and deploy.
3. Room storage: **Storage & Databases → KV → Create namespace** named `couchside-rooms`. Then in the Pages project go to **Settings → Bindings → Add → KV namespace**, variable name `ROOMS`, pick `couchside-rooms`, save, and redeploy.

The site lives at `https://<project>.pages.dev`. Every push to `main` redeploys it.

Server functions (in `functions/api/`) run on Cloudflare:
- `rooms` saves rooms so anyone with the site link sees them. Rooms stay up until the owner deletes them.
- `check` tests every link added to a room, pulls the playable video out of normal web pages, adds other playable videos from the page as backups, and moves links that won't play to the end.
- `extract` lists the videos found in a page.
- `stream` relays direct video links (.m3u8, .mp4, .mpd and so on) that the browser can't load on its own: plain `http://` links, servers that block other sites, and HLS playlists whose segments need the same treatment. The player tries each link directly first and only uses the relay if that fails.

In a room, each source shows a dot: green plays, yellow plays when the channel is live, red won't play. Direct streams that drop or don't start within 20 seconds switch to the next backup automatically.

Playback engines (loaded only when needed): YouTube, Twitch, Kick and Vimeo embeds; hls.js for .m3u8; Shaka Player for DASH (.mpd); mpegts.js for .flv and .ts; the browser's own player for .mp4 and .webm. RTMP and RTSP links can't play in browsers and are flagged as won't play.

Only share streams you have the right to share.

## Automatic Cloudflare deploy (recommended)

Add three secrets in GitHub (**Settings → Secrets and variables → Actions**): `CLOUDFLARE_API_TOKEN` (Account permissions: Cloudflare Pages Edit, Workers KV Storage Edit), `CLOUDFLARE_ACCOUNT_ID`, `OWNER_PASS`. Then **Actions → Deploy to Cloudflare → Run workflow** once. It creates the Pages project and room storage, copies your current rooms across, sets the owner login and deploys to `https://couchbandit.pages.dev`. Every push to `main` after that redeploys by itself.

## Couch Bandit on Cloudflare (log in anywhere, no GitHub key) (manual setup)

The same code runs on GitHub Pages and Cloudflare Pages. On Cloudflare the owner login is checked by the server and rooms are saved on the server, so the master can log in on any device and save straight away.

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick **CouchBandit**. Build command: none. Build output directory: `public`. Deploy.
2. **Storage & Databases → KV → Create namespace** (any name, e.g. `couchbandit-rooms`). In the Pages project: **Settings → Bindings → Add → KV namespace**, variable name `ROOMS`, pick that namespace.
3. In the Pages project: **Settings → Variables and Secrets → Add**, type **Secret**:
   - `OWNER_PASS` = your master code (no username needed)
4. **Deployments → Retry deployment** (so the settings take effect).

The first time you open the Cloudflare site it shows the rooms from `rooms.json`; your first save copies them onto the server.

## Automatic deploy to GitHub Pages
Every push to `main` that changes `public/` runs **Deploy to GitHub Pages** (`.github/workflows/deploy-pages.yml`). It copies `public/` to the `gh-pages` branch, which serves https://rnr4zor.github.io/CouchBandit/. The live `rooms.json` is kept, so rooms saved on the site aren't overwritten. To redeploy by hand: **Actions → Deploy to GitHub Pages → Run workflow**.

## Auto event rooms (official channels)
`.github/workflows/events-sync.yml` runs every 3 hours. It reads the official channels in `tools/channels.json`, finds their scheduled and live streams for the next 14 days, and adds each as a room with its sport category, start time and up to 5 backups (the same event on other official channels, plus any `alts` you list). Rooms are grouped by sport on the home page, show a countdown before they start, and are filed into Past events after 3 days.

- Uses the `OWNER_PASS` secret you already have. Optional: `YT_API_KEY` (free YouTube Data API key, more reliable) and `SITE_URL` (defaults to https://couchbandit.pages.dev).
- Delete an auto room and it won't come back. Edit one and it becomes yours, so the sync stops changing it.
- Add or remove channels by editing `tools/channels.json`. The Actions log lists any handle it couldn't read.
- Run it now: **Actions → Event sync → Run workflow**.

## Event requests
Anyone can tap **Request event**. The event's name, date/time, league and venue are filled in straight away (TheSportsDB), and the hourly event sync looks for it on the official channels only. If it finds a stream, a ready-made room (up to 5 backups) waits on the **Requests** page for the owner to approve. If not, the owner can paste their own links there; pages, embed code and video links are checked and turned into embeds, same as any room.
