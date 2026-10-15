"""Isolated unit and HTTP integration checks; no platform requests."""
import http.client
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import wave
from unittest.mock import patch
import zipfile

from server.app import APIError, Store, create_server, validate_url


class URLTests(unittest.TestCase):
    def test_platform_posts_and_tracking_removed(self):
        cases = {
            "https://youtu.be/jNQXAC9IVRw?si=tracking": "YouTube",
            "https://www.youtube.com/watch?v=jNQXAC9IVRw&list=other": "YouTube",
            "https://www.youtube.com/shorts/jNQXAC9IVRw": "YouTube",
            "https://www.youtube.com/shorts/jNQXAC9IVRw/": "YouTube",
            "https://x.com/user/status/123?tracking=1": "X/Twitter",
            "https://twitter.com/i/web/status/123": "X/Twitter",
            "https://x.com/user/status/123/photo/1?tracking=1": "X/Twitter",
            "https://www.instagram.com/p/abc123/": "Instagram",
            "https://old.reddit.com/r/test/comments/abc123/title/": "Reddit",
            "https://www.reddit.com/gallery/abc123?utm_source=tracking": "Reddit",
            "https://redd.it/abc123": "Reddit",
        }
        for url, platform in cases.items():
            with self.subTest(url=url):
                actual, canonical = validate_url(url)
                self.assertEqual(actual, platform)
                self.assertNotIn("tracking", canonical)

    def test_reject_proxy_targets_profiles_credentials_and_ports(self):
        for value in [None, "http://x.com/user/status/123", "https://127.0.0.1/", "https://x.com.evil.test/u/status/1", "https://user:password@x.com/u/status/1", "https://x.com:123/u/status/1", "https://x.com/profile", "https://www.youtube.com/playlist?list=123", "https://instagram.com/user/", "https://x.com/u/status/1\n"]:
            with self.subTest(value=value), self.assertRaises(APIError):
                validate_url(value)


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = create_server(port=0, token="test-token-only", origins=["https://example.github.io"], demo=True)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.server.store.close()

    def request(self, method, path, data=None, token=True, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        request_headers = {"Authorization": "Bearer test-token-only"} if token else {}
        if data is not None:
            request_headers["Content-Type"] = "application/json"
            data = json.dumps(data)
        request_headers.update(headers or {})
        connection.request(method, path, data, request_headers)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_health_public_and_auth_required(self):
        status, _, body = self.request("GET", "/api/health", token=False)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["demo"])
        self.assertIn("https://example.github.io", json.loads(body)["allowed_origins"])
        self.assertNotIn("*", json.loads(body)["allowed_origins"])
        self.assertNotIn("test-token-only", body.decode())
        for path in ["/api/extract", "/api/jobs/" + "a" * 32]:
            method = "POST" if path.endswith("extract") else "GET"
            self.assertEqual(self.request(method, path, {"url": "https://youtu.be/jNQXAC9IVRw"} if method == "POST" else None, token=False)[0], 401)

    def test_host_and_origin_guards(self):
        self.assertEqual(self.request("GET", "/api/health", headers={"Host": "evil.test"})[0], 403)
        self.assertEqual(self.request("GET", "/api/health", headers={"Origin": "https://evil.test"})[0], 403)
        self.assertEqual(self.request("GET", "/api/health", headers={"Origin": "https://example.github.io.evil.test"})[0], 403)
        self.assertEqual(self.request("GET", "/api/health", headers={"Origin": "null"})[0], 403)
        status, headers, _ = self.request("OPTIONS", "/api/extract", token=False, headers={"Origin": "https://example.github.io"})
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://example.github.io")
        self.assertNotEqual(headers["Access-Control-Allow-Origin"], "*")

    def test_complete_job_file_and_zip_path(self):
        status, _, body = self.request("POST", "/api/extract", {"url": "https://youtu.be/jNQXAC9IVRw?si=private-marker"})
        self.assertEqual(status, 202)
        key = json.loads(body)["id"]
        for _ in range(100):
            status, _, body = self.request("GET", "/api/jobs/" + key)
            job = json.loads(body)
            if job["state"] in {"ready", "error"}:
                break
            time.sleep(.05)
        self.assertEqual(job["state"], "ready", job)
        self.assertNotIn("private-marker", body.decode())
        self.assertNotIn("url", job)
        self.assertEqual(job["progress"], 100)
        item = job["items"][0]
        status, headers, content = self.request("GET", f"/api/jobs/{key}/files/{item['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(len(content), item["size"])
        self.assertIn("attachment", headers["Content-Disposition"])
        status, _, archive = self.request("POST", f"/api/jobs/{key}/download", {"item_ids": [i["id"] for i in job["items"]]})
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            self.assertEqual(len(z.namelist()), len(job["items"]))
            self.assertEqual(z.read(item["filename"]), content)
        self.assertEqual(self.request("GET", f"/api/jobs/{key}/files/999")[0], 404)
        self.assertEqual(self.request("POST", f"/api/jobs/{key}/download", {"item_ids": []})[0], 400)

    def test_invalid_json_and_url(self):
        self.assertEqual(self.request("POST", "/api/extract", {"url": "https://localhost/private"})[0], 400)
        self.assertEqual(self.request("POST", "/api/extract", None)[0], 400)
        self.assertEqual(self.request("GET", "/api/jobs/" + "0" * 32)[0], 404)

    def test_real_demo_wav_clip_download_and_decode(self):
        if not self.server.store.ffmpeg:
            self.skipTest("Local FFmpeg unavailable")
        status, _, body = self.request("POST", "/api/extract", {"url": "https://youtu.be/jNQXAC9IVRw", "options": {"format": "wav", "start_seconds": .2, "end_seconds": .8}})
        self.assertEqual(status, 202)
        key = json.loads(body)["id"]
        for _ in range(200):
            _, _, body = self.request("GET", "/api/jobs/" + key)
            job = json.loads(body)
            if job["state"] in {"ready", "error"}:
                break
            time.sleep(.05)
        self.assertEqual(job["state"], "ready", job)
        self.assertEqual(job["options"]["format"], "wav")
        self.assertEqual({item["kind"] for item in job["items"]}, {"image", "audio"})
        audio = next(item for item in job["items"] if item["kind"] == "audio")
        status, _, content = self.request("GET", f"/api/jobs/{key}/files/{audio['id']}")
        self.assertEqual(status, 200)
        with wave.open(io.BytesIO(content)) as decoded:
            self.assertAlmostEqual(decoded.getnframes() / decoded.getframerate(), .6, delta=.02)
            self.assertEqual(decoded.getsampwidth(), 2)
        self.assertTrue(job["warnings"])

    def test_static_traversal_rejected(self):
        self.assertEqual(self.request("GET", "/%2e%2e/server/app.py")[0], 404)


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.store = Store()
        self.key = "a" * 32
        self.folder = self.store.root / self.key
        self.folder.mkdir()
        self.store.jobs[self.key] = dict(id=self.key, state="queued", items=[], updated=time.time())

    def tearDown(self):
        self.store.close()

    def test_failed_video_fragments_not_exposed_and_partial_warned(self):
        self.store.ffmpeg = "local-ffmpeg"
        def fake_run(command, folder):
            if "--skip-download" in command:
                (folder / "thumbnail.jpg").write_bytes(b"original-image")
                return 0
            (folder / "video-id.f137.mp4").write_bytes(b"unmerged-no-audio")
            return 1
        with patch("server.app.dependency_version", return_value="test"), patch.object(self.store, "run", side_effect=fake_run):
            self.store.extract(self.key, "YouTube", "https://www.youtube.com/watch?v=jNQXAC9IVRw")
        job = self.store.get(self.key)
        self.assertEqual(job["state"], "ready")
        self.assertEqual([i["kind"] for i in job["items"]], ["image"])
        self.assertTrue(job["warnings"])

    def test_image_only_posts_work_without_ffmpeg(self):
        self.store.ffmpeg = None
        def fake_run(command, folder):
            self.assertIn("gallery_dl", command)
            (folder / "original.png").write_bytes(b"original")
            return 0
        with patch("server.app.dependency_version", return_value="test"), patch.object(self.store, "run", side_effect=fake_run):
            self.store.extract(self.key, "Instagram", "https://www.instagram.com/p/test/")
        self.assertEqual(self.store.get(self.key)["state"], "ready")
        self.assertIn("FFmpeg", self.store.get(self.key)["warnings"][0])

    def test_completed_jobs_expire_and_cleanup(self):
        self.store.jobs[self.key].update(state="ready", updated=time.time() - 4000)
        self.store.cleanup()
        self.assertFalse(self.folder.exists())
        with self.assertRaises(APIError):
            self.store.get(self.key)


if __name__ == "__main__":
    unittest.main()
