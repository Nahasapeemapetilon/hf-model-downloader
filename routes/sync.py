"""routes/sync.py — Auto-Sync API"""
import logging

from flask import Blueprint, current_app, jsonify, request

logger = logging.getLogger("hf_downloader")

sync_bp = Blueprint("sync", __name__)


def _sm():
    return current_app.sync_manager


@sync_bp.route("/api/sync/config", methods=["GET"])
def get_sync_config():
    return jsonify(_sm().get_config())


@sync_bp.route("/api/sync/config", methods=["POST"])
def set_sync_config():
    data   = request.get_json(silent=True) or {}
    result = _sm().update_config(data)
    logger.info(f"[SYNC] Config aktualisiert: {result}")
    return jsonify(result)


@sync_bp.route("/api/sync/status", methods=["GET"])
def get_sync_status():
    return jsonify(_sm().get_status())


@sync_bp.route("/api/sync/run", methods=["POST"])
def run_sync():
    started = _sm().start_sync(triggered_by="manual")
    if started:
        return jsonify({"message": "Sync gestartet."})
    return jsonify({"error": "Sync läuft bereits."}), 409


@sync_bp.route("/api/sync/stop", methods=["POST"])
def stop_sync():
    _sm().stop_sync()
    return jsonify({"message": "Sync-Abbruch angefordert."})


@sync_bp.route("/api/sync/exclude", methods=["POST"])
def sync_exclude():
    data    = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "repo_id required"}), 400
    _sm().exclude_repo(repo_id)
    logger.info(f"[SYNC] Repo ausgeschlossen: '{repo_id}'")
    return jsonify({"success": True})


@sync_bp.route("/api/sync/include", methods=["POST"])
def sync_include():
    data    = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "repo_id required"}), 400
    _sm().include_repo(repo_id)
    logger.info(f"[SYNC] Repo eingeschlossen: '{repo_id}'")
    return jsonify({"success": True})
