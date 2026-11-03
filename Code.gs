/* =====================================================
   NOTIFY APP — Google Apps Script backend (Code.gs)
   Google Sheet = database | OneSignal = push | Trigger = scheduler

   SIRF YE 3 CHEEZEN BADALNI HAIN (neeche CONFIG me):
   ONESIGNAL_APP_ID, ONESIGNAL_REST_KEY, ADMIN_PASSWORD
   ===================================================== */

// ================= CONFIG =================
const SHEET_ID           = "1nSSRD3ANeq6lgYf33FmRil1Le-ElHOmK2BoAokpxdcc";  // aapki Google Sheet
const ONESIGNAL_APP_ID   = "YOUR_ONESIGNAL_APP_ID";      // OneSignal → Settings → Keys & IDs
const ONESIGNAL_REST_KEY = "YOUR_ONESIGNAL_REST_KEY";    // OneSignal → Settings → Keys & IDs (secret rakhein)
const ADMIN_PASSWORD     = "admin123";                   // Admin password (yahan check hota hai, isliye secure) — badal dein
// ==========================================

const SUBSCRIBERS_SHEET = "Subscribers";
const SCHEDULE_SHEET    = "Schedule";

/* ---------- Spreadsheet kholna ----------
   SHEET_ID sahi ho to wo, warna jis sheet se script bani hai wahi use hogi */
function getSS_() {
  if (SHEET_ID && SHEET_ID.indexOf("YOUR_") !== 0) return SpreadsheetApp.openById(SHEET_ID);
  return SpreadsheetApp.getActiveSpreadsheet();
}

/* ---------- Sheet helper: tab na ho to khud bana deta hai ---------- */
function getSheet_(name) {
  const ss = getSS_();
  let sh = ss.getSheetByName(name);
  if (sh) return sh;

  sh = ss.insertSheet(name);
  if (name === SUBSCRIBERS_SHEET) {
    sh.appendRow(["Registered At", "Player ID"]);
    sh.setColumnWidth(1, 170);
    sh.setColumnWidth(2, 330);
  } else if (name === SCHEDULE_SHEET) {
    sh.appendRow(["Created", "Message", "Time (schedule)", "Status"]);
    sh.setColumnWidth(1, 150);
    sh.setColumnWidth(2, 380);
    sh.setColumnWidth(3, 160);
    sh.setColumnWidth(4, 160);
    // Time column ko real date-time format do (sheet se haath se likhna aasan ho)
    sh.getRange("A2:A").setNumberFormat("dd-mmm-yyyy hh:mm");
    sh.getRange("C2:C").setNumberFormat("dd-mmm-yyyy hh:mm");
    // Status dropdown: pending / sent (failed likha aaye to bhi chalega)
    sh.getRange("D2:D").setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(["pending", "sent"], true).setAllowInvalid(true).build()
    );
    sh.getRange("C1").setNote("Yahan date-time likhiye, jaise 05-Nov-2026 18:30. Khali chhodenge to agle 5 minute me turant jayega.");
    sh.getRange("D1").setNote("Naya row banate waqt 'pending' likhiye. Bhejne ke baad 'sent' ho jayega.");
  }
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight("bold").setBackground("#e0e7ff");
  sh.setFrozenRows(1);
  return sh;
}

/* ---------- JSON response helper ---------- */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =====================================================
   doGet — browser/website se GET requests
   ?action=config → website ko OneSignal App ID milta hai
   (REST key kabhi bahar nahi jati)
   ===================================================== */
function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';
  if (action === 'config') {
    return json_({ ok: true, appId: ONESIGNAL_APP_ID });
  }
  return json_({ ok: true, service: 'Notify App backend chal raha hai' });
}

/* =====================================================
   doPost — website se aane wali saari requests
   ===================================================== */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // ---- REGISTER: playerId ko Subscribers sheet me save karo ----
    if (data.action === 'register') {
      if (!data.playerId) return json_({ ok: false, error: 'playerId missing' });
      const sh = getSheet_(SUBSCRIBERS_SHEET);
      const last = sh.getLastRow();
      if (last > 1) {
        const ids = sh.getRange(2, 2, last - 1, 1).getValues().flat();
        if (ids.indexOf(data.playerId) !== -1) return json_({ ok: true, duplicate: true });
      }
      sh.appendRow([new Date(), data.playerId]);
      return json_({ ok: true });
    }

    // ---- VERIFY: admin password sahi hai ya nahi ----
    if (data.action === 'verify') {
      if (data.password !== ADMIN_PASSWORD) return json_({ ok: false, error: 'unauthorized' });
      return json_({ ok: true });
    }

    // ---- SCHEDULE: (sirf admin) message save karo; time khali ho to turant bhejo ----
    if (data.action === 'schedule') {
      if (data.password !== ADMIN_PASSWORD) return json_({ ok: false, error: 'unauthorized' });

      const message = String(data.message || '').trim();
      const time    = String(data.time || '').trim();
      if (!message) return json_({ ok: false, error: 'message missing' });

      const when = time ? new Date(time) : null;
      if (time && isNaN(when.getTime())) return json_({ ok: false, error: 'time sahi nahi hai' });

      const sh = getSheet_(SCHEDULE_SHEET);
      sh.appendRow([new Date(), message, when || '', 'pending']);
      const row = sh.getLastRow();

      if (!when) {
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

  /* --- SIRF EK USER KO BHEJNA HO to upar ki 'included_segments' line hata kar ye use karein ---
     payload.include_player_ids = [playerId];
     (naye OneSignal me: payload.include_subscription_ids = [playerId];) */

  // OneSignal ki key ke hisaab se 'Basic' ya 'Key' chalta hai — dono try karte hain
  const schemes = ['Basic', 'Key'];
  let lastInfo = '';
  for (let i = 0; i < schemes.length; i++) {
    const res = UrlFetchApp.fetch('https://onesignal.com/api/v1/notifications', {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      headers: { 'Authorization': schemes[i] + ' ' + ONESIGNAL_REST_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    const body = res.getContentText();
    let parsed = {};
    try { parsed = JSON.parse(body); } catch (e) {}

    if (code === 200 && parsed.id) return { ok: true, info: parsed.id };
    lastInfo = ('HTTP ' + code + ' ' + body).substring(0, 200);
    if (code !== 401 && code !== 403) break;   // auth ke alawa error ho to dobara try nahi
  }
  return { ok: false, info: lastInfo };
}

/* =====================================================
   checkSchedule — har 5 minute me chalta hai (trigger se)
   Schedule sheet ke 'pending' (ya khali status wale) rows jinka time aa gaya
   hai (ya time khali hai) unhe bhejta hai. Sheet me haath se likhe rows bhi chalenge.
   ===================================================== */
function checkSchedule() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;          // do runs ek saath nahi
  try {
    const sh = getSheet_(SCHEDULE_SHEET);
    const last = sh.getLastRow();
    if (last < 2) return;

    const rows = sh.getRange(2, 1, last - 1, 4).getValues();
    const now = new Date();

    for (let i = 0; i < rows.length; i++) {
      const message = String(rows[i][1] || '').trim();
      const timeCell = rows[i][2];
      const status = String(rows[i][3] || '').trim().toLowerCase();

      if (!message) continue;                              // khali message skip
      if (status !== 'pending' && status !== '') continue; // sent/failed skip

      let when = null;                                     // khali time = abhi bhejo
      if (timeCell instanceof Date) {
        when = timeCell;
      } else if (String(timeCell).trim() !== '') {
        when = new Date(timeCell);
        if (isNaN(when.getTime())) {
          sh.getRange(i + 2, 4).setValue('failed: time sahi nahi');
          continue;
        }
      }

      if (!when || when <= now) {
        const result = sendNow(message);
        sh.getRange(i + 2, 4).setValue(result.ok ? 'sent' : 'failed: ' + result.info);
        if (!rows[i][0]) sh.getRange(i + 2, 1).setValue(new Date());
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/* =====================================================
   setupTrigger — EK BAAR run karein
   Purane triggers hata kar naya 5-minute trigger banata hai
   ===================================================== */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkSchedule').timeBased().everyMinutes(5).create();
  Logger.log('Trigger set: checkSchedule har 5 minute me chalega.');
}

/* =====================================================
   Extra: Sheet me "Notify App" menu (jab script Sheet se bani ho)
   Test notification / abhi check karna / trigger setup yahin se
   ===================================================== */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('🔔 Notify App')
      .addItem('Setup 5-min trigger (ek baar)', 'setupTrigger')
      .addItem('Send test notification', 'sendTest')
      .addItem('Pending messages abhi check karo', 'checkSchedule')
      .addToUi();
  } catch (e) {}
}

function sendTest() {
  const r = sendNow('Test notification ✅ Notify App sahi chal raha hai.');
  SpreadsheetApp.getUi().alert(r.ok ? 'Test notification bhej di gayi!' : 'Fail: ' + r.info);
}
