# Sarthi Narad AI — Shuru kaise karein (sirf Android phone se)

Aapke paas 2 cheezein banani hain: **(A) Server** (AI + Live Browser ke liye) aur **(B) APK** (phone app).

## A. Gemini API key
1. aistudio.google.com par login karke **Get API key** se key banayein. Ye key kisi ko na dein, chat/screenshot me na daalein.

## B. Code GitHub par
1. github.com par naya **private** repository banayein (naam: `sarthi-narad-ai`). Private rakhein.
2. Is zip ko extract karke saari files repo me upload karein (Add file → Upload files). `.github` folder bhi jana chahiye.

## C. Server deploy (Render.com — free plan chalega)
1. render.com → **New → Web Service** → apna GitHub repo chunein.
2. Build Command: `npm install && npm run build`
3. Start Command: `npm start`
4. Environment me `GEMINI_API_KEY` = aapki key, aur `NODE_ENV` = `production`.
5. Deploy hone par URL milega, jaise `https://sarthi-narad-ai.onrender.com`. Use copy karein.

**Zaroori:** "Live Browser" (Playwright Chromium) ko Render ke free plan par Chromium chahiye. Agar Live Browser na khule to Render par Build Command me `npm install && npx playwright install --with-deps chromium && npm run build` kar dein. Bina Chromium ke bhi baaki sab (Directory, AI Agent, Vault, OCR, APK ka native browser) chalega.

## D. APK banana
1. GitHub repo → **Actions** tab → **Build Sarthi Narad AI Android APK** → **Run workflow**.
2. `backend_url` me apna Render URL daalein → Run.
3. 8-12 minute baad run ke andar **Artifacts → sarthiai-android-apk** download karein (zip hoga, andar `.apk`).
4. Phone me install karein (Unknown sources allow karna padega).

## E. Use karna
1. **Vault** me details bharein (10th/12th/graduation bhi).
2. Header me **Zero-Save OFF** karein (warna Vault se form nahi bharega).
3. **Directory** me portal dhundhein → **AI Browser me kholo** → AI form bharega.
4. CAPTCHA, OTP, password, payment aur "Declaration" tick **aap** karein. AI ke blue fields ek baar check kar lein, phir submit.

## Dhyan rakhein
- Maine ye poora code is chat me **build/run nahi kiya** (yahan internet band tha). Pehli baar GitHub Actions me koi error aaye to error ka text bhej dein, theek kar dunga.
- Sarkari portals ke fields kabhi badal jaate hain; kuch fields AI/rules se miss ho sakte hain. Submit se pehle sab dekhna aapki zimmedari hai.
- Server free plan par 15 min inactive rehne par so jaata hai; pehla load slow hoga.
