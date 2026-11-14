import type { ServiceBrief, ServiceCatalogItem } from '../types';

export const PRIMARY_GRID_SERVICES: ServiceCatalogItem[] = [
  {
    id: 'irctc-ticket',
    title: 'IRCTC & Ticket',
    subtitle: 'Train, PNR, IRCTC Account',
    category: 'ticket',
    actionLabel: 'Book Direct →',
    iconLetter: 'I',
    tint: 'blue',
    directFormUrl: 'https://www.irctc.co.in/nget/train-search',
    portalName: 'IRCTC Train Search & Booking',
    defaultFee: 'Sleeper ₹150–₹600 · 3A ₹500–₹1800 (+ ₹15–₹30 IRCTC fee)',
    defaultProcessingTime: 'Instant e-Ticket / Account 5 min',
    defaultEligibility: 'Valid mobile number, email ID aur passenger ID proof zaruri hai.',
    defaultDocuments: [
      { name: 'Aadhaar Card / Photo ID', reason: 'Passenger Name, Age & Gender match karne ke liye' },
      { name: 'Active Mobile & Email', reason: 'IRCTC OTP aur ticket SMS/PDF ke liye' },
    ],
    defaultFormGoal:
      'IRCTC Train Search / Booking direct page kholo. From Station, To Station (gaon ke paas), aur Travel Date fill karo. Passenger details OCR/Profile se bharo, CAPTCHA/OTP aur UPI payment par ruko.',
  },
  {
    id: 'ssc-direct',
    title: 'SSC Jobs (CGL/GD)',
    subtitle: 'OTR & Direct Form Apply',
    category: 'job',
    actionLabel: 'Apply Direct →',
    iconLetter: 'S',
    tint: 'purple',
    directFormUrl: 'https://ssc.gov.in/candidate-portal/one-time-registration/home-page',
    portalName: 'SSC Candidate OTR & Apply Form',
    defaultFee: '₹100 (Gen / OBC Male) · ₹0 (SC / ST / Female / Ex-SM)',
    defaultProcessingTime: '15–20 min online form',
    defaultEligibility: '10th / 12th / Graduate (post ke hisab se), age 18–30 years.',
    defaultDocuments: [
      { name: 'Aadhaar Card', reason: 'OTR identity verification aur Father/DOB ke liye' },
      { name: '10th Marksheet', reason: 'Roll Number, Board, Passing Year aur exact DOB ke liye' },
      { name: 'Passport Photo & Signature', reason: 'Live/scanned upload ke liye' },
    ],
    defaultFormGoal:
      'SSC Candidate Direct Registration/Apply page par meri details auto-fill karo. CAPTCHA aur OTP/final submit par ruko.',
  },
  {
    id: 'pan-card',
    title: 'PAN Card (49A)',
    subtitle: 'New PAN & Correction',
    category: 'pan',
    actionLabel: 'Apply Direct →',
    iconLetter: 'P',
    tint: 'indigo',
    directFormUrl: 'https://onlineservices.proteantech.in/paam/endUserRegisterContact.html',
    portalName: 'Protean NSDL Form 49A Direct Page',
    defaultFee: '₹107 (Physical + e-PAN India) · ₹72 (Digital e-PAN only)',
    defaultProcessingTime: 'e-PAN 48 hrs · Physical card 10–15 days',
    defaultEligibility: 'Any Indian citizen (18+ ya Minor ke liye representative assessee).',
    defaultDocuments: [
      { name: 'Aadhaar Card', reason: 'Name, DOB, Father Name aur e-KYC OTP ke liye' },
    ],
    defaultFormGoal:
      'NSDL PAN Form 49A direct application page par Application Type, Category, Name, DOB, Email, aur Mobile fill karo, phir CAPTCHA par ruko.',
  },
  {
    id: 'passport-seva',
    title: 'Passport Seva',
    subtitle: 'Fresh / Re-issue Direct',
    category: 'passport',
    actionLabel: 'Apply Direct →',
    iconLetter: 'P',
    tint: 'teal',
    directFormUrl: 'https://portal2.passportindia.gov.in/AppOnlineProject/user/RegistrationBaseAction',
    portalName: 'Passport Seva Direct Registration Form',
    defaultFee: '₹1,500 (Normal 36 Pages) · ₹3,500 (Tatkaal)',
    defaultProcessingTime: 'PSK Appointment 3–7 days · Police Verification',
    defaultEligibility: 'Indian citizen with valid Date of Birth & Address proof.',
    defaultDocuments: [
      { name: 'Aadhaar Card', reason: 'Address aur Identity verification ke liye' },
      { name: '10th Marksheet / Birth Certificate', reason: 'Non-ECR status aur DOB proof ke liye' },
    ],
    defaultFormGoal:
      'Passport Seva User Registration / Direct Form page par details auto-fill karo aur CAPTCHA par ruko.',
  },
  {
    id: 'driving-licence',
    title: 'Driving Licence',
    subtitle: 'Parivahan LL & DL Form',
    category: 'dl',
    actionLabel: 'Apply Direct →',
    iconLetter: 'D',
    tint: 'emerald',
    directFormUrl: 'https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do',
    portalName: 'Parivahan Sarathi Direct Application',
    defaultFee: '₹200 (Learner Licence) + ₹150–₹300 (Test/DL Smart Card)',
    defaultProcessingTime: 'Contactless Aadhaar e-KYC se same day LL slot',
    defaultEligibility: 'Minimum age 18 years (Gear vehicle) / 16 years (Gearless 50cc).',
    defaultDocuments: [
      { name: 'Aadhaar Card', reason: 'Aadhaar authentication (bina RTO gaye LL test) ke liye' },
      { name: 'Blood Group / 10th Marksheet', reason: 'Age proof aur medical self-declaration ke liye' },
    ],
    defaultFormGoal:
      'Parivahan Sarathi State Selection & Learner Licence direct form par state select karke details fill karo.',
  },
  {
    id: 'court-block',
    title: 'Court, Block & Land',
    subtitle: 'Aay, Niwas, Jati, Khasra',
    category: 'court_block',
    actionLabel: 'Apply Direct →',
    iconLetter: 'L',
    tint: 'amber',
    directFormUrl: 'https://serviceonline.bihar.gov.in/',
    portalName: 'ServicePlus / Block Certificate Portal',
    defaultFee: '₹0 (Official RTPS / e-District Govt Portal Free)',
    defaultProcessingTime: '10–14 working days (Tatkal option available)',
    defaultEligibility: 'State resident (Bihar, UP, MP, Jharkhand etc. portal selectable).',
    defaultDocuments: [
      { name: 'Aadhaar Card', reason: 'Applicant name, Father name, Gram, Block, Thana, District ke liye' },
      { name: 'Ration Card / Electricity Bill / Self Declaration', reason: 'Local niwas / aay verification ke liye' },
    ],
    defaultFormGoal:
      'Block / RTPS / e-District certificate direct application form fill karo (Name, Father, Mother, Gram, Post, Thana, Block, District) aur CAPTCHA par ruko.',
  },
  {
    id: 'army-bharti',
    title: 'Army Agniveer',
    subtitle: 'Join Indian Army Apply',
    category: 'job',
    actionLabel: 'Apply Direct →',
    iconLetter: 'A',
    tint: 'rose',
    directFormUrl: 'https://joinindianarmy.nic.in/Authentication.aspx',
    portalName: 'Join Indian Army Direct Registration / Login',
    defaultFee: '₹250 Examination Fee (Common Entrance Exam)',
    defaultProcessingTime: 'Online CEE Form + Rally Admit Card',
    defaultEligibility: '10th / 12th pass (45%+ aggregate), age 17.5–21 years.',
    defaultDocuments: [
      { name: '10th / 12th Marksheet', reason: 'Subjects marks, Roll No, Board aur DOB ke liye' },
      { name: 'Aadhaar Card & Domicile', reason: 'District/Tehsil rally zone aur e-KYC ke liye' },
    ],
    defaultFormGoal:
      'Join Indian Army Authentication / Registration page kholo, CAPTCHA enter karwao aur phir eligibility/registration fields auto-fill karo.',
  },
  {
    id: 'railway-rrb',
    title: 'Railway RRB / Group D',
    subtitle: 'Direct Recruitment Portal',
    category: 'job',
    actionLabel: 'Apply Direct →',
    iconLetter: 'R',
    tint: 'emerald',
    directFormUrl: 'https://www.rrbapply.gov.in/#/auth/landing',
    portalName: 'Railway RRB Official Apply Form',
    defaultFee: '₹500 (Gen/OBC — ₹400 refund after CBT) · ₹250 (SC/ST/Female)',
    defaultProcessingTime: 'Direct One-Time Account & Post Form',
    defaultEligibility: '10th / ITI / Graduate (post ke hisab se), age 18–33 years.',
    defaultDocuments: [
      { name: 'Aadhaar Card', reason: 'RRB Aadhaar e-KYC verification ke liye' },
      { name: '10th Marksheet / ITI Certificate', reason: 'Qualification & Roll Number bharne ke liye' },
    ],
    defaultFormGoal:
      'RRB Apply portal par Create Account / Candidate Login direct form kholo aur Aadhaar/10th details auto-fill karo.',
  },
  {
    id: 'scholarship-nsp',
    title: 'Scholarship (NSP)',
    subtitle: 'Pre / Post Matric Apply',
    category: 'yojana',
    actionLabel: 'Apply Direct →',
    iconLetter: 'S',
    tint: 'rose',
    directFormUrl: 'https://scholarships.gov.in/ApplicationForm/',
    portalName: 'National Scholarship Direct Form',
    defaultFee: '₹0 (Bilkul Free Government Portal)',
    defaultProcessingTime: 'OTR + Institute Verification',
    defaultEligibility: 'School / College students with Income & Caste certificate.',
    defaultDocuments: [
      { name: 'Aadhaar Card & Bank Passbook', reason: 'DBT Scholarship account credit ke liye' },
      { name: 'Income Certificate & Last Marksheet', reason: 'Family income aur marks verification ke liye' },
    ],
    defaultFormGoal:
      'National Scholarship Portal direct OTR / Application page kholo aur student details bharo.',
  },
  {
    id: 'voter-id',
    title: 'Voter ID (Form 6)',
    subtitle: 'New Voter Direct Apply',
    category: 'custom',
    actionLabel: 'Apply Direct →',
    iconLetter: 'V',
    tint: 'purple',
    directFormUrl: 'https://voters.eci.gov.in/form6',
    portalName: 'ECI Voters Portal Form 6 Direct',
    defaultFee: '₹0 (Free Government Service)',
    defaultProcessingTime: '15–30 days BLO verification + e-EPIC download',
    defaultEligibility: 'Indian citizen age 18+ years.',
    defaultDocuments: [
      { name: 'Aadhaar Card', reason: 'DOB aur present address proof ke liye' },
    ],
    defaultFormGoal:
      'ECI Voters Form 6 direct page kholo aur Naya Voter ID form auto-fill karo.',
  },
  {
    id: 'epf-tax',
    title: 'EPF / UAN / Tax',
    subtitle: 'PF Claim & ITR e-Filing',
    category: 'tax_epf',
    actionLabel: 'Open Direct →',
    iconLetter: 'E',
    tint: 'blue',
    directFormUrl: 'https://unifiedportal-mem.epfindia.gov.in/memberinterface/',
    portalName: 'EPFO Member UAN Direct Login',
    defaultFee: '₹0 (Official EPFO Portal Free)',
    defaultProcessingTime: 'PF Withdrawal 3–7 days after OTP',
    defaultEligibility: 'Active UAN linked with Aadhaar & Bank.',
    defaultDocuments: [
      { name: 'UAN Number / PAN Card / Aadhaar', reason: 'Login aur Bank KYC claim ke liye' },
    ],
    defaultFormGoal:
      'EPFO Member Portal direct login/claim page kholo aur UAN details bharo.',
  },
  {
    id: 'hotel-booking',
    title: 'Hotel & Travel Stay',
    subtitle: 'Budget Rooms Near Station',
    category: 'hotel',
    actionLabel: 'Search Direct →',
    iconLetter: 'H',
    tint: 'amber',
    directFormUrl: 'https://www.irctctourism.com/accommodation',
    portalName: 'IRCTC Retiring Room & Hotel Direct',
    defaultFee: '₹300–₹2,500 / night (Retiring room & budget stays)',
    defaultProcessingTime: 'Instant booking confirmation',
    defaultEligibility: 'Valid Photo ID (Aadhaar / PAN / DL) & PNR (for retiring room).',
    defaultDocuments: [
      { name: 'Aadhaar Card / Photo ID', reason: 'Guest Check-in details bharne ke liye' },
    ],
    defaultFormGoal:
      'IRCTC Accommodation / Hotel direct booking page kholo aur city, check-in date aur guest details fill karo.',
  },
];

export const LATEST_JOBS_ITEMS: ServiceCatalogItem[] = [
  {
    ...PRIMARY_GRID_SERVICES[7], // Railway RRB
    id: 'job-rrb-group-d',
    title: 'Railway Group D / RRB 2026',
    subtitle: 'Fee ₹500/₹250 · Direct Form',
    badgeText: 'NEW',
  },
  {
    ...PRIMARY_GRID_SERVICES[1], // SSC
    id: 'job-ssc-cgl-gd',
    title: 'SSC CGL / SSC GD 2026',
    subtitle: 'Fee ₹100 / ₹0 · Direct Apply',
    badgeText: 'NEW',
  },
  {
    ...PRIMARY_GRID_SERVICES[6], // Army
    id: 'job-army-agniveer',
    title: 'Indian Army Agniveer 2026',
    subtitle: 'Fee ₹250 · 10th/12th Direct',
    badgeText: 'NEW',
  },
  {
    id: 'job-police-constable',
    title: 'Bihar / UP Police Constable',
    subtitle: 'Fee ₹675/₹400 · Direct Apply',
    category: 'job',
    actionLabel: 'Apply Direct →',
    iconLetter: 'P',
    tint: 'blue',
    directFormUrl: 'https://csbc.bihar.gov.in/',
    portalName: 'CSBC / UPPRPB Police Direct Form',
    defaultFee: '₹675 (Bihar Gen/OBC) · ₹400 (UP Police) · ₹180 (Reserved)',
    defaultProcessingTime: 'Online Registration + Form Fill',
    defaultEligibility: '12th Pass (10+2), Age 18–25 years.',
    defaultDocuments: [
      { name: '10th & 12th Marksheet', reason: 'Marks, Certificate No & DOB ke liye' },
      { name: 'Aadhaar Card & Domicile/Caste', reason: 'Category aur address verification ke liye' },
    ],
    defaultFormGoal:
      'Police Constable recruitment direct registration form kholo aur candidate details bharo.',
    badgeText: 'NEW',
  },
];

export const ADMIT_AND_RESULT_ITEMS: ServiceCatalogItem[] = [
  {
    id: 'admit-ssc',
    title: 'SSC CGL / GD Admit Card',
    subtitle: 'Candidate Login Direct',
    category: 'admit_card',
    actionLabel: 'Download →',
    iconLetter: 'A',
    tint: 'purple',
    directFormUrl: 'https://ssc.gov.in/login',
    portalName: 'SSC Candidate Direct Login',
    defaultFee: '₹0 (Free Download)',
    defaultProcessingTime: 'Instant PDF Download',
    defaultEligibility: 'SSC Registration Number + Password / DOB chahiye.',
    defaultDocuments: [
      { name: 'SSC Registration Slip / Aadhaar', reason: 'Registration Number & DOB bharne ke liye' },
    ],
    defaultFormGoal: 'SSC Login direct page kholo aur Registration No / Password / CAPTCHA section dikhao.',
    badgeText: 'LIVE',
  },
  {
    id: 'admit-rrb',
    title: 'Railway RRB Admit & Status',
    subtitle: 'Direct Candidate Portal',
    category: 'admit_card',
    actionLabel: 'Download →',
    iconLetter: 'R',
    tint: 'blue',
    directFormUrl: 'https://www.rrbapply.gov.in/#/auth/landing',
    portalName: 'RRB Direct Candidate Portal',
    defaultFee: '₹0 (Free Download)',
    defaultProcessingTime: 'Instant City Intimation / Admit Card',
    defaultEligibility: 'RRB Registration No / Mobile + DOB.',
    defaultDocuments: [
      { name: 'Application Slip / Aadhaar', reason: 'Registered Mobile/Email aur DOB ke liye' },
    ],
    defaultFormGoal: 'RRB Apply login page par registration credentials fill karo.',
    badgeText: 'LIVE',
  },
  {
    id: 'result-board',
    title: '10th / 12th Board Result',
    subtitle: 'CBSE / BSEB / UPMSP Direct',
    category: 'result',
    actionLabel: 'Check →',
    iconLetter: 'B',
    tint: 'emerald',
    directFormUrl: 'https://results.cbse.nic.in/',
    portalName: 'Official Board Result Direct Page',
    defaultFee: '₹0 (Free Check)',
    defaultProcessingTime: 'Instant Marksheet Preview',
    defaultEligibility: 'Roll Number, Roll Code / School Code zaruri hai.',
    defaultDocuments: [
      { name: 'Exam Admit Card', reason: 'Exact Roll Number aur Roll Code nikalne ke liye' },
    ],
    defaultFormGoal: 'Board result direct page par Roll Number aur Roll Code fill karo.',
    badgeText: 'NEW',
  },
  {
    id: 'ecourts-case',
    title: 'Court Case / Kachahari Status',
    subtitle: 'CNR & Order Direct Search',
    category: 'court_block',
    actionLabel: 'Check →',
    iconLetter: 'C',
    tint: 'amber',
    directFormUrl: 'https://services.ecourts.gov.in/ecourtindia_v6/',
    portalName: 'eCourts India Direct Search',
    defaultFee: '₹0 (Official eCourts Free)',
    defaultProcessingTime: 'Instant Next Hearing Date & Order PDF',
    defaultEligibility: '16-digit CNR Number ya Party Name + District.',
    defaultDocuments: [
      { name: 'Case Paper / Notice (CNR No)', reason: 'CNR Number ya Party Name OCR se nikalne ke liye' },
    ],
    defaultFormGoal: 'eCourts direct search page par CNR Number ya District/Case details fill karo.',
    badgeText: 'DIRECT',
  },
];

export const POPULAR_SERVICE_TILES: ServiceCatalogItem[] = [
  PRIMARY_GRID_SERVICES[2], // PAN Card
  PRIMARY_GRID_SERVICES[0], // IRCTC
  PRIMARY_GRID_SERVICES[3], // Passport
  PRIMARY_GRID_SERVICES[4], // Driving Licence
  PRIMARY_GRID_SERVICES[9], // Voter ID
  PRIMARY_GRID_SERVICES[5], // Block / Income / Caste / Residence
  {
    id: 'aadhaar-update',
    title: 'Aadhaar Update (myAadhaar)',
    subtitle: 'Address Update / PVC Order',
    category: 'custom',
    actionLabel: 'Open Direct →',
    iconLetter: 'A',
    tint: 'blue',
    directFormUrl: 'https://myaadhaar.uidai.gov.in/',
    portalName: 'myAadhaar Direct Login Portal',
    defaultFee: '₹50 (Online Document/Address Update & PVC Card)',
    defaultProcessingTime: '5–15 days',
    defaultEligibility: 'Aadhaar linked mobile number for OTP.',
    defaultDocuments: [
      { name: 'Aadhaar Card', reason: '12-digit Aadhaar No ke liye' },
      { name: 'Address Proof (Bank/Electricity/Ration)', reason: 'Naya address upload karne ke liye' },
    ],
    defaultFormGoal: 'myAadhaar Login direct page kholo aur Aadhaar No + CAPTCHA entry dikhao.',
  },
  {
    id: 'ration-card',
    title: 'Ration Card (NFSA)',
    subtitle: 'New / Member Add Direct',
    category: 'yojana',
    actionLabel: 'Apply Direct →',
    iconLetter: 'R',
    tint: 'emerald',
    directFormUrl: 'https://nfsa.gov.in/portal/ration_card_state_portals_aa',
    portalName: 'NFSA State Ration Card Direct List',
    defaultFee: '₹0–₹20 (State portal fee)',
    defaultProcessingTime: '15–30 days verification',
    defaultEligibility: 'Family head Aadhaar, Bank Passbook, aur Income certificate.',
    defaultDocuments: [
      { name: 'Family Aadhaar Cards', reason: 'Sabhi sadasyon ki details ke liye' },
      { name: 'Bank Passbook & Income Cert', reason: 'Eligibility aur head account ke liye' },
    ],
    defaultFormGoal: 'NFSA Ration Card portal par apna state portal kholo aur application form fill karo.',
  },
  {
    id: 'gst-reg',
    title: 'GST Registration',
    subtitle: 'New GSTIN Direct Apply',
    category: 'tax_epf',
    actionLabel: 'Apply Direct →',
    iconLetter: 'G',
    tint: 'indigo',
    directFormUrl: 'https://reg.gst.gov.in/registration/',
    portalName: 'GST Portal New Registration Direct',
    defaultFee: '₹0 (Official GST Portal Free)',
    defaultProcessingTime: '3–7 working days TRN to GSTIN',
    defaultEligibility: 'PAN, Aadhaar, Business Address Proof & Bank Account.',
    defaultDocuments: [
      { name: 'PAN Card & Aadhaar Card', reason: 'Authorized signatory verification ke liye' },
      { name: 'Electricity Bill / Rent Agreement', reason: 'Business address proof ke liye' },
    ],
    defaultFormGoal: 'GST New Registration direct form par PAN, State, Email aur Mobile fill karo.',
  },
  {
    id: 'itr-efiling',
    title: 'Income Tax e-Filing',
    subtitle: 'Direct ITR Login / Link PAN',
    category: 'tax_epf',
    actionLabel: 'Open Direct →',
    iconLetter: 'T',
    tint: 'purple',
    directFormUrl: 'https://eportal.incometax.gov.in/iec/foservices/#/login',
    portalName: 'Income Tax e-Filing Direct Login',
    defaultFee: '₹0 (Self e-Filing Free)',
    defaultProcessingTime: 'Instant e-Verify via Aadhaar OTP',
    defaultEligibility: 'PAN Card + Aadhaar linked mobile number.',
    defaultDocuments: [
      { name: 'PAN Card & Form 16 / Bank Statement', reason: 'PAN login aur income summary ke liye' },
    ],
    defaultFormGoal: 'Income Tax e-Filing login direct page kholo aur PAN number fill karo.',
  },
  PRIMARY_GRID_SERVICES[10], // EPF
  {
    id: 'digilocker',
    title: 'DigiLocker Sign-In',
    subtitle: 'Original Marksheet / DL PDF',
    category: 'custom',
    actionLabel: 'Open Direct →',
    iconLetter: 'D',
    tint: 'teal',
    directFormUrl: 'https://accounts.digitallocker.gov.in/signin/smart_v2',
    portalName: 'DigiLocker Direct Sign-In',
    defaultFee: '₹0 (Official Govt App Free)',
    defaultProcessingTime: 'Instant digital documents',
    defaultEligibility: 'Aadhaar Number / Mobile Number.',
    defaultDocuments: [
      { name: 'Aadhaar Card', reason: 'Aadhaar number + OTP verification ke liye' },
    ],
    defaultFormGoal: 'DigiLocker Sign-In direct page kholo aur Aadhaar/Mobile fill karo.',
  },
];

export const ALL_SERVICES: ServiceCatalogItem[] = [
  ...PRIMARY_GRID_SERVICES,
  ...LATEST_JOBS_ITEMS,
  ...ADMIT_AND_RESULT_ITEMS,
  ...POPULAR_SERVICE_TILES,
].filter((item, index, arr) => arr.findIndex((x) => x.id === item.id) === index);

export function findServiceByIdOrQuery(serviceId?: string, query?: string): ServiceCatalogItem | null {
  if (serviceId) {
    const exact = ALL_SERVICES.find((s) => s.id === serviceId);
    if (exact) return exact;
  }
  const q = (query || '').toLowerCase().trim();
  if (!q) return null;
  return (
    ALL_SERVICES.find(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.subtitle.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
    ) || null
  );
}

export function buildFallbackServiceBrief(
  query: string,
  catalogItem?: ServiceCatalogItem | null
): ServiceBrief {
  const item = catalogItem || findServiceByIdOrQuery(undefined, query);
  if (item) {
    return {
      serviceId: item.id,
      title: item.title,
      category: item.category,
      portalName: item.portalName,
      directFormUrl: item.directFormUrl,
      feeSummary: item.defaultFee,
      processingTime: item.defaultProcessingTime,
      eligibilitySummary: item.defaultEligibility,
      keyHighlights: [
        `Direct Form Link (No Homepage): ${item.portalName}`,
        `Estimated Fee: ${item.defaultFee}`,
        `Time / Output: ${item.defaultProcessingTime}`,
      ],
      requiredDocuments: item.defaultDocuments.map((d, i) => ({
        id: `${item.id}-doc-${i + 1}`,
        name: d.name,
        reason: d.reason,
      })),
      formSteps: [
        'Niche maange gaye documents upload karein — OCR+AI RAM me details nikal lega.',
        'Agar koi extra detail (jaise Station, Exam Zone, Category) chahiye toh check karein.',
        '"Direct Form Page Kholo & Auto-Fill Chalao" dabate hi seedha form wala page khulega aur AI bharna shuru karega.',
      ],
      humanCheckNotes: 'CAPTCHA, Aadhaar/Mobile OTP aur Final Payment sirf aap live screen par enter karenge.',
      directFormGoal: item.defaultFormGoal,
      sources: [{ title: item.portalName, uri: item.directFormUrl }],
      fromLiveAi: false,
    };
  }

  const encoded = encodeURIComponent(`${query} official apply online form`);
  return {
    serviceId: `custom-${Date.now()}`,
    title: query,
    category: 'custom',
    portalName: `${query} Direct Application Portal`,
    directFormUrl: `https://www.google.com/search?q=${encoded}`,
    feeSummary: 'Official portal notification ke hisab se (usually ₹0–₹500)',
    processingTime: 'Online portal process ke mutabik',
    eligibilitySummary: `${query} ke liye valid ID proof aur qualification details chahiye.`,
    keyHighlights: [
      `Seedha "${query}" ke official apply link par jaane ke liye tayyar`,
      'Pehle apna Aadhaar / Marksheet OCR se scan karein',
    ],
    requiredDocuments: [
      { id: 'custom-doc-1', name: 'Aadhaar Card / Photo ID', reason: 'Name, DOB, Father Name & Address fill karne ke liye' },
      { id: 'custom-doc-2', name: 'Relevant Marksheet / Certificate', reason: 'Qualification ya certificate number fill karne ke liye' },
    ],
    formSteps: [
      'Zaruri document upload karein taaki OCR details nikal le.',
      'Direct Form Page kholkar AI Autopilot ko auto-fill karne dein.',
    ],
    humanCheckNotes: 'CAPTCHA, OTP aur Payment step par AI ruk kar aapko dikhayega.',
    directFormGoal: `${query} ka direct official apply/registration form page kholo (homepage par mat ruko) aur meri details auto-fill karo. CAPTCHA/OTP par ruko.`,
    sources: [],
    fromLiveAi: false,
  };
}
