const { app, BrowserWindow, BrowserView, ipcMain, dialog, shell, session, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { URL } = require('url');

// 连接池：复用 TCP 连接，支持并行下载
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 6 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 6, rejectUnauthorized: false });

// 可重试的网络错误码
const RETRYABLE_ERRORS = ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'EHOSTUNREACH'];

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

// 多 BrowserView 管理
const browserViews = new Map(); // tabId -> BrowserView
let activeTabId = null;
let tabIdCounter = 0;

// 抓取模式状态（主进程维护，供右键菜单显示和切换）
let inspectModeState = false;

// 侧边栏显示状态（由渲染进程同步，影响 BrowserView 宽度计算）
let sidebarVisibleFromRenderer = true;

// 侧边栏宽度
const SIDEBAR_WIDTH = 360;
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
    x: 0,
    y: VIEW_OFFSET_Y,
    width: contentBounds.width - sidebarOffset,
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
      sandbox: false
    },
    icon: path.join(__dirname, '../../assets/icon.png')
  });

  // 主窗口加载 app UI
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

  // ============ 右键菜单 ============
  setupContextMenu();

  // ============ 媒体请求拦截 ============
  setupMediaInterception();
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
              mainWindow.webContents.send('inspect-mode-changed-from-main', inspectModeState);
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
  bv.setBounds({
    x: 0,
    y: VIEW_OFFSET_Y,
    width: contentBounds.width - SIDEBAR_WIDTH - 8,
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

  // ============ BrowserView 事件转发（带上 tabId） ============

  // BrowserView → 渲染器 IPC 转发（带上 tabId，使用正确的数据格式）
  // resources-extracted: preload 发送 (resources)，需要包装为 { tabId, resources }
  ipcMain.on('resources-extracted', (event, resources) => {
    if (bv && event.sender === bv.webContents) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('resources-extracted', { tabId, resources });
      }
    }
  });

  // page-title: preload 发送 (title)，需要包装为 { tabId, title }
  ipcMain.on('page-title', (event, title) => {
    if (bv && event.sender === bv.webContents) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('page-title', { tabId, title });
      }
    }
  });

  // inspect-mode-changed: preload 发送 (enabled)，需要包装为 { tabId, enabled }
  ipcMain.on('inspect-mode-changed', (event, enabled) => {
    if (bv && event.sender === bv.webContents) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('inspect-mode-changed', { tabId, enabled });
      }
    }
  });

  // element-resources: preload 发送 (data)，需要包装为 { tabId, ...data }
  ipcMain.on('element-resources', (event, data) => {
    if (bv && event.sender === bv.webContents) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('element-resources', { tabId, ...data });
      }
    }
  });

  // element-hover-preview: preload 发送 (data)，需要包装为 { tabId, ...data }
  ipcMain.on('element-hover-preview', (event, data) => {
    if (bv && event.sender === bv.webContents) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('element-hover-preview', { tabId, ...data });
      }
    }
  });

  // element-hover-clear: preload 发送，需要包装为 { tabId }
  ipcMain.on('element-hover-clear', (event) => {
    if (bv && event.sender === bv.webContents) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('element-hover-clear', { tabId });
      }
    }
  });

  // media-batch: preload 发送 (mediaArray)，需要包装为 { tabId, mediaArray }
  ipcMain.on('media-batch', (event, mediaArray) => {
    if (bv && event.sender === bv.webContents) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('media-batch', { tabId, mediaArray });
      }
    }
  });

  // page-url-changed: preload 发送 (url)，需要包装为 { tabId, url }
  ipcMain.on('page-url-changed', (event, url) => {
    if (bv && event.sender === bv.webContents) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('page-url-changed', { tabId, url });
      }
    }
  });

  // 非抓取模式下超链接点击：转发给渲染进程以便新建标签页
  ipcMain.on('link-clicked', (event, url) => {
    if (bv && event.sender === bv.webContents) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('link-clicked', { tabId, url });
      }
    }
  });

  // B站视频下载进度反馈：从 webview 转发到渲染进程
  ipcMain.on('bilibili-download-progress-from-webview', (event, data) => {
    if (bv && event.sender === bv.webContents) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bilibili-download-progress', data);
      }
    }
  });

  // 页面加载完成
  bv.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser-did-finish-load', { tabId });
    }
    // 同步当前抓取模式状态到新加载的页面（新标签页默认为关闭状态）
    if (inspectModeState && !bv.webContents.isDestroyed()) {
      bv.webContents.send('toggle-inspect', true);
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
    // 其他情况在当前 BrowserView 中打开
    bv.webContents.loadURL(url);
    return { action: 'deny' };
  });

  // 加载 URL
  if (url) {
    bv.webContents.loadURL(url);
  }

  return tabId;
}

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

// 隐藏/显示 BrowserView（用于对话框弹出时）
ipcMain.handle('set-browserview-visible', (event, visible) => {
  const bv = browserViews.get(activeTabId);
  if (bv) {
    if (visible) {
      mainWindow.setBrowserView(bv);
      updateBrowserViewBounds();
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
  return { tabId, url: url || DEFAULT_HOME_URL };
});

// 切换到指定标签
ipcMain.handle('switch-tab', (event, tabId) => {
  switchBrowserView(tabId);
  return true;
});

// 关闭指定标签
ipcMain.handle('close-tab', (event, tabId) => {
  destroyBrowserView(tabId);
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
  return result.filePaths[0] || null;
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

// 获取下载路径
ipcMain.handle('get-downloads-path', async () => app.getPath('downloads'));

// 下载文件（带 Referer 和 User-Agent，支持 fileId 进度标识）
ipcMain.handle('download-file', async (event, { url, savePath, referer, fileId }) => {
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
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 500;

    return new Promise((resolve) => {
      const doRequest = async (reqUrl, redirectCount, retryCount = 0) => {
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
        });

        try {
          speedTracker.start();
          const response = await request();
          const total = parseInt(response.headers['content-length'], 10);
          let downloaded = 0;

          response.on('data', (chunk) => {
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
            file.close();
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
        } catch (err) {
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
            });

            speedTracker.start();
            const response = await request();
            const contentType = response.headers['content-type'] || headContentType;
            const ext = getVideoExtFromContentType(contentType, reqUrl);
            const finalPath = fixFileExtension(savePath, ext);
            const file = fs.createWriteStream(finalPath, { highWaterMark: 64 * 1024 });

            let downloaded = 0;
            response.on('data', (chunk) => {
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
          const partBuffers = new Array(ranges.length);

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
                response.on('end', () => resolvePart(Buffer.concat(chunks)));
                response.on('error', rejectPart);
              });
              partReq.on('error', rejectPart);
              partReq.end();
            });
          };

          await Promise.all(ranges.map(downloadPart));

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
          const resp = await fetch(apiUrl, { headers: { 'Referer': 'https://www.bilibili.com/video/${bvid}' } });
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
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              partDownloaded += value.length;
              totalDownloaded += value.length;

              // 实时回传进度（每2%或每500KB报告一次）
              const progress = Math.round((totalDownloaded / contentLength) * 100);
              window.postMessage({
                type: 'bilibili-download-progress',
                fileId: ${fileId || 'null'},
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
            const resp = await fetch(apiUrl, { headers: { 'Referer': '${videoReferer}' } });
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

        proto.get({
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
            proto2.get({
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
              resolveSize(size);
            });
            return;
          }
          const size = parseInt(res.headers['content-length'], 10) || 0;
          res.destroy();
          resolveSize(size);
        }).on('error', () => resolveSize(0));
      });
    };

    // 下载指定范围的块
    const downloadPart = (start, end, partIndex) => {
      return new Promise((resolvePart, rejectPart) => {
        const uu = new URL(videoUrl);
        const proto = uu.protocol === 'https:' ? https : http;
        const agent = uu.protocol === 'https:' ? httpsAgent : httpAgent;

        proto.get({
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
            proto2.get({
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
              res2.on('data', (chunk) => chunks.push(chunk));
              res2.on('end', () => resolvePart(Buffer.concat(chunks)));
              res2.on('error', rejectPart);
            });
            return;
          }

          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolvePart(Buffer.concat(chunks)));
          res.on('error', rejectPart);
        }).on('error', rejectPart);
      });
    };

    // 主下载流程
    (async () => {
      try {
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
        resolve({ success: false, error: err.message });
      }
    })();
  });
}

// 通用文件下载（带进度回调）
function downloadFileWithProgress(url, savePath, referer, onProgress) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const u = new URL(url);
    const reqHeaders = { 'User-Agent': UA, 'Referer': referer || url, 'Accept': '*/*', 'Origin': 'https://www.bilibili.com' };
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
        const total = parseInt(res.headers['content-length'], 10);
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

// 保存 WSW 文件
ipcMain.handle('save-wsw', async (event, { filePath, data }) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

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
