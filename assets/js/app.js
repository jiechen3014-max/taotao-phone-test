/* ============================================================
 * 页面交互：排序 → 动态答题 → 购机画像 → 验证码解锁 AI 报告
 * ============================================================ */
(function () {
  'use strict';

  const D = window.QUIZ_DATA;
  const Q = window.PhoneQuiz;
  const C = window.APP_CONFIG;

  const $ = function (sel, el) {
    return (el || document).querySelector(sel);
  };
  const $$ = function (sel, el) {
    return Array.prototype.slice.call((el || document).querySelectorAll(sel));
  };

  const STORAGE_KEY = 'taotao-phone-result-v2';
  const THEMES =
    C.themes && C.themes.length
      ? C.themes
      : [{ id: 'peach', name: '蜜桃乌龙', emoji: '🍑' }];
  const MOTIFS =
    C.motifs && C.motifs.length
      ? C.motifs
      : [{ id: 'heart', name: '爱心', emoji: '♡', glyphs: ['♡'] }];

  const UNIVERSAL_DIM = {
    id: 'universal',
    name: '通用',
    emoji: '🤍',
    color: '#9C8A86',
    soft: '#F7EFEA'
  };

  const RANKING_Q = {
    id: 'ranking',
    type: 'ranking',
    dim: 'ranking',
    title: '先排个序：选手机，你最在意什么？',
    hint: '从最在意开始，依次点 6 项；点错了再点一下就能取消。'
  };

  const LOADING_MESSAGES = [
    'AI 正在翻参数表…',
    '在预算红线内挑 5 款…',
    '正在对比影像、手感和续航…',
    '快好了，别走开～'
  ];

  const state = {
    rankOrder: [],
    answers: {},
    flow: [RANKING_Q],
    index: 0,
    weights: null,
    report: null,
    demo: false,
    finished: false,
    totalQuestions: 0,
    code: '',
    remaining: null,
    quota: null,
    styleStep: -1,
    reportMeta: null
  };

  let autoTimer = null;
  let toastTimer = null;
  let loadingTimer = null;
  let generating = false;
  let debugMode = false;

  /* ============================================================
   * 启动
   * ============================================================ */
  function init() {
    applyConfig();
    bindEvents();

    const params = new URLSearchParams(window.location.search);
    debugMode = params.get('debug') === '1';
    const codeParam = String(params.get('code') || '')
      .replace(/\D/g, '')
      .slice(0, 8);
    if (codeParam) state.code = codeParam;

    if (params.get('demo') === '1') {
      startDemo();
      return;
    }
    updateHome();
  }

  function applyConfig() {
    document.title = C.title;
    $$('[data-brand]').forEach(function (el) {
      el.textContent = C.brand;
    });
    $$('[data-brand-en]').forEach(function (el) {
      el.textContent = C.brandEn;
    });
    $$('[data-handle]').forEach(function (el) {
      el.textContent = C.handle;
    });
    $$('[data-footer-note]').forEach(function (el) {
      el.textContent = C.footerNote;
    });

    const contact = $('.unlock-contact');
    const contactLink = $('[data-contact-link]');
    if (contactLink) {
      if (C.contactUrl) {
        contactLink.href = C.contactUrl;
        contactLink.textContent = C.contactLabel || '来小红书找我';
      } else if (contact) {
        contact.hidden = true;
      }
    }

    const printBtn = $('#print-btn');
    if (printBtn && !C.enablePrint) printBtn.hidden = true;
  }

  function bindEvents() {
    document.addEventListener('click', function (e) {
      const actEl = e.target.closest('[data-act]');
      if (actEl) {
        e.preventDefault();
        handleAction(actEl.dataset.act, actEl);
        return;
      }

      const opt = e.target.closest('[data-opt]');
      if (opt && !opt.disabled) {
        chooseOption(opt.dataset.opt);
        return;
      }

      const dim = e.target.closest('[data-dim]');
      if (dim) {
        toggleRank(dim.dataset.dim);
        return;
      }

      const skip = e.target.closest('[data-skip]');
      if (skip) {
        skipCurrent();
      }
    });

    const form = $('#unlock-form');
    if (form) form.addEventListener('submit', generateReport);

    const codeInput = $('#code-input');
    if (codeInput) {
      codeInput.addEventListener('input', function () {
        const digits = codeInput.value.replace(/\D/g, '').slice(0, 8);
        if (codeInput.value !== digits) codeInput.value = digits;
        if (digits !== state.code) {
          state.remaining = null;
          renderRemaining();
        }
        const status = $('#unlock-status');
        if (status && status.classList.contains('is-error')) {
          status.className = 'unlock-status';
          status.textContent = '';
        }
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.dataset.view === 'quiz') {
        quitQuiz();
      }
    });
  }

  function handleAction(act) {
    switch (act) {
      case 'home':
        if (document.body.dataset.view === 'quiz') quitQuiz();
        else {
          showView('home');
          updateHome();
        }
        break;
      case 'start':
        startQuiz();
        break;
      case 'demo':
        startDemo();
        break;
      case 'back':
        goBack();
        break;
      case 'quit':
        quitQuiz();
        break;
      case 'next':
        goNext();
        break;
      case 'reset-rank':
        state.rankOrder = [];
        syncRanking();
        renderFoot(currentQ());
        break;
      case 'restart':
        startQuiz();
        break;
      case 'copy-caption':
        copyCaption();
        break;
      case 'print':
        if (state.report) window.print();
        else toast('先生成报告再打印哦');
        break;
      case 'shuffle-theme':
        shuffleTheme();
        break;
      case 'resume':
        resumeSaved();
        break;
      default:
        break;
    }
  }

  /* ============================================================
   * 视图
   * ============================================================ */
  function showView(name) {
    ['home', 'quiz', 'result'].forEach(function (v) {
      const el = $('#view-' + v);
      if (el) el.hidden = v !== name;
    });
    document.body.dataset.view = name;

    if (name === 'result' && (state.report || state.demo)) {
      applyTheme(state.styleStep);
    } else if (name !== 'result') {
      resetThemeAttrs();
    }

    window.scrollTo(0, 0);
  }

  function updateHome() {
    const slot = $('#resume-slot');
    if (!slot) return;
    const saved = readSession();
    if (saved && saved.rankOrder && !state.demo) {
      const text = saved.report
        ? '🧸 上次的报告还在，继续看 →'
        : '📝 上次答完了，继续去解锁 →';
      slot.innerHTML =
        '<button class="resume-link" type="button" data-act="resume">' + text + '</button>';
    } else {
      slot.innerHTML = '';
    }
  }

  /* ============================================================
   * 答题流程
   * ============================================================ */
  function startQuiz() {
    clearTimeout(autoTimer);
    stopLoadingMessages();
    state.rankOrder = [];
    state.answers = {};
    state.flow = [RANKING_Q];
    state.index = 0;
    state.weights = null;
    state.report = null;
    state.demo = false;
    state.finished = false;
    state.totalQuestions = 0;
    state.styleStep = -1;
    state.reportMeta = null;

    const banner = $('#demo-banner');
    if (banner) banner.hidden = true;
    const report = $('#report-wrap');
    if (report) report.hidden = true;
    const status = $('#unlock-status');
    if (status) {
      status.textContent = '';
      status.className = 'unlock-status';
    }
    resetThemeAttrs();
    showView('quiz');
    renderStep();
  }

  function quitQuiz() {
    clearTimeout(autoTimer);
    state.rankOrder = [];
    state.answers = {};
    state.flow = [RANKING_Q];
    state.index = 0;
    state.weights = null;
    state.report = null;
    state.demo = false;
    state.finished = false;
    showView('home');
    updateHome();
  }

  function currentQ() {
    return state.flow[state.index];
  }

  function renderStep() {
    const q = currentQ();
    if (!q) return;
    updateProgress();

    const card = $('#quiz-card');
    if (q.type === 'ranking') renderRanking(card);
    else renderQuestion(q, card);

    card.classList.remove('is-enter');
    void card.offsetWidth;
    card.classList.add('is-enter');

    renderFoot(q);
    window.scrollTo(0, 0);
  }

  function updateProgress() {
    const total = state.flow.length;
    const cur = state.index + 1;
    $('#q-count').textContent = '第 ' + cur + ' 题';
    $('#q-total').textContent = total > 1 ? '共 ' + total + ' 题' : '先排个序';
    const pct = total > 1 ? Math.round((cur / total) * 100) : 4;
    $('#q-bar').style.width = pct + '%';
    const bar = $('.quiz-progress__bar');
    if (bar) bar.setAttribute('aria-valuenow', String(pct));
  }

  function renderRanking(card) {
    const order = state.rankOrder;
    const items = D.DIMS.map(function (d) {
      const pos = order.indexOf(d.id);
      const picked = pos >= 0;
      return (
        '<button class="rank-item' + (picked ? ' is-picked' : '') + '" type="button" data-dim="' +
        d.id + '" style="--dim-color:' + d.color + ';--dim-soft:' + d.soft + '" aria-pressed="' +
        (picked ? 'true' : 'false') + '">' +
        '<span class="rank-item__badge">' + (picked ? pos + 1 : '+') + '</span>' +
        '<span class="rank-item__emoji">' + d.emoji + '</span>' +
        '<span class="rank-item__text"><strong>' + d.name + '</strong><small>' + d.desc + '</small></span>' +
        '<span class="rank-item__state">' + (picked ? '第 ' + (pos + 1) + ' 在意' : '点我') + '</span>' +
        '</button>'
      );
    }).join('');

    card.innerHTML =
      '<div class="q-card__head">' +
      '<span class="q-chip" style="--chip:#E9899B;--chip-soft:#FFE6EB">✿ 第 1 题 · 排序</span>' +
      '<h2 class="q-title">' + RANKING_Q.title + '</h2>' +
      '<p class="q-hint">' + RANKING_Q.hint + '</p>' +
      '</div>' +
      '<div class="rank-list">' + items + '</div>' +
      '<div class="rank-bar">' +
      '<span>已选 <strong>' + order.length + '</strong> / 6</span>' +
      '<button class="text-btn" type="button" data-act="reset-rank"' + (order.length ? '' : ' disabled') + '>重新排</button>' +
      '</div>' +
      '<p class="rank-tip">💡 没有标准答案，按你真实的想法点就好。</p>';
  }

  function toggleRank(id) {
    const pos = state.rankOrder.indexOf(id);
    if (pos >= 0) {
      state.rankOrder.splice(pos, 1);
    } else {
      if (state.rankOrder.length >= D.DIMS.length) {
        shake($('#quiz-card'));
        toast('6 项已经排满啦，先取消一个再点～');
        return;
      }
      state.rankOrder.push(id);
    }
    syncRanking();
    renderFoot(currentQ());
  }

  function syncRanking() {
    const order = state.rankOrder;
    $$('.rank-item').forEach(function (btn) {
      const pos = order.indexOf(btn.dataset.dim);
      const picked = pos >= 0;
      btn.classList.toggle('is-picked', picked);
      btn.setAttribute('aria-pressed', picked ? 'true' : 'false');
      const badge = $('.rank-item__badge', btn);
      if (badge) badge.textContent = picked ? String(pos + 1) : '+';
      const stateEl = $('.rank-item__state', btn);
      if (stateEl) stateEl.textContent = picked ? '第 ' + (pos + 1) + ' 在意' : '点我';
    });
    const barStrong = $('.rank-bar strong');
    if (barStrong) barStrong.textContent = String(order.length);
    const reset = $('[data-act="reset-rank"]');
    if (reset) reset.disabled = order.length === 0;
  }

  function renderQuestion(q, card) {
    const dim =
      q.dim === 'universal'
        ? UNIVERSAL_DIM
        : D.DIMS.filter(function (d) {
            return d.id === q.dim;
          })[0];

    const value = state.answers[q.id];
    const selected = q.type === 'multi' ? (Array.isArray(value) ? value : []) : value;

    const options = q.options
      .map(function (o) {
        const on = q.type === 'multi' ? selected.indexOf(o.k) >= 0 : selected === o.k;
        const maxed = q.type === 'multi' && q.max && selected.length >= q.max && !on;
        return (
          '<button class="option' + (on ? ' is-selected' : '') + (maxed ? ' is-disabled' : '') +
          '" type="button" data-opt="' + o.k + '" aria-pressed="' + (on ? 'true' : 'false') + '"' +
          (maxed ? ' disabled' : '') + '>' +
          '<span class="option__emoji">' + o.emoji + '</span>' +
          '<span class="option__text"><strong>' + o.label + '</strong>' +
          (o.note ? '<small>' + o.note + '</small>' : '') +
          '</span>' +
          '<span class="option__check" aria-hidden="true">✓</span>' +
          '</button>'
        );
      })
      .join('');

    card.innerHTML =
      '<div class="q-card__head">' +
      '<div class="q-card__meta">' +
      '<span class="q-chip" style="--chip:' + dim.color + ';--chip-soft:' + dim.soft + '">' +
      dim.emoji + ' ' + (q.dim === 'universal' ? '通用' : dim.name) + '</span>' +
      (q.type === 'multi' ? '<span class="q-type">多选' + (q.max ? ' · 最多 ' + q.max + ' 项' : '') + '</span>' : '') +
      '</div>' +
      '<h2 class="q-title">' + q.title + '</h2>' +
      '<p class="q-hint">' + q.hint + '</p>' +
      '</div>' +
      '<div class="options' + (q.options.length > 6 ? ' options--dense' : '') + '">' + options + '</div>';
  }

  function chooseOption(key) {
    const q = currentQ();
    if (!q || q.type === 'ranking') return;

    if (q.type === 'multi') {
      let arr = Array.isArray(state.answers[q.id]) ? state.answers[q.id].slice() : [];
      const pos = arr.indexOf(key);
      if (pos >= 0) {
        arr.splice(pos, 1);
      } else {
        if (q.max && arr.length >= q.max) {
          shake($('#quiz-card'));
          toast('最多选 ' + q.max + ' 项哦～');
          return;
        }
        arr.push(key);
      }
      state.answers[q.id] = arr;
      syncOptions(q);
      renderFoot(q);
      return;
    }

    clearTimeout(autoTimer);
    state.answers[q.id] = key;
    syncOptions(q);
    renderFoot(q);
    autoTimer = setTimeout(function () {
      goNext();
    }, 280);
  }

  function syncOptions(q) {
    const card = $('#quiz-card');
    const value = state.answers[q.id];
    const selected = q.type === 'multi' ? (Array.isArray(value) ? value : []) : value;

    $$('.option', card).forEach(function (btn) {
      const k = btn.dataset.opt;
      const on = q.type === 'multi' ? selected.indexOf(k) >= 0 : selected === k;
      const maxed = q.type === 'multi' && q.max && selected.length >= q.max && !on;
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-disabled', !!maxed);
      btn.disabled = !!maxed;
    });
  }

  function skipCurrent() {
    const q = currentQ();
    if (!q || q.type !== 'multi' || !q.skipLabel) return;
    state.answers[q.id] = [];
    renderStep();
  }

  function renderFoot(q) {
    const foot = $('#quiz-foot');
    if (!foot) return;
    const last = state.index === state.flow.length - 1;

    if (q.type === 'ranking') {
      const ready = state.rankOrder.length === D.DIMS.length;
      foot.innerHTML =
        '<div class="quiz-foot__hint">' +
        (ready ? '排好啦，开始答题吧 ✿' : '把 6 项都点一遍才能继续') +
        '</div>' +
        '<button class="btn btn--primary quiz-next" type="button" data-act="next"' +
        (ready ? '' : ' disabled') + '>锁定排序，开始答题</button>';
      return;
    }

    const value = state.answers[q.id];
    const answered = q.type === 'multi' ? Array.isArray(value) : !!value;

    let hint = '';
    if (q.type === 'multi') {
      if (answered) {
        hint = '已选 ' + value.length + ' 项 · 可以改';
      } else if (q.skipLabel) {
        hint = '<button class="text-btn" type="button" data-skip>' + q.skipLabel + '</button>';
      } else {
        hint = '最多选 ' + (q.max || q.options.length) + ' 项';
      }
    } else {
      hint = answered ? '选好了就下一题 →' : '选一个最接近的答案';
    }

    foot.innerHTML =
      '<div class="quiz-foot__hint">' + hint + '</div>' +
      '<button class="btn btn--primary quiz-next" type="button" data-act="next"' +
      (answered ? '' : ' disabled') + '>' +
      (last ? '生成我的购机画像 ✨' : '下一题') +
      '</button>';
  }

  function goNext() {
    clearTimeout(autoTimer);
    const q = currentQ();
    if (!q) return;

    if (q.type === 'ranking') {
      if (state.rankOrder.length !== D.DIMS.length) {
        shake($('#quiz-card'));
        toast('还差几项没排呢～');
        return;
      }
      completeRanking();
      return;
    }

    const value = state.answers[q.id];
    const answered = q.type === 'multi' ? Array.isArray(value) : !!value;
    if (!answered) {
      shake($('#quiz-card'));
      toast('先选一个答案呀');
      return;
    }

    if (state.index >= state.flow.length - 1) {
      finish();
      return;
    }
    state.index += 1;
    renderStep();
  }

  function goBack() {
    clearTimeout(autoTimer);
    if (state.index > 0) {
      state.index -= 1;
      renderStep();
    } else {
      quitQuiz();
    }
  }

  function completeRanking() {
    state.weights = Q.computeWeights(state.rankOrder);
    const follow = Q.buildFlow(state.rankOrder);
    state.flow = [RANKING_Q].concat(follow);
    state.totalQuestions = state.flow.length;

    const allowed = {};
    state.flow.forEach(function (q) {
      allowed[q.id] = true;
    });
    Object.keys(state.answers).forEach(function (id) {
      if (!allowed[id]) delete state.answers[id];
    });

    state.index = 1;
    renderStep();
  }

  function finish() {
    clearTimeout(autoTimer);
    if (!state.weights) state.weights = Q.computeWeights(state.rankOrder);
    state.totalQuestions = state.flow.length;
    state.finished = true;
    state.demo = false;
    state.report = null;
    state.styleStep = -1;
    state.reportMeta = null;
    saveSession();
    renderResult();
    showView('result');
    updateHome();
  }

  /* ============================================================
   * 结果页
   * ============================================================ */
  function renderResult() {
    const calc = state.weights || Q.computeWeights(state.rankOrder);
    state.weights = calc;

    const banner = $('#demo-banner');
    if (banner) banner.hidden = !state.demo;

    const sub = $('#result-sub');
    if (sub) {
      sub.textContent = state.demo
        ? '这是一份示例画像，看看完整报告长什么样。'
        : '根据排序和 ' + Math.max(0, state.totalQuestions - 1) + ' 道回答算出，越靠前越值得花钱。';
    }

    $('#budget-text').textContent = Q.getBudgetLabel(state.answers);
    const budgetNote = $('#budget-note');
    if (budgetNote) {
      budgetNote.textContent =
        state.answers.p1 === 'flex'
          ? '没有硬预算，按值不值来选'
          : '预算会作为硬性红线单独约束';
    }

    const prefOrder = Q.preferenceOrder(calc);
    const pref = Q.preferenceWeights(calc);

    const tags = prefOrder.slice(0, 3).map(function (id) {
      const d = D.DIMS.filter(function (x) {
        return x.id === id;
      })[0];
      return (
        '<span class="profile-tag" style="--tag:' + d.color + ';--tag-soft:' + d.soft + '">' +
        d.emoji + ' ' + d.name +
        '</span>'
      );
    }).join('');
    $('#profile-tags').innerHTML = tags;
    $('#profile-summary').textContent = Q.getSummary(calc);

    const rows = prefOrder.map(function (id) {
      const d = D.DIMS.filter(function (x) {
        return x.id === id;
      })[0];
      return (
        '<div class="weight-row">' +
        '<span class="weight-row__name">' + d.emoji + ' ' + d.name + '</span>' +
        '<div class="weight-row__track"><i class="weight-row__fill" style="--w:' + pref[id] +
        '%;--bar:' + d.color + '"></i></div>' +
        '<span class="weight-row__pct">' + pref[id] + '%</span>' +
        '</div>'
      );
    }).join('');
    $('#weight-list').innerHTML = rows;

    const showReport = !!state.report || state.demo;

    const unlockCard = $('#unlock-card');
    if (unlockCard) unlockCard.hidden = showReport;
    const scrollCue = $('#scroll-cue');
    if (scrollCue) scrollCue.hidden = showReport;
    const themeDock = $('#theme-dock');
    if (themeDock) themeDock.hidden = !showReport;
    const actions = $('#result-actions');
    if (actions) actions.hidden = !showReport;

    const codeInput = $('#code-input');
    if (codeInput) codeInput.value = state.code || '';
    renderRemaining();

    if (showReport) {
      renderReport();
      applyTheme(state.styleStep);
    } else {
      $('#report-wrap').hidden = true;
      resetThemeAttrs();
    }

    const status = $('#unlock-status');
    if (status) {
      status.textContent = '';
      status.className = 'unlock-status';
    }

    renderDebug(calc);
  }

  function renderReport() {
    const report = state.report;
    if (!report) {
      $('#report-wrap').hidden = true;
      return;
    }
    const items = (report.mains || []).concat(report.backups || []);
    if (!items.length) {
      $('#report-wrap').hidden = true;
      return;
    }

    const intro = $('#report-intro');
    intro.textContent = report.intro || '';
    intro.hidden = !report.intro;

    const mains = report.mains || [];
    const backups = report.backups || [];

    let html = '';
    mains.forEach(function (item, i) {
      html += pickCard(item, 'main', i);
    });
    backups.forEach(function (item, i) {
      html += pickCard(item, 'backup', i);
    });
    $('#report-grid').innerHTML = html;

    let extra = '';
    if (report.final) {
      extra +=
        '<div class="advice"><span class="advice__label">最终建议</span><p>' + esc(report.final) + '</p></div>';
    }
    if (report.pitfall) {
      extra +=
        '<div class="advice advice--warn"><span class="advice__label">避坑提醒</span><p>' + esc(report.pitfall) + '</p></div>';
    }
    $('#report-extra').innerHTML = extra;
    $('#report-extra').hidden = !extra;

    const caption = Q.buildCaption(state, report);
    const capEl = $('#caption-text');
    if (capEl) capEl.value = caption;
    const capCard = $('#caption-card');
    if (capCard) capCard.hidden = !caption;

    updatePrintMeta();
    $('#report-wrap').hidden = false;
  }

  function pickCard(item, kind, index) {
    const label = (kind === 'main' ? '主推 ' : '备选 ') + (index + 1);
    const pros = (item.pros || [])
      .map(function (p) {
        return '<li>' + esc(p) + '</li>';
      })
      .join('');
    const cons = (item.cons || [])
      .map(function (c) {
        return '<li>' + esc(c) + '</li>';
      })
      .join('');

    return (
      '<article class="pick pick--' + kind + '">' +
      '<div class="pick__top">' +
      '<span class="pick__badge">' + (kind === 'main' ? '♡ ' : '') + label + '</span>' +
      (item.price ? '<span class="pick__price">' + esc(item.price) + '</span>' : '') +
      '</div>' +
      '<h4 class="pick__model">' + esc(item.model) + '</h4>' +
      (item.config ? '<p class="pick__config">' + esc(item.config) + '</p>' : '') +
      (pros ? '<div class="pick__block"><span class="pick__label">优点</span><ul>' + pros + '</ul></div>' : '') +
      (cons ? '<div class="pick__block pick__block--cons"><span class="pick__label">缺点</span><ul>' + cons + '</ul></div>' : '') +
      (item.fit ? '<p class="pick__fit"><strong>适合</strong>' + esc(item.fit) + '</p>' : '') +
      '</article>'
    );
  }

  function renderRemaining() {
    const meta = $('#code-meta');
    if (!meta) return;
    if (state.demo || state.remaining == null) {
      meta.hidden = true;
      return;
    }
    meta.hidden = false;
    if (state.remaining > 0) {
      meta.innerHTML = '💗 这个码还剩 <strong id="code-left">' + state.remaining + '</strong> 次';
    } else {
      meta.innerHTML = '💗 这个码的次数用完啦，找店主再要一个～';
    }
  }

  /* ============================================================
   * 生成
   * ============================================================ */
  async function generateReport(e) {
    if (e) e.preventDefault();
    if (generating) return;
    if (!state.finished) {
      toast('先答完题呀');
      return;
    }

    const input = $('#code-input');
    const code = String(input ? input.value : '').replace(/\D/g, '').slice(0, 8);
    if (input) input.value = code;

    if (!/^\d{8}$/.test(code)) {
      showUnlockError('请输入 8 位数字验证码');
      if (input) input.focus();
      return;
    }
    if (state.remaining === 0 && code === state.code) {
      showUnlockError('这个验证码的次数已经用完了，找店主再要一个吧');
      return;
    }
    if (window.location.protocol === 'file:') {
      showUnlockError('请用 npm start 启动后端后再试；直接双击 HTML 无法调用 AI。');
      return;
    }

    setLoading(true);
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, 95000);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          requestId: makeRequestId(),
          rankOrder: state.rankOrder,
          answers: state.answers
        }),
        signal: controller.signal
      });

      let data = null;
      try {
        data = await res.json();
      } catch (err) {
        data = null;
      }

      if (!res.ok) {
        const err = new Error(
          (data && data.error && data.error.message) || '生成失败了，请稍后再试'
        );
        err.code = data && data.error ? data.error.code : '';
        err.remaining = data && data.error ? data.error.remaining : undefined;
        throw err;
      }
      if (!data || !data.report || !Array.isArray(data.report.mains) || !Array.isArray(data.report.backups)) {
        throw new Error('AI 返回的报告格式不对，请再试一次');
      }

      state.report = data.report;
      state.code = code;
      state.remaining = typeof data.remaining === 'number' ? data.remaining : null;
      state.quota = typeof data.quota === 'number' ? data.quota : null;
      state.reportMeta = {
        generatedAt: data.generatedAt || new Date().toISOString(),
        requestId: data.requestId || ''
      };
      if (state.styleStep < 0) state.styleStep = randomStyleStep();

      setLoading(false);
      saveSession();
      renderResult();
      showView('result');

      setTimeout(function () {
        const report = $('#report-wrap');
        if (report) report.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 180);

      toast('报告解锁啦 ✨');
    } catch (err) {
      setLoading(false);
      let message = err && err.message ? err.message : '生成失败了，请稍后再试';
      if (err && err.name === 'AbortError') {
        message = 'AI 思考超时了，次数已退回，请再试一次';
      }
      if (typeof err.remaining === 'number') {
        state.remaining = err.remaining;
        renderRemaining();
      }
      showUnlockError(message);
      console.error('[report] failed', err && err.code, err && err.message, Date.now() - started);
    } finally {
      clearTimeout(timer);
    }
  }

  function setLoading(on) {
    generating = on;
    const btn = $('#generate-btn');
    const input = $('#code-input');
    const status = $('#unlock-status');
    const card = $('#unlock-card');

    if (on) {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'AI 正在挑手机…';
        btn.classList.add('is-loading');
      }
      if (input) input.disabled = true;
      if (card) card.classList.add('is-loading');
      if (status) {
        status.className = 'unlock-status is-loading';
        status.textContent = LOADING_MESSAGES[0];
      }
      startLoadingMessages();
    } else {
      stopLoadingMessages();
      if (btn) {
        btn.disabled = false;
        btn.textContent = '生成我的报告 ✨';
        btn.classList.remove('is-loading');
      }
      if (input) input.disabled = false;
      if (card) card.classList.remove('is-loading');
      if (status) {
        status.className = 'unlock-status';
        status.textContent = '';
      }
    }
  }

  function startLoadingMessages() {
    stopLoadingMessages();
    let i = 0;
    loadingTimer = setInterval(function () {
      const el = $('#unlock-status');
      if (!el) return;
      i = (i + 1) % LOADING_MESSAGES.length;
      el.textContent = LOADING_MESSAGES[i];
    }, 3200);
  }

  function stopLoadingMessages() {
    clearInterval(loadingTimer);
    loadingTimer = null;
  }

  function showUnlockError(message) {
    const status = $('#unlock-status');
    if (status) {
      status.className = 'unlock-status is-error';
      status.textContent = message;
    }
    shake($('#unlock-card'));
  }

  function makeRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID().replace(/-/g, '');
    }
    return (
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 12) +
      Math.random().toString(36).slice(2, 8)
    );
  }

  /* ============================================================
   * 5×5 风格 / PDF
   * ============================================================ */
  function randomStyleStep() {
    return Math.floor(Math.random() * THEMES.length * MOTIFS.length);
  }

  function applyTheme(step) {
    const total = THEMES.length * MOTIFS.length;
    let s = Number(step);
    if (!Number.isFinite(s) || s < 0) s = randomStyleStep();
    s = ((s % total) + total) % total;
    state.styleStep = s;

    const theme = THEMES[s % THEMES.length];
    const motif = MOTIFS[Math.floor(s / THEMES.length) % MOTIFS.length];

    document.documentElement.dataset.theme = theme.id;
    document.documentElement.dataset.motif = motif.id;

    const motifLabel = (motif.emoji ? motif.emoji + ' ' : '') + motif.name;
    const label = theme.emoji + ' ' + theme.name + ' × ' + motifLabel;
    const labelEl = $('#theme-label');
    if (labelEl) labelEl.textContent = label;
    const printTheme = $('#print-theme');
    if (printTheme) printTheme.textContent = theme.name + ' × ' + motifLabel;
    const sticker = $('#print-cover-sticker');
    if (sticker) sticker.textContent = motif.glyphs[0] || motif.emoji || '♡';

    renderMotifs(motif);
    updatePrintMeta();
  }

  function resetThemeAttrs() {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-motif');
    const layer = $('#motif-layer');
    if (layer) layer.innerHTML = '';
  }

  function renderMotifs(motif) {
    const layer = $('#motif-layer');
    if (!layer) return;
    const glyphs = (motif && motif.glyphs) || ['♡'];
    let html = '';
    for (let i = 0; i < 10; i += 1) {
      const glyph = glyphs[i % glyphs.length];
      html += '<span class="motif motif--' + (i + 1) + '">' + glyph + '</span>';
    }
    layer.innerHTML = html;
  }

  function shuffleTheme() {
    if (!state.report) return;
    const total = THEMES.length * MOTIFS.length;
    state.styleStep = ((state.styleStep < 0 ? 0 : state.styleStep) + 1) % total;
    applyTheme(state.styleStep);
    saveSession();
    toast('换好啦，这个风格喜欢吗？');
  }

  function updatePrintMeta() {
    const now = new Date();
    const date =
      now.getFullYear() +
      '.' +
      String(now.getMonth() + 1).padStart(2, '0') +
      '.' +
      String(now.getDate()).padStart(2, '0');
    const dateEl = $('#print-date');
    if (dateEl) dateEl.textContent = date;
    const yearEl = $('#print-year');
    if (yearEl) yearEl.textContent = String(now.getFullYear());

    const serialEl = $('#print-serial');
    if (serialEl) {
      const tail = state.code ? state.code.slice(-4) : 'DEMO';
      const ymd =
        String(now.getFullYear()).slice(2) +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0');
      serialEl.textContent = 'NO. TT-' + ymd + '-' + tail;
    }
  }

  /* ============================================================
   * 示例 / 续看 / 存储
   * ============================================================ */
  function startDemo() {
    clearTimeout(autoTimer);
    stopLoadingMessages();
    state.rankOrder = D.SAMPLE.rankOrder.slice();
    state.answers = JSON.parse(JSON.stringify(D.SAMPLE.answers));
    state.weights = Q.computeWeights(state.rankOrder);
    state.flow = [RANKING_Q].concat(Q.buildFlow(state.rankOrder));
    state.totalQuestions = state.flow.length;
    state.index = state.flow.length - 1;
    state.report = Q.parseAIReport(D.SAMPLE.aiText);
    state.demo = true;
    state.finished = true;
    state.code = '';
    state.remaining = null;
    state.quota = null;
    state.styleStep = randomStyleStep();
    state.reportMeta = { demo: true };

    renderResult();
    showView('result');
  }

  function saveSession() {
    if (state.demo) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 2,
          rankOrder: state.rankOrder,
          answers: state.answers,
          report: state.report,
          totalQuestions: state.totalQuestions,
          code: state.code,
          remaining: state.remaining,
          quota: state.quota,
          styleStep: state.styleStep,
          savedAt: Date.now()
        })
      );
    } catch (e) {
      /* 隐私模式 / 无存储时忽略 */
    }
  }

  function readSession() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.version !== 2) return null;
      if (!Array.isArray(data.rankOrder) || data.rankOrder.length !== D.DIMS.length) {
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  function resumeSaved() {
    const saved = readSession();
    if (!saved) {
      updateHome();
      return;
    }
    try {
      state.rankOrder = saved.rankOrder;
      state.answers = saved.answers || {};
      state.weights = Q.computeWeights(state.rankOrder);
      state.flow = [RANKING_Q].concat(Q.buildFlow(state.rankOrder));
      state.totalQuestions = saved.totalQuestions || state.flow.length;
      state.index = state.flow.length - 1;
      state.report = saved.report || null;
      state.code = String(saved.code || '').replace(/\D/g, '').slice(0, 8);
      state.remaining = typeof saved.remaining === 'number' ? saved.remaining : null;
      state.quota = typeof saved.quota === 'number' ? saved.quota : null;
      state.styleStep =
        typeof saved.styleStep === 'number'
          ? saved.styleStep
          : state.report
            ? randomStyleStep()
            : -1;
      state.demo = false;
      state.finished = true;
      state.reportMeta = null;
      renderResult();
      showView('result');
    } catch (e) {
      toast('上次的记录读不出来，重新测一次吧～');
      updateHome();
    }
  }

  /* ============================================================
   * 复制 / 小工具
   * ============================================================ */
  function copyCaption() {
    const text = $('#caption-text') ? $('#caption-text').value : '';
    if (!text) return;
    const btn = $('[data-act="copy-caption"]');
    const original = btn ? btn.textContent : '';
    copyText(text)
      .then(function () {
        toast('文案复制好啦 ✓');
        if (btn) {
          btn.textContent = '已复制 ✓';
          setTimeout(function () {
            btn.textContent = original;
          }, 1600);
        }
      })
      .catch(function () {
        toast('复制失败了，长按输入框手动复制吧');
      });
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () {
        return fallbackCopy(text);
      });
    }
    return new Promise(function (resolve, reject) {
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
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    if (!ok) throw new Error('copy failed');
  }

  function renderDebug(calc) {
    if (!debugMode) return;
    const panel = $('#debug-panel');
    if (!panel) return;
    panel.hidden = false;
    $('#debug-pre').textContent = JSON.stringify(
      {
        rankOrder: state.rankOrder,
        weights: calc.weights,
        preferenceWeights: Q.preferenceWeights(calc),
        priceBoosted: calc.priceBoosted,
        totalQuestions: state.totalQuestions,
        flow: state.flow.map(function (q) {
          return q.id;
        }),
        codeTail: state.code ? '****' + state.code.slice(-4) : '',
        remaining: state.remaining,
        styleStep: state.styleStep,
        reportItems: state.report ? state.report.mains.length + state.report.backups.length : 0
      },
      null,
      2
    );
  }

  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('is-show');
    }, 2200);
  }

  function shake(el) {
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  init();
})();
