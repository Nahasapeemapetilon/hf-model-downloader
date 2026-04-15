import json
import logging
import os
import re
import sys
import time
from datetime import datetime
from flask import Flask, render_template, request, jsonify, Response
import threading
import requests
from huggingface_hub import HfApi, hf_hub_url
try:
    from huggingface_hub.errors import RepositoryNotFoundError
except ImportError:
    from huggingface_hub.utils import RepositoryNotFoundError

# --- Logging setup ---
# Log to both stdout (sichtbar in Unraid-Protokoll / docker logs) und in eine Datei
log_fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")

stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setFormatter(log_fmt)

log_file = os.path.join(os.environ.get("TEMP", "/tmp"), "unraid_downloader_app.log")
file_handler = logging.FileHandler(log_file)
file_handler.setFormatter(log_fmt)

logger = logging.getLogger("hf_downloader")
logger.setLevel(logging.INFO)
logger.addHandler(stream_handler)
logger.addHandler(file_handler)

# Werkzeug-Request-Logs unterdrücken (zu viel Rauschen durch 1-Sekunden-Polling)
logging.getLogger("werkzeug").setLevel(logging.WARNING)

app = Flask(__name__)

@app.before_request
def require_auth():
    auth_user = os.environ.get("AUTH_USER", "").strip()
    auth_pass = os.environ.get("AUTH_PASS", "").strip()
    if not auth_user or not auth_pass:
        return  # Auth not configured — allow all
    creds = request.authorization
    if not creds or creds.username != auth_user or creds.password != auth_pass:
        return Response(
            "Authentication required.",
            401,
            {"WWW-Authenticate": 'Basic realm="HF Downloader"'},
        )

logger.info("=" * 60)
logger.info("HuggingFace Downloader gestartet")
logger.info("=" * 60)

# --- Configuration ---
_default_dl_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "downloads")
DOWNLOAD_DIR = os.environ.get("DOWNLOAD_DIR", _default_dl_dir)
if not os.path.exists(DOWNLOAD_DIR):
    os.makedirs(DOWNLOAD_DIR)
    logger.info(f"Download-Verzeichnis erstellt: {DOWNLOAD_DIR}")
logger.info(f"Download-Verzeichnis: {DOWNLOAD_DIR}")

_default_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DATA_DIR = os.environ.get("DATA_DIR", _default_data_dir)
if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR)
    logger.info(f"Data-Verzeichnis erstellt: {DATA_DIR}")
logger.info(f"Data-Verzeichnis: {DATA_DIR}")

_hf_token = os.environ.get("HF_TOKEN", "").strip()
HF_TOKEN = _hf_token if _hf_token else None
if HF_TOKEN:
    logger.info("HF_TOKEN gesetzt – private Repos werden unterstützt")
else:
    logger.info("HF_TOKEN nicht gesetzt – nur öffentliche Repos")

CHUNK_SIZE = 8192  # bytes per read chunk during download

# Network errors that trigger an automatic retry (with resume from partial file)
_NET_ERRORS = (
    requests.exceptions.ConnectionError,
    requests.exceptions.ChunkedEncodingError,
    requests.exceptions.Timeout,
)
_FILE_RETRY_DELAYS = [5, 15, 30]  # seconds between retries per file

_HF_RETRY_STATUSES = {429, 503}
_HF_RETRY_DELAYS   = [2, 5, 15]  # seconds between retries

def _hf_api_call(fn, *args, **kwargs):
    """
    Calls fn(*args, **kwargs) and retries on rate-limit (429) or
    temporary unavailability (503) with exponential-ish back-off.
    All other exceptions propagate immediately.
    """
    for attempt, delay in enumerate(_HF_RETRY_DELAYS + [None], start=1):
        try:
            return fn(*args, **kwargs)
        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status in _HF_RETRY_STATUSES and delay is not None:
                logger.warning(f"[HF API] HTTP {status} – Retry {attempt}/{len(_HF_RETRY_DELAYS)} in {delay}s")
                time.sleep(delay)
            else:
                raise
        except Exception:
            raise
    # final attempt — let it raise naturally
    return fn(*args, **kwargs)


def _fmt_size(num_bytes):
    """Gibt eine lesbare Dateigröße zurück (z. B. '1.23 GB')."""
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(num_bytes) < 1024.0:
            return f"{num_bytes:.2f} {unit}"
        num_bytes /= 1024.0
    return f"{num_bytes:.2f} PB"

def _safe_repo_path(repo_id: str) -> str | None:
    """
    Gibt den absoluten lokalen Pfad für ein Repo zurück.
    Gibt None zurück wenn der Pfad außerhalb von DOWNLOAD_DIR liegt (Path Traversal).
    """
    base = os.path.realpath(DOWNLOAD_DIR)
    target = os.path.realpath(os.path.join(DOWNLOAD_DIR, repo_id.replace("/", os.sep)))
    if not target.startswith(base + os.sep) and target != base:
        logger.warning(f"[SECURITY] Path-Traversal-Versuch blockiert: '{repo_id}'")
        return None
    return target

# --- Scheduler ---
class SchedulerConfig:
    def __init__(self):
        self.enabled = False
        self.start   = "23:00"       # HH:MM — window start
        self.end     = "07:00"       # HH:MM — window end (may cross midnight)
        self.days    = list(range(7)) # 0=Mon … 6=Sun

    def is_in_window(self) -> bool:
        """Returns True if downloads should run right now."""
        if not self.enabled:
            return True  # scheduler off → no restriction
        now = datetime.now()
        if now.weekday() not in self.days:
            return False
        start_h, start_m = map(int, self.start.split(':'))
        end_h,   end_m   = map(int, self.end.split(':'))
        start_min = start_h * 60 + start_m
        end_min   = end_h   * 60 + end_m
        now_min   = now.hour * 60 + now.minute
        if start_min <= end_min:          # same-day window  e.g. 09:00–17:00
            return start_min <= now_min < end_min
        else:                              # midnight-crossing e.g. 23:00–07:00
            return now_min >= start_min or now_min < end_min

    def minutes_until_window(self) -> int:
        """Minutes until the next window opens (0 if already in window)."""
        if self.is_in_window():
            return 0
        now = datetime.now()
        start_h, start_m = map(int, self.start.split(':'))
        start_min = start_h * 60 + start_m
        now_min   = now.hour * 60 + now.minute
        diff = (start_min - now_min) % (24 * 60)
        return diff if diff > 0 else 24 * 60

    def to_dict(self) -> dict:
        return {"enabled": self.enabled, "start": self.start,
                "end": self.end, "days": self.days}

    @staticmethod
    def _parse_time(value: str, default: str) -> str:
        """Validates HH:MM format and returns it, or falls back to default."""
        try:
            h, m = map(int, str(value).split(':'))
            if 0 <= h <= 23 and 0 <= m <= 59:
                return f"{h:02d}:{m:02d}"
        except (ValueError, AttributeError):
            pass
        logger.warning(f"[SCHEDULER] Ungültiges Zeitformat '{value}' – verwende Standard '{default}'")
        return default

    def update(self, d: dict):
        self.enabled = bool(d.get("enabled", False))
        self.start   = self._parse_time(d.get("start", "23:00"), "23:00")
        self.end     = self._parse_time(d.get("end",   "07:00"), "07:00")
        self.days    = [x for x in (int(v) for v in d.get("days", list(range(7)))) if 0 <= x <= 6]
        if not self.days:
            self.days = list(range(7))

    def save(self, path: str):
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)
        os.replace(tmp, path)

    def load(self, path: str):
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    self.update(json.load(f))
            except Exception as exc:
                logger.warning(f"[SCHEDULER] Config konnte nicht geladen werden: {exc}")


# --- Download Management ---
class DownloadJob:
    def __init__(self, repo_id, files, scheduled=False):
        self.repo_id = repo_id
        self.files_to_download = files
        self.scheduled = scheduled   # True = only run inside scheduler window
        self.status = 'queued'       # queued, downloading, paused, completed, error
        self.error_message = None
        self.total_files = len(files)
        self.current_file_index = 0
        self.current_file = ""
        self.current_file_progress = 0
        self.total_progress = 0

class DownloadManager:
    def __init__(self):
        self.queue = []
        self.current_job = None
        self._pause_event = threading.Event()
        self._cancel_requested = False
        self._download_thread = None
        self._worker_running = False
        self._lock = threading.Lock()
        self.scheduler = SchedulerConfig()
        self.scheduler.load(os.path.join(DATA_DIR, "scheduler.json"))
        self._wakeup_event = threading.Event()
        self._reschedule_current = False
        self._load_queue()
        # Monitor thread: auto-pause/resume scheduled jobs when window opens/closes
        threading.Thread(target=self._scheduler_monitor, daemon=True).start()

    # ------------------------------------------------------------------
    # Queue persistence
    # ------------------------------------------------------------------
    def _queue_state_path(self) -> str:
        return os.path.join(DATA_DIR, "queue_state.json")

    def _save_queue(self):
        """Write queue state to disk atomically. Caller must hold self._lock."""
        state = []
        # If a job was running when we crash/restart, put it back at the front
        if self.current_job and self.current_job.status in ("downloading", "paused"):
            state.append({"repo_id":   self.current_job.repo_id,
                          "files":     self.current_job.files_to_download,
                          "scheduled": self.current_job.scheduled})
        for job in self.queue:
            state.append({"repo_id":   job.repo_id,
                          "files":     job.files_to_download,
                          "scheduled": job.scheduled})

        path = self._queue_state_path()
        tmp  = path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2)
            os.replace(tmp, path)   # atomic on both POSIX and Windows
        except Exception as exc:
            logger.warning(f"[QUEUE] Queue-State konnte nicht gespeichert werden: {exc}")

    def _load_queue(self):
        """Restore queue from disk on startup (called before lock is needed)."""
        path = self._queue_state_path()
        if not os.path.exists(path):
            return
        try:
            with open(path, "r", encoding="utf-8") as f:
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
                logger.info(f"[QUEUE] {restored} Job(s) aus gespeichertem Queue-State wiederhergestellt")
                self._worker_running = True
                self._download_thread = threading.Thread(target=self._download_worker, daemon=True)
                self._download_thread.start()
        except Exception as exc:
            logger.warning(f"[QUEUE] Queue-State konnte nicht geladen werden: {exc}")

    def _scheduler_monitor(self):
        """Background thread: auto-pause/resume the current job when the scheduler window opens or closes."""
        prev_in_window = self.scheduler.is_in_window()
        while True:
            time.sleep(30)
            in_window = self.scheduler.is_in_window()
            with self._lock:
                job = self.current_job
            if job and job.scheduled:
                if in_window and not prev_in_window and job.status == 'paused':
                    logger.info(f"[SCHEDULER] Zeitfenster geöffnet – Resume: '{job.repo_id}'")
                    self.resume()
                elif not in_window and prev_in_window and job.status == 'downloading':
                    logger.info(f"[SCHEDULER] Zeitfenster beendet – Pause: '{job.repo_id}'")
                    self.pause()
            prev_in_window = in_window

    def move_current_to_scheduler(self):
        """Cancels the active download and re-queues it as a scheduled job."""
        with self._lock:
            if not self.current_job:
                return False, "No active download."
            if not self.scheduler.enabled:
                return False, "Scheduler is not enabled."
            self.current_job.scheduled = True
            self._reschedule_current = True
            self._cancel_requested = True
            self._pause_event.set()  # unpause so worker can process the cancel
        return True, f"'{self.current_job.repo_id}' wird in Scheduler-Queue verschoben."

    def add_to_queue(self, repo_id, files, scheduled=False):
        with self._lock:
            # Prevent adding the exact same repo+files combination if already queued or running
            requested = set(files)
            for j in self.queue:
                if j.repo_id == repo_id and set(j.files_to_download) == requested:
                    logger.warning(f"[QUEUE] '{repo_id}' mit identischen Dateien bereits in Warteschlange – übersprungen")
                    return False, "This exact download is already in the queue."
            if self.current_job and self.current_job.repo_id == repo_id and set(self.current_job.files_to_download) == requested:
                logger.warning(f"[QUEUE] '{repo_id}' mit identischen Dateien läuft bereits – übersprungen")
                return False, "This exact download is already running."

            job = DownloadJob(repo_id, files, scheduled)
            self.queue.append(job)
            mode = "geplant" if scheduled else "sofort"
            logger.info(f"[QUEUE] '{repo_id}' hinzugefügt ({len(files)} Datei(en), {mode}) | Warteschlange: {len(self.queue)} Job(s)")
            self._save_queue()
            # If the download thread is not running, start it
            if not self._worker_running:
                self._worker_running = True
                self._download_thread = threading.Thread(target=self._download_worker, daemon=True)
                self._download_thread.start()
            elif not scheduled:
                # Wake up worker immediately if it's waiting for the scheduler window
                self._wakeup_event.set()
        return True, "Added to download queue."

    def pause(self):
        with self._lock:
            if self.current_job and self.current_job.status == 'downloading':
                self._pause_event.clear()
                self.current_job.status = 'paused'
                logger.info(f"[PAUSE] Download pausiert: '{self.current_job.repo_id}' "
                            f"(Datei {self.current_job.current_file_index + 1}/{self.current_job.total_files})")

    def resume(self):
        with self._lock:
            if self.current_job and self.current_job.status == 'paused':
                self.current_job.status = 'downloading'
                self._pause_event.set()
                logger.info(f"[RESUME] Download fortgesetzt: '{self.current_job.repo_id}'")

    def cancel(self):
        with self._lock:
            if self.current_job and self.current_job.status in ['downloading', 'paused']:
                logger.info(f"[CANCEL] Abbruch angefordert für: '{self.current_job.repo_id}'")
                self._cancel_requested = True
                self._pause_event.set() # Un-pause to allow the worker to exit

    def move_in_queue(self, index, direction):
        with self._lock:
            if 0 <= index < len(self.queue):
                if direction == 'up' and index > 0:
                    self.queue[index], self.queue[index - 1] = self.queue[index - 1], self.queue[index]
                elif direction == 'down' and index < len(self.queue) - 1:
                    self.queue[index], self.queue[index + 1] = self.queue[index + 1], self.queue[index]
                logger.info(f"[QUEUE] '{self.queue[index].repo_id}' in Warteschlange verschoben ({direction})")
                self._save_queue()

    def remove_from_queue(self, index):
        with self._lock:
            if 0 <= index < len(self.queue):
                removed = self.queue[index].repo_id
                del self.queue[index]
                logger.info(f"[QUEUE] '{removed}' aus Warteschlange entfernt")
                self._save_queue()
    
    def get_status(self):
        with self._lock:
            queue_status = [
                {'repo_id': j.repo_id, 'status': j.status,
                 'total_files': j.total_files, 'scheduled': j.scheduled}
                for j in self.queue
            ]
            sched = self.scheduler
            base_status = {
                'queue': queue_status,
                'scheduler': {
                    **sched.to_dict(),
                    'in_window':            sched.is_in_window(),
                    'minutes_until_window': sched.minutes_until_window(),
                },
            }

            if self.current_job:
                base_status.update({
                    'status': self.current_job.status,
                    'current_repo_id': self.current_job.repo_id,
                    'files_to_download': self.current_job.files_to_download,
                    'total_files': self.current_job.total_files,
                    'file_index': self.current_job.current_file_index + 1,
                    'current_file': self.current_job.current_file,
                    'total_progress': self.current_job.total_progress,
                    'error': self.current_job.error_message
                })
            elif self.queue:
                 base_status['status'] = 'pending' # There are items in the queue, but none are active
            else:
                base_status['status'] = 'idle'

            return base_status

    def _download_worker(self):
        try:
            while True:
                job = None
                with self._lock:
                    in_window = self.scheduler.is_in_window()
                    # Priority 1: immediate (non-scheduled) jobs
                    for i, j in enumerate(self.queue):
                        if not j.scheduled:
                            job = self.queue.pop(i)
                            break
                    # Priority 2: scheduled jobs — only if window is open
                    if job is None and in_window:
                        for i, j in enumerate(self.queue):
                            if j.scheduled:
                                job = self.queue.pop(i)
                                break

                    if job is None:
                        if not self.queue:
                            self.current_job = None
                            logger.info("[WORKER] Warteschlange leer – Worker beendet")
                            self._save_queue()
                            return
                        # Only scheduled jobs remain, window not open yet — wait
                    else:
                        self.current_job = job
                        job.status = 'downloading'
                        self._cancel_requested = False
                        self._reschedule_current = False
                        self._pause_event.set()
                        self._save_queue()

                if job is None:
                    mins = self.scheduler.minutes_until_window()
                    logger.info(f"[SCHEDULER] Nur geplante Jobs – warte auf Zeitfenster "
                                f"({self.scheduler.start}–{self.scheduler.end}, in {mins} min)")
                    # Wait up to 60s, but wake up immediately if a non-scheduled job arrives
                    self._wakeup_event.wait(timeout=60)
                    self._wakeup_event.clear()
                    continue

                job = self.current_job
                logger.info(f"[START] Starte Job: '{job.repo_id}' | {job.total_files} Datei(en)")

                for i, filename in enumerate(job.files_to_download):
                    if self._cancel_requested: break
                    self._pause_event.wait()
                    if self._cancel_requested: break

                    job.current_file_index = i
                    job.current_file = filename
                    job.current_file_progress = 0

                    local_dir = os.path.join(DOWNLOAD_DIR, job.repo_id)
                    local_path = os.path.realpath(os.path.join(local_dir, filename.replace("/", os.sep)))
                    if not local_path.startswith(os.path.realpath(DOWNLOAD_DIR)):
                        logger.error(f"[SECURITY] Path-Traversal in Dateiname blockiert: '{filename}'")
                        continue
                    try:
                        os.makedirs(os.path.dirname(local_path), exist_ok=True)
                    except OSError as e:
                        logger.error(f"[ERROR] Verzeichnis konnte nicht erstellt werden für '{filename}': {e}")
                        job.status = 'error'
                        job.error_message = f"Cannot create directory: {e}"
                        break

                    url = hf_hub_url(job.repo_id, filename)
                    file_done = False

                    for attempt, retry_delay in enumerate(_FILE_RETRY_DELAYS + [None], start=1):
                        if self._cancel_requested:
                            break
                        try:
                            # Re-read existing size on every attempt so resume picks up
                            # exactly where the last attempt left off.
                            existing_size = os.path.getsize(local_path) if os.path.exists(local_path) else 0
                            req_headers = {}
                            if existing_size > 0:
                                req_headers['Range'] = f'bytes={existing_size}-'
                            if HF_TOKEN:
                                req_headers['Authorization'] = f'Bearer {HF_TOKEN}'

                            with requests.get(url, stream=True, timeout=(30, 60), headers=req_headers) as r:
                                # 416 = Datei bereits vollständig vorhanden
                                if r.status_code == 416:
                                    logger.info(f"[SKIP] ({i + 1}/{job.total_files}) '{filename}' – bereits vollständig, übersprungen")
                                    job.current_file_progress = 100
                                    job.total_progress = ((i + 1) / job.total_files) * 100
                                    file_done = True
                                    break

                                r.raise_for_status()

                                if r.status_code == 206:
                                    remaining  = int(r.headers.get('content-length', 0))
                                    total_size = existing_size + remaining
                                    downloaded = existing_size
                                    file_mode  = 'ab'
                                    size_str   = _fmt_size(total_size) if total_size else "unbekannte Größe"
                                    logger.info(f"[RESUME] ({i + 1}/{job.total_files}) '{filename}' | "
                                                f"Fortsetze ab {_fmt_size(existing_size)} / {size_str}")
                                else:
                                    total_size = int(r.headers.get('content-length', 0))
                                    downloaded = 0
                                    file_mode  = 'wb'
                                    size_str   = _fmt_size(total_size) if total_size else "unbekannte Größe"
                                    if existing_size > 0:
                                        logger.warning(f"[RESTART] Server unterstützt kein Resume – "
                                                       f"'{filename}' wird neu gestartet (vorher: {_fmt_size(existing_size)})")
                                    else:
                                        logger.info(f"[FILE] ({i + 1}/{job.total_files}) '{filename}' | {size_str}")

                                last_logged_pct = int((downloaded / total_size * 100) // 25) * 25 if total_size > 0 else -1
                                with open(local_path, file_mode) as f:
                                    for chunk in r.iter_content(chunk_size=CHUNK_SIZE):
                                        if self._cancel_requested: break
                                        self._pause_event.wait()
                                        if self._cancel_requested: break
                                        if chunk:
                                            f.write(chunk)
                                            downloaded += len(chunk)
                                            if total_size > 0:
                                                job.current_file_progress = (downloaded / total_size) * 100
                                                job.total_progress = ((i + (downloaded / total_size)) / job.total_files) * 100
                                                pct = int(job.current_file_progress // 25) * 25
                                                if pct > last_logged_pct and pct > 0:
                                                    last_logged_pct = pct
                                                    logger.info(f"[PROGRESS] '{filename}' – {pct}% "
                                                                f"({_fmt_size(downloaded)} / {size_str}) | "
                                                                f"Gesamt: {job.total_progress:.1f}%")

                            if self._cancel_requested:
                                logger.info(f"[CANCEL] '{filename}' unterbrochen bei {_fmt_size(downloaded)} – "
                                            f"Teildatei bleibt für späteres Resume erhalten")
                                break
                            logger.info(f"[DONE] '{filename}' vollständig heruntergeladen ({_fmt_size(downloaded)})")
                            file_done = True
                            break  # success — move on to next file

                        except _NET_ERRORS as e:
                            if self._cancel_requested:
                                break
                            if retry_delay is not None:
                                logger.warning(f"[RETRY] Netzwerkfehler bei '{filename}' "
                                               f"(Versuch {attempt}/{len(_FILE_RETRY_DELAYS)}): {e} – "
                                               f"Retry in {retry_delay}s (Resume ab Teildatei)")
                                # Sleep interruptibly so cancel still works
                                for _ in range(retry_delay):
                                    if self._cancel_requested: break
                                    time.sleep(1)
                            else:
                                logger.error(f"[ERROR] '{filename}' nach {len(_FILE_RETRY_DELAYS)} Retries aufgegeben: {e}")
                                job.status = 'error'
                                job.error_message = f"Network error after {len(_FILE_RETRY_DELAYS)} retries: {e}"

                        except Exception as e:
                            if not self._cancel_requested:
                                job.status = 'error'
                                job.error_message = f"Failed to download {filename}: {e}"
                                logger.error(f"[ERROR] Fehler beim Download von '{filename}': {e}")
                            break  # non-network error — don't retry

                    if job.status == 'error' or self._cancel_requested:
                        break

                with self._lock:
                    if self._reschedule_current:
                        # Re-queue as scheduled job instead of cancelling
                        self._reschedule_current = False
                        self._cancel_requested = False
                        job.status = 'queued'
                        job.current_file_index = 0
                        job.current_file = ""
                        job.current_file_progress = 0
                        job.total_progress = 0
                        self.queue.insert(0, job)
                        logger.info(f"[SCHEDULER] '{job.repo_id}' in Scheduler-Queue verschoben")
                    elif self._cancel_requested:
                        job.status = 'cancelled'
                        logger.info(f"[CANCELLED] Job abgebrochen: '{job.repo_id}'")
                    elif job.status != 'error':
                        job.status = 'completed'
                        logger.info(f"[COMPLETED] Job abgeschlossen: '{job.repo_id}' ({job.total_files} Datei(en))")

                    if self.current_job == job:
                        self.current_job = None
                    self._save_queue()
        finally:
            with self._lock:
                self._worker_running = False


download_manager = DownloadManager()

# List to keep track of completed downloads
# Valid HuggingFace repo name: alphanumeric + hyphens/underscores/dots, optional org/ prefix
_HF_NAME_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._-]*$')

def _is_valid_hf_name(name: str) -> bool:
    """Returns True if name looks like a valid HuggingFace org or repo identifier."""
    return bool(_HF_NAME_RE.match(name))

def get_completed_downloads():
    """
    Scans the download directory for local repos.
    Filters out directories whose names don't match HuggingFace naming conventions
    or that contain no files at all.
    """
    completed = []
    if not os.path.exists(DOWNLOAD_DIR):
        return []

    for item in os.listdir(DOWNLOAD_DIR):
        if not _is_valid_hf_name(item):
            logger.debug(f"[SCAN] Übersprungen (ungültiger Name): '{item}'")
            continue
        item_path = os.path.join(DOWNLOAD_DIR, item)
        if not os.path.isdir(item_path):
            continue
        try:
            dir_contents = os.listdir(item_path)
            has_subdirs = any(os.path.isdir(os.path.join(item_path, sub)) for sub in dir_contents)
            has_files   = any(os.path.isfile(os.path.join(item_path, sub)) for sub in dir_contents)

            if has_subdirs:
                # Treat as org — look one level deeper for repo dirs
                for sub_item in dir_contents:
                    if not _is_valid_hf_name(sub_item):
                        continue
                    sub_path = os.path.join(item_path, sub_item)
                    if not os.path.isdir(sub_path):
                        continue
                    # Only include if it actually contains files
                    try:
                        sub_contents = os.listdir(sub_path)
                        if any(os.path.isfile(os.path.join(sub_path, f)) for f in sub_contents):
                            completed.append(f"{item}/{sub_item}")
                    except OSError:
                        continue
            elif has_files:
                # Root-level repo (e.g. 'gpt2') with files directly inside
                completed.append(item)
            # Empty directories are ignored
        except OSError:
            continue

    return sorted(list(set(completed)))

@app.route("/")
def index():
    """Renders the main page."""
    return render_template("index.html", completed_downloads=get_completed_downloads())

@app.route("/api/list-files", methods=["POST"])
def list_files_route():
    """Lists files in a Hugging Face repository."""
    data = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "No repository ID provided"}), 400

    logger.info(f"[API] Dateiliste angefordert: '{repo_id}'")
    try:
        # Use HfApi to get detailed file information
        api = HfApi(token=HF_TOKEN)
        repo_info = _hf_api_call(api.repo_info, repo_id=repo_id, files_metadata=True, timeout=15)
        # Create a list of file details, excluding .gitattributes
        files = [
            {'name': f.rfilename, 'size': f.size}
            for f in repo_info.siblings
            if f.rfilename != '.gitattributes' and f.size is not None
        ]
        logger.info(f"[API] '{repo_id}' – {len(files)} Datei(en) gefunden")
        return jsonify(files)
    except Exception as e:
        logger.error(f"[API] Fehler beim Abrufen von '{repo_id}': {e}")
        return jsonify({"error": f"Could not list files for repo '{repo_id}': {e}"}), 404

@app.route("/api/repository-status", methods=["POST"])
def repository_status():
    """Compares local and remote files for a repository and returns a combined status list."""
    data = request.get_json(silent=True) or {}
    repo_id = data.get("repo_id", "").strip()
    if not repo_id:
        return jsonify({"error": "No repository ID provided"}), 400

    local_repo_path = _safe_repo_path(repo_id)
    if local_repo_path is None:
        return jsonify({"error": "Invalid repository ID."}), 400

    try:
        # Get remote files
        api = HfApi(token=HF_TOKEN)
        repo_info = _hf_api_call(api.repo_info, repo_id=repo_id, files_metadata=True, timeout=15)
        remote_files = {f.rfilename: f.size for f in repo_info.siblings if f.rfilename != '.gitattributes' and f.size is not None}

        # Get local files
        local_files = {}
        if os.path.exists(local_repo_path):
            for root, _, files in os.walk(local_repo_path):
                for name in files:
                    file_path = os.path.join(root, name)
                    relative_path = os.path.relpath(file_path, local_repo_path).replace(os.sep, '/')
                    local_files[relative_path] = os.path.getsize(file_path)
        
        # Combine and determine status
        all_files = set(remote_files.keys()) | set(local_files.keys())
        status_list = []

        for filename in sorted(list(all_files)):
            status = ''
            size = 0
            is_in_remote = filename in remote_files
            is_in_local = filename in local_files

            if is_in_remote and is_in_local:
                if remote_files[filename] == local_files[filename]:
                    status = 'synced'
                    size = local_files[filename]
                else:
                    status = 'outdated'
                    size = remote_files[filename]
            elif is_in_remote and not is_in_local:
                status = 'not_downloaded'
                size = remote_files[filename]
            elif not is_in_remote and is_in_local:
                status = 'local_only'
                size = local_files[filename]
            
            status_list.append({'name': filename, 'size': size, 'status': status})

        return jsonify(status_list)

    except RepositoryNotFoundError:
        logger.warning(f"[API] Repo '{repo_id}' existiert nicht auf HuggingFace")
        return jsonify({"error": f"Repository '{repo_id}' not found on HuggingFace.", "not_found": True}), 404
    except Exception as e:
        return jsonify({"error": f"Could not get repository status for '{repo_id}': {e}"}), 500


@app.route("/api/scheduler", methods=["GET"])
def get_scheduler():
    """Returns current scheduler configuration and window status."""
    sched = download_manager.scheduler
    return jsonify({
        **sched.to_dict(),
        "in_window":            sched.is_in_window(),
        "minutes_until_window": sched.minutes_until_window(),
    })

@app.route("/api/scheduler", methods=["POST"])
def set_scheduler():
    """Updates scheduler configuration."""
    data = request.get_json(silent=True) or {}
    download_manager.scheduler.update(data)
    path = os.path.join(DATA_DIR, "scheduler.json")
    try:
        download_manager.scheduler.save(path)
        logger.info(f"[SCHEDULER] Config gespeichert: {download_manager.scheduler.to_dict()}")
        dm = download_manager
        with dm._lock:
            has_waiting = any(j.scheduled for j in dm.queue)
        if has_waiting:
            with dm._lock:
                if not dm._worker_running:
                    dm._worker_running = True
                    dm._download_thread = threading.Thread(target=dm._download_worker, daemon=True)
                    dm._download_thread.start()
                else:
                    # Worker is sleeping — wake it up immediately so it re-evaluates the window
                    dm._wakeup_event.set()
        return jsonify({"message": "Scheduler updated.", **download_manager.scheduler.to_dict()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/download", methods=["POST"])
def download():
    """Initiates a download."""
    data = request.get_json(silent=True) or {}
    repo_id   = data.get("repo_id", "").strip()
    files     = data.get("files")
    scheduled = bool(data.get("scheduled", False))
    if not repo_id:
        return jsonify({"error": "No repository ID provided"}), 400
    if not files or not isinstance(files, list):
        return jsonify({"error": "No files selected for download"}), 400
    if _safe_repo_path(repo_id) is None:
        return jsonify({"error": "Invalid repository ID."}), 400

    mode = "geplant" if scheduled else "sofort"
    logger.info(f"[REQUEST] Download angefordert ({mode}): '{repo_id}' | {len(files)} Datei(en): {', '.join(files)}")
    success, message = download_manager.add_to_queue(repo_id, files, scheduled)
    if success:
        return jsonify({"message": message})
    else:
        return jsonify({"error": message}), 409

@app.route("/download-status")
def download_status():
    """Returns the current download status."""
    return jsonify(download_manager.get_status())

@app.route("/api/current/to-scheduler", methods=["POST"])
def current_to_scheduler():
    """Moves the currently active download into the scheduler queue."""
    success, message = download_manager.move_current_to_scheduler()
    if not success:
        return jsonify({"error": message}), 400
    return jsonify({"message": message})

@app.route("/pause-download", methods=["POST"])
def pause_download():
    """Pauses the current download."""
    download_manager.pause()
    return jsonify({"message": "Download paused"})

@app.route("/resume-download", methods=["POST"])
def resume_download():
    """Resumes the current download."""
    download_manager.resume()
    return jsonify({"message": "Download resumed"})

@app.route("/cancel-download", methods=["POST"])
def cancel_download():
    """Cancels the current download."""
    download_manager.cancel()
    return jsonify({"message": "Download cancelled"})


@app.route("/api/queue/move/<int:index>/<direction>", methods=["POST"])
def move_queue_item(index, direction):
    """Moves an item up or down in the queue."""
    if direction not in ("up", "down"):
        return jsonify({"error": "Invalid direction."}), 400
    download_manager.move_in_queue(index, direction)
    return jsonify({"message": "Queue updated."})

@app.route("/api/queue/remove/<int:index>", methods=["POST"])
def remove_queue_item(index):
    """Removes an item from the queue."""
    download_manager.remove_from_queue(index)
    return jsonify({"message": "Item removed from queue."})

@app.route("/api/queue/start-now/<int:index>", methods=["POST"])
def queue_start_now(index):
    """Removes the scheduled flag from a queued job so it starts immediately."""
    with download_manager._lock:
        if 0 <= index < len(download_manager.queue):
            download_manager.queue[index].scheduled = False
            download_manager._save_queue()
            download_manager._wakeup_event.set()
            return jsonify({"message": "Job will start immediately."})
    return jsonify({"error": "Invalid queue index."}), 400


@app.route("/completed")
def completed():
    """Returns the list of completed downloads."""
    return jsonify(get_completed_downloads())

@app.route("/api/search-models", methods=["POST"])
def search_models():
    """Searches / browses HuggingFace models with optional text query, tag, and sort."""
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
        api = HfApi(token=HF_TOKEN)
        kwargs = dict(sort=sort, direction=-1, limit=limit, cardData=False)
        if query:
            kwargs["search"] = query
        if pipeline_tag:
            kwargs["pipeline_tag"] = pipeline_tag
        models = list(_hf_api_call(api.list_models, **kwargs))
        result = [
            {
                "id": m.id,
                "downloads": getattr(m, "downloads", 0) or 0,
                "likes":     getattr(m, "likes", 0) or 0,
                "pipeline_tag": getattr(m, "pipeline_tag", None),
            }
            for m in models
        ]
        logger.info(f"[API] Modell-Suche: {len(result)} Ergebnisse")
        return jsonify(result)
    except Exception as e:
        logger.error(f"[API] Fehler bei Modell-Suche: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    try:
        logger.info("Starte Flask-Server auf 0.0.0.0:5000")
        app.run(host="0.0.0.0", port=5000, debug=os.environ.get("FLASK_DEBUG", "false").lower() == "true")
        logger.info("Flask-Server beendet")
    except Exception as e:
        logger.critical(f"Kritischer Fehler beim Starten: {e}", exc_info=True)
        raise
