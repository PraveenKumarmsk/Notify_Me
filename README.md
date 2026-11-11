# PingMe — Personal Notification Sharing PWA

Ek user doosre user ke phone par **push notification** bhej sakta hai — turant, schedule karke, ya bahut logon ko ek saath.
Free stack: **GitHub Pages** (frontend) + **Google Apps Script** (backend API) + **Google Sheets** (database) + **Web Push (VAPID)**.
Koi paid service, Firebase, OneSignal ya npm/build step nahi chahiye.

## Files

```
/
├── index.html              ← app ka page
├── style.css               ← design (Light + Dark)
├── script.js               ← app ka logic
├── service-worker.js       ← push + offline cache
├── manifest.json           ← PWA (naam, icons)
├── icons/
│   ├── icon-192x192.png
│   ├── icon-512x512.png
│   ├── icon-maskable-512x512.png
│   └── favicon.png
├── vapid-generator.html    ← VAPID keys banane ka tool (apne computer par kholiye)
├── Code.gs                 ← Google Apps Script backend (Apps Script me paste hoga)
├── appsscript.json         ← (optional) Apps Script settings
└── README.md
```

**GitHub par upload karni hain:** `index.html`, `style.css`, `script.js`, `service-worker.js`, `manifest.json`, `icons/` folder.
**GitHub par upload NAHI karni:** `Code.gs` aur VAPID Private Key (ye secret hain).

## Ye kaise kaam karta hai

1. User register/login karta hai. Password server par **salted PBKDF2-SHA256 (10,000 rounds)** se hash hokar Sheet me jata hai — plain password kabhi save nahi hota. Login ke baad server ek **signed token** deta hai aur har request server par verify hoti hai.
2. Users ek doosre ko User ID se search karke **connection request** bhejte hain. Sirf **connected** users hi ek doosre ko notification bhej sakte hain.
3. Har device apne browser se push subscribe karta hai; subscription `Devices` sheet me user ke saath save hoti hai. Ek account par kitne bhi devices — sab par notification aati hai.
4. Send karne par Apps Script **VAPID JWT (ES256)** sign karke push service (Google FCM / Mozilla / Apple) ko "wake-up" push bhejta hai. Phone ka service worker jaagta hai, server se message le aata hai aur notification dikhata hai — **browser band ho tab bhi** (jahan OS allow kare).
5. Schedule: message `Scheduled` sheet me jata hai; Apps Script ka **1-minute trigger** time aate hi bhej deta hai.

---

## SETUP — Step by step (~25 minute)

### Step 1 — Google Sheet banana
1. https://sheets.google.com par **Blank** sheet banaiye, naam: `PingMe DB`.
2. Kuch aur nahi karna. Tabs (`Users`, `Connections`, `Devices`, `Notifications`, `Scheduled`) aur unke headers **apne aap ban jate hain** (Step 3 me `setupTrigger` chalane par).
3. (Optional) Sheet ki ID copy kijiye: URL me `/d/` aur `/edit` ke beech wala lamba text.

Sheets ka structure:

| Tab | Columns |
|---|---|
| **Users** | User ID, Password Hash, Name, Created Date, Status |
| **Connections** | Sender ID, Receiver ID, Connection Status (`pending` / `accepted` / `rejected`), Updated At |
| **Devices** | User ID, Device ID, Push Subscription, Device, Updated At |
| **Notifications** | Sender ID, Receiver ID, Message, Date, Time, Status (`queued` / `sent` / `delivered` / `read` / `failed`), ID, At (ISO), Read At, Delivered To, Hidden By |
| **Scheduled** | User ID, Receiver ID, Message, Scheduled Date, Scheduled Time, Status (`pending` / `sent` / `cancelled` / `failed`), ID, Scheduled At (ISO), Created At, Hidden By |

### Step 2 — VAPID keys banana
1. Is project ki `vapid-generator.html` file apne computer par **double-click** karke Chrome/Edge me kholiye.
2. **Keys generate karo** dabaiye. **Public Key** aur **Private Key** dikhengi. Dono ko abhi Notepad me copy kar lijiye.
3. Ye dono keys **ek hi jodi** hain. Alag-alag baar ki keys mix mat kijiye. Private key secret hai.

### Step 3 — Apps Script (backend) deploy karna
1. Apni Sheet me **Extensions → Apps Script** kholiye.
2. Left me `Code.gs` me jo bhi purana code hai use **poora hata kar** is project ka `Code.gs` paste kijiye.
3. (Optional par accha) **Project Settings (gear)** → **Show "appsscript.json" manifest file** ON karke `appsscript.json` me is project wali file ka content paste kijiye. Ye V8 runtime aur time zone set karta hai. (Naye projects me V8 pehle se hota hai.)
4. `Code.gs` ke upar **CONFIG** me ye bhariye:
   ```js
   const SHEET_ID          = "";                       // khali = wahi Sheet jisse script bani hai (ya apni Sheet ID)
   const VAPID_PUBLIC_KEY  = "yahan Public Key";
   const VAPID_PRIVATE_KEY = "yahan Private Key";
   const VAPID_SUBJECT     = "mailto:aapka@email.com"; // apna email
   ```
   > Agar script isi Sheet se (Extensions → Apps Script) bani hai to `SHEET_ID` ko `""` rakhna sabse safe hai.
5. **Ctrl+S** se save kijiye.
6. Function dropdown se **`setupTrigger`** chuniye → **Run** → permissions: **Review permissions → apna account → Advanced → Go to project (unsafe) → Allow**. Ye 5 tabs banata hai aur har 1 minute wala scheduler trigger lagata hai.
7. Phir function **`selfTest`** chalaiye. Logs me ye dikhna chahiye:
   ```
   VAPID keys: OK (public/private match karte hain)
   VAPID JWT sign: OK
   Password hash/verify: OK
   Sheets tabs: OK
   Trigger(s): 1
   ```
8. **Deploy → New deployment → ⚙ Select type → Web app**
   - Description: `PingMe v1`
   - **Execute as: Me**
   - **Who has access: Anyone**
   - **Deploy** dabaiye.
9. Jo **Web app URL** (`https://script.google.com/macros/s/.../exec`) mile use copy kijiye.
10. **Check:** us URL ke aage `?action=config` lagakar browser me kholiye. Ye dikhna chahiye:
    ```
    {"ok":true,"appName":"PingMe","vapidPublicKey":"B...","vapidReady":true,"vapidMessage":""}
    ```
    `vapidReady` **true** hona chahiye. Agar `false` hai to `vapidMessage` me wajah likhi hogi.

> **Code.gs badalne par:** Save karke **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy** zaroor kijiye. URL wahi rahega.

### Step 4 — GitHub Pages par frontend publish karna
1. https://github.com par **New repository** banaiye (Public). Naam kuch bhi ho sakta hai, jaise `Notify_Me` ya `praveenkumarmsk.github.io`.
2. **Add file → Upload files**. In sabko drag & drop kijiye:
   `index.html`, `style.css`, `script.js`, `service-worker.js`, `manifest.json` aur poora `icons` folder.
   Files repo ke **root me** honi chahiye (kisi extra folder ke andar nahi). **Commit changes** dabaiye.
3. **Settings → Pages → Source: Deploy from a branch → Branch: main, Folder: / (root) → Save**.
4. 1–2 minute baad site live ho jayegi:
   - Repo ka naam `USERNAME.github.io` hai → `https://USERNAME.github.io/`
   - Koi aur naam (jaise `Notify_Me`) hai → `https://USERNAME.github.io/Notify_Me/`
   
   Dono tarah kaam karta hai (saare paths relative hain).
5. (Optional) Chahein to `script.js` me upar `BACKEND_URL_DEFAULT = "..."` me apna Web App URL daal dein, taaki users ko paste na karna pade.

### Step 5 — App kholna aur account banana
1. Phone me Chrome se site kholiye. Pehli baar **Web App URL paste** karne ko kahega → paste karke **Save & Continue**.
   - Shortcut: ye link doston ko bhejiye, URL apne aap save ho jayega:
     `https://USERNAME.github.io/Notify_Me/?api=<WEB_APP_URL>`
2. **New User** tab → naam, **User ID**, password → **Account banao**.
3. Dashboard par **Enable** dabaiye → browser poochega → **Allow**. "Push chalu hai" dikhna chahiye.
4. Settings → **Test notification** se apne hi phone par test bhejiye.

### Step 6 — PWA install karna
- **Android (Chrome):** menu (⋮) → **Install app** / **Add to Home screen**. Ya dashboard par "Install" button.
- **Desktop (Chrome/Edge):** address bar me install icon (⊕) → Install.
- **iPhone/iPad:** Safari me **Share → Add to Home Screen**, phir **home screen ke icon se** app kholiye aur wahin Enable kijiye (iOS 16.4+ zaroori; browser tab me push nahi chalta).

### Step 7 — Do users ke beech test (push testing)
1. **Phone A** par User `ravi`, **Phone B** par User `sana` banaiye. Dono par **Enable** kijiye.
2. A: **People** → `sana` search → **Connect**.
3. B: **People** → **Aayi hui requests** → **Accept**.
4. A: **Send** → `sana` chuniye → "Hi, How are you?" → **Abhi bhejo**.
5. B ke phone par notification aani chahiye (B ka browser band/background me ho tab bhi).
6. Schedule test: A: **Schedule** tab → message → **Time chuniye…** → 3-4 minute baad ka time → **Schedule karo**. Time par B ko notification aayegi.
7. Bulk test: **Bulk** tab → kai users chuniye → bhejiye.
8. History: B ne notification kholi → A ki **Sent** tab me status **Sent → Delivered → Read** ho jata hai.

---

## Features kahan hain

| Feature | Kahan |
|---|---|
| Register / Login / Logout | Pehla screen, Settings → Logout |
| Add New User | Login screen → **New User** |
| User search, connection request, accept / reject | **People** |
| Dashboard (Total Users, Connected, Sent, Received, Scheduled) | **Dashboard** |
| Instant / Schedule (popup) / Bulk notification | **Send** |
| Sent / Received / Scheduled history, status, delete | **History** |
| Multiple devices sync | Doosre device par isi ID se login + Enable |
| Dark / Light mode | Top-right button ya Settings |

## Delivery status ka matlab
- **Queued** — receiver ne abhi push Enable nahi kiya; app kholne par History me dikhega.
- **Sent** — push service ne accept kar liya.
- **Delivered** — receiver ke device ne message le liya.
- **Read** — receiver ne app me kholkar dekha.
- **Failed** — push nahi ja paya.

## Limitations (zaroor padhein)
- **iPhone:** sirf Home Screen par installed PWA me push chalta hai (iOS 16.4+).
- **Android:** battery saver / data saver ki wajah se notification kuch second late ho sakti hai. Chrome ko "Unrestricted" battery do to behtar.
- **Scheduled** notification 1 minute ke andar bhejte hain, exact second par nahi.
- Apps Script ka free quota hota hai (roz ke URL fetch / trigger runtime). Chhote group (10–100 users) ke liye kaafi hai.
- Messages Google Sheet me store hote hain — Sheet ka owner unhe dekh sakta hai. Sheet ko kisi ke saath share mat kijiye.
- Web App "Anyone" access ke saath deploy hota hai (browser ko call karne ke liye zaroori); asli suraksha server par token + password hash se hoti hai. 5 galat login ke baad 10 minute ka lock lagta hai.
- Push endpoints sirf known push services (Google, Mozilla, Apple, Microsoft) ke allowed hain.

## Troubleshooting

| Dikkat | Kya karein |
|---|---|
| "Server se connect nahi ho paya" | Web App deploy me **Who has access = Anyone** hai? URL `/exec` par khatam hota hai? |
| Dashboard par "Server setup adhoora hai" | `?action=config` kholkar `vapidMessage` padhiye; `Code.gs` me keys bhariye aur **New version** deploy kijiye. |
| "Public aur Private key ek jodi nahi hain" | `vapid-generator.html` se **ek hi baar** me dono keys lijiye. |
| Enable dabane par "blocked" | Chrome → site settings → Notifications → Allow. |
| Notification nahi aa rahi | Receiver ne Enable kiya? Settings → Test notification chalaiye. Phone ka Do Not Disturb / battery saver dekhiye. Sheet ke `Notifications` tab me Status dekhiye. |
| Schedule nahi chal raha | Apps Script → Triggers me `processScheduled` har minute dikhna chahiye (`setupTrigger` dobara chalaiye). |
| Site par 404 / purana page | Pages enabled hai? Files repo root me hain? Ctrl+Shift+R. |
| "Service worker ready nahi hua" | Site `https://` (GitHub Pages) par kholiye, `file://` par nahi. |
| Update ke baad purana design | `service-worker.js` me `CACHE = 'pingme-v1'` ko `v2` kijiye aur commit kijiye. |

## Update kaise karein
- **Frontend:** GitHub me files replace karke commit. `service-worker.js` ka `CACHE` version badhaiye.
- **Backend:** `Code.gs` paste karke Save → **Deploy → Manage deployments → Edit → New version → Deploy**.
