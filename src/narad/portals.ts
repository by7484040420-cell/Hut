import type { Category, Portal, SvcDetail } from './types';

export const extraHosts = [
  'irctc.co.in', 'mudra.org.in', 'jansamarth.in', 'standupmitra.in', 'licindia.in',
  'sbpdcl.co.in', 'nbpdcl.co.in', 'nta.ac.in', 'nptel.ac.in', 'upmsp.edu.in',
  'slprbassam.in', 'tgprb.in', 'manipurpolice.org', 'ibps.in', 'sbi.co.in', 'rbi.org.in',
  'cdac.in', 'aiimsexams.ac.in', 'cbse.gov.in', 'uksssc.in', 'amcsscentry.gov.in'
];

export function isAllowed(url: string): boolean {
  if (!url || !url.trim()) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (host === 'gov.in' || host.endsWith('.gov.in') || host.endsWith('.nic.in')) return true;
    return extraHosts.some(h => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

// Popular Portals
export const pAfms: Portal = { name: 'AFMS Join (Armed Forces Medical Services)', url: 'https://amcsscentry.gov.in', keys: ['afms', 'armed forces', 'medical services', 'military nurse'], note: 'Armed Forces Medical Services' };
export const pAadhaar: Portal = { name: 'Aadhaar Card (UIDAI)', url: 'https://myaadhaar.uidai.gov.in', keys: ['aadhaar', 'aadhar', 'adhar', 'uidai'], note: 'Download / Update / PVC Card' };
export const pPan: Portal = { name: 'PAN Card (Instant e-PAN)', url: 'https://eportal.incometax.gov.in/iec/foservices/#/pre-login/instant-e-pan', keys: ['pan', 'instant pan', 'e-pan'], note: 'Free Instant e-PAN' };
export const pIrctc: Portal = { name: 'IRCTC (Train Ticket Booking)', url: 'https://www.irctc.co.in', keys: ['irctc', 'train', 'ticket', 'railway ticket', 'tatkal'], note: 'Tatkal & General Ticket' };
export const pVoter: Portal = { name: 'Voter ID (ECI Form 6)', url: 'https://voters.eci.gov.in', keys: ['voter', 'matdata', 'election card'], note: 'New Registration / Download' };
export const pPassport: Portal = { name: 'Passport Seva', url: 'https://www.passportindia.gov.in', keys: ['passport', 'seva'], note: 'Fresh Passport / Renewal' };
export const pDl: Portal = { name: 'Driving Licence (Parivahan)', url: 'https://parivahan.gov.in', keys: ['driving', 'licence', 'license', 'dl', 'sarathi'], note: 'Learner & DL Services' };
export const pRation: Portal = { name: 'Ration Card (EPDS Bihar)', url: 'https://epds.bihar.gov.in', keys: ['ration', 'epds'], note: 'Bihar Ration Services' };
export const pIncomeCert: Portal = { name: 'Income Certificate (RTPS Bihar)', url: 'https://serviceonline.bihar.gov.in', keys: ['income certificate', 'aay praman', 'aay', 'rtps'], note: 'Aay Praman Patra' };
export const pCasteCert: Portal = { name: 'Caste Certificate (RTPS Bihar)', url: 'https://serviceonline.bihar.gov.in', keys: ['caste', 'jati', 'jaati', 'rtps'], note: 'Jaati Praman Patra' };
export const pResidenceCert: Portal = { name: 'Residence Certificate (RTPS Bihar)', url: 'https://serviceonline.bihar.gov.in', keys: ['residence', 'domicile', 'niwas', 'nivas', 'awasiya', 'rtps'], note: 'Awasiya Praman Patra' };
export const pBirthCert: Portal = { name: 'Birth Certificate (CRS)', url: 'https://crsorgi.gov.in', keys: ['birth', 'janm praman'], note: 'Birth & Death Registration' };
export const pEpf: Portal = { name: 'EPF / UAN Member Portal', url: 'https://unifiedportal-mem.epfindia.gov.in', keys: ['epf', 'uan', 'pf', 'passbook'], note: 'PF Balance / Withdrawal' };
export const pGst: Portal = { name: 'GST Portal', url: 'https://www.gst.gov.in', keys: ['gst', 'return'], note: 'Registration & Filing' };
export const pItr: Portal = { name: 'Income Tax e-Filing (ITR)', url: 'https://www.incometax.gov.in', keys: ['itr', 'income tax', 'tax'], note: 'ITR Filing & Refund Status' };
export const pNcs: Portal = { name: 'National Career Service (NCS)', url: 'https://www.ncs.gov.in', keys: ['ncs', 'job', 'naukri', 'rojgar', 'career'], note: 'Central Govt Jobs' };
export const pUmang: Portal = { name: 'UMANG Unified Platform', url: 'https://web.umang.gov.in', keys: ['umang', 'services'], note: 'All Central & State Apps' };
export const pDigi: Portal = { name: 'DigiLocker', url: 'https://www.digilocker.gov.in', keys: ['digilocker', 'digi locker', 'documents'], note: 'Issued Documents' };

export const pUpsc: Portal = { name: 'UPSC (Union Public Service)', url: 'https://upsc.gov.in', keys: ['upsc', 'ias', 'nda', 'cds'], note: 'Civil Services & Defence' };
export const pSsc: Portal = { name: 'SSC (Staff Selection Commission)', url: 'https://ssc.gov.in', keys: ['ssc', 'cgl', 'gd', 'chsl', 'mts'], note: 'CGL, GD, CHSL, MTS' };
export const pRrb: Portal = { name: 'Railway Recruitment (RRB)', url: 'https://www.rrbapply.gov.in', keys: ['rrb', 'railway job', 'group d', 'ntpc', 'alp'], note: 'ALP, NTPC, Group D' };
export const pBpsc: Portal = { name: 'BPSC (Bihar Public Service)', url: 'https://bpsc.bih.nic.in', keys: ['bpsc', 'bihar psc', 'tre'], note: 'BPSC Civil & Teacher' };
export const pCsbc: Portal = { name: 'Bihar Police (CSBC)', url: 'https://csbc.bihar.gov.in', keys: ['bihar police', 'csbc', 'sipahi'], note: 'Constable & Fireman' };
export const pUpPolice: Portal = { name: 'UP Police (UPPBPB)', url: 'https://uppbpb.gov.in', keys: ['up police', 'uppbpb', 'daroga'], note: 'Constable & SI' };
export const pNta: Portal = { name: 'NTA (NEET, JEE, CUET)', url: 'https://nta.ac.in', keys: ['nta', 'neet', 'jee', 'cuet', 'ugc net'], note: 'National Testing Agency' };
export const pEmpNews: Portal = { name: 'Employment News', url: 'https://employmentnews.gov.in', keys: ['employment news', 'rojgar samachar'], note: 'Official Job Gazette' };
export const pPib: Portal = { name: 'Press Information Bureau (PIB)', url: 'https://pib.gov.in', keys: ['pib', 'press'], note: 'Govt Notifications' };
export const pMyScheme: Portal = { name: 'myScheme Portal', url: 'https://www.myscheme.gov.in', keys: ['myscheme', 'yojana', 'scheme'], note: 'All Govt Welfare Schemes' };
export const pIndiaGov: Portal = { name: 'India.gov.in', url: 'https://www.india.gov.in', keys: ['india.gov', 'national'], note: 'National Portal of India' };
export const pBseb: Portal = { name: 'Bihar Board (BSEB)', url: 'https://biharboardonline.bihar.gov.in', keys: ['bseb', 'bihar board', 'matric', 'inter'], note: '10th & 12th Results' };
export const pUpBoard: Portal = { name: 'UP Board (UPMSP)', url: 'https://upmsp.edu.in', keys: ['up board', 'upmsp'], note: 'High School & Intermediate' };
export const pCbse: Portal = { name: 'CBSE Result', url: 'https://results.cbse.nic.in', keys: ['cbse', '10th', '12th'], note: 'Board Examinations' };

// Categories list
export const categories: Category[] = [
  {
    name: 'IRCTC & Ticket',
    sub: 'Train, Bus, Flight, PNR',
    tag: 'I',
    color: '#1E88E5',
    links: [
      pIrctc,
      { name: 'Indian Railways', url: 'https://indianrailways.gov.in', keys: ['indian railways'], note: 'Rail Portal' },
      { name: 'PNR / Train Status (NTES)', url: 'https://enquiry.indianrail.gov.in', keys: ['pnr', 'train status', 'running status'], note: 'Live Train Enquiry' }
    ]
  },
  {
    name: 'Jobs & Exams',
    sub: 'Govt & State Recruitments',
    tag: 'J',
    color: '#8E24AA',
    links: [pNcs, pUpsc, pSsc, pRrb, pBpsc, pCsbc, pUpPolice, pNta, pEmpNews]
  },
  {
    name: 'Admit Card',
    sub: 'All Exam Hall Tickets',
    tag: 'A',
    color: '#E53935',
    links: [
      { name: 'SSC Admit Card', url: 'https://ssc.gov.in', keys: ['ssc admit'], note: 'CGL, CHSL, GD' },
      { name: 'UPSC Admit Card', url: 'https://upsc.gov.in', keys: ['upsc admit'], note: 'Civil Services' },
      { name: 'RRB Admit Card', url: 'https://www.rrbapply.gov.in', keys: ['rrb admit'], note: 'Railway Exams' },
      { name: 'Bihar Police Admit Card', url: 'https://csbc.bihar.gov.in', keys: ['csbc admit'], note: 'CSBC' },
      { name: 'UP Police Admit Card', url: 'https://uppbpb.gov.in', keys: ['uppbpb admit'], note: 'UPPBPB' },
      { name: 'NTA Admit Card', url: 'https://nta.ac.in', keys: ['nta admit'], note: 'JEE, NEET, CUET' }
    ]
  },
  {
    name: 'Results',
    sub: 'Merit Lists & Cutoffs',
    tag: 'R',
    color: '#43A047',
    links: [
      { name: 'SSC Result', url: 'https://ssc.gov.in', keys: ['ssc result'], note: 'Official Results' },
      { name: 'UPSC Result', url: 'https://upsc.gov.in', keys: ['upsc result'], note: 'Official Results' },
      pBseb, pUpBoard, pCbse,
      { name: 'NTA Result', url: 'https://nta.ac.in', keys: ['nta result'], note: 'Official Results' }
    ]
  },
  {
    name: 'Documents & Identity',
    sub: 'PAN, DL, Aadhaar, Voter',
    tag: 'D',
    color: '#1565C0',
    links: [pAadhaar, pPan, pVoter, pPassport, pDl, pRation, pBirthCert, pDigi]
  },
  {
    name: 'Land & Property',
    sub: 'Khasra, Jamabandi, Rasid',
    tag: 'L',
    color: '#EF6C00',
    links: [
      { name: 'Bihar Bhumi (Jamabandi, Khasra, Rasid)', url: 'https://biharbhumi.bihar.gov.in', keys: ['bhumi', 'jamabandi', 'khasra', 'lagaan', 'dakhil kharij'], note: 'Bihar Land Records' },
      { name: 'UP Bhulekh', url: 'https://upbhulekh.gov.in', keys: ['bhulekh', 'khatauni'], note: 'Uttar Pradesh Land' },
      { name: 'Jharbhoomi (Jharkhand)', url: 'https://jharbhoomi.nic.in', keys: ['jharbhoomi'], note: 'Jharkhand Land' }
    ]
  },
  {
    name: 'Government Loan',
    sub: 'Mudra, PMEGP, Stand-Up',
    tag: 'G',
    color: '#2E7D32',
    links: [
      { name: 'PM Mudra Yojana', url: 'https://www.mudra.org.in', keys: ['mudra'], note: 'Business Loan' },
      { name: 'Jan Samarth Portal', url: 'https://www.jansamarth.in', keys: ['jan samarth'], note: 'All Central Loans' },
      { name: 'PMEGP Scheme', url: 'https://www.kviconline.gov.in/pmegpeportal', keys: ['pmegp'], note: 'Employment Subsidies' },
      { name: 'PM SVANidhi', url: 'https://pmsvanidhi.mohua.gov.in', keys: ['svanidhi'], note: 'Street Vendor Support' },
      { name: 'Stand-Up India', url: 'https://www.standupmitra.in', keys: ['stand up', 'standup'], note: 'SC/ST & Women' }
    ]
  },
  {
    name: 'Scholarship',
    sub: 'NSP, Post-Matric, CC',
    tag: 'S',
    color: '#D81B60',
    links: [
      { name: 'National Scholarship Portal', url: 'https://scholarships.gov.in', keys: ['scholarship', 'nsp', 'chhatravritti'], note: 'Central NSP' },
      { name: 'Bihar Post-Matric Scholarship', url: 'https://pmsonline.bihar.gov.in', keys: ['post matric', 'bihar scholarship'], note: 'Bihar' },
      { name: 'Bihar Student Credit Card', url: 'https://www.7nishchay-yuvaupmission.bihar.gov.in', keys: ['student credit card', 'bscc'], note: 'Higher Education Loan' }
    ]
  },
  {
    name: 'Yojana & Benefits',
    sub: 'Kisan, Ayushman, Ujjwala',
    tag: 'Y',
    color: '#F9A825',
    links: [
      pMyScheme,
      { name: 'PM-KISAN Samman Nidhi', url: 'https://pmkisan.gov.in', keys: ['pm kisan', 'kisan samman'], note: '₹6000/yr Assistance' },
      { name: 'Ayushman Bharat (PM-JAY)', url: 'https://pmjay.gov.in', keys: ['ayushman', 'pmjay'], note: '₹5 Lakh Health Cover' },
      { name: 'Ujjwala (PMUY)', url: 'https://www.pmuy.gov.in', keys: ['ujjwala', 'gas'], note: 'Free LPG Connection' },
      { name: 'e-Shram Portal', url: 'https://eshram.gov.in', keys: ['eshram', 'e-shram', 'shramik'], note: 'Unorganized Workers' }
    ]
  },
  {
    name: 'Insurance',
    sub: 'PMJJBY, PMSBY, LIC',
    tag: 'I',
    color: '#5E35B1',
    links: [
      { name: 'Jan Suraksha (PMJJBY / PMSBY)', url: 'https://jansuraksha.gov.in', keys: ['jeevan jyoti', 'suraksha bima', 'pmjjby', 'pmsby'], note: 'Low Cost Life & Accident' },
      { name: 'LIC of India', url: 'https://licindia.in', keys: ['lic'], note: 'Life Insurance' },
      { name: 'IRDAI Grievance Portal', url: 'https://irdai.gov.in', keys: ['irdai'], note: 'Insurance Redressal' }
    ]
  },
  {
    name: 'Rasid & Payment',
    sub: 'Bijli Bill, Challan, Tax',
    tag: 'R',
    color: '#00897B',
    links: [
      { name: 'Bhumi Lagaan Rasid (Bihar)', url: 'https://biharbhumi.bihar.gov.in', keys: ['lagaan', 'rasid'], note: 'Online Rent Receipt' },
      { name: 'e-Challan (Parivahan)', url: 'https://echallan.parivahan.gov.in', keys: ['challan', 'echallan'], note: 'Traffic Challan Payment' },
      { name: 'Bijli Bill - SBPDCL (South Bihar)', url: 'https://sbpdcl.co.in', keys: ['bijli', 'sbpdcl'], note: 'South Bihar Power' },
      { name: 'Bijli Bill - NBPDCL (North Bihar)', url: 'https://nbpdcl.co.in', keys: ['nbpdcl'], note: 'North Bihar Power' },
      { name: 'Income Tax e-Pay Tax', url: 'https://www.incometax.gov.in', keys: ['tax payment', 'challan 280'], note: 'Tax Payment' }
    ]
  },
  {
    name: 'More Services',
    sub: 'CSC, India Post, Digi',
    tag: 'M',
    color: '#3949AB',
    links: [
      pUmang, pDigi, pNcs,
      { name: 'India Post Tracking & Speed Post', url: 'https://www.indiapost.gov.in', keys: ['post office', 'india post'], note: 'Tracking & Postal' },
      { name: 'CSC Digital Seva (Jan Seva Kendra)', url: 'https://csc.gov.in', keys: ['csc', 'jan seva'], note: 'Citizen Services' },
      pIndiaGov
    ]
  },
  {
    name: 'Padhai Ghar',
    sub: 'NCERT, SWAYAM, NPTEL',
    tag: 'P',
    color: '#6A1B9A',
    links: [
      { name: 'SWAYAM (Free Online Govt Courses)', url: 'https://swayam.gov.in', keys: ['swayam', 'free course'], note: 'Certified Courses' },
      { name: 'DIKSHA National Teacher Platform', url: 'https://diksha.gov.in', keys: ['diksha'], note: 'K-12 Education' },
      { name: 'NCERT Textbooks Online', url: 'https://ncert.nic.in', keys: ['ncert', 'textbook'], note: 'Free Books' },
      { name: 'NPTEL (IIT & IISc Courses)', url: 'https://nptel.ac.in', keys: ['nptel'], note: 'Engineering & Science' }
    ]
  }
];

// 85 Verified Government Portals
export const govtPortals: Portal[] = [
  { name: 'SSC (Staff Selection Commission)', url: 'https://ssc.gov.in', keys: ['ssc', 'staff selection commission'], note: 'Central' },
  { name: 'Railway Recruitment Board (RRB)', url: 'https://www.rrbapply.gov.in', keys: ['railway recruitment board', 'rrb'], note: 'Central' },
  { name: 'Central Selection Board of Constable, Bihar (CSBC)', url: 'https://csbc.bihar.gov.in', keys: ['bihar csbc', 'csbc'], note: 'Bihar' },
  { name: 'UP Police Recruitment & Promotion Board (UPPBPB)', url: 'https://uppbpb.gov.in', keys: ['up police', 'uppbpb'], note: 'Uttar Pradesh' },
  { name: 'AP State Level Police Recruitment Board', url: 'https://slprb.ap.gov.in', keys: ['ap police', 'slprb'], note: 'Andhra Pradesh' },
  { name: 'State Level Police Recruitment Board, Assam', url: 'https://slprbassam.in', keys: ['assam police', 'slprbassam'], note: 'Assam' },
  { name: 'Maharashtra Police Recruitment', url: 'https://www.mahapolice.gov.in/police-recru.php', keys: ['maharashtra police'], note: 'Maharashtra' },
  { name: 'Rajasthan Recruitment Portal', url: 'https://www.recruitment.rajasthan.gov.in', keys: ['rajasthan recruitment'], note: 'Rajasthan' },
  { name: 'UP Public Service Commission (UPPSC)', url: 'https://uppsc.up.nic.in', keys: ['uppsc'], note: 'Uttar Pradesh' },
  { name: 'IBPS (Bank PO / Clerk Exams)', url: 'https://www.ibps.in', keys: ['bank exams', 'ibps'], note: 'Central' },
  { name: 'UPSC (Civil Services Online)', url: 'https://upsconline.gov.in', keys: ['civil services', 'upsc'], note: 'Central' },
  { name: 'ISRO Recruitment', url: 'https://www.isro.gov.in', keys: ['isro', 'space'], note: 'Central' },
  { name: 'DRDO Recruitment (RAC)', url: 'https://rac.gov.in', keys: ['drdo', 'rac'], note: 'Central' },
  { name: 'ESIC Recruitment', url: 'https://esic.gov.in', keys: ['esic'], note: 'Central' },
  { name: 'AIIMS Common Recruitment Examination (CRE)', url: 'https://aiimsexams.ac.in', keys: ['aiims', 'cre'], note: 'Central' },
  { name: 'TNUSRB (Tamil Nadu Uniformed Services)', url: 'https://www.tnusrb.tn.gov.in', keys: ['tnusrb', 'tn police'], note: 'Tamil Nadu' },
  { name: 'Karnataka State Police (KSP)', url: 'https://ksp.karnataka.gov.in', keys: ['ksp', 'karnataka police'], note: 'Karnataka' },
  { name: 'Gujarat Police Recruitment Board (GPRB)', url: 'https://gprb.gujarat.gov.in', keys: ['gprb', 'gujarat police'], note: 'Gujarat' },
  { name: 'Telangana Police Recruitment Board (TGPRB)', url: 'https://www.tgprb.in', keys: ['tgprb', 'telangana police'], note: 'Telangana' },
  { name: 'Madhya Pradesh Police', url: 'https://mppolice.gov.in', keys: ['mp police'], note: 'Madhya Pradesh' },
  { name: 'Kerala Police', url: 'https://www.keralapolice.gov.in', keys: ['kerala police'], note: 'Kerala' },
  { name: 'Punjab Police', url: 'https://www.punjabpolice.gov.in', keys: ['punjab police'], note: 'Punjab' },
  { name: 'West Bengal Police Recruitment (WBPRB)', url: 'https://prb.wb.gov.in', keys: ['wbprb', 'wb police'], note: 'West Bengal' },
  { name: 'Haryana Staff Selection Commission (HSSC)', url: 'https://hssc.gov.in', keys: ['hssc'], note: 'Haryana' },
  { name: 'Odisha Police', url: 'https://police.odisha.gov.in', keys: ['odisha police'], note: 'Odisha' },
  { name: 'Chhattisgarh Police', url: 'https://www.cgpolice.gov.in', keys: ['cg police', 'chhattisgarh police'], note: 'Chhattisgarh' },
  { name: 'Jharkhand Police', url: 'https://www.jhpolice.gov.in', keys: ['jharkhand police'], note: 'Jharkhand' },
  { name: 'Delhi Police', url: 'https://delhipolice.gov.in', keys: ['delhi police'], note: 'Delhi' },
  { name: 'Join Indian Army', url: 'https://joinindianarmy.nic.in', keys: ['join indian army', 'agniveer army'], note: 'Central' },
  { name: 'Join Indian Navy', url: 'https://www.joinindiannavy.gov.in', keys: ['join indian navy', 'agniveer navy'], note: 'Central' },
  { name: 'Indian Air Force Recruitment', url: 'https://indianairforce.nic.in', keys: ['indian air force', 'agniveer vayu'], note: 'Central' },
  { name: 'Border Security Force (BSF)', url: 'https://rectt.bsf.gov.in', keys: ['bsf recruitment', 'bsf'], note: 'Central' },
  { name: 'Central Reserve Police Force (CRPF)', url: 'https://rect.crpf.gov.in', keys: ['crpf'], note: 'Central' },
  { name: 'Central Industrial Security Force (CISF)', url: 'https://cisfrectt.cisf.gov.in', keys: ['cisf'], note: 'Central' },
  { name: 'Indo-Tibetan Border Police (ITBP)', url: 'https://recruitment.itbpolice.nic.in', keys: ['itbp'], note: 'Central' },
  { name: 'Sashastra Seema Bal (SSB)', url: 'https://recruitment.ssb.gov.in', keys: ['ssb'], note: 'Central' },
  { name: 'CTET (Central Teacher Eligibility Test)', url: 'https://ctet.nic.in', keys: ['ctet'], note: 'Central' },
  { name: 'Kendriya Vidyalaya Sangathan (KVS)', url: 'https://kvsangathan.nic.in', keys: ['kvs'], note: 'Central' },
  { name: 'Navodaya Vidyalaya Samiti (NVS)', url: 'https://navodaya.gov.in', keys: ['nvs'], note: 'Central' },
  { name: 'DSSSB (Delhi Subordinate Services)', url: 'https://dsssb.delhi.gov.in', keys: ['dsssb'], note: 'Delhi' },
  { name: 'Reserve Bank of India Careers (RBI)', url: 'https://opportunities.rbi.org.in', keys: ['rbi recruitment', 'rbi grade b'], note: 'Central' },
  { name: 'India Post GDS Recruitment', url: 'https://indiapostgdsonline.gov.in', keys: ['india post gds', 'dak sevak'], note: 'Central' },
  { name: 'Bihar Public Service Commission (BPSC)', url: 'https://bpsc.bih.nic.in', keys: ['bpsc'], note: 'Bihar' },
  { name: 'MP Public Service Commission (MPPSC)', url: 'https://mppsc.mp.gov.in', keys: ['mppsc'], note: 'Madhya Pradesh' },
  { name: 'Rajasthan Public Service Commission (RPSC)', url: 'https://rpsc.rajasthan.gov.in', keys: ['rpsc'], note: 'Rajasthan' },
  { name: 'TNPSC (Tamil Nadu)', url: 'https://www.tnpsc.gov.in', keys: ['tnpsc'], note: 'Tamil Nadu' },
  { name: 'TSPSC (Telangana)', url: 'https://www.tspsc.gov.in', keys: ['tspsc'], note: 'Telangana' },
  { name: 'GPSC (Gujarat)', url: 'https://gpsc.gujarat.gov.in', keys: ['gpsc'], note: 'Gujarat' },
  { name: 'OPSC (Odisha)', url: 'https://www.opsc.gov.in', keys: ['opsc'], note: 'Odisha' },
  { name: 'JPSC (Jharkhand)', url: 'https://www.jpsc.gov.in', keys: ['jpsc'], note: 'Jharkhand' },
  { name: 'MPSC (Maharashtra)', url: 'https://mpsc.gov.in', keys: ['mpsc'], note: 'Maharashtra' },
  { name: 'APPSC (Andhra Pradesh)', url: 'https://psc.ap.gov.in', keys: ['appsc'], note: 'Andhra Pradesh' },
  { name: 'WBPSC (West Bengal)', url: 'https://psc.wb.gov.in', keys: ['wbpsc'], note: 'West Bengal' },
  { name: 'HPSC (Haryana)', url: 'https://hpsc.gov.in', keys: ['hpsc'], note: 'Haryana' },
  { name: 'JKPSC (Jammu & Kashmir)', url: 'https://jkpsc.nic.in', keys: ['jkpsc'], note: 'Jammu & Kashmir' },
  { name: 'CGPSC (Chhattisgarh)', url: 'https://psc.cg.gov.in', keys: ['cgpsc'], note: 'Chhattisgarh' },
  { name: 'Kerala Public Service Commission (KPSC)', url: 'https://www.keralapsc.gov.in', keys: ['kerala psc'], note: 'Kerala' },
  { name: 'UKPSC (Uttarakhand)', url: 'https://psc.uk.gov.in', keys: ['ukpsc'], note: 'Uttarakhand' },
  { name: 'Punjab Public Service Commission (PPSC)', url: 'https://ppsc.gov.in', keys: ['ppsc'], note: 'Punjab' },
  { name: 'Karnataka Public Service Commission (KPSC)', url: 'https://kpsc.kar.nic.in', keys: ['kpsc'], note: 'Karnataka' },
  { name: 'Assam Public Service Commission (APSC)', url: 'https://apsc.nic.in', keys: ['apsc'], note: 'Assam' }
];

export const stateRecruit: Portal[] = [
  ...govtPortals.filter(p => p.note !== 'Central'),
  { name: 'BSSC (Bihar Staff Selection)', url: 'https://bssc.bihar.gov.in', keys: ['bssc'], note: 'Bihar' },
  { name: 'BPSSC (Bihar Police Subordinate)', url: 'https://bpssc.bihar.gov.in', keys: ['bpssc', 'bihar si'], note: 'Bihar' },
  { name: 'UPSSSC (UP Subordinate Services)', url: 'https://upsssc.gov.in', keys: ['upsssc', 'pet'], note: 'Uttar Pradesh' },
  { name: 'JSSC (Jharkhand Staff Selection)', url: 'https://www.jssc.nic.in', keys: ['jssc'], note: 'Jharkhand' },
  { name: 'RSMSSB (Rajasthan Staff Selection)', url: 'https://rsmssb.rajasthan.gov.in', keys: ['rsmssb'], note: 'Rajasthan' },
  { name: 'MP ESB (Vyapam)', url: 'https://esb.mp.gov.in', keys: ['vyapam', 'mpesb'], note: 'Madhya Pradesh' },
  { name: 'OJAS Gujarat', url: 'https://ojas.gujarat.gov.in', keys: ['ojas', 'gsssb'], note: 'Gujarat' },
  { name: 'OSSC (Odisha Staff Selection)', url: 'https://ossc.gov.in', keys: ['ossc'], note: 'Odisha' },
  { name: 'WBSSC (West Bengal Staff Selection)', url: 'https://www.wbssc.gov.in', keys: ['wbssc'], note: 'West Bengal' },
  { name: 'JKSSB (J&K Services Selection)', url: 'https://www.jkssb.nic.in', keys: ['jkssb'], note: 'Jammu & Kashmir' }
];

export const centralJobs: Portal[] = [
  pRrb, pSsc, pUpsc, pNta, pNcs, pEmpNews,
  ...govtPortals.filter(p => p.note === 'Central'),
  { name: 'SBI Careers (State Bank of India)', url: 'https://sbi.co.in/web/careers', keys: ['sbi po', 'sbi clerk'], note: 'Central' },
  { name: 'India Post GDS', url: 'https://indiapostgdsonline.gov.in', keys: ['gds', 'dak sevak'], note: 'Central' },
  { name: 'Agniveer Vayu (Indian Air Force)', url: 'https://agnipathvayu.cdac.in', keys: ['agniveer', 'vayu'], note: 'Central' },
  { name: 'Indian Coast Guard Navik', url: 'https://joinindiancoastguard.cdac.in', keys: ['coast guard', 'navik'], note: 'Central' },
  { name: 'FCI (Food Corporation of India)', url: 'https://fci.gov.in', keys: ['fci'], note: 'Central' }
];

export const allJobs: Portal[] = Array.from(
  new Map([...centralJobs, ...stateRecruit].map(p => [p.url, p])).values()
);

export const examSites = [
  { name: 'SSC', url: 'https://ssc.gov.in' },
  { name: 'UPSC', url: 'https://upsc.gov.in' },
  { name: 'RRB (Railway)', url: 'https://www.rrbapply.gov.in' },
  { name: 'NTA', url: 'https://nta.ac.in' },
  { name: 'IBPS', url: 'https://www.ibps.in' },
  { name: 'Bihar Police (CSBC)', url: 'https://csbc.bihar.gov.in' },
  { name: 'UP Police (UPPBPB)', url: 'https://uppbpb.gov.in' },
  { name: 'BPSC', url: 'https://bpsc.bih.nic.in' },
  { name: 'BSSC', url: 'https://bssc.bihar.gov.in' },
  { name: 'UPPSC', url: 'https://uppsc.up.nic.in' },
  { name: 'UPSSSC', url: 'https://upsssc.gov.in' },
  { name: 'JSSC', url: 'https://www.jssc.nic.in' },
  { name: 'HSSC', url: 'https://hssc.gov.in' },
  { name: 'RSMSSB', url: 'https://rsmssb.rajasthan.gov.in' },
  { name: 'MP ESB', url: 'https://esb.mp.gov.in' },
  { name: 'Delhi Police', url: 'https://delhipolice.gov.in' },
  { name: 'India Post GDS', url: 'https://indiapostgdsonline.gov.in' },
  { name: 'AIIMS', url: 'https://aiimsexams.ac.in' }
];

export const allAdmit: Portal[] = examSites.map(s => ({
  name: `${s.name} Admit Card`,
  url: s.url,
  keys: [`${s.name.toLowerCase()} admit`, 'hall ticket', 'admit card'],
  note: 'Official site'
}));

export const allResults: Portal[] = [
  ...examSites.map(s => ({
    name: `${s.name} Result`,
    url: s.url,
    keys: [`${s.name.toLowerCase()} result`, 'cutoff', 'merit'],
    note: 'Official site'
  })),
  pBseb, pUpBoard, pCbse,
  { name: 'National Result Portal', url: 'https://results.gov.in', keys: ['result', 'board'], note: 'All Universities & Boards' },
  { name: 'MP Board (MPBSE)', url: 'https://mpbse.nic.in', keys: ['mp board', 'mpbse'], note: 'Official site' },
  { name: 'Rajasthan Board (RBSE)', url: 'https://rajeduboard.rajasthan.gov.in', keys: ['rajasthan board', 'rbse'], note: 'Official site' }
];

export const allUpdates: Portal[] = [
  pEmpNews, pPib, pMyScheme, pIndiaGov,
  { name: 'MyGov India', url: 'https://www.mygov.in', keys: ['mygov'], note: 'Govt Citizen Engagement' },
  { name: 'Rojgar Mela (NCS)', url: 'https://www.ncs.gov.in', keys: ['rojgar mela'], note: 'Job Fair Updates' }
];

export const verifiedOfficialPortals: Portal[] = [
  pAfms,
  pIrctc,
  pPan,
  pSsc,
  pUpsc,
  pDl,
  pPassport,
  pVoter,
  pRrb,
  pIncomeCert
];

export const popularPortals: Portal[] = [
  pAfms, pAadhaar, pPan, pIrctc, pVoter, pPassport, pDl, pRation,
  pIncomeCert, pCasteCert, pResidenceCert, pBirthCert, pEpf, pGst, pItr, pNcs, pUmang, pDigi, pUpsc, pSsc
];

export const allPortals: Portal[] = Array.from(
  new Map(
    [
      ...popularPortals,
      ...categories.flatMap(c => c.links),
      ...allJobs,
      ...allAdmit,
      ...allResults,
      ...allUpdates
    ].map(p => [p.name, p])
  ).values()
);

export const SERVICE_EXTRA: Record<string, SvcDetail> = {
  'IRCTC (Train Ticket Booking)': {
    direct: 'https://www.irctc.co.in/nget/train-search',
    info: 'IRCTC Train Ticket Booking:\n• Tatkal AC booking: 10:00 AM\n• Tatkal Non-AC/Sleeper: 11:00 AM\n• User sirf CAPTCHA aur Bank OTP daalein, baki passenger details AI bharega!\n• Master List aur auto-fill se 20 second me ticket book!',
    ask: 'IRCTC par aapka pehle se Account bana hai?',
    yesLabel: 'Haan, Account Hai',
    noLabel: 'Nahi, Naya Banayein',
    yesUrl: 'https://www.irctc.co.in/nget/train-search',
    noUrl: 'https://www.irctc.co.in/nget/user-registration',
    yesSay: 'Bahut achha! AI aapki passenger details, journey, aur berth preference auto-fill karega. Bas CAPTCHA aur payment OTP aapko daalna hoga.',
    noSay: 'Theek hai! Pehle user registration page par AI aapka naam, address, mobile aur email auto-fill karega.'
  },
  'PAN Card (Instant e-PAN)': {
    direct: 'https://eportal.incometax.gov.in/iec/foservices/#/pre-login/instant-e-pan',
    info: 'Instant e-PAN (Income Tax Department):\n• Fees: ₹0 (Bilkul Free)\n• Samay: 10 Minute me PDF e-PAN\n• Chahiye: Aadhaar Number aur usse linked mobile par aane wala OTP.\n• AI saari personal details bharega, bas Aadhaar OTP aap verify karenge.',
    ask: 'Kya aapka mobile number Aadhaar se juda hua hai?',
    yesLabel: 'Haan, Linked Hai',
    noLabel: 'Nahi, Linked Nahi Hai',
    yesSay: 'Shaandar! 10 minute me free e-PAN mil jayega. AI form bharega, OTP aane par enter kijiye.',
    noSay: 'Agar mobile linked nahi hai to NSDL physical form bharna hoga ya Aadhaar center par mobile update karwana hoga.'
  },
  'Voter ID (ECI Form 6)': {
    direct: 'https://voters.eci.gov.in',
    info: 'Naya Matdata Pehchan Patra (Form 6):\n• Fees: ₹0\n• Kaun: 18 saal ya usse zyada umar ke Bharatiya nagrik\n• Chahiye: Photo, Date of Birth proof, Address proof, mobile\n• AI profile se state, district, assembly, address sab auto-fill karega.',
    ask: 'Kya aapka pehle se kisi rajya me Voter ID bana hai?',
    yesLabel: 'Haan, Sudhar/Shift karna hai (Form 8)',
    noLabel: 'Nahi, Pehli Baar Naya Banana hai (Form 6)',
    yesSay: 'Theek hai, Form 8 (Correction / Address Shift) ke liye AI saari details ready karega.',
    noSay: 'Form 6 (New Voter Registration) khula hai. AI aapki complete details auto-fill karega.'
  },
  'Income Certificate (RTPS Bihar)': {
    direct: 'https://serviceonline.bihar.gov.in',
    info: 'Aay Praman Patra (Bihar RTPS):\n• Samay: 7 se 14 din\n• Fees: ₹0 (Free)\n• Chahiye: Photo, Aadhar copy, Shapath patra\n• AI aapka naam, pita, mata, gaon, post, block, jila sab instant bharega.',
    ask: 'Aay kahan se aati hai? (Vyavasay / Krishi / Sarkari Seva)',
    yesLabel: 'Krishi & Mazdoori',
    noLabel: 'Vyavasay ya Anya',
    yesSay: 'Theek hai, standard aay vivaran set kar diya gaya hai.',
    noSay: 'Theek hai, aapke hisaab se annual income details calculate ho jayegi.'
  },
  'Caste Certificate (RTPS Bihar)': {
    direct: 'https://serviceonline.bihar.gov.in',
    info: 'Jaati Praman Patra (Bihar RTPS):\n• Samay: 10 se 14 din\n• Chahiye: Photo, Pehchan Patra, Khatiyan ya Jamabandi copy\n• AI category (SC/ST/OBC/EBC) aur sabhi pate auto-fill karega.'
  },
  'Residence Certificate (RTPS Bihar)': {
    direct: 'https://serviceonline.bihar.gov.in',
    info: 'Awasiya / Niwas Praman Patra (Bihar RTPS):\n• Samay: 7 din\n• Chahiye: Photo aur Aadhar copy\n• AI permanent aur present address dono auto-fill karega.'
  },
  'SSC (Staff Selection Commission)': {
    direct: 'https://ssc.gov.in',
    info: 'SSC One-Time Registration (OTR) & Application:\n• CGL, CHSL, GD, MTS\n• AI aapka 10th roll number, board, passing year, marks, address, aur preferences auto-fill karega.\n• Live photo capture aur final submission aap verify karenge.'
  },
  'Railway Recruitment Board (RRB)': {
    direct: 'https://www.rrbapply.gov.in',
    info: 'RRB Apply Online (ALP / Technician / NTPC / Group D):\n• Central Railway Recruitment\n• Community, Trade, ITI/Diploma, Aadhar verification\n• AI aapka form 100% bhar dega, bas OTP daal kar submit karein.'
  }
};
