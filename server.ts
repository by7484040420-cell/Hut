import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import {
  cloneAndSignApkBuffer,
  inspectRealApkBuffer,
} from './server/apkEngine.ts';
import type { ClonedApkRecord } from './src/types.ts';

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const DATA_DIR = path.resolve('data');
const UPLOAD_DIR = path.resolve('uploads');
const CLONED_DIR = path.join(UPLOAD_DIR, 'cloned');
const HISTORY_FILE = path.join(DATA_DIR, 'apk-history.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(CLONED_DIR, { recursive: true });

function loadHistory(): ClonedApkRecord[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
      if (Array.isArray(parsed)) return parsed as ClonedApkRecord[];
    }
  } catch {
    // ignore
  }
  return [];
}

function saveHistory(records: ClonedApkRecord[]) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(records, null, 2));
  } catch (err) {
    console.warn('Failed to write apk-history.json:', err);
  }
}

let history: ClonedApkRecord[] = loadHistory();

const app = express();
app.use(express.json({ limit: '10mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

const httpServer = http.createServer(app);

// ---- Real APK Inspection & Binary Cloning API ----

app.get('/api/bootstrap', (_req, res) => {
  // Only return records whose output APK file still exists on disk
  const valid = history.filter((item) => {
    const filename = path.basename(item.downloadUrl);
    return fs.existsSync(path.join(CLONED_DIR, filename));
  });
  if (valid.length !== history.length) {
    history = valid;
    saveHistory(history);
  }
  res.json({ history });
});

app.post('/api/apk/inspect', upload.single('apk'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Please select a .apk file' });
    return;
  }
  try {
    const summary = inspectRealApkBuffer(req.file.originalname, req.file.buffer);
    res.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse APK binary manifest';
    res.status(400).json({ error: message });
  }
});

app.post('/api/apk/clone', upload.single('apk'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No .apk file uploaded' });
    return;
  }

  const newPackageName = String(req.body?.newPackageName || '').trim();
  const newAppLabel = String(req.body?.newAppLabel || '').trim();
  const renameAuthorities = req.body?.renameAuthorities !== 'false';
  const renameCustomPermissions = req.body?.renameCustomPermissions !== 'false';

  try {
    const result = cloneAndSignApkBuffer(req.file.buffer, {
      newPackageName,
      newAppLabel: newAppLabel || undefined,
      renameAuthorities,
      renameCustomPermissions,
    });

    const id = `apk-${crypto.randomBytes(4).toString('hex')}`;
    const safeSlug = result.clonedPackageName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const outFileName = `${safeSlug}-${id}.apk`;
    const outPath = path.join(CLONED_DIR, outFileName);
    fs.writeFileSync(outPath, result.signedApk);

    const record: ClonedApkRecord = {
      id,
      originalFileName: req.file.originalname,
      originalPackage: result.originalManifest.packageName,
      clonedPackage: result.clonedPackageName,
      clonedLabel:
        newAppLabel ||
        result.originalManifest.appLabel ||
        result.clonedPackageName,
      versionName: result.originalManifest.versionName,
      sizeBytes: result.signedApk.length,
      downloadUrl: `/api/apk/download/${outFileName}`,
      createdAt: Date.now(),
    };

    history.unshift(record);
    if (history.length > 25) history = history.slice(0, 25);
    saveHistory(history);

    res.json({ record, history });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'APK cloning failed';
    res.status(400).json({ error: message });
  }
});

app.get('/api/apk/download/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename);
  const fullPath = path.join(CLONED_DIR, safeName);
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: 'Cloned APK file not found' });
    return;
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.sendFile(fullPath);
});

app.delete('/api/apk/history/:id', (req, res) => {
  const idx = history.findIndex((h) => h.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }
  const [removed] = history.splice(idx, 1);
  const safeName = path.basename(removed.downloadUrl);
  const fullPath = path.join(CLONED_DIR, safeName);
  fs.unlink(fullPath, () => {});
  saveHistory(history);
  res.json({ history });
});

app.get('/api/native-android/zip', (_req, res) => {
  const nativeDir = path.resolve('native-android');
  const workflowFile = path.resolve('.github/workflows/build-apk.yml');
  if (!fs.existsSync(nativeDir)) {
    res.status(404).json({ error: 'Native Android project not found' });
    return;
  }

  const zip = new AdmZip();
  zip.addLocalFolder(nativeDir, 'native-android');
  if (fs.existsSync(workflowFile)) {
    zip.addLocalFile(workflowFile, '.github/workflows');
  }
  const buf = zip.toBuffer();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="mochiclone-native-android.zip"');
  res.send(buf);
});

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
    console.log(`MochiClone APK Engine running on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
