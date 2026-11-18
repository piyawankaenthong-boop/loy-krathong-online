// Loy Krathong Online - shared server (no dependencies, Node.js 14+)
// Run:  node server.js        (optional: PORT=8080 ADMIN_KEY=secret node server.js)
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const DATA = path.join(__dirname, 'wishes.json');
// Finds the page even if the browser renamed it, e.g. "loy-krathong-online (1).html"
const PAGE = (() => {
  const exact = path.join(__dirname, 'loy-krathong-online.html');
  if (fs.existsSync(exact)) return exact;
  const alt = fs.readdirSync(__dirname).filter(f => /^loy-krathong.*\.html$/i.test(f)).sort().pop();
  return alt ? path.join(__dirname, alt) : exact;
})();
const MAX_ITEMS = 500;

let items = [];
try { items = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) {}
const persist = () => fs.writeFile(DATA, JSON.stringify(items), () => {});
const clean = (v, n) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

const hits = new Map(); // simple rate limit: 10 posts / minute / IP
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr); return arr.length > 10;
}

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end((typeof body === 'string' || Buffer.isBuffer(body)) ? body : JSON.stringify(body));
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return fs.readFile(PAGE, (e, d) => e ? send(res, 500, 'Page not found', 'text/plain') : send(res, 200, d, 'text/html; charset=utf-8'));
  }
  if (url.pathname !== '/api/wishes') return send(res, 404, { error: 'not found' });

  if (req.method === 'GET') return send(res, 200, { items: items.slice(-60) });

  if (req.method === 'POST') {
    const ip = req.socket.remoteAddress;
    if (limited(ip)) return send(res, 429, { error: 'too many requests' });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 5000) req.destroy(); });
    req.on('end', () => {
      let d; try { d = JSON.parse(body); } catch (e) { return send(res, 400, { error: 'bad json' }); }
      const show = d.m === 'wish' && d.show === true && clean(d.t, 120);
      const it = {
        id: (/^[a-z0-9]{6,24}$/.test(String(d.id)) && !items.some(x => x.id === d.id)) ? d.id : Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        k: Math.max(0, Math.min(3, parseInt(d.k, 10) || 0)),
        m: d.m === 'let' ? 'let' : 'wish',
        show: !!show,
        t: show ? clean(d.t, 120) : '',   // private text is never stored
        n: show ? clean(d.n, 30) : ''
      };
      items.push(it); if (items.length > MAX_ITEMS) items.shift(); persist();
      send(res, 201, it);
    });
    return;
  }

  if (req.method === 'DELETE') {
    if (url.searchParams.get('key') !== ADMIN_KEY) return send(res, 403, { error: 'forbidden' });
    items = []; persist(); return send(res, 200, { ok: true });
  }
  send(res, 405, { error: 'method not allowed' });
}).listen(...(/^\d+$/.test(String(PORT)) ? [PORT, '0.0.0.0'] : [PORT]), () => {
  const os = require('os');
  const ips = [];
  Object.values(os.networkInterfaces()).forEach(list => (list || []).forEach(i => {
    if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  }));
  console.log('');
  console.log('==============================================');
  console.log(' Loy Krathong server is running');
  console.log('==============================================');
  console.log(' Open on this computer :  http://localhost:' + PORT);
  console.log('');
  console.log(' LINK TO SEND TO COLLEAGUES (same office network / VPN):');
  if (ips.length) ips.forEach(ip => console.log('   http://' + ip + ':' + PORT));
  else console.log('   (no network found - connect to the office network)');
  console.log('');
  console.log(' Admin link (do NOT share):  http://localhost:' + PORT + '/?admin=' + ADMIN_KEY);
  console.log('==============================================');
  if (ADMIN_KEY === 'change-me') console.log(' Tip: set ADMIN_KEY before sharing.');
});
