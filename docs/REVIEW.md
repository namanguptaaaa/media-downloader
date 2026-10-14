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

## Residual boundaries

- Source-platform extraction changes, login gates, PO tokens, rate limits and authorized-session requirements remain upstream constraints. Deterministic fixtures establish application behavior, not successful downloading from every current platform.
- Temporary media uses a dedicated directory and ready/error jobs expire after one hour. Normal shutdown deletes it; abrupt process termination can leave temporary artifacts. No URL history or application access log is written.
- The companion is designed for trusted local use or a private authenticated HTTPS deployment. Bearer authentication and browser Origin/Host constraints do not replace reverse-proxy isolation or network policy.
- Public GitHub Pages hosting stores only static application files; the user must configure the companion's explicit allowed origin and may encounter browser local-network permission prompts. A private server can serve the UI from the same origin.
- External extractor binaries/packages and FFmpeg carry independent licenses and update/security responsibilities. The application does not claim that an upstream software license permits downloading arbitrary copyrighted material.
