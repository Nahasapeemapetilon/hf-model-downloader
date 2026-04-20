"""routes/history.py — Download-Historie"""
import json
import logging
import os

from flask import Blueprint, jsonify, request

from config import HISTORY_PATH

logger = logging.getLogger("hf_downloader")

history_bp = Blueprint("history", __name__)


def _load() -> list:
    try:
        with open(HISTORY_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save(data: list) -> None:
    tmp = HISTORY_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, HISTORY_PATH)


@history_bp.route("/api/history", methods=["GET"])
def get_history():
    return jsonify(_load())


@history_bp.route("/api/history/<entry_id>", methods=["DELETE"])
def delete_entry(entry_id):
    history = [e for e in _load() if e.get("id") != entry_id]
    _save(history)
    return jsonify({"success": True})


@history_bp.route("/api/history", methods=["DELETE"])
def clear_history():
    _save([])
    return jsonify({"success": True})
