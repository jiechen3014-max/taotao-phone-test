/* ============================================================
 * 验证码 / 额度 / 每日用量存储
 * 单进程 Node 服务使用；落盘到 data/*.json，重启不丢。
 * ============================================================ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_QUOTA = 10;

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function todayStr(now) {
  const d = now || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function atomicWrite(file, obj) {
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(3).toString('hex') + '.tmp';
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(obj, null, 2), 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    // Windows 上少数情况下 rename 不能覆盖，退化为 copy + unlink
    fs.copyFileSync(tmp, file);
    fs.unlinkSync(tmp);
  }
}

function normalizeCode(input) {
  return String(input == null ? '' : input).replace(/\D/g, '').slice(0, 8);
}

class Store {
  constructor(dataDir) {
    this.dir = path.resolve(dataDir || './data');
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.codesFile = path.join(this.dir, 'codes.json');
    this.usageFile = path.join(this.dir, 'usage.json');
    this.maxQuota = clampInt(process.env.MAX_CODE_QUOTA, 1, MAX_QUOTA, MAX_QUOTA);
    this.ttlDays = clampInt(process.env.CODE_TTL_DAYS, 1, 365, 30);
    this.data = this.loadCodes();
    this.usage = this.loadUsage();
  }

  loadCodes() {
    if (!fs.existsSync(this.codesFile)) return { codes: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.codesFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !parsed.codes) return { codes: {} };
      return parsed;
    } catch (err) {
      const backup = this.codesFile + '.broken-' + Date.now();
      try {
        fs.copyFileSync(this.codesFile, backup);
      } catch (e) {
        /* ignore */
      }
      console.error('[store] codes.json 解析失败，已备份到', backup);
      return { codes: {} };
    }
  }

  saveCodes() {
    atomicWrite(this.codesFile, this.data);
  }

  loadUsage() {
    if (!fs.existsSync(this.usageFile)) {
      return { date: todayStr(), count: 0 };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.usageFile, 'utf8'));
      if (!parsed || parsed.date !== todayStr()) {
        return { date: todayStr(), count: 0 };
      }
      return { date: parsed.date, count: Number(parsed.count) || 0 };
    } catch (err) {
      return { date: todayStr(), count: 0 };
    }
  }

  saveUsage() {
    atomicWrite(this.usageFile, this.usage);
  }

  generateCode() {
    for (let i = 0; i < 20; i += 1) {
      const code = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
      if (!this.data.codes[code]) return code;
    }
    throw new Error('验证码生成冲突，请重试');
  }

  createCodes(options) {
    const opts = options || {};
    const count = clampInt(opts.count, 1, 100, 1);
    const quota = clampInt(opts.quota, 1, this.maxQuota, this.maxQuota);
    const note = String(opts.note || '').trim().slice(0, 80);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlDays * 86400000).toISOString();

    const created = [];
    for (let i = 0; i < count; i += 1) {
      const code = this.generateCode();
      const record = {
        code,
        quota,
        used: 0,
        active: true,
        note,
        createdAt: now.toISOString(),
        expiresAt,
        lastUsedAt: null
      };
      this.data.codes[code] = record;
      created.push(this.publicRecord(record));
    }
    this.saveCodes();
    return created;
  }

  getRaw(code) {
    return this.data.codes[normalizeCode(code)] || null;
  }

  statusOf(record) {
    if (!record) return { ok: false, code: 'INVALID', message: '验证码不存在' };
    if (!record.active) return { ok: false, code: 'DISABLED', message: '这个验证码已停用' };
    if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) {
      return { ok: false, code: 'EXPIRED', message: '这个验证码已过期' };
    }
    if (record.used >= record.quota) {
      return { ok: false, code: 'EXHAUSTED', message: '这个验证码的 10 次额度已用完' };
    }
    return { ok: true };
  }

  publicRecord(record) {
    if (!record) return null;
    const remaining = Math.max(0, record.quota - record.used);
    let status = 'active';
    if (!record.active) status = 'disabled';
    else if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) status = 'expired';
    else if (remaining <= 0) status = 'exhausted';
    return {
      code: record.code,
      quota: record.quota,
      used: record.used,
      remaining,
      status,
      note: record.note || '',
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt || null
    };
  }

  /**
   * 预占 1 次额度。返回 {ok:true, remaining} 或 {ok:false, code, message}。
   * 同步执行，单进程内不会并发超卖。
   */
  consume(code) {
    const record = this.getRaw(code);
    const status = this.statusOf(record);
    if (!status.ok) return status;

    record.used += 1;
    record.lastUsedAt = new Date().toISOString();
    this.saveCodes();
    return {
      ok: true,
      code: record.code,
      quota: record.quota,
      remaining: Math.max(0, record.quota - record.used)
    };
  }

  refund(code) {
    const record = this.getRaw(code);
    if (!record || record.used <= 0) return false;
    record.used -= 1;
    this.saveCodes();
    return true;
  }

  disable(code) {
    const record = this.getRaw(code);
    if (!record) return false;
    record.active = false;
    this.saveCodes();
    return true;
  }

  listCodes() {
    return Object.values(this.data.codes)
      .map((r) => this.publicRecord(r))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  stats() {
    const all = this.listCodes();
    const totalUses = all.reduce((sum, r) => sum + r.used, 0);
    return {
      totalCodes: all.length,
      activeCodes: all.filter((r) => r.status === 'active').length,
      exhaustedCodes: all.filter((r) => r.status === 'exhausted').length,
      totalUses,
      today: this.usage.date,
      todayCalls: this.usage.count,
      maxQuota: this.maxQuota,
      ttlDays: this.ttlDays
    };
  }

  consumeDaily(limit) {
    this.usage = this.loadUsage();
    if (this.usage.count >= limit) {
      return { ok: false, code: 'DAILY_LIMIT', message: '今天的 AI 额度已经用完了，明天再来吧' };
    }
    this.usage.count += 1;
    this.saveUsage();
    return { ok: true, count: this.usage.count };
  }

  daily() {
    this.usage = this.loadUsage();
    return this.usage;
  }
}

module.exports = {
  Store,
  normalizeCode,
  MAX_QUOTA,
  todayStr
};
