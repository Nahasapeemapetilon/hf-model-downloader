# HF Model Downloader

A web UI to browse, download, and manage models from [HuggingFace Hub](https://huggingface.co), designed to run as a Docker container on Unraid (and any other Docker host).

## Features

- **Download Queue** — Queue multiple repos, pause, resume and cancel at any time
- **Resume Support** — Interrupted downloads continue where they left off
- **Download Scheduler** — Set a time window and weekdays; downloads start/pause automatically
- **Bandwidth Limit** — Cap download speed via the settings panel
- **Auto-Sync** — Periodically check repos for updates and auto-queue outdated files
- **Sync Status** — Compare local files against the remote repo (synced / outdated / local only)
- **Download History** — Persistent log of completed, cancelled and failed jobs
- **Disk Space Monitor** — Footer shows free space with configurable warning thresholds
- **Push Notifications** — Browser notifications when a download completes
- **Webhooks** — POST request on completion/cancellation/error — works with n8n, Home Assistant, ioBroker and more
- **Multi-Language** — EN / DE / FR / ES / ZH
- **Dark / Light Theme** — Persisted per browser
- **Basic Auth** — Optional username/password protection
- **HF Token** — Support for private and gated repositories (Llama, Gemma, …)

## Quick Start

```bash
docker run -d \
  --name hf-model-downloader \
  -p 5000:5000 \
  -v /path/to/downloads:/app/downloads \
  -v /path/to/appdata:/app/data \
  mygithub217/hf-model-downloader:latest
```

Then open `http://localhost:5000` in your browser.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HF_TOKEN` | — | HuggingFace API token (required for private/gated repos) |
| `AUTH_USER` | — | Basic Auth username (leave empty to disable) |
| `AUTH_PASS` | — | Basic Auth password |
| `DATA_DIR` | `/app/data` | App state directory — mount to your appdata folder |
| `DOWNLOAD_DIR` | `/app/downloads` | Download path inside the container |
| `FLASK_DEBUG` | `false` | Flask debug mode — **never use in production** |

## Unraid

Search for **HF Model Downloader** in the Community Apps plugin, or import the template manually from the [GitHub repository](https://github.com/Nahasapeemapetilon/hf-model-downloader).

## Source & License

[github.com/Nahasapeemapetilon/hf-model-downloader](https://github.com/Nahasapeemapetilon/hf-model-downloader) — MIT License
