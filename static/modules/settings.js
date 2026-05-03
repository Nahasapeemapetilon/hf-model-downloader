import { fetchJson } from './api.js';
import { settings, applySettings } from './state.js';
import { updateSchedulerUI } from './scheduler.js';
import { updateSyncStatusDisplay } from './sync.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';
import { initNotifications } from './notifications.js';
import { reRenderOpenCards } from './repos.js';

// ── HF Token ─────────────────────────────────────────────────

function renderTokenStatus(data) {
    const statusEl  = document.getElementById('hf-token-status');
    const clearBtn  = document.getElementById('hf-token-clear');
    if (!statusEl) return;

    if (data.source === 'settings') {
        statusEl.innerHTML = `<span class="hf-token-badge hf-token-badge--settings">${t('settings.hf_token_from_settings')}: <code>${data.preview}</code></span>`;
        if (clearBtn) clearBtn.style.display = '';
    } else if (data.source === 'env') {
        statusEl.innerHTML = `<span class="hf-token-badge hf-token-badge--env">${t('settings.hf_token_from_env')}: <code>${data.preview}</code></span>`;
        if (clearBtn) clearBtn.style.display = 'none';
    } else {
        statusEl.innerHTML = `<span class="hf-token-badge hf-token-badge--none">${t('settings.hf_token_not_set')}</span>`;
        if (clearBtn) clearBtn.style.display = 'none';
    }
}

async function loadHfTokenStatus() {
    try {
        const resp = await fetch('/api/settings/hf-token');
        if (resp.ok) renderTokenStatus(await resp.json());
    } catch { /* ignore */ }
}

function initHfToken() {
    const input    = document.getElementById('setting-hf-token');
    const eyeBtn   = document.getElementById('hf-token-eye');
    const saveBtn  = document.getElementById('hf-token-save');
    const clearBtn = document.getElementById('hf-token-clear');

    eyeBtn?.addEventListener('click', () => {
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
    });

    saveBtn?.addEventListener('click', async () => {
        const token = input?.value.trim();
        if (!token) return;
        try {
            const resp = await fetchJson('/api/settings/hf-token', {
                method: 'POST',
                body:   JSON.stringify({ token }),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);
            renderTokenStatus({ source: 'settings', preview: data.preview });
            if (input) input.value = '';
            showToast('success', t('settings.hf_token_saved'), data.preview);
        } catch (e) {
            showToast('error', t('settings.hf_token_error'), e.message);
        }
    });

    clearBtn?.addEventListener('click', async () => {
        try {
            const resp = await fetchJson('/api/settings/hf-token', { method: 'DELETE' });
            const data = await resp.json();
            renderTokenStatus(data);
            showToast('info', t('settings.hf_token_cleared'), '');
        } catch { /* ignore */ }
    });
}

// ─────────────────────────────────────────────────────────────

function updateBandwidthDisplay(mbps) {
    const el = document.getElementById('bandwidth-display');
    if (el) el.textContent = mbps > 0 ? `${mbps.toFixed(1)} MB/s` : t('settings.unlimited');
}

// ── Webhook ───────────────────────────────────────────────────

async function loadWebhookSettings() {
    try {
        const resp = await fetch('/api/settings/webhook');
        if (!resp.ok) return;
        const data = await resp.json();
        const urlEl    = document.getElementById('setting-webhook-url');
        const hintEl   = document.getElementById('webhook-secret-hint');
        const events   = data.events || ['completed', 'cancelled', 'error'];
        if (urlEl) urlEl.value = data.url || '';
        ['completed', 'cancelled', 'error'].forEach(ev => {
            const cb = document.getElementById(`webhook-event-${ev}`);
            if (cb) cb.checked = events.includes(ev);
        });
        if (hintEl) hintEl.style.display = data.secret_set ? '' : 'none';
    } catch { /* ignore */ }
}

function initWebhook() {
    const saveBtn = document.getElementById('webhook-save-btn');
    const testBtn = document.getElementById('webhook-test-btn');

    const urlInput = document.getElementById('setting-webhook-url');

    function isValidWebhookUrl(val) {
        if (!val) return true; // empty = clear, allowed
        try {
            const u = new URL(val);
            return u.protocol === 'http:' || u.protocol === 'https:';
        } catch {
            return false;
        }
    }

    function setUrlValidity(valid) {
        if (!urlInput) return;
        urlInput.classList.toggle('input--error', !valid);
        if (saveBtn) saveBtn.disabled = !valid;
        if (testBtn) testBtn.disabled = !valid;
    }

    urlInput?.addEventListener('input', () => {
        setUrlValidity(isValidWebhookUrl(urlInput.value.trim()));
    });

    saveBtn?.addEventListener('click', async () => {
        const url    = urlInput?.value.trim() || '';
        if (!isValidWebhookUrl(url)) { setUrlValidity(false); return; }
        const secret = document.getElementById('setting-webhook-secret')?.value || '';
        const events = ['completed', 'cancelled', 'error'].filter(ev =>
            document.getElementById(`webhook-event-${ev}`)?.checked
        );
        try {
            const resp = await fetchJson('/api/settings/webhook', {
                method: 'POST',
                body:   JSON.stringify({ url, secret, events }),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);
            const secretInput = document.getElementById('setting-webhook-secret');
            if (secretInput) secretInput.value = '';
            const hintEl = document.getElementById('webhook-secret-hint');
            if (hintEl) hintEl.style.display = data.secret_set ? '' : 'none';
            showToast('success', t('settings.webhook_saved'), url || t('settings.webhook_cleared'));
        } catch (e) {
            showToast('error', t('settings.webhook_save_error'), e.message);
        }
    });

    testBtn?.addEventListener('click', async () => {
        const url    = urlInput?.value.trim() || '';
        if (!isValidWebhookUrl(url)) { setUrlValidity(false); return; }
        const secret = document.getElementById('setting-webhook-secret')?.value || '';
        try {
            const resp = await fetchJson('/api/settings/webhook/test', {
                method: 'POST',
                body:   JSON.stringify({ url, secret }),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);
            showToast('info', t('settings.webhook_test_sent'), url);
        } catch (e) {
            showToast('error', t('settings.webhook_test_error'), e.message);
        }
    });
}

// ─────────────────────────────────────────────────────────────

export async function openSettings() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    try {
        const resp = await fetch('/api/settings/bandwidth');
        const data = await resp.json();
        const slider = document.getElementById('setting-bandwidth');
        if (slider) {
            slider.value = data.bandwidth_limit_mbps || 0;
            updateBandwidthDisplay(parseFloat(slider.value));
        }
    } catch { /* ignore */ }

    loadHfTokenStatus();
    loadWebhookSettings();

    try {
        const syncResp = await fetch('/api/sync/config');
        const cfg      = await syncResp.json();
        const elEnabled  = document.getElementById('setting-auto-sync-enabled');
        const elMode     = document.getElementById('setting-sync-mode');
        const elInterval = document.getElementById('setting-sync-interval');
        const elInWindow = document.getElementById('setting-sync-in-window');
        if (elEnabled)  elEnabled.checked  = cfg.enabled;
        if (elMode)     elMode.value        = cfg.mode || 'notify';
        if (elInterval) elInterval.value    = String(cfg.interval_hours || 24);
        if (elInWindow) elInWindow.checked  = cfg.run_in_scheduler_window !== false;
    } catch { /* ignore */ }

    try {
        const schedResp = await fetch('/api/scheduler');
        if (schedResp.ok) updateSchedulerUI(await schedResp.json());
    } catch { /* ignore */ }

    updateSyncStatusDisplay();
}

export function closeSettings() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

export function initSettings() {
    const modal    = document.getElementById('settings-modal');
    const openBtn  = document.getElementById('settings-btn');
    const closeBtn = document.getElementById('settings-close-btn');
    const backdrop = document.getElementById('settings-backdrop');

    if (modal) {
        modal.addEventListener('click', (e) => {
            const tab = e.target.closest('.settings-tab');
            if (!tab) return;
            const tabId = tab.dataset.tab;
            modal.querySelectorAll('.settings-tab').forEach(t => {
                t.classList.toggle('is-active', t === tab);
                t.setAttribute('aria-selected', t === tab);
            });
            modal.querySelectorAll('.settings-tab-panel').forEach(p => {
                p.classList.toggle('is-active', p.id === `spanel-${tabId}`);
            });
        });
    }

    if (openBtn)  openBtn.addEventListener('click', openSettings);
    if (closeBtn) closeBtn.addEventListener('click', closeSettings);
    if (backdrop) backdrop.addEventListener('click', closeSettings);

    document.addEventListener('keydown', e => {
        const modal = document.getElementById('settings-modal');
        if (e.key === 'Escape' && modal?.style.display !== 'none') closeSettings();
    });

    [
        { id: 'setting-file-delete',        key: 'allowFileDelete'    },
        { id: 'setting-repo-delete',        key: 'allowRepoDelete'    },
        { id: 'setting-non-hf-delete',      key: 'allowNonHFDelete'   },
        { id: 'setting-show-speed',         key: 'showSpeedEta'       },
        { id: 'setting-repo-group-status',  key: 'repoGroupByStatus'  },
    ].forEach(({ id, key }) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.checked = settings[key];
        el.addEventListener('change', () => {
            settings[key] = el.checked;
            localStorage.setItem(id, el.checked);
            applySettings();
            if (key === 'repoGroupByStatus') reRenderOpenCards();
        });
    });

    initHfToken();
    initNotifications();
    initWebhook();

    let _bwSaveTimer = null;

    const bwSlider = document.getElementById('setting-bandwidth');
    if (bwSlider) {
        bwSlider.addEventListener('input', () => {
            const mbps = parseFloat(bwSlider.value);
            updateBandwidthDisplay(mbps);
            clearTimeout(_bwSaveTimer);
            _bwSaveTimer = setTimeout(async () => {
                try {
                    await fetchJson('/api/settings/bandwidth', {
                        method: 'POST',
                        body:   JSON.stringify({ bandwidth_limit_mbps: mbps }),
                    });
                } catch { /* ignore */ }
            }, 400);
        });
    }
}
