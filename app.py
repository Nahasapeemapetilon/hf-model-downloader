"""
app.py — HuggingFace Downloader (Flask entry point)
Logging-Setup, Manager-Singletons, Auth, Blueprint-Registrierung.
Business-Logik lebt in managers/ und routes/.
"""
import logging
import os
import sys

from flask import Flask, Response, request
from flask_wtf.csrf import CSRFProtect, generate_csrf

# ============================================================
# Logging (muss vor allen anderen Imports stehen)
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
# Config / Managers
# ============================================================
from managers.download_manager import DownloadManager   # noqa: E402
from managers.sync_manager     import SyncManager       # noqa: E402

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

# --- Singletons ---
sync_manager     = SyncManager()
download_manager = DownloadManager(on_window_open=sync_manager.trigger_if_due)
sync_manager.set_download_manager(download_manager)

# ============================================================
# Flask app
# ============================================================
app = Flask(__name__)
app.config["APP_VERSION"]        = APP_VERSION
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # 5 MB max request body
app.config["SECRET_KEY"]         = os.environ.get("SECRET_KEY", os.urandom(24).hex())
app.download_manager             = download_manager
app.sync_manager                 = sync_manager

csrf = CSRFProtect(app)

@app.context_processor
def inject_csrf():
    return dict(csrf_token=generate_csrf())


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


@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"]        = "DENY"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:;"
    )
    return response


# ============================================================
# Blueprints
# ============================================================
from routes.main      import main_bp       # noqa: E402
from routes.hf        import hf_bp         # noqa: E402
from routes.download  import download_bp   # noqa: E402
from routes.repos     import repos_bp      # noqa: E402
from routes.scheduler import scheduler_bp  # noqa: E402
from routes.settings  import settings_bp   # noqa: E402
from routes.sync      import sync_bp       # noqa: E402

app.register_blueprint(main_bp)
app.register_blueprint(hf_bp)
app.register_blueprint(download_bp)
app.register_blueprint(repos_bp)
app.register_blueprint(scheduler_bp)
app.register_blueprint(settings_bp)
app.register_blueprint(sync_bp)

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
