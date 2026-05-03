import { fetchJson } from './api.js';
import { escapeHtml, formatBytes } from './utils.js';
import { showToast } from './toast.js';
import { t } from './i18n.js';
import {
    localOnlyRepos, confirmedHFRepos, syncState,
    cachedSyncConfig, setCachedSyncConfig, saveLocalOnlyCache,
    settings,
} from './state.js';

let _repoFilter      = localStorage.getItem('repoFilter') || 'all';
let _completedListUl = null;
let _startPolling    = null;
let _completedRepos  = [];
let _searchTerm      = '';

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
            <span class="repo-meta" aria-label="File count and size">—</span>
            <div class="repo-card-actions">
                <button class="btn btn-ghost btn-icon btn-sm repo-copy-btn"
                        data-repo="${escapeHtml(repo)}" title="${t('repos.copy_id')}"
                        aria-label="${t('repos.copy_id')}">
                    <svg class="copy-icon" width="13" height="13" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    <svg class="copy-check-icon" width="13" height="13" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2.5"
                         stroke-linecap="round" stroke-linejoin="round" style="display:none;">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                </button>
                ${!localOnlyRepos.has(repo) && repo.includes('/') ? `
                <a class="btn btn-ghost btn-icon btn-sm" href="https://huggingface.co/${repo}"
                   target="_blank" rel="noopener noreferrer"
                   title="${t('repos.open_hf')}" aria-label="${t('repos.open_hf')}">
                    <svg width="13" height="13" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                </a>` : ''}
                <button class="btn btn-ghost btn-icon btn-sm update-btn"
                        data-repo="${escapeHtml(repo)}" title="${t('repos.btn_refresh')}"
                        aria-label="${t('repos.btn_refresh')}">
                    <svg class="refresh-icon" width="13" height="13" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2.5"
                         stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="23 4 23 10 17 10"/>
                        <polyline points="1 20 1 14 7 14"/>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                    </svg>
                </button>
                <button class="btn btn-ghost btn-icon btn-sm repo-hide-btn"
                        data-repo="${escapeHtml(repo)}" title="${t('repos.btn_hide')}"
                        aria-label="${t('repos.btn_hide')}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                </button>
                <button class="btn btn-ghost btn-icon btn-sm repo-delete-btn"
                        data-repo="${escapeHtml(repo)}" title="${t('repos.btn_delete')}"
                        aria-label="${t('repos.btn_delete')}">
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
            <div class="local-file-search-wrap" style="display:none;">
                <div class="input-group">
                    <svg class="input-icon" width="13" height="13" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input type="text" class="input input-sm local-file-search"
                           autocomplete="off" spellcheck="false"
                           data-i18n-placeholder="repos.file_search_placeholder">
                </div>
                <div class="file-sort-btns" role="group">
                    <button class="btn btn-ghost btn-sm file-sort-btn" data-sort="name" data-dir="asc"
                            type="button" data-i18n="repos.sort_name">Name</button>
                    <button class="btn btn-ghost btn-sm file-sort-btn" data-sort="size" data-dir="desc"
                            type="button" data-i18n="repos.sort_size">Size</button>
                    <button class="btn btn-ghost btn-sm file-sort-btn" data-sort="reset"
                            type="button" data-i18n="repos.sort_reset">Reset</button>
                </div>
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
                    <button class="btn btn-primary btn-sm download-all-updates-btn"
                            data-repo="${escapeHtml(repo)}" style="display:none;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2.5"
                             stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                            <line x1="5" y1="9" x2="19" y2="9"/>
                        </svg>
                        ${t('repos.download_all_updates')}
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
                        data-repo="${escapeHtml(repo)}" title="${t('repos.btn_unhide')}" aria-label="${t('repos.btn_unhide')}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                </button>
                <button class="btn btn-ghost btn-icon btn-sm repo-delete-btn"
                        data-repo="${escapeHtml(repo)}" title="${t('repos.btn_delete')}"
                        aria-label="${t('repos.btn_delete')}">
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

const _statusEmojis  = { synced: '✅', not_downloaded: '🆕', outdated: '🔄', local_only: '🗑️' };
const _statusLabels  = () => ({
    synced:         t('repos.group_synced'),
    local_only:     t('repos.group_local_only'),
    outdated:       t('repos.group_outdated'),
    not_downloaded: t('repos.group_not_downloaded'),
});

function _makeFileLi(file, repoId) {
    const canDownload = file.status === 'not_downloaded' || file.status === 'outdated';
    const canDelete   = file.status === 'synced';
    const checkboxId  = `cb-${repoId.replace(/[^a-zA-Z0-9]/g, '-')}-${file.name.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const li = document.createElement('li');
    li.className = 'status-file-item';
    li.innerHTML = `
        <span class="status-emoji">${_statusEmojis[file.status] || '❓'}</span>
        ${canDownload ? `<input type="checkbox" id="${checkboxId}" value="${escapeHtml(file.name)}" class="download-update-cb" checked>` : ''}
        <label for="${checkboxId}" class="file-name truncate" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</label>
        <span class="file-size" data-bytes="${file.size || 0}">${formatBytes(file.size)}</span>
        ${canDelete ? `<button class="file-delete-btn" data-repo="${escapeHtml(repoId)}" data-file="${escapeHtml(file.name)}" title="${t('repos.btn_delete_file')}" aria-label="${t('repos.btn_delete_file')}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
        </button>` : ''}
    `;
    return li;
}

function _sortItems(items, sort, dir) {
    return [...items].sort((a, b) => {
        if (sort === 'name') {
            const na = a.querySelector('.file-name')?.textContent || '';
            const nb = b.querySelector('.file-name')?.textContent || '';
            return dir === 'asc' ? na.localeCompare(nb) : nb.localeCompare(na);
        }
        if (sort === 'size') {
            const sa = parseFloat(a.querySelector('.file-size')?.dataset.bytes || 0);
            const sb = parseFloat(b.querySelector('.file-size')?.dataset.bytes || 0);
            return dir === 'desc' ? sb - sa : sa - sb;
        }
        return 0;
    });
}

function _applySortToList(fileList, sort, dir) {
    if (settings.repoGroupByStatus) {
        fileList.querySelectorAll('.file-group-body').forEach(body => {
            const items = [...body.querySelectorAll('.status-file-item')];
            _sortItems(items, sort, dir).forEach(el => body.appendChild(el));
        });
    } else {
        const items = [...fileList.querySelectorAll('.status-file-item')];
        _sortItems(items, sort, dir).forEach(el => fileList.appendChild(el));
    }
}

function _applyFileFilter(fileList, term) {
    if (settings.repoGroupByStatus) {
        fileList.querySelectorAll('.file-group').forEach(group => {
            let visible = 0;
            group.querySelectorAll('.status-file-item').forEach(li => {
                const name    = (li.querySelector('.file-name')?.textContent || '').toLowerCase();
                const matches = !term || name.includes(term);
                li.style.display = matches ? '' : 'none';
                if (matches) visible++;
            });
            group.style.display = visible === 0 ? 'none' : '';
        });
    } else {
        fileList.querySelectorAll('.status-file-item').forEach(li => {
            const name = (li.querySelector('.file-name')?.textContent || '').toLowerCase();
            li.style.display = !term || name.includes(term) ? '' : 'none';
        });
    }
}

function _renderFlat(statusList, fileList, repoId) {
    statusList.forEach(file => fileList.appendChild(_makeFileLi(file, repoId)));
}

function _renderGrouped(statusList, fileList, repoId) {
    const groups   = ['synced', 'local_only', 'outdated', 'not_downloaded'];
    const labels   = _statusLabels();
    const grouped  = Object.fromEntries(groups.map(g => [g, []]));
    statusList.forEach(f => { if (grouped[f.status]) grouped[f.status].push(f); });

    groups.forEach(status => {
        const files = grouped[status];
        if (files.length === 0) return;

        const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
        const group = document.createElement('li');
        group.className = 'file-group';
        group.innerHTML = `
            <button class="file-group-header" type="button" aria-expanded="false">
                <svg class="file-group-chevron" width="12" height="12" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="2.5"
                     stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                </svg>
                <span class="file-group-emoji">${_statusEmojis[status] || ''}</span>
                <span class="file-group-label">${escapeHtml(labels[status] || status)}</span>
                <span class="file-group-meta">(${files.length}) · ${formatBytes(totalSize)}</span>
            </button>
            <ul class="file-group-body"></ul>
        `;

        const header = group.querySelector('.file-group-header');
        const body   = group.querySelector('.file-group-body');
        files.forEach(f => body.appendChild(_makeFileLi(f, repoId)));

        header.addEventListener('click', () => {
            const open = header.getAttribute('aria-expanded') === 'true';
            header.setAttribute('aria-expanded', String(!open));
            body.style.display = open ? 'none' : '';
        });
        body.style.display = 'none';

        fileList.appendChild(group);
    });
}

export async function refreshRepoStatus(card) {
    const repoId        = card.dataset.repo;
    const body          = card.querySelector('.repo-card-body');
    const fileList      = card.querySelector('.local-file-list');
    const skeleton      = card.querySelector('.file-skeleton');
    const statsBar      = card.querySelector('.sync-stats-bar');
    const localControls = card.querySelector('.local-list-controls');
    const downloadBtn      = card.querySelector('.download-updates-btn');
    const scheduleBtn      = card.querySelector('.schedule-updates-btn');
    const downloadAllBtn   = card.querySelector('.download-all-updates-btn');
    const refreshIcon   = card.querySelector('.refresh-icon');

    if (skeleton)    { skeleton.style.display = 'flex'; }
    if (fileList)      fileList.innerHTML = '';
    if (statsBar)      statsBar.style.display = 'none';
    if (localControls) localControls.style.display = 'none';
    if (downloadBtn)    downloadBtn.style.display    = 'none';
    if (scheduleBtn)    scheduleBtn.style.display    = 'none';
    if (downloadAllBtn) downloadAllBtn.style.display = 'none';
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
        card._cachedStatusList = statusList;
        if (skeleton) skeleton.style.display = 'none';

        const metaSpan = card.querySelector('.repo-meta');
        if (metaSpan) {
            const totalSize = statusList.reduce((s, f) => s + (f.size || 0), 0);
            metaSpan.textContent = `${statusList.length} ${t('repos.meta_files')} · ${formatBytes(totalSize)}`;
        }

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

        const hasDownloadable = statusList.some(
            f => f.status === 'not_downloaded' || f.status === 'outdated'
        );

        if (settings.repoGroupByStatus) {
            _renderGrouped(statusList, fileList, repoId);
        } else {
            _renderFlat(statusList, fileList, repoId);
        }

        if (hasDownloadable && localControls && downloadBtn) {
            localControls.style.display = 'flex';
            downloadBtn.style.display   = 'inline-flex';
            if (scheduleBtn)    scheduleBtn.style.display    = 'inline-flex';
            if (downloadAllBtn) downloadAllBtn.style.display = 'inline-flex';
        }

        const searchWrap  = card.querySelector('.local-file-search-wrap');
        const searchInput = card.querySelector('.local-file-search');
        if (searchWrap && searchInput && statusList.length > 5) {
            searchWrap.style.display = '';
            searchInput.addEventListener('input', () => {
                _applyFileFilter(fileList, searchInput.value.trim().toLowerCase());
            });

            card.querySelectorAll('.file-sort-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const sort = btn.dataset.sort;
                    if (sort === 'reset') {
                        card.querySelectorAll('.file-sort-btn').forEach(b => b.classList.remove('is-active'));
                        card._cachedStatusList && (() => {
                            fileList.innerHTML = '';
                            if (settings.repoGroupByStatus) _renderGrouped(card._cachedStatusList, fileList, repoId);
                            else _renderFlat(card._cachedStatusList, fileList, repoId);
                            if (searchInput.value.trim()) _applyFileFilter(fileList, searchInput.value.trim().toLowerCase());
                        })();
                        return;
                    }
                    const wasActive = btn.classList.contains('is-active');
                    const curDir    = btn.dataset.dir;
                    const newDir    = wasActive ? (curDir === 'asc' ? 'desc' : 'asc') : curDir;
                    btn.dataset.dir = newDir;
                    card.querySelectorAll('.file-sort-btn').forEach(b => b.classList.remove('is-active'));
                    btn.classList.add('is-active');
                    btn.textContent = `${btn.getAttribute(`data-i18n`) ? t(btn.getAttribute('data-i18n')) : sort} ${newDir === 'asc' ? '↑' : '↓'}`;
                    _applySortToList(fileList, sort, newDir);
                });
            });
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
    _completedRepos = completed;

    let visible = _repoFilter === 'hf'
        ? completed.filter(r => r.includes('/') && !localOnlyRepos.has(r))
        : _repoFilter === 'local'
            ? completed.filter(r => !r.includes('/') || localOnlyRepos.has(r))
            : completed;

    const searchWrap = document.getElementById('repo-search-wrap');
    if (searchWrap) searchWrap.style.display = visible.length > 5 ? '' : 'none';

    if (_searchTerm) {
        const term = _searchTerm.toLowerCase();
        visible = visible.filter(r => r.toLowerCase().includes(term));
    }

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

    const searchInput = document.getElementById('repo-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            _searchTerm = searchInput.value.trim();
            renderCompletedList(_completedRepos);
        });
    }
}

export function getStartPolling() { return _startPolling; }

export function reRenderOpenCards() {
    if (!_completedListUl) return;
    _completedListUl.querySelectorAll('.repo-card.is-expanded').forEach(card => {
        const statusList = card._cachedStatusList;
        if (!statusList) return;
        const fileList    = card.querySelector('.local-file-list');
        const searchInput = card.querySelector('.local-file-search');
        if (!fileList) return;
        if (searchInput) searchInput.value = '';
        fileList.innerHTML = '';
        if (settings.repoGroupByStatus) {
            _renderGrouped(statusList, fileList, card.dataset.repo);
        } else {
            _renderFlat(statusList, fileList, card.dataset.repo);
        }
    });
}
