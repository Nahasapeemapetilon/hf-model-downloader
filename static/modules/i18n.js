let _translations = {};
let _fallback     = {};
let _currentLang  = 'en';

/**
 * Translate a key, optionally interpolating {variable} placeholders.
 * Falls back to the English string, then to the raw key if missing.
 */
export function t(key, vars = {}) {
    let str = _translations[key] ?? _fallback[key] ?? key;
    for (const [k, v] of Object.entries(vars)) {
        str = str.replaceAll(`{${k}}`, v);
    }
    return str;
}

export function currentLang() { return _currentLang; }

/** Apply translations to the DOM (call after load and after language switch). */
export function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.dataset.i18nTitle);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
        el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
    document.documentElement.lang = _currentLang;
}

async function loadLocale(lang) {
    const resp = await fetch(`/static/locales/${lang}.json`);
    if (!resp.ok) throw new Error(`Locale not found: ${lang}`);
    return resp.json();
}

/**
 * Load translations and apply to DOM.
 * Always loads English as fallback first, then the target language on top.
 */
export async function initI18n(lang = 'en') {
    _currentLang = lang;

    // English is always the fallback
    try { _fallback = await loadLocale('en'); } catch { _fallback = {}; }

    if (lang === 'en') {
        _translations = _fallback;
    } else {
        try {
            _translations = await loadLocale(lang);
        } catch {
            _translations = _fallback; // graceful fallback to English
            _currentLang = 'en';
        }
    }

    applyTranslations();
}

/** Switch language, persist to localStorage, re-apply DOM translations. */
export async function switchLang(lang) {
    localStorage.setItem('lang', lang);
    await initI18n(lang);
    // Update language toggle button label
    const label = document.getElementById('lang-label');
    if (label) label.textContent = t(`lang.${lang}`);
}

/** Wire up the language toggle button in the topbar. */
export function initLangToggle() {
    const btn   = document.getElementById('lang-toggle');
    const label = document.getElementById('lang-label');
    if (!btn) return;

    // Show current lang
    if (label) label.textContent = t(`lang.${_currentLang}`);

    btn.addEventListener('click', () => {
        const next = _currentLang === 'en' ? 'de' : 'en';
        switchLang(next).then(() => {
            // Re-render dynamic content that was already inserted into DOM
            document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang: next } }));
        });
    });
}
