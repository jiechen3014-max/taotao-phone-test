/* 逻辑自测：node tests/engine.test.js */
'use strict';

const assert = require('assert');
const DATA = require('../assets/js/questions.js');
const Q = require('../assets/js/engine.js');

let checks = 0;
function ok(cond, msg) {
  checks += 1;
  assert.ok(cond, msg);
}

/* ---------- 1. 全排列：权重合计 100，价格永远在前三 ---------- */
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  arr.forEach((v, i) => {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    permutations(rest).forEach((p) => out.push([v].concat(p)));
  });
  return out;
}

const ids = DATA.DIMS.map((d) => d.id);
const perms = permutations(ids);
ok(perms.length === 720, '应有 720 种排序');

let boosted = 0;
perms.forEach((order) => {
  const calc = Q.computeWeights(order);
  const vals = Object.values(calc.weights);
  const sum = vals.reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, 100, '权重合计应为 100：' + order.join(','));
  const sorted = Q.sortedDimIds(calc.weights, calc.rank);
  const pos = sorted.indexOf('price');
  assert.ok(pos <= 2, '价格掉出前三：' + order.join(',') + ' => ' + JSON.stringify(calc.weights));
  if (calc.priceBoosted) boosted += 1;
  vals.forEach((v) => assert.ok(v > 0, '权重不能为 0'));
  const pref = Q.preferenceWeights(calc);
  assert.strictEqual(
    Object.values(pref).reduce((a, b) => a + b, 0),
    100,
    '对外偏好权重应合计 100'
  );
  assert.ok(!('price' in pref), '对外偏好权重不应包含价格');
});
ok(boosted === 720 - 6 * 5 * 4 * 3, '价格不在前三的排列数量应正确');

/* ---------- 2. 动态出题 ---------- */
let maxFlow = 0;
let minFlow = 99;
perms.forEach((order) => {
  const flow = Q.buildFlow(order);
  const total = flow.length + 1; // + 第 1 题排序
  maxFlow = Math.max(maxFlow, total);
  minFlow = Math.min(minFlow, total);
  ok(total <= DATA.MAX_QUESTIONS, '总题数超限：' + total);
  const seen = {};
  flow.forEach((q) => {
    assert.ok(!seen[q.id], '题目重复：' + q.id);
    seen[q.id] = true;
  });
  // 价格题在最前
  assert.ok(flow[0].dim === 'price', '价格题应排在最前');
  // 非前三维度只保留核心题
  const top3 = order.slice(0, 3);
  flow.forEach((q) => {
    if (q.deep) assert.ok(top3.includes(q.dim), '非前三维度不应出现进阶题：' + q.id);
  });
});
ok(maxFlow <= 30, '最大题数应 ≤ 30');
console.log(`   题数范围：${minFlow}–${maxFlow} 题（含排序），价格被抬进前三的排列：${boosted}`);

/* ---------- 3. Prompt ---------- */
const sampleCalc = Q.computeWeights(DATA.SAMPLE.rankOrder);
const pref = Q.preferenceWeights(sampleCalc);
ok(Object.keys(pref).length === 5 && !('price' in pref), '对外权重不应包含价格');
ok(Object.values(pref).reduce((a, b) => a + b, 0) === 100, '对外权重合计应为 100');
ok(Q.preferenceOrder(sampleCalc).indexOf('price') === -1, '偏好排序不应包含价格');
ok(Q.getSummary(sampleCalc).includes('影像优先'), '画像总结应使用偏好权重');

const prompt = Q.buildPrompt(
  {
    rankOrder: DATA.SAMPLE.rankOrder,
    answers: DATA.SAMPLE.answers,
    weights: sampleCalc
  },
  'doubao'
);
ok(prompt.includes('【主推1】'), 'Prompt 应包含主推格式');
ok(prompt.includes('【备选3】'), 'Prompt 应包含备选格式');
ok(prompt.includes('2 款「主推」'), 'Prompt 应明确 2 主推');
ok(prompt.includes('4,000–5,500 元'), 'Prompt 应包含预算');
ok(prompt.includes('拍照'), 'Prompt 应包含权重');
ok(prompt.includes('预算红线'), 'Prompt 应包含预算硬约束');
ok(prompt.includes('价格态度'), 'Prompt 应包含价格态度');
ok(!prompt.includes('价格 19%'), 'Prompt 不应暴露价格被抬高的权重');

const flexPrompt = Q.buildPrompt(
  {
    rankOrder: DATA.SAMPLE.rankOrder,
    answers: Object.assign({}, DATA.SAMPLE.answers, { p1: 'flex', p2: 'used' }),
    weights: sampleCalc
  },
  'doubao'
);
ok(flexPrompt.includes('没有硬预算'), '无硬预算应写进 Prompt');
ok(flexPrompt.includes('二手都可以'), '二手渠道应写进 Prompt');
ok(flexPrompt.includes('不要推荐明显溢价'), '无硬预算应提醒不要溢价');

const apiPrompt = Q.buildPrompt(
  { rankOrder: DATA.SAMPLE.rankOrder, answers: DATA.SAMPLE.answers, weights: sampleCalc },
  'api'
);
ok(apiPrompt.includes('只输出最终推荐结果'), 'API prompt 应只输出结果');
ok(apiPrompt.includes('两个视角'), 'API prompt 应包含双视角检查');
ok(prompt.includes('不要输出表格'), 'Prompt 应禁止表格');
const deepPrompt = Q.buildPrompt(
  { rankOrder: DATA.SAMPLE.rankOrder, answers: DATA.SAMPLE.answers, weights: sampleCalc },
  'deepseek'
);
ok(deepPrompt.includes('先花 2–3 句话') || deepPrompt.includes('先用 2–3 句话'), 'DeepSeek 版应有分析要求');

/* ---------- 4. 解析示例回答 ---------- */
const report = Q.parseAIReport(DATA.SAMPLE.aiText);
ok(report.mains.length === 2, '应解析出 2 个主推，实际 ' + report.mains.length);
ok(report.backups.length === 3, '应解析出 3 个备选，实际 ' + report.backups.length);
ok(report.mains[0].model === 'vivo X200 Pro mini', '机型解析错误：' + report.mains[0].model);
ok(report.mains[0].config === '12GB+256GB', '配置解析错误：' + report.mains[0].config);
ok(report.mains[0].price === '¥4,699', '价格解析错误：' + report.mains[0].price);
ok(report.mains[0].pros.length >= 2, '优点解析不足');
ok(report.mains[0].cons.length >= 1, '缺点解析不足');
ok(report.mains[0].fit.includes('爱拍照'), '适合谁解析错误');
ok(report.final.includes('闭眼选'), '最终建议解析错误');

const range = Q.parseAIReport('【主推1】vivo X200 Pro mini｜12+512GB｜约4,700–5,000元\n优点：轻\n缺点：贵\n适合：她');
ok(range.mains[0].price === '¥4,700–5,000', '区间价格解析错误：' + range.mains[0].price);
ok(range.mains[0].extra.length === 0, '价格不应再进入 extra');
ok(report.pitfall.includes('参数更强'), '避坑解析错误');
ok(report.intro.includes('拍照和颜值优先'), '开头解析错误');

/* ---------- 5. 兼容另一种写法 ---------- */
const alt = Q.parseAIReport(`**主推 1：** 小米 15｜12+256｜¥4499
- 优点：小屏手感好；性能强
- 缺点：续航一般
- 适合：喜欢小屏的人

### 备选 1：iPhone 16 | 128GB | 4999 元
优点：视频稳
缺点：贵

最终建议：买小米。
避坑提醒：别买 128G。`);
ok(alt.mains.length === 1, '兼容写法主推解析失败');
ok(alt.backups.length === 1, '兼容写法备选解析失败');
ok(alt.mains[0].model === '小米 15', '兼容写法机型错误：' + alt.mains[0].model);
ok(alt.mains[0].price === '¥4,499', '兼容写法价格错误：' + alt.mains[0].price);
ok(alt.final.includes('买小米'), '兼容写法最终建议失败');

/* ---------- 6. 示例数据完整性 ---------- */
const sampleFlow = Q.buildFlow(DATA.SAMPLE.rankOrder);
sampleFlow.forEach((q) => {
  assert.ok(
    Object.prototype.hasOwnProperty.call(DATA.SAMPLE.answers, q.id),
    '示例数据缺少答案：' + q.id
  );
});
const caption = Q.buildCaption(
  {
    rankOrder: DATA.SAMPLE.rankOrder,
    answers: DATA.SAMPLE.answers,
    weights: sampleCalc,
    totalQuestions: sampleFlow.length + 1
  },
  report
);
ok(caption.includes('vivo X200 Pro mini'), '文案应包含主推机型');
ok(caption.includes('#手机推荐'), '文案应包含话题标签');

console.log(`\n✅ 全部通过（${checks} 项检查）`);
