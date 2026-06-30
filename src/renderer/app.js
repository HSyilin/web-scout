// ============ WebScout - 智能资源提取器（三层资源面板 + 多标签页） ============

// 全局状态
let currentData = null;  // 当前活动标签的资源数据（引用）
let selected = new Set(); // 当前活动标签的选中资源（引用）
let lang = 'zh';
let inspectMode = false;
let sidebarVisible = true;
let currentUrl = '';
let showResourceLayer = false; // 显示资源层设置（默认隐藏）
let currentTheme = 'dark'; // 当前主题：'dark' 或 'light'

// 标签页状态（每个标签有独立的 BrowserView 和数据）
let tabs = [];          // { id: number (主进程tabId), url, title, currentData, selected, selectedResources, pageHistory, historyIndex }
let activeTabId = null; // 当前活动标签的主进程 tabId

// 当前活动标签的已选资源（引用，与 tab.selectedResources 同步）
// 结构: { images: [], videos: [], audios: [], links: [], texts: [] }
let selectedResources = createEmptySelectedResources();

function createEmptySelectedResources() {
  return { images: [], videos: [], audios: [], links: [], texts: [] };
}

function getSelectedTotal() {
  if (!selectedResources) return 0;
  return selectedResources.images.length + selectedResources.videos.length +
         selectedResources.audios.length + selectedResources.links.length +
         selectedResources.texts.length;
}

// 全局浏览历史（所有标签共享，用于地址栏监听）
let globalHistory = []; // 存储用户访问过的所有URL
let historyIndex = -1;  // 当前在历史中的位置

// DOM 元素
const urlInput = document.getElementById('urlInput');
const fetchBtn = document.getElementById('fetchBtn');
const inspectToggle = document.getElementById('inspectToggle');
const emptyState = document.getElementById('emptyState');
const loadingOverlay = document.getElementById('loadingOverlay');
const statusText = document.getElementById('statusText');
const selectedCount = document.getElementById('selectedCount');
const pageTitle = document.getElementById('pageTitle');
const toast = document.getElementById('toast');
const rightPanel = document.getElementById('rightPanel');
const sidebarToggle = document.getElementById('sidebarToggle');
const tabBar = document.getElementById('tabBar');

// 进度条 DOM
const progressBarContainer = document.getElementById('progressBarContainer');
const progressBarFill = document.getElementById('progressBarFill');
const progressPercent = document.getElementById('progressPercent');
const progressDetail = document.getElementById('progressDetail');
const progressTitle = document.getElementById('progressTitle');
const progressStatus = document.getElementById('progressStatus');

// 资源面板 DOM（标签页布局）
const layerPanels = document.getElementById('layerPanels');
const resourceTabs = document.getElementById('resourceTabs');
// 固定信息区
const infoPageTitle = document.getElementById('infoPageTitle');
const infoSelectedElement = document.getElementById('infoSelectedElement');
const infoSelectedElementRow = document.getElementById('infoSelectedElementRow');
// 主标签页计数
const tabCountResources = document.getElementById('tabCountResources');
const tabCountSelected = document.getElementById('tabCountSelected');
const tabCountTexts = document.getElementById('tabCountTexts');
// 子标签页计数 - 资源
const subImageCount = document.getElementById('subImageCount');
const subVideoCount = document.getElementById('subVideoCount');
const subAudioCount = document.getElementById('subAudioCount');
const subLinkCount = document.getElementById('subLinkCount');
// 子标签页计数 - 已选
const subSelectedImageCount = document.getElementById('subSelectedImageCount');
const subSelectedVideoCount = document.getElementById('subSelectedVideoCount');
const subSelectedAudioCount = document.getElementById('subSelectedAudioCount');
const subSelectedLinkCount = document.getElementById('subSelectedLinkCount');
const subSelectedTextCount = document.getElementById('subSelectedTextCount');
// 资源列表 - 资源标签页
const imageList = document.getElementById('imageList');
const videoList = document.getElementById('videoList');
const audioList = document.getElementById('audioList');
const linkList = document.getElementById('linkList');
const textList = document.getElementById('textList');
// 资源列表 - 已选标签页
const selectedImageList = document.getElementById('selectedImageList');
const selectedVideoList = document.getElementById('selectedVideoList');
const selectedAudioList = document.getElementById('selectedAudioList');
const selectedLinkList = document.getElementById('selectedLinkList');
const selectedTextList = document.getElementById('selectedTextList');

// ============ 辅助：获取当前活动标签 ============
function getActiveTab() {
  return tabs.find(t => t.id === activeTabId) || null;
}

// 更新页面标题（同时同步固定信息区）
function setPageTitle(text) {
  pageTitle.textContent = text || '--';
  if (infoPageTitle) infoPageTitle.textContent = pageTitle.textContent || currentUrl || '--';
}

// ============ 国际化 ============
const i18n = {
  zh: {
    ready: '就绪', loading: '正在加载页面...', extracting: '正在提取资源...',
    done: '提取完成', error: '提取失败', noResources: '未找到资源',
    images: '图片', videos: '视频', audios: '音频', links: '链接',
    documents: '文档', texts: '文本', total: '总共', selected: '已选', items: '个资源',
    exportFolder: ' 导出到文件夹', exportWSW: '📦 导出为 .wsw 文件',
    exportExcel: '📊 导出为 Excel', downloadSelected: '⬇️ 下载选中资源',
    fetchPlaceholder: '输入网址 (如 bilibili.com) 提取资源...',
    fetchBtn: '提取资源', inspectMode: '提取模式',
    emptyText: '输入网址开始提取资源',
    emptyHint: '支持任意网站：B站、抖音、知乎、微博...',
    pageInfo: '📋 资源提取', pageTitle: '📄 页面标题',
    exportActions: '📤 导出操作', copied: '已复制到剪贴板', downloadStarted: '开始下载',
    resourceLayer: '🖼 资源层', linkLayer: '🔗 超链接层', textLayer: '📝 文本层',
    selectedElement: '🎯 选中元素', chars: '字符', newTab: '新建标签页'
  },
  en: {
    ready: 'Ready', loading: 'Loading page...', extracting: 'Extracting resources...',
    done: 'Extraction complete', error: 'Extraction failed', noResources: 'No resources found',
    images: 'Images', videos: 'Videos', audios: 'Audio', links: 'Links',
    documents: 'Documents', texts: 'Text', total: 'Total', selected: 'Selected', items: 'items',
    exportFolder: '📁 Export to folder', exportWSW: '📦 Export as .wsw',
    exportExcel: ' Export to Excel', downloadSelected: '⬇️ Download selected',
    fetchPlaceholder: 'Enter URL (e.g. example.com) to extract...',
    fetchBtn: 'Extract', inspectMode: 'Inspect Mode',
    emptyText: 'Enter a URL to start extracting',
    emptyHint: 'Supports any website: YouTube, Twitter, Wikipedia...',
    pageInfo: '📋 Resources', pageTitle: '📄 Page Title',
    exportActions: '📤 Export', copied: 'Copied to clipboard', downloadStarted: 'Download started',
    resourceLayer: ' Resources', linkLayer: '🔗 Links', textLayer: '📝 Texts',
    selectedElement: '🎯 Selected Element', chars: 'chars', newTab: 'New Tab'
  }
};

function t(key) { return i18n[lang][key] || key; }

function toggleLang() {
  lang = lang === 'zh' ? 'en' : 'zh';
  applyLanguage();
  showToast('Language: ' + (lang === 'zh' ? '中文' : 'English'));
}

function applyLanguage() {
  urlInput.placeholder = t('fetchPlaceholder');
  fetchBtn.textContent = t('fetchBtn');
  inspectToggle.textContent = t('inspectMode');
  document.querySelector('.empty-text').textContent = t('emptyText');
  document.querySelector('.empty-hint').textContent = t('emptyHint');

  // 主标签页标题
  const tabResources = document.querySelector('#resourceTabs .resource-tab[data-tab="resources"] span:first-child');
  const tabSelected = document.querySelector('#resourceTabs .resource-tab[data-tab="selected"] span:first-child');
  const tabTexts = document.querySelector('#resourceTabs .resource-tab[data-tab="texts"] span:first-child');
  if (tabResources) tabResources.textContent = '🖼 ' + t('resourceLayer');
  if (tabSelected) tabSelected.textContent = '✅ ' + t('selected');
  if (tabTexts) tabTexts.textContent = '📝 ' + t('textLayer');

  document.querySelector('#rightPanel .panel-header span:first-child').textContent = t('pageInfo');
  const layerTitles = document.querySelectorAll('#panelBody .layer-title');
  if (layerTitles.length >= 2) {
    layerTitles[0].textContent = t('pageTitle');
    layerTitles[layerTitles.length - 1].textContent = t('exportActions');
  }

  const exportBtns = document.querySelectorAll('.export-actions button');
  if (exportBtns.length >= 3) {
    exportBtns[0].textContent = t('exportFolder');
    exportBtns[1].textContent = t('exportWSW');
    exportBtns[2].textContent = t('exportExcel');
  }

  // 更新标签栏 "+" 按钮标题
  const addBtn = tabBar ? tabBar.querySelector('.tab-add') : null;
  if (addBtn) addBtn.title = t('newTab');
}

// ============ 侧边栏切换 ============
function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  rightPanel.style.display = sidebarVisible ? 'flex' : 'none';
  sidebarToggle.textContent = sidebarVisible ? '◀' : '▶';
  // 通知主进程 sidebar 状态，使其正确计算 BrowserView 宽度
  if (window.electronAPI && window.electronAPI.setSidebarVisible) {
    window.electronAPI.setSidebarVisible(sidebarVisible);
  } else if (window.electronAPI && window.electronAPI.updateBrowserBounds) {
    window.electronAPI.updateBrowserBounds();
  }
}

// ============ 窗口控制 ============
function minimizeWindow() {
  if (window.electronAPI && window.electronAPI.minimizeWindow) {
    window.electronAPI.minimizeWindow();
  }
}

function maximizeWindow() {
  if (window.electronAPI && window.electronAPI.maximizeWindow) {
    window.electronAPI.maximizeWindow();
  }
}

function closeWindow() {
  if (window.electronAPI && window.electronAPI.closeWindow) {
    window.electronAPI.closeWindow();
  }
}

// ============ 设置面板 ============
function toggleSettings() {
  const overlay = document.getElementById('settingsOverlay');
  if (!overlay) return;
  
  if (overlay.classList.contains('show')) {
    // 关闭设置面板，恢复 BrowserView
    overlay.classList.remove('show');
    if (window.electronAPI && window.electronAPI.setBrowserviewVisible) {
      window.electronAPI.setBrowserviewVisible(true);
    }
  } else {
    // 打开设置面板：先隐藏 BrowserView，再显示设置面板
    // BrowserView 是原生元素，始终覆盖 HTML 内容，必须通过 removeBrowserView 隐藏
    if (window.electronAPI && window.electronAPI.setBrowserviewVisible) {
      window.electronAPI.setBrowserviewVisible(false).then(() => {
        overlay.classList.add('show');
        updateDashboard();
      }).catch(() => {
        // 如果 API 调用失败，仍然显示设置面板（可能没有活动标签）
        overlay.classList.add('show');
        updateDashboard();
      });
    } else {
      overlay.classList.add('show');
      updateDashboard();
    }
  }
}

// 更新仪表盘数据
function updateDashboard() {
  // 已提取资源总数
  const totalResources = currentData ? 
    (currentData.images?.length || 0) + 
    (currentData.videos?.length || 0) + 
    (currentData.audios?.length || 0) + 
    (currentData.links?.length || 0) + 
    (currentData.texts?.length || 0) : 0;
  
  // 已选资源数
  const selectedCount = getSelectedTotal();
  
  // 已下载大小（从 localStorage 读取）
  let downloadedSize = 0;
  try {
    downloadedSize = parseFloat(localStorage.getItem('downloadedSize') || '0');
  } catch (e) {}
  
  // 导出次数（从 localStorage 读取）
  let exportCount = 0;
  try {
    exportCount = parseInt(localStorage.getItem('exportCount') || '0');
  } catch (e) {}
  
  // 更新 DOM
  const dashTotal = document.getElementById('dashTotalResources');
  const dashSelected = document.getElementById('dashSelectedResources');
  const dashDownloaded = document.getElementById('dashDownloadedSize');
  const dashExport = document.getElementById('dashExportCount');
  
  if (dashTotal) dashTotal.textContent = totalResources;
  if (dashSelected) dashSelected.textContent = selectedCount;
  if (dashDownloaded) dashDownloaded.textContent = formatBytes(downloadedSize);
  if (dashExport) dashExport.textContent = exportCount;
}

function closeSettingsOnOverlay(event) {
  if (event.target.id === 'settingsOverlay') {
    toggleSettings();
  }
}

// 显示/隐藏资源层
function toggleShowResourceLayer() {
  const toggle = document.getElementById('showResourceLayerToggle');
  if (!toggle) return;
  showResourceLayer = toggle.checked;
  try {
    localStorage.setItem('showResourceLayer', showResourceLayer ? 'true' : 'false');
  } catch (e) {
    console.warn('无法保存设置到 localStorage:', e);
  }
  applyResourceLayerVisibility();
}

function loadShowResourceLayerSetting() {
  try {
    // 强制清除旧值，默认隐藏资源层
    localStorage.removeItem('showResourceLayer');
    showResourceLayer = false;
    const toggle = document.getElementById('showResourceLayerToggle');
    if (toggle) {
      toggle.checked = showResourceLayer;
    }
  } catch (e) {
    console.warn('无法从 localStorage 加载设置:', e);
  }
  applyResourceLayerVisibility();
}

function applyResourceLayerVisibility() {
  const resourceTabBtn = resourceTabs ? resourceTabs.querySelector('.resource-tab[data-tab="resources"]') : null;
  const paneResources = document.getElementById('paneResources');
  
  // 确保 layerPanels 容器始终可见（已选和文本层也在里面）
  if (layerPanels) {
    layerPanels.style.display = 'flex';
    layerPanels.style.flexDirection = 'column';
  }
  
  if (showResourceLayer) {
    // 显示资源层
    if (resourceTabBtn) resourceTabBtn.style.display = '';
    if (paneResources) {
      paneResources.style.display = '';
      // 如果资源层应该是活动的，确保它有 active 类
      if (activeResourceTab === 'resources') {
        paneResources.classList.add('active');
      }
    }
  } else {
    // 隐藏资源层：只隐藏资源层tab和内容，保留已选和文本层
    if (resourceTabBtn) resourceTabBtn.style.display = 'none';
    if (paneResources) {
      paneResources.style.display = 'none';
      paneResources.classList.remove('active');
    }
    // 如果当前在资源层，切换到已选
    if (activeResourceTab === 'resources') {
      switchResourceTab('selected');
    }
  }
}

// ============ 主题切换 ============
function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme();
  saveThemeSetting();
}

function toggleThemeFromSettings() {
  const toggle = document.getElementById('lightThemeToggle');
  if (!toggle) return;
  currentTheme = toggle.checked ? 'light' : 'dark';
  applyTheme();
  saveThemeSetting();
}

function applyTheme() {
  const html = document.documentElement;
  const themeBtn = document.getElementById('themeToggle');
  const settingsToggle = document.getElementById('lightThemeToggle');

  if (currentTheme === 'light') {
    html.classList.add('light-theme');
    if (themeBtn) themeBtn.textContent = '🌙';
    if (settingsToggle) settingsToggle.checked = true;
  } else {
    html.classList.remove('light-theme');
    if (themeBtn) themeBtn.textContent = '☀';
    if (settingsToggle) settingsToggle.checked = false;
  }
}

function saveThemeSetting() {
  try {
    localStorage.setItem('theme', currentTheme);
  } catch (e) {
    console.warn('无法保存主题设置到 localStorage:', e);
  }
}

function loadThemeSetting() {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') {
      currentTheme = saved;
    }
    applyTheme();
  } catch (e) {
    console.warn('无法从 localStorage 加载主题设置:', e);
  }
}

// SPA动态页面横幅显示/隐藏
function showSpaBanner() {
  const banner = document.getElementById('spaBanner');
  if (banner) banner.classList.remove('hidden');
}

function hideSpaBanner() {
  const banner = document.getElementById('spaBanner');
  if (banner) banner.classList.add('hidden');
}

// ============ 标签页管理 ============
function renderTabs() {
  if (!tabBar) return;
  const addBtn = tabBar.querySelector('.tab-add');
  tabBar.innerHTML = '';

  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
    el.onclick = (e) => {
      if (e.target.classList.contains('tab-close')) return;
      doSwitchTab(tab.id);
    };

    const titleEl = document.createElement('span');
    titleEl.className = 'tab-title';
    titleEl.textContent = tab.title || tab.url;
    titleEl.title = tab.title || tab.url;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = (e) => { e.stopPropagation(); doCloseTab(tab.id); };

    el.appendChild(titleEl);
    el.appendChild(closeBtn);
    tabBar.appendChild(el);
  });

  if (addBtn) tabBar.appendChild(addBtn);
  else {
    const newAddBtn = document.createElement('button');
    newAddBtn.className = 'tab-add';
    newAddBtn.textContent = '+';
    newAddBtn.title = t('newTab');
    newAddBtn.onclick = doAddNewTab;
    tabBar.appendChild(newAddBtn);
  }
}

// 主进程创建标签后的回调（初始标签 + 新建标签）
function onTabCreatedFromMain(tabId, url, title) {
  // 检查是否已存在
  if (tabs.find(t => t.id === tabId)) return;

  const tab = {
    id: tabId,
    url: url,
    title: title || url,
    currentData: null,
    selected: new Set(),
    selectedResources: createEmptySelectedResources(),
    pageHistory: [url],
    historyIndex: 0  // 当前在历史记录中的位置
  };
  tabs.push(tab);

  // 更新全局状态指向新标签
  if (activeTabId === null) {
    // 首个标签：直接设置为活动标签
    activeTabId = tabId;
    currentData = null;
    selected = tab.selected;
    selectedResources = tab.selectedResources;
    currentUrl = url;
    urlInput.value = url;
    clearLayerPanels();
    // 始终显示 layerPanels（包含已选/文本层标签）
    if (layerPanels) {
      layerPanels.style.display = 'flex';
      layerPanels.style.flexDirection = 'column';
    }
    // 应用资源层可见性设置（隐藏资源层tab和内容，保留已选/文本层）
    applyResourceLayerVisibility();
    setPageTitle('--');
    updateSelectionCount();
    updateExportBar();
  } else {
    // 后续标签：切换到新标签
    doSwitchTab(tabId);
  }

  renderTabs();
}

// 切换到指定标签（调用主进程 switchTab，不重新加载页面）
function doSwitchTab(tabId) {
  if (tabId === activeTabId) return;
  if (!tabs.find(t => t.id === tabId)) return;

  // 通知主进程切换 BrowserView
  if (window.electronAPI && window.electronAPI.switchTab) {
    window.electronAPI.switchTab(tabId);
  }

  // 更新本地状态
  activeTabId = tabId;
  const tab = getActiveTab();
  if (!tab) return;

  currentUrl = tab.url;
  urlInput.value = tab.url;

  // 恢复该标签的数据
  currentData = tab.currentData || null;

  // 确保 selected 始终指向 tab.selected（同一个对象引用）
  if (!tab.selected) {
    tab.selected = new Set();
  }
  selected = tab.selected;

  // 确保 selectedResources 始终指向 tab.selectedResources（同一个对象引用）
  if (!tab.selectedResources) {
    tab.selectedResources = createEmptySelectedResources();
  }
  selectedResources = tab.selectedResources;

  // 更新 UI
  // 始终显示 layerPanels（包含已选/文本层标签）
  layerPanels.style.display = 'flex';
  layerPanels.style.flexDirection = 'column';
  if (currentData) {
    emptyState.classList.add('hidden');
    updateAll();
    renderSelectedResources();
  } else if (selectedResources && getSelectedTotal() > 0) {
    // currentData 为空但已选资源有数据（用户在抓取模式下提取过元素）：显示面板，渲染已选资源
    emptyState.classList.add('hidden');
    // 清空主资源标签页（无数据）
    if (imageList) imageList.innerHTML = '';
    if (videoList) videoList.innerHTML = '';
    if (audioList) audioList.innerHTML = '';
    if (linkList) linkList.innerHTML = '';
    if (textList) textList.innerHTML = '';
    if (tabCountResources) tabCountResources.textContent = '0';
    if (tabCountTexts) tabCountTexts.textContent = '0';
    if (subImageCount) subImageCount.textContent = '0';
    if (subVideoCount) subVideoCount.textContent = '0';
    if (subAudioCount) subAudioCount.textContent = '0';
    if (subLinkCount) subLinkCount.textContent = '0';
    clearAllElementTabs();
    // 渲染已选资源
    renderSelectedResources();
  } else {
    clearLayerPanels();
    // 只隐藏资源层内容，不隐藏整个 layerPanels
    const paneResources = document.getElementById('paneResources');
    if (paneResources) paneResources.style.display = 'none';
  }
  // 应用资源层可见性设置
  applyResourceLayerVisibility();
  setPageTitle(tab.title || '--');
  updateSelectionCount();
  updateExportBar();
  updateNavButtons();
  renderTabs();
}

// 关闭指定标签
function doCloseTab(tabId) {
  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx < 0) return;

  // 通知主进程销毁 BrowserView
  if (window.electronAPI && window.electronAPI.closeTab) {
    window.electronAPI.closeTab(tabId);
  }

  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    activeTabId = null;
    currentUrl = '';
    urlInput.value = '';
    currentData = null;
    selected = new Set();
    selectedResources = createEmptySelectedResources();
    clearLayerPanels();
    // 只隐藏资源层内容，不隐藏整个 layerPanels
    const paneResources = document.getElementById('paneResources');
    if (paneResources) paneResources.style.display = 'none';
    emptyState.classList.remove('hidden');
    setPageTitle('--');
    updateSelectionCount();
    updateExportBar();
  } else if (tabId === activeTabId) {
    // 关闭的是当前标签，切换到最近的标签
    const newTab = tabs[Math.min(idx, tabs.length - 1)];
    doSwitchTab(newTab.id);
  } else if (idx < tabs.findIndex(t => t.id === activeTabId)) {
    // 关闭的标签在当前标签之前，索引偏移不需要处理（我们用 tabId 而非索引）
  }

  renderTabs();
}

// 新建标签页（打开百度）
async function doAddNewTab() {
  if (window.electronAPI && window.electronAPI.createTab) {
    const result = await window.electronAPI.createTab('https://www.baidu.com');
    if (result && result.tabId) {
      // onTabCreatedFromMain 内部对非首标签会自动调用 doSwitchTab，无需在此重复调用
      onTabCreatedFromMain(result.tabId, result.url, '百度');
    }
  }
}

// 更新当前标签的标题
function updateActiveTabTitle(title) {
  const tab = getActiveTab();
  if (tab) {
    tab.title = title;
    renderTabs();
  }
}

// ============ 资源面板：标签页切换 ============

// 当前活动主标签页
let activeResourceTab = 'selected';

// 主标签页切换
function switchResourceTab(tabName) {
  activeResourceTab = tabName;
  // 更新主标签栏 active 状态
  const tabs = resourceTabs.querySelectorAll('.resource-tab');
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  // 更新主标签页内容 active 状态
  const panes = layerPanels.querySelectorAll('.tab-pane');
  panes.forEach(p => p.classList.remove('active'));
  const targetPane = document.getElementById('pane' + capitalize(tabName));
  if (targetPane) {
    targetPane.classList.add('active');
    // 如果切换到资源标签页，恢复显示（可能被自动隐藏）
    if (tabName === 'resources') {
      // 只有当设置允许显示资源层时才恢复
      if (showResourceLayer) {
        targetPane.style.display = '';
        const resourceTabBtn = resourceTabs.querySelector('.resource-tab[data-tab="resources"]');
        if (resourceTabBtn) resourceTabBtn.style.display = '';
      }
    }
  }
  // 如果是元素标签页（动态创建的），需要特殊处理
  if (tabName.startsWith('element-')) {
    const elementPane = document.getElementById('pane-' + tabName);
    if (elementPane) elementPane.classList.add('active');
  }
}

// 子标签页切换
function switchSubTab(parentTab, subTab) {
  const paneId = 'pane' + capitalize(parentTab);
  const pane = document.getElementById(paneId);
  if (!pane) return;
  // 更新子标签栏 active 状态
  const subTabs = pane.querySelectorAll('.sub-tab');
  subTabs.forEach(t => t.classList.toggle('active', t.dataset.subtab === subTab));
  // 更新子标签页内容 active 状态
  const subPanes = pane.querySelectorAll('.sub-pane');
  subPanes.forEach(p => p.classList.toggle('active', p.dataset.subpane === subTab));
}

// 字符串首字母大写
function capitalize(str) {
  if (!str) return '';
  // 处理 element-xxx 格式
  if (str.startsWith('element-')) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============ 选中元素标签页管理（抓取模式下动态创建） ============

// 存储所有选中元素的标签页 { id, title, element, resources }
let elementTabs = [];
let elementTabCounter = 0;

// 创建选中元素标签页
function createElementTab(element, resources, counts) {
  elementTabCounter++;
  const tabId = 'element-' + elementTabCounter;
  const tag = element.tagName.toLowerCase();
  const idStr = element.id ? `#${element.id}` : '';
  const cls = element.className && typeof element.className === 'string'
    ? '.' + element.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  const title = `<${tag}${idStr}${cls}>`;

  // 创建主标签按钮
  const tabBtn = document.createElement('div');
  tabBtn.className = 'resource-tab';
  tabBtn.dataset.tab = tabId;
  tabBtn.innerHTML = `<span>🎯 ${escapeHtml(title)}</span><span class="tab-count">${counts.total}</span><span class="tab-close" style="margin-left:4px;cursor:pointer;font-size:14px;opacity:0.6;">×</span>`;
  tabBtn.onclick = (e) => {
    if (e.target.classList.contains('tab-close')) {
      e.stopPropagation();
      removeElementTab(tabId);
      return;
    }
    switchResourceTab(tabId);
  };
  resourceTabs.appendChild(tabBtn);

  // 创建标签页内容
  const pane = document.createElement('div');
  pane.className = 'tab-pane';
  pane.id = 'pane-' + tabId;

  // 元素信息
  const infoHtml = `
    <div style="padding:8px 12px;background:var(--darker);border-bottom:1px solid var(--border);font-size:11px;color:var(--text-dim);">
      <div style="margin-bottom:4px;"><code style="background:var(--dark);padding:2px 6px;border-radius:4px;color:var(--primary);">${escapeHtml(title)}</code></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <span>🖼 ${counts.images}</span><span>🎬 ${counts.videos}</span><span>🎵 ${counts.audios}</span>
        <span>🔗 ${counts.links}</span><span>📝 ${counts.texts}</span>
      </div>
      ${element.textContent ? `<div style="margin-top:6px;max-height:60px;overflow:hidden;opacity:0.7;">${escapeHtml(element.textContent.substring(0, 120))}...</div>` : ''}
    </div>`;

  // 子标签页：图片/视频/音频/链接/文本
  const subTabsHtml = `
    <div class="sub-tabs">
      <div class="sub-tab active" data-subtab="${tabId}-images" onclick="switchElementSubTab('${tabId}','images')"><span>📷 图片</span><span class="sub-count">${counts.images}</span></div>
      <div class="sub-tab" data-subtab="${tabId}-videos" onclick="switchElementSubTab('${tabId}','videos')"><span>🎬 视频</span><span class="sub-count">${counts.videos}</span></div>
      <div class="sub-tab" data-subtab="${tabId}-audios" onclick="switchElementSubTab('${tabId}','audios')"><span>🎵 音频</span><span class="sub-count">${counts.audios}</span></div>
      <div class="sub-tab" data-subtab="${tabId}-links" onclick="switchElementSubTab('${tabId}','links')"><span>🔗 链接</span><span class="sub-count">${counts.links}</span></div>
      <div class="sub-tab" data-subtab="${tabId}-texts" onclick="switchElementSubTab('${tabId}','texts')"><span>📝 文本</span><span class="sub-count">${counts.texts}</span></div>
    </div>`;

  pane.innerHTML = infoHtml + subTabsHtml;

  // 各子标签页内容容器
  const types = ['images', 'videos', 'audios', 'links', 'texts'];
  types.forEach((type, idx) => {
    const subPane = document.createElement('div');
    subPane.className = 'sub-pane' + (idx === 0 ? ' active' : '');
    subPane.dataset.subpane = `${tabId}-${type}`;
    const list = document.createElement('div');
    list.className = 'resource-list' + (type === 'links' || type === 'texts' ? ' list-mode' : '');
    list.id = `${tabId}-${type}-list`;
    subPane.appendChild(list);
    pane.appendChild(subPane);
  });

  layerPanels.appendChild(pane);

  // 渲染各类型资源
  renderElementTabResources(tabId, resources);

  // 存储并切换到新标签页
  elementTabs.push({ id: tabId, title, element, resources });
  switchResourceTab(tabId);

  return tabId;
}

// 渲染选中元素标签页的资源
function renderElementTabResources(tabId, resources) {
  const imgList = document.getElementById(`${tabId}-images-list`);
  const vidList = document.getElementById(`${tabId}-videos-list`);
  const audList = document.getElementById(`${tabId}-audios-list`);
  const lnkList = document.getElementById(`${tabId}-links-list`);
  const txtList = document.getElementById(`${tabId}-texts-list`);

  // 图片
  if (imgList) {
    const imgs = (resources.images || []).map(url => ({ type: 'image', url, name: getFileName(url), format: (getExt(url) || 'jpg').toUpperCase() }));
    renderMediaCards(imgs, imgList, 'image');
  }
  // 视频
  if (vidList) {
    const vids = (resources.videos || []).map(v => {
      const url = typeof v === 'string' ? v : v.url;
      return { type: 'video', url, name: getFileName(url), format: (getExt(url) || 'mp4').toUpperCase() };
    });
    renderMediaCards(vids, vidList, 'video');
  }
  // 音频
  if (audList) {
    const auds = (resources.audios || []).map(url => ({ type: 'audio', url, name: getFileName(url), format: (getExt(url) || 'mp3').toUpperCase() }));
    renderMediaCards(auds, audList, 'audio');
  }
  // 链接
  if (lnkList) {
    const links = (resources.links || []).map(l => ({ type: 'link', url: l.url, name: l.text || l.url, format: 'LINK' }));
    renderLinks(links, lnkList);
  }
  // 文本
  if (txtList) {
    const texts = (resources.texts || []).map(t => ({ type: 'text', name: t.name || t.content?.substring(0, 30) || 'text', content: t.content || '', length: (t.content || '').length }));
    renderTexts(texts, txtList);
  }
}

// 选中元素标签页的子标签页切换
function switchElementSubTab(tabId, subType) {
  const pane = document.getElementById('pane-' + tabId);
  if (!pane) return;
  const subTabs = pane.querySelectorAll('.sub-tab');
  subTabs.forEach(t => t.classList.toggle('active', t.dataset.subtab === `${tabId}-${subType}`));
  const subPanes = pane.querySelectorAll('.sub-pane');
  subPanes.forEach(p => p.classList.toggle('active', p.dataset.subpane === `${tabId}-${subType}`));
}

// 移除选中元素标签页
function removeElementTab(tabId) {
  // 移除标签按钮
  const tabBtn = resourceTabs.querySelector(`.resource-tab[data-tab="${tabId}"]`);
  if (tabBtn) tabBtn.remove();
  // 移除标签页内容
  const pane = document.getElementById('pane-' + tabId);
  if (pane) pane.remove();
  // 从存储中移除
  elementTabs = elementTabs.filter(t => t.id !== tabId);
  // 切换回资源标签页
  if (activeResourceTab === tabId) {
    switchResourceTab('resources');
  }
}

// 清除所有选中元素标签页
function clearAllElementTabs() {
  elementTabs.forEach(t => {
    const tabBtn = resourceTabs.querySelector(`.resource-tab[data-tab="${t.id}"]`);
    if (tabBtn) tabBtn.remove();
    const pane = document.getElementById('pane-' + t.id);
    if (pane) pane.remove();
  });
  elementTabs = [];
}

// ============ 核心：加载URL（地址不同则新建标签页，相同则在当前标签导航） ============
async function loadUrl() {
  let url = urlInput.value.trim();
  if (!url) return;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
    urlInput.value = url;
  }

  const activeTab = getActiveTab();

  // 地址与当前标签页相同，直接导航
  if (activeTab && activeTab.url === url) {
    if (window.electronAPI && window.electronAPI.browserNavigate) {
      await window.electronAPI.browserNavigate(url);
    }
    return;
  }

  // 地址不同，创建新标签页
  loadingOverlay.classList.remove('hidden');
  emptyState.classList.add('hidden');
  fetchBtn.disabled = true;
  statusText.textContent = t('loading');

  if (window.electronAPI && window.electronAPI.createTab) {
    const result = await window.electronAPI.createTab(url);
    if (result && result.tabId) {
      onTabCreatedFromMain(result.tabId, result.url, url);
    }
  }

  // 添加到全局历史
  addToGlobalHistory(url);
}

// ============ 历史记录管理 ============
function addToGlobalHistory(url) {
  // 如果当前不在历史末尾，清除后续历史
  if (historyIndex < globalHistory.length - 1) {
    globalHistory = globalHistory.slice(0, historyIndex + 1);
  }
  // 避免重复添加相同的URL
  if (globalHistory.length === 0 || globalHistory[globalHistory.length - 1] !== url) {
    globalHistory.push(url);
    historyIndex = globalHistory.length - 1;
  }
}

// 后退
async function goBack() {
  const tab = getActiveTab();
  if (!tab || tab.historyIndex <= 0) return;

  tab.historyIndex--;
  const url = tab.pageHistory[tab.historyIndex];
  tab.url = url;
  currentUrl = url;
  urlInput.value = url;

  if (window.electronAPI && window.electronAPI.browserNavigate) {
    await window.electronAPI.browserNavigate(url);
  }
  renderTabs();
  updateNavButtons();
}

// 前进
async function goForward() {
  const tab = getActiveTab();
  if (!tab || tab.historyIndex >= tab.pageHistory.length - 1) return;

  tab.historyIndex++;
  const url = tab.pageHistory[tab.historyIndex];
  tab.url = url;
  currentUrl = url;
  urlInput.value = url;

  if (window.electronAPI && window.electronAPI.browserNavigate) {
    await window.electronAPI.browserNavigate(url);
  }
  renderTabs();
  updateNavButtons();
}

// 更新导航按钮状态
function updateNavButtons() {
  const tab = getActiveTab();
  const backBtn = document.getElementById('backBtn');
  const forwardBtn = document.getElementById('forwardBtn');
  if (backBtn) backBtn.disabled = !tab || tab.historyIndex <= 0;
  if (forwardBtn) forwardBtn.disabled = !tab || tab.historyIndex >= tab.pageHistory.length - 1;
}

// 切换历史记录下拉
function toggleHistoryDropdown() {
  const dropdown = document.getElementById('historyDropdown');
  if (!dropdown) return;
  if (dropdown.style.display === 'none') {
    renderHistoryDropdown();
    dropdown.style.display = 'block';
  } else {
    dropdown.style.display = 'none';
  }
}

// 渲染历史记录下拉
function renderHistoryDropdown() {
  const dropdown = document.getElementById('historyDropdown');
  if (!dropdown) return;

  const tab = getActiveTab();
  const history = tab ? tab.pageHistory : globalHistory;

  let html = `<div class="history-header">
    <span>${lang === 'zh' ? '浏览历史' : 'History'} (${history.length})</span>
    <button onclick="clearHistory()">${lang === 'zh' ? '清除' : 'Clear'}</button>
  </div>`;

  if (history.length === 0) {
    html += `<div class="history-item" style="color:var(--text-dim)">${lang === 'zh' ? '暂无历史记录' : 'No history'}</div>`;
  } else {
    for (let i = history.length - 1; i >= 0; i--) {
      const url = history[i];
      const isCurrent = tab && tab.url === url;
      html += `<div class="history-item" style="${isCurrent ? 'color:var(--primary);font-weight:600' : ''}" onclick="navigateFromHistory('${url.replace(/'/g, "\\'")}')">${escapeHtml(url)}</div>`;
    }
  }

  dropdown.innerHTML = html;
}

// 从历史记录导航
async function navigateFromHistory(url) {
  const dropdown = document.getElementById('historyDropdown');
  if (dropdown) dropdown.style.display = 'none';

  const activeTab = getActiveTab();

  // 地址与当前标签页相同，直接导航
  if (activeTab && activeTab.url === url) {
    if (window.electronAPI && window.electronAPI.browserNavigate) {
      await window.electronAPI.browserNavigate(url);
    }
    return;
  }

  // 地址不同，创建新标签页
  loadingOverlay.classList.remove('hidden');
  emptyState.classList.add('hidden');
  fetchBtn.disabled = true;
  statusText.textContent = t('loading');

  if (window.electronAPI && window.electronAPI.createTab) {
    const result = await window.electronAPI.createTab(url);
    if (result && result.tabId) {
      onTabCreatedFromMain(result.tabId, result.url, url);
    }
  }
}

// 清除历史
function clearHistory() {
  const tab = getActiveTab();
  if (tab) {
    tab.pageHistory = [tab.url];
    tab.historyIndex = 0;
  }
  globalHistory = [];
  historyIndex = -1;
  renderHistoryDropdown();
  updateNavButtons();
}

// 地址栏变化监听
function setupUrlInputListener() {
  let lastUrl = '';
  urlInput.addEventListener('input', () => {
    const currentInput = urlInput.value.trim();
    if (currentInput && currentInput !== lastUrl) {
      lastUrl = currentInput;
    }
  });
}

function clearLayerPanels() {
  if (imageList) imageList.innerHTML = '';
  if (videoList) videoList.innerHTML = '';
  if (audioList) audioList.innerHTML = '';
  if (linkList) linkList.innerHTML = '';
  if (textList) textList.innerHTML = '';
  if (selectedImageList) selectedImageList.innerHTML = '';
  if (selectedVideoList) selectedVideoList.innerHTML = '';
  if (selectedAudioList) selectedAudioList.innerHTML = '';
  if (selectedLinkList) selectedLinkList.innerHTML = '';
  if (selectedTextList) selectedTextList.innerHTML = '';
  if (tabCountResources) tabCountResources.textContent = '0';
  if (tabCountSelected) tabCountSelected.textContent = '0';
  if (tabCountTexts) tabCountTexts.textContent = '0';
  if (subImageCount) subImageCount.textContent = '0';
  if (subVideoCount) subVideoCount.textContent = '0';
  if (subAudioCount) subAudioCount.textContent = '0';
  if (subLinkCount) subLinkCount.textContent = '0';
  if (subSelectedImageCount) subSelectedImageCount.textContent = '0';
  if (subSelectedVideoCount) subSelectedVideoCount.textContent = '0';
  if (subSelectedAudioCount) subSelectedAudioCount.textContent = '0';
  if (subSelectedLinkCount) subSelectedLinkCount.textContent = '0';
  if (subSelectedTextCount) subSelectedTextCount.textContent = '0';
  // 重置固定信息区
  if (infoPageTitle) infoPageTitle.textContent = '--';
  if (infoSelectedElementRow) infoSelectedElementRow.style.display = 'none';
  if (infoSelectedElement) infoSelectedElement.textContent = '--';
  // 清除所有选中元素标签页
  clearAllElementTabs();
  // 注意：selectedResources 数据由 tab 同步管理，此处不重置数据，只清空 UI
}

// ============ 监听主进程转发的事件 ============
function setupEventListeners() {
  // 主进程创建标签的通知（初始百度标签）— 监听器在 DOMContentLoaded 中注册，此处不重复注册

  // BrowserView 页面加载完成
  if (window.electronAPI && window.electronAPI.onBrowserDidFinishLoad) {
    window.electronAPI.onBrowserDidFinishLoad((tabId) => {
      // 只处理当前活动标签的事件
      if (activeTabId !== null && tabId !== activeTabId) return;

      loadingOverlay.classList.add('hidden');
      fetchBtn.disabled = false;
      statusText.textContent = t('extracting');

      if (window.electronAPI && window.electronAPI.browserExtractAll) {
        window.electronAPI.browserExtractAll();
      }
      if (window.electronAPI && window.electronAPI.browserGetTitle) {
        window.electronAPI.browserGetTitle().then(title => {
          setPageTitle(title || currentUrl);
          updateActiveTabTitle(title || currentUrl);
        }).catch(() => {});
      }
    });
  }

  // BrowserView 页面加载失败
  if (window.electronAPI && window.electronAPI.onBrowserDidFailLoad) {
    window.electronAPI.onBrowserDidFailLoad((detail, tabId) => {
      if (activeTabId !== null && tabId !== activeTabId) return;

      loadingOverlay.classList.add('hidden');
      fetchBtn.disabled = false;
      if (detail && detail.errorCode !== -3) {
        showToast(t('error') + ': ' + (detail.errorDescription || 'Unknown error'));
        statusText.textContent = t('error');
      }
    });
  }

  // BrowserView 导航事件
  if (window.electronAPI && window.electronAPI.onBrowserDidNavigate) {
    window.electronAPI.onBrowserDidNavigate((url, tabId) => {
      if (activeTabId !== null && tabId !== activeTabId) return;
      if (url) {
        currentUrl = url;
        urlInput.value = url;
        
        // 检测是否为单页应用(SPA)
        const spaDomains = ['bilibili.com', 'douyin.com', 'weibo.com', 'taobao.com', 'tmall.com', 'kuaishou.com'];
        const isSPA = spaDomains.some(domain => url.includes(domain));
        if (isSPA) {
          showSpaBanner();
        } else {
          hideSpaBanner();
        }
        
        const tab = getActiveTab();
        if (tab) {
          tab.url = url;
          // 更新页面历史（前进时清除后续历史）
          if (tab.historyIndex < tab.pageHistory.length - 1) {
            tab.pageHistory = tab.pageHistory.slice(0, tab.historyIndex + 1);
          }
          tab.pageHistory.push(url);
          tab.historyIndex = tab.pageHistory.length - 1;
          renderTabs();
        }
        // 添加到全局历史
        addToGlobalHistory(url);
      }
    });
  }

  if (window.electronAPI && window.electronAPI.onBrowserDidNavigateInPage) {
    window.electronAPI.onBrowserDidNavigateInPage((url, tabId) => {
      if (activeTabId !== null && tabId !== activeTabId) return;
      if (url) {
        currentUrl = url;
        urlInput.value = url;
        const tab = getActiveTab();
        if (tab) {
          tab.url = url;
          // 更新页面历史（前进时清除后续历史）
          if (tab.historyIndex < tab.pageHistory.length - 1) {
            tab.pageHistory = tab.pageHistory.slice(0, tab.historyIndex + 1);
          }
          tab.pageHistory.push(url);
          tab.historyIndex = tab.pageHistory.length - 1;
          renderTabs();
        }
        // 添加到全局历史
        addToGlobalHistory(url);
      }
    });
  }

  // 资源提取结果
  if (window.electronAPI && window.electronAPI.onResourcesExtracted) {
    window.electronAPI.onResourcesExtracted((resources, tabId) => {
      if (activeTabId !== null && tabId !== activeTabId) return;
      if (resources) handleResourcesExtracted(resources);
    });
  }

  // 页面标题
  if (window.electronAPI && window.electronAPI.onPageTitle) {
    window.electronAPI.onPageTitle((title, tabId) => {
      if (activeTabId !== null && tabId !== activeTabId) return;
      if (title) {
        setPageTitle(title);
        updateActiveTabTitle(title);
      }
    });
  }

  // 页面标题更新（来自 page-title-updated）
  if (window.electronAPI && window.electronAPI.onBrowserPageTitleUpdated) {
    window.electronAPI.onBrowserPageTitleUpdated((title, tabId) => {
      if (activeTabId !== null && tabId !== activeTabId) return;
      if (title) {
        setPageTitle(title);
        updateActiveTabTitle(title);
      }
    });
  }

  // 提取模式状态变化
  if (window.electronAPI && window.electronAPI.onInspectModeChanged) {
    window.electronAPI.onInspectModeChanged((enabled) => {
      inspectMode = enabled;
      inspectToggle.classList.toggle('active', inspectMode);
    });
  }

  // 元素资源（点击提取，完整数据）
  if (window.electronAPI && window.electronAPI.onElementResources) {
    window.electronAPI.onElementResources((data) => {
      if (data) handleElementResources(data);
    });
  }

  // 元素悬停预览（hover 时显示预览）
  if (window.electronAPI && window.electronAPI.onElementHoverPreview) {
    window.electronAPI.onElementHoverPreview((data) => {
      if (data) handleElementHoverPreview(data);
    });
  }

  // 元素悬停清除（mouseout 时清除预览）
  if (window.electronAPI && window.electronAPI.onElementHoverClear) {
    window.electronAPI.onElementHoverClear(() => {
      clearHoverPreview();
    });
  }

  // 媒体批量
  if (window.electronAPI && window.electronAPI.onMediaBatch) {
    window.electronAPI.onMediaBatch((mediaArray) => {
      if (mediaArray && Array.isArray(mediaArray)) {
        mediaArray.forEach(media => addMediaResource(media));
      }
    });
  }

  // 媒体请求拦截（来自主进程 session 拦截）
  if (window.electronAPI && window.electronAPI.onMediaRequestIntercepted) {
    window.electronAPI.onMediaRequestIntercepted((media) => {
      addMediaResource(media);
    });
  }

  // window.open 被拦截后的 URL
  if (window.electronAPI && window.electronAPI.onOpenUrlInWebview) {
    window.electronAPI.onOpenUrlInWebview((url) => {
      if (url && url.startsWith('http')) {
        urlInput.value = url;
        loadUrl();
      }
    });
  }

  // 下载进度监听
  if (window.electronAPI && window.electronAPI.onDownloadProgress) {
    window.electronAPI.onDownloadProgress((data) => {
      if (data && typeof data.progress === 'number') {
        showProgressBar(data);
      }
    });
  }
}

// ============ 切换提取模式 ============
function toggleInspect() {
  inspectMode = !inspectMode;
  inspectToggle.classList.toggle('active', inspectMode);
  // 开启抓取模式时自动展开侧栏，关闭抓取模式时不自动折叠（保持侧栏当前状态，用户可手动折叠）
  if (inspectMode) {
    if (!sidebarVisible) {
      sidebarVisible = true;
      rightPanel.style.display = 'flex';
      sidebarToggle.textContent = '';
      if (window.electronAPI && window.electronAPI.setSidebarVisible) {
        window.electronAPI.setSidebarVisible(true);
      }
    }
  } else {
    // 关闭抓取模式：不自动折叠侧栏，仅重置抓取资源面板
    // 只隐藏资源层内容，不隐藏整个 layerPanels
    const paneResources = document.getElementById('paneResources');
    if (paneResources) paneResources.style.display = 'none';
    emptyState.classList.remove('hidden');
  }
  if (window.electronAPI && window.electronAPI.browserToggleInspect) {
    window.electronAPI.browserToggleInspect(inspectMode);
  }
}

// ============ 添加媒体资源（来自主进程拦截） ============
function addMediaResource(media) {
  const tab = getActiveTab();
  if (!tab) return;

  if (!tab.currentData) {
    tab.currentData = {
      title: currentUrl, url: currentUrl,
      images: [], videos: [], audios: [], links: [], documents: [], texts: [],
      stats: { images: 0, videos: 0, audios: 0, links: 0, documents: 0, texts: 0, total: 0 }
    };
  }
  currentData = tab.currentData;

  const type = media.type;
  const url = media.url;
  if (!url) return;

  if (type === 'image') {
    if (!currentData.images.some(i => i.url === url)) {
      currentData.images.push({ type: 'image', url, name: media.name || getFileName(url), format: media.format || (getExt(url) || 'jpg').toUpperCase(), width: 0, height: 0 });
    }
  } else if (type === 'video') {
    if (!currentData.videos.some(v => v.url === url)) {
      currentData.videos.push({ type: 'video', url, name: media.name || getFileName(url), format: media.format || (getExt(url) || 'mp4').toUpperCase(), duration: 0 });
    }
  } else if (type === 'audio') {
    if (!currentData.audios.some(a => a.url === url)) {
      currentData.audios.push({ type: 'audio', url, name: media.name || getFileName(url), format: media.format || (getExt(url) || 'mp3').toUpperCase(), duration: 0 });
    }
  }

  updateStats();
  updateAll();
}

// ============ 处理提取到的资源 ============
function handleResourcesExtracted(resources) {
  loadingOverlay.classList.add('hidden');
  fetchBtn.disabled = false;

  const tab = getActiveTab();
  if (!tab) return;

  if (!tab.currentData) {
    tab.currentData = {
      title: currentUrl, url: currentUrl,
      images: [], videos: [], audios: [], links: [], documents: [], texts: [],
      stats: { images: 0, videos: 0, audios: 0, links: 0, documents: 0, texts: 0, total: 0 }
    };
  }
  currentData = tab.currentData;

  const imageSet = new Set(currentData.images.map(i => i.url));
  const videoSet = new Set(currentData.videos.map(v => v.url));
  const audioSet = new Set(currentData.audios.map(a => a.url));
  const linkSet = new Set(currentData.links.map(l => l.url));

  (resources.images || []).forEach(url => {
    if (!imageSet.has(url)) {
      imageSet.add(url);
      currentData.images.push({ type: 'image', url, name: getFileName(url), format: (getExt(url) || 'jpg').toUpperCase(), width: 0, height: 0 });
    }
  });

  (resources.videos || []).forEach(v => {
    const url = typeof v === 'string' ? v : v.url;
    const streamType = typeof v === 'object' ? v.streamType : undefined;
    if (!videoSet.has(url)) {
      videoSet.add(url);
      const item = { type: 'video', url, name: getFileName(url), format: (getExt(url) || 'mp4').toUpperCase(), duration: 0 };
      if (streamType) item.streamType = streamType;
      currentData.videos.push(item);
    }
  });

  (resources.audios || []).forEach(url => {
    if (!audioSet.has(url)) {
      audioSet.add(url);
      currentData.audios.push({ type: 'audio', url, name: getFileName(url), format: (getExt(url) || 'mp3').toUpperCase(), duration: 0 });
    }
  });

  (resources.links || []).forEach(link => {
    if (!linkSet.has(link.url)) {
      linkSet.add(link.url);
      currentData.links.push({ type: 'link', url: link.url, name: link.text || link.url, format: 'LINK' });
    }
  });

  const textSet = new Set(currentData.texts.map(t => t.name));
  (resources.texts || []).forEach(textItem => {
    const name = textItem.name || textItem.content?.substring(0, 30) || 'text';
    if (!textSet.has(name)) {
      textSet.add(name);
      currentData.texts.push({
        type: 'text', name: name,
        content: textItem.content || '',
        length: (textItem.content || '').length
      });
    }
  });

  const docSet = new Set(currentData.documents.map(d => d.url));
  (resources.documents || []).forEach(doc => {
    const url = doc.url || doc;
    if (!docSet.has(url)) {
      docSet.add(url);
      currentData.documents.push({
        type: 'document', url: url,
        name: doc.name || doc.text || getFileName(url),
        format: doc.format || (getExt(url) || 'pdf').toUpperCase()
      });
    }
  });

  // selected 已指向 tab.selected，无需重新赋值
  updateStats();
  updateAll();
  renderSelectedResources();
  statusText.textContent = t('done') + ' — ' + currentData.stats.total + ' ' + t('items');
  showToast(t('done') + ': ' + currentData.stats.total + ' ' + t('items'));
}

// ============ Hover 预览面板 ============
const hoverPreviewPanel = document.getElementById('hoverPreviewPanel');
const hoverPreviewSelector = document.getElementById('hoverPreviewSelector');
const hoverPreviewBody = document.getElementById('hoverPreviewBody');

// 处理悬停预览
function handleElementHoverPreview(data) {
  if (!inspectMode) return;
  const { selector, counts, textPreview } = data;
  if (!selector) return;

  // 面板始终可见，仅更新内容
  if (hoverPreviewSelector) hoverPreviewSelector.textContent = selector;

  // 构建预览内容
  if (hoverPreviewBody) {
    const parts = [];
    if (counts && counts.images > 0) parts.push(`<div class="hover-preview-item">📷 图片: ${counts.images} 个</div>`);
    if (counts && counts.videos > 0) parts.push(`<div class="hover-preview-item">🎬 视频: ${counts.videos} 个</div>`);
    if (counts && counts.audios > 0) parts.push(`<div class="hover-preview-item">🎵 音频: ${counts.audios} 个</div>`);
    if (textPreview) parts.push(`<div class="hover-preview-text">📝 文本: ${escapeHtml(textPreview.substring(0, 60))}...</div>`);
    
    if (parts.length === 0) {
      hoverPreviewBody.innerHTML = '<div class="hover-preview-empty">无资源</div>';
    } else {
      hoverPreviewBody.innerHTML = parts.join('');
    }
  }
}

// 清除悬停预览（重置为默认提示，不隐藏面板）
function clearHoverPreview() {
  if (!inspectMode) {
    if (hoverPreviewSelector) hoverPreviewSelector.textContent = '--';
    if (hoverPreviewBody) hoverPreviewBody.innerHTML = '<div class="hover-preview-empty">启用抓取模式后悬停元素查看预览</div>';
  } else {
    // 抓取模式下保留上次内容，仅清空选择器标识
    if (hoverPreviewSelector) hoverPreviewSelector.textContent = '（移动鼠标选择元素）';
  }
}

// ============ 处理元素资源（提取模式） ============
function handleElementResources(data) {
  const { element, resources } = data;

  // 过滤掉无法预览的资源（blob: URL、无扩展名的 CDN 流等）
  const filtered = filterPreviewableResources(resources);

  const counts = {
    images: (filtered.images || []).length,
    videos: (filtered.videos || []).length,
    audios: (filtered.audios || []).length,
    links: (filtered.links || []).length,
    texts: (filtered.texts || []).length
  };
  counts.total = counts.images + counts.videos + counts.audios + counts.links + counts.texts;

  showToast(`${t('selectedElement')}: <${element.tagName.toLowerCase()}> - ${counts.images} ${t('images')}, ${counts.videos} ${t('videos')}, ${counts.audios} ${t('audios')}, ${counts.links} ${t('links')}, ${counts.texts} ${t('texts')}`);

  // 已选资源层独立显示点击区域内的资源，不合并到主资源层（currentData）
  // 将过滤后的元素资源追加到已选资源（按 URL/内容去重，直接存储完整对象）
  const prevTotal = getSelectedTotal();
  appendToSelectedResources(filtered);

  // 同步 selected Set（仅用于主资源标签页卡片高亮显示）
  syncSelectedSetFromSelectedResources();

  // 更新固定信息区：选中元素文本
  const tag = element.tagName.toLowerCase();
  const idStr = element.id ? `#${element.id}` : '';
  const cls = element.className && typeof element.className === 'string'
    ? '.' + element.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  if (infoSelectedElementRow) infoSelectedElementRow.style.display = 'flex';
  if (infoSelectedElement) {
    const elemDesc = `<${tag}${idStr}${cls}>`;
    const textPreview = element.textContent ? element.textContent.substring(0, 80) : '';
    infoSelectedElement.textContent = textPreview ? `${elemDesc} ${textPreview}` : elemDesc;
  }

  // 为选中元素创建独立标签页（含文本和超链接）
  createElementTab(element, filtered, counts);

  const newTotal = getSelectedTotal();
  if (newTotal > prevTotal) {
    renderSelectedResources();
    updateSelectionCount();
    updateExportBar();
  }

  // 确保面板可见（即使 currentData 为空，只要有已选资源就显示）
  if (newTotal > 0 && (!currentData || layerPanels.style.display === 'none')) {
    layerPanels.style.display = 'flex';
    layerPanels.style.flexDirection = 'column';
    emptyState.classList.add('hidden');
  }
}

// 图片 CDN 域名（无标准扩展名但实际是图片）
const imageCdnDomains = [
  'bdimg.com', 'bdstatic.com', 'sinaimg.cn', 'weibocdn.com',
  'alicdn.com', 'taobaocdn.com', 'tmall.com',
  'douyinstatic.com',
  'iqiyi.com', 'qiyipic.com',
  'youku.com', 'ykimg.com',
  'v.qq.com', 'qqvideo.com',
  'zhihu.com', 'zhimg.com',
  'cdninstagram.com', 'fbcdn.net',
  'twimg.com', 'gstatic.com', 'googleusercontent.com',
  'wp.com', 'wordpress.com',
  'medium.com', 'miro.medium.com'
];

// 视频 CDN 域名（无标准扩展名但实际是视频）
const videoCdnDomains = [
  'hdslb.com', 'bilivideo.com', 'bilivideo.cn',
  'douyinvod.com', 'douyinstatic.com',
  'iqiyi.com', 'qiyipic.com',
  'youku.com', 'ykimg.com',
  'v.qq.com', 'qqvideo.com',
  'weibocdn.com', 'sinaimg.cn'
];

function isImageCdnUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return imageCdnDomains.some(d => hostname.endsWith(d) || hostname === d);
  } catch { return false; }
}

function isVideoCdnUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return videoCdnDomains.some(d => hostname.endsWith(d) || hostname === d);
  } catch { return false; }
}

// 过滤无法预览的资源（blob: URL、无扩展名的 CDN 流等）
function filterPreviewableResources(resources) {
  const result = { images: [], videos: [], audios: [], links: [], texts: [] };
  if (!resources) return result;

  // 图片：过滤 blob: 和 data:，保留 http/https URL（包括 CDN 域名）
  result.images = (resources.images || []).filter(img => {
    const url = typeof img === 'string' ? img : img.url;
    if (!url) return false;
    if (url.startsWith('blob:') || url.startsWith('data:')) return false;
    // 有标准图片扩展名 或 来自已知图片 CDN
    const ext = getExt(url);
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff'].includes(ext) || isImageCdnUrl(url);
  });

  // 视频：保留 blob: URL（MSE 流媒体）、标准视频扩展名、视频 CDN 域名
  result.videos = (resources.videos || []).filter(v => {
    const url = typeof v === 'string' ? v : v.url;
    if (!url) return false;
    // 保留 blob: URL（MSE 流媒体视频）
    if (url.startsWith('blob:')) return true;
    if (url.startsWith('data:')) return false;
    const ext = getExt(url);
    return ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'flv', 'm3u8', 'ts'].includes(ext) || isVideoCdnUrl(url);
  });

  // 音频：只保留有标准音频扩展名的，过滤 blob:
  result.audios = (resources.audios || []).filter(a => {
    const url = typeof a === 'string' ? a : a.url;
    if (!url) return false;
    if (url.startsWith('blob:') || url.startsWith('data:')) return false;
    const ext = getExt(url);
    return ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma'].includes(ext);
  });

  // 链接和文本：全部保留
  result.links = resources.links || [];
  result.texts = resources.texts || [];
  return result;
}

// 获取当前页面标题（用于文件命名）
function getCurrentPageTitle() {
  return pageTitle && pageTitle.textContent && pageTitle.textContent !== '--'
    ? pageTitle.textContent
    : null;
}

// 将元素资源追加到 selectedResources（按 URL/内容去重）
function appendToSelectedResources(resources) {
  if (!selectedResources) selectedResources = createEmptySelectedResources();

  const currentPageTitle = getCurrentPageTitle();

  // 图片
  (resources.images || []).forEach(img => {
    const url = typeof img === 'string' ? img : img.url;
    if (!url) return;
    if (selectedResources.images.some(r => r.url === url)) return;
    selectedResources.images.push({
      type: 'image', url: url,
      name: (img && img.name) || getFileName(url),
      format: (img && img.format) || (getExt(url) || 'jpg').toUpperCase(),
      width: img && img.width, height: img && img.height,
      pageTitle: currentPageTitle  // 保存页面标题用于导出命名
    });
  });

  // 视频
  (resources.videos || []).forEach(v => {
    const url = typeof v === 'string' ? v : v.url;
    if (!url) return;
    // blob: URL 用 streamType 或序号去重，避免重复添加
    if (selectedResources.videos.some(r => r.url === url || (url.startsWith('blob:') && r.url.startsWith('blob:') && r.streamType === (v && v.streamType)))) return;
    const videoItem = {
      type: 'video', url: url,
      name: (v && v.name) || (url.startsWith('blob:') ? '流媒体视频' : getFileName(url)),
      format: (v && v.format) || (url.startsWith('blob:') ? 'BLOB' : (getExt(url) || 'mp4').toUpperCase()),
      duration: v && v.duration,
      streamType: v && v.streamType,
      localPath: null,      // 预处理后的本地文件路径
      processing: false,    // 是否正在预处理
      processed: false,     // 是否已完成预处理
      pageTitle: currentPageTitle  // 保存页面标题用于导出命名
    };
    selectedResources.videos.push(videoItem);
    // 对流媒体视频提前预处理（blob:/m3u8/无扩展名 CDN 流）
    preprocessVideoIfNeeded(videoItem);
  });

  // 音频
  (resources.audios || []).forEach(a => {
    const url = typeof a === 'string' ? a : a.url;
    if (!url) return;
    if (selectedResources.audios.some(r => r.url === url)) return;
    selectedResources.audios.push({
      type: 'audio', url: url,
      name: (a && a.name) || getFileName(url),
      format: (a && a.format) || (getExt(url) || 'mp3').toUpperCase(),
      pageTitle: currentPageTitle  // 保存页面标题用于导出命名
    });
  });

  // 链接
  (resources.links || []).forEach(l => {
    const url = l && (l.url || l);
    if (!url || typeof url !== 'string') return;
    if (selectedResources.links.some(r => r.url === url)) return;
    selectedResources.links.push({
      type: 'link', url: url,
      name: (l && (l.text || l.name)) || getFileName(url),
      format: 'LINK',
      pageTitle: currentPageTitle
    });
  });

  // 文本（按内容去重）
  (resources.texts || []).forEach(tx => {
    const content = (tx && (tx.content || tx.text)) || '';
    if (!content) return;
    if (selectedResources.texts.some(r => r.content === content)) return;
    selectedResources.texts.push({
      type: 'text',
      name: (tx && tx.name) || content.substring(0, 30) || 'text',
      content: content,
      length: content.length,
      pageTitle: currentPageTitle
    });
  });
}

// 同步 selected Set：用于主资源标签页卡片高亮（保留旧 Set 机制以兼容卡片选中态显示）
function syncSelectedSetFromSelectedResources() {
  if (!selected) return;
  // 清空并重建
  selected.clear();
  if (!selectedResources) return;
  selectedResources.images.forEach(r => selected.add(r.url));
  selectedResources.videos.forEach(r => selected.add(r.url));
  selectedResources.audios.forEach(r => selected.add(r.url));
  selectedResources.links.forEach(r => selected.add(r.url));
  // 文本通过内容前 20 字符标识
  selectedResources.texts.forEach(r => selected.add('text_' + (r.content || '').substring(0, 20)));
}

// 判断视频是否需要预处理（blob:/m3u8/无扩展名 CDN 流）
function needsPreprocess(url) {
  if (!url) return false;
  // B站页面视频不需要预处理，导出时用专用下载（fnval=0 单文件 MP4）
  if (isBilibiliVideoUrl(currentUrl)) return false;
  if (url.startsWith('blob:')) return true;
  if (url.includes('.m3u8') || getExt(url) === 'm3u8') return true;
  // 无扩展名且来自视频 CDN
  const ext = getExt(url);
  if (!ext && isVideoCdnUrl(url)) return true;
  return false;
}

// 对单个视频项进行预处理（提前转码为可播放的本地文件）
async function preprocessVideoIfNeeded(videoItem) {
  if (!videoItem || videoItem.processing || videoItem.processed) return;
  if (!needsPreprocess(videoItem.url)) return;

  videoItem.processing = true;
  renderSelectedResources();

  try {
    if (!window.electronAPI || !window.electronAPI.preprocessVideo) return;
    const result = await window.electronAPI.preprocessVideo(videoItem.url, currentUrl, videoItem.name);
    if (result && result.success) {
      if (result.localPath) {
        // blob:/m3u8 已下载到本地临时文件
        videoItem.localPath = result.localPath;
        videoItem.format = (result.ext || 'mp4').toUpperCase();
        videoItem.processed = true;
        videoItem.streamType = '已转码';
        showToast(`视频已转码: ${videoItem.name}`);
      } else if (result.ext) {
        // 普通 HTTP 仅修正扩展名
        videoItem.format = result.ext.toUpperCase();
        videoItem.processed = true;
      }
    } else {
      videoItem.streamType = '转码失败';
      console.error('视频预处理失败:', videoItem.url, result && result.error);
    }
  } catch (e) {
    videoItem.streamType = '转码失败';
    console.error('视频预处理异常:', videoItem.url, e);
  } finally {
    videoItem.processing = false;
    renderSelectedResources();
  }
}

// updateSelectedElementInfo 已移除：元素信息现在显示在独立的元素标签页中


// ============ 更新统计 ============
function updateStats() {
  if (!currentData) return;
  currentData.stats = {
    images: currentData.images.length,
    videos: currentData.videos.length,
    audios: currentData.audios.length,
    links: currentData.links.length,
    documents: currentData.documents.length,
    texts: currentData.texts.length,
    total: currentData.images.length + currentData.videos.length + currentData.audios.length +
           currentData.links.length + currentData.documents.length + currentData.texts.length
  };
}

// ============ 更新三层面板 ============
function updateAll() {
  if (!currentData) return;

  // 始终显示 layerPanels（包含已选/文本层标签）
  layerPanels.style.display = 'flex';
  layerPanels.style.flexDirection = 'column';
  emptyState.classList.add('hidden');

  // 应用资源层可见性设置（隐藏/显示资源层tab）
  applyResourceLayerVisibility();

  // 资源标签页总数 = 图片 + 视频 + 音频 + 链接
  const resourceTotal = currentData.stats.images + currentData.stats.videos + currentData.stats.audios + currentData.stats.links + currentData.stats.documents;
  if (tabCountResources) tabCountResources.textContent = resourceTotal;
  if (tabCountTexts) tabCountTexts.textContent = currentData.stats.texts;
  if (subImageCount) subImageCount.textContent = currentData.stats.images;
  if (subVideoCount) subVideoCount.textContent = currentData.stats.videos;
  if (subAudioCount) subAudioCount.textContent = currentData.stats.audios;
  if (subLinkCount) subLinkCount.textContent = currentData.stats.links + currentData.stats.documents;
  // 更新固定信息区页面标题
  if (infoPageTitle) infoPageTitle.textContent = pageTitle.textContent || currentUrl || '--';

  renderThreeLayers();
}

// ============ 渲染三层资源 ============
function renderThreeLayers() {
  if (!currentData) return;

  renderMediaCards(currentData.images, imageList, 'image');
  renderMediaCards(currentData.videos, videoList, 'video');
  renderMediaCards(currentData.audios, audioList, 'audio');
  renderLinks(currentData.links, linkList);
  renderTexts(currentData.texts, textList);

  updateSelectionCount();
}

// ============ 渲染媒体卡片（图片/视频/音频） ============
function renderMediaCards(data, container, mediaType, isRemovable = false) {
  if (!container) return;
  container.innerHTML = '';

  if (!data || data.length === 0) {
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--text-dim);font-size:11px;">${t('noResources')}</div>`;
    return;
  }

  data.forEach((item, idx) => {
    const key = item.url;
    const isSel = selected.has(key);
    const card = document.createElement('div');
    card.className = 'resource-card' + (isSel ? ' selected' : '');
    card.dataset.url = key;
    card.dataset.mediaType = mediaType;
    card.dataset.index = idx;
    if (isRemovable) card.style.cursor = 'pointer';

    let preview;
    if (mediaType === 'image') {
      preview = `<img src="${escapeHtml(item.url)}" loading="lazy" onerror="this.parentElement.innerHTML='<span class=\\'icon-large\\'>🖼️</span>'">`;
    } else if (mediaType === 'video') {
      preview = '<span class="icon-large">🎬</span>';
    } else {
      preview = '<span class="icon-large"></span>';
    }

    let metaHtml = `<span>${item.format || ''}</span>`;
    if (item.width && item.height) metaHtml += `<span>${item.width}x${item.height}</span>`;
    if (item.duration) metaHtml += `<span>${item.duration}</span>`;
    if (item.processing) {
      metaHtml += `<span style="color:var(--warning);">⏳ 转码中...</span>`;
    } else if (item.localPath) {
      metaHtml += `<span style="color:var(--success);">✓ 已转码</span>`;
    } else if (item.streamType) {
      metaHtml += `<span>${item.streamType}</span>`;
    }

    card.innerHTML = `
      <div class="card-preview">${preview}</div>
      <div class="card-info">
        <div class="card-name" title="${escapeHtml(item.name || item.url)}">${escapeHtml(item.name || item.url)}</div>
        <div class="card-meta">${metaHtml}</div>
      </div>
      <div class="card-check"></div>`;

    // 仅已选面板的卡片支持点击移除（先取消勾选再移除）
    if (isRemovable) {
      card.addEventListener('click', () => {
        // 先取消勾选（视觉反馈）
        card.classList.remove('selected');
        // 然后移除已选内容
        removeFromSelectedResources(mediaType, idx);
      });
    }

    container.appendChild(card);
  });
}

// 从已选资源中移除指定项
function removeFromSelectedResources(mediaType, idx) {
  if (!selectedResources) return;

  let removed = false;
  if (mediaType === 'image' && selectedResources.images[idx]) {
    selectedResources.images.splice(idx, 1);
    removed = true;
  } else if (mediaType === 'video' && selectedResources.videos[idx]) {
    selectedResources.videos.splice(idx, 1);
    removed = true;
  } else if (mediaType === 'audio' && selectedResources.audios[idx]) {
    selectedResources.audios.splice(idx, 1);
    removed = true;
  }

  if (removed) {
    syncSelectedSetFromSelectedResources();
    renderSelectedResources();
    updateSelectionCount();
    updateExportBar();
    showToast('已移除资源');
  }
}

// ============ 渲染链接列表 ============
function renderLinks(data, container, isRemovable = false) {
  if (!container) return;
  container.innerHTML = '';

  const allLinks = [...(data || []), ...((currentData && currentData.documents) || [])];

  if (allLinks.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-dim);font-size:11px;">${t('noResources')}</div>`;
    return;
  }

  allLinks.forEach((item, idx) => {
    const key = item.url;
    const isSel = selected.has(key);
    const row = document.createElement('div');
    row.className = 'link-row' + (isSel ? ' selected' : '');
    row.dataset.index = idx;
    if (isRemovable) row.style.cursor = 'pointer';

    const icon = item.type === 'document' ? '' : '🔗';
    row.innerHTML = `
      <span class="link-icon">${icon}</span>
      <span class="link-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      <span class="link-url" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</span>
      <span class="link-check"></span>`;

    // 仅已选面板支持点击移除（先取消勾选再移除）
    if (isRemovable) {
      row.addEventListener('click', () => {
        row.classList.remove('selected');
        removeFromSelectedLink(idx);
      });
    }

    container.appendChild(row);
  });
}

// 从已选资源中移除链接
function removeFromSelectedLink(idx) {
  if (!selectedResources || !selectedResources.links[idx]) return;
  selectedResources.links.splice(idx, 1);
  syncSelectedSetFromSelectedResources();
  renderSelectedResources();
  updateSelectionCount();
  updateExportBar();
  showToast('已移除链接');
}

// ============ 渲染文本列表 ============
function renderTexts(data, container, isRemovable = false) {
  if (!container) return;
  container.innerHTML = '';

  if (!data || data.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-dim);font-size:11px;">${t('noResources')}</div>`;
    return;
  }

  data.forEach((item, idx) => {
    // 使用内容前 20 字符作为 key，与 syncSelectedSetFromSelectedResources 保持一致
    const key = 'text_' + (item.content || '').substring(0, 20);
    const isSel = selected.has(key);
    const block = document.createElement('div');
    block.className = 'text-block' + (isSel ? ' selected' : '');
    block.dataset.index = idx;
    if (isRemovable) block.style.cursor = 'pointer';

    block.innerHTML = `
      <div class="text-header">
        <span style="font-size:12px;color:var(--primary);">${escapeHtml(item.name)}</span>
        <span style="font-size:11px;color:var(--text-dim);">${item.length} ${t('chars')}</span>
      </div>
      <div class="text-content">${escapeHtml(item.content)}</div>`;

    // 仅已选面板支持点击移除（先取消勾选再移除）
    if (isRemovable) {
      block.addEventListener('click', () => {
        block.classList.remove('selected');
        removeFromSelectedText(idx);
      });
    }

    container.appendChild(block);
  });
}

// 从已选资源中移除文本
function removeFromSelectedText(idx) {
  if (!selectedResources || !selectedResources.texts[idx]) return;
  selectedResources.texts.splice(idx, 1);
  syncSelectedSetFromSelectedResources();
  renderSelectedResources();
  updateSelectionCount();
  updateExportBar();
  showToast('已移除文本');
}

// 全部取消勾选：清空所有已选资源
function clearAllSelected() {
  if (!selectedResources) return;
  const total = getSelectedTotal();
  if (total === 0) { showToast('已选资源为空'); return; }

  selectedResources.images = [];
  selectedResources.videos = [];
  selectedResources.audios = [];
  selectedResources.links = [];
  selectedResources.texts = [];

  syncSelectedSetFromSelectedResources();
  renderSelectedResources();
  updateSelectionCount();
  updateExportBar();
  showToast(`已清空 ${total} 个已选资源`);
}

// toggleSelect/updateSelectionVisual 已移除：已选资源通过抓取模式下点击元素提取，不再手动勾选

function updateSelectionCount() {
  const total = getSelectedTotal();
  selectedCount.textContent = t('selected') + ': ' + total;
  if (tabCountSelected) tabCountSelected.textContent = total;
}

function updateExportBar() {
  const total = getSelectedTotal();
  const buttons = document.querySelectorAll('.export-actions button');
  buttons.forEach(btn => {
    if (total === 0) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    }
  });
}

function renderSelectedResources() {
  // 直接从 selectedResources 数组渲染（独立于 currentData）
  if (!selectedResources) selectedResources = createEmptySelectedResources();

  const imgs = selectedResources.images;
  const vids = selectedResources.videos;
  const auds = selectedResources.audios;
  const lnks = selectedResources.links;
  const txts = selectedResources.texts;

  if (subSelectedImageCount) subSelectedImageCount.textContent = imgs.length;
  if (subSelectedVideoCount) subSelectedVideoCount.textContent = vids.length;
  if (subSelectedAudioCount) subSelectedAudioCount.textContent = auds.length;
  if (subSelectedLinkCount) subSelectedLinkCount.textContent = lnks.length;
  if (subSelectedTextCount) subSelectedTextCount.textContent = txts.length;

  renderMediaCards(imgs, selectedImageList, 'image', true);
  renderMediaCards(vids, selectedVideoList, 'video', true);
  renderMediaCards(auds, selectedAudioList, 'audio', true);
  renderLinks(lnks, selectedLinkList, true);
  renderTexts(txts, selectedTextList, true);

  // 更新已选标签页总数
  const totalCount = imgs.length + vids.length + auds.length + lnks.length + txts.length;
  if (tabCountSelected) tabCountSelected.textContent = totalCount;
}

// ============ 进度条 ============

function showProgressBar(data) {
  if (!progressBarContainer) return;

  progressBarContainer.classList.add('show');

  if (progressPercent) {
    progressPercent.textContent = data.progress + '%';
  }

  if (progressBarFill) {
    progressBarFill.style.width = data.progress + '%';
  }

  if (progressDetail && data.downloaded !== undefined && data.total !== undefined) {
    const downloadedMB = (data.downloaded / 1048576).toFixed(1);
    const totalMB = (data.total / 1048576).toFixed(1);
    progressDetail.textContent = `${downloadedMB} MB / ${totalMB} MB`;
  }

  if (progressStatus) {
    if (data.progress === 100) {
      progressStatus.textContent = '完成';
    } else if (data.progress > 0) {
      progressStatus.textContent = '下载中...';
    } else {
      progressStatus.textContent = '准备中...';
    }
  }

  if (progressTitle) {
    progressTitle.textContent = data.progress === 100 ? '下载完成' : '正在下载...';
  }

  // 自动隐藏（5秒后）
  if (data.progress === 100) {
    setTimeout(() => hideProgressBar(), 5000);
  }
}

function hideProgressBar() {
  if (progressBarContainer) {
    progressBarContainer.classList.remove('show');
  }
}

// ============ 导出（只处理已选资源） ============

// 获取安全文件名
function safeFileName(name) {
  return (name || 'resource').replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
}

// 判断是否为B站视频 URL
function isBilibiliVideoUrl(url) {
  if (!url) return false;
  return url.includes('bilibili.com/video/') || /^BV\w+/.test(url);
}

// 导出已选资源到文件夹
// ============ 导出对话框 ============

let exportDialogData = null; // 当前导出对话框数据

// 打开导出对话框（先显示对话框，在对话框内选择目录）
function exportToFolder() {
  const total = getSelectedTotal();
  if (total === 0) { showToast('请先在已选资源中选择内容'); return; }

  // 准备导出文件列表
  const files = [];
  
  // 图片
  for (const res of (selectedResources.images || [])) {
    if (!res.url) continue;
    const baseName = res.pageTitle || res.name || res.url.split('/').pop() || 'image';
    const name = safeFileName(baseName);
    files.push({
      type: 'image',
      name: name,
      url: res.url,
      format: 'jpg',
      resource: res
    });
  }

  // 视频
  const isBilibiliPage = isBilibiliVideoUrl(currentUrl);
  for (const res of (selectedResources.videos || [])) {
    if (!res.url) continue;
    const baseName = res.pageTitle || res.name || 'video';
    const name = safeFileName(baseName);
    files.push({
      type: 'video',
      name: name,
      url: res.url,
      format: 'mp4',
      resource: res,
      isBilibili: isBilibiliPage
    });
  }

  // 音频
  for (const res of (selectedResources.audios || [])) {
    if (!res.url) continue;
    const baseName = res.pageTitle || res.name || res.url.split('/').pop() || 'audio';
    const name = safeFileName(baseName);
    files.push({
      type: 'audio',
      name: name,
      url: res.url,
      format: 'mp3',
      resource: res
    });
  }

  // 链接
  for (const link of (selectedResources.links || [])) {
    if (!link.url) continue;
    const baseName = link.pageTitle || link.name || 'link';
    const name = safeFileName(baseName);
    files.push({
      type: 'link',
      name: name,
      url: link.url,
      format: 'txt',
      resource: link
    });
  }

  // 文本
  for (const txt of (selectedResources.texts || [])) {
    if (!txt.content) continue;
    const baseName = txt.pageTitle || txt.name || 'text';
    const name = safeFileName(baseName);
    files.push({
      type: 'text',
      name: name,
      content: txt.content,
      format: 'txt',
      resource: txt
    });
  }

  // 保存导出对话框数据
  exportDialogData = {
    dir: null, // 稍后在对话框内选择
    files: files,
    selectedFormats: {}
  };

  // 初始化格式选择
  files.forEach((f, idx) => {
    exportDialogData.selectedFormats[idx] = f.format;
  });

  // 显示导出对话框
  showExportDialog();
}

// 显示导出对话框
async function showExportDialog() {
  if (!exportDialogData) return;

  // 隐藏 BrowserView，防止遮挡对话框
  if (window.electronAPI && window.electronAPI.setBrowserviewVisible) {
    await window.electronAPI.setBrowserviewVisible(false);
  }

  const overlay = document.getElementById('exportDialogOverlay');
  const formatOptions = document.getElementById('exportFormatOptions');
  const fileList = document.getElementById('exportFileList');
  const startBtn = document.getElementById('startExportBtn');

  // 生成格式选项（按类型分组）
  const formatGroups = {
    video: ['mp4', 'webm', 'avi', 'mkv'],
    audio: ['mp3', 'wav', 'aac', 'flac'],
    image: ['jpg', 'png', 'webp', 'gif'],
    text: ['txt', 'pdf', 'docx'],
    link: ['txt', 'pdf', 'docx']
  };

  // 获取当前选中的文件类型（去重）
  const types = [...new Set(exportDialogData.files.map(f => f.type))];
  
  // 生成格式按钮
  formatOptions.innerHTML = '';
  types.forEach(type => {
    const formats = formatGroups[type] || ['txt'];
    const label = document.createElement('div');
    label.className = 'export-format-label';
    label.style.marginTop = '12px';
    label.textContent = getTypeName(type) + '：';
    formatOptions.appendChild(label);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'export-format-options';
    btnGroup.style.marginBottom = '8px';
    
    formats.forEach(fmt => {
      const btn = document.createElement('button');
      btn.className = 'export-format-btn';
      btn.textContent = fmt.toUpperCase();
      btn.dataset.type = type;
      btn.dataset.format = fmt;
      btn.onclick = () => selectFormat(type, fmt);
      btnGroup.appendChild(btn);
    });
    
    formatOptions.appendChild(btnGroup);
  });

  // 生成文件列表
  fileList.innerHTML = '';
  exportDialogData.files.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'export-file-item';
    item.id = `export-file-${idx}`;
    
    const header = document.createElement('div');
    header.className = 'export-file-header';
    
    const nameSpan = document.createElement('div');
    nameSpan.className = 'export-file-name';
    nameSpan.textContent = `${file.name}.${exportDialogData.selectedFormats[idx]}`;
    
    const statusSpan = document.createElement('div');
    statusSpan.className = 'export-file-status';
    statusSpan.id = `export-status-${idx}`;
    statusSpan.textContent = '等待中';
    
    header.appendChild(nameSpan);
    header.appendChild(statusSpan);
    
    const progressBar = document.createElement('div');
    progressBar.className = 'export-progress-bar';
    
    const progressFill = document.createElement('div');
    progressFill.className = 'export-progress-fill';
    progressFill.id = `export-progress-${idx}`;
    
    progressBar.appendChild(progressFill);
    
    // 下载量显示区域
    const downloadInfo = document.createElement('div');
    downloadInfo.className = 'export-file-download-info';
    downloadInfo.id = `export-download-info-${idx}`;
    
    // 错误信息显示区域
    const errorSpan = document.createElement('div');
    errorSpan.className = 'export-file-error';
    errorSpan.id = `export-error-${idx}`;
    errorSpan.style.display = 'none';
    
    item.appendChild(header);
    item.appendChild(progressBar);
    item.appendChild(downloadInfo);
    item.appendChild(errorSpan);
    fileList.appendChild(item);
  });

  // 更新格式按钮选中状态
  updateFormatButtons();

  // 显示对话框
  overlay.classList.add('show');
  startBtn.disabled = false;
  startBtn.textContent = '开始导出';
}

// 关闭导出对话框
async function closeExportDialog() {
  const overlay = document.getElementById('exportDialogOverlay');
  overlay.classList.remove('show');
  exportDialogData = null;
  
  // 恢复 BrowserView
  if (window.electronAPI && window.electronAPI.setBrowserviewVisible) {
    await window.electronAPI.setBrowserviewVisible(true);
  }
}

// 选择格式
function selectFormat(type, format) {
  if (!exportDialogData) return;
  
  // 更新所有该类型文件的格式
  exportDialogData.files.forEach((file, idx) => {
    if (file.type === type) {
      exportDialogData.selectedFormats[idx] = format;
    }
  });

  updateFormatButtons();
  updateFileNames();
}

// 更新格式按钮选中状态
function updateFormatButtons() {
  if (!exportDialogData) return;
  
  const buttons = document.querySelectorAll('.export-format-btn');
  buttons.forEach(btn => {
    const type = btn.dataset.type;
    const format = btn.dataset.format;
    
    // 检查该类型是否选择了这个格式
    const isSelected = exportDialogData.files.some((file, idx) => 
      file.type === type && exportDialogData.selectedFormats[idx] === format
    );
    
    if (isSelected) {
      btn.classList.add('selected');
    } else {
      btn.classList.remove('selected');
    }
  });
}

// 更新文件名显示
function updateFileNames() {
  if (!exportDialogData) return;
  
  exportDialogData.files.forEach((file, idx) => {
    const nameSpan = document.querySelector(`#export-file-${idx} .export-file-name`);
    if (nameSpan) {
      nameSpan.textContent = `${file.name}.${exportDialogData.selectedFormats[idx]}`;
    }
  });
}

// 格式化字节数为 MB
function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 MB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 获取类型中文名
function getTypeName(type) {
  const names = {
    image: '图片',
    video: '视频',
    audio: '音频',
    link: '链接',
    text: '文本'
  };
  return names[type] || type;
}

// 获取导出错误消息（友好的中文提示）
function getExportErrorMessage(error) {
  if (!error) return '未知错误';
  
  const errorMsg = error.message || error.toString();
  
  // 网络相关错误
  if (errorMsg.includes('ENOTFOUND') || errorMsg.includes('getaddrinfo')) {
    return '无网络连接，请检查网络';
  }
  if (errorMsg.includes('ETIMEDOUT') || errorMsg.includes('timeout')) {
    return '连接超时，请重试';
  }
  if (errorMsg.includes('ECONNREFUSED')) {
    return '连接被拒绝，服务器可能已关闭';
  }
  if (errorMsg.includes('ECONNRESET')) {
    return '连接被重置，请重试';
  }
  if (errorMsg.includes('ENETUNREACH')) {
    return '网络不可达，请检查网络连接';
  }
  
  // HTTP 错误
  if (errorMsg.includes('HTTP 404') || errorMsg.includes('404')) {
    return '文件不存在（404）';
  }
  if (errorMsg.includes('HTTP 403') || errorMsg.includes('403')) {
    return '访问被拒绝（403）';
  }
  if (errorMsg.includes('HTTP 5')) {
    return '服务器错误，请稍后重试';
  }
  
  // 文件操作错误
  if (errorMsg.includes('EPERM') || errorMsg.includes('EACCES')) {
    return '权限不足，无法写入文件';
  }
  if (errorMsg.includes('ENOSPC')) {
    return '磁盘空间不足';
  }
  
  // 视频处理错误
  if (errorMsg.includes('视频下载失败')) {
    return '视频下载失败，可能已被删除或需要登录';
  }
  if (errorMsg.includes('下载内容为空')) {
    return '下载内容为空，请检查网络连接';
  }
  
  // 默认返回原始错误消息（截取前50字符）
  return errorMsg.substring(0, 50);
}

// 开始导出
async function startExport() {
  if (!exportDialogData) return;

  // 先选择导出目录
  if (!exportDialogData.dir) {
    const dir = await window.electronAPI.selectDirectory();
    if (!dir) {
      showToast('未选择导出目录');
      return;
    }
    exportDialogData.dir = dir;
  }

  const startBtn = document.getElementById('startExportBtn');
  startBtn.disabled = true;
  startBtn.textContent = '导出中...';

  statusText.textContent = '正在导出已选资源...';
  let count = 0;
  let failed = 0;

  // 逐个导出文件
  for (let idx = 0; idx < exportDialogData.files.length; idx++) {
    const file = exportDialogData.files[idx];
    const format = exportDialogData.selectedFormats[idx];
    const statusSpan = document.getElementById(`export-status-${idx}`);
    const progressFill = document.getElementById(`export-progress-${idx}`);
    const errorSpan = document.getElementById(`export-error-${idx}`);

    try {
      statusSpan.textContent = '导出中...';
      statusSpan.className = 'export-file-status';
      if (errorSpan) errorSpan.style.display = 'none';
      progressFill.style.width = '0%';

      if (file.type === 'image') {
        await exportImage(file, format, idx);
      } else if (file.type === 'video') {
        await exportVideo(file, format, idx);
      } else if (file.type === 'audio') {
        await exportAudio(file, format, idx);
      } else if (file.type === 'link') {
        await exportLink(file, format, idx);
      } else if (file.type === 'text') {
        await exportText(file, format, idx);
      }

      progressFill.style.width = '100%';
      statusSpan.textContent = '完成';
      statusSpan.className = 'export-file-status success';
      count++;
    } catch (e) {
      console.error(`导出失败: ${file.name}`, e);
      const errorMsg = getExportErrorMessage(e);
      statusSpan.textContent = '失败';
      statusSpan.className = 'export-file-status error';
      if (errorSpan) {
        errorSpan.textContent = errorMsg;
        errorSpan.style.display = 'block';
      }
      failed++;
    }
  }

  statusText.textContent = `导出完成: ${count} 成功, ${failed} 失败`;
  showToast(`导出完成: ${count} 个文件${failed > 0 ? ', ' + failed + ' 个失败' : ''}`);
  
  startBtn.textContent = '导出完成';
  setTimeout(() => closeExportDialog(), 2000);
}

// 导出图片
async function exportImage(file, format, idx) {
  const progressFill = document.getElementById(`export-progress-${idx}`);
  const statusSpan = document.getElementById(`export-status-${idx}`);
  const downloadInfo = document.getElementById(`export-download-info-${idx}`);
  const destPath = `${exportDialogData.dir}\\${file.name}.${format}`;

  // 下载时间追踪
  const startTime = Date.now();

  // 监听进度
  let removeListener = null;
  const progressHandler = (data) => {
    if (data && data.fileId === idx && typeof data.progress === 'number') {
      progressFill.style.width = data.progress + '%';
      if (data.statusText && statusSpan) {
        statusSpan.textContent = data.statusText;
      }
      if (downloadInfo && data.downloaded !== undefined) {
        const elapsed = Date.now() - startTime;
        const elapsedSec = Math.floor(elapsed / 1000);
        const timeStr = elapsedSec > 0 ? ` | ${elapsedSec}s` : '';
        downloadInfo.textContent = `${formatBytes(data.downloaded)} / ${formatBytes(data.total)}${timeStr}`;
      }
    }
  };

  if (window.electronAPI && window.electronAPI.onDownloadProgress) {
    removeListener = window.electronAPI.onDownloadProgress(progressHandler);
  }

  try {
    if (statusSpan) statusSpan.textContent = '下载中...';
    // 图片直接下载
    await window.electronAPI.downloadFile(file.url, destPath, currentUrl, idx);
    progressFill.style.width = '100%';
    if (statusSpan) statusSpan.textContent = '完成';
  } finally {
    if (removeListener) removeListener();
  }
}

// 导出视频
async function exportVideo(file, format, idx) {
  const progressFill = document.getElementById(`export-progress-${idx}`);
  const statusSpan = document.getElementById(`export-status-${idx}`);
  const downloadInfo = document.getElementById(`export-download-info-${idx}`);
  const destPath = `${exportDialogData.dir}\\${file.name}.${format}`;

  // 下载时间追踪
  const startTime = Date.now();
  let lastTimeUpdate = 0;

  // 监听进度
  let removeListener = null;
  let removeBilibiliListener = null;
  const progressHandler = (data) => {
    if (data && data.fileId === idx && typeof data.progress === 'number') {
      progressFill.style.width = data.progress + '%';
      if (data.statusText && statusSpan) {
        statusSpan.textContent = data.statusText;
      }
      if (downloadInfo && data.downloaded !== undefined) {
        const elapsed = Date.now() - startTime;
        const elapsedSec = Math.floor(elapsed / 1000);
        const timeStr = elapsedSec > 0 ? ` | ${elapsedSec}s` : '';
        downloadInfo.textContent = `${formatBytes(data.downloaded)} / ${formatBytes(data.total)}${timeStr}`;
      }
    }
  };

  if (window.electronAPI && window.electronAPI.onDownloadProgress) {
    removeListener = window.electronAPI.onDownloadProgress(progressHandler);
  }

  // B站视频下载进度监听（来自主进程转发的 bilibili-download-progress）
  if (file.isBilibili && window.electronAPI && window.electronAPI.onBilibiliDownloadProgress) {
    removeBilibiliListener = window.electronAPI.onBilibiliDownloadProgress((data) => {
      if (data && data.fileId === idx && typeof data.progress === 'number') {
        progressFill.style.width = data.progress + '%';
        if (statusSpan) statusSpan.textContent = `下载中 ${data.progress}%`;
        if (downloadInfo && data.downloaded !== undefined) {
          const elapsed = Date.now() - startTime;
          const elapsedSec = Math.floor(elapsed / 1000);
          const timeStr = elapsedSec > 0 ? ` | ${elapsedSec}s` : '';
          downloadInfo.textContent = `${formatBytes(data.downloaded)} / ${formatBytes(data.total)}${timeStr}`;
        }
      }
    });
  }

  try {
    let result;
    if (file.resource.localPath) {
      // 已预处理的本地文件，直接复制
      if (statusSpan) statusSpan.textContent = '复制文件...';
      result = await window.electronAPI.copyLocalFile(file.resource.localPath, destPath);
    } else if (file.isBilibili) {
      // B站视频
      if (statusSpan) statusSpan.textContent = '获取视频信息...';
      result = await window.electronAPI.downloadBilibiliVideo(currentUrl, destPath, currentUrl, idx);
    } else {
      // 其他视频
      if (statusSpan) statusSpan.textContent = '下载中...';
      result = await window.electronAPI.downloadVideoSmart(file.url, destPath, currentUrl, idx);
    }

    if (!result.success) {
      throw new Error(result.error || '视频下载失败');
    }

    progressFill.style.width = '100%';
    if (statusSpan) statusSpan.textContent = '完成';
  } finally {
    if (removeListener) removeListener();
    if (removeBilibiliListener) removeBilibiliListener();
  }
}

// 导出音频
async function exportAudio(file, format, idx) {
  const progressFill = document.getElementById(`export-progress-${idx}`);
  const statusSpan = document.getElementById(`export-status-${idx}`);
  const downloadInfo = document.getElementById(`export-download-info-${idx}`);
  const destPath = `${exportDialogData.dir}\\${file.name}.${format}`;

  // 下载时间追踪
  const startTime = Date.now();

  // 监听进度
  let removeListener = null;
  const progressHandler = (data) => {
    if (data && data.fileId === idx && typeof data.progress === 'number') {
      progressFill.style.width = data.progress + '%';
      if (data.statusText && statusSpan) {
        statusSpan.textContent = data.statusText;
      }
      if (downloadInfo && data.downloaded !== undefined) {
        const elapsed = Date.now() - startTime;
        const elapsedSec = Math.floor(elapsed / 1000);
        const timeStr = elapsedSec > 0 ? ` | ${elapsedSec}s` : '';
        downloadInfo.textContent = `${formatBytes(data.downloaded)} / ${formatBytes(data.total)}${timeStr}`;
      }
    }
  };

  if (window.electronAPI && window.electronAPI.onDownloadProgress) {
    removeListener = window.electronAPI.onDownloadProgress(progressHandler);
  }

  try {
    if (statusSpan) statusSpan.textContent = '下载中...';
    // 音频直接下载
    await window.electronAPI.downloadFile(file.url, destPath, currentUrl, idx);
    progressFill.style.width = '100%';
    if (statusSpan) statusSpan.textContent = '完成';
  } finally {
    if (removeListener) removeListener();
  }
}

// 导出链接
async function exportLink(file, format, idx) {
  const progressFill = document.getElementById(`export-progress-${idx}`);
  const destPath = `${exportDialogData.dir}\\${file.name}.${format}`;
  
  if (format === 'txt') {
    const content = `[InternetShortcut]\nURL=${file.url}\n`;
    await window.electronAPI.saveTextFile(destPath, content);
  } else if (format === 'pdf') {
    await window.electronAPI.saveTextAsPdf(destPath, file.url);
  } else if (format === 'docx') {
    await window.electronAPI.saveTextAsDocx(destPath, file.url);
  }
  
  progressFill.style.width = '100%';
}

// 导出文本
async function exportText(file, format, idx) {
  const progressFill = document.getElementById(`export-progress-${idx}`);
  const destPath = `${exportDialogData.dir}\\${file.name}.${format}`;
  
  if (format === 'txt') {
    await window.electronAPI.saveTextFile(destPath, file.content);
  } else if (format === 'pdf') {
    await window.electronAPI.saveTextAsPdf(destPath, file.content);
  } else if (format === 'docx') {
    await window.electronAPI.saveTextAsDocx(destPath, file.content);
  }
  
  progressFill.style.width = '100%';
}

// 下载选中资源（与 exportToFolder 相同，保留兼容）
async function downloadSelected() {
  await exportToFolder();
}

// 导出已选资源为 WSW 文件
async function exportToWSW() {
  const total = getSelectedTotal();
  if (total === 0) { showToast('请先在已选资源中选择内容'); return; }
  const filePath = await window.electronAPI.selectSaveFile({
    title: '保存 WSW 文件',
    defaultPath: (pageTitle.textContent || 'webscout') + '.wsw',
    filters: [{ name: 'WebShow 文件', extensions: ['wsw'] }]
  });
  if (!filePath) return;
  const wswData = {
    title: pageTitle.textContent, url: currentUrl,
    createdAt: new Date().toISOString(),
    resources: {
      images: selectedResources.images || [],
      videos: selectedResources.videos || [],
      audios: selectedResources.audios || [],
      links: selectedResources.links || [],
      texts: selectedResources.texts || []
    },
    stats: { total: getSelectedTotal() }
  };
  const result = await window.electronAPI.saveWSW(filePath, wswData);
  if (result.success) showToast('WSW 文件已保存');
  else showToast('保存失败: ' + result.error);
}

// 导出已选资源为 Excel 文件
async function exportToExcel() {
  const total = getSelectedTotal();
  if (total === 0) { showToast('请先在已选资源中选择内容'); return; }
  const filePath = await window.electronAPI.selectSaveFile({
    title: '保存 Excel 文件',
    defaultPath: (pageTitle.textContent || 'webscout') + '.xlsx',
    filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }]
  });
  if (!filePath) return;
  const rows = [];
  (selectedResources.images || []).forEach(r => rows.push({ 类型: '图片', 名称: r.name, 格式: r.format, URL: r.url }));
  (selectedResources.videos || []).forEach(r => rows.push({ 类型: '视频', 名称: r.name, 格式: r.format, URL: r.url }));
  (selectedResources.audios || []).forEach(r => rows.push({ 类型: '音频', 名称: r.name, 格式: r.format, URL: r.url }));
  (selectedResources.links || []).forEach(r => rows.push({ 类型: '链接', 名称: r.name, 格式: r.format, URL: r.url }));
  (selectedResources.texts || []).forEach(r => rows.push({ 类型: '文本', 名称: r.name, 内容: (r.content || '').substring(0, 500) }));
  const result = await window.electronAPI.saveExcel(filePath, rows);
  if (result.success) showToast('Excel 文件已保存');
  else showToast('保存失败: ' + result.error);
}

// ============ 工具函数 ============
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', () => {
  applyLanguage();
  loadShowResourceLayerSetting(); // 加载资源层显示设置（默认隐藏）
  loadThemeSetting(); // 加载主题设置
  statusText.textContent = t('ready');
  setupEventListeners();
  setupUrlInputListener();
  updateNavButtons();

  // 监听主进程发送的标签创建事件
  if (window.electronAPI && window.electronAPI.onTabCreated) {
    window.electronAPI.onTabCreated((data) => {
      console.log('[TAB] tab-created event:', data);
      if (data && data.tabId) {
        onTabCreatedFromMain(data.tabId, data.url, data.title);
        updateNavButtons();
      }
    });
  }

  // 监听非抓取模式下超链接点击：新建标签页并导航
  if (window.electronAPI && window.electronAPI.onLinkClicked) {
    window.electronAPI.onLinkClicked(async (url, fromTabId) => {
      if (!url) return;
      console.log('[LINK] non-capture link clicked, opening new tab:', url, 'from tab:', fromTabId);
      if (window.electronAPI && window.electronAPI.createTab) {
        const result = await window.electronAPI.createTab(url);
        if (result && result.tabId) {
          onTabCreatedFromMain(result.tabId, result.url, url);
          addToGlobalHistory(url);
        }
      }
    });
  }

  // 监听右键菜单触发的抓取模式切换：仅更新本地 UI 状态，不反向通知主进程（避免循环）
  if (window.electronAPI && window.electronAPI.onInspectModeChangedFromMain) {
    window.electronAPI.onInspectModeChangedFromMain((enabled) => {
      inspectMode = !!enabled;
      inspectToggle.classList.toggle('active', inspectMode);
      console.log('[INSPECT] mode changed from main menu:', inspectMode);
      // 同步资源面板显示状态：抓取模式开启时展开侧栏，关闭时不自动折叠（用户可手动折叠）
      if (inspectMode) {
        if (!sidebarVisible) {
          sidebarVisible = true;
          rightPanel.style.display = 'flex';
          sidebarToggle.textContent = '';
          if (window.electronAPI && window.electronAPI.setSidebarVisible) {
            window.electronAPI.setSidebarVisible(true);
          }
        }
      } else {
        // 关闭抓取模式：不自动折叠侧栏，仅重置抓取资源面板
        // 只隐藏资源层内容，不隐藏整个 layerPanels
        const paneResources = document.getElementById('paneResources');
        if (paneResources) paneResources.style.display = 'none';
        emptyState.classList.remove('hidden');
      }
    });
  }

  // 通知主进程渲染进程已就绪
  if (window.electronAPI && window.electronAPI.rendererReady) {
    window.electronAPI.rendererReady();
  }
});
