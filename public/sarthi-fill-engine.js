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
  var RE_DECLARATION = /declaration|i agree|i accept|i hereby|hereby state|no objection|terms( and conditions)?|privacy policy|declare that|i confirm|agree to|consent|undertaking|shapath|स्वीकार|घोषणा|सहमत/;
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
    // IRCTC / travel
    [{ key: 'fromStation', pos: /\bfrom\b|\borigin\b|source station|departure station|boarding/, neg: /date|time|dob|year|month|day|bank|income|name/ },
     { key: 'toStation', pos: /\bto\b|\bdestination\b|arrival station/, neg: /date|time|dob|year|month|day|bank|income|name|agree|consent|terms|same|equal|verify|confirm|back|next|proceed|apply|upload|photo|print/ },
     { key: 'journeyDate', pos: /journey date|travel date|departure date|date of journey|\bdoj\b|\bj ?date\b|dd mm yyyy|dd\/mm\/yyyy/, neg: /birth|dob|issue|expiry/ },
     { key: 'trainClass', pos: /all classes|journey class|travel class|journeyclass|\bclass\b|coach/, neg: /10th|12th|tenth|twelfth|matric|high ?school|inter/ },
     { key: 'trainQuota', pos: /\bquota\b|journey ?quota|reservation quota/, neg: /^$/ },
     { key: 'berthPreference', pos: /berth|seat preference/, neg: /^$/ }],

    // optional login (only filled when user supplied loginUserId / loginPassword)
    [{ key: 'loginUserId', pos: /user ?name|user ?id|login ?id|reg(istration)? ?(no|number|id)|roll ?no.*login/, neg: /father|mother|10th|12th|matric|inter|bank|upi/ },
     { key: 'loginPassword', pos: /pass ?word|passwd|\bpwd\b|पासवर्ड/, neg: /otp|pin|mpin|captcha/ }],

    // parents BEFORE applicant first/middle/last so "Father's First Name" NEVER gets applicant's First Name
    [{ key: 'fatherName', pos: /father|pita|guardian|s ?o\b|पिता/, neg: /mobile|phone|email|occupation|income|\bid\b|aadhaar|single parent|printed on/ },
     { key: 'motherName', pos: /mother|mata|माता|माँ/, neg: /mobile|phone|email|occupation|income|tongue|maiden|single parent|printed on/ },
     { key: 'firstName',  pos: /first name|given name|\bfname\b|पहला नाम/, neg: /father|mother|spouse/ },
     { key: 'middleName', pos: /middle name|\bmname\b/, neg: /father|mother/ },
     { key: 'lastName',   pos: /last name|surname|family name|\blname\b|उपनाम/, neg: /father|mother/ }],

    // contact
    [{ key: 'alternateMobile', pos: /(alt|alternate|other|emergency|parent|guardian|whatsapp).*(mobile|phone|contact|number)|(mobile|phone|contact).*(alt|alternate|other|emergency)/, neg: /email/ },
     { key: 'email', pos: /e ?mail|ईमेल/, neg: /alt|parent|father|otp/ },
     { key: 'mobile', pos: /mobile|phone|contact (no|number)|cell|tel\b|मोबाइल|फोन/, neg: /alt|emergency|parent|father|landline|std|otp|country code/ }],

    // personal
    [{ key: 'birthPlace', pos: /place of birth|birth ?place|janm ?sthan|जन्म स्थान/, neg: /date/ },
     { key: 'dob', pos: /\bdob\b|date of birth|birth ?date|janm ?tithi|जन्म/, neg: /place|state|district|city|village|certificate|proof/ },
     { key: 'age', pos: /\bage\b|passenger age|\bumr\b|उम्र|आयु/, neg: /page|language|village|percentage|average|stage|image|message|manage|storage|package/ },
     { key: 'gender', pos: /gender|\bsex\b|ling\b|लिंग/, neg: /^$/ },
     { key: 'category', pos: /category|caste|\bvarg\b|reservation|वर्ग|श्रेणी/, neg: /sub ?category|certificate|number|issue|applicant/ },
     { key: 'maritalStatus', pos: /marital|married|vaivahik|वैवाहिक/, neg: /^$/ },
     { key: 'bloodGroup', pos: /blood ?group|rakht|रक्त/, neg: /^$/ }],

    // address (skip office address boxes so residence details don't leak into office address)
    [{ key: 'addressLine', pos: /flat|door|building|road|street|sector|house no|plot/, neg: /office address|e ?mail|proof|type|same|police|station|pin ?code|post office/ },
     { key: 'pinCode', pos: /pin ?code|\bpin\b|postal|पिन/, neg: /office address|security|otp|mpin|pan/ },
     { key: 'district', pos: /district|\bjila\b|\bcity\b|जिला/, neg: /office address|court|pin ?code|std|birth|area|locality|town|country/ },
     { key: 'state', pos: /\bstate\b|rajya|राज्य|pradesh|province|domicile state/, neg: /office address|domicile board|\bstatus\b|statement|pin ?code|std/ },
     { key: 'blockOrTehsil', pos: /block|tehsil|tahsil|taluka|taluk|anchal|अंचल|तहसील|प्रखंड/, neg: /office address/ },
     { key: 'policeStation', pos: /police station|\bthana\b|थाना/, neg: /office address/ },
     { key: 'postOffice', pos: /post office|\bpo\b|डाकघर/, neg: /office address/ },
     { key: 'villageOrWard', pos: /village|\bgram\b|ward|mohalla|locality|town|गांव|ग्राम|मोहल्ला/, neg: /office address/ },
     { key: 'district', pos: /\bverifying place\b|^place$/i, neg: /birth|office|work|station|from|to/ },
     { key: 'addressLine', pos: /address|\bpata\b|house|street|residen|पता/, neg: /office address|e ?mail|\bip\b|web|proof|type|same/ }],

    // Name as per Aadhaar BEFORE aadhaarNumber so it maps to fullName
    [{ key: 'fullName', pos: /name as per aadhaa?r|aadhaa?r name|name on aadhaa?r/, neg: /father|mother|spouse|enrol|ack|uidai/ },
     { key: 'aadhaarLast4', pos: /last (four|4) digits? of aadhaa?r|aadhaa?r last 4/, neg: /^$/ },
     { key: 'panNumber', pos: /\bpan\b|permanent account|पैन/, neg: /company|father|mother|pancha|panel|expan|printed on|card|application/ },
     { key: 'aadhaarNumber', pos: /aadhaar|aadhar|adhar|\buid\b|uidai|आधार/, neg: /enrol|virtual|consent|have a aadhaar|do you have|name as per|photo|last four|last 4/ },
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
     { key: 'qualification', pos: /qualification|education|योग्यता|शिक्षा/, neg: /roll|year|percent|board/ },
     { key: 'boardOrUniversity', pos: /board|university|विश्वविद्यालय/, neg: /roll|year|percent/ },
     { key: 'passingYear', pos: /passing year|year of passing|pass out/, neg: /roll/ },
     { key: 'percentageOrGrade', pos: /percentage|percent|cgpa|grade|marks obtained|प्रतिशत/, neg: /roll|year|max/ },
     { key: 'rollNumber', pos: /roll ?(no|number|num)|रोल/, neg: /father|mother|year/ }],

    // generic "name" last (must NEVER match Area Name, City Name, Office Name, Bank Name, etc.)
    [{ key: 'fullName', pos: /full ?name|applicant ?name|candidate ?name|student ?name|passenger ?name|your name|name (as per|of) (the )?(applicant|candidate|student|aadhaa?r|pan|matric)|naam|^name$|\bname\b|नाम/,
       neg: /father|mother|spouse|husband|wife|area|ao|ward|range|circle|city|town|locality|road|street|flat|door|building|landmark|country|nationality|pan card|document|school|college|board|bank|ifsc|holder|account|company|organi[sz]ation|user ?name|user ?id|login ?id|file ?name|nominee|guardian|referee|hospital|institute|district|state|post|police|village|panchayat|branch|changed name|new name|office|employer|station|train|board|exam/ }]
  );

  // flatten + ensure group filter works
  function matchKey(hint, ctx) {
    ctx = ctx || {};
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      if (r.g && !r.g.test(hint)) continue;
      if (r.pos.test(hint) && !(r.neg && r.neg.test(hint))) {
        return r.key;
      }
    }
    if ((ctx.type === 'select' || ctx.isCustomDd) && /^(general|tatkal|premium tatkal|ladies|lower berth sr citizen)$/.test(hint)) {
      return 'trainQuota';
    }
    if (ctx.type === 'email') return 'email';
    if (ctx.type === 'tel') return 'mobile';
    if (ctx.type === 'password') return 'loginPassword';
    if (ctx.autocomplete) {
      var ac = ctx.autocomplete;
      if (/given-name/.test(ac)) return 'firstName';
      if (/family-name/.test(ac)) return 'lastName';
      if (/^name$/.test(ac)) return 'fullName';
      if (/bday/.test(ac)) return 'dob';
      if (/postal/.test(ac)) return 'pinCode';
      if (/street-address|address-line1/.test(ac)) return 'addressLine';
      if (/username/.test(ac)) return 'loginUserId';
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

  function computeAge(dobStr) {
    var p = parseDate(dobStr);
    if (!p) return '';
    var y = parseInt(p.y, 10), m = parseInt(p.m, 10), d = parseInt(p.d, 10);
    if (!y || y < 1900) return '';
    var now = new Date();
    var age = now.getFullYear() - y;
    var dm = (now.getMonth() + 1) - m;
    if (dm < 0 || (dm === 0 && now.getDate() < d)) age--;
    return (age > 0 && age < 120) ? String(age) : '';
  }

  function valueFor(key, data) {
    var n = splitName(data.fullName);
    switch (key) {
      case 'fullName': return data.fullName || data.passenger1Name || '';
      case 'firstName': return data.firstName || n.first;
      case 'middleName': return data.middleName || n.middle;
      case 'lastName': return data.lastName || n.last;
      case 'age': return data.age || data.passenger1Age || computeAge(data.dob);
      case 'gender': return data.gender || data.passenger1Gender || '';
      case 'berthPreference': return data.berthPreference || data.passenger1Berth || '';
      case 'aadhaarNumber': {
        var ad = String(data.aadhaarNumber || '').replace(/\D/g, '');
        return ad.length >= 12 ? ad.slice(0, 12) : '';
      }
      case 'aadhaarLast4': {
        var digits = String(data.aadhaarLast4 || data.aadhaarNumber || '').replace(/\D/g, '');
        return digits.length >= 4 ? digits.slice(-4) : '';
      }
      case 'tenthBoard': return data.tenthBoard || data.boardOrUniversity || '';
      case 'tenthRoll': return data.tenthRoll || data.rollNumber || '';
      case 'tenthYear': return data.tenthYear || data.passingYear || '';
      case 'tenthPercent': return data.tenthPercent || data.percentageOrGrade || '';
      case 'rollNumber': return data.rollNumber || data.tenthRoll || data.twelfthRoll || '';
      case 'boardOrUniversity': return data.boardOrUniversity || data.tenthBoard || data.twelfthBoard || '';
      case 'passingYear': return data.passingYear || data.tenthYear || data.twelfthYear || data.graduationYear || '';
      case 'percentageOrGrade': return data.percentageOrGrade || data.tenthPercent || data.twelfthPercent || data.graduationPercent || '';
      case 'qualification': return data.qualification || data.graduationDegree || (data.twelfthBoard || data.twelfthYear ? '12th' : (data.tenthBoard || data.tenthYear || data.tenthRoll ? '10th' : ''));
      case 'addressLine': return data.addressLine || data.villageOrWard || data.district || '';
      case 'villageOrWard': return data.villageOrWard || data.addressLine || data.district || '';
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
    obc: ['obc', 'other backward', 'obc ncl', 'bc', 'ebc', 'mbc', 'बीसी', 'पिछड़ा'],
    sc: ['sc', 'scheduled caste', 'अनुसूचित जाति'],
    st: ['st', 'scheduled tribe', 'अनुसूचित जनजाति'],
    ews: ['ews', 'economically weaker'],
    unmarried: ['unmarried', 'single', 'never married', 'अविवाहित'],
    married: ['married', 'विवाहित'],
    widowed: ['widowed', 'widow', 'widower', 'विधवा'],
    divorced: ['divorced', 'तलाकशुदा'],
    cbse: ['cbse', 'central board of secondary education'],
    bseb: ['bseb', 'bihar school examination board', 'bihar board'],
    upmsp: ['upmsp', 'up board', 'board of high school and intermediate education uttar pradesh'],
    icse: ['icse', 'cisce', 'council for the indian school certificate examinations'],
    jac: ['jac', 'jharkhand academic council'],
    nios: ['nios', 'national institute of open schooling'],
    rbse: ['rbse', 'board of secondary education rajasthan'],
    mpbse: ['mpbse', 'board of secondary education madhya pradesh'],
    wbbse: ['wbbse', 'west bengal board of secondary education'],
    '10th': ['10th', 'matric', 'matriculation', 'matriculation 10th', 'high school', 'secondary', 'ssc'],
    '12th': ['12th', 'higher secondary', 'higher secondary 10 2', '10 2', 'senior secondary', 'intermediate', 'hsc'],
    graduate: ['graduate', 'graduation', 'bachelor', 'b tech', 'btech', 'b sc', 'bsc', 'b a', 'ba', 'b com', 'bcom', 'ug'],
    'post graduate': ['post graduate', 'post graduation', 'master', 'm tech', 'm sc', 'ma', 'mcom', 'pg'],
    sl: ['sl', 'sleeper', 'sleeper sl'],
    '3a': ['3a', 'ac 3 tier', 'ac 3 tier 3a', '3 tier ac', '3ac', 'ac 3'],
    '3e': ['3e', 'ac 3 economy', 'ac 3 economy 3e', '3ac economy'],
    '2a': ['2a', 'ac 2 tier', 'ac 2 tier 2a', '2ac'],
    '1a': ['1a', 'ac first class', 'ac first class 1a', '1ac', 'first ac', 'fast ac', '1st ac', 'first class ac'],
    cc: ['cc', 'ac chair car', 'ac chair car cc', 'chair car'],
    '2s': ['2s', 'second sitting', 'second sitting 2s']
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
      var hit = n === k || SYN[k].indexOf(n) >= 0 || n.indexOf(k) === 0 ||
        SYN[k].some(function (s) { var ns = norm(s); return ns.length >= 6 && n.indexOf(ns) >= 0; });
      if (hit) {
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
    if (key === 'trainClass' && norm(wanted) === 'ac') {
      if (/\b3a\b|ac 3 tier/.test(t)) return 95;
      if (/\b3e\b|ac 3 economy/.test(t)) return 85;
      if (/\b2a\b|ac 2 tier/.test(t)) return 80;
      if (/\b(cc|ec)\b|chair car/.test(t)) return 70;
      if (/\b1a\b|first class/.test(t)) return 45;
    }
    var wants = key === 'state' ? expandState(wanted) : expandSyn(wanted);
    var best = 0, i;
    for (i = 0; i < wants.length; i++) {
      var w = wants[i];
      if (!w) continue;
      if (key === 'gender') {
        if (/^(male|m)$/.test(w) && /\bfemale\b/.test(t)) continue;
        if (/^(female|f)$/.test(w) && !/\bfemale\b/.test(t) && /\bmale\b/.test(t)) continue;
      }
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
    try { if (el.matches && el.matches(':disabled')) return false; } catch (e) { /* ignore */ }
    try { if (el.closest && el.closest('fieldset[disabled], [aria-disabled="true"]')) return false; } catch (e) { /* ignore */ }
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
      // First check direct sibling / strictly local field wrapper BEFORE touching multi-column row parents
      var isToggle = /^(checkbox|radio)$/i.test(el.type || '');
      if (!txt.trim() && !isToggle) {
        var prev = el.previousElementSibling;
        if (prev && !(prev.querySelector && prev.querySelector('input,select,textarea')) && prev.innerText && prev.innerText.length < 260) {
          txt += ' ' + prev.innerText;
        }
      }
      // Walk up 1..2 immediate single-field wrappers checking preceding sibling nodes/text (handles Protean PAN bare divs like "Name as per Aadhaar", "City", "Passport Number")
      if (!txt.trim()) {
        var curNode = el;
        for (var up = 0; up < 3 && !txt.trim() && curNode && curNode.parentElement; up++) {
          var par = curNode.parentElement;
          if (par.tagName === 'FORM' || par.tagName === 'BODY') break;
          var parCount = par.querySelectorAll ? par.querySelectorAll('input:not([type="hidden"]),select,textarea').length : 1;
          // Stop before crossing into a shared row/table holding OTHER form controls (and never guess toggle labels from preceding siblings in a multi-input box)
          if ((up > 0 || isToggle) && parCount > 1) break;
          var kids = par.childNodes || par.children || [];
          var collected = '';
          for (var ki = 0; ki < kids.length; ki++) {
            var ch = kids[ki];
            if (ch === curNode || (ch.contains && ch.contains(el))) break;
            if (ch.nodeType === 3) {
              var nt = (ch.nodeValue || '').trim();
              if (nt) collected += ' ' + nt;
            } else if (ch.nodeType === 1) {
              if (/^(INPUT|SELECT|TEXTAREA)$/.test(ch.tagName) || (ch.querySelector && ch.querySelector('input:not([type="hidden"]),select,textarea'))) {
                collected = '';
                continue;
              }
              if (/^(SCRIPT|STYLE|OPTION|BUTTON)$/.test(ch.tagName)) continue;
              var ct = (ch.innerText || ch.textContent || '').trim();
              if (ct && ct.length < 240 && !/please select|^\s*select\s*$|^[-]+select[-]+$/i.test(ct)) collected = ct;
            }
          }
          if (collected.trim()) txt = collected.trim();
          curNode = par;
        }
      }
      // Fallback to single-field container or two-column th/label table row (never steal labels from a sibling column in a multi-input row!)
      if (!txt.trim()) {
        var cell = el.closest ? el.closest('td,th,.form-group,.form-field,.mat-form-field,.p-field,.input-group,.col,.row,div') : null;
        if (cell) {
          var before = cell.previousElementSibling;
          if (before && before.innerText && before.innerText.length < 260 && !(before.querySelector && before.querySelector('input:not([type="hidden"]),select,textarea'))) {
            txt += ' ' + before.innerText;
          } else if (cell.querySelector) {
            var cellInputs = cell.querySelectorAll ? cell.querySelectorAll('input:not([type="hidden"]),select,textarea').length : 1;
            if (cellInputs <= 1) {
              var l = cell.querySelector('label,.label,.form-label,.col-form-label,mat-label,strong,b,span,p');
              if (l && l !== el && !l.contains(el) && l.innerText && l.innerText.length < 260 && !(l.querySelector && l.querySelector('input,select,textarea'))) {
                txt += ' ' + l.innerText;
              }
            }
          }
          if (!txt.trim() && cell.parentElement) {
            var rowInputs = cell.parentElement.querySelectorAll ? cell.parentElement.querySelectorAll('input:not([type="hidden"]),select,textarea').length : 2;
            if (rowInputs <= 1) {
              var pLabel = cell.parentElement.querySelector('label,.form-label,.col-form-label,th');
              if (pLabel && pLabel !== el && !pLabel.contains(el) && pLabel.innerText && pLabel.innerText.length < 260) {
                txt += ' ' + pLabel.innerText;
              }
            }
          }
        }
      }
    } catch (e) { /* ignore */ }
    return txt;
  }

  // Radio / checkbox ke explicit ya aage (right side) likha label padho — pichhle checkbox ka text kabhi na churao
  function adjacentControlLabel(el) {
    var explicit = '';
    try {
      if (el.labels && el.labels.length) {
        for (var i = 0; i < el.labels.length; i++) explicit += ' ' + (el.labels[i].innerText || el.labels[i].textContent || '');
      }
      if (!explicit && el.id) {
        var lb = document.querySelector('label[for="' + el.id.replace(/"/g, '\\"') + '"]');
        if (lb) explicit += ' ' + (lb.innerText || lb.textContent || '');
      }
      if (!explicit) {
        var wrap = el.closest ? el.closest('label') : null;
        if (wrap) explicit += ' ' + (wrap.innerText || wrap.textContent || '');
      }
      if (!explicit && el.getAttribute) {
        var al = el.getAttribute('aria-label');
        if (al) explicit = al;
      }
      if (explicit && explicit.trim()) return explicit.trim();

      var n = el.nextSibling, acc = '', steps = 0;
      while (n && steps < 4) {
        if (n.nodeType === 1 && /^(INPUT|SELECT|TEXTAREA|BR)$/.test(n.tagName)) break;
        if (n.nodeType === 1 && n.querySelector && n.querySelector('input,select,textarea')) break;
        var t = (n.nodeType === 3 ? n.nodeValue : (n.innerText || n.textContent || '')) || '';
        t = t.trim();
        if (t && t.length < 120) acc += ' ' + t;
        n = n.nextSibling;
        steps++;
      }
      if (acc.trim()) return acc.trim();
      var p = el.parentElement;
      if (p && p.querySelectorAll && p.querySelectorAll('input:not([type="hidden"]),select,textarea').length <= 1) {
        var pt = (p.innerText || p.textContent || '').trim();
        if (pt && pt.length < 140) return pt;
      }
      if (el.tagName === 'INPUT' && p && p.tagName === 'TD' && p.nextElementSibling) {
        var nt = (p.nextElementSibling.innerText || p.nextElementSibling.textContent || '').trim();
        if (nt && nt.length < 120) return nt;
      }
    } catch (e) { /* ignore */ }
    var base = labelTextOf(el);
    return (base && base.trim()) ? base.trim() : '';
  }

  function parentSectionTag(el) {
    try {
      var n = el.parentElement, hops = 0;
      while (n && hops < 4) {
        var head = '';
        var sib = n.previousElementSibling;
        if (sib && sib.innerText && sib.innerText.length < 120) head += ' ' + sib.innerText;
        var h = n.querySelector && n.querySelector('h1,h2,h3,h4,h5,legend,.section-title,.card-header,.panel-title');
        if (h && !h.contains(el) && h.innerText && h.innerText.length < 120) head += ' ' + h.innerText;
        var nh = norm(head);
        if (/father s? name/.test(nh) && !/mother/.test(nh)) return 'father';
        if (/mother s? name/.test(nh) && !/father/.test(nh)) return 'mother';
        if (/office address/.test(nh) && !/residence/.test(nh)) return 'office address';
        n = n.parentElement;
        hops++;
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  function hintOf(el) {
    var ddHost = el.closest ? el.closest('p-dropdown, p-autocomplete, p-calendar, mat-select, ng-select, [formcontrolname]') : null;
    return norm([
      el.name, el.id, el.placeholder, el.title,
      el.getAttribute && el.getAttribute('formcontrolname'),
      el.getAttribute && el.getAttribute('ng-reflect-name'),
      ddHost && ddHost.getAttribute && ddHost.getAttribute('formcontrolname'),
      ddHost && ddHost.getAttribute && ddHost.getAttribute('ng-reflect-name'),
      el.getAttribute && el.getAttribute('data-placeholder'),
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('data-label'),
      labelTextOf(el),
      parentSectionTag(el)
    ].join(' '));
  }

  function setNativeValue(el, val, opts) {
    opts = opts || {};
    irSoftFocus(el);
    var proto = el.tagName === 'TEXTAREA' ? root.HTMLTextAreaElement.prototype : root.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, val); else el.value = val;
    var s = String(val == null ? '' : val);
    var lastCh = s ? s.charAt(s.length - 1) : 'Backspace';
    var code = lastCh.length === 1 ? lastCh.toUpperCase().charCodeAt(0) : 8;
    try {
      if (root.KeyboardEvent) el.dispatchEvent(new root.KeyboardEvent('keydown', { key: lastCh, keyCode: code, which: code, bubbles: true }));
    } catch (e) { /* ignore */ }
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: s, inputType: s ? 'insertText' : 'deleteContentBackward' }));
    } catch (e) {
      fire(el, ['input']);
    }
    try {
      if (root.KeyboardEvent) el.dispatchEvent(new root.KeyboardEvent('keyup', { key: lastCh, keyCode: code, which: code, bubbles: true }));
    } catch (e) {
      fire(el, ['keyup']);
    }
    if (!opts.noBlur) fire(el, ['change', 'blur']);
  }

  // Character-by-character typing for masked Aadhaar / custom Angular directives (e.g. SSC OTR)

  function isNativeWebViewHost() {
    try {
      return (typeof root.SarthiCred !== 'undefined' || typeof root.SarthiNative !== 'undefined') && !root.__sarthiPlaywrightControlled;
    } catch (e) { return false; }
  }
  function isIrctcNativeManual() {
    try {
      return isNativeWebViewHost() && !!(root.location && /irctc\.co\.in/i.test(root.location.hostname || ''));
    } catch (e) { return false; }
  }

  // Keyboard na khule: focus se pehle inputmode=none (IRCTC par keyboard kabhi block nahi karte)
  function irNoKeyboard(el) {
    try {
      if (root.location && /irctc\.co\.in/i.test(root.location.hostname || '')) return;
      if (!el || el.tagName !== 'INPUT' || el.getAttribute('data-sarthi-im')) return;
      el.setAttribute('data-sarthi-im', el.getAttribute('inputmode') || '-');
      el.setAttribute('inputmode', 'none');
      el.addEventListener('touchstart', function () {
        var o = el.getAttribute('data-sarthi-im');
        if (o === '-' || o === null) el.removeAttribute('inputmode'); else el.setAttribute('inputmode', o);
      }, { once: true, passive: true });
    } catch (e) { /* ignore */ }
  }
  function irSoftFocus(el) {
    try { irNoKeyboard(el); el.focus && el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  function typeDigitsIncrementally(el, digits) {
    var s = String(digits || '').replace(/\D/g, '');
    if (!s) return;
    irSoftFocus(el);
    var desc = Object.getOwnPropertyDescriptor(root.HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, ''); else el.value = '';
    try { el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContentBackward' })); } catch (e) { fire(el, ['input']); }
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var code = ch.charCodeAt(0);
      try {
        if (root.KeyboardEvent) {
          el.dispatchEvent(new root.KeyboardEvent('keydown', { key: ch, code: 'Digit' + ch, keyCode: code, which: code, bubbles: true }));
          el.dispatchEvent(new root.KeyboardEvent('keypress', { key: ch, code: 'Digit' + ch, charCode: code, keyCode: code, which: code, bubbles: true }));
        }
      } catch (e) { /* ignore */ }
      try { el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: ch, inputType: 'insertText' })); } catch (e) { /* ignore */ }
      var nextVal = String(el.value || '') + ch;
      if (desc && desc.set) desc.set.call(el, nextVal); else el.value = nextVal;
      try {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      } catch (e) {
        fire(el, ['input']);
      }
      try {
        if (root.KeyboardEvent) el.dispatchEvent(new root.KeyboardEvent('keyup', { key: ch, code: 'Digit' + ch, keyCode: code, which: code, bubbles: true }));
      } catch (e) {
        fire(el, ['keyup']);
      }
    }
    fire(el, ['change', 'blur']);
  }

  // Natural character-by-character typing for Angular/PrimeNG autocomplete (IRCTC From/To station, etc.)
  function typeTextIncrementally(el, text, done, opts) {
    var s = String(text || '');
    var isFast = Boolean((opts && opts.fast) || (root.location && /irctc/i.test(root.location.href || '')));
    irSoftFocus(el);
    var desc = Object.getOwnPropertyDescriptor(root.HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, ''); else el.value = '';
    try { el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContentBackward' })); } catch (e) { fire(el, ['input']); }
    var idx = 0;
    function step() {
      if (idx >= s.length) {
        if (typeof done === 'function') done();
        return;
      }
      var ch = s.charAt(idx++);
      var code = ch.toUpperCase().charCodeAt(0);
      try {
        if (root.KeyboardEvent) {
          el.dispatchEvent(new root.KeyboardEvent('keydown', { key: ch, keyCode: code, which: code, bubbles: true }));
          el.dispatchEvent(new root.KeyboardEvent('keypress', { key: ch, charCode: code, keyCode: code, which: code, bubbles: true }));
        }
      } catch (e) { /* ignore */ }
      try { el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: ch, inputType: 'insertText' })); } catch (e) { /* ignore */ }
      var nextVal = String(el.value || '') + ch;
      if (desc && desc.set) desc.set.call(el, nextVal); else el.value = nextVal;
      try {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      } catch (e) {
        fire(el, ['input']);
      }
      try {
        if (root.KeyboardEvent) el.dispatchEvent(new root.KeyboardEvent('keyup', { key: ch, keyCode: code, which: code, bubbles: true }));
      } catch (e) {
        fire(el, ['keyup']);
      }
      // Subtle human jitter on IRCTC keeps automation fast (~14ms/char) without robotic 0ms burst patterns
      var delay = isFast ? (11 + Math.floor(Math.random() * 8)) : 32;
      setTimeout(step, delay);
    }
    setTimeout(step, isFast ? 18 : 35);
  }

  function fire(el, names) {
    names.forEach(function (n) {
      try { el.dispatchEvent(new Event(n, { bubbles: true })); } catch (e) { /* ignore */ }
    });
  }

  function mark(el, color) {
    if (isIrctcNativeManual()) return;
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
    if (/agree to have.*aadhaa?r photo|aadhaa?r photo printed|photo printed on.*pan|hereby agree/.test(hint)) {
      return 'yes';
    }
    // Country code / ISD / nationality / country: India default
    if (/country code|isd|std code of country|dial(ing)? code/.test(hint)) return 'india (91)';
    if (/\bcountry\b|country region/.test(hint) && !/code|isd|std/.test(hint)) return 'india';
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
    return norm(adjacentControlLabel(r) + ' ' + (r.value || '') + ' ' + (r.getAttribute('aria-label') || ''));
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
  // 5b. Universal Custom Dropdown & Autocomplete Engine
  //     (Angular Material, ng-select, PrimeNG, Bootstrap, React-Select, SSC/IRCTC)
  // ---------------------------------------------------------------
  var CUSTOM_DD_SEL = '[role="combobox"],[role="listbox"],mat-select,ng-select,p-dropdown,.ui-dropdown,[aria-haspopup="listbox"],[aria-haspopup="true"],.select2-selection,[class*="select__control"],.p-dropdown,.dropdown-toggle';
  var OPTION_SEL = '[role="option"],mat-option,.mat-option,.ng-option,.p-dropdown-item,.ui-dropdown-item,p-dropdownitem li,.p-dropdown-panel li,.ui-dropdown-panel li,.p-autocomplete-item,.ui-autocomplete-list-item,p-autocomplete li,.ui-autocomplete-panel li,.p-autocomplete-panel li,.select2-results__option,.dropdown-item,[role="listbox"] li,.cdk-overlay-container li,.p-dropdown-items li,.ui-dropdown-items li,.p-autocomplete-items li,.ui-autocomplete-items li,ul.dropdown-menu li';

  var ddQueue = [];
  var ddBusy = false;
  var ddStartTimer = null;

  function customDropdownLabelText(dd) {
    if (!dd) return '';
    try {
      var lblEl = dd.querySelector && dd.querySelector('.ui-dropdown-label, .p-dropdown-label, .mat-select-value-text, .mat-select-min-line, .ng-value-label, [class*="singleValue"]');
      if (lblEl) {
        var lt = (lblEl.innerText || lblEl.textContent || '').trim();
        if (lt) return lt;
      }
    } catch (e) { /* ignore */ }
    return (dd.innerText || dd.textContent || '').trim();
  }

  function isCustomPlaceholderText(txt) {
    var t = norm(txt);
    return !t || /^(select|choose|please select|select one|select option|चुनें|चयन|--)$/.test(t);
  }

  function isAutocompleteCommitted(el) {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute('data-sarthi-ac-done') === '1') return true;
    var v = String(el.value || '').trim();
    // IRCTC stations look like "SIWAN JN - SV" or "DELHI JN. - DLI (NEW DELHI)"
    return /\s-\s[A-Za-z0-9]{1,8}(\s*\([^)]+\))?$|\([A-Z]{2,5}\)$/.test(v);
  }

  function isAutocompleteEl(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    return Boolean(
      el.getAttribute('role') === 'combobox' ||
      el.getAttribute('role') === 'searchbox' ||
      el.getAttribute('aria-autocomplete') ||
      (el.closest && el.closest('p-autocomplete,mat-autocomplete,.ui-autocomplete,[class*="autocomplete"]'))
    );
  }

  function findCustomDropdownTriggers() {
    var seen = [];
    var candidates = Array.prototype.slice.call(document.querySelectorAll(CUSTOM_DD_SEL));
    // Also detect custom div/button/span dropdowns whose visible text is "Select" near a form label (e.g. SSC OTR)
    Array.prototype.slice.call(document.querySelectorAll('div, button, span, a')).forEach(function (el) {
      if (candidates.indexOf(el) >= 0) return;
      if (el.closest && el.closest('header, nav, footer')) return;
      if (el.querySelector && el.querySelector('input, select, textarea, ' + CUSTOM_DD_SEL)) return;
      var txt = norm(el.innerText || el.textContent || '');
      if (txt === 'select' || txt === 'please select' || txt === 'choose' || txt === 'select option' || txt === 'select one') {
        if (el.getBoundingClientRect) {
          var rc = el.getBoundingClientRect();
          if (rc.height < 20 || rc.height > 76 || rc.width < 60) return;
        }
        candidates.push(el);
      }
    });
    return candidates.filter(function (el) {
      if (!isVisible(el)) return false;
      if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return false;
      if (el.tagName === 'INPUT' && /^(text|search|)$/i.test(el.type || '')) return false; // autocomplete inputs handled separately
      // Keep the outer custom dropdown trigger if an inner child also matched
      for (var i = 0; i < seen.length; i++) {
        if (seen[i].contains(el)) return false;
        if (el.contains(seen[i])) { seen[i] = el; return false; }
      }
      seen.push(el);
      return true;
    });
  }

  function clickLikeUser(el) {
    if (!el) return;
    var target = el;
    irNoKeyboard(el);
    if (/^(P-DROPDOWN|MAT-SELECT|NG-SELECT)$/.test(el.tagName) && el.querySelector) {
      target = el.querySelector('.ui-dropdown, .p-dropdown, .ui-dropdown-trigger, .p-dropdown-trigger, .mat-select-trigger, .ng-select-container') || el;
    }
    try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { /* ignore */ }
    // On IRCTC, dispatching pointerdown/mousedown + click can trigger double-click detection ("Sorry!!! Please Try again!!")
    if (root.location && /irctc\.co\.in/i.test(root.location.hostname || '')) {
      if (typeof target.click === 'function') {
        try { target.click(); } catch (e) { /* ignore */ }
      } else {
        try { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: root })); } catch (e) { /* ignore */ }
      }
      return;
    }
    if (root.PointerEvent) {
      ['pointerdown', 'pointerup'].forEach(function (evName) {
        try { target.dispatchEvent(new root.PointerEvent(evName, { bubbles: true, cancelable: true, view: root })); } catch (e) { /* ignore */ }
      });
    }
    ['mousedown', 'mouseup'].forEach(function (evName) {
      try { target.dispatchEvent(new MouseEvent(evName, { bubbles: true, cancelable: true, view: root })); } catch (e) { /* ignore */ }
    });
    // Fire ONLY ONE click event so toggle components like PrimeNG p-dropdown do not open and immediately close
    if (typeof target.click === 'function') {
      try { target.click(); } catch (e) { /* ignore */ }
    } else {
      try { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: root })); } catch (e) { /* ignore */ }
    }
  }

  function findFallbackDropdownOptions(triggerEl) {
    var out = [];
    var seenNodes = [];
    var trigTxt = norm(customDropdownLabelText(triggerEl));
    function addScope(scope) {
      if (!scope || !scope.querySelectorAll) return;
      var items = scope.querySelectorAll('li, a, button, span, p, div');
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (seenNodes.indexOf(item) >= 0) continue;
        if (!isVisible(item)) continue;
        if (item === triggerEl || item.contains(triggerEl) || triggerEl.contains(item)) continue;
        if (item.closest && item.closest('label')) continue;
        if (item.querySelector && item.querySelector('input, select, textarea')) continue;
        var raw = (item.innerText || item.textContent || '').trim();
        if (!raw || raw.length > 72 || raw.indexOf('\n') >= 0) continue;
        var t = norm(raw);
        if (!t || t === trigTxt) continue;
        if (/^(select|choose|please select|select option|--+)$/.test(t)) continue;
        if (/is mandatory|is required|is not valid|should be same/.test(t)) continue;
        // Skip wrapper nodes whose direct child element holds the exact same text
        var hasSameChild = false;
        if (item.children) {
          for (var c = 0; c < item.children.length; c++) {
            if (norm(item.children[c].innerText || '') === t) { hasSameChild = true; break; }
          }
        }
        if (hasSameChild) continue;
        seenNodes.push(item);
        out.push(item);
      }
    }
    var localScope = triggerEl.closest ? triggerEl.closest('.form-group, .form-field, [class*="select"], [class*="dropdown"], td, div') : triggerEl.parentElement;
    if (localScope && localScope.parentElement && localScope.parentElement.tagName !== 'FORM') addScope(localScope.parentElement);
    if (out.length === 0 && localScope) addScope(localScope);
    if (out.length === 0) {
      Array.prototype.slice.call(document.querySelectorAll('.cdk-overlay-container, [role="menu"], ul[class*="dropdown"], ul[class*="option"], div[class*="dropdown-menu"], div[class*="select-options"], div[class*="options"]')).forEach(addScope);
    }
    return out;
  }

  function pickBestOverlayOption(opts, wanted, key, isAutocomplete) {
    var wNorm = norm(wanted);
    var best = null, bestSc = 0;
    opts.forEach(function (o) {
      if (o.getAttribute && o.getAttribute('aria-disabled') === 'true') return;
      if (o.classList && (o.classList.contains('ui-state-disabled') || o.classList.contains('p-disabled') || o.classList.contains('ui-autocomplete-group'))) return;
      var raw = (o.innerText || o.textContent || '').trim();
      if (!raw || /^-+.*-+$/.test(raw)) return;
      var tNorm = norm(raw);
      if (!tNorm) return;
      var sc = scoreOption(raw, raw, wanted, key);
      if (isAutocomplete) {
        if (tNorm === wNorm) sc = Math.max(sc, 100);
        else if (tNorm.indexOf(wNorm + ' jn') === 0 || tNorm.indexOf('new ' + wNorm) === 0 || tNorm.indexOf(wNorm + ' ') === 0) sc = Math.max(sc, 95);
        else if (tNorm.indexOf(wNorm) >= 0) sc = Math.max(sc, 82);
        else if (wNorm.length >= 2 && wNorm.length <= 4 && new RegExp('\\b' + wNorm + '$').test(tNorm)) sc = Math.max(sc, 90);
      }
      if (sc > bestSc) { bestSc = sc; best = o; }
    });
    if ((!best || bestSc < 40) && opts.length > 0 && isAutocomplete) {
      for (var i = 0; i < opts.length; i++) {
        var c = opts[i];
        if (c.classList && (c.classList.contains('ui-state-disabled') || c.classList.contains('p-disabled'))) continue;
        var firstTx = norm(c.innerText || c.textContent || '');
        if (firstTx && !/station/.test(firstTx.slice(0, 12)) && firstTx.indexOf(wNorm.slice(0, 3)) >= 0) { best = c; break; }
      }
    }
    return best;
  }

  var lastAcAttemptAt = 0;

  function processDdQueue() {
    if (ddBusy || ddQueue.length === 0) return;
    ddBusy = true;
    var isFastHost = !!(root.location && /irctc/i.test(root.location.href || ''));
    var job = ddQueue.shift();
    var el = job.el;
    var wanted = job.wanted;
    var key = job.key;
    function finishJob() {
      setTimeout(function () {
        try { el.removeAttribute && el.removeAttribute('data-sarthi-dd-queued'); } catch (e) { /* ignore */ }
      }, isFastHost ? 260 : 500);
      ddBusy = false;
      setTimeout(processDdQueue, isFastHost ? 90 : 180);
    }
    try {
      if (job.isAutocomplete && isAutocompleteCommitted(el) && !job.overwrite) {
        finishJob();
        return;
      }

      var pollAttempts = 0;
      var maxPollAttempts = job.isAutocomplete ? 20 : 10;
      function pollOptions() {
        pollAttempts++;
        try {
          var filterInput = document.querySelector('.p-dropdown-filter,.ui-dropdown-filter,.select2-search__field,.ng-input input,[role="listbox"] input[type="text"],.cdk-overlay-container input[type="text"]');
          if (filterInput && isVisible(filterInput) && filterInput !== el && !filterInput.getAttribute('data-sarthi-filtered')) {
            filterInput.setAttribute('data-sarthi-filtered', '1');
            setNativeValue(filterInput, wanted, { noBlur: true });
            setTimeout(pollOptions, isFastHost ? 140 : 250);
            return;
          }
          var opts = [];
          if (job.isAutocomplete) {
            var acScope = el.closest ? el.closest('p-autocomplete, .ui-autocomplete, [class*="autocomplete"]') : null;
            if (acScope) {
              opts = Array.prototype.slice.call(acScope.querySelectorAll(OPTION_SEL + ', li')).filter(isVisible);
            }
          }
          if (opts.length === 0) {
            opts = Array.prototype.slice.call(document.querySelectorAll(OPTION_SEL)).filter(isVisible);
          }
          if (opts.length === 0 && !job.isAutocomplete) {
            opts = findFallbackDropdownOptions(el);
          }
          if (opts.length === 0 && pollAttempts < maxPollAttempts) {
            if (job.isAutocomplete && pollAttempts === 9) {
              try {
                el.dispatchEvent(new InputEvent('input', { bubbles: true, data: wanted, inputType: 'insertText' }));
                if (root.KeyboardEvent) el.dispatchEvent(new root.KeyboardEvent('keyup', { key: 'a', keyCode: 65, which: 65, bubbles: true }));
              } catch (e) { /* ignore */ }
            }
            setTimeout(pollOptions, isFastHost ? 115 : 220);
            return;
          }
          var best = pickBestOverlayOption(opts, wanted, key, job.isAutocomplete);
          if (best) {
            clickLikeUser(best);
            if (job.isAutocomplete) el.setAttribute('data-sarthi-ac-done', '1');
            else el.setAttribute('data-sarthi-dd-done', norm(wanted));
            el.removeAttribute && el.removeAttribute('data-sarthi-dd-fail');
            mark(el, GREEN);
            fire(el, ['change', 'blur']);
          } else {
            if (job.isAutocomplete) {
              el.blur && el.blur();
            } else {
              var fails = parseInt((el.getAttribute && el.getAttribute('data-sarthi-dd-fail')) || '0', 10) + 1;
              el.setAttribute && el.setAttribute('data-sarthi-dd-fail', String(fails));
            }
          }
        } catch (e) { /* ignore */ }
        finishJob();
      }

      if (job.isAutocomplete && el.tagName === 'INPUT') {
        lastAcAttemptAt = Date.now();
        clickLikeUser(el);
        var hadVal = String(el.value || '').trim().length > 0;
        if (hadVal) {
          setNativeValue(el, '', { noBlur: true });
        }
        setTimeout(function () {
          typeTextIncrementally(el, wanted, function () {
            setTimeout(pollOptions, isFastHost ? 190 : 380);
          }, { fast: isFastHost });
        }, hadVal ? (isFastHost ? 110 : 240) : 50);
      } else {
        clickLikeUser(el);
        setTimeout(pollOptions, isFastHost ? 140 : 280);
      }
    } catch (e) {
      finishJob();
    }
  }

  function enqueueCustomDropdown(job) {
    if (!job || !job.el || !job.wanted) return;
    if (job.el.getAttribute('data-sarthi-dd-queued') === '1') return;
    job.el.setAttribute('data-sarthi-dd-queued', '1');
    setTimeout(function () { try { job.el.removeAttribute('data-sarthi-dd-queued'); } catch (e) { /* ignore */ } }, 4500);
    ddQueue.push(job);
    clearTimeout(ddStartTimer);
    ddStartTimer = setTimeout(processDdQueue, (root.location && /irctc/i.test(root.location.href || '')) ? 90 : 200);
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
      if (/^(hidden|submit|button|reset|image|range|color)$/.test(type)) return;
      if (!isVisible(el)) return;
      if (type === 'search') return;
      if (type === 'radio') { radios.push(el); return; }
      if (type === 'checkbox') { checks.push(el); return; }
      if (el.readOnly && !/dob|birth|journey|date/.test(hintOf(el))) return;

      var hint = hintOf(el);
      if (/\b(search|query|keyword|newsletter|subscribe|unsubscribe)\b|खोज/.test(hint) && !/from|to|station/.test(hint)) return;
      var sec = classifySecurity(hint) || (type === 'password' ? 'password' : null);
      // Masked Aadhaar inputs sometimes set type="password" — allow filling 12-digit Aadhaar if NOT a password prompt
      if (sec === 'password' && /aadhaar|aadhar|adhar|\buid\b|uidai/.test(hint) && !RE_PASSWORD.test(hint) && !RE_CAPTCHA.test(hint) && !RE_OTP.test(hint)) {
        sec = null;
      }
      if (sec) {
        // Fill password whenever loginPassword is supplied (skip only if confirm/create password on registration when user already has one, or fill both safely)
        if (sec === 'password' && data.loginPassword && String(data.loginPassword).trim()) {
          if (!String(el.value || '').trim()) {
            var pwVal = String(data.loginPassword).trim();
            var pwId = el.getAttribute('data-sarthi-id');
            if (!pwId) { pwId = 'sf' + (++uid); el.setAttribute('data-sarthi-id', pwId); }
            setNativeValue(el, pwVal);
            mark(el, GREEN);
            summary.filled++;
            if (summary.filledKeys.indexOf('loginPassword') < 0) summary.filledKeys.push('loginPassword');
            summary.filledItems.push({ id: pwId, tag: el.tagName.toLowerCase(), type: 'password', value: pwVal });
          }
          return;
        }
        if (sec === 'password' && !irSkipSavedLogin(data)) {
          var missPwId = el.getAttribute('data-sarthi-id');
          if (!missPwId) { missPwId = 'sf' + (++uid); el.setAttribute('data-sarthi-id', missPwId); }
          if (summary.needsUser.indexOf('loginPassword') < 0) summary.needsUser.push('loginPassword');
          if (summary.missingFields.length < 30 && !/confirm|re ?enter|retype|verify/i.test(hint)) {
            summary.missingFields.push({
              id: missPwId,
              key: 'loginPassword',
              label: readableLabelOf(el, 'loginPassword') || 'Login Password',
              tag: el.tagName.toLowerCase(),
              type: 'password',
              placeholder: el.placeholder || 'Enter Password',
              options: []
            });
          }
        }
        mark(el, AMBER);
        if (sec === 'captcha') summary.hasCaptcha = true;
        else if (sec === 'otp') summary.hasOtp = true;
        else if (sec === 'password') summary.hasPassword = true;
        else if (sec === 'payment') summary.hasPayment = true;
        return;
      }

      var isSelect = el.tagName === 'SELECT';
      var key = matchKey(hint, { type: type, autocomplete: el.getAttribute('autocomplete') || '' });
      var val = key ? valueFor(key, data) : '';
      var acPending = (key === 'fromStation' || key === 'toStation' || isAutocompleteEl(el)) && !isAutocompleteCommitted(el);
      var dateNeedsUpdate = key === 'journeyDate' && val && String(el.value || '').trim() !== formatDateForInput(val, type, el.placeholder, el.maxLength > 0 ? el.maxLength : 0);
      var rawCurVal = String(el.value || '').trim();
      var aadhaarNeedsFix = key === 'aadhaarNumber' && val && rawCurVal.replace(/\s+/g, '').length < 12;
      var already = !isSelect && rawCurVal.length > 0 && !acPending && !dateNeedsUpdate && !aadhaarNeedsFix;
      if (already && !opts.overwrite) return;
      if (isSelect && el.selectedIndex > 0 && !opts.overwrite) {
        var curTxt = norm(el.options[el.selectedIndex].text);
        if (curTxt && !/^(select|choose|please)/.test(curTxt)) return;
      }

      // PAN-type dropdown (Application Type / Applicant Category / Aadhaar Photo Agree): matchKey se pehle
      if (isSelect) {
        var pw = portalSelectWant(hint, data) || portalSelectWant(hint + ' ' + ancestorText(el).slice(0, 260), data);
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

      if ((key === 'fatherName' || key === 'motherName') && val) {
        var pp = parentPart(val, hint);
        if (pp === null) return;
        val = pp;
      }
      if (key === 'middleName' && !val) return;
      if ((key === 'loginUserId' || key === 'loginPassword') && irSkipSavedLogin(data)) return;
      if (key === 'loginUserId' && !val) {
        var uidMissingId = el.getAttribute('data-sarthi-id');
        if (!uidMissingId) { uidMissingId = 'sf' + (++uid); el.setAttribute('data-sarthi-id', uidMissingId); }
        mark(el, BLUE);
        if (summary.needsUser.indexOf('loginUserId') < 0) summary.needsUser.push('loginUserId');
        if (summary.missingFields.length < 30 && (isRequiredEl(el) || /user ?id|user ?name|login/i.test(hint))) {
          var alreadyAddedUid = summary.missingFields.some(function (m) { return m.id === uidMissingId; });
          if (!alreadyAddedUid) {
            summary.missingFields.push({
              id: uidMissingId,
              key: 'loginUserId',
              label: readableLabelOf(el, 'loginUserId') || 'User ID / Username',
              tag: el.tagName.toLowerCase(),
              type: type,
              placeholder: el.placeholder || 'Enter User ID / Username',
              options: []
            });
          }
        }
        return;
      }
      if (key === 'loginPassword' && !val) return;

      if (key && !val) {
        var isReqField = isRequiredEl(el);
        if (isReqField && /^(fullName|firstName|fatherName|motherName|dob|aadhaarNumber|panNumber|addressLine|pinCode|district|state|tenthRoll|twelfthRoll)$/.test(key)) {
          summary.isPersonalForm = true;
        }
        if (isReqField) {
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
        var isAcInput = !isSelect && (isAutocompleteEl(el) || key === 'fromStation' || key === 'toStation');

        if (isSelect) {
          ok = selectOption(el, val, key);
          if (ok && el.selectedIndex >= 0) {
            finalVal = (el.options[el.selectedIndex].text || val).trim();
          }
        } else if (isAcInput) {
          enqueueCustomDropdown({ el: el, wanted: String(val), key: key, isAutocomplete: true, overwrite: opts.overwrite || acPending });
          ok = true;
          summary.customQueued = (summary.customQueued || 0) + 1;
        } else {
          if (key === 'dob' || key === 'journeyDate') finalVal = formatDateForInput(val, type, el.placeholder, el.maxLength > 0 ? el.maxLength : 0);
          if (key === 'mobile' || key === 'alternateMobile') finalVal = String(val).replace(/\D/g, '').slice(-10);
          if (key === 'pinCode') finalVal = String(val).replace(/\D/g, '').slice(0, 6);
          if (key === 'panNumber') finalVal = String(val).toUpperCase();
          if (key === 'aadhaarNumber') finalVal = String(val).replace(/\D/g, '').slice(0, 12);
          if (el.maxLength > 0 && String(finalVal).length > el.maxLength && key !== 'dob' && key !== 'journeyDate') finalVal = String(finalVal).slice(0, el.maxLength);
          var wasRO = el.readOnly;
          if (wasRO) el.removeAttribute('readonly');
          if (key === 'aadhaarNumber') {
            typeDigitsIncrementally(el, finalVal);
          } else {
            setNativeValue(el, finalVal);
            if ((key === 'mobile' || key === 'alternateMobile' || key === 'pinCode') && String(el.value || '').replace(/\D/g, '') !== finalVal) {
              typeDigitsIncrementally(el, finalVal);
            }
          }
          if (wasRO) el.setAttribute('readonly', 'readonly');
          if (key === 'journeyDate') {
            try {
              el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, which: 27, bubbles: true }));
              el.blur && el.blur();
              var dp = document.querySelector('.ui-datepicker, .p-datepicker, .mat-datepicker-content');
              if (dp && isVisible(dp)) {
                var safeHdr = document.querySelector('h1, h2, .book-ticket, .heading-font');
                if (safeHdr && safeHdr.click) safeHdr.click();
              }
            } catch (e) { /* ignore */ }
          }
          ok = true;
        }
        if (ok) {
          mark(el, GREEN);
          summary.filled++;
          if (summary.filledKeys.indexOf(key) < 0) summary.filledKeys.push(key);
          if (!isAcInput) {
            summary.filledItems.push({ id: filledId, tag: el.tagName.toLowerCase(), type: type, value: String(finalVal) });
          }
          return;
        }
      }

      if (el.getAttribute('data-sarthi-asked')) return;
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
          placeholder: el.placeholder || '', options: o,
          required: isRequiredEl(el)
        });
      }
    });

    // Custom non-native dropdowns (SSC OTR mat-select / ng-select, IRCTC p-dropdown/ui-dropdown, Bootstrap/React dropdowns)
    findCustomDropdownTriggers().forEach(function (dd) {
      var curTxt = customDropdownLabelText(dd);
      var hint = norm(hintOf(dd) + ' ' + curTxt);
      if (classifySecurity(hint) || RE_ROBOT.test(hint)) return;
      var pw = portalSelectWant(hint, data);
      var key = pw ? null : matchKey(hint, { type: 'select', isCustomDd: true });
      var val = pw || (key ? valueFor(key, data) : '');
      if (!val) return;
      var doneWanted = dd.getAttribute && dd.getAttribute('data-sarthi-dd-done');
      if (!opts.overwrite && doneWanted && doneWanted === norm(String(val))) return;
      if (parseInt((dd.getAttribute && dd.getAttribute('data-sarthi-dd-fail')) || '0', 10) >= 2 && !opts.overwrite) return;
      var isPrePopulated = curTxt && !isCustomPlaceholderText(curTxt);
      if (!opts.overwrite && isPrePopulated) {
        // Already matches user's wanted value -> skip! If default ("All Classes" / "GENERAL"), update to user's choice!
        if (scoreOption(curTxt, curTxt, String(val), key) >= 80) return;
      }
      enqueueCustomDropdown({ el: dd, wanted: String(val), key: key, isSelectBox: true, overwrite: opts.overwrite || isPrePopulated });
      summary.filled++;
      summary.customQueued = (summary.customQueued || 0) + 1;
      if (key && summary.filledKeys.indexOf(key) < 0) summary.filledKeys.push(key);
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
      if (RE_DECLARATION.test(h) && !isIrctcNativeManual()) {
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
    if (summary.portalSelects > 0 && !opts._retry && !isIrctcNativeManual()) {
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
      var secType = classifySecurity(hint);
      if (secType && secType !== 'password') return;    // CAPTCHA, OTP, Payment kabhi AI se nahi bharte; Password sirf explicit map/user input se
      var type = (el.type || el.tagName).toLowerCase();
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
  var RE_NEXT = /^(next|next step|next page|continue|proceed|go to next|save (and )?(next|continue|proceed)|save & (next|continue|proceed)|submit & (next|continue)|search trains?|search|ok & proceed|i agree & continue|आगे|अगला|आगे बढ़ें|आगे बढे|जारी रखें|सेव और आगे)( |$)/;
  var RE_NO_CLICK = /final submit|finalise|pay now|make payment|proceed to pay|confirm booking|place order|checkout|logout|sign ?out|cancel|back|previous|reset|clear|close|download|print|delete|remove|भुगतान|जमा|रद्द|पीछे|बंद/;
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
      if (/^(hidden|submit|button|reset|image|range|color|search)$/.test(type)) return;
      if (el.disabled || (type !== 'file' && !isVisible(el))) return;
      if (el.readOnly && type !== 'checkbox') return;
      var hint = hintOf(el);
      var sec = classifySecurity(hint);
      if (sec && sec !== 'password') return;
      if (RE_ROBOT.test(hint)) return;
      if (type === 'password' || sec === 'password') {
        if (!String(el.value || '').trim() && !/confirm|re ?enter|retype|verify/i.test(hint)) {
          var epwId = el.getAttribute('data-sarthi-id');
          if (!epwId) { epwId = 'sf' + (++uid); el.setAttribute('data-sarthi-id', epwId); }
          out.push({ id: epwId, kind: 'text', key: 'loginPassword', label: readableLabelOf(el, 'loginPassword') || 'Login Password', tag: el.tagName.toLowerCase(), type: 'password', placeholder: el.placeholder || 'Enter password', options: [] });
        }
        return;
      }
      var key = matchKey(hint, { type: type, autocomplete: el.getAttribute('autocomplete') || '' });
      var isStationAc = (key === 'fromStation' || key === 'toStation' || isAutocompleteEl(el));
      if (isStationAc && !isAutocompleteCommitted(el)) {
        var acId = el.getAttribute('data-sarthi-id');
        if (!acId) { acId = 'sf' + (++uid); el.setAttribute('data-sarthi-id', acId); }
        out.push({ id: acId, kind: 'text', key: key || '', label: readableLabelOf(el, key), tag: 'input', type: 'text', placeholder: el.placeholder || '', options: [] });
        return;
      }
      if (!isRequiredEl(el)) return;
      var id = el.getAttribute('data-sarthi-id');
      if (!id) { id = 'sf' + (++uid); el.setAttribute('data-sarthi-id', id); }
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
          if (opts.length === 0) { out.push({ id: id, kind: 'wait', key: '', label: readableLabelOf(el, key) }); return; }
          var pw2 = portalSelectWant(hint, {});
          if (pw2 && selectOption(el, pw2, null)) return;
          out.push({ id: id, kind: 'select', key: key || '', label: readableLabelOf(el, key), tag: 'select', type: 'select', options: opts });
        }
        return;
      }
      if (!String(el.value || '').trim()) {
        out.push({ id: id, kind: 'text', key: key || '', label: readableLabelOf(el, key), tag: el.tagName.toLowerCase(), type: type, placeholder: el.placeholder || '', options: [] });
      }
    });
    // Also detect required custom dropdowns that still say "Select"
    findCustomDropdownTriggers().forEach(function (dd) {
      var curTxt = customDropdownLabelText(dd);
      if (!isCustomPlaceholderText(curTxt)) return;
      var hint = hintOf(dd);
      if (classifySecurity(hint) || RE_ROBOT.test(hint)) return;
      if (!isRequiredEl(dd) && !/gender|board|state|category/.test(hint)) return;
      var id = dd.getAttribute('data-sarthi-id');
      if (!id) { id = 'sf' + (++uid); dd.setAttribute('data-sarthi-id', id); }
      out.push({ id: id, kind: 'select', key: matchKey(hint, { type: 'select', isCustomDd: true }) || '', label: readableLabelOf(dd, null), tag: dd.tagName.toLowerCase(), type: 'custom-select', options: [] });
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

  function buildAsks(list, s) {
    var seen = {}, asks = [];
    function add(a) {
      var k = a.key ? 'k:' + a.key : 'i:' + a.id;
      if (seen[k]) return;
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

  function looksFinished(list) {
    if (list.length > 0) return false;
    var vis = Array.prototype.slice.call(document.querySelectorAll('input:not([type="hidden"]),select,textarea')).filter(isVisible);
    if (vis.length > 3) return false;
    var t = norm(((document.body && document.body.innerText) || '').slice(0, 4000));
    return /application (has been |is )?(successfully )?(submitted|registered)|successfully (submitted|registered|completed|booked)|acknowledg(e)?ment (number|no|receipt)|transaction (is )?successful|booking (is )?confirmed|आवेदन सफलतापूर्वक|सफलतापूर्वक जमा/.test(t);
  }

  // IRCTC LOGIN popup: jab user ne loginUserId/loginPassword payload me NAHI diya ho aur native Android saved-login handle kar raha ho tabhi skip karo;
  // jab user ne explicit credentials diye hon tab ALWAYS fill karo!
  function irSkipSavedLogin(data) {
    try {
      if (data && (String(data.loginUserId || '').trim() || String(data.loginPassword || '').trim())) {
        return false;
      }
      if (!/irctc\.co\.in/i.test(location.hostname)) return false;
      var h = String(location.href || '').toLowerCase();
      if (/register|signup/.test(h)) return false;
      var pw = Array.prototype.slice.call(document.querySelectorAll('input[type="password"]')).filter(isVisible);
      return pw.length < 2 && (typeof root.SarthiNative !== 'undefined' || typeof root.SarthiCred !== 'undefined');
    } catch (e) { return false; }
  }

  // IRCTC: ek click ke baad 20 sec koi dusra Next/Search click nahi (double click = "Sorry! Please try again")
  function irNextLocked() {
    try {
      if (!/irctc\.co\.in/i.test(location.hostname)) return false;
      var t = parseInt(root.sessionStorage.getItem('sarthi_ir_next_at') || '0', 10);
      return t > 0 && Date.now() - t < 20000;
    } catch (e) { return false; }
  }

  // IRCTC: login status helper (never blind-clicks LOGIN or Sorry links from clickNext)
  var irWaitMsg = '';
  function irIsLoggedIn() {
    try {
      var txt = (document.body && document.body.innerText) || '';
      if (/\blogout\b|\bsign ?out\b/i.test(txt)) return true;
      return !!document.querySelector('a[href*="logout"], button[aria-label*="logout" i]');
    } catch (e) { return false; }
  }
  function irLoginGate() {
    try {
      if (!/irctc\.co\.in/i.test(location.hostname)) return '';
      if (/register|signup/.test(String(location.href || '').toLowerCase())) return '';
      if (irIsLoggedIn()) return '';
      var bodyTxt = (document.body && document.body.innerText) || '';
      if (/please try again/i.test(bodyTxt)) {
        irWaitMsg = 'IRCTC session reset - Click here to login dabakar dobara kholein';
        return '__wait__';
      }
      if (Array.prototype.slice.call(document.querySelectorAll('input[type="password"]')).some(isVisible)) {
        irWaitMsg = 'IRCTC login: poora CAPTCHA daalo aur SIGN IN dabao';
        return '__wait__';
      }
      return '';
    } catch (e) { return ''; }
  }

  function clickNext() {
    irWaitMsg = '';
    if (/irctc\.co\.in/i.test(location.hostname)) return '';
    if (irNextLocked()) return '__wait__';
    var els = Array.prototype.slice.call(document.querySelectorAll('button,a,input[type="button"],input[type="submit"],[role="button"]'));
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!isVisible(el)) continue;
      var txt = norm(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '');
      if (!txt || txt.length > 35) continue;
      if (RE_NO_CLICK.test(txt)) continue;
      if (RE_NEXT.test(txt)) {
        try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
        clickLikeUser(el);
        try { if (/irctc\.co\.in/i.test(location.hostname)) root.sessionStorage.setItem('sarthi_ir_next_at', String(Date.now())); } catch (e) { /* ignore */ }
        return txt;
      }
    }
    return '';
  }

  var fillingTicks = 0, askedSig = '';

  var CUSTOM_SEL = '[role="combobox"],[role="listbox"],[role="radio"],[role="checkbox"],[role="switch"],[contenteditable="true"],mat-select,ng-select,p-dropdown,.ui-dropdown,[aria-haspopup="listbox"],.select2-selection,[class*="select__control"],.dropdown-toggle';
  var PLAN_NO_CLICK = /final submit|finalise|pay now|make payment|proceed to pay|confirm booking|place order|checkout|logout|sign ?out|cancel|back|previous|reset|clear|close|download|print|delete|remove|draft|verify|send otp|get otp|generate|upload|choose file|esign|e sign|digilocker|भुगतान|जमा|रद्द|पीछे|बंद/;

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
    for (var i = 0; i < all.length && fields.length < 90; i++) {
      var el = all[i];
      var type = (el.type || el.getAttribute('role') || el.tagName).toLowerCase();
      if (/^(hidden|submit|button|reset|image|range|color|search)$/.test(type)) continue;
      if (!isVisible(el) || el.disabled) continue;
      var hint = '';
      try { hint = hintOf(el); } catch (e) { hint = norm(el.getAttribute('aria-label') || el.textContent || ''); }
      if (classifySecurity(hint) && type !== 'password') continue;
      if (RE_ROBOT.test(hint)) continue;
      var id = el.getAttribute('data-sarthi-id');
      if (!id) { id = 'sf' + (++uid); el.setAttribute('data-sarthi-id', id); }
      var label = '';
      try { label = readableLabelOf(el, null); } catch (e) { /* ignore */ }
      if (!label) label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || '').trim().slice(0, 80);
      var value = '';
      if (el.tagName === 'SELECT') value = el.selectedIndex >= 0 ? (el.options[el.selectedIndex].text || '').trim() : '';
      else if (type === 'checkbox' || type === 'radio') value = el.checked ? 'checked' : '';
      else if (el.tagName === 'INPUT' && isAutocompleteEl(el)) {
        var acVal = String(el.value || '').trim();
        value = isAutocompleteCommitted(el) ? acVal : '';
      }
      else if ('value' in el) value = String(el.value || '');
      else {
        var rawTxt = customDropdownLabelText(el).slice(0, 60);
        value = isCustomPlaceholderText(rawTxt) ? '' : rawTxt;
      }
      fields.push({
        id: id, tag: el.tagName.toLowerCase(), type: type, label: label, value: value.slice(0, 60),
        required: isRequiredEl(el), section: sectionOf(el),
        options: el.tagName === 'SELECT' ? optionsOf(el) : []
      });
    }
    var bs = document.querySelectorAll('button,a[href],input[type="button"],input[type="submit"],[role="button"]');
    for (var j = 0; j < bs.length && buttons.length < 35; j++) {
      var b = bs[j];
      if (!isVisible(b)) continue;
      var tx = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim();
      if (!tx || tx.length > 45) continue;
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
      if (el.getAttribute('aria-checked') !== 'true') clickLikeUser(el);
      return;
    }
    enqueueCustomDropdown({
      el: el,
      wanted: String(value),
      key: null,
      isAutocomplete: el.tagName === 'INPUT',
      isSelectBox: el.tagName !== 'INPUT',
      overwrite: true
    });
  }

  function applyPlan(plan) {
    plan = plan || {};
    var res = { filled: 0, clickQueued: '' };
    var fills = plan.fills || {}, std = {}, custom = [];
    Object.keys(fills).forEach(function (id) {
      var el = document.querySelector('[data-sarthi-id="' + id + '"]');
      var role = el ? (el.getAttribute('role') || '') : '';
      var isAc = isAutocompleteEl(el);
      if (!el || (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !/^(combobox|listbox|radio|checkbox|switch)$/.test(role) && !el.isContentEditable && !isAc)) std[id] = fills[id];
      else custom.push({ el: el, value: fills[id] });
    });
    if (Object.keys(std).length) res.filled += (applyMap(std).filled || 0);
    custom.forEach(function (c) {
      try { fillCustom(c.el, c.value); res.filled++; } catch (e) { /* ignore */ }
    });
    if (plan.click) {
      var btn = document.querySelector('[data-sarthi-id="' + plan.click + '"]');
      var bt = btn ? norm(btn.innerText || btn.value || btn.getAttribute('aria-label') || '') : '';
      if (btn && bt && !PLAN_NO_CLICK.test(bt)) {
        res.clickQueued = bt;
        setTimeout(function () {
          try {
            if (ddBusy || ddQueue.length > 0) return;
            var rem = emptyRequiredList();
            if (rem.length > 0) {
              rem.forEach(function (r) {
                var rel = document.querySelector('[data-sarthi-id="' + r.id + '"]');
                if (rel) mark(rel, BLUE);
              });
              return;
            }
            btn.scrollIntoView({ block: 'center' });
            clickLikeUser(btn);
          } catch (e) { /* ignore */ }
        }, 1000 * (custom.length + 1) + 1200);
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
    state: 'State', birthPlace: 'Janm sthan (Place of birth)', bloodGroup: 'Blood group', qualification: 'Qualification',
    fromStation: 'From Station (Kahan se)', toStation: 'To Station (Kahan tak)', journeyDate: 'Journey Date (DD/MM/YYYY)',
    trainClass: 'Train Class (SL / 3A / 2A)', trainQuota: 'Quota (GENERAL / TATKAL / LADIES)'
  };
  var PROFILES = [
    { name: 'PAN Card',
      test: /proteantech|tin-nsdl|tin\.nsdl|utiitsl|nsdl\.co|new pan|form 49a|pan application/,
      keys: ['fullName', 'dob', 'gender', 'fatherName', 'motherName', 'mobile', 'email', 'addressLine', 'district', 'state', 'pinCode'],
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
    { name: 'IRCTC Ticket Booking',
      test: /irctc/,
      keys: ['fromStation', 'toStation', 'journeyDate', 'trainClass', 'trainQuota', 'fullName', 'dob', 'gender', 'mobile', 'email'],
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
  var RE_OTP_VERIFY = /(verify|validate|confirm|submit)\s*(the\s*|my\s*|your\s*|aadhaa?r\s*|mobile\s*|phone\s*|email\s*)?(otp|code)|otp\s*(verify|validate|submit|confirm)|^(verify|validate)(\s+(mobile|phone|email|aadhaa?r|number))?$|सत्यापित|ओटीपी\s*(जमा|सत्यापन)/;
  var otpSentAt = {}, otpVerifyAt = {};

  function otpPageKey() { return (root.location ? root.location.pathname : '') + '|' + (document.title || ''); }

  function clickables(scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll('button,a,input[type="button"],input[type="submit"],[role="button"]'))
      .filter(function (el) { return isVisible(el); });
  }

  function btnText(el) { return norm(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.title || ''); }

  function isBtnEnabled(b) {
    if (!b || b.disabled) return false;
    if (b.getAttribute && b.getAttribute('aria-disabled') === 'true') return false;
    if (/disable-btn|disabled/.test(b.className || '')) return false;
    return true;
  }

  function findAllBtns(re, scope) {
    return clickables(scope).filter(function (el) {
      if (!isBtnEnabled(el)) return false;
      var t = btnText(el);
      if (!t || t.length > 40) return false;
      if (RE_OTP_RESEND.test(t)) return false;
      return re.test(t);
    });
  }

  function findNearestOtpBtn(re, oi) {
    var node = oi ? oi.parentElement : null;
    for (var up = 0; up < 5 && node && node !== document.body; up++) {
      var hits = findAllBtns(re, node);
      if (hits.length > 0) return hits[0];
      node = node.parentElement;
    }
    var all = findAllBtns(re, document);
    return all.length ? all[0] : null;
  }

  function captchaPending() {
    var ins = Array.prototype.slice.call(document.querySelectorAll('input,textarea'));
    for (var i = 0; i < ins.length; i++) {
      var el = ins[i], type = (el.type || '').toLowerCase();
      if (/^(hidden|submit|button|checkbox|radio|file)$/.test(type) || !isVisible(el) || el.disabled) continue;
      if (classifySecurity(hintOf(el)) === 'captcha' && !String(el.value || '').trim()) return true;
    }
    return false;
  }

  function contactFilled() {
    var ins = Array.prototype.slice.call(document.querySelectorAll('input,textarea'));
    for (var i = 0; i < ins.length; i++) {
      var el = ins[i], type = (el.type || '').toLowerCase();
      if (/^(hidden|submit|button|checkbox|radio|file|password)$/.test(type) || !isVisible(el)) continue;
      var k = matchKey(hintOf(el), { type: type, autocomplete: el.getAttribute('autocomplete') || '' });
      var v = String(el.value || '').trim();
      var d = v.replace(/\D/g, '');
      if (k === 'mobile' && /^[6-9]\d{9}$/.test(d)) return true;
      if (k === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return true;
      if (k === 'aadhaarNumber' && d.length === 12) return true;
    }
    return false;
  }

  function rowContactReady(sb) {
    var node = sb ? sb.parentElement : null;
    for (var up = 0; up < 4 && node && node !== document.body; up++) {
      var ins = Array.prototype.slice.call(node.querySelectorAll('input,textarea'));
      var hasContact = false;
      for (var i = 0; i < ins.length; i++) {
        var el = ins[i], type = (el.type || '').toLowerCase();
        if (/^(hidden|submit|button|checkbox|radio|file|password)$/.test(type) || !isVisible(el)) continue;
        var h = hintOf(el);
        var k = matchKey(h, { type: type, autocomplete: el.getAttribute('autocomplete') || '' });
        if (k === 'mobile' || k === 'email' || k === 'aadhaarNumber') {
          hasContact = true;
          var v = String(el.value || '').trim();
          var d = v.replace(/\D/g, '');
          if (k === 'mobile' && /^[6-9]\d{9}$/.test(d)) return true;
          if (k === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return true;
          if (k === 'aadhaarNumber' && d.length === 12) return true;
        }
      }
      if (hasContact) return false;
      node = node.parentElement;
    }
    return contactFilled();
  }

  function findOtpInputs() {
    var out = [];
    var ins = Array.prototype.slice.call(document.querySelectorAll('input'));
    for (var i = 0; i < ins.length; i++) {
      var el = ins[i], type = (el.type || '').toLowerCase();
      if (/^(hidden|submit|button|checkbox|radio|file)$/.test(type) || !isVisible(el) || el.disabled) continue;
      if (RE_OTP.test(hintOf(el))) out.push(el);
    }
    return out;
  }

  // return: '' | 'send' | 'verify'
  function otpAssist() {
    try {
      var now = Date.now();
      // 1) User ne kisi bhi OTP box me 4-8 digit OTP dal diya -> us row ka Verify OTP dabao
      var ois = findOtpInputs();
      for (var i = 0; i < ois.length; i++) {
        var oi = ois[i];
        var v = String(oi.value || '').trim();
        if (!/^\d{4,8}$/.test(v)) continue;
        var lastAt = parseInt(oi.getAttribute('data-sarthi-otp-v-at') || '0', 10);
        var lastVal = oi.getAttribute('data-sarthi-otp-v-val') || '';
        if (lastVal === v && now - lastAt < 4500) continue;
        var vb = findNearestOtpBtn(RE_OTP_VERIFY, oi);
        if (vb) {
          oi.setAttribute('data-sarthi-otp-v-at', String(now));
          oi.setAttribute('data-sarthi-otp-v-val', v);
          mark(vb, GREEN);
          clickLikeUser(vb);
          return 'verify';
        }
      }
      // 2) Jis contact row me sahi number/email/aadhaar bhar gaya hai, uska Send OTP dabao (per-button cooldown)
      if (!captchaPending()) {
        var sbs = findAllBtns(RE_OTP_SEND, document);
        for (var j = 0; j < sbs.length; j++) {
          var sb = sbs[j];
          var sentAt = parseInt(sb.getAttribute('data-sarthi-otp-sent-at') || '0', 10);
          if (sentAt && now - sentAt < 25000) continue;
          if (rowContactReady(sb)) {
            sb.setAttribute('data-sarthi-otp-sent-at', String(now));
            mark(sb, GREEN);
            clickLikeUser(sb);
            return 'send';
          }
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
    { q: /address for communication|communication address|correspondence address/, pick: /^(residence|residential)(\s|$)/ },
    { q: /residential status|resident status/, pick: /^resident(\s|$)/ },
    { q: /upload.*proof|proof of date of birth other than|supporting documents/, pick: /manual/ },
    { q: /single parent/, pick: /^no(\s|$)/ },
    { q: /parent.*printed on.*pan|printed on the pan card/, pick: /father/ },
    { q: /physical copy|soft copy/, pick: /physical/ },
    { q: /appointing (a )?representative|representative assessee/, pick: /^no(\s|$)/ }
  ];
  var DEF_SELECTS = [
    { q: /proof of date of birth|proof of dob|date of birth proof/, pick: /aadhaa?r/ },
    { q: /proof of identity|identity proof/, pick: /aadhaa?r/ },
    { q: /proof of address|address proof/, pick: /aadhaa?r/ },
    { q: /\btitle\b|salutation/, pick: /^shri$|^mr$/ },
    { q: /\bcapacity\b|in the capacity of/, pick: /himself|herself|individual|self/ },
    { q: /\bcountry\b(?!.*(code|isd|std))/, pick: /^india$/ }
  ];

  function ancestorMatches(el, re, maxLen) {
    var n = el, hops = 0;
    while (n && hops < 8) {
      var t = norm(String(n.innerText || '').slice(0, maxLen || 2400));
      if (t.length > 0 && t.length <= (maxLen || 2400) && re.test(t)) return true;
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
    var out = { filled: 0, missing: [], unlockedSection: false };
    try {
      var isFemale = /female|mahila|woman|stri|\bf\b/i.test(String((data && data.gender) || ''));
      // radios (match both ancestor context AND the radio group's option labels directly)
      var radios = Array.prototype.slice.call(document.querySelectorAll('input[type="radio"]')).filter(function (r) { return !r.disabled && isVisible(r); });
      var gs = groupRadios(radios);
      Object.keys(gs).forEach(function (gk) {
        var grp = gs[gk];
        if (grp.some(function (r) { return r.checked; })) return;
        var ctx = norm(grp.map(function (r) { return ancestorText(r); }).join(' ') + ' ' + sectionOf(grp[0]));
        var optLabs = grp.map(function (r) { return norm(adjacentControlLabel(r)) || radioLabel(r); });
        var hasOpt = function (re) { return optLabs.some(function (l) { return re.test(l); }); };
        var pickOpt = function (re) {
          return grp.find(function (r) {
            var lb = norm(adjacentControlLabel(r)) || radioLabel(r);
            return re.test(lb);
          }) || null;
        };

        var pickedRadio = null;
        if (hasOpt(/^(residence|residential)(\s|$)/) && hasOpt(/^office(\s|$)/)) {
          pickedRadio = pickOpt(/^(residence|residential)(\s|$)/);
        } else if (hasOpt(/^resident(\s|$)/) && hasOpt(/non ?resident/)) {
          pickedRadio = grp.find(function (r) { var lb = norm(adjacentControlLabel(r)) || radioLabel(r); return /^resident(\s|$)/.test(lb) && !/non ?resident/.test(lb); });
        } else if (hasOpt(/indian citizen/) && hasOpt(/nri|foreign/)) {
          pickedRadio = pickOpt(/indian citizen/);
        } else if (hasOpt(/father.?s name/) && hasOpt(/mother.?s name/)) {
          var wantMother = data && data.motherName && !data.fatherName;
          pickedRadio = pickOpt(wantMother ? /mother/ : /father/);
        } else if (/single parent/.test(ctx) && hasOpt(/^yes\b/) && hasOpt(/^no\b/)) {
          var isSingle = data && data.motherName && !data.fatherName;
          pickedRadio = pickOpt(isSingle ? /^yes\b/ : /^no\b/);
        } else if (/representative assessee/.test(ctx) && hasOpt(/^yes\b/) && hasOpt(/^no\b/)) {
          pickedRadio = pickOpt(/^no\b/);
        } else {
          DEF_RADIOS.forEach(function (d) {
            if (pickedRadio || !d.q.test(ctx)) return;
            pickedRadio = pickOpt(d.pick);
          });
        }
        if (pickedRadio) {
          try { pickedRadio.click(); } catch (e) { /* ignore */ }
          if (!pickedRadio.checked) { pickedRadio.checked = true; fire(pickedRadio, ['input', 'change']); }
          mark(pickedRadio.parentElement || pickedRadio, GREEN);
          out.filled++;
          if (/residence|residential/.test(radioLabel(pickedRadio))) out.unlockedSection = true;
        }
      });
      // dropdowns (Proof of ID/Address/DOB, Title, Country, Declaration Capacity)
      Array.prototype.slice.call(document.querySelectorAll('select')).forEach(function (sel) {
        if (sel.disabled || !isVisible(sel)) return;
        if (sel.selectedIndex > 0 && sel.value) return;
        var h = hintOf(sel);
        if (classifySecurity(h)) return;
        if (/\btitle\b|salutation/.test(h)) {
          var titleRe = isFemale ? /^(smt|kumari|ms|mrs)$/ : /^(shri|mr)$/;
          if (pickByRegex(sel, titleRe)) { mark(sel, GREEN); out.filled++; return; }
        }
        for (var i = 0; i < DEF_SELECTS.length; i++) {
          if (DEF_SELECTS[i].q.test(h)) {
            if (pickByRegex(sel, DEF_SELECTS[i].pick)) { mark(sel, BLUE); out.filled++; return; }
            if (/proof of/.test(h) && sel.options.length > 1) {
              for (var oi = 1; oi < sel.options.length; oi++) {
                if (sel.options[oi].value && !/select|choose|please/i.test(sel.options[oi].text || '')) {
                  sel.selectedIndex = oi; fire(sel, ['input', 'change']); mark(sel, BLUE); out.filled++; return;
                }
              }
            }
          }
        }
      });
      // designation & verifying place (declaration)
      Array.prototype.slice.call(document.querySelectorAll('input[type="text"],input:not([type])')).forEach(function (el) {
        if (el.disabled || el.readOnly || !isVisible(el) || String(el.value || '').trim()) return;
        var h = hintOf(el);
        if (/designation/.test(h)) {
          setNativeValue(el, (data && data.designation) || 'Self');
          mark(el, BLUE); out.filled++;
        } else if (/\b(verifying place|place)\b/.test(h) && !/birth|office|work|station|from|to/.test(h)) {
          var pv = (data && (data.district || data.villageOrWard || data.state)) || '';
          if (pv) { setNativeValue(el, pv); mark(el, BLUE); out.filled++; }
        }
      });
      // PAN Step 4 AO Code auto-Fetch: ONLY when Area code/Range code/AO No are STILL empty! (If Pin Code already filled PTN/W/27/92, don't touch!)
      var aoEmpty = Array.prototype.slice.call(document.querySelectorAll('input')).some(function (el) {
        return isVisible(el) && !el.disabled && !String(el.value || '').trim() && /area ?code|range ?code|ao ?no|ao ?type/.test(hintOf(el));
      });
      if (aoEmpty) {
        var aoRadios = Array.prototype.slice.call(document.querySelectorAll('table input[type="radio"], .ao-table input[type="radio"]')).filter(function (r) { return !r.disabled && isVisible(r); });
        if (aoRadios.length > 0 && !aoRadios.some(function (r) { return r.checked; })) {
          clickLikeUser(aoRadios[0]);
          mark(aoRadios[0], BLUE);
          out.filled++;
        } else {
          var fetchBtn = findAllBtns(/^fetch$/i, document)[0];
          if (fetchBtn && !fetchBtn.getAttribute('data-sarthi-ao-fetched')) {
            fetchBtn.setAttribute('data-sarthi-ao-fetched', '1');
            clickLikeUser(fetchBtn);
            out.unlockedSection = true;
          }
        }
      }
      // source of income (checkbox group on PAN Step 3) -> use adjacentControlLabel so right-side labels like "<input> No income" never miss!
      var boxes = Array.prototype.slice.call(document.querySelectorAll('input[type="checkbox"]')).filter(function (c) { return !c.disabled && isVisible(c); });
      var inc = boxes.filter(function (c) {
        var lbl = norm(adjacentControlLabel(c));
        var meta = norm(lbl + ' ' + (c.value || '') + ' ' + (c.id || '') + ' ' + (c.name || ''));
        if (/^(no income|income from other sources|income from house property|income from business( profession)?|capital gains|salary)$/.test(lbl)) return true;
        return ancestorMatches(c, /source of income/, 3000) && /salary|business|profession|house property|other sources|capital gains|no income/.test(meta);
      });
      if (inc.length && !inc.some(function (c) { return c.checked; })) {
        var want = norm((data && data.incomeSource) || '');
        if (!want) {
          var noInc = inc.find(function (c) { return /\bno income\b/.test(norm(adjacentControlLabel(c))); }) ||
                      inc.find(function (c) { return /\bother sources\b/.test(norm(adjacentControlLabel(c))); });
          if (noInc) {
            try { noInc.click(); } catch (e) { /* ignore */ }
            if (!noInc.checked) { noInc.checked = true; fire(noInc, ['input', 'change']); }
            mark(noInc.parentElement || noInc, BLUE); out.filled++;
          } else {
            out.missing.push('Source of Income');
          }
        } else {
          var toks = want.split(/[,;|\/]+/).map(function (x) { return x.trim(); }).filter(Boolean);
          inc.forEach(function (c) {
            var lb = norm(adjacentControlLabel(c));
            if (toks.some(function (t) { return t && (lb.indexOf(t) >= 0 || t.indexOf(lb.split(' ')[0]) === 0); })) {
              try { c.click(); } catch (e) { /* ignore */ }
              if (!c.checked) { c.checked = true; fire(c, ['input', 'change']); }
              mark(c.parentElement || c, BLUE); out.filled++;
            }
          });
        }
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  // Radio group ka sawal: parent levels + previous headings sab padho (25 chars pe break mat karo)
  function ancestorText(el) {
    var n = el, hops = 0, parts = [];
    while (n && hops < 6 && n.tagName !== 'FORM' && n.tagName !== 'BODY') {
      var txt = String(n.innerText || '').trim();
      if (txt.length <= 500) {
        if (txt) parts.push(norm(txt));
        var prev = n.previousElementSibling;
        if (prev && prev.innerText && prev.innerText.length <= 160) parts.push(norm(prev.innerText));
      }
      n = n.parentElement;
      hops++;
    }
    return parts.join(' ');
  }

  // ---------------------------------------------------------------
  // IRCTC SMART BOOKING BRAIN (Confirmation popups + Train List + Class + Slot + Book Now)
  // User ne preferredTrain diya ho to wahi train, warna BEST available/RAC train khud chuno.
  // CAPTCHA / OTP / Payment par user ko pause dena compulsory hai.
  // ---------------------------------------------------------------
  var irctcLastActAt = 0, irctcBookAt = 0;

  function irctcWantedClasses(trainClass) {
    var cp = norm(trainClass || '');
    if (/\b(1a|1st|fc)\b|first\s*ac|fast\s*ac|ac\s*first|first\s*class/.test(cp)) return ['1A', '2A', '3A'];
    if (/\b(2a|2ac)\b|2\s*tier|second\s*ac/.test(cp)) return ['2A', '3A', '1A'];
    if (/\b3e\b|economy/.test(cp)) return ['3E', '3A', 'SL', '2A'];
    if (/\b(cc|ec)\b|chair/.test(cp)) return ['CC', 'EC', '2S'];
    if (/\b2s\b|second sitting/.test(cp)) return ['2S', 'SL', 'CC'];
    if (/sleeper|\bsl\b/.test(cp)) return ['SL', '2S', '3E', '3A'];
    if (/3a|3\s*tier|3ac|\bac\b/.test(cp)) return ['3A', '3E', '2A', '1A', 'SL'];
    return ['SL', '3A', '3E', '2A', '1A', 'CC', '2S'];
  }

  function irctcCardMatchesTrain(cardText, prefTrain) {
    var pt = norm(prefTrain || '');
    if (!pt) return true;
    var ct = norm(cardText || '');
    var numMatch = pt.match(/\b\d{4,5}\b/);
    if (numMatch && ct.indexOf(numMatch[0]) >= 0) return true;
    var toks = pt.split(' ').filter(function (w) { return w.length > 2 && !/^(express|exp|superfast|sf|mail|train|special|spl)$/.test(w); });
    if (!toks.length) return ct.indexOf(pt) >= 0;
    var hits = 0;
    toks.forEach(function (t) { if (ct.indexOf(t) >= 0) hits++; });
    return hits >= Math.min(2, toks.length);
  }

  function irctcClassTokenOf(txt) {
    var t = norm(txt);
    if (!t || t.length > 42) return '';
    if (/\b(sl|sleeper)\b/.test(t) && !/ladies|tatkal/.test(t)) return 'SL';
    if (/\b3e\b|ac 3 economy/.test(t)) return '3E';
    if (/\b(3a|3 tier|ac 3)\b/.test(t) && !/economy/.test(t)) return '3A';
    if (/\b(2a|2 tier|ac 2)\b/.test(t)) return '2A';
    if (/\b(1a|first class|first ac|ac first)\b/.test(t)) return '1A';
    if (/\b(cc|chair car)\b/.test(t)) return 'CC';
    if (/\b(2s|second sitting)\b/.test(t)) return '2S';
    if (/\bec\b|exec/.test(t)) return 'EC';
    return '';
  }

  function irctcClickableChild(tile, wantRefresh, retryOuter) {
    if (!tile || !tile.querySelectorAll) return tile;
    if (retryOuter && !wantRefresh && tile.closest) {
      var tdWrap = tile.closest('td, .link, [role="gridcell"]');
      if (tdWrap && isVisible(tdWrap)) return tdWrap;
    }
    var pre = tile.classList && tile.classList.contains('pre-avl') ? tile : tile.querySelector('.pre-avl');
    var rootTile = pre || tile;
    if (wantRefresh) {
      var list = rootTile.querySelectorAll('a, button, [role="button"], .link, [class*="refresh"], i.fa-refresh, div, span, strong');
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!isVisible(c)) continue;
        var ct = norm(c.innerText || '');
        if ((c.classList && c.classList.contains('link')) || /refresh/.test(ct) || /fa-refresh|refresh/.test(c.className || '')) {
          if (c.children && c.children.length === 1 && /refresh/i.test(c.children[0].innerText || '')) return c.children[0];
          return c;
        }
      }
    }
    // Date slots: NEVER click inner static <strong> (can miss Angular (click) on div.pre-avl / td.link)
    var inner = rootTile.querySelector('a, button, [role="button"]');
    return (inner && isVisible(inner)) ? inner : rootTile;
  }

  function irctcIsBookBtnEnabled(b) {
    if (!b || !isVisible(b) || b.disabled) return false;
    if (!/^book now$/.test(norm(b.innerText || b.value || ''))) return false;
    if (b.getAttribute && b.getAttribute('aria-disabled') === 'true') return false;
    var p = b, hops = 0;
    while (p && hops < 4) {
      if (/disable-btn|btn-disabled|\bdisabled\b/.test(p.className || '')) return false;
      p = p.parentElement; hops++;
    }
    try {
      var st = root.getComputedStyle ? root.getComputedStyle(b) : null;
      if (st) {
        if (st.opacity !== '' && parseFloat(st.opacity) < 0.85) return false;
        if (st.pointerEvents === 'none' || st.cursor === 'not-allowed') return false;
        var bg = String(st.backgroundColor || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/i);
        if (bg) {
          var r = parseInt(bg[1], 10), g = parseInt(bg[2], 10), bl = parseInt(bg[3], 10);
          var alpha = bg[4] !== undefined ? parseFloat(bg[4]) : 1;
          if (alpha > 0 && alpha < 0.85) return false;
          // Faded IRCTC Book Now is pale peach (high R, G, B with orange bias); active IRCTC Book Now is deep orange #fb792b (g~121, b~43)
          if (r >= 230 && g >= 175 && bl >= 135 && (r - bl) >= 20) return false;
        }
      }
    } catch (e) { /* ignore */ }
    return true;
  }

  function irctcIsSlotSelected(sl) {
    if (!sl) return false;
    var nodes = [sl];
    try {
      if (sl.parentElement) nodes.push(sl.parentElement);
      var td = sl.closest && sl.closest('td, .link, .pre-avl');
      if (td && nodes.indexOf(td) < 0) nodes.push(td);
    } catch (e) { /* ignore */ }
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (/selected|active|highlighted|ui-state-highlight|p-highlight|border-orange/.test(n.className || '')) return true;
      if (n.getAttribute && n.getAttribute('aria-selected') === 'true') return true;
    }
    return false;
  }

  function irctcInferPageClassHint() {
    try {
      var dd = document.querySelector('p-dropdown[formcontrolname="journeyClass"], p-dropdown[formcontrolname*="class"]');
      if (dd) {
        var lt = customDropdownLabelText(dd);
        if (lt && !/all classes/i.test(lt)) return lt;
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  function irctcTrainListStep(data) {
    try {
      var href = String((root.location ? root.location.href : '') || '').toLowerCase();
      if (!/irctc/.test(href)) return null;
      if (isNativeWebViewHost()) {
        if (irPwInputs().length > 0) return null;
        var nDialogs = Array.prototype.slice.call(document.querySelectorAll('.ui-dialog, .p-dialog, [role="dialog"], .modal.show, app-confirmation-dialog, app-login')).filter(isVisible);
        for (var nd = 0; nd < nDialogs.length; nd++) {
          if (nDialogs[nd].querySelector('input:not([type="hidden"]), select, textarea')) return null;
          var nBtns = Array.prototype.slice.call(nDialogs[nd].querySelectorAll('button, a, [role="button"]')).filter(isVisible);
          for (var nb = 0; nb < nBtns.length; nb++) {
            var nbt = norm(nBtns[nb].innerText || nBtns[nb].value || '');
            if (/^(yes|i agree|agree|ok|ok proceed|continue|proceed)$/.test(nbt) && !RE_NO_CLICK.test(nbt)) {
              return { state: 'user', tatkalStage: 'train_list', note: 'Confirmation popup par khud Yes / I Agree dabao (AI tap se block hota hai)' };
            }
          }
        }
        var nCards = Array.prototype.slice.call(document.querySelectorAll('app-train-avl-enq, .train-avl-enq')).filter(isVisible);
        if (nCards.length > 0) {
          var nPref = (data && data.preferredTrain) ? String(data.preferredTrain).trim() : '';
          if (nPref) {
            var nMatch = nCards.find(function (c) { return irctcCardMatchesTrain(c.innerText || '', nPref); });
            if (nMatch && !nMatch.getAttribute('data-sarthi-scrolled')) {
              try {
                nMatch.setAttribute('data-sarthi-scrolled', '1');
                nMatch.scrollIntoView({ block: 'center', behavior: 'smooth' });
              } catch (eSc) { /* ignore */ }
            }
          }
          return {
            state: 'user',
            tatkalStage: 'train_list',
            note: (nPref ? ('Train ' + nPref + ' ready — ') : 'Train List ready! ') + 'Class chuno aur khud Book Now dabao (AI tap se Sorry error aata hai)'
          };
        }
        return null;
      }
      var now = Date.now();

      // 0) If Login / Password / OTP / CAPTCHA modal is open over the Train List page, hand over IMMEDIATELY!
      if (irPwInputs().length > 0) return null;
      var dialogs = Array.prototype.slice.call(document.querySelectorAll('.ui-dialog, .p-dialog, [role="dialog"], .modal.show, app-confirmation-dialog, app-login')).filter(isVisible);
      for (var chk = 0; chk < dialogs.length; chk++) {
        if (dialogs[chk].querySelector('input:not([type="hidden"]), select, textarea')) {
          return null;
        }
      }

      // 1) Confirmation / T&C modal dialogs ("Yes", "I Agree", "OK") — never click Cancel/No/Pay
      for (var d = 0; d < dialogs.length; d++) {
        var dlgBtns = Array.prototype.slice.call(dialogs[d].querySelectorAll('button, a, [role="button"]')).filter(isVisible);
        for (var db = 0; db < dlgBtns.length; db++) {
          var bt = norm(dlgBtns[db].innerText || dlgBtns[db].value || '');
          if (/^(yes|i agree|agree|ok|ok proceed|continue|proceed)$/.test(bt) && !RE_NO_CLICK.test(bt)) {
            if (now - irctcLastActAt < 550) return { state: 'filling', tatkalStage: 'train_list', note: 'Confirmation popup accept...' };
            irctcLastActAt = now;
            clickLikeUser(dlgBtns[db]);
            return { state: 'next', clicked: bt, tatkalStage: 'train_list', note: 'IRCTC popup accepted (' + bt + ')' };
          }
        }
      }

      // 2) Only act on train cards when train search results are visible (never on Search/Passenger page)
      var cards = Array.prototype.slice.call(document.querySelectorAll('app-train-avl-enq, .train-avl-enq')).filter(isVisible);
      if (!cards.length) {
        var bookBtns = Array.prototype.slice.call(document.querySelectorAll('button, input[type="button"]')).filter(function (b) {
          return isVisible(b) && /^book now$/.test(norm(b.innerText || b.value || ''));
        });
        bookBtns.forEach(function (b) {
          var c = b.closest && (b.closest('.form-group, .white-back, .bull-back, .train-container, div[class*="train"]') || b.parentElement.parentElement);
          if (c && cards.indexOf(c) < 0) cards.push(c);
        });
      }
      if (!cards.length) return null;

      // 2b) Ensure Quota dropdown on Train-List matches user's Tatkal preference before refreshing availability
      if (data && data.trainQuota && !irFlow.busy) {
        var qreList = irQuotaRe(data.trainQuota);
        var qddList = qreList ? irFindDd('quota') : null;
        if (qddList && !qreList.test(irDdLabel(qddList)) && irTry('tl_quota') <= 2) {
          irFlow.busy = true; irFlow.since = now; irFlow.note = 'Quota (' + data.trainQuota + ') set ho raha hai...';
          irPickDropdown(qddList, qreList, function () { irFlow.busy = false; });
          return { state: 'filling', tatkalStage: 'train_list', note: irFlow.note };
        }
      }

      var prefTrain = (data && data.preferredTrain) ? String(data.preferredTrain).trim() : '';
      var effClass = (data && data.trainClass && !/all classes/i.test(data.trainClass)) ? data.trainClass : irctcInferPageClassHint();
      var wantedClasses = irctcWantedClasses(effClass);
      var matchingCards = cards.filter(function (c) {
        return prefTrain ? irctcCardMatchesTrain(c.innerText || '', prefTrain) : (c.getAttribute('data-sarthi-regret') !== '1');
      });
      if (!matchingCards.length) {
        if (prefTrain) return { state: 'filling', tatkalStage: 'train_list', note: 'Train "' + prefTrain + '" list me dhundhi ja rahi hai...' };
        matchingCards = cards;
      }

      // Score cards: prefer cards having wanted primary class + AVAILABLE / RAC + enabled Book Now
      var chosen = matchingCards[0], bestCardScore = -1;
      matchingCards.forEach(function (card, idx) {
        var txt = (card.innerText || '').toUpperCase();
        var sc = (matchingCards.length - idx);
        var hasAvl = /\b(AVAILABLE|CURR[_\s-]?AVBL|AVBL)\b/.test(txt);
        var hasRac = /\bRAC\s*\d*\b/.test(txt);
        var hasWl = /\b(WL|RLWL|PQWL|GNWL|TQWL)\s*\d*\b/.test(txt);
        var cardTiles = Array.prototype.slice.call(card.querySelectorAll('.pre-avl, td, strong, span')).filter(function (el) {
          return isVisible(el) && !!irctcClassTokenOf(el.innerText || '');
        });
        var hasPrimary = cardTiles.some(function (t) { return irctcClassTokenOf(t.innerText || '') === wantedClasses[0]; });
        var hasSecondary = wantedClasses[1] && cardTiles.some(function (t) { return irctcClassTokenOf(t.innerText || '') === wantedClasses[1]; });
        var bookBtn = Array.prototype.slice.call(card.querySelectorAll('button, input[type="button"]')).find(irctcIsBookBtnEnabled);
        if (hasPrimary) sc += 180;
        else if (hasSecondary) sc += 80;
        if (hasAvl) sc += 500;
        else if (hasRac) sc += 250;
        else if (hasWl) sc += 80;
        if (bookBtn && (hasAvl || hasRac || hasWl)) sc += 300;
        if (sc > bestCardScore) { bestCardScore = sc; chosen = card; }
      });

      if (!chosen) return null;

      // 3) Look for date/availability slots inside chosen card (prefer inner .pre-avl over outer td wrapper)
      var slotCandidates = Array.prototype.slice.call(chosen.querySelectorAll('.pre-avl, td, div[class*="avl"], div[tabindex], a')).filter(function (el) {
        if (!isVisible(el)) return false;
        if (el.tagName === 'TD' && el.querySelector && el.querySelector('.pre-avl')) return false;
        var t = (el.innerText || '').trim();
        if (!t || t.length > 72) return false;
        return /\b(AVAILABLE|CURR[_\s-]?AVBL|AVBL|RAC\s*\d*|WL\s*\d*|RLWL\s*\d*|PQWL\s*\d*|GNWL\s*\d*|TQWL\s*\d*|REGRET|NOT AVAILABLE)\b/i.test(t) &&
               !/(SLEEPER|AC 3|AC 2|AC FIRST|CHAIR CAR|SECOND SITTING)/i.test(t);
      });
      var bookableSlots = slotCandidates.filter(function (el) {
        var u = (el.innerText || '').toUpperCase();
        return /\b(AVAILABLE|CURR[_\s-]?AVBL|AVBL|RAC\s*\d*|WL\s*\d*|RLWL\s*\d*|PQWL\s*\d*|GNWL\s*\d*|TQWL\s*\d*)\b/.test(u) && !/\b(REGRET|NOT AVAILABLE|CANCELLED)\b/.test(u);
      });

      // If all loaded slots in this non-preferred train are REGRET/NOT AVAILABLE, skip this card on next tick
      if (slotCandidates.length > 0 && bookableSlots.length === 0 && !prefTrain) {
        chosen.setAttribute('data-sarthi-regret', '1');
        return { state: 'filling', tatkalStage: 'train_list', note: 'Train regret hai - agli available train dekh raha hai...' };
      }

      // Agar IRCTC ka yellow toast "please select class" dikh raha hai to slot abhi select nahi hua — dobara td/pre-avl pe click karo
      var toastErr = Array.prototype.slice.call(document.querySelectorAll('.ui-toast, .p-toast, .toast, [role="alert"]')).some(function (t) {
        return isVisible(t) && /please select class/i.test(t.innerText || '');
      });
      // Check genuinely enabled Book Now button (never click faded/disabled orange button)
      var chosenBookBtn = toastErr ? null : Array.prototype.slice.call(chosen.querySelectorAll('button, input[type="button"]')).find(irctcIsBookBtnEnabled);

      if (bookableSlots.length > 0) {
        // Pick best slot: AVAILABLE/CURR_AVBL first, then RAC, then WL
        var bestSlot = bookableSlots[0], bestSlotScore = -1;
        bookableSlots.forEach(function (sl) {
          var u = (sl.innerText || '').toUpperCase();
          var sc = /\b(AVAILABLE|CURR[_\s-]?AVBL|AVBL)\b/.test(u) ? 300 : (/\bRAC\s*\d*\b/.test(u) ? 200 : 100);
          if (irctcIsSlotSelected(sl)) sc += 20;
          if (sc > bestSlotScore) { bestSlotScore = sc; bestSlot = sl; }
        });
        var slotAt = parseInt(chosen.getAttribute('data-sarthi-slot-at') || '0', 10);
        var slotTries = parseInt(chosen.getAttribute('data-sarthi-slot-tries') || '0', 10);
        var slotClicked = chosen.getAttribute('data-sarthi-slot-clicked') === '1';
        var isSlotSelected = !toastErr && (irctcIsSlotSelected(bestSlot) || (!!chosenBookBtn && slotClicked));
        if (!isSlotSelected) {
          if (now - slotAt >= 600 && now - irctcLastActAt >= 320) {
            irctcLastActAt = now;
            chosen.setAttribute('data-sarthi-slot-at', String(now));
            chosen.setAttribute('data-sarthi-slot-tries', String(slotTries + 1));
            chosen.setAttribute('data-sarthi-slot-clicked', '1');
            mark(bestSlot, GREEN);
            clickLikeUser(irctcClickableChild(bestSlot, false, slotTries % 2 === 1));
            return { state: 'filling', tatkalStage: 'train_list', note: 'Date slot fast-select kiya...' };
          }
          return { state: 'filling', tatkalStage: 'train_list', note: 'Date slot active hone ka wait...' };
        }
        if (chosenBookBtn && now - irctcLastActAt >= 220 && now - irctcBookAt >= 6500) {
          irctcBookAt = now;
          try { root.sessionStorage.setItem('sarthi_ir_book_at', String(now)); } catch (eB) { /* ignore */ }
          irctcLastActAt = now;
          mark(chosenBookBtn, GREEN);
          clickLikeUser(chosenBookBtn);
          return { state: 'next', clicked: 'book now', tatkalStage: 'train_list', note: 'Book Now fast dabaya!' };
        }
        return { state: 'filling', tatkalStage: 'train_list', note: 'Book Now button activate ho raha hai...' };
      }

      // 4) No availability slots open yet in chosen card -> click wanted class tab's inner clickable/Refresh target so Angular catches it!
      var clsTiles = Array.prototype.slice.call(chosen.querySelectorAll('.pre-avl, td, [role="button"], button, a, div[class*="col"], strong, span')).filter(function (el) {
        if (!isVisible(el)) return false;
        if (el.querySelectorAll && el.querySelectorAll('.pre-avl').length > 0 && !el.classList.contains('pre-avl')) return false;
        return !!irctcClassTokenOf(el.innerText || '');
      });
      if (clsTiles.length > 0) {
        var pickedTile = null;
        for (var wi = 0; wi < wantedClasses.length && !pickedTile; wi++) {
          for (var ti = 0; ti < clsTiles.length; ti++) {
            if (irctcClassTokenOf(clsTiles[ti].innerText || '') === wantedClasses[wi]) {
              pickedTile = clsTiles[ti];
              break;
            }
          }
        }
        if (!pickedTile) pickedTile = clsTiles[0];
        if (pickedTile && pickedTile.closest) {
          pickedTile = pickedTile.closest('.pre-avl') || pickedTile.closest('td, [role="button"], button, a') || pickedTile;
        }
        var clsAt = parseInt(chosen.getAttribute('data-sarthi-cls-at') || '0', 10);
        if (pickedTile && now - clsAt >= 1100 && now - irctcLastActAt >= 320) {
          var tok = irctcClassTokenOf(pickedTile.innerText || '');
          irctcLastActAt = now;
          chosen.setAttribute('data-sarthi-cls-at', String(now));
          chosen.removeAttribute('data-sarthi-slot-at');
          mark(pickedTile, GREEN);
          clickLikeUser(irctcClickableChild(pickedTile, true));
          return { state: 'filling', tatkalStage: 'train_list', note: 'Class (' + tok + ') Tatkal availability check...' };
        }
        return { state: 'filling', tatkalStage: 'train_list', note: 'Train availability load ho rahi hai...' };
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  var profAskedSig = '', profNoteFor = '', forcedNext = {}, tickSig = '', lastPendSig = '';


  // ---------------------------------------------------------------
  // IRCTC ACCOUNT: ID/password diya ho to login; na ho to naya account (Register) khud banao.
  // CAPTCHA / OTP hamesha user dalta hai. Naya ID+password status line me dikhta hai (note kar lo).
  // ---------------------------------------------------------------
  var irAcctAt = 0;

  // Login/Register tabhi jab "Book Now" dab chuka ho (pehle date/train/class sab confirm hone do)
  function irBookRecent() {
    try {
      var t = parseInt(root.sessionStorage.getItem('sarthi_ir_book_at') || '0', 10);
      return t > 0 && Date.now() - t < 20 * 60 * 1000;
    } catch (e) { return false; }
  }

  function irHref() { return String((root.location ? root.location.href : '') || '').toLowerCase(); }

  function irPwInputs() {
    return Array.prototype.slice.call(document.querySelectorAll('input[type="password"]')).filter(isVisible);
  }

  function irGenCreds(data) {
    var saved = null;
    try { saved = JSON.parse(root.sessionStorage.getItem('sarthi_irctc_gen') || 'null'); } catch (e) { /* ignore */ }
    if (!saved && root.__sarthiIrGen) saved = root.__sarthiIrGen;
    if (!saved) {
      var base = String((data && data.fullName) || 'user').toLowerCase().replace(/[^a-z]/g, '').slice(0, 8) || 'user';
      var alnum = 'abcdefghjkmnpqrstuvwxyz23456789', r = '';
      for (var i = 0; i < 8; i++) r += alnum.charAt(Math.floor(Math.random() * alnum.length));
      saved = { id: base + String(Math.floor(1000 + Math.random() * 9000)), pw: 'Tr@' + r + '9' };
      root.__sarthiIrGen = saved;
      try { root.sessionStorage.setItem('sarthi_irctc_gen', JSON.stringify(saved)); } catch (e) { /* ignore */ }
    }
    return saved;
  }

  // run() se PEHLE: register page ho aur user ne ID/password na diya ho to khud ka ID/password payload me daalo
  function irctcAccountPre(data) {
    try {
      if (!/irctc/.test(irHref()) || !data) return null;
      if (!irBookRecent()) return null;
      var pw = irPwInputs();
      var isReg = pw.length >= 2 || /register|signup/.test(irHref());
      if (!isReg || !pw.length) return null;
      if (String(data.loginUserId || '').trim() && String(data.loginPassword || '').trim()) return null;
      var g = irGenCreds(data);
      data.loginUserId = g.id;
      data.loginPassword = g.pw;
      return { note: 'Naya IRCTC account: ID = ' + g.id + ' | Password = ' + g.pw + ' (note kar lo)' };
    } catch (e) { return null; }
  }

  function irCaptchaFilled() {
    var any = false, ok = true;
    Array.prototype.slice.call(document.querySelectorAll('input')).filter(isVisible).forEach(function (el) {
      if (classifySecurity(hintOf(el)) === 'captcha') { any = true; if (String(el.value || '').trim().length < 4) ok = false; }
    });
    return !any || ok;
  }

  function irFindBtn(re, scope) {
    var els = Array.prototype.slice.call((scope || document).querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]'));
    for (var i = 0; i < els.length; i++) {
      if (!isVisible(els[i])) continue;
      var t = norm(els[i].innerText || els[i].textContent || els[i].value || '');
      if (t && t.length < 30 && re.test(t)) return els[i];
    }
    return null;
  }

  // run() ke BAAD: Login modal par User/Pass bharne ke baad CAPTCHA/SIGN IN user ke haath me rakho (Tatkal par Register kabhi mat dabao)
  function irctcAccountPost(data) {
    try {
      if (!/irctc/.test(irHref())) return null;
      var pw = irPwInputs();
      if (!pw.length) return null;
      var isReg = pw.length >= 2 || /register|signup/.test(irHref());
      if (isReg) {
        if (!irCaptchaFilled()) {
          focusSecurityInput();
          return { state: 'user', hasCaptcha: true, tatkalStage: 'login_captcha', note: 'Registration screen par CAPTCHA daalein aur khud Register dabayein' };
        }
        return { state: 'user', hasCaptcha: true, tatkalStage: 'login_captcha', note: 'Registration details ready hain — check karke Register dabayein' };
      }
      // Login popup / Login page: kabhi 4-char CAPTCHA pe auto Sign In mat dabao aur kabhi Register mat dabao!
      var pwFilled = pw.some(function (p) { return String(p.value || '').trim().length > 0; });
      var hasCreds = !!(String((data && data.loginUserId) || '').trim() && String((data && data.loginPassword) || '').trim());
      focusSecurityInput();
      if (pwFilled || hasCreds) {
        return {
          state: 'user',
          hasCaptcha: true,
          hasPassword: !pwFilled,
          tatkalStage: 'login_captcha',
          note: pwFilled
            ? 'Login ID & Password bhar chuke hain! Poora CAPTCHA daal kar SIGN IN dabayein.'
            : 'IRCTC Login khula hai — apna Password aur CAPTCHA daal kar SIGN IN dabayein.'
        };
      }
      return {
        state: 'user',
        hasCaptcha: true,
        hasPassword: true,
        tatkalStage: 'login_captcha',
        note: 'IRCTC Login khula hai — User ID, Password aur CAPTCHA daal kar SIGN IN dabayein.'
      };
    } catch (e) { return null; }
  }


  // ---------------------------------------------------------------
  // IRCTC SEARCH PAGE - seedha, ek-ek step: From -> To -> Date -> Class -> Quota -> Search (sirf ek baar)
  // Is page par generic engine (queue/retry) band: wahi baar-baar click karke "Sorry!!! Please try again" laata tha.
  // ---------------------------------------------------------------

  function irctcSearchButton() {
    var els = Array.prototype.slice.call(document.querySelectorAll('button, input[type="submit"], input[type="button"], a[role="button"]'));
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!isVisible(el)) continue;
      if (el.closest && el.closest('header, nav, app-header, .ui-dialog, .p-dialog, [role="dialog"]')) continue;
      var txt = norm(el.innerText || el.textContent || el.value || '');
      var cls = String(el.className || '');
      var lbl = String((el.getAttribute && el.getAttribute('label')) || '');
      if (RE_NO_CLICK.test(txt)) continue;
      if (/^(search trains?|search|find trains?)$/.test(txt) || /search_btn|train_search/i.test(cls) || /find trains?/i.test(lbl)) return el;
    }
    return null;
  }

  var irFlow = { busy: false, since: 0, note: '', tries: {} };

  function stationValueOk(v) {
    v = String(v || '').trim();
    return /\s-\s[A-Za-z0-9]{1,8}(\s*\([^)]+\))?$|\([A-Z]{2,5}\)$/.test(v);
  }
  function irTry(k) { irFlow.tries[k] = (irFlow.tries[k] || 0) + 1; return irFlow.tries[k]; }
  function irVisibleOpts(scope) {
    var o = [];
    if (scope && scope.querySelectorAll) o = Array.prototype.slice.call(scope.querySelectorAll(OPTION_SEL + ', li')).filter(isVisible);
    if (!o.length) o = Array.prototype.slice.call(document.querySelectorAll(OPTION_SEL)).filter(isVisible);
    return o;
  }
  function irKey(el, k, c) {
    ['keydown', 'keyup'].forEach(function (t) {
      try { el.dispatchEvent(new root.KeyboardEvent(t, { key: k, code: k, keyCode: c, which: c, bubbles: true, cancelable: true })); } catch (e) { /* ignore */ }
    });
  }

  // station: fast human-paced typing -> quick poll -> select best match -> commit Angular ControlValueAccessor
  function irStation(el, wanted, key, done) {
    var polls = 0;
    function finish() {
      try { fire(el, ['change', 'blur']); } catch (e) { /* ignore */ }
      done();
    }
    function verify(cb) {
      setTimeout(function () {
        if (stationValueOk(el.value)) {
          mark(el, GREEN);
          finish();
        } else cb();
      }, 240);
    }
    function poll() {
      polls++;
      var ac = el.closest ? el.closest('p-autocomplete, .ui-autocomplete, [class*="autocomplete"]') : null;
      var opts = irVisibleOpts(ac);
      if (!opts.length) { if (polls < 32) { setTimeout(poll, 95); return; } finish(); return; }
      var best = pickBestOverlayOption(opts, wanted, key, true);
      if (best) {
        clickLikeUser(best);
        verify(function () {
          irSoftFocus(el); irKey(el, 'ArrowDown', 40);
          setTimeout(function () { irKey(el, 'Enter', 13); verify(finish); }, 130);
        });
      } else {
        irSoftFocus(el); irKey(el, 'ArrowDown', 40);
        setTimeout(function () { irKey(el, 'Enter', 13); verify(finish); }, 130);
      }
    }
    irSoftFocus(el);
    typeTextIncrementally(el, String(wanted), function () { setTimeout(poll, 170); }, { fast: true });
  }

  function irClassRe(w) {
    var n = norm(w || '');
    if (/\b1a\b|first (ac|class)|ac first/.test(n)) return /\b1a\b|first class|ac first/;
    if (/\b2a\b|2 ?tier|second ac|ac 2/.test(n)) return /\b2a\b|2 tier/;
    if (/\b3a\b|3 ?tier|third ac|ac 3/.test(n)) return /\b3a\b|3 tier/;
    if (/\b3e\b|economy/.test(n)) return /\b3e\b|economy/;
    if (/\bsl\b|sleeper/.test(n)) return /\bsl\b|sleeper/;
    if (/\bcc\b|chair/.test(n)) return /\bcc\b|chair/;
    if (/\bec\b|executive/.test(n)) return /\bec\b|executive/;
    if (/\b2s\b|second sitting/.test(n)) return /\b2s\b|second sitting/;
    return null;
  }
  function irQuotaRe(w) {
    var n = norm(w || '');
    if (/premium/.test(n)) return /premium tatkal/;
    if (/tatkal/.test(n)) return /^tatkal$/;
    if (/ladies|mahila/.test(n)) return /ladies/;
    if (/general|gen\b/.test(n)) return /^general$/;
    return null;
  }
  function irDdLabel(host) {
    var l = host.querySelector('.p-dropdown-label, .ui-dropdown-label, label');
    return norm((l && (l.innerText || l.textContent)) || host.innerText || '');
  }
  function irFindDd(kind) {
    var hosts = Array.prototype.slice.call(document.querySelectorAll('p-dropdown')).filter(isVisible);
    for (var i = 0; i < hosts.length; i++) {
      var fc = norm((hosts[i].getAttribute('formcontrolname') || '') + ' ' + (hosts[i].getAttribute('ng-reflect-name') || ''));
      var lb = irDdLabel(hosts[i]);
      if (kind === 'class' && (/class/.test(fc) || /all classes|\([a-z0-9]{2}\)|sleeper|chair car|first class|ac \d/.test(lb))) return hosts[i];
      if (kind === 'quota' && (/quota/.test(fc) || /^(general|tatkal|premium tatkal|ladies|lower berth.*|person with disability.*|duty pass|defence.*|physically.*)$/.test(lb))) return hosts[i];
    }
    return null;
  }
  // p-dropdown: ek baar kholo -> fast option click -> label verify
  function irPickDropdown(host, re, done) {
    var polls = 0;
    clickLikeUser(host);
    function poll() {
      polls++;
      var opts = irVisibleOpts(null);
      if (!opts.length) { if (polls < 24) { setTimeout(poll, 90); return; } done(); return; }
      var pick = null;
      opts.forEach(function (o) { if (!pick && re.test(norm(o.innerText || o.textContent || ''))) pick = o; });
      if (!pick) { try { document.body.click(); } catch (e) { /* ignore */ } setTimeout(done, 150); return; }
      clickLikeUser(pick);
      setTimeout(function () { if (re.test(irDdLabel(host))) mark(host, GREEN); done(); }, 220);
    }
    setTimeout(poll, 110);
  }

  function irctcCloseOverlays(dateEl) {
    try {
      if (dateEl) {
        irKey(dateEl, 'Escape', 27);
        dateEl.blur && dateEl.blur();
      }
      if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        irKey(document.activeElement, 'Escape', 27);
      }
      var panels = document.querySelectorAll('.ui-datepicker, .p-datepicker, .ui-dropdown-panel, .p-dropdown-panel, .ui-autocomplete-panel, .p-autocomplete-panel');
      Array.prototype.forEach.call(panels, function (p) {
        if (isVisible(p)) {
          try { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); document.body.click(); } catch (e) { /* ignore */ }
        }
      });
    } catch (e) { /* ignore */ }
  }

  function irctcReadToastText() {
    try {
      var sels = '.ui-toast-detail, .p-toast-detail, .ui-toast-summary, .p-toast-summary, .ui-messages-error, .p-message-error, .alert-danger, .err_msg, [role="alert"]';
      var nodes = Array.prototype.slice.call(document.querySelectorAll(sels)).filter(isVisible);
      var texts = [];
      nodes.forEach(function (n) {
        var t = String(n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length > 3 && texts.indexOf(t) < 0) texts.push(t);
      });
      return texts.join(' | ');
    } catch (e) { return ''; }
  }

  function irctcIsLoadingSpinnerActive() {
    try {
      return Array.prototype.slice.call(document.querySelectorAll('app-loader, .ui-blockui, .p-blockui, .p-progress-spinner, .loading-spinner, [class*="preloader"]')).some(isVisible);
    } catch (e) { return false; }
  }

  function irSetJourneyDate(dateEl, want, done) {
    try {
      irNoKeyboard(dateEl);
      irSoftFocus(dateEl);
      typeTextIncrementally(dateEl, want, function () {
        setTimeout(function () {
          // If PrimeNG calendar overlay is open, click the matching day cell ONLY when calendar displays the target month/year
          try {
            var dp = document.querySelector('.ui-datepicker, .p-datepicker');
            var parts = want.split(/[\/\-\.]/);
            var wantDay = parts.length === 3 ? String(parseInt(parts[0], 10)) : '';
            var wantMonthIdx = parts.length === 3 ? parseInt(parts[1], 10) - 1 : -1;
            var wantYear = parts.length === 3 ? parts[2] : '';
            var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            if (dp && isVisible(dp) && wantDay && wantMonthIdx >= 0 && wantMonthIdx < 12) {
              var hdr = norm((dp.querySelector('.ui-datepicker-title, .p-datepicker-title') || {}).innerText || '');
              var monthOk = !hdr || (hdr.indexOf(MONTHS[wantMonthIdx]) >= 0 && (!wantYear || hdr.indexOf(wantYear) >= 0));
              if (monthOk) {
                var cells = Array.prototype.slice.call(dp.querySelectorAll('td:not(.ui-state-disabled):not(.p-datepicker-other-month) a, td:not(.ui-state-disabled):not(.p-datepicker-other-month) span'));
                var hit = cells.find(function (c) { return String(c.innerText || '').trim() === wantDay && isVisible(c); });
                if (hit) clickLikeUser(hit);
              }
            }
          } catch (eCal) { /* ignore */ }
          irKey(dateEl, 'Enter', 13);
          irKey(dateEl, 'Escape', 27);
          fire(dateEl, ['input', 'change', 'blur']);
          irctcCloseOverlays(dateEl);
          done();
        }, 120);
      }, { fast: true });
    } catch (e) {
      setNativeValue(dateEl, want);
      done();
    }
  }

  function irctcSearchFlow(data) {
    try {
      if (!/irctc/.test(irHref()) || !data || !data.fromStation || !data.toStation) return null;
      if (Array.prototype.slice.call(document.querySelectorAll('app-train-avl-enq, .train-avl-enq')).some(isVisible)) return null;      // visible train list: dusra step sambhalega
      if (Array.prototype.slice.call(document.querySelectorAll('.ui-dialog, .p-dialog, [role="dialog"], .modal.show')).some(isVisible)) return null;
      var fromEl = null, toEl = null, dateEl = null;
      Array.prototype.slice.call(document.querySelectorAll('input')).filter(isVisible).forEach(function (el) {
        var k = matchKey(hintOf(el), { type: (el.type || 'text').toLowerCase() });
        if (k === 'fromStation' && !fromEl) fromEl = el;
        else if (k === 'toStation' && !toEl) toEl = el;
        else if (k === 'journeyDate' && !dateEl) dateEl = el;
      });
      var btn = irctcSearchButton();
      if (!fromEl || !toEl || !btn) return null;

      if (irFlow.busy) {
        if (Date.now() - irFlow.since > 18000) irFlow.busy = false;       // watchdog
        else return { state: 'filling', tatkalStage: 'search', note: irFlow.note };
      }
      function run1(note, fn) {
        irFlow.busy = true; irFlow.since = Date.now(); irFlow.note = note;
        fn(function () { irFlow.busy = false; });
        return { state: 'filling', tatkalStage: 'search', note: note };
      }
      // 1) From  2) To
      if (!stationValueOk(fromEl.value) && irTry('from') <= 4) return run1('From station chun raha hoon...', function (d) { irStation(fromEl, data.fromStation, 'fromStation', d); });
      if (!stationValueOk(toEl.value) && irTry('to') <= 4) return run1('To station chun raha hoon...', function (d) { irStation(toEl, data.toStation, 'toStation', d); });
      // 3) Date (PrimeNG p-calendar safe commit)
      if (data.journeyDate && dateEl) {
        var want = formatDateForInput(data.journeyDate, (dateEl.type || 'text').toLowerCase(), dateEl.placeholder, dateEl.maxLength > 0 ? dateEl.maxLength : 0);
        if (String(dateEl.value || '').trim() !== want && irTry('date') <= 3) {
          return run1('Date (' + want + ') set kar raha hoon...', function (d) { irSetJourneyDate(dateEl, want, d); });
        }
      }
      // 4) Class  5) Quota
      var cre = irClassRe(data.trainClass);
      if (cre) {
        var cdd = irFindDd('class');
        if (cdd && !cre.test(irDdLabel(cdd)) && irTry('class') <= 4) return run1('Class (' + data.trainClass + ') chun raha hoon...', function (d) { irPickDropdown(cdd, cre, d); });
      }
      var qre = irQuotaRe(data.trainQuota);
      if (qre) {
        var qdd = irFindDd('quota');
        if (qdd && !qre.test(irDdLabel(qdd)) && irTry('quota') <= 4) return run1('Quota (' + data.trainQuota + ') chun raha hoon...', function (d) { irPickDropdown(qdd, qre, d); });
      }
      // 6) Search - APK WebView me user khud Search dabayega (100% real finger touch, zero Akamai bot flag)
      if (isNativeWebViewHost()) {
        irctcCloseOverlays(dateEl);
        return { state: 'user', tatkalStage: 'search', note: 'From / To / Date / Class bhar diya — ab khud Search dabao (AI click se block hota hai)' };
      }

      // Cloud Playwright: detect live IRCTC toast errors immediately instead of silently hanging 45s!
      var last = 0, n = 0;
      try { last = parseInt(root.sessionStorage.getItem('sarthi_ir_search_at') || '0', 10); n = parseInt(root.sessionStorage.getItem('sarthi_ir_search_n') || '0', 10); } catch (e) { /* ignore */ }
      var now = Date.now();
      var toastErr = irctcReadToastText();
      if (last > 0 && toastErr) {
        var tl = norm(toastErr);
        if (/tatkal|10:00|11:00|not allowed|cannot be booked|access denied|unable to process|bad request|error/.test(tl)) {
          return { state: 'user', tatkalStage: 'search', note: 'IRCTC Search Alert: ' + toastErr };
        }
        if (/origin|destination|station|journey date|valid date|please select/.test(tl) && n < 3) {
          try { root.sessionStorage.removeItem('sarthi_ir_search_at'); } catch (e) { /* ignore */ }
          irFlow.tries = {};
          return { state: 'filling', tatkalStage: 'search', note: 'IRCTC field check (' + toastErr + ') — dobara set kar raha hoon...' };
        }
      }
      var waitWindow = irctcIsLoadingSpinnerActive() ? 22000 : 12000;
      if (now - last < waitWindow) return { state: 'waiting', tatkalStage: 'search', note: 'Search Trains response load ho raha hai...' };
      if (n >= 3) return { state: 'user', tatkalStage: 'search', note: toastErr ? ('IRCTC Search Error: ' + toastErr) : 'Search Trains 3 baar try kiya — ek baar khud Search dabayein ya Phone IP use karein.' };

      irctcCloseOverlays(dateEl);
      try { root.sessionStorage.setItem('sarthi_ir_search_at', String(now)); root.sessionStorage.setItem('sarthi_ir_search_n', String(n + 1)); } catch (e) { /* ignore */ }
      mark(btn, GREEN);
      try { document.querySelectorAll('[data-sarthi-click]').forEach(function (x) { x.removeAttribute('data-sarthi-click'); }); } catch (eC) { /* ignore */ }
      btn.setAttribute('data-sarthi-click', 'search');
      if (root.__sarthiPlaywrightControlled) {
        return { state: 'next', clicked: 'search trains', clickSelector: '[data-sarthi-click="search"]', tatkalStage: 'search', note: 'Search Trains trusted click ho raha hai...' };
      }
      clickLikeUser(btn);
      return { state: 'next', clicked: 'search trains', tatkalStage: 'search', note: 'Search Trains dabaya!' };
    } catch (e) { return null; }
  }

  var irSorrySeenAt = 0;
  function irctcSorryPage() {
    try {
      if (!/irctc/.test(irHref())) return null;
      var t = norm(((document.body && document.body.innerText) || '').slice(0, 800));
      if (!/sorry.{0,6}please try again/.test(t)) {
        irSorrySeenAt = 0;
        return null;
      }
      if (isNativeWebViewHost()) {
        return {
          state: 'user',
          tatkalStage: 'blocked',
          note: 'IRCTC ne "Sorry" page dikhaya — khud "Click here to login" ya Close dabakar dobara kholein'
        };
      }
      var now = Date.now();
      var sorryN = 0, sorryAt = 0;
      try {
        sorryN = parseInt(root.sessionStorage.getItem('sarthi_ir_sorry_n') || '0', 10) || 0;
        sorryAt = parseInt(root.sessionStorage.getItem('sarthi_ir_sorry_at') || '0', 10) || 0;
        if (sorryAt && now - sorryAt > 90000) {
          sorryN = 0;
          root.sessionStorage.removeItem('sarthi_ir_sorry_n');
          root.sessionStorage.removeItem('sarthi_ir_sorry_at');
        }
      } catch (eS) { /* ignore */ }
      if (sorryN >= 1) {
        return {
          state: 'user',
          tatkalStage: 'blocked',
          note: 'IRCTC ne "Sorry!!! Please Try again!!" dikhaya — neeche "Click here to login" ya upar CLOSE dabakar dobara kholein'
        };
      }
      if (!irSorrySeenAt) irSorrySeenAt = now;
      if (now - irSorrySeenAt < 2500) {
        return { state: 'waiting', tatkalStage: 'blocked', note: 'IRCTC session reset hua - 2 sec me home par ja raha hu...' };
      }
      var b = irFindBtn(/click here to login|click here/);
      if (!b) {
        return { state: 'user', tatkalStage: 'blocked', note: 'IRCTC "Sorry" page — CLOSE dabakar dobara kholein' };
      }
      irSorrySeenAt = 0;
      try {
        root.sessionStorage.setItem('sarthi_ir_sorry_n', String(sorryN + 1));
        root.sessionStorage.setItem('sarthi_ir_sorry_at', String(now));
        root.sessionStorage.removeItem('sarthi_ir_search_at');
        root.sessionStorage.removeItem('sarthi_ir_search_n');
        root.sessionStorage.removeItem('sarthi_ir_cont_at');
        root.sessionStorage.removeItem('sarthi_ir_next_at');
      } catch (e) { /* ignore */ }
      irFlow.tries = {};
      clickLikeUser(b);
      return { state: 'next', clicked: 'click here to login', tatkalStage: 'search', note: 'IRCTC session reset — home page khol raha hu (1/1)' };
    } catch (e) { return null; }
  }

  function focusSecurityInput() {
    try {
      if (isIrctcNativeManual()) return false;
      var candidates = Array.prototype.slice.call(document.querySelectorAll('input, textarea')).filter(function (el) {
        var tp = (el.type || '').toLowerCase();
        return !/^(hidden|submit|button|checkbox|radio|file)$/.test(tp) && isVisible(el) && !el.disabled;
      });
      var otpEl = candidates.find(function (el) { return classifySecurity(hintOf(el)) === 'otp'; });
      var capEl = candidates.find(function (el) { return classifySecurity(hintOf(el)) === 'captcha'; });
      var target = otpEl || capEl || null;
      if (target) {
        mark(target, AMBER);
        if (!target.getAttribute('data-sarthi-focused')) {
          target.setAttribute('data-sarthi-focused', '1');
          try { target.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) { target.scrollIntoView(); }
          irSoftFocus(target);
        }
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function irctcPaymentScreenCheck() {
    try {
      if (!/irctc/.test(irHref())) return null;
      var href = irHref();
      var body = norm(((document.body && document.body.innerText) || '').slice(0, 2200));
      var hasPassengerInputs = Array.prototype.slice.call(document.querySelectorAll('input')).some(function (el) {
        return isVisible(el) && /passenger|full ?name|\bage\b/.test(hintOf(el));
      });
      if (hasPassengerInputs) return null;
      var payBtn = irFindBtn(/^(pay & book|pay and book|make payment|proceed to pay|pay rs\.?|pay now)/);
      var isPayUrl = /\/payment|\/bkgpayment|\/pg\b|ipay/.test(href);
      var hasPaySection = /select payment method|payment options|multiple payment service|irctc ipay|bhim\/upi|net banking|wallets/.test(body) && (!!payBtn || isPayUrl);
      if (isPayUrl || hasPaySection) {
        if (payBtn) mark(payBtn, AMBER);
        return {
          state: 'user',
          hasPayment: true,
          tatkalStage: 'payment',
          note: 'Payment Checkout ready hai! Apna UPI / Bank chunein aur OTP + Payment confirm karein.'
        };
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function irctcPassengerSmartExtras(data) {
    var added = 0;
    try {
      if (!/irctc/.test(irHref())) return 0;
      // 1) Auto-tick "Consider for Auto Upgradation" checkbox
      var cbs = Array.prototype.slice.call(document.querySelectorAll('input[type="checkbox"]')).filter(function (c) { return !c.disabled && isVisible(c); });
      cbs.forEach(function (c) {
        var h = hintOf(c);
        if (/auto ?upgrad|consider for auto/.test(h) && !c.checked) {
          try { c.click(); } catch (e) { c.checked = true; fire(c, ['input', 'change']); }
          mark(c.parentElement || c, GREEN);
          added++;
        }
      });
      // 2) Select Payment Mode ("Pay through BHIM/UPI" fastest for Tatkal) & Travel Insurance ("Yes") radios
      var rds = Array.prototype.slice.call(document.querySelectorAll('input[type="radio"]')).filter(function (r) { return !r.disabled && isVisible(r); });
      var groups = groupRadios(rds);
      Object.keys(groups).forEach(function (gk) {
        var grp = groups[gk];
        if (grp.some(function (r) { return r.checked; })) return;
        var optTxt = norm(grp.map(function (r) { return radioLabel(r); }).join(' | '));
        var ctx = norm(grp.map(function (r) { return ancestorText(r); }).join(' '));
        if (/bhim|upi|pay through/.test(optTxt)) {
          var upiR = grp.find(function (r) { return /bhim|upi/.test(radioLabel(r)); }) || grp[0];
          if (upiR) {
            try { upiR.click(); } catch (e) { upiR.checked = true; fire(upiR, ['input', 'change']); }
            mark(upiR.parentElement || upiR, GREEN);
            added++;
          }
          return;
        }
        if (/travel insurance|insurance/.test(ctx) && grp.some(function (r) { return /\byes\b|accept/.test(radioLabel(r)); })) {
          var yesR = grp.find(function (r) { return /\byes\b|accept/.test(radioLabel(r)); });
          if (yesR) {
            try { yesR.click(); } catch (e) { yesR.checked = true; fire(yesR, ['input', 'change']); }
            mark(yesR.parentElement || yesR, GREEN);
            added++;
          }
        }
      });
    } catch (e) { /* ignore */ }
    return added;
  }

  var irLastAddPaxAt = 0;
  function irctcMultiPassengerStep(data) {
    try {
      if (!/irctc/.test(irHref()) || !data) return null;
      if (irPwInputs().length > 0) return null;
      var wanted = [];
      for (var n = 1; n <= 4; n++) {
        var nm = n === 1 ? (data.passenger1Name || data.fullName) : data['passenger' + n + 'Name'];
        var ag = n === 1 ? (data.passenger1Age || data.age) : data['passenger' + n + 'Age'];
        var gd = n === 1 ? (data.passenger1Gender || data.gender) : data['passenger' + n + 'Gender'];
        var br = n === 1 ? (data.passenger1Berth || data.berthPreference) : data['passenger' + n + 'Berth'];
        if (nm && String(nm).trim()) {
          wanted.push({
            name: String(nm).trim(),
            age: ag ? String(ag).trim() : '',
            gender: gd ? String(gd).trim() : '',
            berth: br ? String(br).trim() : '',
          });
        }
      }
      if (wanted.length <= 1) return null;

      var allVisibleInputs = Array.prototype.slice.call(document.querySelectorAll('input')).filter(function (el) {
        if (!isVisible(el) || el.disabled || el.readOnly) return false;
        if (el.closest && el.closest('header, nav, .ui-dialog, .p-dialog, [role="dialog"]')) return false;
        var tp = (el.type || 'text').toLowerCase();
        return /^(text|number|tel|search|)$/.test(tp);
      });
      var nameInputs = allVisibleInputs.filter(function (el) {
        var h = hintOf(el);
        return /passenger.*name|passengername|^passenger name$|^name$/i.test(h) && !/user|father|mother|school|college|train|card/.test(h);
      });
      if (!nameInputs.length) return null;

      var ageInputs = allVisibleInputs.filter(function (el) {
        return /\bage\b|passengerage|umr/i.test(hintOf(el));
      });
      var allSelects = Array.prototype.slice.call(document.querySelectorAll('select')).filter(function (el) {
        if (!isVisible(el) || el.disabled) return false;
        return !(el.closest && el.closest('header, nav, .ui-dialog, .p-dialog, [role="dialog"]'));
      });
      var genderSelects = allSelects.filter(function (el) { return /gender|\bsex\b|passenger ?gender/i.test(hintOf(el)); });
      var berthSelects = allSelects.filter(function (el) { return /berth|preference|seat/i.test(hintOf(el)); });

      // Fill currently rendered passenger rows (0 .. Math.min(nameInputs.length, wanted.length) - 1)
      var limit = Math.min(nameInputs.length, wanted.length);
      var filledCount = 0;
      for (var i = 0; i < limit; i++) {
        var pax = wanted[i];
        var nEl = nameInputs[i];
        var rowScope = (nEl.closest && nEl.closest('app-passenger-input, .passenger-row, .form-row, .row, tr, [formgroupname]')) || nEl.parentElement;
        var aEl = (rowScope && Array.prototype.slice.call(rowScope.querySelectorAll('input')).find(function (x) { return isVisible(x) && /\bage\b|umr/i.test(hintOf(x)); })) || ageInputs[i] || null;
        var gEl = (rowScope && Array.prototype.slice.call(rowScope.querySelectorAll('select')).find(function (x) { return isVisible(x) && /gender|\bsex\b/i.test(hintOf(x)); })) || genderSelects[i] || null;
        var bEl = (rowScope && Array.prototype.slice.call(rowScope.querySelectorAll('select')).find(function (x) { return isVisible(x) && /berth|preference/i.test(hintOf(x)); })) || berthSelects[i] || null;

        if (nEl && !String(nEl.value || '').trim() && pax.name) {
          setNativeValue(nEl, pax.name);
          mark(nEl, GREEN);
          filledCount++;
        }
        if (aEl && !String(aEl.value || '').trim() && pax.age) {
          setNativeValue(aEl, pax.age);
          mark(aEl, GREEN);
          filledCount++;
        }
        if (gEl && pax.gender) {
          var gCur = gEl.selectedIndex >= 0 ? norm(gEl.options[gEl.selectedIndex].text || '') : '';
          if (!gEl.value || /select|gender|choose/.test(gCur)) {
            if (selectOption(gEl, pax.gender, 'gender')) {
              mark(gEl, GREEN);
              filledCount++;
            }
          }
        }
        if (bEl && pax.berth) {
          var bCur = bEl.selectedIndex >= 0 ? norm(bEl.options[bEl.selectedIndex].text || '') : '';
          if (!bEl.value || /no preference|select|berth|choose/.test(bCur)) {
            if (selectOption(bEl, pax.berth, 'berthPreference')) {
              mark(bEl, GREEN);
              filledCount++;
            }
          }
        }
      }

      if (nameInputs.length < wanted.length) {
        var now = Date.now();
        var addBtn = irFindBtn(/\+?\s*add\s*passenger|add\s*more\s*passenger|\+?\s*add\s*infant/i);
        if (addBtn && now - irLastAddPaxAt >= 500 && irTry('add_pax_' + nameInputs.length) <= 3) {
          irLastAddPaxAt = now;
          mark(addBtn, GREEN);
          clickLikeUser(addBtn);
          return { state: 'filling', tatkalStage: 'passenger', note: 'Passenger ' + (nameInputs.length + 1) + ' (' + wanted[nameInputs.length].name + ') add ho raha hai...' };
        }
        if (filledCount > 0) {
          return { state: 'filling', tatkalStage: 'passenger', note: 'Passenger details fill ho rahe hain...' };
        }
      }
      return null;
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------
  // IRCTC FIX 1: "Welcome to IRCTC - language chuno" popup -> English apne aap
  // ---------------------------------------------------------------
  var irLangAt = 0;
  function irctcWelcomeLanguage() {
    try {
      if (!/irctc/.test(irHref())) return null;
      var bt = norm(((document.body && document.body.innerText) || '').slice(0, 4000));
      if (!/welcome to irctc/.test(bt) || !/language/.test(bt)) return null;
      if (isNativeWebViewHost()) {
        return { state: 'user', tatkalStage: 'search', note: 'Language popup par khud English / OK dabao' };
      }
      var now = Date.now();
      if (now - irLangAt < 2500) return { state: 'waiting', tatkalStage: 'search', note: 'Language popup band ho raha hai...' };
      var eb = irFindBtn(/^english$/);
      if (!eb) return null;
      irLangAt = now;
      mark(eb, GREEN);
      clickLikeUser(eb);
      return { state: 'next', clicked: 'english', tatkalStage: 'search', note: 'Language: English chun li' };
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------
  // IRCTC FIX 2: Passenger page -> details poori bharne ke baad
  //   (a) "Pay through BHIM/UPI" apne aap chuno
  //   (b) "Continue" APK WebView me user khud dabayega (real touch = zero Sorry block)
  // CAPTCHA aur payment ka final step user hi karega.
  // ---------------------------------------------------------------
  var irPaxSig = '', irPaxSigAt = 0, irUpiTryAt = 0;
  function irctcPassengerFinish() {
    try {
      if (!/irctc/.test(irHref())) return null;
      if (irPwInputs().length > 0) return null;
      var names = Array.prototype.slice.call(document.querySelectorAll('input[formcontrolname="passengerName"], app-passenger input[placeholder="Name"]')).filter(isVisible);
      if (!names.length) return null;
      var ages = Array.prototype.slice.call(document.querySelectorAll('input[formcontrolname="passengerAge"]')).filter(isVisible);
      var genders = Array.prototype.slice.call(document.querySelectorAll('select[formcontrolname="passengerGender"]')).filter(isVisible);
      var now = Date.now();

      var sig = names.map(function (n) { return n.value; }).join('|') + '#' + ages.map(function (a) { return a.value; }).join('|') + '#' + genders.map(function (g) { return g.value; }).join('|');
      if (sig !== irPaxSig) { irPaxSig = sig; irPaxSigAt = now; }

      var ready = names.every(function (n) { return String(n.value || '').trim().length >= 3; }) &&
                  ages.length >= names.length && ages.every(function (a) { return String(a.value || '').trim(); }) &&
                  genders.every(function (g) { return !!g.value; });
      if (!ready) return null;                       // baaki fill engine pehle bhar le
      var paxWaitMs = isNativeWebViewHost() ? 800 : 2500;
      if (now - irPaxSigAt < paxWaitMs) return { state: 'filling', tatkalStage: 'passenger', note: 'Passenger details bhar raha hu...' };
      if (irctcIsLoadingSpinnerActive()) return { state: 'waiting', tatkalStage: 'passenger', note: 'IRCTC loading hai - ruk raha hu' };
      var bad = Array.prototype.slice.call(document.querySelectorAll('app-passenger input.ng-invalid, app-passenger select.ng-invalid, input[formcontrolname="passengerName"].ng-invalid, input[formcontrolname="passengerAge"].ng-invalid, select[formcontrolname="passengerGender"].ng-invalid, input#mobileNumber.ng-invalid')).filter(isVisible);
      if (bad.length) { bad.forEach(function (b) { mark(b, AMBER); }); return { state: 'filling', tatkalStage: 'passenger', note: 'Passenger form me ' + bad.length + ' field galat/khali hai - theek karke Continue dabayein' }; }

      // (a) BHIM/UPI payment mode
      var lbls = Array.prototype.slice.call(document.querySelectorAll('label, span')).filter(function (el) {
        return isVisible(el) && /pay through bhim\s*\/?\s*upi/.test(norm(el.innerText || el.textContent || '')) && (el.innerText || '').length < 80;
      });
      if (lbls.length) {
        var lb = lbls[0];
        var holder = lb.closest ? (lb.closest('p-radiobutton') || lb.parentElement) : lb.parentElement;
        var rb = holder && holder.querySelector ? holder.querySelector('input[type="radio"]') : null;
        var box = holder && holder.querySelector ? holder.querySelector('.ui-radiobutton-box, .p-radiobutton-box') : null;
        var on = (rb && rb.checked) || (box && /ui-state-active|p-highlight/.test(box.className || ''));
        if (!on) {
          if (now - irUpiTryAt > 1500) { irUpiTryAt = now; mark(lb, GREEN); clickLikeUser(lb); }
          return { state: 'filling', tatkalStage: 'passenger', note: 'Payment mode: BHIM/UPI chun raha hu...' };
        }
      }

      if (isNativeWebViewHost()) {
        return { state: 'user', tatkalStage: 'passenger', note: 'Passenger details + BHIM/UPI bhar diya — check karke khud Continue dabayein' };
      }

      // (b) Continue - sirf ek baar (Cloud Playwright only), phir 30 sec tak kuch nahi
      var lastAt = 0;
      try { lastAt = parseInt(root.sessionStorage.getItem('sarthi_ir_cont_at') || '0', 10); } catch (e1) { /* ignore */ }
      if (lastAt && now - lastAt < 30000) return { state: 'waiting', tatkalStage: 'review_captcha', note: 'Continue dab chuka - IRCTC ka page khulne ka wait (dobara click nahi karunga)' };
      var cb = irFindBtn(/^continue$/);
      if (!cb || cb.disabled) return null;
      try { root.sessionStorage.setItem('sarthi_ir_cont_at', String(now)); } catch (e2) { /* ignore */ }
      mark(cb, GREEN);
      clickLikeUser(cb);
      return { state: 'next', clicked: 'continue', tatkalStage: 'review_captcha', note: 'Continue dabaya - ab CAPTCHA aap daalein' };
    } catch (e) { return null; }
  }

  var irLoginMenuOpenedAt = 0;
  function irctcOpenLoginStep(data) {
    try {
      if (!/irctc\.co\.in/i.test(irHref())) return null;
      if (/register|signup/.test(irHref())) return null;
      if (irIsLoggedIn() || irPwInputs().length > 0) return null;
      if (Array.prototype.slice.call(document.querySelectorAll('app-train-avl-enq, .train-avl-enq')).some(isVisible)) return null;
      if (Array.prototype.slice.call(document.querySelectorAll('.ui-dialog, .p-dialog, [role="dialog"], .modal.show')).some(isVisible)) return null;
      var wantLogin = !!(data && (
        data.autoOpenLogin === '1' ||
        data.autoOpenLogin === true ||
        (!isNativeWebViewHost() && (
          (/login|account|sign\s*in/i.test(String(data.goal || '')) && !data.fromStation && !data.toStation) ||
          (String(data.loginUserId || '').trim() && String(data.loginPassword || '').trim() && !data.fromStation && !data.toStation)
        ))
      ));
      if (!wantLogin) return null;
      var now = Date.now();
      var lastAt = 0;
      try { lastAt = parseInt(root.sessionStorage.getItem('sarthi_ir_open_login_at') || '0', 10); } catch (e1) { /* ignore */ }
      if (lastAt && now - lastAt < 25000) {
        return { state: 'waiting', tatkalStage: 'login_captcha', note: 'IRCTC Login screen khulne ka wait...' };
      }
      var loginEls = Array.prototype.slice.call(document.querySelectorAll('a.loginText, button.loginText, a[aria-label*="Click here to Login" i], a[aria-label*="Login" i], button[aria-label*="Login" i], app-header a, app-header button, nav a, nav button, button, a')).filter(isVisible);
      var btn = null;
      for (var i = 0; i < loginEls.length; i++) {
        var el = loginEls[i];
        var t = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
        var cls = String(el.className || '');
        if (/logintext/i.test(cls) || /^(login|sign ?in)$/.test(t)) { btn = el; break; }
      }
      if (btn) {
        try { root.sessionStorage.setItem('sarthi_ir_open_login_at', String(now)); } catch (e2) { /* ignore */ }
        mark(btn, GREEN);
        clickLikeUser(btn);
        return { state: 'next', clicked: 'login', tatkalStage: 'login_captcha', note: 'IRCTC Account Login khol raha hoon...' };
      }
      if (now - irLoginMenuOpenedAt > 10000) {
        var menuEl = document.querySelector('app-header .h_menu_drop_button, a.h_menu_drop_button, button[aria-label*="menu" i], app-header i.fa-bars, app-header i.fa-align-justify, app-header .fa-user');
        if (menuEl && isVisible(menuEl)) {
          irLoginMenuOpenedAt = now;
          var clickTarget = (menuEl.closest && menuEl.closest('a, button')) || menuEl;
          clickLikeUser(clickTarget);
          setTimeout(function () {
            try {
              var after = Array.prototype.slice.call(document.querySelectorAll('a.loginText, button.loginText, a, button')).filter(isVisible);
              for (var j = 0; j < after.length; j++) {
                var t2 = norm(after[j].innerText || after[j].textContent || '');
                if (/^(login|sign ?in)$/.test(t2) || /logintext/i.test(String(after[j].className || ''))) {
                  try { root.sessionStorage.setItem('sarthi_ir_open_login_at', String(Date.now())); } catch (e3) { /* ignore */ }
                  clickLikeUser(after[j]);
                  break;
                }
              }
            } catch (eM) { /* ignore */ }
          }, 380);
          return { state: 'waiting', tatkalStage: 'login_captcha', note: 'Mobile menu se IRCTC Login khol raha hoon...' };
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function autopilotCore(payload, opts) {
    opts = opts || {};
    var sorry = irctcSorryPage();
    if (sorry) {
      return { filled: 0, url: root.location ? root.location.href : '', title: document.title || '', hasCaptcha: false, hasOtp: false, hasPassword: false, hasPayment: false,
               isPersonalForm: false, declarations: 0, needsUser: [], missingFields: [], unmatched: [], filledKeys: [], filledItems: [], state: sorry.state, clicked: sorry.clicked || '',
               asks: [], uploads: [], uploadFields: [], done: false, note: sorry.note, profile: 'IRCTC', tatkalStage: sorry.tatkalStage || 'blocked', emptyRequired: 0 };
    }
    var langStep = irctcWelcomeLanguage();
    if (langStep) {
      return { filled: 0, url: root.location ? root.location.href : '', title: document.title || '', hasCaptcha: false, hasOtp: false, hasPassword: false, hasPayment: false,
               isPersonalForm: false, declarations: 0, needsUser: [], missingFields: [], unmatched: [], filledKeys: [], filledItems: [], state: langStep.state, clicked: langStep.clicked || '',
               asks: [], uploads: [], uploadFields: [], done: false, note: langStep.note, profile: 'IRCTC Ticket Booking', tatkalStage: langStep.tatkalStage || 'search', emptyRequired: 0, irctcHandled: true };
    }
    if (opts.reset) {
      askedSig = ''; fillingTicks = 0; lastNextSig = ''; profAskedSig = ''; profNoteFor = ''; otpSentAt = {}; otpVerifyAt = {}; forcedNext = {}; tickSig = ''; irctcLastActAt = 0; irctcBookAt = 0; irLastAddPaxAt = 0;
      try {
        if (!Array.prototype.slice.call(document.querySelectorAll('app-train-avl-enq, .train-avl-enq')).some(isVisible)) {
          root.sessionStorage.removeItem('sarthi_ir_search_at');
          root.sessionStorage.removeItem('sarthi_ir_search_n');
          irFlow.tries = {};
          irFlow.busy = false;
        }
      } catch (eR) { /* ignore */ }
    }

    // Never touch payment confirmation buttons on IRCTC Payment screen — hand over immediately to user!
    var payCheck = irctcPaymentScreenCheck();
    if (payCheck) {
      return {
        filled: 0, url: root.location ? root.location.href : '', title: document.title || '',
        hasCaptcha: false, hasOtp: false, hasPassword: false, hasPayment: true,
        isPersonalForm: false, declarations: 0, needsUser: [], missingFields: [], unmatched: [], filledKeys: [], filledItems: [],
        state: 'user', clicked: '', asks: [], uploads: [], uploadFields: [], done: false, irctcHandled: true,
        note: payCheck.note, profile: 'IRCTC Ticket Booking', tatkalStage: 'payment', emptyRequired: 0
      };
    }

    // On IRCTC /train-list or confirmation popups: handle train cards FIRST so top "Modify Search" header bar NEVER loops!
    var irStep = irctcTrainListStep(payload || {});
    if (irStep) {
      ddQueue = [];
      clearTimeout(ddStartTimer);
      return {
        filled: 0, url: root.location ? root.location.href : '', title: document.title || '',
        hasCaptcha: false, hasOtp: false, hasPassword: false, hasPayment: false,
        isPersonalForm: false, declarations: 0, needsUser: [], missingFields: [], unmatched: [], filledKeys: [], filledItems: [],
        state: irStep.state || 'filling', clicked: irStep.clicked || '', clickSelector: irStep.clickSelector || '', asks: [], uploads: [], uploadFields: [],
        done: false, irctcHandled: true, note: irStep.note || '', profile: 'IRCTC Ticket Booking', tatkalStage: irStep.tatkalStage || 'train_list', emptyRequired: 0
      };
    }

    var openLoginStep = irctcOpenLoginStep(payload || {});
    if (openLoginStep) {
      return {
        filled: 0, url: root.location ? root.location.href : '', title: document.title || '',
        hasCaptcha: false, hasOtp: false, hasPassword: false, hasPayment: false,
        isPersonalForm: false, declarations: 0, needsUser: [], missingFields: [], unmatched: [], filledKeys: [], filledItems: [],
        state: openLoginStep.state || 'next', clicked: openLoginStep.clicked || 'login', asks: [], uploads: [], uploadFields: [],
        done: false, irctcHandled: true, note: openLoginStep.note || '', profile: 'IRCTC Ticket Booking', tatkalStage: 'login_captcha', emptyRequired: 0
      };
    }

    var sflow = irctcSearchFlow(payload || {});
    if (sflow) {
      return { filled: 0, url: root.location ? root.location.href : '', title: document.title || '', hasCaptcha: false, hasOtp: false, hasPassword: false, hasPayment: false,
               isPersonalForm: false, declarations: 0, needsUser: [], missingFields: [], unmatched: [], filledKeys: [], filledItems: [], state: sflow.state, clicked: sflow.clicked || '', clickSelector: sflow.clickSelector || '',
               asks: [], uploads: [], uploadFields: [], done: false, note: sflow.note || '', profile: 'IRCTC Ticket Booking', tatkalStage: sflow.tatkalStage || 'search', emptyRequired: 0, irctcHandled: true };
    }
    var acctPre = irctcAccountPre(payload);
    var multiPax = irctcMultiPassengerStep(payload);
    if (multiPax) {
      irctcPassengerSmartExtras(payload || {});
      return {
        filled: 1, url: root.location ? root.location.href : '', title: document.title || '',
        hasCaptcha: false, hasOtp: false, hasPassword: false, hasPayment: false,
        isPersonalForm: true, declarations: 0, needsUser: [], missingFields: [], unmatched: [], filledKeys: [], filledItems: [],
        state: multiPax.state || 'filling', clicked: '', asks: [], uploads: [], uploadFields: [], done: false, irctcHandled: true,
        note: multiPax.note || '', profile: 'IRCTC Ticket Booking', tatkalStage: 'passenger', emptyRequired: 0
      };
    }
    var s = run(payload, {});
    var sd = smartDefaults(payload || {});      // form-style wale sawalon ke samajhdaar default
    s.filled += sd.filled + irctcPassengerSmartExtras(payload || {});
    s.smartMissing = sd.missing;
    if (sd.unlockedSection && !opts._afterUnlock && !isIrctcNativeManual()) {
      setTimeout(function () { try { run(payload || {}, { _afterUnlock: true }); } catch (e) { /* ignore */ } }, 450);
    }
    var curSig = pageSig();
    if (curSig !== tickSig) { tickSig = curSig; fillingTicks = 0; }
    s.state = 'working';
    s.clicked = '';
    s.asks = [];
    s.uploads = [];
    s.done = false;
    s.note = '';
    s.profile = '';
    var paxFin = irctcPassengerFinish();
    if (paxFin) {
      s.state = paxFin.state; s.clicked = paxFin.clicked || ''; s.note = paxFin.note || '';
      s.profile = 'IRCTC Ticket Booking'; s.tatkalStage = paxFin.tatkalStage || 'passenger'; s.irctcHandled = true;
      return s;
    }
    var list = emptyRequiredList();
    s.emptyRequired = list.length;

    if (looksFinished(list)) { s.state = 'done'; s.done = true; return s; }

    // Wait while custom dropdowns / station autocompletes are actively opening and selecting
    if (ddBusy || ddQueue.length > 0 || sd.unlockedSection) {
      s.state = 'filling';
      return s;
    }

    // IRCTC login / naya account
    var acct = irctcAccountPost(payload || {});
    if (acct) {
      s.state = acct.state;
      s.clicked = acct.clicked || '';
      s.hasCaptcha = !!acct.hasCaptcha;
      s.hasPassword = false;
      if (acct.tatkalStage) s.tatkalStage = acct.tatkalStage;
      s.note = (acct.note || '') + (acctPre ? (acct.note ? ' | ' : '') + acctPre.note : '');
      s.profile = 'IRCTC Ticket Booking';
      return s;
    }
    if (acctPre) s.note = acctPre.note;

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

    var reqUnmatched = (s.unmatched || []).filter(function (u) { return u.required; });
    var pending = list.length > 0 || s.needsUser.length > 0 || reqUnmatched.length > 0 || (s.smartMissing && s.smartMissing.length > 0);
    if (pending) {
      fillingTicks++;
      if (fillingTicks >= 2) {
        var asks = buildAsks(list, s);
        var sg = asks.map(function (a) { return a.key || a.id; }).join(',');
        if (asks.length > 0 && sg !== askedSig) { askedSig = sg; s.asks = asks; }
      }
      // NEVER skip a page while required fields or dropdowns are still empty!
      if (list.length > 0 || (s.smartMissing && s.smartMissing.length > 0)) {
        s.pending = (s.smartMissing || []).concat(list.map(function (a) { return a.label; }).slice(0, 8));
      }
      s.state = s.uploads.length > 0 ? 'upload' : 'filling';
      return s;
    }
    fillingTicks = 0;

    if (s.hasCaptcha || s.hasOtp || s.hasPassword || s.hasPayment) {
      focusSecurityInput();
      if (/irctc/.test(irHref())) {
        s.tatkalStage = s.hasPayment ? 'payment' : (s.hasOtp ? 'otp' : (/review/i.test(irHref()) || !irPwInputs().length ? 'review_captcha' : 'login_captcha'));
        if (!s.note) {
          s.note = s.hasPayment
            ? 'Payment screen ready hai — UPI / Bank OTP verify karke Ticket Confirm karein.'
            : (s.hasOtp
              ? 'OTP daalein — AI baaki details bhar chuka hai.'
              : 'CAPTCHA screen par hai — sirf CAPTCHA type karein, baaki AI sambhalega.');
        }
      }
      s.state = 'user';
      userHold = { sig: pageSig() };
      return s;
    }

    if (/irctc\.co\.in/i.test(irHref())) {
      if (irPwInputs().length > 0) {
        focusSecurityInput();
        s.hasCaptcha = true;
        s.tatkalStage = 'login_captcha';
        s.state = 'user';
        userHold = { sig: pageSig() };
        return s;
      }
      s.state = 'final';
      return s;
    }

    var sig = pageSig();
    if (sig === lastNextSig && Date.now() - lastNextAt < 10000) { s.state = 'waiting'; return s; }
    var t = clickNext();
    if (t === '__wait__') {
      s.state = 'waiting';
      if (irWaitMsg) s.pending = [irWaitMsg];
      return s;
    }
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
    // Bas: OTP dalte hi Verify dabana (otpAssist) allowed hai; verify click ke baad userHold chhod do taaki aage badhe
    if (userHold && userHold.sig === pageSig()) {
      var holdAct = otpAssist();
      if (holdAct === 'verify') userHold = null;
      return { state: holdAct === 'verify' ? 'otp' : 'user', otpAction: holdAct, note: holdAct === 'verify' ? 'OTP verify dabaya' : (holdAct === 'send' ? 'OTP bhej diya - aap OTP daal dein' : ''), filled: 0, asks: [], uploads: [], uploadFields: [], done: false, profile: '', needRecipe: false, stuck: null,
               hasCaptcha: true, hasOtp: false, hasPassword: false, hasPayment: false, needsUser: [], unmatched: [], emptyRequired: 0, tatkalStage: /irctc/.test(irHref()) ? (/review/i.test(irHref()) ? 'review_captcha' : 'login_captcha') : undefined, url: root.location ? root.location.href : '', title: document.title || '' };
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
    if (ddBusy || ddQueue.length > 0 || s.irctcHandled || (Date.now() - lastAcAttemptAt < 5000)) {
      stuckTicks = 0; stuckSig = '';
    } else if (!s.done && s.asks.length === 0 && /^(filling|final|waiting|working)$/.test(s.state)) {
      var sig = pageSig() + '|' + s.emptyRequired + '|' + s.state;
      stuckTicks = (sig === stuckSig) ? stuckTicks + 1 : 1;
      stuckSig = sig;
      var key = pageSig();
      if (stuckTicks >= 3 && (scanCount[key] || 0) < 4) { scanCount[key] = (scanCount[key] || 0) + 1; s.stuck = snapshot(); }
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
    try {
      if (root.location && /irctc\.co\.in/i.test(root.location.hostname || '')) return;
    } catch (eW) { /* ignore */ }
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
      if (!relevant || watchRuns >= 80) return;
      try {
        if (root.location && /irctc/i.test(root.location.href || '')) {
          if (irFlow.busy) return;
          var ct = parseInt(root.sessionStorage.getItem('sarthi_ir_cont_at') || '0', 10);
          if (ct && Date.now() - ct < 30000) return;   // Continue dab chuka: naya page load ho raha hai, usme kuch mat likho
          var btxt = (document.body && document.body.innerText) || '';
          if (/sorry!*\s*please try again/i.test(btxt)) return;
          if (Array.prototype.slice.call(document.querySelectorAll('app-train-avl-enq, .train-avl-enq')).some(isVisible)) return;
          if (irPwInputs().length > 0) return;
        }
      } catch (eW) { /* ignore */ }
      clearTimeout(watchTimer);
      watchTimer = setTimeout(function () {
        watchRuns++;
        try { run(payload, {}); } catch (e) { /* ignore */ }
      }, 900);
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
    focusSecurityInput: focusSecurityInput,
    _internal: {
      norm: norm, matchKey: matchKey, classifySecurity: classifySecurity,
      parseDate: parseDate, formatDateForInput: formatDateForInput,
      scoreOption: scoreOption, bestOptionIndex: bestOptionIndex, expandSyn: expandSyn, splitName: splitName, valueFor: valueFor,
      irctcWantedClasses: irctcWantedClasses, irctcCardMatchesTrain: irctcCardMatchesTrain,
      irctcClassTokenOf: irctcClassTokenOf, irctcTrainListStep: irctcTrainListStep, irctcIsBookBtnEnabled: irctcIsBookBtnEnabled, isAutocompleteCommitted: isAutocompleteCommitted
    }
  };
  root.SarthiFill = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
