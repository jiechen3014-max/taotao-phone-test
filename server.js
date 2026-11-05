/* ============================================================
 * 桃桃选机 · 后端
 * - 静态站点
 * - DeepSeek 单次生成（key 只在服务端）
 * - 验证码额度（默认可配 1–10 次）
 * - IP / 每日总额度限流
 * - 管理员发码接口
 * ============================================================ */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { Store, normalizeCode } = require('./lib/store.js');
const { ValidationError, validateQuizPayload, validateRequestId, isPlainObject } = require('./lib/validate.js');
const { callDeepSeek, AiError } = require('./lib/ai.js');
const Q = require('./assets/js/engine.js');
const DATA = require('./assets/js/questions.js');

/* ---------- .env ---------- */
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  text.split(/\r?\n/).forEach((line) => {
    const s = line.trim();
    if (!s || s.startsWith('#')) return;
    const m = s.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) return;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] == null) process.env[m[1]] = value;
  });
}

loadEnv(path.join(__dirname, '.env'));

const ROOT = __dirname;
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const DATA_DIR = process.env.DATA_DIR
  ? path.isAbsolute(process.env.DATA_DIR)
    ? process.env.DATA_DIR
    : path.join(ROOT, process.env.DATA_DIR)
  : path.join(ROOT, 'data');

const RATE_WINDOW_MS = Math.max(1, Number(process.env.RATE_WINDOW_MIN) || 10) * 60000;
const RATE_MAX = Math.max(1, Number(process.env.RATE_MAX) || 12);
const IP_DAILY_MAX = Math.max(1, Number(process.env.IP_DAILY_MAX) || 30);
const GLOBAL_DAILY_MAX = Math.max(1, Number(process.env.GLOBAL_DAILY_MAX) || 200);
const ADMIN_RATE_MAX = Math.max(1, Number(process.env.ADMIN_RATE_MAX) || 30);
const ADMIN_RATE_WINDOW_MS = 15 * 60000;
const MAX_BODY = 48 * 1024;
const MAX_CODES_PER_REQUEST = 50;

const store = new Store(DATA_DIR);
const serverStartedAt = Date.now();
const buckets = new Map();
const ipDaily = new Map();
const responseCache = new Map();
const CACHE_TTL_MS = 3 * 60000;

/* ---------- 小工具 ---------- */
function todayStr() {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || '')).digest('hex').slice(0, 10);
}

function getIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const first = String(xff).split(',')[0].trim();
      if (first) return first;
    }
  }
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; font-src 'self' data:; " +
      "base-uri 'none'; form-action 'self'; frame-ancestors 'self'"
  );
}

function sendJson(res, status, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  setSecurityHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (extraHeaders) {
    Object.keys(extraHeaders).forEach((k) => res.setHeader(k, extraHeaders[k]));
  }
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function sendError(res, status, code, message, extra) {
  sendJson(res, status, {
    ok: false,
    error: {
      code,
      message,
      ...(extra || {})
    }
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared && declared > limit) {
      reject(new ValidationError('请求太大了'));
      return;
    }
    const chunks = [];
    let size = 0;
    let finished = false;
    req.on('data', (chunk) => {
      if (finished) return;
      size += chunk.length;
      if (size > limit) {
        finished = true;
        reject(new ValidationError('请求太大了'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (finished) return;
      finished = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new ValidationError('请求格式不正确'));
      }
    });
    req.on('error', (err) => {
      if (!finished) {
        finished = true;
        reject(err);
      }
    });
  });
}

function hitRate(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((ts) => now - ts < windowMs);
  if (arr.length >= max) {
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - arr[0])) / 1000));
    buckets.set(key, arr);
    return { ok: false, retryAfter };
  }
  arr.push(now);
  buckets.set(key, arr);
  return { ok: true, retryAfter: 0 };
}

function hitIpDaily(ip) {
  const day = todayStr();
  const rec = ipDaily.get(ip);
  if (!rec || rec.date !== day) {
    ipDaily.set(ip, { date: day, count: 1 });
    return { ok: true, count: 1 };
  }
  if (rec.count >= IP_DAILY_MAX) {
    return { ok: false, count: rec.count };
  }
  rec.count += 1;
  return { ok: true, count: rec.count };
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl / 服务端调用；仍需要验证码
  if (PUBLIC_ORIGIN && origin === PUBLIC_ORIGIN) return true;
  const host = req.headers.host;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  if (host && origin === proto + '://' + host) return true;
  return false;
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function adminAllowed(req) {
  if (!ADMIN_TOKEN) return { ok: false, status: 503, message: '管理员密码还没配置' };
  const header = req.headers['x-admin-token'];
  const auth = req.headers.authorization || '';
  const provided = header ? String(header) : auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!provided || !safeEqual(provided, ADMIN_TOKEN)) {
    return { ok: false, status: 401, message: '管理员密码不对' };
  }
  return { ok: true };
}

function publicOrigin(req) {
  if (PUBLIC_ORIGIN) return PUBLIC_ORIGIN;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return proto + '://' + (req.headers.host || 'localhost:' + PORT);
}

function adminRate(req) {
  return hitRate('admin:' + getIp(req), ADMIN_RATE_MAX, ADMIN_RATE_WINDOW_MS);
}

/* ---------- 静态文件 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function staticPath(pathname) {
  if (pathname === '/' || pathname === '') return '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') return '/admin.html';
  return pathname;
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'METHOD_NOT_ALLOWED', '只支持 GET');
    return;
  }

  let decoded;
  try {
    decoded = decodeURIComponent(staticPath(pathname));
  } catch (err) {
    sendError(res, 400, 'BAD_PATH', '路径不合法');
    return;
  }

  if (decoded.includes('\0') || decoded.includes('..')) {
    sendError(res, 404, 'NOT_FOUND', '页面不存在');
    return;
  }

  const allowed =
    decoded === '/index.html' ||
    decoded === '/admin.html' ||
    decoded.startsWith('/assets/') ||
    decoded.startsWith('/preview/');

  if (!allowed) {
    sendError(res, 404, 'NOT_FOUND', '页面不存在');
    return;
  }

  const file = path.resolve(path.join(ROOT, decoded));
  if (!file.startsWith(path.resolve(ROOT) + path.sep)) {
    sendError(res, 404, 'NOT_FOUND', '页面不存在');
    return;
  }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      sendError(res, 404, 'NOT_FOUND', '页面不存在');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    setSecurityHeaders(res);
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    res.setHeader(
      'Cache-Control',
      decoded.endsWith('.html') ? 'no-store' : 'public, max-age=300'
    );
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- 报告清洗 ---------- */
function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, max);
}

function cleanItem(item) {
  if (!isPlainObject(item)) return null;
  const model = cleanText(item.model, 80);
  if (!model || model === '待确认机型') return null;
  const pros = (Array.isArray(item.pros) ? item.pros : [])
    .map((p) => cleanText(p, 220))
    .filter(Boolean)
    .slice(0, 5);
  const cons = (Array.isArray(item.cons) ? item.cons : [])
    .map((p) => cleanText(p, 220))
    .filter(Boolean)
    .slice(0, 4);
  return {
    model,
    config: cleanText(item.config, 60),
    price: cleanText(item.price, 30),
    pros,
    cons,
    fit: cleanText(item.fit, 260)
  };
}

function cleanReport(report) {
  if (!report || !isPlainObject(report)) return null;
  const mains = (Array.isArray(report.mains) ? report.mains : []).map(cleanItem).filter(Boolean);
  const backups = (Array.isArray(report.backups) ? report.backups : []).map(cleanItem).filter(Boolean);
  if (mains.length < 2 || backups.length < 3) return null;
  return {
    intro: cleanText(report.intro, 240),
    mains: mains.slice(0, 2),
    backups: backups.slice(0, 3),
    final: cleanText(report.final, 400),
    pitfall: cleanText(report.pitfall, 400),
    generatedAt: new Date().toISOString()
  };
}

function cacheKey(code, requestId) {
  return requestId ? code + ':' + requestId : '';
}

function cacheGet(key) {
  if (!key) return null;
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return hit.payload;
}

function cacheSet(key, payload) {
  if (!key) return;
  responseCache.set(key, { expires: Date.now() + CACHE_TTL_MS, payload });
  if (responseCache.size > 500) {
    const cutoff = Date.now();
    for (const [k, v] of responseCache) {
      if (v.expires < cutoff) responseCache.delete(k);
    }
  }
}

/* ---------- 生成接口 ---------- */
async function handleGenerate(req, res) {
  if (req.method !== 'POST') {
    sendError(res, 405, 'METHOD_NOT_ALLOWED', '只支持 POST');
    return;
  }
  if (!originAllowed(req)) {
    sendError(res, 403, 'BAD_ORIGIN', '请求来源不合法');
    return;
  }

  const ip = getIp(req);
  const rate = hitRate('generate:' + ip, RATE_MAX, RATE_WINDOW_MS);
  if (!rate.ok) {
    sendError(res, 429, 'RATE_LIMIT', '操作太频繁了，歇一会儿再试', {
      retryAfter: rate.retryAfter
    });
    return;
  }

  const daily = hitIpDaily(ip);
  if (!daily.ok) {
    sendError(res, 429, 'IP_DAILY_LIMIT', '今天这台设备的次数用完啦，明天再来');
    return;
  }

  let body;
  try {
    body = await readBody(req, MAX_BODY);
  } catch (err) {
    sendError(res, 400, 'BAD_BODY', err.message || '请求格式不正确');
    return;
  }

  const code = normalizeCode(body.code);
  if (!/^\d{8}$/.test(code)) {
    sendError(res, 400, 'CODE_FORMAT', '请输入 8 位数字验证码');
    return;
  }

  let payload;
  let requestId = '';
  try {
    requestId = validateRequestId(body.requestId);
    payload = validateQuizPayload(body);
  } catch (err) {
    if (err instanceof ValidationError) {
      sendError(res, 400, err.code, err.message);
      return;
    }
    throw err;
  }

  if (!API_KEY) {
    sendError(res, 503, 'AI_NOT_CONFIGURED', 'AI 服务还没配置，请联系店主');
    return;
  }

  const key = cacheKey(code, requestId);
  const cached = cacheGet(key);
  if (cached) {
    sendJson(res, 200, { ...cached, cached: true });
    return;
  }

  const consumed = store.consume(code);
  if (!consumed.ok) {
    const status = consumed.code === 'EXHAUSTED' ? 429 : 403;
    sendError(res, status, consumed.code, consumed.message, { remaining: 0 });
    return;
  }

  const global = store.consumeDaily(GLOBAL_DAILY_MAX);
  if (!global.ok) {
    store.refund(code);
    sendError(res, 503, 'DAILY_LIMIT', '今天全站 AI 额度用完了，明天再来吧');
    return;
  }

  const started = Date.now();
  try {
    const promptState = {
      rankOrder: payload.rankOrder,
      answers: payload.answers,
      weights: payload.calc
    };
    const prompt = Q.buildPrompt(promptState, 'api');

    const result = await callDeepSeek({
      prompt,
      apiKey: API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL,
      model: process.env.DEEPSEEK_MODEL,
      maxTokens: Number(process.env.DEEPSEEK_MAX_TOKENS) || 1800
    });

    const parsed = Q.parseAIReport(result.content);
    const report = cleanReport(parsed);
    if (!report) {
      store.refund(code);
      console.error('[generate] 格式不完整，已退还 1 次额度');
      sendError(
        res,
        502,
        'AI_FORMAT',
        'AI 这次没把 5 款机型写完整，次数已经退回，请再试一次'
      );
      return;
    }

    const response = {
      ok: true,
      report,
      remaining: consumed.remaining,
      quota: consumed.quota,
      requestId: requestId || null,
      generatedAt: report.generatedAt
    };
    cacheSet(key, response);

    console.log(
      '[generate] ok',
      'code=****' + code.slice(-4),
      'ip=' + hashIp(ip),
      'remaining=' + consumed.remaining,
      'ms=' + (Date.now() - started)
    );

    sendJson(res, 200, response);
  } catch (err) {
    store.refund(code);
    const ms = Date.now() - started;
    if (err instanceof AiError) {
      console.error('[generate] ai fail', err.code, 'ms=' + ms, 'code=****' + code.slice(-4));
      sendError(res, err.status, err.code, err.message);
      return;
    }
    console.error('[generate] unexpected', err && err.message, 'ms=' + ms);
    sendError(res, 502, 'AI_ERROR', '生成失败了，次数已经退回，请再试一次');
  }
}

/* ---------- 管理接口 ---------- */
async function handleAdmin(req, res, pathname) {
  if (!originAllowed(req)) {
    sendError(res, 403, 'BAD_ORIGIN', '请求来源不合法');
    return;
  }
  const rate = adminRate(req);
  if (!rate.ok) {
    sendError(res, 429, 'RATE_LIMIT', '管理员操作太频繁了', { retryAfter: rate.retryAfter });
    return;
  }
  const auth = adminAllowed(req);
  if (!auth.ok) {
    sendError(res, auth.status, 'ADMIN_AUTH', auth.message);
    return;
  }

  if (pathname === '/api/admin/codes' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      stats: store.stats(),
      codes: store.listCodes()
    });
    return;
  }

  if (pathname === '/api/admin/codes' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req, MAX_BODY);
    } catch (err) {
      sendError(res, 400, 'BAD_BODY', err.message || '请求格式不正确');
      return;
    }
    const count = Number(body.count) || 1;
    const quota = Number(body.quota) || store.maxQuota;
    if (!Number.isInteger(count) || count < 1 || count > MAX_CODES_PER_REQUEST) {
      sendError(res, 400, 'BAD_COUNT', '一次最多生成 50 个验证码');
      return;
    }
    if (!Number.isInteger(quota) || quota < 1 || quota > store.maxQuota) {
      sendError(res, 400, 'BAD_QUOTA', '单个验证码额度需在 1–' + store.maxQuota + ' 之间');
      return;
    }
    let codes;
    try {
      codes = store.createCodes({ count, quota, note: body.note });
    } catch (err) {
      sendError(res, 500, 'CREATE_FAILED', '生成失败，请重试');
      return;
    }
    const origin = publicOrigin(req);
    const withLinks = codes.map((c) => ({ ...c, link: origin + '/?code=' + c.code }));
    console.log('[admin] created', withLinks.length, 'quota=' + quota);
    sendJson(res, 200, { ok: true, codes: withLinks, stats: store.stats() });
    return;
  }

  if (pathname === '/api/admin/codes/disable' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req, MAX_BODY);
    } catch (err) {
      sendError(res, 400, 'BAD_BODY', err.message || '请求格式不正确');
      return;
    }
    const code = normalizeCode(body.code);
    if (!/^\d{8}$/.test(code)) {
      sendError(res, 400, 'CODE_FORMAT', '验证码格式不对');
      return;
    }
    if (!store.disable(code)) {
      sendError(res, 404, 'NOT_FOUND', '没有这个验证码');
      return;
    }
    console.log('[admin] disabled ****' + code.slice(-4));
    sendJson(res, 200, { ok: true, stats: store.stats() });
    return;
  }

  sendError(res, 404, 'NOT_FOUND', '接口不存在');
}

/* ---------- 路由 ---------- */
async function handle(req, res) {
  setSecurityHeaders(res);
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      aiConfigured: Boolean(API_KEY),
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      uptime: Math.floor((Date.now() - serverStartedAt) / 1000)
    });
    return;
  }

  if (pathname === '/api/generate') {
    await handleGenerate(req, res);
    return;
  }

  if (pathname.startsWith('/api/admin/')) {
    await handleAdmin(req, res, pathname);
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendError(res, 404, 'NOT_FOUND', '接口不存在');
    return;
  }

  serveStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('[server] unhandled', err);
    if (!res.headersSent) {
      sendError(res, 500, 'SERVER_ERROR', '服务器开小差了');
    } else {
      res.end();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log('----------------------------------------');
  console.log('桃桃选机 server');
  console.log('http://localhost:' + PORT);
  console.log('AI:', API_KEY ? 'configured' : 'NOT configured');
  console.log('admin:', ADMIN_TOKEN ? 'enabled' : 'disabled (set ADMIN_TOKEN)');
  console.log('data:', DATA_DIR);
  console.log('codes max quota:', store.maxQuota);
  console.log('rate:', RATE_MAX + ' / ' + RATE_WINDOW_MS / 60000 + 'min per IP');
  console.log('daily:', GLOBAL_DAILY_MAX, 'global /', IP_DAILY_MAX, 'per IP');
  console.log('----------------------------------------');
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));

/* 定期清理内存里的限流记录 */
setInterval(
  () => {
    const now = Date.now();
    for (const [key, arr] of buckets) {
      const alive = arr.filter((ts) => now - ts < Math.max(RATE_WINDOW_MS, ADMIN_RATE_WINDOW_MS));
      if (!alive.length) buckets.delete(key);
      else buckets.set(key, alive);
    }
    const day = todayStr();
    for (const [ip, rec] of ipDaily) {
      if (rec.date !== day) ipDaily.delete(ip);
    }
    for (const [key, hit] of responseCache) {
      if (hit.expires < now) responseCache.delete(key);
    }
  },
  10 * 60000
).unref();
