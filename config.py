"""
config.py — Zentrale Konfiguration für HF Downloader.
Liest Umgebungsvariablen und definiert alle Pfade und Konstanten.
Wird von app.py und den Manager-Modulen importiert.
"""
import json
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
_hf_token_env     = os.environ.get("HF_TOKEN", "").strip() or None
_hf_token_runtime = None   # overrides env var when set via Settings UI

HF_TOKEN = _hf_token_env   # kept for import-compat; prefer get_hf_token()
if HF_TOKEN:
    logger.info("HF_TOKEN gesetzt (Env) – private Repos werden unterstützt")
else:
    logger.info("HF_TOKEN nicht gesetzt – nur öffentliche Repos")


def get_hf_token() -> str | None:
    """Returns the active HF token: UI setting takes priority over env var."""
    return _hf_token_runtime or _hf_token_env


def set_hf_token_runtime(token: str | None) -> None:
    """Set or clear the runtime token (called by settings route on save/delete)."""
    global _hf_token_runtime, HF_TOKEN
    _hf_token_runtime = token.strip() if token else None
    HF_TOKEN = get_hf_token()   # keep module-level var in sync
    if _hf_token_runtime:
        logger.info("HF_TOKEN aktualisiert (Settings UI)")
    else:
        logger.info(f"HF_TOKEN Runtime gelöscht – aktiv: {'Env' if _hf_token_env else 'keiner'}")

def get_or_create_secret_key() -> str:
    """Returns a stable SECRET_KEY across restarts.
    Priority: SECRET_KEY env var → settings.json → generate & persist."""
    env_key = os.environ.get("SECRET_KEY", "").strip()
    if env_key:
        return env_key

    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        key = data.get("secret_key", "")
        if key:
            return key
    except Exception:
        data = {}

    key = os.urandom(24).hex()
    data["secret_key"] = key
    try:
        tmp = SETTINGS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, SETTINGS_PATH)
        logger.info("SECRET_KEY generiert und in settings.json persistiert.")
    except Exception as e:
        logger.warning(f"SECRET_KEY konnte nicht persistiert werden: {e}")
    return key


# --- Download constants ---
CHUNK_SIZE = 8192  # bytes per read chunk

_NET_RETRY_DELAYS  = [5, 15, 30]   # seconds between per-file network retries
_HF_RETRY_STATUSES = {429, 503}
_HF_RETRY_DELAYS   = [2, 5, 15]    # seconds between HF API retries

# --- Persistent file paths ---
HISTORY_PATH     = os.path.join(DATA_DIR, "download_history.json")
HIDDEN_PATH      = os.path.join(DATA_DIR, "hidden_repos.json")
SETTINGS_PATH    = os.path.join(DATA_DIR, "settings.json")
SYNC_CONFIG_PATH = os.path.join(DATA_DIR, "sync_config.json")
SYNC_STATE_PATH  = os.path.join(DATA_DIR, "sync_state.json")
SCHEDULER_PATH   = os.path.join(DATA_DIR, "scheduler.json")
QUEUE_STATE_PATH = os.path.join(DATA_DIR, "queue_state.json")
