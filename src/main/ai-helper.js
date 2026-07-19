'use strict';

// ===== AI 辅助模块 =====
// 提供 AES-256-GCM 加密存储、配置读写、callLLM 通用调用
// 支持 OpenAI 兼容 API（OpenAI/DeepSeek/Moonshot/通义千问等）

const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { app } = require('electron');

// 延迟计算密钥（app.getPath 需在 app ready 后可用）
let _encKey = null;
let _configFile = null;

function getEncKey() {
  if (!_encKey) {
    _encKey = crypto.scryptSync(app.getPath('userData'), 'web-scout-salt', 32);
  }
  return _encKey;
}

function getConfigFile() {
  if (!_configFile) {
    _configFile = path.join(app.getPath('userData'), 'ai-config.enc');
  }
  return _configFile;
}

// AES-256-GCM 加密：输出 base64(iv[12] + tag[16] + ciphertext)
function encrypt(text) {
  if (text == null) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncKey(), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(encryptedB64) {
  if (!encryptedB64) return '';
  const buf = Buffer.from(encryptedB64, 'base64');
  if (buf.length < 29) throw new Error('密文长度不足');
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const enc = buf.slice(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

// API Key 脱敏：sk-abcdef1234 -> sk-****1234
function maskApiKey(key) {
  if (!key) return '';
  const s = String(key);
  if (s.length <= 8) return '****';
  return s.slice(0, 3) + '****' + s.slice(-4);
}

// 保存配置（apiKey 加密后写入 ai-config.enc）
function saveConfig(cfg) {
  const toSave = {
    endpoint: cfg.endpoint || '',
    apiKey: cfg.apiKey ? encrypt(cfg.apiKey) : '',
    model: cfg.model || '',
    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.7,
    maxTokens: cfg.maxTokens || 2048,
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(getConfigFile(), JSON.stringify(toSave, null, 2), 'utf8');
}

// 读取配置（解密 apiKey）
function loadConfig() {
  const fp = getConfigFile();
  if (!fs.existsSync(fp)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (raw.apiKey) {
      try { raw.apiKey = decrypt(raw.apiKey); } catch (e) { raw.apiKey = ''; }
    }
    return raw;
  } catch (e) {
    return null;
  }
}

// 同步：是否有可用配置
function hasAiConfig() {
  const cfg = loadConfig();
  return !!(cfg && cfg.apiKey && cfg.endpoint && cfg.model);
}

// 返回脱敏配置（供 UI 显示）
function getMaskedConfig() {
  const cfg = loadConfig();
  if (!cfg) {
    return { hasKey: false, endpoint: '', apiKey: '', model: '', temperature: 0.7, maxTokens: 2048 };
  }
  return {
    endpoint: cfg.endpoint || '',
    apiKey: maskApiKey(cfg.apiKey),
    hasKey: !!cfg.apiKey,
    model: cfg.model || '',
    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.7,
    maxTokens: cfg.maxTokens || 2048,
  };
}

// 拼接 chat completions URL：endpoint 已含 /chat/completions 则直接用，否则拼接
function buildChatUrl(endpoint) {
  const base = String(endpoint || '').replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(base)) return base;
  return base + '/chat/completions';
}

// 底层 HTTP POST
function httpPost(urlStr, bodyObj, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      reject(new Error('无效的 endpoint URL'));
      return;
    }
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const agent = isHttps
      ? new https.Agent({ keepAlive: false, rejectUnauthorized: false })
      : new http.Agent({ keepAlive: false });
    const bodyStr = JSON.stringify(bodyObj);
    const reqOpts = {
      method: 'POST',
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      }, headers || {}),
      agent: agent,
    };
    const req = lib.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    if (timeoutMs && timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('请求超时（' + Math.round(timeoutMs / 1000) + 's）'));
      });
    }
    req.write(bodyStr);
    req.end();
  });
}

// 用指定配置调用 LLM（内部函数）
async function callLLMWithConfig(cfg, messages, opts) {
  opts = opts || {};
  if (!cfg || !cfg.apiKey || !cfg.endpoint || !cfg.model) {
    return { success: false, error: '未配置 AI 模型，请先在 AI 配置中填写 Endpoint / API Key / Model' };
  }
  const temperature = typeof opts.temperature === 'number'
    ? opts.temperature
    : (typeof cfg.temperature === 'number' ? cfg.temperature : 0.7);
  const maxTokens = typeof opts.maxTokens === 'number'
    ? opts.maxTokens
    : (cfg.maxTokens || 2048);
  const timeout = opts.timeout || 60000;

  const url = buildChatUrl(cfg.endpoint);
  const body = {
    model: cfg.model,
    messages: messages,
    temperature: temperature,
    max_tokens: maxTokens,
  };
  if (opts.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  let resp;
  try {
    resp = await httpPost(url, body, { 'Authorization': 'Bearer ' + cfg.apiKey }, timeout);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (/超时|timeout/i.test(msg)) {
      return { success: false, error: '网络错误：请求超时' };
    }
    return { success: false, error: '网络错误：' + msg };
  }

  if (resp.statusCode < 200 || resp.statusCode >= 300) {
    let detail = '';
    try {
      const errJson = JSON.parse(resp.body);
      if (errJson.error && errJson.error.message) detail = errJson.error.message;
      else if (errJson.message) detail = errJson.message;
    } catch (e) {
      if (resp.body) detail = resp.body.slice(0, 200);
    }
    let errorType = 'API 返回错误';
    if (resp.statusCode === 401) errorType = 'API Key 无效或未授权（401）';
    else if (resp.statusCode === 403) errorType = 'API 拒绝访问（403）';
    else if (resp.statusCode === 429) errorType = 'API 配额不足或请求频率超限（429）';
    else if (resp.statusCode >= 500) errorType = 'API 服务端错误（' + resp.statusCode + '）';
    return { success: false, error: errorType + (detail ? '：' + detail : ''), statusCode: resp.statusCode };
  }

  try {
    const data = JSON.parse(resp.body);
    const content = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    return { success: true, content: content, usage: data.usage || null };
  } catch (e) {
    return { success: false, error: '解析 API 响应失败：' + (e.message || String(e)) };
  }
}

// 通用 callLLM：读取已保存配置调用
async function callLLM(messages, opts) {
  const cfg = loadConfig();
  return callLLMWithConfig(cfg, messages, opts);
}

// 测试连接（使用临时配置，发送 ping）
async function testConnection(tempConfig) {
  const result = await callLLMWithConfig(tempConfig,
    [{ role: 'user', content: 'ping' }],
    { maxTokens: 50, timeout: 15000 }
  );
  if (result.success) {
    return { success: true, response: result.content || '(空响应)' };
  }
  return { success: false, response: null, error: result.error };
}

// JSON 容错解析：提取 markdown 代码块或首个 JSON 对象/数组
function parseLLMJson(content) {
  if (!content) return null;
  let text = String(content).trim();
  // 去除 markdown 代码块包裹
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }
  // 直接尝试
  try { return JSON.parse(text); } catch (e) { /* continue */ }
  // 提取数组
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch (e) { /* continue */ }
  }
  // 提取对象
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch (e) { /* continue */ }
  }
  return null;
}

module.exports = {
  encrypt,
  decrypt,
  maskApiKey,
  saveConfig,
  loadConfig,
  hasAiConfig,
  getMaskedConfig,
  callLLM,
  callLLMWithConfig,
  testConnection,
  parseLLMJson,
  buildChatUrl,
};
