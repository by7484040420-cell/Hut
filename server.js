const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { PORTALS } = require('./portals-data.js');

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const RESULTS_FILE = path.join(__dirname, 'test-results.json');

function loadResults() {
  try { return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveResults(data) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2));
}

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    if (!GEMINI_API_KEY) return reject(new Error('GEMINI_API_KEY set nahi hai'));
    const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
    const req = https.request(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            resolve(text.replace(/```json|```/g, '').trim());
          } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return sendJSON(res, 200, {});

  if (req.url === '/api/portals' && req.method === 'GET') {
    const results = loadResults();
    const withResults = PORTALS.map((p) => ({ ...p, testResult: results[p.id] || null }));
    return sendJSON(res, 200, withResults);
  }

  // ---- Test result save karo: "worked" ya "blocked" ----
  if (req.url === '/api/mark-test' && req.method === 'POST') {
    const { portalId, result, note } = await readBody(req);
    const results = loadResults();
    results[portalId] = { result, note: note || '', testedAt: Date.now() };
    saveResults(results);
    return sendJSON(res, 200, { ok: true });
  }

  if (req.url === '/api/gemini-field-map' && req.method === 'POST') {
    const { fields, profileKeys } = await readBody(req);
    if (!fields || fields.length === 0) return sendJSON(res, 200, {});
    const prompt = `Yeh ek government form ke input fields hain:
${fields.map((f) => `${f.idx}: "${f.label}"`).join('\n')}

Available profile keys: ${(profileKeys || []).join(', ')}

Har field index ke liye, agar match kare, wahi key do. Match na kare toh chhod do.
SIRF JSON format: {"0": "name", "2": "dob"}`;
    try {
      const raw = await callGemini(prompt);
      return sendJSON(res, 200, JSON.parse(raw));
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  if (req.url === '/bipin-autofill.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*' });
    return fs.createReadStream(path.join(__dirname, 'public', 'bipin-autofill.js')).pipe(res);
  }

  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return fs.createReadStream(path.join(__dirname, 'public', 'index.html')).pipe(res);
  }

  // ---- Generic static file serving (public/ ke andar ki koi bhi file,
  // jaise app-shell.html) — pehle wale routes se cover nahi hui files ----
  const staticPath = path.join(__dirname, 'public', req.url);
  if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    const ext = path.extname(staticPath);
    const contentType = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    return fs.createReadStream(staticPath).pipe(res);
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => console.log(`BIPIN AI Full Test App: http://localhost:${PORT}`));
