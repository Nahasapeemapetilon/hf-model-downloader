export const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]')?.content || '';

export async function fetchJson(url, options = {}) {
    const method  = (options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        headers['X-CSRFToken'] = CSRF_TOKEN;
    }
    if (options.body !== undefined && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, { ...options, headers });

    // CSRF token expired — server returns HTML instead of JSON
    if ((response.status === 400 || response.status === 403)) {
        const ct = response.headers.get('content-type') || '';
        if (ct.includes('text/html')) {
            _handleSessionExpired();
        }
    }

    return response;
}

function _handleSessionExpired() {
    if (document.getElementById('session-expired-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'session-expired-banner';
    banner.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
        'background:var(--color-error,#e53e3e)', 'color:#fff',
        'text-align:center', 'padding:10px 16px', 'font-size:14px',
        'cursor:pointer',
    ].join(';');
    banner.textContent = 'Session abgelaufen — klicken zum Neu laden';
    banner.addEventListener('click', () => location.reload());
    document.body.prepend(banner);

    setTimeout(() => location.reload(), 5000);
}
