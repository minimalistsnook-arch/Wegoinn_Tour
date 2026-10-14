import { t } from './i18n.js';

export function initProfilePhotoViewer() {
  const dialog = document.createElement('dialog');
  dialog.className = 'profile-photo-viewer';
  dialog.setAttribute('aria-labelledby', 'profilePhotoName');
  dialog.innerHTML = '<button type="button" class="profile-photo-viewer__close">×</button><img alt="" /><p id="profilePhotoName" data-user-content></p>';
  document.body.append(dialog);
  const close = () => dialog.close();
  dialog.querySelector('button').addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  // Escape closes only this viewer, preserving the community sheet underneath.
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
  dialog.addEventListener('close', () => dialog.querySelector('img').removeAttribute('src'));
  document.addEventListener('click', event => {
    const avatar = event.target.closest('[data-profile-photo]');
    if (!avatar || !avatar.dataset.profilePhoto.startsWith('https://')) return;
    const image = dialog.querySelector('img');
    image.src = avatar.dataset.profilePhoto;
    image.alt = avatar.dataset.profileName || '';
    dialog.querySelector('p').textContent = avatar.dataset.profileName || '';
    dialog.querySelector('button').setAttribute('aria-label', t('Close'));
    dialog.showModal();
  });
}
