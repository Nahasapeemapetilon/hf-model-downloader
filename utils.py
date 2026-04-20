"""
utils.py — Gemeinsame Hilfsfunktionen für HF Downloader.
Keine Flask-, Manager- oder Config-Abhängigkeiten (außer config.py).
"""
import logging
import os
import re
import time

import requests

from config import DOWNLOAD_DIR, _HF_RETRY_STATUSES, _HF_RETRY_DELAYS

logger = logging.getLogger("hf_downloader")

# Valid HuggingFace name pattern
_HF_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")


def fmt_size(num_bytes: int) -> str:
    """Human-readable file size, e.g. '1.23 GB'."""
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(num_bytes) < 1024.0:
            return f"{num_bytes:.2f} {unit}"
        num_bytes /= 1024.0
    return f"{num_bytes:.2f} PB"


def is_valid_hf_name(name: str) -> bool:
    """True if name looks like a valid HuggingFace org or repo identifier."""
    return bool(_HF_NAME_RE.match(name))


def has_any_file(directory: str) -> bool:
    """True if directory contains at least one file anywhere in its subtree."""
    for _, _, files in os.walk(directory):
        if files:
            return True
    return False


def safe_repo_path(repo_id: str) -> str | None:
    """
    Returns the absolute local path for a repo ID.
    Returns None if the path would escape DOWNLOAD_DIR (path traversal protection).
    """
    base   = os.path.realpath(DOWNLOAD_DIR)
    target = os.path.realpath(os.path.join(DOWNLOAD_DIR, repo_id.replace("/", os.sep)))
    if not target.startswith(base + os.sep) and target != base:
        logger.warning(f"[SECURITY] Path-Traversal-Versuch blockiert: '{repo_id}'")
        return None
    return target


def hf_api_call(fn, *args, **kwargs):
    """
    Calls fn(*args, **kwargs) and retries on HF rate-limit (429) or
    temporary unavailability (503) with exponential back-off.
    All other exceptions propagate immediately.
    """
    for attempt, delay in enumerate(_HF_RETRY_DELAYS + [None], start=1):
        try:
            return fn(*args, **kwargs)
        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status in _HF_RETRY_STATUSES and delay is not None:
                logger.warning(
                    f"[HF API] HTTP {status} – Retry {attempt}/{len(_HF_RETRY_DELAYS)} in {delay}s"
                )
                time.sleep(delay)
            else:
                raise
        except Exception:
            raise
    return fn(*args, **kwargs)


_completed_cache: list[str] | None = None
_completed_cache_ts: float = 0.0
_COMPLETED_CACHE_TTL: float = 10.0  # seconds


def invalidate_completed_cache() -> None:
    """Force next get_completed_downloads() call to re-scan the disk."""
    global _completed_cache
    _completed_cache = None


def get_completed_downloads() -> list[str]:
    """
    Scans DOWNLOAD_DIR for local repos.
    Returns sorted list of repo IDs (e.g. 'org/model' or 'gpt2').
    Result is cached for _COMPLETED_CACHE_TTL seconds to avoid repeated disk scans.
    """
    global _completed_cache, _completed_cache_ts
    now = time.monotonic()
    if _completed_cache is not None and now - _completed_cache_ts < _COMPLETED_CACHE_TTL:
        return _completed_cache

    completed = []
    if not os.path.exists(DOWNLOAD_DIR):
        _completed_cache    = []
        _completed_cache_ts = now
        return []

    for item in os.listdir(DOWNLOAD_DIR):
        if not is_valid_hf_name(item):
            logger.debug(f"[SCAN] Übersprungen (ungültiger Name): '{item}'")
            continue
        item_path = os.path.join(DOWNLOAD_DIR, item)
        if not os.path.isdir(item_path):
            continue
        try:
            dir_contents = os.listdir(item_path)
            has_subdirs  = any(os.path.isdir(os.path.join(item_path, s)) for s in dir_contents)
            has_files    = any(os.path.isfile(os.path.join(item_path, s)) for s in dir_contents)

            if has_subdirs:
                for sub in dir_contents:
                    if not is_valid_hf_name(sub):
                        continue
                    sub_path = os.path.join(item_path, sub)
                    if not os.path.isdir(sub_path):
                        continue
                    try:
                        if has_any_file(sub_path):
                            completed.append(f"{item}/{sub}")
                    except OSError:
                        continue
            elif has_files or has_any_file(item_path):
                completed.append(item)
        except OSError:
            continue

    result = sorted(set(completed))
    _completed_cache    = result
    _completed_cache_ts = now
    return result
