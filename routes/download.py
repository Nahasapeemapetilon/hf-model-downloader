"""routes/download.py — Download-Queue und Steuerung"""
import logging
import threading

from flask import Blueprint, current_app, jsonify, request

from utils import safe_repo_path

logger = logging.getLogger("hf_downloader")

download_bp = Blueprint("download", __name__)


def _dm():
    return current_app.download_manager


def _sm():
    return current_app.sync_manager


@download_bp.route("/download", methods=["POST"])
def download():
    data      = request.get_json(silent=True) or {}
    repo_id   = data.get("repo_id", "").strip()
    files     = data.get("files")
    scheduled = bool(data.get("scheduled", False))
    if not repo_id:
        return jsonify({"error": "No repository ID provided"}), 400
    if not files or not isinstance(files, list):
        return jsonify({"error": "No files selected"}), 400
    if safe_repo_path(repo_id) is None:
        return jsonify({"error": "Invalid repository ID."}), 400

    mode = "geplant" if scheduled else "sofort"
    logger.info(f"[REQUEST] Download ({mode}): '{repo_id}' | {len(files)} Datei(en)")
    success, message = _dm().add_to_queue(repo_id, files, scheduled)
    if success:
        return jsonify({"message": message})
    return jsonify({"error": message}), 409


@download_bp.route("/download-status")
def download_status():
    status = _dm().get_status()
    try:
        s = _sm().get_status()
        status["sync"] = {
            "status":         s["status"],
            "progress":       s["progress"],
            "outdated_count": s["outdated_count"],
        }
    except Exception:
        pass
    return jsonify(status)


@download_bp.route("/api/current/to-scheduler", methods=["POST"])
def current_to_scheduler():
    success, message = _dm().move_current_to_scheduler()
    if not success:
        return jsonify({"error": message}), 400
    return jsonify({"message": message})


@download_bp.route("/pause-download", methods=["POST"])
def pause_download():
    _dm().pause()
    return jsonify({"message": "Download paused"})


@download_bp.route("/resume-download", methods=["POST"])
def resume_download():
    _dm().resume()
    return jsonify({"message": "Download resumed"})


@download_bp.route("/cancel-download", methods=["POST"])
def cancel_download():
    _dm().cancel()
    return jsonify({"message": "Download cancelled"})


@download_bp.route("/api/queue/move/<int:index>/<direction>", methods=["POST"])
def move_queue_item(index, direction):
    if direction not in ("up", "down"):
        return jsonify({"error": "Invalid direction."}), 400
    _dm().move_in_queue(index, direction)
    return jsonify({"message": "Queue updated."})


@download_bp.route("/api/queue/remove/<int:index>", methods=["POST"])
def remove_queue_item(index):
    _dm().remove_from_queue(index)
    return jsonify({"message": "Item removed."})


@download_bp.route("/api/queue/start-now/<int:index>", methods=["POST"])
def queue_start_now(index):
    dm = _dm()
    with dm._lock:
        if 0 <= index < len(dm.queue):
            dm.queue[index].scheduled = False
            dm._save_queue()
            dm._wakeup_event.set()
            return jsonify({"message": "Job will start immediately."})
    return jsonify({"error": "Invalid queue index."}), 400
