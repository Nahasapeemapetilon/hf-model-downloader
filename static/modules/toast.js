import { escapeHtml } from './utils.js';

const TOAST_DURATION = { success: 4000, info: 4000, warning: 6000, error: 8000 };

const TOAST_ICONS = {
    success: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    warning: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info:    `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
};

export function dismissToast(toast) {
    if (toast.classList.contains('is-dismissing')) return;
    toast.classList.add('is-dismissing');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
}

export function showToast(type, title, message = '') {
    const container = document.getElementById('toast-container');
    const duration  = TOAST_DURATION[type] || 4000;
    const toast     = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        ${TOAST_ICONS[type] || ''}
        <div class="toast-content">
            <div class="toast-title">${escapeHtml(title)}</div>
            ${message ? `<div class="toast-message">${escapeHtml(message)}</div>` : ''}
        </div>
        <button class="toast-close" aria-label="Dismiss notification">✕</button>
        <div class="toast-progress"
             style="animation: toast-timer ${duration}ms linear forwards;"></div>
    `;
    toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));
    container.appendChild(toast);
    setTimeout(() => dismissToast(toast), duration);
}
