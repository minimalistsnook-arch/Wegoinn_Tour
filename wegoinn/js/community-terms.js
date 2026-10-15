import { TERMS_LANGUAGES, termsCopy, translateTerms } from './community-terms-language.js';
import { supabase } from './supabase.js';
import { escapeHtml } from './utils.js';

// A deliberately small, escaped Markdown subset for administrator-authored notices.
export function renderTerms(body) {
  const inline = text => escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return String(body).split(/\n\s*\n/).map(block => {
    return block.split('\n').map(line => {
      if (/^### /.test(line)) return `<h3>${inline(line.slice(4))}</h3>`;
      if (/^# /.test(line)) return `<h2>${inline(line.slice(2))}</h2>`;
      if (line.trim() === '---') return '<hr />';
      if (line.startsWith('- ')) return `<p class="terms-bullet">• ${inline(line.slice(2))}</p>`;
      return `<p>${inline(line)}</p>`;
    }).join('');
  }).join('');
}

export async function getCommunityTerms() {
  const { data, error } = await supabase.rpc('get_community_terms');
  if (error) throw error;
  if (!data?.version || !data?.body) throw new Error('이용 안내가 등록되지 않았습니다. 운영자에게 문의해 주세요.');
  return data;
}

let pending;
export function ensureCommunityConsent() {
  if (pending) return pending;
  pending = consentGate().finally(() => { pending = null; });
  return pending;
}
async function consentGate() {
  let terms;
  try { terms = await getCommunityTerms(); } catch { /* The blocking dialog provides a retry. */ }
  if (terms?.accepted) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'community-consent';
  dialog.setAttribute('aria-labelledby', 'communityConsentTitle');
  dialog.setAttribute('translate', 'no');
  dialog.innerHTML = `
    <header class="community-consent__head"><h2 id="communityConsentTitle">커뮤니티 이용 안내</h2><select class="community-consent__language" aria-label="Language">${TERMS_LANGUAGES.map(([code, label]) => `<option value="${code}">${label}</option>`).join('')}</select></header>
    <div class="community-consent__body terms-copy" tabindex="0"></div>
    <form class="community-consent__actions">
      <p class="terms-error" role="alert" hidden></p>
      <button type="button" class="terms-retry" hidden>다시 불러오기</button>
      <p class="community-consent__read-hint" role="status"></p>
      <label class="community-consent__check"><input type="checkbox" required /><span class="community-consent__check-label"></span></label>
      <div class="community-consent__buttons"><button type="button" class="terms-exit">로그아웃</button><button type="submit" class="terms-accept" disabled>동의하고 시작하기</button></div>
    </form>`;
  document.body.append(dialog);
  document.documentElement.classList.add('consent-open');
  const app = document.querySelector('#appView');
  const wasInert = app?.inert;
  if (app) app.inert = true;
  const body = dialog.querySelector('.community-consent__body');
  const checkbox = dialog.querySelector('input');
  const accept = dialog.querySelector('.terms-accept');
  const error = dialog.querySelector('.terms-error');
  const retry = dialog.querySelector('.terms-retry');
  const languageSelect = dialog.querySelector('.community-consent__language');
  let language = 'ko';
  try { const saved = localStorage.getItem('wegoinn-terms-language'); if (TERMS_LANGUAGES.some(([code]) => code === saved)) language = saved; } catch {}
  languageSelect.value = language;
  let generation = 0, loading = false, readComplete = false;
  const syncControls = () => {
    checkbox.disabled = !terms || loading || !readComplete;
    accept.disabled = checkbox.disabled || !checkbox.checked;
    dialog.querySelector('.community-consent__read-hint').hidden = readComplete || loading || !terms;
  };
  const checkRead = () => {
    if (terms && !loading && body.scrollTop + body.clientHeight >= body.scrollHeight - 8) readComplete = true;
    syncControls();
  };
  async function paint() {
    const token = ++generation;
    checkbox.checked = false; readComplete = false; loading = true;
    const [title, agreement, confirm, logout, hint, translating, failure, retryLabel] = termsCopy(language);
    dialog.lang = language;
    dialog.querySelector('#communityConsentTitle').textContent = title;
    dialog.querySelector('.community-consent__check-label').textContent = agreement;
    accept.textContent = confirm;
    dialog.querySelector('.terms-exit').textContent = logout;
    dialog.querySelector('.community-consent__read-hint').textContent = hint;
    retry.textContent = retryLabel;
    retry.hidden = true; error.hidden = true;
    body.textContent = translating;
    syncControls();
    try {
      if (!terms) throw new Error('Missing terms');
      const translated = await translateTerms(terms.body, language);
      if (token !== generation) return;
      body.innerHTML = renderTerms(translated);
      body.scrollTop = 0;
      loading = false;
      requestAnimationFrame(checkRead);
    } catch {
      if (token !== generation) return;
      body.textContent = failure;
      error.hidden = false; error.textContent = failure;
      retry.hidden = false;
      // Partial or failed translations can never be accepted.
      loading = true;
    }
    syncControls();
  }
  paint();
  body.addEventListener('scroll', checkRead, { passive: true });
  window.addEventListener('resize', checkRead);
  dialog.addEventListener('cancel', event => event.preventDefault());
  checkbox.addEventListener('change', syncControls);
  languageSelect.addEventListener('change', () => {
    language = languageSelect.value;
    try { localStorage.setItem('wegoinn-terms-language', language); } catch {}
    paint();
  });
  retry.addEventListener('click', async () => {
    retry.disabled = true;
    try { terms = await getCommunityTerms(); } catch { terms = null; }
    await paint(); retry.disabled = false;
  });
  dialog.querySelector('.terms-exit').addEventListener('click', async () => {
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
    if (signOutError) { error.hidden = false; error.textContent = '로그아웃에 실패했습니다. 다시 시도해 주세요.'; return; }
    location.reload();
  });
  dialog.showModal();
  body.focus();
  return new Promise(resolve => {
    dialog.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      if (!terms || loading || !readComplete || !checkbox.checked || accept.disabled) return;
      accept.disabled = true; checkbox.disabled = true; languageSelect.disabled = true;
      try {
        const { error: saveError } = await supabase.rpc('accept_community_terms', { p_version: terms.version });
        if (saveError) throw saveError;
        const current = await getCommunityTerms();
        if (!current.accepted) { terms = current; paint(); return; }
        window.removeEventListener('resize', checkRead);
        dialog.close(); dialog.remove();
        document.documentElement.classList.remove('consent-open');
        if (app) app.inert = Boolean(wasInert);
        resolve();
      } catch (cause) {
        try {
          const latest = await getCommunityTerms();
          if (latest.version !== terms.version) { terms = latest; paint(); }
        } catch { /* Keep the current notice and require a successful save. */ }
        error.hidden = false;
        error.textContent = cause.message || '동의를 저장하지 못했습니다. 다시 시도해 주세요.';
      } finally { languageSelect.disabled = false; syncControls(); }
    });
  });
}

export async function renderTermsSettings(container) {
  container.innerHTML = '<p>이용 안내를 불러오는 중…</p>';
  try {
    let terms = await getCommunityTerms();
    container.innerHTML = `<form class="terms-editor" translate="no">
      <h2>커뮤니티 이용 안내 설정</h2>
      <p>내용을 변경해 저장하면 새 버전으로 게시되며, 이용자는 새 안내에 다시 동의해야 합니다.</p>
      <label>안내 내용<textarea name="body" rows="24" required minlength="100" maxlength="30000"></textarea></label>
      <p># 제목 · ### 소제목 · **굵은 글씨** · - 목록 형식을 사용할 수 있습니다.</p>
      <button type="submit">안내 저장 및 게시</button><p class="terms-editor__status" role="status"></p>
      <details><summary>미리보기</summary><div class="terms-copy terms-editor__preview"></div></details>
    </form>`;
    const form = container.querySelector('form');
    const input = form.elements.body;
    const status = form.querySelector('[role="status"]');
    input.value = terms.body;
    const preview = () => { form.querySelector('.terms-editor__preview').innerHTML = renderTerms(input.value); };
    input.addEventListener('input', preview); preview();
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const button = form.querySelector('[type="submit"]'); button.disabled = true;
      try {
        const { data, error } = await supabase.rpc('publish_community_terms', { p_body: input.value, p_expected_version: terms.version });
        if (error) throw error;
        terms = { ...terms, version: data, body: input.value };
        status.textContent = `안내 v${data} 저장 완료. 이용자는 새 내용에 다시 동의해야 합니다.`;
      } catch (cause) { status.textContent = cause.message || '저장하지 못했습니다.'; }
      finally { button.disabled = false; }
    });
  } catch (cause) { container.textContent = cause.message || '설정을 불러오지 못했습니다.'; }
}
