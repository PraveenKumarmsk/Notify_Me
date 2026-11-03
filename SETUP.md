# Notify App — SETUP STEPS (~20 min)

## File tree
```
/
├── index.html
├── manifest.json
├── OneSignalSDKWorker.js
├── offline.html
└── icons/
    ├── icon-192x192.png
    └── icon-512x512.png
```
(`Code.gs` Google Apps Script me paste hoga — GitHub par upload nahi karna.)

## 1. OneSignal (push)
1. https://onesignal.com par free account banaiye → **New App/Website** → platform: **Web**.
2. Site setup: **Custom Code**. Site URL = aapka GitHub Pages URL (e.g. `https://username.github.io`). "Auto resubscribe" ON rakhiye.
3. Service worker settings me path/filename: `OneSignalSDKWorker.js` (default).
4. **Settings → Keys & IDs** se **App ID** aur **REST API Key** copy kijiye.

## 2. Google Sheet + Apps Script
1. https://sheets.google.com par naya blank Sheet banaiye. URL me `/d/` aur `/edit` ke beech wali ID copy kijiye (**SHEET_ID**).
2. Sheet me **Extensions → Apps Script**. Poora purana code hata kar `Code.gs` ka code paste kijiye.
3. Top ke 3 placeholders replace kijiye: `SHEET_ID`, `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_KEY`.
4. **Deploy → New deployment → Web app**: *Execute as:* **Me**, *Who has access:* **Anyone** → Deploy → permissions Allow kijiye.
5. Jo **Web App URL** (`.../exec`) mile use copy kijiye.

## 3. Placeholders replace karein
| File | Placeholder |
|---|---|
| `index.html` | `ONESIGNAL_APP_ID`, `BACKEND_URL` (Web App URL), `ADMIN_PASSWORD` (badalna better hai) |
| `Code.gs` | `SHEET_ID`, `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_KEY` |

## 4. GitHub Pages
1. GitHub par repo banaiye. **Important:** repo ka naam `username.github.io` rakhiye (taaki site root `/` par chale — `start_url "/"` aur cache paths isi par kaam karte hain).
2. Saari files (`icons/` folder samet) upload kijiye.
3. **Settings → Pages → Deploy from branch → main / root → Save**. 1–2 minute me site live.

## 5. Trigger on karein
Apps Script editor me function dropdown se **setupTrigger** chuniye → **Run** (ek hi baar). Ab `checkSchedule` har 5 minute me chalega.

## 6. Test
1. Site kholiye → **Enable Notifications** → Allow. "✅ Subscribed" dikhna chahiye aur Sheet ke *Subscribers* tab me ID aani chahiye.
2. Background par 1.5 sec me 5 baar tap → password `admin123` → message likhiye → **Send** (time khali = turant).
3. Schedule test: 6–10 minute aage ka time chuniye.

## LIMITATIONS
- **iPhone:** Safari me pehle **Share → Add to Home Screen**, phir wahin se app kholkar Enable kijiye (iOS 16.4+ zaruri).
- **Android:** battery optimization ki wajah se notification kuch second late ho sakti hai.
- Scheduled messages **5 minute ke gap** par bhejte hain, exact second par nahi.
- Admin password client-side hai (page source me dikhta hai) aur Web App "Anyone" hai — chhote private group ke liye theek, sensitive use ke liye nahi. Web App URL kisi ko share na karein.
- Agar site `username.github.io/repo-name/` jaise subpath par chalayenge to `/` wale paths (manifest `start_url`, worker cache list, offline.html retry) ko `/repo-name/` ke saath badalna padega.
- Free tiers: Apps Script ~20,000 URL fetch/day aur OneSignal free plan — 10–100 users ke liye bahut kaafi.

## Sirf EK user ko bhejna (optional)
`Code.gs` ke `sendNow()` me `included_segments: ['Subscribed Users']` hata kar ye daaliye:
```js
payload.include_player_ids = ["PLAYER_ID_YAHAN"];
// naye OneSignal me: payload.include_subscription_ids = ["PLAYER_ID_YAHAN"];
```
Player ID *Subscribers* sheet ke column B me milti hai.
