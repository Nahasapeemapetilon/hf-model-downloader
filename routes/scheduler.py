"""routes/scheduler.py — Scheduler-Konfiguration"""
import logging
import threading

from flask import Blueprint, current_app, jsonify, request

import config as cfg

logger = logging.getLogger("hf_downloader")

scheduler_bp = Blueprint("scheduler", __name__)


@scheduler_bp.route("/api/scheduler", methods=["GET"])
def get_scheduler():
    sched = current_app.download_manager.scheduler
    return jsonify({
        **sched.to_dict(),
        "in_window":            sched.is_in_window(),
        "minutes_until_window": sched.minutes_until_window(),
    })


@scheduler_bp.route("/api/scheduler", methods=["POST"])
def set_scheduler():
    data = request.get_json(silent=True) or {}
    dm   = current_app.download_manager
    dm.scheduler.update(data)
    try:
        dm.scheduler.save(cfg.SCHEDULER_PATH)
        logger.info(f"[SCHEDULER] Config gespeichert: {dm.scheduler.to_dict()}")
        with dm._lock:
            has_waiting = any(j.scheduled for j in dm.queue)
        if has_waiting:
            with dm._lock:
                if not dm._worker_running:
                    dm._worker_running  = True
                    dm._download_thread = threading.Thread(
                        target=dm._download_worker, daemon=True)
                    dm._download_thread.start()
                else:
                    dm._wakeup_event.set()
        return jsonify({"message": "Scheduler updated.", **dm.scheduler.to_dict()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
