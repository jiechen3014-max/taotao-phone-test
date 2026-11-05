/* ============================================================
 * 服务端校验：只相信结构化答案，不接收前端传的 prompt
 * ============================================================ */
'use strict';

const DATA = require('../assets/js/questions.js');
const Q = require('../assets/js/engine.js');

class ValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ValidationError';
    this.code = code || 'BAD_REQUEST';
    this.status = 400;
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateRankOrder(value) {
  if (!Array.isArray(value) || value.length !== DATA.DIMS.length) {
    throw new ValidationError('排序数据不完整，请回到第 1 题重新排序');
  }
  const ids = DATA.DIMS.map((d) => d.id);
  const seen = new Set();
  value.forEach((id) => {
    if (!ids.includes(id) || seen.has(id)) {
      throw new ValidationError('排序数据不合法');
    }
    seen.add(id);
  });
  return value.slice();
}

function validateAnswers(answers, flow) {
  if (!isPlainObject(answers)) {
    throw new ValidationError('答案数据不完整');
  }

  const cleaned = {};
  for (const q of flow) {
    const value = answers[q.id];

    if (q.type === 'multi') {
      if (!Array.isArray(value)) {
        throw new ValidationError('第 ' + q.id + ' 题还没有选');
      }
      if (q.max && value.length > q.max) {
        throw new ValidationError('第 ' + q.id + ' 题选得太多了');
      }
      const keys = [];
      for (const key of value) {
        if (typeof key !== 'string' || !Q.getOption(q, key)) {
          throw new ValidationError('第 ' + q.id + ' 题选项不合法');
        }
        if (!keys.includes(key)) keys.push(key);
      }
      cleaned[q.id] = keys;
    } else {
      if (typeof value !== 'string' || !Q.getOption(q, value)) {
        throw new ValidationError('第 ' + q.id + ' 题还没有选');
      }
      cleaned[q.id] = value;
    }
  }

  return cleaned;
}

/**
 * @param {object} body
 * @returns {{rankOrder: string[], answers: object, flow: object[], calc: object}}
 */
function validateQuizPayload(body) {
  if (!isPlainObject(body)) {
    throw new ValidationError('请求格式不正确');
  }
  const rankOrder = validateRankOrder(body.rankOrder);
  let flow;
  let calc;
  try {
    flow = Q.buildFlow(rankOrder);
    calc = Q.computeWeights(rankOrder);
  } catch (err) {
    throw new ValidationError('排序数据不合法');
  }

  if (flow.length + 1 > DATA.MAX_QUESTIONS) {
    throw new ValidationError('题目数量超出上限');
  }

  const answers = validateAnswers(body.answers, flow);
  return { rankOrder, answers, flow, calc };
}

function validateRequestId(value) {
  if (value == null) return '';
  const s = String(value);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(s)) {
    throw new ValidationError('请求标识不合法');
  }
  return s;
}

module.exports = {
  ValidationError,
  validateQuizPayload,
  validateRequestId,
  isPlainObject
};
