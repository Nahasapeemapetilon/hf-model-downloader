"""routes/repos.py — Completed Repos, Hide/Unhide, Delete"""
import json
import logging
import os
import shutil

from flask import Blueprint, current_app, jsonify, request

import config as cfg
from utils import get_completed_downloads, has_any_file, safe_repo_path

logger = logging.getLogger("hf_downloader")

repos_bp = Blueprint("repos", __name__)


# ----------------------------------------------------------------
# Hidden-repos helpers
# ----------------------------------------------------------------

def _load_hidden() -> set:
    try:
        with open(cfg.HIDDEN_PATH, "r", encoding="utf-8") as f:
            return set(json.load(f))
    except Exception:
        return set()


def _save_hidden(hidden: set):
    tmp = cfg.HIDDEN_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(sorted(hidden), f)
    os.replace(tmp, cfg.HIDDEN_PATH)


# ----------------------------------------------------------------
# Routes
# ----------------------------------------------------------------

@repos_bp.route("/completed")
def completed():
    hidden = _load_hidden()
    return jsonify([r for r in get_completed_downloads() if r not in hidden])


@repos_bp.route("/api/repo/hidden", methods=["GET"])
def get_hidden_repos():
    return jsonify(sorted(_load_hidden()))


@repos_bp.route("/api/repo/hide", methods=["POST"])
def hide_repo():
    data    = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "repo_id required"}), 400
    hidden = _load_hidden()
    hidden.add(repo_id)
    _save_hidden(hidden)
    return jsonify({"success": True})


@repos_bp.route("/api/repo/unhide", methods=["POST"])
def unhide_repo():
    data    = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "repo_id required"}), 400
    hidden = _load_hidden()
    hidden.discard(repo_id)
    _save_hidden(hidden)
    return jsonify({"success": True})


@repos_bp.route("/api/repo", methods=["DELETE"])
def delete_repo():
    data    = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "repo_id required"}), 400

    dm     = current_app.download_manager
    status = dm.get_status()
    if status.get("current_job") and status["current_job"].get("repo_id") == repo_id:
        return jsonify({"error": "Repo is currently downloading"}), 409
    if any(q.get("repo_id") == repo_id for q in status.get("queue", [])):
        return jsonify({"error": "Repo is in the download queue"}), 409

    repo_path = safe_repo_path(repo_id)
    if not repo_path:
        return jsonify({"error": "Invalid repo_id"}), 400
    if not os.path.exists(repo_path):
        return jsonify({"error": "Repo not found"}), 404

    try:
        shutil.rmtree(repo_path)
        logger.info(f"[DELETE] Repo '{repo_id}' entfernt")
        parent = os.path.dirname(repo_path)
        if parent != os.path.realpath(cfg.DOWNLOAD_DIR) and os.path.isdir(parent):
            if not os.listdir(parent):
                os.rmdir(parent)
                logger.info("[DELETE] Leeres Org-Verzeichnis entfernt")
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"[DELETE] Repo '{repo_id}': {e}")
        return jsonify({"error": str(e)}), 500


@repos_bp.route("/api/file", methods=["DELETE"])
def delete_file():
    data     = request.get_json(silent=True) or {}
    repo_id  = data.get("repo_id",  "").strip()
    filename = data.get("filename", "").strip()
    if not repo_id or not filename:
        return jsonify({"error": "repo_id and filename required"}), 400

    dm     = current_app.download_manager
    status = dm.get_status()
    if status.get("current_job") and status["current_job"].get("repo_id") == repo_id:
        return jsonify({"error": "Repo is currently downloading"}), 409
    if any(q.get("repo_id") == repo_id for q in status.get("queue", [])):
        return jsonify({"error": "Repo is in the download queue"}), 409

    repo_path = safe_repo_path(repo_id)
    if not repo_path:
        return jsonify({"error": "Invalid repo_id"}), 400

    file_path = os.path.realpath(os.path.join(repo_path, filename))
    if not file_path.startswith(os.path.realpath(repo_path) + os.sep):
        logger.warning(f"[SECURITY] Path-Traversal bei Datei: '{filename}'")
        return jsonify({"error": "Invalid filename"}), 400
    if not os.path.isfile(file_path):
        return jsonify({"error": "File not found"}), 404

    try:
        os.remove(file_path)
        logger.info(f"[DELETE] Datei '{filename}' aus '{repo_id}'")

        parent = os.path.dirname(file_path)
        while os.path.realpath(parent) != os.path.realpath(repo_path):
            if not os.listdir(parent):
                os.rmdir(parent)
                parent = os.path.dirname(parent)
            else:
                break

        repo_empty = not has_any_file(repo_path)
        if repo_empty:
            shutil.rmtree(repo_path)
            logger.info(f"[DELETE] Leeres Repo '{repo_id}' entfernt")
            org_dir = os.path.dirname(repo_path)
            if org_dir != os.path.realpath(cfg.DOWNLOAD_DIR) and os.path.isdir(org_dir):
                if not os.listdir(org_dir):
                    os.rmdir(org_dir)

        return jsonify({"success": True, "repo_deleted": repo_empty})
    except Exception as e:
        logger.error(f"[DELETE] '{filename}' aus '{repo_id}': {e}")
        return jsonify({"error": str(e)}), 500
