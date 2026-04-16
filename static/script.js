document.addEventListener("DOMContentLoaded", function () {

    // ============================================================
    // DOM REFERENCES
    // ============================================================
    const listFilesForm          = document.getElementById("list-files-form");
    const repoIdInput            = document.getElementById("repo-id-input");
    const fileSelectionContainer = document.getElementById("file-selection-container");
    const fileListDiv            = document.getElementById("file-list");
    const downloadSelectionForm  = document.getElementById("download-selection-form");
    const selectAllBtn           = document.getElementById("select-all-btn");
    const deselectAllBtn         = document.getElementById("deselect-all-btn");
    const fileFilterInput        = document.getElementById("file-filter-input");
    const startDownloadBtn       = document.getElementById("start-download-btn");
    const queueListUl            = document.getElementById("download-queue-list");
    const completedListUl        = document.getElementById("completed-list");
    const themeToggle            = document.getElementById("theme-toggle");

    let progressTimeout      = null;
    let currentRepoId        = '';
    let trendingLoaded       = false;
    let repoFilter           = localStorage.getItem('repoFilter') || 'all'; // 'all' | 'hf' | 'local'

    // Repos confirmed as "not on HuggingFace"
    const localOnlyRepos  = new Set(JSON.parse(localStorage.getItem('localOnlyRepos')  || '[]'));
    // Repos confirmed as existing on HuggingFace
    const confirmedHFRepos = new Set(JSON.parse(localStorage.getItem('confirmedHFRepos') || '[]'));

    // Settings
    const settings = {
        allowFileDelete:   localStorage.getItem('setting-file-delete')   === 'true',
        allowRepoDelete:   localStorage.getItem('setting-repo-delete')   === 'true',
        allowNonHFDelete:  localStorage.getItem('setting-non-hf-delete') === 'true',
        showSpeedEta:      localStorage.getItem('setting-show-speed') !== 'false',
    };

    function applySettings() {
        document.body.classList.toggle('allow-file-delete',  settings.allowFileDelete);
        document.body.classList.toggle('allow-repo-delete',  settings.allowRepoDelete);
        document.body.classList.toggle('allow-non-hf-delete', settings.allowNonHFDelete);
    }
    applySettings();

    function saveLocalOnlyCache() {
        localStorage.setItem('localOnlyRepos',   JSON.stringify([...localOnlyRepos]));
        localStorage.setItem('confirmedHFRepos', JSON.stringify([...confirmedHFRepos]));
    }

    // ============================================================
    // THEME TOGGLE
    // ============================================================
    function applyTheme(isLight) {
        document.documentElement.classList.toggle('light-theme', isLight);
        const iconMoon = document.getElementById('icon-moon');
        const iconSun  = document.getElementById('icon-sun');
        if (iconMoon) iconMoon.style.display = isLight ? 'none'  : 'block';
        if (iconSun)  iconSun.style.display  = isLight ? 'block' : 'none';
        themeToggle.setAttribute('aria-label',
            isLight ? 'Switch to dark theme' : 'Switch to light theme');
    }

    // Load saved theme
    const savedTheme = localStorage.getItem('theme');
    applyTheme(savedTheme === 'light');

    themeToggle.addEventListener('click', () => {
        const isLight = document.documentElement.classList.toggle('light-theme');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        applyTheme(isLight);
    });

    // ============================================================
    // HELPERS
    // ============================================================
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatBytes(bytes, decimals = 1) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function getFileTypeInfo(filename) {
        const ext = (filename.split('.').pop() || '').toLowerCase();
        const map = {
            'safetensors': { label: 'ST',   cls: 'ft-safetensors' },
            'bin':         { label: 'BIN',  cls: 'ft-bin'         },
            'gguf':        { label: 'GGUF', cls: 'ft-gguf'        },
            'json':        { label: 'JSON', cls: 'ft-json'        },
            'txt':         { label: 'TXT',  cls: 'ft-txt'         },
            'md':          { label: 'MD',   cls: 'ft-md'          },
            'py':          { label: 'PY',   cls: 'ft-json'        },
            'yaml':        { label: 'YML',  cls: 'ft-json'        },
            'yml':         { label: 'YML',  cls: 'ft-json'        },
            'pt':          { label: 'PT',   cls: 'ft-bin'         },
            'pth':         { label: 'PTH',  cls: 'ft-bin'         },
        };
        const info = map[ext];
        if (info) return info;
        const short = ext.substring(0, 4).toUpperCase() || '?';
        return { label: short, cls: 'ft-default' };
    }

    function getSizeBadgeClass(bytes) {
        if (bytes < 100 * 1024 * 1024)  return 'size-small';
        if (bytes < 1024 * 1024 * 1024) return 'size-medium';
        return 'size-large';
    }

    const getSelectedFiles = () =>
        Array.from(fileListDiv.querySelectorAll('input[type="checkbox"]:checked'))
             .map(cb => cb.value);

    const setAllCheckboxes = (checked) => {
        fileListDiv.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = checked;
            cb.closest('.file-item').classList.toggle('is-checked', checked);
        });
        updateSelectionSummary();
    };

    // ============================================================
    // TOAST SYSTEM
    // ============================================================
    const TOAST_DURATION = { success: 4000, info: 4000, warning: 6000, error: 8000 };

    const TOAST_ICONS = {
        success: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
        error:   `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
        warning: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
        info:    `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    };

    function showToast(type, title, message = '') {
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

    function dismissToast(toast) {
        if (toast.classList.contains('is-dismissing')) return;
        toast.classList.add('is-dismissing');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }

    // ============================================================
    // STATUS PILL
    // ============================================================
    function updateStatusPill(status) {
        const pill = document.getElementById('global-status-pill');
        if (!pill) return;
        const text = pill.querySelector('.status-text');
        pill.className = 'status-pill';
        const map = {
            'downloading': ['status-active', 'Downloading'],
            'paused':      ['status-paused', 'Paused'],
            'error':       ['status-error',  'Error'],
            'idle':        ['status-idle',   'Idle'],
            'pending':     ['status-active', 'Queued'],
        };
        const [cls, label] = map[status] || ['status-idle', 'Idle'];
        pill.classList.add(cls);
        text.textContent = label;
    }

    // ============================================================
    // FILE LIST RENDERING
    // ============================================================
    function renderFileList(files) {
        fileListDiv.innerHTML = '';
        if (!files || files.length === 0) {
            fileListDiv.innerHTML = '<div class="empty-state" style="padding:var(--space-6)"><em>No files found.</em></div>';
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

            fileListDiv.appendChild(div);
        });

        updateSelectionSummary();
    }

    function updateSelectionSummary() {
        const checked    = Array.from(fileListDiv.querySelectorAll('input[type="checkbox"]:checked'));
        const count      = checked.length;
        const totalBytes = checked.reduce((sum, cb) => {
            return sum + parseInt(cb.closest('.file-item')?.dataset.bytes || 0);
        }, 0);

        const countEl = document.getElementById('selected-count');
        const sizeEl  = document.getElementById('selected-size');
        if (countEl) countEl.textContent = count;
        if (sizeEl)  sizeEl.textContent  = formatBytes(totalBytes);

        const downloadBtn  = document.getElementById('start-download-btn');
        const scheduleBtn  = document.getElementById('schedule-download-btn');
        const countBadge   = document.getElementById('download-btn-count');
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

    // ============================================================
    // QUEUE RENDERING
    // ============================================================
    function renderQueue(queue) {
        const container   = document.getElementById('download-queue-container');
        const countBadge  = document.getElementById('queue-count-badge');

        queueListUl.innerHTML = '';

        if (!queue || queue.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
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
            li.innerHTML = `
                <div class="queue-position">${index + 1}</div>
                <div class="queue-item-info">
                    <div class="queue-repo-name truncate" title="${escapeHtml(job.repo_id)}">
                        ${clockIcon}${escapeHtml(job.repo_id)}
                    </div>
                    <div class="queue-file-count">${job.total_files} file${job.total_files !== 1 ? 's' : ''}</div>
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

    // ============================================================
    // COMPLETED DOWNLOADS
    // ============================================================
    function repoTypeClass(repo) {
        if (localOnlyRepos.has(repo) || !repo.includes('/')) return 'is-local-repo';
        return 'is-hf-repo';
    }

    function createRepoCard(repo) {
        const li = document.createElement('li');
        li.className = `repo-card completed-item ${repoTypeClass(repo)}`;
        li.dataset.repo = repo;

        li.innerHTML = `
            <div class="repo-card-header">
                <div class="repo-card-title">
                    <svg class="repo-type-icon" width="14" height="14" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span class="repo-card-name truncate" title="${escapeHtml(repo)}">${escapeHtml(repo)}</span>
                </div>
                <div class="repo-card-actions">
                    <button class="btn btn-ghost btn-icon btn-sm update-btn"
                            data-repo="${escapeHtml(repo)}" title="Refresh sync status"
                            aria-label="Refresh sync status">
                        <svg class="refresh-icon" width="13" height="13" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" stroke-width="2.5"
                             stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="23 4 23 10 17 10"/>
                            <polyline points="1 20 1 14 7 14"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                    </button>
                    <button class="btn btn-ghost btn-icon btn-sm repo-hide-btn"
                            data-repo="${escapeHtml(repo)}" title="Hide repo from list"
                            aria-label="Hide repo">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2"
                             stroke-linecap="round" stroke-linejoin="round">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                    </button>
                    <button class="btn btn-ghost btn-icon btn-sm repo-delete-btn"
                            data-repo="${escapeHtml(repo)}" title="Delete repo and all files"
                            aria-label="Delete repo">
                        <svg width="13" height="13" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" stroke-width="2"
                             stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                    </button>
                    <svg class="chevron-icon" width="14" height="14" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                    </svg>
                </div>
            </div>
            <div class="repo-card-body">
                <div class="sync-stats-bar" style="display:none;">
                    <span class="sync-stat synced"><span class="sync-stat-count">0</span> synced</span>
                    <span class="sync-stat new"><span class="sync-stat-count">0</span> new</span>
                    <span class="sync-stat outdated"><span class="sync-stat-count">0</span> outdated</span>
                    <span class="sync-stat local"><span class="sync-stat-count">0</span> local only</span>
                </div>
                <div class="file-skeleton flex-col" style="display:none;">
                    <div class="skeleton skeleton-row"></div>
                    <div class="skeleton skeleton-row"></div>
                    <div class="skeleton skeleton-row"></div>
                </div>
                <ul class="local-file-list"></ul>
                <div class="local-list-controls" style="display:none;">
                    <div class="local-controls-left">
                        <button class="btn btn-ghost btn-sm select-all-local-btn">All</button>
                        <button class="btn btn-ghost btn-sm deselect-all-local-btn">None</button>
                    </div>
                    <div class="local-controls-right">
                        <button class="btn btn-primary btn-sm download-updates-btn"
                                data-repo="${escapeHtml(repo)}" data-scheduled="false" style="display:none;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" stroke-width="2.5"
                                 stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            Download Now
                        </button>
                        <button class="btn btn-secondary btn-sm schedule-updates-btn"
                                data-repo="${escapeHtml(repo)}" data-scheduled="true" style="display:none;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" stroke-width="2.5"
                                 stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                            </svg>
                            Schedule
                        </button>
                    </div>
                </div>
            </div>
        `;
        return li;
    }

    async function refreshRepoStatus(card) {
        const repoId       = card.dataset.repo;
        const body         = card.querySelector('.repo-card-body');
        const fileList     = card.querySelector('.local-file-list');
        const skeleton     = card.querySelector('.file-skeleton');
        const statsBar     = card.querySelector('.sync-stats-bar');
        const localControls = card.querySelector('.local-list-controls');
        const downloadBtn  = card.querySelector('.download-updates-btn');
        const scheduleBtn  = card.querySelector('.schedule-updates-btn');
        const refreshIcon  = card.querySelector('.refresh-icon');

        // Show skeleton
        if (skeleton) { skeleton.style.display = 'flex'; }
        if (fileList)   fileList.innerHTML = '';
        if (statsBar)   statsBar.style.display = 'none';
        if (localControls) localControls.style.display = 'none';
        if (downloadBtn)   downloadBtn.style.display = 'none';
        if (scheduleBtn)   scheduleBtn.style.display = 'none';
        if (refreshIcon)   refreshIcon.classList.add('is-loading');

        try {
            const response = await fetch('/api/repository-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repo_id: repoId })
            });
            if (!response.ok) {
                const data = await response.json();
                const err = new Error(data.error);
                err.notFound = response.status === 404 && data.not_found === true;
                throw err;
            }

            const statusList = await response.json();
            if (skeleton) skeleton.style.display = 'none';

            // Repo confirmed on HF — update both caches
            confirmedHFRepos.add(repoId);
            if (localOnlyRepos.has(repoId)) {
                localOnlyRepos.delete(repoId);
                saveLocalOnlyCache();
            }

            // Count stats
            const counts = { synced: 0, not_downloaded: 0, outdated: 0, local_only: 0 };
            statusList.forEach(f => { if (counts[f.status] !== undefined) counts[f.status]++; });

            // Update stats bar
            if (statsBar) {
                const statEls = statsBar.querySelectorAll('.sync-stat');
                if (statEls[0]) statEls[0].querySelector('.sync-stat-count').textContent = counts.synced;
                if (statEls[1]) statEls[1].querySelector('.sync-stat-count').textContent = counts.not_downloaded;
                if (statEls[2]) statEls[2].querySelector('.sync-stat-count').textContent = counts.outdated;
                if (statEls[3]) statEls[3].querySelector('.sync-stat-count').textContent = counts.local_only;
                statsBar.style.display = 'flex';
            }

            const statusEmojis = {
                synced: '✅', not_downloaded: '🆕', outdated: '🔄', local_only: '🗑️'
            };

            let hasDownloadable = false;

            statusList.forEach(file => {
                const canDownload  = file.status === 'not_downloaded' || file.status === 'outdated';
                const canDelete    = file.status === 'synced';
                if (canDownload) hasDownloadable = true;

                const checkboxId = `cb-${repoId.replace(/[^a-zA-Z0-9]/g, '-')}-${file.name.replace(/[^a-zA-Z0-9]/g, '-')}`;
                const li = document.createElement('li');
                li.className = 'status-file-item';
                li.innerHTML = `
                    <span class="status-emoji">${statusEmojis[file.status] || '❓'}</span>
                    ${canDownload ? `<input type="checkbox" id="${checkboxId}" value="${escapeHtml(file.name)}" class="download-update-cb" checked>` : ''}
                    <label for="${checkboxId}" class="file-name truncate" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</label>
                    <span class="file-size">${formatBytes(file.size)}</span>
                    ${canDelete ? `<button class="file-delete-btn" data-repo="${escapeHtml(repoId)}" data-file="${escapeHtml(file.name)}" title="Delete file" aria-label="Delete ${escapeHtml(file.name)}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                    </button>` : ''}
                `;
                fileList.appendChild(li);
            });

            if (hasDownloadable && localControls && downloadBtn) {
                localControls.style.display = 'flex';
                downloadBtn.style.display   = 'inline-flex';
                if (scheduleBtn) scheduleBtn.style.display = 'inline-flex';
            }

        } catch (error) {
            if (skeleton) skeleton.style.display = 'none';
            if (error.notFound) {
                // Mark as local-only so the HF filter can exclude it
                localOnlyRepos.add(repoId);
                saveLocalOnlyCache();

                fileList.innerHTML = `
                    <li class="repo-not-found">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        Not found on HuggingFace — local files only.
                    </li>`;
            } else {
                showToast('error', 'Status Error', error.message);
            }
        } finally {
            if (refreshIcon) refreshIcon.classList.remove('is-loading');
        }
    }

    function renderCompletedList(completed) {
        const visible = repoFilter === 'hf'
            ? completed.filter(r => r.includes('/') && !localOnlyRepos.has(r))
            : repoFilter === 'local'
                ? completed.filter(r => !r.includes('/') || localOnlyRepos.has(r))
                : completed;

        completedListUl.innerHTML = '';

        const countBadge = document.getElementById('completed-count-badge');
        const emptyState = completedListUl.parentElement.querySelector('.empty-state');

        if (countBadge) countBadge.textContent = visible.length;

        if (visible.length === 0) {
            if (emptyState) emptyState.style.display = 'flex';
            return;
        }
        if (emptyState) emptyState.style.display = 'none';

        visible.forEach(repo => {
            completedListUl.appendChild(createRepoCard(repo));
        });
    }

    async function checkReposOnHF(repos) {
        // Only check repos not yet in either cache
        const unknown = repos.filter(r => !localOnlyRepos.has(r) && !confirmedHFRepos.has(r));
        if (unknown.length === 0) return false;

        try {
            const resp = await fetch('/api/repos/check-hf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repos: unknown })
            });
            if (!resp.ok) return false;
            const hfStatus = await resp.json();
            let changed = false;
            for (const [repo, exists] of Object.entries(hfStatus)) {
                if (exists === false) {
                    if (!localOnlyRepos.has(repo)) { localOnlyRepos.add(repo); changed = true; }
                    confirmedHFRepos.delete(repo);
                } else if (exists === true) {
                    if (localOnlyRepos.has(repo)) { localOnlyRepos.delete(repo); changed = true; }
                    confirmedHFRepos.add(repo);
                }
                // exists === null means network error — leave uncached, retry next time
            }
            if (changed) saveLocalOnlyCache();
            return changed;
        } catch {
            return false;
        }
    }

    async function updateCompletedList() {
        try {
            const response  = await fetch("/completed");
            const completed = await response.json();

            // Phase 1: render immediately using cached HF knowledge
            renderCompletedList(completed);

            // Phase 2: check only repos not yet in either cache
            const toCheck = completed.filter(r => r.includes('/'));
            if (toCheck.length > 0) {
                const changed = await checkReposOnHF(toCheck);
                if (changed) renderCompletedList(completed);
            }
        } catch (error) {
            console.error("Error fetching completed list:", error);
        }
    }

    // ============================================================
    // POLLING & DOWNLOAD STATUS
    // ============================================================
    function startPollingProgress() {
        if (!progressTimeout) {
            updateDownloadProgress();
        }
    }

    function stopPollingProgress() {
        clearTimeout(progressTimeout);
        progressTimeout = null;

        const container = document.getElementById('download-status-container');
        if (container) container.style.display = 'none';

        updateStatusPill('idle');
        document.title = 'HF Downloader';
        updateCompletedList();
    }

    async function updateDownloadProgress() {
        try {
            const response = await fetch("/download-status");
            const status   = await response.json();

            updateStatusPill(status.status);
            renderQueue(status.queue);
            if (status.scheduler) updateSchedulerUI(status.scheduler);

            const container = document.getElementById('download-status-container');
            const badge     = document.getElementById('download-status-badge');

            if (status.status === 'downloading' || status.status === 'paused') {
                container.style.display = 'flex';
                container.classList.remove('is-downloading', 'is-paused', 'is-error');

                // Repo + File info
                document.getElementById('current-repo').textContent  = status.current_repo_id || '';
                document.getElementById('current-file').textContent  = status.current_file || '';
                document.getElementById('file-counter').textContent  =
                    `File ${status.file_index || 0} of ${status.total_files || 0}`;

                // Progress (clamped 0–100)
                const pct = Math.min(100, Math.max(0, Math.round(status.total_progress || 0)));
                document.getElementById('progress-bar-fill').style.width = `${pct}%`;
                document.getElementById('progress-pct-text').textContent  = `${pct}%`;

                // Speed + ETA
                const speedEtaEl = document.getElementById('download-speed-eta');
                if (speedEtaEl) {
                    if (settings.showSpeedEta && status.download_speed > 0) {
                        const speedMB = (status.download_speed / 1048576).toFixed(1);
                        let etaStr = '';
                        if (status.eta_seconds != null && status.eta_seconds > 0) {
                            const m = Math.floor(status.eta_seconds / 60);
                            const s = status.eta_seconds % 60;
                            etaStr = m > 0
                                ? ` · ${m}m ${s}s`
                                : ` · ${s}s`;
                        }
                        speedEtaEl.textContent = `${speedMB} MB/s${etaStr}`;
                        speedEtaEl.style.display = '';
                    } else {
                        speedEtaEl.textContent = '';
                        speedEtaEl.style.display = 'none';
                    }
                }

                // Legacy progress element
                const legacyProgress = document.getElementById('total-progress');
                if (legacyProgress) legacyProgress.value = pct;

                // Page title
                document.title = `↓ ${pct}% | HF Downloader`;

                const toSchedulerBtn = document.getElementById('to-scheduler-btn');
                const schedulerEnabled = status.scheduler && status.scheduler.enabled;

                if (status.status === 'downloading') {
                    container.classList.add('is-downloading');
                    if (badge) { badge.textContent = 'DOWNLOADING'; badge.className = 'badge badge-info badge-pulse'; }
                    document.getElementById('pause-btn').style.display  = 'inline-flex';
                    document.getElementById('resume-btn').style.display = 'none';
                    // Show "To Scheduler" only if scheduler is enabled and job is not already scheduled
                    if (toSchedulerBtn) toSchedulerBtn.style.display = schedulerEnabled ? 'inline-flex' : 'none';
                } else {
                    container.classList.add('is-paused');
                    if (badge) { badge.textContent = 'PAUSED'; badge.className = 'badge badge-warning'; }
                    document.getElementById('pause-btn').style.display  = 'none';
                    document.getElementById('resume-btn').style.display = 'inline-flex';
                    if (toSchedulerBtn) toSchedulerBtn.style.display = 'none';
                }
            } else {
                container.style.display = 'none';
            }

            if (status.error) {
                showToast('error', 'Download Failed', status.error);
            }

            // Determine next poll interval based on status
            let nextInterval;
            if (status.status === 'idle' && (!status.queue || status.queue.length === 0)) {
                stopPollingProgress();
                return;
            } else if (status.status === 'downloading' || status.status === 'paused') {
                nextInterval = 1000; // Fast polling during active download
            } else {
                nextInterval = 5000; // Slow polling when idle but queue has items
            }

            progressTimeout = setTimeout(updateDownloadProgress, nextInterval);

        } catch (error) {
            console.error("Error fetching status:", error);
            stopPollingProgress();
        }
    }

    // ============================================================
    // EXPLORE / SEARCH MODELS
    // ============================================================
    const trendingToggle  = document.getElementById('trending-toggle');
    const trendingContent = document.getElementById('trending-content');
    const trendingListEl  = document.getElementById('trending-list');
    const modelSearchInput = document.getElementById('model-search-input');
    const tagFilterRow    = document.getElementById('tag-filter-row');
    const sortRow         = document.getElementById('sort-row');

    // Browse state
    let browseState = { query: '', tag: '', sort: 'downloads' };
    let browseDebounceTimer = null;

    function formatCount(n) {
        if (!n) return '—';
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
        if (n >= 1_000)     return Math.round(n / 1_000) + 'k';
        return String(n);
    }

    function renderBrowseResults(models) {
        trendingListEl.innerHTML = '';
        if (!models || models.length === 0) {
            trendingListEl.innerHTML = '<div class="trending-empty">No models found.</div>';
            return;
        }
        const isSortedByLikes = browseState.sort === 'likes';
        models.forEach(model => {
            const btn = document.createElement('button');
            btn.className = 'trending-item';
            btn.type = 'button';
            btn.title = `Open ${model.id}`;
            const tagHtml = model.pipeline_tag
                ? `<span class="trending-tag">${escapeHtml(model.pipeline_tag.replace(/-/g, '\u2011'))}</span>`
                : '';
            const countVal  = isSortedByLikes ? model.likes    : model.downloads;
            const countIcon = isSortedByLikes ? '♥'            : '↓';
            const countTip  = isSortedByLikes
                ? `${model.likes.toLocaleString()} likes`
                : `${model.downloads.toLocaleString()} downloads`;
            btn.innerHTML = `
                <div class="trending-item-main">
                    <span class="trending-model-id truncate">${escapeHtml(model.id)}</span>
                    ${tagHtml}
                </div>
                <span class="trending-dl-count" title="${escapeHtml(countTip)}">
                    ${escapeHtml(countIcon)} ${escapeHtml(formatCount(countVal))}
                </span>
            `;
            btn.addEventListener('click', () => {
                repoIdInput.value = model.id;
                repoIdInput.focus();
                listFilesForm.dispatchEvent(new Event('submit'));
            });
            trendingListEl.appendChild(btn);
        });
    }

    async function loadBrowseResults() {
        trendingLoaded = false;
        trendingListEl.innerHTML = '<div class="trending-empty"><span class="spinner" aria-hidden="true"></span> Loading…</div>';
        try {
            const response = await fetch('/api/search-models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query:        browseState.query,
                    pipeline_tag: browseState.tag,
                    sort:         browseState.sort,
                    limit:        20,
                }),
            });
            if (!response.ok) throw new Error((await response.json()).error);
            const models = await response.json();
            renderBrowseResults(models);
            trendingLoaded = true;
        } catch (error) {
            trendingListEl.innerHTML = `<div class="trending-empty trending-error">Error: ${escapeHtml(error.message)}</div>`;
        }
    }

    function scheduleBrowseLoad(immediate = false) {
        clearTimeout(browseDebounceTimer);
        if (immediate) {
            loadBrowseResults();
        } else {
            browseDebounceTimer = setTimeout(loadBrowseResults, 450);
        }
    }

    // Toggle open/close
    if (trendingToggle) {
        trendingToggle.addEventListener('click', () => {
            const isOpen = trendingContent.style.display !== 'none';
            trendingContent.style.display = isOpen ? 'none' : 'block';
            trendingToggle.setAttribute('aria-expanded', String(!isOpen));
            trendingToggle.classList.toggle('is-open', !isOpen);
            if (!isOpen && !trendingLoaded) {
                loadBrowseResults();
            }
        });
    }

    // Search input — debounced
    if (modelSearchInput) {
        modelSearchInput.addEventListener('input', () => {
            browseState.query = modelSearchInput.value.trim();
            scheduleBrowseLoad(false);
        });
    }

    // Tag filter pills
    if (tagFilterRow) {
        tagFilterRow.addEventListener('click', (e) => {
            const btn = e.target.closest('.tag-filter-btn');
            if (!btn) return;
            tagFilterRow.querySelectorAll('.tag-filter-btn').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            browseState.tag = btn.dataset.tag;
            scheduleBrowseLoad(true);
        });
    }

    // Sort controls
    if (sortRow) {
        sortRow.addEventListener('click', (e) => {
            const btn = e.target.closest('.sort-btn');
            if (!btn) return;
            sortRow.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            browseState.sort = btn.dataset.sort;
            scheduleBrowseLoad(true);
        });
    }

    // ============================================================
    // EVENT LISTENERS — Repository Finder
    // ============================================================
    listFilesForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        currentRepoId = repoIdInput.value.trim();
        if (!currentRepoId) {
            repoIdInput.focus();
            return;
        }

        // No slash → treat as org/user → open Explore with pre-filled search
        if (!currentRepoId.includes('/')) {
            if (modelSearchInput) modelSearchInput.value = currentRepoId;
            browseState.query = currentRepoId;
            // Open Explore section if collapsed
            if (trendingContent.style.display === 'none') {
                trendingToggle.click();
            }
            loadBrowseResults();
            trendingContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
            repoIdInput.value = '';
            currentRepoId = '';
            return;
        }

        const btn       = document.getElementById('list-files-btn');
        const label     = btn.querySelector('.btn-label');
        const spinner   = document.getElementById('list-files-spinner');
        const errorEl   = document.getElementById('finder-error');
        const errorText = document.getElementById('finder-error-text');

        // Validate repo ID format: org/repo — both parts must be valid HF identifiers
        const HF_REPO_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
        if (!HF_REPO_RE.test(currentRepoId)) {
            errorText.textContent = 'Invalid repo ID. Expected format: owner/repo-name';
            errorEl.style.display = 'flex';
            repoIdInput.focus();
            return;
        }
        const infoBar   = document.getElementById('repo-info-bar');

        btn.disabled             = true;
        label.textContent        = 'Loading…';
        spinner.style.display    = 'inline-block';
        errorEl.style.display    = 'none';
        infoBar.style.display    = 'none';
        fileSelectionContainer.style.display = 'none';

        try {
            const response = await fetch("/api/list-files", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ repo_id: currentRepoId })
            });
            if (!response.ok) throw new Error((await response.json()).error);

            const files = await response.json();

            // Show repo info bar
            document.getElementById('repo-title').textContent = currentRepoId;
            infoBar.style.display = 'flex';

            // Show file selection
            fileSelectionContainer.style.display = 'block';
            if (fileFilterInput) fileFilterInput.value = '';
            renderFileList(files);
            fileSelectionContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

        } catch (error) {
            errorText.textContent = error.message;
            errorEl.style.display = 'flex';
        } finally {
            btn.disabled          = false;
            label.textContent     = 'List Files';
            spinner.style.display = 'none';
        }
    });

    // Clear repo button
    const clearRepoBtn = document.getElementById('clear-repo-btn');
    if (clearRepoBtn) {
        clearRepoBtn.addEventListener('click', () => {
            repoIdInput.value    = '';
            currentRepoId        = '';
            document.getElementById('repo-info-bar').style.display = 'none';
            document.getElementById('finder-error').style.display  = 'none';
            fileSelectionContainer.style.display = 'none';
            repoIdInput.focus();
        });
    }

    // ============================================================
    // EVENT LISTENERS — File Selection
    // ============================================================
    async function submitDownload(scheduled) {
        const selectedFiles = getSelectedFiles();
        if (selectedFiles.length === 0) {
            showToast('warning', 'No files selected', 'Please select at least one file to download.');
            return;
        }
        try {
            const response = await fetch("/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ repo_id: currentRepoId, files: selectedFiles, scheduled })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);

            fileSelectionContainer.style.display = 'none';
            document.getElementById('repo-info-bar').style.display = 'none';
            repoIdInput.value = '';
            currentRepoId = '';

            const label = scheduled ? 'Added to scheduler' : 'Added to queue';
            const detail = scheduled
                ? `${selectedFiles.length} file(s) will download during the scheduled window.`
                : `${selectedFiles.length} file(s) queued for download.`;
            showToast('success', label, detail);
            startPollingProgress();
        } catch (error) {
            showToast('error', 'Download Error', error.message || 'An unknown error occurred.');
        }
    }

    downloadSelectionForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        await submitDownload(false);
    });

    const scheduleDownloadBtn = document.getElementById('schedule-download-btn');
    if (scheduleDownloadBtn) {
        scheduleDownloadBtn.addEventListener('click', async () => {
            await submitDownload(true);
        });
    }

    if (fileFilterInput) {
        fileFilterInput.addEventListener('input', function () {
            const query = this.value.toLowerCase();
            fileListDiv.querySelectorAll('.file-item').forEach(item => {
                const name = item.querySelector('.file-item-name')?.textContent.toLowerCase() || '';
                item.style.display = name.includes(query) ? 'flex' : 'none';
            });
        });
    }

    selectAllBtn.addEventListener("click",   () => setAllCheckboxes(true));
    deselectAllBtn.addEventListener("click", () => setAllCheckboxes(false));

    // ============================================================
    // EVENT LISTENERS — Queue Controls
    // ============================================================
    queueListUl.addEventListener('click', async (event) => {
        const target = event.target.closest('button');
        if (!target) return;
        const index = target.dataset.index;
        if (index === undefined) return;

        let url;
        if (target.classList.contains('move-up-btn')) {
            url = `/api/queue/move/${index}/up`;
        } else if (target.classList.contains('move-down-btn')) {
            url = `/api/queue/move/${index}/down`;
        } else if (target.classList.contains('remove-btn')) {
            url = `/api/queue/remove/${index}`;
        } else if (target.classList.contains('queue-start-now-btn')) {
            url = `/api/queue/start-now/${index}`;
        } else {
            return;
        }

        try {
            const response = await fetch(url, { method: 'POST' });
            if (!response.ok) throw new Error((await response.json()).error);
            updateDownloadProgress();
        } catch (error) {
            showToast('error', 'Queue Error', error.message);
        }
    });

    // ============================================================
    // EVENT LISTENERS — Download Controls
    // ============================================================
    document.getElementById('pause-btn').addEventListener('click',
        () => fetch("/pause-download", { method: "POST" }));
    document.getElementById('resume-btn').addEventListener('click',
        () => fetch("/resume-download", { method: "POST" }));
    document.getElementById('cancel-btn').addEventListener('click',
        () => fetch("/cancel-download", { method: "POST" }));
    document.getElementById('to-scheduler-btn').addEventListener('click', async () => {
        try {
            const response = await fetch("/api/current/to-scheduler", { method: "POST" });
            const result   = await response.json();
            if (!response.ok) throw new Error(result.error);
            showToast('info', 'Moved to Scheduler', result.message);
        } catch (err) {
            showToast('error', 'Error', err.message || 'Could not move to scheduler.');
        }
    });

    // ============================================================
    // EVENT LISTENERS — Completed Downloads
    // ============================================================
    completedListUl.addEventListener('click', async (event) => {
        const target = event.target;
        const card   = target.closest('.completed-item');
        if (!card) return;

        const repoId      = card.dataset.repo;
        const body        = card.querySelector('.repo-card-body');
        const fileList    = card.querySelector('.local-file-list');
        const downloadBtn = card.querySelector('.download-updates-btn');

        // Hide repo
        if (target.closest('.repo-hide-btn')) {
            try {
                const response = await fetch('/api/repo/hide', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ repo_id: repoId })
                });
                if (!response.ok) throw new Error((await response.json()).error);
                card.remove();
                const countBadge = document.getElementById('completed-count-badge');
                if (countBadge) countBadge.textContent = Math.max(0, parseInt(countBadge.textContent || '0') - 1);
                if (showHidden) await loadHiddenRepos();
                showToast('info', 'Repo hidden', `"${repoId}" is hidden. Use the eye button to show hidden repos.`);
            } catch (err) {
                showToast('error', 'Hide failed', err.message || 'Could not hide repo.');
            }
            return;
        }

        // Unhide repo
        if (target.closest('.repo-unhide-btn')) {
            try {
                const response = await fetch('/api/repo/unhide', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ repo_id: repoId })
                });
                if (!response.ok) throw new Error((await response.json()).error);
                card.remove();
                await updateCompletedList();
                showToast('success', 'Repo restored', `"${repoId}" is visible again.`);
            } catch (err) {
                showToast('error', 'Unhide failed', err.message || 'Could not unhide repo.');
            }
            return;
        }

        // Delete repo button
        if (target.closest('.repo-delete-btn')) {
            if (!confirm(`Delete "${repoId}" and all its files from disk?\nThis cannot be undone.`)) return;
            try {
                const response = await fetch('/api/repo', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ repo_id: repoId })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);

                card.remove();
                localOnlyRepos.delete(repoId);
                confirmedHFRepos.delete(repoId);
                saveLocalOnlyCache();
                // Also remove from hidden list if it was hidden
                await fetch('/api/repo/unhide', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ repo_id: repoId })
                }).catch(() => {});
                if (!card.classList.contains('is-hidden-repo')) {
                    const countBadge = document.getElementById('completed-count-badge');
                    if (countBadge) countBadge.textContent = Math.max(0, parseInt(countBadge.textContent || '0') - 1);
                }
                showToast('success', 'Repo deleted', `"${repoId}" removed from disk.`);
            } catch (err) {
                showToast('error', 'Delete failed', err.message || 'Could not delete repo.');
            }
            return;
        }

        // Delete single file
        if (target.closest('.file-delete-btn')) {
            const btn      = target.closest('.file-delete-btn');
            const filename = btn.dataset.file;
            if (!confirm(`Delete "${filename}"?\nIt will need to be re-downloaded from HuggingFace.`)) return;
            try {
                const response = await fetch('/api/file', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ repo_id: repoId, filename })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);

                if (result.repo_deleted) {
                    // Whole repo is gone — remove card and update counter
                    card.remove();
                    localOnlyRepos.delete(repoId);
                    confirmedHFRepos.delete(repoId);
                    saveLocalOnlyCache();
                    const countBadge = document.getElementById('completed-count-badge');
                    if (countBadge) countBadge.textContent = Math.max(0, parseInt(countBadge.textContent || '0') - 1);
                    showToast('success', 'File deleted', `Last file removed — repo "${repoId}" cleaned up.`);
                } else {
                    // Remove just this file row and refresh stats
                    btn.closest('li').remove();
                    await refreshRepoStatus(card);
                    showToast('success', 'File deleted', `"${filename}" removed.`);
                }
            } catch (err) {
                showToast('error', 'Delete failed', err.message || 'Could not delete file.');
            }
            return;
        }

        // Header click → toggle expand
        if (target.closest('.repo-card-header') && !target.closest('.update-btn')) {
            const isExpanded = card.classList.toggle('is-expanded');
            if (isExpanded && !card.dataset.loaded) {
                card.dataset.loaded = '1';
                await refreshRepoStatus(card);
            }
            return;
        }

        // Refresh status button
        if (target.closest('.update-btn')) {
            card.classList.add('is-expanded');
            await refreshRepoStatus(card);
            return;
        }

        // Download Now / Schedule buttons on repo cards
        const updateBtn = target.closest('.download-updates-btn') || target.closest('.schedule-updates-btn');
        if (updateBtn) {
            const scheduled = updateBtn.dataset.scheduled === 'true';
            const filesToDownload = Array.from(
                fileList.querySelectorAll('.download-update-cb:checked')
            ).map(cb => cb.value);

            if (filesToDownload.length === 0) {
                showToast('warning', 'No files selected', 'Select at least one file to download.');
                return;
            }

            try {
                const response = await fetch("/download", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ repo_id: repoId, files: filesToDownload, scheduled })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);

                const label  = scheduled ? 'Added to scheduler' : 'Added to queue';
                const detail = scheduled
                    ? `${filesToDownload.length} file(s) will download during the scheduled window.`
                    : `${filesToDownload.length} file(s) queued for download.`;
                showToast('success', label, detail);
                startPollingProgress();
            } catch (error) {
                showToast('error', 'Download Error', error.message || 'An unknown error occurred.');
            }
            return;
        }

        // Select / Deselect all in local file list
        if (target.classList.contains('select-all-local-btn')) {
            card.querySelectorAll('.download-update-cb').forEach(cb => cb.checked = true);
        }
        if (target.classList.contains('deselect-all-local-btn')) {
            card.querySelectorAll('.download-update-cb').forEach(cb => cb.checked = false);
        }
    });

    // ============================================================
    // SCHEDULER UI
    // ============================================================
    let schedulerDirty = false;  // true = user has unsaved changes → ignore poll updates

    // Mark dirty when user touches any scheduler control
    document.querySelectorAll('#scheduler-enabled, #scheduler-start, #scheduler-end, .day-pill input')
        .forEach(el => el.addEventListener('change', () => { schedulerDirty = true; }));

    function updateSchedulerUI(sched) {
        if (!sched) return;
        const enabledCb  = document.getElementById('scheduler-enabled');
        const startInput = document.getElementById('scheduler-start');
        const endInput   = document.getElementById('scheduler-end');
        const badge      = document.getElementById('scheduler-status-badge');
        const nextWin    = document.getElementById('scheduler-next-window');

        // Only update form fields if user has no unsaved changes
        if (!schedulerDirty) {
            if (enabledCb)  enabledCb.checked = sched.enabled;
            if (startInput) startInput.value  = sched.start;
            if (endInput)   endInput.value    = sched.end;
            document.querySelectorAll('.day-pill input[type="checkbox"]').forEach(cb => {
                cb.checked = sched.days.includes(parseInt(cb.value));
            });
        }

        // Status badge
        if (badge) {
            if (!sched.enabled) {
                badge.textContent  = 'Off';
                badge.className    = 'badge';
            } else if (sched.in_window) {
                badge.textContent  = 'Active';
                badge.className    = 'badge badge-active';
            } else {
                badge.textContent  = 'Waiting';
                badge.className    = 'badge badge-waiting';
            }
        }

        // Next window info
        if (nextWin) {
            if (sched.enabled && !sched.in_window) {
                const h = Math.floor(sched.minutes_until_window / 60);
                const m = sched.minutes_until_window % 60;
                const timeStr = h > 0 ? `${h}h ${m}min` : `${m}min`;
                nextWin.textContent  = `Next window starts at ${sched.start} (in ${timeStr})`;
                nextWin.style.display = 'block';
            } else {
                nextWin.style.display = 'none';
            }
        }
    }

    // Load scheduler config on page load
    fetch('/api/scheduler')
        .then(r => r.json())
        .then(updateSchedulerUI)
        .catch(() => {});

    // Also update from status polling (already in the poll response)
    const _origUpdateStatus = window._updateStatusCallback;

    // Save scheduler
    const schedulerSaveBtn = document.getElementById('scheduler-save-btn');
    if (schedulerSaveBtn) {
        schedulerSaveBtn.addEventListener('click', async () => {
            const enabled = document.getElementById('scheduler-enabled').checked;
            const start   = document.getElementById('scheduler-start').value;
            const end     = document.getElementById('scheduler-end').value;
            const days    = Array.from(
                document.querySelectorAll('.day-pill input[type="checkbox"]:checked')
            ).map(cb => parseInt(cb.value));

            try {
                const response = await fetch('/api/scheduler', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ enabled, start, end, days }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);
                schedulerDirty = false;
                updateSchedulerUI({ ...result, in_window: result.in_window, minutes_until_window: result.minutes_until_window });
                showToast('success', 'Scheduler saved', enabled
                    ? `Active ${start}–${end}`
                    : 'Scheduler disabled.');
            } catch (err) {
                showToast('error', 'Save failed', err.message || 'Could not save scheduler.');
            }
        });
    }

    // ============================================================
    // FILTER BUTTON GROUP — All / HF only / Local only
    // ============================================================
    const repoFilterBtns = document.querySelectorAll('.repo-filter-btn');
    repoFilterBtns.forEach(btn => {
        if (btn.dataset.filter === repoFilter) btn.classList.add('is-active');
        else btn.classList.remove('is-active');

        btn.addEventListener('click', () => {
            repoFilter = btn.dataset.filter;
            localStorage.setItem('repoFilter', repoFilter);
            repoFilterBtns.forEach(b => b.classList.toggle('is-active', b === btn));
            updateCompletedList();
        });
    });

    // ============================================================
    // SETTINGS MODAL
    // ============================================================
    const settingsModal    = document.getElementById('settings-modal');
    const settingsBtn      = document.getElementById('settings-btn');
    const settingsCloseBtn = document.getElementById('settings-close-btn');
    const settingsBackdrop = document.getElementById('settings-backdrop');

    function openSettings() {
        settingsModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
    function closeSettings() {
        settingsModal.style.display = 'none';
        document.body.style.overflow = '';
    }

    if (settingsBtn)      settingsBtn.addEventListener('click', openSettings);
    if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', closeSettings);
    if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettings);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && settingsModal.style.display !== 'none') closeSettings();
    });

    // Init toggles from saved state
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

    // ============================================================
    // SHOW HIDDEN TOGGLE
    // ============================================================
    let showHidden = false;
    const showHiddenBtn = document.getElementById('show-hidden-btn');

    async function loadHiddenRepos() {
        try {
            const resp = await fetch('/api/repo/hidden');
            const hidden = await resp.json();
            const existingHidden = completedListUl.querySelectorAll('.repo-card.is-hidden-repo');
            existingHidden.forEach(el => el.remove());

            hidden.forEach(repo => {
                const card = createHiddenRepoCard(repo);
                completedListUl.appendChild(card);
            });
        } catch (e) {
            console.error('Error loading hidden repos:', e);
        }
    }

    function createHiddenRepoCard(repo) {
        const li = document.createElement('li');
        li.className = `repo-card completed-item is-hidden-repo ${repoTypeClass(repo)}`;
        li.dataset.repo = repo;
        li.innerHTML = `
            <div class="repo-card-header">
                <div class="repo-card-title">
                    <svg class="repo-type-icon" width="14" height="14" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span class="repo-card-name truncate" title="${escapeHtml(repo)}">${escapeHtml(repo)}</span>
                </div>
                <div class="repo-card-actions">
                    <button class="btn btn-ghost btn-icon btn-sm repo-unhide-btn"
                            data-repo="${escapeHtml(repo)}" title="Unhide repo" aria-label="Unhide repo">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2"
                             stroke-linecap="round" stroke-linejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                    <button class="btn btn-ghost btn-icon btn-sm repo-delete-btn"
                            data-repo="${escapeHtml(repo)}" title="Delete repo and all files"
                            aria-label="Delete repo">
                        <svg width="13" height="13" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" stroke-width="2"
                             stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
        return li;
    }

    if (showHiddenBtn) {
        showHiddenBtn.addEventListener('click', async () => {
            showHidden = !showHidden;
            showHiddenBtn.classList.toggle('is-active', showHidden);
            showHiddenBtn.setAttribute('aria-pressed', showHidden);
            if (showHidden) {
                await loadHiddenRepos();
            } else {
                completedListUl.querySelectorAll('.is-hidden-repo').forEach(el => el.remove());
            }
        });
    }

    // ============================================================
    // INITIAL LOAD
    // ============================================================
    updateCompletedList();
    startPollingProgress();
});
