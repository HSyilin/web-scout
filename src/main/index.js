const { app, BrowserWindow, BrowserView, ipcMain, dialog, shell, session, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { URL } = require('url');
const child_process = require('child_process');

// ===== Task 18: MCP 服务端实例（模块级，跨 createWindow 调用保持状态） =====
let mcpServerInstance = null; // { child, readonly, startedAt, callLogs, toolCount }
const aiHelper = require('./ai-helper');

// 连接池：复用 TCP 连接，支持并行下载
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 6 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 6, rejectUnauthorized: false });

// 可重试的网络错误码
const RETRYABLE_ERRORS = ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'EHOSTUNREACH'];

// 活跃下载请求跟踪（用于取消下载）
const activeDownloadRequests = new Map();
// 全局下载取消标志
let globalDownloadCancelled = false;

// 延迟函数
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 下载速度计算器
function createSpeedTracker() {
  let startTime = 0;
  let totalBytes = 0;
  let lastReportTime = 0;
  let lastBytes = 0;
  let currentSpeed = 0;

  return {
    start() {
      startTime = Date.now();
      lastReportTime = startTime;
      totalBytes = 0;
      lastBytes = 0;
      currentSpeed = 0;
    },
    update(bytes) {
      totalBytes = bytes;
      const now = Date.now();
      const elapsed = now - lastReportTime;
      // 每 200ms 更新一次速度，避免抖动
      if (elapsed >= 200) {
        const deltaBytes = bytes - lastBytes;
        const deltaSec = elapsed / 1000;
        currentSpeed = deltaSec > 0 ? deltaBytes / deltaSec : 0;
        lastReportTime = now;
        lastBytes = bytes;
      }
      return currentSpeed;
    },
    getSpeed() { return currentSpeed; },
    getTotalBytes() { return totalBytes; },
    getElapsedMs() { return Date.now() - startTime; }
  };
}

// 格式化下载速度
function formatSpeed(bytesPerSec) {
  if (bytesPerSec <= 0) return '';
  if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + ' B/s';
  if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
  return (bytesPerSec / (1024 * 1024)).toFixed(2) + ' MB/s';
}

// 判断错误是否可重试
function isRetryableError(err) {
  if (!err) return false;
  const code = err.code || '';
  if (RETRYABLE_ERRORS.includes(code)) return true;
  // 网络相关错误消息
  const msg = (err.message || '').toLowerCase();
  return msg.includes('socket hang up') || msg.includes('network') || msg.includes('aborted');
}

// 简单并发限制器
class ConcurrencyLimiter {
  constructor(max) {
    this.max = max;
    this.running = 0;
    this.queue = [];
  }
  async run(fn) {
    if (this.running >= this.max) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next();
      }
    }
  }
}

let mainWindow;
let wswEditorWindow = null;
let workflowWindow = null;

// 数据目录（在 app ready 后初始化）
let DATA_DIR, WORKFLOWS_DIR;
let AIWORKFLOWS_DIR;
let WORKFLOWS_TRASH_DIR;

function initDataDirs() {
  DATA_DIR = path.join(app.getPath('userData'), 'data');
  WORKFLOWS_DIR = path.join(DATA_DIR, 'workflows');
  AIWORKFLOWS_DIR = path.join(DATA_DIR, 'aiworkflows');
  WORKFLOWS_TRASH_DIR = path.join(DATA_DIR, 'workflows_trash');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(WORKFLOWS_DIR)) fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
  if (!fs.existsSync(AIWORKFLOWS_DIR)) fs.mkdirSync(AIWORKFLOWS_DIR, { recursive: true });
  if (!fs.existsSync(WORKFLOWS_TRASH_DIR)) fs.mkdirSync(WORKFLOWS_TRASH_DIR, { recursive: true });
}

// ===== 应用全局设置（settings.json）=====
let settingsData = null;
function getSettingsPath() { return path.join(DATA_DIR, 'settings.json'); }
function loadSettings() {
  if (settingsData) return settingsData;
  if (!DATA_DIR) return {};
  const p = getSettingsPath();
  if (!fs.existsSync(p)) { settingsData = {}; return settingsData; }
  try { settingsData = JSON.parse(fs.readFileSync(p, 'utf8') || '{}'); }
  catch (e) { console.error('[Settings] 读取失败:', e); settingsData = {}; }
  return settingsData;
}
function saveSettings(updates) {
  const cur = loadSettings();
  settingsData = Object.assign({}, cur, updates || {});
  try { fs.writeFileSync(getSettingsPath(), JSON.stringify(settingsData, null, 2), 'utf8'); }
  catch (e) { console.error('[Settings] 保存失败:', e); }
  return settingsData;
}
function getDefaultExportDir() {
  return loadSettings().defaultExportDir || '';
}

// 读取 AI 工作流任务文件（不存在返回 null）
function readTaskFile(taskId) {
  if (!taskId || !AIWORKFLOWS_DIR) return null;
  const filePath = path.join(AIWORKFLOWS_DIR, taskId + '.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

// 写入 AI 工作流任务文件
function writeTaskFile(task) {
  if (!task || !task.id || !AIWORKFLOWS_DIR) return;
  const filePath = path.join(AIWORKFLOWS_DIR, task.id + '.json');
  fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf8');
}

// 链式组合：从上游任务最新批次结果中提取 URL 列表
// sourceField: 'href'（默认）| 'url' | 'content'
function resolveSourceUrls(sourceTaskId, sourceField) {
  if (!sourceTaskId) return [];
  const srcTask = readTaskFile(sourceTaskId);
  if (!srcTask) return [];
  const results = Array.isArray(srcTask.results) ? srcTask.results : [];
  if (!results.length) return [];
  // 取最新一批结果
  const latestBatch = results[results.length - 1];
  if (!latestBatch || !Array.isArray(latestBatch.items)) return [];
  const field = sourceField || 'href';
  const urls = new Set();
  for (const item of latestBatch.items) {
    let val = null;
    if (field === 'url') {
      val = item.sourceUrl || (item.attributes && item.attributes.href) || '';
    } else if (field === 'content') {
      val = item.textContent || item.content || '';
    } else {
      // href：优先 attributes.href，其次 sourceUrl
      val = (item.attributes && item.attributes.href) || item.sourceUrl || '';
    }
    if (val && /^https?:\/\//i.test(val)) {
      urls.add(val);
    }
  }
  return Array.from(urls);
}

// 提取元素下的所有子链接（包括元素自身如果是 <a>，以及向上查找最近的 <a> 祖先）
// 通过 toString 注入到 BrowserView 内执行
// el: DOM 元素，maxLinks: 最大返回数（默认 50）
// 返回 [{ href, text }]，href 已解析为绝对 URL，去重
function extractChildLinksFn(el, maxLinks) {
  maxLinks = maxLinks || 50;
  var seen = {};
  var result = [];
  function pushLink(node) {
    try {
      // link.href 是 DOM 属性，自动解析为绝对 URL；getAttribute('href') 是原始值
      var href = node.href || node.getAttribute('href') || '';
      if (!href || href === '#' || href.indexOf('javascript:') === 0) return;
      // 去重（按 href）
      if (seen[href]) return;
      seen[href] = true;
      var text = (node.textContent || '').trim().slice(0, 120);
      result.push({ href: href, text: text });
    } catch (e) {}
  }
  // 0. 向上查找最近的 <a href> 祖先（百度新闻等场景：拾取到 <span>，链接在父 <a> 上）
  var p = el.parentElement;
  while (p) {
    if (p.tagName && p.tagName.toLowerCase() === 'a' && p.getAttribute('href')) {
      pushLink(p);
      break; // 只取最近的一个祖先 <a>
    }
    p = p.parentElement;
  }
  // 1. 如果元素自身是 <a>，把自身也加入（防止拾取的就是 <a> 本身）
  if (el.tagName && el.tagName.toLowerCase() === 'a' && el.getAttribute('href')) {
    pushLink(el);
  }
  // 2. 查找所有后代 <a href>（不再限制 5 个）
  var links = el.querySelectorAll('a[href]');
  for (var i = 0; i < links.length && result.length < maxLinks; i++) {
    pushLink(links[i]);
  }
  // 3. 查找 <area href>（图片热点链接）
  var areas = el.querySelectorAll('area[href]');
  for (var j = 0; j < areas.length && result.length < maxLinks; j++) {
    pushLink(areas[j]);
  }
  // 4. 查找带 data-href / data-url 的元素（SPA 常见）
  var dataEls = el.querySelectorAll('[data-href], [data-url]');
  for (var k = 0; k < dataEls.length && result.length < maxLinks; k++) {
    var de = dataEls[k];
    var dhref = de.getAttribute('data-href') || de.getAttribute('data-url') || '';
    if (dhref && /^https?:|^\/\//.test(dhref) && !seen[dhref]) {
      seen[dhref] = true;
      var dtext = (de.textContent || '').trim().slice(0, 120);
      result.push({ href: dhref, text: dtext });
    }
  }
  return result;
}

// 末端抓取：在 BrowserView 内执行的纯 JS 字段提取函数（通过 toString 注入）
// 输入: fields = [{ name, selector, attr, extractType }]
// 输出: { fields: { [name]: { values, extractType, count } }, missing: [name], pageTitle }
function extractTemplateFieldsFn(fields) {
  var result = {};
  var missing = [];
  function getAttr(el, attr) {
    if (attr === 'text') return (el.textContent || '').trim();
    if (attr === 'html') return el.innerHTML;
    return el.getAttribute(attr) || '';
  }
  function extractResourceUrl(el, type) {
    var src = el.getAttribute('src') || el.src || '';
    if (src && !src.startsWith('data:')) return src;
    var dataAttrs = ['data-src', 'data-url', 'data-video', 'data-audio', 'data-download', 'data-file', 'data-href'];
    for (var i = 0; i < dataAttrs.length; i++) {
      var v = el.getAttribute(dataAttrs[i]);
      if (v && /^https?:|^\/\/|^\//.test(v)) return v;
    }
    var child = el.querySelector('source, video, audio');
    if (child) {
      var csrc = child.getAttribute('src') || child.src || '';
      if (csrc && !csrc.startsWith('data:')) return csrc;
    }
    if (type === 'link' || type === 'download') {
      var href = el.getAttribute('href') || el.href || '';
      if (href && href !== '#' && !href.startsWith('javascript:')) return href;
    }
    if (type === 'video' || type === 'audio') {
      try {
        var bg = getComputedStyle(el).backgroundImage;
        var m = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (m && m[1] && !m[1].startsWith('data:')) return m[1];
      } catch (e) {}
    }
    return '';
  }
  // 判断是否下载链接：带 download 属性，或扩展名匹配常见下载文件
  var downloadExtRe = /\.(zip|rar|7z|exe|msi|dmg|pkg|deb|rpm|apk|xapk|ipa|doc|docx|xls|xlsx|ppt|pptx|pdf|txt|csv|json|xml|yaml|yml|tar|gz|bz2|xz|iso|img|vmdk|ova|ovf|whl|egg|jar|war|ear|dll|so|dylib|lib|a|o|obj|bin|dat|db|sqlite|mdb|sql|psd|ai|sketch|fig|xd|svgz|ttf|otf|woff|woff2|eot|mp4|mkv|avi|mov|wmv|flv|webm|mp3|wav|flac|aac|ogg|opus|m4a|m4v|mpg|mpeg|mpe|mpv|m2v|m4p|m4b|3gp|3g2|f4v|f4p|f4a|f4b)$/i;
  function isDownloadLink(href, el) {
    if (el && el.hasAttribute && el.hasAttribute('download')) return true;
    if (downloadExtRe.test(href)) return true;
    return false;
  }

  // 综合提取：扫描容器元素内所有资源，按类型分类
  function extractAllResources(rootEl) {
    var texts = [];
    var images = [];
    var videos = [];
    var audios = [];
    var links = [];
    var downloads = [];
    var seenUrl = {};

    // 文本：元素自身直接文本（不含子元素文本），累积成一段
    var directText = '';
    for (var i = 0; i < rootEl.childNodes.length; i++) {
      var node = rootEl.childNodes[i];
      if (node.nodeType === 3) { // TextNode
        var t = (node.textContent || '').trim();
        if (t) directText += (directText ? ' ' : '') + t;
      }
    }
    if (directText) texts.push(directText);
    // 如果没有直接文本，用整体 textContent
    if (!texts.length) {
      var fullText = (rootEl.textContent || '').trim();
      if (fullText) texts.push(fullText.slice(0, 500));
    }

    // 图片：<img src>
    var imgs = rootEl.querySelectorAll('img');
    for (var j = 0; j < imgs.length; j++) {
      var src = extractResourceUrl(imgs[j], 'image');
      if (src && !seenUrl[src]) { seenUrl[src] = true; images.push(src); }
    }

    // 视频：<video src> 或 <source>
    var vids = rootEl.querySelectorAll('video');
    for (var k = 0; k < vids.length; k++) {
      var vsrc = extractResourceUrl(vids[k], 'video');
      if (vsrc && !seenUrl[vsrc]) { seenUrl[vsrc] = true; videos.push(vsrc); }
    }
    var sources = rootEl.querySelectorAll('source');
    for (var m = 0; m < sources.length; m++) {
      var ssrc = sources[m].getAttribute('src') || sources[m].src || '';
      if (ssrc && !ssrc.startsWith('data:') && !seenUrl[ssrc]) {
        seenUrl[ssrc] = true;
        // 根据 type 属性判断视频/音频
        var stype = (sources[m].getAttribute('type') || '').toLowerCase();
        if (stype.indexOf('audio') >= 0) audios.push(ssrc);
        else videos.push(ssrc);
      }
    }

    // 音频：<audio src>
    var auds = rootEl.querySelectorAll('audio');
    for (var n = 0; n < auds.length; n++) {
      var asrc = extractResourceUrl(auds[n], 'audio');
      if (asrc && !seenUrl[asrc]) { seenUrl[asrc] = true; audios.push(asrc); }
    }

    // 超链接 + 下载链接：<a href>
    var anchors = rootEl.querySelectorAll('a[href]');
    for (var p = 0; p < anchors.length; p++) {
      var a = anchors[p];
      var href = a.href || a.getAttribute('href') || '';
      if (!href || href === '#' || href.indexOf('javascript:') === 0) continue;
      if (seenUrl[href]) continue;
      seenUrl[href] = true;
      var text = (a.textContent || '').trim().slice(0, 120);
      if (isDownloadLink(href, a)) {
        downloads.push({ href: href, text: text });
      } else {
        links.push({ href: href, text: text });
      }
    }

    // 嵌入式资源：<iframe src>、<embed src>、<object data>
    var ifrs = rootEl.querySelectorAll('iframe[src]');
    for (var q = 0; q < ifrs.length; q++) {
      var isrc = ifrs[q].getAttribute('src') || ifrs[q].src || '';
      if (isrc && !seenUrl[isrc]) { seenUrl[isrc] = true; links.push({ href: isrc, text: 'iframe' }); }
    }
    var objs = rootEl.querySelectorAll('object[data]');
    for (var r = 0; r < objs.length; r++) {
      var dsrc = objs[r].getAttribute('data') || '';
      if (dsrc && !seenUrl[dsrc]) { seenUrl[dsrc] = true; links.push({ href: dsrc, text: 'object' }); }
    }

    // 背景图：style background-image
    var allEls = rootEl.querySelectorAll('*');
    for (var s = 0; s < allEls.length && images.length < 50; s++) {
      try {
        var bg = getComputedStyle(allEls[s]).backgroundImage;
        var bm = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (bm && bm[1] && !bm[1].startsWith('data:') && !seenUrl[bm[1]]) {
          seenUrl[bm[1]] = true;
          images.push(bm[1]);
        }
      } catch (e) {}
    }

    return {
      texts: texts,
      images: images,
      videos: videos,
      audios: audios,
      links: links,
      downloads: downloads
    };
  }

  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var name = f.name || ('field_' + i);
    var sel = (f.selector || '').trim();
    var attr = f.attr || 'text';
    var extractType = f.extractType || 'text';
    if (!sel) { result[name] = null; missing.push(name); continue; }
    var els = null;
    try { els = document.querySelectorAll(sel); } catch (e) { els = null; }
    if (!els || !els.length) { result[name] = null; missing.push(name); continue; }

    // 'all' 类型：综合提取容器内所有资源
    if (extractType === 'all') {
      var allTexts = [];
      var allImages = [];
      var allVideos = [];
      var allAudios = [];
      var allLinks = [];
      var allDownloads = [];
      for (var k = 0; k < els.length; k++) {
        var r = extractAllResources(els[k]);
        allTexts = allTexts.concat(r.texts);
        allImages = allImages.concat(r.images);
        allVideos = allVideos.concat(r.videos);
        allAudios = allAudios.concat(r.audios);
        allLinks = allLinks.concat(r.links);
        allDownloads = allDownloads.concat(r.downloads);
      }
      // 去重（links/downloads 按 href 去重）
      var seenH = {};
      allLinks = allLinks.filter(function(x) {
        if (seenH[x.href]) return false; seenH[x.href] = true; return true;
      });
      var seenD = {};
      allDownloads = allDownloads.filter(function(x) {
        if (seenD[x.href]) return false; seenD[x.href] = true; return true;
      });
      var totalCount = allTexts.length + allImages.length + allVideos.length + allAudios.length + allLinks.length + allDownloads.length;
      result[name] = {
        extractType: 'all',
        texts: allTexts,
        images: allImages,
        videos: allVideos,
        audios: allAudios,
        links: allLinks,
        downloads: allDownloads,
        count: totalCount
      };
      if (totalCount === 0) missing.push(name);
      continue;
    }

    // 单一类型提取（原有逻辑）
    var values = [];
    for (var k = 0; k < els.length; k++) {
      var el = els[k];
      var v = null;
      if (extractType === 'text' || (extractType === 'link' && attr === 'text')) {
        v = getAttr(el, attr);
      } else if (extractType === 'link') {
        v = el.getAttribute('href') || el.href || getAttr(el, attr);
        if (v === '#' || (v && v.startsWith('javascript:'))) v = '';
      } else if (extractType === 'image') {
        // 图片：优先 src，回退 data-src
        v = extractResourceUrl(el, 'image');
      } else if (extractType === 'video' || extractType === 'audio' || extractType === 'download') {
        v = extractResourceUrl(el, extractType);
        if (!v && extractType === 'download') {
          v = el.getAttribute('href') || el.href || '';
          if (v === '#' || (v && v.startsWith('javascript:'))) v = '';
        }
      } else {
        v = getAttr(el, attr);
      }
      if (v) values.push(v);
    }
    result[name] = {
      values: values,
      extractType: extractType,
      count: values.length
    };
    if (!values.length) missing.push(name);
  }
  var pageTitle = (document.title || '').trim();
  return { fields: result, missing: missing, pageTitle: pageTitle };
}

// 链式组合：查找所有以 sourceTaskId 为上游的下游任务
function findDownstreamTasks(sourceTaskId) {
  if (!sourceTaskId || !AIWORKFLOWS_DIR) return [];
  const downstream = [];
  try {
    const files = fs.readdirSync(AIWORKFLOWS_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const task = JSON.parse(fs.readFileSync(path.join(AIWORKFLOWS_DIR, f), 'utf8'));
        if (task && task.config) {
          // 同时匹配 sourceTaskId（crosspage/template 样本源）和 targetSourceTaskId（template 目标源）
          if (task.config.sourceTaskId === sourceTaskId || task.config.targetSourceTaskId === sourceTaskId) {
            downstream.push(task);
          }
        }
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  return downstream;
}

function updateStat(key) {
  try {
    const statsFile = path.join(DATA_DIR, 'stats.json');
    let stats = { scrapes: 0, wswFiles: 0, workflows: 0 };
    if (fs.existsSync(statsFile)) {
      stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
    }
    stats[key] = (stats[key] || 0) + 1;
    fs.writeFileSync(statsFile, JSON.stringify(stats), 'utf8');
  } catch (e) { /* ignore */ }
}

// 多 BrowserView 管理
const browserViews = new Map(); // tabId -> BrowserView
let activeTabId = null;
let tabIdCounter = 0;

// ===== 后台任务 BrowserView 池（用于 AI 工作流的批量抓取等） =====
const taskBrowserViewPool = []; // 复用池，最多 3 个
const TASK_BV_POOL_MAX = 3;

// 从池中获取一个空闲 BrowserView（无则新建），用于后台任务加载
async function getTaskBrowserView() {
  if (taskBrowserViewPool.length > 0) {
    return taskBrowserViewPool.pop();
  }
  const bv = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, '../renderer/webview-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
      sandbox: false
    }
  });
  // BrowserView 必须附加到 BrowserWindow 才能加载 URL，附加到 mainWindow 但 setBounds 到屏幕外不可见区域
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBrowserView(bv);
    bv.setBounds({ x: 0, y: 0, width: 1, height: 1 });
  }
  return bv;
}

// 归还 BrowserView 到池（超过上限则销毁）
function releaseTaskBrowserView(bv) {
  if (!bv || bv.webContents.isDestroyed()) return;
  if (taskBrowserViewPool.length >= TASK_BV_POOL_MAX) {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.removeBrowserView(bv);
      }
      bv.webContents.destroy();
    } catch (e) { /* ignore */ }
    return;
  }
  // 归还时重置到不可见区域，并停止当前加载
  try {
    bv.setBounds({ x: 0, y: 0, width: 1, height: 1 });
    if (!bv.webContents.isDestroyed()) {
      bv.webContents.stop();
    }
  } catch (e) { /* ignore */ }
  taskBrowserViewPool.push(bv);
}

// 加载 URL 并返回 document.body.innerHTML（截断到 maxBytes），供 AI 功能使用
async function loadUrlAndGetHtml(url, maxBytes) {
  maxBytes = maxBytes || 30 * 1024;
  const bv = await getTaskBrowserView();
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!bv.webContents.isDestroyed()) bv.webContents.removeListener('did-finish-load', onLoad);
        resolve();
      }, 30000);
      const onLoad = () => {
        clearTimeout(timeout);
        bv.webContents.removeListener('did-finish-load', onLoad);
        resolve();
      };
      bv.webContents.once('did-finish-load', onLoad);
      bv.webContents.once('did-fail-load', (e, code, desc, u, isMain) => {
        if (isMain) {
          clearTimeout(timeout);
          bv.webContents.removeListener('did-finish-load', onLoad);
          resolve();
        }
      });
      try {
        bv.webContents.loadURL(url);
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
      }
    });
    await sleep(2000);
    if (bv.webContents.isDestroyed()) {
      throw new Error('BrowserView 已销毁');
    }
    const html = await bv.webContents.executeJavaScript(
      `(function(){ try { return document.body ? document.body.innerHTML : ''; } catch(e){ return ''; } })()`,
      true
    );
    const s = String(html || '');
    return s.length > maxBytes ? s.slice(0, maxBytes) : s;
  } finally {
    releaseTaskBrowserView(bv);
  }
}

// 抓取模式状态（主进程维护，供右键菜单显示和切换）
let inspectModeState = false;

// 拾取模式状态（主进程维护，picker 模式下不显示默认右键菜单，由 preload 自定义菜单接管）
let pickerModeState = false;

// 侧边栏显示状态（由渲染进程同步，影响 BrowserView 宽度计算）
let sidebarVisibleFromRenderer = true;

// 侧边栏宽度
const SIDEBAR_WIDTH = 360;
// 左侧导航栏宽度（默认折叠 60px，展开 200px）
let LEFT_NAV_WIDTH = 60;
// BrowserView 偏移量（标题栏 + 搜索栏 + 标签栏）
const VIEW_OFFSET_Y = 142;
const VIEW_OFFSET_BOTTOM = 30;

// 默认首页
const DEFAULT_HOME_URL = 'https://www.baidu.com';

// 自定义 User-Agent（根据平台动态生成）
function getPlatformUA() {
  const chromeVer = '120.0.0.0';
  const base = `Mozilla/5.0 (${process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64'
    : process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
    : 'X11; Linux x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
  return base;
}
const UA = getPlatformUA();

// 媒体文件扩展名
const videoExts = ['mp4', 'webm', 'flv', 'avi', 'mov', 'wmv', 'mkv', 'm3u8', 'ts'];
const audioExts = ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma'];
const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff'];

function getExt(url) {
  try {
    const u = new URL(url);
    const name = (u.pathname.split('/').pop() || '').split('?')[0];
    return name.split('.').pop().toLowerCase();
  } catch { return ''; }
}

function getFileName(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent((u.pathname.split('/').pop() || 'resource').split('?')[0]);
  } catch { return 'resource'; }
}

function resolveUrl(baseUrl, relativeUrl) {
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return relativeUrl;
  }
}

// 更新当前活动 BrowserView 的 bounds
function updateBrowserViewBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || !activeTabId) return;
  const bv = browserViews.get(activeTabId);
  if (!bv) return;
  // 使用 getContentBounds() 获取实际内容区域尺寸（不含标题栏和边框）
  const contentBounds = mainWindow.getContentBounds();
  // 根据侧边栏显示状态计算宽度
  const sidebarOffset = sidebarVisibleFromRenderer ? (SIDEBAR_WIDTH + 8) : 8;
  bv.setBounds({
    x: LEFT_NAV_WIDTH,
    y: VIEW_OFFSET_Y,
    width: contentBounds.width - LEFT_NAV_WIDTH - sidebarOffset,
    height: contentBounds.height - VIEW_OFFSET_Y - VIEW_OFFSET_BOTTOM
  });
}

function createWindow() {
  // 移除原生菜单栏
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
      sandbox: false,
      webviewTag: true
    },
    icon: path.join(__dirname, '../../assets/icon.png')
  });

  // 主窗口直接进入抓取模块
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // 监听窗口 resize，调整 BrowserView 大小
  mainWindow.on('resize', () => {
    updateBrowserViewBounds();
  });

  // ============ 窗口控制 ============
  ipcMain.handle('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.handle('window-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('window-close', () => { if (mainWindow) mainWindow.close(); });

  // ============ 仪表盘统计 ============
  ipcMain.handle('get-dashboard-stats', () => {
    try {
      const statsFile = path.join(DATA_DIR, 'stats.json');
      let stats = { scrapes: 0, wswFiles: 0, workflows: 0 };
      if (fs.existsSync(statsFile)) {
        stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
      }
      // 计算工作流数量
      const wfFiles = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));
      stats.workflows = wfFiles.length;
      return { success: true, data: stats };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ============ 工作流管理 ============
  ipcMain.handle('save-workflow', (event, workflow) => {
    try {
      const id = workflow.id || Date.now().toString(36);
      const filePath = path.join(WORKFLOWS_DIR, id + '.json');
      workflow.id = id;
      workflow.savedAt = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), 'utf8');
      // 更新统计
      updateStat('scrapes');
      return { success: true, id };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-workflows', () => {
    try {
      const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));
      const workflows = files.map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf8')); }
        catch { return null; }
      }).filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return { success: true, data: workflows };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 获取单个工作流完整记录（用于WSW容器链接资源加载）
  ipcMain.handle('get-workflow-detail', (event, workflowId) => {
    try {
      if (!workflowId) return { success: false, error: '缺少workflowId' };
      const filePath = path.join(WORKFLOWS_DIR, workflowId + '.json');
      if (!fs.existsSync(filePath)) return { success: false, error: '工作流不存在' };
      const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return { success: true, data: workflow };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 删除工作流记录（移入回收站，不永久删除）
  ipcMain.handle('delete-workflow', (event, workflowId) => {
    try {
      if (!workflowId) return { success: false, error: '缺少workflowId' };
      const filePath = path.join(WORKFLOWS_DIR, workflowId + '.json');
      if (!fs.existsSync(filePath)) return { success: false, error: '卡片不存在' };
      const trashPath = path.join(WORKFLOWS_TRASH_DIR, workflowId + '.json');
      // 读取原文件，添加 deletedAt 标记后写入回收站
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      data.deletedAt = new Date().toISOString();
      data.originalPath = filePath;
      fs.writeFileSync(trashPath, JSON.stringify(data, null, 2), 'utf8');
      // 从原目录删除
      fs.unlinkSync(filePath);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 获取回收站中的卡片列表
  ipcMain.handle('get-trash-workflows', () => {
    try {
      if (!WORKFLOWS_TRASH_DIR || !fs.existsSync(WORKFLOWS_TRASH_DIR)) {
        return { success: true, data: [] };
      }
      const files = fs.readdirSync(WORKFLOWS_TRASH_DIR).filter(f => f.endsWith('.json'));
      const workflows = files.map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(WORKFLOWS_TRASH_DIR, f), 'utf8')); }
        catch { return null; }
      }).filter(Boolean).sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
      return { success: true, data: workflows };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 还原回收站中的卡片
  ipcMain.handle('restore-workflow', (event, workflowId) => {
    try {
      if (!workflowId) return { success: false, error: '缺少workflowId' };
      const trashPath = path.join(WORKFLOWS_TRASH_DIR, workflowId + '.json');
      if (!fs.existsSync(trashPath)) return { success: false, error: '回收站中不存在该卡片' };
      const data = JSON.parse(fs.readFileSync(trashPath, 'utf8'));
      // 移除回收站标记
      delete data.deletedAt;
      delete data.originalPath;
      // 写回原目录
      const filePath = path.join(WORKFLOWS_DIR, workflowId + '.json');
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      // 从回收站删除
      fs.unlinkSync(trashPath);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 清空回收站（永久删除所有回收站卡片）
  ipcMain.handle('empty-trash', () => {
    try {
      if (!WORKFLOWS_TRASH_DIR || !fs.existsSync(WORKFLOWS_TRASH_DIR)) {
        return { success: true };
      }
      const files = fs.readdirSync(WORKFLOWS_TRASH_DIR).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try { fs.unlinkSync(path.join(WORKFLOWS_TRASH_DIR, f)); } catch (e) { /* ignore */ }
      }
      return { success: true, count: files.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 从回收站永久删除单个卡片
  ipcMain.handle('permanent-delete-workflow', (event, workflowId) => {
    try {
      if (!workflowId) return { success: false, error: '缺少workflowId' };
      const trashPath = path.join(WORKFLOWS_TRASH_DIR, workflowId + '.json');
      if (!fs.existsSync(trashPath)) return { success: false, error: '回收站中不存在该卡片' };
      fs.unlinkSync(trashPath);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ============ AI 工作流管理 ============
  // 保存 AI 工作流任务
  ipcMain.handle('save-aiworkflow', async (event, task) => {
    try {
      const id = (task && task.id) || Date.now().toString(36);
      const filePath = path.join(AIWORKFLOWS_DIR, id + '.json');
      task = task || {};
      task.id = id;
      task.savedAt = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf8');
      return { success: true, id };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 导出任务配置文件（抓取清单，用于快捷导入其他用户的抓取方案）
  // 以任务名称命名，保存到指定目录
  ipcMain.handle('export-task-config', async (event, { task, dir }) => {
    try {
      if (!task || !dir) return { success: false, error: '缺少任务或目录' };
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // 文件名以任务名称命名，sanitize 非法字符
      const rawName = (task.name || 'task').toString().trim();
      const safeName = rawName.replace(/[\\/:*?"<>|]/g, '_').substring(0, 100) || 'task';
      const fileName = safeName + '.json';
      const fullPath = path.join(dir, fileName);

      // 构造纯净的配置导出数据（不含运行时数据）
      const exportData = {
        __type: 'aiworkflow-task-config',
        __version: 1,
        exportedAt: new Date().toISOString(),
        task: {
          type: task.type,
          name: task.name,
          config: task.config || {},
        }
      };
      fs.writeFileSync(fullPath, JSON.stringify(exportData, null, 2), 'utf8');
      return { success: true, path: fullPath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ===== 阶段 C1: 模板管理 IPC（内置 + 用户模板 CRUD）=====
  // 内置模板目录：assets/templates/<category>/*.json
  const BUILTIN_TEMPLATES_DIR = path.join(__dirname, '..', '..', 'assets', 'templates');
  // 用户模板目录：userData/data/user_templates/<category>/*.json
  const getUserTemplatesRoot = () => path.join(DATA_DIR, 'user_templates');
  const TEMPLATE_CATEGORIES = ['recruitment', 'comments', 'products'];

  // 扫描单个分类目录，返回模板条目数组
  function scanTemplateDir(dir, category, source) {
    const items = [];
    try {
      if (!fs.existsSync(dir)) return items;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        const full = path.join(dir, f);
        let displayName = f.replace(/\.json$/i, '');
        try {
          const obj = JSON.parse(fs.readFileSync(full, 'utf8'));
          if (obj && obj.task && obj.task.name) displayName = String(obj.task.name);
        } catch (e) { /* 解析失败用文件名作为显示名 */ }
        items.push({ name: displayName, file: f, category, source });
      }
    } catch (e) { /* 目录读取失败返回空数组 */ }
    return items;
  }

  // 1. list-templates：扫描内置 + 用户模板，按分类返回
  ipcMain.handle('list-templates', async () => {
    try {
      const userRoot = getUserTemplatesRoot();
      // 用户模板根目录不存在时自动创建
      if (!fs.existsSync(userRoot)) fs.mkdirSync(userRoot, { recursive: true });

      const result = {};
      for (const cat of TEMPLATE_CATEGORIES) {
        const builtin = scanTemplateDir(path.join(BUILTIN_TEMPLATES_DIR, cat), cat, 'builtin');
        const user = scanTemplateDir(path.join(userRoot, cat), cat, 'user');
        result[cat] = { builtin, user };
      }
      return { success: true, data: result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 2. import-task-template：读取指定模板文件内容
  ipcMain.handle('import-task-template', async (event, { source, category, file }) => {
    try {
      if (!source || !category || !file) return { success: false, error: '参数不完整' };
      let dir;
      if (source === 'builtin') dir = path.join(BUILTIN_TEMPLATES_DIR, category);
      else if (source === 'user') dir = path.join(getUserTemplatesRoot(), category);
      else return { success: false, error: '无效的 source' };
      const fullPath = path.join(dir, file);
      if (!fs.existsSync(fullPath)) return { success: false, error: '模板不存在' };
      const taskConfig = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      return { success: true, data: taskConfig };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 3. save-user-template：保存用户自定义模板（覆盖同名）
  ipcMain.handle('save-user-template', async (event, { name, category, taskConfig }) => {
    try {
      if (!name || !category || !taskConfig) return { success: false, error: '参数不完整' };
      // 仅允许在三个内置分类下保存；custom 等其他值归入 products 同级的 custom 子目录
      const safeCategory = String(category).replace(/[\\/:*?"<>|]/g, '_').substring(0, 50) || 'custom';
      const safeName = String(name).replace(/[\\/:*?"<>|]/g, '_').substring(0, 100) || 'template';
      const fileName = safeName + '.json';
      const userCatDir = path.join(getUserTemplatesRoot(), safeCategory);
      if (!fs.existsSync(userCatDir)) fs.mkdirSync(userCatDir, { recursive: true });
      const fullPath = path.join(userCatDir, fileName);
      // 补全 taskConfig 元信息
      const finalConfig = Object.assign({}, taskConfig, {
        __type: 'aiworkflow-task-config',
        __version: 1,
        exportedAt: new Date().toISOString(),
      });
      fs.writeFileSync(fullPath, JSON.stringify(finalConfig, null, 2), 'utf8');
      return { success: true, data: { file: fileName, path: fullPath } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 4. delete-user-template：仅允许删除用户模板
  ipcMain.handle('delete-user-template', async (event, { category, file }) => {
    try {
      if (!category || !file) return { success: false, error: '参数不完整' };
      // 硬编码拒绝 builtin：不允许通过此 IPC 删除内置模板
      const userRoot = getUserTemplatesRoot();
      const safeCategory = String(category).replace(/[\\/:*?"<>|]/g, '_').substring(0, 50);
      const safeFile = path.basename(String(file));
      const fullPath = path.join(userRoot, safeCategory, safeFile);
      // 二次校验：路径必须位于用户模板根目录下，且不在内置目录
      const builtinPath = path.join(BUILTIN_TEMPLATES_DIR, safeCategory, safeFile);
      if (fullPath === builtinPath || fullPath.startsWith(BUILTIN_TEMPLATES_DIR + path.sep)) {
        return { success: false, error: '内置模板不可删除' };
      }
      if (!fullPath.startsWith(userRoot + path.sep)) {
        return { success: false, error: '非法路径' };
      }
      if (!fs.existsSync(fullPath)) return { success: false, error: '模板不存在' };
      fs.unlinkSync(fullPath);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 获取所有 AI 工作流任务列表（按 createdAt 倒序）
  ipcMain.handle('get-aiworkflows', async () => {
    try {
      const files = fs.readdirSync(AIWORKFLOWS_DIR).filter(f => f.endsWith('.json'));
      const tasks = files.map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(AIWORKFLOWS_DIR, f), 'utf8')); }
        catch { return null; }
      }).filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return { success: true, data: tasks };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 获取单个 AI 工作流任务详情
  ipcMain.handle('get-aiworkflow-detail', async (event, taskId) => {
    try {
      if (!taskId) return { success: false, error: '缺少taskId' };
      const filePath = path.join(AIWORKFLOWS_DIR, taskId + '.json');
      if (!fs.existsSync(filePath)) return { success: false, error: 'AI工作流不存在' };
      const task = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return { success: true, data: task };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 删除 AI 工作流任务
  ipcMain.handle('delete-aiworkflow', async (event, taskId) => {
    try {
      if (!taskId) return { success: false, error: '缺少taskId' };
      // 若是追踪任务，先停止调度器
      try { TrackingScheduler.stop(taskId); } catch (e) { /* ignore */ }
      const filePath = path.join(AIWORKFLOWS_DIR, taskId + '.json');
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      // 同步清理：将该任务关联的抓取信息卡片移入回收站
      if (WORKFLOWS_DIR && WORKFLOWS_TRASH_DIR) {
        try {
          const wfFiles = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));
          for (const f of wfFiles) {
            try {
              const wf = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf8'));
              if (wf && String(wf.sourceTaskId) === String(taskId)) {
                // 移入回收站
                wf.deletedAt = new Date().toISOString();
                wf.deletedReason = '关联任务已删除';
                fs.writeFileSync(path.join(WORKFLOWS_TRASH_DIR, f), JSON.stringify(wf, null, 2), 'utf8');
                fs.unlinkSync(path.join(WORKFLOWS_DIR, f));
              }
            } catch (e) { /* ignore parse errors */ }
          }
        } catch (e) { /* ignore */ }
      }
      // Task 16.3: 通知渲染进程任务已删除，便于 HT 编辑器容器联动
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('aiworkflow-task-deleted', taskId);
        }
      } catch (e) { /* ignore */ }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ===== Task 8: 追踪调度器 IPC =====
  // 启动追踪：读取任务，启动调度器，更新 active:true, status:'tracking'
  ipcMain.handle('start-tracking', async (event, taskId) => {
    try {
      if (!taskId) return { success: false, error: '缺少 taskId' };
      const task = readTaskFile(taskId);
      if (!task) return { success: false, error: '任务不存在' };
      task.active = true;
      task.status = 'tracking';
      TrackingScheduler.start(task);
      writeTaskFile(task);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // 暂停追踪：停止调度器，更新 active:false, status:'paused'
  ipcMain.handle('pause-tracking', async (event, taskId) => {
    try {
      if (!taskId) return { success: false, error: '缺少 taskId' };
      TrackingScheduler.stop(taskId);
      const task = readTaskFile(taskId);
      if (task) {
        task.active = false;
        task.status = 'paused';
        task.nextCheckAt = null;
        writeTaskFile(task);
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // 恢复追踪：读取任务，重新启动调度器，更新 active:true, status:'tracking'
  ipcMain.handle('resume-tracking', async (event, taskId) => {
    try {
      if (!taskId) return { success: false, error: '缺少 taskId' };
      const task = readTaskFile(taskId);
      if (!task) return { success: false, error: '任务不存在' };
      task.active = true;
      task.status = 'tracking';
      TrackingScheduler.start(task);
      writeTaskFile(task);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // 更新 AI 工作流任务（深合并策略：数组替换，对象浅合并）
  ipcMain.handle('update-aiworkflow', async (event, { id, updates }) => {
    try {
      if (!id) return { success: false, error: '缺少id' };
      const filePath = path.join(AIWORKFLOWS_DIR, id + '.json');
      if (!fs.existsSync(filePath)) return { success: false, error: 'AI工作流不存在' };
      const task = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const merged = { ...task };
      if (updates && typeof updates === 'object') {
        for (const key of Object.keys(updates)) {
          const newVal = updates[key];
          const oldVal = task[key];
          // 数组采用替换策略
          if (Array.isArray(newVal)) {
            merged[key] = newVal;
          }
          // 普通对象采用浅合并
          else if (newVal && typeof newVal === 'object' && oldVal && typeof oldVal === 'object' && !Array.isArray(oldVal)) {
            merged[key] = { ...oldVal, ...newVal };
          }
          // 其他类型直接替换
          else {
            merged[key] = newVal;
          }
        }
      }
      merged.id = id;
      merged.savedAt = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf8');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ===== Discourse 论坛 JSON API 辅助函数 =====
  // Discourse 使用 Ember.js 虚拟滚动，DOM 中始终只有 ~30 个节点
  // 直接调用 JSON API 分页获取全部话题，绕过虚拟滚动限制
  // 返回 { isDiscourse, topics } 或 { isDiscourse: false }
  // isAborted: 函数，返回当前是否已停止
  // onProgress: 可选回调 (count) => void
  async function fetchDiscourseTopicsViaAPI(bv, url, maxPages, isAborted, onProgress) {
    try {
      // 构造 JSON API URL
      let jsonUrl = url.replace(/\/?$/, '.json');
      const allTopics = [];
      let page = 0;
      let nextUrl = jsonUrl;

      while (nextUrl && page < maxPages && !isAborted()) {
        // 通过 BrowserView 的 fetch 调用 JSON API（复用 cookies/session）
        const jsonStr = await bv.webContents.executeJavaScript(
          `(async function() {
            try {
              var resp = await fetch(${JSON.stringify(nextUrl)}, { credentials: 'include' });
              if (!resp.ok) return null;
              return await resp.text();
            } catch(e) { return null; }
          })()`,
          true
        );
        if (!jsonStr) break;

        let data;
        try { data = JSON.parse(jsonStr); } catch(e) { break; }

        const topicList = data && data.topic_list;
        if (!topicList || !Array.isArray(topicList.topics)) break;

        for (const t of topicList.topics) {
          // 构造话题 URL
          const topicUrl = new URL('/t/' + (t.slug || 'topic') + '/' + t.id, url).href;
          // 构造预览文本（标题 + 摘要）
          const title = t.title || t.fancy_title || '';
          const excerpt = t.excerpt || '';
          const tags = Array.isArray(t.tags)
            ? t.tags.map(tg => (typeof tg === 'string' ? tg : (tg.name || ''))).filter(Boolean)
            : [];
          const views = t.views || 0;
          const likeCount = t.like_count || 0;
          const postsCount = t.posts_count || 0;

          const textContent = title + (excerpt ? '\n' + excerpt : '') +
            (tags.length ? '\n标签: ' + tags.join(', ') : '') +
            '\n浏览: ' + views + ' · 点赞: ' + likeCount + ' · 回复: ' + postsCount;

          allTopics.push({
            href: topicUrl,
            textContent: textContent.slice(0, 5000),
            innerText: title,
            tagName: 'a',
            groupKey: tags.length ? tags[0] : 'no-tag',
            level: 0,
            parentId: null,
            attributes: {
              href: topicUrl,
              'data-topic-id': String(t.id)
            },
            outerHTML: '<a href="' + topicUrl + '">' + title + '</a>',
            childLinks: [{ href: topicUrl, text: title }],
            // 额外的元数据
            topicId: t.id,
            title: title,
            tags: tags,
            views: views,
            likeCount: likeCount,
            postsCount: postsCount,
            excerpt: excerpt,
            createdAt: t.created_at,
            lastPostedAt: t.last_posted_at
          });
        }

        // 发送进度
        if (typeof onProgress === 'function') {
          try { onProgress(allTopics.length); } catch(e) {}
        }

        // 获取下一页 URL
        const moreUrl = topicList.more_topics_url;
        if (moreUrl) {
          // more_topics_url 是相对路径如 "/c/38-category/40-category/40?page=1"
          nextUrl = new URL(moreUrl, url).href;
          // 确保是 JSON 请求
          if (!nextUrl.endsWith('.json') && !nextUrl.includes('.json?')) {
            nextUrl = nextUrl.replace(/\/?(\?.*)?$/, '.json$1');
          }
          page++;
        } else {
          break;
        }
      }

      return { isDiscourse: allTopics.length > 0, topics: allTopics };
    } catch (e) {
      return { isDiscourse: false, topics: [], error: e.message };
    }
  }

  // ===== Task 5: 测试选择器匹配数量 =====
  // 参数: { url, selector }，加载 URL 后执行 document.querySelectorAll(selector).length
  // 测试选择器：支持滚动到底 + 实时进度
  ipcMain.handle('test-selector', async (event, { url, selector, scroll }) => {
    if (!url || !selector) {
      return { success: false, error: '缺少 url 或 selector 参数' };
    }
    let bv = null;
    let aborted = false;
    // 监听来自渲染进程的停止信号（ipcRenderer.send 发送到 ipcMain，不是 webContents）
    const abortHandler = () => { aborted = true; };
    ipcMain.on('test-selector-abort', abortHandler);
    try {
      bv = await getTaskBrowserView();
      // 加载 URL 并等待 did-finish-load
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!bv.webContents.isDestroyed()) bv.webContents.removeListener('did-finish-load', onLoad);
          resolve();
        }, 20000);
        const onLoad = () => {
          clearTimeout(timeout);
          bv.webContents.removeListener('did-finish-load', onLoad);
          resolve();
        };
        bv.webContents.once('did-finish-load', onLoad);
        bv.webContents.once('did-fail-load', (e, code, desc, url2, isMain) => {
          if (isMain) {
            clearTimeout(timeout);
            bv.webContents.removeListener('did-finish-load', onLoad);
            resolve();
          }
        });
        try {
          bv.webContents.loadURL(url);
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });
      // 等待 SPA 页面内容渲染完成（最多等待 8 秒）
      let spaWaited = 0;
      const maxSpaWait = 8000;
      const spaWaitInterval = 1000;
      while (spaWaited < maxSpaWait && !aborted) {
        await sleep(spaWaitInterval);
        spaWaited += spaWaitInterval;
        // 检查页面是否有实际内容（body 中有子元素且高度 > 100）
        const hasContent = await bv.webContents.executeJavaScript(
          `(function(){ try { return document.body.children.length > 0 && document.body.scrollHeight > 100; } catch(e) { return false; } })()`,
          true
        );
        if (hasContent) {
          // 再等 1 秒让 JS 框架完成渲染
          await sleep(1000);
          break;
        }
      }
      if (bv.webContents.isDestroyed() || aborted) {
        return { success: false, error: aborted ? '已停止' : 'BrowserView 已销毁' };
      }

      // 优先尝试 Discourse JSON API（绕过虚拟滚动限制）
      // Discourse 论坛使用 Ember.js 虚拟滚动，DOM 中始终只有 ~30 个节点
      // 直接调用 JSON API 分页获取全部话题
      // maxPages=100（每页30条，最多3000条），支持近2000条帖子的完整抓取
      const discourseResult = await fetchDiscourseTopicsViaAPI(bv, url, 100, () => aborted, (count) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('test-selector-progress', { 
            scrollCount: 0, 
            count: count, 
            height: 0 
          });
        }
      });
      if (discourseResult.isDiscourse && discourseResult.topics.length > 0) {
        const topics = discourseResult.topics;
        // 发送进度
        if (!event.sender.isDestroyed()) {
          event.sender.send('test-selector-progress', { 
            scrollCount: 0, 
            count: topics.length, 
            height: 0 
          });
        }
        // 构造预览（前100个，用于分类预览展示）
        const previews = topics.slice(0, 100).map((t, i) => ({
          index: i,
          tag: 'a',
          text: t.innerText,
          textContent: t.textContent,
          href: t.href,
          class: t.groupKey,
          childLinks: t.childLinks,
          groupKey: t.groupKey
        }));
        return { 
          success: true, 
          count: topics.length, 
          previews: previews, 
          scrolled: true,
          isDiscourse: true,
          discourseTopics: topics
        };
      }

      // 主进程侧累积所有出现过的唯一 href（用于虚拟滚动页面增量收集）
      const allUniqueHrefs = new Set();

      // 如果需要滚动到底（针对 Discourse 等虚拟滚动论坛的增量收集策略）
      // 虚拟滚动只保留 ~30 个 DOM 节点，滚动时回收旧节点加载新节点
      // 所以必须在滚动过程中增量收集 href 并去重，最终取 Set 大小
      if (scroll) {
        const maxScrolls = 200;
        const maxTimeMs = 120000;
        const scrollDelay = 800;
        let lastHeight = 0;
        let stableCount = 0;
        let scrollCount = 0;
        const startTime = Date.now();
        
        while (stableCount < 15 && scrollCount < maxScrolls && (Date.now() - startTime) < maxTimeMs && !aborted) {
          await bv.webContents.executeJavaScript(`window.scrollTo(0, document.body.scrollHeight);`);
          await sleep(scrollDelay);
          scrollCount++;
          
          const curHeight = await bv.webContents.executeJavaScript(`document.body.scrollHeight;`);
          
          // 提取当前 DOM 中所有匹配元素的 href
          const currentHrefs = await bv.webContents.executeJavaScript(
            `(function(){
              try {
                var els = document.querySelectorAll(${JSON.stringify(selector)});
                var hrefs = [];
                for (var i = 0; i < els.length; i++) {
                  var href = els[i].getAttribute('href') || els[i].href || '';
                  if (href && !href.startsWith('javascript:') && href !== '#') {
                    hrefs.push(href);
                  }
                }
                return hrefs;
              } catch(e) { return []; }
            })()`,
            true
          );
          
          // 累积到 Set 中去重
          const prevSize = allUniqueHrefs.size;
          for (const h of currentHrefs) { allUniqueHrefs.add(h); }
          const newSize = allUniqueHrefs.size;
          
          if (!event.sender.isDestroyed()) {
            event.sender.send('test-selector-progress', { 
              scrollCount: scrollCount, 
              count: newSize, 
              height: curHeight 
            });
          }
          
          // 如果本次滚动没有新增元素，增加稳定计数
          if (newSize === prevSize && newSize > 0) {
            stableCount++;
          } else {
            stableCount = 0;
          }
          
          if (curHeight !== lastHeight && curHeight > 0) {
            lastHeight = curHeight;
          }
        }
        
        // 滚动结束后，再等待一段时间让最后的懒加载内容渲染
        if (!aborted) {
          await sleep(2000);
          // 最终计数 = Set 中累积的唯一 href 数量
          const finalCount = allUniqueHrefs.size;
          if (!event.sender.isDestroyed()) {
            event.sender.send('test-selector-progress', { scrollCount, count: finalCount, height: lastHeight });
          }
          // 滚回顶部
          await bv.webContents.executeJavaScript(`window.scrollTo(0, 0);`);
        }
      }

      if (bv.webContents.isDestroyed() || aborted) {
        return { success: false, error: aborted ? '已停止' : 'BrowserView 已销毁' };
      }
      // 提取前20个元素的预览内容（包含子链接）
      // 注意：对于虚拟滚动页面，DOM中只有~30个节点，预览只能取当前可见的
      const result = await bv.webContents.executeJavaScript(
        `(function() {
          var extractChildLinksFn = ${extractChildLinksFn.toString()};
          try {
            var els = document.querySelectorAll(${JSON.stringify(selector)});
            var count = els.length;
            var previews = [];
            var maxPreview = Math.min(count, 20);
            for (var i = 0; i < maxPreview; i++) {
              var el = els[i];
              var text = (el.textContent || '').trim().slice(0, 200);
              var href = el.getAttribute('href') || '';
              var tag = el.tagName.toLowerCase();
              var cls = el.className || '';
              if (typeof cls !== 'string') cls = '';
              var childLinks = extractChildLinksFn(el, 50);
              previews.push({ index: i, tag: tag, text: text, href: href, class: cls, childLinks: childLinks });
            }
            return { count: count, previews: previews };
          } catch(e) { return { count: -1, previews: [] }; }
        })()`,
        true
      );
      if (!result || result.count < 0) {
        return { success: false, error: '选择器语法无效' };
      }
      // 对于虚拟滚动页面，使用 Set 中累积的唯一 href 数量作为最终 count
      const finalCount = (scroll && allUniqueHrefs.size > 0) ? allUniqueHrefs.size : result.count;
      return { success: true, count: finalCount, previews: result.previews, scrolled: !!scroll };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    } finally {
      ipcMain.removeListener('test-selector-abort', abortHandler);
      if (bv) releaseTaskBrowserView(bv);
    }
  });

  // ===== 末端抓取模板测试：用样本 URL 验证字段提取规则 =====
  // 参数: { url, fields }，返回 { success, fields, missing, pageTitle } 或 { success:false, error }
  ipcMain.handle('test-template-fields', async (event, { url, fields }) => {
    if (!url) {
      return { success: false, error: '缺少 url 参数' };
    }
    if (!Array.isArray(fields) || !fields.length) {
      return { success: false, error: '缺少 fields 配置' };
    }
    let bv = null;
    try {
      bv = await getTaskBrowserView();
      // 加载 URL
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!bv.webContents.isDestroyed()) bv.webContents.removeListener('did-finish-load', onLoad);
          resolve();
        }, 30000);
        const onLoad = () => {
          clearTimeout(timeout);
          bv.webContents.removeListener('did-finish-load', onLoad);
          resolve();
        };
        bv.webContents.once('did-finish-load', onLoad);
        bv.webContents.once('did-fail-load', (e, code, desc, u, isMain) => {
          if (isMain) {
            clearTimeout(timeout);
            bv.webContents.removeListener('did-finish-load', onLoad);
            resolve();
          }
        });
        try {
          bv.webContents.loadURL(url);
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });
      // 等待 SPA 渲染
      await sleep(2000);
      if (bv.webContents.isDestroyed()) {
        return { success: false, error: 'BrowserView 已销毁' };
      }
      // 复用 runTemplateTask 内的字段提取 JS（共用 extractTemplateFields 注入脚本）
      const extracted = await bv.webContents.executeJavaScript(
        '(' + extractTemplateFieldsFn.toString() + ')(' + JSON.stringify(fields) + ')',
        true
      );
      if (!extracted) {
        return { success: false, error: '提取失败' };
      }
      return {
        success: true,
        fields: extracted.fields || {},
        missing: extracted.missing || [],
        pageTitle: extracted.pageTitle || ''
      };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    } finally {
      if (bv) releaseTaskBrowserView(bv);
    }
  });

  // ===== Task 15: 工作流结果回写抓取信息卡片 =====
  // 将任务执行批次转换为抓取信息卡片（cardType='aiworkflow-result'）并保存到 WORKFLOWS_DIR
  function buildResultCard(task, batch) {
    const items = Array.isArray(batch && batch.items) ? batch.items : [];
    // flatMap：一个 item 可能展开为多个 resource（'all' 类型每类一个 resource）
    const resources = items.flatMap(item => {
      const itemResources = [];
      let name = '', content = '';
      let resourceType = 'text';
      if (task.type === 'crosspage' || task.type === 'template') {
        const fields = (item && item.fields) || {};
        // template: fields[k] = { values: [...], extractType, count } 或 { extractType: 'all', texts, images, videos, audios, links, downloads, count }
        // crosspage: fields[k] = string
        const isTemplateFields = Object.keys(fields).some(k =>
          fields[k] && typeof fields[k] === 'object' &&
          (Array.isArray(fields[k].values) || fields[k].extractType === 'all')
        );

        if (isTemplateFields) {
          // 处理 'all' 类型字段：将每个分类展开为独立 resource
          const pageUrl = (item && item.sourceUrl) || (task.config && task.config.url) || '';
          const fieldNames = Object.keys(fields);
          // 先处理 'all' 类型字段，展开为多个 resource
          for (const k of fieldNames) {
            const v = fields[k];
            if (!v || typeof v !== 'object' || v.extractType !== 'all') continue;

            // 汇总 resource（type=composite，包含所有分类的 JSON）
            const summaryParts = [];
            if (v.texts && v.texts.length) summaryParts.push('文本:' + v.texts.length);
            if (v.images && v.images.length) summaryParts.push('图片:' + v.images.length);
            if (v.videos && v.videos.length) summaryParts.push('视频:' + v.videos.length);
            if (v.audios && v.audios.length) summaryParts.push('音频:' + v.audios.length);
            if (v.links && v.links.length) summaryParts.push('链接:' + v.links.length);
            if (v.downloads && v.downloads.length) summaryParts.push('下载:' + v.downloads.length);
            const summaryName = k + ' [综合] ' + summaryParts.join(' / ');
            const summaryContent = JSON.stringify({
              texts: v.texts, images: v.images, videos: v.videos,
              audios: v.audios, links: v.links, downloads: v.downloads
            });
            // 汇总 childLinks：所有 links + downloads + videos + audios + images 的 URL
            const allChildLinks = [];
            if (Array.isArray(v.links)) {
              for (const lnk of v.links) {
                if (lnk && lnk.href) allChildLinks.push({ href: lnk.href, text: lnk.text || '' });
              }
            }
            if (Array.isArray(v.downloads)) {
              for (const dl of v.downloads) {
                if (dl && dl.href) allChildLinks.push({ href: dl.href, text: dl.text || 'download' });
              }
            }
            if (Array.isArray(v.videos)) {
              for (const vv of v.videos) {
                if (vv) allChildLinks.push({ href: String(vv), text: 'video' });
              }
            }
            if (Array.isArray(v.audios)) {
              for (const aa of v.audios) {
                if (aa) allChildLinks.push({ href: String(aa), text: 'audio' });
              }
            }
            if (Array.isArray(v.images)) {
              for (const im of v.images) {
                if (im) allChildLinks.push({ href: String(im), text: 'image' });
              }
            }

            // 推断主资源类型
            let mainType = 'text';
            if (v.videos && v.videos.length) mainType = 'video';
            else if (v.audios && v.audios.length) mainType = 'audio';
            else if (v.downloads && v.downloads.length) mainType = 'download';
            else if (v.links && v.links.length) mainType = 'link';
            else if (v.images && v.images.length) mainType = 'image';

            itemResources.push({
              type: mainType,
              name: summaryName.slice(0, 100),
              content: summaryContent,
              pageUrl: pageUrl,
              childLinks: allChildLinks
            });

            // 为每个分类生成独立 resource（便于后续预处理/导出）
            // 文本
            if (v.texts && v.texts.length) {
              itemResources.push({
                type: 'text',
                name: k + ' 文本 (' + v.texts.length + ')',
                content: v.texts.join('\n').slice(0, 2000),
                pageUrl: pageUrl
              });
            }
            // 图片
            if (v.images && v.images.length) {
              for (let i = 0; i < v.images.length; i++) {
                itemResources.push({
                  type: 'image',
                  name: k + ' 图片 ' + (i + 1),
                  content: '',
                  url: v.images[i],
                  pageUrl: pageUrl
                });
              }
            }
            // 视频
            if (v.videos && v.videos.length) {
              for (let i = 0; i < v.videos.length; i++) {
                itemResources.push({
                  type: 'video',
                  name: k + ' 视频 ' + (i + 1),
                  content: '',
                  url: v.videos[i],
                  pageUrl: pageUrl
                });
              }
            }
            // 音频
            if (v.audios && v.audios.length) {
              for (let i = 0; i < v.audios.length; i++) {
                itemResources.push({
                  type: 'audio',
                  name: k + ' 音频 ' + (i + 1),
                  content: '',
                  url: v.audios[i],
                  pageUrl: pageUrl
                });
              }
            }
            // 超链接
            if (v.links && v.links.length) {
              for (let i = 0; i < v.links.length; i++) {
                itemResources.push({
                  type: 'link',
                  name: (v.links[i].text || k + ' 链接 ' + (i + 1)).slice(0, 50),
                  content: v.links[i].text || '',
                  url: v.links[i].href,
                  pageUrl: pageUrl
                });
              }
            }
            // 下载链接
            if (v.downloads && v.downloads.length) {
              for (let i = 0; i < v.downloads.length; i++) {
                itemResources.push({
                  type: 'download',
                  name: (v.downloads[i].text || k + ' 下载 ' + (i + 1)).slice(0, 50),
                  content: '',
                  url: v.downloads[i].href,
                  pageUrl: pageUrl
                });
              }
            }
          }

          // 再处理非 'all' 类型字段（原有逻辑：合并为一个汇总 resource）
          const nonAllFields = fieldNames.filter(k => {
            const v = fields[k];
            return v && typeof v === 'object' && Array.isArray(v.values);
          });
          if (nonAllFields.length) {
            name = nonAllFields.map(k => {
              const v = fields[k];
              const cnt = v && v.count != null ? v.count : 0;
              return k + '(' + (v && v.extractType ? v.extractType : 'text') + '):' + cnt;
            }).join(' | ').slice(0, 50);
            content = JSON.stringify(fields);
            const types = nonAllFields.map(k => fields[k] && fields[k].extractType).filter(Boolean);
            if (types.includes('video')) resourceType = 'video';
            else if (types.includes('audio')) resourceType = 'audio';
            else if (types.includes('download')) resourceType = 'download';
            else if (types.includes('image')) resourceType = 'image';
            else if (types.includes('link')) resourceType = 'link';

            const ret = {
              type: resourceType,
              name: name,
              content: content,
              pageUrl: (item && item.sourceUrl) || (task.config && task.config.url) || ''
            };
            // 链接资源附带 url 字段
            if (resourceType === 'link') {
              const v = fields[nonAllFields[0]];
              ret.url = (v && v.values && v.values[0]) || '';
            }
            // image/video/audio/download 资源也附带 url
            if (resourceType === 'image' || resourceType === 'video' || resourceType === 'audio' || resourceType === 'download') {
              const v = fields[nonAllFields[0]];
              ret.url = (v && v.values && v.values[0]) || '';
            }
            // template 类型：从 fields 中提取 link/download 类型字段的 URL，作为 childLinks 补充
            const tplLinks = [];
            for (const k of nonAllFields) {
              const v = fields[k];
              if (v && typeof v === 'object' && Array.isArray(v.values)) {
                const et = v.extractType || 'text';
                if (et === 'link' || et === 'download' || et === 'image' || et === 'video' || et === 'audio') {
                  for (const val of v.values) {
                    if (val) tplLinks.push({ href: String(val), text: k });
                  }
                }
              }
            }
            if (tplLinks.length > 0) {
              ret.childLinks = (ret.childLinks || []).concat(tplLinks);
            }
            itemResources.push(ret);
          }

          // 如果只有 'all' 类型字段，返回展开的资源；否则继续处理
          if (itemResources.length) {
            return itemResources;
          }
        } else {
          // crosspage 旧结构
          name = Object.keys(fields).map(k => k + ':' + String(fields[k] || '').slice(0, 20)).join(' | ').slice(0, 30);
          content = JSON.stringify(fields);
        }
      } else if (task.type === 'tracking') {
        const text = item.textContent || item.content || '';
        name = text.slice(0, 30) || (item.id || '');
        content = text;
      } else {
        // batch：同时抓取文本和超链接
        const text = item.textContent || '';
        const attrs = item.attributes || {};
        const href = attrs.href || '';
        name = text.slice(0, 30) || (item.id || '');
        content = text;
        // 如果是链接元素（有 href），生成 link 资源类型，并附带 url
        if (href && href !== '#' && !href.startsWith('javascript:')) {
          resourceType = 'link';
        }
      }
      const ret = {
        type: resourceType,
        name: name,
        content: content,
        pageUrl: (item && item.sourceUrl) || (task.config && task.config.url) || ''
      };
      // 链接资源附带 url 字段，便于下游任务解析
      if (resourceType === 'link') {
        const attrs = item.attributes || {};
        ret.url = attrs.href || item.sourceUrl || '';
      }
      // 保留 childLinks（batch 类型抓取时提取的子链接，便于下游任务/卡片选择器导入）
      if (Array.isArray(item.childLinks) && item.childLinks.length > 0) {
        ret.childLinks = item.childLinks;
      }
      // template 类型：从 fields 中提取 link 类型字段的 URL，作为 childLinks 补充
      if (task.type === 'template') {
        const fields = (item && item.fields) || {};
        const tplLinks = [];
        for (const k of Object.keys(fields)) {
          const v = fields[k];
          if (v && typeof v === 'object' && Array.isArray(v.values)) {
            const et = v.extractType || 'text';
            if (et === 'link' || et === 'download') {
              for (const val of v.values) {
                if (val) tplLinks.push({ href: String(val), text: k });
              }
            }
          }
        }
        if (tplLinks.length > 0) {
          ret.childLinks = (ret.childLinks || []).concat(tplLinks);
        }
      }
      itemResources.push(ret);
      return itemResources;
    });
    const cfg = task.config || {};
    return {
      cardType: 'aiworkflow-result',
      sourceTaskId: task.id,
      sourceTaskType: task.type,
      sourceTaskName: task.name,
      title: (task.name || 'AI工作流') + ' ' + new Date(batch && batch.runAt || Date.now()).toLocaleString('zh-CN'),
      url: cfg.url || (Array.isArray(cfg.urls) && cfg.urls[0]) || '',
      time: (batch && batch.runAt) || new Date().toISOString(),
      createdAt: new Date().toISOString(),
      resources: resources,
      resourceCount: resources.length,
      aiworkflowBatchId: batch && batch.batchId
    };
  }

  // 保存结果卡片到 WORKFLOWS_DIR，返回卡片 id
  function saveResultCard(card) {
    if (!WORKFLOWS_DIR) return null;
    const id = Date.now().toString(36) + '_aw';
    card.id = id;
    card.savedAt = new Date().toISOString();
    const filePath = path.join(WORKFLOWS_DIR, id + '.json');
    fs.writeFileSync(filePath, JSON.stringify(card, null, 2), 'utf8');
    return id;
  }

  // ===== Task 5: 运行 AI 工作流任务 =====
  // 参数: taskId，返回 { success, batchId, itemCount, cardId? } 或 { success:false, error }
  ipcMain.handle('run-aiworkflow-task', async (event, taskId) => {
    try {
      if (!taskId) return { success: false, error: '缺少 taskId' };
      const filePath = path.join(AIWORKFLOWS_DIR, taskId + '.json');
      if (!fs.existsSync(filePath)) return { success: false, error: 'AI工作流不存在' };
      const task = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      const isTracking = task.type === 'tracking';

      // 更新任务状态为运行中
      task.status = 'running';
      fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf8');

      let result;
      try {
        if (task.type === 'batch') {
          result = await runBatchTask(task);
        } else if (task.type === 'crosspage') {
          result = await runCrosspageTask(task);
        } else if (task.type === 'template') {
          result = await runTemplateTask(task);
        } else if (task.type === 'tracking') {
          // 追踪任务自己负责写回 knownIds/results/status
          result = await runTrackingTask(task, true);
          // Task 15: 追踪任务结果回写卡片（读取已写回的最新 batch）
          let trackingCardId = null;
          try {
            const freshTask = readTaskFile(taskId);
            if (freshTask) {
              const batches = Array.isArray(freshTask.results) ? freshTask.results : [];
              const batch = batches.find(b => b && b.batchId === result.batchId) || batches[batches.length - 1];
              if (batch) {
                const card = buildResultCard(freshTask, batch);
                trackingCardId = saveResultCard(card);
                if (trackingCardId) {
                  batch.cardId = trackingCardId;
                  writeTaskFile(freshTask);
                }
              }
            }
          } catch (e) { /* 卡片回写失败不影响任务结果 */ }
          return { success: true, batchId: result.batchId, itemCount: result.count, newCount: result.newCount, cardId: trackingCardId };
        } else {
          throw new Error('未知任务类型: ' + task.type);
        }
      } catch (err) {
        // 任务失败，恢复状态
        task.status = isTracking ? 'tracking' : 'idle';
        task.lastRunAt = new Date().toISOString();
        fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf8');
        return { success: false, error: err.message || String(err) };
      }

      // 写回结果（batch/crosspage）
      task.results = task.results || [];
      task.results.push(result);
      task.lastRunAt = new Date().toISOString();
      task.status = 'idle';

      // Task 15: batch/crosspage 结果回写卡片
      let resultCardId = null;
      try {
        const card = buildResultCard(task, result);
        resultCardId = saveResultCard(card);
        if (resultCardId) result.cardId = resultCardId;
      } catch (e) { /* 卡片回写失败不影响任务结果 */ }

      fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf8');

      // ===== 自动导出（batch / template 任务，按「页面标题\资源类型」分类保存） =====
      let autoExportPath = null;
      if ((task.type === 'batch' || task.type === 'template') && task.config && task.config.autoExport) {
        try {
          const exportFormat = task.config.exportFormat || 'json';
          // 任务级路径优先；未设置时回退到全局默认导出目录
          const exportDir = task.config.exportPath || getDefaultExportDir();
          if (!exportDir) {
            console.warn('[AIWorkflow] 自动导出跳过：未设置任务级路径且无全局默认导出目录');
          } else {
            const items = Array.isArray(result.items) ? result.items : [];

            if (fs.existsSync(exportDir) === false) {
              fs.mkdirSync(exportDir, { recursive: true });
            }

            // 按 sourceUrl 分组（每个网页一组）
            const pageGroups = {};
            const pageOrder = [];
            for (const item of items) {
              const url = (item && (item.sourceUrl || item.url)) || '(unknown)';
              if (!pageGroups[url]) { pageGroups[url] = []; pageOrder.push(url); }
              pageGroups[url].push(item);
            }

            // 类型标签映射
            const typeLabels = {
              text: '文本', image: '图片', video: '视频',
              audio: '音频', link: '链接', download: '下载'
            };

            const escapeFileName = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').substring(0, 100);

            for (const url of pageOrder) {
              const groupItems = pageGroups[url];
              const firstItem = groupItems[0] || {};
              let pageTitle = firstItem.pageTitle || '';
              if (!pageTitle) {
                try {
                  const u = new URL(url);
                  pageTitle = u.hostname + (u.pathname && u.pathname !== '/' ? u.pathname.replace(/\//g, '_').substring(0, 50) : '');
                } catch { pageTitle = 'unknown_page'; }
              }
              const safeTitle = escapeFileName(pageTitle) || 'unknown_page';
              const pageDir = path.join(exportDir, safeTitle);
              if (fs.existsSync(pageDir) === false) {
                fs.mkdirSync(pageDir, { recursive: true });
              }

              // 收集该网页所有资源，按类型分类
              const byType = { text: [], image: [], video: [], audio: [], link: [], download: [] };
              for (const item of groupItems) {
                const fields = (item && item.fields) || {};
                const isTemplateFields = Object.keys(fields).some(k =>
                  fields[k] && typeof fields[k] === 'object' &&
                  (Array.isArray(fields[k].values) || fields[k].extractType === 'all')
                );

                if (isTemplateFields) {
                  for (const k of Object.keys(fields)) {
                    const v = fields[k];
                    if (!v || typeof v !== 'object') continue;

                    // 'all' 类型：综合字段，按子类型展开
                    if (v.extractType === 'all') {
                      if (Array.isArray(v.texts)) for (const t of v.texts) if (t) byType.text.push({ field: k, value: t });
                      if (Array.isArray(v.images)) for (const im of v.images) if (im) byType.image.push({ field: k, value: im });
                      if (Array.isArray(v.videos)) for (const vv of v.videos) if (vv) byType.video.push({ field: k, value: vv });
                      if (Array.isArray(v.audios)) for (const aa of v.audios) if (aa) byType.audio.push({ field: k, value: aa });
                      if (Array.isArray(v.links)) for (const lnk of v.links) if (lnk && lnk.href) byType.link.push({ field: k, value: lnk.href, text: lnk.text || '' });
                      if (Array.isArray(v.downloads)) for (const dl of v.downloads) if (dl && dl.href) byType.download.push({ field: k, value: dl.href, text: dl.text || '' });
                    } else if (Array.isArray(v.values)) {
                      let extractType = v.extractType || 'text';
                      if (!typeLabels[extractType]) extractType = 'text';
                      for (const val of v.values) {
                        if (val == null || val === '') continue;
                        byType[extractType].push({ field: k, value: String(val) });
                      }
                    }
                  }
                } else {
                  // crosspage: fields[k] = string，全部归为文本
                  for (const k of Object.keys(fields)) {
                    const val = fields[k];
                    if (typeof val === 'string' && val) byType.text.push({ field: k, value: val });
                    else if (val != null && val !== '') byType.text.push({ field: k, value: String(val) });
                  }
                }
              }

              // 子目录下保存一份索引文件（页面信息）
              const indexPath = path.join(pageDir, safeTitle + '_索引.json');
              try {
                const indexData = {
                  pageTitle: pageTitle,
                  sourceUrl: url,
                  exportedAt: new Date().toISOString(),
                  counts: {
                    文本: byType.text.length, 图片: byType.image.length, 视频: byType.video.length,
                    音频: byType.audio.length, 链接: byType.link.length, 下载: byType.download.length
                  }
                };
                fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf8');
              } catch (e) { /* 索引文件失败不阻断 */ }

              // 按类型保存文件
              for (const t of Object.keys(byType)) {
                const arr = byType[t];
                if (!arr.length) continue;
                const typeLabel = typeLabels[t];
                const fileName = `${safeTitle}_${typeLabel}.${exportFormat}`;
                const fullPath = path.join(pageDir, fileName);

                let content = '';
                let bom = '';
                if (exportFormat === 'json') {
                  content = JSON.stringify(arr, null, 2);
                } else if (exportFormat === 'csv') {
                  const headers = ['field', 'value', 'text'];
                  const rows = [headers.join(',')];
                  for (const r of arr) {
                    const cells = headers.map(k => {
                      const v = r[k];
                      if (v == null) return '';
                      const s = String(v).replace(/"/g, '""');
                      return /[",\n]/.test(s) ? '"' + s + '"' : s;
                    });
                    rows.push(cells.join(','));
                  }
                  content = rows.join('\n');
                  bom = '\uFEFF';
                } else if (exportFormat === 'md') {
                  const lines = ['# ' + safeTitle + ' - ' + typeLabel + '\n'];
                  for (const r of arr) {
                    lines.push('- **' + r.field + '**: ' + r.value + (r.text ? ' | ' + r.text : ''));
                  }
                  content = lines.join('\n');
                } else { // txt
                  const lines = ['【' + safeTitle + ' - ' + typeLabel + '】\n'];
                  for (const r of arr) {
                    lines.push('[' + r.field + '] ' + r.value + (r.text ? ' | ' + r.text : ''));
                  }
                  content = lines.join('\n');
                }
                fs.writeFileSync(fullPath, bom + content, 'utf8');
              }
              if (!autoExportPath) autoExportPath = pageDir;
            }

            // 没有 items 但配置了 autoExport，返回 exportDir
            if (!autoExportPath) autoExportPath = exportDir;
            console.log('[AIWorkflow] 自动导出完成（分类保存）:', autoExportPath);
          }
        } catch (exportErr) {
          console.error('[AIWorkflow] 自动导出失败:', exportErr);
        }
      }

      return { success: true, batchId: result.batchId, itemCount: result.count, cardId: resultCardId, autoExportPath };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // ===== Task 10.5: 链式运行 =====
  // 运行指定任务，完成后自动运行所有以其为上游的下游任务
  // 返回 { success, chainResults: [{ taskId, taskName, success, itemCount, error? }] }
  ipcMain.handle('chain-run-aiworkflow-task', async (event, taskId) => {
    const chainResults = [];
    const visited = new Set(); // 防止循环依赖

    const runTaskChain = async (id) => {
      if (!id || visited.has(id)) return;
      visited.add(id);

      const filePath = path.join(AIWORKFLOWS_DIR, id + '.json');
      if (!fs.existsSync(filePath)) {
        chainResults.push({ taskId: id, taskName: '(不存在)', success: false, error: '任务不存在' });
        return;
      }
      const task = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const taskName = task.name || '未命名';
      const isTracking = task.type === 'tracking';

      task.status = 'running';
      fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf8');

      try {
        let result;
        if (task.type === 'batch') {
          result = await runBatchTask(task);
        } else if (task.type === 'crosspage') {
          result = await runCrosspageTask(task);
        } else if (task.type === 'template') {
          result = await runTemplateTask(task);
        } else if (task.type === 'tracking') {
          result = await runTrackingTask(task, true);
        } else {
          throw new Error('未知任务类型: ' + task.type);
        }

        // 写回结果（非 tracking）
        if (task.type !== 'tracking') {
          task.results = task.results || [];
          task.results.push(result);
          task.lastRunAt = new Date().toISOString();
          task.status = 'idle';
          // 结果回写卡片
          try {
            const card = buildResultCard(task, result);
            const resultCardId = saveResultCard(card);
            if (resultCardId) result.cardId = resultCardId;
          } catch (e) { /* ignore */ }
          fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf8');
        }

        chainResults.push({
          taskId: id,
          taskName: taskName,
          success: true,
          itemCount: result.count,
          newCount: result.newCount
        });

        // 递归运行下游任务
        const downstream = findDownstreamTasks(id);
        for (const ds of downstream) {
          await runTaskChain(String(ds.id));
        }
      } catch (err) {
        task.status = isTracking ? 'tracking' : 'idle';
        task.lastRunAt = new Date().toISOString();
        fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf8');
        chainResults.push({
          taskId: id,
          taskName: taskName,
          success: false,
          error: err.message || String(err)
        });
      }
    };

    try {
      if (!taskId) return { success: false, error: '缺少 taskId' };
      await runTaskChain(String(taskId));
      return { success: true, chainResults: chainResults };
    } catch (e) {
      return { success: false, error: e.message || String(e), chainResults: chainResults };
    }
  });

  // ===== Task 10.6: 获取可链式依赖的上游任务列表 =====
  ipcMain.handle('list-source-tasks', async (event, excludeTaskId) => {
    try {
      if (!AIWORKFLOWS_DIR) return { success: true, data: [] };
      const files = fs.readdirSync(AIWORKFLOWS_DIR).filter(f => f.endsWith('.json'));
      const tasks = [];
      for (const f of files) {
        try {
          const task = JSON.parse(fs.readFileSync(path.join(AIWORKFLOWS_DIR, f), 'utf8'));
          if (task && task.id && String(task.id) !== String(excludeTaskId)) {
            const resultCount = Array.isArray(task.results) ? task.results.length : 0;
            const latestCount = resultCount > 0
              ? (task.results[resultCount - 1].count || 0)
              : 0;
            tasks.push({
              id: task.id,
              name: task.name || '未命名',
              type: task.type,
              resultCount: resultCount,
              latestItemCount: latestCount
            });
          }
        } catch (e) { /* ignore */ }
      }
      return { success: true, data: tasks };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // ===== Task 11: 导出 AI 工作流结果 =====
  // 参数: { taskId, batchId?, format }  format: txt/json/md/csv
  ipcMain.handle('export-aiworkflow-results', async (event, { taskId, batchId, format }) => {
    try {
      if (!taskId) return { success: false, error: '缺少 taskId' };
      if (!format || !['txt', 'json', 'md', 'csv'].includes(format)) {
        return { success: false, error: '格式无效，支持 txt/json/md/csv' };
      }
      const task = readTaskFile(taskId);
      if (!task) return { success: false, error: '任务不存在' };
      const allResults = Array.isArray(task.results) ? task.results : [];
      if (!allResults.length) return { success: false, error: '任务无结果可导出' };

      let batches;
      if (batchId) {
        const b = allResults.find(r => r.batchId === batchId);
        if (!b) return { success: false, error: '未找到指定批次' };
        batches = [b];
      } else {
        batches = allResults;
      }

      // 合并所有批次的 items 作为导出数据
      const items = [];
      batches.forEach(b => {
        const its = Array.isArray(b.items) ? b.items : [];
        its.forEach(it => items.push(it));
      });
      if (!items.length) return { success: false, error: '批次无条目可导出' };

      const taskType = task.type;
      let content;
      if (format === 'json') {
        content = JSON.stringify(items, null, 2);
      } else if (format === 'csv') {
        content = buildExportCsv(items, taskType, task.config);
      } else if (format === 'md') {
        content = buildExportMd(items, taskType, batches, task.config);
      } else {
        content = buildExportTxt(items, taskType);
      }

      const taskName = (task.name || 'task').replace(/[\\/:*?"<>|]/g, '_');
      const filters = [
        { name: format.toUpperCase() + ' 文件', extensions: [format] },
        { name: '所有文件', extensions: ['*'] }
      ];
      const result = dialog.showSaveDialogSync(mainWindow, {
        title: '导出结果',
        defaultPath: taskName + (batchId ? '_' + batchId : '') + '.' + format,
        filters
      });
      if (!result) return { success: false, error: '取消' };
      fs.writeFileSync(result, content, 'utf8');
      return { success: true, path: result };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // CSV 字段转义：含逗号、换行、双引号时用双引号包裹，内部双引号双写
  function csvEscape(val) {
    if (val == null) return '';
    const s = String(val);
    if (/[",\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  // 按任务类型展平为 CSV
  function buildExportCsv(items, taskType, config) {
    let header, rows;
    if (taskType === 'batch') {
      header = ['id', 'parentId', 'level', 'groupKey', 'href', 'textContent', 'childLinks'];
      rows = items.map(it => {
        // 子链接格式化为 "text|href; text|href"
        let childLinksStr = '';
        if (Array.isArray(it.childLinks) && it.childLinks.length > 0) {
          childLinksStr = it.childLinks.map(cl => (cl.text || '') + '|' + (cl.href || '')).join('; ');
        }
        return [
          it.id || '',
          it.parentId || '',
          it.level || 0,
          it.groupKey || '',
          it.href || (it.attributes && it.attributes.href) || '',
          it.textContent || '',
          childLinksStr
        ];
      });
    } else if (taskType === 'crosspage') {
      const fieldNames = (config && Array.isArray(config.fieldMappings) ? config.fieldMappings : [])
        .map(f => f.name).filter(Boolean);
      header = ['sourceUrl', 'overridden'].concat(fieldNames);
      rows = items.map(it => {
        const fields = it.fields || {};
        const row = [it.sourceUrl || '', it.overridden ? 'true' : 'false'];
        fieldNames.forEach(fn => row.push(fields[fn] == null ? '' : String(fields[fn])));
        return row;
      });
    } else if (taskType === 'template') {
      // 末端抓取：每条 item 有 sourceUrl + fields（值为 { values:[...], extractType, count }）
      // 展平为：sourceUrl, pageTitle, fieldName, extractType, valueIndex, value
      const fieldNames = (config && Array.isArray(config.fields) ? config.fields : [])
        .map(f => f.name).filter(Boolean);
      header = ['sourceUrl', 'pageTitle', 'fieldName', 'extractType', 'valueIndex', 'value'];
      rows = [];
      items.forEach(it => {
        const fields = it.fields || {};
        fieldNames.forEach(fn => {
          const fv = fields[fn];
          if (fv && Array.isArray(fv.values) && fv.values.length > 0) {
            fv.values.forEach((val, vi) => {
              rows.push([
                it.sourceUrl || '',
                it.pageTitle || '',
                fn,
                fv.extractType || 'text',
                vi,
                val == null ? '' : String(val)
              ]);
            });
          } else {
            rows.push([
              it.sourceUrl || '',
              it.pageTitle || '',
              fn,
              (fv && fv.extractType) || 'text',
              0,
              ''
            ]);
          }
        });
        if (it.error) {
          rows.push([it.sourceUrl || '', it.pageTitle || '', '(error)', '', 0, it.error]);
        }
      });
    } else { // tracking
      header = ['id', 'isNew', 'detectedAt', 'content'];
      rows = items.map(it => [
        it.id || '',
        it.isNew ? 'true' : 'false',
        it.detectedAt || '',
        it.textContent || ''
      ]);
    }
    const lines = [header.map(csvEscape).join(',')];
    rows.forEach(r => lines.push(r.map(csvEscape).join(',')));
    // 加 BOM 以便 Excel 正确识别 UTF-8
    return '\uFEFF' + lines.join('\r\n');
  }

  // Markdown 格式
  function buildExportMd(items, taskType, batches, config) {
    let out = '';
    if (taskType === 'batch') {
      const groups = {};
      items.forEach(it => {
        const gk = it.groupKey || 'default';
        if (!groups[gk]) groups[gk] = [];
        groups[gk].push(it);
      });
      out += '# 批量抓取结果\n\n';
      Object.keys(groups).forEach(gk => {
        out += '## ' + gk + '\n\n';
        groups[gk].forEach(it => {
          const lvl = it.level || 0;
          const text = (it.textContent || '').replace(/\n/g, ' ');
          const href = it.href || (it.attributes && it.attributes.href) || '';
          out += '- [level ' + lvl + '] ' + text + '\n';
          if (href) out += '  - 链接: ' + href + '\n';
          // 子链接
          if (Array.isArray(it.childLinks) && it.childLinks.length > 0) {
            it.childLinks.forEach(cl => {
              out += '  - [' + (cl.text || '').replace(/\n/g, ' ') + '](' + (cl.href || '') + ')\n';
            });
          }
        });
        out += '\n';
      });
    } else if (taskType === 'crosspage') {
      out += '# 跨页面抓取结果\n\n';
      const groups = {};
      items.forEach(it => {
        const url = it.sourceUrl || '(无URL)';
        if (!groups[url]) groups[url] = [];
        groups[url].push(it);
      });
      Object.keys(groups).forEach(url => {
        const tuned = groups[url].some(it => it.overridden);
        out += '## ' + url + (tuned ? ' (已微调)' : '') + '\n\n';
        groups[url].forEach(it => {
          const fields = it.fields || {};
          Object.keys(fields).forEach(k => {
            const v = (fields[k] == null ? '' : String(fields[k])).replace(/\n/g, ' ');
            out += '- **' + k + '**: ' + v + '\n';
          });
          if (it.error) out += '- ⚠ 错误: ' + it.error + '\n';
          out += '\n';
        });
      });
    } else if (taskType === 'template') {
      // 末端抓取：按 URL 分组，每个 URL 下列出各字段及 values
      out += '# 末端抓取结果（模板批量提取）\n\n';
      const groups = {};
      items.forEach(it => {
        const url = it.sourceUrl || '(无URL)';
        if (!groups[url]) groups[url] = [];
        groups[url].push(it);
      });
      Object.keys(groups).forEach(url => {
        out += '## ' + url + '\n\n';
        groups[url].forEach(it => {
          if (it.pageTitle) out += '> 页面标题: ' + it.pageTitle.replace(/\n/g, ' ') + '\n\n';
          const fields = it.fields || {};
          Object.keys(fields).forEach(k => {
            const fv = fields[k];
            const extType = (fv && fv.extractType) || 'text';
            const cnt = (fv && fv.count != null) ? fv.count : 0;
            const vals = (fv && Array.isArray(fv.values)) ? fv.values : [];
            out += '- **' + k + '** (' + extType + ', ' + cnt + '个)\n';
            vals.forEach(v => {
              out += '  - ' + (v == null ? '' : String(v).replace(/\n/g, ' ')) + '\n';
            });
          });
          if (Array.isArray(it.missing) && it.missing.length) {
            out += '- ⚠ 缺失字段: ' + it.missing.join(', ') + '\n';
          }
          if (it.error) out += '- ⚠ 错误: ' + it.error + '\n';
          out += '\n';
        });
      });
    } else { // tracking
      out += '# 更新追踪结果\n\n';
      batches.forEach(b => {
        const its = Array.isArray(b.items) ? b.items : [];
        const label = b.isBaseline ? '基线' : '更新';
        out += '## 批次 ' + (b.batchId || '') + ' (' + label + ')\n\n';
        its.forEach(it => {
          const tag = it.isNew ? '新增' : (b.isBaseline ? '基线' : '已有');
          const text = (it.textContent || '').replace(/\n/g, ' ');
          out += '- [' + tag + '] ' + text + '\n';
        });
        out += '\n';
      });
    }
    return out;
  }

  // TXT 格式：简单 key: value 行，每条 item 用 --- 分隔
  function buildExportTxt(items, taskType) {
    const lines = [];
    items.forEach(it => {
      if (taskType === 'batch') {
        lines.push('id: ' + (it.id || ''));
        lines.push('parentId: ' + (it.parentId || ''));
        lines.push('level: ' + (it.level || 0));
        lines.push('groupKey: ' + (it.groupKey || ''));
        lines.push('href: ' + (it.href || (it.attributes && it.attributes.href) || ''));
        lines.push('textContent: ' + (it.textContent || ''));
        // 子链接（超链接）
        if (Array.isArray(it.childLinks) && it.childLinks.length > 0) {
          lines.push('childLinks:');
          it.childLinks.forEach(cl => {
            lines.push('  - text: ' + (cl.text || ''));
            lines.push('    href: ' + (cl.href || ''));
          });
        }
      } else if (taskType === 'crosspage') {
        lines.push('sourceUrl: ' + (it.sourceUrl || ''));
        lines.push('overridden: ' + (it.overridden ? 'true' : 'false'));
        const fields = it.fields || {};
        Object.keys(fields).forEach(k => {
          lines.push(k + ': ' + (fields[k] == null ? '' : String(fields[k])));
        });
        if (it.error) lines.push('error: ' + it.error);
      } else if (taskType === 'template') {
        // 末端抓取：每个 URL 输出 sourceUrl + pageTitle + 各字段 values
        lines.push('sourceUrl: ' + (it.sourceUrl || ''));
        lines.push('pageTitle: ' + (it.pageTitle || ''));
        const fields = it.fields || {};
        Object.keys(fields).forEach(k => {
          const fv = fields[k];
          const extType = (fv && fv.extractType) || 'text';
          const cnt = (fv && fv.count != null) ? fv.count : 0;
          const vals = (fv && Array.isArray(fv.values)) ? fv.values : [];
          lines.push(k + ' (' + extType + ', ' + cnt + '个):');
          vals.forEach((v, vi) => {
            lines.push('  [' + vi + '] ' + (v == null ? '' : String(v)));
          });
        });
        if (Array.isArray(it.missing) && it.missing.length) {
          lines.push('missing: ' + it.missing.join(', '));
        }
        if (it.error) lines.push('error: ' + it.error);
      } else { // tracking
        lines.push('id: ' + (it.id || ''));
        lines.push('isNew: ' + (it.isNew ? 'true' : 'false'));
        lines.push('detectedAt: ' + (it.detectedAt || ''));
        lines.push('content: ' + (it.textContent || ''));
      }
      lines.push('---');
    });
    return lines.join('\n');
  }

  // ===== Task 5: 批量抓取任务执行 =====
  async function runBatchTask(task) {
    const config = task.config || {};
    const url = config.url;
    const selector = config.selector;
    const classifyBy = config.classifyBy || 'none';
    const preserveRelations = config.preserveRelations !== false;
    const matchMode = config.matchMode || 'all';
    const matchLimit = config.matchLimit || null;

    if (!url || !selector) {
      throw new Error('任务配置缺少 url 或 selector');
    }

    const bv = await getTaskBrowserView();
    let aborted = false;
    const abortHandler = () => { aborted = true; };
    // 注册停止信号（通过 ipcMain 监听，因为 ipcRenderer.send 发送到 ipcMain）
    ipcMain.on('test-selector-abort', abortHandler);
    try {
      // 加载 URL 并等待页面就绪
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!bv.webContents.isDestroyed()) bv.webContents.removeListener('did-finish-load', onLoad);
          resolve();
        }, 30000);
        const onLoad = () => {
          clearTimeout(timeout);
          bv.webContents.removeListener('did-finish-load', onLoad);
          resolve();
        };
        bv.webContents.once('did-finish-load', onLoad);
        bv.webContents.once('did-fail-load', (e, code, desc, u, isMain) => {
          if (isMain) {
            clearTimeout(timeout);
            bv.webContents.removeListener('did-finish-load', onLoad);
            resolve();
          }
        });
        try {
          bv.webContents.loadURL(url);
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });

      // 等待 SPA 页面内容渲染完成（最多等待 8 秒）
      let spaWaited = 0;
      const maxSpaWait = 8000;
      while (spaWaited < maxSpaWait && !aborted) {
        await sleep(1000);
        spaWaited += 1000;
        const hasContent = await bv.webContents.executeJavaScript(
          `(function(){ try { return document.body.children.length > 0 && document.body.scrollHeight > 100; } catch(e) { return false; } })()`,
          true
        );
        if (hasContent) {
          await sleep(1000);
          break;
        }
      }

      if (bv.webContents.isDestroyed() || aborted) {
        throw new Error(aborted ? '用户已停止' : 'BrowserView 已销毁');
      }

      // 优先尝试 Discourse JSON API（绕过虚拟滚动限制）
      // Discourse 论坛使用 Ember.js 虚拟滚动，DOM 中始终只有 ~30 个节点
      // 直接调用 JSON API 分页获取全部话题
      // maxPages=100（每页30条，最多3000条），支持近2000条帖子的完整抓取
      const discourseResult = await fetchDiscourseTopicsViaAPI(bv, url, 100, () => aborted);
      if (discourseResult.isDiscourse && discourseResult.topics.length > 0) {
        let finalItems = discourseResult.topics;
        // 应用 matchLimit
        if (matchLimit && typeof matchLimit === 'number' && matchLimit > 0) {
          finalItems = finalItems.slice(0, matchLimit);
        }
        // 给每个 item 添加 id
        for (let k = 0; k < finalItems.length; k++) {
          if (!finalItems[k].id) finalItems[k].id = 'item_' + k;
        }
        // 按 groupKey 分组
        const groups = {};
        for (let k = 0; k < finalItems.length; k++) {
          const gk = finalItems[k].groupKey || 'default';
          if (!groups[gk]) groups[gk] = [];
          groups[gk].push(finalItems[k].id);
        }
        const batchId = Date.now().toString(36);
        return {
          batchId: batchId,
          runAt: new Date().toISOString(),
          url: url,
          selector: selector,
          items: finalItems,
          groups: groups,
          count: finalItems.length
        };
      }

      // 主进程侧累积所有出现过的唯一 href（用于虚拟滚动页面增量收集）
      const allUniqueHrefs = new Set();
      // 累积所有出现过的元素数据（用于虚拟滚动页面）
      const allItemsMap = new Map(); // key=href, value=item data

      // matchMode === 'all' 时滚动到底部触发懒加载（增量收集策略）
      // 关键：虚拟滚动页面 DOM 中始终只有 ~30 个节点，Set 大小永远不变
      // 所以不能用 Set 大小判断稳定，必须用滚动位置进度判断
      if (matchMode === 'all') {
        const maxScrolls = 300;
        const maxTimeMs = 180000;
        const scrollDelay = 600;
        let scrollCount = 0;
        const startTime = Date.now();
        let maxScrollTop = 0;
        let noProgressCount = 0; // 连续无法向下滚动的次数

        while (scrollCount < maxScrolls && (Date.now() - startTime) < maxTimeMs && !aborted) {
          // 获取当前滚动位置
          const beforeScrollTop = await bv.webContents.executeJavaScript(`window.scrollY || document.documentElement.scrollTop || 0;`);
          
          // 滚动到底部
          await bv.webContents.executeJavaScript(`window.scrollTo(0, document.body.scrollHeight);`);
          await sleep(scrollDelay);
          scrollCount++;

          const afterScrollTop = await bv.webContents.executeJavaScript(`window.scrollY || document.documentElement.scrollTop || 0;`);
          const curHeight = await bv.webContents.executeJavaScript(`document.body.scrollHeight;`);

          // 检查是否真的向下滚动了
          if (afterScrollTop > maxScrollTop) {
            maxScrollTop = afterScrollTop;
            noProgressCount = 0;
          } else {
            noProgressCount++;
          }

          // 提取当前 DOM 中所有匹配元素的完整数据
          const currentItems = await bv.webContents.executeJavaScript(
            `(function() {
              var extractChildLinksFn = ${extractChildLinksFn.toString()};
              try {
                var selector = ${JSON.stringify(selector)};
                var classifyBy = ${JSON.stringify(classifyBy)};
                var preserveRelations = ${JSON.stringify(preserveRelations)};
                var els = document.querySelectorAll(selector);
                var items = [];
                for (var i = 0; i < els.length; i++) {
                  var el = els[i];
                  var href = el.getAttribute('href') || el.href || '';
                  // 向上查找楼层容器
                  var parentId = null;
                  if (preserveRelations) {
                    var parent = el.closest('[data-pid], [data-parent], [comment-id], [pid]');
                    if (parent) {
                      parentId = parent.getAttribute('data-pid') ||
                                 parent.getAttribute('data-parent') ||
                                 parent.getAttribute('comment-id') ||
                                 parent.getAttribute('pid');
                    }
                  }
                  // 计算 level
                  var level = 0;
                  var p = el.parentElement;
                  while (p) {
                    try { if (p.matches(selector)) level++; } catch(e) {}
                    p = p.parentElement;
                  }
                  // 分组键
                  var groupKey = 'default';
                  if (classifyBy === 'class') {
                    groupKey = (typeof el.className === 'string' && el.className)
                      ? el.className.trim().split(/\\s+/)[0]
                      : 'no-class';
                  } else if (classifyBy === 'data-attr') {
                    var dataAttrs = Array.from(el.attributes).filter(function(a){ return a.name.indexOf('data-') === 0; });
                    groupKey = dataAttrs.length > 0 ? dataAttrs[0].value : 'no-data';
                  } else if (classifyBy === 'dom-position') {
                    groupKey = el.parentElement ? el.parentElement.tagName.toLowerCase() : 'no-parent';
                  }
                  // 属性对象
                  var attrs = {};
                  for (var j = 0; j < el.attributes.length; j++) {
                    var a = el.attributes[j];
                    attrs[a.name] = a.value;
                  }
                  // 提取子链接（增强：去重 + 绝对 URL + 元素自身 + area + data-href，上限 50）
                  var childLinks = extractChildLinksFn(el, 50);
                  items.push({
                    href: href,
                    parentId: parentId,
                    level: level,
                    groupKey: groupKey,
                    textContent: (el.textContent || '').trim().slice(0, 5000),
                    innerText: (el.innerText || '').trim().slice(0, 5000),
                    attributes: attrs,
                    outerHTML: el.outerHTML.slice(0, 2000),
                    tagName: el.tagName.toLowerCase(),
                    childLinks: childLinks
                  });
                }
                return items;
              } catch(e) { return []; }
            })()`,
            true
          );

          // 累积到 Map 中去重（以 href 为 key）
          for (const item of currentItems) {
            const key = item.href || ('idx_' + allItemsMap.size);
            if (!allItemsMap.has(key)) {
              allItemsMap.set(key, item);
            }
            if (item.href && !item.href.startsWith('javascript:') && item.href !== '#') {
              allUniqueHrefs.add(item.href);
            }
          }

          // 如果连续 20 次滚动都无法向下移动，说明到底了
          if (noProgressCount >= 20) {
            break;
          }
        }

        if (!aborted) {
          await sleep(2000);
          await bv.webContents.executeJavaScript(`window.scrollTo(0, 0);`);
        }
      }

      if (bv.webContents.isDestroyed() || aborted) {
        throw new Error(aborted ? '用户已停止' : 'BrowserView 已销毁');
      }

      // 构建最终 items 列表
      let finalItems = Array.from(allItemsMap.values());

      // 如果没有使用增量收集（matchMode !== 'all'），用传统方式提取
      if (matchMode !== 'all') {
        const extracted = await bv.webContents.executeJavaScript(`
          (function() {
            var extractChildLinksFn = ${extractChildLinksFn.toString()};
            var selector = ${JSON.stringify(selector)};
            var classifyBy = ${JSON.stringify(classifyBy)};
            var preserveRelations = ${JSON.stringify(preserveRelations)};
            var matchLimit = ${JSON.stringify(matchLimit)};
            try {
              var elements = document.querySelectorAll(selector);
            } catch(e) {
              return { error: '选择器语法无效: ' + e.message };
            }
            var limit = elements.length;
            if (matchLimit && typeof matchLimit === 'number' && matchLimit > 0) {
              limit = Math.min(matchLimit, elements.length);
            }
            var items = [];
            for (var i = 0; i < limit; i++) {
              var el = elements[i];
              var parentId = null;
              if (preserveRelations) {
                var parent = el.closest('[data-pid], [data-parent], [comment-id], [pid]');
                if (parent) {
                  parentId = parent.getAttribute('data-pid') ||
                             parent.getAttribute('data-parent') ||
                             parent.getAttribute('comment-id') ||
                             parent.getAttribute('pid');
                }
              }
              var level = 0;
              var p = el.parentElement;
              while (p) {
                try { if (p.matches(selector)) level++; } catch(e) {}
                p = p.parentElement;
              }
              var groupKey = 'default';
              if (classifyBy === 'class') {
                groupKey = (typeof el.className === 'string' && el.className)
                  ? el.className.trim().split(/\\s+/)[0]
                  : 'no-class';
              } else if (classifyBy === 'data-attr') {
                var dataAttrs = Array.from(el.attributes).filter(function(a){ return a.name.indexOf('data-') === 0; });
                groupKey = dataAttrs.length > 0 ? dataAttrs[0].value : 'no-data';
              } else if (classifyBy === 'dom-position') {
                groupKey = el.parentElement ? el.parentElement.tagName.toLowerCase() : 'no-parent';
              }
              var attrs = {};
              for (var j = 0; j < el.attributes.length; j++) {
                var a = el.attributes[j];
                attrs[a.name] = a.value;
              }
              // 提取子链接（增强：去重 + 绝对 URL + 元素自身 + area + data-href，上限 50）
              var childLinks = extractChildLinksFn(el, 50);
              items.push({
                href: el.getAttribute('href') || el.href || '',
                parentId: parentId,
                level: level,
                groupKey: groupKey,
                textContent: (el.textContent || '').trim().slice(0, 5000),
                innerText: (el.innerText || '').trim().slice(0, 5000),
                attributes: attrs,
                outerHTML: el.outerHTML.slice(0, 2000),
                tagName: el.tagName.toLowerCase(),
                childLinks: childLinks
              });
            }
            return items;
          })()
        `, true);

        if (extracted && !extracted.error) {
          finalItems = extracted;
        }
      }

      // 应用 matchLimit
      if (matchLimit && typeof matchLimit === 'number' && matchLimit > 0) {
        finalItems = finalItems.slice(0, matchLimit);
      }

      // 按 groupKey 分组
      const groups = {};
      for (let k = 0; k < finalItems.length; k++) {
        const gk = finalItems[k].groupKey || 'default';
        if (!groups[gk]) groups[gk] = [];
        groups[gk].push(finalItems[k].id || ('item_' + k));
      }

      // 给每个 item 添加 id
      for (let k = 0; k < finalItems.length; k++) {
        if (!finalItems[k].id) finalItems[k].id = 'item_' + k;
      }

      const batchId = Date.now().toString(36);
      return {
        batchId: batchId,
        runAt: new Date().toISOString(),
        url: url,
        selector: selector,
        items: finalItems,
        groups: groups,
        count: finalItems.length
      };
    } finally {
      ipcMain.removeListener('test-selector-abort', abortHandler);
      releaseTaskBrowserView(bv);
    }
  }

  // ===== Task 6: 跨页面抓取任务执行 =====
  async function runCrosspageTask(task) {
    const config = task.config || {};
    let urls = Array.isArray(config.urls) ? config.urls.slice() : [];
    const fieldMappings = Array.isArray(config.fieldMappings) ? config.fieldMappings : [];
    const overrides = Array.isArray(config.overrides) ? config.overrides : [];

    // 链式组合：如果配置了 sourceTaskId，从上游任务最新结果导入 URL
    if (config.sourceTaskId) {
      const sourceUrls = resolveSourceUrls(config.sourceTaskId, config.sourceField || 'href');
      if (sourceUrls.length) {
        urls = Array.from(new Set([...sourceUrls, ...urls]));
      }
    }

    if (!urls.length) {
      throw new Error('任务配置缺少 urls');
    }
    if (!fieldMappings.length) {
      throw new Error('任务配置缺少 fieldMappings');
    }

    // 通用：在 BrowserView 中加载 URL 并等待页面就绪
    const loadAndWait = async (bv, url) => {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!bv.webContents.isDestroyed()) bv.webContents.removeListener('did-finish-load', onLoad);
          resolve();
        }, 30000);
        const onLoad = () => {
          clearTimeout(timeout);
          bv.webContents.removeListener('did-finish-load', onLoad);
          resolve();
        };
        bv.webContents.once('did-finish-load', onLoad);
        bv.webContents.once('did-fail-load', (e, code, desc, u, isMain) => {
          if (isMain) {
            clearTimeout(timeout);
            bv.webContents.removeListener('did-finish-load', onLoad);
            resolve();
          }
        });
        try {
          bv.webContents.loadURL(url);
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });
      await sleep(2000);
    };

    const limiter = new ConcurrencyLimiter(3);
    const items = [];

    const processUrl = async (url) => {
      const bv = await getTaskBrowserView();
      try {
        await loadAndWait(bv, url);
        if (bv.webContents.isDestroyed()) {
          throw new Error('BrowserView 已销毁');
        }
        // 检查该 URL 是否有字段覆盖
        const overrideEntry = overrides.find(o => o.url === url);
        const overridden = !!overrideEntry;
        const fieldOverrides = overridden ? (overrideEntry.fieldOverrides || {}) : {};

        const rootSelector = (config.selector || '').trim();
        const fields = await bv.webContents.executeJavaScript(`
          (function() {
            var rootSelector = ${JSON.stringify(rootSelector)};
            var fieldMappings = ${JSON.stringify(fieldMappings)};
            var fieldOverrides = ${JSON.stringify(fieldOverrides)};
            var root = rootSelector ? document.querySelector(rootSelector) : document;
            if (!root) return null;
            var fields = {};
            for (var i = 0; i < fieldMappings.length; i++) {
              var fm = fieldMappings[i];
              var sel = fieldOverrides[fm.name] || fm.selector;
              var el = null;
              try { el = root.querySelector(sel); } catch(e) { el = null; }
              if (!el) { fields[fm.name] = null; continue; }
              if (fm.attr === 'text') fields[fm.name] = (el.textContent || '').trim();
              else if (fm.attr === 'html') fields[fm.name] = el.innerHTML;
              else fields[fm.name] = el.getAttribute(fm.attr) || '';
            }
            return fields;
          })()
        `, true);
        if (!fields) {
          return { sourceUrl: url, fields: {}, overridden: overridden, error: 'root not found' };
        }
        return { sourceUrl: url, fields: fields || {}, overridden: overridden };
      } finally {
        releaseTaskBrowserView(bv);
      }
    };

    const promises = urls.map(url => limiter.run(() =>
      processUrl(url)
        .then(item => { items.push(item); })
        .catch(e => {
          // 单个 URL 失败不阻断整体
          items.push({ sourceUrl: url, fields: {}, overridden: false, error: e.message || String(e) });
        })
    ));
    await Promise.all(promises);

    const batchId = Date.now().toString(36);
    return {
      batchId: batchId,
      runAt: new Date().toISOString(),
      items: items,
      count: items.length
    };
  }

  // ===== Task 6.5: 末端抓取执行（多 URL 批量按模板提取：文本/链接/视频/音频/下载链接） =====
  // 工作流：样本网页配置模板字段 → 目标网页（多选）批量应用模板抓取
  // 配置: config.urls（目标 URL 数组）、config.fields（模板字段）、config.targetSourceTaskId（目标链式数据源）
  // 兼容旧配置: config.url（单个样本 URL）→ 退化为单 URL 模式
  async function runTemplateTask(task) {
    const config = task.config || {};
    const fields = Array.isArray(config.fields) ? config.fields : [];

    // 目标 URL 列表：优先 config.urls（数组），兼容旧版 config.url（字符串）
    let urls = Array.isArray(config.urls) ? config.urls.slice() : [];
    if (!urls.length && config.url) {
      urls = [config.url];
    }

    // 链式组合：如果配置了 targetSourceTaskId，从上游任务最新结果导入 URL 作为目标
    if (config.targetSourceTaskId) {
      const sourceUrls = resolveSourceUrls(config.targetSourceTaskId, config.sourceField || 'url');
      if (sourceUrls.length) {
        urls = Array.from(new Set([...sourceUrls, ...urls]));
      }
    }
    // 兼容：旧版 sourceTaskId（无 targetSourceTaskId 时回退）
    if (!config.targetSourceTaskId && config.sourceTaskId) {
      const sourceUrls = resolveSourceUrls(config.sourceTaskId, config.sourceField || 'url');
      if (sourceUrls.length) {
        urls = Array.from(new Set([...sourceUrls, ...urls]));
      }
    }

    if (!urls.length) {
      throw new Error('任务配置缺少目标 urls');
    }
    if (!fields.length) {
      throw new Error('任务配置缺少模板 fields');
    }

    // 通用：加载 URL 并等待 SPA 渲染
    const loadAndWait = async (bv, url) => {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!bv.webContents.isDestroyed()) bv.webContents.removeListener('did-finish-load', onLoad);
          resolve();
        }, 30000);
        const onLoad = () => {
          clearTimeout(timeout);
          bv.webContents.removeListener('did-finish-load', onLoad);
          resolve();
        };
        bv.webContents.once('did-finish-load', onLoad);
        bv.webContents.once('did-fail-load', (e, code, desc, u, isMain) => {
          if (isMain) {
            clearTimeout(timeout);
            bv.webContents.removeListener('did-finish-load', onLoad);
            resolve();
          }
        });
        try {
          bv.webContents.loadURL(url);
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });
      await sleep(2000);
    };

    const limiter = new ConcurrencyLimiter(3);
    const items = [];

    const processUrl = async (url, idx) => {
      const bv = await getTaskBrowserView();
      try {
        await loadAndWait(bv, url);
        if (bv.webContents.isDestroyed()) {
          throw new Error('BrowserView 已销毁');
        }
        // 共用 extractTemplateFieldsFn 注入脚本
        const extracted = await bv.webContents.executeJavaScript(
          '(' + extractTemplateFieldsFn.toString() + ')(' + JSON.stringify(fields) + ')',
          true
        );
        if (!extracted) {
          return {
            id: 'tpl_' + idx,
            sourceUrl: url,
            fields: {},
            missing: fields.map(f => f.name || 'field'),
            pageTitle: '',
            error: '提取失败'
          };
        }
        return {
          id: 'tpl_' + idx,
          sourceUrl: url,
          fields: extracted.fields || {},
          missing: extracted.missing || [],
          pageTitle: extracted.pageTitle || ''
        };
      } finally {
        releaseTaskBrowserView(bv);
      }
    };

    const promises = urls.map((url, idx) => limiter.run(() =>
      processUrl(url, idx)
        .then(item => { items.push(item); })
        .catch(e => {
          // 单个 URL 失败不阻断整体
          items.push({
            id: 'tpl_' + idx,
            sourceUrl: url,
            fields: {},
            missing: fields.map(f => f.name || 'field'),
            pageTitle: '',
            error: e.message || String(e)
          });
        })
    ));
    await Promise.all(promises);

    // 统计总数：按字段 values 数量累加（跨所有 URL）
    let totalCount = 0;
    items.forEach(item => {
      const fieldsObj = item.fields || {};
      Object.keys(fieldsObj).forEach(k => {
        const v = fieldsObj[k];
        if (v && typeof v === 'object' && Array.isArray(v.values)) {
          totalCount += v.values.length;
        }
      });
    });
    if (totalCount === 0) totalCount = items.length;

    const batchId = Date.now().toString(36);
    return {
      batchId: batchId,
      runAt: new Date().toISOString(),
      url: urls[0] || '',
      urls: urls,
      items: items,
      count: totalCount,
      templateType: true
    };
  }

  // ===== Task 7: 追踪任务执行 =====
  // isManual=true 表示用户手动触发；返回 { success, batchId, itemCount, newCount, count }
  // 追踪任务自己负责写回 knownIds / results / status
  async function runTrackingTask(task, isManual) {
    const config = task.config || {};
    const url = config.url;
    const selector = config.selector;
    const idField = config.idField || 'href';

    if (!url || !selector) {
      throw new Error('任务配置缺少 url 或 selector');
    }

    const bv = await getTaskBrowserView();
    let items;
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!bv.webContents.isDestroyed()) bv.webContents.removeListener('did-finish-load', onLoad);
          resolve();
        }, 30000);
        const onLoad = () => {
          clearTimeout(timeout);
          bv.webContents.removeListener('did-finish-load', onLoad);
          resolve();
        };
        bv.webContents.once('did-finish-load', onLoad);
        bv.webContents.once('did-fail-load', (e, code, desc, u, isMain) => {
          if (isMain) {
            clearTimeout(timeout);
            bv.webContents.removeListener('did-finish-load', onLoad);
            resolve();
          }
        });
        try {
          bv.webContents.loadURL(url);
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });

      await sleep(2000);
      if (bv.webContents.isDestroyed()) {
        throw new Error('BrowserView 已销毁');
      }

      const extracted = await bv.webContents.executeJavaScript(`
        (function() {
          var selector = ${JSON.stringify(selector)};
          var idField = ${JSON.stringify(idField)};
          try {
            var elements = document.querySelectorAll(selector);
          } catch(e) {
            return { error: '选择器语法无效: ' + e.message };
          }
          var items = [];
          for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            var id = null;
            if (idField === 'href') {
              var a = el.querySelector('a');
              id = a ? a.href : (el.getAttribute('href') || '');
            } else if (idField === 'data-id') {
              id = el.getAttribute('data-id') || '';
            } else if (idField === 'data-pid') {
              id = el.getAttribute('data-pid') || '';
            } else if (idField === 'id') {
              id = el.id || '';
            } else if (idField === 'textContent') {
              id = (el.textContent || '').trim().slice(0, 200);
            }
            items.push({
              id: id,
              textContent: (el.textContent || '').trim().slice(0, 1000),
              outerHTML: el.outerHTML.slice(0, 1000),
              tagName: el.tagName.toLowerCase()
            });
          }
          return { items: items, count: items.length };
        })()
      `, true);

      if (!extracted || extracted.error) {
        throw new Error(extracted ? extracted.error : '提取失败');
      }
      items = extracted.items;
    } finally {
      releaseTaskBrowserView(bv);
    }

    // 比对 knownIds
    const knownIds = Array.isArray(task.knownIds) ? task.knownIds : [];
    const knownSet = new Set(knownIds);
    const isFirstRun = knownIds.length === 0;
    const now = new Date();
    const nowIso = now.toISOString();

    const processedItems = items.map(it => {
      const isNew = !isFirstRun && !knownSet.has(it.id);
      return {
        id: it.id,
        textContent: it.textContent,
        outerHTML: it.outerHTML,
        tagName: it.tagName,
        isNew: isFirstRun ? false : isNew,
        detectedAt: isNew ? nowIso : null
      };
    });

    const newCount = processedItems.filter(it => it.isNew).length;
    const allIds = items.map(it => it.id).filter(Boolean);
    const updatedKnownIds = Array.from(new Set([...knownIds, ...allIds]));

    const batchId = Date.now().toString(36);
    const batch = {
      batchId: batchId,
      runAt: nowIso,
      items: processedItems,
      newCount: newCount,
      count: processedItems.length,
      isBaseline: isFirstRun
    };

    // 写回文件（追踪任务自己负责持久化）
    task.results = task.results || [];
    task.results.push(batch);
    task.knownIds = updatedKnownIds;
    task.lastRunAt = nowIso;
    task.status = task.active === false ? 'paused' : 'tracking';
    writeTaskFile(task);

    return { success: true, batchId: batchId, itemCount: processedItems.length, newCount: newCount, count: processedItems.length };
  }

  // ===== Task 8: 追踪调度器 =====
  const TrackingScheduler = {
    timers: new Map(), // taskId -> setTimeout handle

    start(task) {
      if (!task || !task.id) return;
      this.stop(task.id);
      const delay = Math.max(60 * 1000, (task.config && task.config.intervalMinutes || 10) * 60 * 1000);
      const handle = setTimeout(() => this.tick(task.id), delay);
      this.timers.set(task.id, handle);
      // 更新 nextCheckAt
      task.nextCheckAt = new Date(Date.now() + delay).toISOString();
    },

    stop(taskId) {
      if (!taskId) return;
      const h = this.timers.get(taskId);
      if (h) {
        clearTimeout(h);
        this.timers.delete(taskId);
      }
    },

    stopAll() {
      for (const [, h] of this.timers) {
        try { clearTimeout(h); } catch (e) { /* ignore */ }
      }
      this.timers.clear();
    },

    async tick(taskId) {
      try {
        const task = readTaskFile(taskId);
        if (!task) return;
        // 已暂停或非追踪任务则不再继续
        if (task.type !== 'tracking' || task.active === false) return;
        const result = await runTrackingTask(task, false);
        if (result.newCount > 0 && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('tracking-update', {
            taskId: taskId,
            taskName: task.name,
            newCount: result.newCount
          });
        }
        // 重新读取任务（runTrackingTask 已更新文件）并继续调度
        const updated = readTaskFile(taskId);
        if (updated && updated.type === 'tracking' && updated.active !== false) {
          this.start(updated);
          writeTaskFile(updated);
        }
      } catch (e) {
        console.error('Tracking tick error:', e);
        // 出错时尝试重新调度（避免单次失败永久停止）
        try {
          const task = readTaskFile(taskId);
          if (task && task.type === 'tracking' && task.active !== false) {
            this.start(task);
            writeTaskFile(task);
          }
        } catch (e2) { /* ignore */ }
      }
    },

    checkAll() {
      try {
        const files = fs.readdirSync(AIWORKFLOWS_DIR).filter(f => f.endsWith('.json'));
        for (const f of files) {
          let task;
          try {
            task = JSON.parse(fs.readFileSync(path.join(AIWORKFLOWS_DIR, f), 'utf8'));
          } catch (e) { continue; }
          if (task.type === 'tracking' && task.active !== false) {
            const next = task.nextCheckAt ? new Date(task.nextCheckAt).getTime() : 0;
            const delay = Math.max(0, next - Date.now());
            if (delay === 0) {
              // 已到期，立即触发
              this.tick(task.id);
            } else {
              const handle = setTimeout(() => this.tick(task.id), delay);
              this.timers.set(task.id, handle);
            }
          }
        }
      } catch (e) {
        console.error('TrackingScheduler.checkAll error:', e);
      }
    }
  };

  // ===== Task 20: AI 模型配置 IPC =====
  // 保存 AI 配置（apiKey 加密存储）
  ipcMain.handle('save-ai-config', async (event, cfg) => {
    try {
      const config = {
        endpoint: (cfg && cfg.endpoint || '').trim(),
        apiKey: (cfg && cfg.apiKey || '').trim(),
        model: (cfg && cfg.model || '').trim(),
        temperature: typeof cfg.temperature === 'number' ? Math.max(0, Math.min(2, cfg.temperature)) : 0.7,
        maxTokens: cfg.maxTokens || 2048,
      };
      // 若 apiKey 为脱敏值（含 ****），保留原密钥
      if (/\*/.test(config.apiKey)) {
        const existing = aiHelper.loadConfig();
        config.apiKey = (existing && existing.apiKey) || '';
      }
      if (!config.endpoint || !config.model) {
        return { success: false, error: '请填写 API 端点和模型名' };
      }
      aiHelper.saveConfig(config);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // 读取 AI 配置（apiKey 脱敏显示）
  ipcMain.handle('get-ai-config', async () => {
    try {
      const masked = aiHelper.getMaskedConfig();
      return { success: true, data: masked };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // 测试 AI 配置（接收临时配置，发送 ping）
  ipcMain.handle('test-ai-config', async (event, cfg) => {
    try {
      const tempConfig = {
        endpoint: (cfg && cfg.endpoint || '').trim(),
        apiKey: (cfg && cfg.apiKey || '').trim(),
        model: (cfg && cfg.model || '').trim(),
        temperature: 0.7,
        maxTokens: 50,
      };
      // 若 apiKey 为脱敏值，用已保存的密钥测试
      if (!tempConfig.apiKey || /\*/.test(tempConfig.apiKey)) {
        const existing = aiHelper.loadConfig();
        tempConfig.apiKey = (existing && existing.apiKey) || '';
      }
      if (!tempConfig.apiKey || !tempConfig.endpoint || !tempConfig.model) {
        return { success: false, error: '请先填写完整的 API 端点、API Key、模型名' };
      }
      const result = await aiHelper.testConnection(tempConfig);
      return result;
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // ===== Task 21: AI 辅助功能 IPC =====
  // 21.1 AI 生成选择器：加载 URL 获取 HTML，调用 LLM 返回候选选择器
  ipcMain.handle('ai-generate-selector', async (event, { url, description }) => {
    try {
      if (!url || !description) {
        return { success: false, error: '缺少 url 或 description 参数' };
      }
      if (!aiHelper.hasAiConfig()) {
        return { success: false, error: '未配置 AI 模型，请先点击"⚙ AI 配置"完成配置' };
      }
      const html = await loadUrlAndGetHtml(url, 30 * 1024);
      if (!html) {
        return { success: false, error: '无法获取页面内容（页面可能为空或加载失败）' };
      }
      const messages = [
        {
          role: 'system',
          content: '你是 CSS 选择器专家。根据用户描述和提供的 HTML 片段，返回 3-5 个候选 CSS 选择器的 JSON 数组。每个元素含 selector（字符串）和 description（字符串，说明该选择器匹配什么）字段。只返回 JSON，不要额外解释。'
        },
        {
          role: 'user',
          content: '用户想抓取：' + description + '\n\n页面 HTML 片段（已截断）：\n' + html
        }
      ];
      const llmResult = await aiHelper.callLLM(messages, { responseFormat: 'json', temperature: 0.3, maxTokens: 1024 });
      if (!llmResult.success) {
        return { success: false, error: llmResult.error || 'AI 调用失败' };
      }
      let candidates = aiHelper.parseLLMJson(llmResult.content);
      if (!Array.isArray(candidates)) {
        // 尝试从对象中提取数组
        if (candidates && Array.isArray(candidates.candidates)) candidates = candidates.candidates;
        else if (candidates && Array.isArray(candidates.selectors)) candidates = candidates.selectors;
        else candidates = [];
      }
      // 规范化：确保每个候选有 selector/description 字段
      candidates = candidates.map(c => ({
        selector: c.selector || c.css || '',
        description: c.description || c.desc || '',
      })).filter(c => c.selector);
      return { success: true, data: candidates };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // 21.2 AI 推断字段映射：加载 URL 获取 HTML，调用 LLM 返回字段映射建议
  ipcMain.handle('ai-infer-fields', async (event, { url, description }) => {
    try {
      if (!url) {
        return { success: false, error: '缺少 url 参数' };
      }
      if (!aiHelper.hasAiConfig()) {
        return { success: false, error: '未配置 AI 模型，请先点击"⚙ AI 配置"完成配置' };
      }
      const html = await loadUrlAndGetHtml(url, 30 * 1024);
      if (!html) {
        return { success: false, error: '无法获取页面内容（页面可能为空或加载失败）' };
      }
      const descPart = description ? '用户关注的内容：' + description + '\n\n' : '';
      const messages = [
        {
          role: 'system',
          content: '分析提供的 HTML 片段，返回字段映射建议的 JSON 数组。每个元素含 fieldName（字符串，字段名）、selector（字符串，相对根容器的子选择器）、attr（字符串，取值属性，取值范围 text/href/src）字段。返回 3-8 个字段。只返回 JSON。'
        },
        {
          role: 'user',
          content: descPart + '页面 HTML 片段（已截断）：\n' + html
        }
      ];
      const llmResult = await aiHelper.callLLM(messages, { responseFormat: 'json', temperature: 0.3, maxTokens: 1024 });
      if (!llmResult.success) {
        return { success: false, error: llmResult.error || 'AI 调用失败' };
      }
      let fields = aiHelper.parseLLMJson(llmResult.content);
      if (!Array.isArray(fields)) {
        if (fields && Array.isArray(fields.fields)) fields = fields.fields;
        else if (fields && Array.isArray(fields.mappings)) fields = fields.mappings;
        else fields = [];
      }
      fields = fields.map(f => ({
        fieldName: f.fieldName || f.name || '',
        selector: f.selector || '',
        attr: ['text', 'href', 'src'].includes(f.attr) ? f.attr : 'text',
      })).filter(f => f.fieldName);
      return { success: true, data: fields };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // 21.3 AI 分类：读取批次 items，调用 LLM 返回分类
  ipcMain.handle('ai-classify-results', async (event, { taskId, batchId }) => {
    try {
      if (!taskId) return { success: false, error: '缺少 taskId' };
      if (!aiHelper.hasAiConfig()) {
        return { success: false, error: '未配置 AI 模型，请先点击"⚙ AI 配置"完成配置' };
      }
      const task = readTaskFile(taskId);
      if (!task) return { success: false, error: '任务不存在' };
      const results = Array.isArray(task.results) ? task.results : [];
      const batch = batchId
        ? results.find(r => r.batchId === batchId)
        : (results.length ? results[0] : null);
      if (!batch) return { success: false, error: '未找到结果批次' };
      const items = Array.isArray(batch.items) ? batch.items : [];
      if (!items.length) return { success: false, error: '该批次无条目可分类' };

      // 截取前 200 条，超出标记未分类
      const limit = 200;
      const toClassify = items.slice(0, limit);
      const itemTexts = toClassify.map((it, idx) => {
        const text = (it.textContent || it.innerText || '').trim().slice(0, 200);
        return { itemId: it.id || ('item_' + idx), text: text };
      });

      const messages = [
        {
          role: 'system',
          content: '将提供的文本条目分类，返回 JSON 数组，每个元素含 itemId（字符串）和 category（字符串，分类名）字段。分类应简洁（2-4 字）。只返回 JSON。'
        },
        {
          role: 'user',
          content: '请分类以下条目：\n' + JSON.stringify(itemTexts, null, 2)
        }
      ];
      const llmResult = await aiHelper.callLLM(messages, { responseFormat: 'json', temperature: 0.3, maxTokens: 2048, timeout: 90000 });
      if (!llmResult.success) {
        return { success: false, error: llmResult.error || 'AI 调用失败' };
      }
      let classifications = aiHelper.parseLLMJson(llmResult.content);
      if (!Array.isArray(classifications)) {
        if (classifications && Array.isArray(classifications.classifications)) classifications = classifications.classifications;
        else if (classifications && Array.isArray(classifications.results)) classifications = classifications.results;
        else classifications = [];
      }
      // 构建 itemId -> category 映射
      const catMap = {};
      classifications.forEach(c => {
        if (c.itemId) catMap[String(c.itemId)] = c.category || '未分类';
      });
      // 组装结果：前 limit 条用 AI 分类，其余标记"未分类"
      const result = items.map((it, idx) => {
        const itemId = String(it.id || ('item_' + idx));
        return {
          itemId: itemId,
          category: idx < limit ? (catMap[itemId] || '未分类') : '未分类'
        };
      });
      return { success: true, data: result };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // 21.4 AI 摘要：读取结果数据，调用 LLM 生成摘要
  ipcMain.handle('ai-summarize-results', async (event, { taskId, batchId }) => {
    try {
      if (!taskId) return { success: false, error: '缺少 taskId' };
      if (!aiHelper.hasAiConfig()) {
        return { success: false, error: '未配置 AI 模型，请先点击"⚙ AI 配置"完成配置' };
      }
      const task = readTaskFile(taskId);
      if (!task) return { success: false, error: '任务不存在' };
      const results = Array.isArray(task.results) ? task.results : [];
      if (!results.length) return { success: false, error: '任务暂无结果可摘要' };

      let batches;
      if (batchId) {
        const b = results.find(r => r.batchId === batchId);
        if (!b) return { success: false, error: '未找到指定批次' };
        batches = [b];
      } else {
        batches = results;
      }

      // 提取每条 item 的摘要文本，控制总大小
      const summary = [];
      let totalChars = 0;
      const MAX_CHARS = 12000;
      batches.forEach(b => {
        const items = Array.isArray(b.items) ? b.items : [];
        items.forEach(it => {
          if (totalChars >= MAX_CHARS) return;
          let text = '';
          if (it.fields && typeof it.fields === 'object') {
            text = Object.keys(it.fields).map(k => k + ':' + String(it.fields[k] || '').slice(0, 100)).join(' ');
          } else {
            text = it.textContent || it.innerText || '';
          }
          text = String(text).trim().slice(0, 300);
          if (text) {
            summary.push(text);
            totalChars += text.length;
          }
        });
      });
      if (!summary.length) return { success: false, error: '结果条目无文本内容可摘要' };

      const taskType = task.type || 'batch';
      const messages = [
        {
          role: 'system',
          content: '用中文生成结果摘要，不超过 300 字。概述数据的主要内容、数量、特点。只返回摘要文本。'
        },
        {
          role: 'user',
          content: '任务类型：' + taskType + '，共 ' + summary.length + ' 条数据（部分展示）：\n' + summary.join('\n---\n')
        }
      ];
      const llmResult = await aiHelper.callLLM(messages, { temperature: 0.5, maxTokens: 512, timeout: 90000 });
      if (!llmResult.success) {
        return { success: false, error: llmResult.error || 'AI 调用失败' };
      }
      return { success: true, data: { summary: llmResult.content || '', itemCount: summary.length, taskType: taskType } };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // ===== Task 9: 拾取模式 IPC =====
  // 进入拾取模式：向当前活动 BrowserView 的 webContents 发送 enter-picker-mode
  ipcMain.handle('enter-picker-mode', async () => {
    const bv = getActiveBV();
    if (!bv || bv.webContents.isDestroyed()) {
      return { success: false, error: '没有活动的 BrowserView' };
    }
    pickerModeState = true;  // 主进程同步状态，阻止默认右键菜单
    bv.webContents.send('enter-picker-mode');
    return { success: true };
  });

  // 退出拾取模式：向当前活动 BrowserView 发送 exit-picker-mode
  ipcMain.handle('exit-picker-mode', async () => {
    const bv = getActiveBV();
    if (!bv || bv.webContents.isDestroyed()) {
      pickerModeState = false;
      return { success: false, error: '没有活动的 BrowserView' };
    }
    bv.webContents.send('exit-picker-mode');
    pickerModeState = false;
    return { success: true };
  });

  // picker-result: 由 webview-preload 通过 ipcRenderer.send 发到主进程，主进程转发到渲染进程
  ipcMain.on('picker-result', (event, data) => {
    // picker-result 到达即意味着 picker 流程结束，同步状态
    pickerModeState = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('picker-result', data);
    }
  });

  // preload 主动同步 picker 模式状态（用于 exitPickerModeInternal 等场景）
  ipcMain.on('picker-mode-changed', (event, enabled) => {
    pickerModeState = !!enabled;
  });

  // 获取当前活动标签页的视频资源（用于WSW浏览器捕获）
  ipcMain.handle('get-active-tab-videos', async () => {
    try {
      if (!activeTabId) return { success: false, error: '无活动标签页' };
      const bv = browserViews.get(activeTabId);
      if (!bv) return { success: false, error: '未找到BrowserView' };

      // 在页面中执行JS提取所有video元素信息
      const videos = await bv.webContents.executeJavaScript(`
        (function() {
          const videos = [];
          // 提取 <video> 元素
          document.querySelectorAll('video').forEach((v, i) => {
            const src = v.src || v.currentSrc || '';
            if (!src) return;
            videos.push({
              src: src,
              title: document.title || ('视频' + (i + 1)),
              poster: v.poster || '',
              pageUrl: window.location.href,
              duration: v.duration || 0,
              width: v.videoWidth || 0,
              height: v.videoHeight || 0
            });
          });
          // 提取 source 标签
          document.querySelectorAll('source[src]').forEach((s, i) => {
            const src = s.src || '';
            if (!src) return;
            const parent = s.closest('video');
            videos.push({
              src: src,
              title: document.title || ('视频' + (i + 1)),
              poster: parent?.poster || '',
              pageUrl: window.location.href,
              duration: parent?.duration || 0,
              width: parent?.videoWidth || 0,
              height: parent?.videoHeight || 0
            });
          });
          return videos;
        })()
      `, true);

      return { success: true, data: videos || [] };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('export-workflow', (event, payload) => {
    try {
      // 兼容旧格式：直接传 workflow 对象，或新格式 { workflow, selectedResources, format }
      const workflow = payload.workflow || payload;
      const selectedResources = payload.selectedResources || workflow.resources || [];
      const format = payload.format || null;

      const baseName = (workflow.title || 'workflow').replace(/[\\/:*?"<>|]/g, '_');
      const filters = [
        { name: '文本文件 (TXT)', extensions: ['txt'] },
        { name: 'JSON 数据', extensions: ['json'] },
        { name: 'Markdown 文档', extensions: ['md'] },
        { name: 'WSW 演示文件', extensions: ['wsw'] },
        { name: 'Excel 表格 (CSV)', extensions: ['csv'] },
        { name: '所有文件', extensions: ['*'] }
      ];
      const result = dialog.showSaveDialogSync(mainWindow, {
        title: '导出工作流',
        defaultPath: baseName,
        filters
      });
      if (!result) return { success: false, error: '取消' };

      const ext = result.split('.').pop().toLowerCase();
      let content = '';
      const resources = selectedResources || [];

      if (ext === 'json') {
        // JSON 格式：完整结构化数据（仅包含选中资源）
        const exportData = {
          ...workflow,
          resources: resources,
          exportedAt: new Date().toISOString(),
          exportedCount: resources.length
        };
        content = JSON.stringify(exportData, null, 2);
      } else if (ext === 'md') {
        // Markdown 格式
        content += '# ' + (workflow.title || '未命名') + '\n\n';
        content += '**来源**: [' + (workflow.url || '') + '](' + (workflow.url || '') + ')\n\n';
        content += '**时间**: ' + (workflow.createdAt || '') + '\n\n';
        content += '**资源数量**: ' + resources.length + '\n\n';
        content += '---\n\n';
        if (resources.length > 0) {
          content += '## 抓取资源\n\n';
          resources.forEach((res, i) => {
            const typeIcon = { image: '🖼️', video: '🎬', audio: '🎵', link: '🔗', text: '📝' }[res.type] || '📄';
            content += '### ' + typeIcon + ' ' + (res.name || res.type || '资源 ' + (i + 1)) + '\n\n';
            content += '- **类型**: ' + (res.type || 'unknown') + '\n';
            if (res.format) content += '- **格式**: ' + res.format + '\n';
            if (res.url) content += '- **URL**: ' + res.url + '\n';
            if (res.content) {
              const c = res.content.substring(0, 500);
              if (res.type === 'text') {
                content += '\n```\n' + c + '\n```\n';
              } else {
                content += '- **内容**: ' + c + '\n';
              }
            }
            content += '\n';
          });
        }
      } else if (ext === 'wsw') {
        // WSW 格式：生成可在 WSW 编辑器中打开的演示文件
        const wswDoc = {
          version: '1.0',
          title: workflow.title || '导出工作流',
          background: { type: 'color', value: '#0a0a1a' },
          showGrid: true,
          cards: []
        };
        // 为每个资源生成一个卡片
        const typeColors = {
          image: '#e94560', video: '#3498db', audio: '#9b59b6',
          link: '#2ecc71', text: '#f39c12'
        };
        resources.forEach((res, i) => {
          const col = i % 3;
          const row = Math.floor(i / 3);
          const x = 80 + col * 320;
          const y = 60 + row * 200;
          if (res.type === 'text') {
            // 文本资源用文字框
            const mdContent = '# ' + (res.name || '资源 ' + (i + 1)) + '\n\n' +
              (res.content || res.url || '').substring(0, 500);
            wswDoc.cards.push({
              id: i + 1, type: 'textbox', name: res.name || '文本',
              mdView: true, content: mdContent,
              x, y, w: 280, h: 160, z: i + 1
            });
          } else if (res.type === 'image' && res.url) {
            // 图片资源用图片框
            wswDoc.cards.push({
              id: i + 1, type: 'image', name: res.name || '图片',
              src: res.url,
              x, y, w: 280, h: 160, z: i + 1
            });
          } else {
            // 其他资源用形状卡片
            const shapes = ['rect', 'circle', 'triangle'];
            const shapeType = shapes[i % 3];
            wswDoc.cards.push({
              id: i + 1, type: 'shape', shapeType: shapeType,
              name: res.name || res.type || '资源',
              color: typeColors[res.type] || '#e94560',
              x, y, w: 120, h: 120, z: i + 1
            });
          }
        });
        // 如果没有资源，添加一个说明卡片
        if (wswDoc.cards.length === 0) {
          wswDoc.cards.push({
            id: 1, type: 'textbox', name: '说明', mdView: true,
            content: '# 空工作流\n\n此工作流没有选中任何资源。',
            x: 80, y: 60, w: 320, h: 120, z: 1
          });
        }
        content = JSON.stringify(wswDoc, null, 2);
      } else if (ext === 'csv') {
        // CSV 格式（Excel 可打开）
        content += '\uFEFF'; // BOM 确保 Excel 正确识别 UTF-8
        content += '序号,类型,名称,格式,URL,内容\n';
        resources.forEach((res, i) => {
          const cells = [
            String(i + 1),
            (res.type || '').replace(/"/g, '""'),
            (res.name || '').replace(/"/g, '""'),
            (res.format || '').replace(/"/g, '""'),
            (res.url || '').replace(/"/g, '""'),
            (res.content || '').substring(0, 500).replace(/"/g, '""').replace(/\n/g, ' ')
          ];
          content += cells.map(c => '"' + c + '"').join(',') + '\n';
        });
        // 工作流信息
        content += '\n';
        content += '"工作流信息",,,,\n';
        content += '"标题","' + (workflow.title || '').replace(/"/g, '""') + '",,,\n';
        content += '"来源","' + (workflow.url || '').replace(/"/g, '""') + '",,,\n';
        content += '"时间","' + (workflow.createdAt || '').replace(/"/g, '""') + '",,,\n';
        content += '"资源数","' + resources.length + '",,,\n';
      } else {
        // TXT 格式（默认，AI 可识别的结构化文本）
        content += '=== WebScout 抓取工作流 ===\n';
        content += '标题: ' + (workflow.title || '未命名') + '\n';
        content += '来源: ' + (workflow.url || '') + '\n';
        content += '时间: ' + (workflow.createdAt || '') + '\n';
        content += '资源数量: ' + resources.length + '\n';
        content += '\n--- 抓取资源 ---\n';
        resources.forEach((res, i) => {
          content += '[' + (i + 1) + '] ' + (res.type || 'unknown') + ': ' + (res.name || '') + '\n';
          content += '    URL: ' + (res.url || '') + '\n';
          if (res.format) content += '    格式: ' + res.format + '\n';
          if (res.content) content += '    内容: ' + res.content.substring(0, 500) + '\n';
          content += '\n';
        });
        content += '=== 工作流结束 ===\n';
      }

      fs.writeFileSync(result, content, 'utf8');
      updateStat('workflows');
      return { success: true, path: result, format: ext };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('save-workflows', (event, workflows) => {
    try {
      // 批量保存工作流
      workflows.forEach(wf => {
        const id = wf.id || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const filePath = path.join(WORKFLOWS_DIR, id + '.json');
        wf.id = id;
        fs.writeFileSync(filePath, JSON.stringify(wf, null, 2), 'utf8');
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ============ 右键菜单 ============
  setupContextMenu();

  // ============ 媒体请求拦截 ============
  setupMediaInterception();

  // ============ Task 8: 追踪调度器启动与清理 ============
  // 应用启动后恢复所有 active=true 的追踪任务定时器
  try {
    TrackingScheduler.checkAll();
  } catch (e) {
    console.error('TrackingScheduler.checkAll on ready failed:', e);
  }
  // 应用退出前清理所有定时器
  app.on('before-quit', () => {
    try { TrackingScheduler.stopAll(); } catch (e) { /* ignore */ }
    // Task 18: 同时停止 MCP 子进程
    try { stopMcpServer(); } catch (e) { /* ignore */ }
  });

  // ===== Task 18.3 + Task 19: MCP 服务端 IPC =====
  // 加载 URL 并等待 did-finish-load 或超时（复用 taskBrowserViewPool）
  async function mcpLoadUrlAndWait(bv, url, timeoutMs) {
    timeoutMs = timeoutMs || 30000;
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!bv.webContents.isDestroyed()) bv.webContents.removeListener('did-finish-load', onLoad);
        resolve();
      }, timeoutMs);
      const onLoad = () => {
        clearTimeout(timeout);
        bv.webContents.removeListener('did-finish-load', onLoad);
        resolve();
      };
      bv.webContents.once('did-finish-load', onLoad);
      bv.webContents.once('did-fail-load', (e, code, desc, u, isMain) => {
        if (isMain) {
          clearTimeout(timeout);
          bv.webContents.removeListener('did-finish-load', onLoad);
          resolve();
        }
      });
      try {
        bv.webContents.loadURL(url);
      } catch (e) {
        clearTimeout(timeout);
        resolve();
      }
    });
    // 额外等待 2 秒让 SPA 渲染完成
    await sleep(2000);
  }

  // Task 19.1: scrape_page 工具实现
  // selector 为空：返回页面所有资源摘要（标题/链接/图片/视频/音频）
  // selector 非空：返回匹配元素的 text/html/attrs
  async function mcpScrapePage(url, selector) {
    if (!url) throw new Error('缺少 url 参数');
    const bv = await getTaskBrowserView();
    try {
      await mcpLoadUrlAndWait(bv, url);
      if (bv.webContents.isDestroyed()) throw new Error('BrowserView 已销毁');

      if (!selector) {
        // 返回页面资源摘要
        const summary = await bv.webContents.executeJavaScript(`
          (function() {
            function absUrl(u) { try { return new URL(u, document.baseURI).href; } catch(e) { return u; } }
            var links = Array.prototype.slice.call(document.querySelectorAll('a[href]')).slice(0, 50).map(function(a) {
              return { href: absUrl(a.href), text: (a.textContent || '').trim().slice(0, 100) };
            });
            var images = Array.prototype.slice.call(document.querySelectorAll('img[src]')).slice(0, 50).map(function(img) {
              return { src: absUrl(img.src), alt: img.alt || '' };
            });
            var videos = Array.prototype.slice.call(document.querySelectorAll('video source, video')).slice(0, 20).map(function(v) {
              return { src: absUrl(v.src || v.currentSrc || ''), poster: v.poster || '' };
            });
            var audios = Array.prototype.slice.call(document.querySelectorAll('audio source, audio')).slice(0, 20).map(function(a) {
              return { src: absUrl(a.src || a.currentSrc || '') };
            });
            return {
              url: window.location.href,
              title: document.title || '',
              metaDescription: (document.querySelector('meta[name="description"]') || {}).content || '',
              counts: { links: links.length, images: images.length, videos: videos.length, audios: audios.length },
              links: links,
              images: images,
              videos: videos,
              audios: audios
            };
          })()
        `, true);
        return summary;
      }

      // selector 非空：返回匹配元素明细
      const extracted = await bv.webContents.executeJavaScript(`
        (function() {
          var selector = ${JSON.stringify(selector)};
          try { var elements = document.querySelectorAll(selector); }
          catch(e) { return { error: '选择器语法无效: ' + e.message }; }
          var items = [];
          for (var i = 0; i < elements.length && i < 100; i++) {
            var el = elements[i];
            var attrs = {};
            for (var j = 0; j < el.attributes.length; j++) {
              var a = el.attributes[j];
              attrs[a.name] = a.value;
            }
            items.push({
              index: i,
              tagName: el.tagName.toLowerCase(),
              textContent: (el.textContent || '').trim().slice(0, 2000),
              innerHTML: el.innerHTML.slice(0, 2000),
              outerHTML: el.outerHTML.slice(0, 2000),
              attributes: attrs
            });
          }
          return { selector: selector, count: items.length, items: items };
        })()
      `, true);
      if (!extracted || extracted.error) {
        throw new Error(extracted ? extracted.error : '提取失败');
      }
      return extracted;
    } finally {
      releaseTaskBrowserView(bv);
    }
  }

  // Task 19.2: extract_elements 工具实现
  // 返回字段映射结果数组：[{sourceUrl, fields:{name:value}}]
  async function mcpExtractElements(url, selector, fields) {
    if (!url) throw new Error('缺少 url 参数');
    if (!selector) throw new Error('缺少 selector 参数');
    const bv = await getTaskBrowserView();
    try {
      await mcpLoadUrlAndWait(bv, url);
      if (bv.webContents.isDestroyed()) throw new Error('BrowserView 已销毁');

      const fieldMappings = Array.isArray(fields) && fields.length > 0 ? fields : null;
      const extracted = await bv.webContents.executeJavaScript(`
        (function() {
          var selector = ${JSON.stringify(selector)};
          var fieldMappings = ${JSON.stringify(fieldMappings)};
          try { var elements = document.querySelectorAll(selector); }
          catch(e) { return { error: '选择器语法无效: ' + e.message }; }
          var items = [];
          for (var i = 0; i < elements.length && i < 100; i++) {
            var el = elements[i];
            if (fieldMappings) {
              var fields = {};
              for (var k = 0; k < fieldMappings.length; k++) {
                var fm = fieldMappings[k];
                var sub = null;
                try { sub = el.querySelector(fm.selector); } catch(e) { sub = null; }
                if (!sub) { fields[fm.name] = null; continue; }
                if (fm.attr === 'text') fields[fm.name] = (sub.textContent || '').trim().slice(0, 2000);
                else if (fm.attr === 'html') fields[fm.name] = sub.innerHTML.slice(0, 2000);
                else fields[fm.name] = sub.getAttribute(fm.attr) || '';
              }
              items.push({ index: i, fields: fields });
            } else {
              var attrs = {};
              for (var j = 0; j < el.attributes.length; j++) {
                var a = el.attributes[j];
                attrs[a.name] = a.value;
              }
              items.push({
                index: i,
                tagName: el.tagName.toLowerCase(),
                textContent: (el.textContent || '').trim().slice(0, 2000),
                attributes: attrs
              });
            }
          }
          return { url: window.location.href, selector: selector, count: items.length, items: items };
        })()
      `, true);
      if (!extracted || extracted.error) {
        throw new Error(extracted ? extracted.error : '提取失败');
      }
      return extracted;
    } finally {
      releaseTaskBrowserView(bv);
    }
  }

  // Task 19.3: list_workflows 工具实现
  async function mcpListWorkflows() {
    const files = fs.readdirSync(AIWORKFLOWS_DIR).filter(f => f.endsWith('.json'));
    const tasks = files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(AIWORKFLOWS_DIR, f), 'utf8')); }
      catch { return null; }
    }).filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return tasks.map(t => ({
      id: t.id,
      name: t.name,
      type: t.type,
      status: t.status,
      lastRunAt: t.lastRunAt || null,
      resultCount: Array.isArray(t.results) ? t.results.length : 0
    }));
  }

  // Task 19.4: run_workflow 工具实现（复用 run-aiworkflow-task 逻辑）
  async function mcpRunTask(taskId) {
    if (!taskId) throw new Error('缺少 taskId');
    const filePath = path.join(AIWORKFLOWS_DIR, taskId + '.json');
    if (!fs.existsSync(filePath)) throw new Error('AI工作流不存在: ' + taskId);
    const task = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const isTracking = task.type === 'tracking';

    task.status = 'running';
    fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf8');

    let result;
    try {
      if (task.type === 'batch') {
        result = await runBatchTask(task);
      } else if (task.type === 'crosspage') {
        result = await runCrosspageTask(task);
      } else if (task.type === 'template') {
        result = await runTemplateTask(task);
      } else if (task.type === 'tracking') {
        result = await runTrackingTask(task, true);
        let trackingCardId = null;
        try {
          const freshTask = readTaskFile(taskId);
          if (freshTask) {
            const batches = Array.isArray(freshTask.results) ? freshTask.results : [];
            const batch = batches.find(b => b && b.batchId === result.batchId) || batches[batches.length - 1];
            if (batch) {
              const card = buildResultCard(freshTask, batch);
              trackingCardId = saveResultCard(card);
              if (trackingCardId) {
                batch.cardId = trackingCardId;
                writeTaskFile(freshTask);
              }
            }
          }
        } catch (e) { /* ignore */ }
        return {
          taskId: taskId,
          batchId: result.batchId,
          itemCount: result.count,
          newCount: result.newCount,
          cardId: trackingCardId
        };
      } else {
        throw new Error('未知任务类型: ' + task.type);
      }
    } catch (err) {
      task.status = isTracking ? 'tracking' : 'idle';
      task.lastRunAt = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf8');
      throw err;
    }

    task.results = task.results || [];
    task.results.push(result);
    task.lastRunAt = new Date().toISOString();
    task.status = 'idle';

    let resultCardId = null;
    try {
      const card = buildResultCard(task, result);
      resultCardId = saveResultCard(card);
      if (resultCardId) result.cardId = resultCardId;
    } catch (e) { /* ignore */ }

    fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf8');

    return {
      taskId: taskId,
      batchId: result.batchId,
      itemCount: result.count,
      cardId: resultCardId
    };
  }

  // Task 19.5: create_workflow 工具实现
  async function mcpCreateTask(args) {
    const type = args && args.type;
    const name = args && args.name;
    const config = args && args.config;
    if (!type || !['batch', 'crosspage', 'tracking'].includes(type)) {
      throw new Error('type 必须为 batch/crosspage/tracking');
    }
    if (!name) throw new Error('缺少 name');
    if (!config) throw new Error('缺少 config');

    const id = Date.now().toString(36);
    const nowIso = new Date().toISOString();
    const task = {
      id: id,
      type: type,
      name: name,
      config: config,
      results: [],
      createdAt: nowIso,
      savedAt: nowIso,
      lastRunAt: null,
      status: type === 'tracking' ? 'tracking' : 'idle'
    };
    if (type === 'tracking') {
      task.active = true;
      task.knownIds = [];
      task.nextCheckAt = null;
    }
    const filePath = path.join(AIWORKFLOWS_DIR, id + '.json');
    fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf8');
    return { taskId: id };
  }

  // Task 19.6: get_workflow_results 工具实现
  async function mcpGetTaskResults(taskId, batchId) {
    if (!taskId) throw new Error('缺少 taskId');
    const task = readTaskFile(taskId);
    if (!task) throw new Error('任务不存在: ' + taskId);
    const allResults = Array.isArray(task.results) ? task.results : [];
    if (!allResults.length) return { taskId: taskId, batches: [] };
    let batches;
    if (batchId) {
      const b = allResults.find(r => r.batchId === batchId);
      if (!b) throw new Error('未找到批次: ' + batchId);
      batches = [b];
    } else {
      batches = allResults;
    }
    return {
      taskId: taskId,
      taskName: task.name,
      taskType: task.type,
      batches: batches.map(b => ({
        batchId: b.batchId,
        runAt: b.runAt,
        count: b.count,
        newCount: b.newCount,
        items: Array.isArray(b.items) ? b.items : []
      }))
    };
  }

  // Task 19.7: list_cards 工具实现
  async function mcpListCards() {
    const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));
    const cards = files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf8')); }
      catch { return null; }
    }).filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return cards.map(c => ({
      id: c.id,
      title: c.title,
      url: c.url,
      cardType: c.cardType || 'media',
      resourceCount: c.resourceCount || (Array.isArray(c.resources) ? c.resources.length : 0),
      createdAt: c.createdAt,
      sourceTaskId: c.sourceTaskId || null,
      sourceTaskType: c.sourceTaskType || null
    }));
  }

  // Task 19.8: tracking_status 工具实现
  async function mcpGetTrackingStatus() {
    const files = fs.readdirSync(AIWORKFLOWS_DIR).filter(f => f.endsWith('.json'));
    const tasks = files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(AIWORKFLOWS_DIR, f), 'utf8')); }
      catch { return null; }
    }).filter(Boolean);
    return tasks
      .filter(t => t.type === 'tracking')
      .map(t => {
        const batches = Array.isArray(t.results) ? t.results : [];
        let newCount = 0;
        if (batches.length > 0) {
          const lastBatch = batches[batches.length - 1];
          newCount = (lastBatch && lastBatch.newCount) || 0;
        }
        return {
          taskId: t.id,
          name: t.name,
          active: t.active !== false,
          lastRunAt: t.lastRunAt || null,
          nextCheckAt: t.nextCheckAt || null,
          newCount: newCount,
          totalBatches: batches.length
        };
      });
  }

  // 处理来自 mcp-stdio 子进程的数据请求
  async function handleMcpChildRequest(child, msg) {
    if (!msg || msg.type !== 'request') return;
    const id = msg.id;
    const method = msg.method;
    const payload = msg.payload || {};
    let payloadOut = null;
    let errorOut = null;
    try {
      switch (method) {
        case 'getWorkflows':
          payloadOut = await mcpListCards();
          break;
        case 'getAiworkflows':
          payloadOut = await mcpListWorkflows();
          break;
        case 'runTask':
          payloadOut = await mcpRunTask(payload.taskId);
          break;
        case 'createTask':
          payloadOut = await mcpCreateTask(payload);
          break;
        case 'getTaskResults':
          payloadOut = await mcpGetTaskResults(payload.taskId, payload.batchId);
          break;
        case 'scrapePage':
          payloadOut = await mcpScrapePage(payload.url, payload.selector);
          break;
        case 'extractElements':
          payloadOut = await mcpExtractElements(payload.url, payload.selector, payload.fields);
          break;
        case 'getTrackingStatus':
          payloadOut = await mcpGetTrackingStatus();
          break;
        default:
          throw new Error('未知的 MCP 子进程请求方法: ' + method);
      }
    } catch (err) {
      errorOut = (err && err.message) ? err.message : String(err);
    }
    try {
      child.send({ type: 'response', id: id, payload: payloadOut, error: errorOut });
    } catch (e) { /* 子进程可能已退出 */ }
  }

  // 启动 MCP 子进程
  function startMcpServer(readonly) {
    if (mcpServerInstance && mcpServerInstance.child && !mcpServerInstance.child.killed) {
      // 已在运行，先停止
      stopMcpServer();
    }
    const mcpStdioPath = path.join(__dirname, 'mcp-stdio.js');
    const env = Object.assign({}, process.env, {
      MCP_READONLY: readonly ? 'true' : 'false'
    });
    const child = child_process.fork(mcpStdioPath, [], {
      env: env,
      stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    });

    const instance = {
      child: child,
      readonly: !!readonly,
      startedAt: Date.now(),
      callLogs: [],
      toolCount: readonly ? 6 : 8,
      ready: false
    };

    child.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ready') {
        instance.ready = true;
        instance.startedAt = (msg.payload && msg.payload.startedAt) || instance.startedAt;
        instance.toolCount = (msg.payload && msg.payload.toolCount) || instance.toolCount;
      } else if (msg.type === 'request') {
        // 子进程请求数据
        handleMcpChildRequest(child, msg);
      } else if (msg.type === 'log') {
        // Task 19.10/19.11: 收集调用日志
        if (msg.payload && typeof msg.payload === 'object') {
          instance.callLogs.push(msg.payload);
          if (instance.callLogs.length > 100) {
            instance.callLogs.splice(0, instance.callLogs.length - 100);
          }
        }
      } else if (msg.type === 'error') {
        console.error('[MCP] child error:', msg.payload && msg.payload.message);
      } else if (msg.type === 'exited') {
        // 子进程退出
      }
    });

    child.on('exit', (code, signal) => {
      // 若用户未主动停止，记录异常退出
      if (mcpServerInstance === instance) {
        mcpServerInstance = null;
      }
    });

    child.on('error', (err) => {
      console.error('[MCP] child process error:', err);
    });

    mcpServerInstance = instance;
    return instance;
  }

  // 停止 MCP 子进程
  function stopMcpServer() {
    if (!mcpServerInstance || !mcpServerInstance.child) {
      mcpServerInstance = null;
      return;
    }
    try {
      if (!mcpServerInstance.child.killed) {
        try { mcpServerInstance.child.send({ type: 'shutdown', payload: {} }); } catch (e) { /* ignore */ }
        // 给 500ms 优雅退出，否则强杀
        setTimeout(() => {
          try {
            if (mcpServerInstance && mcpServerInstance.child && !mcpServerInstance.child.killed) {
              mcpServerInstance.child.kill('SIGKILL');
            }
          } catch (e) { /* ignore */ }
        }, 500);
      }
    } catch (e) { /* ignore */ }
    mcpServerInstance = null;
  }

  // Task 18.3: mcp-toggle IPC
  ipcMain.handle('mcp-toggle', async (event, params) => {
    try {
      params = params || {};
      const enabled = !!params.enabled;
      const readonly = params.readonly !== false; // 默认只读
      if (enabled) {
        startMcpServer(readonly);
        return { success: true, data: { running: true, readonly: readonly, startedAt: mcpServerInstance.startedAt } };
      } else {
        stopMcpServer();
        return { success: true, data: { running: false } };
      }
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // Task 18.3: mcp-status IPC
  ipcMain.handle('mcp-status', async () => {
    try {
      if (!mcpServerInstance || !mcpServerInstance.child || mcpServerInstance.child.killed) {
        return { success: true, data: { running: false, readonly: false, startedAt: null, toolCount: 0, ready: false } };
      }
      return {
        success: true,
        data: {
          running: true,
          readonly: mcpServerInstance.readonly,
          startedAt: mcpServerInstance.startedAt,
          toolCount: mcpServerInstance.toolCount,
          ready: !!mcpServerInstance.ready
        }
      };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // Task 18.3: mcp-set-readonly IPC（重启 server 实例以应用新 readonly 模式）
  ipcMain.handle('mcp-set-readonly', async (event, readonly) => {
    try {
      const wasRunning = !!(mcpServerInstance && mcpServerInstance.child && !mcpServerInstance.child.killed);
      if (wasRunning) {
        stopMcpServer();
        // 等待子进程退出
        await sleep(300);
        startMcpServer(!!readonly);
        return { success: true, data: { running: true, readonly: !!readonly, restarted: true } };
      } else {
        // 未运行时只记录意图（下次启动时应用），这里直接返回未运行状态
        return { success: true, data: { running: false, readonly: !!readonly, restarted: false } };
      }
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // Task 19.11: mcp-get-logs IPC
  // 调用日志存主进程内存：从子进程通过 'log' 消息收集，或回退到直接调用 invokeWithLog 路径
  // 由于工具调用发生在子进程内，子进程每次工具调用后会通过 process.send 上报日志
  ipcMain.handle('mcp-get-logs', async () => {
    try {
      const logs = (mcpServerInstance && Array.isArray(mcpServerInstance.callLogs))
        ? mcpServerInstance.callLogs.slice(-100)
        : [];
      return { success: true, data: logs };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });
}

function setupContextMenu() {
  // 主窗口（UI 区域）右键菜单
  mainWindow.webContents.on('context-menu', (e, params) => {
    const menuTemplate = [
      { label: '剪切', role: 'cut' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
      { type: 'separator' },
      { label: '全选', role: 'selectall' }
    ];
    const menu = Menu.buildFromTemplate(menuTemplate);
    menu.popup(mainWindow);
  });

  // BrowserView 右键菜单（使用当前活动的 BrowserView）
  const getActiveBV = () => activeTabId ? browserViews.get(activeTabId) : null;

  // 为所有 BrowserView 设置右键菜单
  const setupBVContextMenu = (bv) => {
    bv.webContents.on('context-menu', (e, params) => {
      // picker 模式下不显示主进程右键菜单（由 preload 自定义工具菜单接管）
      if (pickerModeState) {
        e.preventDefault();
        return;
      }
      const menuTemplate = [
        { label: '返回', enabled: bv.webContents.canGoBack(), click: () => bv.webContents.goBack() },
        { label: '前进', enabled: bv.webContents.canGoForward(), click: () => bv.webContents.goForward() },
        { label: '刷新', click: () => bv.webContents.reload() },
        { type: 'separator' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { type: 'separator' },
        {
          label: '抓取模式',
          type: 'checkbox',
          checked: inspectModeState,
          click: () => {
            // 切换抓取模式状态
            inspectModeState = !inspectModeState;
            // 通知所有 BrowserView 的 preload
            for (const v of browserViews.values()) {
              if (v && !v.webContents.isDestroyed()) {
                v.webContents.send('toggle-inspect', inspectModeState);
              }
            }
            // 通知渲染进程更新 UI（按钮高亮等）
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('inspect-mode-changed', inspectModeState);
            }
          }
        },
        { type: 'separator' },
        { label: '检查元素', click: () => bv.webContents.inspectElement(params.x, params.y) }
      ];
      const menu = Menu.buildFromTemplate(menuTemplate);
      menu.popup(mainWindow);
    });
  };

  // 存储 setupBVContextMenu 供 createBrowserView 使用
  globalThis._setupBVContextMenu = setupBVContextMenu;
}

// 视频 CDN 域名（无标准扩展名但实际是视频流）
const videoCdnDomains = [
  'bilivideo.com', 'bilivideo.cn', 'hdslb.com',
  'iqiyi.com', 'qiyipic.com',
  'youku.com', 'ykimg.com',
  'v.qq.com', 'qqvideo.com',
  'douyinvod.com', 'douyinstatic.com',
  'weibocdn.com', 'sinaimg.cn'
];

function isVideoCdnUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return videoCdnDomains.some(d => hostname.endsWith(d) || hostname === d);
  } catch { return false; }
}

function setupMediaInterception() {
  // 使用 defaultSession 来拦截 BrowserView 中的网络请求
  const ses = session.defaultSession;

  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const ext = getExt(url);

    // 检测媒体资源请求
    let mediaType = null;
    if (videoExts.includes(ext)) mediaType = 'video';
    else if (audioExts.includes(ext)) mediaType = 'audio';
    else if (imgExts.includes(ext)) mediaType = 'image';
    // 检测视频 CDN URL（无标准扩展名）
    else if (isVideoCdnUrl(url)) mediaType = 'video';
    // 也检测 content-type 中可能的媒体类型（通过URL特征）
    else if (/\.(mp4|webm|flv|m3u8|ts|mp3|wav|ogg|aac)(\?|$)/i.test(url)) {
      if (videoExts.includes(ext)) mediaType = 'video';
      else if (audioExts.includes(ext)) mediaType = 'audio';
    }

    if (mediaType && mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.send('media-request-intercepted', {
          type: mediaType,
          url: url,
          name: getFileName(url),
          format: ext.toUpperCase() || mediaType.toUpperCase(),
          resourceType: details.resourceType
        });
      } catch (e) {
        // window may have been destroyed
      }
    }

    // 始终放行请求，只是监控
    callback({});
  });

  // 也通过 onHeadersReceived 来捕获（某些CDN URL没有明确扩展名但有正确content-type）
  ses.webRequest.onHeadersReceived((details, callback) => {
    const contentType = (details.responseHeaders && (
      details.responseHeaders['Content-Type'] ||
      details.responseHeaders['content-type']
    )) || [];
    const ct = Array.isArray(contentType) ? contentType[0] : contentType;

    let mediaType = null;
    if (/^video\//i.test(ct)) mediaType = 'video';
    else if (/^audio\//i.test(ct)) mediaType = 'audio';
    else if (/^image\//i.test(ct) && details.resourceType === 'xhr') mediaType = 'image';

    if (mediaType && mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.send('media-request-intercepted', {
          type: mediaType,
          url: details.url,
          name: getFileName(details.url),
          format: (getExt(details.url) || mediaType).toUpperCase(),
          resourceType: details.resourceType,
          contentType: ct
        });
      } catch (e) {}
    }

    callback({});
  });
}

// ============ 多 BrowserView 管理 ============

// 创建新的 BrowserView 并返回 tabId
function createBrowserView(url) {
  const tabId = ++tabIdCounter;

  const bv = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, '../renderer/webview-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
      sandbox: false
    }
  });

  // 设置 BrowserView 位置（使用 getContentBounds 获取实际内容区域）
  const contentBounds = mainWindow.getContentBounds();
  const sidebarOffset = sidebarVisibleFromRenderer ? (SIDEBAR_WIDTH + 8) : 8;
  bv.setBounds({
    x: LEFT_NAV_WIDTH,
    y: VIEW_OFFSET_Y,
    width: contentBounds.width - LEFT_NAV_WIDTH - sidebarOffset,
    height: contentBounds.height - VIEW_OFFSET_Y - VIEW_OFFSET_BOTTOM
  });

  // 添加到 Map
  browserViews.set(tabId, bv);

  // 设置为活动标签
  if (!activeTabId) {
    mainWindow.setBrowserView(bv);
    activeTabId = tabId;
  } else {
    // 非首个标签，先不添加到窗口，等切换时再添加
  }

  // 设置右键菜单
  if (globalThis._setupBVContextMenu) {
    globalThis._setupBVContextMenu(bv);
  }

  // ============ BrowserView webContents 事件（使用闭包变量 tabId/bv） ============

  // 页面加载完成
  bv.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser-did-finish-load', { tabId });
    }
    // 同步当前抓取模式状态到新加载的页面（新标签页默认为关闭状态）
    if (inspectModeState && !bv.webContents.isDestroyed()) {
      bv.webContents.send('toggle-inspect', true);
    }
    // 主动触发资源提取（不依赖 preload 的 load 事件，确保提取一定执行）
    if (!bv.webContents.isDestroyed()) {
      bv.webContents.send('extract-all');
    }
  });

  // 页面加载失败
  bv.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser-did-fail-load', {
        tabId,
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame
      });
    }
  });

  // 页面导航
  bv.webContents.on('did-navigate', (event, url) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser-did-navigate', { tabId, url });
    }
  });

  // 监听页面 console.log 进度事件（B站视频下载进度）
  bv.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (message && message.startsWith('__BILI_PROGRESS__')) {
      try {
        const data = JSON.parse(message.replace('__BILI_PROGRESS__', ''));
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', data);
        }
      } catch (e) {}
    }
  });

  // 页面页内导航（hash 变化、history API）
  bv.webContents.on('did-navigate-in-page', (event, url) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser-did-navigate-in-page', { tabId, url });
    }
  });

  // 页面标题更新
  bv.webContents.on('page-title-updated', (event, title) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser-page-title-updated', { tabId, title });
    }
  });

  // 页面 favicon 更新
  bv.webContents.on('page-favicon-updated', (event, favicons) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser-page-favicon-updated', { tabId, favicons });
    }
  });

  // ============ window.open() 拦截 ============
  bv.webContents.setWindowOpenHandler(({ url, features }) => {
    // 如果有宽高参数（如登录弹窗），允许弹出新窗口
    if (features && (features.includes('width=') || features.includes('height='))) {
      return { action: 'allow' };
    }
    // 其他情况创建新标签页打开
    const newTabId = createBrowserView(url);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tab-created', { tabId: newTabId, url, title: '新标签页', autoSwitch: true });
    }
    return { action: 'deny' };
  });

  // 加载 URL
  if (url) {
    bv.webContents.loadURL(url);
  }

  return tabId;
}

// ============ 全局 BrowserView IPC 转发（避免在 createBrowserView 中重复注册） ============

// 辅助函数：根据 event.sender 查找 tabId
function findTabIdBySender(sender) {
  for (const [id, bv] of browserViews) {
    if (bv && !bv.webContents.isDestroyed() && bv.webContents === sender) {
      return id;
    }
  }
  return null;
}

// resources-extracted: preload 发送 (resources)，包装为 { tabId, resources }
ipcMain.on('resources-extracted', (event, resources) => {
  const tabId = findTabIdBySender(event.sender);
  if (tabId !== null && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('resources-extracted', { tabId, resources });
  }
});

// page-title: preload 发送 (title)，包装为 { tabId, title }
ipcMain.on('page-title', (event, title) => {
  const tabId = findTabIdBySender(event.sender);
  if (tabId !== null && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('page-title', { tabId, title });
  }
});

// inspect-mode-changed: preload 发送 (enabled)，包装为 { tabId, enabled }
ipcMain.on('inspect-mode-changed', (event, enabled) => {
  const tabId = findTabIdBySender(event.sender);
  if (tabId !== null) {
    inspectModeState = !!enabled;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('inspect-mode-changed', { tabId, enabled });
    }
  }
});

// element-resources: preload 发送 (data)，包装为 { tabId, ...data }
ipcMain.on('element-resources', (event, data) => {
  const tabId = findTabIdBySender(event.sender);
  if (tabId !== null && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('element-resources', { tabId, ...data });
  }
});

// element-hover-preview: preload 发送 (data)，包装为 { tabId, ...data }
ipcMain.on('element-hover-preview', (event, data) => {
  const tabId = findTabIdBySender(event.sender);
  if (tabId !== null && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('element-hover-preview', { tabId, ...data });
  }
});

// element-hover-clear: preload 发送，包装为 { tabId }
ipcMain.on('element-hover-clear', (event) => {
  const tabId = findTabIdBySender(event.sender);
  if (tabId !== null && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('element-hover-clear', { tabId });
  }
});

// media-batch: preload 发送 (mediaArray)，包装为 { tabId, mediaArray }
ipcMain.on('media-batch', (event, mediaArray) => {
  const tabId = findTabIdBySender(event.sender);
  if (tabId !== null && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('media-batch', { tabId, mediaArray });
  }
});

// page-url-changed: preload 发送 (url)，包装为 { tabId, url }
ipcMain.on('page-url-changed', (event, url) => {
  const tabId = findTabIdBySender(event.sender);
  if (tabId !== null && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('page-url-changed', { tabId, url });
  }
});

// 非抓取模式下超链接点击：转发给渲染进程以便新建标签页
ipcMain.on('link-clicked', (event, url) => {
  const tabId = findTabIdBySender(event.sender);
  if (tabId !== null && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('link-clicked', { tabId, url });
  }
});

// B站视频下载进度反馈：从 webview 转发到渲染进程
ipcMain.on('bilibili-download-progress-from-webview', (event, data) => {
  const tabId = findTabIdBySender(event.sender);
  if (tabId !== null && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bilibili-download-progress', data);
  }
});

// 切换到指定标签的 BrowserView
function switchBrowserView(tabId) {
  if (tabId === activeTabId) return;
  if (!browserViews.has(tabId)) return;

  // 隐藏当前 BrowserView
  if (activeTabId && browserViews.has(activeTabId)) {
    mainWindow.removeBrowserView(browserViews.get(activeTabId));
  }

  // 显示目标 BrowserView
  const bv = browserViews.get(tabId);
  mainWindow.setBrowserView(bv);
  activeTabId = tabId;

  // 更新 bounds
  updateBrowserViewBounds();

  // 聚焦 BrowserView
  bv.webContents.focus();
}

// 销毁指定标签的 BrowserView
function destroyBrowserView(tabId) {
  const bv = browserViews.get(tabId);
  if (!bv) return;

  // 如果是活动标签，先切换到其他标签
  if (tabId === activeTabId) {
    mainWindow.removeBrowserView(bv);
    browserViews.delete(tabId);

    // 切换到最近的标签
    const remainingTabs = Array.from(browserViews.keys());
    if (remainingTabs.length > 0) {
      const newActiveTabId = remainingTabs[remainingTabs.length - 1];
      const newBv = browserViews.get(newActiveTabId);
      mainWindow.setBrowserView(newBv);
      activeTabId = newActiveTabId;
      updateBrowserViewBounds();
      newBv.webContents.focus();
    } else {
      activeTabId = null;
    }
  } else {
    browserViews.delete(tabId);
  }

  // 销毁 BrowserView
  bv.webContents.destroy();
}

app.whenReady().then(() => {
  initDataDirs();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============ 渲染进程就绪信号 ============

// 渲染进程就绪后，创建初始标签页（百度首页）
ipcMain.handle('renderer-ready', () => {
  const firstTabId = createBrowserView(DEFAULT_HOME_URL);
  mainWindow.webContents.send('tab-created', { tabId: firstTabId, url: DEFAULT_HOME_URL, title: '百度' });
  return true;
});

// ============ BrowserView IPC 处理器 ============

// 获取当前活动的 BrowserView
function getActiveBV() {
  return activeTabId ? browserViews.get(activeTabId) : null;
}

// 浏览器导航到指定 URL
ipcMain.handle('browser-navigate', (event, url) => {
  const bv = getActiveBV();
  if (bv && !bv.webContents.isDestroyed()) {
    bv.webContents.loadURL(url);
    return true;
  }
  return false;
});

// 切换检查模式
ipcMain.handle('browser-toggle-inspect', (event, enabled) => {
  inspectModeState = !!enabled;
  // 通知所有 BrowserView 的 preload（切换标签时也能保持正确状态）
  for (const bv of browserViews.values()) {
    if (bv && !bv.webContents.isDestroyed()) {
      bv.webContents.send('toggle-inspect', inspectModeState);
    }
  }
  return true;
});

// 触发资源提取
ipcMain.handle('browser-extract-all', () => {
  const bv = getActiveBV();
  if (bv && !bv.webContents.isDestroyed()) {
    bv.webContents.send('extract-all');
    return true;
  }
  return false;
});

// 获取 BrowserView 中页面标题
ipcMain.handle('browser-get-title', () => {
  const bv = getActiveBV();
  if (bv && !bv.webContents.isDestroyed()) {
    return bv.webContents.getTitle();
  }
  return '';
});

// 浏览器后退
ipcMain.handle('browser-go-back', () => {
  const bv = getActiveBV();
  if (bv && !bv.webContents.isDestroyed()) {
    bv.webContents.goBack();
    return true;
  }
  return false;
});

// 浏览器前进
ipcMain.handle('browser-go-forward', () => {
  const bv = getActiveBV();
  if (bv && !bv.webContents.isDestroyed()) {
    bv.webContents.goForward();
    return true;
  }
  return false;
});

// 浏览器刷新
ipcMain.handle('browser-reload', () => {
  const bv = getActiveBV();
  if (bv && !bv.webContents.isDestroyed()) {
    bv.webContents.reload();
    return true;
  }
  return false;
});

// 更新 BrowserView bounds（侧边栏状态变化时调用）
ipcMain.handle('browser-update-bounds', () => {
  updateBrowserViewBounds();
  return true;
});

// 同步侧边栏显示状态（渲染进程调用，影响 BrowserView 宽度计算）
ipcMain.handle('set-sidebar-visible', (event, visible) => {
  sidebarVisibleFromRenderer = visible;
  updateBrowserViewBounds();
});

// 设置左侧导航栏宽度（折叠/展开时调用）
ipcMain.handle('set-left-nav-width', (event, width) => {
  LEFT_NAV_WIDTH = width;
  updateBrowserViewBounds();
});

// 隐藏/显示 BrowserView（用于模块切换和对话框弹出时）
ipcMain.handle('set-browserview-visible', (event, visible) => {
  const bv = browserViews.get(activeTabId);
  if (bv) {
    if (visible) {
      mainWindow.setBrowserView(bv);
      // 延迟更新 bounds，确保窗口布局已稳定
      setTimeout(() => updateBrowserViewBounds(), 50);
    } else {
      mainWindow.removeBrowserView(bv);
    }
  }
  return true;
});

// ============ 标签管理 IPC 处理器 ============

// 创建新标签页
ipcMain.handle('create-tab', (event, url) => {
  const tabId = createBrowserView(url || DEFAULT_HOME_URL);
  // 通知渲染进程标签已创建
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-created', { tabId, url: url || DEFAULT_HOME_URL, title: '新标签页' });
  }
  return { tabId, url: url || DEFAULT_HOME_URL };
});

// 切换到指定标签
ipcMain.handle('switch-tab', (event, tabId) => {
  switchBrowserView(Number(tabId));
  return true;
});

// 关闭指定标签
ipcMain.handle('close-tab', (event, tabId) => {
  destroyBrowserView(Number(tabId));
  return true;
});

// ============ 原有 IPC 处理器 ============

// 抓取网页HTML
ipcMain.handle('fetch-page', async (event, url) => {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const reqHeaders = {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate',
      'Referer': url
    };

    const doRequest = (reqUrl, redirectCount) => {
      if (redirectCount > 5) {
        resolve({ success: false, error: 'Too many redirects' });
        return;
      }

      const proto = reqUrl.startsWith('https') ? https : http;
      proto.get(reqUrl, { headers: reqHeaders, rejectUnauthorized: false }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const redirectUrl = resolveUrl(reqUrl, response.headers.location);
          response.destroy();
          doRequest(redirectUrl, redirectCount + 1);
          return;
        }

        if (response.statusCode !== 200) {
          resolve({ success: false, error: `HTTP ${response.statusCode}` });
          return;
        }

        // 处理gzip/deflate压缩
        const encoding = response.headers['content-encoding'];
        let stream = response;

        if (encoding === 'gzip') {
          stream = response.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
          stream = response.pipe(zlib.createInflate());
        }

        const chunks = [];
        stream.on('data', (chunk) => { chunks.push(chunk); });
        stream.on('end', () => {
          const buffer = Buffer.concat(chunks);
          // 尝试从Content-Type或BOM检测编码
          const contentType = response.headers['content-type'] || '';
          let html = buffer.toString('utf8');

          // 如果检测到charset，尝试重新解码
          const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
          if (charsetMatch) {
            const charset = charsetMatch[1].toLowerCase().replace('-', '');
            if (charset === 'gbk' || charset === 'gb2312' || charset === 'gb18030') {
              try {
                const { TextDecoder } = require('util');
                const decoder = new TextDecoder('gbk');
                html = decoder.decode(buffer);
              } catch (e) {
                // 保持utf8
              }
            }
          }

          resolve({ success: true, html, finalUrl: reqUrl });
        });
        stream.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });
      }).on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    };

    doRequest(url, 0);
  });
});

// 选择目录
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  const dir = result.filePaths[0] || null;
  // 返回统一结构 { success, data }，便于前端判断
  return { success: !!dir, data: dir };
});

// 在文件管理器中打开指定目录
ipcMain.handle('open-in-explorer', async (event, targetPath) => {
  try {
    if (!targetPath || !fs.existsSync(targetPath)) {
      return { success: false, error: '路径不存在' };
    }
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      shell.openPath(targetPath);
    } else {
      // 是文件，打开所在目录并选中
      shell.showItemInFolder(targetPath);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===== 应用默认导出目录（全局通用，未设置任务级路径时回退） =====
ipcMain.handle('get-default-export-dir', async () => {
  return { success: true, data: getDefaultExportDir() };
});
ipcMain.handle('set-default-export-dir', async (event, dir) => {
  try {
    // dir 为 null/空字符串表示清除默认目录
    const finalDir = dir && String(dir).trim();
    if (finalDir) {
      // 校验目录是否存在（不存在则尝试创建）
      if (!fs.existsSync(finalDir)) {
        fs.mkdirSync(finalDir, { recursive: true });
      }
    }
    saveSettings({ defaultExportDir: finalDir || '' });
    return { success: true, data: finalDir || '' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 选择保存文件
ipcMain.handle('select-save-file', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: options.title || '保存文件',
    defaultPath: options.defaultPath || '',
    filters: options.filters || [{ name: '所有文件', extensions: ['*'] }]
  });
  return result.filePath || null;
});

// 选择打开文件（HT 编辑器导入数据用）
ipcMain.handle('select-open-file', async (event, options) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: (options && options.title) || '选择文件',
      defaultPath: (options && options.defaultPath) || '',
      filters: (options && options.filters) || [{ name: '所有文件', extensions: ['*'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths || !result.filePaths.length) {
      return null;
    }
    return result.filePaths[0];
  } catch (e) {
    return null;
  }
});

// 解析电子表格文件（CSV/JSON/XLSX）为二维数组（HT 编辑器统计图导入数据）
ipcMain.handle('parse-spreadsheet', async (event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' };
    }
    const ext = path.extname(filePath).toLowerCase();
    let rows = [];
    if (ext === '.json') {
      const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const arr = Array.isArray(json) ? json : [json];
      if (!arr.length) return { success: false, error: 'JSON 为空' };
      const headers = Object.keys(arr[0]);
      rows.push(headers);
      for (const item of arr) rows.push(headers.map(h => item[h] != null ? String(item[h]) : ''));
    } else if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
      const text = fs.readFileSync(filePath, 'utf8');
      const sep = ext === '.tsv' ? '\t' : (text.includes('\t') && !text.includes(',') ? '\t' : (text.includes(';') && !text.includes(',') ? ';' : ','));
      const lines = text.split(/\r?\n/).filter(l => l.length > 0);
      for (const line of lines) rows.push(line.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));
    } else if (ext === '.xlsx' || ext === '.xls') {
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(filePath);
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }).map(r => r.map(c => String(c)));
    } else {
      return { success: false, error: '不支持的文件类型：' + ext };
    }
    const headers = rows.length ? rows[0] : [];
    return { success: true, data: { rows, headers } };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 获取下载路径
ipcMain.handle('get-downloads-path', async () => app.getPath('downloads'));

// 取消所有活跃下载
ipcMain.handle('cancel-download', async () => {
  globalDownloadCancelled = true;
  let cancelledCount = 0;
  // 中止主进程中的 HTTP 请求
  for (const [key, req] of activeDownloadRequests) {
    try {
      if (req && typeof req.destroy === 'function') {
        req.destroy();
        cancelledCount++;
      }
    } catch {}
  }
  activeDownloadRequests.clear();
  // 中止 BrowserView 中的 fetch 下载（B站视频）
  for (const [tabId, bv] of browserViews) {
    try {
      if (bv && !bv.webContents.isDestroyed()) {
        bv.webContents.executeJavaScript('window.__download_cancelled__ = true', true).catch(() => {});
      }
    } catch {}
  }
  return { success: true, cancelled: cancelledCount };
});

// 重置下载取消标志
ipcMain.handle('reset-download-cancel', async () => {
  globalDownloadCancelled = false;
  return { success: true };
});

// 下载文件（带 Referer 和 User-Agent，支持 fileId 进度标识）
ipcMain.handle('download-file', async (event, { url, savePath, referer, fileId }) => {
  // 下载开始时重置取消标志（避免上次取消残留）
  globalDownloadCancelled = false;
  try {
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 优化：使用高水位线提升 I/O 性能
    const file = fs.createWriteStream(savePath, { highWaterMark: 64 * 1024 });
    const reqHeaders = {
      'User-Agent': UA,
      'Referer': referer || url
    };

    const speedTracker = createSpeedTracker();
    const downloadKey = fileId || savePath;
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 500;

    return new Promise((resolve) => {
      const doRequest = async (reqUrl, redirectCount, retryCount = 0) => {
        // 检查取消标志
        if (globalDownloadCancelled) {
          file.close();
          fs.unlink(savePath, () => {});
          resolve({ success: false, error: '已取消' });
          return;
        }
        if (redirectCount > 5) {
          file.close();
          resolve({ success: false, error: 'Too many redirects' });
          return;
        }

        const proto = reqUrl.startsWith('https') ? https : http;
        const agent = reqUrl.startsWith('https') ? httpsAgent : httpAgent;

        const request = () => new Promise((res, rej) => {
          const req = proto.get(reqUrl, {
            headers: reqHeaders,
            agent,
            rejectUnauthorized: false
          }, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              const redirectUrl = resolveUrl(reqUrl, response.headers.location);
              response.destroy();
              doRequest(redirectUrl, redirectCount + 1, retryCount).then(res).catch(rej);
              return;
            }

            if (response.statusCode !== 200) {
              response.destroy();
              rej(new Error(`HTTP ${response.statusCode}`));
              return;
            }

            res(response);
          });
          req.on('error', rej);
          // 注册请求对象用于取消下载
          activeDownloadRequests.set(downloadKey, req);
        });

        try {
          speedTracker.start();
          const response = await request();
          const total = parseInt(response.headers['content-length'], 10);
          let downloaded = 0;
          let cancelledFlag = false;

          response.on('data', (chunk) => {
            // 检查取消标志
            if (globalDownloadCancelled) {
              cancelledFlag = true;
              response.unpipe(file);
              response.destroy();
              file.destroy();
              fs.unlink(savePath, () => {});
              resolve({ success: false, error: '已取消' });
              return;
            }
            downloaded += chunk.length;
            const speed = speedTracker.update(downloaded);
            if (mainWindow && !mainWindow.isDestroyed()) {
              const progress = total > 0 ? Math.round((downloaded / total) * 100) : 0;
              const speedStr = formatSpeed(speed);
              mainWindow.webContents.send('download-progress', {
                fileId: fileId !== undefined ? fileId : null,
                progress,
                downloaded,
                total,
                stage: 'downloading',
                statusText: total > 0 ? '下载中 ' + progress + '%' + (speedStr ? ' ' + speedStr : '') : '下载中 ' + formatBytes(downloaded) + (speedStr ? ' ' + speedStr : '')
              });
            }
          });
          response.pipe(file);
          file.on('finish', () => {
            if (cancelledFlag) return;
            file.close();
            activeDownloadRequests.delete(downloadKey);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('download-progress', {
                fileId: fileId !== undefined ? fileId : null,
                progress: 100,
                downloaded: downloaded || total,
                total: total || downloaded,
                stage: 'done',
                statusText: '完成'
              });
            }
            resolve({ success: true, path: savePath });
          });
          file.on('error', () => {
            if (!cancelledFlag) {
              try { fs.unlink(savePath, () => {}); } catch {}
              resolve({ success: false, error: '文件写入错误' });
            }
          });
        } catch (err) {
          activeDownloadRequests.delete(downloadKey);
          // 取消时不重试，直接返回
          if (globalDownloadCancelled) {
            file.close();
            fs.unlink(savePath, () => {});
            resolve({ success: false, error: '已取消' });
            return;
          }
          if (retryCount < MAX_RETRIES && isRetryableError(err)) {
            await sleep(RETRY_DELAY_MS * (retryCount + 1));
            doRequest(reqUrl, redirectCount, retryCount + 1).then(resolve).catch(() => {
              file.close();
              fs.unlink(savePath, () => {});
              resolve({ success: false, error: err.message });
            });
          } else {
            file.close();
            fs.unlink(savePath, () => {});
            resolve({ success: false, error: err.message });
          }
        }
      };

      doRequest(url, 0, 0);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============ 智能视频下载（转码/格式修正） ============

// 根据 Content-Type 获取正确的视频扩展名
function getVideoExtFromContentType(contentType, url) {
  if (!contentType) {
    // 从 URL 推断
    const ext = getExt(url);
    if (['mp4', 'webm', 'flv', 'avi', 'mov', 'mkv'].includes(ext)) return ext;
    return 'mp4'; // 默认 mp4
  }
  contentType = contentType.toLowerCase();
  if (contentType.includes('mp4') || contentType.includes('mpeg4')) return 'mp4';
  if (contentType.includes('webm')) return 'webm';
  if (contentType.includes('flv')) return 'flv';
  if (contentType.includes('matroska') || contentType.includes('mkv')) return 'mkv';
  if (contentType.includes('quicktime')) return 'mov';
  if (contentType.includes('mpegurl') || contentType.includes('m3u8')) return 'm3u8';
  if (contentType.includes('mp2t') || contentType.includes('mpeg')) return 'ts';
  return 'mp4';
}

// 修正文件扩展名
function fixFileExtension(savePath, ext) {
  const dir = path.dirname(savePath);
  const basename = path.basename(savePath, path.extname(savePath));
  return path.join(dir, basename + '.' + ext);
}

// 下载 m3u8 并合并为单个视频文件
async function downloadM3u8AndMerge(m3u8Url, savePath, referer, onProgress) {
  const reqHeaders = { 'User-Agent': UA, 'Referer': referer || m3u8Url };

  // 1. 下载 m3u8 播放列表（使用连接池）
  const playlistText = await new Promise((resolve, reject) => {
    const proto = m3u8Url.startsWith('https') ? https : http;
    const agent = m3u8Url.startsWith('https') ? httpsAgent : httpAgent;
    proto.get(m3u8Url, { headers: reqHeaders, agent, rejectUnauthorized: false }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });

  // 2. 解析 ts 片段 URL
  const lines = playlistText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  if (lines.length === 0) throw new Error('m3u8 播放列表为空');

  const segmentUrls = lines.map(line => resolveUrl(m3u8Url, line));

  // 3. 并发下载 ts 片段并合并（最多 3 个并行）
  const finalPath = savePath.replace(/\.[^.]+$/, '.ts');
  const writeStream = fs.createWriteStream(finalPath, { highWaterMark: 64 * 1024 });
  const total = segmentUrls.length;
  const completedSegments = new Array(total);
  const limiter = new ConcurrencyLimiter(3);
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 300;

  // 下载单个片段（带重试）
  const downloadSegment = async (index, segUrl) => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const buffer = await new Promise((resolve, reject) => {
          const proto = segUrl.startsWith('https') ? https : http;
          const agent = segUrl.startsWith('https') ? httpsAgent : httpAgent;
          proto.get(segUrl, { headers: reqHeaders, agent, rejectUnauthorized: false }, (res) => {
            if (res.statusCode !== 200) { reject(new Error(`片段 ${index+1} HTTP ${res.statusCode}`)); return; }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
          }).on('error', reject);
        });
        return { index, buffer };
      } catch (err) {
        if (attempt < MAX_RETRIES && isRetryableError(err)) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        throw err;
      }
    }
  };

  // 并发下载所有片段
  const downloadPromises = segmentUrls.map((segUrl, i) =>
    limiter.run(async () => {
      const result = await downloadSegment(i, segUrl);
      completedSegments[result.index] = result.buffer;
      if (onProgress) {
        const completed = completedSegments.filter(Boolean).length;
        onProgress(Math.round((completed / total) * 100));
      }
    })
  );

  await Promise.all(downloadPromises);

  // 按顺序写入文件
  for (const buffer of completedSegments) {
    if (buffer) writeStream.write(buffer);
  }

  await new Promise(resolve => writeStream.end(resolve));
  return { success: true, path: finalPath, segmentCount: total };
}

// 智能下载视频：处理 m3u8、根据 Content-Type 修正扩展名
ipcMain.handle('download-video-smart', async (event, { url, savePath, referer, fileId }) => {
  // 下载开始时重置取消标志（避免上次取消残留）
  globalDownloadCancelled = false;
  try {
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const reqHeaders = { 'User-Agent': UA, 'Referer': referer || url };

    // 处理 m3u8 流媒体
    if (url.includes('.m3u8') || getExt(url) === 'm3u8') {
      const result = await downloadM3u8AndMerge(url, savePath, referer, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            fileId: fileId !== undefined ? fileId : null,
            progress, downloaded: 0, total: 0,
            stage: 'downloading', statusText: '下载片段 ' + progress + '%'
          });
        }
      });
      return { ...result, type: 'm3u8' };
    }

    // 处理 blob: URL（通过 BrowserView 获取 blob 数据）
    if (url.startsWith('blob:')) {
      const bv = browserViews.get(activeTabId);
      if (!bv) return { success: false, error: '无法获取 blob 数据：没有活动标签页' };

      // 在页面中执行 JS 获取 blob 数据
      const base64Data = await bv.webContents.executeJavaScript(`
        (async function() {
          try {
            const response = await fetch('${url}');
            const blob = await response.blob();
            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          } catch(e) { return null; }
        })()
      `, true);

      if (!base64Data) return { success: false, error: '无法读取 blob 数据' };

      // 去除 data URL 前缀
      const base64 = base64Data.split(',')[1];
      const buffer = Buffer.from(base64, 'base64');
      const ext = 'webm'; // blob 通常是 webm 格式
      const finalPath = savePath.replace(/\.[^.]+$/, '') + '.' + ext;
      fs.writeFileSync(finalPath, buffer);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          fileId: fileId !== undefined ? fileId : null,
          progress: 100, downloaded: buffer.length, total: buffer.length,
          stage: 'done', statusText: '完成'
        });
      }
      return { success: true, path: finalPath, type: 'blob' };
    }

    // 普通 HTTP 下载，根据 Content-Type 修正扩展名
    return new Promise((resolve) => {
      const speedTracker = createSpeedTracker();
      const MAX_RETRIES = 2;
      const RETRY_DELAY_MS = 500;
      const PARTS = 4; // IDM式4部分并行下载

      const doRequest = async (reqUrl, redirectCount, retryCount = 0, skipHead = false) => {
        // 检查取消标志
        if (globalDownloadCancelled) { resolve({ success: false, error: '已取消' }); return; }
        if (redirectCount > 5) { resolve({ success: false, error: 'Too many redirects' }); return; }
        const proto = reqUrl.startsWith('https') ? https : http;
        const agent = reqUrl.startsWith('https') ? httpsAgent : httpAgent;

        // 先HEAD请求获取文件大小（skipHead时跳过）
        let total = 0;
        let headContentType = '';
        if (!skipHead) {
          const headRequest = () => new Promise((res, rej) => {
            const req = proto.request({
              method: 'HEAD',
              hostname: new URL(reqUrl).hostname,
              port: new URL(reqUrl).port || (reqUrl.startsWith('https') ? 443 : 80),
              path: new URL(reqUrl).pathname + new URL(reqUrl).search,
              headers: reqHeaders,
              agent,
              rejectUnauthorized: false
            }, (response) => {
              if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.destroy();
                headRequest(resolveUrl(reqUrl, response.headers.location)).then(res).catch(rej);
                return;
              }
              res(response);
            });
            req.on('error', rej);
            activeDownloadRequests.set(fileId + '_head', req);
            req.end();
          });

          try {
            const headResp = await headRequest();
            total = parseInt(headResp.headers['content-length'], 10) || 0;
            headContentType = headResp.headers['content-type'] || '';
            headResp.destroy();
          } catch (e) {
            // HEAD失败，继续尝试GET
          }
        }

        try {
          if (total <= 0) {
            // 无法获取大小或跳过了HEAD，使用单流下载
            const request = () => new Promise((res, rej) => {
              const req = proto.get(reqUrl, { headers: reqHeaders, agent, rejectUnauthorized: false }, (response) => {
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                  const redirectUrl = resolveUrl(reqUrl, response.headers.location);
                  response.destroy();
                  doRequest(redirectUrl, redirectCount + 1, retryCount, true).then(res).catch(rej);
                  return;
                }
                if (response.statusCode !== 200) {
                  response.destroy();
                  rej(new Error(`HTTP ${response.statusCode}`));
                  return;
                }
                res(response);
              });
              req.on('error', rej);
              // 注册请求对象用于取消下载
              activeDownloadRequests.set(fileId + '_single', req);
            });

            speedTracker.start();
            const response = await request();
            const contentType = response.headers['content-type'] || headContentType;
            const ext = getVideoExtFromContentType(contentType, reqUrl);
            const finalPath = fixFileExtension(savePath, ext);
            const file = fs.createWriteStream(finalPath, { highWaterMark: 64 * 1024 });

            let downloaded = 0;
            let cancelledFlag = false;
            response.on('data', (chunk) => {
              if (globalDownloadCancelled) {
                cancelledFlag = true;
                response.unpipe(file);
                response.destroy();
                file.destroy();
                fs.unlink(finalPath, () => {});
                resolve({ success: false, error: '已取消' });
                return;
              }
              downloaded += chunk.length;
              const speed = speedTracker.update(downloaded);
              if (mainWindow && !mainWindow.isDestroyed()) {
                const speedStr = formatSpeed(speed);
                mainWindow.webContents.send('download-progress', {
                  fileId: fileId !== undefined ? fileId : null,
                  progress: 0,
                  downloaded, total: downloaded,
                  stage: 'downloading',
                  statusText: '下载中' + (speedStr ? ' ' + speedStr : '')
                });
              }
            });
            response.pipe(file);
            file.on('finish', () => {
              if (cancelledFlag) return;
              file.close();
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('download-progress', {
                  fileId: fileId !== undefined ? fileId : null,
                  progress: 100, downloaded, total: downloaded,
                  stage: 'done', statusText: '完成'
                });
              }
              resolve({ success: true, path: finalPath, type: 'http', contentType, ext });
            });
            file.on('error', () => {
              if (!cancelledFlag) {
                try { fs.unlink(finalPath, () => {}); } catch {}
                resolve({ success: false, error: '文件写入错误' });
              }
            });
            return;
          }

          // IDM式多部分并行下载
          const partSize = Math.ceil(total / PARTS);
          const ranges = [];
          for (let i = 0; i < PARTS; i++) {
            const start = i * partSize;
            const end = Math.min(start + partSize - 1, total - 1);
            if (start < total) {
              ranges.push({ start, end, index: i });
            }
          }

          // 并行下载所有部分
          let downloaded = 0;

          const downloadPart = (range) => {
            return new Promise((resolvePart, rejectPart) => {
              const uu = new URL(reqUrl);
              const partReq = proto.request({
                method: 'GET',
                hostname: uu.hostname,
                port: uu.port || (reqUrl.startsWith('https') ? 443 : 80),
                path: uu.pathname + uu.search,
                headers: { ...reqHeaders, 'Range': `bytes=${range.start}-${range.end}` },
                agent,
                rejectUnauthorized: false
              }, (response) => {
                const chunks = [];
                response.on('data', (chunk) => {
                  if (globalDownloadCancelled) {
                    response.destroy();
                    partReq.destroy();
                    rejectPart(new Error('已取消'));
                    return;
                  }
                  chunks.push(chunk);
                  downloaded += chunk.length;

                  // 实时发送进度
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    const progress = Math.round((downloaded / total) * 100);
                    mainWindow.webContents.send('download-progress', {
                      fileId: fileId !== undefined ? fileId : null,
                      progress,
                      downloaded,
                      total,
                      stage: 'downloading',
                      statusText: '下载中 ' + progress + '%'
                    });
                  }
                });
                response.on('end', () => {
                  activeDownloadRequests.delete(fileId + '_part_' + range.index);
                  resolvePart(Buffer.concat(chunks));
                });
                response.on('error', (err) => {
                  activeDownloadRequests.delete(fileId + '_part_' + range.index);
                  rejectPart(err);
                });
              });
              partReq.on('error', rejectPart);
              activeDownloadRequests.set(fileId + '_part_' + range.index, partReq);
              partReq.end();
            });
          };

          const partBuffers = await Promise.all(ranges.map(downloadPart));

          // 写入文件前检查取消标志
          if (globalDownloadCancelled) {
            resolve({ success: false, error: '已取消' });
            return;
          }

          // 使用HEAD获取的Content-Type确定扩展名
          const contentType = headContentType;
          const ext = getVideoExtFromContentType(contentType, reqUrl);
          const finalPath = fixFileExtension(savePath, ext);

          // 合并所有部分到文件
          const file = fs.createWriteStream(finalPath, { highWaterMark: 64 * 1024 });
          for (const buffer of partBuffers) {
            file.write(buffer);
          }

          await new Promise((resolveFile, rejectFile) => {
            file.on('finish', () => {
              file.close();
              resolveFile();
            });
            file.on('error', rejectFile);
          });

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-progress', {
              fileId: fileId !== undefined ? fileId : null,
              progress: 100,
              downloaded: total,
              total,
              stage: 'done',
              statusText: '完成'
            });
          }

          resolve({ success: true, path: finalPath, type: 'http', contentType, ext });
        } catch (err) {
          // 取消时不重试，直接返回
          if (globalDownloadCancelled) {
            try { fs.unlink(finalPath || savePath, () => {}); } catch {}
            resolve({ success: false, error: '已取消' });
            return;
          }
          if (retryCount < MAX_RETRIES && isRetryableError(err)) {
            await sleep(RETRY_DELAY_MS * (retryCount + 1));
            doRequest(reqUrl, redirectCount, retryCount + 1, skipHead).then(resolve).catch(() => {
              resolve({ success: false, error: err.message });
            });
          } else {
            resolve({ success: false, error: err.message });
          }
        }
      };
      doRequest(url, 0, 0);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============ B站视频专用下载（fnval=0 单文件 MP4） ============

// 带解压的 HTTP GET（支持 gzip/deflate/br）
function httpGetDecoded(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqHeaders = {
      'User-Agent': UA,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      ...headers
    };
    const proto = u.protocol === 'https:' ? https : http;
    const req = proto.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: reqHeaders,
      rejectUnauthorized: false
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy();
        httpGetDecoded(new URL(res.headers.location, url).href, headers).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let body = Buffer.concat(chunks);
        try {
          const enc = res.headers['content-encoding'];
          if (enc === 'gzip') body = zlib.gunzipSync(body);
          else if (enc === 'deflate') body = zlib.inflateSync(body);
          else if (enc === 'br') body = zlib.brotliDecompressSync(body);
        } catch {}
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('请求超时')); });
    req.end();
  });
}

// 判断是否为B站视频页面 URL
function isBilibiliVideoUrl(url) {
  return url && url.includes('bilibili.com/video/') || (url && url.match(/^BV\w+/));
}

// 从 URL 或 BV 号中提取 bvid
function extractBvid(url) {
  if (!url) return null;
  const m = url.match(/\/video\/(BV\w+)/);
  if (m) return m[1];
  if (url.match(/^BV\w+$/)) return url;
  return null;
}

// B站视频下载：通过 BrowserView 内 JS 一次性完成 blob 获取 + 分块 base64 转换
// 使用单次 executeJavaScript 避免变量跨调用丢失问题（userGesture:true 每次创建新隔离世界）
ipcMain.handle('download-bilibili-video', async (event, { url, savePath, referer, fileId }) => {
  // 下载开始时重置取消标志（避免上次取消残留）
  globalDownloadCancelled = false;
  try {
    const bvid = extractBvid(url);
    if (!bvid) {
      return { success: false, error: '无法识别B站视频BV号' };
    }

    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const bv = browserViews.get(activeTabId);
    if (!bv) {
      return { success: false, error: '没有活动的 BrowserView' };
    }

    const videoReferer = referer || `https://www.bilibili.com/video/${bvid}`;

    // 1. 通过 BrowserView 的 JS 获取 playinfo 数据（轻量级 JSON）
    const playinfoJson = await bv.webContents.executeJavaScript(`
      (async function() {
        try {
          let aid = null, cid = null, title = '';
          if (window.__INITIAL_STATE__) {
            const s = window.__INITIAL_STATE__;
            if (s.videoData) { aid = s.videoData.aid; cid = s.videoData.cid; title = s.videoData.title; }
          }
          if (!aid) { const m = document.querySelector('meta[itemprop="aid"]'); if (m) aid = m.content; }
          if (!cid) { const m = document.querySelector('meta[itemprop="cid"]'); if (m) cid = m.content; }
          if (!title) title = document.title || '';
          if (!aid || !cid) return JSON.stringify({ error: '无法获取aid/cid' });

          const apiUrl = 'https://api.bilibili.com/x/player/playurl?avid=' + aid + '&cid=' + cid + '&qn=80&fnval=0&fnver=0&fourk=1';
          const resp = await fetch(apiUrl, { headers: { 'Referer': 'https://www.bilibili.com/video/${bvid}' }, credentials: 'include' });
          const data = await resp.json();
          return JSON.stringify({ code: data.code, message: data.message, data: data.data, title: title });
        } catch(e) { return JSON.stringify({ error: e.message }); }
      })()
    `, true);

    const playData = JSON.parse(playinfoJson);
    if (playData.error) { return { success: false, error: playData.error }; }
    if (playData.code !== 0 || !playData.data) { return { success: false, error: '获取播放地址失败: ' + playData.message }; }

    const durl = playData.data.durl;
    if (!durl || durl.length === 0) { return { success: false, error: '未找到可下载的视频流' }; }

    const title = playData.title || 'bilibili_video';
    const ext = 'mp4';
    const finalPath = savePath.replace(/\.[^.]+$/, '') + '.' + ext;

    const videoUrl = durl[0].url;
    const CHUNK_SIZE = 10 * 1024 * 1024;
    const totalSize = durl[0].size || 0;

    // 发送初始进度
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', {
        fileId: fileId !== undefined ? fileId : null,
        progress: 0, downloaded: 0, total: totalSize,
        stage: 'downloading', statusText: '正在获取视频...'
      });
    }

    // 2. IDM式多部分并行下载：先HEAD获取大小，再Range分4块并行下载
    // 通过 postMessage 回传进度，主进程 console-message 监听器转发到渲染进程
    const result = await bv.webContents.executeJavaScript(`
      (async function() {
        try {
          window.__download_cancelled__ = false;
          const url = ${JSON.stringify(videoUrl)};
          const referer = ${JSON.stringify(videoReferer)};
          const commonHeaders = { 'Referer': referer, 'Origin': 'https://www.bilibili.com' };

          // Step 1: HEAD 请求获取文件大小（带cookies鉴权）
          const headResp = await fetch(url, { method: 'HEAD', headers: commonHeaders, credentials: 'include' });
          if (!headResp.ok) return JSON.stringify({ error: 'HEAD HTTP ' + headResp.status });
          const contentLength = parseInt(headResp.headers.get('Content-Length') || '0', 10);
          if (contentLength <= 0) return JSON.stringify({ error: '无法获取文件大小' });

          // Step 2: 分成4块并行 Range 下载
          const PARTS = 4;
          const partSize = Math.ceil(contentLength / PARTS);
          const partResults = new Array(PARTS);
          let totalDownloaded = 0;

          async function downloadPart(partIndex) {
            const start = partIndex * partSize;
            const end = Math.min(start + partSize - 1, contentLength - 1);
            const resp = await fetch(url, {
              headers: { ...commonHeaders, 'Range': 'bytes=' + start + '-' + end },
              credentials: 'include'
            });
            if (!resp.ok) throw new Error('Part ' + partIndex + ' HTTP ' + resp.status);

            const reader = resp.body.getReader();
            const chunks = [];
            let partDownloaded = 0;
            while (true) {
              if (window.__download_cancelled__) {
                reader.cancel();
                throw new Error('已取消');
              }
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              partDownloaded += value.length;
              totalDownloaded += value.length;

              // 实时回传进度（每2%或每500KB报告一次）
              const progress = Math.round((totalDownloaded / contentLength) * 100);
              window.postMessage({
                type: 'bilibili-download-progress',
                fileId: ${fileId !== undefined ? JSON.stringify(fileId) : 'null'},
                progress: progress,
                downloaded: totalDownloaded,
                total: contentLength
              }, '*');
            }
            // 合并该块的chunks
            const blob = new Blob(chunks);
            return { index: partIndex, blob: blob };
          }

          // 并行下载所有块
          const results = await Promise.all(
            Array.from({ length: PARTS }, (_, i) => downloadPart(i))
          );

          // Step 3: 按顺序合并所有块
          const mergedBlob = new Blob(results.map(r => r.blob));
          if (mergedBlob.size === 0) return JSON.stringify({ error: '下载内容为空' });

          // Step 4: 分块转base64传回主进程
          const base64Chunks = [];
          const chunkSize = ${CHUNK_SIZE};
          for (let start = 0; start < mergedBlob.size; start += chunkSize) {
            const end = Math.min(start + chunkSize, mergedBlob.size);
            const slice = mergedBlob.slice(start, end);
            const dataUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(slice);
            });
            base64Chunks.push(dataUrl.split(',')[1]);
          }

          return JSON.stringify({ success: true, chunks: base64Chunks, size: mergedBlob.size });
        } catch(e) { return JSON.stringify({ error: e.message }); }
      })()
    `, true);

    const data = JSON.parse(result);
    if (data.error) {
      // 如果是用户取消，直接返回不进入备用方案
      if (data.error === '已取消' || globalDownloadCancelled) {
        // 清理可能已创建的部分文件
        try { fs.unlink(finalPath, () => {}); } catch {}
        return { success: false, error: '已取消' };
      }
      // 备用方案：重新获取播放地址后主进程直接 HTTP 下载
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          fileId: fileId !== undefined ? fileId : null,
          progress: 0, downloaded: 0, total: totalSize,
          stage: 'downloading', statusText: '备用下载中...'
        });
      }
      // 重新获取播放地址（原URL可能已过期）
      const retryPlayinfoJson = await bv.webContents.executeJavaScript(`
        (async function() {
          try {
            let aid = null, cid = null;
            if (window.__INITIAL_STATE__) {
              const s = window.__INITIAL_STATE__;
              if (s.videoData) { aid = s.videoData.aid; cid = s.videoData.cid; }
            }
            if (!aid || !cid) return JSON.stringify({ error: '无法获取aid/cid' });
            const apiUrl = 'https://api.bilibili.com/x/player/playurl?avid=' + aid + '&cid=' + cid + '&qn=80&fnval=0&fnver=0&fourk=1';
            const resp = await fetch(apiUrl, { headers: { 'Referer': '${videoReferer}' }, credentials: 'include' });
            const data = await resp.json();
            if (data.code === 0 && data.data && data.data.durl && data.data.durl.length > 0) {
              return JSON.stringify({ url: data.data.durl[0].url, size: data.data.durl[0].size || 0 });
            }
            return JSON.stringify({ error: data.message || '获取播放地址失败' });
          } catch(e) { return JSON.stringify({ error: e.message }); }
        })()
      `, true);
      const retryData = JSON.parse(retryPlayinfoJson);
      if (retryData.url) {
        const fallbackResult = await downloadBilibiliDirect(retryData.url, finalPath, videoReferer, fileId, retryData.size || totalSize);
        if (fallbackResult.success) {
          return { ...fallbackResult, type: 'bilibili-mp4', title, segments: 1 };
        }
        return { success: false, error: fallbackResult.error || data.error };
      }
      return { success: false, error: data.error };
    }

    // Step 3: Write chunks to file
    const file = fs.createWriteStream(finalPath);
    let downloaded = 0;

    for (const chunk of data.chunks) {
      // 写入阶段也检查取消标志
      if (globalDownloadCancelled) {
        file.close();
        try { fs.unlink(finalPath, () => {}); } catch {}
        return { success: false, error: '已取消' };
      }
      const buffer = Buffer.from(chunk, 'base64');
      file.write(buffer);
      downloaded += buffer.length;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          fileId: fileId !== undefined ? fileId : null,
          progress: Math.round((downloaded / data.size) * 100),
          downloaded, total: data.size,
          stage: 'writing', statusText: '写入文件...'
        });
      }
    }

    await new Promise(resolve => file.end(resolve));

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', {
        fileId: fileId !== undefined ? fileId : null,
        progress: 100, downloaded, total: data.size,
        stage: 'done', statusText: '完成'
      });
    }

    return { success: true, path: finalPath, type: 'bilibili-mp4', title, size: downloaded, segments: 1 };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// B站视频备用下载：主进程 IDM式多部分并行下载
async function downloadBilibiliDirect(videoUrl, savePath, referer, fileId, totalSize) {
  return new Promise((resolve) => {
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 1000;
    const PARTS = 4; // 分成4部分并行下载

    // 先获取文件大小
    const getFileSize = () => {
      return new Promise((resolveSize) => {
        const uu = new URL(videoUrl);
        const proto = uu.protocol === 'https:' ? https : http;
        const agent = uu.protocol === 'https:' ? httpsAgent : httpAgent;

        const sizeReq = proto.get({
          hostname: uu.hostname,
          port: uu.port || (uu.protocol === 'https:' ? 443 : 80),
          path: uu.pathname + uu.search,
          headers: {
            'User-Agent': UA,
            'Referer': referer || videoUrl,
            'Origin': 'https://www.bilibili.com',
            'Accept': '*/*'
          },
          agent,
          rejectUnauthorized: false
        }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.destroy();
            const newUrl = new URL(res.headers.location, videoUrl).href;
            // 递归获取重定向后的文件大小
            const uu2 = new URL(newUrl);
            const proto2 = uu2.protocol === 'https:' ? https : http;
            const sizeReq2 = proto2.get({
              hostname: uu2.hostname,
              port: uu2.port || (uu2.protocol === 'https:' ? 443 : 80),
              path: uu2.pathname + uu2.search,
              headers: {
                'User-Agent': UA,
                'Referer': referer || newUrl,
                'Origin': 'https://www.bilibili.com'
              },
              agent,
              rejectUnauthorized: false
            }, (res2) => {
              const size = parseInt(res2.headers['content-length'], 10) || 0;
              res2.destroy();
              activeDownloadRequests.delete(fileId + '_size2');
              resolveSize(size);
            });
            activeDownloadRequests.set(fileId + '_size2', sizeReq2);
            sizeReq2.on('error', () => resolveSize(0));
            return;
          }
          const size = parseInt(res.headers['content-length'], 10) || 0;
          res.destroy();
          activeDownloadRequests.delete(fileId + '_size');
          resolveSize(size);
        });
        activeDownloadRequests.set(fileId + '_size', sizeReq);
        sizeReq.on('error', () => resolveSize(0));
      });
    };

    // 下载指定范围的块
    const downloadPart = (start, end, partIndex) => {
      return new Promise((resolvePart, rejectPart) => {
        const uu = new URL(videoUrl);
        const proto = uu.protocol === 'https:' ? https : http;
        const agent = uu.protocol === 'https:' ? httpsAgent : httpAgent;

        const partReq = proto.get({
          hostname: uu.hostname,
          port: uu.port || (uu.protocol === 'https:' ? 443 : 80),
          path: uu.pathname + uu.search,
          headers: {
            'User-Agent': UA,
            'Referer': referer || videoUrl,
            'Origin': 'https://www.bilibili.com',
            'Range': `bytes=${start}-${end}`
          },
          agent,
          rejectUnauthorized: false
        }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.destroy();
            const newUrl = new URL(res.headers.location, videoUrl).href;
            const uu2 = new URL(newUrl);
            const proto2 = uu2.protocol === 'https:' ? https : http;
            const partReq2 = proto2.get({
              hostname: uu2.hostname,
              port: uu2.port || (uu2.protocol === 'https:' ? 443 : 80),
              path: uu2.pathname + uu2.search,
              headers: {
                'User-Agent': UA,
                'Referer': referer || newUrl,
                'Origin': 'https://www.bilibili.com',
                'Range': `bytes=${start}-${end}`
              },
              agent,
              rejectUnauthorized: false
            }, (res2) => {
              const chunks = [];
              res2.on('data', (chunk) => {
                if (globalDownloadCancelled) {
                  res2.destroy();
                  partReq2.destroy();
                  rejectPart(new Error('已取消'));
                  return;
                }
                chunks.push(chunk);
              });
              res2.on('end', () => {
                activeDownloadRequests.delete(fileId + '_part2_' + partIndex);
                resolvePart(Buffer.concat(chunks));
              });
              res2.on('error', (err) => {
                activeDownloadRequests.delete(fileId + '_part2_' + partIndex);
                rejectPart(err);
              });
            });
            activeDownloadRequests.set(fileId + '_part2_' + partIndex, partReq2);
            partReq2.on('error', rejectPart);
            return;
          }

          const chunks = [];
          res.on('data', (chunk) => {
            if (globalDownloadCancelled) {
              res.destroy();
              partReq.destroy();
              rejectPart(new Error('已取消'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            activeDownloadRequests.delete(fileId + '_part_' + partIndex);
            resolvePart(Buffer.concat(chunks));
          });
          res.on('error', (err) => {
            activeDownloadRequests.delete(fileId + '_part_' + partIndex);
            rejectPart(err);
          });
        });
        activeDownloadRequests.set(fileId + '_part_' + partIndex, partReq);
        partReq.on('error', rejectPart);
      });
    };

    // 主下载流程
    (async () => {
      try {
        // 检查取消标志
        if (globalDownloadCancelled) {
          resolve({ success: false, error: '已取消' });
          return;
        }
        // 1. 获取文件大小
        const size = await getFileSize();
        const total = size || totalSize;
        if (total <= 0) {
          resolve({ success: false, error: '无法获取文件大小' });
          return;
        }

        // 2. 计算每个部分的范围
        const partSize = Math.ceil(total / PARTS);
        const ranges = [];
        for (let i = 0; i < PARTS; i++) {
          const start = i * partSize;
          const end = Math.min(start + partSize - 1, total - 1);
          if (start < total) {
            ranges.push({ start, end, index: i });
          }
        }

        // 3. 并行下载所有部分
        let downloaded = 0;
        const partBuffers = new Array(ranges.length);

        const downloadPromises = ranges.map((range) =>
          downloadPart(range.start, range.end, range.index)
            .then((buffer) => {
              partBuffers[range.index] = buffer;
              downloaded += buffer.length;

              // 实时发送进度
              if (mainWindow && !mainWindow.isDestroyed()) {
                const progress = Math.round((downloaded / total) * 100);
                mainWindow.webContents.send('download-progress', {
                  fileId: fileId !== undefined ? fileId : null,
                  progress,
                  downloaded,
                  total,
                  stage: 'downloading',
                  statusText: `下载中 ${progress}%`
                });
              }
            })
        );

        await Promise.all(downloadPromises);

        // 4. 合并所有部分到文件
        const file = fs.createWriteStream(savePath);
        for (const buffer of partBuffers) {
          file.write(buffer);
        }

        await new Promise((resolveFile, rejectFile) => {
          file.on('finish', () => {
            file.close();
            resolveFile();
          });
          file.on('error', rejectFile);
        });

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            fileId: fileId !== undefined ? fileId : null,
            progress: 100,
            downloaded: total,
            total,
            stage: 'done',
            statusText: '完成'
          });
        }

        resolve({ success: true, path: savePath, size: total });
      } catch (err) {
        // 取消或失败时清理部分下载的文件
        try { fs.unlink(savePath, () => {}); } catch {}
        resolve({ success: false, error: err.message });
      }
    })();
  });
}

// 通用文件下载（带进度回调）
function downloadFileWithProgress(url, savePath, referer, onProgress, knownTotal) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const u = new URL(url);
    const reqHeaders = { 'User-Agent': UA, 'Referer': referer || url, 'Accept': '*/*' };
    const doRequest = (reqUrl, redirectCount) => {
      if (redirectCount > 5) { reject(new Error('重定向次数过多')); return; }
      const uu = new URL(reqUrl);
      const proto = uu.protocol === 'https:' ? https : http;
      proto.get({
        hostname: uu.hostname,
        port: uu.port || (uu.protocol === 'https:' ? 443 : 80),
        path: uu.pathname + uu.search,
        headers: { ...reqHeaders, Referer: referer || reqUrl },
        rejectUnauthorized: false
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.destroy();
          doRequest(new URL(res.headers.location, reqUrl).href, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) { res.destroy(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
        // 优先使用响应头 content-length，其次使用外部传入的 knownTotal（探测值）
        const total = parseInt(res.headers['content-length'], 10) || knownTotal || 0;
        let downloaded = 0;
        const file = fs.createWriteStream(savePath);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (onProgress) onProgress(total ? Math.round((downloaded / total) * 100) : 0, downloaded, total);
        });
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve({ success: true, path: savePath, size: downloaded }); });
        file.on('error', reject);
      }).on('error', reject);
    };
    doRequest(url, 0);
  });
}

// ============ 高速下载（多线程分块并行） ============
// 区别于普通浏览器下载：通过 HTTP Range 请求分块并行下载，显著提升大文件下载速度
// 适用场景：支持 Range 请求（Accept-Ranges: bytes）的服务器，如 GitHub Releases 静态资源
// 注意：GitHub codeload archive 为动态生成，不支持 Range，将自动回退单线程下载

// 探测文件大小与是否支持 Range 请求
// 策略：HEAD → GET+Range → plain GET（逐步降级，处理 GitHub codeload 等动态生成场景）
function probeDownload(url, referer) {
  return new Promise((resolve, reject) => {
    const reqHeaders = { 'User-Agent': UA, 'Referer': referer || url };
    const maxRedirects = 8;

    // 阶段1：HEAD 请求（跟随重定向）
    const doHead = (reqUrl, redirectCount) => {
      if (redirectCount > maxRedirects) {
        probeWithGet(url, 0).then(resolve).catch(reject);
        return;
      }
      const uu = new URL(reqUrl);
      const proto = uu.protocol === 'https:' ? https : http;
      const req = proto.request({
        hostname: uu.hostname,
        port: uu.port || (uu.protocol === 'https:' ? 443 : 80),
        path: uu.pathname + uu.search,
        method: 'HEAD',
        headers: reqHeaders,
        rejectUnauthorized: false
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.destroy();
          doHead(new URL(res.headers.location, reqUrl).href, redirectCount + 1);
          return;
        }
        const total = parseInt(res.headers['content-length'], 10) || 0;
        const acceptRanges = res.headers['accept-ranges'] === 'bytes';
        // HEAD 成功且 content-length > 0 → 直接使用
        if (res.statusCode === 200 && total > 0) {
          res.destroy();
          resolve({ url: reqUrl, total, acceptRanges, filename: getFilenameFromHeaders(res.headers, reqUrl) });
          return;
        }
        // HEAD 失败或 content-length=0/缺失（如 GitHub codeload 动态生成）→ 回退 GET+Range
        res.destroy();
        probeWithGet(url, 0).then(resolve).catch(reject);
      });
      req.on('error', () => {
        // HEAD 出错，回退到 GET+Range
        probeWithGet(url, 0).then(resolve).catch(reject);
      });
      req.end();
    };

    // 阶段2：GET + Range=0-0 探测（跟随重定向）
    const probeWithGet = (reqUrl, redirectCount) => new Promise((res2, rej2) => {
      if (redirectCount > maxRedirects) { rej2(new Error('重定向次数过多')); return; }
      const uu = new URL(reqUrl);
      const proto = uu.protocol === 'https:' ? https : http;
      const r = proto.request({
        hostname: uu.hostname,
        port: uu.port || (uu.protocol === 'https:' ? 443 : 80),
        path: uu.pathname + uu.search,
        method: 'GET',
        headers: { ...reqHeaders, Range: 'bytes=0-0' },
        rejectUnauthorized: false
      }, (resp) => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          resp.destroy();
          probeWithGet(new URL(resp.headers.location, reqUrl).href, redirectCount + 1).then(res2).catch(rej2);
          return;
        }
        // 206 Partial Content → 服务器支持 Range
        if (resp.statusCode === 206) {
          const cr = resp.headers['content-range'];
          let realTotal = 0;
          if (cr) {
            const m = cr.match(/\/(\d+)/);
            if (m) realTotal = parseInt(m[1], 10);
          }
          resp.destroy();
          res2({ url: reqUrl, total: realTotal, acceptRanges: true, filename: getFilenameFromHeaders(resp.headers, reqUrl) });
          return;
        }
        // 200 OK → 服务器可能不支持 Range，但 content-length 可用
        if (resp.statusCode === 200) {
          const total = parseInt(resp.headers['content-length'], 10) || 0;
          const acceptRanges = resp.headers['accept-ranges'] === 'bytes';
          resp.destroy();
          if (total > 0) {
            res2({ url: reqUrl, total, acceptRanges, filename: getFilenameFromHeaders(resp.headers, reqUrl) });
            return;
          }
          // content-length=0/缺失（chunked encoding，如 GitHub codeload）→ 回退 plain GET
          probeWithPlainGet(url, 0).then(res2).catch(rej2);
          return;
        }
        // 其他状态码 → 回退 plain GET
        resp.destroy();
        probeWithPlainGet(url, 0).then(res2).catch(rej2);
      });
      r.on('error', () => {
        // GET+Range 出错，尝试不带 Range
        probeWithPlainGet(url, 0).then(res2).catch(rej2);
      });
      r.end();
    });

    // 阶段3：不带 Range 的 GET 探测（最后手段，用于不支持 Range 的服务器）
    const probeWithPlainGet = (reqUrl, redirectCount) => new Promise((res3, rej3) => {
      if (redirectCount > maxRedirects) { rej3(new Error('重定向次数过多')); return; }
      const uu = new URL(reqUrl);
      const proto = uu.protocol === 'https:' ? https : http;
      const r = proto.request({
        hostname: uu.hostname,
        port: uu.port || (uu.protocol === 'https:' ? 443 : 80),
        path: uu.pathname + uu.search,
        method: 'GET',
        headers: reqHeaders,
        rejectUnauthorized: false
      }, (resp) => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          resp.destroy();
          probeWithPlainGet(new URL(resp.headers.location, reqUrl).href, redirectCount + 1).then(res3).catch(rej3);
          return;
        }
        if (resp.statusCode !== 200) {
          resp.destroy();
          rej3(new Error('HTTP ' + resp.statusCode));
          return;
        }
        const total = parseInt(resp.headers['content-length'], 10) || 0;
        const acceptRanges = resp.headers['accept-ranges'] === 'bytes';
        if (total > 0) {
          resp.destroy();
          res3({ url: reqUrl, total, acceptRanges, filename: getFilenameFromHeaders(resp.headers, reqUrl) });
          return;
        }
        // chunked encoding：读取实际数据计算大小（最多读 2MB 后停止，避免下载整个大文件）
        let totalBytes = 0;
        let settled = false;
        resp.on('data', (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes >= 2 * 1024 * 1024 && !settled) {
            settled = true;
            resp.destroy();
            res3({ url: reqUrl, total: 0, acceptRanges: false, filename: getFilenameFromHeaders(resp.headers, reqUrl) });
          }
        });
        resp.on('end', () => {
          if (!settled) {
            res3({ url: reqUrl, total: totalBytes, acceptRanges: false, filename: getFilenameFromHeaders(resp.headers, reqUrl) });
          }
        });
        resp.on('error', () => {
          if (!settled) {
            res3({ url: reqUrl, total: totalBytes, acceptRanges: false, filename: getFilenameFromHeaders(resp.headers, reqUrl) });
          }
        });
      });
      r.on('error', rej3);
      r.end();
    });

    doHead(url, 0);
  });
}

function getFilenameFromHeaders(headers, url) {
  const cd = headers['content-disposition'];
  if (cd) {
    const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
    if (m && m[1]) {
      try { return decodeURIComponent(m[1]); } catch { return m[1]; }
    }
  }
  return getFileName(url);
}

// 下载单个分块到临时文件
function downloadChunk(url, start, end, destPath, referer, fileId, onProgress) {
  return new Promise((resolve, reject) => {
    const reqHeaders = {
      'User-Agent': UA,
      'Referer': referer || url,
      'Range': `bytes=${start}-${end}`
    };
    const doRequest = (reqUrl, redirectCount) => {
      if (redirectCount > 5) { reject(new Error('重定向次数过多')); return; }
      const uu = new URL(reqUrl);
      const proto = uu.protocol === 'https:' ? https : http;
      const agent = uu.protocol === 'https:' ? httpsAgent : httpAgent;
      const req = proto.get(reqUrl, {
        headers: reqHeaders,
        agent,
        rejectUnauthorized: false
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.destroy();
          doRequest(new URL(res.headers.location, reqUrl).href, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 206 && res.statusCode !== 200) {
          res.destroy();
          reject(new Error(`分块 HTTP ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(destPath);
        let downloaded = 0;
        res.on('data', (chunk) => {
          if (globalDownloadCancelled) {
            res.destroy();
            file.close(() => fs.unlink(destPath, () => {}));
            reject(new Error('已取消'));
            return;
          }
          downloaded += chunk.length;
          if (onProgress) onProgress(downloaded);
        });
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve({ success: true, path: destPath, size: downloaded }); });
        file.on('error', (e) => { fs.unlink(destPath, () => {}); reject(e); });
      });
      req.on('error', reject);
      activeDownloadRequests.set(fileId + '_chunk_' + start, req);
    };
    doRequest(url, 0);
  });
}

// 高速下载：分块并行 + 合并
// 参数：url, savePath, referer, fileId, onProgress(percent, downloaded, total), chunkCount(默认8), onSpeed(bytesPerSec)
async function fastDownload(url, savePath, referer, fileId, onProgress, chunkCount) {
  // 1. 探测文件
  const probe = await probeDownload(url, referer);
  const total = probe.total;

  // 2. 不支持 Range 或文件过小：回退单线程下载
  if (!probe.acceptRanges || !total || total < 1024 * 1024) {
    // 单线程下载（复用现有逻辑，传入探测到的 total 用于进度计算）
    if (onProgress) onProgress(0, 0, total);
    const result = await downloadFileWithProgress(url, savePath, referer, (pct, dl, t) => {
      // t 可能为 NaN（chunked encoding），用探测到的 total 兜底
      const realTotal = t || total;
      const realPct = realTotal > 0 ? Math.min(100, Math.round((dl / realTotal) * 100)) : pct;
      if (onProgress) onProgress(realPct, dl, realTotal);
    }, total);
    return { success: true, path: savePath, size: result.size, mode: 'single', filename: probe.filename };
  }

  // 3. 分块并行下载
  const chunks = Math.min(chunkCount || 8, Math.max(1, Math.ceil(total / (512 * 1024)))); // 每块至少 512KB
  const chunkSize = Math.ceil(total / chunks);
  const tempDir = path.join(path.dirname(savePath), '.ws_chunks_' + (fileId || Date.now().toString(36)));
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  let downloadedTotal = 0;
  let lastTime = Date.now();
  let lastBytes = 0;
  const startTime = Date.now();

  const chunkTasks = [];
  for (let i = 0; i < chunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize - 1, total - 1);
    const chunkPath = path.join(tempDir, 'chunk_' + i + '.part');
    // 跳过已下载的分块（断点续传）
    if (fs.existsSync(chunkPath) && fs.statSync(chunkPath).size === (end - start + 1)) {
      downloadedTotal += (end - start + 1);
      if (onProgress) onProgress(Math.round((downloadedTotal / total) * 100), downloadedTotal, total);
      continue;
    }
    chunkTasks.push((async () => {
      await downloadChunk(url, start, end, chunkPath, referer, fileId, (dl) => {
        // 注意：这里只能拿到当前块已下载，无法精确合并总进度
        // 简化处理：仅用于心跳，不精确计算
      });
      downloadedTotal += (end - start + 1);
      const now = Date.now();
      if (now - lastTime > 500 && onProgress) {
        const speed = (downloadedTotal - lastBytes) / ((now - lastTime) / 1000);
        onProgress(Math.round((downloadedTotal / total) * 100), downloadedTotal, total, speed);
        lastTime = now;
        lastBytes = downloadedTotal;
      }
      if (onProgress) onProgress(Math.round((downloadedTotal / total) * 100), downloadedTotal, total);
    })());
  }

  // 限制并发数（避免过多 socket）
  const concurrency = Math.min(chunks, 8);
  const results = [];
  for (let i = 0; i < chunkTasks.length; i += concurrency) {
    const batch = chunkTasks.slice(i, i + concurrency);
    await Promise.all(batch.map(p => p.catch(e => { throw e; })));
    if (globalDownloadCancelled) {
      throw new Error('已取消');
    }
  }

  if (globalDownloadCancelled) {
    throw new Error('已取消');
  }

  // 4. 合并分块
  const finalFile = fs.createWriteStream(savePath, { highWaterMark: 256 * 1024 });
  for (let i = 0; i < chunks; i++) {
    const chunkPath = path.join(tempDir, 'chunk_' + i + '.part');
    if (!fs.existsSync(chunkPath)) continue;
    const data = fs.readFileSync(chunkPath);
    finalFile.write(data);
  }
  await new Promise((resolve) => finalFile.end(resolve));

  // 5. 清理临时分块
  try {
    for (let i = 0; i < chunks; i++) {
      const chunkPath = path.join(tempDir, 'chunk_' + i + '.part');
      if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
    }
    fs.rmdirSync(tempDir);
  } catch (e) { /* ignore */ }

  const elapsed = (Date.now() - startTime) / 1000;
  const avgSpeed = elapsed > 0 ? Math.round(downloadedTotal / elapsed) : 0;
  if (onProgress) onProgress(100, downloadedTotal, total, avgSpeed);
  return { success: true, path: savePath, size: downloadedTotal, mode: 'parallel', filename: probe.filename, avgSpeed };
}

// 高速下载 IPC handler
ipcMain.handle('fast-download', async (event, { url, savePath, referer, fileId }) => {
  globalDownloadCancelled = false;
  try {
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const result = await fastDownload(url, savePath, referer, fileId || ('fast_' + Date.now()), (percent, downloaded, total, speed) => {
      try {
        event.sender.send('download-progress', {
          fileId: fileId,
          percent: percent,
          downloaded: downloaded,
          total: total,
          speed: speed || 0,
          mode: 'fast'
        });
      } catch (e) { /* sender 可能已销毁 */ }
    }, 8);
    return { success: true, path: result.path, size: result.size, mode: result.mode, filename: result.filename, avgSpeed: result.avgSpeed };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

// 探测下载链接（获取文件大小、是否支持多线程）
ipcMain.handle('probe-download', async (event, { url, referer }) => {
  try {
    const probe = await probeDownload(url, referer);
    return { success: true, total: probe.total, acceptRanges: probe.acceptRanges, filename: probe.filename, url: probe.url };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
});

// ============ 视频预处理（选中时提前转码） ============

// 获取临时目录路径
function getTempDir() {
  const tempDir = path.join(app.getPath('temp'), 'webscout-videos');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

// 预处理视频：将 blob:/m3u8/无扩展名 CDN 流提前下载到临时目录，返回本地文件路径
ipcMain.handle('preprocess-video', async (event, { url, referer, name }) => {
  try {
    const tempDir = getTempDir();
    const safeName = (name || 'video').replace(/[<>:"/\\|?*]/g, '_').substring(0, 80);
    const reqHeaders = { 'User-Agent': UA, 'Referer': referer || url };

    // 1. 处理 blob: URL —— 通过 BrowserView 在页面内 fetch 获取 blob 数据
    if (url.startsWith('blob:')) {
      const bv = browserViews.get(activeTabId);
      if (!bv) return { success: false, error: '无法获取 blob 数据：没有活动标签页' };

      const base64Data = await bv.webContents.executeJavaScript(`
        (async function() {
          try {
            const response = await fetch('${url}');
            const blob = await response.blob();
            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          } catch(e) { return null; }
        })()
      `, true);

      if (!base64Data) return { success: false, error: '无法读取 blob 数据' };

      const base64 = base64Data.split(',')[1];
      const buffer = Buffer.from(base64, 'base64');
      const ext = 'webm';
      const localPath = path.join(tempDir, safeName + '_' + Date.now() + '.' + ext);
      fs.writeFileSync(localPath, buffer);
      return { success: true, localPath, ext, type: 'blob', originalUrl: url };
    }

    // 2. 处理 m3u8 流媒体 —— 下载播放列表并合并 ts 片段
    if (url.includes('.m3u8') || getExt(url) === 'm3u8') {
      const localPath = path.join(tempDir, safeName + '_' + Date.now() + '.ts');
      const result = await downloadM3u8AndMerge(url, localPath, referer, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', { progress, downloaded: 0, total: 0 });
        }
      });
      if (result.success) {
        return { success: true, localPath: result.path, ext: 'ts', type: 'm3u8', originalUrl: url, segmentCount: result.segmentCount };
      }
      return result;
    }

    // 3. 普通 HTTP URL —— 发 HEAD 请求获取 Content-Type，修正扩展名信息
    const contentType = await new Promise((resolve) => {
      const proto = url.startsWith('https') ? https : http;
      proto.request(url, { method: 'HEAD', headers: reqHeaders, rejectUnauthorized: false }, (res) => {
        resolve(res.headers['content-type'] || '');
        res.destroy();
      }).on('error', () => resolve('')).end();
    });

    const ext = getVideoExtFromContentType(contentType, url);
    // 如果有标准扩展名或是视频 CDN，不需要预处理，导出时按原 URL 下载即可
    return { success: true, localPath: null, ext, type: 'http', contentType, originalUrl: url };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 复制本地文件到目标路径（用于导出已预处理的视频）
ipcMain.handle('copy-local-file', async (event, { srcPath, destPath }) => {
  try {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    return { success: true, path: destPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 保存 WSW 文件（支持 HTML 内容或 JSON 数据）
ipcMain.handle('save-wsw', async (event, { filePath, data }) => {
  try {
    // 如果 data 是字符串（HTML 内容），直接保存
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 保存临时 HTML 文件（用于 HT 编辑器预览）
ipcMain.handle('save-temp-html', async (event, htmlContent) => {
  try {
    const path = require('path');
    const os = require('os');
    const fs = require('fs');
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, 'ht-preview-' + Date.now() + '.html');
    fs.writeFileSync(tmpFile, htmlContent, 'utf-8');
    return { success: true, filePath: tmpFile };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 在浏览器中打开文件（处理 .wsw 等非标准扩展名）
ipcMain.handle('open-in-browser', async (event, filePath) => {
  try {
    const { shell } = require('electron');
    const path = require('path');
    const os = require('os');

    // 如果文件不是 .html/.htm，创建临时副本
    const ext = path.extname(filePath).toLowerCase();
    let openPath = filePath;

    if (ext !== '.html' && ext !== '.htm') {
      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, path.basename(filePath, ext) + '.html');
      fs.copyFileSync(filePath, tmpFile);
      openPath = tmpFile;
    }

    await shell.openPath(openPath);
    // 延迟删除临时文件（等浏览器加载完成）
    if (openPath !== filePath && path.basename(openPath).startsWith('ht-preview-')) {
      setTimeout(() => { try { fs.unlinkSync(openPath); } catch(e) {} }, 10000);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 获取资源 base64 数据（用于 WSW 导出）
ipcMain.handle('fetch-resource-base64', async (event, { url, type }) => {
  try {
    const https = require('https');
    const http = require('http');

    return new Promise((resolve) => {
      const client = url.startsWith('https') ? https : http;

      client.get(url, { timeout: 10000 }, (res) => {
        // 处理重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).href;
          const redirClient = redirectUrl.startsWith('https') ? https : http;
          redirClient.get(redirectUrl, { timeout: 10000 }, (res2) => {
            handleResponse(res2, resolve);
          }).on('error', (err) => resolve({ success: false, error: err.message }))
            .on('timeout', () => resolve({ success: false, error: '请求超时' }));
          return;
        }

        handleResponse(res, resolve);
      }).on('error', (err) => {
        resolve({ success: false, error: err.message });
      }).on('timeout', () => {
        resolve({ success: false, error: '请求超时' });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 辅助：处理 HTTP 响应为 base64
function handleResponse(res, resolve) {
  if (res.statusCode !== 200) {
    return resolve({ success: false, error: 'HTTP ' + res.statusCode });
  }
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => {
    try {
      const buffer = Buffer.concat(chunks);
      const base64 = buffer.toString('base64');
      const contentType = res.headers['content-type'] || '';
      let mimeType = 'application/octet-stream';
      if (contentType.includes('image/')) mimeType = contentType;
      else if (contentType.includes('video/')) mimeType = contentType;
      else if (contentType.includes('audio/')) mimeType = contentType;
      resolve({ success: true, data: 'data:' + mimeType + ';base64,' + base64 });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
  res.on('error', (err) => resolve({ success: false, error: err.message }));
}

// 读取 WSW 文件
ipcMain.handle('read-wsw', async (event, filePath) => {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 保存 Excel
ipcMain.handle('save-excel', async (event, { filePath, data }) => {
  try {
    const XLSX = require('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '资源列表');
    XLSX.writeFile(workbook, filePath);
    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 打开外部链接
ipcMain.handle('open-external', async (event, url) => {
  shell.openExternal(url);
  return true;
});

// 获取应用路径
ipcMain.handle('get-app-path', async () => app.getPath('userData'));

// 保存文本文件
ipcMain.handle('save-text-file', async (event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============ PDF 生成 ============
ipcMain.handle('save-text-as-pdf', async (event, { filePath, content }) => {
  try {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50 });
    const writeStream = fs.createWriteStream(filePath);
    
    doc.pipe(writeStream);
    
    // 设置字体（使用内置字体，支持基本字符）
    doc.fontSize(12).text(content, {
      align: 'left',
      lineGap: 4
    });
    
    doc.end();
    
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
    
    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============ DOCX 生成 ============
ipcMain.handle('save-text-as-docx', async (event, { filePath, content }) => {
  try {
    const { Document, Packer, Paragraph, TextRun } = require('docx');
    
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: content,
                size: 24 // 12pt
              })
            ]
          })
        ]
      }]
    });
    
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);

    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============ 新架构 IPC 处理 ============

// 页面导航（app.js 调用）
ipcMain.handle('load-url', (event, { tabId, url }) => {
  const bv = browserViews.get(Number(tabId));
  if (bv && bv.webContents) {
    bv.webContents.loadURL(url);
  }
});

ipcMain.handle('go-back', (event, tabId) => {
  const bv = browserViews.get(Number(tabId));
  if (bv && bv.webContents && bv.webContents.canGoBack()) {
    bv.webContents.goBack();
  }
});

ipcMain.handle('go-forward', (event, tabId) => {
  const bv = browserViews.get(Number(tabId));
  if (bv && bv.webContents && bv.webContents.canGoForward()) {
    bv.webContents.goForward();
  }
});

ipcMain.handle('reload', (event, tabId) => {
  const bv = browserViews.get(Number(tabId));
  if (bv && bv.webContents) {
    bv.webContents.reload();
  }
});

// 提取模式（app.js 调用）
ipcMain.handle('toggle-inspect', (event, { tabId, enabled }) => {
  inspectModeState = !!enabled;
  // 通知所有 BrowserView 的 preload（与右键菜单行为一致，切换标签时也能保持状态）
  for (const bv of browserViews.values()) {
    if (bv && !bv.webContents.isDestroyed()) {
      bv.webContents.send('toggle-inspect', inspectModeState);
    }
  }
  // 通知渲染进程更新 UI（按钮高亮等）
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('inspect-mode-changed', inspectModeState);
  }
  return true;
});

// 更新 BrowserView 布局
ipcMain.handle('update-browser-view-bounds', () => {
  updateBrowserViewBounds();
});

// 导出功能
ipcMain.handle('export-to-folder', async (event, { resources, tabId }) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: '选择导出文件夹'
    });

    if (result.canceled || !result.filePaths[0]) {
      return { success: false, error: '用户取消' };
    }

    const destDir = result.filePaths[0];

    for (const resource of resources) {
      if (resource.url) {
        const fileName = path.basename(resource.url) || `resource_${Date.now()}`;
        const savePath = path.join(destDir, fileName);

        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(savePath);
          const request = resource.url.startsWith('https')
            ? https.get(resource.url, (response) => {
                response.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
              })
            : http.get(resource.url, (response) => {
                response.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
              });
          request.on('error', reject);
        });
      }
    }

    return { success: true, path: destDir };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('export-to-wsw', async (event, { resources, tabId }) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存 WSW 文件',
      defaultPath: 'web-scout-presentation.wsw',
      filters: [{ name: 'WSW 文件', extensions: ['wsw'] }]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: '用户取消' };
    }

    const wswContent = JSON.stringify({
      version: '1.0',
      title: 'WebScout 演示',
      resources: resources,
      createdAt: new Date().toISOString()
    }, null, 2);

    fs.writeFileSync(result.filePath, wswContent, 'utf-8');
    shell.openPath(result.filePath);

    return { success: true, path: result.filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('export-to-excel', async (event, { resources, tabId }) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存 Excel 文件',
      defaultPath: 'web-scout-resources.xlsx',
      filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: '用户取消' };
    }

    return { success: true, path: result.filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
