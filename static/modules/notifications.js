import { t } from './i18n.js';

const STORAGE_KEY = 'notifications_enabled';

export function notificationsEnabled() {
    return localStorage.getItem(STORAGE_KEY) === 'true'
        && 'Notification' in window
        && Notification.permission === 'granted';
}

export function notifyDownloadComplete(repoId, fileCount) {
    if (!notificationsEnabled()) return;
    try {
        new Notification(t('notif.download_complete'), {
            body: t('notif.download_complete_body', { repo: repoId, count: fileCount }),
            icon: '/static/favicon.ico',
        });
    } catch { /* ignore – browser may block in certain contexts */ }
}

function _permissionBadge() {
    const el = document.getElementById('notif-permission-status');
    if (!el) return;
    const perm = 'Notification' in window ? Notification.permission : 'denied';
    el.textContent = t(`notif.permission_${perm}`);
    el.dataset.state = perm;
}

export function initNotifications() {
    const row    = document.getElementById('notifications-setting-row');
    const toggle = document.getElementById('setting-notifications');

    if (!('Notification' in window)) {
        if (row) row.style.display = 'none';
        return;
    }

    if (!toggle) return;

    toggle.checked = localStorage.getItem(STORAGE_KEY) === 'true'
        && Notification.permission === 'granted';

    _permissionBadge();

    toggle.addEventListener('change', async () => {
        if (toggle.checked) {
            const perm = await Notification.requestPermission();
            _permissionBadge();
            if (perm !== 'granted') {
                toggle.checked = false;
                localStorage.setItem(STORAGE_KEY, 'false');
                return;
            }
        }
        localStorage.setItem(STORAGE_KEY, String(toggle.checked));
    });
}
