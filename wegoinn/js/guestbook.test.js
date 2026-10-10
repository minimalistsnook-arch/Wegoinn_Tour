import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const mock = vi.hoisted(() => ({ posts: [], insert: vi.fn(), compress: vi.fn(), upload: vi.fn() }));
vi.mock('./supabase.js', () => ({ supabase: { from: () => {
  const chain = { select: () => chain, order: () => chain, limit: () => chain, insert: mock.insert, then: resolve => Promise.resolve({ data: mock.posts, error: null }).then(resolve) };
  return chain;
} }, errorMessage: error => error.message }));
vi.mock('./image-upload.js', () => ({ isImageUploadConfigured: () => true, compressImage: mock.compress, uploadImage: mock.upload }));
import { initGuestbook } from './guestbook.js';
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
beforeEach(async () => {
  document.documentElement.innerHTML = readFileSync(`${process.cwd()}/wegoinn/index.html`, 'utf8').replace(/<!DOCTYPE html>/i, '').replace(/<\/?html[^>]*>/g, '');
  mock.posts = [];
  mock.insert.mockReset(); mock.compress.mockReset(); mock.upload.mockReset();
  mock.insert.mockImplementation(async details => {
    mock.posts = [{ ...details, id: 'new-post', author_id: 'me', author: { nickname: 'Traveler' }, created_at: new Date().toISOString(), comments: [] }];
    return { error: null };
  });
  vi.stubGlobal('requestAnimationFrame', callback => { callback(); return 1; });
  await initGuestbook({ id: 'me', nickname: 'Traveler' });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('docks the composer only when the guestbook is active and labels it 방명록', () => {
  const section = document.querySelector('#guestbook');
  const composer = document.querySelector('#guestbookComposer');
  vi.spyOn(section, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 2000 });
  window.dispatchEvent(new Event('scroll'));
  expect(composer.classList.contains('is-visible')).toBe(true);
  expect(composer.inert).toBe(false);
  vi.spyOn(section, 'getBoundingClientRect').mockReturnValue({ top: -1000, bottom: -100 });
  window.dispatchEvent(new Event('scroll'));
  expect(composer.inert).toBe(true);
  expect(document.querySelector('a[href="#guestbook"]').textContent).toContain('방명록');
});
it('publishes once while a request is pending and refreshes the guestbook', async () => {
  let complete;
  mock.insert.mockImplementationOnce(details => new Promise(resolve => {
    complete = () => { mock.posts = [{ ...details, id: 'new-post', author_id: 'me', author: { nickname: 'Traveler' }, created_at: new Date().toISOString(), comments: [] }]; resolve({ error: null }); };
  }));
  const input = document.querySelector('#postInput');
  input.value = '서울에서의 추억'; input.dispatchEvent(new Event('input'));
  document.querySelector('#publishPostBtn').click();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  expect(mock.insert).toHaveBeenCalledTimes(1);
  expect(input.readOnly).toBe(true);
  complete(); await settle();
  expect(document.querySelector('#feed').textContent).toContain('서울에서의 추억');
  expect(input.value).toBe('');
});
it('uploads a photo and registers a photo-only guestbook entry', async () => {
  mock.compress.mockResolvedValue(new File(['photo'], 'photo.webp', { type: 'image/webp' }));
  mock.upload.mockResolvedValue('https://example.com/photo.webp');
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const fileInput = document.querySelector('#postImageInput');
  Object.defineProperty(fileInput, 'files', { value: [new File(['photo'], 'photo.png', { type: 'image/png' })] });
  fileInput.dispatchEvent(new Event('change')); await settle();
  expect(document.querySelector('#postPreview').hidden).toBe(false);
  document.querySelector('#publishPostBtn').click(); await settle();
  expect(mock.upload).toHaveBeenCalledTimes(1);
  expect(mock.insert).toHaveBeenCalledWith(expect.objectContaining({ content: '', image_url: 'https://example.com/photo.webp' }));
  expect(document.querySelector('#feed .post__photo img').src).toBe('https://example.com/photo.webp');
  expect(document.querySelector('#postPreview').hidden).toBe(true);
});
