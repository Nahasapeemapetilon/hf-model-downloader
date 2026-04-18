import { fetchJson }         from './modules/api.js';
import { settings, localOnlyRepos, confirmedHFRepos, saveLocalOnlyCache, applySettings }
                             from './modules/state.js';
import { showToast }         from './modules/toast.js';
import { initTheme }         from './modules/theme.js';
import { updateStatusPill }  from './modules/status-pill.js';
import { renderQueue }       from './modules/queue.js';
import {
    initFiles, renderFileList, updateSelectionSummary,
    getSelectedFiles, setAllCheckboxes, initFileFilter,
} from './modules/files.js';
import { updateSchedulerUI, initScheduler } from './modules/scheduler.js';
import { updateSyncStatusDisplay, initSyncSettings } from './modules/sync.js';
import { initSettings }                      from './modules/settings.js';
import {
    initRepos, refreshRepoStatus,
    updateCompletedList, loadHiddenRepos,
    setRepoFilter, getRepoFilter,
} from './modules/repos.js';
import { initExplore, openExploreWithQuery } from './modules/explore.js';

// ============================================================
// DOM REFERENCES
// ============================================================
const listFilesForm          = document.getElementById('list-files-form');
const repoIdInput            = document.getElementById('repo-id-input');
const fileSelectionContainer = document.getElementById('file-selection-container');
const fileListDiv            = document.getElementById('file-list');
const downloadSelectionForm  = document.getElementById('download-selection-form');
const selectAllBtn           = document.getElementById('select-all-btn');
const deselectAllBtn         = document.getElementById('deselect-all-btn');
const fileFilterInput        = document.getElementById('file-filter-input');
const queueListUl            = document.getElementById('download-queue-list');
const completedListUl        = document.getElementById('completed-list');

let progressTimeout = null;
let currentRepoId   = '';
let showHidden      = false;

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
        const response = await fetch('/download-status');
        const status   = await response.json();

        updateStatusPill(status.status);
        renderQueue(status.queue, queueListUl);
        if (status.scheduler) updateSchedulerUI(status.scheduler);

        // Sync indicator in topbar
        const syncInd  = document.getElementById('sync-indicator');
        const syncText = document.getElementById('sync-indicator-text');
        if (status.sync && status.sync.status === 'running') {
            if (syncInd)  syncInd.style.display = 'flex';
            const p = status.sync.progress || {};
            if (syncText) syncText.textContent = `Sync ${p.checked || 0}/${p.total || 0}`;
        } else {
            if (syncInd)  syncInd.style.display = 'none';
        }

        const container = document.getElementById('download-status-container');
        const badge     = document.getElementById('download-status-badge');

        if (status.status === 'downloading' || status.status === 'paused') {
            container.style.display = 'flex';
            container.classList.remove('is-downloading', 'is-paused', 'is-error');

            document.getElementById('current-repo').textContent = status.current_repo_id || '';
            document.getElementById('current-file').textContent = status.current_file || '';
            document.getElementById('file-counter').textContent =
                `File ${status.file_index || 0} of ${status.total_files || 0}`;

            const pct = Math.min(100, Math.max(0, Math.round(status.total_progress || 0)));
            document.getElementById('progress-bar-fill').style.width = `${pct}%`;
            document.getElementById('progress-pct-text').textContent  = `${pct}%`;

            const speedEtaEl = document.getElementById('download-speed-eta');
            if (speedEtaEl) {
                if (settings.showSpeedEta && status.download_speed > 0) {
                    const speedMB = (status.download_speed / 1048576).toFixed(1);
                    let etaStr = '';
                    if (status.eta_seconds != null && status.eta_seconds > 0) {
                        const m = Math.floor(status.eta_seconds / 60);
                        const s = status.eta_seconds % 60;
                        etaStr = m > 0 ? ` · ${m}m ${s}s` : ` · ${s}s`;
                    }
                    speedEtaEl.textContent   = `${speedMB} MB/s${etaStr}`;
                    speedEtaEl.style.display = '';
                } else {
                    speedEtaEl.textContent   = '';
                    speedEtaEl.style.display = 'none';
                }
            }

            const legacyProgress = document.getElementById('total-progress');
            if (legacyProgress) legacyProgress.value = pct;

            document.title = `↓ ${pct}% | HF Downloader`;

            const toSchedulerBtn   = document.getElementById('to-scheduler-btn');
            const schedulerEnabled = status.scheduler && status.scheduler.enabled;

            if (status.status === 'downloading') {
                container.classList.add('is-downloading');
                if (badge) { badge.textContent = 'DOWNLOADING'; badge.className = 'badge badge-info badge-pulse'; }
                document.getElementById('pause-btn').style.display  = 'inline-flex';
                document.getElementById('resume-btn').style.display = 'none';
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

        const syncRunning = status.sync && status.sync.status === 'running';
        if (status.status === 'idle' && (!status.queue || status.queue.length === 0) && !syncRunning) {
            stopPollingProgress();
            return;
        }

        const nextInterval = (status.status === 'downloading' || status.status === 'paused')
            ? 1000
            : 5000;

        progressTimeout = setTimeout(updateDownloadProgress, nextInterval);

    } catch (error) {
        console.error('Error fetching status:', error);
        stopPollingProgress();
    }
}

// ============================================================
// REPO FILTER BUTTONS
// ============================================================
function initRepoFilter() {
    const btns = document.querySelectorAll('.repo-filter-btn');
    btns.forEach(btn => {
        if (btn.dataset.filter === getRepoFilter()) btn.classList.add('is-active');
        else btn.classList.remove('is-active');

        btn.addEventListener('click', () => {
            setRepoFilter(btn.dataset.filter);
            localStorage.setItem('repoFilter', btn.dataset.filter);
            btns.forEach(b => b.classList.toggle('is-active', b === btn));
            updateCompletedList();
        });
    });
}

// ============================================================
// SHOW HIDDEN TOGGLE
// ============================================================
function initShowHidden() {
    const showHiddenBtn = document.getElementById('show-hidden-btn');
    if (!showHiddenBtn) return;

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
// EVENT DELEGATION — Completed List
// ============================================================
function initCompletedEvents() {
    completedListUl.addEventListener('click', async (event) => {
        const target = event.target;
        const card   = target.closest('.completed-item');
        if (!card) return;

        const repoId      = card.dataset.repo;
        const fileList    = card.querySelector('.local-file-list');

        // Hide repo
        if (target.closest('.repo-hide-btn')) {
            try {
                const response = await fetchJson('/api/repo/hide', {
                    method: 'POST',
                    body:   JSON.stringify({ repo_id: repoId }),
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
                const response = await fetchJson('/api/repo/unhide', {
                    method: 'POST',
                    body:   JSON.stringify({ repo_id: repoId }),
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

        // Delete repo
        if (target.closest('.repo-delete-btn')) {
            if (!confirm(`Delete "${repoId}" and all its files from disk?\nThis cannot be undone.`)) return;
            try {
                const response = await fetchJson('/api/repo', {
                    method: 'DELETE',
                    body:   JSON.stringify({ repo_id: repoId }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);

                card.remove();
                localOnlyRepos.delete(repoId);
                confirmedHFRepos.delete(repoId);
                saveLocalOnlyCache();
                await fetchJson('/api/repo/unhide', {
                    method: 'POST',
                    body:   JSON.stringify({ repo_id: repoId }),
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
                const response = await fetchJson('/api/file', {
                    method: 'DELETE',
                    body:   JSON.stringify({ repo_id: repoId, filename }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);

                if (result.repo_deleted) {
                    card.remove();
                    localOnlyRepos.delete(repoId);
                    confirmedHFRepos.delete(repoId);
                    saveLocalOnlyCache();
                    const countBadge = document.getElementById('completed-count-badge');
                    if (countBadge) countBadge.textContent = Math.max(0, parseInt(countBadge.textContent || '0') - 1);
                    showToast('success', 'File deleted', `Last file removed — repo "${repoId}" cleaned up.`);
                } else {
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

        // Download Now / Schedule buttons
        const updateBtn = target.closest('.download-updates-btn') || target.closest('.schedule-updates-btn');
        if (updateBtn) {
            const scheduled      = updateBtn.dataset.scheduled === 'true';
            const filesToDownload = Array.from(
                fileList.querySelectorAll('.download-update-cb:checked')
            ).map(cb => cb.value);

            if (filesToDownload.length === 0) {
                showToast('warning', 'No files selected', 'Select at least one file to download.');
                return;
            }

            try {
                const response = await fetchJson('/download', {
                    method: 'POST',
                    body:   JSON.stringify({ repo_id: repoId, files: filesToDownload, scheduled }),
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
}

// ============================================================
// EVENT DELEGATION — Queue Controls
// ============================================================
function initQueueEvents() {
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
            const response = await fetchJson(url, { method: 'POST' });
            if (!response.ok) throw new Error((await response.json()).error);
            updateDownloadProgress();
        } catch (error) {
            showToast('error', 'Queue Error', error.message);
        }
    });
}

// ============================================================
// DOWNLOAD CONTROLS
// ============================================================
function initDownloadControls() {
    document.getElementById('pause-btn').addEventListener('click',
        () => fetchJson('/pause-download', { method: 'POST' }));
    document.getElementById('resume-btn').addEventListener('click',
        () => fetchJson('/resume-download', { method: 'POST' }));
    document.getElementById('cancel-btn').addEventListener('click',
        () => fetchJson('/cancel-download', { method: 'POST' }));

    const toSchedulerBtn = document.getElementById('to-scheduler-btn');
    if (toSchedulerBtn) {
        toSchedulerBtn.addEventListener('click', async () => {
            try {
                const response = await fetchJson('/api/current/to-scheduler', { method: 'POST' });
                const result   = await response.json();
                if (!response.ok) throw new Error(result.error);
                showToast('info', 'Moved to Scheduler', result.message);
            } catch (err) {
                showToast('error', 'Error', err.message || 'Could not move to scheduler.');
            }
        });
    }
}

// ============================================================
// REPOSITORY FINDER
// ============================================================
function initRepoFinder() {
    listFilesForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        currentRepoId = repoIdInput.value.trim();
        if (!currentRepoId) { repoIdInput.focus(); return; }

        // No slash → open Explore with pre-filled search
        if (!currentRepoId.includes('/')) {
            openExploreWithQuery(currentRepoId);
            repoIdInput.value = '';
            currentRepoId = '';
            return;
        }

        const btn       = document.getElementById('list-files-btn');
        const label     = btn.querySelector('.btn-label');
        const spinner   = document.getElementById('list-files-spinner');
        const errorEl   = document.getElementById('finder-error');
        const errorText = document.getElementById('finder-error-text');

        const HF_REPO_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
        if (!HF_REPO_RE.test(currentRepoId)) {
            errorText.textContent = 'Invalid repo ID. Expected format: owner/repo-name';
            errorEl.style.display = 'flex';
            repoIdInput.focus();
            return;
        }

        const infoBar = document.getElementById('repo-info-bar');
        btn.disabled             = true;
        label.textContent        = 'Loading…';
        spinner.style.display    = 'inline-block';
        errorEl.style.display    = 'none';
        infoBar.style.display    = 'none';
        fileSelectionContainer.style.display = 'none';

        try {
            const response = await fetchJson('/api/list-files', {
                method: 'POST',
                body:   JSON.stringify({ repo_id: currentRepoId }),
            });
            if (!response.ok) throw new Error((await response.json()).error);

            const files = await response.json();
            document.getElementById('repo-title').textContent = currentRepoId;
            infoBar.style.display = 'flex';
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
}

// ============================================================
// FILE SELECTION
// ============================================================
async function submitDownload(scheduled) {
    const selectedFiles = getSelectedFiles();
    if (selectedFiles.length === 0) {
        showToast('warning', 'No files selected', 'Please select at least one file to download.');
        return;
    }
    try {
        const response = await fetchJson('/download', {
            method: 'POST',
            body:   JSON.stringify({ repo_id: currentRepoId, files: selectedFiles, scheduled }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);

        fileSelectionContainer.style.display = 'none';
        document.getElementById('repo-info-bar').style.display = 'none';
        repoIdInput.value = '';
        currentRepoId = '';

        const lbl    = scheduled ? 'Added to scheduler' : 'Added to queue';
        const detail = scheduled
            ? `${selectedFiles.length} file(s) will download during the scheduled window.`
            : `${selectedFiles.length} file(s) queued for download.`;
        showToast('success', lbl, detail);
        startPollingProgress();
    } catch (error) {
        showToast('error', 'Download Error', error.message || 'An unknown error occurred.');
    }
}

function initFileSelection() {
    downloadSelectionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitDownload(false);
    });

    const scheduleDownloadBtn = document.getElementById('schedule-download-btn');
    if (scheduleDownloadBtn) {
        scheduleDownloadBtn.addEventListener('click', async () => submitDownload(true));
    }

    selectAllBtn.addEventListener('click',   () => setAllCheckboxes(true));
    deselectAllBtn.addEventListener('click', () => setAllCheckboxes(false));
}

// ============================================================
// EXPLORE SELECT EVENT
// ============================================================
document.addEventListener('explore:select', (e) => {
    repoIdInput.value = e.detail.modelId;
    repoIdInput.focus();
    listFilesForm.dispatchEvent(new Event('submit'));
});

// ============================================================
// INIT
// ============================================================
initTheme();
applySettings();
initFiles(fileListDiv);
initFileFilter(fileFilterInput);
initRepos(completedListUl, startPollingProgress);
initRepoFinder();
initFileSelection();
initQueueEvents();
initDownloadControls();
initCompletedEvents();
initRepoFilter();
initShowHidden();
initScheduler();
initSyncSettings(startPollingProgress);
initSettings();
initExplore();

updateCompletedList();
startPollingProgress();
