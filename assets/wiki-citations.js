const citationState = {
  popover: null,
  activeTrigger: null,
};

function citationEscapeHtml(value) {
  return (value || '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function ensureCitationPopover() {
  if (citationState.popover) return citationState.popover;
  const popover = document.createElement('aside');
  popover.className = 'citation-popover';
  popover.hidden = true;
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-modal', 'false');
  popover.setAttribute('aria-label', '각주 내용');
  popover.innerHTML = '<button type="button" class="citation-popover-close" data-citation-close aria-label="각주 팝업 닫기">×</button><div class="citation-popover-body" data-citation-body></div>';
  document.body.appendChild(popover);
  popover.addEventListener('click', event => {
    if (event.target.closest('[data-citation-close]')) closeCitationPopover();
  });
  citationState.popover = popover;
  return popover;
}

function closeCitationPopover() {
  if (citationState.activeTrigger) citationState.activeTrigger.setAttribute('aria-expanded', 'false');
  citationState.activeTrigger = null;
  if (citationState.popover) citationState.popover.hidden = true;
}

function referencePayload(refId) {
  const reference = document.getElementById(refId);
  if (!reference) return null;
  const title = reference.querySelector('.ref-title')?.textContent?.trim() || `출처 ${refId.replace(/^ref-/, '')}`;
  const source = reference.querySelector('.ref-source')?.innerHTML?.trim() || '';
  const quote = reference.querySelector('.ref-quote')?.innerHTML?.trim() || '';
  return { title, source, quote };
}

function renderCitationBody(payload, number) {
  const source = payload.source ? `<div class="citation-popover-source">${payload.source}</div>` : '';
  const quote = payload.quote ? `<blockquote>${payload.quote}</blockquote>` : '<p class="citation-popover-empty">표시할 인용문이 없어.</p>';
  return `<div class="citation-popover-number">각주 ${citationEscapeHtml(number)}</div><strong>${citationEscapeHtml(payload.title)}</strong>${source}${quote}`;
}

function positionCitationPopover(popover, trigger) {
  const gap = 10;
  const margin = 12;
  const rect = trigger.getBoundingClientRect();
  popover.hidden = false;
  popover.style.left = '0px';
  popover.style.top = '0px';
  const popRect = popover.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  let left = rect.left + rect.width / 2 - popRect.width / 2;
  left = Math.max(margin, Math.min(left, viewportWidth - popRect.width - margin));
  let top = rect.bottom + gap;
  if (top + popRect.height + margin > viewportHeight && rect.top - popRect.height - gap > margin) {
    top = rect.top - popRect.height - gap;
    popover.dataset.placement = 'top';
  } else {
    popover.dataset.placement = 'bottom';
  }
  top = Math.max(margin, Math.min(top, viewportHeight - popRect.height - margin));
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function openCitationPopover(trigger) {
  const refId = trigger.dataset.refTarget;
  const number = trigger.textContent.trim();
  const payload = referencePayload(refId);
  if (!payload) return false;
  const popover = ensureCitationPopover();
  const body = popover.querySelector('[data-citation-body]');
  body.innerHTML = renderCitationBody(payload, number);
  if (citationState.activeTrigger && citationState.activeTrigger !== trigger) {
    citationState.activeTrigger.setAttribute('aria-expanded', 'false');
  }
  citationState.activeTrigger = trigger;
  trigger.setAttribute('aria-expanded', 'true');
  positionCitationPopover(popover, trigger);
  return true;
}

document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-cite-popover]');
  if (trigger) {
    event.preventDefault();
    event.stopPropagation();
    openCitationPopover(trigger);
    return;
  }
  if (citationState.popover && !citationState.popover.hidden && !event.target.closest('.citation-popover')) {
    closeCitationPopover();
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeCitationPopover();
});

window.addEventListener('resize', () => {
  if (citationState.popover && !citationState.popover.hidden && citationState.activeTrigger) {
    positionCitationPopover(citationState.popover, citationState.activeTrigger);
  }
});
