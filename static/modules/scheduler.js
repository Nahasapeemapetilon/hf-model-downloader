import { fetchJson } from './api.js';
import { showToast } from './toast.js';

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
            badge.textContent = 'Active';
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
            nextWin.textContent   = `Next window starts at ${sched.start} (in ${timeStr})`;
            nextWin.style.display = 'block';
        } else {
            nextWin.style.display = 'none';
        }
    }
}

export function initScheduler() {
    // Mark dirty when user touches any scheduler control
    document.querySelectorAll('#scheduler-enabled, #scheduler-start, #scheduler-end, .day-pill input')
        .forEach(el => el.addEventListener('change', () => { _dirty = true; }));

    // Load initial config
    fetch('/api/scheduler')
        .then(r => r.json())
        .then(updateSchedulerUI)
        .catch(() => {});

    // Save button
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
                updateSchedulerUI({ ...result, in_window: result.in_window, minutes_until_window: result.minutes_until_window });
                showToast('success', 'Scheduler saved', enabled
                    ? `Active ${start}–${end}`
                    : 'Scheduler disabled.');
            } catch (err) {
                showToast('error', 'Save failed', err.message || 'Could not save scheduler.');
            }
        });
    }
}
