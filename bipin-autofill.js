(function () {
  const API_BASE = document.currentScript ? new URL(document.currentScript.src).origin : window.location.origin;
  const sessionData = {}; // kahin save nahi hota, sirf isi run ke liye

  function collectFields() {
    const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type]), textarea, select');
    const fields = [];
    inputs.forEach((input, idx) => {
      if (input.type === 'password') return;
      let label = '';
      if (input.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (lbl) label += lbl.textContent + ' ';
      }
      label += (input.placeholder || '') + ' ' + (input.name || '') + ' ' + (input.getAttribute('aria-label') || '');
      const prev = input.previousElementSibling;
      if (prev && prev.textContent) label += ' ' + prev.textContent;
      input.setAttribute('data-bipin-idx', idx);
      fields.push({ idx, label: label.trim().slice(0, 100) });
    });
    return fields;
  }

  function buildWidget() {
    const old = document.getElementById('bipin-live-chat');
    if (old) old.remove();
    const box = document.createElement('div');
    box.id = 'bipin-live-chat';
    box.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:55vh;background:#fff;z-index:2147483647;font-family:sans-serif;box-shadow:0 -6px 24px rgba(0,0,0,.25);border-radius:16px 16px 0 0;display:flex;flex-direction:column;';
    box.innerHTML = `
      <div style="background:#12172B;color:#fff;padding:12px 16px;border-radius:16px 16px 0 0;display:flex;justify-content:space-between;font-size:13px;">
        <b>BIPIN AI</b><span id="bipin-close" style="cursor:pointer;color:#E8A93B;">✕ Band Karo</span>
      </div>
      <div id="bipin-log" style="flex:1;overflow-y:auto;padding:12px 16px;font-size:13px;display:flex;flex-direction:column;gap:8px;max-height:28vh;"></div>
      <div style="display:flex;gap:8px;padding:12px 16px;border-top:1px solid #eee;">
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

  async function run() {
    buildWidget();
    addMsg('Is page ko padh raha hoon...', 'ai');
    const fields = collectFields();
    if (fields.length === 0) {
      addMsg('Koi bharne layak field nahi mila.', 'ai');
      return;
    }

    const QUESTIONS = [
      { key: 'name', text: 'Aapka poora naam?' },
      { key: 'father', text: "Pita ka naam?" },
      { key: 'dob', text: 'Janam tithi (DD/MM/YYYY)?' },
      { key: 'mobile', text: 'Mobile number?' },
      { key: 'email', text: 'Email?' },
    ];
    for (const q of QUESTIONS) {
      sessionData[q.key] = await askUser(q.text);
    }

    addMsg('Dhanyavaad! AI ab fields match kar raha hai...', 'ai');

    let mapping;
    try {
      const res = await fetch(API_BASE + '/api/gemini-field-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, profileKeys: Object.keys(sessionData) }),
      });
      mapping = await res.json();
    } catch (e) {
      addMsg('AI se connect nahi ho paya: ' + e.message, 'ai');
      return;
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

    addMsg(`${count} field(s) bhar diye. Check karo, phir khud Submit karo.`, 'ai');
  }

  run();
})();
