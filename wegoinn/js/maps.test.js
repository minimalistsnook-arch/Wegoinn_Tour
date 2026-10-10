import { describe, expect, it, vi, afterEach } from 'vitest';
import { mapLink, mapLocation, resolveMap } from './maps.js';
import { onRequestGet } from '../../functions/api/map-location.js';
afterEach(() => vi.unstubAllGlobals());
describe('map shared locations', () => {
  it('accepts shared text, missing schemes and Korean map HTTP links', () => {
    expect(mapLink('[네이버 지도] 서울역 https://naver.me/example')).toBe('https://naver.me/example');
    expect(mapLink('map.kakao.com/link/map/서울역,37.55,126.97')).toContain('https://map.kakao.com/');
    expect(mapLink('http://map.kakao.com/link/map/123')).toBe('https://map.kakao.com/link/map/123');
    expect(mapLink('https://map.kakao.com.evil.test/')).toBe('');
    expect(mapLink('javascript:alert(1)')).toBe('');
    expect(mapLink('https://user:password@map.kakao.com/')).toBe('');
  });
  it('extracts place names and prioritizes Google pin over viewport', () => {
    const info = mapLocation('https://www.google.com/maps/place/Seoul+Station/@37.5,126.9,15z/data=!3d37.55!4d126.97');
    expect(info.name).toBe('Seoul Station');
    expect(info.coordinates).toBe('37.55, 126.97');
    expect(mapLocation('https://www.google.com/maps/search/?api=1&query=37.55%2C126.97').coordinates).toBe('37.55, 126.97');
    expect(mapLocation('https://map.kakao.com/link/map/서울역,37.55,126.97').coordinates).toBe('37.55, 126.97');
    expect(mapLocation('https://map.naver.com/?lat=37.55&lng=126.97').coordinates).toBe('37.55, 126.97');
  });
  it('resolves short link redirects and rejects non-map redirect targets', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://www.google.com/maps/place/Seoul+Station/' } })).mockResolvedValueOnce(new Response('<title>Seoul Station - Google Maps</title>'));
    vi.stubGlobal('fetch', fetchMock);
    const response = await onRequestGet({ request: new Request('https://example.test/api/map-location?url=https://maps.app.goo.gl/test') });
    expect((await response.json()).name).toBe('Seoul Station');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }));
    expect((await onRequestGet({ request: new Request('https://example.test/api/map-location?url=https://naver.me/test') })).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('does not fetch a parseable location and reports unavailable short links', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 422 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await resolveMap('https://www.google.com/maps/search/?api=1&query=Seoul')).name).toBe('Seoul');
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(resolveMap('https://naver.me/test')).rejects.toThrow('full place link');
  });
});

it('accepts the supplied Naver desktop place URL and reads its search location', async () => {
  const link = 'https://map.naver.com/p/search/%EC%82%BC%EA%B0%81%EC%A7%80/place/2072965380?c=15.00,0,0,0,dh&placePath=%2Fhome%3Ffrom%3Dmap%26fromPanelNum%3D2%26timestamp%3D202610101417%26locale%3Dko%26svcName%3Dmap_pcv5%26searchText%3D%EC%82%BC%EA%B0%81%EC%A7%80';
  expect(mapLink(link)).toBe(link);
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  expect(await resolveMap(link)).toMatchObject({ name: '삼각지', searchText: '삼각지', placeId: '2072965380', nameIsSearch: true, coordinates: '' });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(mapLocation('https://map.naver.com/p/entry/place/2072965380?placePath=%2Fhome%3FsearchText%3D%EC%82%BC%EA%B0%81%EC%A7%80')).toMatchObject({ searchText: '삼각지', placeId: '2072965380' });
});
