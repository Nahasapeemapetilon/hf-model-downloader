export const localOnlyRepos  = new Set(JSON.parse(localStorage.getItem('localOnlyRepos')  || '[]'));
export const confirmedHFRepos = new Set(JSON.parse(localStorage.getItem('confirmedHFRepos') || '[]'));

// Mutate in-place — importers hold a reference to this object
export const syncState = { status: 'idle', repos: {}, outdated_count: 0, last_run: null };

// Lazily loaded sync config used by refreshRepoStatus; null = needs re-fetch
export let cachedSyncConfig = null;
export function setCachedSyncConfig(val) { cachedSyncConfig = val; }

function _migrateGroupMode() {
    const stored = localStorage.getItem('setting-repo-group-mode');
    if (stored) return stored;
    const old = localStorage.getItem('setting-repo-group-status');
    return old === 'false' ? 'none' : 'status';
}

export const settings = {
    allowFileDelete:  localStorage.getItem('setting-file-delete')   === 'true',
    allowRepoDelete:  localStorage.getItem('setting-repo-delete')   === 'true',
    allowNonHFDelete: localStorage.getItem('setting-non-hf-delete') === 'true',
    showSpeedEta:     localStorage.getItem('setting-show-speed')    !== 'false',
    repoGroupMode:    _migrateGroupMode(),
};

export function applySettings() {
    document.body.classList.toggle('allow-file-delete',   settings.allowFileDelete);
    document.body.classList.toggle('allow-repo-delete',   settings.allowRepoDelete);
    document.body.classList.toggle('allow-non-hf-delete', settings.allowNonHFDelete);
}

export function saveLocalOnlyCache() {
    localStorage.setItem('localOnlyRepos',   JSON.stringify([...localOnlyRepos]));
    localStorage.setItem('confirmedHFRepos', JSON.stringify([...confirmedHFRepos]));
}
