function reportStorageKey() {
  return 'hsr-wiki-page-reports';
}

function loadReports() {
  try {
    const raw = localStorage.getItem(reportStorageKey());
    const rows = raw ? JSON.parse(raw) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function saveReports(rows) {
  localStorage.setItem(reportStorageKey(), JSON.stringify(rows.slice(-100)));
}

function setReportStatus(root, text) {
  const node = root.querySelector('[data-report-status]');
  if (node) node.textContent = text;
}

function randomId() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}`;
}

function fillReportFromQuery(root) {
  const params = new URLSearchParams(location.search);
  const page = params.get('page') || params.get('title') || '';
  const input = root.querySelector('[data-report-page]');
  if (input && page && !input.value) input.value = page;
}

function loadReportTurnstile(root) {
  const siteKey = root.dataset.reportTurnstileSiteKey || '';
  const container = root.querySelector('[data-report-turnstile-container]');
  if (!siteKey || !container || container.dataset.rendered) return;
  const renderWidget = () => {
    if (!window.turnstile || container.dataset.rendered) return;
    const widgetId = window.turnstile.render(container, {
      sitekey: siteKey,
      callback(token) {
        root.dataset.reportTurnstileToken = token;
      },
      'expired-callback'() {
        root.dataset.reportTurnstileToken = '';
      },
      'error-callback'() {
        root.dataset.reportTurnstileToken = '';
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

function resetReportTurnstile(root) {
  const container = root.querySelector('[data-report-turnstile-container]');
  root.dataset.reportTurnstileToken = '';
  if (window.turnstile && container?.dataset.widgetId) {
    window.turnstile.reset(container.dataset.widgetId);
  }
}

function githubIssueUrl(root, payload) {
  const configured = root.dataset.reportGithubUrl || '';
  if (!configured || configured === 'reports.html') return '';
  const url = new URL(configured, location.href);
  url.searchParams.set('title', `[문서 제보] ${payload.page || '사이트'}`);
  url.searchParams.set('labels', payload.type || 'content-error');
  const body = [
    `문서 또는 URL: ${payload.page || ''}`,
    `유형: ${payload.type || ''}`,
    '',
    payload.body || '',
  ].join('\n');
  url.searchParams.set('body', body);
  return url.toString();
}

async function submitWorkerReport(root, payload) {
  const base = root.dataset.reportWorkerBaseUrl || '';
  if (!base) throw new Error('제보 기능이 아직 설정되지 않았습니다.');
  const response = await fetch(`${base.replace(/\/$/, '')}/page-reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `${response.status}`);
  return body;
}

function initReportForm(root) {
  fillReportFromQuery(root);
  loadReportTurnstile(root);
  const form = root.querySelector('[data-report-form]');
  const result = root.querySelector('[data-report-result]');
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const pageInput = root.querySelector('[data-report-page]');
    const payload = {
      id: randomId(),
      page: pageInput?.value.trim() || '',
      type: root.querySelector('[data-report-type]')?.value || 'content-error',
      body: root.querySelector('[data-report-body]')?.value.trim() || '',
      turnstile_token: root.dataset.reportTurnstileToken || '',
      created_at: new Date().toISOString(),
      url: location.href,
    };
    if (!payload.body) {
      if (result) result.textContent = '내용을 입력해 주세요.';
      return;
    }
    const mode = root.dataset.reportMode || 'local_mock';
    let usedWorker = false;
    try {
      if (mode === 'worker') {
        usedWorker = true;
        await submitWorkerReport(root, payload);
        if (result) result.textContent = '제보가 서버에 접수되었습니다.';
      } else {
        const githubUrl = githubIssueUrl(root, payload);
        if (githubUrl) {
          location.href = githubUrl;
          return;
        }
        const rows = loadReports();
        rows.push(payload);
        saveReports(rows);
        if (result) result.textContent = '제보가 이 브라우저의 로컬 기록에 저장되었습니다.';
      }
      form.reset();
      if (pageInput && payload.page) pageInput.value = payload.page;
      setReportStatus(root, '접수 완료');
    } catch (error) {
      if (result) result.textContent = `접수 실패: ${error.message}`;
    } finally {
      if (usedWorker) resetReportTurnstile(root);
    }
  });
}

function initCopyButtons() {
  for (const button of document.querySelectorAll('[data-copy-text]')) {
    button.addEventListener('click', async () => {
      const value = button.dataset.copyText || '';
      try {
        await navigator.clipboard.writeText(value);
        button.textContent = '복사됨';
      } catch {
        button.textContent = '복사 실패';
      }
      setTimeout(() => {
        button.textContent = '복사';
      }, 1400);
    });
  }
}

for (const root of document.querySelectorAll('[data-report-root]')) initReportForm(root);
initCopyButtons();
