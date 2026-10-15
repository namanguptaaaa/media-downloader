# ssstwitter public frontend investigation

Observed 2026-10-15. Scope: public homepage, shipped browser scripts, and one ordinary anonymous form submission containing a public upstream test tweet. No authentication, CAPTCHA solving, access-control bypass, private URL, proprietary code reuse, or production integration with ssstwitter.

## Evidence identity

| Evidence | Identity / scope |
| --- | --- |
| Saved homepage | `artifacts/site-research/ssstwitter.html`, 95,573 bytes, SHA256 `1697798870A20F6F4A8D2B7B89D1EE51430A95C65FBA463BBD26694373991D66` |
| Public HTMX asset | GET `https://ssstwitter.com/js/htmx.min.js`: HTTP 200, 28,477 characters, UTF-8 re-encoded response-text SHA256 `46FF22717AE2B0D76DC224E768F0F8D2A8AE9F2E775ACB14D1A1CCB5A68DBBF9` |
| Form-parameter extension | GET `https://ssstwitter.com/js/include-vals.js`: HTTP 200, 836 characters, response-text SHA256 `1E8EC23EF137484836FB8FB3DE4B15975344C121193A6A395A114B233D9420BD` |
| Ordinary form result | Fresh anonymous GET followed by one POST to `/`, public NASA tweet `623160978427936768`; HTTP 200, `HX-Trigger: sssfailure`, 86,905 characters, response-text SHA256 `5986ED3AAD3CFB1E13B51FD6437894F85EFDAFF15A450B16FF3651E46C9018FD` |

Script/result response-text hashes identify text returned to the inspection command, not raw compressed HTTP bytes. Those responses were inspected in memory rather than retained as raw captures. The NASA fixture is listed in [yt-dlp's public Twitter extractor tests](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py). The fixture's inclusion upstream does not guarantee its current availability.

## Observed browser contract

The saved homepage's form (lines 257â€“259) declares `data-hx-post="/"`, target `#target`, HTML swapping, selection of `#result`, and URL-history pushing. Input `name="id"` contains the submitted tweet URL; hidden `locale` is `en`. Its include-values declaration adds `tt`, `ts`, and `source:'form'`. Values are supplied by the page; their validation/significance on the server is unknown. The small include-values asset hooks the HTMX request-configuration event and merges the declared parameters. This is request assembly, not media extraction.

The anonymous test used a fresh page's declared fields, normal URL-encoded form submission and HTMX request headers. It returned a failure event despite HTTP 200. No successful download links or actual quality ladder were established by that probe. Repeating requests, guessing hidden endpoints, or bypassing a challenge would not resolve that uncertainty within this bounded scope.

Visible result-handling JavaScript references `.download-btn`, `.quality-best`, `href`, and `data-directurl`. Click handlers navigate to the returned link; some paths involve an advertisement modal. The homepage also contains MP3-conversion UI handlers for `mp3_convert`, including disabled/waiting/ready/error states. Those handlers do not reveal the conversion endpoint, source variant selection, FFmpeg invocation, download-file integrity or exact result markup. No trim input was observed in the captured homepage.

The page loads Google ad and tag-manager scripts and pushes the inserted URL into `dataLayer` on submission/success/failure (saved HTML lines 1309â€“1312, 1343â€“1347, 1371â€“1375). These are direct evidence of a URL-bearing client telemetry queue, not proof of every external transmission. Reusing that frontend would contradict this project's no-analytics/no-URL-logging requirements.

## What remains opaque

No X metadata API call, signed CDN URL generator, video variant ranking algorithm, authentication strategy, or server conversion implementation was recovered from this homepage. The server receives the URL and provides result HTML: server dependence is observed; its internal extractor is unknown. The site's claim that videos come from Twitter CDN is a product statement, not a captured successful media request. `data-directurl` is only a link attribute; it does not prove that every result points directly to X rather than a relay.

Our source inspection cannot establish equivalent platform reach, higher quality than yt-dlp, login-free availability, or original-source recovery. The browser tool reported no available browser in this child session, so this test was ordinary HTTP request inspection rather than browser runtime capture. The global REA skill and its map/understand workflow reference were read.

Root subsequently retained official REA `analyze_javascript_application` evidence in `artifacts/site-research/ssstwitter-rea-evidence.json`: evidence ID `ev_1e154afe495c83e8898637a4f2c2a80e1aad3abf6a51eff3acd9fc69bbf60a14`, subject `ssstwitter-js`, artifact-root SHA256 `3e160241bd91b121c8f1002c95700e9c16b326b0659c6e28ab90787b4107e143`. The result reports derived confidence, shipped-artifact authority, and no inventory integrity contradictions. Its explicit limitations say HTML/JavaScript were parsed as inert text, graph coverage is incomplete, and static relationships do not prove execution. This corroborates retained artifact identity and provides static analysis evidence; it does not recover the opaque server or turn the failed HTTP fixture into a successful media capture.

## Transferable implementation choices

Implement the user-facing concepts independently: one URL, clearly labeled available media/quality, optional local MP3/WAV conversion, explicit compatible MP4 export and bounded clipping. Native FFmpeg can perform authorized local conversions after direct platform extraction; do not send URLs or media to ssstwitter in production. Preserve original highest available quality as the default and label conversions as transformations.

A possible direct-X reliability improvement comes from open-source yt-dlp rather than any recovered ssstwitter backend: its Twitter extractor supports `graphql`, `legacy`, and `syndication`, enumerates `video_info.variants`, handles MP4/HLS, and warns that syndication may omit metadata/media. A bounded explicit syndication retry after a failed primary extraction can be tested without using a public downloader service; preserve partial-result warnings and never treat this as a private-post or universal-quality workaround. [Upstream Twitter extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py).

Acceptance should prove that export options are strictly validated, forwarded through both transports, converted locally, and decoded with expected audio/video/duration. Live X source availability and successful alternate-route extraction need separate evidence. A demo conversion or the site's marketing copy cannot satisfy those claims.

## Independent implementation acceptance

The implemented API accepts only `url` and optional known export fields, with fixed format/height/bitrate choices and finite bounded trim seconds. `tests/test_export_options.py` exercises boolean/NaN/infinite values, unknown fields and shell-like strings, rejection before job creation, unknown API root arguments, unchanged default best-source format selection and no re-encoding for Original. A mocked X primary failure proves exactly one direct upstream syndication retry, removal of failed fragments and an incomplete-source warning; constructed commands contain neither ssstwitter nor Yout service URLs. This proves retry policy, not live fallback availability.

Real local FFmpeg tests create a two-second synthetic video with sound, export one-second MP4/MP3/WAV clips, decode them, verify duration and stream presence, and preserve original images. They found an actual defect where trimming after source duration produced a nonempty header-only MP3 and incorrectly succeeded. The implementation now uses FFmpeg's empty-output/empty-stream failure controls and removes the failed export; the regression passes. Backend reported seventeen targeted backend/export tests passing after the repair.

Targeted Node tests validate both transports' export schema, rejection of unknown/injectable fields and exact options forwarding. The complete Chrome-JSON VM pipeline now carries an MP4/720p/trim extraction request, receives its correlated job response, and then reconstructs multichunk ZIP bytes; the three changed transport tests pass. As before, VM tests do not substitute for actual extension installation or browser save behavior. All media-processing fixtures are synthetic and local, with no accounts or production platform downloads.

## Root browser observation and retained REA analysis

A separate ordinary in-app browser submission of public X post `1790637656616943991` succeeded: result controls offered 728×720, 364×360 and 272×270 video downloads and MP3 conversion. The HD link targeted ssstwitter `/result_normal`; lower-quality links targeted ssscdn.io. All exposed `data-directurl`. This supersedes no failed-fixture evidence: the old NASA probe failed, while this newer fixture succeeded. Returned links establish the visible quality ladder, not the server extraction algorithm, file integrity or equivalence to our extractor. No download/conversion endpoint from either site is used by this product.

The official REA CLI 6.5.0 parsed eight captured inline JavaScript files without parse errors (2,470 AST nodes). Evidence ID and artifact digest above identify this bounded static analysis; execution and private server internals remain unknown.
