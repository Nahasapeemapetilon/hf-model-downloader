"""
managers/download_manager.py — DownloadJob + DownloadManager
Verwaltet die Download-Queue, den Worker-Thread und Pause/Resume/Cancel.
"""
import json
import logging
import os
import threading
import time
from typing import Callable

import requests
from huggingface_hub import hf_hub_url

from config import (
    CHUNK_SIZE, DOWNLOAD_DIR,
    QUEUE_STATE_PATH, SETTINGS_PATH, SCHEDULER_PATH,
    _NET_RETRY_DELAYS, get_hf_token, set_hf_token_runtime,
)
from managers.scheduler import SchedulerConfig
from utils import fmt_size, safe_repo_path

logger = logging.getLogger("hf_downloader")

_NET_ERRORS = (
    requests.exceptions.ConnectionError,
    requests.exceptions.ChunkedEncodingError,
    requests.exceptions.Timeout,
)


# ---------------------------------------------------------------------------
# Settings helpers (bandwidth limit lives in settings.json)
# ---------------------------------------------------------------------------

def _load_settings() -> dict:
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_settings(data: dict):
    tmp = SETTINGS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, SETTINGS_PATH)


# Module-level settings cache (mutated by the bandwidth/token endpoints)
app_settings: dict = _load_settings()

# Apply persisted HF token override on startup
_saved_token = app_settings.get("hf_token_override")
if _saved_token:
    set_hf_token_runtime(_saved_token)


def get_bandwidth_limit() -> int:
    """Returns bandwidth limit in bytes/sec. 0 = unlimited."""
    mbps = app_settings.get("bandwidth_limit_mbps", 0)
    try:
        mbps = float(mbps)
    except (TypeError, ValueError):
        mbps = 0
    return int(mbps * 1024 * 1024) if mbps > 0 else 0


# ---------------------------------------------------------------------------
# DownloadJob
# ---------------------------------------------------------------------------

class DownloadJob:
    def __init__(self, repo_id: str, files: list[str],
                 scheduled: bool = False, is_update: bool = False):
        self.repo_id             = repo_id
        self.files_to_download   = files
        self.scheduled           = scheduled   # True = only run inside scheduler window
        self.is_update           = is_update   # True = atomic .sync-tmp write
        self.status              = "queued"    # queued | downloading | paused | completed | error
        self.error_message       = None
        self.total_files         = len(files)
        self.current_file_index  = 0
        self.current_file        = ""
        self.current_file_progress = 0
        self.total_progress      = 0
        self.download_speed      = 0.0         # bytes/sec (1s sliding window)
        self.eta_seconds         = None        # remaining seconds, None if unknown


# ---------------------------------------------------------------------------
# DownloadManager
# ---------------------------------------------------------------------------

class DownloadManager:
    def __init__(self, on_window_open: Callable | None = None):
        """
        on_window_open — optional callback invoked when the scheduler window
        opens (used to trigger auto-sync without a hard import of SyncManager).
        """
        self.queue               = []
        self.current_job         = None
        self._pause_event        = threading.Event()
        self._cancel_requested   = False
        self._download_thread    = None
        self._worker_running     = False
        self._lock               = threading.Lock()
        self._wakeup_event       = threading.Event()
        self._reschedule_current = False
        self._on_window_open     = on_window_open  # injected after SyncManager exists

        self.scheduler = SchedulerConfig()
        self.scheduler.load(SCHEDULER_PATH)

        self._load_queue()
        threading.Thread(target=self._scheduler_monitor, daemon=True).start()

    # ------------------------------------------------------------------
    # Queue persistence
    # ------------------------------------------------------------------

    def _save_queue(self):
        """Write queue state to disk atomically. Caller must hold self._lock."""
        state = []
        if self.current_job and self.current_job.status in ("downloading", "paused"):
            state.append({"repo_id":   self.current_job.repo_id,
                          "files":     self.current_job.files_to_download,
                          "scheduled": self.current_job.scheduled})
        for job in self.queue:
            state.append({"repo_id":   job.repo_id,
                          "files":     job.files_to_download,
                          "scheduled": job.scheduled})
        tmp = QUEUE_STATE_PATH + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2)
            os.replace(tmp, QUEUE_STATE_PATH)
        except Exception as exc:
            logger.warning(f"[QUEUE] Queue-State konnte nicht gespeichert werden: {exc}")

    def _load_queue(self):
        """Restore queue from disk on startup."""
        if not os.path.exists(QUEUE_STATE_PATH):
            return
        try:
            with open(QUEUE_STATE_PATH, "r", encoding="utf-8") as f:
                state = json.load(f)
            restored = 0
            for entry in state:
                repo_id   = entry.get("repo_id", "").strip()
                files     = entry.get("files", [])
                scheduled = bool(entry.get("scheduled", False))
                if repo_id and isinstance(files, list) and files:
                    self.queue.append(DownloadJob(repo_id, files, scheduled))
                    restored += 1
            if restored:
                logger.info(f"[QUEUE] {restored} Job(s) aus Queue-State wiederhergestellt")
                self._worker_running = True
                self._download_thread = threading.Thread(
                    target=self._download_worker, daemon=True)
                self._download_thread.start()
        except Exception as exc:
            logger.warning(f"[QUEUE] Queue-State konnte nicht geladen werden: {exc}")

    # ------------------------------------------------------------------
    # Scheduler monitor
    # ------------------------------------------------------------------

    def _scheduler_monitor(self):
        """Auto-pause/resume scheduled jobs when the window opens/closes."""
        prev_in_window = self.scheduler.is_in_window()
        while True:
            time.sleep(30)
            in_window = self.scheduler.is_in_window()
            with self._lock:
                job = self.current_job
            if job and job.scheduled:
                if in_window and not prev_in_window and job.status == "paused":
                    logger.info(f"[SCHEDULER] Zeitfenster geöffnet – Resume: '{job.repo_id}'")
                    self.resume()
                elif not in_window and prev_in_window and job.status == "downloading":
                    logger.info(f"[SCHEDULER] Zeitfenster beendet – Pause: '{job.repo_id}'")
                    self.pause()
            # Trigger auto-sync callback when window opens
            if in_window and not prev_in_window and self._on_window_open:
                try:
                    self._on_window_open(triggered_by="window-open")
                except Exception as exc:
                    logger.warning(f"[SCHEDULER] on_window_open Fehler: {exc}")
            prev_in_window = in_window

    # ------------------------------------------------------------------
    # Public controls
    # ------------------------------------------------------------------

    def move_current_to_scheduler(self):
        with self._lock:
            if not self.current_job:
                return False, "No active download."
            if not self.scheduler.enabled:
                return False, "Scheduler is not enabled."
            self.current_job.scheduled  = True
            self._reschedule_current    = True
            self._cancel_requested      = True
            self._pause_event.set()
        return True, f"'{self.current_job.repo_id}' wird in Scheduler-Queue verschoben."

    def add_to_queue(self, repo_id: str, files: list[str],
                     scheduled: bool = False, is_update: bool = False):
        with self._lock:
            requested = set(files)
            for j in self.queue:
                if j.repo_id == repo_id and set(j.files_to_download) == requested:
                    logger.warning(f"[QUEUE] '{repo_id}' identisch bereits in Queue")
                    return False, "This exact download is already in the queue."
            if (self.current_job
                    and self.current_job.repo_id == repo_id
                    and set(self.current_job.files_to_download) == requested):
                logger.warning(f"[QUEUE] '{repo_id}' identisch läuft bereits")
                return False, "This exact download is already running."

            job = DownloadJob(repo_id, files, scheduled, is_update=is_update)
            self.queue.append(job)
            mode = "geplant" if scheduled else "sofort"
            logger.info(
                f"[QUEUE] '{repo_id}' hinzugefügt ({len(files)} Datei(en), {mode}) "
                f"| Queue: {len(self.queue)}"
            )
            self._save_queue()
            if not self._worker_running:
                self._worker_running  = True
                self._download_thread = threading.Thread(
                    target=self._download_worker, daemon=True)
                self._download_thread.start()
            elif not scheduled:
                self._wakeup_event.set()
        return True, "Added to download queue."

    def pause(self):
        with self._lock:
            if self.current_job and self.current_job.status == "downloading":
                self._pause_event.clear()
                self.current_job.status = "paused"
                logger.info(
                    f"[PAUSE] '{self.current_job.repo_id}' "
                    f"(Datei {self.current_job.current_file_index + 1}/{self.current_job.total_files})"
                )

    def resume(self):
        with self._lock:
            if self.current_job and self.current_job.status == "paused":
                self.current_job.status = "downloading"
                self._pause_event.set()
                logger.info(f"[RESUME] '{self.current_job.repo_id}'")

    def cancel(self):
        with self._lock:
            if self.current_job and self.current_job.status in ("downloading", "paused"):
                logger.info(f"[CANCEL] Abbruch angefordert: '{self.current_job.repo_id}'")
                self._cancel_requested = True
                self._pause_event.set()

    def move_in_queue(self, index: int, direction: str):
        with self._lock:
            if 0 <= index < len(self.queue):
                if direction == "up" and index > 0:
                    self.queue[index], self.queue[index - 1] = \
                        self.queue[index - 1], self.queue[index]
                elif direction == "down" and index < len(self.queue) - 1:
                    self.queue[index], self.queue[index + 1] = \
                        self.queue[index + 1], self.queue[index]
                self._save_queue()

    def remove_from_queue(self, index: int):
        with self._lock:
            if 0 <= index < len(self.queue):
                removed = self.queue[index].repo_id
                del self.queue[index]
                logger.info(f"[QUEUE] '{removed}' entfernt")
                self._save_queue()

    def get_status(self) -> dict:
        with self._lock:
            queue_status = [
                {"repo_id": j.repo_id, "status": j.status,
                 "total_files": j.total_files, "scheduled": j.scheduled}
                for j in self.queue
            ]
            sched = self.scheduler
            base = {
                "queue": queue_status,
                "scheduler": {
                    **sched.to_dict(),
                    "in_window":            sched.is_in_window(),
                    "minutes_until_window": sched.minutes_until_window(),
                },
            }
            if self.current_job:
                base.update({
                    "status":           self.current_job.status,
                    "current_repo_id":  self.current_job.repo_id,
                    "files_to_download": self.current_job.files_to_download,
                    "total_files":      self.current_job.total_files,
                    "file_index":       self.current_job.current_file_index + 1,
                    "current_file":     self.current_job.current_file,
                    "total_progress":   self.current_job.total_progress,
                    "download_speed":   self.current_job.download_speed,
                    "eta_seconds":      self.current_job.eta_seconds,
                    "error":            self.current_job.error_message,
                })
            elif self.queue:
                base["status"] = "pending"
            else:
                base["status"] = "idle"
            return base

    # ------------------------------------------------------------------
    # Download worker
    # ------------------------------------------------------------------

    def _download_worker(self):
        try:
            while True:
                job = None
                with self._lock:
                    in_window = self.scheduler.is_in_window()
                    for i, j in enumerate(self.queue):
                        if not j.scheduled:
                            job = self.queue.pop(i)
                            break
                    if job is None and in_window:
                        for i, j in enumerate(self.queue):
                            if j.scheduled:
                                job = self.queue.pop(i)
                                break
                    if job is None:
                        if not self.queue:
                            self.current_job = None
                            logger.info("[WORKER] Queue leer – Worker beendet")
                            self._save_queue()
                            return
                    else:
                        self.current_job         = job
                        job.status               = "downloading"
                        self._cancel_requested   = False
                        self._reschedule_current = False
                        self._pause_event.set()
                        self._save_queue()

                if job is None:
                    mins = self.scheduler.minutes_until_window()
                    logger.info(
                        f"[SCHEDULER] Nur geplante Jobs – warte auf Zeitfenster "
                        f"({self.scheduler.start}–{self.scheduler.end}, in {mins} min)"
                    )
                    self._wakeup_event.wait(timeout=60)
                    self._wakeup_event.clear()
                    continue

                job = self.current_job
                logger.info(f"[START] '{job.repo_id}' | {job.total_files} Datei(en)")

                for i, filename in enumerate(job.files_to_download):
                    if self._cancel_requested:
                        break
                    self._pause_event.wait()
                    if self._cancel_requested:
                        break

                    job.current_file_index   = i
                    job.current_file         = filename
                    job.current_file_progress = 0
                    job.download_speed       = 0.0
                    job.eta_seconds          = None

                    local_dir  = os.path.join(DOWNLOAD_DIR, job.repo_id)
                    local_path = os.path.realpath(
                        os.path.join(local_dir, filename.replace("/", os.sep)))
                    # Atomic update: write to .sync-tmp, replace on success
                    is_update_file = job.is_update and os.path.exists(local_path)
                    write_path     = (local_path + ".sync-tmp") if is_update_file else local_path

                    if not local_path.startswith(os.path.realpath(DOWNLOAD_DIR)):
                        logger.error(f"[SECURITY] Path-Traversal blockiert: '{filename}'")
                        continue
                    try:
                        os.makedirs(os.path.dirname(local_path), exist_ok=True)
                    except OSError as e:
                        logger.error(f"[ERROR] Verzeichnis konnte nicht erstellt werden: {e}")
                        job.status        = "error"
                        job.error_message = f"Cannot create directory: {e}"
                        break

                    url      = hf_hub_url(job.repo_id, filename)
                    file_done = False

                    for attempt, retry_delay in enumerate(_NET_RETRY_DELAYS + [None], start=1):
                        if self._cancel_requested:
                            break
                        try:
                            existing_size = (os.path.getsize(write_path)
                                            if os.path.exists(write_path) else 0)
                            req_headers = {}
                            if existing_size > 0:
                                req_headers["Range"] = f"bytes={existing_size}-"
                            token = get_hf_token()
                            if token:
                                req_headers["Authorization"] = f"Bearer {token}"

                            with requests.get(
                                url, stream=True, timeout=(30, 60), headers=req_headers
                            ) as r:
                                if r.status_code == 416:
                                    logger.info(
                                        f"[SKIP] ({i+1}/{job.total_files}) "
                                        f"'{filename}' – bereits vollständig"
                                    )
                                    if is_update_file and os.path.exists(write_path):
                                        os.replace(write_path, local_path)
                                    job.current_file_progress = 100
                                    job.total_progress = ((i + 1) / job.total_files) * 100
                                    file_done = True
                                    break

                                r.raise_for_status()

                                if r.status_code == 206:
                                    remaining  = int(r.headers.get("content-length", 0))
                                    total_size = existing_size + remaining
                                    downloaded = existing_size
                                    file_mode  = "ab"
                                    size_str   = fmt_size(total_size) if total_size else "?"
                                    logger.info(
                                        f"[RESUME] ({i+1}/{job.total_files}) '{filename}' "
                                        f"ab {fmt_size(existing_size)} / {size_str}"
                                    )
                                else:
                                    total_size = int(r.headers.get("content-length", 0))
                                    downloaded = 0
                                    file_mode  = "wb"
                                    size_str   = fmt_size(total_size) if total_size else "?"
                                    if existing_size > 0:
                                        logger.warning(
                                            f"[RESTART] Kein Resume-Support – "
                                            f"'{filename}' wird neu gestartet"
                                        )
                                    else:
                                        logger.info(
                                            f"[FILE] ({i+1}/{job.total_files}) "
                                            f"'{filename}' | {size_str}"
                                        )

                                last_pct        = int((downloaded / total_size * 100) // 25) * 25 \
                                                  if total_size > 0 else -1
                                _win_bytes      = 0
                                _win_start      = time.monotonic()
                                _chunk_start    = time.monotonic()

                                with open(write_path, file_mode) as f:
                                    for chunk in r.iter_content(chunk_size=CHUNK_SIZE):
                                        if self._cancel_requested:
                                            break
                                        self._pause_event.wait()
                                        if self._cancel_requested:
                                            break
                                        if chunk:
                                            f.write(chunk)
                                            chunk_len   = len(chunk)
                                            downloaded += chunk_len
                                            _win_bytes += chunk_len

                                            # Bandwidth throttle
                                            bw = get_bandwidth_limit()
                                            if bw > 0:
                                                _elapsed  = time.monotonic() - _chunk_start
                                                _expected = chunk_len / bw
                                                _sleep    = _expected - _elapsed
                                                while _sleep > 0 and not self._cancel_requested:
                                                    time.sleep(min(0.05, _sleep))
                                                    _sleep -= 0.05
                                            _chunk_start = time.monotonic()

                                            # Speed / ETA (1s sliding window)
                                            _now     = time.monotonic()
                                            _elapsed = _now - _win_start
                                            if _elapsed >= 1.0:
                                                job.download_speed = _win_bytes / _elapsed
                                                _win_bytes  = 0
                                                _win_start  = _now
                                                if job.download_speed > 0 and total_size > 0:
                                                    job.eta_seconds = int(
                                                        (total_size - downloaded) / job.download_speed
                                                    )

                                            if total_size > 0:
                                                job.current_file_progress = (downloaded / total_size) * 100
                                                job.total_progress = (
                                                    (i + downloaded / total_size) / job.total_files
                                                ) * 100
                                                pct = int(job.current_file_progress // 25) * 25
                                                if pct > last_pct and pct > 0:
                                                    last_pct = pct
                                                    logger.info(
                                                        f"[PROGRESS] '{filename}' – {pct}% "
                                                        f"({fmt_size(downloaded)}/{size_str}) "
                                                        f"| Gesamt: {job.total_progress:.1f}%"
                                                    )

                            if self._cancel_requested:
                                logger.info(
                                    f"[CANCEL] '{filename}' unterbrochen bei "
                                    f"{fmt_size(downloaded)} – Teildatei bleibt"
                                )
                                break

                            if is_update_file:
                                os.replace(write_path, local_path)
                                logger.info(f"[UPDATE] '{filename}' aktualisiert ({fmt_size(downloaded)})")
                            else:
                                logger.info(f"[DONE] '{filename}' ({fmt_size(downloaded)})")
                            file_done = True
                            break

                        except _NET_ERRORS as e:
                            if self._cancel_requested:
                                break
                            if retry_delay is not None:
                                logger.warning(
                                    f"[RETRY] '{filename}' Versuch {attempt}/{len(_NET_RETRY_DELAYS)}: "
                                    f"{e} – Retry in {retry_delay}s"
                                )
                                for _ in range(retry_delay):
                                    if self._cancel_requested:
                                        break
                                    time.sleep(1)
                            else:
                                logger.error(
                                    f"[ERROR] '{filename}' nach {len(_NET_RETRY_DELAYS)} Retries: {e}"
                                )
                                job.status        = "error"
                                job.error_message = f"Network error after retries: {e}"

                        except Exception as e:
                            if not self._cancel_requested:
                                job.status        = "error"
                                job.error_message = f"Failed: {e}"
                                logger.error(f"[ERROR] '{filename}': {e}")
                            break

                    if job.status == "error" or self._cancel_requested:
                        break

                with self._lock:
                    if self._reschedule_current:
                        self._reschedule_current = False
                        self._cancel_requested   = False
                        job.status               = "queued"
                        job.current_file_index   = 0
                        job.current_file         = ""
                        job.current_file_progress = 0
                        job.total_progress        = 0
                        self.queue.insert(0, job)
                        logger.info(f"[SCHEDULER] '{job.repo_id}' in Scheduler-Queue verschoben")
                    elif self._cancel_requested:
                        job.status = "cancelled"
                        logger.info(f"[CANCELLED] '{job.repo_id}'")
                    elif job.status != "error":
                        job.status = "completed"
                        logger.info(f"[COMPLETED] '{job.repo_id}' ({job.total_files} Datei(en))")

                    if self.current_job == job:
                        self.current_job = None
                    self._save_queue()
        finally:
            with self._lock:
                self._worker_running = False
