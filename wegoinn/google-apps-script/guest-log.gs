// Google Apps Script bound to the guest-log spreadsheet.
// Setup: README.md → "로그인 기록 Google Sheet 연동".
// Script property WEBHOOK_SECRET must equal Cloudflare's GOOGLE_SHEET_WEBHOOK_SECRET.
const SHEET_NAME = 'Guest Log';
const SPREADSHEET_ID = '1iSTD4TPnC8hS-bxhRMS3ysehGS6FRGlsrWiQANGztZI';
const HEADERS = ['Time (KST)', 'Reservation name / number', 'Nickname', 'Photo', 'Photo URL', 'Profile ID', 'Check in date', 'Check out date', 'Room number', 'Room type', 'Capacity', 'Role', 'Checked out (x)'];

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
      plain(body.checkIn), plain(body.checkOut), plain(body.roomNumber),
      plain(body.roomType), plain(body.capacity), plain(body.role),
    ]);
  } finally {
    lock.releaseLock();
  }
  return reply({ ok: true });
}

function guestSheet() {
  // Web apps have no active spreadsheet; open the destination explicitly.
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = book.getSheetByName(SHEET_NAME) || book.insertSheet(SHEET_NAME);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  return sheet;
}

// Run from the Apps Script editor to authorize access and check the destination.
// Creates only the tab/header, without adding a guest login record.
function testGuestSheet() {
  const sheet = guestSheet();
  SpreadsheetApp.flush();
  console.log('SUCCESS: Guest Log tab is ready. ' +
    'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID +
    '/edit#gid=' + sheet.getSheetId());
  const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  console.log(secret ? 'WEBHOOK_SECRET is set (value hidden).' :
    'ERROR: Set WEBHOOK_SECRET in Project Settings > Script Properties.');
}

// Guests type these values, so never let them run as spreadsheet formulas.
function plain(value) {
  const s = String(value || '').slice(0, 1000);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
