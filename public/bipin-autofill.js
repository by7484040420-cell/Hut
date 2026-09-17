(function () {
  const API_BASE = document.currentScript ? new URL(document.currentScript.src).origin : window.location.origin;
  const sessionData = {}; // kahin save nahi hota, sirf isi run ke liye — band karte hi delete

  // ---- Page ke fields padhna: text/select wale alag, file (document) wale alag ----
  function collectFields() {
    const textInputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input:not([type]), textarea, select');
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const labelFor = (input) => {
      let label = '';
      if (input.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (lbl) label += lbl.textContent + ' ';
      }
      label += (input.placeholder || '') + ' ' + (input.name || '') + ' ' + (input.getAttribute('aria-label') || '');
      const prev = input.previousElementSibling;
      if (prev && prev.textContent) label += ' ' + prev.textContent;
      return label.trim().slice(0, 100);
    };
    const textFields = [];
    textInputs.forEach((input, idx) => {
      if (input.type === 'password') return;
      input.setAttribute('data-bipin-idx', idx);
      textFields.push({ idx, label: labelFor(input) });
    });
    const fileFields = [];
    fileInputs.forEach((input, idx) => {
      input.setAttribute('data-bipin-file-idx', idx);
      fileFields.push({ idx, label: labelFor(input) || 'Document' });
    });
    return { textFields, fileFields };
  }

  // ---- Chat widget ----
  function buildWidget() {
    const old = document.getElementById('bipin-live-chat');
    if (old) old.remove();
    const box = document.createElement('div');
    box.id = 'bipin-live-chat';
    box.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:60vh;background:#fff;z-index:2147483647;font-family:sans-serif;box-shadow:0 -6px 24px rgba(0,0,0,.25);border-radius:16px 16px 0 0;display:flex;flex-direction:column;';
    box.innerHTML = `
      <div style="background:#12172B;color:#fff;padding:12px 16px;border-radius:16px 16px 0 0;display:flex;justify-content:space-between;font-size:13px;">
        <b>BIPIN AI</b><span id="bipin-close" style="cursor:pointer;color:#E8A93B;">✕ Band Karo (sab delete)</span>
      </div>
      <div id="bipin-log" style="flex:1;overflow-y:auto;padding:12px 16px;font-size:13px;display:flex;flex-direction:column;gap:8px;max-height:32vh;"></div>
      <div id="bipin-input-row" style="display:flex;gap:8px;padding:12px 16px;border-top:1px solid #eee;">
        <input id="bipin-input" placeholder="Type karo..." style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;">
        <button id="bipin-send" style="background:#12172B;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:13px;">Bhejo</button>
      </div>`;
    document.body.appendChild(box);
    document.getElementById('bipin-close').onclick = () => {
      Object.keys(sessionData).forEach((k) => delete sessionData[k]);
      box.remove();
    };
  }

  function addMsg(text, from) {
    const log = document.getElementById('bipin-log');
    const m = document.createElement('div');
    m.style.cssText = from === 'ai'
      ? 'background:#EEF0F6;padding:8px 12px;border-radius:10px;align-self:flex-start;max-width:85%;'
      : 'background:#12172B;color:#fff;padding:8px 12px;border-radius:10px;align-self:flex-end;max-width:85%;';
    m.textContent = text;
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
  }

  function askUser(promptText) {
    return new Promise((resolve) => {
      addMsg(promptText, 'ai');
      const input = document.getElementById('bipin-input');
      const send = document.getElementById('bipin-send');
      const handler = () => {
        const val = input.value.trim();
        if (!val) return;
        addMsg(val, 'user');
        input.value = '';
        send.removeEventListener('click', handler);
        resolve(val);
      };
      send.addEventListener('click', handler);
    });
  }

  // ---- Document mangwana: chat me "📎 Attach" button dikhta hai, tap karte
  // hi camera/gallery khulta hai. File seedha us page ke input me chala
  // jaata hai — kahin upload/save nahi hota. ----
  function askForFile(promptText) {
    return new Promise((resolve) => {
      addMsg(promptText, 'ai');
      const log = document.getElementById('bipin-log');
      const row = document.createElement('div');
      row.style.cssText = 'align-self:flex-start;';
      row.innerHTML = `
        <label style="display:inline-block;background:#E8A93B;color:#12172B;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">
          📎 Photo Lagao
          <input type="file" accept="image/*,application/pdf" capture="environment" style="display:none;">
        </label>`;
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
      const picker = row.querySelector('input[type="file"]');
      picker.addEventListener('change', () => {
        const file = picker.files[0];
        if (!file) return;
        addMsg('📎 ' + file.name, 'user');
        row.remove();
        resolve(file);
      });
    });
  }

  function setFileInput(fileIdx, file) {
    const input = document.querySelector(`[data-bipin-file-idx="${fileIdx}"]`);
    if (!input) return false;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.style.outline = '2px solid #E8A93B';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  async function run() {
    buildWidget();
    addMsg('Is page ko padh raha hoon...', 'ai');
    const { textFields, fileFields } = collectFields();
    if (textFields.length === 0 && fileFields.length === 0) {
      addMsg('Koi bharne layak field nahi mila.', 'ai');
      return;
    }

    // 1) Documents pehle — live maango, seedha us field me lagao
    for (const f of fileFields) {
      const file = await askForFile(`Document chahiye — "${f.label}". Camera/Gallery se lagao:`);
      setFileInput(f.idx, file);
      addMsg('✅ Laga diya.', 'ai');
    }

    // 2) Basic details live poochho
    if (textFields.length > 0) {
      const QUESTIONS = [
        { key: 'name', text: 'Aapka poora naam?' },
        { key: 'father', text: 'Pita ka naam?' },
        { key: 'dob', text: 'Janam tithi (DD/MM/YYYY)?' },
        { key: 'gender', text: 'Gender (Male/Female/Other)?' },
        { key: 'mobile', text: 'Mobile number?' },
        { key: 'email', text: 'Email?' },
        { key: 'address', text: 'Poora address?' },
        { key: 'pincode', text: 'Pincode?' },
      ];
      for (const q of QUESTIONS) {
        sessionData[q.key] = await askUser(q.text);
      }

      addMsg('Dhanyavaad! AI ab fields match kar raha hai...', 'ai');
      let mapping = {};
      try {
        const res = await fetch(API_BASE + '/api/gemini-field-map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: textFields, profileKeys: Object.keys(sessionData) }),
        });
        mapping = await res.json();
      } catch (e) {
        addMsg('AI matching me dikkat aayi, jo pata hai wahi bhar raha hoon...', 'ai');
      }

      let count = 0;
      Object.entries(mapping).forEach(([idx, key]) => {
        if (!key || !sessionData[key]) return;
        const input = document.querySelector(`[data-bipin-idx="${idx}"]`);
        if (!input) return;
        input.value = sessionData[key];
        input.style.background = '#FFF9C4';
        input.style.border = '2px solid #E8A93B';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        count++;
      });

      // 3) Jo field abhi bhi khaali hai, uske baare me seedha poochho — live
      for (const f of textFields) {
        const input = document.querySelector(`[data-bipin-idx="${f.idx}"]`);
        if (!input || input.value) continue;
        const ans = await askUser(`"${f.label || 'yeh field'}" ke liye kya likhu?`);
        input.value = ans;
        input.style.background = '#FFF9C4';
        input.style.border = '2px solid #E8A93B';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        count++;
      }

      addMsg(`${count} field(s) bhar diye.`, 'ai');
    }

    addMsg('🎉 Form ready hai! Ab CAPTCHA aur Payment/OTP khud daalo, phir Submit karo.', 'ai');
    addMsg('Kaam ho jaaye toh upar "✕ Band Karo" dabao — chat aur documents turant delete ho jaayenge.', 'ai');
  }

  run();
})();
