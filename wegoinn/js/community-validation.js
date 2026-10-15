import { t } from './i18n.js';

const fields = {
  community_date: 'Date',
  community_time: 'Time · KST (UTC+9)',
  deadline_date: 'Apply by · Date',
  deadline_time: 'Apply by · Time (KST)',
  language: 'Community Language',
  title: 'Community Name',
  about: 'About this community',
  meeting_place: 'Meeting place',
  max_participants: 'Maximum Participants',
  min_participants: 'Minimum Participants',
};
const validations = new WeakMap();

export function validateCommunityRequiredFields(form) {
  validations.get(form)?.abort();
  const controller = new AbortController();
  validations.set(form, controller);
  const clearErrors = () => {
    form.querySelectorAll('[data-required-error]').forEach(el => el.remove());
    form.querySelectorAll('[aria-invalid="true"]').forEach(el => {
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
    });
  };
  clearErrors();
  form.addEventListener('reset', () => { clearErrors(); controller.abort(); }, { signal: controller.signal });
  const required = { ...fields };
  if (form.elements.feeType.value === 'paid') required.participation_fee = 'Participation Fee';
  let first;
  for (const [name, label] of Object.entries(required)) {
    const input = form.elements[name];
    if (input.value.trim()) continue;
    const error = document.createElement('small');
    error.id = `community-required-${name}`;
    error.dataset.requiredError = '';
    error.className = 'login-error';
    error.setAttribute('role', 'alert');
    error.textContent = `${t('Please fill in:')} ${t(label)}`;
    input.closest('.field').append(error);
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', error.id);
    const clear = () => {
      if (!input.value.trim()) return;
      error.remove();
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
      input.removeEventListener('input', clear);
      input.removeEventListener('change', clear);
    };
    input.addEventListener('input', clear, { signal: controller.signal });
    input.addEventListener('change', clear, { signal: controller.signal });
    first ||= input;
  }
  if (first) {
    first.focus();
    first.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }
  return !first;
}

// Date-only stay bounds include both the check-in and check-out day (KST).
export function communityDateWithinStay(date, profile) {
  if (profile?.role === 'admin') return true;
  return Boolean(date && profile?.check_in && profile?.check_out
    && date >= profile.check_in && date <= profile.check_out);
}
