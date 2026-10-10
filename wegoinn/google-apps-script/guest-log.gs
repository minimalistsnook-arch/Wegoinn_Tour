// Google Apps Script bound to the guest-log spreadsheet.
// Setup: README.md → "로그인 기록 Google Sheet 연동".
// Script property WEBHOOK_SECRET must equal Cloudflare's GOOGLE_SHEET_WEBHOOK_SECRET.
const SHEET_NAME = 'Guest Log';
const HEADERS = ['Time (KST)', 'Reservation name / number', 'Nickname', 'Photo', 'Photo URL', 'Profile ID'];

function doPost(e) {
  const body = JSON.parse((e.postData && e.postData.contents) || '{}');
  const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  if (!secret || body.secret !== secret) return reply({ ok: false, error: 'unauthorized' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = guestSheet();
    const photo = body.avatarUrl ? `=IMAGE("${String(body.avatarUrl).replace(/"/g, '')}")` : '';
    sheet.appendRow([
      Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'),
      plain(body.reservation),
      plain(body.nickname),
      photo,
      plain(body.avatarUrl),
      plain(body.profileId),
    ]);
  } finally {
    lock.releaseLock();
  }
  return reply({ ok: true });
}

function guestSheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = book.getSheetByName(SHEET_NAME) || book.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Guests type these values, so never let them run as spreadsheet formulas.
function plain(value) {
  const s = String(value || '').slice(0, 1000);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
