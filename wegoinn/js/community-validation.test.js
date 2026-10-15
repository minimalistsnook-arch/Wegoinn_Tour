import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./supabase.js', () => ({ supabase: null }));
import { readFileSync } from 'node:fs';
import { validateCommunityRequiredFields } from './community-validation.js';
const html = readFileSync(`${process.cwd()}/wegoinn/index.html`, 'utf8');
let form;
beforeEach(() => {
  document.body.innerHTML = html;
  form = document.querySelector('#communityForm');
  document.querySelector('#createSheet').hidden = false;
});
it('names each missing field and focuses the first one', () => {
  expect(validateCommunityRequiredFields(form)).toBe(false);
  expect(form.querySelector('#community-required-title').textContent).toBe('Please fill in: Community Name');
  expect(form.querySelector('#community-required-language').textContent).toContain('Community Language');
  expect(form.elements.title.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(form.elements.community_date);
  expect(form.querySelector('#community-required-participation_fee')).toBeNull();
});
it('clears corrected fields and removes messages when the form resets', () => {
  validateCommunityRequiredFields(form);
  form.elements.title.value = 'Night walk';
  form.elements.title.dispatchEvent(new Event('input'));
  expect(form.querySelector('#community-required-title')).toBeNull();
  expect(form.elements.title.hasAttribute('aria-invalid')).toBe(false);
  validateCommunityRequiredFields(form);
  expect(form.querySelectorAll('#community-required-language')).toHaveLength(1);
  form.reset();
  expect(form.querySelector('[data-required-error]')).toBeNull();
});
it('requires a fee only for paid communities and accepts completed forms', () => {
  form.elements.feeType.value = 'paid';
  validateCommunityRequiredFields(form);
  expect(form.querySelector('#community-required-participation_fee').textContent).toContain('Participation Fee');
  for (const input of form.querySelectorAll('[aria-invalid="true"]')) {
    input.value = input.type === 'date' ? '2099-01-01' : input.type === 'time' ? '19:00' : input.type === 'number' ? '1000' : input.tagName === 'SELECT' ? input.options[1]?.value : 'Filled';
  }
  // Language options are populated by initCommunity in the app.
  form.elements.language.innerHTML = '<option value="en">English</option>';
  expect(validateCommunityRequiredFields(form)).toBe(true);
});

it('limits guest community dates to inclusive stay bounds and exempts admins', async () => {
  const { communityDateWithinStay } = await import('./community-validation.js');
  const guest = { role: 'guest', check_in: '2099-01-10', check_out: '2099-01-15' };
  for (const date of ['2099-01-10', '2099-01-12', '2099-01-15']) expect(communityDateWithinStay(date, guest)).toBe(true);
  for (const date of ['2099-01-09', '2099-01-16', '']) expect(communityDateWithinStay(date, guest)).toBe(false);
  expect(communityDateWithinStay('2099-01-12', { role: 'guest' })).toBe(false);
  expect(communityDateWithinStay('2099-12-31', { role: 'admin' })).toBe(true);
});
