import { fetchJson } from './api.js';
import { escapeHtml, formatBytes } from './utils.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';
import {
    localOnlyRepos, confirmedHFRepos, syncState,
    cachedSyncConfig, setCachedSyncConfig, saveLocalOnlyCache,
} from './state.js';

let _repoFilter      = localStorage.getItem('repoFilter') || 'all';
let _completedListUl = null;
let _startPolling    = null;

export function getRepoFilter() { return _repoFilter; }
export function setRepoFilter(f) { _repoFilter = f; }

export function repoTypeClass(repo) {
    if (localOnlyRepos.has(repo) || !repo.includes('/')) return 'is-local-repo';
    return 'is-hf-repo';
}

export function createRepoCard(repo) {
    const li = document.createElement('li');
    li.className = `repo-card completed-item ${repoTypeClass(repo)}`;
    li.dataset.repo = repo;

    const syncInfo   = syncState.repos[repo];
    const isOutdated = syncInfo && syncInfo.status === 'outdated';
    let syncBadge = '';
    if (isOutdated) {
        const outdCnt = (syncInfo.outdated_files || []).length;
        const newCnt  = (syncInfo.new_files || []).length;
        const parts   = [];
        if (outdCnt) parts.push(`${outdCnt} updated`);
        if (newCnt)  parts.push(`${newCnt} new`);
        const label   = newCnt && !outdCnt ? '✦ New files' : '↑ Update';
        syncBadge = `<span class="sync-outdated-badge" title="${parts.join(' · ')}">${label}</span>`;
    }

    li.innerHTML = `
        <div class="repo-card-header">
            <div class="repo-card-title">
                <svg class="repo-type-icon" width="14" height="14" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="repo-card-name truncate" title="${escapeHtml(repo)}">${escapeHtml(repo)}</span>
                ${syncBadge}
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
                <span class="sync-stat synced"><span class="sync-stat-count">0</span> ${t('repos.stat_synced')}</span>
                <span class="sync-stat new"><span class="sync-stat-count">0</span> ${t('repos.stat_new')}</span>
                <span class="sync-stat outdated"><span class="sync-stat-count">0</span> ${t('repos.stat_outdated')}</span>
                <span class="sync-stat local"><span class="sync-stat-count">0</span> ${t('repos.stat_local')}</span>
            </div>
            <div class="file-skeleton flex-col" style="display:none;">
                <div class="skeleton skeleton-row"></div>
                <div class="skeleton skeleton-row"></div>
                <div class="skeleton skeleton-row"></div>
            </div>
            <ul class="local-file-list"></ul>
            <div class="local-list-controls" style="display:none;">
                <div class="local-controls-left">
                    <button class="btn btn-ghost btn-sm select-all-local-btn">${t('repos.select_all_local')}</button>
                    <button class="btn btn-ghost btn-sm deselect-all-local-btn">${t('repos.deselect_all_local')}</button>
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
                        ${t('repos.download_now')}
                    </button>
                    <button class="btn btn-secondary btn-sm schedule-updates-btn"
                            data-repo="${escapeHtml(repo)}" data-scheduled="true" style="display:none;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2.5"
                             stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                        ${t('repos.schedule')}
                    </button>
                </div>
            </div>
        </div>
    `;
    return li;
}

export function createHiddenRepoCard(repo) {
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

export async function refreshRepoStatus(card) {
    const repoId        = card.dataset.repo;
    const body          = card.querySelector('.repo-card-body');
    const fileList      = card.querySelector('.local-file-list');
    const skeleton      = card.querySelector('.file-skeleton');
    const statsBar      = card.querySelector('.sync-stats-bar');
    const localControls = card.querySelector('.local-list-controls');
    const downloadBtn   = card.querySelector('.download-updates-btn');
    const scheduleBtn   = card.querySelector('.schedule-updates-btn');
    const refreshIcon   = card.querySelector('.refresh-icon');

    if (skeleton)    { skeleton.style.display = 'flex'; }
    if (fileList)      fileList.innerHTML = '';
    if (statsBar)      statsBar.style.display = 'none';
    if (localControls) localControls.style.display = 'none';
    if (downloadBtn)   downloadBtn.style.display = 'none';
    if (scheduleBtn)   scheduleBtn.style.display = 'none';
    if (refreshIcon)   refreshIcon.classList.add('is-loading');

    try {
        const response = await fetchJson('/api/repository-status', {
            method: 'POST',
            body:   JSON.stringify({ repo_id: repoId }),
        });
        if (!response.ok) {
            const data = await response.json();
            const err = new Error(data.error);
            err.notFound = response.status === 404 && data.not_found === true;
            throw err;
        }

        const statusList = await response.json();
        if (skeleton) skeleton.style.display = 'none';

        confirmedHFRepos.add(repoId);
        if (localOnlyRepos.has(repoId)) {
            localOnlyRepos.delete(repoId);
            saveLocalOnlyCache();
        }

        const counts = { synced: 0, not_downloaded: 0, outdated: 0, local_only: 0 };
        statusList.forEach(f => { if (counts[f.status] !== undefined) counts[f.status]++; });

        if (statsBar) {
            const statEls = statsBar.querySelectorAll('.sync-stat');
            if (statEls[0]) statEls[0].querySelector('.sync-stat-count').textContent = counts.synced;
            if (statEls[1]) statEls[1].querySelector('.sync-stat-count').textContent = counts.not_downloaded;
            if (statEls[2]) statEls[2].querySelector('.sync-stat-count').textContent = counts.outdated;
            if (statEls[3]) statEls[3].querySelector('.sync-stat-count').textContent = counts.local_only;
            statsBar.style.display = 'flex';
        }

        const _statusOrder = { synced: 0, local_only: 1, outdated: 2, not_downloaded: 3 };
        statusList.sort((a, b) => {
            const od = (_statusOrder[a.status] ?? 9) - (_statusOrder[b.status] ?? 9);
            return od !== 0 ? od : a.name.localeCompare(b.name);
        });

        const statusEmojis = { synced: '✅', not_downloaded: '🆕', outdated: '🔄', local_only: '🗑️' };
        let hasDownloadable = false;

        statusList.forEach(file => {
            const canDownload = file.status === 'not_downloaded' || file.status === 'outdated';
            const canDelete   = file.status === 'synced';
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

        try {
            if (!cachedSyncConfig) {
                const cfgResp = await fetch('/api/sync/config');
                setCachedSyncConfig(await cfgResp.json());
            }
            const excluded   = (cachedSyncConfig.excluded_repos || []).includes(repoId);
            const syncToggle = document.createElement('div');
            syncToggle.className = 'sync-exclude-row';
            syncToggle.innerHTML = `
                <label class="sync-exclude-label">
                    <input type="checkbox" class="sync-exclude-cb" ${excluded ? '' : 'checked'}>
                    <span>${t('repos.include_in_sync')}</span>
                </label>`;
            syncToggle.querySelector('.sync-exclude-cb').addEventListener('change', async (e) => {
                const endpoint = e.target.checked ? '/api/sync/include' : '/api/sync/exclude';
                await fetchJson(endpoint, { method: 'POST', body: JSON.stringify({ repo_id: repoId }) });
                setCachedSyncConfig(null);
            });
            body.appendChild(syncToggle);
        } catch { /* ignore */ }

    } catch (error) {
        if (skeleton) skeleton.style.display = 'none';
        if (error.notFound) {
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
                    ${t('repos.not_on_hf')}
                </li>`;
        } else {
            showToast('error', t('repos.status_error'), error.message);
        }
    } finally {
        if (refreshIcon) refreshIcon.classList.remove('is-loading');
    }
}

export function renderCompletedList(completed) {
    const visible = _repoFilter === 'hf'
        ? completed.filter(r => r.includes('/') && !localOnlyRepos.has(r))
        : _repoFilter === 'local'
            ? completed.filter(r => !r.includes('/') || localOnlyRepos.has(r))
            : completed;

    _completedListUl.innerHTML = '';

    const countBadge = document.getElementById('completed-count-badge');
    const emptyState = _completedListUl.parentElement.querySelector('.empty-state');

    if (countBadge) countBadge.textContent = visible.length;

    if (visible.length === 0) {
        if (emptyState) emptyState.style.display = 'flex';
        return;
    }
    if (emptyState) emptyState.style.display = 'none';

    visible.forEach(repo => {
        _completedListUl.appendChild(createRepoCard(repo));
    });
}

export async function checkReposOnHF(repos) {
    const unknown = repos.filter(r => !localOnlyRepos.has(r) && !confirmedHFRepos.has(r));
    if (unknown.length === 0) return false;

    try {
        const resp = await fetchJson('/api/repos/check-hf', {
            method: 'POST',
            body:   JSON.stringify({ repos: unknown }),
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
        }
        if (changed) saveLocalOnlyCache();
        return changed;
    } catch {
        return false;
    }
}

export async function updateCompletedList() {
    try {
        const [completedResp, syncResp] = await Promise.all([
            fetch('/completed'),
            fetch('/api/sync/status'),
        ]);
        const completed = await completedResp.json();

        try {
            const s = await syncResp.json();
            Object.assign(syncState, s);
        } catch { /* ignore */ }

        renderCompletedList(completed);

        const toCheck = completed.filter(r => r.includes('/'));
        if (toCheck.length > 0) {
            const changed = await checkReposOnHF(toCheck);
            if (changed) renderCompletedList(completed);
        }
    } catch (error) {
        console.error('Error fetching completed list:', error);
    }
}

export async function loadHiddenRepos() {
    try {
        const resp   = await fetch('/api/repo/hidden');
        const hidden = await resp.json();
        _completedListUl.querySelectorAll('.repo-card.is-hidden-repo').forEach(el => el.remove());
        hidden.forEach(repo => _completedListUl.appendChild(createHiddenRepoCard(repo)));
    } catch (e) {
        console.error('Error loading hidden repos:', e);
    }
}

export function initRepos(completedListUl, startPollingProgress) {
    _completedListUl = completedListUl;
    _startPolling    = startPollingProgress;
}

export function getStartPolling() { return _startPolling; }
