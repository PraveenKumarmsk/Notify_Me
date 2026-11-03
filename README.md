# Notify App — Easy Setup (CMD Notes jaisa)

Aapko sirf **Code.gs** me 3 values badalni hain. `index.html` me kuch badalna nahi hai
(aapka Web App URL pehle se bhara hua hai, OneSignal App ID backend se khud aata hai).

## Aapke URLs
- Google Sheet: https://docs.google.com/spreadsheets/d/1nSSRD3ANeq6lgYf33FmRil1Le-ElHOmK2BoAokpxdcc/edit
- Web App URL (Apps Script): https://script.google.com/macros/s/AKfycbxgzNhqhgx6jsTKfOIN2GM1vT1RnUZ-F6PFN4quOIs3xCVzwzobRehLZ_WMdXaj-vRo/exec
- App ka URL (GitHub Pages): https://USERNAME.github.io   (USERNAME = aapka GitHub username)

## Step 1 — GitHub par publish
1. github.com → **New repository** → naam exactly `USERNAME.github.io` → Public → Create.
2. **Add file → Upload files** → ye 4 files + `icons` folder drag kijiye:
   `index.html`, `manifest.json`, `OneSignalSDKWorker.js`, `offline.html`, `icons/`
   (**Code.gs aur SETUP.md upload nahi karni**) → Commit changes.
3. **Settings → Pages → Deploy from a branch → main / (root) → Save**.
4. 1–2 min baad `https://USERNAME.github.io` khul jayega.

## Step 2 — OneSignal
1. onesignal.com → free account → New App → **Web** → **Custom Code**.
2. Site URL = `https://USERNAME.github.io` (end me `/` nahi). Auto Resubscribe ON → Save.
3. **Settings → Keys & IDs** se **App ID** aur **REST API Key** copy kijiye.

## Step 3 — Apps Script (backend)
1. Google Sheet kholiye → **Extensions → Apps Script**.
2. Purana code hata kar **Code.gs** ka poora code paste kijiye.
3. Top ke CONFIG me ye 3 badaliye (SHEET_ID pehle se bhari hai):
   ```js
   const ONESIGNAL_APP_ID   = "OneSignal App ID";
   const ONESIGNAL_REST_KEY = "OneSignal REST API Key";
   const ADMIN_PASSWORD     = "apna naya password";
   ```
4. Save (Ctrl+S).
5. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**
   (Naya deployment banane ki zaroorat nahi — aapka Web App URL wahi rahega.)
   Pehli baar ho to: Deploy → New deployment → Web app → *Execute as: Me*, *Who has access: Anyone*.
6. Function dropdown me **setupTrigger** chuniye → **Run** → Allow (sirf ek baar).
   Ya Sheet reload karke menu **🔔 Notify App → Setup 5-min trigger**.

## Step 4 — Test
1. `https://USERNAME.github.io` kholiye → **Enable Notifications** → Allow → "✅ Subscribed".
   Sheet me **Subscribers** tab aa jayega (tabs aur headers khud ban jate hain).
2. Background par 5 baar jaldi-jaldi tap → password → **Admin Panel** khulega → message likhiye → Send.
3. Ya Sheet me **🔔 Notify App → Send test notification**.

## Google Sheet se notification bhejna (bina app ke)
**Schedule** tab me naya row likhiye:

| Created | Message | Time (schedule) | Status |
|---|---|---|---|
| (khali chhod sakte hain) | Kal meeting 10 baje hai | 05-Nov-2026 09:30 | pending |

- Time khali chhodenge to agle 5 minute ke andar turant jayega.
- Bhejne ke baad Status apne aap `sent` ho jata hai. Galti hone par `failed: ...` likha aata hai.

## Naye users ko link dena
- Sirf `https://USERNAME.github.io` bhejiye.
- Agar kabhi naya Web App URL banana pade: `https://USERNAME.github.io/?api=<NAYA_EXEC_URL>` kholne se wo browser me save ho jata hai.

## Limitations
- **iPhone:** Safari → Share → **Add to Home Screen**, phir wahin se kholkar Enable (iOS 16.4+).
- **Android:** battery saver se notification kuch second late ho sakti hai.
- Schedule 5 minute ke gap par check hota hai, exact second par nahi.
- Admin password ab Apps Script me check hota hai (page source me nahi dikhta). Fir bhi Web App "Anyone" hai, isliye REST Key kabhi `index.html` ya GitHub me na daalein.

## Sirf ek user ko bhejna (optional)
`Code.gs` ke `sendNow()` me `included_segments` line hata kar:
```js
payload.include_player_ids = ["PLAYER_ID"];
// naye OneSignal me: payload.include_subscription_ids = ["PLAYER_ID"];
```
Player ID **Subscribers** tab ke column B me milti hai.

## Error aaye to
- *"Setup pending"* → Code.gs me ONESIGNAL_APP_ID daala? New version deploy kiya?
- *"Connect nahi hua"* → Deploy me Access = Anyone check kijiye; browser me Web App URL kholkar JSON dikhna chahiye.
- *OneSignal start nahi hua* → OneSignal me Site URL exactly GitHub Pages URL hai?
- Schedule me `failed: HTTP 400/403` → REST Key / App ID dobara check kijiye.
