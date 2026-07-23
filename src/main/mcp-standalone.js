#!/usr/bin/env node
// @ts-check
/**
 * Standalone MCP 入口（不依赖 Electron 主进程）
 *
 * 用途：让外部 AI（如 TRAE Work、Claude Desktop）通过 stdio 协议直接调用本应用的能力。
 *      无需启动 Electron 应用即可读取已保存的工作流/卡片数据，并提供基础页面抓取。
 *
 * 数据来源：
 *   - 工作流任务：  <userData>/data/aiworkflows/*.json
 *   - 抓取卡片：    <userData>/data/workflows/*.json
 *   - 跟踪状态：    <userData>/data/tracking-state.json（若存在）
 *   - 应用设置：    <userData>/data/settings.json
 *
 * 启动方式：
 *   node src/main/mcp-standalone.js              # 默认读写模式
 *   MCP_READONLY=true node src/main/mcp-standalone.js  # 只读模式
 *
 * TRAE Work 配置（.mcp.json）：
 *   {
 *     "mcpServers": {
 *       "web-scout": {
 *         "command": "node",
 *         "args": ["<项目路径>/src/main/mcp-standalone.js"]
 *       }
 *     }
 *   }
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { createMcpServer } = require('./mcp-server.js');

// ============ 数据目录定位（不依赖 Electron） ============

function getUserDataDir() {
  // 优先使用环境变量
  if (process.env.WEB_SCOUT_USER_DATA) {
    return process.env.WEB_SCOUT_USER_DATA;
  }
  const home = os.homedir();
  const appName = 'web-scout';
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), appName);
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', appName);
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), appName);
  }
}

const USER_DATA_DIR = getUserDataDir();
const DATA_DIR = path.join(USER_DATA_DIR, 'data');
const WORKFLOWS_DIR = path.join(DATA_DIR, 'workflows');
const AIWORKFLOWS_DIR = path.join(DATA_DIR, 'aiworkflows');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// ============ 工具函数 ============

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
  }
}

function readJsonSafe(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(dir, f));
  } catch (e) {
    return [];
  }
}

// ============ 数据访问实现 ============

/**
 * 列出所有抓取信息卡片（workflows）
 */
async function listCards() {
  const files = listJsonFiles(WORKFLOWS_DIR);
  const cards = [];
  for (const file of files) {
    const data = readJsonSafe(file, null);
    if (!data) continue;
    cards.push({
      id: data.id || path.basename(file, '.json'),
      title: data.title || '',
      url: data.url || '',
      cardType: data.cardType || 'media',
      sourceTaskType: data.sourceTaskType || null,
      resourceCount: Array.isArray(data.resources) ? data.resources.length : 0,
      createdAt: data.createdAt || null,
    });
  }
  cards.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return {
    total: cards.length,
    cards: cards
  };
}

/**
 * 列出所有 AI 工作流任务
 */
async function listWorkflows() {
  const files = listJsonFiles(AIWORKFLOWS_DIR);
  const tasks = [];
  for (const file of files) {
    const data = readJsonSafe(file, null);
    if (!data) continue;
    // 统计结果批次数
    const batches = Array.isArray(data.results) ? data.results.length : 0;
    const lastBatch = batches > 0 ? data.results[data.results.length - 1] : null;
    tasks.push({
      id: data.id || path.basename(file, '.json'),
      name: data.name || '未命名',
      type: data.type || 'unknown',
      status: data.status || 'idle',
      lastRunAt: data.lastRunAt || null,
      resultCount: batches,
      lastBatchId: lastBatch ? (lastBatch.id || lastBatch.batchId) : null,
      lastResultCount: lastBatch && Array.isArray(lastBatch.items) ? lastBatch.items.length : 0
    });
  }
  tasks.sort((a, b) => (b.lastRunAt || 0) - (a.lastRunAt || 0));
  return {
    total: tasks.length,
    tasks: tasks
  };
}

/**
 * 获取指定任务的详细结果
 */
async function getTaskResults(taskId, batchId) {
  if (!taskId) throw new Error('taskId 必填');
  const filePath = path.join(AIWORKFLOWS_DIR, taskId + '.json');
  const data = readJsonSafe(filePath, null);
  if (!data) throw new Error('任务不存在: ' + taskId);

  const results = Array.isArray(data.results) ? data.results : [];
  if (batchId) {
    const target = results.find(r => (r.id || r.batchId) === batchId);
    if (!target) throw new Error('批次不存在: ' + batchId);
    return {
      taskId: data.id,
      taskName: data.name,
      batchId: target.id || target.batchId,
      runAt: target.runAt || null,
      total: Array.isArray(target.items) ? target.items.length : 0,
      items: target.items || []
    };
  }
  // 返回所有批次摘要
  return {
    taskId: data.id,
    taskName: data.name,
    taskType: data.type,
    batches: results.map(r => ({
      batchId: r.id || r.batchId,
      runAt: r.runAt || null,
      count: Array.isArray(r.items) ? r.items.length : 0
    })),
    totalBatches: results.length
  };
}

/**
 * 跟踪任务状态查询（独立模式下从文件读取最近一次状态）
 */
async function getTrackingStatus() {
  const stateFile = path.join(DATA_DIR, 'tracking-state.json');
  const state = readJsonSafe(stateFile, { tasks: [] });
  // 同时从 aiworkflows 文件中补全跟踪任务基本信息
  const files = listJsonFiles(AIWORKFLOWS_DIR);
  const trackingTasks = [];
  for (const file of files) {
    const data = readJsonSafe(file, null);
    if (!data || data.type !== 'tracking') continue;
    const savedState = (state.tasks || []).find(t => t.taskId === data.id);
    trackingTasks.push({
      taskId: data.id,
      name: data.name,
      active: savedState ? !!savedState.active : false,
      lastRunAt: data.lastRunAt || null,
      nextCheckAt: savedState ? savedState.nextCheckAt : null,
      newCount: savedState ? (savedState.newCount || 0) : 0
    });
  }
  return { tasks: trackingTasks, total: trackingTasks.length };
}

/**
 * 简易页面抓取（standalone 模式）
 * 注：无法处理 SPA 动态页面（需 Electron 浏览器环境），仅做静态 HTML 解析
 */
async function scrapePage(url, selector) {
  if (!url) throw new Error('url 必填');
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    },
    redirect: 'follow'
  });
  if (!response.ok) {
    throw new Error('HTTP ' + response.status + ' ' + response.statusText);
  }
  const html = await response.text();
  const finalUrl = response.url || url;

  // 使用 jsdom 解析
  let dom = null;
  try {
    const { JSDOM } = require('jsdom');
    dom = new JSDOM(html, { url: finalUrl });
  } catch (e) {
    // jsdom 不可用时退化为原始 HTML 返回
    return {
      url: finalUrl,
      title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '',
      note: 'jsdom 不可用，仅返回原始 HTML',
      htmlLength: html.length,
      html: html.slice(0, 50000)
    };
  }

  const doc = dom.window.document;
  const title = doc.title || '';

  if (selector) {
    // 返回匹配元素明细
    const elements = Array.from(doc.querySelectorAll(selector));
    return {
      url: finalUrl,
      title: title,
      selector: selector,
      matched: elements.length,
      items: elements.slice(0, 200).map(el => ({
        text: (el.textContent || '').trim().slice(0, 1000),
        html: el.outerHTML.slice(0, 5000),
        tagName: el.tagName.toLowerCase(),
        href: el.getAttribute('href') || '',
        src: el.getAttribute('src') || ''
      }))
    };
  }

  // 返回页面资源摘要
  const links = Array.from(doc.querySelectorAll('a[href]')).slice(0, 100).map(a => ({
    text: (a.textContent || '').trim().slice(0, 200),
    href: a.href
  }));
  const images = Array.from(doc.querySelectorAll('img[src]')).slice(0, 100).map(img => ({
    src: img.src,
    alt: img.alt || ''
  }));
  const videos = Array.from(doc.querySelectorAll('video[src], video source[src]')).slice(0, 50).map(v => ({
    src: v.src,
    type: v.getAttribute('type') || ''
  }));
  const metas = {};
  doc.querySelectorAll('meta[name], meta[property]').forEach(m => {
    const key = m.getAttribute('name') || m.getAttribute('property');
    const val = m.getAttribute('content');
    if (key && val) metas[key] = val;
  });

  return {
    url: finalUrl,
    title: title,
    meta: metas,
    links: { count: links.length, items: links },
    images: { count: images.length, items: images },
    videos: { count: videos.length, items: videos },
    htmlLength: html.length,
    note: 'standalone 模式仅支持静态 HTML 解析，SPA 站点（B站/抖音等）需启动 Electron 应用'
  };
}

/**
 * 按字段映射提取元素
 */
async function extractElements(url, selector, fields) {
  if (!url || !selector) throw new Error('url 和 selector 必填');
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    redirect: 'follow'
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const html = await response.text();
  const finalUrl = response.url || url;

  let dom;
  try {
    const { JSDOM } = require('jsdom');
    dom = new JSDOM(html, { url: finalUrl });
  } catch (e) {
    throw new Error('jsdom 不可用，无法解析页面');
  }

  const doc = dom.window.document;
  const containers = Array.from(doc.querySelectorAll(selector));
  const fieldList = Array.isArray(fields) ? fields : [];

  const items = containers.slice(0, 500).map(el => {
    const row = {};
    for (const f of fieldList) {
      const fSel = f.selector;
      const fAttr = f.attr || 'text';
      if (!fSel) {
        row[f.name] = '';
        continue;
      }
      const target = el.querySelector(fSel);
      if (!target) {
        row[f.name] = '';
        continue;
      }
      if (fAttr === 'text') {
        row[f.name] = (target.textContent || '').trim();
      } else if (fAttr === 'html') {
        row[f.name] = target.innerHTML;
      } else {
        row[f.name] = target.getAttribute(fAttr) || '';
      }
    }
    return row;
  });

  return {
    url: finalUrl,
    selector: selector,
    fieldCount: fieldList.length,
    matched: items.length,
    items: items
  };
}

/**
 * 创建新的 AI 工作流任务（standalone 模式直接写文件）
 */
async function createTask(args) {
  const type = args.type;
  const name = args.name;
  const config = args.config || {};
  if (!type || !name) throw new Error('type 和 name 必填');
  if (!['batch', 'crosspage', 'tracking', 'template'].includes(type)) {
    throw new Error('不支持的任务类型: ' + type);
  }
  ensureDir(AIWORKFLOWS_DIR);
  const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const taskData = {
    id: taskId,
    name: name,
    type: type,
    config: config,
    status: 'idle',
    createdAt: Date.now(),
    lastRunAt: null,
    results: []
  };
  const filePath = path.join(AIWORKFLOWS_DIR, taskId + '.json');
  if (!writeJsonSafe(filePath, taskData)) {
    throw new Error('写入任务文件失败');
  }
  return {
    taskId: taskId,
    name: name,
    type: type,
    message: '任务已创建（standalone 模式，未执行。如需执行请启动 Electron 应用）'
  };
}

/**
 * 执行任务（standalone 模式：仅记录执行意图，不真实执行抓取）
 */
async function runTask(taskId) {
  if (!taskId) throw new Error('taskId 必填');
  const filePath = path.join(AIWORKFLOWS_DIR, taskId + '.json');
  const data = readJsonSafe(filePath, null);
  if (!data) throw new Error('任务不存在: ' + taskId);

  // standalone 模式下不真实执行抓取（需要 Electron 浏览器环境）
  // 仅返回任务信息和提示
  return {
    taskId: data.id,
    taskName: data.name,
    taskType: data.type,
    status: 'standby',
    message: 'standalone 模式无法真实执行抓取任务（需 Electron 浏览器环境）。请启动 Electron 应用以执行任务，或将任务配置导出后在应用内运行。',
    config: data.config,
    lastResultCount: Array.isArray(data.results) ? data.results.length : 0
  };
}

// ============ 启动 MCP Server ============

const startedAt = Date.now();
const readonly = process.env.MCP_READONLY === 'true' || process.argv.includes('--readonly');

function buildOpts() {
  return {
    readonly: readonly,
    getWorkflows: listCards,
    getAiworkflows: listWorkflows,
    runTask: runTask,
    createTask: createTask,
    getTaskResults: getTaskResults,
    scrapePage: scrapePage,
    extractElements: extractElements,
    getTrackingStatus: getTrackingStatus,
    onLog: null // standalone 模式日志直接输出到 stderr
  };
}

async function start() {
  const opts = buildOpts();
  const mcpInstance = createMcpServer(opts);
  mcpInstance.registerHandlers();

  const transport = new StdioServerTransport();
  await mcpInstance.server.connect(transport);

  // 写入 stderr（不能写入 stdout，会污染 MCP 协议）
  if (process.stderr) {
    process.stderr.write('[mcp-standalone] 已启动 ' + (readonly ? '（只读）' : '（读写）') + '\n');
    process.stderr.write('[mcp-standalone] 数据目录: ' + DATA_DIR + '\n');
    process.stderr.write('[mcp-standalone] 工具数: ' + (readonly ? 6 : 8) + '\n');
  }
}

// 退出处理
process.on('SIGINT', () => { process.exit(0); });
process.on('SIGTERM', () => { process.exit(0); });

process.on('uncaughtException', (err) => {
  if (process.stderr) {
    process.stderr.write('[mcp-standalone] uncaughtException: ' + (err && err.stack ? err.stack : err) + '\n');
  }
});

start().catch((err) => {
  if (process.stderr) {
    process.stderr.write('[mcp-standalone] start failed: ' + (err && err.stack ? err.stack : err) + '\n');
  }
  process.exit(1);
});
