"""routes/settings.py — App-Einstellungen (Bandbreite etc.)"""
import logging

from flask import Blueprint, jsonify, request

from managers.download_manager import app_settings, _save_settings

logger = logging.getLogger("hf_downloader")

settings_bp = Blueprint("settings", __name__)


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
