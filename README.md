<p align="center">
  <img src="icon.png" alt="HF Model Downloader" width="128">
</p>

# HF Model Downloader

A web UI to browse, download, and manage models from [HuggingFace Hub](https://huggingface.co), designed to run as a Docker container on Unraid (and any other Docker host).

| Main View | File Selection | Explore & Search |
|---|---|---|
| ![Downloaded Repos](.github/assets/screenshot-main.png) | ![File Selection](.github/assets/screenshot-listfiles.png) | ![Explore Models](.github/assets/screenshot-explore.png) |

## Features

### Download & Queue
- **Download Queue** — Queue multiple repos, pause, resume and cancel at any time
- **Resume Support** — Interrupted downloads continue where they left off (HTTP Range)
- **Download Scheduler** — Set a time window and weekdays; downloads start/pause automatically
- **Bandwidth Limit** — Cap download speed (0–50 MB/s) via the settings panel
- **Speed & ETA** — Live MB/s display and remaining time estimate
- **Download History** — Persistent log of completed, cancelled and failed jobs

### Model Management
- **Sync Status** — Compare local files against the remote repo: synced / outdated / local only
- **Auto-Sync** — Periodically check repos for updates; notify or auto-queue outdated files
- **File Selection** — List all files in a repo, filter and select individually before downloading
- **Hide Repos** — Hide repos from the main view without deleting them
- **Delete Repos & Files** — Remove repos or individual files directly from the UI

### Browse & Explore
- **Browse & Search** — Explore trending models, filter by type (text-gen, image, ASR, …) and sort by downloads, likes or date
- **HF Token** — Support for private and gated repositories (Llama, Gemma, …)

### UI & System
- **Disk Space** — Footer shows free space; warning and critical thresholds configurable
- **Push Notifications** — Browser notifications when a download completes (opt-in)
- **Webhooks** — POST request on download completion, cancellation or error — integrates with n8n, Home Assistant, ioBroker, Make, and more
- **Multi-Language** — Interface available in English, German, French, Spanish and Chinese
- **Dark / Light Theme** — Persisted per browser
- **Basic Auth** — Optional username/password protection via environment variables

---

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

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `HF_TOKEN` | No | — | HuggingFace API token. Required for private/gated repos. Get one at [hf.co/settings/tokens](https://huggingface.co/settings/tokens) |
| `AUTH_USER` | No | — | Basic Auth username. Leave empty to disable auth |
| `AUTH_PASS` | No | — | Basic Auth password. Only active when `AUTH_USER` is also set |
| `DATA_DIR` | No | `/app/data` | App state directory (queue, history, settings). Mount to your appdata folder |
| `DOWNLOAD_DIR` | No | `/app/downloads` | Download path inside the container |
| `FLASK_DEBUG` | No | `false` | Enable Flask debug mode. **Never use in production** |

---

## Unraid Installation

### Option A — Manual Template Import

1. SSH into your Unraid server
2. Copy the template:
   ```bash
   wget -O /boot/config/plugins/dockerMan/templates-user/hf-model-downloader.xml \
     https://raw.githubusercontent.com/Nahasapeemapetilon/hf-model-downloader/main/hf-model-downloader.xml
   ```
3. In the Unraid UI: **Docker → Add Container** → select **hf-model-downloader** from the template dropdown

### Option B — Build Locally on Unraid

```bash
ssh root@<UNRAID-IP>
cd /mnt/user/appdata/hf-model-downloader/src
docker build -t mygithub217/hf-model-downloader .
```

---

## Download Path

Downloaded models are stored under:
```
/app/downloads/<org>/<repo>/<filename>
# e.g.
/app/downloads/meta-llama/Llama-3.2-1B/model.safetensors
```

Mount a host directory to `/app/downloads` to persist downloads across container restarts.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to report bugs, suggest features, or submit pull requests.

---

## License

MIT — see [LICENSE](LICENSE)
