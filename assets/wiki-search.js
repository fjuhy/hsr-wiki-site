const SEARCH_PATHS = {
  manifest: 'search/manifest.json',
  suggest: 'search/suggest.json',
  pages: 'search/pages.json',
  shards: 'search/shards/'
};
const MAX_QUERY_TERMS = 10;
const DEFAULT_SHARD_COUNT = 128;
const state = {
  manifest: null,
  suggestions: null,
  pages: null,
  shards: new Map(),
  activeIndex: -1,
  currentSuggestions: [],
  debounce: null,
  lastQuery: ''
};

function normalizeText(value) {
  return (value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[·•・\-_/|:—–\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function compact(value) { return normalizeText(value).replace(/\s+/g, ''); }
function hasCjkish(value) { return /[가-힣\u3400-\u9fff\uf900-\ufaff]/u.test(value); }
function ngrams(value, sizes = [2, 3]) {
  const out = new Set();
  const chars = Array.from(value);
  for (const size of sizes) {
    if (chars.length >= size) {
      for (let i = 0; i <= chars.length - size; i++) out.add(chars.slice(i, i + size).join(''));
    }
  }
  return out;
}
function termsForText(value, forQuery = false) {
  const norm = normalizeText(value);
  const out = new Set();
  if (!norm) return out;
  const words = norm.split(' ').filter(w => Array.from(w).length >= 2);
  const joined = norm.replace(/\s+/g, '');
  for (const word of words) {
    out.add(word);
    if (hasCjkish(word)) {
      for (const g of ngrams(word)) out.add(g);
    } else if (/[a-z0-9]/.test(word)) {
      const chars = Array.from(word);
      for (let end = 2; end <= Math.min(chars.length, 10); end++) out.add(chars.slice(0, end).join(''));
    }
  }
  if (Array.from(joined).length >= 2) {
    out.add(joined);
    if (hasCjkish(joined)) for (const g of ngrams(joined)) out.add(g);
  }
  let arr = Array.from(out);
  if (forQuery && hasCjkish(joined)) {
    const joinedLength = Array.from(joined).length;
    if (joinedLength > 0 && joinedLength <= 3) arr = arr.filter(term => Array.from(term).length >= joinedLength);
    else arr = arr.filter(term => Array.from(term).length >= 3);
  }
  if (forQuery && arr.length > MAX_QUERY_TERMS) {
    arr = arr.sort((a, b) => Array.from(b).length - Array.from(a).length || a.localeCompare(b)).slice(0, MAX_QUERY_TERMS);
  }
  return new Set(arr);
}
function fnv1a32(value) {
  const bytes = new TextEncoder().encode(value);
  let h = 2166136261 >>> 0;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function shardForTerm(term) { const count = state.manifest?.shard_count || DEFAULT_SHARD_COUNT; return String(fnv1a32(term) % count).padStart(2, '0') + '.json'; }
async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}
async function ensureManifest() {
  if (!state.manifest) state.manifest = await fetchJson(SEARCH_PATHS.manifest);
  return state.manifest;
}
async function ensureSuggestions() {
  if (!state.suggestions) {
    const payload = await fetchJson(SEARCH_PATHS.suggest);
    state.suggestions = payload.suggestions || [];
  }
  return state.suggestions;
}
async function ensurePages() {
  if (!state.pages) {
    const payload = await fetchJson(SEARCH_PATHS.pages);
    state.pages = new Map((payload.pages || []).map(page => [page.id, page]));
  }
  return state.pages;
}
async function ensureShard(name) {
  if (!state.shards.has(name)) {
    const promise = fetchJson(SEARCH_PATHS.shards + name).catch(error => {
      state.shards.delete(name);
      throw error;
    });
    state.shards.set(name, promise);
  }
  return state.shards.get(name);
}
function scoreSuggestion(query, item) {
  const q = normalizeText(query);
  const qc = q.replace(/\s+/g, '');
  if (!qc) return 0;
  const key = item.key || '';
  const keyc = item.keyCompact || key.replace(/\s+/g, '');
  let score = 0;
  if (key === q || keyc === qc) score = 100000;
  else if (key.startsWith(q) || keyc.startsWith(qc)) score = 50000;
  else if (key.includes(q) || keyc.includes(qc)) score = 12000;
  else {
    const minFuzzyLength = hasCjkish(qc) ? 3 : 2;
    for (const term of termsForText(q, true)) {
      if (Array.from(term).length < minFuzzyLength) continue;
      if (keyc.includes(term)) { score = Math.max(score, 2000 + Array.from(term).length * 100); }
    }
  }
  return score ? score + (item.rank || 0) : 0;
}
function findSuggestions(query, suggestions, limit = 8) {
  const rows = suggestions
    .map(item => ({ item, score: scoreSuggestion(query, item) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label, 'ko'));
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const target = row.item.slug || row.item.href || row.item.label;
    if (seen.has(target)) continue;
    seen.add(target);
    out.push(row.item);
    if (out.length >= limit) break;
  }
  return out;
}
function exactPageMatch(query, suggestions) {
  const q = normalizeText(query);
  const qc = q.replace(/\s+/g, '');
  return suggestions.find(item => item.kind === 'page' && (item.key === q || item.keyCompact === qc));
}
function escapeHtml(value) {
  return (value || '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}
function typeLabel(type) {
  return ({ cosmology:'우주관', path:'운명의 길', faction:'파벌', 'faction-subgroup':'파벌 하위 조직', organization:'조직', concept:'개념', character:'인물', place:'장소', topic:'항목' })[type] || '항목';
}
function statusLabel(status) {
  return ({ rendered:'문서', queued:'등록 용어', needs_review:'검토 용어' })[status] || status;
}
function highlight(text, query) {
  let safe = escapeHtml(text || '');
  const terms = Array.from(termsForText(query, true)).sort((a, b) => Array.from(b).length - Array.from(a).length).slice(0, 4);
  for (const term of terms) {
    if (Array.from(term).length < 2) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    safe = safe.replace(new RegExp(escaped, 'gi'), match => `<mark>${match}</mark>`);
  }
  return safe;
}
async function searchPages(query, limit = 12) {
  const started = performance.now();
  await ensureManifest();
  const pages = await ensurePages();
  const suggestions = await ensureSuggestions();
  const shortQuery = Array.from(compact(query)).length < 2;
  if (shortQuery) {
    const byHref = new Map(Array.from(pages.values()).map(page => [page.href, page]));
    const results = findSuggestions(query, suggestions, limit)
      .filter(item => item.kind === 'page' && item.href && byHref.has(item.href))
      .map(item => ({ ...byHref.get(item.href), score: 100000 + (item.rank || 0) }));
    return { terms: [compact(query)].filter(Boolean), results, elapsedMs: Math.round((performance.now() - started) * 10) / 10, shards: 0, exactOnly: true };
  }
  const terms = Array.from(termsForText(query, true));
  const scores = new Map();
  const shardNames = Array.from(new Set(terms.map(shardForTerm)));
  await Promise.all(shardNames.map(async name => {
    const shard = await ensureShard(name);
    for (const term of terms) {
      const rows = shard.terms?.[term] || [];
      const weight = 1 + Math.min(Array.from(term).length, 8) / 10;
      for (const [id, score] of rows) scores.set(id, (scores.get(id) || 0) + score * weight);
    }
  }));
  const results = Array.from(scores.entries())
    .map(([id, score]) => ({ page: pages.get(id), score }))
    .filter(row => row.page)
    .sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title, 'ko'))
    .slice(0, limit)
    .map(row => ({ ...row.page, score: Math.round(row.score * 10) / 10 }));
  return { terms, results, elapsedMs: Math.round((performance.now() - started) * 10) / 10, shards: shardNames.length };
}
function renderSuggestions(root, query, suggestions) {
  const box = root.querySelector('[data-search-suggestions]');
  if (!box) return;
  state.activeIndex = -1;
  state.currentSuggestions = suggestions;
  if (!query || suggestions.length === 0) {
    box.innerHTML = '';
    state.currentSuggestions = [];
    return;
  }
  box.innerHTML = suggestions.map((item, index) => {
    const href = item.href ? ` data-href="${escapeHtml(item.href)}"` : '';
    const icon = item.kind === 'page' ? '↵' : '＋';
    const sub = item.kind === 'page' ? `${typeLabel(item.type)} · 바로 이동` : `${statusLabel(item.status)} · 아직 문서 없음`;
    return `<button type="button" class="search-suggestion" data-suggestion-index="${index}" aria-selected="false"${href}>
      <span><strong>${highlight(item.label, query)}</strong> <small>${escapeHtml(item.alias ? item.title : sub)}</small></span>
      <em>${icon}</em>
    </button>`;
  }).join('');
}

function updateActiveSuggestion(root, nextIndex) {
  const buttons = Array.from(root.querySelectorAll('[data-suggestion-index]'));
  if (!buttons.length) { state.activeIndex = -1; return; }
  const bounded = (nextIndex + buttons.length) % buttons.length;
  state.activeIndex = bounded;
  buttons.forEach((button, index) => {
    const active = index === bounded;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) button.scrollIntoView({ block: 'nearest' });
  });
}
function chooseSuggestion(root, index) {
  const item = state.currentSuggestions[index];
  if (!item) return false;
  if (item.href) { window.location.href = item.href; return true; }
  const input = root.querySelector('[data-search-input]');
  if (input) {
    input.value = item.label;
    handleInput(root);
  }
  return true;
}
function renderResults(root, query, payload) {
  const box = root.querySelector('[data-search-results]');
  if (!box) return;
  if (!query) {
    box.innerHTML = '<p class="search-empty">검색어를 입력하면 관련 문서가 바로 표시됩니다.</p>';
    return;
  }
  if (Array.from(compact(query)).length < 2 && !payload.results.length) {
    box.innerHTML = '<p class="search-empty">두 글자 이상 입력하면 문서 검색이 시작됩니다.</p>';
    return;
  }
  if (!payload.results.length) {
    box.innerHTML = `<p class="search-empty">문서 본문에서 <strong>${escapeHtml(query)}</strong>와 일치하는 결과가 없습니다.</p>`;
    return;
  }
  const metaLabel = payload.exactOnly ? `${payload.results.length}개 바로 이동 결과 · ${payload.elapsedMs}ms` : `${payload.results.length}개 결과 · shard ${payload.shards}개 · ${payload.elapsedMs}ms`;
  const meta = `<div class="search-meta">${metaLabel}</div>`;
  box.innerHTML = meta + payload.results.map(result => `
    <a class="search-result" href="${escapeHtml(result.href)}">
      <strong>${highlight(result.title, query)}</strong>
      <span>${typeLabel(result.type)} · score ${result.score}</span>
      <p>${highlight(result.summary || (result.headings || []).join(' · '), query)}</p>
    </a>`).join('');
}
function setPanelOpen(root, open) {
  const panel = root.querySelector('[data-search-panel]');
  if (panel) panel.hidden = !open;
}
async function handleInput(root) {
  const input = root.querySelector('[data-search-input]');
  const query = input.value.trim();
  state.lastQuery = query;
  if (!query) { setPanelOpen(root, false); return; }
  setPanelOpen(root, true);
  const suggestions = findSuggestions(query, await ensureSuggestions());
  renderSuggestions(root, query, suggestions);
  clearTimeout(state.debounce);
  state.debounce = setTimeout(async () => {
    if (state.lastQuery !== query) return;
    try {
      const payload = await searchPages(query);
      if (state.lastQuery === query) renderResults(root, query, payload);
    }
    catch (err) {
      const resultBox = root.querySelector('[data-search-results]');
      if (resultBox) resultBox.innerHTML = `<p class="search-empty">검색 인덱스를 불러오지 못했어: ${escapeHtml(err.message)}</p>`;
    }
  }, 90);
}
async function submitSearch(root) {
  const input = root.querySelector('[data-search-input]');
  const query = input.value.trim();
  if (!query) { setPanelOpen(root, false); return; }
  const suggestions = await ensureSuggestions();
  const exact = exactPageMatch(query, suggestions);
  if (exact?.href) { window.location.href = exact.href; return; }
  setPanelOpen(root, true);
  renderSuggestions(root, query, findSuggestions(query, suggestions));
  renderResults(root, query, await searchPages(query));
}
function initSearch(root) {
  const input = root.querySelector('[data-search-input]');
  const form = root.querySelector('[data-search-form]');
  if (!input || !form) return;
  ensureManifest().catch(() => {});
  input.addEventListener('focus', () => { if (input.value.trim()) setPanelOpen(root, true); });
  input.addEventListener('input', () => handleInput(root));
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      updateActiveSuggestion(root, state.activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      updateActiveSuggestion(root, state.activeIndex - 1);
    } else if (event.key === 'Enter' && state.activeIndex >= 0) {
      event.preventDefault();
      chooseSuggestion(root, state.activeIndex);
    }
  });
  form.addEventListener('submit', event => { event.preventDefault(); submitSearch(root); });
  root.addEventListener('click', event => {
    const target = event.target.closest('[data-href]');
    if (target) window.location.href = target.dataset.href;
  });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      event.preventDefault(); input.focus();
    }
    if (event.key === 'Escape') setPanelOpen(root, false);
  });
  document.addEventListener('click', event => { if (!root.contains(event.target)) setPanelOpen(root, false); });
}
for (const root of document.querySelectorAll('[data-wiki-search]')) initSearch(root);
