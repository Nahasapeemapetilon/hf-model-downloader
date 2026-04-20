"""routes/hf.py — HuggingFace API Routen"""
import logging
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from functools import wraps

from flask import Blueprint, jsonify, request
from huggingface_hub import HfApi

try:
    from huggingface_hub.errors import RepositoryNotFoundError
except ImportError:
    from huggingface_hub.utils import RepositoryNotFoundError

import config as cfg
from config import get_hf_token
from utils import hf_api_call, safe_repo_path

logger = logging.getLogger("hf_downloader")

hf_bp = Blueprint("hf", __name__)


# ---------------------------------------------------------------------------
# Simple in-memory rate limiter (per endpoint, global — single-user app)
# ---------------------------------------------------------------------------
_rate_windows: dict[str, deque] = {}

def _rate_limit(max_calls: int, window_seconds: int = 60):
    """Decorator: rejects requests once max_calls is exceeded within window_seconds."""
    def decorator(fn):
        _rate_windows[fn.__name__] = deque()

        @wraps(fn)
        def wrapper(*args, **kwargs):
            now    = time.monotonic()
            window = _rate_windows[fn.__name__]
            while window and window[0] < now - window_seconds:
                window.popleft()
            if len(window) >= max_calls:
                logger.warning(f"[RATE LIMIT] {fn.__name__} – {max_calls} Anfragen/{window_seconds}s überschritten")
                return jsonify({"error": "Rate limit exceeded. Please wait before retrying."}), 429
            window.append(now)
            return fn(*args, **kwargs)
        return wrapper
    return decorator


@hf_bp.route("/api/list-files", methods=["POST"])
@_rate_limit(max_calls=60, window_seconds=60)
def list_files_route():
    data    = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "No repository ID provided"}), 400
    logger.info(f"[API] Dateiliste angefordert: '{repo_id}'")
    try:
        api       = HfApi(token=get_hf_token())
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


@hf_bp.route("/api/repository-status", methods=["POST"])
@_rate_limit(max_calls=60, window_seconds=60)
def repository_status():
    import os
    data    = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "No repository ID provided"}), 400

    local_repo_path = safe_repo_path(repo_id)
    if local_repo_path is None:
        return jsonify({"error": "Invalid repository ID."}), 400

    try:
        api       = HfApi(token=get_hf_token())
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


@hf_bp.route("/api/search-models", methods=["POST"])
@_rate_limit(max_calls=30, window_seconds=60)
def search_models():
    data         = request.json or {}
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
        api    = HfApi(token=get_hf_token())
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


@hf_bp.route("/api/repos/check-hf", methods=["POST"])
@_rate_limit(max_calls=20, window_seconds=60)
def check_repos_hf():
    data  = request.get_json(silent=True) or {}
    repos = [r for r in data.get("repos", []) if isinstance(r, str)][:50]
    api   = HfApi(token=get_hf_token() or None)

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
