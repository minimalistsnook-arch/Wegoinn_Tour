import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./supabase.js', () => ({ supabase: { rpc:mock.rpc }, errorMessage:e=>e.message }));
import { initOperatorAccounts, loadAccounts } from './operator-accounts.js';
beforeEach(()=>{
 vi.useFakeTimers();mock.rpc.mockReset();
 document.body.innerHTML='<a id="accountsTab" hidden></a><section id="accounts" hidden><button id="refreshAccounts"></button><p id="accountError" hidden></p><div id="accountList"></div></section>';
});
afterEach(()=>vi.useRealTimers());
it('hides account access from ordinary guests and makes no roster request',()=>{
 initOperatorAccounts({id:'guest',role:'guest'});
 expect(document.querySelector('#accountsTab').hidden).toBe(true);expect(mock.rpc).not.toHaveBeenCalled();
});
it('lists dates and activity, protects the current account and shows SQL errors',async()=>{
 mock.rpc.mockResolvedValue({data:[{id:'admin',nickname:'Staff',role:'admin',check_in:'999222',check_out:'999222',is_online:true,stay_active:true},{id:'guest',nickname:'<Guest>',role:'guest',check_in:'2099-10-13',check_out:'2099-10-25',room_number:'701',is_online:false,stay_active:true}]});
 await initOperatorAccounts({id:'admin',role:'admin'});
 expect(document.querySelector('#accountsTab').hidden).toBe(false);
 expect(document.querySelector('[data-delete-account="admin"]').disabled).toBe(true);
 expect(document.querySelector('#accountList').textContent).toContain('2099-10-25');
 expect(document.querySelector('#accountList').textContent).toContain('<Guest>');
 expect(document.querySelector('#accountList').textContent).toContain('접속 중');
 mock.rpc.mockResolvedValue({error:{code:'PGRST202'}});await loadAccounts();
 expect(document.querySelector('#accountError').hidden).toBe(false);
});
it('marks the shared staff room 000 as staff',async()=>{
 mock.rpc.mockResolvedValue({data:[{id:'admin',nickname:'Op',role:'admin'},{id:'staff',nickname:'Mina',role:'guest',room_number:'000',stay_active:true}]});
 await initOperatorAccounts({id:'admin',role:'admin'});
 const row=document.querySelector('[data-delete-account="staff"]').closest('article');
 expect(row.querySelector('.tag').textContent).toBe('Staff 직원');
 expect(row.textContent).toContain('객실 000 (Staff 직원)');
});
