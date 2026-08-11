from __future__ import annotations


def is_allowed_license(license_name: str | None, license_url: str | None = None) -> bool:
    text = f"{license_name or ''} {license_url or ''}".lower()
    if not text.strip():
        return False
    if any(disallowed in text for disallowed in ("nc", "nd", "sa", "sampling")):
        return False
    allowed_markers = ("cc0", "public domain", "pdm", "cc by", "/by/")
    return any(marker in text for marker in allowed_markers)


def normalize_license_name(license_name: str | None) -> str:
    if not license_name:
        return "unknown"
    return " ".join(license_name.replace("_", " ").split())

