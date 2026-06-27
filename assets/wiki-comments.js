const AUTH_KEY = 'hsr-wiki-comment-auth';

function commentKey(slug) {
  return `hsr-wiki-comments:${slug}`;
}

function loadJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJsonStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadLocalComments(slug) {
  const rows = loadJsonStorage(commentKey(slug), []);
  return Array.isArray(rows) ? rows : [];
}

function saveLocalComments(slug, rows) {
  saveJsonStorage(commentKey(slug), rows.slice(-100));
}

function setStatus(root, message) {
  const status = root.querySelector('[data-comments-status]');
  if (status) status.textContent = message;
}

function randomId() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}`;
}

function renderList(root, rows, handlers = {}) {
  const list = root.querySelector('[data-comments-list]');
  if (!list) return;
  list.replaceChildren();
  const statusOf = row => row.status || row.moderation_status || 'allow';
  const visibleRows = rows.filter(row => statusOf(row) !== 'hide');
  if (!visibleRows.length) {
    const empty = document.createElement('p');
    empty.className = 'subtle';
    empty.textContent = '아직 댓글이 없습니다.';
    list.append(empty);
    return;
  }
  for (const row of visibleRows) {
    const card = document.createElement('article');
    const status = statusOf(row);
    card.className = `comment-card${status === 'hold' ? ' is-held' : ''}`;
    const meta = document.createElement('strong');
    const statusLabel = status === 'hold' ? ' · 검토 대기' : '';
    meta.textContent = `${row.author || row.author_name || '익명'} · ${row.createdAt || row.created_at || ''}${statusLabel}`;
    const body = document.createElement('p');
    body.textContent = row.text || row.body || '';
    const actions = document.createElement('div');
    actions.className = 'comment-actions';
    if (handlers.report) {
      const report = document.createElement('button');
      report.type = 'button';
      report.textContent = '신고';
      report.addEventListener('click', () => handlers.report(row));
      actions.append(report);
    }
    if (handlers.hide) {
      const hide = document.createElement('button');
      hide.type = 'button';
      hide.textContent = '숨김';
      hide.addEventListener('click', () => handlers.hide(row));
      actions.append(hide);
    }
    card.append(meta, body, actions);
    list.append(card);
  }
}

function initLocalMode(root) {
  const slug = root.dataset.pageSlug || 'unknown';
  const maxChars = Number(root.dataset.maxChars || 1200);
  const form = root.querySelector('[data-comments-form]');
  const text = root.querySelector('[data-comments-text]');
  const nameInput = root.querySelector('[data-comments-name]');
  if (!form || !text) return;
  setStatus(root, '로컬 댓글 모드입니다. 이 브라우저에만 저장됩니다.');
  form.hidden = false;
  let rows = loadLocalComments(slug);
  const rerender = () => renderList(root, rows, {
    report(row) {
      row.reportedCount = Number(row.reportedCount || 0) + 1;
      row.status = row.status === 'allow' ? 'hold' : row.status;
      saveLocalComments(slug, rows);
      setStatus(root, '신고가 로컬 기록에 저장되었습니다.');
      rerender();
    },
    hide(row) {
      row.status = 'hide';
      saveLocalComments(slug, rows);
      setStatus(root, '댓글을 로컬에서 숨겼습니다.');
      rerender();
    },
  });
  rerender();
  form.addEventListener('submit', event => {
    event.preventDefault();
    const value = (text.value || '').trim().slice(0, maxChars);
    if (!value) return;
    rows = [
      ...rows,
      {
        id: randomId(),
        author: (nameInput?.value || '').trim().slice(0, 40) || 'local user',
        createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        text: value,
        depth: 0,
        status: 'allow',
      },
    ];
    saveLocalComments(slug, rows);
    text.value = '';
    rerender();
  });
}

function parseAuthHash() {
  if (!location.hash.includes('access_token=')) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('access_token');
  const refresh = params.get('refresh_token');
  const expiresIn = Number(params.get('expires_in') || 3600);
  if (!token) return null;
  const payload = {
    access_token: token,
    refresh_token: refresh || '',
    expires_at: Date.now() + Math.max(60, expiresIn - 30) * 1000,
  };
  sessionStorage.setItem(AUTH_KEY, JSON.stringify(payload));
  history.replaceState(null, document.title, location.pathname + location.search);
  return payload;
}

function readAuth() {
  parseAuthHash();
  let payload = null;
  try {
    payload = JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null');
  } catch {
    payload = null;
  }
  if (!payload || !payload.access_token || Date.now() > Number(payload.expires_at || 0)) {
    sessionStorage.removeItem(AUTH_KEY);
    return null;
  }
  return payload;
}

async function fetchSupabaseUser(root, auth) {
  const projectUrl = root.dataset.supabaseProjectUrl || '';
  const anonKey = root.dataset.supabaseAnonKey || '';
  if (!projectUrl || !anonKey || !auth?.access_token) return null;
  const response = await fetch(`${projectUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${auth.access_token}`,
    },
  });
  if (!response.ok) return null;
  return response.json();
}

function loginWithGoogle(root) {
  const projectUrl = root.dataset.supabaseProjectUrl || '';
  const anonKey = root.dataset.supabaseAnonKey || '';
  if (!projectUrl || !anonKey) {
    setStatus(root, 'Google 로그인을 쓰려면 Supabase URL과 anon key를 공개 설정에 입력해야 합니다.');
    return;
  }
  const redirect = location.href.split('#')[0];
  const url = new URL(`${projectUrl.replace(/\/$/, '')}/auth/v1/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', redirect);
  window.location.href = url.toString();
}

function logout(root) {
  sessionStorage.removeItem(AUTH_KEY);
  setStatus(root, '로그아웃했습니다.');
  location.reload();
}

function workerUrl(root, path) {
  const base = root.dataset.workerBaseUrl || '';
  if (!base) return '';
  return `${base.replace(/\/$/, '')}${path}`;
}

async function workerJson(root, path, options = {}) {
  const url = workerUrl(root, path);
  if (!url) throw new Error('댓글 Worker URL이 설정되지 않았습니다.');
  const auth = readAuth();
  const headers = {
    'content-type': 'application/json',
    ...(options.headers || {}),
  };
  if (auth?.access_token) headers.authorization = `Bearer ${auth.access_token}`;
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${response.status}`);
  return payload;
}

function profileDisplayName(user) {
  const meta = user?.user_metadata || {};
  for (const candidate of [meta.preferred_username, meta.user_name, meta.name, meta.full_name]) {
    const name = String(candidate || '').trim().slice(0, 40);
    if (name) return name;
  }
  return '';
}

function loadTurnstile(root) {
  const siteKey = root.dataset.turnstileSiteKey || '';
  const container = root.querySelector('[data-turnstile-container]');
  if (!siteKey || !container || container.dataset.rendered) return;
  const renderWidget = () => {
    if (!window.turnstile || container.dataset.rendered) return;
    const widgetId = window.turnstile.render(container, {
      sitekey: siteKey,
      callback(token) {
        root.dataset.turnstileToken = token;
      },
      'expired-callback'() {
        root.dataset.turnstileToken = '';
      },
      'error-callback'() {
        root.dataset.turnstileToken = '';
      },
    });
    if (widgetId !== undefined) container.dataset.widgetId = String(widgetId);
    container.dataset.rendered = '1';
  };
  if (window.turnstile) {
    renderWidget();
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
  script.async = true;
  script.defer = true;
  script.addEventListener('load', renderWidget);
  document.head.append(script);
}

function resetTurnstile(root) {
  const container = root.querySelector('[data-turnstile-container]');
  root.dataset.turnstileToken = '';
  if (window.turnstile && container?.dataset.widgetId) {
    window.turnstile.reset(container.dataset.widgetId);
  }
}

async function initWorkerMode(root) {
  const slug = root.dataset.pageSlug || 'unknown';
  if (!root.dataset.workerBaseUrl) {
    setStatus(root, '댓글 Worker URL이 설정되지 않았습니다.');
    return;
  }
  const form = root.querySelector('[data-comments-form]');
  const text = root.querySelector('[data-comments-text]');
  const nameInput = root.querySelector('[data-comments-name]');
  const authBox = root.querySelector('[data-comments-auth]');
  const login = root.querySelector('[data-comments-login]');
  const logoutButton = root.querySelector('[data-comments-logout]');
  const userLabel = root.querySelector('[data-comments-user]');
  if (authBox) authBox.hidden = false;
  if (login) login.addEventListener('click', () => loginWithGoogle(root));
  if (logoutButton) logoutButton.addEventListener('click', () => logout(root));

  const auth = readAuth();
  const user = auth ? await fetchSupabaseUser(root, auth).catch(() => null) : null;
  if (user) {
    if (login) login.hidden = true;
    if (logoutButton) logoutButton.hidden = false;
    if (userLabel) userLabel.textContent = 'Google 로그인됨';
    if (nameInput && !nameInput.value) {
      nameInput.value = profileDisplayName(user);
    }
    if (form) form.hidden = false;
    loadTurnstile(root);
  } else {
    if (form) form.hidden = true;
  }

  async function refresh() {
    const payload = await workerJson(root, `/comments?page_slug=${encodeURIComponent(slug)}`);
    const handlers = user ? {
      async report(row) {
        const reason = prompt('신고 사유를 짧게 입력해 주세요.');
        if (!reason) return;
        try {
          await workerJson(root, '/reports', {
            method: 'POST',
            body: JSON.stringify({ comment_id: row.id, reason, turnstile_token: root.dataset.turnstileToken || '' }),
          });
          setStatus(root, '신고가 접수되었습니다.');
        } catch (error) {
          setStatus(root, `신고 접수 실패: ${error.message}`);
        } finally {
          resetTurnstile(root);
        }
      },
    } : {};
    renderList(root, payload.comments || [], handlers);
  }

  await refresh().catch(error => setStatus(root, `댓글을 불러오지 못했습니다: ${error.message}`));
  if (!user) {
    setStatus(root, '댓글 작성은 Google 로그인 후 가능합니다.');
    return;
  }
  setStatus(root, '댓글을 작성할 수 있습니다.');
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const body = (text.value || '').trim();
    if (!body) return;
    try {
      const payload = {
        page_slug: slug,
        body,
        author_name: (nameInput?.value || '').trim().slice(0, 40),
        turnstile_token: root.dataset.turnstileToken || '',
      };
      const result = await workerJson(root, '/comments', { method: 'POST', body: JSON.stringify(payload) });
      text.value = '';
      setStatus(root, result.comment?.moderation_status === 'hold' ? '댓글이 검토 대기 상태로 접수되었습니다.' : '댓글이 등록되었습니다.');
      resetTurnstile(root);
      await refresh().catch(error => setStatus(root, `댓글은 접수됐지만 목록 갱신에 실패했습니다: ${error.message}`));
    } catch (error) {
      setStatus(root, `댓글 등록 실패: ${error.message}`);
      resetTurnstile(root);
    }
  });
}

function initDisabled(root) {
  setStatus(root, '댓글은 운영 설정 연결 후 활성화됩니다.');
}

function initComments(root) {
  const mode = root.dataset.commentsMode || 'disabled';
  if (mode === 'local_mock') {
    initLocalMode(root);
    return;
  }
  if (mode === 'worker') {
    initWorkerMode(root);
    return;
  }
  initDisabled(root);
}

for (const root of document.querySelectorAll('[data-comments-root]')) initComments(root);
