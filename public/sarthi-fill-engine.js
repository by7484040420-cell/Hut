/*
 * Sarthi-Narad Fill Engine  v2
 * ---------------------------------------------------------------
 * Hut (SarthiAI) ke native matcher + Narad AI ke injected engine ka merge.
 * Kisi bhi real website ke andar chalta hai (Android WebView ya Playwright).
 *
 * Kya karta hai:
 *  - Hindi/Hinglish/English labels se field pehchanta hai (naam, pita, janm, पता ...)
 *  - Text, textarea, select, radio, "same as" checkbox bharta hai
 *  - React/Angular safe (native setter + input/change/blur events)
 *  - CAPTCHA, OTP, password, payment/bank, declaration -> kabhi nahi bharta, sirf highlight
 *  - Jo field rules se nahi mile unki list deta hai -> AI (Gemini) unko map karta hai
 *  - Multi-step form: naya step aate hi dobara bharta hai (watch)
 *
 * Public API (window.SarthiFill):
 *   run(payload, opts)      -> summary object (JSON-serialisable)
 *   applyMap(map)           -> { filled }   (AI se aaya {sarthiId: value} map)
 *   watch(payload)          -> multi-step re-fill
 *   unwatch()
 *   _internal               -> pure helpers (testing ke liye)
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------
  // 1. Text normalisation
  // ---------------------------------------------------------------
  function norm(s) {
    return String(s == null ? '' : s)
      .replace(/([a-z])([A-Z])/g, '$1 $2')          // camelCase -> camel Case
      .toLowerCase()
      .replace(/[_\-./\\[\]():*#]+/g, ' ')
      .replace(/[^a-z0-9\u0900-\u097f ]+/g, ' ')     // latin + devanagari
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ---------------------------------------------------------------
  // 2. Security / never-fill classifiers
  // ---------------------------------------------------------------
  var RE_CAPTCHA = /captcha|security code|security text|verification code|enter the (code|text)|image text|कैप्चा|सुरक्षा कोड/;
  var RE_OTP = /\botp\b|one time|onetime|ओटीपी|mpin/;
  var RE_PASSWORD = /pass ?word|passwd|\bpwd\b|passcode|पासवर्ड/;
  var RE_PAYMENT = /card ?(no|number|num)|\bcvv\b|\bcvc\b|expiry|expire|\bupi\b|\bvpa\b|net ?banking|debit|credit|account ?(no|number|num)|\bifsc\b|\batm\b|bank ?account/;
  var RE_DECLARATION = /declaration|i agree|i accept|i hereby|terms|consent|undertaking|shapath|स्वीकार|घोषणा|सहमत/;
  var RE_ROBOT = /robot|human/;

  function classifySecurity(hint) {
    if (RE_CAPTCHA.test(hint)) return 'captcha';
    if (RE_OTP.test(hint)) return 'otp';
    if (RE_PASSWORD.test(hint)) return 'password';
    if (RE_PAYMENT.test(hint)) return 'payment';
    return null;
  }

  // ---------------------------------------------------------------
  // 3. Field rules (specific -> generic). First match wins.
  //    key  = payload key
  //    pos  = hint must match
  //    neg  = hint must NOT match
  // ---------------------------------------------------------------
  var T10 = '(10th|10 th|tenth|matric|matriculation|high ?school|\\bssc\\b|secondary|class ?x\\b|\\bx\\b|दसवीं|मैट्रिक)';
  var T12 = '(12th|12 th|twelfth|\\binter\\b|intermediate|\\bhsc\\b|senior secondary|class ?xii|\\bxii\\b|plus ?two|\\+2|बारहवीं|इंटर)';
  var GRAD = '(graduation|graduate|degree|bachelor|b ?sc|b ?a\\b|b ?com|b ?tech|ug\\b|स्नातक)';

  function eduRules(prefix, grp) {
    var g = new RegExp(grp);
    return [
      { key: prefix + 'Roll',    g: g, pos: /roll|seat|reg(istration)? ?(no|number)|रोल/, neg: /year/ },
      { key: prefix + 'Year',    g: g, pos: /year|passing|pass out|yop|वर्ष/, neg: /roll/ },
      { key: prefix + 'Percent', g: g, pos: /percent|percentage|marks|cgpa|grade|score|%|अंक|प्रतिशत/, neg: /roll|year|max|total|obtained marks max/ },
      { key: prefix + 'Board',   g: g, pos: /board|university|school|council|बोर्ड/, neg: /roll|year|percent/ },
      { key: prefix + 'Stream',  g: g, pos: /stream|subject|group|विषय/, neg: /roll|year|percent/ }
    ];
  }

  var RULES = [].concat(
    // names
    [{ key: 'firstName',  pos: /first name|given name|fname|पहला नाम/, neg: /father|mother|spouse/ },
     { key: 'middleName', pos: /middle name|mname/, neg: /father|mother/ },
     { key: 'lastName',   pos: /last name|surname|family name|lname|उपनाम/, neg: /father|mother/ },
     { key: 'fatherName', pos: /father|pita|guardian|s ?o\b|पिता/, neg: /mobile|phone|email|occupation|income|\bid\b|aadhaar/ },
     { key: 'motherName', pos: /mother|mata|माता|माँ/, neg: /mobile|phone|email|occupation|income|tongue|maiden/ }],

    // contact
    [{ key: 'alternateMobile', pos: /(alt|alternate|other|emergency|parent|guardian|whatsapp).*(mobile|phone|contact|number)|(mobile|phone|contact).*(alt|alternate|other|emergency)/, neg: /email/ },
     { key: 'email', pos: /e ?mail|ईमेल/, neg: /alt|parent|father|otp|verify|confirm email|re ?enter/ },
     { key: 'mobile', pos: /mobile|phone|contact (no|number)|cell|tel\b|मोबाइल|फोन/, neg: /alt|emergency|parent|father|landline|std|otp|country code/ }],

    // personal
    [{ key: 'birthPlace', pos: /place of birth|birth ?place|janm ?sthan|जन्म स्थान/, neg: /date/ },
     { key: 'dob', pos: /\bdob\b|date of birth|birth ?date|janm ?tithi|जन्म/, neg: /place|state|district|city|village|certificate|proof/ },
     { key: 'gender', pos: /gender|\bsex\b|ling\b|लिंग/, neg: /^$/ },
     { key: 'category', pos: /category|caste|\bvarg\b|reservation|वर्ग|श्रेणी/, neg: /sub ?category|certificate|number|issue/ },
     { key: 'maritalStatus', pos: /marital|married|vaivahik|वैवाहिक/, neg: /^$/ },
     { key: 'bloodGroup', pos: /blood ?group|rakht|रक्त/, neg: /^$/ }],

    // address
    [{ key: 'pinCode', pos: /pin ?code|\bpin\b|zip|postal|पिन/, neg: /security|otp|mpin|pan/ },
     { key: 'district', pos: /district|\bjila\b|जिला/, neg: /code|court/ },
     { key: 'state', pos: /\bstate\b|rajya|राज्य|province/, neg: /code|domicile board|status|statement/ },
     { key: 'blockOrTehsil', pos: /block|tehsil|tahsil|taluka|taluk|anchal|अंचल|तहसील|प्रखंड/, neg: /^$/ },
     { key: 'policeStation', pos: /police station|\bthana\b|थाना/, neg: /^$/ },
     { key: 'postOffice', pos: /post office|\bpo\b|डाकघर/, neg: /^$/ },
     { key: 'villageOrWard', pos: /village|\bgram\b|ward|mohalla|locality|town|गांव|ग्राम|मोहल्ला/, neg: /^$/ },
     { key: 'addressLine', pos: /address|\bpata\b|house|street|residen|पता/, neg: /e ?mail|\bip\b|web|proof|type|same/ }],

    // IDs
    [{ key: 'panNumber', pos: /\bpan\b|permanent account|पैन/, neg: /company|father|mother|pancha|panel|expan|company/ },
     { key: 'aadhaarNumber', pos: /aadhaar|aadhar|adhar|\buid\b|uidai|आधार/, neg: /enrol|virtual|vid\b|consent/ },
     { key: 'passportNumber', pos: /passport|पासपोर्ट/, neg: /issue|expiry|office|place|date/ },
     { key: 'dlNumber', pos: /driving ?licen[cs]e|\bdl\b ?(no|number)|licen[cs]e ?(no|number)|लाइसेंस/, neg: /issue|expiry|authority/ },
     { key: 'voterId', pos: /voter|epic|matdata|मतदाता/, neg: /^$/ }],

    // education (specific boards first)
    eduRules('tenth', T10),
    eduRules('twelfth', T12),
    [{ key: 'graduationDegree', pos: /degree|course|programme|qualification|योग्यता/, neg: /roll|year|percent|marks/, g: new RegExp(GRAD + '|degree|qualification') },
     { key: 'collegeName', pos: /college|university|institute|संस्थान|महाविद्यालय/, neg: /roll|year|percent|marks/ },
     { key: 'graduationYear', g: new RegExp(GRAD), pos: /year|passing/, neg: /roll/ },
     { key: 'graduationPercent', g: new RegExp(GRAD), pos: /percent|marks|cgpa|grade/, neg: /roll|year/ },
     { key: 'qualification', pos: /qualification|education|योग्यता|शिक्षा/, neg: /roll|year|percent/ },
     { key: 'boardOrUniversity', pos: /board|university|विश्वविद्यालय/, neg: /roll|year|percent/ },
     { key: 'passingYear', pos: /passing year|year of passing|pass out/, neg: /roll/ },
     { key: 'percentageOrGrade', pos: /percentage|percent|cgpa|grade|marks obtained|प्रतिशत/, neg: /roll|year|max/ }],

    // generic "name" last (so father/mother/first/last win first)
    [{ key: 'fullName', pos: /full ?name|applicant|candidate|student|your name|name of (the )?(applicant|candidate|student)|naam|^name$|\bname\b|नाम/,
       neg: /father|mother|spouse|husband|wife|city|school|college|board|bank|account|company|organi[sz]ation|user|login|file|nominee|guardian|referee|hospital|institute|district|state|post|police|village|panchayat/ }]
  );

  // flatten + ensure group filter works
  function matchKey(hint, ctx) {
    ctx = ctx || {};
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      if (r.g && !r.g.test(hint)) continue;
      if (r.pos.test(hint) && !(r.neg && r.neg.test(hint))) {
        // type shortcuts
        return r.key;
      }
    }
    // type-based fallbacks (when label is useless)
    if (ctx.type === 'email') return 'email';
    if (ctx.type === 'tel') return 'mobile';
    if (ctx.autocomplete) {
      var ac = ctx.autocomplete;
      if (/given-name/.test(ac)) return 'firstName';
      if (/family-name/.test(ac)) return 'lastName';
      if (/^name$/.test(ac)) return 'fullName';
      if (/bday/.test(ac)) return 'dob';
      if (/postal/.test(ac)) return 'pinCode';
      if (/street-address|address-line1/.test(ac)) return 'addressLine';
    }
    return null;
  }

  // ---------------------------------------------------------------
  // 4. Value helpers
  // ---------------------------------------------------------------
  function splitName(full) {
    var parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    return {
      first: parts[0] || '',
      last: parts.length > 1 ? parts[parts.length - 1] : '',
      middle: parts.length > 2 ? parts.slice(1, -1).join(' ') : ''
    };
  }

  function valueFor(key, data) {
    var n = splitName(data.fullName);
    switch (key) {
      case 'firstName': return data.firstName || n.first;
      case 'middleName': return data.middleName || n.middle;
      case 'lastName': return data.lastName || n.last;
      default: return data[key] || '';
    }
  }

  // dob -> {d,m,y} from "YYYY-MM-DD" or "DD/MM/YYYY" or "DD-MM-YYYY"
  function parseDate(v) {
    var s = String(v || '').trim();
    var m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (m) return { y: m[1], m: pad(m[2]), d: pad(m[3]) };
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
    if (m) return { y: m[3], m: pad(m[2]), d: pad(m[1]) };
    return null;
  }
  function pad(x) { x = String(x); return x.length < 2 ? '0' + x : x; }

  function formatDateForInput(dateStr, type, placeholder, maxLength) {
    var p = parseDate(dateStr);
    if (!p) return dateStr;
    if (type === 'date') return p.y + '-' + p.m + '-' + p.d;
    var ph = String(placeholder || '').toLowerCase();
    if (/yyyy[-\/.]mm[-\/.]dd/.test(ph)) return p.y + '-' + p.m + '-' + p.d;
    if (/mm[-\/.]dd[-\/.]yyyy/.test(ph)) return p.m + '/' + p.d + '/' + p.y;
    if (/dd-mm-yyyy/.test(ph)) return p.d + '-' + p.m + '-' + p.y;
    if (maxLength === 8) return p.d + p.m + p.y;
    return p.d + '/' + p.m + '/' + p.y;
  }

  // synonyms for dropdown / radio matching
  var SYN = {
    male: ['male', 'm', 'purush', 'पुरुष', 'man'],
    female: ['female', 'f', 'mahila', 'महिला', 'woman', 'stri'],
    other: ['other', 'transgender', 'third gender', 'अन्य'],
    general: ['general', 'gen', 'ur', 'unreserved', 'open', 'सामान्य'],
    obc: ['obc', 'other backward', 'bc', 'ebc', 'mbc', 'बीसी', 'पिछड़ा'],
    sc: ['sc', 'scheduled caste', 'अनुसूचित जाति'],
    st: ['st', 'scheduled tribe', 'अनुसूचित जनजाति'],
    ews: ['ews', 'economically weaker'],
    unmarried: ['unmarried', 'single', 'never married', 'अविवाहित'],
    married: ['married', 'विवाहित'],
    widowed: ['widowed', 'widow', 'widower', 'विधवा'],
    divorced: ['divorced', 'तलाकशुदा']
  };

  function expandSyn(v) {
    var n = norm(v);
    var out = [n];
    Object.keys(SYN).forEach(function (k) {
      if (n === k || SYN[k].indexOf(n) >= 0 || n.indexOf(k) === 0) {
        SYN[k].forEach(function (s) { out.push(norm(s)); });
        out.push(k);
      }
    });
    // "OBC (Non-Creamy)" -> obc, etc.
    var first = n.split(' ')[0];
    if (first && SYN[first]) SYN[first].forEach(function (s) { out.push(norm(s)); });
    return uniq(out);
  }
  function uniq(a) { var o = [], i; for (i = 0; i < a.length; i++) if (a[i] && o.indexOf(a[i]) < 0) o.push(a[i]); return o; }

  function stateNorm(s) {
    return norm(s).replace(/\band\b/g, '').replace(/\bnct of\b/g, '').replace(/\bu t\b/g, '').replace(/\s+/g, '');
  }

  // score option text vs wanted value (0 = no match)
  function scoreOption(optText, optValue, wanted, key) {
    var t = norm(optText), v = norm(optValue);
    if (!t && !v) return 0;
    if (/^(select|choose|--|please select|चुनें|चयन)/.test(t) && !v) return 0;
    var wants = expandSyn(wanted);
    var best = 0, i;
    for (i = 0; i < wants.length; i++) {
      var w = wants[i];
      if (!w) continue;
      if (t === w || v === w) best = Math.max(best, 100);
      else if (t.split(' ')[0] === w || v === w) best = Math.max(best, 80);
      else if (w.length > 2 && (t.indexOf(w) >= 0 || v.indexOf(w) >= 0)) best = Math.max(best, 60);
      else if (t.length > 2 && w.indexOf(t) >= 0) best = Math.max(best, 40);
    }
    if (key === 'state' || key === 'district') {
      var sw = stateNorm(wanted), st = stateNorm(optText), sv = stateNorm(optValue);
      if (sw && (st === sw || sv === sw)) best = Math.max(best, 100);
      else if (sw && sw.length > 3 && (st.indexOf(sw) >= 0 || sw.indexOf(st) >= 0) && st.length > 3) best = Math.max(best, 70);
    }
    // numeric years / percentages
    if (/^\d+(\.\d+)?%?$/.test(String(wanted).trim())) {
      var num = String(wanted).replace('%', '').trim();
      if (t === num || v === num) best = Math.max(best, 100);
    }
    return best;
  }

  function bestOptionIndex(options, wanted, key) {
    var bi = -1, bs = 0, i;
    for (i = 0; i < options.length; i++) {
      var sc = scoreOption(options[i].text, options[i].value, wanted, key);
      if (sc > bs) { bs = sc; bi = i; }
    }
    return bs >= 40 ? bi : -1;
  }

  // ---------------------------------------------------------------
  // 5. DOM helpers
  // ---------------------------------------------------------------
  var uid = 0;

  function isVisible(el) {
    if (!el || el.disabled) return false;
    var st = root.getComputedStyle ? root.getComputedStyle(el) : null;
    if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
    if (el.offsetParent === null && st && st.position !== 'fixed') return false;
    return true;
  }

  function labelTextOf(el) {
    var txt = '';
    try {
      if (el.labels && el.labels.length) {
        for (var i = 0; i < el.labels.length; i++) txt += ' ' + (el.labels[i].innerText || el.labels[i].textContent || '');
      }
      if (!txt && el.id) {
        var lb = document.querySelector('label[for="' + el.id.replace(/"/g, '\\"') + '"]');
        if (lb) txt += ' ' + (lb.innerText || lb.textContent || '');
      }
      if (!txt) {
        var wrap = el.closest ? el.closest('label') : null;
        if (wrap) txt += ' ' + (wrap.innerText || wrap.textContent || '');
      }
      var lb2 = el.getAttribute('aria-labelledby');
      if (lb2) {
        lb2.split(/\s+/).forEach(function (id) {
          var n = document.getElementById(id);
          if (n) txt += ' ' + (n.innerText || n.textContent || '');
        });
      }
      // table layouts / bootstrap: previous sibling text, or first <th>/<td> in row
      if (!txt.trim()) {
        var prev = el.previousElementSibling;
        if (prev && prev.innerText && prev.innerText.length < 80) txt += ' ' + prev.innerText;
      }
      if (!txt.trim()) {
        var cell = el.closest ? el.closest('td,th,.form-group,.col,.row,div') : null;
        if (cell) {
          var before = cell.previousElementSibling;
          if (before && before.innerText && before.innerText.length < 80) txt += ' ' + before.innerText;
          else if (cell.querySelector) {
            var l = cell.querySelector('label,.label,span');
            if (l && l !== el && l.innerText && l.innerText.length < 80) txt += ' ' + l.innerText;
          }
        }
      }
    } catch (e) { /* ignore */ }
    return txt;
  }

  function hintOf(el) {
    return norm([
      el.name, el.id, el.placeholder, el.title,
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('data-label'),
      labelTextOf(el)
    ].join(' '));
  }

  function setNativeValue(el, val) {
    el.focus && el.focus();
    var proto = el.tagName === 'TEXTAREA' ? root.HTMLTextAreaElement.prototype : root.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, val); else el.value = val;
    fire(el, ['input', 'keyup', 'change', 'blur']);
  }

  function fire(el, names) {
    names.forEach(function (n) {
      try { el.dispatchEvent(new Event(n, { bubbles: true })); } catch (e) { /* ignore */ }
    });
  }

  function mark(el, color) {
    try { el.style.outline = '2px solid ' + color; el.style.outlineOffset = '1px'; } catch (e) { /* ignore */ }
  }
  var GREEN = '#10b981', AMBER = '#f59e0b', BLUE = '#3b82f6';

  function selectOption(sel, wanted, key) {
    var opts = [], i;
    for (i = 0; i < sel.options.length; i++) opts.push({ text: sel.options[i].text, value: sel.options[i].value });
    var idx = bestOptionIndex(opts, wanted, key);
    if (idx < 0) return false;
    sel.selectedIndex = idx;
    fire(sel, ['input', 'change', 'blur']);
    return true;
  }

  function groupRadios(radios) {
    var g = {};
    radios.forEach(function (r) {
      var k = r.name || ('__nogroup' + (uid++));
      (g[k] = g[k] || []).push(r);
    });
    return g;
  }

  function radioLabel(r) {
    return norm(labelTextOf(r) + ' ' + (r.value || '') + ' ' + (r.getAttribute('aria-label') || ''));
  }

  // ---------------------------------------------------------------
  // 6. Main run
  // ---------------------------------------------------------------
  function run(payload, opts) {
    opts = opts || {};
    var data = payload || {};
    var summary = {
      filled: 0, url: root.location ? root.location.href : '',
      title: document.title || '',
      hasCaptcha: false, hasOtp: false, hasPassword: false, hasPayment: false,
      declarations: 0, needsUser: [], unmatched: [], filledKeys: []
    };

    var controls = Array.prototype.slice.call(
      document.querySelectorAll('input,select,textarea')
    );

    // radios handled as groups after the loop
    var radios = [];
    var checks = [];

    controls.forEach(function (el) {
      var type = (el.type || el.tagName).toLowerCase();
      if (/^(hidden|submit|button|reset|image|file|range|color)$/.test(type)) return;
      if (!isVisible(el)) return;
      if (type === 'search') return;                       // search boxes kabhi nahi bharna
      if (type === 'radio') { radios.push(el); return; }
      if (type === 'checkbox') { checks.push(el); return; }
      if (el.readOnly) return;

      var hint = hintOf(el);
      if (/\bsearch\b|\bquery\b|खोज/.test(hint)) return;
      var sec = classifySecurity(hint) || (type === 'password' ? 'password' : null);
      if (sec) {
        mark(el, AMBER);
        if (sec === 'captcha') summary.hasCaptcha = true;
        else if (sec === 'otp') summary.hasOtp = true;
        else if (sec === 'password') summary.hasPassword = true;
        else if (sec === 'payment') summary.hasPayment = true;
        return;
      }

      var isSelect = el.tagName === 'SELECT';
      var already = !isSelect && el.value && String(el.value).trim().length > 0;
      if (already && !opts.overwrite) return;
      if (isSelect && el.selectedIndex > 0 && !opts.overwrite) {
        // dropdown already chosen by user/site
        var curTxt = norm(el.options[el.selectedIndex].text);
        if (curTxt && !/^(select|choose|please)/.test(curTxt)) return;
      }

      var key = matchKey(hint, { type: type, autocomplete: el.getAttribute('autocomplete') || '' });
      var val = key ? valueFor(key, data) : '';

      if (key && !val) {
        // we know what it is but the vault has no value -> user must type it
        if (summary.needsUser.indexOf(key) < 0) summary.needsUser.push(key);
        mark(el, BLUE);
        return;
      }

      if (key && val) {
        var ok = false;
        if (isSelect) {
          ok = selectOption(el, val, key);
        } else {
          if (key === 'dob') val = formatDateForInput(val, type, el.placeholder, el.maxLength > 0 ? el.maxLength : 0);
          if (key === 'mobile' || key === 'alternateMobile') val = String(val).replace(/\D/g, '').slice(-10);
          if (key === 'panNumber') val = String(val).toUpperCase();
          if (el.maxLength > 0 && String(val).length > el.maxLength && key !== 'dob') val = String(val).slice(0, el.maxLength);
          setNativeValue(el, val);
          ok = true;
        }
        if (ok) {
          mark(el, GREEN);
          summary.filled++;
          if (summary.filledKeys.indexOf(key) < 0) summary.filledKeys.push(key);
          return;
        }
      }

      // not matched -> candidate for AI mapping
      if (summary.unmatched.length < 40) {
        var id = el.getAttribute('data-sarthi-id');
        if (!id) { id = 'sf' + (++uid); el.setAttribute('data-sarthi-id', id); }
        var o = [];
        if (isSelect) {
          for (var i = 0; i < el.options.length && o.length < 40; i++) {
            var tx = (el.options[i].text || '').trim();
            if (tx) o.push(tx);
          }
        }
        summary.unmatched.push({
          id: id, tag: el.tagName.toLowerCase(), type: type,
          name: el.name || '', label: (hint || '').slice(0, 120),
          placeholder: el.placeholder || '', options: o
        });
      }
    });

    // radios
    var groups = groupRadios(radios);
    Object.keys(groups).forEach(function (gk) {
      var grp = groups[gk];
      if (grp.some(function (r) { return r.checked; }) && !opts.overwrite) return;
      var gh = norm(gk + ' ' + grp.map(function (r) { return labelTextOf(r.closest ? (r.closest('fieldset,.form-group,div') || r) : r); }).join(' ').slice(0, 200));
      var key = null;
      if (/gender|\bsex\b|ling|लिंग/.test(gh)) key = 'gender';
      else if (/marital|married|vaivahik/.test(gh)) key = 'maritalStatus';
      else if (/category|caste|varg/.test(gh)) key = 'category';
      else {
        // option labels themselves tell us (male/female)
        var labs = grp.map(radioLabel).join(' ');
        if (/\bmale\b/.test(labs) && /\bfemale\b/.test(labs)) key = 'gender';
      }
      if (!key) return;
      var want = valueFor(key, data);
      if (!want) { if (summary.needsUser.indexOf(key) < 0) summary.needsUser.push(key); return; }
      var wants = expandSyn(want), pick = null, bs = 0;
      grp.forEach(function (r) {
        var lab = radioLabel(r);
        var sc = 0;
        wants.forEach(function (w) {
          if (lab === w) sc = Math.max(sc, 100);
          else if (new RegExp('(^| )' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(lab)) sc = Math.max(sc, 70);
        });
        // "male" must not match "female"
        if (/^male$|^m$/.test(wants[0]) && /female/.test(lab)) sc = 0;
        if (sc > bs) { bs = sc; pick = r; }
      });
      if (pick && bs >= 70) {
        pick.checked = true;
        try { pick.click(); } catch (e) { fire(pick, ['input', 'change']); }
        mark(pick.parentElement || pick, GREEN);
        summary.filled++;
        if (summary.filledKeys.indexOf(key) < 0) summary.filledKeys.push(key);
      }
    });

    // checkboxes: only "same as" is auto-ticked; declarations are NEVER auto-ticked
    checks.forEach(function (cb) {
      var h = hintOf(cb);
      if (RE_ROBOT.test(h) || RE_CAPTCHA.test(h)) { summary.hasCaptcha = true; mark(cb.parentElement || cb, AMBER); return; }
      if (/same as|permanent same|correspondence same|same address|दोनों पते/.test(h)) {
        if (!cb.checked) {
          try { cb.click(); } catch (e) { cb.checked = true; fire(cb, ['input', 'change']); }
          mark(cb.parentElement || cb, GREEN);
          summary.filled++;
        }
        return;
      }
      if (RE_DECLARATION.test(h)) {
        summary.declarations++;
        mark(cb.parentElement || cb, AMBER);
      }
    });

    return summary;
  }

  // ---------------------------------------------------------------
  // 7. AI map (from Gemini): { sarthiId: value }
  // ---------------------------------------------------------------
  function applyMap(map) {
    var filled = 0;
    if (!map) return { filled: 0 };
    Object.keys(map).forEach(function (id) {
      var el = document.querySelector('[data-sarthi-id="' + id + '"]');
      var val = map[id];
      if (!el || val == null || val === '') return;
      var hint = hintOf(el);
      if (classifySecurity(hint)) return;               // AI ko bhi security fields nahi chhune dena
      var type = (el.type || el.tagName).toLowerCase();
      if (type === 'password') return;
      if (el.tagName === 'SELECT') {
        if (selectOption(el, String(val), null)) { mark(el, GREEN); filled++; }
      } else {
        var v = String(val);
        if (parseDate(v) && (type === 'date' || /dob|birth|date/.test(hint))) v = formatDateForInput(v, type, el.placeholder, el.maxLength > 0 ? el.maxLength : 0);
        setNativeValue(el, v);
        mark(el, BLUE);
        filled++;
      }
    });
    return { filled: filled };
  }

  // ---------------------------------------------------------------
  // 8. Multi-step watcher
  // ---------------------------------------------------------------
  var observer = null, watchRuns = 0, watchTimer = null;

  function watch(payload) {
    unwatch();
    if (typeof MutationObserver === 'undefined') return;
    watchRuns = 0;
    observer = new MutationObserver(function (muts) {
      var relevant = false;
      for (var i = 0; i < muts.length && !relevant; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          if (/^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName) || (n.querySelector && n.querySelector('input,select,textarea'))) { relevant = true; break; }
        }
      }
      if (!relevant || watchRuns >= 20) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(function () {
        watchRuns++;
        try { run(payload, {}); } catch (e) { /* ignore */ }
      }, 1200);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function unwatch() {
    if (observer) { observer.disconnect(); observer = null; }
    clearTimeout(watchTimer);
  }

  // ---------------------------------------------------------------
  // export
  // ---------------------------------------------------------------
  var api = {
    version: 2,
    run: run,
    applyMap: applyMap,
    watch: watch,
    unwatch: unwatch,
    _internal: {
      norm: norm, matchKey: matchKey, classifySecurity: classifySecurity,
      parseDate: parseDate, formatDateForInput: formatDateForInput,
      bestOptionIndex: bestOptionIndex, expandSyn: expandSyn, splitName: splitName, valueFor: valueFor
    }
  };
  root.SarthiFill = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
