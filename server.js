/**
 * btools — Standalone HTTP & REST API Server
 * Serves Hub, Slider Mockup Studio, Ring 3D Slider Studio, and Presets REST API
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;
const BASE_DIR = __dirname;
const SLIDER_DIR = path.resolve(BASE_DIR, 'slider');
const RING_SLIDER_DIR = path.resolve(BASE_DIR, 'ring-slider');
const SLIDER_PRESETS_FILE = path.resolve(SLIDER_DIR, 'presets.json');
const RING_PRESETS_FILE = path.resolve(RING_SLIDER_DIR, 'presets.json');

// Ensure preset storage exists
function getPresets(file) {
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return [];
  }
}

function savePresets(file, list) {
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4':  'video/mp4'
};

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  let pathname = decodeURIComponent(parsed.pathname);

  // Normalize /btools prefix if proxied with /btools
  if (pathname.startsWith('/btools/')) {
    pathname = pathname.substring(7);
  } else if (pathname === '/btools') {
    pathname = '/';
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // --- REST API: Slider Presets ---
  if (pathname === '/api/slider/presets') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(getPresets(SLIDER_PRESETS_FILE)));
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const list = getPresets(SLIDER_PRESETS_FILE);
          const newPreset = {
            id: 'preset_' + Date.now(),
            name: data.name || 'Безымянный пресет',
            createdAt: new Date().toISOString(),
            config: data.config || {}
          };
          list.unshift(newPreset);
          savePresets(SLIDER_PRESETS_FILE, list);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(newPreset));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // --- REST API: Ring Slider Presets ---
  if (pathname === '/api/ring-slider/presets') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(getPresets(RING_PRESETS_FILE)));
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const list = getPresets(RING_PRESETS_FILE);
          const newPreset = {
            id: 'ring_' + Date.now(),
            name: data.name || 'Безымянный Ring пресет',
            createdAt: new Date().toISOString(),
            config: data.config || {}
          };
          list.unshift(newPreset);
          savePresets(RING_PRESETS_FILE, list);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(newPreset));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // --- Static Files Serving ---
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/slider' || pathname === '/slider/') pathname = '/slider/index.html';
  if (pathname === '/ring-slider' || pathname === '/ring-slider/') pathname = '/ring-slider/index.html';

  let filePath = path.join(BASE_DIR, pathname);

  if (!filePath.startsWith(BASE_DIR)) {
    res.writeHead(403);
    return res.end('Access Denied');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`404 Not Found: ${pathname}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 btools Ecosystem running at: http://localhost:${PORT}/`);
  console.log(`   - Hub:         http://localhost:${PORT}/`);
  console.log(`   - Ring Slider: http://localhost:${PORT}/ring-slider/`);
  console.log(`   - Strip Slider:http://localhost:${PORT}/slider/`);
  console.log(`=======================================================`);
});
