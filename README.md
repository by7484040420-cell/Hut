# BIPIN AI — REAL Split-Screen (Left AI, Right Government Portal)

## Yeh Kaam Kaise Karta Hai (Verified via Research)
`@capgo/capacitor-inappbrowser` ka `openWebView()` function width,
height, x, y accept karta hai — matlab hum government portal ko
SIRF SCREEN KE RIGHT HALF mein khol sakte hain. Left half mein
hamara APNA AI chat panel (humari khud ki HTML/CSS) rehta hai.

## Zaroori Update Karna Hai
1. Apni current `public/app-shell.html` ko is naye file se REPLACE karo
2. `hut-3igh.onrender.com` (aapka URL) is file mein kahin hardcode
   nahi hai (yeh saara logic client-side hai) — bas ensure karo
   `capacitor.config.json` mein URL abhi bhi
   `https://hut-3igh.onrender.com/app-shell.html` hi ho

## Test Kiya
- JavaScript syntax: valid ✅
- Width/position calculation: verified — right half exact 50% se
  shuru hota hai ✅

## Sach — Ek Zaroori Baat
Maine yeh calculation aur JS logic test kiya hai, lekin
`InAppBrowser.openWebView()` ka REAL, LIVE split-screen rendering
sirf real Android device/APK par hi dekha ja sakta hai — mere paas
Android device/emulator access nahi hai. Agar dimensions thoda
adjust karne padein (jaisa toolbar height), APK test karke batana,
turant fix karunga.
