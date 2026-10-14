# Independent review and acceptance evidence

Reviewed backend `server/app.py`, static `web/app.js` and markup, dependency requirements, and the extraction/privacy architecture on 2026-10-14. Browser/live-platform validation is recorded separately by the delivery agent.

## Findings resolved during implementation

- A failed YouTube video download could previously produce a successful thumbnail-only result without disclosure. Backend now includes extraction warnings and an explicit thumbnail-only warning; frontend displays partial-result warnings. A regression test simulates this exact failure.
- YouTube runtime/EJS requirements were absent from health status. Backend now reports these prerequisites and supports local JS-runtime configuration, including explicit Node enablement; frontend surfaces missing prerequisites.

## Deterministic verification

`python -m unittest discover -s tests -v` passed nine tests against a disposable in-process companion with real loopback HTTP connections. The execution sandbox denies loopback socket connections, so the successful run used approved escalation. No platform account, production credentials or real submitted media were accessed.

Coverage: bearer-token rejection; hostile Host and Origin rejection; explicit-origin preflight; opaque/null-origin denial; unsupported URL/credential/custom-port/profile rejection without creating jobs; canonical tracking-query removal; static traversal and unknown-route denial; synthetic extraction, status polling, item download and ZIP bytes; attachment/no-store/nosniff headers; inert ZIP member names; no submitted URL in job state or console output; and non-loopback binding requiring explicit host configuration.

A mocked process-boundary test exercises the actual constructed extractor commands and checks inherited configuration/plugin/postprocessor suppression, scoped gallery extraction, and a standalone `--` argument before the canonical URL. It does not execute an upstream extractor or establish live platform availability.

## Hosted-page local bridge review

The hosted UI can use an explicitly opened local popup to perform same-origin companion requests and return their results through `postMessage`. This preserves a clean popup URL without a token or media URL in its query, fragment or path. The popup loads its exact trusted parent origins from public health configuration. Both sides check the other window's identity, exact origin, message namespace and connection nonce; no wildcard message target is used. The popup accepts only the application's health, extraction, job status, item and ZIP routes and fixed GET/POST methods. It constructs request headers itself, omits cookies, and rejects redirects. Tokens exist in memory and the bearer header; no browser storage or console logging is used.

`node --test tests/test_bridge.cjs` passed five independent VM tests against the actual popup/client scripts. These exercise hostile and opaque origins, wrong opener/window source, pre-handshake requests, nonce changes, invalid routes and absolute URLs, query-token injection, methods, malformed/extra JSON fields, CRLF token injection, correlated binary Blob bytes, duplicate request IDs, the eight-request concurrency cap, close/cancellation cleanup, clean popup URLs, and spoofed client responses. Storage access fails the fixture immediately. The additional HTTP test verifies that public health exposes the configured origin allowlist without exposing tokens or jobs.

These deterministic tests do not establish browser popup permission, cross-context structured-clone behavior, local-network permission, or browser download completion. Browser acceptance is recorded separately. A hosted-page HTTPS-to-loopback timeout was observed in the delivery environment; browser local-network policy is a plausible cause, not a conclusively isolated diagnosis. The popup bridge is a tested alternate application path, not evidence that a particular browser policy caused the initial timeout.

## MV3 background relay review (2026-10-15)

The hosted application now defaults to an installed Chrome extension; the local popup remains an explicitly selected alternative. Missing extension detection reports installation steps and does not open a fallback window. The extension worker fixes its only fetch endpoint to `http://127.0.0.1:8765`, verifies its own extension sender ID, top frame and exact GitHub Pages origin/project path, and applies the same API method/path/body/token validation in both the isolated content script and worker. Its manifest declares only the local companion host permission and the project's content-script match, with packaged executable code and no cookie/history/storage permissions.

Chrome runtime messaging serializes JSON rather than browser Blob objects. The relay therefore transfers bounded base64 chunks with request IDs, session nonces, monotonically ordered sequence numbers and an acknowledgment before each next chunk. The worker and page enforce concurrency, timeouts and cancellation; the content script ends its internal keepalive heartbeat on disconnect or navigation. Tokens are sent only through in-memory messages and the companion bearer header and are not reflected in response messages. [Chrome message serialization documentation](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#serialization), [service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

`node --test tests/test_extension.cjs tests/test_bridge.cjs` passed twelve checks, including seven extension tests. The extension tests execute the actual manifest validation, worker, isolated content script, page adapter and application integration inside separate VM contexts. Mock Chrome ports force a JSON serialization round trip. A 120 KB multichunk binary payload including ZIP header/control bytes was reconstructed byte-for-byte through the full page/content/worker pipeline. Adversarial checks reject wrong sender/frame/origin/project, wrong page source, pre-handshake requests, changed nonces, arbitrary URLs/query/routes/methods, unsafe or oversized bodies and tokens, duplicate requests and concurrency overflow; cancellation closes streams and missing-extension integration opens no window. Fixtures trap storage/logging access. These are meaningful deterministic protocol tests, not actual Chrome installation or browser permission evidence.

Independent review found a worker/page size-limit mismatch for ZIP overhead; both now allow the same 4 GiB plus 1 MiB transport maximum. This cap is an abuse boundary, not a promise that the browser can buffer that much media within its available memory. No unresolved consequential relay defect was found. Loading the extension in the user's Chrome profile, real extension permissions, service-worker lifetime, companion CORS and actual browser save behavior require separately recorded browser acceptance.

## Remaining deployment and extraction boundaries

- Source-platform extraction changes, login gates, PO tokens, rate limits and authorized-session requirements remain upstream constraints. Deterministic fixtures establish application behavior, not successful downloading from every current platform.
- Temporary media uses a dedicated directory and ready/error jobs expire after one hour. Normal shutdown deletes it; abrupt process termination can leave temporary artifacts. No URL history or application access log is written.
- The companion is designed for trusted local use or a private authenticated HTTPS deployment. Bearer authentication and browser Origin/Host constraints do not replace reverse-proxy isolation or network policy.
- Public GitHub Pages hosting stores only static application files; the user must configure the companion's explicit allowed origin and may encounter browser local-network permission prompts. A private server can serve the UI from the same origin.
- External extractor binaries/packages and FFmpeg carry independent licenses and update/security responsibilities. The application does not claim that an upstream software license permits downloading arbitrary copyrighted material.
