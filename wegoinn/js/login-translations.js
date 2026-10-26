// Bundled login guidance works before authentication and without the translation API.
export const loginTranslations = [
["Cannot connect to the login server. Check your internet connection and try again.", "로그인 서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.", "ログインサーバーに接続できません。通信環境を確認して再試行してください。", "无法连接登录服务器，请检查网络后重试。"],
["This room is full for these dates. To return to your account, enter your original stay dates, room number and nickname.", "해당 숙박 기간에 객실 수용 인원이 모두 등록되어 새 닉네임을 만들 수 없습니다. 이미 등록한 날짜·객실 번호·닉네임을 입력하면 기존 계정으로 로그인할 수 있습니다.", "この宿泊期間の部屋は定員に達しています。既存の宿泊日・部屋番号・ニックネームで再ログインしてください。", "该住宿期间房间名额已满。请使用原来的住宿日期、房间号和昵称登录已有账号。"],
["Could not save your profile photo. Choose another photo and try again with the same login details.", "프로필 사진 저장에 실패했습니다. 다른 사진을 골라 같은 로그인 정보로 다시 시도해 주세요.", "写真を保存できませんでした。別の写真を選び、同じログイン情報で再試行してください。", "头像保存失败，请选择其他照片并使用相同登录信息重试。"],
["Could not complete sign in. Refresh the page and try again.", "로그인을 완료하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.", "ログインできませんでした。ページを更新して再試行してください。", "无法完成登录，请刷新页面后重试。"],
['Enter dates as YYYY-MM-DD or YY.MM.DD.','날짜를 YYYY-MM-DD 또는 YY.MM.DD 형식으로 입력하세요.','日付は YYYY-MM-DD または YY.MM.DD 形式で入力してください。','请以 YYYY-MM-DD 或 YY.MM.DD 格式输入日期。'],
['Enter a valid date.','올바른 날짜를 입력하세요.','有効な日付を入力してください。','请输入有效日期。'],
['Check in date:','체크인 날짜:','チェックイン日：','入住日期：'],
['Check out date:','체크아웃 날짜:','チェックアウト日：','退房日期：'],
['Enter a nickname of 1–20 characters.','닉네임은 1~20자로 입력하세요.','ニックネームは1〜20文字で入力してください。','请输入1至20个字符的昵称。'],
['Enter your room number.','객실 번호를 입력하세요.','部屋番号を入力してください。','请输入房间号。'],
['Enter a registered room number.','등록된 객실 번호를 입력하세요.','登録された部屋番号を入力してください。','请输入已登记的房间号。'],
['Check out must be after check in.','체크아웃 날짜는 체크인 날짜보다 이후여야 합니다.','チェックアウト日はチェックイン日より後にしてください。','退房日期必须晚于入住日期。'],
['Check out must be after check in.','체크아웃은 체크인 이후여야 합니다.','チェックアウト日はチェックイン日より後にしてください。','退房日期必须晚于入住日期。'],
['Add a profile photo. Any photo is fine.','프로필 사진을 추가해 주세요. 아무 사진이나 괜찮습니다.','プロフィール写真を追加してください。どんな写真でも構いません。','请添加头像，任意照片均可。'],
['Check your check in and check out dates, nickname and room number.','체크인·체크아웃 날짜와 ID, 객실 번호를 확인해 주세요.','宿泊日・ニックネーム・部屋番号を確認してください。','请确认入住退房日期、昵称和房间号。'],
['Your stay dates, nickname and room number do not match an existing account. Add a photo if this is your first visit.','체크인·체크아웃 날짜와 ID, 객실 번호가 기존 계정과 일치하지 않습니다. 처음 가입하는 경우 사진을 추가해 주세요.','宿泊日・ニックネーム・部屋番号が既存のアカウントと一致しません。初めての方は写真を追加してください。','入住退房日期、昵称和房间号与已有账号不符。首次注册请添加照片。'],
['You cannot sign in because you have checked out or your stay has ended.','체크아웃 처리되었거나 숙박 기간이 종료되어 로그인할 수 없습니다.','チェックアウト済み、または宿泊期間が終了したためログインできません。','您已退房或住宿已结束，无法登录。'],
['Guests who have checked out cannot sign in again.','체크아웃 처리된 손님은 다시 로그인할 수 없습니다.','チェックアウト済みの方は再ログインできません。','已退房的住客无法再次登录。'],
['Staff sign in requires 999222 in both date fields.','운영자 로그인은 체크인과 체크아웃 날짜에 모두 999222를 입력해야 합니다.','スタッフは両方の日付欄に999222を入力してください。','员工登录须在两个日期栏均输入999222。'],
['Login session check failed','로그인 세션 확인 실패','ログインセッションの確認に失敗しました','登录会话验证失败'],
['Authentication failed','로그인 인증 실패','ログイン認証に失敗しました','登录认证失败'],
['Stay account check failed','숙박 계정 확인 실패','宿泊アカウントの確認に失敗しました','住宿账号验证失败'],
['Error code:','오류 코드:','エラーコード：','错误代码：'],
];

export function translateLoginMessage(message, language) {
  const index = ['en', 'ko', 'ja', 'zh'].indexOf(language);
  if (index < 0) return message;
  let result = message;
  const replacements = loginTranslations.flatMap(row => row.map(source => ({ source, target: row[index] })));
  replacements.sort((a, b) => b.source.length - a.source.length);
  const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const targets = new Map(replacements.map(({ source, target }) => [source, target]));
  return result.replace(new RegExp([...targets.keys()].map(escaped).join('|'), 'g'), source => targets.get(source));
}
