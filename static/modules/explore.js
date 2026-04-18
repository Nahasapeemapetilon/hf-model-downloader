import { fetchJson } from './api.js';
import { escapeHtml } from './utils.js';

let _browseState = { query: '', tag: '', sort: 'downloads' };
let _debounceTimer = null;
let _loaded = false;

let _trendingListEl = null;

function formatCount(n) {
    if (!n) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return Math.round(n / 1_000) + 'k';
    return String(n);
}

function renderBrowseResults(models) {
    _trendingListEl.innerHTML = '';
    if (!models || models.length === 0) {
        _trendingListEl.innerHTML = '<div class="trending-empty">No models found.</div>';
        return;
    }
    const isSortedByLikes = _browseState.sort === 'likes';
    models.forEach(model => {
        const btn = document.createElement('button');
        btn.className = 'trending-item';
        btn.type = 'button';
        btn.title = `Open ${model.id}`;
        const tagHtml = model.pipeline_tag
            ? `<span class="trending-tag">${escapeHtml(model.pipeline_tag.replace(/-/g, '\u2011'))}</span>`
            : '';
        const countVal  = isSortedByLikes ? model.likes     : model.downloads;
        const countIcon = isSortedByLikes ? '♥'             : '↓';
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
            document.dispatchEvent(new CustomEvent('explore:select', { detail: { modelId: model.id } }));
        });
        _trendingListEl.appendChild(btn);
    });
}

async function loadBrowseResults() {
    _loaded = false;
    _trendingListEl.innerHTML = '<div class="trending-empty"><span class="spinner" aria-hidden="true"></span> Loading…</div>';
    try {
        const response = await fetchJson('/api/search-models', {
            method: 'POST',
            body: JSON.stringify({
                query:        _browseState.query,
                pipeline_tag: _browseState.tag,
                sort:         _browseState.sort,
                limit:        20,
            }),
        });
        if (!response.ok) throw new Error((await response.json()).error);
        const models = await response.json();
        renderBrowseResults(models);
        _loaded = true;
    } catch (error) {
        _trendingListEl.innerHTML = `<div class="trending-empty trending-error">Error: ${escapeHtml(error.message)}</div>`;
    }
}

function scheduleBrowseLoad(immediate = false) {
    clearTimeout(_debounceTimer);
    if (immediate) {
        loadBrowseResults();
    } else {
        _debounceTimer = setTimeout(loadBrowseResults, 450);
    }
}

export function openExploreWithQuery(query) {
    const trendingContent = document.getElementById('trending-content');
    const trendingToggle  = document.getElementById('trending-toggle');
    const modelSearchInput = document.getElementById('model-search-input');

    if (modelSearchInput) modelSearchInput.value = query;
    _browseState.query = query;

    if (trendingContent && trendingContent.style.display === 'none') {
        trendingToggle && trendingToggle.click();
    }
    loadBrowseResults();
    trendingContent && trendingContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function initExplore() {
    const trendingToggle   = document.getElementById('trending-toggle');
    const trendingContent  = document.getElementById('trending-content');
    const modelSearchInput = document.getElementById('model-search-input');
    const tagFilterRow     = document.getElementById('tag-filter-row');
    const sortRow          = document.getElementById('sort-row');

    _trendingListEl = document.getElementById('trending-list');
    if (!_trendingListEl) return;

    if (trendingToggle) {
        trendingToggle.addEventListener('click', () => {
            const isOpen = trendingContent.style.display !== 'none';
            trendingContent.style.display = isOpen ? 'none' : 'block';
            trendingToggle.setAttribute('aria-expanded', String(!isOpen));
            trendingToggle.classList.toggle('is-open', !isOpen);
            if (!isOpen && !_loaded) {
                loadBrowseResults();
            }
        });
    }

    if (modelSearchInput) {
        modelSearchInput.addEventListener('input', () => {
            _browseState.query = modelSearchInput.value.trim();
            scheduleBrowseLoad(false);
        });
    }

    if (tagFilterRow) {
        tagFilterRow.addEventListener('click', (e) => {
            const btn = e.target.closest('.tag-filter-btn');
            if (!btn) return;
            tagFilterRow.querySelectorAll('.tag-filter-btn').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            _browseState.tag = btn.dataset.tag;
            scheduleBrowseLoad(true);
        });
    }

    if (sortRow) {
        sortRow.addEventListener('click', (e) => {
            const btn = e.target.closest('.sort-btn');
            if (!btn) return;
            sortRow.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            _browseState.sort = btn.dataset.sort;
            scheduleBrowseLoad(true);
        });
    }
}
