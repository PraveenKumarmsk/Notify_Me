/* =====================================================
   NOTIFY APP — Google Apps Script backend (Code.gs)
   Google Sheet = database, OneSignal = push, trigger = scheduler
   ===================================================== */

// ====== PLACEHOLDERS — apni values yahan daaliye ======
const SHEET_ID           = "YOUR_GOOGLE_SHEET_ID";      // Sheet URL me /d/ aur /edit ke beech wala hissa
const ONESIGNAL_APP_ID   = "YOUR_ONESIGNAL_APP_ID";     // OneSignal App ID
const ONESIGNAL_REST_KEY = "YOUR_ONESIGNAL_REST_KEY";   // OneSignal REST API Key

const SUBSCRIBERS_SHEET = "Subscribers";
const SCHEDULE_SHEET    = "Schedule";

/* ---------- Sheet helper: sheet na ho to khud bana deta hai ---------- */
function getSheet_(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (name === SUBSCRIBERS_SHEET) {
      sh.appendRow(["Registered At", "Player ID"]);
    } else if (name === SCHEDULE_SHEET) {
      sh.appendRow(["Created", "Message", "Time (ISO)", "Status"]);
      sh.getRange("C:C").setNumberFormat("@");   // time ko plain text rakho (auto date convert na ho)
    }
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ---------- JSON response banane ka helper ---------- */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =====================================================
   doPost — website se aane wali saari requests yahan aati hain
   ===================================================== */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // ---- 1) REGISTER: playerId ko Subscribers sheet me save karo ----
    if (data.action === 'register') {
      if (!data.playerId) return json_({ ok: false, error: 'playerId missing' });
      const sh = getSheet_(SUBSCRIBERS_SHEET);

      // Duplicate se bachne ke liye pehle check karo (column B me ids)
      const last = sh.getLastRow();
      if (last > 1) {
        const ids = sh.getRange(2, 2, last - 1, 1).getValues().flat();
        if (ids.indexOf(data.playerId) !== -1) return json_({ ok: true, duplicate: true });
      }
      sh.appendRow([new Date(), data.playerId]);
      return json_({ ok: true });
    }

    // ---- 2) SCHEDULE: message save karo; time khali ho to turant bhejo ----
    if (data.action === 'schedule') {
      const message = String(data.message || '').trim();
      const time    = String(data.time || '').trim();
      if (!message) return json_({ ok: false, error: 'message missing' });

      const sh = getSheet_(SCHEDULE_SHEET);
      sh.appendRow([new Date(), message, time, 'pending']);
      const row = sh.getLastRow();

      if (!time) {
        const result = sendNow(message);
        sh.getRange(row, 4).setValue(result.ok ? 'sent' : 'failed: ' + result.info);
        return json_({ ok: result.ok, error: result.ok ? undefined : result.info });
      }
      return json_({ ok: true, scheduled: true });
    }

    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* Browser me URL kholne par ye dikhega (sirf check karne ke liye) */
function doGet() {
  return json_({ ok: true, service: 'Notify App backend chal raha hai' });
}

/* =====================================================
   sendNow — OneSignal ko notification bhejta hai
   Return: { ok: true/false, info: '...' }
   ===================================================== */
function sendNow(message) {
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    included_segments: ['Subscribed Users'],   // sabhi subscribers ko
    headings: { en: 'Notify App' },
    contents: { en: message }
  };

  /* --- SIRF EK USER KO BHEJNA HO to upar ke 'included_segments' ki jagah ye use karein ---
     payload.include_player_ids = [playerId];
     (naye OneSignal me: payload.include_subscription_ids = [playerId];) */

  const res = UrlFetchApp.fetch('https://onesignal.com/api/v1/notifications', {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: { 'Authorization': 'Basic ' + ONESIGNAL_REST_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  let parsed = {};
  try { parsed = JSON.parse(body); } catch (e) {}

  // Success tab maane jab 200 ho aur response me notification 'id' ho
  if (code === 200 && parsed.id) return { ok: true, info: parsed.id };
  return { ok: false, info: ('HTTP ' + code + ' ' + body).substring(0, 200) };
}

/* =====================================================
   checkSchedule — har 5 minute me chalta hai (trigger se)
   'pending' rows jinka time aa gaya hai, unhe bhejta hai
   ===================================================== */
function checkSchedule() {
  // Lock: do runs ek saath chalein to message do baar na jaye
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const sh = getSheet_(SCHEDULE_SHEET);
    const last = sh.getLastRow();
    if (last < 2) return;

    const rows = sh.getRange(2, 1, last - 1, 4).getValues();
    const now = new Date();

    for (let i = 0; i < rows.length; i++) {
      const message = rows[i][1];
      const timeCell = rows[i][2];
      const status = rows[i][3];
      if (status !== 'pending' || !timeCell) continue;

      const when = new Date(timeCell);           // string ya Date dono chalega
      if (isNaN(when.getTime())) {
        sh.getRange(i + 2, 4).setValue('failed: bad time');
        continue;
      }
      if (when <= now) {
        const result = sendNow(message);
        sh.getRange(i + 2, 4).setValue(result.ok ? 'sent' : 'failed: ' + result.info);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/* =====================================================
   setupTrigger — EK BAAR editor me run karein
   Purane triggers hata kar naya 5-minute trigger banata hai
   ===================================================== */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkSchedule')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Trigger set: checkSchedule har 5 minute me chalega.');
}
