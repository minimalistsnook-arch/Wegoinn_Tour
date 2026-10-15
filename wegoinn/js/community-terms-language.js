import { ORIGINAL_TERMS, ORIGINAL_TERMS_TRANSLATIONS } from './community-terms-translations.js';
import { checkTranslationService, translateText } from './translation.js';

export const TERMS_LANGUAGES = [
 ['ko','한국어 · 대한민국'], ['en','English · United States'], ['ja','日本語 · 日本'],
 ['zh','中文 · 中国'], ['es','Español · España'], ['fr','Français · France'],
 ['de','Deutsch · Deutschland'], ['ru','Русский · Россия'], ['vi','Tiếng Việt · Việt Nam'], ['th','ไทย · ประเทศไทย'],
];
// title, agreement, confirm, logout, read-all hint, loading, failure, retry
const copy = {
 ko:['커뮤니티 이용 안내','위 안내사항을 모두 확인했으며 이용에 동의합니다.','동의하고 시작하기','로그아웃','안내 끝까지 내려 모든 내용을 확인해 주세요.','안내를 번역하는 중…','안내를 불러오거나 번역하지 못했습니다. 다시 시도해 주세요.','다시 불러오기'],
 en:['Community guidelines','I have read all the guidelines above and agree.','Agree and get started','Log out','Scroll to the end to review all the guidelines.','Translating the guidelines…','Could not load or translate the guidelines. Please try again.','Try again'],
 ja:['コミュニティ利用案内','上記の案内をすべて確認し、同意します。','同意して始める','ログアウト','最後までスクロールし、すべての案内をご確認ください。','案内を翻訳しています…','案内の読み込み、または翻訳に失敗しました。もう一度お試しください。','再試行'],
 zh:['社区使用指南','我已阅读以上全部指南并同意。','同意并开始','退出登录','请滚动到末尾，阅读全部指南。','正在翻译指南…','无法加载或翻译指南，请重试。','重试'],
 es:['Normas de la comunidad','He leído todas las normas anteriores y las acepto.','Aceptar y comenzar','Cerrar sesión','Desplázate hasta el final para leer todas las normas.','Traduciendo las normas…','No se pudieron cargar o traducir las normas. Inténtalo de nuevo.','Reintentar'],
 fr:['Règles de la communauté','J’ai lu toutes les règles ci-dessus et je les accepte.','Accepter et commencer','Se déconnecter','Faites défiler jusqu’à la fin pour lire toutes les règles.','Traduction des règles…','Impossible de charger ou de traduire les règles. Veuillez réessayer.','Réessayer'],
 de:['Community-Richtlinien','Ich habe alle obigen Richtlinien gelesen und stimme zu.','Zustimmen und starten','Abmelden','Bitte bis zum Ende scrollen und alle Richtlinien lesen.','Richtlinien werden übersetzt…','Die Richtlinien konnten nicht geladen oder übersetzt werden. Bitte erneut versuchen.','Erneut versuchen'],
 ru:['Правила сообщества','Я прочитал(а) все правила выше и согласен(на) с ними.','Согласиться и начать','Выйти','Прокрутите до конца и ознакомьтесь со всеми правилами.','Перевод правил…','Не удалось загрузить или перевести правила. Попробуйте снова.','Повторить'],
 vi:['Hướng dẫn cộng đồng','Tôi đã đọc toàn bộ hướng dẫn ở trên và đồng ý.','Đồng ý và bắt đầu','Đăng xuất','Cuộn đến cuối để đọc toàn bộ hướng dẫn.','Đang dịch hướng dẫn…','Không thể tải hoặc dịch hướng dẫn. Vui lòng thử lại.','Thử lại'],
 th:['แนวทางการใช้ชุมชน','ฉันได้อ่านแนวทางทั้งหมดข้างต้นและยอมรับแล้ว','ยอมรับและเริ่มใช้งาน','ออกจากระบบ','เลื่อนไปจนสุดเพื่ออ่านแนวทางทั้งหมด','กำลังแปลแนวทาง…','ไม่สามารถโหลดหรือแปลแนวทางได้ โปรดลองอีกครั้ง','ลองอีกครั้ง'],
};
export const termsCopy = language => copy[language] || copy.ko;

// Keep every character and paragraph, including notices edited up to 30,000 characters.
export function splitTermsForTranslation(text, limit = 1800) {
 const chunks = [];
 let rest = text;
 while (rest.length > limit) {
  let end = rest.lastIndexOf('\n', limit - 1);
  if (end < limit / 2) end = limit;
  else end += 1;
  if (/[\uD800-\uDBFF]/.test(rest[end - 1]) && /[\uDC00-\uDFFF]/.test(rest[end])) end -= 1;
  chunks.push(rest.slice(0, end)); rest = rest.slice(end);
 }
 if (rest) chunks.push(rest);
 return chunks;
}
export async function translateTerms(body, language) {
 if (language === 'ko') return body;
 if (!TERMS_LANGUAGES.some(([code]) => code === language)) throw new Error('Unsupported language');
 if (body.trim().replace(/\r\n/g, '\n') === ORIGINAL_TERMS) return ORIGINAL_TERMS_TRANSLATIONS[language];
 if (!await checkTranslationService()) throw new Error('Translation unavailable');
 const translated = [];
 for (const chunk of splitTermsForTranslation(body)) {
  const result = await translateText(chunk, language);
  if (!result?.trim()) throw new Error('Translation incomplete');
  translated.push(result);
 }
 return translated.join('\n');
}
