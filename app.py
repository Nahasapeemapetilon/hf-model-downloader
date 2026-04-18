"""
app.py — HuggingFace Downloader (Flask entry point)
Enthält: Logging-Setup, Flask-App, Auth, alle Route-Handler.
Business-Logik lebt in managers/ und utils.py.
"""
import json
import logging
import os
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor

from flask import Flask, render_template, request, jsonify, Response
from huggingface_hub import HfApi
try:
    from huggingface_hub.errors import RepositoryNotFoundError
except ImportError:
    from huggingface_hub.utils import RepositoryNotFoundError

# ============================================================
# Logging (must come before config imports so managers can log)
# ============================================================
log_fmt = logging.Formatter(
    "%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
)
stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setFormatter(log_fmt)

log_file = os.path.join(os.environ.get("TEMP", "/tmp"), "unraid_downloader_app.log")
file_handler = logging.FileHandler(log_file)
file_handler.setFormatter(log_fmt)

logger = logging.getLogger("hf_downloader")
logger.setLevel(logging.INFO)
logger.addHandler(stream_handler)
logger.addHandler(file_handler)

logging.getLogger("werkzeug").setLevel(logging.WARNING)

# ============================================================
# Config / Managers / Utils
# ============================================================
import config as cfg                                    # noqa: E402
from managers.download_manager import (                 # noqa: E402
    DownloadManager, app_settings, _save_settings,
)
from managers.sync_manager import SyncManager           # noqa: E402
from utils import (                                     # noqa: E402
    fmt_size, safe_repo_path, has_any_file,
    get_completed_downloads, hf_api_call,
)

logger.info("=" * 60)
logger.info("HuggingFace Downloader gestartet")
logger.info("=" * 60)

# --- Version ---
_version_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "VERSION")
try:
    with open(_version_file, "r", encoding="utf-8") as _vf:
        APP_VERSION = _vf.read().strip()
except Exception:
    APP_VERSION = "unknown"
logger.info(f"Version: {APP_VERSION}")

# ============================================================
# Manager singletons — wire cross-references after both exist
# ============================================================
sync_manager     = SyncManager()
download_manager = DownloadManager(on_window_open=sync_manager.trigger_if_due)
sync_manager.set_download_manager(download_manager)

# ============================================================
# Flask app
# ============================================================
app = Flask(__name__)


@app.before_request
def require_auth():
    auth_user = os.environ.get("AUTH_USER", "").strip()
    auth_pass = os.environ.get("AUTH_PASS", "").strip()
    if not auth_user or not auth_pass:
        return
    creds = request.authorization
    if not creds or creds.username != auth_user or creds.password != auth_pass:
        return Response(
            "Authentication required.",
            401,
            {"WWW-Authenticate": 'Basic realm="HF Downloader"'},
        )


# ============================================================
# Hidden repos helpers
# ============================================================
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


# ============================================================
# Routes — Main page
# ============================================================
@app.route("/")
def index():
    return render_template(
        "index.html",
        completed_downloads=get_completed_downloads(),
        app_version=APP_VERSION,
    )


# ============================================================
# Routes — HuggingFace API
# ============================================================
@app.route("/api/list-files", methods=["POST"])
def list_files_route():
    data    = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "No repository ID provided"}), 400
    logger.info(f"[API] Dateiliste angefordert: '{repo_id}'")
    try:
        api       = HfApi(token=cfg.HF_TOKEN)
        repo_info = hf_api_call(api.repo_info, repo_id=repo_id,
                                files_metadata=True, timeout=15)
        files = [
            {"name": f.rfilename, "size": f.size}
            for f in repo_info.siblings
            if f.rfilename != ".gitattributes" and f.size is not None
        ]
        logger.info(f"[API] '{repo_id}' – {len(files)} Datei(en)")
        return jsonify(files)
    except Exception as e:
        logger.error(f"[API] Fehler: '{repo_id}': {e}")
        return jsonify({"error": f"Could not list files for '{repo_id}': {e}"}), 404


@app.route("/api/repository-status", methods=["POST"])
def repository_status():
    data    = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "No repository ID provided"}), 400

    local_repo_path = safe_repo_path(repo_id)
    if local_repo_path is None:
        return jsonify({"error": "Invalid repository ID."}), 400

    try:
        api       = HfApi(token=cfg.HF_TOKEN)
        repo_info = hf_api_call(api.repo_info, repo_id=repo_id,
                                files_metadata=True, timeout=15)
        remote = {
            f.rfilename: f.size for f in repo_info.siblings
            if f.rfilename != ".gitattributes" and f.size is not None
        }

        local: dict = {}
        if os.path.exists(local_repo_path):
            for root, _, files in os.walk(local_repo_path):
                for name in files:
                    if name.endswith(".sync-tmp"):
                        continue
                    fp  = os.path.join(root, name)
                    rel = os.path.relpath(fp, local_repo_path).replace(os.sep, "/")
                    local[rel] = os.path.getsize(fp)

        status_list = []
        for filename in sorted(set(remote) | set(local)):
            if filename in remote and filename in local:
                status = "synced" if remote[filename] == local[filename] else "outdated"
                size   = local[filename] if status == "synced" else remote[filename]
            elif filename in remote:
                status, size = "not_downloaded", remote[filename]
            else:
                status, size = "local_only", local[filename]
            status_list.append({"name": filename, "size": size, "status": status})

        return jsonify(status_list)

    except RepositoryNotFoundError:
        logger.warning(f"[API] '{repo_id}' nicht auf HuggingFace")
        return jsonify({"error": f"Repository '{repo_id}' not found.", "not_found": True}), 404
    except Exception as e:
        return jsonify({"error": f"Could not get status for '{repo_id}': {e}"}), 500


@app.route("/api/search-models", methods=["POST"])
def search_models():
    data = request.json or {}
    query        = data.get("query", "").strip()
    pipeline_tag = data.get("pipeline_tag", "").strip() or None
    sort         = data.get("sort", "downloads")
    try:
        limit = min(int(data.get("limit", 20)), 50)
    except (ValueError, TypeError):
        limit = 20
    if sort not in ("downloads", "likes", "lastModified"):
        sort = "downloads"

    try:
        logger.info(f"[API] Modell-Suche: query='{query}' tag='{pipeline_tag}' sort='{sort}'")
        api    = HfApi(token=cfg.HF_TOKEN)
        kwargs = dict(sort=sort, direction=-1, limit=limit, cardData=False)
        if query:        kwargs["search"]       = query
        if pipeline_tag: kwargs["pipeline_tag"] = pipeline_tag
        models = list(hf_api_call(api.list_models, **kwargs))
        result = [
            {
                "id":           m.id,
                "downloads":    getattr(m, "downloads", 0) or 0,
                "likes":        getattr(m, "likes", 0) or 0,
                "pipeline_tag": getattr(m, "pipeline_tag", None),
            }
            for m in models
        ]
        logger.info(f"[API] Modell-Suche: {len(result)} Ergebnisse")
        return jsonify(result)
    except Exception as e:
        logger.error(f"[API] Modell-Suche Fehler: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/repos/check-hf", methods=["POST"])
def check_repos_hf():
    data  = request.get_json(silent=True) or {}
    repos = [r for r in data.get("repos", []) if isinstance(r, str)][:50]
    api   = HfApi(token=cfg.HF_TOKEN or None)

    def _check(repo_id):
        try:
            api.repo_info(repo_id=repo_id, repo_type="model")
            return repo_id, True
        except RepositoryNotFoundError:
            return repo_id, False
        except Exception:
            return repo_id, None

    result = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        for repo_id, exists in ex.map(_check, repos):
            result[repo_id] = exists
    return jsonify(result)


# ============================================================
# Routes — Scheduler
# ============================================================
@app.route("/api/scheduler", methods=["GET"])
def get_scheduler():
    sched = download_manager.scheduler
    return jsonify({
        **sched.to_dict(),
        "in_window":            sched.is_in_window(),
        "minutes_until_window": sched.minutes_until_window(),
    })


@app.route("/api/scheduler", methods=["POST"])
def set_scheduler():
    data = request.get_json(silent=True) or {}
    download_manager.scheduler.update(data)
    try:
        download_manager.scheduler.save(cfg.SCHEDULER_PATH)
        logger.info(f"[SCHEDULER] Config gespeichert: {download_manager.scheduler.to_dict()}")
        dm = download_manager
        with dm._lock:
            has_waiting = any(j.scheduled for j in dm.queue)
        if has_waiting:
            with dm._lock:
                if not dm._worker_running:
                    import threading
                    dm._worker_running  = True
                    dm._download_thread = threading.Thread(
                        target=dm._download_worker, daemon=True)
                    dm._download_thread.start()
                else:
                    dm._wakeup_event.set()
        return jsonify({"message": "Scheduler updated.",
                        **download_manager.scheduler.to_dict()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ============================================================
# Routes — Download
# ============================================================
@app.route("/download", methods=["POST"])
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
    success, message = download_manager.add_to_queue(repo_id, files, scheduled)
    if success:
        return jsonify({"message": message})
    return jsonify({"error": message}), 409


@app.route("/download-status")
def download_status():
    status = download_manager.get_status()
    try:
        s = sync_manager.get_status()
        status["sync"] = {
            "status":         s["status"],
            "progress":       s["progress"],
            "outdated_count": s["outdated_count"],
        }
    except Exception:
        pass
    return jsonify(status)


@app.route("/api/current/to-scheduler", methods=["POST"])
def current_to_scheduler():
    success, message = download_manager.move_current_to_scheduler()
    if not success:
        return jsonify({"error": message}), 400
    return jsonify({"message": message})


@app.route("/pause-download",  methods=["POST"])
def pause_download():
    download_manager.pause()
    return jsonify({"message": "Download paused"})


@app.route("/resume-download", methods=["POST"])
def resume_download():
    download_manager.resume()
    return jsonify({"message": "Download resumed"})


@app.route("/cancel-download", methods=["POST"])
def cancel_download():
    download_manager.cancel()
    return jsonify({"message": "Download cancelled"})


@app.route("/api/queue/move/<int:index>/<direction>", methods=["POST"])
def move_queue_item(index, direction):
    if direction not in ("up", "down"):
        return jsonify({"error": "Invalid direction."}), 400
    download_manager.move_in_queue(index, direction)
    return jsonify({"message": "Queue updated."})


@app.route("/api/queue/remove/<int:index>", methods=["POST"])
def remove_queue_item(index):
    download_manager.remove_from_queue(index)
    return jsonify({"message": "Item removed."})


@app.route("/api/queue/start-now/<int:index>", methods=["POST"])
def queue_start_now(index):
    with download_manager._lock:
        if 0 <= index < len(download_manager.queue):
            download_manager.queue[index].scheduled = False
            download_manager._save_queue()
            download_manager._wakeup_event.set()
            return jsonify({"message": "Job will start immediately."})
    return jsonify({"error": "Invalid queue index."}), 400


# ============================================================
# Routes — Completed / Repos
# ============================================================
@app.route("/completed")
def completed():
    hidden = _load_hidden()
    return jsonify([r for r in get_completed_downloads() if r not in hidden])


@app.route("/api/repo/hidden", methods=["GET"])
def get_hidden_repos():
    return jsonify(sorted(_load_hidden()))


@app.route("/api/repo/hide", methods=["POST"])
def hide_repo():
    data    = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "repo_id required"}), 400
    hidden = _load_hidden()
    hidden.add(repo_id)
    _save_hidden(hidden)
    return jsonify({"success": True})


@app.route("/api/repo/unhide", methods=["POST"])
def unhide_repo():
    data    = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "repo_id required"}), 400
    hidden = _load_hidden()
    hidden.discard(repo_id)
    _save_hidden(hidden)
    return jsonify({"success": True})


@app.route("/api/repo", methods=["DELETE"])
def delete_repo():
    data    = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "repo_id required"}), 400

    status = download_manager.get_status()
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
                logger.info(f"[DELETE] Leeres Org-Verzeichnis entfernt")
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"[DELETE] Repo '{repo_id}': {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/file", methods=["DELETE"])
def delete_file():
    data     = request.get_json(silent=True) or {}
    repo_id  = data.get("repo_id",  "").strip()
    filename = data.get("filename", "").strip()
    if not repo_id or not filename:
        return jsonify({"error": "repo_id and filename required"}), 400

    status = download_manager.get_status()
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


# ============================================================
# Routes — Settings
# ============================================================
@app.route("/api/settings/bandwidth", methods=["GET"])
def get_bandwidth():
    return jsonify({"bandwidth_limit_mbps": app_settings.get("bandwidth_limit_mbps", 0)})


@app.route("/api/settings/bandwidth", methods=["POST"])
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


# ============================================================
# Routes — Auto-Sync
# ============================================================
@app.route("/api/sync/config", methods=["GET"])
def get_sync_config():
    return jsonify(sync_manager.get_config())


@app.route("/api/sync/config", methods=["POST"])
def set_sync_config():
    data   = request.get_json(silent=True) or {}
    result = sync_manager.update_config(data)
    logger.info(f"[SYNC] Config aktualisiert: {result}")
    return jsonify(result)


@app.route("/api/sync/status", methods=["GET"])
def get_sync_status():
    return jsonify(sync_manager.get_status())


@app.route("/api/sync/run", methods=["POST"])
def run_sync():
    started = sync_manager.start_sync(triggered_by="manual")
    if started:
        return jsonify({"message": "Sync gestartet."})
    return jsonify({"error": "Sync läuft bereits."}), 409


@app.route("/api/sync/stop", methods=["POST"])
def stop_sync():
    sync_manager.stop_sync()
    return jsonify({"message": "Sync-Abbruch angefordert."})


@app.route("/api/sync/exclude", methods=["POST"])
def sync_exclude():
    data    = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "repo_id required"}), 400
    sync_manager.exclude_repo(repo_id)
    logger.info(f"[SYNC] Repo ausgeschlossen: '{repo_id}'")
    return jsonify({"success": True})


@app.route("/api/sync/include", methods=["POST"])
def sync_include():
    data    = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "repo_id required"}), 400
    sync_manager.include_repo(repo_id)
    logger.info(f"[SYNC] Repo eingeschlossen: '{repo_id}'")
    return jsonify({"success": True})


# ============================================================
# Entry point
# ============================================================
if __name__ == "__main__":
    try:
        logger.info("Starte Flask-Server auf 0.0.0.0:5000")
        app.run(
            host="0.0.0.0",
            port=5000,
            debug=os.environ.get("FLASK_DEBUG", "false").lower() == "true",
        )
        logger.info("Flask-Server beendet")
    except Exception as e:
        logger.critical(f"Kritischer Fehler beim Starten: {e}", exc_info=True)
        raise
