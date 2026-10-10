import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/api/translate.js';
const env = { GOOGLE_TRANSLATE_API_KEY:'server-only', SUPABASE_URL:'https://project.supabase.co', SUPABASE_ANON_KEY:'public' };
const request = (body={text:'안녕하세요',target:'en'}, token='Bearer guest') => new Request('https://wegoinn.example/api/translate',{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify(body)});
afterEach(()=>vi.unstubAllGlobals());
describe('authenticated translation endpoint',()=>{
 it('reports disconnected configuration without exposing secrets',async()=>{
   const response=await onRequest({request:new Request('https://wegoinn.example/api/translate'),env:{}});
   expect(await response.json()).toEqual({configured:false});
   expect((await onRequest({request:request(),env:{}})).status).toBe(503);
 });
 it('requires an authenticated, registered guest before translating',async()=>{
   expect((await onRequest({request:request({},''),env})).status).toBe(401);
   vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('[]')));
   expect((await onRequest({request:request(),env})).status).toBe(403);
   expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('validates languages and translates with source-language detection',async()=>{
   const fetchMock=vi.fn().mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('[{"id":"guest"}]')).mockResolvedValueOnce(new Response(JSON.stringify({data:{translations:[{translatedText:'Hello'}]}})));
   vi.stubGlobal('fetch',fetchMock);
   const response=await onRequest({request:request(),env});
   expect(await response.json()).toEqual({translatedText:'Hello'});
   const [url,options]=fetchMock.mock.calls[2];
   expect(url).toContain('translation.googleapis.com');
   expect(JSON.parse(options.body)).toEqual({q:'안녕하세요',target:'en',format:'text'});
 });
 it('keeps provider errors out of the client response',async()=>{
   vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('[{"id":"guest"}]')).mockResolvedValueOnce(new Response('private-provider-diagnostic',{status:500})));
   const response=await onRequest({request:request(),env});
   expect(response.status).toBe(502);
   expect(await response.text()).not.toContain('private-provider');
 });
});
