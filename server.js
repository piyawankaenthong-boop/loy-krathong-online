// Loy Krathong Online - shared server (no dependencies, Node.js 14+)
//   Public page : /        (everyone; no clear button)
//   Admin page  : /admin   (asks for ADMIN_KEY; shows the "Clear river" button)
// Run:  ADMIN_KEY=secret node server.js      (PORT is optional)
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';           // empty = admin disabled (secure by default)
const DATA = path.join(__dirname, 'wishes.json');
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
const sha = v => crypto.createHash('sha256').update(String(v)).digest();
const keyOk = k => ADMIN_KEY !== '' && crypto.timingSafeEqual(sha(k || ''), sha(ADMIN_KEY));
const clientIp = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

// Rate limits per visitor (behind a proxy every request shares one address, so use X-Forwarded-For)
const buckets = new Map();
function limited(name, ip, max) {
  const k = name + ip, now = Date.now(), arr = (buckets.get(k) || []).filter(t => now - t < 60000);
  arr.push(now); buckets.set(k, arr);
  if (buckets.size > 3000) for (const [kk, v] of buckets) if (!v.some(t => now - t < 60000)) buckets.delete(kk);
  return arr.length > max;
}

function send(res, code, body, type, extra) {
  res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {}));
  res.end((typeof body === 'string' || Buffer.isBuffer(body)) ? body : JSON.stringify(body));
}
const page = (res, extra) => fs.readFile(PAGE, (e, d) => e ? send(res, 500, 'Page not found', 'text/plain') : send(res, 200, d, 'text/html; charset=utf-8', extra));

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (p === '/' || p === '/index.html') return page(res);
  if (p === '/admin') return page(res, { 'X-Robots-Tag': 'noindex, nofollow' });

  if (p === '/api/admin/check' && req.method === 'GET') {
    if (ADMIN_KEY === '') return send(res, 503, { error: 'ADMIN_KEY not set' });
    if (limited('adm', clientIp(req), 10)) return send(res, 429, { error: 'too many attempts' });
    return keyOk(req.headers['x-admin-key']) ? send(res, 200, { ok: true }) : send(res, 403, { error: 'forbidden' });
  }

  if (p !== '/api/wishes') return send(res, 404, { error: 'not found' });

  if (req.method === 'GET') return send(res, 200, { items: items.slice(-60) });

  if (req.method === 'POST') {
    if (limited('post', clientIp(req), 10)) return send(res, 429, { error: 'too many requests' });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 5000) req.destroy(); });
    req.on('end', () => {
      let d; try { d = JSON.parse(body); } catch (e) { return send(res, 400, { error: 'bad json' }); }
      const show = d.m === 'wish' && d.show === true && clean(d.t, 120);
      const okId = /^[a-z0-9]{6,24}$/.test(String(d.id)) && !items.some(x => x.id === d.id);
      const it = {
        id: okId ? d.id : Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
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

  if (req.method === 'DELETE') {   // clear the river: admin only, key sent in a header (never in the URL)
    if (ADMIN_KEY === '') return send(res, 503, { error: 'ADMIN_KEY not set' });
    if (limited('adm', clientIp(req), 10)) return send(res, 429, { error: 'too many attempts' });
    if (!keyOk(req.headers['x-admin-key'])) return send(res, 403, { error: 'forbidden' });
    items = []; persist(); return send(res, 200, { ok: true });
  }
  send(res, 405, { error: 'method not allowed' });
}).listen(...(/^\d+$/.test(String(PORT)) ? [PORT, '0.0.0.0'] : [PORT]), () => {
  const ips = [];
  Object.values(os.networkInterfaces()).forEach(l => (l || []).forEach(i => { if (i.family === 'IPv4' && !i.internal) ips.push(i.address); }));
  console.log('==============================================');
  console.log(' Loy Krathong server is running');
  console.log('==============================================');
  console.log(' PUBLIC link (send to everyone):');
  console.log('   http://localhost:' + PORT + '/');
  ips.forEach(ip => console.log('   http://' + ip + ':' + PORT + '/   (same office network / VPN)'));
  console.log(' ADMIN link (keep private, asks for the admin key):');
  console.log('   http://localhost:' + PORT + '/admin');
  if (!ADMIN_KEY) console.log(' WARNING: ADMIN_KEY is not set, so the admin page cannot sign in.');
  console.log('==============================================');
});
