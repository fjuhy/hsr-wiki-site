const THEME_KEY = 'hsr-wiki-theme';
const GISCUS_ORIGIN = 'https://giscus.app';
const root = document.documentElement;
let giscusObserver = null;

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
  syncGiscusTheme(theme);
}

function toggleTheme() {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

function giscusTheme(theme) {
  return theme === 'dark' ? 'dark' : 'light';
}

function syncGiscusTheme(theme) {
  const nextTheme = giscusTheme(theme);
  for (const script of document.querySelectorAll('script[src^="https://giscus.app/client.js"]')) {
    script.setAttribute('data-theme', nextTheme);
  }
  for (const frame of document.querySelectorAll('iframe.giscus-frame')) {
    syncGiscusFrame(frame, nextTheme);
  }
}

function syncGiscusFrame(frame, theme) {
  if (frame.contentWindow) {
    frame.contentWindow.postMessage({ giscus: { setConfig: { theme } } }, GISCUS_ORIGIN);
  }
  if (!frame.dataset.themeSyncReady) {
    frame.dataset.themeSyncReady = 'true';
    frame.addEventListener('load', () => syncGiscusTheme(root.dataset.theme || preferredTheme()), { once: true });
  }
}

function watchGiscusFrames() {
  if (giscusObserver || !document.body) return;
  giscusObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches('iframe.giscus-frame') || node.querySelector('iframe.giscus-frame')) {
          syncGiscusTheme(root.dataset.theme || preferredTheme());
          return;
        }
      }
    }
  });
  giscusObserver.observe(document.body, { childList: true, subtree: true });
}

applyTheme(preferredTheme());
watchGiscusFrames();

for (const button of document.querySelectorAll('[data-theme-toggle]')) {
  button.addEventListener('click', toggleTheme);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!localStorage.getItem(THEME_KEY)) applyTheme(preferredTheme());
});
