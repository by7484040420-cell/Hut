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

  // Java har tick pe ye file dobara inject karta hai. Agar engine pehle se loaded hai to dobara mat banao,
  // warna state (fillingTicks, askedSig, ids) har baar reset ho jata hai aur AI user se kuch poochta hi nahi.
  if (root.SarthiFill && root.SarthiFill.version === 4) return;

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
    [{ key: 'addressLine', pos: /flat|door|building|road|street|sector|house no|plot/, neg: /e ?mail|proof|type|same|police|station|pin ?code|post office/ },
     { key: 'pinCode', pos: /pin ?code|\bpin\b|postal|पिन/, neg: /security|otp|mpin|pan/ },
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

  // Father/Mother ka poora naam -> label ke hisaab se First / Middle / Last
  function parentPart(full, hint) {
    var n = splitName(full);
    if (/middle/.test(hint)) return n.middle ? n.middle : null;
    if (/first name|given name|\bfirst\b/.test(hint)) return n.first;
    if (/last name|surname|\blast\b/.test(hint)) return n.last || n.first;
    return full;
  }

  function valueFor(key, data) {
    var n = splitName(data.fullName);
    switch (key) {
      case 'firstName': return data.firstName || n.first;
      case 'middleName': return data.middleName || n.middle;
      case 'lastName': return data.lastName || n.last;
      case 'villageOrWard': return data.villageOrWard || data.addressLine || '';
      case 'postOffice': return data.postOffice || data.villageOrWard || data.district || '';
      case 'blockOrTehsil': return data.blockOrTehsil || data.district || '';
      case 'policeStation': return data.policeStation || data.district || '';
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
    // Country code / ISD / nationality: user ne India hi chahiye (popup me poochne ki zarurat nahi)
    if (/country code|isd|std code of country|dial(ing)? code/.test(hint)) return 'india (91)';
    if (/nationality|citizenship|country of (citizenship|nationality)/.test(hint)) return 'indian';
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
      if ((key === 'fatherName' || key === 'motherName') && val) {
        var pp = parentPart(val, hint);
        if (pp === null) return;                     // middle name nahi hai -> khali chhodo
        val = pp;
      }
      if (key === 'middleName' && !val) return;      // middle name optional

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
      if (!key) {
        // Citizenship / Nationality radio: Indian Citizen khud chuno (NRI / Foreign nahi)
        var cLabs = grp.map(radioLabel).join(' ');
        if (/citizen|nationality/.test(gh) || /indian citizen/.test(cLabs)) {
          var cPick = null;
          grp.forEach(function (r) {
            var l = radioLabel(r);
            if (!cPick && /indian/.test(l) && !/nri|foreign|non/.test(l)) cPick = r;
          });
          if (cPick && !cPick.checked) {
            cPick.checked = true;
            try { cPick.click(); } catch (e) { fire(cPick, ['input', 'change']); }
            mark(cPick.parentElement || cPick, GREEN);
            summary.filled++;
          }
        }
        return;
      }
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

  function isRequiredEl(el) {
    return !!(el.required || el.getAttribute('aria-required') === 'true' || /\*/.test(labelTextOf(el)));
  }

  function optionsOf(el) {
    var o = [];
    for (var i = 0; i < el.options.length && o.length < 50; i++) {
      var tx = (el.options[i].text || '').trim();
      if (tx && !/^(select|choose|please|--)/i.test(tx)) o.push(tx);
    }
    return o;
  }

  // Khali required fields ki list (AI ko user se poochna ho ya upload karwana ho)
  function emptyRequiredList() {
    var out = [], radios = {};
    Array.prototype.slice.call(document.querySelectorAll('input,select,textarea')).forEach(function (el) {
      var type = (el.type || el.tagName).toLowerCase();
      if (/^(hidden|submit|button|reset|image|range|color|search|password)$/.test(type)) return;
      if (el.disabled || (type !== 'file' && !isVisible(el))) return;   // file input aksar hidden hota hai
      if (el.readOnly && type !== 'checkbox') return;
      var hint = hintOf(el);
      if (classifySecurity(hint) || RE_ROBOT.test(hint)) return;      // user ke kaam
      if (!isRequiredEl(el)) return;
      var id = el.getAttribute('data-sarthi-id');
      if (!id) { id = 'sf' + (++uid); el.setAttribute('data-sarthi-id', id); }
      var key = matchKey(hint, { type: type, autocomplete: el.getAttribute('autocomplete') || '' });
      if (type === 'file') {
        if (!(el.files && el.files.length)) {
          var fl = readableLabelOf(el, null);
          var fh = norm(fl + ' ' + hint);
          var dk = /photo|photograph|passport size|picture|selfie/.test(fh) ? 'photo' : (/sign/.test(fh) ? 'signature' : 'doc');
          mark(el.parentElement || el, AMBER);
          out.push({ id: id, kind: 'file', docKind: dk, key: '', label: fl });
        }
        return;
      }
      if (type === 'checkbox') { if (!el.checked) out.push({ id: id, kind: 'checkbox', key: '', label: readableLabelOf(el, null) }); return; }
      if (type === 'radio') {
        var g = el.name || id;
        if (!radios[g]) radios[g] = { els: [], checked: false };
        radios[g].els.push(el);
        if (el.checked) radios[g].checked = true;
        return;
      }
      if (el.tagName === 'SELECT') {
        var cur = el.selectedIndex >= 0 ? norm(el.options[el.selectedIndex].text) : '';
        if (!el.value || /^(select|choose|please)/.test(cur)) {
          var opts = optionsOf(el);
          if (opts.length === 0) { out.push({ id: id, kind: 'wait', key: '', label: readableLabelOf(el, key) }); return; }   // options abhi load ho rahe hain
          var pw2 = portalSelectWant(hint, {});
          if (pw2 && selectOption(el, pw2, null)) return;                                                               // Individual / New PAN jaise default
          out.push({ id: id, kind: 'select', key: key || '', label: readableLabelOf(el, key), tag: 'select', type: 'select', options: opts });
        }
        return;
      }
      if (!String(el.value || '').trim()) {
        out.push({ id: id, kind: 'text', key: key || '', label: readableLabelOf(el, key), tag: el.tagName.toLowerCase(), type: type, placeholder: el.placeholder || '', options: [] });
      }
    });
    Object.keys(radios).forEach(function (g) {
      var r = radios[g];
      if (r.checked) return;
      var rgId = 'sfrg' + (++uid), opts = [];
      r.els.forEach(function (x) {
        x.setAttribute('data-sarthi-radio-group', rgId);
        var rl = labelTextOf(x); if (rl && opts.indexOf(rl.trim()) < 0) opts.push(rl.trim());
      });
      out.push({ id: rgId, kind: 'radio', key: '', label: readableLabelOf(r.els[0], null), tag: 'radio', type: 'radio', options: opts });
    });
    return out;
  }

  // User se kya poochna hai (key wale ek hi baar: Father ka naam ek baar, First/Middle/Last engine khud todta hai)
  function buildAsks(list, s) {
    var seen = {}, asks = [];
    function add(a) {
      var k = a.key ? 'k:' + a.key : 'i:' + a.id;
      if (seen[k]) return;
      // dropdown ke options abhi load nahi hue (dependent dropdown) -> user kya chunega, thoda ruko
      if ((a.type === 'select' || a.tag === 'select') && !(a.options && a.options.length)) return;
      seen[k] = 1;
      var lbl = a.label || 'Detail';
      if (a.key === 'fatherName') lbl = "Father ka poora naam (First Middle Last)";
      else if (a.key === 'motherName') lbl = "Mother ka poora naam (First Middle Last)";
      else if (a.key === 'mobile') lbl = 'Mobile number';
      else if (a.key === 'email') lbl = 'Email ID';
      asks.push({ id: a.id, key: a.key || '', label: lbl, type: a.type || 'text', options: a.options || [] });
    }
    (s.missingFields || []).forEach(function (m) {
      var el = document.querySelector('[data-sarthi-id="' + m.id + '"]') || document.querySelector('[data-sarthi-radio-group="' + m.id + '"]');
      var core = /^(fatherName|motherName|mobile|email|dob|gender|fullName|firstName|lastName|pinCode|addressLine|state|district)$/.test(m.key);
      if (core || (el && isRequiredEl(el))) add(m);
    });
    list.forEach(function (a) { if (a.kind === 'text' || a.kind === 'select' || a.kind === 'radio') add(a); });
    return asks.slice(0, 12);
  }

  // Form complete (acknowledgement/success page) pehchano
  function looksFinished(list) {
    if (list.length > 0) return false;
    var vis = Array.prototype.slice.call(document.querySelectorAll('input:not([type="hidden"]),select,textarea')).filter(isVisible);
    if (vis.length > 3) return false;
    var t = norm(((document.body && document.body.innerText) || '').slice(0, 4000));
    return /application (has been |is )?(successfully )?(submitted|registered)|successfully (submitted|registered|completed|booked)|acknowledg(e)?ment (number|no|receipt)|transaction (is )?successful|booking (is )?confirmed|आवेदन सफलतापूर्वक|सफलतापूर्वक जमा/.test(t);
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

  var fillingTicks = 0, askedSig = '';

  // ---------------------------------------------------------------
  // AI PAGE READER: jab rules page ko na samjhein (custom JS widgets, naye layout)
  // snapshot() page ka naksha Gemini ko bhejta hai, applyPlan() uska jawab lagata hai.
  // CAPTCHA/OTP/password/payment/Submit/Pay kabhi nahi chhuta.
  // ---------------------------------------------------------------
  var CUSTOM_SEL = '[role="combobox"],[role="listbox"],[role="radio"],[role="checkbox"],[role="switch"],[contenteditable="true"],mat-select,.select2-selection,[class*="select__control"]';
  var PLAN_NO_CLICK = /submit|pay|payment|final|confirm|logout|sign ?out|cancel|back|previous|reset|clear|close|download|print|delete|remove|draft|verify|send otp|get otp|generate|upload|choose file|esign|e sign|digilocker|भुगतान|जमा|रद्द|पीछे|बंद/;

  function sectionOf(el) {
    try {
      var fs = el.closest && el.closest('fieldset');
      if (fs) { var lg = fs.querySelector('legend'); if (lg && lg.innerText) return lg.innerText.trim().slice(0, 60); }
      var n = el, hops = 0;
      while (n && hops < 8) {
        var prev = n.previousElementSibling;
        while (prev) {
          if (/^H[1-5]$/.test(prev.tagName) && prev.innerText) return prev.innerText.trim().slice(0, 60);
          var h = prev.querySelector && prev.querySelector('h1,h2,h3,h4,h5,legend');
          if (h && h.innerText) return h.innerText.trim().slice(0, 60);
          prev = prev.previousElementSibling;
        }
        n = n.parentElement; hops++;
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  function snapshot() {
    var fields = [], buttons = [], headings = [];
    var all = document.querySelectorAll('input,select,textarea,' + CUSTOM_SEL);
    for (var i = 0; i < all.length && fields.length < 80; i++) {
      var el = all[i];
      var type = (el.type || el.getAttribute('role') || el.tagName).toLowerCase();
      if (/^(hidden|submit|button|reset|image|range|color|search|password)$/.test(type)) continue;
      if (!isVisible(el) || el.disabled) continue;
      var hint = '';
      try { hint = hintOf(el); } catch (e) { hint = norm(el.getAttribute('aria-label') || el.textContent || ''); }
      if (classifySecurity(hint) || RE_ROBOT.test(hint)) continue;
      var id = el.getAttribute('data-sarthi-id');
      if (!id) { id = 'sf' + (++uid); el.setAttribute('data-sarthi-id', id); }
      var label = '';
      try { label = readableLabelOf(el, null); } catch (e) { /* ignore */ }
      if (!label) label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || '').trim().slice(0, 80);
      var value = '';
      if (el.tagName === 'SELECT') value = el.selectedIndex >= 0 ? (el.options[el.selectedIndex].text || '').trim() : '';
      else if (type === 'checkbox' || type === 'radio') value = el.checked ? 'checked' : '';
      else if ('value' in el) value = String(el.value || '');
      else value = (el.textContent || '').trim().slice(0, 60);
      fields.push({
        id: id, tag: el.tagName.toLowerCase(), type: type, label: label, value: value.slice(0, 60),
        required: isRequiredEl(el), section: sectionOf(el),
        options: el.tagName === 'SELECT' ? optionsOf(el) : []
      });
    }
    var bs = document.querySelectorAll('button,a[href],input[type="button"],input[type="submit"],[role="button"]');
    for (var j = 0; j < bs.length && buttons.length < 30; j++) {
      var b = bs[j];
      if (!isVisible(b)) continue;
      var tx = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim();
      if (!tx || tx.length > 40) continue;
      var bid = b.getAttribute('data-sarthi-id');
      if (!bid) { bid = 'sfb' + (++uid); b.setAttribute('data-sarthi-id', bid); }
      buttons.push({ id: bid, text: tx });
    }
    Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3,legend')).forEach(function (h) {
      if (headings.length < 12 && isVisible(h) && h.innerText) headings.push(h.innerText.trim().slice(0, 80));
    });
    return { url: root.location ? root.location.href : '', title: document.title || '', headings: headings, fields: fields, buttons: buttons };
  }

  function fillCustom(el, value) {
    var role = el.getAttribute('role') || '';
    if (el.isContentEditable) {
      el.textContent = value; fire(el, ['input', 'change']); return;
    }
    if (role === 'radio' || role === 'checkbox' || role === 'switch') {
      if (el.getAttribute('aria-checked') !== 'true') el.click();
      return;
    }
    // dropdown / autocomplete: kholo, option dhoondo, click karo
    if (el.tagName === 'INPUT') { setNativeValue(el, value); fire(el, ['input']); }
    try { el.click(); } catch (e) { /* ignore */ }
    setTimeout(function () {
      var want = norm(value), best = null, bestScore = 0;
      Array.prototype.slice.call(document.querySelectorAll('[role="option"],mat-option,.mat-option,.select2-results__option,[class*="option"],ul li')).forEach(function (o) {
        if (!isVisible(o)) return;
        var t = norm(o.innerText || o.textContent || '');
        if (!t) return;
        var sc = t === want ? 100 : (t.indexOf(want) >= 0 || want.indexOf(t) >= 0 ? 60 : 0);
        if (sc > bestScore) { bestScore = sc; best = o; }
      });
      if (best) { try { best.click(); } catch (e) { fire(best, ['click']); } }
    }, 450);
  }

  function applyPlan(plan) {
    plan = plan || {};
    var res = { filled: 0, clickQueued: '' };
    var fills = plan.fills || {}, std = {}, custom = [];
    Object.keys(fills).forEach(function (id) {
      var el = document.querySelector('[data-sarthi-id="' + id + '"]');
      var role = el ? (el.getAttribute('role') || '') : '';
      if (!el || (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !/^(combobox|listbox|radio|checkbox|switch)$/.test(role) && !el.isContentEditable)) std[id] = fills[id];
      else custom.push({ el: el, value: fills[id] });
    });
    if (Object.keys(std).length) res.filled += (applyMap(std).filled || 0);
    custom.forEach(function (c, i) {
      setTimeout(function () { try { fillCustom(c.el, c.value); } catch (e) { /* ignore */ } }, 600 * i);
      res.filled++;
    });
    if (plan.click) {
      var btn = document.querySelector('[data-sarthi-id="' + plan.click + '"]');
      var bt = btn ? norm(btn.innerText || btn.value || btn.getAttribute('aria-label') || '') : '';
      if (btn && bt && !PLAN_NO_CLICK.test(bt)) {
        res.clickQueued = bt;
        setTimeout(function () {
          try { btn.scrollIntoView({ block: 'center' }); btn.click(); } catch (e) { fire(btn, ['click']); }
        }, 600 * (custom.length + 1) + 900);
      }
    }
    return res;
  }

  // ---------------------------------------------------------------
  // FORM PROFILES: AI ko pata hai kaunsa form banane me kaun si details/documents lagte hain
  // (rules badal sakte hain - portal ka page final hai)
  // ---------------------------------------------------------------
  var ASK_LABELS = {
    fullName: 'Poora naam (jaise Aadhaar me hai)', dob: 'Date of Birth (DD/MM/YYYY)', gender: 'Gender',
    fatherName: 'Father ka poora naam (First Middle Last)', motherName: 'Mother ka poora naam (First Middle Last)',
    mobile: 'Mobile number', email: 'Email ID', addressLine: 'Poora address', pinCode: 'PIN code',
    state: 'State', birthPlace: 'Janm sthan (Place of birth)', bloodGroup: 'Blood group', qualification: 'Qualification'
  };
  var PROFILES = [
    { name: 'PAN Card',
      test: /proteantech|tin-nsdl|tin\.nsdl|utiitsl|nsdl\.co|new pan|form 49a|pan application/,
      keys: ['fullName', 'dob', 'gender', 'fatherName', 'mobile', 'email'],
      docs: ['Aadhaar card (eKYC me Aadhaar-linked mobile ka OTP lagta hai)',
             'Aadhaar na ho to ID proof + address proof + DOB proof (voter ID / DL / 10th marksheet / birth certificate)',
             'Passport size photo aur signature (sirf document-upload mode me)'] },
    { name: 'Driving Licence / Learner',
      test: /parivahan|sarathi|driving licen/,
      keys: ['fullName', 'dob', 'gender', 'fatherName', 'mobile', 'addressLine', 'pinCode', 'bloodGroup'],
      docs: ['Aadhaar card', 'Age/DOB proof (10th marksheet ya birth certificate)', 'Address proof',
             'Passport photo aur signature', 'Medical Form 1 (self declaration; 40+ umar me doctor ka Form 1A)'] },
    { name: 'Passport',
      test: /passportindia|passport seva/,
      keys: ['fullName', 'dob', 'gender', 'birthPlace', 'fatherName', 'motherName', 'mobile', 'email', 'addressLine', 'pinCode'],
      docs: ['Aadhaar ya address proof', 'DOB proof (birth certificate / 10th marksheet)', 'Education proof (ECR/non-ECR ke liye)'] },
    { name: 'IRCTC Account',
      test: /irctc/,
      keys: ['fullName', 'dob', 'gender', 'mobile', 'email'],
      docs: [] },
    { name: 'Voter ID',
      test: /voters\.eci|nvsp|voter service/,
      keys: ['fullName', 'dob', 'gender', 'fatherName', 'mobile', 'addressLine', 'pinCode'],
      docs: ['Passport size photo', 'DOB proof', 'Address proof', 'Aadhaar (optional)'] }
  ];

  function detectProfile() {
    var t = String((root.location ? root.location.href : '') + ' ' + (document.title || '')).toLowerCase();
    for (var i = 0; i < PROFILES.length; i++) if (PROFILES[i].test.test(t)) return PROFILES[i];
    return null;
  }

  function haveKey(data, key) {
    if (key === 'fullName') return !!(data.fullName || (data.firstName && data.lastName));
    return !!(data[key] && String(data[key]).trim());
  }


  // ---------------------------------------------------------------
  // OTP ASSIST: mobile/Aadhaar bhar jaye to "Send/Get OTP" khud dabao.
  // OTP user khud dalta hai. OTP dalne ke baad "Verify" khud dabao.
  // CAPTCHA kabhi nahi bharta: captcha khali ho to Send OTP nahi dabata.
  // ---------------------------------------------------------------
  var RE_OTP_SEND = /(^|\s)(send|get|generate|request|receive)\s*(an\s*|the\s*)?(otp|one time (password|pin)|verification code|code)|^otp\s*(send|generate|bhejo)|send\s*code|ओटीपी\s*(भेजें|प्राप्त|जनरेट)|otp\s*भेजें/;
  var RE_OTP_RESEND = /resend|re-send|dobara|फिर से/;
  var RE_OTP_VERIFY = /(verify|validate|confirm|submit)\s*(the\s*)?(otp|code)|otp\s*(verify|validate|submit|confirm)|^(verify|validate)$|^(verify|validate)\s*(mobile|phone|number)?$|सत्यापित|ओटीपी\s*(जमा|सत्यापन)/;
  var otpSentAt = {}, otpVerifyAt = {};

  function otpPageKey() { return (root.location ? root.location.pathname : '') + '|' + (document.title || ''); }

  function clickables(scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll('button,a,input[type="button"],input[type="submit"],[role="button"]'))
      .filter(function (el) { return isVisible(el); });
  }

  function btnText(el) { return norm(el.innerText || el.value || el.getAttribute('aria-label') || el.title || ''); }

  function findBtn(re, scope) {
    var els = clickables(scope);
    for (var i = 0; i < els.length; i++) {
      var t = btnText(els[i]);
      if (!t || t.length > 40) continue;
      if (RE_OTP_RESEND.test(t)) continue;
      if (re.test(t)) return els[i];
    }
    return null;
  }

  function contactFilled() {
    var ins = Array.prototype.slice.call(document.querySelectorAll('input,textarea'));
    for (var i = 0; i < ins.length; i++) {
      var el = ins[i], type = (el.type || '').toLowerCase();
      if (/^(hidden|submit|button|checkbox|radio|file|password)$/.test(type) || !isVisible(el)) continue;
      var v = String(el.value || '').trim();
      if (!v) continue;
      var k = matchKey(hintOf(el), { type: type, autocomplete: el.getAttribute('autocomplete') || '' });
      var digits = v.replace(/\D/g, '');
      if (k === 'mobile' && digits.length >= 10) return true;
      if (k === 'email' && /@/.test(v)) return true;
      if (k === 'aadhaarNumber' && digits.length >= 12) return true;
    }
    return false;
  }

  function captchaPending() {
    var ins = Array.prototype.slice.call(document.querySelectorAll('input[type="text"],input:not([type]),input[type="tel"],input[type="number"]'));
    for (var i = 0; i < ins.length; i++) {
      var el = ins[i];
      if (!isVisible(el)) continue;
      if (RE_CAPTCHA.test(hintOf(el)) && !String(el.value || '').trim()) return true;
    }
    return false;
  }

  function findOtpInput() {
    var ins = Array.prototype.slice.call(document.querySelectorAll('input'));
    for (var i = 0; i < ins.length; i++) {
      var el = ins[i], type = (el.type || '').toLowerCase();
      if (/^(hidden|submit|button|checkbox|radio|file)$/.test(type) || !isVisible(el)) continue;
      if (RE_OTP.test(hintOf(el))) return el;
    }
    return null;
  }

  // return: '' | 'send' | 'verify'
  function otpAssist() {
    try {
      var key = otpPageKey();
      // 1) User ne OTP dal diya -> Verify dabao (ek baar)
      var oi = findOtpInput();
      if (oi && !otpVerifyAt[key] && /^\d{4,8}$/.test(String(oi.value || '').trim())) {
        var scope = (oi.closest && oi.closest('form')) || (oi.parentElement && oi.parentElement.parentElement && oi.parentElement.parentElement.parentElement) || document;
        var vb = findBtn(RE_OTP_VERIFY, scope) || findBtn(RE_OTP_VERIFY, document);
        if (vb) {
          otpVerifyAt[key] = Date.now();
          try { vb.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
          try { vb.click(); } catch (e) { fire(vb, ['click']); }
          return 'verify';
        }
      }
      // 2) Number bhar gaya, OTP abhi bheja nahi -> Send OTP dabao (ek baar)
      if (!otpSentAt[key]) {
        var sb = findBtn(RE_OTP_SEND, document);
        if (sb && contactFilled() && !captchaPending()) {
          otpSentAt[key] = Date.now();
          try { sb.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
          try { sb.click(); } catch (e) { fire(sb, ['click']); }
          return 'send';
        }
      }
    } catch (e) { /* ignore */ }
    return '';
  }


  // ---------------------------------------------------------------
  // SMART DEFAULTS: har form ka style alag hota hai. Jo sawal user ke data me nahi hote
  // (Residential status, DOB proof, Designation, Income source...) unka samajhdaar jawab khud chuno.
  // AI ke chune hue fields BLUE dikhte hain, ek baar dekh lena.
  // ---------------------------------------------------------------
  var DEF_RADIOS = [
    { q: /address for communication|communication address|correspondence address/, pick: /^(residence|residential)$/ },
    { q: /residential status|resident status/, pick: /^resident$/ },
    { q: /upload.*proof|proof of date of birth other than|supporting documents/, pick: /manual/ },
    { q: /appointing (a )?representative|representative assessee/, pick: /^no$/ }
  ];
  var DEF_SELECTS = [
    { q: /proof of date of birth|proof of dob|date of birth proof/, pick: /aadhaa?r/ },
    { q: /proof of identity|identity proof/, pick: /aadhaa?r/ },
    { q: /proof of address|address proof/, pick: /aadhaa?r/ },
    { q: /\bcountry\b(?!.*(code|isd|std))/, pick: /^india$/ }
  ];

  function ancestorMatches(el, re, maxLen) {
    var n = el, hops = 0;
    while (n && hops < 6) {
      var t = norm(String(n.innerText || '').slice(0, 900));
      if (t.length > 0 && t.length <= maxLen && re.test(t)) return true;
      n = n.parentElement; hops++;
    }
    return false;
  }

  function pickByRegex(sel, re) {
    for (var i = 0; i < sel.options.length; i++) {
      if (re.test(norm(sel.options[i].text || ''))) {
        sel.selectedIndex = i;
        fire(sel, ['input', 'change']);
        return true;
      }
    }
    return false;
  }

  function smartDefaults(data) {
    var out = { filled: 0, missing: [] };
    try {
      // radios
      var radios = Array.prototype.slice.call(document.querySelectorAll('input[type="radio"]')).filter(function (r) { return !r.disabled && isVisible(r); });
      var gs = groupRadios(radios);
      Object.keys(gs).forEach(function (gk) {
        var grp = gs[gk];
        if (grp.some(function (r) { return r.checked; })) return;
        DEF_RADIOS.forEach(function (d) {
          if (!d.q.test(norm(grp.map(function (r) { return ancestorText(r); }).join(' ')))) return;
          if (grp.some(function (r) { return r.checked; })) return;
          for (var i = 0; i < grp.length; i++) {
            if (d.pick.test(norm(labelTextOf(grp[i]) || grp[i].value || ''))) {
              try { grp[i].click(); } catch (e) { grp[i].checked = true; fire(grp[i], ['input', 'change']); }
              mark(grp[i].parentElement || grp[i], BLUE);
              out.filled++;
              return;
            }
          }
        });
      });
      // dropdowns
      Array.prototype.slice.call(document.querySelectorAll('select')).forEach(function (sel) {
        if (sel.disabled || !isVisible(sel)) return;
        if (sel.selectedIndex > 0 && sel.value) return;
        var h = hintOf(sel);
        if (classifySecurity(h)) return;
        for (var i = 0; i < DEF_SELECTS.length; i++) {
          if (DEF_SELECTS[i].q.test(h) && pickByRegex(sel, DEF_SELECTS[i].pick)) { mark(sel, BLUE); out.filled++; return; }
        }
      });
      // designation (declaration)
      Array.prototype.slice.call(document.querySelectorAll('input[type="text"],input:not([type])')).forEach(function (el) {
        if (el.disabled || el.readOnly || !isVisible(el) || String(el.value || '').trim()) return;
        if (/designation/.test(hintOf(el))) {
          setNativeValue(el, data.designation || 'Self');
          mark(el, BLUE); out.filled++;
        }
      });
      // source of income (checkbox group)
      var boxes = Array.prototype.slice.call(document.querySelectorAll('input[type="checkbox"]')).filter(function (c) { return !c.disabled && isVisible(c); });
      var inc = boxes.filter(function (c) { return ancestorMatches(c, /source of income/, 900) && /salary|business|profession|house property|other sources|capital gains|no income/.test(norm(labelTextOf(c))); });
      if (inc.length && !inc.some(function (c) { return c.checked; })) {
        var want = norm(data.incomeSource || '');
        if (!want) { out.missing.push('Source of Income'); }
        else {
          var toks = want.split(/[,;|\/]+/).map(function (x) { return x.trim(); }).filter(Boolean);
          inc.forEach(function (c) {
            var lb = norm(labelTextOf(c));
            if (toks.some(function (t) { return t && (lb.indexOf(t) >= 0 || t.indexOf(lb.split(' ')[0]) === 0); })) {
              try { c.click(); } catch (e) { c.checked = true; fire(c, ['input', 'change']); }
              mark(c.parentElement || c, BLUE); out.filled++;
            }
          });
        }
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  // Radio group ka sawal: apna dabba + uske upar ke heading (aksar alag element me hota hai)
  function ancestorText(el) {
    var n = el, hops = 0, t = '';
    while (n && hops < 5) {
      t = norm(String(n.innerText || '').slice(0, 400));
      if (t.length >= 25) break;
      n = n.parentElement; hops++;
    }
    var h = 0, sib = n ? n.previousElementSibling : null;
    while (sib && h < 2) { t += ' ' + norm(String(sib.innerText || '').slice(0, 100)); sib = sib.previousElementSibling; h++; }
    return t;
  }

  var profAskedSig = '', profNoteFor = '', forcedNext = {}, tickSig = '', lastPendSig = '';

  function autopilotCore(payload, opts) {
    opts = opts || {};
    if (opts.reset) { askedSig = ''; fillingTicks = 0; lastNextSig = ''; profAskedSig = ''; profNoteFor = ''; otpSentAt = {}; otpVerifyAt = {}; forcedNext = {}; tickSig = ''; }
    var s = run(payload, {});
    var sd = smartDefaults(payload || {});      // form-style wale sawalon ke samajhdaar default
    s.filled += sd.filled;
    s.smartMissing = sd.missing;
    var curSig = pageSig();
    if (curSig !== tickSig) { tickSig = curSig; fillingTicks = 0; }
    s.state = 'working';
    s.clicked = '';
    s.asks = [];
    s.uploads = [];
    s.done = false;
    s.note = '';
    s.profile = '';
    var list = emptyRequiredList();
    s.emptyRequired = list.length;

    if (looksFinished(list)) { s.state = 'done'; s.done = true; return s; }

    // OTP: number bharte hi Send OTP khud dabao; OTP user dalega, phir Verify khud dabao
    var oa = otpAssist();
    if (oa) {
      s.state = 'otp';
      s.otpAction = oa;
      s.note = oa === 'send' ? 'OTP bhej diya - aap OTP daal dein' : 'OTP verify dabaya';
      return s;
    }

    s.uploadFields = [];
    list.forEach(function (a) { if (a.kind === 'file') { s.uploads.push(a.label); s.uploadFields.push({ id: a.id, label: a.label, docKind: a.docKind }); } });

    // Form ka type pehchano -> jo details vault/OCR me nahi hain pehle hi maango, aur documents ki list batao
    var prof = detectProfile();
    if (prof) {
      s.profile = prof.name;
      var pa = prof.keys.filter(function (k) { return !haveKey(payload || {}, k); }).map(function (k) {
        return { id: '', key: k, label: ASK_LABELS[k] || k, type: k === 'gender' ? 'select' : 'text',
                 options: k === 'gender' ? ['Male', 'Female', 'Other'] : [] };
      });
      var pnote = prof.docs.length ? (prof.name + ' ke liye documents: ' + prof.docs.join(' | ') + '. Page upload maange to us field pe tap karke file chuno.') : '';
      if (profNoteFor !== prof.name && pnote) { profNoteFor = prof.name; s.note = pnote; }
      var psig = prof.name + ':' + pa.map(function (a) { return a.key; }).join(',');
      if (pa.length > 0 && psig !== profAskedSig) {
        profAskedSig = psig;
        s.asks = pa;
        s.state = 'filling';
        return s;
      }
    }

    var pending = list.length > 0 || s.needsUser.length > 0 || s.unmatched.length > 0;
    if (pending) {
      fillingTicks++;
      // pehle 2 tick Gemini/engine ko do, phir bhi khali ho to user se poochho (ek baar)
      if (fillingTicks >= 2) {
        var asks = buildAsks(list, s);
        var sg = asks.map(function (a) { return a.key || a.id; }).join(',');
        if (asks.length > 0 && sg !== askedSig) { askedSig = sg; s.asks = asks; }
      }
      // Kuch field bhar nahi paye to bhi ruko mat: Next dabao (Submit/Pay kabhi nahi), baaki fields user ko dikhenge
      if (fillingTicks >= 6 && !s.hasCaptcha && !s.hasOtp && !s.hasPassword && !s.hasPayment && !forcedNext[curSig]) {
        forcedNext[curSig] = 1;
        var ft = clickNext();
        if (ft) {
          s.clicked = ft; s.state = 'next'; fillingTicks = 0;
          s.pending = (s.smartMissing || []).concat(list.map(function (a) { return a.label; }).slice(0, 8));
          s.note = 'Kuch fields bhar nahi paye, AI aage badh gaya (' + ft + '). Wapas aakar dekh lena';
          return s;
        }
      }
      s.state = s.uploads.length > 0 ? 'upload' : 'filling';
      return s;
    }
    fillingTicks = 0;

    if (s.hasCaptcha || s.hasOtp || s.hasPassword || s.hasPayment) { s.state = 'user'; userHold = { sig: pageSig() }; return s; }

    var sig = pageSig();
    if (sig === lastNextSig && Date.now() - lastNextAt < 10000) { s.state = 'waiting'; return s; }
    var t = clickNext();
    if (t) { lastNextSig = sig; lastNextAt = Date.now(); s.clicked = t; s.state = 'next'; }
    else { s.state = 'final'; }
    return s;
  }

  var stuckSig = '', stuckTicks = 0, scanCount = {}, recipeHost = '', userHold = null;

  // Website khulne ke baad koi popup nahi: jo detail nahi mili wo s.pending me label ke roop me jaati hai
  // (user ko sirf status line me dikhti hai). Purana popup chahiye to: window.SARTHI_ASK_POPUP = true
  function silenceAsks(s) {
    if (root.SARTHI_ASK_POPUP === true) return s;
    if (s && s.asks && s.asks.length) {
      s.pending = (s.pending || []).concat(s.asks.map(function (a) { return a.label || a.key || 'Detail'; }));
      s.asks = [];
    }
    return s;
  }

  function autopilot(payload, opts) {
    opts = opts || {};
    if (opts.reset) { scanCount = {}; stuckSig = ''; stuckTicks = 0; userHold = null; }
    // CAPTCHA/OTP pe user ka intezaar: jab tak page nahi badla, page me kuch mat likho (site ka session bigad sakta hai)
    // Bas: OTP dalte hi Verify dabana (otpAssist) allowed hai
    if (userHold && userHold.sig === pageSig()) {
      var holdAct = otpAssist();
      return { state: 'user', otpAction: holdAct, note: holdAct === 'verify' ? 'OTP verify dabaya' : (holdAct === 'send' ? 'OTP bhej diya - aap OTP daal dein' : ''), filled: 0, asks: [], uploads: [], uploadFields: [], done: false, profile: '', needRecipe: false, stuck: null,
               hasCaptcha: true, hasOtp: false, hasPassword: false, hasPayment: false, needsUser: [], unmatched: [], emptyRequired: 0, url: root.location ? root.location.href : '', title: document.title || '' };
    }
    userHold = null;
    var s = autopilotCore(payload, opts);
    silenceAsks(s);
    var pendAll = (s.pending || []).concat(s.smartMissing || []);
    var pendSig = pendAll.join('|');
    s.pending = (pendSig && pendSig !== lastPendSig) ? pendAll : undefined;   // status line me baar-baar wahi na dikhe
    lastPendSig = pendSig;
    s.needRecipe = false;
    s.stuck = null;
    var host = root.location ? root.location.hostname : '';
    if (host && recipeHost !== host) { recipeHost = host; s.needRecipe = true; }   // form ki poori list (sabji ka saman) ek baar
    if (!s.done && s.asks.length === 0 && /^(filling|final|waiting|working)$/.test(s.state)) {
      var sig = pageSig() + '|' + s.emptyRequired + '|' + s.state;
      stuckTicks = (sig === stuckSig) ? stuckTicks + 1 : 1;
      stuckSig = sig;
      var key = pageSig();
      if (stuckTicks >= 2 && (scanCount[key] || 0) < 4) { scanCount[key] = (scanCount[key] || 0) + 1; s.stuck = snapshot(); }
    } else { stuckTicks = 0; stuckSig = ''; }
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
    version: 4,
    run: run,
    autopilot: autopilot,
    snapshot: snapshot,
    applyPlan: applyPlan,
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
