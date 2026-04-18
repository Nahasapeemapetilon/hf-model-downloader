"""routes/settings.py — App-Einstellungen (Bandbreite etc.)"""
import logging
import os
import shutil
import threading
import time

from flask import Blueprint, jsonify, request

from config import DOWNLOAD_DIR
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
