import { fetchJson } from './api.js';
import { settings, applySettings } from './state.js';
import { updateSchedulerUI } from './scheduler.js';
import { updateSyncStatusDisplay } from './sync.js';

function updateBandwidthDisplay(mbps) {
    const el = document.getElementById('bandwidth-display');
    if (el) el.textContent = mbps > 0 ? `${mbps.toFixed(1)} MB/s` : 'Unlimited';
}

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

    // Tab switching
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

    // Toggle settings from saved state
    [
        { id: 'setting-file-delete',   key: 'allowFileDelete'  },
        { id: 'setting-repo-delete',   key: 'allowRepoDelete'  },
        { id: 'setting-non-hf-delete', key: 'allowNonHFDelete' },
        { id: 'setting-show-speed',    key: 'showSpeedEta'     },
    ].forEach(({ id, key }) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.checked = settings[key];
        el.addEventListener('change', () => {
            settings[key] = el.checked;
            localStorage.setItem(id, el.checked);
            applySettings();
        });
    });

    // Bandwidth slider (debounced auto-save)
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
