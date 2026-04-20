import { fetchJson } from './api.js';
import { showToast } from './toast.js';
import { setCachedSyncConfig } from './state.js';
import { t } from './i18n.js';

export async function saveSyncConfig(partial) {
    try {
        const resp = await fetchJson('/api/sync/config', {
            method: 'POST',
            body:   JSON.stringify(partial),
        });
        if (resp.ok) setCachedSyncConfig(null);
    } catch { /* ignore */ }
}

export async function updateSyncStatusDisplay() {
    try {
        const resp = await fetch('/api/sync/status');
        const s    = await resp.json();
        const el   = document.getElementById('sync-last-run-text');
        if (!el) return;
        if (s.last_run) {
            const dt   = new Date(s.last_run);
            const diff = Math.round((Date.now() - dt.getTime()) / 60000);
            let timeStr;
            if (diff < 1)    timeStr = t('sync.just_now');
            else if (diff < 60)   timeStr = t('sync.min_ago',   { min: diff });
            else if (diff < 1440) timeStr = t('sync.hours_ago', { h: Math.round(diff / 60) });
            else timeStr = dt.toLocaleDateString();

            if (s.status === 'running') {
                el.textContent = t('sync.running', { checked: s.progress?.checked || 0, total: s.progress?.total || 0 });
            } else if (s.outdated_count > 0) {
                el.textContent = s.outdated_count === 1
                    ? t('sync.outdated_one', { time: timeStr })
                    : t('sync.outdated_many', { time: timeStr, count: s.outdated_count });
            } else {
                el.textContent = t('sync.all_ok', { time: timeStr });
            }
        } else {
            el.textContent = t('sync.never');
        }
    } catch { /* ignore */ }
}

export function initSyncSettings(startPollingProgress) {
    const syncEnabledEl  = document.getElementById('setting-auto-sync-enabled');
    const syncModeEl     = document.getElementById('setting-sync-mode');
    const syncIntervalEl = document.getElementById('setting-sync-interval');
    const syncInWindowEl = document.getElementById('setting-sync-in-window');
    const syncRunNowBtn  = document.getElementById('setting-sync-run-now');

    if (syncEnabledEl)  syncEnabledEl.addEventListener('change',  () => saveSyncConfig({ enabled:                syncEnabledEl.checked }));
    if (syncModeEl)     syncModeEl.addEventListener('change',     () => saveSyncConfig({ mode:                   syncModeEl.value }));
    if (syncIntervalEl) syncIntervalEl.addEventListener('change', () => saveSyncConfig({ interval_hours:         parseInt(syncIntervalEl.value, 10) }));
    if (syncInWindowEl) syncInWindowEl.addEventListener('change', () => saveSyncConfig({ run_in_scheduler_window: syncInWindowEl.checked }));

    if (syncRunNowBtn) {
        syncRunNowBtn.addEventListener('click', async () => {
            syncRunNowBtn.disabled = true;
            try {
                const resp   = await fetchJson('/api/sync/run', { method: 'POST' });
                const result = await resp.json();
                if (!resp.ok) throw new Error(result.error);
                showToast('info', t('sync.started'), t('sync.started_msg'));
                startPollingProgress();
                setTimeout(updateSyncStatusDisplay, 1000);
            } catch (err) {
                showToast('error', t('sync.error'), err.message || t('sync.error_msg'));
            } finally {
                setTimeout(() => { syncRunNowBtn.disabled = false; }, 3000);
            }
        });
    }
}
