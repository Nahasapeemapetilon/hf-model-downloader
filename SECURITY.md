# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest (`main`) | Yes |
| Older releases | No |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues by opening a private [GitHub Security Advisory](https://github.com/Nahasapeemapetilon/hf-model-downloader/security/advisories/new). Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce or proof-of-concept (if available)
- Affected version(s)

You can expect an acknowledgement within 48 hours and a status update within 7 days.

## Security Considerations

- **Basic Auth** is optional but recommended when the container is exposed to a network. Set `AUTH_USER` and `AUTH_PASS` environment variables.
- **HF Token** is passed via environment variable and never written to disk or logged.
- **`FLASK_DEBUG`** must never be set to `true` in production — it exposes an interactive debugger.
- The container runs as a non-root user by default. Avoid overriding this.
