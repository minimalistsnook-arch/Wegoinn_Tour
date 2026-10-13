import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('./operator-accounts.js', () => ({ accountSummary: () => 'Guest · Check in 2099-10-13 · Check out 2099-10-25' }));
import { installOperatorLongPress } from './operator-longpress.js';
function pointer(el, type, x=0, y=0, pointerType='touch') {
 const e = new Event(type, { bubbles: true });
 Object.assign(e,{clientX:x,clientY:y,pointerType,isPrimary:true}); el.dispatchEvent(e);
}
let root, row, edit, remove;
beforeEach(() => {
 vi.useFakeTimers();
 document.body.innerHTML='<div id="root"><article class="item">Content</article></div><div id="operatorActionsSheet" hidden><div class="sheet__panel"><p data-operator-summary></p><button data-operator-edit></button><button data-operator-delete></button></div></div>';
 root=document.querySelector('#root'); row=root.firstElementChild; edit=vi.fn(); remove=vi.fn();
});
afterEach(() => { installOperatorLongPress(root,{},'.item',()=>{}); vi.useRealTimers(); });
it('opens edit and delete menu after a mobile hold',()=>{
 installOperatorLongPress(root,{role:'admin'},'.item',()=>({edit,delete:remove,authorId:'guest'}));
 pointer(row,'pointerdown');vi.advanceTimersByTime(549);
 expect(document.querySelector('#operatorActionsSheet').hidden).toBe(true);
 vi.advanceTimersByTime(1);
 expect(document.querySelector('#operatorActionsSheet').hidden).toBe(false);
 document.querySelector('[data-operator-edit]').click();expect(edit).toHaveBeenCalledOnce();
});
it('cancels when scrolling or releasing and ignores desktop or guest holds',()=>{
 installOperatorLongPress(root,{role:'admin'},'.item',()=>({edit,delete:remove}));
 pointer(row,'pointerdown');pointer(row,'pointermove',20);vi.advanceTimersByTime(600);
 expect(document.querySelector('#operatorActionsSheet').hidden).toBe(true);
 pointer(row,'pointerdown');pointer(row,'pointerup');vi.advanceTimersByTime(600);
 expect(document.querySelector('#operatorActionsSheet').hidden).toBe(true);
 pointer(row,'pointerdown',0,0,'mouse');vi.advanceTimersByTime(600);
 expect(document.querySelector('#operatorActionsSheet').hidden).toBe(true);
 installOperatorLongPress(root,{role:'guest'},'.item',()=>({edit,delete:remove}));
 pointer(row,'pointerdown');vi.advanceTimersByTime(600);
 expect(document.querySelector('#operatorActionsSheet').hidden).toBe(true);
});
