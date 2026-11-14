import fs from 'fs';
import path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
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
          ],
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Cloud Chromium browser launch nahi ho saka (${msg.split('\n')[0]}). Aap "External / Open Direct Form on Device" button se seedha phone/PC browser me portal khol sakte hain.`
        );
      }
    }

    if (!this.context) {
      this.context = await this.browser.newContext({
        viewport: { width: this.status.viewportWidth, height: this.status.viewportHeight },
        deviceScaleFactor: 1,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        ignoreHTTPSErrors: true,
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
    this.status.url = target;
    this.broadcastStatus();

    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 22000 });
      await page.waitForTimeout(700);
    } catch (err) {
      this.appendLog(
        `Navigation note: ${err instanceof Error ? err.message : 'Timeout waiting for page'}`
      );
    } finally {
      this.status.loading = false;
      this.status.url = page.url();
      this.status.title = await page.title().catch(() => page.url());
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

  private async collectPageSnapshot(page: Page): Promise<{
    elements: InteractiveDomElement[];
    pageTextSnippet: string;
  }> {
    try {
      return await page.evaluate(() => {
        const selectors =
          'input, textarea, select, button, a[href], [role="button"], [role="combobox"]';
        const nodes = Array.from(document.querySelectorAll(selectors));
        const results: InteractiveDomElement[] = [];
        let idx = 0;

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
            tag: el.tagName.toLowerCase(),
            type: inputEl.type || '',
            label: labelText,
            nearbyText,
            placeholder: (inputEl.placeholder || '').slice(0, 60),
            value: (inputEl.value || '').slice(0, 50),
            checked,
            options,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height,
          });

          if (results.length >= 65) break;
        }

        const pageTextSnippet = (document.body?.innerText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 1600);

        return { elements: results, pageTextSnippet };
      });
    } catch {
      return { elements: [], pageTextSnippet: '' };
    }
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

      const maxSteps = 12;
      for (let step = 1; step <= maxSteps; step++) {
        if (this.agentAbort) break;

        this.status.agentStatus = `Step ${step}/${maxSteps}: Inspecting website & OCR screen...`;
        this.broadcastStatus();

        const screenshotB64 = await this.captureAndBroadcastFrame();
        const { elements, pageTextSnippet } = await this.collectPageSnapshot(page);
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
        } else if (decision.action === 'click') {
          let clicked = false;
          if (typeof decision.elementIndex === 'number') {
            try {
              await page
                .locator(`[data-sarthi-idx="${decision.elementIndex}"]`)
                .first()
                .click({ timeout: 3000 });
              clicked = true;
            } catch {
              clicked = false;
            }
          }
          if (!clicked && typeof decision.x === 'number' && typeof decision.y === 'number') {
            await this.clickAt(decision.x, decision.y);
          } else {
            await page.waitForTimeout(500);
            this.status.url = page.url();
            this.status.title = await page.title().catch(() => page.url());
            this.broadcastStatus();
            await this.captureAndBroadcastFrame();
          }
        } else if (decision.action === 'fill' && typeof decision.value === 'string') {
          let filled = false;
          if (typeof decision.elementIndex === 'number') {
            try {
              const loc = page.locator(`[data-sarthi-idx="${decision.elementIndex}"]`).first();
              await loc.click({ timeout: 2500 });
              await loc.fill(decision.value, { timeout: 3000 });
              filled = true;
            } catch {
              filled = false;
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
            try {
              const loc = page.locator(`[data-sarthi-idx="${decision.elementIndex}"]`).first();
              await loc
                .selectOption({ label: decision.value }, { timeout: 2500 })
                .catch(() => loc.selectOption(decision.value!, { timeout: 2500 }));
              selected = true;
            } catch {
              selected = false;
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
          this.status.agentRunning = false;
          this.status.waitingForHuman = true;
          this.status.requestedDocuments = [];
          this.status.humanPrompt =
            decision.humanPrompt ||
            decision.reason ||
            'Live screen par CAPTCHA / OTP / final verification enter karein, phir Resume AI dabayein.';
          this.status.agentStatus = 'Paused for your CAPTCHA / OTP / Confirmation';
          this.broadcastStatus();
          return;
        } else if (decision.action === 'done') {
          this.status.agentRunning = false;
          this.status.waitingForHuman = false;
          this.status.humanPrompt = null;
          this.status.requestedDocuments = [];
          this.status.agentStatus = `Completed: ${decision.reason}`;
          this.broadcastStatus();
          return;
        }

        await page.waitForTimeout(900);
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

  private async countFillableControls(page: Page): Promise<number> {
    try {
      return await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('input, select, textarea'));
        let count = 0;
        for (const node of els) {
          const el = node as HTMLInputElement;
          const type = (el.type || el.tagName).toLowerCase();
          if (/^(hidden|submit|button|reset|image|file|search|range|color)$/.test(type)) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 10 || rect.height < 10) continue;
          const hint = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
          if (/\bsearch\b|\bquery\b|खोज/.test(hint)) continue;
          count++;
        }
        return count;
      });
    } catch {
      return 0;
    }
  }

  private async findAndClickApplyButton(page: Page, minScore = 68): Promise<string | null> {
    try {
      const candidate = await page.evaluate((threshold: number) => {
        const nodes = Array.from(
          document.querySelectorAll('a[href], button, input[type="button"], input[type="submit"], [role="button"]')
        );
        let bestIdx = -1;
        let bestScore = threshold - 1;
        let bestLabel = '';

        nodes.forEach((node) => {
          const el = node as HTMLElement;
          el.removeAttribute('data-sarthi-apply');
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
          const rect = el.getBoundingClientRect();
          if (rect.width < 16 || rect.height < 14) return;

          const inputEl = el as HTMLInputElement;
          const rawText = (el.innerText || el.textContent || inputEl.value || el.getAttribute('aria-label') || el.getAttribute('title') || '')
            .replace(/\s+/g, ' ')
            .trim();
          if (!rawText || rawText.length > 90) return;

          const lower = rawText.toLowerCase();
          const href = ((el as HTMLAnchorElement).href || '').toLowerCase();

          // Never click noise / PDF notices / external ads / logout
          if (/\b(pdf|notification|syllabus|admit card|result|privacy|terms|cookie|logout|sign out|cancel|reset|back)\b/.test(lower)) {
            return;
          }
          if (href.endsWith('.pdf')) return;

          let score = 0;
          if (/click here to apply|apply online|apply now|online application|ऑनलाइन आवेदन|आवेदन करें/.test(lower)) {
            score = 100;
          } else if (/one time registration|\botr\b|new registration|fresh registration|register.*apply|form 49a|fill form|proceed to apply|start application/.test(lower)) {
            score = 92;
          } else if (/\bapply\b/.test(lower)) {
            score = 84;
          } else if (/registration|register now|proceed|next step|save & next|continue/.test(lower)) {
            score = 68;
          }

          if (score > bestScore) {
            bestScore = score;
            bestLabel = rawText;
            nodes.forEach((n) => (n as HTMLElement).removeAttribute('data-sarthi-apply'));
            el.setAttribute('data-sarthi-apply', '1');
            bestIdx = 1;
          }
        });

        return bestIdx > 0 ? { label: bestLabel, score: bestScore } : null;
      }, minScore);

      if (!candidate) return null;

      const loc = page.locator('[data-sarthi-apply="1"]').first();
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1400);
      await this.page?.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => {});
      this.status.url = this.page?.url() || this.status.url;
      this.status.title = (await this.page?.title().catch(() => this.status.url)) || this.status.url;
      this.broadcastStatus();
      await this.captureAndBroadcastFrame();
      return candidate.label;
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

    this.status.agentRunning = true;
    this.status.missingFields = [];
    this.status.agentStatus = 'Scanning page & checking Apply/Form buttons...';
    this.broadcastStatus();

    try {
      // Step 1: If page looks like a landing/portal page (<4 form fields), auto-click Apply / Registration CTA!
      if (params.autoApply !== false) {
        const controlCount = await this.countFillableControls(page);
        if (controlCount < 4) {
          const minScore = controlCount < 2 ? 68 : 84;
          const clickedLabel = await this.findAndClickApplyButton(page, minScore);
          if (clickedLabel) {
            this.appendLog(`AI auto-clicked "${clickedLabel}" to open the form.`);
            page = await this.ensurePage();
          } else if (controlCount < 2 && isGeminiConfigured()) {
            // Try one Gemini Vision click if DOM text didn't match obvious Apply labels
            const screenshotB64 = await this.captureAndBroadcastFrame();
            const { elements, pageTextSnippet } = await this.collectPageSnapshot(page);
            const decision = await decideLiveBrowserStep({
              screenshotBase64: screenshotB64,
              currentUrl: page.url(),
              pageTitle: await page.title().catch(() => page.url()),
              pageTextSnippet,
              goal: params.goal || 'Click the Apply Online / Registration / Form link to reach the application form.',
              interactiveElements: elements,
              profile: params.profile,
              ephemeralDocs: params.ephemeralDocs,
              stepHistory: this.status.lastStepLogs,
            }).catch(() => null);
            if (decision && decision.action === 'click') {
              let clicked = false;
              if (typeof decision.elementIndex === 'number') {
                await page.locator(`[data-sarthi-idx="${decision.elementIndex}"]`).first().click({ timeout: 3500 }).then(() => {
                  clicked = true;
                }).catch(() => {});
              }
              if (!clicked && typeof decision.x === 'number' && typeof decision.y === 'number') {
                await this.clickAt(decision.x, decision.y);
              }
              await page.waitForTimeout(1200);
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

      this.status.agentStatus = 'Sarthi-Narad Fill Engine: Filling matched fields...';
      this.broadcastStatus();

      await page.evaluate((src: string) => {
        const w = window as unknown as { SarthiFill?: unknown };
        if (!w.SarthiFill) {
          // eslint-disable-next-line no-eval
          (0, eval)(src);
        }
      }, engineSource);

      const summary = await page.evaluate((pl: Record<string, string>) => {
        const w = window as unknown as {
          SarthiFill: {
            run: (p: Record<string, string>, o?: Record<string, unknown>) => {
              filled: number;
              hasCaptcha: boolean;
              hasOtp: boolean;
              declarations: number;
              missingFields?: MissingFormField[];
              unmatched: (UnmatchedFormField & { rawHint?: string })[];
            };
            watch: (p: Record<string, string>) => void;
          };
        };
        const res = w.SarthiFill.run(pl, {});
        w.SarthiFill.watch(pl);
        return res;
      }, payload);

      let aiFilled = 0;
      const mappedIds = new Set<string>();
      const hasAnyData = Object.keys(payload).filter((k) => k !== 'goal').length > 0;

      if (hasAnyData && Array.isArray(summary.unmatched) && summary.unmatched.length > 0 && isGeminiConfigured()) {
        const pageTitle = await page.title().catch(() => '');
        const pageUrl = page.url();
        const mapping = await mapFormFieldsWithAI({
          fields: summary.unmatched,
          data: payload,
          pageTitle,
          pageUrl,
        });
        for (const k of Object.keys(mapping)) mappedIds.add(k);
        if (Object.keys(mapping).length > 0) {
          const applied = await page.evaluate((m: Record<string, string>) => {
            const w = window as unknown as {
              SarthiFill: { applyMap: (map: Record<string, string>) => { filled: number } };
            };
            return w.SarthiFill.applyMap(m);
          }, mapping);
          aiFilled = applied.filled || 0;
        }
      }

      // Collect ALL remaining empty non-security fields for AI Popup prompt
      const missingMap = new Map<string, MissingFormField>();
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
      const missingFields = Array.from(missingMap.values()).slice(0, 18);

      const totalFilled = (summary.filled || 0) + aiFilled;
      this.appendLog(
        `Instant Fill: ${summary.filled || 0} rule + ${aiFilled} AI = ${totalFilled} filled` +
          (missingFields.length > 0 ? ` · ${missingFields.length} missing details requested.` : '.')
      );

      const guards: string[] = [];
      if (summary.hasCaptcha) guards.push('CAPTCHA');
      if (summary.hasOtp) guards.push('OTP');
      if (summary.declarations > 0) guards.push('Declaration checkbox');

      this.status.agentRunning = false;
      this.status.missingFields = missingFields;

      if (missingFields.length > 0) {
        this.status.waitingForHuman = true;
        this.status.humanPrompt = `${totalFilled} fields fill ho gaye! ${missingFields.length} bachi hui details niche AI Popup me bharein — AI turant website me daal dega.`;
        this.status.agentStatus = `${totalFilled} filled · ${missingFields.length} missing details needed`;
      } else if (guards.length > 0) {
        this.status.waitingForHuman = true;
        this.status.humanPrompt = `${totalFilled} fields auto-fill ho chuke hain! Ab screen par ${guards.join(', ')} aap khud bharein aur verify karke submit karein.`;
        this.status.agentStatus = `Auto-filled ${totalFilled} fields · Waiting for ${guards.join('/')}`;
      } else {
        this.status.waitingForHuman = false;
        this.status.humanPrompt = null;
        this.status.agentStatus = `Auto-fill complete (${totalFilled} fields filled)`;
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
      const applied = await page.evaluate((m: Record<string, string>) => {
        const w = window as unknown as {
          SarthiFill?: { applyMap: (map: Record<string, string>) => { filled: number } };
        };
        if (!w.SarthiFill) return { filled: 0 };
        return w.SarthiFill.applyMap(m);
      }, map);

      const remaining = (this.status.missingFields || []).filter((f) => !filledIds.has(f.id));
      this.status.missingFields = remaining;
      this.appendLog(
        `AI Popup filled ${applied.filled || Object.keys(map).length} missing detail(s) into form.`
      );
      if (remaining.length === 0) {
        this.status.waitingForHuman = false;
        this.status.humanPrompt = null;
        this.status.agentStatus = `Missing details filled (${applied.filled || Object.keys(map).length} fields)`;
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
