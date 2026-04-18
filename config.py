"""
config.py — Zentrale Konfiguration für HF Downloader.
Liest Umgebungsvariablen und definiert alle Pfade und Konstanten.
Wird von app.py und den Manager-Modulen importiert.
"""
import logging
import os

logger = logging.getLogger("hf_downloader")

# --- Download directory ---
_default_dl_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "downloads")
DOWNLOAD_DIR = os.environ.get("DOWNLOAD_DIR", _default_dl_dir)
if not os.path.exists(DOWNLOAD_DIR):
    os.makedirs(DOWNLOAD_DIR)
    logger.info(f"Download-Verzeichnis erstellt: {DOWNLOAD_DIR}")
logger.info(f"Download-Verzeichnis: {DOWNLOAD_DIR}")

# --- Data directory ---
_default_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DATA_DIR = os.environ.get("DATA_DIR", _default_data_dir)
if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR)
    logger.info(f"Data-Verzeichnis erstellt: {DATA_DIR}")
logger.info(f"Data-Verzeichnis: {DATA_DIR}")

# --- HuggingFace Token ---
_hf_token = os.environ.get("HF_TOKEN", "").strip()
HF_TOKEN = _hf_token if _hf_token else None
if HF_TOKEN:
    logger.info("HF_TOKEN gesetzt – private Repos werden unterstützt")
else:
    logger.info("HF_TOKEN nicht gesetzt – nur öffentliche Repos")

# --- Download constants ---
CHUNK_SIZE = 8192  # bytes per read chunk

_NET_RETRY_DELAYS  = [5, 15, 30]   # seconds between per-file network retries
_HF_RETRY_STATUSES = {429, 503}
_HF_RETRY_DELAYS   = [2, 5, 15]    # seconds between HF API retries

# --- Persistent file paths ---
HIDDEN_PATH      = os.path.join(DATA_DIR, "hidden_repos.json")
SETTINGS_PATH    = os.path.join(DATA_DIR, "settings.json")
SYNC_CONFIG_PATH = os.path.join(DATA_DIR, "sync_config.json")
SYNC_STATE_PATH  = os.path.join(DATA_DIR, "sync_state.json")
SCHEDULER_PATH   = os.path.join(DATA_DIR, "scheduler.json")
QUEUE_STATE_PATH = os.path.join(DATA_DIR, "queue_state.json")
