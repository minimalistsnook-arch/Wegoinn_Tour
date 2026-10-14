import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./supabase.js', () => ({ supabase: null }));
import { avatarHtml } from './utils.js';
import { initProfilePhotoViewer } from './profile-photo.js';

beforeEach(() => {
  document.body.innerHTML = '<div class="sheet is-open" id="communitySheet"></div>';
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
});

it('opens dynamically rendered profile photos with the correct image and nickname', () => {
  initProfilePhotoViewer();
  document.body.insertAdjacentHTML('beforeend', avatarHtml('Mina <3', 'avatar--sm', 'https://example.com/profile.webp'));
  const avatar = document.querySelector('[data-profile-photo]');
  expect(avatar.tagName).toBe('BUTTON');
  avatar.querySelector('img').click();
  const viewer = document.querySelector('dialog');
  expect(viewer.open).toBe(true);
  expect(viewer.querySelector('img').src).toBe('https://example.com/profile.webp');
  expect(viewer.querySelector('p').textContent).toBe('Mina <3');
  viewer.querySelector('button').click();
  expect(viewer.open).toBe(false);
  expect(viewer.querySelector('img').hasAttribute('src')).toBe(false);
  expect(document.querySelector('#communitySheet').classList.contains('is-open')).toBe(true);
});

it('keeps Escape within the viewer and supports closing via the background', () => {
  initProfilePhotoViewer();
  document.body.insertAdjacentHTML('beforeend', avatarHtml('Guest', '', 'https://example.com/avatar.webp'));
  document.querySelector('[data-profile-photo]').click();
  const viewer = document.querySelector('dialog');
  const listener = vi.fn();
  document.addEventListener('keydown', listener);
  viewer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(listener).not.toHaveBeenCalled();
  document.removeEventListener('keydown', listener);
  viewer.click();
  expect(viewer.open).toBe(false);
});

it('keeps missing and unsafe profile photo URLs as initials', () => {
  expect(avatarHtml('Guest')).not.toContain('data-profile-photo');
  expect(avatarHtml('Guest', '', 'javascript:alert(1)')).not.toContain('data-profile-photo');
  expect(avatarHtml('" onclick="bad', '', 'https://example.com/"bad')).not.toContain(' onclick="bad');
});
