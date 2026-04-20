import { escapeHtml } from './utils.js';
import { t } from './i18n.js';

export function renderQueue(queue, queueListUl) {
    const container  = document.getElementById('download-queue-container');
    const countBadge = document.getElementById('queue-count-badge');

    queueListUl.innerHTML = '';

    if (!queue || queue.length === 0) {
        if (container) container.style.display = 'none';
        return;
    }

    if (container) container.style.display = 'block';
    if (countBadge) countBadge.textContent = queue.length;

    queue.forEach((job, index) => {
        const li = document.createElement('li');
        li.className = 'queue-item';
        const clockIcon = job.scheduled
            ? `<svg class="queue-scheduled-icon" title="Scheduled" width="13" height="13" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" stroke-width="2.5"
                    stroke-linecap="round" stroke-linejoin="round">
                   <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
               </svg>`
            : '';
        const fileWord = job.total_files === 1 ? t('unit.file') : t('unit.files');
        li.innerHTML = `
            <div class="queue-position">${index + 1}</div>
            <div class="queue-item-info">
                <div class="queue-repo-name truncate" title="${escapeHtml(job.repo_id)}">
                    ${clockIcon}${escapeHtml(job.repo_id)}
                </div>
                <div class="queue-file-count">${job.total_files} ${fileWord}</div>
            </div>
            <span class="queue-status-badge ${job.scheduled ? 'badge-scheduled' : ''}">${escapeHtml(job.status)}</span>
            <div class="queue-item-controls">
                ${job.scheduled ? `<button class="queue-start-now-btn" data-index="${index}"
                        aria-label="Start now" title="Start immediately">▶</button>` : ''}
                <button class="queue-move-btn move-up-btn" data-index="${index}"
                        ${index === 0 ? 'disabled' : ''} aria-label="Move up" title="Move up">▲</button>
                <button class="queue-move-btn move-down-btn" data-index="${index}"
                        ${index === queue.length - 1 ? 'disabled' : ''} aria-label="Move down" title="Move down">▼</button>
                <button class="queue-remove-btn remove-btn" data-index="${index}"
                        aria-label="Remove from queue" title="Remove">✕</button>
            </div>
        `;
        queueListUl.appendChild(li);
    });
}
