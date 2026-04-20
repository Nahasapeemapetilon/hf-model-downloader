# Contributing

Thanks for your interest in contributing to HF Model Downloader!

## Reporting Bugs

Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.yml) issue template. Include:
- Steps to reproduce
- Expected vs. actual behavior
- Docker version and Unraid version (if applicable)
- Relevant log output from `/tmp/unraid_downloader_app.log`

## Suggesting Features

Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.yml) issue template. Describe the use case, not just the solution.

## Pull Requests

1. Fork the repo and create a branch from `main`.
2. Keep changes focused — one logical change per PR.
3. Test your changes locally:
   ```bash
   pip install -r requirements.txt
   python app.py
   ```
   Then verify the affected functionality in the browser.
4. For Docker changes, build and run the container:
   ```bash
   docker build -t hf-model-downloader .
   docker run -p 5000:5000 -v ./downloads:/app/downloads hf-model-downloader
   ```
5. Fill out the pull request template when opening the PR.

## Development Setup

```bash
git clone https://github.com/Nahasapeemapetilon/hf-model-downloader.git
cd hf-model-downloader
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

The app runs at `http://localhost:5000`.

## Architecture Notes

- All backend logic lives in `app.py` (single-file Flask app) plus helpers in `managers/`, `routes/`, `utils.py`, and `config.py`.
- Frontend is vanilla JS — no build step required (`static/script.js`, `templates/index.html`).
- Downloads are written to `downloads/<org>/<repo>/` relative to the working directory.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
