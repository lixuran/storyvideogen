from __future__ import annotations

import ipaddress
import mimetypes
import socket
import urllib.parse
import urllib.request
from pathlib import Path


def download_image(
    url: str,
    output_dir: Path,
    stem: str,
    timeout_seconds: int = 15,
    max_bytes: int = 12_000_000,
) -> Path:
    _validate_remote_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": "storyvideogen/0.1"})
    opener = urllib.request.build_opener(_SafeRedirectHandler())
    with opener.open(request, timeout=timeout_seconds) as response:
        _validate_remote_url(response.geturl())
        content_type = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if not content_type.startswith("image/"):
            raise ValueError(f"URL did not return an image: {url}")
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > max_bytes:
            raise ValueError(f"Image exceeds maximum size: {url}")
        suffix = mimetypes.guess_extension(content_type) or ".jpg"
        data = _read_limited(response, max_bytes)

    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{stem}{suffix}"
    path.write_bytes(data)
    return path


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    max_redirections = 3

    def redirect_request(self, req: urllib.request.Request, fp: object, code: int, msg: str, headers: object, newurl: str) -> urllib.request.Request | None:
        _validate_remote_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _validate_remote_url(url: str) -> None:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Image downloads require a public HTTPS URL.")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise ValueError("Image download host could not be resolved.") from error
    if not addresses or any(not ipaddress.ip_address(address[4][0]).is_global for address in addresses):
        raise ValueError("Image download host is not public.")


def _read_limited(response: object, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = response.read(65_536)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise ValueError("Image exceeds maximum size.")
        chunks.append(chunk)
    return b"".join(chunks)
