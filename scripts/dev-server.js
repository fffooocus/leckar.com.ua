// Small local server for static pages and Vercel-style API functions.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const api = {
  '/api/cod-checkout': require('../api/cod-checkout'),
  '/api/novapay-checkout': require('../api/novapay-checkout'),
  '/api/novapay-callback': require('../api/novapay-callback')
};
const mime = { '.html': 'text/html; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch (e) { res.writeHead(400).end(); return; }

  if (api[pathname]) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 65536) { res.writeHead(413).end(); return; }
    }
    try { req.body = body ? JSON.parse(body) : {}; }
    catch (e) { res.writeHead(400).end('Invalid JSON'); return; }
    res.status = code => { res.statusCode = code; return res; };
    res.json = data => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); };
    await api[pathname](req, res);
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  else if (pathname === '/favicon.ico') {
    res.writeHead(302, { Location: '/favicon.svg' }).end(); return;
  }
  else if (!path.extname(pathname)) pathname += '.html';
  if (!/^\/(?:favicon\.svg|[a-z0-9-]+\.(?:html|xml|txt)|img\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:jpg|jpeg|png|webp|svg|ico))$/i.test(pathname)) {
    res.writeHead(404).end(); return;
  }
  const filename = path.join(root, pathname.slice(1));
  try {
    const stat = await fs.promises.stat(filename);
    res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream',
      'Content-Length': stat.size });
    fs.createReadStream(filename).pipe(res);
  } catch (e) { res.writeHead(404).end(); }
});

const port = Number(process.env.PORT || 8765);
server.listen(port, '127.0.0.1', () => console.log('Local site: http://127.0.0.1:' + port + '/'));
