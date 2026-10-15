"""Local streaming acceptance; no platform traffic or browser credentials."""
import http.client
import io
import json
import shutil
import threading
import time
import unittest
import zipfile
from unittest.mock import patch
from server.app import create_server


class StreamingTransfer(unittest.TestCase):
    def test_zip_first_bytes_arrive_while_archive_is_still_being_written(self):
        self.transfer()

    def test_interrupted_zip_is_reported_as_failed_http_transfer(self):
        self.transfer(fail=True)

    def transfer(self, fail=False):
        server = create_server(port=0, token="disposable-transfer-token", demo=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        key = "b" * 32
        folder = server.store.root / key; folder.mkdir()
        source = folder / "fixture.mp4"; source.write_bytes(b"z" * (2 * 1024 * 1024))
        server.store.jobs[key] = dict(id=key,state="ready",updated=time.time(),items=[dict(id="1",filename=source.name,size=source.stat().st_size,kind="video")])
        blocked = threading.Event(); release = threading.Event()
        original = shutil.copyfileobj
        def copy(src, dst, length=0):
            if getattr(src, "name", None) == str(source):
                dst.write(src.read(1024 * 1024)); blocked.set()
                if not release.wait(5): raise AssertionError("Client did not receive streaming headers")
                if fail: raise OSError("Disposable read failure")
            return original(src, dst, length)
        connection = http.client.HTTPConnection("127.0.0.1",server.server_address[1],timeout=3)
        try:
            with patch("server.app.shutil.copyfileobj", side_effect=copy):
                connection.request("POST", f"/api/jobs/{key}/download", json.dumps({"item_ids":["1"]}), {"Authorization":"Bearer disposable-transfer-token","Content-Type":"application/json"})
                response = connection.getresponse()
                self.assertEqual(response.status,200)
                self.assertTrue(blocked.wait(2))
                first = response.read(4)
                self.assertEqual(first,b"PK\x03\x04")
                self.assertFalse(release.is_set(), "Headers and ZIP bytes must arrive before the archive finishes")
                release.set()
                if fail:
                    with self.assertRaises(http.client.IncompleteRead): response.read()
                    return
                content = first + response.read()
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                self.assertIsNone(archive.testzip())
                self.assertEqual(archive.read(source.name), source.read_bytes())
        finally:
            release.set(); connection.close(); server.shutdown(); server.server_close(); server.store.close(); thread.join(2)

if __name__ == "__main__": unittest.main()
