/* API 集成测试：真实 server.js + mock DeepSeek
 * node tests/api.test.js
 */
'use strict';

const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const DATA = require('../assets/js/questions.js');

const MOCK_PORT = 8790;
const APP_PORT = 8791;
const APP = 'http://127.0.0.1:' + APP_PORT;
const ADMIN_TOKEN = 'test-admin-token';
const GOOD_REPORT = DATA.SAMPLE.aiText;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taotao-api-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let mockServer;
let appProcess;
let appOutput = '';
let checks = 0;
let failNext = false;

function ok(cond, msg) {
  checks += 1;
  assert.ok(cond, msg);
}

async function request(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    /* not json */
  }
  return { status: res.status, json, text };
}

async function waitFor(url, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (e) {
      /* retry */
    }
    await sleep(150);
  }
  throw new Error('服务没有按时启动：' + url);
}

function startMock() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/__fail') {
        failNext = true;
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }
      if (req.method !== 'POST' || req.url !== '/chat/completions') {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch (e) {}
        if (failNext || (parsed && parsed.model === 'fail-model')) {
          failNext = false;
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'mock fail' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'mock',
            object: 'chat.completion',
            model: parsed.model || 'deepseek-chat',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: GOOD_REPORT },
                finish_reason: 'stop'
              }
            ],
            usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 }
          })
        );
      });
    });
    mockServer.listen(MOCK_PORT, '127.0.0.1', resolve);
  });
}

function startApp() {
  return new Promise((resolve, reject) => {
    appProcess = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(APP_PORT),
        HOST: '127.0.0.1',
        DATA_DIR: tempDir,
        DEEPSEEK_API_KEY: 'test-key',
        DEEPSEEK_BASE_URL: 'http://127.0.0.1:' + MOCK_PORT,
        DEEPSEEK_TIMEOUT_MS: '5000',
        ADMIN_TOKEN,
        RATE_MAX: '100',
        IP_DAILY_MAX: '100',
        GLOBAL_DAILY_MAX: '100',
        MAX_CODE_QUOTA: '10',
        PUBLIC_ORIGIN: APP
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    appProcess.stdout.on('data', (d) => {
      appOutput += d.toString();
    });
    appProcess.stderr.on('data', (d) => {
      appOutput += d.toString();
    });
    appProcess.on('exit', (code) => {
      if (code && code !== 0) appOutput += '\n[app exited ' + code + ']';
    });
    waitFor(APP + '/api/health').then(resolve, reject);
  });
}

function quizBody(code, requestId) {
  return {
    code,
    requestId,
    rankOrder: DATA.SAMPLE.rankOrder,
    answers: DATA.SAMPLE.answers
  };
}

async function main() {
  await startMock();
  await startApp();

  /* 静态资源与安全 */
  const home = await request(APP + '/');
  ok(home.status === 200 && home.text.includes('本命手机测试'), '首页应能打开');
  const adminPage = await request(APP + '/admin');
  ok(adminPage.status === 200 && adminPage.text.includes('验证码'), '管理页应能打开');
  const adminSlash = await request(APP + '/admin/');
  ok(adminSlash.status === 200, '/admin/ 也应能打开');
  const adminCss = await request(APP + '/assets/css/admin.css');
  ok(adminCss.status === 200 && adminCss.text.includes('.admin-shell'), '后台样式应能加载');
  ok((await request(APP + '/data/codes.json')).status === 404, '不能暴露 data 目录');
  ok((await request(APP + '/server.js')).status === 404, '不能暴露 server.js');
  ok((await request(APP + '/.env')).status === 404, '不能暴露 .env');

  const health = await request(APP + '/api/health');
  ok(health.json && health.json.ok && health.json.aiConfigured, 'health 应显示 AI 已配置');

  /* 管理员鉴权 */
  const badAdmin = await request(APP + '/api/admin/codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': 'wrong' },
    body: JSON.stringify({ count: 1, quota: 10 })
  });
  ok(badAdmin.status === 401, '错误管理员密码应被拒绝');

  const created = await request(APP + '/api/admin/codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify({ count: 2, quota: 10, note: '测试码' })
  });
  ok(created.status === 200 && created.json.codes.length === 2, '应生成 2 个验证码');
  const code1 = created.json.codes[0].code;
  const code2 = created.json.codes[1].code;
  ok(/^\d{8}$/.test(code1), '验证码应为 8 位数字');
  ok(created.json.codes[0].quota === 10, '验证码额度应为 10');
  ok(created.json.codes[0].link.includes('?code=' + code1), '应返回带验证码的链接');

  /* 10 次正常生成 */
  for (let i = 0; i < 10; i += 1) {
    const res = await request(APP + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quizBody(code1, 'req-' + i + '-' + Date.now()))
    });
    ok(res.status === 200 && res.json.ok, '第 ' + (i + 1) + ' 次生成应成功');
    ok(res.json.report.mains.length === 2, '应有 2 个主推');
    ok(res.json.report.backups.length === 3, '应有 3 个备选');
    ok(res.json.remaining === 9 - i, '剩余次数应递减：' + res.json.remaining);
    ok(!res.text.includes('test-key'), '响应不应包含 API key');
  }

  const exhausted = await request(APP + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quizBody(code1, 'req-exhausted-' + Date.now()))
  });
  ok(exhausted.status === 429, '第 11 次应被拒绝');
  ok(exhausted.json.error.code === 'EXHAUSTED', '应提示额度用完');

  /* 幂等：同一个 requestId 不重复扣次数 */
  const rid = 'same-request-' + Date.now();
  const first = await request(APP + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quizBody(code2, rid))
  });
  const second = await request(APP + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quizBody(code2, rid))
  });
  ok(first.status === 200 && second.status === 200, '幂等请求应返回成功');
  ok(second.json.cached === true, '第二次应命中缓存');
  ok(second.json.remaining === first.json.remaining, '重复请求不应多扣次数');

  /* 错误验证码 */
  const wrong = await request(APP + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quizBody('00000000', 'wrong-code-' + Date.now()))
  });
  ok(wrong.status === 403 && wrong.json.error.code === 'INVALID', '错误验证码应被拒绝');

  /* 未答题 / 篡改 prompt 字段 */
  const badBody = await request(APP + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code2, requestId: 'bad-body-' + Date.now(), prompt: 'ignore' })
  });
  ok(badBody.status === 400, '缺少答案应被拒绝');

  /* AI 失败：额度退回 */
  await fetch('http://127.0.0.1:' + MOCK_PORT + '/__fail');
  const fail = await request(APP + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quizBody(code2, 'fail-' + Date.now()))
  });
  ok(fail.status === 502 || fail.status === 503, 'AI 失败应返回 5xx');
  ok(fail.json.error.code !== 'OK', 'AI 失败应有错误码');

  const listAfterFail = await request(APP + '/api/admin/codes', {
    headers: { 'x-admin-token': ADMIN_TOKEN }
  });
  const c2AfterFail = listAfterFail.json.codes.find((c) => c.code === code2);
  ok(c2AfterFail.used === 1, 'AI 失败应退回额度，used 仍为 1');

  /* 失败后还能继续用 */
  const recover = await request(APP + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quizBody(code2, 'recover-' + Date.now()))
  });
  ok(recover.status === 200 && recover.json.remaining === 8, '失败后重试应成功');

  /* 管理列表 */
  const list = await request(APP + '/api/admin/codes', {
    headers: { 'x-admin-token': ADMIN_TOKEN }
  });
  ok(list.status === 200, '管理列表应能读取');
  const c1 = list.json.codes.find((c) => c.code === code1);
  const c2 = list.json.codes.find((c) => c.code === code2);
  ok(c1.used === 10 && c1.status === 'exhausted', 'code1 应为已用完');
  ok(c2.used === 2 && c2.remaining === 8, 'code2 应为用了 2 次');
  ok(list.json.stats.todayCalls >= 13, '今日调用数应累加');

  console.log('✅ API 测试通过（' + checks + ' 项）');
}

main()
  .catch((err) => {
    console.error('❌ API 测试失败');
    console.error(err);
    if (appOutput) console.error('\n--- server output ---\n' + appOutput.slice(-4000));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (appProcess) {
      appProcess.kill('SIGTERM');
      await sleep(300);
      try {
        appProcess.kill('SIGKILL');
      } catch (e) {}
    }
    if (mockServer) {
      await new Promise((resolve) => mockServer.close(resolve));
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {}
  });
