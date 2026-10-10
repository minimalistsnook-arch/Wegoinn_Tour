import { escapeHtml } from './utils.js';

export function mapLink(value) {
  const match = String(value || '').match(/https?:\/\/[^\s<>"']+/i);
  try {
    const url = new URL(match ? match[0] : `https://${String(value || '').trim()}`);
    const host = url.hostname;
    const allowed = ['maps.app.goo.gl', 'goo.gl', 'maps.google.com', 'www.google.com', 'google.com', 'map.naver.com', 'm.map.naver.com', 'naver.me', 'map.kakao.com', 'm.map.kakao.com', 'kko.to'];
    if (!allowed.includes(host) || url.username || url.password || (url.port && url.port !== '443')) return '';
    if (['www.google.com', 'google.com'].includes(host) && !url.pathname.startsWith('/maps')) return '';
    if (host === 'goo.gl' && !url.pathname.startsWith('/maps')) return '';
    url.protocol = 'https:';
    return url.href;
  } catch { return ''; }
}

export function mapLocation(value) {
  const link = mapLink(value);
  if (!link) return null;
  const url = new URL(link);
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { path = url.pathname; }
  const params = url.searchParams;
  const isNaver = ['map.naver.com', 'm.map.naver.com'].includes(url.hostname);
  let placePath;
  try { placePath = new URL(params.get('placePath') || '/', 'https://map.naver.com'); } catch { placePath = new URL('https://map.naver.com'); }
  const searchText = isNaver ? (path.match(/\/(?:p\/)?search\/([^/]+)/)?.[1] || placePath.searchParams.get('searchText') || '') : '';
  const placeId = isNaver ? (path.match(/\/place\/(\d+)/)?.[1] || '') : '';
  const name = params.get('query') || params.get('q') || params.get('name') || params.get('text') || path.match(/\/maps\/(?:place|search)\/([^/]+)/)?.[1]?.replace(/\+/g, ' ') || path.match(/\/link\/(?:map|to)\/([^/,]+)/)?.[1] || searchText;
  // Prefer the place pin to Google Maps' viewport center (@lat,lng).
  const pin = link.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const pair = name.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/) || path.match(/\/link\/(?:map|to)\/[^/,]+,(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) || path.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const lat = Number(pin?.[1] ?? params.get('lat') ?? params.get('y') ?? pair?.[1] ?? NaN);
  const lng = Number(pin?.[2] ?? params.get('lng') ?? params.get('x') ?? pair?.[2] ?? NaN);
  const coordinates = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? `${lat}, ${lng}` : '';
  return { url: link, name: name.slice(0, 200), coordinates, ...(isNaver ? { searchText: searchText.slice(0, 200), placeId, nameIsSearch: Boolean(searchText && name === searchText) } : {}) };
}

export async function resolveMap(value, signal) {
  const info = mapLocation(value);
  if (!info) throw new Error('Paste a Google, Naver or Kakao Maps link.');
  if (info.name || info.coordinates) return info;
  const response = await fetch(`/api/map-location?url=${encodeURIComponent(info.url)}`, { signal });
  if (!response.ok) throw new Error('Location could not be read. Open the map and copy its full place link, or enter the meeting place manually.');
  return response.json();
}

export function locationHtml(info) {
  const label = info.name || info.coordinates;
  return `${info.nameIsSearch ? '<small>검색 위치</small>' : ''}<p data-user-content>${escapeHtml(label || 'Map link saved. Enter the meeting place manually if the location is unavailable.')}</p>${info.coordinates && info.name ? `<small>${escapeHtml(info.coordinates)}</small>` : ''}${info.placeId ? `<small>네이버 장소 ID: ${escapeHtml(info.placeId)}</small>` : ''}<a class="btn btn--ghost" href="${escapeHtml(info.url)}" target="_blank" rel="noopener noreferrer">Open map</a>`;
}
