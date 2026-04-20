import { fetchJson } from './api.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';

let _dirty = false;

export function updateSchedulerUI(sched) {
    if (!sched) return;
    const enabledCb  = document.getElementById('scheduler-enabled');
    const startInput = document.getElementById('scheduler-start');
    const endInput   = document.getElementById('scheduler-end');
    const badge      = document.getElementById('scheduler-status-badge');
    const nextWin    = document.getElementById('scheduler-next-window');

    if (!_dirty) {
        if (enabledCb)  enabledCb.checked = sched.enabled;
        if (startInput) startInput.value  = sched.start;
        if (endInput)   endInput.value    = sched.end;
        document.querySelectorAll('.day-pill input[type="checkbox"]').forEach(cb => {
            cb.checked = sched.days.includes(parseInt(cb.value));
        });
    }

    if (badge) {
        if (!sched.enabled) {
            badge.textContent = 'Off';
            badge.className   = 'badge';
        } else if (sched.in_window) {
            badge.textContent = t('status.downloading').slice(0, 6) === 'Lädt' ? 'Aktiv' : 'Active';
            badge.className   = 'badge badge-active';
        } else {
            badge.textContent = 'Waiting';
            badge.className   = 'badge badge-waiting';
        }
    }

    if (nextWin) {
        if (sched.enabled && !sched.in_window) {
            const h = Math.floor(sched.minutes_until_window / 60);
            const m = sched.minutes_until_window % 60;
            const timeStr = h > 0 ? `${h}h ${m}min` : `${m}min`;
            nextWin.textContent   = t('scheduler.next_window', { start: sched.start, time: timeStr });
            nextWin.style.display = 'block';
        } else {
            nextWin.style.display = 'none';
        }
    }
}

export function initScheduler() {
    document.querySelectorAll('#scheduler-enabled, #scheduler-start, #scheduler-end, .day-pill input')
        .forEach(el => el.addEventListener('change', () => { _dirty = true; }));

    fetch('/api/scheduler')
        .then(r => r.json())
        .then(updateSchedulerUI)
        .catch(() => {});

    const saveBtn = document.getElementById('scheduler-save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const enabled = document.getElementById('scheduler-enabled').checked;
            const start   = document.getElementById('scheduler-start').value;
            const end     = document.getElementById('scheduler-end').value;
            const days    = Array.from(
                document.querySelectorAll('.day-pill input[type="checkbox"]:checked')
            ).map(cb => parseInt(cb.value));

            try {
                const response = await fetchJson('/api/scheduler', {
                    method: 'POST',
                    body:   JSON.stringify({ enabled, start, end, days }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);
                _dirty = false;
                updateSchedulerUI({ ...result });
                showToast('success', t('scheduler.saved'), enabled
                    ? t('scheduler.active_label', { start, end })
                    : t('scheduler.disabled'));
            } catch (err) {
                showToast('error', t('scheduler.save_error'), err.message || t('scheduler.save_fail'));
            }
        });
    }
}
