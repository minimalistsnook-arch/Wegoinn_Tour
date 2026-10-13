import { supabase, errorMessage } from './supabase.js';
import { $, toast, setBusy } from './utils.js';
import { detectLanguage } from './translation.js';
import { openSheet, closeSheet } from './sheet.js';

export function moderationError(error) {
  if (['PGRST202', 'PGRST205', '42P01'].includes(error?.code)) return '운영자 관리 기능의 DB 설정이 아직 적용되지 않았습니다. 관리자에게 운영자 권한 SQL 적용을 요청하세요.';
  if (error?.code === '23514') return '내용이 비어 있거나 허용 길이를 넘었습니다. 방명록은 1,000자, 댓글과 채팅은 500자까지 작성할 수 있습니다. 모임 정원은 현재 참가 인원보다 적게 설정할 수 없습니다.';
  return errorMessage(error);
}

let edit = null;
let boundForm = null;
let saving = false;
export function openContentEditor({ me, kind, item, onSaved }) {
  if (me?.role !== 'admin') return toast('운영자만 다른 사람의 내용을 수정할 수 있습니다.', 'error');
  if (saving) return;
  const form = $('#moderationForm');
  if (boundForm !== form) {
    form.addEventListener('submit', saveContent);
    boundForm = form;
  }
  edit = { kind, item, onSaved };
  $('#moderationTitle').textContent = { post: 'Edit post', comment: 'Edit comment', chat: 'Edit message', community_comment: 'Edit comment' }[kind];
  form.elements.content.value = item.content || '';
  form.elements.content.maxLength = kind === 'post' ? 1000 : 500;
  form.elements.remove_image.checked = false;
  $('#moderationImageOption').hidden = kind !== 'post' || !item.image_url;
  $('#moderationError').hidden = true;
  openSheet('moderationSheet');
  form.elements.content.focus();
}

async function saveContent(event) {
  event.preventDefault();
  if (!edit || saving) return;
  const current = edit;
  const form = event.currentTarget;
  const content = form.elements.content.value.trim();
  const removeImage = form.elements.remove_image.checked;
  if (!content && (current.kind !== 'post' || !current.item.image_url || removeImage)) {
    $('#moderationError').textContent = '내용을 입력하세요. 사진도 삭제하려면 방명록 내용을 입력해야 합니다.';
    $('#moderationError').hidden = false;
    return;
  }
  saving = true;
  const button = form.querySelector('[type=submit]');
  setBusy(button, true);
  try {
    const { error } = await supabase.rpc('admin_update_content', {
      p_kind: current.kind, p_id: current.item.id, p_content: content,
      p_original_language: detectLanguage(content), p_remove_image: removeImage,
    });
    if (error) throw error;
    closeSheet('moderationSheet');
    toast('Saved.');
    await current.onSaved?.();
  } catch (error) {
    $('#moderationError').textContent = moderationError(error);
    $('#moderationError').hidden = false;
  } finally {
    saving = false;
    setBusy(button, false);
  }
}
