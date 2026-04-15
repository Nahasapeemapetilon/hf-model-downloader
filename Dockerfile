# Basis-Image: Python 3.11 slim (LTS bis Oktober 2027)
FROM python:3.11-slim

# Python-Verhalten optimieren:
#   PYTHONUNBUFFERED — stdout/stderr ungepuffert → Logs erscheinen sofort in docker logs
#   PYTHONDONTWRITEBYTECODE — keine .pyc-Dateien im Image
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Abhängigkeiten zuerst kopieren (besseres Layer-Caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Anwendungscode kopieren
COPY . .

# Persistenz-Verzeichnisse anlegen (werden via Volume überschrieben)
RUN mkdir -p /app/data /app/downloads

EXPOSE 5000

# Healthcheck: prüft sekündlich ob Flask antwortet (Start-Puffer: 10s)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/')" || exit 1

CMD ["python", "app.py"]
