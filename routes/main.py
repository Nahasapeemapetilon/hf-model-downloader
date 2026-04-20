"""routes/main.py — Hauptseite"""
from flask import Blueprint, current_app, render_template

from utils import get_completed_downloads

main_bp = Blueprint("main", __name__)


@main_bp.route("/")
def index():
    return render_template(
        "index.html",
        completed_downloads=get_completed_downloads(),
        app_version=current_app.config["APP_VERSION"],
    )
