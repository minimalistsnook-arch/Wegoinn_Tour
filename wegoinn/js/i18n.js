import { isTranslationConfigured, translateText, checkTranslationService } from './translation.js';
// Interface translations are local; guest-written content uses the authenticated API.
const rows = [
['Community creation is temporarily unavailable. Please contact staff.','현재 모임을 만들 수 없습니다. 직원에게 문의해 주세요.','現在コミュニティを作成できません。スタッフにお問い合わせください。','暂时无法创建活动，请联系工作人员。'],
['Mark shown as read','표시된 알림 읽음 처리','表示中の通知を既読にする','将显示的通知标为已读'],['Entering…','입장 중…','ログイン中…','正在进入…'],['Posting…','게시 중…','投稿中…','正在发布…'],['Sending…','전송 중…','送信中…','正在发送…'],['Creating…','저장 중…','保存中…','正在保存…'],
['Stay','머무르기','泊まる','入住'],['Meet','만나기','出会う','相遇'],['Remember','기억하기','思い出','留念'],['for','날짜','日付','日期'],['Sections','메뉴','メニュー','菜单'],
['e.g. AGD12345678','예: AGD12345678','例：AGD12345678','例如：AGD12345678'],['e.g. SunnyMina','예: SunnyMina','例：SunnyMina','例如：SunnyMina'],['e.g. Hongdae Night Walk','예: 홍대 밤 산책','例：弘大ナイトウォーク','例如：弘大夜游'],['e.g. Wegoinn lobby','예: 위고인 로비','例：Wegoinn ロビー','例如：Wegoinn 大堂'],
['Street food, music, and a slow walk around Hongdae…','홍대에서 길거리 음식과 음악, 여유로운 산책…','弘大で屋台グルメ、音楽、ゆっくり散歩…','在弘大品尝街头美食、听音乐、悠闲散步…'],['Anyone who loves meeting new people!','새로운 사람들과 만나는 것을 좋아하는 누구나!','新しい出会いが好きな方ならどなたでも！','欢迎喜欢结识新朋友的任何人！'],
['19:30  Meet at the Wegoinn lobby\n20:00  Walk to Hongdae\n21:00  Dinner together','19:30  위고인 로비에서 만남\n20:00  홍대로 이동\n21:00  함께 저녁 식사','19:30  Wegoinn ロビーに集合\n20:00  弘大へ移動\n21:00  一緒に夕食','19:30  Wegoinn 大堂集合\n20:00  前往弘大\n21:00  一起晚餐'],
['Delete this post?','게시글을 삭제할까요?','投稿を削除しますか？','删除此留言吗？'],['Delete this comment? Replies to it will be removed too.','댓글을 삭제할까요? 답글도 함께 삭제됩니다.','コメントを削除しますか？返信も削除されます。','删除此评论吗？回复也会一并删除。'],
['Please enter your reservation number and nickname.','예약번호와 닉네임을 입력하세요.','予約番号とニックネームを入力してください。','请输入预订编号和昵称。'],['Maximum participants must be 1 – 30.','최대 참가 인원은 1~30명입니다.','定員は1〜30人です。','最多参加人数应为1至30人。'],['Please enter the fee in KRW.','참가비를 원화로 입력하세요.','参加費を韓国ウォンで入力してください。','请以韩元输入参加费。'],['This community is already full.','모임 정원이 마감되었습니다.','このコミュニティは満員です。','活动人数已满。'],['You already sent a request.','이미 신청한 모임입니다.','すでに申請済みです。','你已经提交过申请。'],['No active application to withdraw','철회할 신청이 없습니다','取り下げ可能な申請がありません','没有可撤回的申请'],['Post deleted.','게시글을 삭제했습니다.','投稿を削除しました。','留言已删除。'],['Comment deleted.','댓글을 삭제했습니다.','コメントを削除しました。','评论已删除。'],['Your moment is on the wall ✨','이야기를 게시했습니다 ✨','投稿しました ✨','已发布留言 ✨'],['Write something or add a photo first.','내용을 입력하거나 사진을 추가하세요.','文章または写真を追加してください。','请先填写内容或添加照片。'],
['Content translation failed. Original text is shown.','게시글 번역에 실패해 원문을 표시합니다.','投稿の翻訳に失敗したため原文を表示します。','内容翻译失败，正在显示原文。'],
['Delete','삭제','削除','删除'],['Send','보내기','送信','发送'],['Comments','댓글','コメント','评论'],['No comments yet — say hello ✨','아직 댓글이 없습니다. 인사를 남겨보세요 ✨','コメントはまだありません。挨拶しましょう ✨','暂无评论，打个招呼吧 ✨'],
['Language','언어','言語','语言'],['Guestbook & Community','방명록과 모임','ゲストブック＆コミュニティ','留言簿与活动'],
['Guestbook','방명록','ゲストブック','留言簿'],['Community','모임','コミュニティ','活动'],['Notifications','알림','通知','通知'],['Log out','로그아웃','ログアウト','退出登录'],
['Welcome in','환영합니다','ようこそ','欢迎'],['Reservation Name or Number','예약자 이름 또는 예약번호','予約者名または予約番号','预订人姓名或预订编号'],['Enter the name or number on your reservation, then choose a nickname for the guestbook.','예약자 이름 또는 예약번호를 입력하고 방명록에서 사용할 닉네임을 정하세요.','予約者名または予約番号を入力し、ゲストブック用のニックネームを決めてください。','请输入预订人姓名或预订编号，并选择留言簿昵称。'],['Profile Photo','프로필 사진','プロフィール写真','头像'],['Choose profile photo','프로필 사진 선택','プロフィール写真を選択','选择头像'],['(optional)','(선택)','(任意)','（可选）'],['Remove photo','사진 삭제','写真を削除','移除照片'],['A face photo shown in a circle next to your nickname.','닉네임 옆에 동그랗게 표시되는 얼굴 사진입니다.','ニックネームの横に丸く表示される顔写真です。','显示在昵称旁的圆形头像照片。'],['Your reservation name or number is never shown to other guests.','예약자 이름과 예약번호는 다른 투숙객에게 공개되지 않습니다.','予約者名・予約番号は他のゲストには表示されません。','预订人姓名或编号不会向其他住客公开。'],['Please enter the reservation name or number and a nickname.','예약자 이름 또는 예약번호와 닉네임을 입력하세요.','予約者名または予約番号とニックネームを入力してください。','请输入预订人姓名或预订编号以及昵称。'],['Reservation Number','예약번호','予約番号','预订编号'],['English Nickname','영문 닉네임','英語のニックネーム','英文昵称'],['ENTER','입장','入る','进入'],
['Check in with your reservation and choose a nickname for the guestbook.','예약번호와 방명록에서 사용할 닉네임을 입력하세요.','予約番号とニックネームを入力してください。','请输入预订编号并选择留言簿昵称。'],
['English letters & numbers · this is the only name other guests see.','영문과 숫자 · 다른 투숙객에게는 이 이름만 보입니다.','英字と数字 · 他のゲストにはこの名前だけが表示されます。','英文字母和数字 · 其他住客只能看到此昵称。'],
['Your reservation number is never shown to other guests.','예약번호는 다른 투숙객에게 공개되지 않습니다.','予約番号は他のゲストには表示されません。','预订编号不会向其他住客公开。'],
['Welcome home','어서 오세요','おかえりなさい','欢迎回来'],['Hello,','안녕하세요,','こんにちは、','你好，'],['traveler','여행자','旅人','旅行者'],
['Share a little moment from your stay — and find people to explore Seoul with.','여행의 추억을 나누고 서울을 함께 둘러볼 친구를 만나세요.','旅の思い出を共有し、一緒にソウルを楽しむ仲間を見つけましょう。','分享旅途点滴，寻找一起探索首尔的伙伴。'],
['01 — Community Calendar','01 — 모임 달력','01 — コミュニティカレンダー','01 — 活动日历'],['02 — Wegoinn Guestbook','02 — 위고인 방명록','02 — Wegoinn ゲストブック','02 — Wegoinn 留言簿'],['Calendar','달력','カレンダー','日历'],['Wegoinn Guestbook','위고인 방명록','Wegoinn ゲストブック','Wegoinn 留言簿'],['Community Calendar','모임 달력','コミュニティカレンダー','活动日历'],
['Photo','사진','写真','照片'],['POST','게시','投稿','发布'],['Load more','더 보기','もっと見る','加载更多'],['Original','원문','原文','原文'],['Translated','번역','翻訳','译文'],['you','나','あなた','你'],['Reply','답글','返信','回复'],['REPLY','답글','返信','回复'],['Cancel','취소','キャンセル','取消'],['SEND','보내기','送信','发送'],['COMMENT','댓글','コメント','评论'],
['Leave a note, a tip, a memory…','이야기, 여행 팁, 추억을 남겨보세요…','メモ、旅のヒント、思い出を残しましょう…','留下故事、旅行建议或回忆…'],['Write a comment…','댓글을 입력하세요…','コメントを書く…','写下评论…'],['Write a reply…','답글을 입력하세요…','返信を書く…','写下回复…'],
['My communities','내 모임','自分のコミュニティ','我的活动'],['Hosting, applications and history · All times KST (UTC+9)','주최·신청·지난 모임 · 모든 시간은 한국 시간(UTC+9)','主催・申請・履歴 · すべて韓国時間 (UTC+9)','发起、申请与历史 · 所有时间为韩国时间 (UTC+9)'],
['No communities yet.','아직 내 모임이 없습니다.','コミュニティはまだありません。','暂无活动。'],['Selected date','선택한 날짜','選択した日付','所选日期'],['A community is planned','모임이 있는 날','予定がある日','有活动安排'],['Nothing planned yet','아직 예정된 모임이 없습니다','予定はまだありません','暂无活动安排'],['No communities on this day','이 날에는 모임이 없습니다','この日にコミュニティはありません','当天没有活动'],
['Pick another date to see what\'s happening.','다른 날짜의 모임을 확인해 보세요.','別の日付の予定を見てみましょう。','请选择其他日期查看活动。'],['Be the one who brings everyone together.','첫 모임을 직접 만들어 보세요.','仲間が集まるコミュニティを作りましょう。','创建活动，召集大家吧。'],
['CREATE COMMUNITY','모임 만들기','コミュニティを作成','创建活动'],['Create Community','모임 만들기','コミュニティを作成','创建活动'],['Host your own activity','직접 모임을 열어보세요','自分のイベントを主催','发起自己的活动'],['Create','만들기','作成','创建'],['Date','날짜','日付','日期'],['Time','시간','時間','时间'],['Time · KST (UTC+9)','시간 · 한국 시간(UTC+9)','時間 · 韓国時間 (UTC+9)','时间 · 韩国时间 (UTC+9)'],
['Community Name','모임 이름','コミュニティ名','活动名称'],['Activity · What are you going to do?','활동 · 무엇을 할 예정인가요?','活動 · 何をしますか？','活动 · 计划做什么？'],['What kind of people would you like to join?','어떤 사람들과 함께하고 싶나요?','どんな人に参加してほしいですか？','希望哪些人参加？'],['Activity Schedule / Plan','활동 일정 / 계획','活動スケジュール / 計画','活动日程 / 计划'],['Maximum Participants','최대 참가 인원','最大参加人数','最多参加人数'],['1 – 30 people','1~30명','1〜30人','1至30人'],['Participation Fee','참가비','参加費','参加费'],['FREE','무료','無料','免费'],['PAID','유료','有料','收费'],['KRW','원','ウォン','韩元'],
['For information only — guests pay the host directly, not in this app.','참가비 안내용입니다. 결제는 주최자에게 직접 합니다.','料金の案内です。主催者に直接お支払いください。','费用仅供参考，请直接向发起人支付。'],['Only Wegoinn staff can see this. Other guests never will.','위고인 직원만 확인할 수 있습니다. 다른 투숙객에게는 공개되지 않습니다.','スタッフのみ確認できます。他のゲストには公開されません。','仅工作人员可见，不向其他住客公开。'],
['Meeting place','만남 장소','集合場所','集合地点'],['Map link','지도 링크','地図リンク','地图链接'],['Paste a Google, Naver or Kakao Maps HTTPS link.','구글·네이버·카카오 지도의 HTTPS 링크를 붙여넣으세요.','Google・Naver・Kakao Maps の HTTPS リンクを貼り付けてください。','请粘贴 Google、Naver 或 Kakao 地图的 HTTPS 链接。'],['Paste a Google, Naver or Kakao Maps share link. The location appears below.','구글·네이버·카카오 지도 링크를 붙여넣으면 아래에 위치가 표시됩니다.','Google・Naver・Kakao Maps の共有リンクを貼り付けると位置が表示されます。','粘贴 Google、Naver 或 Kakao 地图分享链接，位置将显示在下方。'],['Paste a Google, Naver or Kakao Maps link.','구글·네이버·카카오 지도 링크를 입력하세요.','Google・Naver・Kakao Maps のリンクを入力してください。','请输入 Google、Naver 或 Kakao 地图链接。'],['Open map','지도 열기','地図を開く','打开地图'],['Not specified','미지정','未指定','未指定'],
['VIEW','상세 보기','詳細','查看'],['JOIN','신청','参加申請','申请'],['MANAGE','관리','管理','管理'],['Hosting','주최','主催','我发起的'],['Past','지난 모임','過去','已开始'],['Cancelled','취소됨','中止','已取消'],['CANCELLED','취소됨','中止','已取消'],['PAST · READ ONLY','지난 모임 · 열람만 가능','過去 · 閲覧のみ','已开始 · 仅可查看'],['FULL','정원 마감','満員','已满'],['PENDING','승인 대기','承認待ち','待审核'],['APPROVED','승인됨','承認済み','已批准'],['DECLINED','거절됨','却下','已拒绝'],['WITHDRAWN','철회됨','取り下げ済み','已撤回'],['pending','승인 대기','承認待ち','待审核'],['approved','승인됨','承認済み','已批准'],['declined','거절됨','却下','已拒绝'],['withdrawn','철회됨','取り下げ済み','已撤回'],
['What we\'ll do','함께할 활동','活動内容','活动内容'],['Who we\'d love to meet','함께하고 싶은 사람들','参加してほしい方','希望参与的人'],['Plan','일정','予定','计划'],['Fee','참가비','参加費','费用'],['The fee is paid directly to the host — not through this app.','참가비는 주최자에게 직접 지급합니다.','参加費は主催者に直接お支払いください。','参加费请直接向发起人支付。'],
['Edit community','모임 수정','コミュニティを編集','编辑活动'],['Cancel community','모임 취소','コミュニティを中止','取消活动'],['Withdraw application','신청 철회','申請を取り下げる','撤回申请'],['Save changes','변경 저장','変更を保存','保存修改'],['This community was cancelled. History is preserved.','취소된 모임입니다. 이력은 유지됩니다.','中止されたコミュニティです。履歴は保存されています。','活动已取消，历史记录已保留。'],['This community has started. History is read-only.','시작된 모임입니다. 이력만 조회할 수 있습니다.','開始済みです。履歴のみ閲覧できます。','活动已开始，仅可查看历史记录。'],['This community is read-only','이 모임은 조회만 가능합니다','このコミュニティは閲覧のみです','此活动仅可查看'],
['Only you can see this','나에게만 보입니다','自分だけに表示されます','仅自己可见'],['Manage your community','내 모임 관리','コミュニティの管理','管理我的活动'],['Approved','승인됨','承認済み','已批准'],['Pending','대기 중','承認待ち','待审核'],['Max','최대 인원','定員','人数上限'],['Applicants','신청자','申請者','申请人'],['APPROVE','승인','承認','批准'],['DECLINE','거절','却下','拒绝'],['You\'ve reached the maximum — no more approvals possible.','정원에 도달하여 더 승인할 수 없습니다.','定員に達したため、追加承認はできません。','已达到人数上限，无法继续批准。'],['No requests yet. Share the word in the guestbook!','아직 신청자가 없습니다. 방명록에 모임을 알려보세요!','申請はまだありません。ゲストブックで紹介しましょう！','暂无申请，请在留言簿介绍活动！'],
['Notifications are saved here. Push notifications while the site is closed are not connected.','알림은 여기에 저장됩니다. 사이트를 닫았을 때의 푸시 알림은 아직 연결되지 않았습니다.','通知はここに保存されます。サイトを閉じた際のプッシュ通知は未接続です。','通知保存在这里，关闭网站后的推送通知尚未连接。'],['Mark all as read','모두 읽음 처리','すべて既読にする','全部标为已读'],['No notifications yet.','아직 알림이 없습니다.','通知はまだありません。','暂无通知。'],['New application','새 참가 신청','新しい参加申請','新的参加申请'],['Application approved','신청이 승인되었습니다','申請が承認されました','申请已批准'],['Application declined','신청이 거절되었습니다','申請が却下されました','申请已拒绝'],['Application withdrawn','신청이 철회되었습니다','申請が取り下げられました','申请已撤回'],['Community updated','모임이 수정되었습니다','コミュニティが変更されました','活动已修改'],['Community cancelled','모임이 취소되었습니다','コミュニティが中止されました','活动已取消'],
['The guestbook is waiting for you','첫 방명록을 기다리고 있어요','最初の投稿をお待ちしています','留言簿等待你的分享'],['Be the first to leave a little note for the next traveler.','다음 여행자를 위해 첫 이야기를 남겨보세요.','次の旅人のために最初のメッセージを残しましょう。','为下一位旅行者留下第一条留言吧。'],['Hostel guestbook & community · Seoul','호스텔 방명록과 모임 · 서울','ホステルのゲストブック＆コミュニティ · ソウル','旅舍留言簿与活动 · 首尔'],
['Sun','일','日','日'],['Mon','월','月','一'],['Tue','화','火','二'],['Wed','수','水','三'],['Thu','목','木','四'],['Fri','금','金','五'],['Sat','토','土','六'],
['Please fill in every field.','필수 항목을 모두 입력하세요.','必須項目を入力してください。','请填写所有必填项。'],['Please enter a valid HTTPS map link.','올바른 HTTPS 지도 링크를 입력하세요.','有効な HTTPS 地図リンクを入力してください。','请输入有效的 HTTPS 地图链接。'],['Choose a future start time (KST)','한국 시간 기준 미래의 시작 시간을 선택하세요','韓国時間で未来の開始時刻を選択してください','请选择韩国时间的未来开始时间'],['Saved. History is preserved.','저장되었습니다. 이력은 유지됩니다.','保存しました。履歴は保持されます。','已保存，历史记录已保留。'],['Community updated.','모임을 수정했습니다.','コミュニティを更新しました。','活动已更新。'],['Your community is live 🎉','모임을 만들었습니다 🎉','コミュニティを作成しました 🎉','活动已创建 🎉'],['Request sent! The host will review it soon.','신청했습니다! 주최자의 승인을 기다려주세요.','申請しました！主催者の承認をお待ちください。','申请已发送，请等待发起人审核。'],['Approved — welcome aboard!','승인했습니다! 환영합니다.','承認しました！ようこそ。','已批准，欢迎加入！'],['Request declined.','신청을 거절했습니다.','申請を却下しました。','已拒绝申请。'],
['Cancel this community? History will be preserved.','모임을 취소할까요? 이력은 유지됩니다.','コミュニティを中止しますか？履歴は保存されます。','取消此活动吗？历史记录会保留。'],['Withdraw your application?','신청을 철회할까요?','申請を取り下げますか？','撤回申请吗？'],
['Chat','채팅','チャット','聊天'],['Live','실시간','リアルタイム','实时'],['03 — Live Chat','03 — 실시간 채팅','03 — リアルタイムチャット','03 — 实时聊天'],['Global Chat','전체 채팅','全体チャット','公共聊天'],['Everyone at Wegoinn','위고인 투숙객 모두','Wegoinn のみんな','Wegoinn 的所有人'],['Group chat','모임 채팅','グループチャット','活动群聊'],['online now','명 접속 중','人がオンライン','人在线'],['Type a message…','메시지를 입력해 보세요…','メッセージを入力…','输入消息…'],['No messages yet — say hello 👋','아직 메시지가 없습니다. 먼저 인사해 보세요 👋','まだメッセージはありません。挨拶してみましょう 👋','还没有消息，先打个招呼吧 👋'],['Delete this message?','메시지를 삭제할까요?','メッセージを削除しますか？','删除此消息吗？'],['Delete message','메시지 삭제','メッセージを削除','删除消息'],['Open group chat','모임 채팅 열기','グループチャットを開く','打开活动群聊'],['Messages could not be loaded.','메시지를 불러오지 못했습니다.','メッセージを読み込めませんでした。','无法加载消息。'],["You're sending messages too fast. Please wait a moment.",'메시지를 너무 빨리 보내고 있어요. 잠시 후 다시 시도하세요.','送信が速すぎます。少し待ってから送ってください。','发送过快，请稍后再试。'],
['Previous month','이전 달','前の月','上个月'],['Next month','다음 달','次の月','下个月'],['Close','닫기','閉じる','关闭'],['Remove photo','사진 제거','写真を削除','移除照片'],['Write a post','게시글 작성','投稿を書く','写留言'],['Delete post','게시글 삭제','投稿を削除','删除留言'],
];
const languages = ['en','ko','ja','zh'];
const dictionary = new Map(rows.map(row => [row[0], row]));
let language = 'en';
export const siteLanguage = () => language;
export function t(value) {
  if (language === 'en') return value;
  const hit = dictionary.get(value);
  if (hit) return hit[languages.indexOf(language)];
  const count = value.match(/^(\d+) (stories|story|communities|community|comments|comment)$/);
  if (count) {
    const unit = /stor/.test(count[2]) ? ['개 이야기','件の投稿','条留言'] : /communit/.test(count[2]) ? ['개 모임','件のコミュニティ','个活动'] : ['개 댓글','件のコメント','条评论'];
    return `${count[1]} ${unit[languages.indexOf(language)-1]}`;
  }
  if (value.startsWith('Reply to ')) return ({ko:'답글: ',ja:'返信先: ',zh:'回复：'})[language] + value.slice(9);
  if (value.startsWith('hosted by ')) return ({ko:'주최: ',ja:'主催: ',zh:'发起人：'})[language] + value.slice(10);
  if (value.startsWith('for ')) return ({ko:'날짜: ',ja:'日付: ',zh:'日期：'})[language] + value.slice(4);
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const month = months.indexOf(value);
  if (month >= 0) return language === 'ko' ? `${month+1}월` : `${month+1}月`;
  return value;
}
const originals = new WeakMap();
const attributes = new WeakMap();
let contentJobs = new WeakMap();
let contentQueue = [];
let running = 0;
let revision = 0;
function pump() {
  while (running < 3 && contentQueue.length) {
    const job = contentQueue.shift();
    if (job.version !== revision || !job.el.isConnected) continue;
    running++;
    translateText(job.original, job.language).then(result => {
      if (result && job.version === revision && job.el.isConnected) {
        job.el.textContent = result;
        job.el.dataset.siteTranslated = 'true';
      }
    }).catch(() => {
      if (job.version === revision && job.el.isConnected) { job.el.textContent = job.original; delete job.el.dataset.siteTranslated; }
      if (job.version === revision) document.getElementById('translationStatus').textContent = t('Content translation failed. Original text is shown.');
      // Keep the failed job recorded; retry on an explicit language change.
    }).finally(() => { running--; pump(); });
  }
}
function applyLanguage() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,textarea,select,[data-user-content],.js-text,.avatar,#headerNickname,#greetingName,.post__who strong,.comment__head strong,.chat-msg__meta strong,.applicant__name,.detail-host,#translationStatus,code')) continue;
    const current = node.textContent;
    const stored = originals.get(node);
    const original = stored && stored.rendered === current ? stored.original : current;
    const trimmed = original.trim();
    const rendered = trimmed ? original.replace(trimmed, t(trimmed)) : original;
    originals.set(node, {original, rendered});
    if (current !== rendered) node.textContent = rendered;
  }
  document.querySelectorAll('[placeholder],[aria-label]').forEach(el => {
    let saved = attributes.get(el); if (!saved) { saved = {}; attributes.set(el,saved); }
    for (const name of ['placeholder','aria-label']) {
      if (!el.hasAttribute(name)) continue;
      const current = el.getAttribute(name), old = saved[name];
      const original = old && old.rendered === current ? old.original : current;
      const rendered = t(original); saved[name] = {original,rendered};
      if (current !== rendered) el.setAttribute(name,rendered);
    }
  });
  document.querySelectorAll('[data-user-content],.js-text').forEach(el => {
    const original = el.dataset.original ?? el.dataset.siteOriginal ?? el.textContent;
    el.dataset.siteOriginal = original;
    if (!isTranslationConfigured()) {
      if (el.dataset.siteTranslated === 'true') { el.textContent = original; delete el.dataset.siteTranslated; }
      return;
    }
    if (el.dataset.translationMode === "original") return;
    if (contentJobs.get(el) === `${language}:${original}`) return;
    if (el.dataset.siteTranslated === "true") { el.textContent = original; delete el.dataset.siteTranslated; }
    contentJobs.set(el,`${language}:${original}`);
    contentQueue.push({el,original,language,version:revision});
  });
  pump();
}
export function initSiteLanguage() {
  const select = document.getElementById('siteLanguage');
  const choose = value => {
    language = languages.includes(value) ? value : 'en';
    document.querySelectorAll("[data-translation-mode]").forEach(el => delete el.dataset.translationMode);
    revision++; contentQueue = []; contentJobs = new WeakMap();
    document.documentElement.lang = language;
    localStorage.setItem('wegoinn-language',language);
    select.value = language;
    document.getElementById('translationStatus').textContent = language !== 'en' && !isTranslationConfigured()
      ? ({ko:'화면 번역 사용 중 · 게시글 번역은 API 연결이 필요합니다.',ja:'画面翻訳中 · 投稿の翻訳には API 接続が必要です。',zh:'界面已翻译，用户内容翻译需要连接 API。'})[language] : '';
    applyLanguage();
    document.dispatchEvent(new CustomEvent('site-language-change'));
  };
  choose(localStorage.getItem('wegoinn-language') || 'en');
  checkTranslationService().then(() => choose(language));
  select.addEventListener('change',()=>choose(select.value));
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; applyLanguage(); });
  }).observe(document.body,{childList:true,characterData:true,subtree:true});
  // Translate native confirmations as well as the document.
  const confirmOriginal = window.confirm.bind(window);
  window.confirm = message => confirmOriginal(t(message));
}
