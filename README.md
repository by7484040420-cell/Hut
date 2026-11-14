# Sarthi Narad AI

**SarthiAI** (live AI agent, OCR, mini browser, Android APK) + **Narad AI** (85+ sarkari portals, Hinglish search, form-fill engine) — ek app.

## Kya kya milta hai

| Tab | Kaam |
|---|---|
| Home | Services + document upload (OCR) |
| **Directory** (Narad se) | 85+ official portals, 13 categories, Hindi/Hinglish search, har portal par "AI Browser me kholo" / "AI se poochho" |
| AI Agent | Gemini + live Google Search: jobs, procedures, forms ka draft |
| Live Browser | Portal khulta hai, AI form bharta hai (APK me native WebView, web me Playwright Chromium) |
| Forms | AI se bane application drafts (Job, Court/Block, PAN, Passport, DL, Ticket, Hotel) |
| Vault | Aapki details ek baar save: personal, address, 10th/12th/graduation, IDs |

## Form-fill kaise kaam karta hai (merged engine)

1. `public/sarthi-fill-engine.js` page par chalta hai. Hindi/Hinglish/English labels se field pehchanta hai (text, dropdown, radio, "same as" checkbox, multi-step forms).
2. Jo fields rules se nahi mile, unki list **Gemini** ko jaati hai (`POST /api/ai/map-fields`). Gemini sirf Vault data se value deta hai, kuch invent nahi karta. AI ke bhare fields **blue** highlight hote hain, rule se bhare **green**.
3. **Kabhi automatic nahi bharta:** CAPTCHA, OTP, password, card/UPI/bank, aur Declaration/Terms checkbox. Ye amber highlight hote hain — aap khud karte hain.
4. Vault me jo value nahi hai wo "Vault me kami" me dikhta hai.

## Privacy: Zero-Save

Header me **Zero-Save ON** (default) ho to Vault ka data form-fill me use **nahi** hota — sirf wahi documents jo aapne session me scan kiye. Vault se bharwana ho to **Zero-Save OFF** karein.

## Run (computer / server)

```bash
cp .env.example .env     # GEMINI_API_KEY daalein
npm install
npm run build
npm start                # http://localhost:3000
```

APK banane aur server deploy karne ke steps: **START_HERE_HINDI.md**

## Narad se kya nahi liya (jaan-boojhkar)

- Narad ka hardcoded "live jobs" feed aur sample profile (Rahul Kumar Sharma) — wo asli nahi the. Live jobs ab AI Agent internet se dhundta hai.
- Narad ka purana Kotlin app aur offline chat jawab (purane post-counts the). Native layer ab SarthiAI ka Capacitor WebView hai.
- `crawl.yml` / `docs/` job crawler: `crawler/` folder zip me tha hi nahi.
