import { describe, expect, it } from 'vitest';
import { loginErrorMessage } from './login-errors.js';
describe('login error explanations', () => {
 it('explains the missing database function instead of replacing its long error with a generic message', () => {
  const result=loginErrorMessage({code:'PGRST202',message:'Could not find the function public.register_stay_guest(p_check_in, p_check_out, p_nickname, p_room_number) in the schema cache'});
  expect(result).toContain('숙박 계정 등록');expect(result).toContain('register_stay_guest');expect(result).toContain('PGRST202');
 });
 it('identifies the existing-login function instead of blaming registration', () => {
  const result=loginErrorMessage({code:'PGRST202',loginFunction:'login_stay_guest',message:'Missing API function'});
  expect(result).toContain('기존 계정 로그인');
  expect(result).toContain('login_stay_guest');
  expect(result).not.toContain('register_stay_guest');
 });
 it('keeps account mismatch and checkout reasons visible', () => {
  expect(loginErrorMessage({code:'P0001',loginStage:'profile',message:'체크인·체크아웃 날짜와 ID, 객실 번호가 기존 계정과 일치하지 않습니다.'})).toContain('기존 계정과 일치하지 않습니다');
  expect(loginErrorMessage({message:'체크아웃 처리되어 로그인할 수 없습니다.'})).toBe('체크아웃 처리되어 로그인할 수 없습니다.');
  expect(loginErrorMessage({message:'Invalid API key'})).toContain('연결 키');
 });
 it('distinguishes full rooms, disabled anonymous login and network errors', () => {
  expect(loginErrorMessage({message:'해당 숙박 기간의 객실 수용 인원이 마감되었습니다.'})).toContain('기존 계정');
  expect(loginErrorMessage({code:'anonymous_provider_disabled'})).toContain('비활성화');
  expect(loginErrorMessage(new Error('Failed to fetch'))).toContain('인터넷 연결');
 });
 it('retains long errors with their processing stage', () => {
  const detail='Detailed authentication error '.repeat(7);
  expect(loginErrorMessage({loginStage:'auth',message:detail})).toContain(detail.trim());
 });
 it('does not display credentials embedded in an error message', () => {
  const result=loginErrorMessage({message:'Rejected Bearer private-token and sb_secret_privatevalue'});
  expect(result).not.toContain('private-token');expect(result).not.toContain('sb_secret_privatevalue');
 });
});
