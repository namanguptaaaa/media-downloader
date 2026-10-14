# Independent review and acceptance evidence

Reviewed backend `server/app.py`, static `web/app.js` and markup, dependency requirements, and the extraction/privacy architecture on 2026-10-14. Browser/live-platform validation is recorded separately by the delivery agent.

## Findings resolved during implementation

- A failed YouTube video download could previously produce a successful thumbnail-only result without disclosure. Backend now includes extraction warnings and an explicit thumbnail-only warning; frontend displays partial-result warnings. A regression test simulates this exact failure.
- YouTube runtime/EJS requirements were absent from health status. Backend now reports these prerequisites and supports local JS-runtime configuration, including explicit Node enablement; frontend surfaces missing prerequisites.

## Deterministic verification

`python -m unittest discover -s tests -v` passed eight tests against a disposable in-process companion with real loopback HTTP connections. The execution sandbox denies loopback socket connections, so the successful run used approved escalation. No platform account, production credentials or real submitted media were accessed.

Coverage: bearer-token rejection; hostile Host and Origin rejection; explicit-origin preflight; opaque/null-origin denial; unsupported URL/credential/custom-port/profile rejection without creating jobs; canonical tracking-query removal; static traversal and unknown-route denial; synthetic extraction, status polling, item download and ZIP bytes; attachment/no-store/nosniff headers; inert ZIP member names; no submitted URL in job state or console output; and non-loopback binding requiring explicit host configuration.

A mocked process-boundary test exercises the actual constructed extractor commands and checks inherited configuration/plugin/postprocessor suppression, scoped gallery extraction, and a standalone `--` argument before the canonical URL. It does not execute an upstream extractor or establish live platform availability.

## Residual boundaries

- Source-platform extraction changes, login gates, PO tokens, rate limits and authorized-session requirements remain upstream constraints. Deterministic fixtures establish application behavior, not successful downloading from every current platform.
- Temporary media uses a dedicated directory and ready/error jobs expire after one hour. Normal shutdown deletes it; abrupt process termination can leave temporary artifacts. No URL history or application access log is written.
- The companion is designed for trusted local use or a private authenticated HTTPS deployment. Bearer authentication and browser Origin/Host constraints do not replace reverse-proxy isolation or network policy.
- Public GitHub Pages hosting stores only static application files; the user must configure the companion's explicit allowed origin and may encounter browser local-network permission prompts. A private server can serve the UI from the same origin.
- External extractor binaries/packages and FFmpeg carry independent licenses and update/security responsibilities. The application does not claim that an upstream software license permits downloading arbitrary copyrighted material.
