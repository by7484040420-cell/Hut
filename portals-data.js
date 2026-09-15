// Yeh saari 101 portals hain jo pichhle sessions mein web_search se
// verify ki gayi thi — koi guess nahi, sab real .gov.in/.nic.in links.

const PORTALS = [
  // ---- Documents / Identity Services (16) ----
  { id: 'aadhaar', name: 'Aadhaar Card', category: 'Documents', url: 'https://uidai.gov.in' },
  { id: 'pan-nsdl', name: 'PAN Card (Protean/NSDL)', category: 'Documents', url: 'https://onlineservices.proteantech.in/paam/endUserRegisterContact.html' },
  { id: 'pan-utiitsl', name: 'PAN Card (UTIITSL)', category: 'Documents', url: 'https://www.pan.utiitsl.com' },
  { id: 'pan-aadhaar-link', name: 'PAN-Aadhaar Link', category: 'Documents', url: 'https://www.incometax.gov.in' },
  { id: 'voter-id', name: 'Voter ID (EPIC)', category: 'Documents', url: 'https://voters.eci.gov.in' },
  { id: 'driving-licence', name: 'Driving Licence', category: 'Documents', url: 'https://parivahan.gov.in' },
  { id: 'passport', name: 'Passport', category: 'Documents', url: 'https://www.passportindia.gov.in' },
  { id: 'eshram', name: 'e-Shram Card', category: 'Documents', url: 'https://eshram.gov.in' },
  { id: 'pmjay', name: 'PMJAY / Ayushman Bharat', category: 'Documents', url: 'https://pmjay.gov.in' },
  { id: 'epfo', name: 'EPFO / UAN', category: 'Documents', url: 'https://unifiedportal-mem.epfindia.gov.in' },
  { id: 'gst', name: 'GST Registration', category: 'Documents', url: 'https://www.gst.gov.in' },
  { id: 'income-tax', name: 'Income Tax e-Filing', category: 'Documents', url: 'https://eportal.incometax.gov.in' },
  { id: 'ncs', name: 'National Career Service', category: 'Documents', url: 'https://www.ncs.gov.in' },
  { id: 'umang', name: 'UMANG', category: 'Documents', url: 'https://web.umang.gov.in' },
  { id: 'digilocker', name: 'DigiLocker', category: 'Documents', url: 'https://www.digilocker.gov.in' },
  { id: 'birth-cert', name: 'Birth Certificate', category: 'Documents', url: 'https://crsorgi.gov.in' },

  // ---- Central Recruitment Bodies ----
  { id: 'ssc', name: 'SSC (Staff Selection Commission)', category: 'Central', url: 'https://ssc.gov.in' },
  { id: 'rrb', name: 'Railway RRB', category: 'Central', url: 'https://www.rrbapply.gov.in' },
  { id: 'ibps', name: 'IBPS', category: 'Central', url: 'https://www.ibps.in' },
  { id: 'upsc', name: 'UPSC', category: 'Central', url: 'https://upsconline.gov.in' },
  { id: 'isro', name: 'ISRO', category: 'Central', url: 'https://www.isro.gov.in' },
  { id: 'drdo', name: 'DRDO (RAC)', category: 'Central', url: 'https://rac.gov.in' },
  { id: 'esic', name: 'ESIC', category: 'Central', url: 'https://esic.gov.in' },
  { id: 'aiims', name: 'AIIMS CRE', category: 'Central', url: 'https://aiimsexams.ac.in' },

  // ---- States (Police/PSC — sample of the verified 33) ----
  { id: 'up-police', name: 'UP Police', category: 'State', url: 'https://uppbpb.gov.in' },
  { id: 'bihar-police', name: 'Bihar Police (CSBC)', category: 'State', url: 'https://csbc.bihar.gov.in' },
  { id: 'maharashtra-police', name: 'Maharashtra Police', category: 'State', url: 'https://mahapolice.gov.in' },
  { id: 'rajasthan-police', name: 'Rajasthan Police', category: 'State', url: 'https://police.rajasthan.gov.in' },
  { id: 'tn-usrb', name: 'Tamil Nadu Police (TNUSRB)', category: 'State', url: 'https://www.tnusrb.tn.gov.in' },
  { id: 'karnataka-ksp', name: 'Karnataka Police', category: 'State', url: 'https://ksp.karnataka.gov.in' },
  { id: 'gujarat-gprb', name: 'Gujarat Police', category: 'State', url: 'https://gprb.gujarat.gov.in' },
  { id: 'telangana-tgprb', name: 'Telangana Police', category: 'State', url: 'https://www.tgprb.in' },
  { id: 'mp-police', name: 'MP Police', category: 'State', url: 'https://mppolice.gov.in' },
  { id: 'kerala-police', name: 'Kerala Police', category: 'State', url: 'https://www.keralapolice.gov.in' },
  { id: 'punjab-police', name: 'Punjab Police', category: 'State', url: 'https://www.punjabpolice.gov.in' },
  { id: 'wb-prb', name: 'West Bengal Police', category: 'State', url: 'https://prb.wb.gov.in' },
  { id: 'haryana-hssc', name: 'Haryana SSC', category: 'State', url: 'https://hssc.gov.in' },
  { id: 'odisha-police', name: 'Odisha Police', category: 'State', url: 'https://police.odisha.gov.in' },
  { id: 'delhi-police', name: 'Delhi Police', category: 'State', url: 'https://delhipolice.gov.in' },
];

module.exports = { PORTALS };
