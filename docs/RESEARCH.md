# Extraction research and architecture decision

Reviewed 2026-10-14. Platform behavior changes; tool support means an implemented extractor, not a guarantee that every post or account is accessible.

## Delivery decision

Ship a lightweight static UI (self-hostable or GitHub Pages) talking to a companion that runs on the user's machine or private server. This delivery chooses the website option; a Manifest V3 extension was considered but is not included. The static files are independent of any AI service. No hosted downloader or public relay is part of this design. Source-platform/CDN requests are necessary for actual downloads; "no public endpoints" means no public *downloader service*, not offline extraction.

Chrome documents that normal pages and content scripts obey the same-origin policy, while extension pages/workers require explicit host permissions for cross-origin requests. Thus a plain hosted page cannot reliably fetch authenticated platform metadata/CDNs. Extension permissions improve access but do not implement YouTube's evolving extraction or native audio/video merging. [Chrome network request documentation](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

Use mature extractors as local subprocesses rather than maintaining copied unofficial API algorithms. Native FFmpeg can merge separate best audio/video streams without recompression. For YouTube, yt-dlp recommends FFmpeg/ffprobe, yt-dlp-ejs and a supported JavaScript runtime; Deno is enabled by default, while Node requires explicit enablement. Install dependencies locally ahead of use rather than silently fetching remote scripts at runtime. [yt-dlp dependencies and format selection](https://github.com/yt-dlp/yt-dlp#dependencies), [EJS setup](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

## Tool comparison

| Tool | Relevant capability | License / decision |
| --- | --- | --- |
| yt-dlp | YouTube plus X, Instagram and Reddit video extractors; best format selection, adaptive manifests, native FFmpeg integration | Unlicense core; bundled dependencies have their own terms. Primary video engine. [Repository](https://github.com/yt-dlp/yt-dlp), [supported sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), [third-party notices](https://github.com/yt-dlp/yt-dlp/blob/master/THIRD_PARTY_LICENSES.txt) |
| gallery-dl | Single-post image galleries and mixed media, including X/Instagram/Reddit | GPL-2.0; invoke installed CLI without copying its source into frontend. Preserve obligations when redistributing the dependency. [Repository](https://github.com/mikf/gallery-dl), [sites](https://github.com/mikf/gallery-dl/blob/master/docs/supportedsites.md), [license](https://github.com/mikf/gallery-dl/blob/master/LICENSE) |
| Instaloader | Instagram posts, pictures/videos, session-based access | MIT; useful alternative when Instagram-specific handling warrants it. Extra engine/session complexity is unnecessary for the initial single-post architecture. [Repository](https://github.com/instaloader/instaloader), [documentation](https://instaloader.github.io/) |
| redvid | Reddit-hosted video with audio and maximum-quality option; requires requests and FFmpeg | GPL-3.0. Narrower overlap with yt-dlp, so no extra runtime dependency needed. [Repository](https://github.com/elmoiv/redvid) |
| ssstwitter | Public website accepting a tweet URL and returning downloads | No reusable open-source license established from the reviewed site. A public extraction service conflicts with the privacy requirement; do not integrate or proxy through it. [Official website](https://ssstwitter.com/) |

## Supported input and honest quality limits

| Platform | Intended single-URL input | Images | Videos | Access / quality limits |
| --- | --- | --- | --- | --- |
| YouTube | Individual watch, Shorts, or youtu.be video | Available thumbnails; a YouTube thumbnail is not a recoverable original photograph | yt-dlp best available video + audio, FFmpeg merge | No promise for DRM, removed/private/inaccessible media. Account-restricted items may need local cookies. Some formats may need PO tokens; no public token-provider integration. |
| X / Twitter | Individual status/post | gallery-dl requests original-size variants with available fallbacks | Best available extracted video rendition | Protected posts require authorized account access; rate limits/login gates may affect public posts too. Platform-encoded media may already be lossy. |
| Instagram | Individual post/reel/TV URL | gallery-dl carousel media | Best available accessible rendition | Public content can still encounter login/challenge/rate limits. Local authorized session cookies may be required. Profile/story bulk crawling is outside single-post scope. |
| Reddit | Individual comments/gallery URL or supported hosted video | gallery-dl gallery/image extraction | yt-dlp DASH/HLS + audio merge | Removed, quarantined, age-restricted or externally hosted media may be unavailable. A video-only fallback is not equivalent to full video with sound. |

"Highest quality" means the best rendition actually exposed to that user's session, preserving source encoding where possible. It does not mean an original camera master, universal codec playback, or a quality guarantee after platform processing. Show missing FFmpeg and extraction failures instead of advertising an unverified result.

The relevant upstream patterns were inspected, not copied: X's default image size is `orig` with fallback sizes; Instagram selects the largest available video dimensions; Reddit reads DASH/HLS manifest URLs rather than guessing one MP4 and losing audio. [X extractor](https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/twitter.py), [Instagram extractor](https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/instagram.py), [Reddit extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/reddit.py).

YouTube's own extractor guidance describes changing PO-token requirements and cookies for account-restricted content; these are genuine upstream limitations. [yt-dlp YouTube guidance](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#youtube).

## Privacy, security and distribution constraints

- Bind locally by default; require a random bearer token, constrain Host and browser Origin, and use explicit allowed origins for a separately hosted UI. Tokens belong to the user's local configuration and must never be shipped inside public static assets.
- Do not log submitted URLs, print subprocess commands, expose raw extractor diagnostics, store download histories, or embed third-party analytics/fonts/scripts. Cookies remain server-local and opt-in. Downloads themselves persist until deleted; privacy does not mean that disk artifacts never exist.
- Validate supported platforms and single-post paths before extraction. Disable inherited extractor config and plugins, restrict output to a dedicated directory, reject arbitrary proxy/input/output paths from the API, and cap jobs/time/output size.
- Static UI must not directly embed remote media previews if that would leak the submitted URL/referrer or trigger third-party requests outside the companion workflow.
- MV3 executable code must be packaged locally; remotely hosted JavaScript/WASM is restricted. [Chrome remotely hosted code guidance](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code).
- FFmpeg's license varies with build configuration. Do not silently bundle an unidentified binary. [FFmpeg legal documentation](https://ffmpeg.org/legal.html).

Open-source licenses grant software permissions, not permission to download arbitrary media. Use material you own or have permission to download and observe applicable platform terms and local law. YouTube's terms specifically constrain downloading and interference with access/copy restrictions. This is a distribution/use boundary, not a legal conclusion about a particular download. [YouTube Terms](https://www.youtube.com/static?template=terms).

## REA evidence boundary

The repository's `.agents/skills/rea/SKILL.md` was read. Its workflow favors least-invasive static analysis and forbids setup/configuration changes without authorization. Neither an available REA MCP tool nor an installed `rea` CLI was found during capability discovery. No REA setup was performed. The extractor findings above therefore come from primary upstream source inspection, not a REA runtime trace. REA's official project is [morluto/rea](https://github.com/morluto/rea).

## Validation boundary

Deterministic local fixture tests can prove UI/HTTP/job/download flow and boundary enforcement without contacting real platforms. They cannot prove contemporary live platform availability or account-authenticated behavior. Record live platform probes separately, including failures and missing credentials, and never promote a demo result to a live support claim.
