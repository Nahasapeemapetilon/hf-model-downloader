"""routes/settings.py — App-Einstellungen (Bandbreite etc.)"""
import logging
import os
import shutil
import threading
import time

from flask import Blueprint, jsonify, request

from config import DOWNLOAD_DIR, get_hf_token, set_hf_token_runtime, _hf_token_env
from managers.download_manager import app_settings, _save_settings

logger = logging.getLogger("hf_downloader")

settings_bp = Blueprint("settings", __name__)

# --- Disk breakdown cache (computed in background thread) ---
_breakdown_lock  = threading.Lock()
_breakdown_cache = {"result": None, "computing": False, "computed_at": 0.0}
_BREAKDOWN_TTL   = 300  # seconds


def _dir_size(path: str) -> int:
    total = 0
    for dirpath, _, filenames in os.walk(path):
        for f in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, f))
            except OSError:
                pass
    return total


def _compute_breakdown() -> None:
    entries = []
    try:
        for name in os.listdir(DOWNLOAD_DIR):
            item_path = os.path.join(DOWNLOAD_DIR, name)
            if not os.path.isdir(item_path):
                continue
            sub_items = os.listdir(item_path)
            sub_dirs  = [s for s in sub_items if os.path.isdir(os.path.join(item_path, s))]
            # Org-level folder: all children are subdirs → treat each sub as own entry
            if sub_dirs and len(sub_dirs) == len(sub_items):
                for sub in sub_dirs:
                    size = _dir_size(os.path.join(item_path, sub))
                    entries.append({"name": f"{name}/{sub}", "size": size})
            else:
                entries.append({"name": name, "size": _dir_size(item_path)})
    except OSError as e:
        logger.warning(f"[DISK] breakdown scan error: {e}")

    entries.sort(key=lambda x: x["size"], reverse=True)
    with _breakdown_lock:
        _breakdown_cache["result"]      = entries
        _breakdown_cache["computed_at"] = time.time()
        _breakdown_cache["computing"]   = False


def _trigger_breakdown() -> None:
    with _breakdown_lock:
        if _breakdown_cache["computing"]:
            return
        _breakdown_cache["computing"] = True
    threading.Thread(target=_compute_breakdown, daemon=True).start()


@settings_bp.route("/api/settings/bandwidth", methods=["GET"])
def get_bandwidth():
    return jsonify({"bandwidth_limit_mbps": app_settings.get("bandwidth_limit_mbps", 0)})


@settings_bp.route("/api/settings/bandwidth", methods=["POST"])
def set_bandwidth():
    data = request.get_json(silent=True) or {}
    try:
        mbps = float(data.get("bandwidth_limit_mbps", 0))
        if mbps < 0:
            mbps = 0
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid value"}), 400
    app_settings["bandwidth_limit_mbps"] = mbps
    _save_settings(app_settings)
    logger.info(
        f"[SETTINGS] Bandbreiten-Limit: {mbps} MB/s" if mbps > 0
        else "[SETTINGS] Bandbreiten-Limit: unbegrenzt"
    )
    return jsonify({"success": True, "bandwidth_limit_mbps": mbps})


def _mask_token(token: str) -> str:
    if len(token) <= 8:
        return "****"
    return token[:4] + "****" + token[-4:]


@settings_bp.route("/api/settings/hf-token", methods=["GET"])
def get_hf_token_status():
    runtime = app_settings.get("hf_token_override")
    active  = get_hf_token()
    if runtime:
        source  = "settings"
        preview = _mask_token(runtime)
    elif _hf_token_env:
        source  = "env"
        preview = _mask_token(_hf_token_env)
    else:
        source  = "none"
        preview = None
    return jsonify({"source": source, "preview": preview, "active": bool(active)})


@settings_bp.route("/api/settings/hf-token", methods=["POST"])
def save_hf_token():
    data  = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    if not token:
        return jsonify({"error": "Token must not be empty"}), 400
    app_settings["hf_token_override"] = token
    _save_settings(app_settings)
    set_hf_token_runtime(token)
    return jsonify({"success": True, "preview": _mask_token(token)})


@settings_bp.route("/api/settings/hf-token", methods=["DELETE"])
def delete_hf_token():
    app_settings.pop("hf_token_override", None)
    _save_settings(app_settings)
    set_hf_token_runtime(None)
    # Fall back to env var info
    if _hf_token_env:
        return jsonify({"success": True, "source": "env", "preview": _mask_token(_hf_token_env)})
    return jsonify({"success": True, "source": "none", "preview": None})


@settings_bp.route("/api/settings/webhook", methods=["GET"])
def get_webhook():
    return jsonify({
        "url":        app_settings.get("webhook_url", ""),
        "secret_set": bool(app_settings.get("webhook_secret", "")),
        "events":     app_settings.get("webhook_events", ["completed", "cancelled", "error"]),
    })


@settings_bp.route("/api/settings/webhook", methods=["POST"])
def save_webhook():
    data   = request.get_json(silent=True) or {}
    url    = (data.get("url") or "").strip()
    secret = (data.get("secret") or "").strip()
    events = data.get("events", ["completed", "cancelled", "error"])

    if url and not (url.startswith("http://") or url.startswith("https://")):
        return jsonify({"error": "URL must start with http:// or https://"}), 400
    if not isinstance(events, list) or not all(
        e in ("completed", "cancelled", "error") for e in events
    ):
        return jsonify({"error": "Invalid events list"}), 400

    app_settings["webhook_url"]    = url
    app_settings["webhook_events"] = events
    if secret:
        app_settings["webhook_secret"] = secret
    elif "secret" in data and not secret:
        app_settings.pop("webhook_secret", None)

    _save_settings(app_settings)
    logger.info(f"[WEBHOOK] Konfiguration gespeichert: url={url!r} events={events}")
    return jsonify({"success": True, "secret_set": bool(app_settings.get("webhook_secret", ""))})


@settings_bp.route("/api/settings/webhook", methods=["DELETE"])
def delete_webhook():
    app_settings.pop("webhook_url", None)
    app_settings.pop("webhook_secret", None)
    app_settings.pop("webhook_events", None)
    _save_settings(app_settings)
    logger.info("[WEBHOOK] Konfiguration gelöscht")
    return jsonify({"success": True})


@settings_bp.route("/api/settings/webhook/test", methods=["POST"])
def test_webhook():
    from utils import send_webhook
    data   = request.get_json(silent=True) or {}
    url    = (data.get("url") or app_settings.get("webhook_url", "")).strip()
    secret = (data.get("secret") or app_settings.get("webhook_secret", "")) or None

    if not url:
        return jsonify({"error": "No webhook URL configured"}), 400
    if not (url.startswith("http://") or url.startswith("https://")):
        return jsonify({"error": "URL must start with http:// or https://"}), 400

    import time
    payload = {
        "event":            "download.completed",
        "repo_id":          "test/webhook",
        "file_count":       3,
        "bytes_downloaded": 1073741824,
        "duration_seconds": 42,
        "timestamp":        int(time.time()),
    }
    send_webhook(url, secret, payload)
    logger.info(f"[WEBHOOK] Test gesendet an {url}")
    return jsonify({"success": True})


@settings_bp.route("/api/disk-space", methods=["GET"])
def get_disk_space():
    try:
        usage = shutil.disk_usage(DOWNLOAD_DIR)
        return jsonify({
            "total":        usage.total,
            "used":         usage.used,
            "free":         usage.free,
            "percent_used": round(usage.used / usage.total * 100, 1),
        })
    except OSError as e:
        return jsonify({"error": str(e)}), 500


@settings_bp.route("/api/disk-breakdown", methods=["GET"])
def get_disk_breakdown():
    force = request.args.get("force") == "1"
    with _breakdown_lock:
        cached    = _breakdown_cache["result"]
        computing = _breakdown_cache["computing"]
        age       = time.time() - _breakdown_cache["computed_at"]

    if not force and cached is not None and age < _BREAKDOWN_TTL:
        usage = shutil.disk_usage(DOWNLOAD_DIR)
        return jsonify({"status": "ready", "entries": cached,
                        "free": usage.free, "total": usage.total})

    if not computing:
        _trigger_breakdown()

    return jsonify({"status": "computing"})
