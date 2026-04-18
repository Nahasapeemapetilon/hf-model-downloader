export function updateStatusPill(status) {
    const pill = document.getElementById('global-status-pill');
    if (!pill) return;
    const text = pill.querySelector('.status-text');
    pill.className = 'status-pill';
    const map = {
        'downloading': ['status-active', 'Downloading'],
        'paused':      ['status-paused', 'Paused'],
        'error':       ['status-error',  'Error'],
        'idle':        ['status-idle',   'Idle'],
        'pending':     ['status-active', 'Queued'],
    };
    const [cls, label] = map[status] || ['status-idle', 'Idle'];
    pill.classList.add(cls);
    if (text) text.textContent = label;
}
