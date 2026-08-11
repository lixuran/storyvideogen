from __future__ import annotations

import os


def get_zai_api_key() -> str:
    api_key = os.environ.get("ZAI_API_KEY") or os.environ.get("ZHIPUAI_API_KEY")
    if not api_key:
        raise RuntimeError("ZAI_API_KEY is required for ZAI-powered generation.")
    return api_key


def load_zai_client() -> object:
    try:
        from zai import ZaiClient

        return ZaiClient
    except ImportError:
        from zai import ZhipuAiClient

        return ZhipuAiClient


def message_content(response: object) -> str:
    try:
        message = response.choices[0].message
    except (AttributeError, IndexError, TypeError) as exc:
        raise ValueError("ZAI response did not contain choices[0].message.") from exc

    if isinstance(message, dict):
        content = message.get("content")
    else:
        content = getattr(message, "content", None)
    if not isinstance(content, str):
        raise ValueError("ZAI response message did not contain string content.")
    return content
