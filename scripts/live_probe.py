"""Opt-in live HTTP smoke test. URLs stay in memory and are never printed.

python scripts/live_probe.py --endpoint http://127.0.0.1:8765 --url HTTPS_POST
Set MEDIA_DOWNLOADER_TOKEN in the environment. Starts no server.
"""
import argparse
import json
import os
import time
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default="http://127.0.0.1:8765")
    parser.add_argument("--url", action="append", required=True)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    token = os.environ.get("MEDIA_DOWNLOADER_TOKEN")
    if not token:
        parser.error("Set MEDIA_DOWNLOADER_TOKEN to your companion token.")

    def request(path, payload=None):
        data = json.dumps(payload).encode() if payload else None
        req = urllib.request.Request(args.endpoint.rstrip("/") + path, data=data,
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)

    health = request("/api/health")
    if health.get("demo"):
        parser.error("Live probe requires a server without --demo.")
    jobs = [request("/api/extract", {"url": url})["id"] for url in args.url]
    deadline = time.monotonic() + args.timeout
    pending = set(jobs)
    failed = False
    while pending and time.monotonic() < deadline:
        for key in list(pending):
            job = request("/api/jobs/" + key)
            if job["state"] in {"ready", "error"}:
                print(json.dumps({"platform": job["platform"], "state": job["state"],
                    "items": [{"kind": item["kind"], "size": item["size"]} for item in job["items"]],
                    "warnings": job.get("warnings", []), "error": job.get("error")}))
                pending.remove(key)
                failed |= job["state"] == "error"
        if pending:
            time.sleep(1)
    if pending:
        print(json.dumps({"state": "timeout", "remaining_jobs": len(pending)}))
        failed = True
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
