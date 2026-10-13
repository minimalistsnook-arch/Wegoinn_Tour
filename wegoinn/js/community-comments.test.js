import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({rows:[],insert:vi.fn()}));
vi.mock('./supabase.js',()=>({supabase:{from:()=>{
 const chain={};
 for(const op of ['select','eq','order']) chain[op]=()=>chain;
 chain.insert=mock.insert;
 chain.then=(resolve,reject)=>Promise.resolve({data:mock.rows,error:null}).then(resolve,reject);
 return chain;
}},errorMessage:error=>error.message}));
import { mountCommunityComments } from './community-comments.js';
const community={id:'community',creator_id:'host'};
beforeEach(()=>{
 document.body.innerHTML='<section id="comments"></section><div id="toast"></div>';
 mock.rows=[{id:'comment',content:'Staff note <script>',author_id:'operator',is_operator:true,created_at:'2026-10-13T00:00:00Z',author:{nickname:'Staff'}}];
 mock.insert.mockReset();mock.insert.mockResolvedValue({error:null});
});
describe('community operator comments',()=>{
 it('lets an operator leave an escaped comment without providing an author or role',async()=>{
  const root=document.querySelector('#comments');
  await mountCommunityComments(root,community,{id:'operator',role:'admin'});
  expect(root.querySelector('script')).toBeNull();expect(root.textContent).toContain('Staff note <script>');
  expect(root.querySelector('[data-edit-community-comment]')).not.toBeNull();
  const form=root.querySelector('form');form.elements.content.value='Message for the host';
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,10));
  expect(mock.insert).toHaveBeenCalledWith({community_id:'community',content:'Message for the host'});
 });
 it('allows the host to reply but does not expose operator edit buttons',async()=>{
  const root=document.querySelector('#comments');await mountCommunityComments(root,community,{id:'host',role:'guest'});
  expect(root.querySelector('form')).not.toBeNull();
  expect(root.querySelector('[data-edit-community-comment]')).toBeNull();
  expect(root.querySelector('[data-delete-community-comment]')).toBeNull();
 });
 it('allows another guest to read the thread without exposing writing or management controls',async()=>{
  const root=document.querySelector('#comments');await mountCommunityComments(root,community,{id:'visitor',role:'guest'});
  expect(root.textContent).toContain('Staff note');expect(root.querySelector('form')).toBeNull();
  expect(root.querySelector('[data-edit-community-comment]')).toBeNull();
 });
});
