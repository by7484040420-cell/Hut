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
     { key: 'district', pos: /district|\bjila\b|जिला/, neg: /court|pin ?code|std/ },
     { key: 'state', pos: /\bstate\b|rajya|राज्य|pradesh|province|domicile state/, neg: /domicile board|\bstatus\b|statement|pin ?code|std/ },
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
    [{ key: 'fullName', pos: /full ?name|applicant ?name|candidate ?name|student ?name|passenger ?name|your name|name (as per|of) (the )?(applicant|candidate|student|aadhaar|pan|matric)|applicant|candidate|naam|^name$|\bname\b|नाम/,
       neg: /father|mother|spouse|husband|wife|city|school|college|board|bank|account|company|organi[sz]ation|user ?name|user ?id|login ?id|file ?name|nominee|guardian|referee|hospital|institute|district|state|post|police|village|panchayat|branch/ }]
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

  var STATE_ALIASES = {
    'andhra pradesh': ['andhra pradesh', 'ap', 'आंध्र प्रदेश'],
    'arunachal pradesh': ['arunachal pradesh', 'ar', 'अरुणाचल प्रदेश'],
    'assam': ['assam', 'as', 'असम'],
    'bihar': ['bihar', 'br', 'बिहार'],
    'chhattisgarh': ['chhattisgarh', 'chattisgarh', 'cg', 'छत्तीसगढ़'],
    'goa': ['goa', 'ga', 'गोवा'],
    'gujarat': ['gujarat', 'gujrat', 'gj', 'गुजरात'],
    'haryana': ['haryana', 'hr', 'हरियाणा'],
    'himachal pradesh': ['himachal pradesh', 'hp', 'हिमाचल प्रदेश'],
    'jharkhand': ['jharkhand', 'jh', 'झारखंड', 'झारखण्ड'],
    'karnataka': ['karnataka', 'ka', 'कर्नाटक'],
    'kerala': ['kerala', 'kl', 'केरल'],
    'madhya pradesh': ['madhya pradesh', 'mp', 'मध्य प्रदेश'],
    'maharashtra': ['maharashtra', 'mh', 'महाराष्ट्र'],
    'manipur': ['manipur', 'mn', 'मणिपुर'],
    'meghalaya': ['meghalaya', 'ml', 'मेघालय'],
    'mizoram': ['mizoram', 'mz', 'मिजोरम'],
    'nagaland': ['nagaland', 'nl', 'नागालैंड'],
    'odisha': ['odisha', 'orissa', 'od', 'or', 'ओडिशा'],
    'punjab': ['punjab', 'pb', 'पंजाब'],
    'rajasthan': ['rajasthan', 'rj', 'राजस्थान'],
    'sikkim': ['sikkim', 'sk', 'सिक्किम'],
    'tamil nadu': ['tamil nadu', 'tamilnadu', 'tn', 'तमिलनाडु'],
    'telangana': ['telangana', 'ts', 'tg', 'तेलंगाना'],
    'tripura': ['tripura', 'tr', 'त्रिपुरा'],
    'uttar pradesh': ['uttar pradesh', 'up', 'उत्तर प्रदेश'],
    'uttarakhand': ['uttarakhand', 'uttaranchal', 'uk', 'ua', 'उत्तराखंड'],
    'west bengal': ['west bengal', 'wb', 'पश्चिम बंगाल'],
    'delhi': ['delhi', 'nct of delhi', 'new delhi', 'dl', 'दिल्ली', 'नई दिल्ली'],
    'jammu and kashmir': ['jammu and kashmir', 'jammu kashmir', 'jk', 'जम्मू और कश्मीर'],
    'ladakh': ['ladakh', 'la', 'लद्दाख'],
    'puducherry': ['puducherry', 'pondicherry', 'py', 'पुदुचेरी'],
    'chandigarh': ['chandigarh', 'ch', 'चंडीगढ़'],
    'andaman and nicobar islands': ['andaman and nicobar', 'andaman and nicobar islands', 'an'],
    'dadra and nagar haveli and daman and diu': ['dadra and nagar haveli', 'daman and diu', 'dadra and nagar haveli and daman and diu'],
    'lakshadweep': ['lakshadweep', 'ld']
  };

  function expandState(v) {
    var n = norm(v);
    var out = [n];
    Object.keys(STATE_ALIASES).forEach(function (k) {
      var list = STATE_ALIASES[k].map(norm);
      if (n === k || list.indexOf(n) >= 0) {
        out.push(k);
        list.forEach(function (item) { out.push(item); });
      }
    });
    return uniq(out);
  }

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
    var wants = key === 'state' ? expandState(wanted) : expandSyn(wanted);
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
      for (i = 0; i < wants.length; i++) {
        var sw = stateNorm(wants[i]), st = stateNorm(optText), sv = stateNorm(optValue);
        if (sw && (st === sw || sv === sw)) best = Math.max(best, 100);
        else if (sw && sw.length > 3 && (st.indexOf(sw) >= 0 || sw.indexOf(st) >= 0) && st.length > 3) best = Math.max(best, 75);
      }
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
        var cell = el.closest ? el.closest('td,th,.form-group,.form-field,.mat-form-field,.p-field,.input-group,.col,.row,div') : null;
        if (cell) {
          var before = cell.previousElementSibling;
          if (before && before.innerText && before.innerText.length < 80) txt += ' ' + before.innerText;
          else if (cell.querySelector) {
            var l = cell.querySelector('label,.label,.form-label,.col-form-label,mat-label,strong,b,span,p');
            if (l && l !== el && !l.contains(el) && l.innerText && l.innerText.length < 80) txt += ' ' + l.innerText;
          }
          if (!txt.trim() && cell.parentElement) {
            var pLabel = cell.parentElement.querySelector('label,.form-label,.col-form-label,th');
            if (pLabel && pLabel !== el && !pLabel.contains(el) && pLabel.innerText && pLabel.innerText.length < 80) {
              txt += ' ' + pLabel.innerText;
            }
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


  // ---------------------------------------------------------------
  // PORTAL SELECT DEFAULTS (PAN: Application Type / Applicant Category etc.)
  // Ye "form ka type" wale dropdown hain, user data me nahi hote -> yahan se choose hote hain
  // ---------------------------------------------------------------
  function portalSelectWant(hint, data) {
    var goal = norm((data && data.goal) || '');
    var page = norm((document.title || '') + ' ' + (root.location ? root.location.href : ''));
    if (/application type|type of application|new or change|new or correction|request type/.test(hint)) {
      if (/correction|change|update|reprint|duplicate|sudhar|badlav/.test(goal)) return 'changes or correction';
      return /\bpan\b/.test(page) ? 'new pan' : 'new';
    }
    if (/applicant (category|status|type)|category of (the )?applicant|individual.*(trust|huf)|(trust|huf).*individual/.test(hint)) {
      return 'individual';
    }
    return '';
  }

  // Terms / Declaration checkbox tick (sirf user ki permission ke baad hi call hota hai)
  function tickDeclarations() {
    var n = 0;
    Array.prototype.slice.call(document.querySelectorAll('input[type="checkbox"]')).forEach(function (cb) {
      if (cb.disabled || cb.checked) return;
      if (!isVisible(cb)) return;
      var h = hintOf(cb);
      if (RE_ROBOT.test(h) || RE_CAPTCHA.test(h)) return;   // "I'm not a robot" kabhi nahi
      if (!RE_DECLARATION.test(h)) return;
      try { cb.click(); } catch (e) { /* ignore */ }
      if (!cb.checked) { cb.checked = true; fire(cb, ['input', 'change']); }
      mark(cb.parentElement || cb, GREEN);
      n++;
    });
    return { ticked: n };
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

  function readableLabelOf(el, key) {
    var raw = labelTextOf(el) || el.placeholder || el.getAttribute('aria-label') || el.name || el.id || '';
    raw = String(raw).replace(/\s+/g, ' ').trim();
    if (raw && raw.length <= 80 && !/^sf\d+$/.test(raw)) return raw;
    var KEY_LABELS = {
      fullName: 'Full Name',
      firstName: 'First Name',
      middleName: 'Middle Name',
      lastName: 'Last Name',
      fatherName: "Father's Name",
      motherName: "Mother's Name",
      dob: 'Date of Birth',
      gender: 'Gender',
      category: 'Category / Caste',
      maritalStatus: 'Marital Status',
      bloodGroup: 'Blood Group',
      birthPlace: 'Birth Place',
      mobile: 'Mobile Number',
      alternateMobile: 'Alternate Mobile',
      email: 'Email Address',
      addressLine: 'Full Address',
      villageOrWard: 'Village / Ward / Locality',
      postOffice: 'Post Office',
      policeStation: 'Police Station / Thana',
      blockOrTehsil: 'Block / Tehsil',
      district: 'District / Jila',
      state: 'State / Rajya',
      pinCode: 'PIN Code',
      panNumber: 'PAN Number',
      aadhaarNumber: 'Aadhaar Number',
      passportNumber: 'Passport Number',
      dlNumber: 'Driving Licence Number',
      voterId: 'Voter ID (EPIC)',
      tenthBoard: '10th Board Name',
      tenthRoll: '10th Roll Number',
      tenthYear: '10th Passing Year',
      tenthPercent: '10th Percentage / Marks',
      twelfthBoard: '12th Board Name',
      twelfthRoll: '12th Roll Number',
      twelfthYear: '12th Passing Year',
      twelfthPercent: '12th Percentage / Marks',
      graduationDegree: 'Graduation Degree',
      collegeName: 'College / University',
      graduationYear: 'Graduation Year',
      graduationPercent: 'Graduation Percentage',
      qualification: 'Qualification'
    };
    if (key && KEY_LABELS[key]) return KEY_LABELS[key];
    return (raw || key || 'Required Field').slice(0, 80);
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
      isPersonalForm: false,
      declarations: 0, needsUser: [], missingFields: [], unmatched: [], filledKeys: [], filledItems: []
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
      if (el.readOnly && !/dob|birth/.test(hintOf(el))) return;   // readonly sirf DOB datepicker ke liye allowed

      var hint = hintOf(el);
      if (/\b(search|query|keyword|newsletter|subscribe|unsubscribe)\b|खोज/.test(hint)) return;
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

      // PAN-type dropdown (Application Type / Applicant Category): matchKey se pehle
      if (isSelect) {
        var pw = portalSelectWant(hint, data);
        if (pw && selectOption(el, pw, null)) {
          var pId = el.getAttribute('data-sarthi-id');
          if (!pId) { pId = 'sf' + (++uid); el.setAttribute('data-sarthi-id', pId); }
          mark(el, GREEN);
          summary.filled++;
          summary.portalSelects = (summary.portalSelects || 0) + 1;
          summary.filledItems.push({ id: pId, tag: 'select', type: 'select', value: (el.options[el.selectedIndex].text || pw).trim() });
          return;
        }
      }

      var key = matchKey(hint, { type: type, autocomplete: el.getAttribute('autocomplete') || '' });
      var val = key ? valueFor(key, data) : '';

      if (key && !val) {
        if (/^(fullName|firstName|fatherName|motherName|dob|aadhaarNumber|panNumber|addressLine|pinCode|district|state|tenthRoll|twelfthRoll)$/.test(key)) {
          summary.isPersonalForm = true;
        }
        // we know what it is but the vault has no value -> user must provide it in AI Popup
        if (summary.needsUser.indexOf(key) < 0) summary.needsUser.push(key);
        mark(el, BLUE);
        var mId = el.getAttribute('data-sarthi-id');
        if (!mId) { mId = 'sf' + (++uid); el.setAttribute('data-sarthi-id', mId); }
        var mOpts = [];
        if (isSelect) {
          for (var mi = 0; mi < el.options.length && mi < 50; mi++) {
            var mtx = (el.options[mi].text || '').trim();
            if (mtx && !/^(select|choose|please|--)/i.test(mtx)) mOpts.push(mtx);
          }
        }
        if (summary.missingFields.length < 30) {
          summary.missingFields.push({
            id: mId,
            key: key,
            label: readableLabelOf(el, key),
            tag: el.tagName.toLowerCase(),
            type: type,
            placeholder: el.placeholder || '',
            options: mOpts
          });
        }
        return;
      }

      if (key && val) {
        if (/^(fullName|firstName|fatherName|motherName|dob|aadhaarNumber|panNumber|addressLine|pinCode|district|state|tenthRoll|twelfthRoll)$/.test(key)) {
          summary.isPersonalForm = true;
        }
        var ok = false;
        var filledId = el.getAttribute('data-sarthi-id');
        if (!filledId) { filledId = 'sf' + (++uid); el.setAttribute('data-sarthi-id', filledId); }
        var finalVal = val;
        if (isSelect) {
          ok = selectOption(el, val, key);
          if (ok && el.selectedIndex >= 0) {
            finalVal = (el.options[el.selectedIndex].text || val).trim();
          }
        } else {
          if (key === 'dob') finalVal = formatDateForInput(val, type, el.placeholder, el.maxLength > 0 ? el.maxLength : 0);
          if (key === 'mobile' || key === 'alternateMobile') finalVal = String(val).replace(/\D/g, '').slice(-10);
          if (key === 'panNumber') finalVal = String(val).toUpperCase();
          if (el.maxLength > 0 && String(finalVal).length > el.maxLength && key !== 'dob') finalVal = String(finalVal).slice(0, el.maxLength);
          var wasRO = el.readOnly;
          if (wasRO) el.removeAttribute('readonly');
          setNativeValue(el, finalVal);
          if (wasRO) el.setAttribute('readonly', 'readonly');
          ok = true;
        }
        if (ok) {
          mark(el, GREEN);
          summary.filled++;
          if (summary.filledKeys.indexOf(key) < 0) summary.filledKeys.push(key);
          summary.filledItems.push({ id: filledId, tag: el.tagName.toLowerCase(), type: type, value: String(finalVal) });
          return;
        }
      }

      // not matched -> candidate for AI mapping (or AI Popup if Gemini doesn't have value)
      if (el.getAttribute('data-sarthi-asked')) return;      // is field ke liye AI ko pehle hi pooch chuke
      if (summary.unmatched.length < 40) {
        var id = el.getAttribute('data-sarthi-id');
        if (!id) { id = 'sf' + (++uid); el.setAttribute('data-sarthi-id', id); }
        el.setAttribute('data-sarthi-asked', '1');
        var o = [];
        if (isSelect) {
          for (var i = 0; i < el.options.length && o.length < 50; i++) {
            var tx = (el.options[i].text || '').trim();
            if (tx && !/^(select|choose|please|--)/i.test(tx)) o.push(tx);
          }
        }
        summary.unmatched.push({
          id: id, tag: el.tagName.toLowerCase(), type: type,
          name: el.name || '', label: readableLabelOf(el, null),
          rawHint: (hint || '').slice(0, 120),
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
      if (!want) {
        if (summary.needsUser.indexOf(key) < 0) summary.needsUser.push(key);
        var rgId = 'sfrg' + (++uid);
        var rgOpts = [];
        grp.forEach(function (r) {
          r.setAttribute('data-sarthi-radio-group', rgId);
          var rl = labelTextOf(r);
          if (rl && rgOpts.indexOf(rl) < 0) rgOpts.push(rl);
        });
        if (summary.missingFields.length < 30 && rgOpts.length > 0) {
          summary.missingFields.push({
            id: rgId,
            key: key,
            label: readableLabelOf(grp[0], key),
            tag: 'radio',
            type: 'radio',
            placeholder: '',
            options: rgOpts
          });
        }
        return;
      }
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
        if (/newsletter|subscribe|promotion|marketing|offers|updates|advertis|alert/.test(h)) return;
        summary.declarations++;
        if (!cb.checked) {
          try { cb.click(); } catch (e) { /* ignore */ }
          if (!cb.checked) { cb.checked = true; fire(cb, ['input', 'change']); }
          summary.filled++;
        }
        mark(cb.parentElement || cb, GREEN);
      }
    });

    // dependent dropdown: pehla select hone ke baad doosre ke options load hote hain -> thodi der baad dobara
    if (summary.portalSelects > 0 && !opts._retry) {
      setTimeout(function () { try { run(data, { _retry: true }); } catch (e) { /* ignore */ } }, 1200);
    }

    return summary;
  }

  // ---------------------------------------------------------------
  // 7. AI map (from Gemini): { sarthiId: value }
  // ---------------------------------------------------------------
  function applyMap(map) {
    var filled = 0;
    var filledItems = [];
    if (!map) return { filled: 0, filledItems: filledItems };
    Object.keys(map).forEach(function (id) {
      var val = map[id];
      if (val == null || val === '') return;

      // Support radio groups saved in missingFields
      var radioNodes = document.querySelectorAll('[data-sarthi-radio-group="' + id + '"]');
      if (radioNodes && radioNodes.length > 0) {
        var wants = expandSyn(String(val));
        var bestR = null, bestRs = 0;
        Array.prototype.forEach.call(radioNodes, function (r) {
          var rl = radioLabel(r);
          var sc = 0;
          wants.forEach(function (w) {
            if (rl === w) sc = Math.max(sc, 100);
            else if (rl.indexOf(w) >= 0) sc = Math.max(sc, 70);
          });
          if (sc > bestRs) { bestRs = sc; bestR = r; }
        });
        if (bestR) {
          bestR.checked = true;
          try { bestR.click(); } catch (e) { fire(bestR, ['input', 'change']); }
          mark(bestR.parentElement || bestR, GREEN);
          filled++;
        }
        return;
      }

      var el = document.querySelector('[data-sarthi-id="' + id + '"]');
      if (!el) return;
      var hint = hintOf(el);
      if (classifySecurity(hint)) return;               // AI ko bhi security fields nahi chhune dena
      var type = (el.type || el.tagName).toLowerCase();
      if (type === 'password') return;
      if (el.tagName === 'SELECT') {
        if (selectOption(el, String(val), null)) {
          mark(el, GREEN);
          filled++;
          var selTxt = (el.selectedIndex >= 0 && el.options[el.selectedIndex].text) ? el.options[el.selectedIndex].text.trim() : String(val);
          filledItems.push({ id: id, tag: 'select', type: 'select', value: selTxt });
        }
      } else {
        var v = String(val);
        if (parseDate(v) && (type === 'date' || /dob|birth|date/.test(hint))) v = formatDateForInput(v, type, el.placeholder, el.maxLength > 0 ? el.maxLength : 0);
        setNativeValue(el, v);
        mark(el, GREEN);
        filled++;
        filledItems.push({ id: id, tag: el.tagName.toLowerCase(), type: type, value: v });
      }
    });
    return { filled: filled, filledItems: filledItems };
  }


  // ---------------------------------------------------------------
  // AUTOPILOT: fill -> sab required bhare? -> Next/Continue click -> agla page
  // CAPTCHA / OTP / password / payment aur final Submit kabhi nahi dabata
  // ---------------------------------------------------------------
  var RE_NEXT = /^(next|next step|continue|proceed|go to next|save (and )?(next|continue|proceed)|save and continue|आगे|अगला|आगे बढ़ें|आगे बढे|जारी रखें|सेव और आगे)( |$)/;
  var RE_NO_CLICK = /submit|pay|payment|final|confirm|logout|sign ?out|cancel|back|previous|reset|clear|close|download|print|delete|remove|भुगतान|जमा|रद्द|पीछे|बंद/;
  var lastNextSig = '', lastNextAt = 0;

  function pageSig() {
    return (root.location ? root.location.href : '') + '|' + document.querySelectorAll('input,select,textarea').length + '|' + (document.title || '');
  }

  function emptyRequiredCount() {
    var n = 0, radioSeen = {};
    Array.prototype.slice.call(document.querySelectorAll('input,select,textarea')).forEach(function (el) {
      var type = (el.type || el.tagName).toLowerCase();
      if (/^(hidden|submit|button|reset|image|file|range|color|search|password)$/.test(type)) return;
      if (!isVisible(el) || el.disabled) return;
      var hint = hintOf(el);
      if (classifySecurity(hint) || RE_ROBOT.test(hint)) return;      // user ke kaam
      var req = el.required || el.getAttribute('aria-required') === 'true' || /\*/.test(labelTextOf(el));
      if (!req) return;
      if (type === 'checkbox') { if (!el.checked) n++; return; }
      if (type === 'radio') {
        var g = el.name || ('r' + n);
        if (radioSeen[g] === undefined) radioSeen[g] = false;
        if (el.checked) radioSeen[g] = true;
        return;
      }
      if (el.tagName === 'SELECT') {
        var cur = el.selectedIndex >= 0 ? norm(el.options[el.selectedIndex].text) : '';
        if (!el.value || /^(select|choose|please)/.test(cur)) n++;
        return;
      }
      if (!String(el.value || '').trim()) n++;
    });
    Object.keys(radioSeen).forEach(function (g) { if (!radioSeen[g]) n++; });
    return n;
  }

  function clickNext() {
    var els = Array.prototype.slice.call(document.querySelectorAll('button,a,input[type="button"],input[type="submit"],[role="button"]'));
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!isVisible(el)) continue;
      var txt = norm(el.innerText || el.value || el.getAttribute('aria-label') || '');
      if (!txt || txt.length > 30) continue;
      if (RE_NO_CLICK.test(txt)) continue;
      if (RE_NEXT.test(txt)) {
        try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
        try { el.click(); } catch (e) { fire(el, ['click']); }
        return txt;
      }
    }
    return '';
  }

  function autopilot(payload) {
    var s = run(payload, {});
    s.state = 'working';
    s.clicked = '';
    s.emptyRequired = emptyRequiredCount();
    if (s.hasCaptcha || s.hasOtp || s.hasPassword || s.hasPayment) { s.state = 'user'; return s; }
    if (s.emptyRequired > 0 || s.needsUser.length > 0 || s.unmatched.length > 0) { s.state = 'filling'; return s; }
    var sig = pageSig();
    if (sig === lastNextSig && Date.now() - lastNextAt < 10000) { s.state = 'waiting'; return s; }
    var t = clickNext();
    if (t) { lastNextSig = sig; lastNextAt = Date.now(); s.clicked = t; s.state = 'next'; }
    else { s.state = 'final'; }
    return s;
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
          if (/^(INPUT|SELECT|TEXTAREA|OPTION)$/.test(n.tagName) || (n.querySelector && n.querySelector('input,select,textarea'))) { relevant = true; break; }
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
    autopilot: autopilot,
    applyMap: applyMap,
    watch: watch,
    unwatch: unwatch,
    tickDeclarations: tickDeclarations,
    _internal: {
      norm: norm, matchKey: matchKey, classifySecurity: classifySecurity,
      parseDate: parseDate, formatDateForInput: formatDateForInput,
      bestOptionIndex: bestOptionIndex, expandSyn: expandSyn, splitName: splitName, valueFor: valueFor
    }
  };
  root.SarthiFill = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
