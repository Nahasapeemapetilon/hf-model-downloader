import { t } from './i18n.js';
import { formatBytes } from './utils.js';

let _thresholdGb   = 5;
let _pollTimer     = null;
let _sortAsc       = false;   // false = largest first (default)
let _lastData      = null;

function updateFooter(data) {
    const wrap = document.getElementById('disk-space-display');
    const text = document.getElementById('disk-space-text');
    if (!wrap || !text) return;

    const freeGb = data.free / 1e9;
    text.textContent = `${formatBytes(data.free)} ${t('disk.free')}`;

    wrap.classList.remove('disk-warning', 'disk-critical');
    if (freeGb < _thresholdGb / 2) {
        wrap.classList.add('disk-critical');
        wrap.title = t('disk.critical');
    } else if (freeGb < _thresholdGb) {
        wrap.classList.add('disk-warning');
        wrap.title = t('disk.warning');
    } else {
        wrap.title = '';
    }
}

export async function fetchDiskSpace() {
    try {
        const resp = await fetch('/api/disk-space');
        if (!resp.ok) return;
        updateFooter(await resp.json());
    } catch { /* ignore */ }
}

// ── Breakdown modal ──────────────────────────────────────────

function getModal()    { return document.getElementById('disk-breakdown-modal'); }
function getBody()     { return document.getElementById('disk-breakdown-body'); }
function getRefreshBtn() { return document.getElementById('disk-breakdown-refresh'); }

function renderBreakdown(data) {
    const body = getBody();
    if (!body) return;
    _lastData = data;

    const total   = data.total;
    const entries = [...data.entries].sort((a, b) => _sortAsc ? a.size - b.size : b.size - a.size);
    const other   = total - data.entries.reduce((s, e) => s + e.size, 0);

    const arrow   = _sortAsc ? '↑' : '↓';
    const usedPct = total > 0 ? ((total - data.free) / total * 100).toFixed(1) : 0;

    let html = `
        <p class="disk-breakdown-summary">
            ${formatBytes(data.free)} ${t('disk.free')} · ${usedPct}% ${t('disk.used')}
        </p>
        <div class="disk-breakdown-sort-row">
            <span class="disk-breakdown-col-name">${t('disk.col_folder')}</span>
            <button class="disk-breakdown-sort-btn" id="disk-sort-toggle" type="button">
                ${t('disk.col_size')} ${arrow}
            </button>
        </div>
        <ul class="disk-breakdown-list">`;

    for (const entry of entries) {
        const maxSize = data.entries[0]?.size || 1;
        const pct     = Math.max(0.2, (entry.size / maxSize) * 100);
        html += `
            <li class="disk-breakdown-item">
                <div class="disk-breakdown-meta">
                    <span class="disk-breakdown-name" title="${entry.name}">${entry.name}</span>
                    <span class="disk-breakdown-size">${formatBytes(entry.size)}</span>
                </div>
                <div class="disk-breakdown-bar-wrap">
                    <div class="disk-breakdown-bar" style="width:${pct.toFixed(1)}%"></div>
                </div>
            </li>`;
    }
    if (other > 0) {
        const pct = (other / (data.entries[0]?.size || 1)) * 100;
        html += `
            <li class="disk-breakdown-item disk-breakdown-other">
                <div class="disk-breakdown-meta">
                    <span class="disk-breakdown-name">${t('disk.other')}</span>
                    <span class="disk-breakdown-size">${formatBytes(other)}</span>
                </div>
                <div class="disk-breakdown-bar-wrap">
                    <div class="disk-breakdown-bar" style="width:${Math.min(100, pct).toFixed(1)}%"></div>
                </div>
            </li>`;
    }
    html += '</ul>';

    body.innerHTML = html;

    document.getElementById('disk-sort-toggle')?.addEventListener('click', () => {
        _sortAsc = !_sortAsc;
        renderBreakdown(_lastData);
    });
}

function showSpinner() {
    const body = getBody();
    if (body) body.innerHTML = `<div class="disk-breakdown-spinner"><span class="spinner" aria-hidden="true"></span> ${t('disk.scanning')}</div>`;
}

async function pollBreakdown(force = false) {
    clearTimeout(_pollTimer);
    showSpinner();
    const btn = getRefreshBtn();
    if (btn) btn.disabled = true;

    async function attempt() {
        try {
            const url  = force ? '/api/disk-breakdown?force=1' : '/api/disk-breakdown';
            const resp = await fetch(url);
            const data = await resp.json();
            if (data.status === 'computing') {
                _pollTimer = setTimeout(attempt, 800);
                return;
            }
            renderBreakdown(data);
            updateFooter(data);
        } catch {
            const body = getBody();
            if (body) body.innerHTML = `<p class="disk-breakdown-error">${t('disk.error')}</p>`;
        }
        if (btn) btn.disabled = false;
        force = false;
    }
    attempt();
}

function openModal() {
    const modal = getModal();
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    pollBreakdown(false);
}

function closeModal() {
    clearTimeout(_pollTimer);
    const modal = getModal();
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

export function initDiskSpace() {
    _thresholdGb = parseFloat(localStorage.getItem('diskThresholdGb') || '5');

    const input = document.getElementById('setting-disk-threshold');
    if (input) {
        input.value = _thresholdGb;
        input.addEventListener('change', () => {
            _thresholdGb = Math.max(0.1, parseFloat(input.value) || 5);
            input.value  = _thresholdGb;
            localStorage.setItem('diskThresholdGb', _thresholdGb);
            fetchDiskSpace();
        });
    }

    // Footer click → open breakdown modal
    const display = document.getElementById('disk-space-display');
    if (display) {
        display.style.cursor = 'pointer';
        display.addEventListener('click', openModal);
    }

    // Modal close / refresh buttons
    const closeBtn   = document.getElementById('disk-breakdown-close');
    const backdrop   = document.getElementById('disk-breakdown-backdrop');
    const refreshBtn = getRefreshBtn();
    if (closeBtn)   closeBtn.addEventListener('click', closeModal);
    if (backdrop)   backdrop.addEventListener('click', closeModal);
    if (refreshBtn) refreshBtn.addEventListener('click', () => pollBreakdown(true));

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && getModal()?.style.display !== 'none') closeModal();
    });

    fetchDiskSpace();
}
