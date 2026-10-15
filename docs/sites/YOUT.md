# Yout public frontend investigation

Captured 2026-10-15, public unauthenticated pages only. No paywall, CAPTCHA, login or rate-limit bypass was attempted. This report distinguishes static frontend behavior from unobserved server implementation. The global REA skill and official workflow were read; REA MCP is unavailable in this session. Root subsequently ran the official REA CLI 6.5.0 against the retained JavaScript tree. The observations below are ordinary source inspection, not a REA runtime capture.

## Retained evidence

| Artifact | Primary URL | SHA-256 |
|---|---|---|
| `artifacts/site-research/yout.html` | `https://yout.com/` | `e3f2b65814c0c6901e82a31cf497c19955e1b04c2ba792c3744fc023e458bcf9` |
| `artifacts/site-research/yout-utils.js` | `https://yout.com/static/js/utils.js?v=26b7a74cd251` | `95d007336d625b55a4b046c77113249ebaffa4ffb186d3499869936bdfe3655c` |
| `artifacts/site-research/yout-video.html` | `https://yout.com/video/?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DjNQXAC9IVRw` | `81af06a9a6b645af816717461f786c845849acc3e2f254566cd24fd08ffe8fab` |

The public short fixture is YouTube `jNQXAC9IVRw`. Utilities and video page were fetched with ordinary GET requests. Inline executable script blocks were extracted using Python HTMLParser into `artifacts/site-research/yout-js/`; `mapping.json` retains their original HTML start lines. JSON/JSON-LD and external library scripts were excluded. This derived tree is a scoped analysis input, not recovered private source.

## Observations

1. Home-page `verifyIfVideoURL` redirects individual YouTube links to `/video/?url=...`, with separate playlist/channel branches (home lines 949–974). Our downloader deliberately retains its individual-post boundary.
2. The video page displays MP3, MP4 and WAV format controls. GIF is disabled and linked to pricing (video lines 330–351). MP3 quality choices are 32/64/128/192/256/320 kbit/s; MP4 choices are 144/240/360/480/720/1080/2160/4320 height (video line 2140). Displaying a choice is not proof that this source offers that quality.
3. From/To controls support timestamps and a duration slider. `validateRangeFormatFn`, `manuallyUpdateSliderFn` and `prepareRecordingData` convert entries into numeric start/end times (video lines 2158–2199 and 2345–2368).
4. MP4 exposes an H.264 compatibility checkbox; audio controls also expose normalization, silence removal and metadata discovery (video lines 2371–2395). Their server algorithms are unknown.
5. `prepareRecordingData` performs JSON POST `/api/accounts/rate_limit/` with source URL and format. On success it selects `https://{response.dvr}.yout.com/{format}` (video lines 2407–2425). `utils.sendDVRRequest` submits a regular POST form there with encoded `video_url`, format, selected video quality or audio bitrate, start/end, title/artist and optional fields (utils lines 104–146).
6. `utils.getVideoInfo` calls GET `https://youtdata.com/i?video=ID`, checking response-body errors even on successful HTTP status; it can inject a returned iframe and retry (utils lines 179–291). This is an external metadata service and is not appropriate as a dependency for the independent local downloader.
7. Source comments mention a Go service, proxy retry tiers and yt-dlp. These are frontend author comments, not independent evidence of actual private-server internals. They do not establish extraction equivalence.

## Transfer into the local downloader

Keep the existing original best-video/audio download and original images as the default. Add explicit local export choices: H.264/AAC MP4 compatibility conversion, MP3 audio with selected bitrate, WAV PCM audio, and start/end trim on converted outputs. Bound optional video height through yt-dlp's source-format selection rather than upscaling. Use local FFmpeg for actual export and accurate trim; clearly label conversion as re-encoding, since neither MP3 nor compatibility MP4 can promise unchanged source quality.

These are independently implemented controls and local transformations, not copied private extraction algorithms. Do not integrate Yout's rate-limit, DVR, metadata, proxy, account, analytics or payment endpoints. Do not copy its interface, authentication tokens or service restrictions.

## Unknowns and verification scope

Private media extraction, retries, CDN access, server codec settings and quality enforcement remain unknown. No successful Yout processing/download was observed in this investigation; the identified POST requests are statically represented in shipped public scripts. CAPTCHA/paywall restrictions, if encountered in a normal browser, must remain restrictions. Public source inspection does not prove feature completeness or equivalence. Root's browser/REA evidence can add bounded runtime findings separately.

## Root browser and REA evidence

The ordinary browser flow reached the public video-options page through its URL form. MP3/MP4/WAV, start/end timestamps, MP3 bitrates and upgrade restrictions were visible. Processing was not submitted because its final button explicitly accepts Terms; no successful Yout conversion is claimed.

REA evidence `ev_043bfcd4ddb59908043edb2387dab10d3c9ef6d4ae14de2e0d3caef1b3457a86`, artifact-root SHA256 `01eda2fe9106ad49c056d9c4586e874828e2130060ff6cb095f6c15db8a67f09`, is retained locally at `artifacts/site-research/yout-rea-evidence.json`. Sixteen JavaScript files parsed without errors (9,030 AST nodes). Authority is shipped-artifact, confidence derived. The producer explicitly treats text as inert and graph coverage as incomplete; static endpoints do not prove runtime execution or recover private backend code. Raw third-party source captures are excluded from publication.
