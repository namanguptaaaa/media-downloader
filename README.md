# Local Media

A standalone single-link downloader for YouTube, X/Twitter, Instagram, and Reddit. The lightweight website talks to a companion running on your machine or private server. No AI service, public downloader API, analytics, account keys, or build service is used.

Hosted interface: **https://namanguptaaaa.github.io/media-downloader/**. Source: **https://github.com/namanguptaaaa/media-downloader**. The website is public; extraction runs on your own computer/private server and requires the companion below.

## Chrome background connection (no bridge window)

The hosted website defaults to the Manifest V3 extension. Install it once in **Google Chrome**:

1. Download [the extension ZIP](https://namanguptaaaa.github.io/media-downloader/extension.zip) and unzip it into a permanent folder. In this workspace, the ready-to-load folder is `extension/`.
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the folder containing `manifest.json`.
3. Start the companion with `./start-local.ps1 -ChromeExtension` and keep that terminal running. Alternatively use `python -m server.app --allow-origin chrome-extension://ifalbjaplddiebbnbecaalonfpojnamk`.
4. Open the hosted website in that same Chrome profile, reload it after installation, keep **Chrome extension · in the background** selected, paste the printed companion token, and connect.

No bridge window, extension popup, or extra tab needs to stay open. The local server still performs extraction; the extension makes requests to it in a background service worker. Close the downloader page or disconnect to end its active extension connection. It has no storage/tabs/analytics permissions, requests only `http://127.0.0.1:8765/*`, and injects its relay only into this hosted downloader project. Credentials remain in memory. The manifest includes a public key to preserve its extension ID; it is not a secret or a platform API key.

This is an unpacked extension, not a Chrome Web Store installation. When updating its files, click **Reload** on its Chrome extensions card and reload the website. The Codex in-app browser does not load this Chrome extension; use your installed Google Chrome. The extension connection uses port 8765; private HTTPS deployments use the website's **Direct connection** mode.

## Streaming saves in Chrome

Click a file or **Download selected ZIP**, choose its destination in Chrome's Save as dialog, and it streams to that file immediately. The page shows transferred bytes while saving. It no longer buffers an entire video/ZIP in browser memory before opening a save prompt. ZIPs stream directly from the companion without building another full temporary archive. No new extension permissions are required. Older browsers and the optional bridge retain the buffered fallback.

Reload the unpacked extension for version 1.2.0 and refresh the website for this update. File streaming works through the existing relay protocol; updated extension headers add total-size progress and its active-transfer timeout now resets as bytes arrive. Extraction remains separate from saving: original-quality source media must first reach the local companion. YouTube video and its best thumbnail now share one extraction. Platform stalls are bounded and downloaded-byte activity is visible.

## Export controls

Paste a single URL and extract for original best available video and unchanged images. Expand **Download options** for H.264/AAC MP4, MP3 (128–320 kbps), WAV, a maximum source resolution, or start/end seconds on converted outputs. MP4/MP3 re-encode locally; they cannot improve source quality. Images stay unchanged. X video extraction makes one bounded direct syndication retry after a primary failure, with a partial-source warning when used.

These controls were independently implemented after investigating the public [ssstwitter](https://ssstwitter.com/) and [Yout](https://yout.com/) workflows with browser observations and official REA static analysis. Their private server extractors remain unknown; no public downloader endpoints, copied scripts or analytics are used. Evidence and limitations: [ssstwitter report](docs/sites/SSSTWITTER.md), [Yout report](docs/sites/YOUT.md).

This update requires reloading the unpacked Chrome extension (version 1.1.0) and refreshing the website. In the prepared workspace its files are already updated; click **Reload** on its card in `chrome://extensions`.

## Run locally

Install Python 3.10+ and a supported JavaScript runtime: Node.js 20+ (auto-detected) or Deno. Install dependencies once:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m server.app
```

macOS/Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m server.app
```

Open **http://127.0.0.1:8765**, paste the access token printed in the terminal, and connect. Paste one post/video URL and press Enter or click **Extract media**. Select files and download individually or as a ZIP. Extraction downloads the media to a temporary server directory before presenting the results; transferring to your browser is a separate step.

In this prepared Windows workspace, dependencies have already been installed locally. You can run `./start-local.ps1` (or `./start-local.ps1 -Demo`). The launcher uses an existing interpreter and never installs software; the locally installed bundled Python was used during validation because this machine's default Python could not create a working virtual environment. For a separate installation, use the portable setup commands above. `MEDIA_DOWNLOADER_PYTHON` can choose an explicit interpreter.

`imageio-ffmpeg` supplies a locally installed FFmpeg binary on supported systems. An existing FFmpeg installation is preferred. You can specify an executable:

```sh
python -m server.app --ffmpeg-location /path/to/ffmpeg --js-runtime node:/path/to/node
```

The package installation needs Internet access. Normal use contacts the source platform and its media CDN directly from the companion. It never contacts an AI service. Extractor updates remain necessary as platforms change:

```sh
python -m pip install --upgrade -r requirements.txt
```

## Inputs and quality

| Platform | Accepted links | Media |
| --- | --- | --- |
| YouTube | Watch, youtu.be, Shorts, live, embed video links | Highest accessible video + audio and best available thumbnail |
| X/Twitter | Individual `/user/status/id` or `/i/web/status/id` links | Original-size images and best accessible video; multi-video posts supported |
| Instagram | Individual `/p/`, `/reel/`, `/tv/` links | Original images, carousel entries, accessible videos |
| Reddit | Comments links, `/gallery/id`, redd.it post links | Original galleries/images and accessible hosted video + audio |

Profiles, feeds, playlists, stories, Reddit `/s/` share links and arbitrary media URLs are outside this single-post scope. Open a share link in your browser and copy its canonical post URL. Tracking query strings are discarded. Only HTTPS source URLs on approved platform hosts are accepted.

Video selection uses yt-dlp's `bv*+ba/b`, preserving the best accessible source codecs. FFmpeg merges separate streams into MKV without re-encoding. A combined source may retain its original container. Some AV1/VP9/MKV files need a player such as VLC. "Highest quality" means the best rendition exposed by the platform to your session, not the original camera master. YouTube images are thumbnails, not photos recovered from the video.

Login gates, expired/deleted posts, rate limits, regional restrictions, DRM and upstream extractor breakage can prevent extraction. Partial results carry a visible warning. Incomplete video streams are excluded rather than presented as complete files. There is no guarantee every public post is anonymously accessible.

For content your account may access, optionally supply a **local Netscape cookie file**:

```sh
python -m server.app --cookies /private/path/cookies.txt
```

Cookies are read by local extractors, never uploaded to the website or another downloader. Keep the file private and outside a published directory. The app does not scrape browser credentials, solve challenges, or configure token-provider services. Refer to the upstream tools for legitimate cookie export/session handling.

## Static website / GitHub Pages

Publish only the contents of **`web/`** with any static web server. No npm build is needed. Do not publish the companion, cookies, `.deps`, `.venv`, or temporary downloads.

A GitHub Actions workflow at `.github/workflows/pages.yml` deploys `web/` when frontend changes reach `main` or `master`, and can also be started manually. Push the code to your repository and choose **GitHub Actions** as its Pages source.

Allow the exact Pages origin on your local companion:

```sh
python -m server.app --allow-origin https://YOUR-USER.github.io
```

The prepared Windows launcher supports the same configuration: `./start-local.ps1 -AllowOrigin https://namanguptaaaa.github.io`. Keep that terminal running while using the hosted interface.

The bridge is an optional legacy connection mode and never opens automatically. If you deliberately select **Optional local bridge window**, its window must stay open while connected. The extension is the default for the hosted website and needs no bridge. Both restrict API paths and keep credentials in memory rather than URL parameters or GitHub storage. HTTPS private-server endpoints and the directly served local UI use **Direct connection**.

An origin has no path: a Pages URL `https://YOUR-USER.github.io/repository/` uses `https://YOUR-USER.github.io`. Keep the server field set to your companion, not a public downloader. Browser local-network protections may block direct remote-page-to-local-server requests; the explicitly opened local bridge avoids making those cross-network fetches. If a browser does not support that bridge, use the locally served website or a private HTTPS deployment. No security settings or certificate warnings need to be bypassed.

## Private server

Use a VPN/firewall and a trusted HTTPS reverse proxy. The stdlib HTTP companion is not an Internet-facing production server. Keep it bound to loopback and have your proxy reach it locally. Disable proxy access/request logging if you require no URL/address logs; the application itself suppresses access and extractor logs.

```sh
python -m server.app --public-host media.your-domain.example --allow-origin https://media.your-domain.example
```

Configure the proxy to preserve that exact Host header; include `:port` when appropriate. Serve the UI through the same proxy or allow the separate static UI's exact origin. Set the website's endpoint to your private HTTPS address and acknowledge that you control a custom HTTPS hostname. Non-loopback binding is available only with an explicit allowed Host and should remain behind private network controls. Never expose the companion publicly merely to make Pages work.

Tokens are generated at startup and kept only in page memory. An optional `MEDIA_DOWNLOADER_TOKEN` environment variable can set a stable token (at least 24 ASCII characters without whitespace). Never embed it in static files or a URL. Anyone holding the token and network access can retrieve jobs from that companion; it is a single-user service.

## Privacy and limits

- No saved URL history, application access logs, raw extractor diagnostics, external fonts, previews, third-party scripts, or analytics. The website contacts only its configured companion. Platforms/CDNs necessarily see their own requested URLs.
- Extractor config, plugins and gallery postprocessors are disabled. The API cannot choose arbitrary filesystem paths, shell commands, proxies or extra extractor flags. Host, Origin and bearer-token guards protect the local API.
- Up to 12 retained jobs, two concurrent workers, 100 gallery entries, approximately 4 GB per job and 20 minutes per extraction command. Limits prevent ordinary runaway work; they are not hard filesystem quotas or production DoS guarantees. Progress is a phase indicator, not a measured byte percentage.
- Files and job metadata expire one hour after completion/error and are deleted on normal shutdown. Abrupt termination can leave `private-media-*` folders in the OS temporary directory. Browser downloads persist until you remove them. The input field and OS process arguments can temporarily contain the source URL; "no logging" does not mean memory invisibility.
- Authenticated browser downloads buffer a Blob in memory. For very large media, use the upstream CLI directly or reduce job size; available browser memory may be below the server limit.

## Validation

```sh
python -m unittest discover -s tests -v
python -m unittest server.test_app -v
node --test tests/test_bridge.cjs
node --test tests/test_extension.cjs
node --check web/app.js
```

The deterministic tests use disposable fixtures and loopback HTTP, no platform accounts. To exercise the browser without platform traffic:

```sh
python -m server.app --demo
```

Demo mode is visibly labeled and returns a synthetic image plus a real one-second video when FFmpeg is available. It is never evidence of live platform extraction. An opt-in `scripts/live_probe.py` exercises a running non-demo API; see its help and set `MEDIA_DOWNLOADER_TOKEN` in your environment. It reports platform/state/media sizes without printing submitted URLs.

See [validation evidence](docs/VALIDATION.md), [independent review](docs/REVIEW.md) and [upstream research](docs/RESEARCH.md) for verified outcomes and limitations.

## Licenses

Application code is MIT. External tools have separate licenses: yt-dlp (Unlicense core), gallery-dl (GPL-2.0), and the installed FFmpeg build's applicable license. They are installed as dependencies, not vendored into this repository. If redistributing packaged dependencies/binaries, preserve their notices and satisfy their license obligations. Download only media you own or have permission to save, consistent with applicable terms and law.
