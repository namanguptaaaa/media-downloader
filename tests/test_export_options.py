"""Independent local export acceptance; synthetic inputs and no platform traffic."""
import http.client
import json
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from server.app import APIError, Store, create_server, normalize_options, format_selector

URL = "https://youtu.be/BaW_jenozKc"
FFMPEG = Path(__file__).resolve().parents[1] / ".deps/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe"


def settled(store, key):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        job = store.get(key)
        if job["state"] in {"ready", "error"}:
            return job
        time.sleep(.025)
    raise AssertionError("Disposable export did not settle")


class OptionBoundaries(unittest.TestCase):
    def test_invalid_options_create_no_jobs(self):
        store = Store(demo=True)
        invalid = [True, [], "--exec malicious", {"unknown": 1}, {"format": "mp4;evil"}, {"format": True}, {"max_height": True}, {"max_height": 999}, {"audio_bitrate": True}, {"audio_bitrate": 999}, {"start_seconds": True}, {"start_seconds": float("nan")}, {"start_seconds": float("inf")}, {"start_seconds": -1}, {"end_seconds": True}, {"end_seconds": float("nan")}, {"end_seconds": 86401}, {"format": "original", "start_seconds": 1}, {"format": "mp4", "start_seconds": 2, "end_seconds": 1}, {"format": "mp3", "max_height": 720}, {"format": "wav", "audio_bitrate": 128}]
        try:
            for options in invalid:
                with self.subTest(options=options), self.assertRaises(APIError):
                    store.submit(URL, options)
            self.assertEqual(store.jobs, {})
        finally:
            store.close()

    def test_http_rejects_unknown_root_keys(self):
        server = create_server(port=0, token="disposable-local-test-token", demo=True)
        worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
        try:
            connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
            connection.request("POST", "/api/extract", json.dumps({"url": URL, "args": ["--exec", "evil"]}), {"Authorization": "Bearer disposable-local-test-token", "Content-Type": "application/json"})
            response = connection.getresponse(); response.read(); connection.close()
            self.assertEqual(response.status, 400)
            self.assertEqual(server.store.jobs, {})
        finally:
            server.shutdown(); server.server_close(); server.store.close(); worker.join(timeout=2)

    def test_original_quality_default_and_no_reencoding(self):
        self.assertEqual(format_selector(normalize_options()), "bv*+ba/b")
        self.assertEqual(format_selector(normalize_options({"max_height": 720})), "bv*[height<=720]+ba/b[height<=720]")
        store = Store()
        try:
            source = store.root / "source.webm"; source.write_bytes(b"original encoding untouched")
            with patch.object(store, "run", side_effect=AssertionError("Default must not convert")):
                self.assertEqual(store.convert_exports(store.root, normalize_options()), 0)
            self.assertEqual(source.read_bytes(), b"original encoding untouched")
        finally:
            store.close()

    def test_x_primary_failure_retries_syndication_once_directly(self):
        store = Store(); store.ffmpeg = str(FFMPEG); calls = []
        def run(command, folder):
            calls.append(list(command))
            if "gallery_dl" in command: return 0
            if "twitter:api=syndication" not in command:
                (folder / "unsafe.f137.mp4").write_bytes(b"failed partial")
                return 1
            self.assertFalse((folder / "unsafe.f137.mp4").exists())
            (folder / "complete.mp4").write_bytes(b"recovered video")
            return 0
        try:
            with patch("server.app.dependency_version", return_value="fixture"), patch.object(store, "run", side_effect=run):
                job = settled(store, store.submit("https://x.com/NASA/status/623160978427936768"))
            self.assertEqual(job["state"], "ready", job)
            video_calls = [c for c in calls if "yt_dlp" in c]
            self.assertEqual(len(video_calls), 2)
            self.assertEqual(sum("twitter:api=syndication" in c for c in calls), 1)
            self.assertNotIn("ssstwitter", repr(calls)); self.assertNotIn("yout.com", repr(calls))
            self.assertTrue(any("omit" in warning for warning in job["warnings"]))
        finally:
            store.close()


@unittest.skipUnless(FFMPEG.is_file(), "Install a local FFmpeg binary for synthetic export acceptance")
class FFmpegAcceptance(unittest.TestCase):
    def fixture(self, folder, audio=True):
        source = folder / "source.mp4"
        command = [str(FFMPEG), "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=25:d=2"]
        if audio: command += ["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "aac"]
        command += ["-c:v", "mpeg4", "-y", str(source)]
        subprocess.run(command, check=True, capture_output=True, timeout=15)
        return source

    def test_real_mp4_mp3_wav_clips_decode_and_have_expected_streams(self):
        for format_name in ("mp4", "mp3", "wav"):
            with self.subTest(format=format_name):
                store = Store(ffmpeg=str(FFMPEG))
                try:
                    original = self.fixture(store.root)
                    image = store.root / "original-image.jpg"; image.write_bytes(b"image fixture")
                    options = normalize_options({"format": format_name, "start_seconds": .25, "end_seconds": 1.25})
                    self.assertEqual(store.convert_exports(store.root, options), 1)
                    target = store.root / ("export-1." + format_name)
                    self.assertFalse(original.exists()); self.assertEqual(image.read_bytes(), b"image fixture")
                    decoded = subprocess.run([str(FFMPEG), "-v", "error", "-i", str(target), "-map", "0:a:0", "-f", "s16le", "-ac", "1", "-ar", "8000", "pipe:1"], capture_output=True, check=True, timeout=15)
                    self.assertAlmostEqual(len(decoded.stdout) / 16000, 1, delta=.09)
                    probe = subprocess.run([str(FFMPEG), "-hide_banner", "-i", str(target), "-f", "null", "-"], capture_output=True, check=True, timeout=15).stderr.decode(errors="replace")
                    self.assertIn("Audio:", probe)
                    if format_name == "mp4": self.assertIn("Video: h264", probe); self.assertIn("Audio: aac", probe)
                    else: self.assertNotIn("Video:", probe)
                finally:
                    store.close()

    def test_missing_audio_and_out_of_range_clip_remove_failed_export(self):
        for audio, start in ((False, 0), (True, 3)):
            with self.subTest(audio=audio, start=start):
                store = Store(ffmpeg=str(FFMPEG))
                try:
                    self.fixture(store.root, audio=audio)
                    options = normalize_options({"format": "mp3", "start_seconds": start})
                    with self.assertRaises(APIError): store.convert_exports(store.root, options)
                    self.assertFalse((store.root / "export-1.mp3").exists())
                finally:
                    store.close()


if __name__ == "__main__":
    unittest.main()
