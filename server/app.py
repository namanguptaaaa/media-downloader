"""Local media downloader. Run: python -m server.app [--demo]."""
from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.metadata
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import parse_qs, unquote, urlsplit
import zipfile

VERSION = "1.0.0"
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic"}
VIDEO_EXT = {".mp4", ".mkv", ".webm", ".mov", ".m4v"}
MAX_JOB_BYTES = 4 * 1024**3
MAX_JOBS = 12
TTL = 3600


class APIError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def validate_url(value):
    if not isinstance(value, str) or len(value) > 2048 or any(ord(c) < 32 for c in value):
        raise APIError("Enter a valid public post URL.")
    try:
        u = urlsplit(value)
        if u.scheme != "https" or u.username or u.password or u.port not in (None, 443):
            raise ValueError()
    except ValueError:
        raise APIError("Use an HTTPS URL without credentials or a custom port.") from None
    host = (u.hostname or "").lower()
    path = u.path
    if host in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}:
        video_id = path.strip("/") if host == "youtu.be" else (parse_qs(u.query).get("v", [""])[0] if path == "/watch" else path.rstrip("/").split("/")[-1])
        valid_path = host == "youtu.be" or path == "/watch" or re.fullmatch(r"/(shorts|live|embed)/[^/]+/?", path)
        if valid_path and re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            return "YouTube", "https://www.youtube.com/watch?v=" + video_id
    if host in {"x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"}:
        post = re.fullmatch(r"(/(?:[A-Za-z0-9_]+|i/web)/status/\d+)(?:/(?:photo|video)/[1-4])?/?", path)
        if post:
            return "X/Twitter", "https://x.com" + post.group(1)
    if host in {"instagram.com", "www.instagram.com"} and re.fullmatch(r"/(p|reel|tv)/[A-Za-z0-9_-]+/?", path):
        return "Instagram", "https://www.instagram.com" + path.rstrip("/") + "/"
    if host in {"reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com"} and re.fullmatch(r"/(?:r/[A-Za-z0-9_]+/)?comments/[A-Za-z0-9]+(?:/[^?#]*)?", path):
        return "Reddit", "https://www.reddit.com" + path
    if host in {"reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com"} and re.fullmatch(r"/gallery/[A-Za-z0-9]+/?", path):
        return "Reddit", "https://www.reddit.com/comments/" + path.strip("/").split("/")[1]
    if host == "redd.it" and re.fullmatch(r"/[A-Za-z0-9]+/?", path):
        return "Reddit", "https://www.reddit.com/comments/" + path.strip("/")
    raise APIError("Supported URLs are individual YouTube videos, X posts, Instagram posts/reels, and Reddit posts.")


def dependency_version(name):
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def find_ffmpeg(explicit=None):
    candidate = explicit or shutil.which("ffmpeg")
    if candidate and Path(candidate).is_file():
        return str(Path(candidate).resolve())
    if explicit:
        return None
    try:
        import imageio_ffmpeg
        candidate = imageio_ffmpeg.get_ffmpeg_exe()
        return candidate if Path(candidate).is_file() else None
    except (ImportError, RuntimeError):
        return None


class Store:
    def __init__(self, demo=False, cookies=None, ffmpeg=None, js_runtime=None):
        self.root = Path(tempfile.mkdtemp(prefix="private-media-"))
        self.jobs = {}
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=2)
        self.demo = demo
        self.cookies = cookies
        self.ffmpeg = find_ffmpeg(ffmpeg)
        self.js_runtime = js_runtime or ("node:" + shutil.which("node") if shutil.which("node") else None)
        self.stop = threading.Event()
        self.processes = set()
        self.sweeper = threading.Thread(target=self._sweep, daemon=True)
        self.sweeper.start()

    def _sweep(self):
        while not self.stop.wait(60):
            self.cleanup()

    def cleanup(self):
        with self.lock:
            for key, job in list(self.jobs.items()):
                if job["state"] in {"ready", "error"} and time.time() - job["updated"] > TTL:
                    shutil.rmtree(self.root / key, ignore_errors=True)
                    del self.jobs[key]

    def close(self):
        self.stop.set()
        with self.lock:
            for process in list(self.processes):
                self._kill(process)
        self.pool.shutdown(wait=True, cancel_futures=True)
        shutil.rmtree(self.root, ignore_errors=True)

    def get(self, key):
        with self.lock:
            if key not in self.jobs:
                raise APIError("Job not found or expired.", 404)
            return {k: v for k, v in self.jobs[key].items() if k != "updated"}

    def update(self, key, **fields):
        with self.lock:
            self.jobs[key].update(fields, updated=time.time())

    def submit(self, url):
        platform, canonical = validate_url(url)
        self.cleanup()
        with self.lock:
            if len(self.jobs) >= MAX_JOBS:
                raise APIError("Job limit reached. Restart the service or wait for old jobs to expire.", 429)
            key = secrets.token_hex(16)
            self.jobs[key] = dict(id=key, state="queued", phase="Queued", progress=0, title=platform + " media", platform=platform, items=[], updated=time.time())
            (self.root / key).mkdir()
            self.pool.submit(self.extract, key, platform, canonical)
            return key

    @staticmethod
    def _kill(process):
        if process.poll() is not None:
            return
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            import signal
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def run(self, command, folder):
        # Never retain extractor output: upstream errors can contain submitted URLs.
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=os.name != "nt", creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        with self.lock:
            self.processes.add(process)
        start = time.monotonic()
        try:
            while process.poll() is None:
                if self.stop.wait(.25) or time.monotonic() - start > 1200:
                    self._kill(process)
                    raise APIError("Download timed out or service stopped. Try again.")
                size = 0
                for p in folder.rglob("*"):
                    try:
                        if p.is_file():
                            size += p.stat().st_size
                    except FileNotFoundError:
                        # FFmpeg may replace fragments while the watchdog scans.
                        continue
                if size > MAX_JOB_BYTES:
                    self._kill(process)
                    raise APIError("This post exceeds the 4 GB job limit.")
            return process.returncode
        finally:
            if process.poll() is None:
                self._kill(process)
            process.wait()
            with self.lock:
                self.processes.discard(process)

    def extract(self, key, platform, url):
        folder = self.root / key
        try:
            self.update(key, state="running", phase="Downloading original media", progress=10)
            warnings = []
            if self.demo:
                self.demo_files(folder, self.ffmpeg)
            else:
                if not dependency_version("yt-dlp") or not dependency_version("gallery-dl"):
                    raise APIError("Install the dependencies from requirements.txt, then restart the service.")
                ytdlp = [sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-plugin-dirs", "--no-cache-dir", "--no-progress", "--quiet", "--no-warnings", "--socket-timeout", "25", "--retries", "2", "--fragment-retries", "2", "--max-filesize", "4G", "--use-extractors", "youtube,twitter,instagram,reddit", "--format", "bv*+ba/b", "--merge-output-format", "mkv", "--restrict-filenames", "--output", str(folder / "video-%(id)s-%(autonumber)s.%(ext)s")]
                if platform == "YouTube":
                    ytdlp += ["--no-playlist"]
                if self.ffmpeg:
                    ytdlp += ["--ffmpeg-location", self.ffmpeg]
                if self.js_runtime:
                    ytdlp += ["--js-runtimes", self.js_runtime]
                if self.cookies:
                    ytdlp += ["--cookies", self.cookies]
                video_code = self.run(ytdlp + ["--", url], folder) if self.ffmpeg else 1
                if video_code:
                    for p in folder.rglob("*"):
                        if p.is_file() and p.suffix.lower() in VIDEO_EXT:
                            p.unlink()
                    warnings.append("Video extraction did not complete. This may be an image-only post, require login, or need an extractor update." if self.ffmpeg else "Video extraction requires FFmpeg. Original images can still be downloaded.")
                self.update(key, phase="Checking original images", progress=65)
                if platform == "YouTube":
                    # Best available source thumbnail, rather than a resized preview.
                    image_code = self.run(ytdlp + ["--skip-download", "--write-thumbnail", "--", url], folder)
                else:
                    category = {"X/Twitter": "twitter", "Instagram": "instagram", "Reddit": "reddit"}[platform]
                    gallery = [sys.executable, "-m", "gallery_dl", "--config-ignore", "--no-input", "--quiet", "--no-postprocessors", "--cache-file", ":memory:", "--http-timeout", "25", "--retries", "2", "--directory", str(folder), "--windows-filenames", "--range", "1-100", "--whitelist", category, "--filter", "extension.lower() in ('jpg','jpeg','png','webp','gif','avif','heic')", "-o", "extractor.reddit.comments=0", "-o", "extractor.reddit.morecomments=false"]
                    if self.cookies:
                        gallery += ["--cookies", self.cookies]
                    image_code = self.run(gallery + ["--", url], folder)
                if image_code:
                    warnings.append("Image extraction did not complete. This may be a video-only post, require login, or need an extractor update.")
            items = []
            for p in sorted(folder.rglob("*")):
                if p.is_file() and p.suffix.lower() in IMAGE_EXT | VIDEO_EXT and not re.search(r"\.f\d+\.", p.name):
                    # A safe basename keeps Content-Disposition and ZIP entries inert.
                    name = re.sub(r"[^A-Za-z0-9_.-]", "_", p.name)[:180]
                    item_id = str(len(items) + 1)
                    target = folder / (item_id + "-" + name)
                    p.rename(target)
                    items.append(dict(id=item_id, kind="image" if p.suffix.lower() in IMAGE_EXT else "video", filename=target.name, size=target.stat().st_size))
            if not items:
                raise APIError("No downloadable media was returned. The post may require login, be unavailable, or the platform extractor may need an update.")
            if platform == "YouTube" and not self.demo and not any(i["kind"] == "video" for i in items):
                warnings.append("Only a thumbnail was recovered; the YouTube video is unavailable. Install FFmpeg, use a local JS runtime, or update yt-dlp.")
            self.update(key, state="ready", phase="Ready" + (" (demo fixtures)" if self.demo else ""), progress=100, items=items, warnings=warnings)
        except APIError as exc:
            self.update(key, state="error", phase="Failed", progress=0, error=str(exc))
            shutil.rmtree(folder, ignore_errors=True)
        except Exception:
            self.update(key, state="error", phase="Failed", progress=0, error="Extraction failed. Check the dependencies and available disk space, then retry.")
            shutil.rmtree(folder, ignore_errors=True)
        finally:
            # URL only lived in this worker invocation; never serialize it into a job.
            url = None

    @staticmethod
    def demo_files(folder, ffmpeg):
        png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCKsAAAAASUVORK5CYII="
        (folder / "demo-original.png").write_bytes(base64.b64decode(png))
        if ffmpeg:
            subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "mpeg4", "-c:a", "aac", "-shortest", "-y", str(folder / "demo-video.mp4")], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class Handler(BaseHTTPRequestHandler):
    server_version = "PrivateMedia/1.0"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def log_message(self, *_):
        pass

    def response_headers(self, status, kind="application/json", length=None, attachment=None):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:* https:; img-src 'self' blob: data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        origin = self.headers_in_origin
        if origin and origin in self.server.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Expose-Headers", "Content-Disposition")
        if length is not None:
            self.send_header("Content-Length", str(length))
        if attachment:
            self.send_header("Content-Disposition", 'attachment; filename="' + attachment + '"')
        self.end_headers()

    @property
    def headers_in_origin(self):
        return self.headers.get("Origin", "")

    def json(self, status, value):
        body = json.dumps(value).encode()
        self.response_headers(status, length=len(body))
        self.wfile.write(body)

    def guard(self, auth=True):
        if self.headers.get("Host", "").lower() not in self.server.hosts:
            raise APIError("Host is not allowed.", 403)
        origin = self.headers_in_origin
        if origin and origin not in self.server.origins:
            raise APIError("Origin is not allowed.", 403)
        if auth:
            supplied = self.headers.get("Authorization", "")
            if not hmac.compare_digest(supplied.encode("utf-8"), ("Bearer " + self.server.token).encode("utf-8")):
                raise APIError("A valid local service token is required.", 401)

    def body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 8192 or self.headers.get("Transfer-Encoding"):
                raise ValueError()
            value = json.loads(self.rfile.read(length))
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (ValueError, UnicodeDecodeError):
            raise APIError("Send a JSON object smaller than 8 KB.") from None

    def do_OPTIONS(self):
        try:
            self.guard(auth=False)
            self.send_response(204)
            origin = self.headers_in_origin
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Content-Length", "0")
            self.end_headers()
        except APIError as exc:
            self.json(exc.status, {"error": str(exc)})

    def file_for(self, key, item_id):
        job = self.server.store.get(key)
        if job["state"] != "ready":
            raise APIError("Job is not ready.", 409)
        for item in job["items"]:
            if item["id"] == item_id:
                return self.server.store.root / key / item["filename"], item
        raise APIError("Media item not found.", 404)

    def do_GET(self):
        try:
            path = urlsplit(self.path).path
            self.guard(auth=path.startswith("/api/") and path != "/api/health")
            if path == "/api/health":
                return self.json(200, dict(status="ok", version=VERSION, ffmpeg=bool(self.server.store.ffmpeg), yt_dlp=dependency_version("yt-dlp"), gallery_dl=dependency_version("gallery-dl"), js_runtime=bool(self.server.store.js_runtime or shutil.which("deno")), yt_dlp_ejs=dependency_version("yt-dlp-ejs"), demo=self.server.store.demo))
            match = re.fullmatch(r"/api/jobs/([a-f0-9]{32})(?:/files/([0-9]+))?", path)
            if match:
                key, item_id = match.groups()
                if not item_id:
                    return self.json(200, self.server.store.get(key))
                p, item = self.file_for(key, item_id)
                with p.open("rb") as source:
                    self.response_headers(200, mimetypes.guess_type(p.name)[0] or "application/octet-stream", item["size"], item["filename"])
                    shutil.copyfileobj(source, self.wfile)
                return
            if path.startswith("/api/"):
                raise APIError("API route not found.", 404)
            relative = unquote(path).lstrip("/") or "index.html"
            p = (self.server.web / relative).resolve()
            if not p.is_relative_to(self.server.web) or not p.is_file():
                raise APIError("File not found.", 404)
            with p.open("rb") as source:
                self.response_headers(200, mimetypes.guess_type(p.name)[0] or "application/octet-stream", p.stat().st_size)
                shutil.copyfileobj(source, self.wfile)
        except APIError as exc:
            self.json(exc.status, {"error": str(exc)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except OSError:
            self.json(404, {"error": "File no longer available."})

    def do_POST(self):
        try:
            self.guard()
            path = urlsplit(self.path).path
            body = self.body()
            if path == "/api/extract":
                return self.json(202, {"id": self.server.store.submit(body.get("url"))})
            match = re.fullmatch(r"/api/jobs/([a-f0-9]{32})/download", path)
            if match:
                key = match.group(1)
                ids = body.get("item_ids")
                if not isinstance(ids, list) or not ids or len(ids) > 100 or any(not isinstance(i, str) for i in ids):
                    raise APIError("Select between 1 and 100 media item IDs.")
                files = [self.file_for(key, item_id) for item_id in dict.fromkeys(ids)]
                with tempfile.TemporaryFile() as archive:
                    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as z:
                        for p, item in files:
                            z.write(p, item["filename"])
                    length = archive.tell()
                    archive.seek(0)
                    self.response_headers(200, "application/zip", length, "media-" + key[:8] + ".zip")
                    shutil.copyfileobj(archive, self.wfile)
                return
            raise APIError("API route not found.", 404)
        except APIError as exc:
            self.json(exc.status, {"error": str(exc)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except OSError:
            self.json(500, {"error": "Unable to prepare download. Check available disk space."})


def create_server(bind="127.0.0.1", port=8765, token=None, origins=(), hosts=(), demo=False, cookies=None, ffmpeg=None, js_runtime=None):
    if bind not in {"127.0.0.1", "localhost"} and not hosts:
        raise ValueError("Non-loopback binding requires an explicit --public-host behind a private HTTPS reverse proxy.")
    server = ThreadingHTTPServer((bind, port), Handler)
    server.daemon_threads = True
    actual_port = server.server_address[1]
    server.token = token or secrets.token_urlsafe(32)
    server.hosts = {f"127.0.0.1:{actual_port}", f"localhost:{actual_port}"} | {h.lower() for h in hosts}
    server.origins = {f"http://127.0.0.1:{actual_port}", f"http://localhost:{actual_port}"} | set(origins)
    server.web = (Path(__file__).resolve().parent.parent / "web").resolve()
    server.store = Store(demo=demo, cookies=cookies, ffmpeg=ffmpeg, js_runtime=js_runtime)
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--allow-origin", action="append", default=[])
    parser.add_argument("--public-host", action="append", default=[], help="Exact Host header for a private HTTPS reverse proxy")
    parser.add_argument("--cookies", help="Optional private Netscape cookie file for your own authenticated posts")
    parser.add_argument("--ffmpeg-location", help="Path to a local FFmpeg executable (auto-detected by default)")
    parser.add_argument("--js-runtime", help="Local yt-dlp JS runtime, for example node:/path/to/node")
    parser.add_argument("--demo", action="store_true", help="Use synthetic fixtures, with no platform requests")
    args = parser.parse_args()
    for origin in args.allow_origin:
        parsed = urlsplit(origin)
        if parsed.scheme not in {"http", "https", "chrome-extension"} or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username or "*" in origin:
            parser.error("--allow-origin must be an exact origin without path or wildcard")
    if args.cookies and not Path(args.cookies).is_file():
        parser.error("--cookies must point to an existing private cookie file")
    token = os.environ.get("MEDIA_DOWNLOADER_TOKEN")
    if token is not None and (len(token) < 24 or not token.isascii() or any(c.isspace() for c in token)):
        parser.error("MEDIA_DOWNLOADER_TOKEN must contain at least 24 ASCII characters without whitespace")
    try:
        server = create_server(args.bind, args.port, token, args.allow_origin, args.public_host, args.demo, args.cookies, args.ffmpeg_location, args.js_runtime)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(f"Private media downloader: http://{args.bind}:{server.server_address[1]}")
    print("Local service token (paste into the app): " + server.token)
    if args.demo:
        print("DEMO MODE: synthetic local media, no live extraction.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.store.close()


if __name__ == "__main__":
    main()
