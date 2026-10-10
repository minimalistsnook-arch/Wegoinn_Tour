import { mapLink, mapLocation } from '../../wegoinn/js/maps.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
export async function onRequestGet({ request }) {
  let url = mapLink(new URL(request.url).searchParams.get('url'));
  if (!url || url.length > 2000) return json({ error: 'Invalid map URL' }, 400);
  try {
    for (let i = 0; i < 6; i++) {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get('location');
        url = next && mapLink(new URL(next, url).href);
        if (!url) return json({ error: 'Unsupported redirect' }, 400);
        continue;
      }
      if (!response.ok) return json({ error: 'Map unavailable' }, 502);
      const info = mapLocation(url);
      // Read only bounded metadata; do not download an entire map application.
      let size = 0;
      let html = '';
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        try {
          while (size < 128000) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.length;
            html += decoder.decode(chunk.value, { stream: true });
          }
        } finally { await reader.cancel(); }
      }
      const title = html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] || html.match(/<title[^>]*>([^<]+)/i)?.[1] || '';
      const clean = title.replace(/\s*[-–|]\s*(Google Maps|네이버 지도|카카오맵).*$/i, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
      if (!info.name && clean && !/^(Google Maps|네이버 지도|카카오맵|NAVER|Google)$/i.test(clean)) info.name = clean.slice(0, 200);
      if (!info.name && !info.coordinates) return json({ error: 'Location unavailable' }, 422);
      return json(info);
    }
    return json({ error: 'Too many redirects' }, 502);
  } catch { return json({ error: 'Map unavailable' }, 502); }
}
