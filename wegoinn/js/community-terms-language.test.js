import { expect, it, vi, beforeEach } from 'vitest';
const mock = vi.hoisted(() => ({ translate: vi.fn(), configured: vi.fn() }));
vi.mock('./translation.js', () => ({ translateText: (...args) => mock.translate(...args), checkTranslationService: (...args) => mock.configured(...args) }));
import { splitTermsForTranslation, translateTerms, TERMS_LANGUAGES, termsCopy } from './community-terms-language.js';
beforeEach(() => { mock.translate.mockReset(); mock.configured.mockResolvedValue(true); });
it('provides ten language choices and localized agreement controls for every choice', () => {
 expect(TERMS_LANGUAGES).toHaveLength(10);
 for (const [language] of TERMS_LANGUAGES) expect(termsCopy(language)).toHaveLength(8);
});
it('keeps every character when splitting notices up to the editor maximum', () => {
 const body = ('### 안내\n\n중요한 안내를 모두 확인해 주세요.\n'.repeat(1200)).slice(0,30000);
 const chunks = splitTermsForTranslation(body);
 expect(chunks.join('')).toBe(body);
 expect(chunks.every(chunk => chunk.length <= 1800)).toBe(true);
 expect(splitTermsForTranslation('x'.repeat(10000)).join('')).toBe('x'.repeat(10000));
});
it('translates all chunks in order without truncating the last section', async () => {
 const body = '안내 내용\n'.repeat(800) + '마지막 안내';
 mock.translate.mockImplementation(async (chunk, language) => `${language}:${chunk}`);
 const translated = await translateTerms(body, 'vi');
 expect(mock.translate.mock.calls.map(([chunk]) => chunk).join('')).toBe(body);
 expect(translated).toContain('마지막 안내');
 expect(mock.translate.mock.calls.every(([,language])=>language==='vi')).toBe(true);
});
it('fails closed if any chunk is missing and uses the complete Korean original without a service', async () => {
 mock.translate.mockResolvedValueOnce('First section').mockResolvedValueOnce(null);
 await expect(translateTerms('a'.repeat(3000),'de')).rejects.toThrow('incomplete');
 mock.configured.mockResolvedValue(false);
 await expect(translateTerms('원문 전체','en')).rejects.toThrow('unavailable');
 expect(await translateTerms('원문 전체','ko')).toBe('원문 전체');
});

it('includes the entire original notice in all ten languages without requiring a translation service', async () => {
 const { ORIGINAL_TERMS, ORIGINAL_TERMS_TRANSLATIONS } = await import('./community-terms-translations.js');
 mock.configured.mockResolvedValue(false);
 for (const [language] of TERMS_LANGUAGES) {
  const text = await translateTerms(ORIGINAL_TERMS, language);
  expect(text).toContain('wegoinnteam@gmail.com');
  expect(text).toContain('09:00'); expect(text).toContain('22:00');
  for (let section=1; section<=6; section++) expect(text).toContain(`### ${section}.`);
  expect(text.match(/^### /gm)).toHaveLength(8);
  expect(text.trim().endsWith('Wego Out')).toBe(true);
  expect(text.split(/\n\s*\n/).length).toBe(ORIGINAL_TERMS.split(/\n\s*\n/).length);
  if (language !== 'ko') expect(text).toBe(ORIGINAL_TERMS_TRANSLATIONS[language]);
 }
 expect(mock.translate).not.toHaveBeenCalled();
});
