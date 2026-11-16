// Adres Bulucu sunucusu. Bağımlılık yok: yalnızca Node (18+).
// Görevi: public/ klasörünü sunmak ve API anahtarlarını tarayıcıdan gizleyerek
// apiturkiye.com, Yandex Geocoder ve (isteğe bağlı) Google Places isteklerini iletmek.
// Site herkese açık olduğu için IP başına hız sınırı ve servis başına günlük tavan uygular.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

// --- .env (yerelde); yayında ortam değişkenleri kullanılır ---
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}
const PORT = +process.env.PORT || 3900;
const KEYS = { apt: process.env.APITURKIYE_KEY || '', yandex: process.env.YANDEX_GEOCODER_KEY || '', google: process.env.GOOGLE_PLACES_KEY || '' };
// Günlük tavanlar sağlayıcı limitinin biraz altında tutulur (Yandex limiti aşılırsa erişimi kalıcı kapatıyor).
const DAILY = { apt: +process.env.APT_DAILY_MAX || 950, yandex: +process.env.YANDEX_DAILY_MAX || 900, google: +process.env.GOOGLE_DAILY_MAX || 300 };
const PER_IP_PER_MIN = +process.env.RATE_PER_MIN || 40;
const ROOT = path.join(__dirname, 'public');

// --- günlük sayaçlar (yeniden başlatmada korunması için dosyaya yazılır) ---
const usageFile = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'usage.json');
let usage = { day: '', n: {} };
try { usage = JSON.parse(fs.readFileSync(usageFile, 'utf8')); } catch { }
function spend(svc) {
  const day = new Date().toISOString().slice(0, 10); // UTC günü
  if (usage.day !== day) usage = { day, n: {} };
  if ((usage.n[svc] || 0) >= DAILY[svc]) return false;
  usage.n[svc] = (usage.n[svc] || 0) + 1;
  try { fs.mkdirSync(path.dirname(usageFile), { recursive: true }); fs.writeFileSync(usageFile, JSON.stringify(usage)); } catch { }
  return true;
}

// --- IP başına hız sınırı ---
const hits = new Map();
function allowed(ip) {
  const now = Date.now(), h = hits.get(ip);
  if (!h || now - h.t > 60000) { hits.set(ip, { t: now, n: 1 }); return true; }
  return ++h.n <= PER_IP_PER_MIN;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now - v.t > 60000) hits.delete(k); }, 60000).unref();

// --- önbellek ---
const cache = new Map();
function cacheGet(k) { const c = cache.get(k); if (c && c.exp > Date.now()) return c.body; cache.delete(k); return null; }
function cachePut(k, body, minutes) { if (cache.size > 5000) cache.clear(); cache.set(k, { exp: Date.now() + minutes * 60000, body }); }

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  res.end(body);
}
const err = (res, status, code, message) => send(res, status, JSON.stringify({ error: { code, message } }));

// Önbellek → günlük tavan → üst servis. Yalnızca 200 yanıtlar önbelleğe alınır.
async function upstream(res, svc, cacheKey, ttlMin, url, init) {
  const hit = cacheGet(cacheKey);
  if (hit) return send(res, 200, hit);
  if (!spend(svc)) return err(res, 429, 'daily_cap', 'Bu servis için günlük kullanım sınırına ulaşıldı. Yarın tekrar deneyin.');
  let r, body;
  try { r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) }); body = await r.text(); }
  catch { return err(res, 502, 'upstream_unreachable', 'Servise ulaşılamadı.'); }
  if (r.status === 200) cachePut(cacheKey, body, ttlMin);
  send(res, r.status, body);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (req.method !== 'GET') return err(res, 405, 'method_not_allowed', 'Yalnızca GET.');

    if (p.startsWith('/api/')) {
      if (p === '/api/config') return send(res, 200, JSON.stringify({ apt: !!KEYS.apt, yandex: !!KEYS.yandex, google: !!KEYS.google }));
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
      if (!allowed(ip)) return err(res, 429, 'rate_limit_exceeded', 'Çok hızlı istek gönderildi, biraz bekleyin.');

      // apiturkiye.com: /api/apt/<yol>?<sorgu> -> https://api.apiturkiye.com/v1/<yol>?<sorgu>
      if (p.startsWith('/api/apt/')) {
        if (!KEYS.apt) return err(res, 503, 'no_key', 'APITURKIYE_KEY tanımlı değil.');
        const rest = p.slice(9);
        if (!/^[A-Za-z0-9_\-/]+$/.test(rest)) return err(res, 400, 'invalid_request', 'Geçersiz yol.');
        const url = 'https://api.apiturkiye.com/v1/' + rest + u.search;
        // Liste uçları nadiren değişir: 24 saat; aramalar: 10 dakika
        return upstream(res, 'apt', url, u.search ? 10 : 1440, url, { headers: { 'X-API-Key': KEYS.apt } });
      }

      const q = (u.searchParams.get('q') || '').trim();
      if (p === '/api/yandex/search' || p === '/api/google/search') {
        if (q.length < 3 || q.length > 200) return err(res, 400, 'invalid_query', 'Sorgu 3-200 karakter olmalı.');
      }
      if (p === '/api/yandex/search') {
        if (!KEYS.yandex) return err(res, 503, 'no_key', 'YANDEX_GEOCODER_KEY tanımlı değil.');
        const url = 'https://geocode-maps.yandex.ru/v1/?' + new URLSearchParams({ apikey: KEYS.yandex, geocode: q, lang: 'tr_TR', format: 'json', results: '10', bbox: '25.6,35.8~44.9,42.2', rspn: '1' });
        return upstream(res, 'yandex', 'y:' + q.toLowerCase(), 60, url, {});
      }
      if (p === '/api/google/search') {
        if (!KEYS.google) return err(res, 503, 'no_key', 'GOOGLE_PLACES_KEY tanımlı değil.');
        return upstream(res, 'google', 'g:' + q.toLowerCase(), 60, 'https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEYS.google, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.primaryTypeDisplayName' },
          body: JSON.stringify({ textQuery: q, languageCode: 'tr', regionCode: 'TR', pageSize: 8 }),
        });
      }
      return err(res, 404, 'not_found', 'Bulunamadı.');
    }

    // statik dosyalar
    let rel; try { rel = decodeURIComponent(p === '/' ? '/index.html' : p); } catch { rel = ''; }
    const full = path.join(ROOT, rel);
    if (!rel || !full.startsWith(ROOT + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return send(res, 404, 'Bulunamadı', 'text/plain; charset=utf-8');
    send(res, 200, fs.readFileSync(full), MIME[path.extname(full).toLowerCase()] || 'application/octet-stream');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) err(res, 500, 'server_error', 'Sunucu hatası.');
  }
}).listen(PORT, () => {
  console.log(`Adres Bulucu: http://localhost:${PORT}/`);
  for (const [k, v] of Object.entries(KEYS)) if (!v) console.log(`  not: ${k} anahtarı tanımlı değil, bu kaynak kapalı.`);
});
