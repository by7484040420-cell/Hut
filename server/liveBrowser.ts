import fs from 'fs';
import path from 'path';
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright';
import type { WebSocket, WebSocketServer } from 'ws';
import type {
  EphemeralDocumentExtract,
  FormPageAnalysis,
  LiveBrowserStatus,
  MissingFormField,
  ProfileVault,
} from '../src/types.js';
import {
  analyzeLivePageFormWithAI,
  decideLiveBrowserStep,
  formatGeminiError,
  isGeminiConfigured,
  mapFormFieldsWithAI,
  type InteractiveDomElement,
  type UnmatchedFormField,
} from './geminiAgent.js';
import { resolveIndianState } from '../src/lib/indianStates.js';

function findChromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  try {
    const def = chromium.executablePath();
    if (def && fs.existsSync(def)) return def;
  } catch {
    // ignore
  }
  const directCandidates = [
    '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];
  for (const c of directCandidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    const pwDir = '/ms-playwright';
    if (fs.existsSync(pwDir)) {
      const entries = fs.readdirSync(pwDir).sort().reverse();
      for (const entry of entries) {
        const shellBin = path.join(pwDir, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
        if (fs.existsSync(shellBin)) return shellBin;
        const chromeBin = path.join(pwDir, entry, 'chrome-linux64', 'chrome');
        if (fs.existsSync(chromeBin)) return chromeBin;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

function loadFillEngineSource(): string | null {
  try {
    const enginePath = path.resolve('public', 'sarthi-fill-engine.js');
    if (fs.existsSync(enginePath)) {
      return fs.readFileSync(enginePath, 'utf-8');
    }
  } catch {
    // ignore
  }
  return null;
}

function buildServerFillPayload(params: {
  profile: ProfileVault;
  ephemeralDocs: EphemeralDocumentExtract[];
  zeroSave: boolean;
  goal?: string;
}): Record<string, string> {
  const map: Record<string, string> = {};
  if (!params.zeroSave) {
    const p = params.profile;
    const entries: [string, string][] = [
      ['fullName', p.fullName],
      ['fatherName', p.fatherName],
      ['motherName', p.motherName],
      ['dob', p.dob],
      ['gender', p.gender],
      ['category', p.category],
      ['maritalStatus', p.maritalStatus],
      ['mobile', p.mobile],
      ['alternateMobile', p.alternateMobile],
      ['email', p.email],
      ['addressLine', p.addressLine],
      ['villageOrWard', p.villageOrWard],
      ['postOffice', p.postOffice],
      ['policeStation', p.policeStation],
      ['blockOrTehsil', p.blockOrTehsil],
      ['district', p.district],
      ['state', p.state],
      ['pinCode', p.pinCode],
      ['qualification', p.qualification],
      ['boardOrUniversity', p.boardOrUniversity],
      ['passingYear', p.passingYear],
      ['percentageOrGrade', p.percentageOrGrade],
      ['panNumber', p.panNumber],
      ['aadhaarLast4', p.aadhaarLast4],
      ['passportNumber', p.passportNumber],
      ['dlNumber', p.dlNumber],
      ['voterId', p.voterId],
      ['preferredDepartureCity', p.preferredDepartureCity],
      ['preferredTrainClass', p.preferredTrainClass],
      ['bloodGroup', p.bloodGroup],
      ['birthPlace', p.birthPlace],
      ['tenthBoard', p.tenthBoard],
      ['tenthRoll', p.tenthRoll],
      ['tenthYear', p.tenthYear],
      ['tenthPercent', p.tenthPercent],
      ['twelfthBoard', p.twelfthBoard],
      ['twelfthRoll', p.twelfthRoll],
      ['twelfthYear', p.twelfthYear],
      ['twelfthPercent', p.twelfthPercent],
      ['twelfthStream', p.twelfthStream],
      ['graduationDegree', p.graduationDegree],
      ['collegeName', p.collegeName],
      ['graduationYear', p.graduationYear],
      ['graduationPercent', p.graduationPercent],
    ];
    for (const [k, v] of entries) {
      if (v && v.trim()) map[k] = v.trim();
    }
    if (p.preferredDepartureCity?.trim() && !map.fromStation) {
      map.fromStation = p.preferredDepartureCity.trim();
    }
    if (p.preferredTrainClass?.trim() && !map.trainClass) {
      map.trainClass = p.preferredTrainClass.trim();
    }
    for (const cf of p.customFields || []) {
      const lbl = (cf.label || '').trim();
      const val = (cf.value || '').trim();
      if (!lbl || !val) continue;
      map[`custom_${lbl}`] = val;
      const lowerCf = lbl.toLowerCase();
      if (/irctc.*user|login.*user|portal.*user|user\s*id|username/.test(lowerCf) && !map.loginUserId) {
        map.loginUserId = val;
      } else if (/irctc.*pass|login.*pass|portal.*pass|\bpassword\b/.test(lowerCf) && !map.loginPassword) {
        map.loginPassword = val;
      }
    }
  }
  const EXPLICIT_DIRECT_KEYS = new Set([
    'fromStation', 'toStation', 'journeyDate', 'trainClass', 'trainQuota', 'preferredTrain', 'berthPreference',
    'loginUserId', 'loginPassword', 'incomeSource', 'maritalStatus', 'designation', 'age',
    'tenthBoard', 'tenthRoll', 'tenthYear', 'tenthPercent',
    'twelfthBoard', 'twelfthRoll', 'twelfthYear', 'twelfthPercent',
    'aadhaarNumber', 'panNumber', 'passportNumber', 'dlNumber', 'voterId',
  ]);
  const orderedDocs = [...params.ephemeralDocs].sort((a, b) => {
    const rank = (id: string) => (id.startsWith('tatkal-') ? -1 : id === 'user-details' ? 0 : id.startsWith('popup-') ? 1 : 2);
    return rank(a.id) - rank(b.id);
  });
  for (const doc of orderedDocs) {
    const isTatkalSessionDoc = doc.id.startsWith('tatkal-');
    const docTypeLower = `${doc.documentType} ${doc.fileName}`.toLowerCase();
    const isTenthDoc = /10th|matric|ssc|high\s*school|class\s*x\b/.test(docTypeLower);
    const isTwelfthDoc = /12th|inter|hsc|senior\s*secondary|class\s*xii/.test(docTypeLower);
    const assignField = (keyName: string, val: string) => {
      if (isTatkalSessionDoc) map[keyName] = val;
      else map[keyName] = map[keyName] || val;
    };
    for (const f of doc.fields) {
      const k = f.key.trim();
      const v = f.value.trim();
      if (!v) continue;
      if (EXPLICIT_DIRECT_KEYS.has(k)) {
        assignField(k, v);
      }
      const lower = `${k} ${f.label}`.toLowerCase();
      if (k === 'fromStation' || lower.includes('from station') || lower.includes('boarding station')) assignField('fromStation', v);
      else if (k === 'toStation' || lower.includes('to station') || lower.includes('destination station')) assignField('toStation', v);
      else if (k === 'journeyDate' || lower.includes('journey date') || lower.includes('travel date')) assignField('journeyDate', v);
      else if (k === 'trainClass' || lower.includes('train class')) assignField('trainClass', v);
      else if (k === 'trainQuota' || lower.includes('quota')) assignField('trainQuota', v);
      else if (k === 'preferredTrain' || lower.includes('preferred train') || lower.includes('train name') || lower.includes('train number')) assignField('preferredTrain', v);
      else if (k === 'berthPreference' || lower.includes('berth')) assignField('berthPreference', v);
      else if (k === 'loginUserId' || lower.includes('login user') || lower.includes('irctc user')) assignField('loginUserId', v);
      else if (k === 'loginPassword') assignField('loginPassword', v);
      else if (k === 'age' || lower === 'passenger age') assignField('age', v);
      else if (k === 'tenthBoard') map.tenthBoard = map.tenthBoard || v;
      else if (k === 'tenthRoll') map.tenthRoll = map.tenthRoll || v;
      else if (k === 'tenthYear') map.tenthYear = map.tenthYear || v;
      else if (k === 'tenthPercent') map.tenthPercent = map.tenthPercent || v;
      else if (k === 'twelfthBoard') map.twelfthBoard = map.twelfthBoard || v;
      else if (k === 'twelfthRoll') map.twelfthRoll = map.twelfthRoll || v;
      else if (k === 'twelfthYear') map.twelfthYear = map.twelfthYear || v;
      else if (k === 'twelfthPercent') map.twelfthPercent = map.twelfthPercent || v;
      else if (lower.includes('full_name') || lower === 'fullname' || (lower.includes('name') && !lower.includes('father') && !lower.includes('mother') && !lower.includes('school') && !lower.includes('college') && !lower.includes('board'))) {
        assignField('fullName', v);
      } else if (lower.includes('father')) map.fatherName = map.fatherName || v;
      else if (lower.includes('mother')) map.motherName = map.motherName || v;
      else if (lower.includes('dob') || (lower.includes('birth') && lower.includes('date'))) map.dob = map.dob || v;
      else if (lower.includes('birth') && lower.includes('place')) map.birthPlace = map.birthPlace || v;
      else if (lower.includes('blood')) map.bloodGroup = map.bloodGroup || v;
      else if (lower.includes('gender') || lower.includes('sex')) assignField('gender', v);
      else if (lower.includes('category') || lower.includes('caste')) map.category = map.category || v;
      else if (lower.includes('marital')) map.maritalStatus = map.maritalStatus || v;
      else if (lower.includes('mobile') || lower.includes('phone')) map.mobile = map.mobile || v;
      else if (lower.includes('email')) map.email = map.email || v;
      else if (lower.includes('pin')) map.pinCode = map.pinCode || v;
      else if (lower.includes('pan')) map.panNumber = map.panNumber || v;
      else if (lower.includes('aadhaar') || lower.includes('aadhar') || lower.includes('uid')) map.aadhaarNumber = map.aadhaarNumber || v;
      else if (lower.includes('passport')) map.passportNumber = map.passportNumber || v;
      else if (lower.includes('dl') || lower.includes('driving')) map.dlNumber = map.dlNumber || v;
      else if (lower.includes('voter') || lower.includes('epic')) map.voterId = map.voterId || v;
      else if (lower.includes('address')) map.addressLine = map.addressLine || v;
      else if (lower.includes('village') || lower.includes('ward')) map.villageOrWard = map.villageOrWard || v;
      else if (lower.includes('post_office') || lower.includes('post office')) map.postOffice = map.postOffice || v;
      else if (lower.includes('police') || lower.includes('thana')) map.policeStation = map.policeStation || v;
      else if (lower.includes('block') || lower.includes('tehsil')) map.blockOrTehsil = map.blockOrTehsil || v;
      else if (lower.includes('district')) map.district = map.district || v;
      else if (lower.includes('state') || lower.includes('rajya') || lower.includes('राज्य') || lower.includes('pradesh') || lower.includes('province')) {
        map.state = map.state || v;
      }
      else if (lower.includes('roll')) {
        if (isTenthDoc) map.tenthRoll = map.tenthRoll || v;
        else if (isTwelfthDoc) map.twelfthRoll = map.twelfthRoll || v;
      } else if (lower.includes('year')) {
        map.passingYear = map.passingYear || v;
        if (isTenthDoc) map.tenthYear = map.tenthYear || v;
        else if (isTwelfthDoc) map.twelfthYear = map.twelfthYear || v;
      } else if (lower.includes('percent') || lower.includes('cgpa') || lower.includes('marks')) {
        map.percentageOrGrade = map.percentageOrGrade || v;
        if (isTenthDoc) map.tenthPercent = map.tenthPercent || v;
        else if (isTwelfthDoc) map.twelfthPercent = map.twelfthPercent || v;
      } else if (lower.includes('board') || lower.includes('university')) {
        map.boardOrUniversity = map.boardOrUniversity || v;
        if (isTenthDoc) map.tenthBoard = map.tenthBoard || v;
        else if (isTwelfthDoc) map.twelfthBoard = map.twelfthBoard || v;
      }
      map[`ocr_${k}`] = v;
    }
  }
  if (map.aadhaarNumber && !map.aadhaarLast4) {
    const digits = map.aadhaarNumber.replace(/\D/g, '');
    if (digits.length >= 4) map.aadhaarLast4 = digits.slice(-4);
  }
  const resolvedState = resolveIndianState({
    state: map.state,
    addressLine: map.addressLine,
    pinCode: map.pinCode,
    district: map.district,
  });
  if (resolvedState) map.state = resolvedState;

  if (params.goal?.trim()) map.goal = params.goal.trim();
  return map;
}

const DESKTOP_WIDTH = 1366;
const DESKTOP_HEIGHT = 820;
const MOBILE_WIDTH = 412;
const MOBILE_HEIGHT = 820;

const AD_HOST_PATTERNS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'taboola.com',
  'outbrain.com',
  'criteo.com',
  'criteo.net',
  'pubmatic.com',
  'openx.net',
  'adnxs.com',
  'moatads.com',
  'scorecardresearch.com',
  'amazon-adsystem.com',
  'popads.net',
  'popcash.net',
  'propellerads.com',
  'adsterra.com',
  'adsterratech.com',
  'hilltopads.net',
  'admaven.com',
  'exoclick.com',
  'juicyads.com',
  'trafficjunky.net',
  'mgid.com',
  'revcontent.com',
  'media.net',
  'rubiconproject.com',
  'casalemedia.com',
  'quantserve.com',
  'adsafeprotected.com',
  'zedo.com',
  'adcolony.com',
  'bidswitch.net',
  'inmobi.com',
  'yieldmo.com',
  'sharethrough.com',
  '33across.com',
  'smartadserver.com',
  'adroll.com',
  'clarity.ms',
  'hotjar.com',
  'crazyegg.com',
  'chartbeat.com',
  'newrelic.com',
  'nr-data.net',
  'onesignal.com',
  'izooto.com',
  'pushengage.com',
  'pushnami.com',
  'connect.facebook.net',
  'bat.bing.com',
  'mc.yandex.ru',
  'teads.tv',
  'spotxchange.com',
  'adform.net',
  'mathtag.com',
  'turn.com',
  'bluekai.com',
  'demdex.net',
  'krxd.net',
  'lijit.com',
  'sovrn.com',
  'triplelift.com',
  'indexexchange.com',
];

function isAdUrl(urlStr: string): boolean {
  const lower = urlStr.toLowerCase();
  // Never block essential captcha / security / login assets
  if (/captcha|nlpcaptcha|recaptcha|hcaptcha|turnstile/.test(lower)) return false;
  if (AD_HOST_PATTERNS.some((p) => lower.includes(p))) return true;
  if (
    lower.includes('/pagead/') ||
    lower.includes('/adsense/') ||
    lower.includes('/popunder') ||
    lower.includes('/adserver/') ||
    lower.includes('/prebid') ||
    lower.includes('fbevents.js') ||
    /[?&](adurl|ad_type|popunder)=/.test(lower)
  ) {
    return true;
  }
  return false;
}

function isIrctcUrl(urlStr: string): boolean {
  return /irctc\.co\.in/i.test(urlStr);
}

const COSMETIC_ADBLOCK_CSS = [
  'ins.adsbygoogle',
  '[id^="google_ads"]',
  '[id*="div-gpt-ad"]',
  '[class*="adsbygoogle"]',
  'iframe[src*="doubleclick"]',
  'iframe[src*="googlesyndication"]',
  'iframe[src*="taboola"]',
  'iframe[src*="outbrain"]',
  'iframe[src*="mgid"]',
  '[id*="taboola"]',
  '[class*="taboola"]',
  '[id*="outbrain"]',
  '[class*="outbrain"]',
  '[id*="mgid"]',
  '.ad-banner',
  '.ad-container',
  '.ad-wrapper',
  '.sponsored-ad',
  '.advertisement',
  '[aria-label="Advertisement"]',
].join(', ') + ' { display: none !important; visibility: hidden !important; height: 0 !important; min-height: 0 !important; pointer-events: none !important; }';

export class LiveBrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private wss: WebSocketServer | null = null;
  private frameTimer: NodeJS.Timeout | null = null;
  private agentAbort = false;
  private lastFrameBase64 = '';
  private tatkalManualOverride: boolean | null = null;

  private status: LiveBrowserStatus = {
    active: false,
    url: 'about:blank',
    title: 'SarthiAI Live Desktop Browser',
    loading: false,
    adBlockEnabled: true,
    blockedAdsCount: 0,
    tatkalMode: false,
    tatkalStage: 'idle',
    viewportWidth: DESKTOP_WIDTH,
    viewportHeight: DESKTOP_HEIGHT,
    agentRunning: false,
    agentStatus: 'Idle',
    waitingForHuman: false,
    humanPrompt: null,
    blockedReason: null,
    filledCount: 0,
    requestedDocuments: [],
    missingFields: [],
    formAnalysis: null,
    lastStepLogs: [],
  };

  attachWebSocketServer(wss: WebSocketServer) {
    this.wss = wss;
    wss.on('connection', (ws: WebSocket) => {
      this.sendJson(ws, { type: 'status', status: this.status });
      if (this.lastFrameBase64) {
        this.sendJson(ws, { type: 'frame', image: this.lastFrameBase64 });
      }
      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as {
            type?: string;
            x?: number;
            y?: number;
            text?: string;
            key?: string;
            deltaY?: number;
            url?: string;
          };
          if (msg.type === 'click' && typeof msg.x === 'number' && typeof msg.y === 'number') {
            await this.clickAt(msg.x, msg.y);
          } else if (msg.type === 'type' && typeof msg.text === 'string') {
            await this.typeText(msg.text);
          } else if (msg.type === 'key' && typeof msg.key === 'string') {
            await this.pressKey(msg.key);
          } else if (msg.type === 'scroll' && typeof msg.deltaY === 'number') {
            await this.scrollBy(msg.deltaY);
          } else if (msg.type === 'navigate' && typeof msg.url === 'string') {
            await this.navigate(msg.url);
          }
        } catch {
          // ignore malformed client input
        }
      });
    });
  }

  private sendJson(ws: WebSocket, payload: unknown) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
    }
  }

  private broadcastStatus() {
    if (!this.wss) return;
    const msg = JSON.stringify({ type: 'status', status: this.status });
    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(msg);
    });
  }

  private broadcastFrame(base64: string) {
    this.lastFrameBase64 = base64;
    if (!this.wss) return;
    const msg = JSON.stringify({ type: 'frame', image: base64 });
    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(msg);
    });
  }

  getStatus(): LiveBrowserStatus {
    return { ...this.status };
  }

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    if (!this.browser || !this.browser.isConnected()) {
      try {
        const executablePath = findChromiumExecutable();
        this.browser = await chromium.launch({
          headless: true,
          ...(executablePath ? { executablePath } : {}),
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--disable-ipc-flooding-protection',
            `--window-size=${this.status.viewportWidth},${this.status.viewportHeight}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--ignore-certificate-errors',
          ],
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Cloud Chromium browser launch nahi ho saka (${msg.split('\n')[0]}). Aap "Open in Phone / Native App" button se seedha phone browser me portal khol sakte hain.`
        );
      }
    }

    if (!this.context) {
      this.context = await this.browser.newContext({
        viewport: { width: this.status.viewportWidth, height: this.status.viewportHeight },
        deviceScaleFactor: 1,
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        extraHTTPHeaders: {
          'Accept-Language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7,hi;q=0.6',
          'sec-ch-ua': '"Chromium";v="133", "Not(A:Brand";v="99", "Google Chrome";v="133"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
        },
        ignoreHTTPSErrors: true,
      });

      await this.context.addInitScript(() => {
        try {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'languages', { get: () => ['en-IN', 'en-US', 'en', 'hi'] });
          Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
          if (!navigator.hardwareConcurrency || navigator.hardwareConcurrency < 4) {
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
          }
          const navAny = navigator as unknown as { deviceMemory?: number };
          if (!navAny.deviceMemory) {
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
          }
          const winAny = window as unknown as Record<string, unknown>;
          if (!winAny.chrome) {
            winAny.chrome = {
              runtime: {},
              app: { isInstalled: false },
              csi: () => ({}),
              loadTimes: () => ({}),
            };
          }
          if (!navigator.plugins || navigator.plugins.length === 0) {
            const fakePlugins = [
              { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
              { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
              { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            ];
            Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins });
          }
          if (window.outerWidth === 0) {
            Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth || 1366 });
            Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight || 820 });
          }
          if (navigator.permissions && typeof navigator.permissions.query === 'function') {
            const origQuery = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = (desc: PermissionDescriptor) => {
              if (desc && desc.name === 'notifications') {
                return Promise.resolve({ state: 'denied', onchange: null } as unknown as PermissionStatus);
              }
              return origQuery(desc);
            };
          }
          // Silence annoying notification permission popups on sarkari/news sites
          if (typeof Notification !== 'undefined') {
            Object.defineProperty(Notification, 'permission', { get: () => 'denied' });
            Notification.requestPermission = () => Promise.resolve('denied');
          }
          // Block synthetic popunder/ad windows while preserving legitimate user target=_blank links
          const origOpen = window.open;
          window.open = function (url?: string | URL, target?: string, features?: string) {
            const u = String(url || '').toLowerCase();
            if (!u || u === 'about:blank' || /doubleclick|adsterra|popads|propeller|popcash|taboola|outbrain|mgid/.test(u)) {
              return null;
            }
            return origOpen.call(window, url, target, features);
          };
        } catch {
          // ignore
        }
      });

      await this.context.route('**/*', async (route) => {
        const req = route.request();
        const reqUrl = req.url();
        if (this.status.adBlockEnabled && isAdUrl(reqUrl)) {
          this.status.blockedAdsCount += 1;
          this.broadcastStatus();
          await route.abort();
          return;
        }
        // Tatkal Turbo filter: drop heavy decorative fonts/media/video, chatbots (AskDisha/Corover), & promo banners while preserving ALL core APIs, scripts, CSS, and CAPTCHA images
        if (this.status.tatkalMode) {
          const rtype = req.resourceType();
          const lower = reqUrl.toLowerCase();
          if (rtype === 'media' || rtype === 'font') {
            await route.abort();
            return;
          }
          if (/askdisha|corover|chatbot|livechat|youtube\.com|vimeo\.com/.test(lower) && !/captcha|nlpcaptcha/.test(lower)) {
            await route.abort();
            return;
          }
          if (
            rtype === 'image' &&
            !/captcha|nlpcaptcha|qr|barcode/.test(lower) &&
            (/banner|promo|slider|carousel|dishav|askdisha|youtube|vimeo|irctctourism|tourism/.test(lower) ||
              (!isIrctcUrl(lower) && !lower.startsWith('data:')))
          ) {
            await route.abort();
            return;
          }
        }
        await route.continue();
      });
    }

    this.page = await this.context.newPage();
    this.attachPageListeners(this.page);

    this.status.active = true;
    this.broadcastStatus();
    this.startFrameLoop();

    return this.page;
  }

  private attachPageListeners(page: Page) {
    page.setDefaultTimeout(15000);

    page.on('popup', async (popup) => {
      try {
        await popup.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => {});
        const pUrl = popup.url();
        if (this.status.adBlockEnabled && (!pUrl || pUrl === 'about:blank' || isAdUrl(pUrl))) {
          this.status.blockedAdsCount += 1;
          this.broadcastStatus();
          await popup.close().catch(() => {});
          return;
        }
        // Legitimate Apply / Form tab opened in a new window -> follow it!
        this.page = popup;
        this.attachPageListeners(popup);
        this.status.url = popup.url();
        this.status.title = await popup.title().catch(() => popup.url());
        this.appendLog(`Opened form tab: ${this.status.title}`);
        this.broadcastStatus();
        await this.captureAndBroadcastFrame();
      } catch {
        // ignore popup race
      }
    });

    page.on('framenavigated', async (frame) => {
      if (this.page === page && frame === page.mainFrame()) {
        this.status.url = frame.url();
        this.status.title = (await page.title().catch(() => this.status.url)) || this.status.url;
        this.status.formAnalysis = null;
        this.broadcastStatus();
      }
    });

    page.on('domcontentloaded', async () => {
      if (this.page !== page || page.isClosed()) return;
      if (this.status.adBlockEnabled) {
        await page.addStyleTag({ content: COSMETIC_ADBLOCK_CSS }).catch(() => {});
      }
    });

    page.on('load', async () => {
      if (this.page !== page || page.isClosed()) return;
      if (this.status.adBlockEnabled) {
        await page.addStyleTag({ content: COSMETIC_ADBLOCK_CSS }).catch(() => {});
      }
      this.status.loading = false;
      this.status.url = page.url();
      this.status.title = await page.title().catch(() => this.status.url);
      this.broadcastStatus();
      await this.captureAndBroadcastFrame();
    });

    page.on('response', (resp) => {
      if (this.page !== page || page.isClosed()) return;
      const rUrl = resp.url();
      if (resp.status() === 403 && isIrctcUrl(rUrl) && /eticketing\/web-services|nget\/train-search/i.test(rUrl)) {
        this.agentAbort = true;
        this.status.agentRunning = false;
        this.status.tatkalStage = 'blocked';
        this.status.blockedReason =
          'IRCTC (Akamai) ne is Cloud Server IP ke API request ko 403 Access Denied diya hai — repeat retry se permanent IP block na ho isliye AI ruk gaya hai. Phone / Native App Browser button dabakar seedha apne phone IP par kholein!';
        this.appendLog('Stopped immediately on IRCTC 403 to prevent rate-limit lock.');
        this.broadcastStatus();
      }
    });
  }

  private startFrameLoop() {
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.frameTimer = setInterval(async () => {
      if (!this.page || this.page.isClosed()) return;
      if (!this.wss || this.wss.clients.size === 0) return;
      await this.captureAndBroadcastFrame();
    }, 650);
  }

  async captureAndBroadcastFrame(): Promise<string> {
    if (!this.page || this.page.isClosed()) return this.lastFrameBase64;
    try {
      const buf = await this.page.screenshot({ type: 'jpeg', quality: 82 });
      const b64 = buf.toString('base64');
      this.broadcastFrame(b64);
      return b64;
    } catch {
      return this.lastFrameBase64;
    }
  }

  async navigate(rawUrl: string): Promise<LiveBrowserStatus> {
    const page = await this.ensurePage();
    let target = rawUrl.trim();
    let isSearchQuery = false;
    let rawSearchTerm = '';
    if (!target) target = 'https://www.india.gov.in';
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      if (target.includes('.') && !target.includes(' ')) {
        target = `https://${target}`;
      } else {
        isSearchQuery = true;
        rawSearchTerm = target;
        target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
      }
    }

    // Automatically activate Tatkal Turbo Mode when navigating to IRCTC unless manually turned off
    if (isIrctcUrl(target) && this.tatkalManualOverride === null) {
      this.status.tatkalMode = true;
    }

    this.status.loading = true;
    this.status.blockedReason = null;
    this.status.missingFields = [];
    this.status.formAnalysis = null;
    this.status.url = target;
    this.broadcastStatus();

    const candidateUrls = isIrctcUrl(target)
      ? Array.from(
          new Set([
            target,
            'https://www.irctc.co.in/nget/train-search',
            'https://www.irctc.co.in/nget/',
            'https://www.irctc.co.in',
          ])
        )
      : [target];

    let navError: string | null = null;
    let httpStatus = 0;
    const maxAttempts = isIrctcUrl(target) ? 3 : 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const tryUrl = candidateUrls[Math.min(attempt - 1, candidateUrls.length - 1)];
      navError = null;
      httpStatus = 0;
      if (attempt > 1) {
        this.status.agentStatus = `Retry ${attempt}/${maxAttempts}: Connecting (${tryUrl})...`;
        this.appendLog(`Heavy traffic retry (${attempt}/${maxAttempts}) -> ${tryUrl}`);
        this.broadcastStatus();
      }
      try {
        const resp = await page.goto(tryUrl, {
          waitUntil: 'domcontentloaded',
          timeout: isIrctcUrl(tryUrl) ? 16000 : 20000,
        });
        httpStatus = resp?.status() || 0;
        await page.waitForTimeout(isIrctcUrl(tryUrl) ? 650 : 850);

        // If Google blocks Cloud IP with /sorry CAPTCHA wall, automatically fall back to clean DuckDuckGo HTML search
        if (isSearchQuery && /google\.[^/]+\/sorry/i.test(page.url())) {
          const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(rawSearchTerm)}`;
          this.appendLog('Google bot-check detected — switching to Ad-Free Web Search...');
          const ddgResp = await page.goto(ddgUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          httpStatus = ddgResp?.status() || 200;
          navError = null;
          break;
        }

        // Strict Akamai 403 block on IRCTC -> break immediately for instant Phone/Native Browser fallback
        if (httpStatus === 403) break;
        // Transient gateway errors (502/503/504) during 10-11 AM rush -> retry next URL
        if (httpStatus >= 500 && attempt < maxAttempts) {
          await page.waitForTimeout(450 * attempt);
          continue;
        }
        break;
      } catch (err) {
        navError = err instanceof Error ? err.message : 'Timeout waiting for page';
        this.appendLog(`Attempt ${attempt} note: ${navError.split('\n')[0]}`);
        if (attempt < maxAttempts && !/ERR_NAME_NOT_RESOLVED/i.test(navError)) {
          await page.waitForTimeout(400 * attempt);
          continue;
        }
      }
    }

    try {
      this.status.loading = false;
      const finalUrl = page.url();
      this.status.url = finalUrl;
      this.status.title = await page.title().catch(() => finalUrl);

      // Dismiss IRCTC/govt advisory dialogs immediately on load so controls are clickable
      await this.dismissAdvisoryPopup(page).catch(() => false);

      const bodySnippet = await page
        .evaluate(() => (document.body?.innerText || '').slice(0, 800))
        .catch(() => '');
      const lowerBody = bodySnippet.toLowerCase();

      if (finalUrl.startsWith('chrome-error://') || navError) {
        this.status.blockedReason =
          navError && navError.includes('ERR_NAME_NOT_RESOLVED')
            ? `Domain "${target}" server se resolve nahi hua — Phone Browser me kholein ya Google AI Search se official link dhoondhein.`
            : `Yeh website abhi heavy traffic ya timeout ki wajah se Cloud Server par open nahi hui (${navError ? navError.split('\n')[0] : 'network timeout'}). Retry karein ya Phone / Native App Browser me kholein.`;
      } else if (
        httpStatus === 403 ||
        /access denied|you don't have permission to access|request blocked|akamai/i.test(lowerBody)
      ) {
        this.status.blockedReason = isIrctcUrl(finalUrl)
          ? 'IRCTC (Akamai) ne is Cloud Server IP ko temporarily block (403 Access Denied) kiya hai — Tatkal time par Phone / Native App Browser button se seedha phone ke IP par kholein.'
          : 'Is website ne Cloud Server IP ko block (403 Access Denied) kiya hai — Phone / Native App Browser me yeh turant khulegi.';
      } else {
        this.status.blockedReason = null;
      }

      this.broadcastStatus();
      await this.captureAndBroadcastFrame();
    } catch {
      this.status.loading = false;
      this.broadcastStatus();
    }
    return this.getStatus();
  }

  async goBack() {
    if (!this.page || this.page.isClosed()) return;
    await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    this.status.url = this.page.url();
    this.status.title = await this.page.title().catch(() => this.status.url);
    this.broadcastStatus();
    await this.captureAndBroadcastFrame();
  }

  async reload() {
    if (!this.page || this.page.isClosed()) return;
    this.status.loading = true;
    this.broadcastStatus();
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    this.status.loading = false;
    this.status.url = this.page.url();
    this.status.title = await this.page.title().catch(() => this.status.url);
    this.broadcastStatus();
    await this.captureAndBroadcastFrame();
  }

  async clickAt(x: number, y: number) {
    const page = await this.ensurePage();
    const clampedX = Math.max(0, Math.min(this.status.viewportWidth - 1, Math.round(x)));
    const clampedY = Math.max(0, Math.min(this.status.viewportHeight - 1, Math.round(y)));
    await page.mouse.click(clampedX, clampedY).catch(() => {});
    await page.waitForTimeout(250);
    this.status.url = page.url();
    this.status.title = await page.title().catch(() => page.url());
    this.broadcastStatus();
    await this.captureAndBroadcastFrame();
  }

  async typeText(text: string) {
    const page = await this.ensurePage();
    await page.keyboard.type(text, { delay: 22 }).catch(() => {});
    await page.waitForTimeout(150);
    await this.captureAndBroadcastFrame();
  }

  async pressKey(key: string) {
    const page = await this.ensurePage();
    await page.keyboard.press(key).catch(() => {});
    await page.waitForTimeout(250);
    this.status.url = page.url();
    this.status.title = await page.title().catch(() => page.url());
    this.broadcastStatus();
    await this.captureAndBroadcastFrame();
  }

  async scrollBy(deltaY: number) {
    const page = await this.ensurePage();
    await page.mouse.wheel(0, deltaY).catch(() => {});
    await page.waitForTimeout(200);
    await this.captureAndBroadcastFrame();
  }

  async setViewportMode(mode: 'desktop' | 'mobile'): Promise<LiveBrowserStatus> {
    const width = mode === 'mobile' ? MOBILE_WIDTH : DESKTOP_WIDTH;
    const height = mode === 'mobile' ? MOBILE_HEIGHT : DESKTOP_HEIGHT;
    this.status.viewportWidth = width;
    this.status.viewportHeight = height;
    if (this.page && !this.page.isClosed()) {
      await this.page.setViewportSize({ width, height }).catch(() => {});
      await this.captureAndBroadcastFrame();
    }
    this.broadcastStatus();
    return this.getStatus();
  }

  setAdBlock(enabled: boolean): LiveBrowserStatus {
    this.status.adBlockEnabled = enabled;
    this.broadcastStatus();
    return this.getStatus();
  }

  setTatkalMode(enabled: boolean): LiveBrowserStatus {
    this.tatkalManualOverride = enabled;
    this.status.tatkalMode = enabled;
    this.appendLog(enabled ? 'Tatkal Turbo Mode ON (heavy media/fonts/ads blocked)' : 'Tatkal Turbo Mode OFF');
    this.broadcastStatus();
    return this.getStatus();
  }

  async prewarmIrctc(): Promise<LiveBrowserStatus> {
    this.tatkalManualOverride = true;
    this.status.tatkalMode = true;
    this.status.tatkalStage = 'prewarm';
    this.status.agentStatus = 'Pre-warming IRCTC Tatkal session (TLS + Cookies)...';
    this.appendLog('Pre-warming IRCTC NGET session with Tatkal Turbo Mode...');
    this.broadcastStatus();
    const st = await this.navigate('https://www.irctc.co.in/nget/train-search');
    if (!st.blockedReason) {
      this.status.tatkalStage = 'search';
      this.status.agentStatus = 'IRCTC Tatkal Session Warm & Ready! Ab Search/Login run karein.';
      this.appendLog('IRCTC session warmed, cookies live & advisory dismissed.');
      this.broadcastStatus();
    } else {
      this.status.tatkalStage = 'blocked';
      this.broadcastStatus();
    }
    return this.getStatus();
  }

  stopAgent() {
    this.agentAbort = true;
    this.status.agentRunning = false;
    this.status.agentStatus = 'Paused by user';
    this.broadcastStatus();
  }

  async wipeSession(): Promise<LiveBrowserStatus> {
    this.agentAbort = true;
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
    if (this.page && !this.page.isClosed()) {
      await this.page.close().catch(() => {});
    }
    if (this.context) {
      await this.context.close().catch(() => {});
    }
    this.page = null;
    this.context = null;
    this.lastFrameBase64 = '';
    this.tatkalManualOverride = null;
    this.status = {
      active: false,
      url: 'about:blank',
      title: 'Session Wiped (Zero-Save)',
      loading: false,
      adBlockEnabled: this.status.adBlockEnabled,
      blockedAdsCount: 0,
      tatkalMode: false,
      tatkalStage: 'idle',
      viewportWidth: this.status.viewportWidth,
      viewportHeight: this.status.viewportHeight,
      agentRunning: false,
      agentStatus: 'Idle · Zero-Save Session Cleared',
      waitingForHuman: false,
      humanPrompt: null,
      blockedReason: null,
      filledCount: 0,
      requestedDocuments: [],
      missingFields: [],
      formAnalysis: null,
      lastStepLogs: [],
    };
    this.broadcastStatus();
    return this.getStatus();
  }

  private appendLog(entry: string) {
    this.status.lastStepLogs = [...this.status.lastStepLogs.slice(-11), entry];
    this.broadcastStatus();
  }

  private getAccessibleFrames(page: Page): Frame[] {
    const main = page.mainFrame();
    const rest = page.frames().filter((f) => f !== main && !f.isDetached());
    return [main, ...rest];
  }

  private async dismissAdvisoryPopup(page: Page): Promise<boolean> {
    const frames = this.getAccessibleFrames(page);
    for (const frame of frames) {
      try {
        const hit = await frame.evaluate(() => {
          const selectors = [
            '.modal.show button.btn-close',
            '.modal.show [data-bs-dismiss="modal"]',
            '.modal.show [data-dismiss="modal"]',
            '.ui-dialog-titlebar-close',
            '[role="dialog"] button[aria-label*="close" i]',
            '[role="dialog"] button.close',
            'button.swal2-confirm',
            '.popup-close',
          ];
          const isVisibleBtn = (el: HTMLElement) => {
            const st = window.getComputedStyle(el);
            if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
            const r = el.getBoundingClientRect();
            return r.width >= 4 && r.height >= 4;
          };
          for (const sel of selectors) {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (!el || !isVisibleBtn(el)) continue;
            el.setAttribute('data-sarthi-dismiss', '1');
            return true;
          }
          // Generic small modal OK / Close / Got It button inside visible dialogs
          const dialogBtns = Array.from(
            document.querySelectorAll('[role="dialog"] button, .modal.show button, .popup button')
          ) as HTMLElement[];
          for (const btn of dialogBtns) {
            if (!isVisibleBtn(btn)) continue;
            const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
            if (/^(ok|okay|close|got it|i understand|dismiss|skip|x|×|बंद करें)$/.test(txt)) {
              btn.setAttribute('data-sarthi-dismiss', '1');
              return true;
            }
          }
          return false;
        });
        if (hit) {
          await frame.locator('[data-sarthi-dismiss="1"]').first().click({ timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(350);
          this.appendLog('Closed advisory popup modal.');
          return true;
        }
      } catch {
        // cross-origin or detached frame
      }
    }
    return false;
  }

  private async replayTrustedPlaywrightFills(
    frame: Frame,
    filledItems: Array<{ id: string; tag: string; type: string; value: string }> | undefined
  ) {
    if (!Array.isArray(filledItems) || filledItems.length === 0) return;
    for (const item of filledItems) {
      if (!item || !item.id || !item.value) continue;
      const loc = frame.locator(`[data-sarthi-id="${item.id}"]`).first();
      try {
        if ((await loc.count()) === 0) continue;
        await loc.scrollIntoViewIfNeeded({ timeout: 1200 }).catch(() => {});
        if (item.tag === 'select') {
          await loc
            .selectOption({ label: item.value }, { timeout: 1500 })
            .catch(() => loc.selectOption(item.value, { timeout: 1500 }))
            .catch(() => {});
          continue;
        }

        if (item.type === 'date') {
          await loc.click({ timeout: 1200 }).catch(() => {});
          await loc.fill(item.value, { timeout: 1500 }).catch(() => {});
          continue;
        }

        // Real browser click + trusted keyboard typing for React/Angular/NIC portals
        await loc.click({ timeout: 1500 }).catch(() => {});
        await loc.fill('', { timeout: 1000 }).catch(() => {});
        if (item.value.length <= 64) {
          await loc.pressSequentially(item.value, { delay: 10, timeout: 3500 }).catch(async () => {
            await loc.fill(item.value, { timeout: 1500 }).catch(() => {});
          });
        } else {
          await loc.fill(item.value, { timeout: 1500 }).catch(() => {});
        }
        const currentVal = await loc.inputValue({ timeout: 800 }).catch(() => item.value);
        if (!currentVal || currentVal.trim().length === 0) {
          await loc.fill(item.value, { timeout: 1500 }).catch(() => {});
        }
        await loc.dispatchEvent('change').catch(() => {});
        await loc.dispatchEvent('blur').catch(() => {});
      } catch {
        // fallback already set by SarthiFill DOM engine
      }
    }
  }

  private async collectPageSnapshot(page: Page): Promise<{
    elements: InteractiveDomElement[];
    pageTextSnippet: string;
    frames: Frame[];
  }> {
    const frames = this.getAccessibleFrames(page);
    const allElements: InteractiveDomElement[] = [];
    const textChunks: string[] = [];
    let globalIdx = 0;

    for (let fi = 0; fi < frames.length; fi++) {
      const frame = frames[fi];
      let offsetX = 0;
      let offsetY = 0;
      if (fi > 0) {
        try {
          const fe = await frame.frameElement();
          const box = await fe.boundingBox();
          if (box) {
            offsetX = box.x;
            offsetY = box.y;
          }
        } catch {
          // frame hidden or cross-origin
        }
      }

      try {
        const snap = await frame.evaluate(
          ({
            startIdx,
            frameIndex,
            ox,
            oy,
            maxTotal,
          }: {
            startIdx: number;
            frameIndex: number;
            ox: number;
            oy: number;
            maxTotal: number;
          }) => {
            const selectors =
              'input, textarea, select, button, a[href], [role="button"], [role="combobox"], mat-select, ng-select, p-dropdown, .ui-dropdown, [aria-haspopup="listbox"], [role="listbox"], .dropdown-toggle';
            const nodes = Array.from(document.querySelectorAll(selectors));
            const results: InteractiveDomElement[] = [];
            let idx = startIdx;

            for (const node of nodes) {
              const el = node as HTMLElement;
              el.removeAttribute('data-sarthi-idx');
              const rect = el.getBoundingClientRect();
              if (
                rect.width < 6 ||
                rect.height < 6 ||
                rect.bottom < 0 ||
                rect.top > window.innerHeight ||
                rect.right < 0 ||
                rect.left > window.innerWidth
              ) {
                continue;
              }
              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                continue;
              }

              const inputEl = el as HTMLInputElement;
              const id = el.getAttribute('id');
              const labelNode = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
              const labelText = (
                labelNode?.textContent ||
                el.getAttribute('aria-label') ||
                el.getAttribute('title') ||
                el.innerText ||
                ''
              )
                .trim()
                .replace(/\s+/g, ' ')
                .slice(0, 70);

              const parentBlock = el.closest('div, td, th, li, p, label, form') || el.parentElement;
              const nearbyText = (parentBlock?.textContent || '')
                .trim()
                .replace(/\s+/g, ' ')
                .slice(0, 80);

              let options: string[] | undefined;
              if (el.tagName.toLowerCase() === 'select') {
                const selectEl = el as HTMLSelectElement;
                options = Array.from(selectEl.options)
                  .map((o) => o.text.trim())
                  .filter(Boolean)
                  .slice(0, 20);
              }

              const checked =
                inputEl.type === 'checkbox' || inputEl.type === 'radio'
                  ? Boolean(inputEl.checked)
                  : undefined;

              const isCustomSelect =
                el.tagName.toLowerCase() !== 'input' &&
                el.tagName.toLowerCase() !== 'textarea' &&
                el.tagName.toLowerCase() !== 'select' &&
                el.matches('mat-select, ng-select, p-dropdown, .ui-dropdown, [role="combobox"], [aria-haspopup="listbox"], .dropdown-toggle');
              const displayValue =
                inputEl.value || (isCustomSelect ? (el.textContent || '').trim().replace(/\s+/g, ' ') : '');

              el.setAttribute('data-sarthi-idx', String(idx));

              results.push({
                index: idx++,
                frameIndex,
                tag: el.tagName.toLowerCase(),
                type: inputEl.type || (isCustomSelect ? 'custom-select' : ''),
                label: labelText,
                nearbyText,
                placeholder: (inputEl.placeholder || '').slice(0, 60),
                value: displayValue.slice(0, 50),
                checked,
                options,
                x: Math.round(ox + rect.left + rect.width / 2),
                y: Math.round(oy + rect.top + rect.height / 2),
                width: rect.width,
                height: rect.height,
              });

              if (results.length >= maxTotal) break;
            }

            const snippet = (document.body?.innerText || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 1200);

            return { elements: results, snippet, nextIdx: idx };
          },
          {
            startIdx: globalIdx,
            frameIndex: fi,
            ox: offsetX,
            oy: offsetY,
            maxTotal: Math.max(5, 70 - allElements.length),
          }
        );

        allElements.push(...snap.elements);
        globalIdx = snap.nextIdx;
        if (snap.snippet) textChunks.push(snap.snippet);
        if (allElements.length >= 70) break;
      } catch {
        // cross-origin frame skip
      }
    }

    return {
      elements: allElements,
      pageTextSnippet: textChunks.join(' | ').slice(0, 1800),
      frames,
    };
  }

  private async locateTaggedElementAcrossFrames(
    frames: Frame[],
    idx: number,
    preferredFrameIndex?: number
  ) {
    const ordered: Frame[] = [];
    if (
      typeof preferredFrameIndex === 'number' &&
      frames[preferredFrameIndex] &&
      !frames[preferredFrameIndex].isDetached()
    ) {
      ordered.push(frames[preferredFrameIndex]);
    }
    for (const f of frames) {
      if (!ordered.includes(f) && !f.isDetached()) ordered.push(f);
    }
    for (const f of ordered) {
      try {
        const loc = f.locator(`[data-sarthi-idx="${idx}"]`).first();
        if ((await loc.count()) > 0) return { frame: f, loc };
      } catch {
        // ignore
      }
    }
    return null;
  }

  private async runTatkalFastTrackLoop(params: {
    goal: string;
    profile: ProfileVault;
    ephemeralDocs?: EphemeralDocumentExtract[];
    zeroSave?: boolean;
  }): Promise<'paused' | 'done' | 'fallback_vision'> {
    const engineSource = loadFillEngineSource();
    if (!engineSource) return 'fallback_vision';

    const payload = buildServerFillPayload({
      profile: params.profile,
      ephemeralDocs: params.ephemeralDocs || [],
      zeroSave: Boolean(params.zeroSave),
      goal: params.goal,
    });

    const maxTicks = 75;
    let consecutiveStuck = 0;

    for (let tick = 1; tick <= maxTicks; tick++) {
      if (this.agentAbort || this.status.blockedReason) {
        return 'paused';
      }

      const page = await this.ensurePage();
      await this.dismissAdvisoryPopup(page).catch(() => false);

      const frames = this.getAccessibleFrames(page);
      type TatkalFastSummary = {
        state?: string;
        clicked?: string;
        note?: string;
        filled?: number;
        hasCaptcha?: boolean;
        hasOtp?: boolean;
        hasPassword?: boolean;
        hasPayment?: boolean;
        tatkalStage?: LiveBrowserStatus['tatkalStage'];
        missingFields?: MissingFormField[];
        filledItems?: Array<{ id: string; tag: string; type: string; value: string }>;
        done?: boolean;
        stuck?: unknown;
        irctcHandled?: boolean;
      };
      let bestSummary: TatkalFastSummary | null = null;
      let activeFrame: Frame = frames[0];

      for (const frame of frames) {
        try {
          await frame.evaluate((src: string) => {
            const w = window as unknown as { SarthiFill?: unknown };
            if (!w.SarthiFill) {
              // eslint-disable-next-line no-eval
              (0, eval)(src);
            }
          }, engineSource);

          const res = await frame.evaluate(
            ({ pl, isReset }: { pl: Record<string, string>; isReset: boolean }) => {
              const w = window as unknown as {
                SarthiFill: {
                  autopilot: (
                    p: Record<string, string>,
                    o?: Record<string, unknown>
                  ) => {
                    state?: string;
                    clicked?: string;
                    note?: string;
                    filled?: number;
                    hasCaptcha?: boolean;
                    hasOtp?: boolean;
                    hasPassword?: boolean;
                    hasPayment?: boolean;
                    tatkalStage?: string;
                    missingFields?: MissingFormField[];
                    filledItems?: Array<{ id: string; tag: string; type: string; value: string }>;
                    done?: boolean;
                    stuck?: unknown;
                    irctcHandled?: boolean;
                  };
                };
              };
              return w.SarthiFill.autopilot(pl, { reset: isReset, tatkalFast: true });
            },
            { pl: payload, isReset: tick === 1 }
          );

          if (res && (res.irctcHandled || res.hasCaptcha || res.hasOtp || res.hasPayment || (res.filled || 0) > 0 || res.clicked || !bestSummary)) {
            bestSummary = res as TatkalFastSummary;
            activeFrame = frame;
            if (res.irctcHandled || res.hasCaptcha || res.hasOtp || res.hasPayment) break;
          }
        } catch {
          // frame navigating or cross-origin
        }
      }

      if (!bestSummary) {
        await page.waitForTimeout(240);
        continue;
      }

      // Apply fast trusted fills ONLY when native setter values weren't already retained cleanly
      if (bestSummary.filledItems && bestSummary.filledItems.length > 0) {
        for (const item of bestSummary.filledItems) {
          if (!item?.id || !item.value) continue;
          try {
            const loc = activeFrame.locator(`[data-sarthi-id="${item.id}"]`).first();
            if ((await loc.count()) === 0) continue;
            if (item.tag === 'select') {
              const cur = await loc.inputValue({ timeout: 250 }).catch(() => '');
              if (!cur) {
                await loc.selectOption({ label: item.value }, { timeout: 700 }).catch(() => loc.selectOption(item.value, { timeout: 700 })).catch(() => {});
              }
            } else {
              const cur = await loc.inputValue({ timeout: 250 }).catch(() => '');
              if (cur !== item.value) {
                await loc.fill(item.value, { timeout: 700 }).catch(() => {});
                await loc.dispatchEvent('input').catch(() => {});
                await loc.dispatchEvent('change').catch(() => {});
              }
            }
          } catch {
            // already populated by SarthiFill DOM engine
          }
        }
      }

      this.status.url = page.url();
      this.status.title = await page.title().catch(() => this.status.url);
      if (bestSummary.tatkalStage) {
        this.status.tatkalStage = bestSummary.tatkalStage;
      }
      if (bestSummary.filled) {
        this.status.filledCount = (this.status.filledCount || 0) + bestSummary.filled;
      }
      if (bestSummary.note) {
        this.status.agentStatus = bestSummary.note;
        if (this.status.lastStepLogs[this.status.lastStepLogs.length - 1] !== bestSummary.note) {
          this.appendLog(bestSummary.note);
        }
      }

      // 1) Missing required fields (e.g. Login ID/Password or missing passenger age) -> popup immediately
      if (bestSummary.missingFields && bestSummary.missingFields.length > 0) {
        this.status.missingFields = bestSummary.missingFields;
        this.status.agentRunning = false;
        this.status.waitingForHuman = true;
        this.status.humanPrompt =
          bestSummary.note ||
          `${bestSummary.missingFields.length} detail(s) chahiye — turant enter karein taaki Tatkal fast aage badhe.`;
        this.status.agentStatus = `Details needed (${bestSummary.missingFields.length})`;
        this.broadcastStatus();
        await this.captureAndBroadcastFrame();
        return 'paused';
      }

      // 2) Human-only stage: CAPTCHA / OTP / Payment -> Pause cleanly & focus box!
      const isTransitioning = bestSummary.state === 'next' || bestSummary.state === 'waiting';
      const isSecurityHold =
        bestSummary.hasPayment ||
        bestSummary.tatkalStage === 'payment' ||
        bestSummary.state === 'user' ||
        (!isTransitioning &&
          (bestSummary.hasCaptcha ||
            bestSummary.hasOtp ||
            bestSummary.tatkalStage === 'login_captcha' ||
            bestSummary.tatkalStage === 'review_captcha'));

      if (isSecurityHold) {
        this.status.agentRunning = false;
        this.status.waitingForHuman = true;
        this.status.requestedDocuments = [];
        const stagePrompt = bestSummary.hasPayment || bestSummary.tatkalStage === 'payment'
          ? 'Payment Checkout Ready! UPI / Bank OTP complete karke Ticket Confirm karein.'
          : bestSummary.hasOtp
          ? 'OTP enter karein (niche Quick Box ya screen par) — AI Verify karke aage badhega.'
          : bestSummary.note || 'CAPTCHA screen par hai — Quick CAPTCHA Box me likh kar Enter dabayein.';
        this.status.humanPrompt = stagePrompt;
        this.status.agentStatus =
          bestSummary.hasPayment || bestSummary.tatkalStage === 'payment'
            ? 'Payment Ready (User Confirmation)'
            : bestSummary.hasOtp
            ? 'Waiting for OTP (User)'
            : 'Waiting for CAPTCHA (User)';
        this.broadcastStatus();
        await this.captureAndBroadcastFrame();
        return 'paused';
      }

      if (bestSummary.done) {
        this.status.agentRunning = false;
        this.status.waitingForHuman = false;
        this.status.agentStatus = 'Booking flow completed — verify confirmation!';
        this.broadcastStatus();
        await this.captureAndBroadcastFrame();
        return 'done';
      }

      if (bestSummary.stuck) {
        consecutiveStuck += 1;
        if (consecutiveStuck >= 2 && isGeminiConfigured()) {
          this.appendLog('Tatkal fast-track encountered unfamiliar dialog — switching to 1-step AI Vision check...');
          return 'fallback_vision';
        }
      } else {
        consecutiveStuck = 0;
      }

      this.broadcastStatus();
      if (tick % 3 === 1 || bestSummary.clicked || bestSummary.state === 'next') {
        await this.captureAndBroadcastFrame();
      }
      await page.waitForTimeout(bestSummary.state === 'waiting' ? 520 : 210);
    }

    return 'paused';
  }

  async submitHumanInputAndResume(params: {
    text: string;
    pressEnter?: boolean;
    clickAction?: boolean;
    goal: string;
    profile: ProfileVault;
    ephemeralDocs?: EphemeralDocumentExtract[];
    zeroSave?: boolean;
  }): Promise<LiveBrowserStatus> {
    const page = await this.ensurePage();
    const val = String(params.text || '').trim();

    if (val) {
      const frames = this.getAccessibleFrames(page);
      let typed = false;
      for (const frame of frames) {
        try {
          const hit = await frame.evaluate(() => {
            const els = Array.from(document.querySelectorAll('input, textarea')) as HTMLInputElement[];
            let otp: HTMLInputElement | null = null;
            let cap: HTMLInputElement | null = null;
            for (const el of els) {
              if (el.disabled) continue;
              const st = window.getComputedStyle(el);
              if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
              const r = el.getBoundingClientRect();
              if (r.width <= 12 || r.height <= 12) continue;
              const hint = `${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
              if (!otp && /\botp\b|one time|mpin/.test(hint)) otp = el;
              if (!cap && /captcha|security code|verification code/.test(hint)) cap = el;
            }
            const target = otp || cap || (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') ? (document.activeElement as HTMLInputElement) : null);
            if (!target) return false;
            target.setAttribute('data-sarthi-human-target', '1');
            return true;
          });
          if (hit) {
            const loc = frame.locator('[data-sarthi-human-target="1"]').first();
            await loc.click({ timeout: 1000 }).catch(() => {});
            await loc.fill('', { timeout: 600 }).catch(() => {});
            await loc.pressSequentially(val, { delay: 16, timeout: 2500 }).catch(async () => {
              await loc.fill(val, { timeout: 800 }).catch(() => {});
            });
            await frame.evaluate(() => {
              document.querySelectorAll('[data-sarthi-human-target="1"]').forEach((n) => n.removeAttribute('data-sarthi-human-target'));
            }).catch(() => {});
            typed = true;
            break;
          }
        } catch {
          // try next frame
        }
      }
      if (!typed) {
        await page.keyboard.type(val, { delay: 16 }).catch(() => {});
      }
    }

    if (params.clickAction !== false) {
      // Safe non-payment submit/continue click (SIGN IN / VERIFY / CONTINUE — strictly blocks Pay Now / Checkout!)
      const frames = this.getAccessibleFrames(page);
      for (const frame of frames) {
        try {
          const btnHit = await frame.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a[role="button"]')) as HTMLElement[];
            document.querySelectorAll('[data-sarthi-safe-submit]').forEach((n) => n.removeAttribute('data-sarthi-safe-submit'));
            const noPayRe = /pay now|make payment|proceed to pay|pay & book|pay and book|confirm booking|checkout|final submit/i;
            const okRe = /^(sign ?in|login|log in|verify( otp)?|submit|continue|proceed|next)$/i;
            for (const b of btns) {
              if ((b as HTMLButtonElement).disabled) continue;
              const st = window.getComputedStyle(b);
              if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
              const r = b.getBoundingClientRect();
              if (r.width <= 12 || r.height <= 12) continue;
              const txt = (b.innerText || (b as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim();
              if (!txt || noPayRe.test(txt)) continue;
              if (okRe.test(txt)) {
                b.setAttribute('data-sarthi-safe-submit', '1');
                return txt;
              }
            }
            return null;
          });
          if (btnHit) {
            await frame.locator('[data-sarthi-safe-submit="1"]').first().click({ timeout: 1500 }).catch(() => {});
            await frame.evaluate(() => {
              document.querySelectorAll('[data-sarthi-safe-submit]').forEach((n) => n.removeAttribute('data-sarthi-safe-submit'));
            }).catch(() => {});
            this.appendLog(`CAPTCHA/OTP submitted (${btnHit}) — Resuming Fast-Track AI...`);
            break;
          }
        } catch {
          // ignore
        }
      }
    } else if (params.pressEnter) {
      await page.keyboard.press('Enter').catch(() => {});
    }

    this.status.waitingForHuman = false;
    this.status.humanPrompt = null;
    await page.waitForTimeout(450);
    await this.captureAndBroadcastFrame();

    if (this.status.tatkalStage !== 'payment') {
      void this.startAgentLoop({
        goal: params.goal || 'Complete IRCTC Tatkal Fast-Track booking and stop at CAPTCHA/OTP/Payment.',
        profile: params.profile,
        ephemeralDocs: params.ephemeralDocs,
        zeroSave: params.zeroSave,
      });
    }

    return this.getStatus();
  }

  async startAgentLoop(params: {
    goal: string;
    startUrl?: string;
    profile: ProfileVault;
    ephemeralDocs?: EphemeralDocumentExtract[];
    zeroSave?: boolean;
  }) {
    if (this.status.agentRunning) {
      return;
    }

    this.agentAbort = false;
    this.status.agentRunning = true;
    this.status.waitingForHuman = false;
    this.status.humanPrompt = null;
    this.status.requestedDocuments = [];
    this.status.agentStatus = 'Starting Sarthi Fast-Track Copilot...';
    this.status.lastStepLogs = [`Goal: ${params.goal}`];
    this.broadcastStatus();

    try {
      const page = await this.ensurePage();
      if (params.startUrl && params.startUrl.trim()) {
        await this.navigate(params.startUrl.trim());
      } else if (page.url() === 'about:blank') {
        await this.captureAndBroadcastFrame();
      }

      if (this.status.blockedReason) {
        this.status.agentRunning = false;
        this.status.tatkalStage = 'blocked';
        this.status.agentStatus = 'Portal Cloud IP blocked — Open in Phone / Native App Browser.';
        this.appendLog(this.status.blockedReason);
        this.broadcastStatus();
        return;
      }

      await this.dismissAdvisoryPopup(page);

      // TATKAL EXPRESS FAST-TRACK: Zero-LLM-delay sub-second deterministic automation on IRCTC / Tatkal Turbo Mode!
      if (isIrctcUrl(page.url()) || this.status.tatkalMode) {
        this.status.agentStatus = 'Tatkal Fast-Track Active (Sub-Second Execution)...';
        this.appendLog('Tatkal Express Fast-Track engaged (zero Vision-LLM latency).');
        this.broadcastStatus();
        const fastOutcome = await this.runTatkalFastTrackLoop(params);
        if (fastOutcome !== 'fallback_vision') {
          return;
        }
      }

      const maxSteps = 35;
      for (let step = 1; step <= maxSteps; step++) {
        if (this.agentAbort) break;

        this.status.agentStatus = `Step ${step}/${maxSteps}: Inspecting website & OCR screen...`;
        this.broadcastStatus();

        const screenshotB64 = await this.captureAndBroadcastFrame();
        const { elements, pageTextSnippet, frames } = await this.collectPageSnapshot(page);
        const currentUrl = page.url();
        const pageTitle = await page.title().catch(() => currentUrl);

        const decision = await decideLiveBrowserStep({
          screenshotBase64: screenshotB64,
          currentUrl,
          pageTitle,
          pageTextSnippet,
          goal: params.goal,
          interactiveElements: elements,
          profile: params.profile,
          ephemeralDocs: params.ephemeralDocs,
          stepHistory: this.status.lastStepLogs,
        });

        if (this.agentAbort) break;

        this.appendLog(`Step ${step}: [${decision.action}] ${decision.reason}`);

        if (decision.action === 'navigate' && decision.value) {
          await this.navigate(decision.value);
          if (this.status.blockedReason) {
            this.status.agentRunning = false;
            this.status.agentStatus = 'Portal Cloud IP blocked — Open in Phone / Native App Browser.';
            this.broadcastStatus();
            return;
          }
        } else if (decision.action === 'click') {
          let clicked = false;
          if (typeof decision.elementIndex === 'number') {
            const matchedEl = elements.find((e) => e.index === decision.elementIndex);
            const target = await this.locateTaggedElementAcrossFrames(
              frames,
              decision.elementIndex,
              matchedEl?.frameIndex
            );
            if (target) {
              try {
                await target.loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
                await target.loc.click({ timeout: 3000 });
                clicked = true;
              } catch {
                await target.loc.click({ force: true, timeout: 2500 }).then(() => {
                  clicked = true;
                }).catch(() => {});
              }
            }
          }
          if (!clicked && typeof decision.x === 'number' && typeof decision.y === 'number') {
            await this.clickAt(decision.x, decision.y);
          } else {
            await page.waitForTimeout(700);
            this.status.url = this.page?.url() || page.url();
            this.status.title = (await this.page?.title().catch(() => this.status.url)) || this.status.url;
            this.broadcastStatus();
            await this.captureAndBroadcastFrame();
          }
        } else if (decision.action === 'fill' && typeof decision.value === 'string') {
          let filled = false;
          if (typeof decision.elementIndex === 'number') {
            const matchedEl = elements.find((e) => e.index === decision.elementIndex);
            const target = await this.locateTaggedElementAcrossFrames(
              frames,
              decision.elementIndex,
              matchedEl?.frameIndex
            );
            if (target) {
              try {
                await target.loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
                await target.loc.click({ timeout: 2000 });
                await target.loc.fill('', { timeout: 1000 }).catch(() => {});
                await target.loc.pressSequentially(decision.value, { delay: 12, timeout: 3500 });
                filled = true;
              } catch {
                await target.loc.fill(decision.value, { timeout: 2000 }).then(() => {
                  filled = true;
                }).catch(() => {});
              }
            }
          }
          if (!filled && typeof decision.x === 'number' && typeof decision.y === 'number') {
            await page.mouse.click(Math.round(decision.x), Math.round(decision.y));
            await page.keyboard.press('Control+A').catch(() => {});
            await page.keyboard.press('Backspace').catch(() => {});
            await page.keyboard.type(decision.value, { delay: 18 });
          }
          await page.waitForTimeout(280);
          await this.captureAndBroadcastFrame();
        } else if (decision.action === 'select' && decision.value) {
          let selected = false;
          const wanted = decision.value.trim();
          const selectCustomOption = async (): Promise<boolean> => {
            await page.waitForTimeout(450);
            const optSel =
              '[role="option"], mat-option, .ng-option, .p-dropdown-item, .ui-dropdown-item, .p-autocomplete-item, .ui-autocomplete-list-item, .dropdown-item, .cdk-overlay-container li, .ui-autocomplete-items li, .select2-results__option, ul[role="listbox"] li';
            const optMatch = await page.evaluate(
              ({ sel, want }: { sel: string; want: string }) => {
                const w = want.toLowerCase().trim();
                const items = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
                const visible = items.filter((el) => {
                  const st = window.getComputedStyle(el);
                  const r = el.getBoundingClientRect();
                  return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 4 && r.height > 4;
                });
                const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
                let best = visible.find((el) => norm(el.innerText || el.textContent || '') === w);
                if (!best) {
                  best = visible.find((el) => {
                    const t = norm(el.innerText || el.textContent || '');
                    return t && (t.includes(w) || (t.length >= 3 && w.includes(t)));
                  });
                }
                if (!best) return null;
                best.scrollIntoView({ block: 'nearest' });
                const r = best.getBoundingClientRect();
                best.click();
                return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
              },
              { sel: optSel, want: wanted }
            );
            if (optMatch) return true;
            return false;
          };

          if (typeof decision.elementIndex === 'number') {
            const matchedEl = elements.find((e) => e.index === decision.elementIndex);
            const target = await this.locateTaggedElementAcrossFrames(
              frames,
              decision.elementIndex,
              matchedEl?.frameIndex
            );
            if (target) {
              const isNativeSelect = matchedEl?.tag === 'select';
              if (isNativeSelect) {
                try {
                  await target.loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
                  await target.loc
                    .selectOption({ label: wanted }, { timeout: 2500 })
                    .catch(() => target.loc.selectOption(wanted, { timeout: 2500 }));
                  selected = true;
                } catch {
                  selected = false;
                }
              } else {
                // Custom dropdown (mat-select, ng-select, p-dropdown, div "Select", etc.)
                try {
                  await target.loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
                  await target.loc.click({ timeout: 2500 });
                  selected = await selectCustomOption();
                } catch {
                  selected = false;
                }
              }
            }
          }
          if (!selected && typeof decision.x === 'number' && typeof decision.y === 'number') {
            await page.mouse.click(Math.round(decision.x), Math.round(decision.y));
            selected = await selectCustomOption();
            if (!selected) {
              await page.keyboard.type(wanted, { delay: 20 });
              await page.keyboard.press('Enter').catch(() => {});
            }
          }
          await page.waitForTimeout(350);
          await this.captureAndBroadcastFrame();
        } else if (decision.action === 'press_key' && decision.value) {
          await this.pressKey(decision.value);
        } else if (decision.action === 'scroll') {
          await this.scrollBy(decision.value === 'up' ? -450 : 450);
        } else if (decision.action === 'request_documents') {
          this.status.agentRunning = false;
          this.status.waitingForHuman = true;
          this.status.requestedDocuments = (decision.neededDocuments || []).map((d, i) => ({
            id: `req-${Date.now()}-${i}`,
            name: d.name,
            reason: d.reason,
          }));
          this.status.humanPrompt =
            decision.humanPrompt ||
            decision.reason ||
            'Is website par form bharne ke liye niche diye gaye documents upload karein — OCR se details nikal kar AI form fill karega.';
          this.status.agentStatus = 'Waiting for required documents (OCR + AI)';
          this.broadcastStatus();
          return;
        } else if (decision.action === 'pause_for_human') {
          // Run instant rule fill as well so any remaining missing fields surface in AI Popup
          await this.runInstantRuleAndAiFill({
            profile: params.profile,
            ephemeralDocs: params.ephemeralDocs || [],
            zeroSave: Boolean(params.zeroSave),
            goal: params.goal,
            autoApply: false,
          });
          this.status.agentRunning = false;
          this.status.waitingForHuman = true;
          this.status.requestedDocuments = [];
          this.status.humanPrompt =
            decision.humanPrompt ||
            decision.reason ||
            this.status.humanPrompt ||
            'Live screen par CAPTCHA / OTP / final verification enter karein, phir Resume AI dabayein.';
          this.status.agentStatus = 'Paused for your CAPTCHA / OTP / Confirmation';
          this.broadcastStatus();
          return;
        } else if (decision.action === 'done') {
          await this.runInstantRuleAndAiFill({
            profile: params.profile,
            ephemeralDocs: params.ephemeralDocs || [],
            zeroSave: Boolean(params.zeroSave),
            goal: params.goal,
            autoApply: false,
          });
          return;
        }

        await page.waitForTimeout(800);
      }

      this.status.agentRunning = false;
      this.status.agentStatus =
        'Step limit reached — aap live screen par directly check ya Resume kar sakte hain.';
      this.broadcastStatus();
    } catch (err) {
      const formatted = formatGeminiError(err);
      this.appendLog(`AI Copilot note: ${formatted.message} — Running smart Apply + Auto-Fill engine...`);
      await this.runInstantRuleAndAiFill({
        profile: params.profile,
        ephemeralDocs: params.ephemeralDocs || [],
        zeroSave: Boolean(params.zeroSave),
        goal: params.goal,
        autoApply: true,
      });
    }
  }

  private async countPersonalFormControls(page: Page): Promise<{
    totalFillable: number;
    personalCount: number;
  }> {
    let totalFillable = 0;
    let personalCount = 0;
    const frames = this.getAccessibleFrames(page);
    for (const frame of frames) {
      try {
        const res = await frame.evaluate(() => {
          const els = Array.from(document.querySelectorAll('input, select, textarea'));
          let total = 0;
          let personal = 0;
          for (const node of els) {
            const el = node as HTMLInputElement;
            const type = (el.type || el.tagName).toLowerCase();
            if (/^(hidden|submit|button|reset|image|file|search|range|color)$/.test(type)) continue;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) continue;
            const id = el.getAttribute('id');
            const lb = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || '' : '';
            const hint = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${lb}`.toLowerCase();
            if (/\b(search|query|newsletter|subscribe|track|pnr)\b|खोज/.test(hint)) continue;
            total++;
            if (
              /\b(full\s*name|first\s*name|applicant|candidate|father|mother|dob|birth|aadhaar|aadhar|pan|passport|licence|license|address|village|ward|district|state|rajya|pincode|pin\s*code|mobile|phone|email|gender|category|caste|roll\s*no|board|university)\b/.test(
                hint
              )
            ) {
              personal++;
            }
          }
          return { total, personal };
        });
        totalFillable += res.total;
        personalCount += res.personal;
      } catch {
        // ignore cross-origin frame
      }
    }
    return { totalFillable, personalCount };
  }

  private async scanAndClickApplyInFrames(page: Page, minScore: number): Promise<string | null> {
    const frames = this.getAccessibleFrames(page);
    let bestFrame: Frame | null = null;
    let bestScore = minScore - 1;
    let bestLabel = '';

    for (const frame of frames) {
      try {
        const candidate = await frame.evaluate((threshold: number) => {
          const nodes = Array.from(
            document.querySelectorAll(
              'a[href], button, input[type="button"], input[type="submit"], [role="button"], .btn'
            )
          );
          let bestIdx = -1;
          let topScore = threshold - 1;
          let topLabel = '';

          nodes.forEach((node) => {
            const el = node as HTMLElement;
            el.removeAttribute('data-sarthi-apply');
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
            const rect = el.getBoundingClientRect();
            if (rect.width < 16 || rect.height < 14) return;

            const inputEl = el as HTMLInputElement;
            const rawText = (
              el.innerText ||
              el.textContent ||
              inputEl.value ||
              el.getAttribute('aria-label') ||
              el.getAttribute('title') ||
              ''
            )
              .replace(/\s+/g, ' ')
              .trim();
            if (!rawText || rawText.length > 95) return;

            const lower = rawText.toLowerCase();
            const href = ((el as HTMLAnchorElement).href || '').toLowerCase();

            if (
              /\b(pdf|notification|syllabus|admit card|result|privacy|terms|cookie|logout|sign out|cancel|reset|back|download brochure)\b/.test(
                lower
              )
            ) {
              return;
            }
            if (href.endsWith('.pdf')) return;

            let score = 0;
            if (
              /click here to apply|apply online|apply now|online application|new pan|apply for|ऑनलाइन आवेदन|आवेदन करें/.test(
                lower
              )
            ) {
              score = 100;
            } else if (
              /one time registration|\botr\b|new registration|fresh registration|register.*apply|form 49a|fill form|proceed to apply|start application|get started/.test(
                lower
              )
            ) {
              score = 92;
            } else if (/\bapply\b/.test(lower)) {
              score = 84;
            } else if (/registration|register now|proceed|next step|save & next|continue/.test(lower)) {
              score = 68;
            }

            if (score > topScore) {
              topScore = score;
              topLabel = rawText;
              nodes.forEach((n) => (n as HTMLElement).removeAttribute('data-sarthi-apply'));
              el.setAttribute('data-sarthi-apply', '1');
              bestIdx = 1;
            }
          });

          return bestIdx > 0 ? { label: topLabel, score: topScore } : null;
        }, minScore);

        if (candidate && candidate.score > bestScore) {
          bestScore = candidate.score;
          bestLabel = candidate.label;
          bestFrame = frame;
        }
      } catch {
        // ignore cross-origin frame
      }
    }

    if (!bestFrame || !bestLabel) return null;

    const loc = bestFrame.locator('[data-sarthi-apply="1"]').first();
    await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    let clicked = false;
    await loc
      .click({ timeout: 4500 })
      .then(() => {
        clicked = true;
      })
      .catch(() => {});
    if (!clicked) {
      await loc
        .click({ force: true, timeout: 3000 })
        .then(() => {
          clicked = true;
        })
        .catch(() => {});
    }
    if (!clicked) return null;

    await page.waitForTimeout(1400);
    await this.page?.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => {});
    if (this.page) {
      await Promise.all(
        this.page
          .frames()
          .map((f) => f.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {}))
      );
    }
    this.status.url = this.page?.url() || this.status.url;
    this.status.title = (await this.page?.title().catch(() => this.status.url)) || this.status.url;
    this.broadcastStatus();
    await this.captureAndBroadcastFrame();
    return bestLabel;
  }

  private async findAndClickApplyButton(page: Page, minScore = 68): Promise<string | null> {
    try {
      const firstHit = await this.scanAndClickApplyInFrames(page, minScore);
      if (firstHit) return firstHit;

      // Some govt portals keep "Apply Online" slightly below the hero banner — scroll once and re-check
      await page.mouse.wheel(0, 420).catch(() => {});
      await page.waitForTimeout(450);
      const secondHit = await this.scanAndClickApplyInFrames(page, minScore);
      if (!secondHit) {
        await page.mouse.wheel(0, -420).catch(() => {});
      }
      return secondHit;
    } catch {
      return null;
    }
  }

  async autoClickApplyAndFill(params: {
    profile: ProfileVault;
    ephemeralDocs: EphemeralDocumentExtract[];
    zeroSave: boolean;
    goal?: string;
    startUrl?: string;
  }): Promise<LiveBrowserStatus> {
    return this.runInstantRuleAndAiFill({
      ...params,
      autoApply: true,
    });
  }

  async runInstantRuleAndAiFill(params: {
    profile: ProfileVault;
    ephemeralDocs: EphemeralDocumentExtract[];
    zeroSave: boolean;
    goal?: string;
    startUrl?: string;
    autoApply?: boolean;
  }): Promise<LiveBrowserStatus> {
    const engineSource = loadFillEngineSource();
    if (!engineSource) {
      throw new Error('Sarthi Fill Engine (public/sarthi-fill-engine.js) not found.');
    }

    let page = await this.ensurePage();
    if (params.startUrl && params.startUrl.trim() && page.url() === 'about:blank') {
      await this.navigate(params.startUrl.trim());
      page = await this.ensurePage();
    }

    if (this.status.blockedReason) {
      this.status.agentRunning = false;
      this.status.agentStatus = 'Portal Cloud IP blocked — Open in Phone / Native App Browser.';
      this.broadcastStatus();
      return this.getStatus();
    }

    this.status.agentRunning = true;
    this.status.missingFields = [];
    this.status.agentStatus = 'Scanning page & checking Apply/Form buttons...';
    this.broadcastStatus();

    try {
      await this.dismissAdvisoryPopup(page);

      // Step 1: If no personal application form is open yet (<2 personal fields), click Apply / Registration CTA
      if (params.autoApply !== false) {
        const { totalFillable, personalCount } = await this.countPersonalFormControls(page);
        if (personalCount < 2 && totalFillable < 8) {
          const minScore = personalCount === 0 ? 68 : 84;
          const clickedLabel = await this.findAndClickApplyButton(page, minScore);
          if (clickedLabel) {
            this.appendLog(`AI auto-clicked "${clickedLabel}" to open the form.`);
            page = await this.ensurePage();
            await this.dismissAdvisoryPopup(page);
          } else if (personalCount === 0 && isGeminiConfigured()) {
            const screenshotB64 = await this.captureAndBroadcastFrame();
            const { elements, pageTextSnippet, frames } = await this.collectPageSnapshot(page);
            const decision = await decideLiveBrowserStep({
              screenshotBase64: screenshotB64,
              currentUrl: page.url(),
              pageTitle: await page.title().catch(() => page.url()),
              pageTextSnippet,
              goal:
                params.goal ||
                'Click the Apply Online / Registration / Form link to reach the application form.',
              interactiveElements: elements,
              profile: params.profile,
              ephemeralDocs: params.ephemeralDocs,
              stepHistory: this.status.lastStepLogs,
            }).catch(() => null);
            if (decision && decision.action === 'click') {
              let clicked = false;
              if (typeof decision.elementIndex === 'number') {
                const matchedEl = elements.find((e) => e.index === decision.elementIndex);
                const target = await this.locateTaggedElementAcrossFrames(
                  frames,
                  decision.elementIndex,
                  matchedEl?.frameIndex
                );
                if (target) {
                  await target.loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
                  await target.loc
                    .click({ timeout: 3500 })
                    .then(() => {
                      clicked = true;
                    })
                    .catch(async () => {
                      await target.loc
                        .click({ force: true, timeout: 2500 })
                        .then(() => {
                          clicked = true;
                        })
                        .catch(() => {});
                    });
                }
              }
              if (!clicked && typeof decision.x === 'number' && typeof decision.y === 'number') {
                await this.clickAt(decision.x, decision.y);
              }
              await page.waitForTimeout(1300);
              page = await this.ensurePage();
              this.appendLog(`AI clicked to reach form: ${decision.reason}`);
            }
          }
        }
      }

      const payload = buildServerFillPayload({
        profile: params.profile,
        ephemeralDocs: params.ephemeralDocs,
        zeroSave: params.zeroSave,
        goal: params.goal,
      });

      this.status.agentStatus = 'Sarthi-Narad Fill Engine: Typing details into website...';
      this.broadcastStatus();

      const frames = this.getAccessibleFrames(page);
      const hasAnyData = Object.keys(payload).filter((k) => k !== 'goal').length > 0;
      const missingMap = new Map<string, MissingFormField>();
      let ruleFilledTotal = 0;
      let aiFilledTotal = 0;
      let anyCaptcha = false;
      let anyOtp = false;
      let declarationsTotal = 0;

      for (const frame of frames) {
        try {
          await frame.evaluate((src: string) => {
            const w = window as unknown as { SarthiFill?: unknown };
            if (!w.SarthiFill) {
              // eslint-disable-next-line no-eval
              (0, eval)(src);
            }
          }, engineSource);

          const summary = await frame.evaluate((pl: Record<string, string>) => {
            const w = window as unknown as {
              SarthiFill: {
                run: (
                  p: Record<string, string>,
                  o?: Record<string, unknown>
                ) => {
                  filled: number;
                  customQueued?: number;
                  hasCaptcha: boolean;
                  hasOtp: boolean;
                  declarations: number;
                  missingFields?: MissingFormField[];
                  filledItems?: Array<{ id: string; tag: string; type: string; value: string }>;
                  unmatched: (UnmatchedFormField & { rawHint?: string })[];
                };
                watch: (p: Record<string, string>) => void;
              };
            };
            const res = w.SarthiFill.run(pl, {});
            w.SarthiFill.watch(pl);
            return res;
          }, payload);

          ruleFilledTotal += summary.filled || 0;
          if (summary.hasCaptcha) anyCaptcha = true;
          if (summary.hasOtp) anyOtp = true;
          declarationsTotal += summary.declarations || 0;

          if (summary.filledItems && summary.filledItems.length > 0) {
            await this.replayTrustedPlaywrightFills(frame, summary.filledItems);
          }
          if (summary.customQueued && summary.customQueued > 0) {
            await page.waitForTimeout(Math.min(3500, summary.customQueued * 750 + 500));
          }

          const mappedIds = new Set<string>();
          if (
            hasAnyData &&
            Array.isArray(summary.unmatched) &&
            summary.unmatched.length > 0 &&
            isGeminiConfigured()
          ) {
            this.status.agentStatus = 'AI matching remaining custom form fields...';
            this.broadcastStatus();
            const pageTitle = await page.title().catch(() => '');
            const pageUrl = frame.url() || page.url();
            const mapping = await Promise.race([
              mapFormFieldsWithAI({
                fields: summary.unmatched,
                data: payload,
                pageTitle,
                pageUrl,
              }).catch(() => ({} as Record<string, string>)),
              new Promise<Record<string, string>>((resolve) => setTimeout(() => resolve({}), 9000)),
            ]);
            for (const k of Object.keys(mapping)) mappedIds.add(k);
            if (Object.keys(mapping).length > 0) {
              const applied = await frame.evaluate((m: Record<string, string>) => {
                const w = window as unknown as {
                  SarthiFill: {
                    applyMap: (map: Record<string, string>) => {
                      filled: number;
                      filledItems?: Array<{ id: string; tag: string; type: string; value: string }>;
                    };
                  };
                };
                return w.SarthiFill.applyMap(m);
              }, mapping);
              aiFilledTotal += applied.filled || 0;
              if (applied.filledItems && applied.filledItems.length > 0) {
                await this.replayTrustedPlaywrightFills(frame, applied.filledItems);
              }
            }
          }

          for (const mf of summary.missingFields || []) {
            if (mf && mf.id && !mappedIds.has(mf.id)) {
              missingMap.set(mf.id, mf);
            }
          }
          for (const uf of summary.unmatched || []) {
            if (!uf || !uf.id || mappedIds.has(uf.id) || missingMap.has(uf.id)) continue;
            const label = (uf.label || uf.placeholder || uf.name || '').trim();
            if (!label) continue;
            missingMap.set(uf.id, {
              id: uf.id,
              label,
              tag: uf.tag || 'input',
              type: uf.type || 'text',
              placeholder: uf.placeholder || '',
              options: Array.isArray(uf.options) ? uf.options : [],
            });
          }
        } catch {
          // Skip cross-origin or detached frames cleanly
        }
      }

      const missingFields = Array.from(missingMap.values()).slice(0, 18);
      const totalFilled = ruleFilledTotal + aiFilledTotal;
      this.status.filledCount = totalFilled;

      this.appendLog(
        `Instant Fill: ${ruleFilledTotal} rule + ${aiFilledTotal} AI = ${totalFilled} typed` +
          (missingFields.length > 0 ? ` · ${missingFields.length} missing details requested.` : '.')
      );

      const guards: string[] = [];
      if (anyCaptcha) guards.push('CAPTCHA');
      if (anyOtp) guards.push('OTP');
      if (declarationsTotal > 0) guards.push('Declaration checkbox');

      this.status.agentRunning = false;
      this.status.missingFields = missingFields;

      if (missingFields.length > 0) {
        this.status.waitingForHuman = true;
        this.status.humanPrompt = `${totalFilled} fields website par type ho chuke hain! ${missingFields.length} bachi hui details AI Popup me batayein.`;
        this.status.agentStatus = `${totalFilled} typed · ${missingFields.length} missing details needed`;
      } else if (guards.length > 0) {
        this.status.waitingForHuman = true;
        this.status.humanPrompt = `${totalFilled} fields auto-fill ho chuke hain! Ab screen par ${guards.join(', ')} aap khud bharein aur verify karke submit karein.`;
        this.status.agentStatus = `Auto-filled ${totalFilled} fields · Waiting for ${guards.join('/')}`;
      } else {
        this.status.waitingForHuman = false;
        this.status.humanPrompt = null;
        this.status.agentStatus = `Auto-fill complete (${totalFilled} fields typed)`;
      }

      this.broadcastStatus();
      await this.captureAndBroadcastFrame();
      return this.getStatus();
    } catch (err) {
      const formatted = formatGeminiError(err);
      this.status.agentRunning = false;
      this.status.agentStatus = formatted.message;
      this.appendLog(`Instant Fill note: ${formatted.message}`);
      this.broadcastStatus();
      return this.getStatus();
    }
  }

  async fillMissingFields(
    entries: Array<{ id: string; key?: string; label: string; value: string }>
  ): Promise<LiveBrowserStatus> {
    const page = await this.ensurePage();
    const map: Record<string, string> = {};
    const filledIds = new Set<string>();

    for (const entry of entries) {
      const id = String(entry.id || '').trim();
      const val = String(entry.value || '').trim();
      if (id && val) {
        map[id] = val;
        filledIds.add(id);
      }
    }

    if (Object.keys(map).length === 0) {
      return this.getStatus();
    }

    try {
      const frames = this.getAccessibleFrames(page);
      let totalApplied = 0;

      for (const frame of frames) {
        try {
          const applied = await frame.evaluate((m: Record<string, string>) => {
            const w = window as unknown as {
              SarthiFill?: {
                applyMap: (map: Record<string, string>) => {
                  filled: number;
                  filledItems?: Array<{ id: string; tag: string; type: string; value: string }>;
                };
              };
            };
            if (!w.SarthiFill) return { filled: 0, filledItems: [] };
            return w.SarthiFill.applyMap(m);
          }, map);

          totalApplied += applied.filled || 0;
          if (applied.filledItems && applied.filledItems.length > 0) {
            await this.replayTrustedPlaywrightFills(frame, applied.filledItems);
          }
        } catch {
          // ignore cross-origin frame
        }
      }

      const appliedCount = totalApplied || Object.keys(map).length;
      this.status.filledCount = (this.status.filledCount || 0) + appliedCount;
      const remaining = (this.status.missingFields || []).filter((f) => !filledIds.has(f.id));
      this.status.missingFields = remaining;
      this.appendLog(`AI Popup typed ${appliedCount} missing detail(s) into form.`);
      if (remaining.length === 0) {
        this.status.waitingForHuman = false;
        this.status.humanPrompt = null;
        this.status.agentStatus = `Missing details filled (${appliedCount} fields)`;
      } else {
        this.status.agentStatus = `${remaining.length} details still empty`;
      }
      this.broadcastStatus();
      await this.captureAndBroadcastFrame();
    } catch (err) {
      this.appendLog(
        `Fill missing note: ${err instanceof Error ? err.message : 'Unable to apply fields'}`
      );
    }

    return this.getStatus();
  }

  async analyzeCurrentPageForm(params: {
    profile: ProfileVault;
    ephemeralDocs: EphemeralDocumentExtract[];
    zeroSave: boolean;
  }): Promise<{ status: LiveBrowserStatus; analysis: FormPageAnalysis | null }> {
    const page = await this.ensurePage();
    const currentUrl = page.url();
    if (!currentUrl || currentUrl === 'about:blank') {
      throw new Error('Pehle koi website ya form page kholein, phir AI Form Guide chalayein.');
    }

    this.status.agentStatus = 'AI poora form aur documents analyze kar raha hai...';
    this.broadcastStatus();

    try {
      const screenshotBase64 = await this.captureAndBroadcastFrame();
      const pageTitle = await page.title().catch(() => currentUrl);
      const frames = this.getAccessibleFrames(page);

      const allElements: InteractiveDomElement[] = [];
      const textChunks: string[] = [];
      let idxCounter = 0;

      for (let fi = 0; fi < frames.length; fi++) {
        const frame = frames[fi];
        try {
          const data = await frame.evaluate(
            ({ startIdx, frameIndex }: { startIdx: number; frameIndex: number }) => {
              const controls = Array.from(
                document.querySelectorAll(
                  'input, textarea, select, button, [role="combobox"], mat-select, ng-select, p-dropdown'
                )
              );
              const results: InteractiveDomElement[] = [];
              let idx = startIdx;
              for (const node of controls) {
                const el = node as HTMLElement;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') continue;
                const rect = el.getBoundingClientRect();
                if (rect.width < 4 || rect.height < 4) continue;
                const inp = el as HTMLInputElement;
                const id = el.getAttribute('id');
                const lb = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
                const labelText = (
                  lb?.textContent ||
                  el.getAttribute('aria-label') ||
                  el.getAttribute('title') ||
                  el.innerText ||
                  ''
                )
                  .trim()
                  .replace(/\s+/g, ' ')
                  .slice(0, 80);
                const parent = el.closest('div, td, th, li, p, label, form') || el.parentElement;
                const nearbyText = (parent?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100);
                let options: string[] | undefined;
                if (el.tagName.toLowerCase() === 'select') {
                  options = Array.from((el as HTMLSelectElement).options)
                    .map((o) => o.text.trim())
                    .filter(Boolean)
                    .slice(0, 15);
                }
                results.push({
                  index: idx++,
                  frameIndex,
                  tag: el.tagName.toLowerCase(),
                  type: inp.type || '',
                  label: labelText,
                  nearbyText,
                  placeholder: (inp.placeholder || '').slice(0, 60),
                  value: (inp.value || '').slice(0, 50),
                  options,
                  x: Math.round(rect.left + rect.width / 2),
                  y: Math.round(rect.top + rect.height / 2),
                  width: rect.width,
                  height: rect.height,
                });
                if (results.length >= 65) break;
              }
              const fullText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 3200);
              return { elements: results, fullText, nextIdx: idx };
            },
            { startIdx: idxCounter, frameIndex: fi }
          );
          allElements.push(...data.elements);
          idxCounter = data.nextIdx;
          if (data.fullText) textChunks.push(data.fullText);
        } catch {
          // ignore cross-origin frame
        }
      }

      const emptyProfile: ProfileVault = {
        ...params.profile,
        fullName: params.zeroSave ? '' : params.profile.fullName,
        fatherName: params.zeroSave ? '' : params.profile.fatherName,
        motherName: params.zeroSave ? '' : params.profile.motherName,
        dob: params.zeroSave ? '' : params.profile.dob,
        gender: params.zeroSave ? '' : params.profile.gender,
        mobile: params.zeroSave ? '' : params.profile.mobile,
        email: params.zeroSave ? '' : params.profile.email,
        addressLine: params.zeroSave ? '' : params.profile.addressLine,
        district: params.zeroSave ? '' : params.profile.district,
        state: params.zeroSave ? '' : params.profile.state,
        pinCode: params.zeroSave ? '' : params.profile.pinCode,
        panNumber: params.zeroSave ? '' : params.profile.panNumber,
        aadhaarLast4: params.zeroSave ? '' : params.profile.aadhaarLast4,
        customFields: params.zeroSave ? [] : params.profile.customFields,
      };

      const analysis = await analyzeLivePageFormWithAI({
        screenshotBase64,
        currentUrl,
        pageTitle,
        pageTextSnippet: textChunks.join(' | ').slice(0, 3500),
        interactiveElements: allElements,
        profile: emptyProfile,
        ephemeralDocs: params.ephemeralDocs,
      });

      this.status.formAnalysis = analysis;
      this.status.agentStatus = `AI Form Guide Ready: ${analysis.formTitle}`;
      this.appendLog(`AI analyzed form "${analysis.formTitle}" (${analysis.requiredDocuments.length} docs listed).`);
      this.broadcastStatus();
      return { status: this.getStatus(), analysis };
    } catch (err) {
      const formatted = formatGeminiError(err);
      this.status.agentStatus = formatted.message;
      this.appendLog(`Form Analysis note: ${formatted.message}`);
      this.broadcastStatus();
      throw err;
    }
  }
}
