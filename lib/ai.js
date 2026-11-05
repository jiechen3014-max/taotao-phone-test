/* ============================================================
 * DeepSeek 调用：一次请求、只拿最终文本、不流式、不透传 key
 * ============================================================ */
'use strict';

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

class AiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'AiError';
    this.code = code || 'AI_ERROR';
    this.status = status || 502;
  }
}

function normalizeBase(base) {
  return String(base || DEFAULT_BASE).replace(/\/+$/, '');
}

function friendlyError(status) {
  if (status === 401 || status === 403) {
    return new AiError('AI 服务的密钥无效，请联系店主', 'AI_AUTH', 503);
  }
  if (status === 402) {
    return new AiError('AI 服务的余额不足，请联系店主', 'AI_BALANCE', 503);
  }
  if (status === 429) {
    return new AiError('AI 现在有点忙，请 1 分钟后再试', 'AI_BUSY', 503);
  }
  if (status >= 500) {
    return new AiError('AI 服务暂时不可用，请稍后再试', 'AI_UNAVAILABLE', 503);
  }
  return new AiError('AI 生成失败，请稍后再试', 'AI_ERROR', 502);
}

/**
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} opts.apiKey
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.model]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{content: string, usage: object}>}
 */
async function callDeepSeek(opts) {
  const {
    prompt,
    apiKey,
    baseUrl = process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE,
    model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
    maxTokens = Number(process.env.DEEPSEEK_MAX_TOKENS) || 1800,
    timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS) || 75000
  } = opts || {};

  if (!apiKey) {
    throw new AiError('AI 服务还没有配置，请联系店主', 'AI_NOT_CONFIGURED', 503);
  }
  if (!prompt || typeof prompt !== 'string') {
    throw new AiError('缺少生成内容', 'BAD_PROMPT', 500);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(normalizeBase(baseUrl) + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              '你只输出最终的手机推荐报告。严格按用户给出的格式输出，不要输出思考过程、分析、寒暄、开场白，也不要输出 markdown 表格。你的回答会被程序直接解析，格式错误会导致失败。'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.6,
        top_p: 0.9,
        max_tokens: maxTokens,
        stream: false
      }),
      signal: controller.signal
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new AiError('AI 思考超时了，请重试一次', 'AI_TIMEOUT', 504);
    }
    throw new AiError('连不上 AI 服务，请稍后再试', 'AI_NETWORK', 502);
  } finally {
    clearTimeout(timer);
  }

  let bodyText = '';
  try {
    bodyText = await response.text();
  } catch (err) {
    throw new AiError('读取 AI 结果失败，请重试', 'AI_READ', 502);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const parsed = JSON.parse(bodyText);
      detail = parsed && parsed.error ? String(parsed.error.message || '') : '';
    } catch (e) {
      detail = bodyText.slice(0, 200);
    }
    console.error('[ai] DeepSeek HTTP', response.status, detail.slice(0, 300));
    throw friendlyError(response.status);
  }

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch (err) {
    throw new AiError('AI 返回格式异常，请重试', 'AI_BAD_JSON', 502);
  }

  const choice = data && data.choices && data.choices[0];
  const content = choice && choice.message ? choice.message.content : '';
  if (!content || typeof content !== 'string') {
    throw new AiError('AI 没有返回内容，请重试', 'AI_EMPTY', 502);
  }
  if (content.length > 30000) {
    throw new AiError('AI 返回内容过长，请重试', 'AI_TOO_LONG', 502);
  }

  return {
    content: content.trim(),
    usage: data.usage || null,
    model: data.model || model,
    finishReason: choice.finish_reason || ''
  };
}

module.exports = {
  callDeepSeek,
  AiError,
  DEFAULT_MODEL
};
