"""
managers/scheduler.py — SchedulerConfig
Verwaltung des Download-Zeitfensters (Start/End, Wochentage).
"""
import json
import logging
import os
from datetime import datetime

logger = logging.getLogger("hf_downloader")


class SchedulerConfig:
    def __init__(self):
        self.enabled = False
        self.start   = "23:00"        # HH:MM — window start
        self.end     = "07:00"        # HH:MM — window end (may cross midnight)
        self.days    = list(range(7)) # 0=Mon … 6=Sun

    def is_in_window(self) -> bool:
        """True if downloads should run right now."""
        if not self.enabled:
            return True  # scheduler off → no restriction
        now = datetime.now()
        if now.weekday() not in self.days:
            return False
        start_h, start_m = map(int, self.start.split(":"))
        end_h,   end_m   = map(int, self.end.split(":"))
        start_min = start_h * 60 + start_m
        end_min   = end_h   * 60 + end_m
        now_min   = now.hour * 60 + now.minute
        if start_min <= end_min:          # same-day window e.g. 09:00–17:00
            return start_min <= now_min < end_min
        else:                             # midnight-crossing e.g. 23:00–07:00
            return now_min >= start_min or now_min < end_min

    def minutes_until_window(self) -> int:
        """Minutes until the next window opens (0 if already in window)."""
        if self.is_in_window():
            return 0
        now = datetime.now()
        start_h, start_m = map(int, self.start.split(":"))
        start_min = start_h * 60 + start_m
        now_min   = now.hour * 60 + now.minute
        diff = (start_min - now_min) % (24 * 60)
        return diff if diff > 0 else 24 * 60

    def to_dict(self) -> dict:
        return {"enabled": self.enabled, "start": self.start,
                "end": self.end, "days": self.days}

    @staticmethod
    def _parse_time(value: str, default: str) -> str:
        """Validates HH:MM format; falls back to default on error."""
        try:
            h, m = map(int, str(value).split(":"))
            if 0 <= h <= 23 and 0 <= m <= 59:
                return f"{h:02d}:{m:02d}"
        except (ValueError, AttributeError):
            pass
        logger.warning(f"[SCHEDULER] Ungültiges Zeitformat '{value}' – verwende '{default}'")
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
