const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),

  // BrowserView 控制
  browserNavigate: (url) => ipcRenderer.invoke('browser-navigate', url),
  browserToggleInspect: (enabled) => ipcRenderer.invoke('browser-toggle-inspect', enabled),
  browserExtractAll: () => ipcRenderer.invoke('browser-extract-all'),
  browserGetTitle: () => ipcRenderer.invoke('browser-get-title'),
  browserGoBack: () => ipcRenderer.invoke('browser-go-back'),
  browserGoForward: () => ipcRenderer.invoke('browser-go-forward'),
  browserReload: () => ipcRenderer.invoke('browser-reload'),
  updateBrowserBounds: () => ipcRenderer.invoke('browser-update-bounds'),
  setSidebarVisible: (visible) => ipcRenderer.invoke('set-sidebar-visible', visible),
  setBrowserviewVisible: (visible) => ipcRenderer.invoke('set-browserview-visible', visible),

  // 渲染进程就绪信号
  rendererReady: () => ipcRenderer.invoke('renderer-ready'),

  // 标签管理
  createTab: (url) => ipcRenderer.invoke('create-tab', url),
  switchTab: (tabId) => ipcRenderer.invoke('switch-tab', tabId),
  closeTab: (tabId) => ipcRenderer.invoke('close-tab', tabId),

  // 文件操作
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectSaveFile: (options) => ipcRenderer.invoke('select-save-file', options),
  getDownloadsPath: () => ipcRenderer.invoke('get-downloads-path'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),

  // 下载
  downloadFile: (url, savePath, referer, fileId) => ipcRenderer.invoke('download-file', { url, savePath, referer, fileId }),
  downloadVideoSmart: (url, savePath, referer, fileId) => ipcRenderer.invoke('download-video-smart', { url, savePath, referer, fileId }),
  downloadBilibiliVideo: (url, savePath, referer, fileId) => ipcRenderer.invoke('download-bilibili-video', { url, savePath, referer, fileId }),
  preprocessVideo: (url, referer, name) => ipcRenderer.invoke('preprocess-video', { url, referer, name }),
  copyLocalFile: (srcPath, destPath) => ipcRenderer.invoke('copy-local-file', { srcPath, destPath }),
  saveTextFile: (filePath, content) => ipcRenderer.invoke('save-text-file', { filePath, content }),
  saveTextAsPdf: (filePath, content) => ipcRenderer.invoke('save-text-as-pdf', { filePath, content }),
  saveTextAsDocx: (filePath, content) => ipcRenderer.invoke('save-text-as-docx', { filePath, content }),
  onDownloadProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('download-progress', handler);
    return () => ipcRenderer.removeListener('download-progress', handler);
  },

  // WSW
  saveWSW: (filePath, data) => ipcRenderer.invoke('save-wsw', { filePath, data }),
  readWSW: (filePath) => ipcRenderer.invoke('read-wsw', filePath),

  // Excel
  saveExcel: (filePath, data) => ipcRenderer.invoke('save-excel', { filePath, data }),

  // 外部链接
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // 媒体请求拦截（来自主进程 session 拦截）
  onMediaRequestIntercepted: (callback) => {
    ipcRenderer.on('media-request-intercepted', (event, data) => callback(data));
  },

  // 新URL在webview中打开
  onOpenUrlInWebview: (callback) => {
    ipcRenderer.on('open-url-in-webview', (event, url) => callback(url));
  },

  // 标签创建通知
  onTabCreated: (callback) => {
    ipcRenderer.on('tab-created', (event, data) => callback(data));
  },

  // 非抓取模式下超链接点击（用于新建标签页导航）
  onLinkClicked: (callback) => {
    ipcRenderer.on('link-clicked', (event, data) => {
      const url = data && data.url ? data.url : data;
      const tabId = data && data.tabId ? data.tabId : null;
      callback(url, tabId);
    });
  },

  // 右键菜单切换抓取模式后，主进程通知渲染进程更新 UI
  onInspectModeChangedFromMain: (callback) => {
    ipcRenderer.on('inspect-mode-changed-from-main', (event, enabled) => callback(enabled));
  },

  // ============ 事件回调（带 tabId） ============

  // BrowserView 页面加载完成
  onBrowserDidFinishLoad: (callback) => {
    ipcRenderer.on('browser-did-finish-load', (event, data) => {
      const tabId = data && data.tabId ? data.tabId : null;
      callback(tabId);
    });
  },

  // BrowserView 页面加载失败
  onBrowserDidFailLoad: (callback) => {
    ipcRenderer.on('browser-did-fail-load', (event, data) => {
      const { tabId, ...detail } = data || {};
      callback(detail, tabId);
    });
  },

  // BrowserView 导航
  onBrowserDidNavigate: (callback) => {
    ipcRenderer.on('browser-did-navigate', (event, data) => {
      const url = data && data.url ? data.url : data;
      const tabId = data && data.tabId ? data.tabId : null;
      callback(url, tabId);
    });
  },

  // BrowserView 页内导航
  onBrowserDidNavigateInPage: (callback) => {
    ipcRenderer.on('browser-did-navigate-in-page', (event, data) => {
      const url = data && data.url ? data.url : data;
      const tabId = data && data.tabId ? data.tabId : null;
      callback(url, tabId);
    });
  },

  // 资源提取结果
  onResourcesExtracted: (callback) => {
    ipcRenderer.on('resources-extracted', (event, data) => {
      const resources = data && data.resources ? data.resources : data;
      const tabId = data && data.tabId ? data.tabId : null;
      callback(resources, tabId);
    });
  },

  // 页面标题
  onPageTitle: (callback) => {
    ipcRenderer.on('page-title', (event, data) => {
      const title = data && data.title ? data.title : data;
      const tabId = data && data.tabId ? data.tabId : null;
      callback(title, tabId);
    });
  },

  // 页面标题更新（来自 page-title-updated）
  onBrowserPageTitleUpdated: (callback) => {
    ipcRenderer.on('browser-page-title-updated', (event, data) => {
      const title = data && data.title ? data.title : data;
      const tabId = data && data.tabId ? data.tabId : null;
      callback(title, tabId);
    });
  },

  // 提取模式状态变化
  onInspectModeChanged: (callback) => {
    ipcRenderer.on('inspect-mode-changed', (event, data) => {
      const enabled = data && data.enabled !== undefined ? data.enabled : data;
      callback(enabled);
    });
  },

  // 元素资源（完整数据：包含 element + resources）
  onElementResources: (callback) => {
    ipcRenderer.on('element-resources', (event, data) => {
      callback(data);
    });
  },

  // 元素悬停预览（hover 时发送 element info + resource counts，不发送完整资源）
  onElementHoverPreview: (callback) => {
    ipcRenderer.on('element-hover-preview', (event, data) => {
      callback(data);
    });
  },

  // 元素悬停清除（mouseout 时清除预览面板）
  onElementHoverClear: (callback) => {
    ipcRenderer.on('element-hover-clear', () => {
      callback();
    });
  },

  // 媒体批量
  onMediaBatch: (callback) => {
    ipcRenderer.on('media-batch', (event, data) => {
      const mediaArray = data && Array.isArray(data) ? data : (data && data.mediaArray ? data.mediaArray : []);
      callback(mediaArray);
    });
  },

  // BrowserView 视频下载进度（来自主进程转发）
  onBilibiliDownloadProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('bilibili-download-progress', handler);
    return () => ipcRenderer.removeListener('bilibili-download-progress', handler);
  }
});
