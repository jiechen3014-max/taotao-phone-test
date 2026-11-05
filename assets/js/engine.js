/* ============================================================
 * 核心逻辑：权重算法 / 动态出题 / Prompt 生成 / AI 回答解析
 * 无第三方依赖，浏览器和 Node 都能跑。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./questions.js'));
  } else {
    root.PhoneQuiz = factory(root.QUIZ_DATA);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DATA) {
  'use strict';

  const DIMS = DATA.DIMS;
  const QUESTIONS = DATA.QUESTIONS;
  const BASE_WEIGHTS = DATA.BASE_WEIGHTS;
  const MAX_QUESTIONS = DATA.MAX_QUESTIONS;

  const DIM_MAP = {};
  DIMS.forEach(function (d) {
    DIM_MAP[d.id] = d;
  });

  const QUESTION_MAP = {};
  QUESTIONS.forEach(function (q) {
    QUESTION_MAP[q.id] = q;
  });

  const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };

  const PROMPT_VARIANTS = {
    doubao: {
      id: 'doubao',
      name: '豆包',
      icon: '🫘',
      extra: '8. 语气可以活泼一点，用少量 emoji 分点，但别浮夸。'
    },
    deepseek: {
      id: 'deepseek',
      name: 'DeepSeek',
      icon: '🐳',
      extra: '8. 先用 2–3 句话分析她的取舍，再进入推荐；分析要短，不要长篇大论。'
    },
    api: {
      id: 'api',
      name: 'DeepSeek',
      icon: '🐳',
      extra:
        '8. 先从「体验派」和「实用派」两个视角各检查一遍，再合并成唯一结论；只输出最终推荐结果，不要输出思考过程、分析、开场白或结尾寒暄，不要解释你是怎么选的。'
    }
  };

  /* ============================================================
   * 权重
   * ============================================================ */

  /**
   * 把任意正数对象归一化成合计 100 的整数（最大余数法）。
   */
  function normalizeTo100(raw) {
    const keys = Object.keys(raw);
    const sum = keys.reduce(function (s, k) {
      return s + raw[k];
    }, 0);
    const out = {};
    const exact = {};
    let used = 0;

    keys.forEach(function (k) {
      exact[k] = (raw[k] / sum) * 100;
      out[k] = Math.floor(exact[k]);
      used += out[k];
    });

    let left = 100 - used;
    if (left > 0) {
      keys
        .slice()
        .sort(function (a, b) {
          return exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a]));
        })
        .forEach(function (k) {
          if (left > 0) {
            out[k] += 1;
            left -= 1;
          }
        });
    }

    // 极端情况下 remainder 可能超过 keys 数量，兜底
    let guard = 0;
    while (left > 0 && guard < 100) {
      out[keys[guard % keys.length]] += 1;
      left -= 1;
      guard += 1;
    }
    return out;
  }

  function sortedDimIds(weights, rank) {
    return Object.keys(weights).sort(function (a, b) {
      if (weights[b] !== weights[a]) return weights[b] - weights[a];
      return (rank[a] || 9) - (rank[b] || 9);
    });
  }

  /**
   * 用户可见的「偏好权重」：不展示价格。
   * 价格作为硬预算单独约束，避免把隐藏的价格保底暴露给用户。
   */
  function preferenceWeights(calc) {
    const raw = {};
    DIMS.forEach(function (d) {
      if (d.id !== 'price') raw[d.id] = calc.weights[d.id];
    });
    return normalizeTo100(raw);
  }

  function preferenceOrder(calc) {
    const w = preferenceWeights(calc);
    return Object.keys(w).sort(function (a, b) {
      if (w[b] !== w[a]) return w[b] - w[a];
      return (calc.rank[a] || 9) - (calc.rank[b] || 9);
    });
  }

  /**
   * 隐藏规则：不管用户把「价格」排第几，价格的权重都不会掉出前三。
   * 若排在第 4–6 位，先抬到「第 3 名 + 3」，归一化后再用整数微调保证严格进前三。
   */
  function enforcePriceTopThree(weights, rank) {
    const w = Object.assign({}, weights);
    for (let guard = 0; guard < 12; guard += 1) {
      const order = sortedDimIds(w, rank);
      const pos = order.indexOf('price');
      if (pos <= 2) break;

      const donors = order
        .slice(3)
        .filter(function (id) {
          return id !== 'price';
        })
        .sort(function (a, b) {
          if (w[a] !== w[b]) return w[a] - w[b];
          return (rank[b] || 0) - (rank[a] || 0);
        });

      const donor = donors[0];
      if (!donor || w[donor] <= 1) break;
      w[donor] -= 1;
      w.price += 1;
    }
    return w;
  }

  /**
   * @param {string[]} rankOrder 六个维度 id，从最在意到最不在意
   * @returns {{weights: Object, rank: Object, order: string[], priceBoosted: boolean}}
   */
  function computeWeights(rankOrder) {
    if (!Array.isArray(rankOrder) || rankOrder.length !== DIMS.length) {
      throw new Error('rankOrder 必须包含全部 ' + DIMS.length + ' 个维度');
    }
    const seen = {};
    rankOrder.forEach(function (id) {
      if (!DIM_MAP[id] || seen[id]) throw new Error('rankOrder 维度不合法：' + id);
      seen[id] = true;
    });

    const rank = {};
    const raw = {};
    rankOrder.forEach(function (id, i) {
      rank[id] = i + 1;
      raw[id] = BASE_WEIGHTS[i];
    });

    const priceBoosted = rank.price > 3;
    if (priceBoosted) {
      // 第 3 名的原始权重 + 3；归一化后仍稳定落在前三
      raw.price = BASE_WEIGHTS[2] + 3;
    }

    let weights = normalizeTo100(raw);
    weights = enforcePriceTopThree(weights, rank);

    return {
      weights: weights,
      rank: rank,
      order: sortedDimIds(weights, rank),
      priceBoosted: priceBoosted
    };
  }

  /* ============================================================
   * 动态出题
   * ============================================================ */

  /**
   * 前 3 名的维度问「核心题 + 进阶题」，其余维度只问核心题。
   * 价格题始终放在最前面（预算是最实在的约束）。
   * 最多返回 MAX_QUESTIONS - 1 道题（第 1 题是排序）。
   */
  function buildFlow(rankOrder) {
    const calc = computeWeights(rankOrder);
    const rank = calc.rank;
    const topThree = rankOrder.slice(0, 3);
    const dims = ['price'].concat(
      rankOrder.filter(function (id) {
        return id !== 'price';
      })
    );

    let flow = [];
    dims.forEach(function (dim) {
      QUESTIONS.filter(function (q) {
        return q.dim === dim;
      }).forEach(function (q) {
        if (!q.deep || topThree.indexOf(dim) !== -1) flow.push(q);
      });
    });

    // 通用题永远问
    QUESTIONS.filter(function (q) {
      return q.dim === 'universal';
    }).forEach(function (q) {
      flow.push(q);
    });

    // 兜底：万一以后加题超过上限，优先删掉权重最低维度的进阶题
    const limit = MAX_QUESTIONS - 1;
    if (flow.length > limit) {
      const removable = flow
        .filter(function (q) {
          return q.deep;
        })
        .sort(function (a, b) {
          return (rank[b.dim] || 0) - (rank[a.dim] || 0);
        });
      while (flow.length > limit && removable.length) {
        const q = removable.shift();
        flow = flow.filter(function (item) {
          return item.id !== q.id;
        });
      }
    }

    return flow;
  }

  /* ============================================================
   * 答案格式化
   * ============================================================ */

  function getQuestion(id) {
    return QUESTION_MAP[id] || null;
  }

  function getOption(q, key) {
    if (!q || !q.options) return null;
    for (let i = 0; i < q.options.length; i += 1) {
      if (q.options[i].k === key) return q.options[i];
    }
    return null;
  }

  function answerLabel(q, value) {
    if (!q) return '';
    if (q.type === 'multi') {
      const arr = Array.isArray(value) ? value : [];
      if (!arr.length) return q.skipLabel ? '没有特别要求' : '未填写';
      return arr
        .map(function (k) {
          const o = getOption(q, k);
          return o ? o.label : k;
        })
        .join('、');
    }
    const o = getOption(q, value);
    return o ? o.label : '';
  }

  function hasAnswer(q, value) {
    if (q.type === 'multi') return Array.isArray(value);
    return typeof value === 'string' && value.length > 0;
  }

  function getBudgetLabel(answers) {
    return answerLabel(getQuestion('p1'), answers.p1) || '未填写';
  }

  function getSummary(calc) {
    const order = preferenceOrder(calc);
    const top1 = DIM_MAP[order[0]];
    const top2 = DIM_MAP[order[1]];
    if (!top1) return '';

    const tags = {
      photo: '影像优先',
      video: '视频优先',
      gaming: '性能优先',
      audio: '音质优先',
      brand: '品牌优先',
      price: '预算卡点'
    };

    const tag1 = tags[top1.id] || top1.name;
    const tag2 = tags[top2.id] || top2.name;

    return (
      '你是「' + tag1 + ' · ' + tag2 + '」型选手，最值得把预算花在' +
      top1.name + '和' + top2.name + '上。'
    );
  }

  /* ============================================================
   * Prompt 生成
   * ============================================================ */

  function line(label, value) {
    return value ? '- ' + label + '：' + value : '';
  }

  function buildPrompt(state, variantId) {
    const calc = state.weights || computeWeights(state.rankOrder);
    const answers = state.answers || {};
    const flow = buildFlow(state.rankOrder);
    const asked = {};
    flow.forEach(function (q) {
      asked[q.id] = true;
    });

    function a(id) {
      if (!asked[id]) return '';
      const q = getQuestion(id);
      if (!q || !hasAnswer(q, answers[id])) return '';
      return answerLabel(q, answers[id]);
    }

    const pref = preferenceWeights(calc);
    const prefOrder = preferenceOrder(calc);
    const weightLine = prefOrder
      .map(function (id) {
        return DIM_MAP[id].name + ' ' + pref[id] + '%';
      })
      .join(' · ');

    const priceRank = calc.rank.price;
    const budgetLabel = getBudgetLabel(answers);
    const budgetIsFlex = answers.p1 === 'flex';
    const priceAttitude = budgetIsFlex
      ? '按值不值判断，不要为用不上的功能多花钱'
      : priceRank <= 2
        ? '预算内优先性价比，能省则省'
        : priceRank <= 4
          ? '预算内均衡考虑，不必刻意省'
          : '预算内可以选体验更好的，不必为了省钱牺牲核心体验';
    const budgetRule = budgetIsFlex
      ? '没有固定预算，但每款都要说明价格是否值，不要推荐明显溢价的机型。'
      : '价格不能超预算。预算内确实没有合适的，直接说明，并给一个最接近预算的替代方案。';

    const channel = answers.p2 || 'new';
    const channelRule =
      channel === 'prev'
        ? '优先全新国行，也可以接受上一代旗舰或官方翻新，注明成色和保修'
        : channel === 'used'
          ? '全新、官翻、成色好的二手都可以，但要说清渠道、价格和风险'
          : channel === 'trade'
            ? '按以旧换新后的实际到手价算，说明旧机抵扣的大致影响'
            : channel === 'contract'
              ? '可以给合约机或分期方案，但要说清合约期限和总成本'
              : '优先全新国行';

    const thisYear = new Date().getFullYear();
    const yearRange = thisYear - 1 + '–' + thisYear;

    const hard = [
      line(
        budgetIsFlex ? '预算' : '预算红线',
        budgetIsFlex
          ? budgetLabel + '，但不要推荐明显溢价的机型'
          : budgetLabel + '（硬性约束，任何推荐都不得超预算）'
      ),
      line('价格态度', priceAttitude + (budgetIsFlex ? '' : '（价格在她的排序中排第 ' + priceRank + ' 位）')),
      line('购机方式', a('p2')),
      line('品牌偏好', a('b1')),
      line('系统', a('u3')),
      line('存储', a('u6')),
      line('必须有', a('u4')),
      line('换机时间', a('u7')),
      line('打算用多久', a('p3'))
    ].filter(Boolean);

    const scene = [
      line('常拍题材', a('c1')),
      line('自拍频率', a('c2')),
      line('长焦使用', a('c3')),
      line('照片风格', a('c4')),
      line('常拍视频', a('v1')),
      line('视频最在意', a('v2')),
      line('听歌方式', a('a1')),
      line('听歌场景', a('a2')),
      line('常玩游戏', a('g1')),
      line('游戏强度', a('g2')),
      line('游戏最怕', a('g3')),
      line('外观偏好', a('b3')),
      line('设备生态', a('b2')),
      line('手感偏好', a('u1')),
      line('续航底线', a('u2')),
      line('最忍不了', a('u5'))
    ].filter(Boolean);

    const variant = PROMPT_VARIANTS[variantId] || PROMPT_VARIANTS.doubao;

    const prompt = [
      '你是一位很懂中国手机市场的购机顾问，说话像小红书姐妹：直接、懂行、不堆参数、不恰饭。请根据下面这位女生的真实需求，帮她选一台最适合的手机。',
      '',
      '【她的购机权重】（偏好维度，合计 100%；预算单独看）',
      weightLine,
      '',
      '【硬性条件】',
      hard.join('\n'),
      '',
      '【她的真实使用场景】',
      scene.join('\n'),
      '',
      '【推荐要求】',
      '1. 只推荐中国大陆能买到、售后和渠道说得清楚的机型；' + channelRule + '。机型以 ' + yearRange + ' 年在售为主；不推荐已停产、小众冷门、需要加价抢购的机器。',
      '2. 2 款「主推」：最贴合她前两项权重和预算；3 款「备选」：各有明确取舍，方便她对比。',
      '3. 每款写清：机型 + 建议配置、参考价、2–3 个优点、1–2 个缺点、适合谁。',
      '4. 5 款机型不能重复（不同内存版本也算重复）；' + budgetRule,
      '5. 用大白话讲「这对她意味着什么」，不要罗列参数表，不要堆跑分。',
      '6. 参考价写当前主流电商常见到手价；不确定就写区间，不要编造精确数字。',
      '7. 总字数 600–800 字，最后给一句「闭眼买」结论 + 一句避坑提醒。',
      variant.extra,
      '不要输出表格。',
      '',
      '【输出格式】（严格按这个结构，方便我整理）',
      '先用一句话总结她是什么样的人（20 字内）。',
      '【主推1】机型｜建议配置｜参考价',
      '优点：…',
      '缺点：…',
      '适合：…',
      '【主推2】机型｜建议配置｜参考价',
      '优点：…',
      '缺点：…',
      '适合：…',
      '【备选1】机型｜建议配置｜参考价',
      '优点：…',
      '缺点：…',
      '适合：…',
      '【备选2】机型｜建议配置｜参考价',
      '优点：…',
      '缺点：…',
      '适合：…',
      '【备选3】机型｜建议配置｜参考价',
      '优点：…',
      '缺点：…',
      '适合：…',
      '【最终建议】…',
      '【避坑】…'
    ].join('\n');

    return prompt;
  }

  /* ============================================================
   * AI 回答解析
   * ============================================================ */

  function matchHeading(line) {
    const bracket = line.match(
      /^【\s*(主推|备选|首推|次选|推荐)\s*([1-5一二三四五])?\s*】\s*(.*)$/
    );
    if (bracket) {
      return {
        raw: bracket[1],
        kind: /备|次/.test(bracket[1]) ? 'backup' : 'main',
        num: bracket[2] ? CN_NUM[bracket[2]] || parseInt(bracket[2], 10) : null,
        rest: bracket[3] || ''
      };
    }
    const bare = line.match(
      /^(主推|备选|首推|次选|推荐)\s*([1-5一二三四五])\s*[:：｜|]\s*(.*)$/
    );
    if (bare) {
      return {
        raw: bare[1],
        kind: /备|次/.test(bare[1]) ? 'backup' : 'main',
        num: CN_NUM[bare[2]] || parseInt(bare[2], 10),
        rest: bare[3] || ''
      };
    }
    const alone = line.match(/^(主推|备选|首推|次选|推荐)\s*([1-5一二三四五])\s*$/);
    if (alone) {
      return {
        raw: alone[1],
        kind: /备|次/.test(alone[1]) ? 'backup' : 'main',
        num: CN_NUM[alone[2]] || parseInt(alone[2], 10),
        rest: ''
      };
    }
    return null;
  }

  function matchTail(line) {
    const m = line.match(
      /^【\s*(最终建议|最终推荐|总结|避坑提醒|避坑|注意事项)\s*】\s*[:：]?\s*(.*)$/
    );
    if (m) {
      return { key: /避坑|注意/.test(m[1]) ? 'pitfall' : 'final', rest: m[2] || '' };
    }
    const m2 = line.match(/^(最终建议|最终推荐|避坑提醒|避坑)\s*[:：]\s*(.*)$/);
    if (m2) {
      return { key: /避坑/.test(m2[1]) ? 'pitfall' : 'final', rest: m2[2] || '' };
    }
    return null;
  }

  function pushList(arr, text) {
    String(text || '')
      .split(/[；;]\s*/)
      .map(function (s) {
        return s.replace(/^[\s、,，.-]+/, '').trim();
      })
      .filter(Boolean)
      .forEach(function (s) {
        if (s.length > 1) arr.push(s);
      });
  }

  function looksLikeConfig(s) {
    return /(?:\d+\s*GB?\s*\+\s*\d+\s*GB?|\d+\s*\+\s*\d+|\d+\s*(?:GB|TB)|内存|存储|版本|全网通)/i.test(
      s
    );
  }

  function normalizePrice(raw) {
    if (!raw) return '';
    let s = String(raw)
      .replace(/^(?:参考价|到手价|价格|现价)\s*[:：]?\s*/, '')
      .replace(/[¥￥]/g, '')
      .replace(/\s*元\s*$/, '')
      .replace(/,/g, '')
      .trim();
    if (!s) return '';
    s = s.replace(/\s*[-–—~至]\s*/g, '–');
    s = s.replace(/\d+/g, function (n) {
      return n.length >= 4 ? n.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : n;
    });
    return '¥' + s;
  }

  function extractPrice(text) {
    if (!text) return '';
    // 支持 4,700 / 4700 / 4,700–5,000 / 约4,700–5,000元
    const NUM = '(?:\\d{1,3}(?:,\\d{3})+|\\d{3,5})';
    const RANGE = '\\s*[-–—~至]\\s*[¥￥]?\\s*' + NUM;
    const context = new RegExp(
      '(?:参考价|到手价|现价|价格|售价|约)\\s*[:：]?\\s*([¥￥]?\\s*' +
        NUM +
        '(?:' +
        RANGE +
        ')?\\s*元?)'
    );
    const currency = new RegExp(
      '([¥￥]\\s*' + NUM + '(?:' + RANGE + ')?\\s*元?)'
    );
    const withYuan = new RegExp('(' + NUM + '(?:' + RANGE + ')?)\\s*元');

    let m = text.match(context);
    if (m) return normalizePrice(m[1]);
    m = text.match(currency);
    if (m) return normalizePrice(m[1]);
    m = text.match(withYuan);
    if (m) return normalizePrice(m[1]);
    return '';
  }

  function finalizeItem(cur) {
    const item = {
      kind: cur.kind,
      num: cur.num,
      model: '',
      config: '',
      price: '',
      pros: [],
      cons: [],
      fit: '',
      extra: []
    };

    const titleLines = cur.title ? cur.title.slice() : [];
    let section = 'title';
    const sections = [];

    (cur.lines || []).forEach(function (raw) {
      const t = String(raw)
        .replace(/\*/g, '')
        .replace(/^[\s>•·\-–—]+/, '')
        .trim();
      if (!t) return;

      const sm = t.match(
        /^(优点|亮点|优势|推荐理由|缺点|短板|不足|适合|适合谁|一句话适合)\s*[:：]\s*(.*)$/
      );
      if (sm) {
        const key = sm[1];
        section = /缺点|短板|不足/.test(key)
          ? 'cons'
          : /适合/.test(key)
            ? 'fit'
            : 'pros';
        sections.push({ key: section, text: sm[2] || '' });
        if (sm[2]) {
          if (section === 'fit') item.fit += sm[2] + ' ';
          else pushList(item[section], sm[2]);
        }
        return;
      }

      if (section === 'title') {
        titleLines.push(t);
      } else if (section === 'fit') {
        item.fit += t + ' ';
      } else {
        pushList(item[section], t);
      }
    });

    // 标题：机型｜配置｜价格
    let titleText = titleLines.join(' ').replace(/\s+/g, ' ').trim();
    item.price = extractPrice(cur.title ? cur.title.join(' ') : '') || item.price;

    let parts = titleText
      .split(/[｜|]/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);

    if (parts.length > 1) {
      item.model = parts[0];
      for (let i = 1; i < parts.length; i += 1) {
        const p = parts[i];
        const partPrice = extractPrice(p);
        if (partPrice) {
          if (!item.price) item.price = partPrice;
          continue;
        }
        if (!item.config && looksLikeConfig(p)) {
          item.config = p;
        } else if (!item.price && /^\d{3,5}$/.test(p) && i === parts.length - 1) {
          item.price = '¥' + p;
        } else {
          item.extra.push(p);
        }
      }
    } else {
      item.model = parts[0] || '';
    }

    // 标题里可能残留价格
    if (!item.price) item.price = extractPrice(titleText);
    if (item.price) {
      item.model = item.model
        .replace(/[¥￥]\s*\d[\d,]*(?:\s*[-–—~至]\s*\d[\d,]*)?\s*(?:元|起)?\s*$/, '')
        .replace(/\s+\d{3,5}(?:\s*[-–—~至]\s*\d{3,5})?\s*元\s*$/, '')
        .replace(/(?:参考价|到手价|价格)\s*[:：]?.*$/, '')
        .trim();
    }

    // 有些模型会写「vivo X200 Pro mini 12+256」
    if (!item.config) {
      const cfg = item.model.match(/\s+(\d+\s*\+\s*\d+|\d+\s*GB?\s*\+\s*\d+\s*GB?)\s*$/i);
      if (cfg) {
        item.config = cfg[1];
        item.model = item.model.replace(cfg[0], '').trim();
      }
    }

    item.model = item.model.replace(/^[【\[「《]|[】\]」》]$/g, '').trim() || '待确认机型';
    item.config = item.config.replace(/^[【\[「《]|[】\]」》]$/g, '').trim();
    item.fit = item.fit.replace(/\s+/g, ' ').trim().replace(/[。；;]$/, '');
    item.pros = item.pros.slice(0, 5);
    item.cons = item.cons.slice(0, 4);

    return item;
  }

  function emptyReport(raw) {
    return {
      intro: '',
      mains: [],
      backups: [],
      final: '',
      pitfall: '',
      raw: raw || '',
      total: 0
    };
  }

  /**
   * 容错解析 AI 的回答。
   * 支持：【主推1】、**主推 1：**、主推一：、### 【备选2】 等写法。
   */
  function parseAIReport(text) {
    const src = String(text || '').replace(/\r\n?/g, '\n');
    if (!src.trim()) return emptyReport(src);

    const lines = src.split('\n');
    const items = [];
    const intro = [];
    const tail = { final: [], pitfall: [] };
    let cur = null;
    let mode = 'intro';

    function finish() {
      if (cur) {
        items.push(finalizeItem(cur));
        cur = null;
      }
    }

    lines.forEach(function (raw) {
      const plain = raw
        .replace(/\*/g, '')
        .replace(/^\s*#+\s*/, '')
        .trim();

      if (!plain) {
        if (mode === 'item' && cur) cur.lines.push('');
        else if (mode === 'final' || mode === 'pitfall') tail[mode].push('');
        else intro.push('');
        return;
      }

      const head = matchHeading(plain);
      if (head) {
        finish();
        cur = {
          kind: head.kind,
          num: head.num,
          title: head.rest ? [head.rest] : [],
          lines: []
        };
        mode = 'item';
        return;
      }

      const foot = matchTail(plain);
      if (foot) {
        finish();
        mode = foot.key;
        if (foot.rest) tail[foot.key].push(foot.rest);
        return;
      }

      if (mode === 'item' && cur) {
        cur.lines.push(raw);
      } else if (mode === 'final' || mode === 'pitfall') {
        tail[mode].push(raw);
      } else {
        intro.push(raw);
      }
    });

    finish();

    return {
      intro: intro.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
      mains: items.filter(function (i) {
        return i.kind === 'main';
      }),
      backups: items.filter(function (i) {
        return i.kind === 'backup';
      }),
      final: tail.final.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
      pitfall: tail.pitfall.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
      raw: src,
      total: items.length
    };
  }

  /* ============================================================
   * 小红书文案
   * ============================================================ */

  function buildCaption(state, report) {
    if (!report) return '';
    const main = report.mains[0] || report.backups[0];
    if (!main) return '';

    const calc = state.weights || computeWeights(state.rankOrder);
    const top = preferenceOrder(calc).slice(0, 2).map(function (id) {
      return DIM_MAP[id].name;
    });
    const budget = getBudgetLabel(state.answers || {});
    const total = state.totalQuestions || 0;
    const fit = (main.fit || '').replace(/^适合[:：]\s*/, '').replace(/[。；;]$/, '');

    const lines = [
      '测了 ' + total + ' 道题，我的本命手机是 ' + main.model + ' 📱',
      '',
      '预算 ' + budget + '，最在意' + top[0] + '和' + top[1] + '。',
      'AI 给了我 2 个主推 + 3 个备选，最后我锁定了 ' + main.model + '。',
      fit ? fit + '。' : '',
      '',
      '完整测试在主页，姐妹们自取～',
      '#手机推荐 #女生手机 #换手机 #数码好物 #选机攻略'
    ];
    return lines.filter(function (l) {
      return l !== '';
    }).join('\n');
  }

  return {
    DIMS: DIMS,
    QUESTIONS: QUESTIONS,
    PROMPT_VARIANTS: PROMPT_VARIANTS,
    computeWeights: computeWeights,
    preferenceWeights: preferenceWeights,
    preferenceOrder: preferenceOrder,
    buildFlow: buildFlow,
    buildPrompt: buildPrompt,
    parseAIReport: parseAIReport,
    buildCaption: buildCaption,
    answerLabel: answerLabel,
    getOption: getOption,
    getQuestion: getQuestion,
    hasAnswer: hasAnswer,
    getBudgetLabel: getBudgetLabel,
    getSummary: getSummary,
    getSummaryRaw: getSummary,
    sortedDimIds: sortedDimIds
  };
});
