export interface CscPortalEntry {
  id: string;
  name: string;
  stateOrScope: string;
  url: string;
  purpose: string;
  aiGoal: string;
}

export const LAND_REVENUE_PORTALS: CscPortalEntry[] = [
  {
    id: 'bihar-bhumi',
    name: 'Bihar Bhumi (Jamabandi, Dakhil-Kharij, Parimarjan, Rasid)',
    stateOrScope: 'Bihar',
    url: 'https://biharbhumi.bihar.gov.in/Biharbhumi/',
    purpose: 'Jamabandi dekhein, Online Lagaan Rasid, Dakhil-Kharij (Mutation) & Parimarjan Plus apply karein',
    aiGoal: 'Bihar Bhumi portal par user ke District, Anchal, Mauza, Khata/Khesra ya Jamabandi details fill karne me madad karo.',
  },
  {
    id: 'up-bhulekh',
    name: 'UP Bhulekh & Revenue Court (Khatauni / Vaad)',
    stateOrScope: 'Uttar Pradesh',
    url: 'https://upbhulekh.gov.in/',
    purpose: 'UP Khatauni / Gata sankhya copy aur Bhulekh record verify karein',
    aiGoal: 'UP Bhulekh portal par Janpad, Tehsil, Gram aur Gata/Khata sankhya chuno.',
  },
  {
    id: 'up-vaad',
    name: 'UP Revenue Court (RCCMS / Vaad)',
    stateOrScope: 'Uttar Pradesh',
    url: 'https://vaad.up.nic.in/',
    purpose: 'Tehsildar / SDM / DM Revenue Court mukadma status aur order dekhein',
    aiGoal: 'UP Revenue Court portal par Mandal, Zila, Tehsil aur Vaad sankhya check karo.',
  },
  {
    id: 'jharbhoomi',
    name: 'Jharbhoomi (Khatiyan, Register II, Online Lagaan)',
    stateOrScope: 'Jharkhand',
    url: 'https://jharbhoomi.nic.in/',
    purpose: 'Jharkhand land record, online rasid aur mutation apply karein',
    aiGoal: 'Jharbhoomi portal par District, Circle, Halka aur Mauza select karke land record kholo.',
  },
  {
    id: 'mp-bhulekh',
    name: 'MP Bhulekh (Khasra / B1 / Naksha)',
    stateOrScope: 'Madhya Pradesh',
    url: 'https://mpbhulekh.gov.in/',
    purpose: 'Madhya Pradesh certified Khasra, Khatauni aur map download karein',
    aiGoal: 'MP Bhulekh portal par Zila, Tehsil, Gram aur Khasra details open karo.',
  },
  {
    id: 'raj-apnakhata',
    name: 'Apna Khata Rajasthan (Jamabandi & Mutation)',
    stateOrScope: 'Rajasthan',
    url: 'https://apnakhata.rajasthan.gov.in/',
    purpose: 'Rajasthan Jamabandi nakal aur e-Dharti mutation apply karein',
    aiGoal: 'Apna Khata Rajasthan par Zila, Tehsil aur Gram chuno.',
  },
  {
    id: 'bhunaksha',
    name: 'Bhunaksha India (Digital Plot / Cadastral Map)',
    stateOrScope: 'All States',
    url: 'https://bhunaksha.gov.in/',
    purpose: 'Plot / Khesra ka sarkari map (Naksha) aur boundary dekhein',
    aiGoal: 'Bhunaksha par State, District, Circle aur Plot/Khesra number map dekho.',
  },
  {
    id: 'ngdrs',
    name: 'NGDRS Property & Registry Portal',
    stateOrScope: 'National',
    url: 'https://ngdrs.gov.in/',
    purpose: 'Online registry appointment, stamp duty & deed valuation check karein',
    aiGoal: 'NGDRS portal par apna state chuno aur registry / appointment process open karo.',
  },
];

export const COURT_AND_LEGAL_PORTALS: CscPortalEntry[] = [
  {
    id: 'tele-law',
    name: 'Tele-Law (CSC Official Advocate Video Appointment)',
    stateOrScope: 'All India · CSC',
    url: 'https://www.tele-law.in/',
    purpose: 'Sarkari / Panel Advocate se online video/phone par legal consultation & case appointment book karein',
    aiGoal: 'Tele-Law CSC portal kholo aur Citizen Login / Advocate Consultation appointment registration me details fill karo.',
  },
  {
    id: 'nyaya-bandhu',
    name: 'Nyaya Bandhu (Dept. of Justice — Advocate Connect)',
    stateOrScope: 'Dept. of Justice',
    url: 'https://www.nyayabandhu.doj.gov.in/',
    purpose: 'Free / Pro-Bono verified Advocate (Wakil) se apna case register aur link karein',
    aiGoal: 'Nyaya Bandhu Applicant registration / Advocate connect form kholo aur user details fill karo.',
  },
  {
    id: 'ecourts-services',
    name: 'eCourts India (Case Status, CNR & Hearing Date)',
    stateOrScope: 'District & Taluka Courts',
    url: 'https://services.ecourts.gov.in/ecourtindia_v6/',
    purpose: 'CNR Number, Party Name, FIR Number ya Advocate Name se case status aur agla tarikh (Next Date) dekhein',
    aiGoal: 'eCourts Services portal par CNR number ya State/District/Case status search fill karo, CAPTCHA user dalega.',
  },
  {
    id: 'ecourts-efiling',
    name: 'eCourts e-Filing 3.0 (Online Case & Document Filing)',
    stateOrScope: 'High & District Courts',
    url: 'https://efiling.ecourts.gov.in/',
    purpose: 'Online Vakalatnama, Petition, Affidavit aur court documents e-file karein',
    aiGoal: 'eCourts e-Filing 3.0 portal par State/Litigant login ya registration kholo.',
  },
  {
    id: 'nalsa-legal-aid',
    name: 'NALSA Legal Aid (Muft Sarkari Wakil Application)',
    stateOrScope: 'National Legal Services',
    url: 'https://nalsa.gov.in/',
    purpose: 'Agar wakil kharch nahi utha sakte to Free Govt Legal Aid Advocate ke liye apply karein',
    aiGoal: 'NALSA Legal Aid online application page kholo aur applicant details fill karo.',
  },
  {
    id: 'vcourts',
    name: 'Virtual Courts (Traffic Challan & Summary Cases)',
    stateOrScope: 'All India',
    url: 'https://vcourts.gov.in/',
    purpose: 'Court jaaye bina online Traffic Challan / Notice contest ya settle karein',
    aiGoal: 'Virtual Courts portal par apna State/Court chuno aur Challan / Party Name search kholo.',
  },
  {
    id: 'e-mulakat',
    name: 'e-Mulakat (Jail Prisoner Meeting Online Booking)',
    stateOrScope: 'ePrisons NIC',
    url: 'https://eprisons.nic.in/public/MyVisitRegistration',
    purpose: 'Jail me band vyakti se milne (Physical / Video Mulakat) ka online slot book karein',
    aiGoal: 'e-Mulakat Visitor Registration form par Visitor Name, Father Name, Address, Mobile aur Prisoner details fill karo.',
  },
  {
    id: 'cpgrams',
    name: 'CPGRAMS (Central / Police / Revenue Grievance)',
    stateOrScope: 'PMO & Ministries',
    url: 'https://pgportal.gov.in/',
    purpose: 'Police, Block, Tehsil ya sarkari vibhag ki shikayat online darj karein',
    aiGoal: 'CPGRAMS Citizen Portal par grievance lodge form kholo aur details auto-fill karo.',
  },
];

export const LAND_ISSUE_TYPES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'parimarjan', label: 'Parimarjan / Jamabandi Sudhar', hint: 'Online rashid me naam, khata, khesra ya rakba galat hai' },
  { id: 'mutation', label: 'Dakhil-Kharij (Mutation)', hint: 'Kharidi hui ya virasat wali jamin ka naya mutation karwana hai' },
  { id: 'kabza_boundary', label: 'Jamin Kabza / Batwara / Napi (Demarcation)', hint: 'Padosi ya sharik ka vivad, Amin napi ya CO/SDM stay application' },
  { id: 'rasid_khasra', label: 'Lagaan Rasid / Khasra-Khatauni Copy', hint: 'Online lagan katwana ya purana khatiyan / jamabandi nikalna' },
  { id: 'registry_fraud', label: 'Farzi Registry / Cancel / Revenue Court Appeal', hint: 'Galat kewala, DCLR / ADM / Collector court shikayat' },
];

export const COURT_CASE_TYPES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'criminal_fir', label: 'Criminal Case / FIR Defense & Bail Packet', hint: 'FIR darj hai — Haziri, Anticipatory/Regular Bail, Surety & Case docs tayyar karein' },
  { id: 'preventive_107', label: '107 / 144 / 145 Notice (SDM / Thana Vivad)', hint: 'Jamin ya jhagde ka SDM notice aaya hai — Show-cause reply & Bond' },
  { id: 'civil_land_suit', label: 'Civil / Title Suit & Injunction (Stay Order)', hint: 'Deewani court me jamin/makan mukadma, Plaint/Written Statement & Stay' },
  { id: 'cheque_138', label: 'Section 138 NI Act / Recovery Notice', hint: 'Cheque bounce ya paisa len-den case notice reply & defense brief' },
  { id: 'family_case', label: 'Family Court / Maintenance / Domestic Case', hint: 'Parivarik court jawab, mediation application ya haziri' },
  { id: 'traffic_challan', label: 'Vehicle Seize / Virtual Court / Challan Case', hint: 'Lok Adalat ya Virtual Court me fine kam karwane / release application' },
];

export const APPOINTMENT_TYPES: Array<{ id: string; label: string; portalId: string; hint: string }> = [
  { id: 'telelaw_advocate', label: 'CSC Tele-Law Video Wakil Consultation', portalId: 'tele-law', hint: 'Phone/Video se Advocate advice aur case registration' },
  { id: 'pro_bono_lawyer', label: 'Nyaya Bandhu / NALSA Sarkari Wakil Booking', portalId: 'nyaya-bandhu', hint: 'Free / Pro-bono advocate allotment aur appointment' },
  { id: 'ecourt_hearing', label: 'eCourts Case Check / Video Hearing & e-Filing', portalId: 'ecourts-services', hint: 'CNR search, Advocate memo aur online e-Filing 3.0' },
  { id: 'emulakat_jail', label: 'e-Mulakat Jail Visit Slot Appointment', portalId: 'e-mulakat', hint: 'Prisoner physical/video meeting pass booking' },
  { id: 'vcourt_settlement', label: 'Virtual Court Online Notice / Challan Disposal', portalId: 'vcourts', hint: 'Online contest ya settlement bina court gaye' },
];
