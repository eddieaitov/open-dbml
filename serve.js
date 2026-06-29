/**
 * serve.js — HTTP server для web-режима ui-db
 * Запуск: node serve.js [port]
 * Порт по умолчанию: 7924
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2], 10) || 7924;
const ROOT = __dirname;

// MIME-типы
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

function getMime(ext) {
  return MIME[ext] || 'application/octet-stream';
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    // Inject web-mode flag into index.html
    if (filePath.endsWith('index.html')) {
      const html = data.toString('utf-8')
        .replace(
          '<script src="renderer.js"></script>',
          '<script>window.__WEB_MODE__ = true;</script><script src="renderer.js"></script>'
        );
      res.writeHead(200, { 'Content-Type': getMime(ext) });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'Content-Type': getMime(ext) });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];

  // Маршруты
  if (url === '/') url = '/index.html';

  let filePath;
  if (url.startsWith('/node_modules/')) {
    filePath = path.join(ROOT, url);
  } else {
    filePath = path.join(ROOT, 'src', url);
  }

  // Security: не выходить за пределы проекта
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  serveFile(res, filePath);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🗄️  ui-db — web mode`);
  console.log(`  ─────────────────────`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Docker:  http://0.0.0.0:${PORT}\n`);
});
