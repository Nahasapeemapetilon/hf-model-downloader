function applyTheme(isLight) {
    document.documentElement.classList.toggle('light-theme', isLight);
    const iconMoon = document.getElementById('icon-moon');
    const iconSun  = document.getElementById('icon-sun');
    if (iconMoon) iconMoon.style.display = isLight ? 'none'  : 'block';
    if (iconSun)  iconSun.style.display  = isLight ? 'block' : 'none';
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.setAttribute('aria-label',
        isLight ? 'Switch to dark theme' : 'Switch to light theme');
}

export function initTheme() {
    const saved  = localStorage.getItem('theme');
    applyTheme(saved === 'light');

    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            const isLight = document.documentElement.classList.toggle('light-theme');
            localStorage.setItem('theme', isLight ? 'light' : 'dark');
            applyTheme(isLight);
        });
    }
}
