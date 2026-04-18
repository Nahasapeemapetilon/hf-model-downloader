import { t } from './i18n.js';

export function updateStatusPill(status) {
    const pill = document.getElementById('global-status-pill');
    if (!pill) return;
    const text = pill.querySelector('.status-text');
    pill.className = 'status-pill';
    const map = {
        'downloading': ['status-active',  'status.downloading'],
        'paused':      ['status-paused',  'status.paused'],
        'error':       ['status-error',   'status.error'],
        'idle':        ['status-idle',    'status.idle'],
        'pending':     ['status-active',  'status.queued'],
    };
    const [cls, key] = map[status] || ['status-idle', 'status.idle'];
    pill.classList.add(cls);
    if (text) text.textContent = t(key);
}
