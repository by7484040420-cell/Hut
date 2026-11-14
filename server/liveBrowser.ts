import fs from 'fs';
import path from 'path';
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright';
import type { WebSocket, WebSocketServer } from 'ws';
import type {
  EphemeralDocumentExtract,
  LiveBrowserStatus,
  MissingFormField,
  ProfileVault,
} from '../src/types.js';
import {
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
      ['passportNumber', p.passportNumber],
      ['dlNumber', p.dlNumber],
      ['voterId', p.voterId],
      ['preferredDepartureCity', p.preferredDepartureCity],
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
  }
  for (const doc of params.ephemeralDocs) {
    const docTypeLower = `${doc.documentType} ${doc.fileName}`.toLowerCase();
    const isTenthDoc = /10th|matric|ssc|high\s*school|class\s*x\b/.test(docTypeLower);
    const isTwelfthDoc = /12th|inter|hsc|senior\s*secondary|class\s*xii/.test(docTypeLower);
    for (const f of doc.fields) {
      const k = f.key.trim();
      const v = f.value.trim();
      if (!v) continue;
      const lower = `${k} ${f.label}`.toLowerCase();
      if (lower.includes('full_name') || lower === 'fullname' || (lower.includes('name') && !lower.includes('father') && !lower.includes('mother') && !lower.includes('school') && !lower.includes('college') && !lower.includes('board'))) {
        map.fullName = map.fullName || v;
      } else if (lower.includes('father')) map.fatherName = map.fatherName || v;
      else if (lower.includes('mother')) map.motherName = map.motherName || v;
      else if (lower.includes('dob') || (lower.includes('birth') && lower.includes('date'))) map.dob = map.dob || v;
      else if (lower.includes('birth') && lower.includes('place')) map.birthPlace = map.birthPlace || v;
      else if (lower.includes('blood')) map.bloodGroup = map.bloodGroup || v;
      else if (lower.includes('gender') || lower.includes('sex')) map.gender = map.gender || v;
      else if (lower.includes('category') || lower.includes('caste')) map.category = map.category || v;
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
  'propellerads.com',
  'adsterra.com',
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
];

function isAdUrl(urlStr: string): boolean {
  const lower = urlStr.toLowerCase();
  if (AD_HOST_PATTERNS.some((p) => lower.includes(p))) return true;
  if (lower.includes('/pagead/') || lower.includes('/adsense/') || lower.includes('fbevents.js')) {
    return true;
  }
  return false;
}

export class LiveBrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private wss: WebSocketServer | null = null;
  private frameTimer: NodeJS.Timeout | null = null;
  private agentAbort = false;
  private lastFrameBase64 = '';

  private status: LiveBrowserStatus = {
    active: false,
    url: 'about:blank',
    title: 'SarthiAI Live Desktop Browser',
    loading: false,
    adBlockEnabled: true,
    blockedAdsCount: 0,
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
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        extraHTTPHeaders: {
          'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8',
        },
        ignoreHTTPSErrors: true,
      });

      await this.context.addInitScript(() => {
        try {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'languages', { get: () => ['en-IN', 'en', 'hi'] });
        } catch {
          // ignore
        }
      });

      await this.context.route('**/*', async (route) => {
        const reqUrl = route.request().url();
        if (this.status.adBlockEnabled && isAdUrl(reqUrl)) {
          this.status.blockedAdsCount += 1;
          this.broadcastStatus();
          await route.abort();
          return;
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
        this.broadcastStatus();
      }
    });

    page.on('load', async () => {
      if (this.page !== page || page.isClosed()) return;
      if (this.status.adBlockEnabled) {
        await page
          .addStyleTag({
            content:
              'ins.adsbygoogle, [id^="google_ads"], iframe[src*="doubleclick"], .ad-banner, .sponsored-ad { display: none !important; }',
          })
          .catch(() => {});
      }
      this.status.loading = false;
      this.status.url = page.url();
      this.status.title = await page.title().catch(() => this.status.url);
      this.broadcastStatus();
      await this.captureAndBroadcastFrame();
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
    if (!target) target = 'https://www.india.gov.in';
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target =
        target.includes('.') && !target.includes(' ')
          ? `https://${target}`
          : `https://www.google.com/search?q=${encodeURIComponent(target)}`;
    }

    this.status.loading = true;
    this.status.blockedReason = null;
    this.status.missingFields = [];
    this.status.url = target;
    this.broadcastStatus();

    let navError: string | null = null;
    let httpStatus = 0;
    try {
      const resp = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 22000 });
      httpStatus = resp?.status() || 0;
      await page.waitForTimeout(900);
    } catch (err) {
      navError = err instanceof Error ? err.message : 'Timeout waiting for page';
      this.appendLog(`Navigation note: ${navError}`);
    } finally {
      this.status.loading = false;
      const finalUrl = page.url();
      this.status.url = finalUrl;
      this.status.title = await page.title().catch(() => finalUrl);

      const bodySnippet = await page
        .evaluate(() => (document.body?.innerText || '').slice(0, 600))
        .catch(() => '');
      const lowerBody = bodySnippet.toLowerCase();

      if (finalUrl.startsWith('chrome-error://') || navError) {
        this.status.blockedReason =
          navError && navError.includes('ERR_NAME_NOT_RESOLVED')
            ? `Domain "${target}" server se resolve nahi hua — Native App / Phone Browser me kholein ya AI se naya official link maangein.`
            : `Yeh website Cloud Server par open nahi ho rahi (${navError ? navError.split('\n')[0] : 'network error'}). Phone/Native App me 100% khulegi.`;
      } else if (
        httpStatus === 403 ||
        /access denied|you don't have permission to access|request blocked|cloudflare|akamai/i.test(
          lowerBody
        )
      ) {
        this.status.blockedReason =
          'Is sarkari/ticket website ne Cloud Server IP ko block (403 Access Denied) kiya hai — Phone / Native App Browser me yeh turant khulegi.';
      } else {
        this.status.blockedReason = null;
      }

      this.broadcastStatus();
      await this.captureAndBroadcastFrame();
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
    this.status = {
      active: false,
      url: 'about:blank',
      title: 'Session Wiped (Zero-Save)',
      loading: false,
      adBlockEnabled: this.status.adBlockEnabled,
      blockedAdsCount: 0,
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
              'input, textarea, select, button, a[href], [role="button"], [role="combobox"]';
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

              el.setAttribute('data-sarthi-idx', String(idx));

              results.push({
                index: idx++,
                frameIndex,
                tag: el.tagName.toLowerCase(),
                type: inputEl.type || '',
                label: labelText,
                nearbyText,
                placeholder: (inputEl.placeholder || '').slice(0, 60),
                value: (inputEl.value || '').slice(0, 50),
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

  async startAgentLoop(params: {
    goal: string;
    startUrl?: string;
    profile: ProfileVault;
    ephemeralDocs?: EphemeralDocumentExtract[];
  }) {
    if (this.status.agentRunning) {
      return;
    }

    this.agentAbort = false;
    this.status.agentRunning = true;
    this.status.waitingForHuman = false;
    this.status.humanPrompt = null;
    this.status.requestedDocuments = [];
    this.status.agentStatus = 'Starting Universal OCR + AI Vision Autopilot...';
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
        this.status.agentStatus = 'Portal Cloud IP blocked — Open in Phone / Native App Browser.';
        this.appendLog(this.status.blockedReason);
        this.broadcastStatus();
        return;
      }

      await this.dismissAdvisoryPopup(page);

      const maxSteps = 12;
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
                await target.loc
                  .selectOption({ label: decision.value }, { timeout: 2500 })
                  .catch(() => target.loc.selectOption(decision.value!, { timeout: 2500 }));
                selected = true;
              } catch {
                selected = false;
              }
            }
          }
          if (!selected && typeof decision.x === 'number' && typeof decision.y === 'number') {
            await page.mouse.click(Math.round(decision.x), Math.round(decision.y));
            await page.keyboard.type(decision.value, { delay: 20 });
            await page.keyboard.press('Enter').catch(() => {});
          }
          await page.waitForTimeout(300);
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
            zeroSave: false,
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
            zeroSave: false,
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
        zeroSave: false,
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
}
