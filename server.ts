import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import type {
  AppCategory,
  ApplicationDraft,
  ChatMessage,
  EphemeralDocumentExtract,
  PortalBookmark,
  ProfileVault,
  WorkspaceBootstrap,
} from './src/types.ts';
import {
  extractDocumentWithOCR,
  formatGeminiError,
  generateAutoFilledApplication,
  inspectUrlWithAI,
  isGeminiConfigured,
  runLiveAgentChat,
} from './server/geminiAgent.ts';
import { LiveBrowserController } from './server/liveBrowser.ts';

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const DATA_DIR = path.resolve('data');
const WORKSPACE_FILE = path.join(DATA_DIR, 'workspace.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

interface WorkspaceData {
  profile: ProfileVault;
  applications: ApplicationDraft[];
  chatHistory: ChatMessage[];
  bookmarks: PortalBookmark[];
}

function createEmptyProfile(): ProfileVault {
  return {
    fullName: '',
    fatherName: '',
    motherName: '',
    dob: '',
    gender: '',
    category: 'General',
    maritalStatus: 'Unmarried',
    mobile: '',
    alternateMobile: '',
    email: '',
    addressLine: '',
    villageOrWard: '',
    postOffice: '',
    policeStation: '',
    blockOrTehsil: '',
    district: '',
    state: '',
    pinCode: '',
    qualification: '',
    boardOrUniversity: '',
    passingYear: '',
    percentageOrGrade: '',
    panNumber: '',
    aadhaarLast4: '',
    passportNumber: '',
    dlNumber: '',
    voterId: '',
    preferredDepartureCity: '',
    preferredTrainClass: '3A (AC 3 Tier)',
    customFields: [],
    updatedAt: new Date().toISOString(),
  };
}

function createDefaultBookmarks(): PortalBookmark[] {
  return [
    {
      id: 'bm-ncs',
      name: 'National Career Service (Govt Jobs)',
      category: 'job',
      url: 'https://www.ncs.gov.in',
      description: 'Official Ministry of Labour & Employment job portal',
    },
    {
      id: 'bm-ssc',
      name: 'SSC Portal (Sarkari Bharti)',
      category: 'job',
      url: 'https://ssc.gov.in',
      description: 'Staff Selection Commission jobs & OTR registration',
    },
    {
      id: 'bm-ecourts',
      name: 'eCourts India Services',
      category: 'court_block',
      url: 'https://services.ecourts.gov.in',
      description: 'District & High Court case status, cause lists & orders',
    },
    {
      id: 'bm-umang',
      name: 'UMANG & Block / Citizen Services',
      category: 'court_block',
      url: 'https://web.umang.gov.in',
      description: 'Unified portal for Block, Ration, Caste/Income/Residence certificates',
    },
    {
      id: 'bm-pan',
      name: 'Protean (NSDL) PAN Portal',
      category: 'pan',
      url: 'https://www.onlineservices.nsdl.com/paam/endUserRegisterContact.html',
      description: 'New PAN Card (Form 49A) & PAN correction portal',
    },
    {
      id: 'bm-passport',
      name: 'Passport Seva (MEA India)',
      category: 'passport',
      url: 'https://www.passportindia.gov.in',
      description: 'Fresh/Re-issue Indian Passport & PSK appointment booking',
    },
    {
      id: 'bm-parivahan',
      name: 'Parivahan Sarathi (Driving License)',
      category: 'dl',
      url: 'https://sarathi.parivahan.gov.in',
      description: 'Learner License (LL), Driving License (DL) & renewal',
    },
    {
      id: 'bm-army',
      name: 'Join Indian Army (Agniveer / Officer)',
      category: 'job',
      url: 'https://joinindianarmy.nic.in',
      description: 'Official Indian Army recruitment & rally application portal',
    },
    {
      id: 'bm-irctc',
      name: 'IRCTC Train Tickets & Account',
      category: 'ticket',
      url: 'https://www.irctc.co.in',
      description: 'Official Indian Railways account registration & e-ticketing portal',
    },
    {
      id: 'bm-india',
      name: 'India.gov.in National Portal',
      category: 'general',
      url: 'https://www.india.gov.in',
      description: 'Directory of all Central & State Government online services',
    },
  ];
}

function loadWorkspace(): WorkspaceData {
  try {
    if (fs.existsSync(WORKSPACE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(WORKSPACE_FILE, 'utf-8')) as Partial<WorkspaceData>;
      return {
        profile: { ...createEmptyProfile(), ...(parsed.profile || {}) },
        applications: Array.isArray(parsed.applications) ? parsed.applications : [],
        chatHistory: Array.isArray(parsed.chatHistory) ? parsed.chatHistory : [],
        bookmarks:
          Array.isArray(parsed.bookmarks) && parsed.bookmarks.length > 0
            ? parsed.bookmarks
            : createDefaultBookmarks(),
      };
    }
  } catch (err) {
    console.warn('Failed to load workspace.json, starting fresh:', err);
  }
  return {
    profile: createEmptyProfile(),
    applications: [],
    chatHistory: [
      {
        id: 'msg-welcome',
        role: 'assistant',
        text:
          'Namaste! Main SarthiAI hoon — aapka live internet-connected AI form-filler aur web assistant. Pehle "Profile Vault" me apni basic details save kar dein, fir mujhse koi bhi kaam bolein:\n• Sarkari ya private job form bharna\n• Court, Kachahari, ya Block office ki application likhna\n• PAN Card, Passport, ya Driving License (DL) form ready karna\n• Train/Flight ticket ya Hotel options search karke booking plan banana\n• Mini Browser me kisi bhi official portal ko kholna',
        createdAt: new Date().toISOString(),
      },
    ],
    bookmarks: createDefaultBookmarks(),
  };
}

function saveWorkspace(data: WorkspaceData) {
  try {
    fs.writeFileSync(WORKSPACE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('Failed to write workspace.json:', err);
  }
}

let workspace: WorkspaceData = loadWorkspace();

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function addApplicationDraft(
  draftInput: Omit<ApplicationDraft, 'id' | 'createdAt' | 'updatedAt'>
): ApplicationDraft {
  const now = new Date().toISOString();
  const draft: ApplicationDraft = {
    ...draftInput,
    id: makeId('app'),
    createdAt: now,
    updatedAt: now,
  };
  workspace.applications.unshift(draft);
  if (workspace.applications.length > 50) {
    workspace.applications = workspace.applications.slice(0, 50);
  }
  saveWorkspace(workspace);
  return draft;
}

const app = express();
app.use(express.json({ limit: '6mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const httpServer = http.createServer(app);
const liveBrowser = new LiveBrowserController();
const wss = new WebSocketServer({ server: httpServer, path: '/ws/browser' });
liveBrowser.attachWebSocketServer(wss);

// ---- Workspace Bootstrap & Profile Vault ----

app.get('/api/bootstrap', (_req, res) => {
  const payload: WorkspaceBootstrap = {
    profile: workspace.profile,
    applications: workspace.applications,
    chatHistory: workspace.chatHistory,
    bookmarks: workspace.bookmarks,
    aiConfigured: isGeminiConfigured(),
    liveBrowserAvailable: true,
  };
  res.json(payload);
});

app.patch('/api/profile', (req, res) => {
  const incoming = (req.body || {}) as Partial<ProfileVault>;
  workspace.profile = {
    ...workspace.profile,
    ...incoming,
    customFields: Array.isArray(incoming.customFields)
      ? incoming.customFields
      : workspace.profile.customFields,
    updatedAt: new Date().toISOString(),
  };
  saveWorkspace(workspace);
  res.json({ profile: workspace.profile });
});

// ---- Ephemeral Zero-Save Document OCR + AI Extractor ----

app.post('/api/ocr/extract', uploadMemory.single('document'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Please select a document image or PDF.' });
    return;
  }
  const mimeType = req.file.mimetype || 'image/jpeg';
  const supported =
    mimeType.startsWith('image/') || mimeType === 'application/pdf';
  if (!supported) {
    res.status(400).json({ error: 'Only image (JPG/PNG/WebP) or PDF documents are supported.' });
    return;
  }

  try {
    // Processed purely from RAM buffer; never written to disk
    const extracted = await extractDocumentWithOCR({
      buffer: req.file.buffer,
      mimeType,
      fileName: req.file.originalname,
    });
    res.json({ extracted });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// ---- AI Agent Chat with Live Internet Grounding ----

app.post('/api/ai/chat', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  const zeroSave = Boolean(req.body?.zeroSave);
  const ephemeralDocs = Array.isArray(req.body?.ephemeralDocs)
    ? (req.body.ephemeralDocs as EphemeralDocumentExtract[])
    : [];

  if (!prompt) {
    res.status(400).json({ error: 'Please enter a message for SarthiAI.' });
    return;
  }

  const userMsg: ChatMessage = {
    id: makeId('msg'),
    role: 'user',
    text: prompt,
    createdAt: new Date().toISOString(),
  };

  if (!zeroSave) {
    workspace.chatHistory.push(userMsg);
  }

  try {
    let createdDraft: ApplicationDraft | undefined;
    const result = await runLiveAgentChat({
      prompt,
      profile: zeroSave ? createEmptyProfile() : workspace.profile,
      ephemeralDocs,
      recentHistory: workspace.chatHistory.slice(-6),
      onSaveDraft: (draftInput) => {
        if (zeroSave) {
          const now = new Date().toISOString();
          createdDraft = {
            ...draftInput,
            id: makeId('temp-app'),
            createdAt: now,
            updatedAt: now,
          };
          return createdDraft;
        }
        createdDraft = addApplicationDraft(draftInput);
        return createdDraft;
      },
    });

    const assistantMsg: ChatMessage = {
      id: makeId('msg'),
      role: 'assistant',
      text: result.replyText,
      sources: result.sources,
      linkedApplicationId: result.createdDraft?.id || createdDraft?.id,
      suggestedUrl: result.suggestedUrl,
      requestedDocuments: result.requestedDocuments,
      createdAt: new Date().toISOString(),
    };

    if (!zeroSave) {
      workspace.chatHistory.push(assistantMsg);
      if (workspace.chatHistory.length > 80) {
        workspace.chatHistory = workspace.chatHistory.slice(-80);
      }
      saveWorkspace(workspace);
    }

    res.json({
      message: assistantMsg,
      userMessage: userMsg,
      createdDraft: result.createdDraft || createdDraft,
      applications: workspace.applications,
      chatHistory: workspace.chatHistory,
      zeroSave,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

app.delete('/api/chat', (_req, res) => {
  workspace.chatHistory = [
    {
      id: makeId('msg'),
      role: 'assistant',
      text: 'Chat clear kar di gayi hai. Naya kaam batayein — job form, court/block application, PAN/Passport/DL, ya ticket/hotel planning!',
      createdAt: new Date().toISOString(),
    },
  ];
  saveWorkspace(workspace);
  res.json({ chatHistory: workspace.chatHistory });
});

// ---- AI Smart Auto-Fill Form Generator ----

app.post('/api/ai/autofill', async (req, res) => {
  const category = String(req.body?.category || 'custom') as AppCategory;
  const goal = String(req.body?.goal || '').trim();
  const targetUrl = String(req.body?.targetUrl || '').trim() || undefined;
  const language = (req.body?.language || 'hinglish') as 'hinglish' | 'hindi' | 'english';
  const zeroSave = Boolean(req.body?.zeroSave);
  const ephemeralDocs = Array.isArray(req.body?.ephemeralDocs)
    ? (req.body.ephemeralDocs as EphemeralDocumentExtract[])
    : [];

  if (!goal) {
    res.status(400).json({ error: 'Please describe the form or application you want AI to fill.' });
    return;
  }

  try {
    const draftInput = await generateAutoFilledApplication({
      category,
      goal,
      targetUrl,
      language,
      profile: zeroSave ? createEmptyProfile() : workspace.profile,
      ephemeralDocs,
    });
    if (zeroSave) {
      const now = new Date().toISOString();
      const draft: ApplicationDraft = {
        ...draftInput,
        id: makeId('temp-app'),
        createdAt: now,
        updatedAt: now,
      };
      res.json({ draft, applications: workspace.applications, zeroSave: true });
      return;
    }
    const draft = addApplicationDraft(draftInput);
    res.json({ draft, applications: workspace.applications, zeroSave: false });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

app.patch('/api/applications/:id', (req, res) => {
  const idx = workspace.applications.findIndex((a) => a.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Application draft not found' });
    return;
  }
  const updates = (req.body || {}) as Partial<ApplicationDraft>;
  const existing = workspace.applications[idx];
  const updated: ApplicationDraft = {
    ...existing,
    ...updates,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  workspace.applications[idx] = updated;
  saveWorkspace(workspace);
  res.json({ draft: updated, applications: workspace.applications });
});

app.delete('/api/applications/:id', (req, res) => {
  const idx = workspace.applications.findIndex((a) => a.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Application draft not found' });
    return;
  }
  workspace.applications.splice(idx, 1);
  saveWorkspace(workspace);
  res.json({ applications: workspace.applications });
});

// ---- Mini Browser Bookmarks & Live AI URL Inspector ----

app.post('/api/bookmarks', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const url = String(req.body?.url || '').trim();
  const category = (req.body?.category || 'general') as PortalBookmark['category'];
  const description = String(req.body?.description || '').trim();

  if (!name || !url.startsWith('http')) {
    res.status(400).json({ error: 'Valid bookmark name and http(s) URL required.' });
    return;
  }

  const bm: PortalBookmark = {
    id: makeId('bm'),
    name,
    url,
    category,
    description: description || 'Saved portal bookmark',
  };
  workspace.bookmarks.unshift(bm);
  saveWorkspace(workspace);
  res.json({ bookmark: bm, bookmarks: workspace.bookmarks });
});

app.delete('/api/bookmarks/:id', (req, res) => {
  workspace.bookmarks = workspace.bookmarks.filter((b) => b.id !== req.params.id);
  saveWorkspace(workspace);
  res.json({ bookmarks: workspace.bookmarks });
});

app.post('/api/browser/inspect', async (req, res) => {
  const rawUrl = String(req.body?.url || '').trim();
  if (!rawUrl) {
    res.status(400).json({ error: 'URL is required' });
    return;
  }
  const normalizedUrl =
    rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
      ? rawUrl
      : `https://${rawUrl}`;

  try {
    const inspection = await inspectUrlWithAI({
      url: normalizedUrl,
      profile: workspace.profile,
    });
    res.json(inspection);
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// ---- Real Live Chromium Browser + Ad-Blocker + OCR+AI Vision Copilot ----

app.get('/api/live-browser/status', (_req, res) => {
  res.json({ status: liveBrowser.getStatus() });
});

app.post('/api/live-browser/navigate', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) {
    res.status(400).json({ error: 'URL is required' });
    return;
  }
  const status = await liveBrowser.navigate(url);
  res.json({ status });
});

app.post('/api/live-browser/back', async (_req, res) => {
  await liveBrowser.goBack();
  res.json({ status: liveBrowser.getStatus() });
});

app.post('/api/live-browser/reload', async (_req, res) => {
  await liveBrowser.reload();
  res.json({ status: liveBrowser.getStatus() });
});

app.post('/api/live-browser/adblock', (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const status = liveBrowser.setAdBlock(enabled);
  res.json({ status });
});

app.post('/api/live-browser/agent/start', (req, res) => {
  const goal = String(req.body?.goal || '').trim();
  const startUrl = String(req.body?.startUrl || '').trim() || undefined;
  const zeroSave = Boolean(req.body?.zeroSave);
  const ephemeralDocs = Array.isArray(req.body?.ephemeralDocs)
    ? (req.body.ephemeralDocs as EphemeralDocumentExtract[])
    : [];

  if (!goal) {
    res.status(400).json({ error: 'Please tell the Live AI Copilot what task to perform.' });
    return;
  }

  void liveBrowser.startAgentLoop({
    goal,
    startUrl,
    profile: zeroSave ? createEmptyProfile() : workspace.profile,
    ephemeralDocs,
  });

  res.json({ status: liveBrowser.getStatus() });
});

app.post('/api/live-browser/agent/stop', (_req, res) => {
  liveBrowser.stopAgent();
  res.json({ status: liveBrowser.getStatus() });
});

app.post('/api/live-browser/wipe', async (_req, res) => {
  const status = await liveBrowser.wipeSession();
  res.json({ status });
});

// ---- Server Startup ----

async function start() {
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve('dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`SarthiAI Server running on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
