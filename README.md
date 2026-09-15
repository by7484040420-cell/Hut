# BIPIN AI — Poora App (Website + Native App Build)

## Structure
```
server.js              — backend (39 portals + Gemini AI matching)
portals-data.js         — verified government portals
package.json
public/
  index.html             — website ka homepage (testing/tracking ke liye)
  app-shell.html          — NATIVE APP ka homepage (AI button built-in)
  bipin-autofill.js       — AI ka core logic (fields dhundhna, bharna)
.github/workflows/
  build-apk.yml            — GitHub Actions: khud APK banata hai
```

## GitHub Pe Upload Karne Se Pehle — 3 Jagah URL Badalna Hai
Render pe deploy karne ke baad, jo URL milegi, use yahan daalo:
1. `.github/workflows/build-apk.yml` — `YOUR-RENDER-URL` (1 jagah)
2. `public/app-shell.html` — `YOUR-RENDER-URL` (1 jagah, line jisme
   `bipin-autofill.js` load ho raha hai)

## Deploy Steps
1. **Pehle Render pe deploy karo** (server.js + portals-data.js +
   package.json + public/ — sab)
2. Milі URL ko upar wali 2 jagah daalo, GitHub pe push karo
3. GitHub "Actions" tab mein APK build hoga (10-15 min)
4. APK download karke phone mein install karo

## Bug Fix Kiya Is Session Mein
`app-shell.html` (native app ka homepage) pehle 404 de raha tha —
server sirf fixed routes serve karta tha. Ab `public/` folder ki
koi bhi file generic tarike se serve hoti hai — fix karke test kiya.

## Test Kiya (Sab Verify)
- Homepage: 200 ✅
- app-shell.html: 200 ✅ (fix ke baad)
- Portal API: 39 portals ✅
- Autofill script: 200 ✅
- Mark-test save/load: verified ✅
- Path traversal security: blocked ✅
