"""Deterministic local HTTP acceptance tests; no platform network or credentials."""
import contextlib
import http.client
import io
import json
import threading
import time
import unittest
from unittest.mock import patch
import zipfile

from server.app import create_server, validate_url, Store


class HTTPAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.token = "test-only-disposable-token-123456789"
        cls.server = create_server(port=0, token=cls.token, origins=("https://private.example",), demo=True)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.server.store.close()
        cls.thread.join(timeout=2)

    def request(self, method, path, body=None, auth=True, headers=None):
        request_headers = {"Authorization": "Bearer " + self.token} if auth else {}
        request_headers.update(headers or {})
        encoded = json.dumps(body).encode() if body is not None else None
        if encoded is not None:
            request_headers.setdefault("Content-Type", "application/json")
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            connection.request(method, path, body=encoded, headers=request_headers)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_auth_host_origin_boundaries(self):
        self.assertEqual(self.request("POST", "/api/extract", {"url": "https://youtu.be/BaW_jenozKc"}, auth=False)[0], 401)
        self.assertEqual(self.request("GET", "/api/jobs/" + "0" * 32, headers={"Authorization": "Bearer invalid"})[0], 401)
        self.assertEqual(self.request("GET", "/api/health", auth=False, headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.request("GET", "/api/health", auth=False, headers={"Origin": "https://evil.example"})[0], 403)
        status, headers, _ = self.request("OPTIONS", "/api/extract", auth=False, headers={"Origin": "https://private.example"})
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://private.example")
        self.assertEqual(self.request("OPTIONS", "/api/extract", auth=False, headers={"Origin": "null"})[0], 403)

    def test_unknown_routes_and_traversal(self):
        self.assertEqual(self.request("GET", "/api/unknown")[0], 404)
        self.assertEqual(self.request("GET", "/api/jobs/" + "0" * 32)[0], 404)
        for path in ("/../server/app.py", "/%2e%2e/server/app.py", "/%2e%2e%5cserver%5capp.py", "/.git/config"):
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path, auth=False)[0], 404)

    def test_untrusted_urls_rejected_without_jobs(self):
        before = len(self.server.store.jobs)
        values = ["http://127.0.0.1/", "https://localhost/", "https://youtube.com.evil.example/watch?v=BaW_jenozKc", "https://evil.example/", "file:///etc/passwd", "https://user:pass@www.youtube.com/watch?v=BaW_jenozKc", "https://www.youtube.com:444/watch?v=BaW_jenozKc", "https://www.youtube.com/@account", "https://x.com/account", "https://www.instagram.com/account/", None, 7]
        for value in values:
            with self.subTest(url=value):
                status, _, _ = self.request("POST", "/api/extract", {"url": value})
                self.assertEqual(status, 400)
        self.assertEqual(len(self.server.store.jobs), before)

    def test_demo_extract_poll_download_zip_privacy(self):
        source_url = "https://www.youtube.com/watch?v=BaW_jenozKc&private_query=must-not-persist"
        with contextlib.redirect_stdout(io.StringIO()) as stdout, contextlib.redirect_stderr(io.StringIO()) as stderr:
            status, headers, data = self.request("POST", "/api/extract", {"url": source_url})
            self.assertEqual(status, 202)
            key = json.loads(data)["id"]
            for _ in range(100):
                status, headers, data = self.request("GET", "/api/jobs/" + key)
                job = json.loads(data)
                if job["state"] in ("ready", "error"):
                    break
                time.sleep(.05)
            self.assertEqual(job["state"], "ready", job)
            self.assertIn("demo", job["phase"])
            self.assertEqual(headers["Cache-Control"], "no-store")
            self.assertNotIn(source_url, data.decode())
            self.assertNotIn("private_query", json.dumps(self.server.store.jobs))
            item = job["items"][0]
            status, headers, media = self.request("GET", f"/api/jobs/{key}/files/{item['id']}")
            self.assertEqual(status, 200)
            self.assertEqual(len(media), item["size"])
            self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
            self.assertIn("attachment;", headers["Content-Disposition"])
            self.assertEqual(self.request("GET", f"/api/jobs/{key}/files/{item['id']}", auth=False)[0], 401)
            status, _, archive = self.request("POST", f"/api/jobs/{key}/download", {"item_ids": [i["id"] for i in job["items"]]})
            self.assertEqual(status, 200)
            with zipfile.ZipFile(io.BytesIO(archive)) as z:
                self.assertEqual(len(z.namelist()), len(job["items"]))
                self.assertTrue(all("/" not in n and "\\" not in n and ".." not in n for n in z.namelist()))
                self.assertEqual(z.read(item["filename"]), media)
            self.assertEqual(self.request("POST", f"/api/jobs/{key}/download", {"item_ids": ["../../server/app.py"]})[0], 404)
            self.assertEqual(self.request("POST", f"/api/jobs/{key}/download", {"item_ids": []})[0], 400)
        self.assertNotIn(source_url, stdout.getvalue() + stderr.getvalue())

    def test_nonloopback_requires_explicit_host(self):
        with self.assertRaises(ValueError):
            create_server(bind="0.0.0.0", port=0)

    def test_url_canonicalization_drops_tracking(self):
        cases = {
            "https://youtu.be/BaW_jenozKc?t=2": ("YouTube", "https://www.youtube.com/watch?v=BaW_jenozKc"),
            "https://twitter.com/owner/status/123?tracking=secret": ("X/Twitter", "https://x.com/owner/status/123"),
            "https://instagram.com/reel/ABC_123/?tracking=secret": ("Instagram", "https://www.instagram.com/reel/ABC_123/"),
            "https://redd.it/abc123?tracking=secret": ("Reddit", "https://www.reddit.com/comments/abc123"),
        }
        for url, expected in cases.items():
            self.assertEqual(validate_url(url), expected)

    def test_extractor_commands_disable_inherited_config_and_no_arbitrary_args(self):
        store = Store(ffmpeg="local-disposable-ffmpeg")
        store.ffmpeg = "local-disposable-ffmpeg"
        commands = []
        def fake_run(command, folder):
            commands.append(command)
            (folder / "fixture.mp4").write_bytes(b"disposable video fixture")
            return 0
        try:
            with patch("server.app.dependency_version", return_value="test-version"), patch("server.app.shutil.which", return_value="local-ffmpeg"), patch.object(store, "run", side_effect=fake_run):
                key = store.submit("https://x.com/owner/status/123?secret=removed")
                for _ in range(100):
                    job = store.get(key)
                    if job["state"] in ("ready", "error"):
                        break
                    time.sleep(.01)
                self.assertEqual(job["state"], "ready", job)
            video = next(c for c in commands if "yt_dlp" in c)
            gallery = next(c for c in commands if "gallery_dl" in c)
            self.assertTrue({"--ignore-config", "--no-plugin-dirs", "--no-cache-dir"}.issubset(video))
            self.assertTrue({"--config-ignore", "--no-postprocessors", "--no-input", "--whitelist"}.issubset(gallery))
            self.assertEqual(video[-2:], ["--", "https://x.com/owner/status/123"])
            self.assertEqual(gallery[-2:], ["--", "https://x.com/owner/status/123"])
            self.assertNotIn("secret", repr(commands))
        finally:
            store.close()

    def test_thumbnail_only_result_discloses_failed_video(self):
        store = Store()
        store.ffmpeg = "local-disposable-ffmpeg"
        def fake_run(command, folder):
            if "--write-thumbnail" in command:
                (folder / "thumbnail.jpg").write_bytes(b"disposable image fixture")
                return 0
            return 1
        try:
            with patch("server.app.dependency_version", return_value="test-version"), patch.object(store, "run", side_effect=fake_run):
                key = store.submit("https://youtu.be/BaW_jenozKc")
                for _ in range(100):
                    job = store.get(key)
                    if job["state"] in ("ready", "error"):
                        break
                    time.sleep(.01)
                self.assertEqual(job["state"], "ready", job)
                self.assertEqual([i["kind"] for i in job["items"]], ["image"])
                self.assertTrue(any("thumbnail" in w.lower() for w in job["warnings"]))
        finally:
            store.close()


if __name__ == "__main__":
    unittest.main()
