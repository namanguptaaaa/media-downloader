# Validation evidence

Validated 2026-10-14 using Python 3.12.14, yt-dlp 2026.8.19, gallery-dl 1.32.16, yt-dlp-ejs 0.8.0, Node on PATH, and imageio-ffmpeg 0.6.0 (FFmpeg 7.1). Source versions are recorded rather than promising future platform behavior.

## Application acceptance

- Eight independent HTTP/security tests and ten backend tests passed. These cover token/Host/Origin/CORS boundaries, input normalization, invalid input, static path traversal, missing jobs, attachment files/ZIPs, extractor configuration isolation, job expiry, image-only posts without FFmpeg, rejected failed video fragments, and visible partial-result warnings.
- JavaScript syntax check passed. Frontend agent additionally checked 24 endpoint/platform/size assertions.
- Real browser interaction at the local website: token entry, Connect click, URL entry, Enter submission, result rendering, ZIP button click, and browser download completed in demo mode. The saved ZIP contained a 68-byte PNG and a 14,898-byte video. `zipfile.testzip()` returned no corruption.
- Live browser interaction: Connect, paste URL, Extract click, and individual video Download click completed for YouTube `jNQXAC9IVRw`. Results included a 474,592-byte MKV and an approximately 22 KB thumbnail. FFmpeg decoded the saved MKV successfully: 320×240 AV1 video and stereo Opus audio, approximately 19 seconds. The selector requested best available streams; this old source itself has a low resolution.
- [Saved live browser screenshot](screenshots/live-download.png) shows the completed result/download interface.
- Browser unsupported-domain rejection passed, and the final frontend reconnect passed after adding a bounded connection timeout. Trailing-slash Shorts and X photo/video permalink normalization are covered by the backend URL checks.
- `start-local.ps1 -Demo -Port 8767` started successfully, with all dependency health fields available. Source/static ZIPs were generated and passed archive integrity checks; source bundles exclude installed binaries, cookie files and environments.

The execution sandbox blocks local socket access and external DNS; approved escalation allowed dependency installation, loopback tests and public-platform probes. This is an agent execution limitation, not a runtime dependency of the delivered application.

## Live platform probes

All probes used public upstream extractor test posts with no credentials, through the actual local companion HTTP API. They are samples, not a guarantee for all posts.

| Platform | Observed result |
| --- | --- |
| YouTube | Browser extraction and download passed. Video/audio decode passed, thumbnail returned. An older deleted test video was unavailable; replaced with the accessible sample above. |
| X/Twitter | Newer upstream sample `1790637656616943991` returned a 1,397,317-byte video without warnings. An old Star Wars sample failed due to an unavailable amplify/CDN domain (upstream HTTP 500). |
| Instagram | Carousel `BQ0eAlwhDrw` returned three complete videos (39,753, 960,393 and 2,524,830 bytes). Images returned a partial-result warning; direct gallery-dl diagnosis reported redirect to login. Authenticated original-image extraction was not tested because no cookie file was supplied. |
| Reddit | Public sample returned no media. Direct upstream diagnosis reported "You've been blocked by network security." Live successful Reddit downloading remains unverified on this network; no account credentials or bypass was attempted. |

The UI clearly reports extraction failures/partial output. Platform login and network restrictions are disclosed instead of represented as successful support. Original-image selection delegates to gallery-dl's upstream extractors; live authenticated image extraction remains unverified here. No URL logs/history are created by the application or probe script; this document deliberately records public fixture identifiers for auditable acceptance evidence.

## Delivery boundaries

The static website and companion are delivered; a Chrome extension is not included. The initial delivery was local-only. On the user's follow-up, the public repository `namanguptaaaa/media-downloader` was created, source uploaded, and GitHub Pages enabled with successful Actions deployment. Private proxy/VPN deployment, DRM/account-restricted media and cookies remain untested. See README for these constraints and setup.

## Hosted acceptance after follow-up

Website: **https://namanguptaaaa.github.io/media-downloader/**. Source: **https://github.com/namanguptaaaa/media-downloader**.

Direct HTTPS-page-to-HTTP-localhost requests timed out in the in-app browser, while top-level localhost requests and CORS health requests succeeded. Browser/network policy was a plausible cause, not conclusively diagnosed. Added an explicit local popup bridge using exact-origin, nonce-scoped browser messages and same-origin companion fetches. No browser security settings or certificate checks were disabled. Added versioned asset URLs after a normal reload combined a new page with a cached old script.

Verified in the real browser on the hosted URL: access-token entry, Connect click, local bridge handshake, URL entry, Enter submission, real YouTube extraction, result rendering, Download selected ZIP click, and completed browser download. The archive contains the merged MKV plus thumbnail and passes `zipfile.testzip()`. [Hosted download screenshot](screenshots/github-pages-download.png).

All 24 deterministic tests pass: nine independent HTTP tests, ten backend checks and five Node VM bridge security tests. Bridge tests reject wrong sources/origins/nonces, arbitrary paths/methods, malformed bodies and token injection; verify Blob bytes and request correlation; cover request caps, cancellation and cleanup. The launcher explicitly allows `https://namanguptaaaa.github.io`; the companion remains running for immediate use. For later sessions run `./start-local.ps1 -AllowOrigin https://namanguptaaaa.github.io`, paste its printed token, and keep the local bridge open.

## Background Chrome extension follow-up

The user rejected a persistent bridge window and chose the Chrome extension. Hosted default connection now uses an MV3 background service worker; the legacy bridge is explicit opt-in only. Manifest permissions are restricted to localhost port8765 and a content script on the exact hosted project. The stable extension ID is `ifalbjaplddiebbnbecaalonfpojnamk`; its public manifest key is not a secret.

Seven new independent Node tests pass, including Chrome-style JSON-cloned messages, a complete page/content/worker binary pipeline, ACK backpressure and byte-exact120KB transport, identity/frame/page/path/token bounds, nonce and concurrency limits, cancellation, and absence of popup fallback when the extension is missing. Combined relay suite:12 passing tests. This verifies implementation/protocol behavior, not actual installed Chrome permissions or worker lifecycle.

Desktop automation stopped because it could not reliably determine Chrome's current URL. No Chrome installation/settings changes were automated. The extension must be loaded once by the user with Chrome's Load unpacked control. Actual installed Chrome extraction/download acceptance remains pending that manual step. The companion is configured for the exact extension origin; start it later with `./start-local.ps1 -ChromeExtension`.
