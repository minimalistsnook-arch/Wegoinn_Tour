import { expect, it, vi } from 'vitest';
vi.mock('./translation.js', () => ({ isTranslationConfigured: () => false, translateText: vi.fn(), checkTranslationService: async () => false }));
import { initSiteLanguage, t } from './i18n.js';

it('explains login requirements in every supported language without a translation API', () => {
  document.body.innerHTML = '<p id="translationStatus"></p><select data-site-language><option>en</option><option>ko</option><option>ja</option><option>zh</option></select>';
  initSiteLanguage();
  const picker = document.querySelector('select');
  const guidance = 'First visit: add a photo. Returning guests: use the same dates, room number and nickname; no new photo needed.';
  for (const language of ['ko', 'ja', 'zh']) {
    picker.value = language;
    picker.dispatchEvent(new Event('change'));
    for (const label of ['Please fill in:', 'Check in date', 'Check out date', 'Room number', 'Nickname', '(new guests only)', guidance]) {
      expect(t(label)).not.toBe(label);
    }
  }
});

it('translates login validation and account guidance including English without an API', async () => {
  const { translateLoginMessage } = await import('./login-translations.js');
  const dateError = '체크인 날짜: 날짜를 YYYY-MM-DD 또는 YY.MM.DD 형식으로 입력하세요.';
  expect(translateLoginMessage(dateError, 'en')).toBe('Check in date: Enter dates as YYYY-MM-DD or YY.MM.DD.');
  const mismatch = '숙박 계정 확인 실패: 체크인·체크아웃 날짜와 ID, 객실 번호가 기존 계정과 일치하지 않습니다. 처음 가입하는 경우 사진을 추가해 주세요. (오류 코드: P0001)';
  for (const language of ['en', 'ja', 'zh']) {
    const translated = translateLoginMessage(mismatch, language);
    expect(translated).not.toMatch(/[가-힣]/);
    expect(translated).toContain('P0001');
  }
  expect(translateLoginMessage(dateError, 'ko')).toBe(dateError);
});
