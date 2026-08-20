from __future__ import annotations

import imghdr
import re
from pathlib import Path

ALLOWED_IMAGE_TYPES = {
    "jpeg": ".jpg",
    "png": ".png",
    "gif": ".gif",
    "webp": ".webp",
    "bmp": ".bmp",
}


class UploadValidationError(ValueError):
    pass


def validate_upload_size(content_length: object, max_bytes: int) -> None:
    try:
        size = int(str(content_length or "0"))
    except ValueError as exc:
        raise UploadValidationError("Invalid upload size.") from exc
    if size <= 0:
        raise UploadValidationError("Upload body is empty.")
    if size > max_bytes:
        raise UploadValidationError(f"Upload is too large. Max size is {max_bytes} bytes.")


def validate_image_file(path: Path) -> str:
    detected = imghdr.what(path)
    if detected not in ALLOWED_IMAGE_TYPES:
        raise UploadValidationError("Uploaded file is not a supported image.")
    return ALLOWED_IMAGE_TYPES[detected]


def safe_upload_filename(filename: object, fallback: str = "upload") -> str:
    stem = Path(str(filename or fallback)).stem
    stem = re.sub(r"[^A-Za-z0-9_.-]+", "-", stem).strip(".-")
    return stem[:80] or fallback
