import { escapeHtml, formatBytes, getFileTypeInfo, getSizeBadgeClass } from './utils.js';

let _fileListDiv = null;

export function initFiles(fileListDiv) {
    _fileListDiv = fileListDiv;
}

export function getSelectedFiles() {
    return Array.from(_fileListDiv.querySelectorAll('input[type="checkbox"]:checked'))
                .map(cb => cb.value);
}

export function setAllCheckboxes(checked) {
    _fileListDiv.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = checked;
        cb.closest('.file-item').classList.toggle('is-checked', checked);
    });
    updateSelectionSummary();
}

export function updateSelectionSummary() {
    const checked    = Array.from(_fileListDiv.querySelectorAll('input[type="checkbox"]:checked'));
    const count      = checked.length;
    const totalBytes = checked.reduce((sum, cb) =>
        sum + parseInt(cb.closest('.file-item')?.dataset.bytes || 0), 0);

    const countEl = document.getElementById('selected-count');
    const sizeEl  = document.getElementById('selected-size');
    if (countEl) countEl.textContent = count;
    if (sizeEl)  sizeEl.textContent  = formatBytes(totalBytes);

    const downloadBtn = document.getElementById('start-download-btn');
    const scheduleBtn = document.getElementById('schedule-download-btn');
    const countBadge  = document.getElementById('download-btn-count');
    if (downloadBtn) downloadBtn.disabled = count === 0;
    if (scheduleBtn) scheduleBtn.disabled = count === 0;
    if (countBadge) {
        if (count > 0) {
            countBadge.textContent   = count;
            countBadge.style.display = 'inline-flex';
        } else {
            countBadge.style.display = 'none';
        }
    }
}

export function renderFileList(files) {
    _fileListDiv.innerHTML = '';
    if (!files || files.length === 0) {
        _fileListDiv.innerHTML = '<div class="empty-state" style="padding:var(--space-6)"><em>No files found.</em></div>';
        return;
    }

    files.forEach(file => {
        const fileId = `file-${file.name.replace(/[^a-zA-Z0-9]/g, '-')}`;
        const { label, cls } = getFileTypeInfo(file.name);
        const sizeCls = getSizeBadgeClass(file.size || 0);

        const div = document.createElement('div');
        div.className = 'file-item is-checked';
        div.dataset.bytes = file.size || 0;
        div.innerHTML = `
            <input type="checkbox" id="${fileId}" value="${escapeHtml(file.name)}" checked>
            <div class="file-type-icon ${cls}" aria-hidden="true">${label}</div>
            <label for="${fileId}" class="file-item-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</label>
            <span class="size-badge ${sizeCls}">${formatBytes(file.size)}</span>
        `;

        const cb = div.querySelector('input');
        cb.addEventListener('change', () => {
            div.classList.toggle('is-checked', cb.checked);
            updateSelectionSummary();
        });

        _fileListDiv.appendChild(div);
    });

    updateSelectionSummary();
}

export function initFileFilter(fileFilterInput) {
    if (!fileFilterInput) return;
    fileFilterInput.addEventListener('input', function () {
        const query = this.value.toLowerCase();
        _fileListDiv.querySelectorAll('.file-item').forEach(item => {
            const name = item.querySelector('.file-item-name')?.textContent.toLowerCase() || '';
            item.style.display = name.includes(query) ? 'flex' : 'none';
        });
    });
}
