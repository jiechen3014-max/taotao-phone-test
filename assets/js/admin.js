/* ============================================================
 * 卖家后台：管理员密码 → 生成 / 查看 / 停用验证码
 * ============================================================ */
(function () {
  'use strict';

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.prototype.slice.call((el || document).querySelectorAll(sel));
  const TOKEN_KEY = 'taotao-admin-token-v1';

  let token = '';
  let lastCreated = [];
  let toastTimer = null;

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  async function api(path, options) {
    const opts = options || {};
    const headers = Object.assign({}, opts.headers || {}, {
      'x-admin-token': token
    });
    if (opts.body) headers['Content-Type'] = 'application/json';

    const res = await fetch(path, Object.assign({}, opts, { headers }));
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok) {
      const err = new Error((data && data.error && data.error.message) || '请求失败');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function toast(message) {
    const el = $('#admin-toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-show'), 2200);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return new Promise((resolve, reject) => {
      try {
        fallbackCopy(text);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    if (!ok) throw new Error('copy failed');
  }

  function setToken(value) {
    token = value;
    try {
      if (value) sessionStorage.setItem(TOKEN_KEY, value);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function showLogin(message) {
    $('#login-panel').hidden = false;
    $('#dashboard').hidden = true;
    if (message) {
      const el = $('#login-error');
      el.textContent = message;
      el.hidden = false;
    }
  }

  function showDashboard() {
    $('#login-panel').hidden = true;
    $('#dashboard').hidden = false;
  }

  function statusInfo(status) {
    if (status === 'active') return { text: '可用', cls: '' };
    if (status === 'exhausted') return { text: '已用完', cls: 'code-row__badge--exhausted' };
    if (status === 'expired') return { text: '已过期', cls: 'code-row__badge--used' };
    return { text: '已停用', cls: 'code-row__badge--disabled' };
  }

  function renderStats(stats) {
    const el = $('#stats');
    if (!el || !stats) return;
    el.innerHTML = [
      { label: '验证码总数', value: stats.totalCodes, suffix: '个' },
      { label: '今日 AI 调用', value: stats.todayCalls, suffix: '次' },
      { label: '累计使用', value: stats.totalUses, suffix: '次' },
      { label: '单码上限', value: stats.maxQuota, suffix: '次' }
    ]
      .map(
        (s) =>
          '<div class="stat-card"><div class="stat-card__label">' +
          esc(s.label) +
          '</div><div class="stat-card__value">' +
          esc(s.value) +
          ' <small>' +
          esc(s.suffix) +
          '</small></div></div>'
      )
      .join('');
  }

  function codeLink(item) {
    if (item.link) return item.link;
    return window.location.origin + '/?code=' + item.code;
  }

  function renderNewCodes(codes) {
    const panel = $('#new-codes-panel');
    const list = $('#new-code-list');
    if (!panel || !list) return;
    lastCreated = codes || [];
    if (!lastCreated.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    list.innerHTML = lastCreated
      .map(
        (c) =>
          '<div class="new-code"><strong>' +
          esc(c.code) +
          '</strong><button type="button" data-copy-code="' +
          esc(c.code) +
          '">复制</button></div>'
      )
      .join('');
  }

  function renderCodes(codes) {
    const list = $('#code-list');
    if (!list) return;
    if (!codes || !codes.length) {
      list.innerHTML = '<div class="admin-empty">还没有验证码，先生成一批吧～</div>';
      return;
    }
    list.innerHTML = codes
      .map((c) => {
        const st = statusInfo(c.status);
        const link = codeLink(c);
        return (
          '<div class="code-row">' +
          '<div class="code-row__code">' +
          esc(c.code) +
          '</div>' +
          '<div class="code-row__meta">' +
          '<span class="code-row__link" title="' +
          esc(link) +
          '">' +
          esc(link) +
          '</span>' +
          '<span class="code-row__note">' +
          esc(c.note || '无备注') +
          ' · ' +
          esc(String(c.createdAt || '').slice(0, 10)) +
          '</span>' +
          '</div>' +
          '<div class="code-row__quota">' +
          esc(c.used) +
          ' / ' +
          esc(c.quota) +
          '</div>' +
          '<span class="code-row__badge ' +
          st.cls +
          '">' +
          st.text +
          '</span>' +
          '<div class="code-row__actions">' +
          '<button type="button" data-copy-link="' +
          esc(link) +
          '">复制链接</button>' +
          '<button type="button" data-copy-code="' +
          esc(c.code) +
          '">复制码</button>' +
          (c.status === 'active'
            ? '<button type="button" data-disable="' + esc(c.code) + '">停用</button>'
            : '') +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  async function loadDashboard() {
    const data = await api('/api/admin/codes');
    showDashboard();
    renderStats(data.stats);
    renderCodes(data.codes);
    try {
      const health = await fetch('/api/health').then((r) => r.json());
      if (!health.aiConfigured) {
        if (!document.getElementById('ai-warning')) {
          const warn = document.createElement('p');
          warn.className = 'admin-error';
          warn.id = 'ai-warning';
          warn.textContent = '服务端还没有配置 DEEPSEEK_API_KEY，买家现在无法生成报告。';
          $('#dashboard').insertBefore(warn, $('#stats'));
        }
      } else {
        const warn = document.getElementById('ai-warning');
        if (warn) warn.remove();
      }
    } catch (e) {
      /* ignore */
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    const value = $('#admin-token').value.trim();
    if (!value) return;
    setToken(value);
    try {
      await loadDashboard();
      $('#login-error').hidden = true;
      toast('进来啦 ✨');
    } catch (err) {
      setToken('');
      showLogin(err.status === 503 ? '服务端还没配置管理员密码' : '密码不对，或者服务暂时不可用');
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    const count = Number($('#create-count').value);
    const quota = Number($('#create-quota').value);
    const note = $('#create-note').value.trim();
    const errEl = $('#create-error');
    errEl.hidden = true;

    if (!Number.isInteger(count) || count < 1 || count > 50) {
      errEl.textContent = '一次生成 1–50 个';
      errEl.hidden = false;
      return;
    }
    if (!Number.isInteger(quota) || quota < 1 || quota > 10) {
      errEl.textContent = '单个码额度 1–10 次';
      errEl.hidden = false;
      return;
    }

    try {
      const data = await api('/api/admin/codes', {
        method: 'POST',
        body: JSON.stringify({ count, quota, note })
      });
      renderNewCodes(data.codes);
      renderStats(data.stats);
      await loadDashboard();
      toast('生成好啦，记得复制给买家');
      $('#create-note').value = '';
    } catch (err) {
      errEl.textContent = err.message || '生成失败';
      errEl.hidden = false;
    }
  }

  async function handleDisable(code) {
    if (!window.confirm('停用 ' + code + '？停用后买家就不能用了。')) return;
    try {
      await api('/api/admin/codes/disable', {
        method: 'POST',
        body: JSON.stringify({ code })
      });
      await loadDashboard();
      toast('已停用');
    } catch (err) {
      toast(err.message || '停用失败');
    }
  }

  function bindEvents() {
    $('#login-form').addEventListener('submit', handleLogin);
    $('#create-form').addEventListener('submit', handleCreate);
    $('#logout').addEventListener('click', () => {
      setToken('');
      $('#admin-token').value = '';
      showLogin('已退出');
    });
    $('#refresh-codes').addEventListener('click', () => {
      loadDashboard().catch((err) => toast(err.message || '刷新失败'));
    });
    $('#copy-new').addEventListener('click', () => {
      if (!lastCreated.length) return;
      const text = lastCreated
        .map((c) => c.code + '  ' + codeLink(c))
        .join('\n');
      copyText(text).then(
        () => toast('新验证码已全部复制'),
        () => toast('复制失败，请手动复制')
      );
    });

    document.addEventListener('click', (e) => {
      const copyCode = e.target.closest('[data-copy-code]');
      if (copyCode) {
        copyText(copyCode.dataset.copyCode).then(
          () => toast('验证码已复制'),
          () => toast('复制失败')
        );
        return;
      }
      const copyLink = e.target.closest('[data-copy-link]');
      if (copyLink) {
        copyText(copyLink.dataset.copyLink).then(
          () => toast('链接已复制'),
          () => toast('复制失败')
        );
        return;
      }
      const disable = e.target.closest('[data-disable]');
      if (disable) {
        handleDisable(disable.dataset.disable);
      }
    });
  }

  function init() {
    $$('[data-brand]').forEach((el) => {
      if (window.APP_CONFIG) el.textContent = window.APP_CONFIG.brand;
    });
    $$('[data-brand-en]').forEach((el) => {
      if (window.APP_CONFIG) el.textContent = window.APP_CONFIG.brandEn;
    });
    bindEvents();

    try {
      token = sessionStorage.getItem(TOKEN_KEY) || '';
    } catch (e) {
      token = '';
    }
    if (!token) {
      showLogin('');
      return;
    }
    $('#admin-token').value = token;
    loadDashboard().catch((err) => {
      setToken('');
      showLogin(err.status === 401 ? '登录过期了，再输一次密码' : '后台暂时连不上');
    });
  }

  init();
})();
