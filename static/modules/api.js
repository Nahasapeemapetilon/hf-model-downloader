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
    return fetch(url, { ...options, headers });
}
