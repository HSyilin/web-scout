const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),

  // 标签管理
  createTab: (url) => ipcRenderer.invoke('create-tab', url),
  switchTab: (tabId) => ipcRenderer.invoke('switch-tab', tabId),
  closeTab: (tabId) => ipcRenderer.invoke('close-tab', tabId),

  // 页面导航（app.js 调用）
  loadUrl: (tabId, url) => ipcRenderer.invoke('load-url', { tabId, url }),
  goBack: (tabId) => ipcRenderer.invoke('go-back', tabId),
  goForward: (tabId) => ipcRenderer.invoke('go-forward', tabId),
  reload: (tabId) => ipcRenderer.invoke('reload', tabId),

  // 提取模式
  toggleInspect: (tabId, enabled) => ipcRenderer.invoke('toggle-inspect', { tabId, enabled }),

  // BrowserView 显示/隐藏（模块切换用）
  setBrowserviewVisible: (visible) => ipcRenderer.invoke('set-browserview-visible', visible),
  updateBrowserViewBounds: () => ipcRenderer.invoke('update-browser-view-bounds'),

  // 侧边栏
  setSidebarVisible: (visible) => ipcRenderer.invoke('set-sidebar-visible', visible),

  // 左侧导航栏宽度同步
  setLeftNavWidth: (width) => ipcRenderer.invoke('set-left-nav-width', width),

  // 渲染进程就绪信号
  rendererReady: () => ipcRenderer.invoke('renderer-ready'),

  // 文件操作
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectSaveFile: (options) => ipcRenderer.invoke('select-save-file', options),
  selectOpenFile: (options) => ipcRenderer.invoke('select-open-file', options),
  getDownloadsPath: () => ipcRenderer.invoke('get-downloads-path'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  openInExplorer: (targetPath) => ipcRenderer.invoke('open-in-explorer', targetPath),

  // 应用默认导出目录（全局通用）
  getDefaultExportDir: () => ipcRenderer.invoke('get-default-export-dir'),
  setDefaultExportDir: (dir) => ipcRenderer.invoke('set-default-export-dir', dir),

  // 模板/配置导出目录（全局通用，用于保存任务配置文件和模板）
  getTemplateExportDir: () => ipcRenderer.invoke('get-template-export-dir'),
  setTemplateExportDir: (dir) => ipcRenderer.invoke('set-template-export-dir', dir),

  // 导出任务配置文件（抓取清单，用于快捷导入）
  exportTaskConfig: (task, dir) => ipcRenderer.invoke('export-task-config', { task, dir }),

  // 阶段 C1: 模板管理（内置 + 用户模板 CRUD）
  listTemplates: () => ipcRenderer.invoke('list-templates'),
  importTaskTemplate: (source, category, file) => ipcRenderer.invoke('import-task-template', { source, category, file }),
  saveUserTemplate: (name, category, taskConfig) => ipcRenderer.invoke('save-user-template', { name, category, taskConfig }),
  deleteUserTemplate: (category, file) => ipcRenderer.invoke('delete-user-template', { category, file }),

  // 解析电子表格文件（HT 编辑器统计图导入数据：CSV/JSON/XLSX）
  parseSpreadsheet: (filePath) => ipcRenderer.invoke('parse-spreadsheet', filePath),

  // 下载
  downloadFile: (url, savePath, referer, fileId) => ipcRenderer.invoke('download-file', { url, savePath, referer, fileId }),
  fastDownload: (url, savePath, referer, fileId) => ipcRenderer.invoke('fast-download', { url, savePath, referer, fileId }),
  probeDownload: (url, referer) => ipcRenderer.invoke('probe-download', { url, referer }),
  downloadVideoSmart: (url, savePath, referer, fileId) => ipcRenderer.invoke('download-video-smart', { url, savePath, referer, fileId }),
  downloadBilibiliVideo: (url, savePath, referer, fileId) => ipcRenderer.invoke('download-bilibili-video', { url, savePath, referer, fileId }),
  cancelDownload: () => ipcRenderer.invoke('cancel-download'),
  resetDownloadCancel: () => ipcRenderer.invoke('reset-download-cancel'),
  preprocessVideo: (url, referer, name) => ipcRenderer.invoke('preprocess-video', { url, referer, name }),
  copyLocalFile: (srcPath, destPath) => ipcRenderer.invoke('copy-local-file', { srcPath, destPath }),
  saveTextFile: (filePath, content) => ipcRenderer.invoke('save-text-file', { filePath, content }),
  saveTextAsPdf: (filePath, content) => ipcRenderer.invoke('save-text-as-pdf', { filePath, content }),
  saveTextAsDocx: (filePath, content) => ipcRenderer.invoke('save-text-as-docx', { filePath, content }),

  // 导出
  exportToFolder: (resources, tabId) => ipcRenderer.invoke('export-to-folder', { resources, tabId }),
  exportToWSW: (resources, tabId) => ipcRenderer.invoke('export-to-wsw', { resources, tabId }),
  exportToExcel: (resources, tabId) => ipcRenderer.invoke('export-to-excel', { resources, tabId }),

  // WSW
  saveWSW: (filePath, data) => ipcRenderer.invoke('save-wsw', { filePath, data }),
  readWSW: (filePath) => ipcRenderer.invoke('read-wsw', filePath),
  fetchResourceBase64: (url, type) => ipcRenderer.invoke('fetch-resource-base64', { url, type }),
  openInBrowser: (filePath) => ipcRenderer.invoke('open-in-browser', filePath),

  // Excel
  saveExcel: (filePath, data) => ipcRenderer.invoke('save-excel', { filePath, data }),

  // 外部链接
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // 仪表盘
  getDashboardStats: () => ipcRenderer.invoke('get-dashboard-stats'),

  // 工作流
  saveWorkflow: (workflow) => ipcRenderer.invoke('save-workflow', workflow),
  getWorkflows: () => ipcRenderer.invoke('get-workflows'),
  getWorkflowDetail: (workflowId) => ipcRenderer.invoke('get-workflow-detail', workflowId),
  deleteWorkflow: (workflowId) => ipcRenderer.invoke('delete-workflow', workflowId),
  exportWorkflow: (workflow) => ipcRenderer.invoke('export-workflow', workflow),
  saveWorkflows: (workflows) => ipcRenderer.invoke('save-workflows', workflows),
  getActiveTabVideos: () => ipcRenderer.invoke('get-active-tab-videos'),
  // 回收站
  getTrashWorkflows: () => ipcRenderer.invoke('get-trash-workflows'),
  restoreWorkflow: (workflowId) => ipcRenderer.invoke('restore-workflow', workflowId),
  emptyTrash: () => ipcRenderer.invoke('empty-trash'),
  permanentDeleteWorkflow: (workflowId) => ipcRenderer.invoke('permanent-delete-workflow', workflowId),

  // AI 工作流
  aiworkflowAPI: {
    save: (task) => ipcRenderer.invoke('save-aiworkflow', task),
    getAll: () => ipcRenderer.invoke('get-aiworkflows'),
    getDetail: (id) => ipcRenderer.invoke('get-aiworkflow-detail', id),
    delete: (id) => ipcRenderer.invoke('delete-aiworkflow', id),
    update: (id, updates) => ipcRenderer.invoke('update-aiworkflow', { id, updates }),
    runTask: (id) => ipcRenderer.invoke('run-aiworkflow-task', id),
    chainRunTask: (id) => ipcRenderer.invoke('chain-run-aiworkflow-task', id),
    listSourceTasks: (excludeTaskId) => ipcRenderer.invoke('list-source-tasks', excludeTaskId),
    exportResults: (taskId, batchId, format) => ipcRenderer.invoke('export-aiworkflow-results', { taskId, batchId, format }),
    testSelector: (url, selector, scroll) => ipcRenderer.invoke('test-selector', { url, selector, scroll }),
    abortTestSelector: () => ipcRenderer.send('test-selector-abort'),
    onTestSelectorProgress: (cb) => ipcRenderer.on('test-selector-progress', (e, data) => cb(data)),
    // 末端抓取模板：用样本 URL 测试字段提取规则
    testTemplateFields: (url, fields) => ipcRenderer.invoke('test-template-fields', { url, fields }),
    startTracking: (id) => ipcRenderer.invoke('start-tracking', id),
    pauseTracking: (id) => ipcRenderer.invoke('pause-tracking', id),
    resumeTracking: (id) => ipcRenderer.invoke('resume-tracking', id),
    onTrackingUpdate: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('tracking-update', handler);
      return () => ipcRenderer.removeListener('tracking-update', handler);
    },
    // Task 16.4: 任务删除通知（HT 编辑器容器联动）
    onTaskDeleted: (callback) => {
      const handler = (event, taskId) => callback(taskId);
      ipcRenderer.on('aiworkflow-task-deleted', handler);
      return () => ipcRenderer.removeListener('aiworkflow-task-deleted', handler);
    },
    // Task 21: AI 辅助功能
    aiGenerateSelector: (url, description) => ipcRenderer.invoke('ai-generate-selector', { url, description }),
    aiInferFields: (url, description) => ipcRenderer.invoke('ai-infer-fields', { url, description }),
    aiClassifyResults: (taskId, batchId) => ipcRenderer.invoke('ai-classify-results', { taskId, batchId }),
    aiSummarizeResults: (taskId, batchId) => ipcRenderer.invoke('ai-summarize-results', { taskId, batchId }),
  },

  // Task 20: AI 模型配置
  aiConfigAPI: {
    save: (cfg) => ipcRenderer.invoke('save-ai-config', cfg),
    get: () => ipcRenderer.invoke('get-ai-config'),
    test: (cfg) => ipcRenderer.invoke('test-ai-config', cfg),
  },

  // 拾取模式（在 BrowserView 内拾取元素生成 CSS 选择器）
  pickerAPI: {
    enterPickerMode: () => ipcRenderer.invoke('enter-picker-mode'),
    exitPickerMode: () => ipcRenderer.invoke('exit-picker-mode'),
    onPickerResult: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('picker-result', handler);
      return () => ipcRenderer.removeListener('picker-result', handler);
    },
  },

  // Task 18.5: MCP 服务端 API
  mcpAPI: {
    toggle: (enabled, readonly) => ipcRenderer.invoke('mcp-toggle', { enabled, readonly }),
    getStatus: () => ipcRenderer.invoke('mcp-status'),
    setReadonly: (readonly) => ipcRenderer.invoke('mcp-set-readonly', readonly),
    getLogs: () => ipcRenderer.invoke('mcp-get-logs')
  },

  // MCP 自启动配置（持久化在 settings.json）
  getMcpAutostart: () => ipcRenderer.invoke('mcp-get-autostart'),
  setMcpAutostart: (enabled) => ipcRenderer.invoke('mcp-set-autostart', enabled),

  // ============ 事件回调 ============

  // 下载进度
  onDownloadProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('download-progress', handler);
    return () => ipcRenderer.removeListener('download-progress', handler);
  },

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

  // 非抓取模式下超链接点击
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

  // 页面标题更新
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

  // 元素资源
  onElementResources: (callback) => {
    ipcRenderer.on('element-resources', (event, data) => {
      callback(data);
    });
  },

  // 元素悬停预览
  onElementHoverPreview: (callback) => {
    ipcRenderer.on('element-hover-preview', (event, data) => {
      callback(data);
    });
  },

  // 元素悬停清除
  onElementHoverClear: (callback) => {
    ipcRenderer.on('element-hover-clear', () => {
      callback();
    });
  },

  // 媒体批量
  onMediaBatch: (callback) => {
    ipcRenderer.on('media-batch', (event, data) => {
      const mediaArray = data && Array.isArray(data) ? data : (data && data.mediaArray ? data.mediaArray : []);
      const tabId = data && data.tabId !== undefined ? data.tabId : null;
      callback(mediaArray, tabId);
    });
  },

  // BrowserView 视频下载进度
  onBilibiliDownloadProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('bilibili-download-progress', handler);
    return () => ipcRenderer.removeListener('bilibili-download-progress', handler);
  }
});
