"""
managers/sync_manager.py — SyncManager
Prüft periodisch ob heruntergeladene HF-Repos aktualisiert wurden.
Reiht outdated/neue Dateien in den DownloadManager ein (auto-Modus).
"""
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from huggingface_hub import HfApi
try:
    from huggingface_hub.errors import RepositoryNotFoundError
except ImportError:
    from huggingface_hub.utils import RepositoryNotFoundError

from config import HF_TOKEN, SYNC_CONFIG_PATH, SYNC_STATE_PATH
from utils import get_completed_downloads, safe_repo_path

if TYPE_CHECKING:
    from managers.download_manager import DownloadManager

logger = logging.getLogger("hf_downloader")


class SyncManager:
    """
    Periodically checks local repos against HuggingFace for outdated/new files.
    Cross-reference to DownloadManager is injected after instantiation via
    set_download_manager() to avoid circular imports.
    """

    _DEFAULTS: dict = {
        "enabled":                 False,
        "mode":                    "notify",  # "notify" | "auto"
        "interval_hours":          24,
        "run_in_scheduler_window": True,
        "excluded_repos":          [],
    }

    def __init__(self):
        self._lock            = threading.Lock()
        self._running         = False
        self._stop_flag       = False
        self._download_manager: "DownloadManager | None" = None

        self._config = self._load_config()
        self._state  = self._load_state()

        threading.Thread(target=self._interval_loop, daemon=True).start()

    def set_download_manager(self, dm: "DownloadManager"):
        """Inject DownloadManager reference after both objects are created."""
        self._download_manager = dm

    # ----------------------------------------------------------------
    # Persistence
    # ----------------------------------------------------------------

    def _load_config(self) -> dict:
        try:
            with open(SYNC_CONFIG_PATH, "r", encoding="utf-8") as f:
                return {**self._DEFAULTS, **json.load(f)}
        except Exception:
            return dict(self._DEFAULTS)

    def _save_config(self):
        tmp = SYNC_CONFIG_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._config, f, indent=2)
        os.replace(tmp, SYNC_CONFIG_PATH)

    def _load_state(self) -> dict:
        try:
            with open(SYNC_STATE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {
                "last_run":  None,
                "next_run":  None,
                "status":    "idle",
                "last_error": None,
                "repos":     {},
                "progress":  {"checked": 0, "total": 0},
            }

    def _save_state(self):
        tmp = SYNC_STATE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._state, f, indent=2)
        os.replace(tmp, SYNC_STATE_PATH)

    # ----------------------------------------------------------------
    # Public API
    # ----------------------------------------------------------------

    def get_config(self) -> dict:
        with self._lock:
            return dict(self._config)

    def update_config(self, data: dict) -> dict:
        with self._lock:
            if "enabled" in data:
                self._config["enabled"] = bool(data["enabled"])
            if "mode" in data and data["mode"] in ("notify", "auto"):
                self._config["mode"] = data["mode"]
            if "interval_hours" in data:
                try:
                    self._config["interval_hours"] = max(1, min(168, int(data["interval_hours"])))
                except (TypeError, ValueError):
                    pass
            if "run_in_scheduler_window" in data:
                self._config["run_in_scheduler_window"] = bool(data["run_in_scheduler_window"])
            self._save_config()
            return dict(self._config)

    def exclude_repo(self, repo_id: str):
        with self._lock:
            excl = self._config.get("excluded_repos", [])
            if repo_id not in excl:
                excl.append(repo_id)
                self._config["excluded_repos"] = excl
                self._save_config()

    def include_repo(self, repo_id: str):
        with self._lock:
            excl = self._config.get("excluded_repos", [])
            if repo_id in excl:
                excl.remove(repo_id)
                self._config["excluded_repos"] = excl
                self._save_config()

    def get_status(self) -> dict:
        with self._lock:
            outdated = sum(
                1 for r in self._state.get("repos", {}).values()
                if r.get("status") == "outdated"
            )
            return {
                "status":         "running" if self._running else self._state.get("status", "idle"),
                "last_run":       self._state.get("last_run"),
                "next_run":       self._state.get("next_run"),
                "last_error":     self._state.get("last_error"),
                "progress":       self._state.get("progress", {"checked": 0, "total": 0}),
                "outdated_count": outdated,
                "repos":          dict(self._state.get("repos", {})),
            }

    def start_sync(self, triggered_by: str = "manual") -> bool:
        with self._lock:
            if self._running:
                logger.info(f"[SYNC] Sync bereits aktiv – {triggered_by} ignoriert")
                return False
            self._running   = True
            self._stop_flag = False
        logger.info(f"[SYNC] Sync gestartet ({triggered_by})")
        threading.Thread(target=self._worker, daemon=True).start()
        return True

    def stop_sync(self):
        with self._lock:
            if self._running:
                self._stop_flag = True
                logger.info("[SYNC] Sync-Abbruch angefordert")

    def trigger_if_due(self, triggered_by: str = "scheduler"):
        """Start sync only if enabled and the configured interval has elapsed."""
        with self._lock:
            if not self._config.get("enabled"):
                return
            last_run   = self._state.get("last_run")
            interval_h = self._config.get("interval_hours", 24)
            if last_run:
                try:
                    elapsed = (datetime.now() - datetime.fromisoformat(last_run)).total_seconds()
                    if elapsed < interval_h * 3600:
                        return
                except Exception:
                    pass
            if self._running:
                return
        self.start_sync(triggered_by=triggered_by)

    # ----------------------------------------------------------------
    # Background threads
    # ----------------------------------------------------------------

    def _interval_loop(self):
        """Trigger sync every interval_hours when not bound to scheduler window."""
        while True:
            time.sleep(60)
            try:
                with self._lock:
                    if not self._config.get("enabled"):
                        continue
                    run_in_window = self._config.get("run_in_scheduler_window", True)
                if run_in_window:
                    continue  # handled by DownloadManager._scheduler_monitor callback
                self.trigger_if_due(triggered_by="interval")
            except Exception as exc:
                logger.warning(f"[SYNC] Interval-Loop-Fehler: {exc}")

    # ----------------------------------------------------------------
    # Worker
    # ----------------------------------------------------------------

    def _check_repo(self, repo_id: str, api: HfApi,
                    prev_state: dict | None = None) -> dict:
        """
        Check one repo for updates.

        - outdated_files: locally present files whose remote size differs
        - new_files:      files added to the repo SINCE the last sync
                          (only compared against prev_state['known_remote_files'])
        - Files the user never downloaded (not local, already known remotely) are ignored.
        - First sync (no prev_state): only checks locally present files;
          records baseline for future comparisons.
        """
        if self._stop_flag:
            return {"status": "skipped",
                    "checked_at": datetime.now().isoformat(timespec="seconds")}
        try:
            repo_info = api.repo_info(repo_id=repo_id, files_metadata=True, timeout=15)
            remote = {
                f.rfilename: f.size for f in repo_info.siblings
                if f.rfilename != ".gitattributes" and f.size is not None
            }
        except RepositoryNotFoundError:
            return {"status": "local_only",
                    "checked_at": datetime.now().isoformat(timespec="seconds")}
        except Exception as e:
            logger.warning(f"[SYNC] HF-Fehler bei '{repo_id}': {e}")
            return {"status": "error", "error": str(e),
                    "checked_at": datetime.now().isoformat(timespec="seconds")}

        repo_path = safe_repo_path(repo_id)
        if not repo_path:
            return {"status": "error", "error": "invalid path",
                    "checked_at": datetime.now().isoformat(timespec="seconds")}

        local: dict[str, int] = {}
        if os.path.exists(repo_path):
            for root, _, files in os.walk(repo_path):
                for name in files:
                    if name.endswith(".sync-tmp"):
                        continue
                    fp  = os.path.join(root, name)
                    rel = os.path.relpath(fp, repo_path).replace(os.sep, "/")
                    local[rel] = os.path.getsize(fp)

        # Files the user downloaded that changed size remotely
        outdated = [fn for fn, rs in remote.items()
                    if fn in local and local[fn] != rs]

        # Genuinely new files (only detectable when we have a prior baseline)
        last_known = set(prev_state.get("known_remote_files", [])) if prev_state else None
        new_files  = ([] if last_known is None
                      else [fn for fn in remote if fn not in local and fn not in last_known])

        status = "outdated" if (outdated or new_files) else "synced"
        return {
            "status":              status,
            "checked_at":          datetime.now().isoformat(timespec="seconds"),
            "outdated_files":      outdated,
            "new_files":           new_files,
            "known_remote_files":  list(remote.keys()),  # baseline for next run
        }

    def _worker(self):
        try:
            repos = get_completed_downloads()
            with self._lock:
                excluded      = set(self._config.get("excluded_repos", []))
                mode          = self._config.get("mode", "notify")
                run_in_window = self._config.get("run_in_scheduler_window", True)
            repos = [r for r in repos if r not in excluded]

            # Remove stale repos from state
            repos_set = set(repos)
            with self._lock:
                for r in [k for k in self._state.get("repos", {}) if k not in repos_set]:
                    self._state["repos"].pop(r, None)

            total = len(repos)
            with self._lock:
                self._state.update({"status": "running",
                                    "progress": {"checked": 0, "total": total}})
                self._save_state()

            logger.info(f"[SYNC] Prüfe {total} Repo(s) | excluded: {len(excluded)}")

            api     = HfApi(token=HF_TOKEN)
            checked = 0

            def _check(r):
                with self._lock:
                    prev = self._state.get("repos", {}).get(r)
                return r, self._check_repo(r, api, prev_state=prev)

            with ThreadPoolExecutor(max_workers=4) as ex:
                for repo_id, result in ex.map(_check, repos):
                    if self._stop_flag:
                        break
                    checked += 1
                    with self._lock:
                        self._state["repos"][repo_id] = result
                        self._state["progress"]["checked"] = checked
                    logger.info(f"[SYNC] {checked}/{total}: '{repo_id}' → {result.get('status')}")

            # Auto-download mode
            if mode == "auto" and not self._stop_flag and self._download_manager:
                with self._lock:
                    repos_state = dict(self._state.get("repos", {}))
                scheduler_active = self._download_manager.scheduler.enabled
                use_scheduled    = run_in_window and scheduler_active

                for repo_id, rs in repos_state.items():
                    if rs.get("status") != "outdated":
                        continue
                    files = rs.get("outdated_files", []) + rs.get("new_files", [])
                    if not files:
                        continue
                    ok, msg = self._download_manager.add_to_queue(
                        repo_id, files, scheduled=use_scheduled, is_update=True
                    )
                    if ok:
                        logger.info(f"[SYNC] Auto-Download: '{repo_id}' ({len(files)} Datei(en))")
                    else:
                        logger.info(f"[SYNC] '{repo_id}' nicht eingereiht: {msg}")

            now      = datetime.now().isoformat(timespec="seconds")
            next_run = (datetime.now() + timedelta(
                hours=self._config.get("interval_hours", 24)
            )).isoformat(timespec="seconds")

            with self._lock:
                outdated_count = sum(
                    1 for r in self._state["repos"].values()
                    if r.get("status") == "outdated"
                )
                self._state.update({"last_run": now, "next_run": next_run,
                                    "status": "idle", "last_error": None})
                self._save_state()

            suffix = " (abgebrochen)" if self._stop_flag else ""
            logger.info(
                f"[SYNC] Abgeschlossen{suffix}: {checked}/{total} geprüft, "
                f"{outdated_count} veraltet"
            )

        except Exception as exc:
            logger.error(f"[SYNC] Worker-Fehler: {exc}")
            with self._lock:
                self._state.update({"status": "idle", "last_error": str(exc)})
                self._save_state()
        finally:
            with self._lock:
                self._running = False
