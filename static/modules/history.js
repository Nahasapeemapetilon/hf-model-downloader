import { fetchJson } from './api.js';
import { t } from './i18n.js';
import { showToast } from './toast.js';

let _loaded = false;

function formatBytes(b) {
    if (!b) return '—';
    if (b >= 1e12) return (b / 1e12).toFixed(1) + ' TB';
    if (b >= 1e9)  return (b / 1e9).toFixed(1) + ' GB';
    if (b >= 1e6)  return (b / 1e6).toFixed(1) + ' MB';
    return (b / 1e3).toFixed(0) + ' KB';
}

function formatDuration(s) {
    if (!s) return '—';
    if (s < 60)   return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function formatDate(ts) {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleString();
}

function statusClass(status) {
    return { completed: 'history-status--ok', cancelled: 'history-status--warn', error: 'history-status--err' }[status] || '';
}

function statusLabel(status) {
    return t(`history.status_${status}`) || status;
}

function renderList(entries, listEl) {
    if (!entries.length) {
        listEl.innerHTML = `<li class="history-empty">${t('history.empty')}</li>`;
        return;
    }
    listEl.innerHTML = entries.map(e => `
        <li class="history-item" data-id="${e.id}">
            <div class="history-item-main">
                <span class="history-repo">${e.repo_id}</span>
                <span class="history-status ${statusClass(e.status)}">${statusLabel(e.status)}</span>
            </div>
            <div class="history-item-meta">
                <span title="${t('history.col_date')}">${formatDate(e.completed_at)}</span>
                <span class="history-sep">·</span>
                <span title="${t('history.col_files')}">${e.file_count} ${t('unit.files')}</span>
                <span class="history-sep">·</span>
                <span title="${t('history.col_size')}">${formatBytes(e.bytes_downloaded)}</span>
                <span class="history-sep">·</span>
                <span title="${t('history.col_duration')}">${formatDuration(e.duration_seconds)}</span>
                ${e.error_msg ? `<span class="history-error-msg" title="${e.error_msg}">⚠ ${e.error_msg}</span>` : ''}
            </div>
            <button class="history-delete-btn btn btn-ghost btn-icon" data-id="${e.id}" aria-label="${t('history.delete_entry')}">✕</button>
        </li>`).join('');
}

async function loadHistory() {
    const listEl = document.getElementById('history-list');
    if (!listEl) return;
    try {
        const resp    = await fetch('/api/history');
        const entries = await resp.json();
        renderList(entries, listEl);
        _loaded = true;
    } catch {
        listEl.innerHTML = `<li class="history-empty">${t('history.load_error')}</li>`;
    }
}

export function refreshHistory() {
    if (_loaded) loadHistory();
}

export function initHistory() {
    const toggle   = document.getElementById('history-toggle');
    const content  = document.getElementById('history-content');
    const clearBtn = document.getElementById('history-clear-btn');
    const listEl   = document.getElementById('history-list');

    if (!toggle || !content) return;

    toggle.addEventListener('click', () => {
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : 'block';
        toggle.setAttribute('aria-expanded', String(!isOpen));
        toggle.classList.toggle('is-open', !isOpen);
        if (!isOpen && !_loaded) loadHistory();
    });

    clearBtn?.addEventListener('click', async () => {
        if (!confirm(t('history.confirm_clear'))) return;
        try {
            await fetchJson('/api/history', { method: 'DELETE' });
            if (listEl) listEl.innerHTML = `<li class="history-empty">${t('history.empty')}</li>`;
            showToast('info', t('history.cleared'), '');
        } catch { /* ignore */ }
    });

    listEl?.addEventListener('click', async (e) => {
        const btn = e.target.closest('.history-delete-btn');
        if (!btn) return;
        const id = btn.dataset.id;
        try {
            await fetchJson(`/api/history/${id}`, { method: 'DELETE' });
            btn.closest('.history-item')?.remove();
            if (!listEl.querySelector('.history-item')) {
                listEl.innerHTML = `<li class="history-empty">${t('history.empty')}</li>`;
            }
        } catch { /* ignore */ }
    });
}
