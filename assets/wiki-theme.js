const THEME_KEY = 'hsr-wiki-theme';
const root = document.documentElement;

function preferredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  for (const button of document.querySelectorAll('[data-theme-toggle]')) {
    button.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    button.textContent = theme === 'dark' ? '☀' : '◐';
  }
}

function toggleTheme() {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

applyTheme(preferredTheme());

for (const button of document.querySelectorAll('[data-theme-toggle]')) {
  button.addEventListener('click', toggleTheme);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!localStorage.getItem(THEME_KEY)) applyTheme(preferredTheme());
});
