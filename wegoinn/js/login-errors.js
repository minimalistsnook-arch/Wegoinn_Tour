// Keep login failures actionable without displaying credentials or raw error objects.
export function loginErrorMessage(error) {
  const code = String(error?.code || '');
  const raw = String(error?.message || error || '').trim();
  const stage = error?.loginStage;
  let message;
  if (code === 'PGRST202' || /Could not find the function/i.test(raw)) {
    const fn = error?.loginFunction || raw.match(/(?:public\.)?(login_stay_guest|register_stay_guest|set_my_avatar)\b/)?.[1];
    const action = { login_stay_guest: '기존 계정 로그인', register_stay_guest: '숙박 계정 등록', set_my_avatar: '프로필 사진 저장' }[fn] || '로그인';
    message = `${action}을 처리하는 서버 기능이 준비되지 않아 로그인할 수 없습니다. 입력 정보를 바꾸어도 해결되지 않습니다. 관리자에게 ${fn ? `${fn} 함수와 실행 권한` : '로그인 서버 설정'} 확인을 요청해 주세요.`;
  } else if (code === 'anonymous_provider_disabled' || /anonymous.*(disabled|not enabled)/i.test(raw)) {
    message = '서버에서 익명 로그인이 비활성화되어 있습니다. 관리자가 Supabase의 익명 로그인 설정을 활성화해야 합니다.';
  } else if (/체크아웃/.test(raw) && stage !== 'session') {
    // Stay over (date passed, or staff marked the guest "x"): show the reason as is.
    return raw;
  } else if (/수용 인원/.test(raw)) {
    message = '해당 숙박 기간에 객실 수용 인원이 모두 등록되어 새 닉네임을 만들 수 없습니다. 이미 등록한 날짜·객실 번호·닉네임을 입력하면 기존 계정으로 로그인할 수 있습니다.';
  } else if (/Invalid API key|No API key found|Invalid API Key/i.test(raw)) {
    message = '로그인 서버의 연결 키가 없거나 올바르지 않습니다. 관리자에게 서버 연결 설정 확인을 요청해 주세요.';
  } else if (/Failed to fetch|fetch failed|NetworkError|Load failed|timeout|timed out|aborted/i.test(raw)) {
    message = '로그인 서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
  } else if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || error?.status === 429) {
    message = '로그인 서버의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.';
  } else if (code === 'PGRST301' || code === 'bad_jwt' || /JWT.*expired|invalid.*JWT/i.test(raw)) {
    message = '로그인 인증 정보가 만료되었거나 유효하지 않습니다. 페이지를 새로고침한 뒤 다시 로그인해 주세요.';
  } else if (code === '42501' || /permission denied|row-level security/i.test(raw)) {
    message = '서버에 로그인 처리 권한이 설정되지 않았습니다. 관리자에게 로그인 함수의 실행 권한을 확인해 달라고 요청해 주세요.';
  } else if (stage === 'avatar') {
    message = '프로필 사진 저장에 실패했습니다. 다른 사진을 골라 같은 로그인 정보로 다시 시도해 주세요.';
  } else {
    // Preserve useful validation and provider messages, including messages over 120 chars.
    const detail = raw.replace(/Bearer\s+\S+|\b(?:sb_secret_|sb_publishable_|sbp_)[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[인증 정보 숨김]').slice(0, 500);
    const prefix = { session: '로그인 세션 확인 실패', auth: '로그인 인증 실패', profile: '숙박 계정 확인 실패' }[stage];
    message = detail ? (prefix ? `${prefix}: ${detail}` : detail) : '로그인을 완료하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.';
  }
  return code && /^[A-Za-z0-9_]+$/.test(code) ? `${message} (오류 코드: ${code})` : message;
}
