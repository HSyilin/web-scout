// WebScout 主应用逻辑
const App = {
  state: {
    tabs: [],
    activeTabId: null,
    resources: { images: [], videos: [], audios: [], links: [], downloads: [], texts: [] },
    selectedResources: { images: [], videos: [], audios: [], links: [], downloads: [], texts: [] },
    inspectMode: false,
    sidebarVisible: true,
    theme: 'dark',
    lang: 'zh',
    history: [],
    showResourceLayer: false,
    currentModule: 'scraper',
    downloadCancelled: false,
    selectedFilter: '',
    batchMode: false,
    batchSelected: new Set(),
    pendingWswLink: null  // 暂存的工作流→WSW容器链接 {workflowId, cardIndex, resourceType, resourceInfo}
  },

  init() {
    this.bindEvents();
    this.loadSettings();
    this.updateThemeUI();
    // 同步资源层初始显示状态（开局默认隐藏资源层，只显示已选）
    this.updateResourceLayerVisibility();

    // 通知主进程渲染进程已就绪，触发初始标签创建
    if (window.electronAPI?.rendererReady) {
      window.electronAPI.rendererReady();
    }

    // 监听主进程创建的标签
    if (window.electronAPI?.onTabCreated) {
      window.electronAPI.onTabCreated((data) => {
        const existing = this.state.tabs.find(t => t.id === data.tabId);
        if (!existing) {
          this.state.tabs.push({
            id: data.tabId,
            url: data.url,
            title: data.title || '新标签页'
          });
          this.renderTabs();
          // 初始标签（无活动标签）、通过超链接打开、或 window.open 触发的标签需要自动切换
          if (!this.state.activeTabId || this.state._pendingSwitch || data.autoSwitch) {
            this.switchToTab(data.tabId);
            this.state._pendingSwitch = false;
          }
        }
      });
    }
  },

  bindEvents() {
    // 窗口大小变化时更新 BrowserView
    window.addEventListener('resize', () => {
      if (this.state.currentModule === 'scraper' && window.electronAPI?.updateBrowserViewBounds) {
        window.electronAPI.updateBrowserViewBounds();
      }
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        this.addNewTab();
      }
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        if (this.state.activeTabId) this.closeTab(this.state.activeTabId);
      }
    });

    // 监听主进程事件
    if (window.electronAPI) {
      // 资源提取结果
      window.electronAPI.onResourcesExtracted((resources, tabId) => {
        // 类型保险：确保 tabId 为数字类型进行比较
        const numericTabId = Number(tabId);
        const numericActiveId = Number(this.state.activeTabId);
        if (numericTabId === numericActiveId || this.state.activeTabId === null) {
          this.processResources(resources);
        }
      });

      // 页面标题
      window.electronAPI.onPageTitle((title, tabId) => {
        const tab = this.state.tabs.find(t => t.id === tabId);
        if (tab) {
          tab.title = title;
          this.renderTabs();
        }
      });

      // 页面标题更新
      window.electronAPI.onBrowserPageTitleUpdated((title, tabId) => {
        const tab = this.state.tabs.find(t => t.id === tabId);
        if (tab) {
          tab.title = title;
          this.renderTabs();
        }
      });

      // 页面加载完成
      window.electronAPI.onBrowserDidFinishLoad((tabId) => {
        if (tabId === this.state.activeTabId) {
          this.showLoading(false);
          this.setStatus('加载完成');
        }
      });

      // 页面加载失败
      window.electronAPI.onBrowserDidFailLoad((detail, tabId) => {
        if (tabId === this.state.activeTabId) {
          this.showLoading(false);
          this.setStatus('加载失败');
          this.showToast('页面加载失败');
        }
      });

      // 页面导航
      window.electronAPI.onBrowserDidNavigate((url, tabId) => {
        if (tabId === this.state.activeTabId) {
          const urlInput = document.getElementById('urlInput');
          if (urlInput) urlInput.value = url;
          this.addToHistory(url);
        }
      });

      // 下载进度
      window.electronAPI.onDownloadProgress((data) => {
        this.updateDownloadProgress(data);
      });

      // 提取模式变化
      window.electronAPI.onInspectModeChanged((enabled) => {
        this.state.inspectMode = enabled;
        const btn = document.getElementById('inspectToggle');
        if (btn) btn.classList.toggle('active', enabled);
      });

      // 元素悬停预览
      window.electronAPI.onElementHoverPreview((data) => {
        this.updateHoverPreview(data);
      });

      // 元素悬停清除
      window.electronAPI.onElementHoverClear(() => {
        this.clearHoverPreview();
      });

      // 元素资源
      window.electronAPI.onElementResources((data) => {
        this.addElementResources(data);
      });

      // 网络拦截的媒体资源批量
      if (window.electronAPI.onMediaBatch) {
        window.electronAPI.onMediaBatch((mediaArray, tabId) => {
          const numericTabId = Number(tabId);
          const numericActiveId = Number(this.state.activeTabId);
          if (numericTabId === numericActiveId || this.state.activeTabId === null) {
            this.addMediaBatch(mediaArray);
          }
        });
      }

      // 超链接点击 - 创建新标签页
      window.electronAPI.onLinkClicked((url, tabId) => {
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
          this.addNewTab(url);
        }
      });
    }
  },

  processResources(resources) {
    if (!resources) return;

    // 合并模式：不清空已有资源，去重后合并新资源
    // 避免清空 addElementResources 和 addMediaBatch 添加的资源
    let totalCount = 0;
    let newCount = 0;

    // 辅助函数：去重添加
    const addUnique = (list, resource) => {
      const matchKey = resource.url || resource.content;
      if (!matchKey) return;
      if (!list.find(r => (r.url || r.content) === matchKey)) {
        list.push(resource);
        newCount++;
      }
    };

    if (Array.isArray(resources)) {
      // 数组格式：每个元素有 type 属性
      for (const resource of resources) {
        const type = resource.type || 'image';
        if (this.state.resources[type + 's']) {
          addUnique(this.state.resources[type + 's'], resource);
        } else if (type === 'text') {
          addUnique(this.state.resources.texts, resource);
        }
        totalCount++;
      }
    } else {
      // 对象格式：按类别处理
      const typeMap = { images: 'image', videos: 'video', audios: 'audio', links: 'link', downloads: 'download', texts: 'text' };
      for (const category in resources) {
        if (!resources.hasOwnProperty(category)) continue;
        const items = resources[category];
        if (!Array.isArray(items)) continue;
        const type = typeMap[category] || 'image';
        for (const item of items) {
          const resource = typeof item === 'string' ? { url: item, type } : { ...item, type };
          if (this.state.resources[category]) {
            addUnique(this.state.resources[category], resource);
          }
          totalCount++;
        }
      }
    }

    this.renderResources();
    this.updateResourceCounts();
    if (newCount > 0) {
      this.setStatus(`提取完成 — 新增 ${newCount} 个资源`);
    }
  },

  updateDownloadProgress(data) {
    const container = document.getElementById('progressContainer');
    if (!container) return;

    if (data.status === 'start') {
      container.classList.add('show');
      document.getElementById('progressTitle').textContent = data.title || '正在下载…';
    }

    if (data.percent !== undefined) {
      document.getElementById('progressPercent').textContent = Math.round(data.percent) + '%';
      document.getElementById('progressFill').style.width = data.percent + '%';
    }

    if (data.downloaded !== undefined && data.total !== undefined) {
      const downloadedMB = (data.downloaded / (1024 * 1024)).toFixed(1);
      const totalMB = (data.total / (1024 * 1024)).toFixed(1);
      document.getElementById('progressDetail').textContent = `${downloadedMB} MB / ${totalMB} MB`;
    }

    if (data.speed) {
      document.getElementById('progressStatus').textContent = data.speed;
    }

    if (data.status === 'complete' || data.status === 'error') {
      setTimeout(() => {
        container.classList.remove('show');
      }, 1500);
    }
  },

  updateHoverPreview(data) {
    const selector = document.getElementById('hoverPreviewSelector');
    const body = document.getElementById('hoverPreviewBody');

    if (selector) selector.textContent = data.selector || '--';
    if (body) {
      // 计算资源总数（resources 是对象，包含 images/videos/audios/links/texts 数组）
      let totalCount = 0;
      let textPreview = data.textPreview || '';
      if (data.resources) {
        const res = data.resources;
        if (Array.isArray(res.images)) totalCount += res.images.length;
        if (Array.isArray(res.videos)) totalCount += res.videos.length;
        if (Array.isArray(res.audios)) totalCount += res.audios.length;
        if (Array.isArray(res.links)) totalCount += res.links.length;
        if (Array.isArray(res.texts)) totalCount += res.texts.length;
      }
      // 构建预览内容
      let html = '<div style="font-size:11px;color:var(--text);line-height:1.6">';
      if (totalCount > 0) {
        html += `<div style="color:var(--accent);font-weight:600;margin-bottom:4px">${totalCount} 个资源</div>`;
        // 显示各类型数量
        const parts = [];
        if (data.resources?.images?.length) parts.push('🖼️ ' + data.resources.images.length);
        if (data.resources?.videos?.length) parts.push('🎬 ' + data.resources.videos.length);
        if (data.resources?.audios?.length) parts.push('🎵 ' + data.resources.audios.length);
        if (data.resources?.links?.length) parts.push('🔗 ' + data.resources.links.length);
        if (data.resources?.texts?.length) parts.push('📝 ' + data.resources.texts.length);
        if (parts.length > 0) {
          html += '<div style="font-size:10px;color:var(--text2);margin-bottom:4px">' + parts.join(' · ') + '</div>';
        }
      } else {
        html += '<div style="color:var(--text2)">无资源</div>';
      }
      // 显示文字预览
      if (textPreview) {
        html += '<div style="font-size:10px;color:var(--text2);margin-top:4px;border-top:1px solid var(--border);padding-top:4px;max-height:40px;overflow:hidden;word-break:break-all">' + this.escapeHtml(textPreview) + '</div>';
      }
      html += '</div>';
      body.innerHTML = html;
    }
  },

  clearHoverPreview() {
    const selector = document.getElementById('hoverPreviewSelector');
    const body = document.getElementById('hoverPreviewBody');

    if (selector) selector.textContent = '--';
    if (body) {
      body.innerHTML = '<div class="hover-preview-empty">启用抓取模式后悬停元素查看预览</div>';
    }
  },

  addElementResources(data) {
    if (!data || !data.resources) return;

    const resObj = data.resources;
    let addedCount = 0;
    let selectedAddedCount = 0;
    const videosToPreprocess = [];

    // 辅助函数：去重添加到指定列表
    const addUniqueToList = (list, resource) => {
      const matchKey = resource.url || resource.content;
      if (!matchKey) return false;
      if (!list.find(r => (r.url || r.content) === matchKey)) {
        list.push(resource);
        return true;
      }
      return false;
    };

    if (Array.isArray(resObj)) {
      for (const resource of resObj) {
        const type = resource.type || 'image';
        const typeKey = type + 's';
        const list = this.state.resources[typeKey] || this.state.resources.texts;
        const selectedList = this.state.selectedResources[typeKey] || this.state.selectedResources.texts;
        if (list && addUniqueToList(list, resource)) {
          addedCount++;
        }
        if (selectedList && addUniqueToList(selectedList, resource)) {
          selectedAddedCount++;
          // 视频资源添加到已选后触发预处理
          if (type === 'video') {
            videosToPreprocess.push(resource);
          }
        }
      }
    } else {
      const typeMap = { images: 'image', videos: 'video', audios: 'audio', links: 'link', downloads: 'download', texts: 'text' };
      for (const category in resObj) {
        if (!resObj.hasOwnProperty(category)) continue;
        const items = resObj[category];
        if (!Array.isArray(items)) continue;
        const type = typeMap[category] || 'image';
        const list = this.state.resources[category] || this.state.resources.texts;
        const selectedList = this.state.selectedResources[category] || this.state.selectedResources.texts;
        for (const item of items) {
          const resource = typeof item === 'string' ? { url: item, type } : { ...item, type };
          if (addUniqueToList(list, resource)) {
            addedCount++;
          }
          if (addUniqueToList(selectedList, resource)) {
            selectedAddedCount++;
            // 视频资源添加到已选后触发预处理
            if (type === 'video') {
              videosToPreprocess.push(resource);
            }
          }
        }
      }
    }

    this.renderResources();
    this.updateResourceCounts();

    // 异步触发视频预处理（不阻塞 UI）
    videosToPreprocess.forEach(resource => {
      this.preprocessVideoIfNeeded(resource);
    });

    // 基于添加到"已选"的数量给出反馈（即使资源已在"资源"面板中，新加入"已选"也应提示）
    if (selectedAddedCount > 0) {
      this.setStatus(`元素提取 — ${selectedAddedCount} 个资源已加入已选`);
      this.showToast(`已提取 ${selectedAddedCount} 个资源并加入已选`);
      // 自动切换到"已选"标签，让用户立即看到提取结果
      this.switchResourceTab('selected');
    } else if (addedCount > 0) {
      this.setStatus(`元素提取 — 新增 ${addedCount} 个资源`);
      this.showToast(`已提取 ${addedCount} 个资源`);
    }
  },

  // 网络拦截的媒体资源批量合并到当前资源列表
  addMediaBatch(mediaArray) {
    if (!Array.isArray(mediaArray) || mediaArray.length === 0) return;

    let addedCount = 0;
    const videosToPreprocess = [];
    for (const media of mediaArray) {
      if (!media || !media.url) continue;
      const type = media.type || 'image';
      const typeKey = type + 's'; // image -> images, video -> videos, audio -> audios
      const list = this.state.resources[typeKey];
      if (!list) continue;

      // 去重（使用 url 作为匹配键）
      const matchKey = media.url;
      if (list.find(r => r.url === matchKey)) continue;

      const resource = {
        url: media.url,
        type,
        name: media.name || 'resource',
        format: media.format || type.toUpperCase()
      };
      if (media.streamType) resource.streamType = media.streamType;
      list.push(resource);
      addedCount++;

      // 视频资源触发预处理
      if (type === 'video') {
        videosToPreprocess.push(resource);
      }
    }

    if (addedCount > 0) {
      this.renderResources();
      this.updateResourceCounts();
      this.setStatus(`网络拦截新增 ${addedCount} 个媒体资源`);

      // 异步触发视频预处理
      videosToPreprocess.forEach(resource => {
        this.preprocessVideoIfNeeded(resource);
      });
    }
  },

  loadSettings() {
    try {
      const saved = localStorage.getItem('webscout-settings');
      if (saved) {
        const settings = JSON.parse(saved);
        this.state.theme = settings.theme || 'dark';
        this.state.lang = settings.lang || 'zh';
        this.state.showResourceLayer = settings.showResourceLayer === true;
      }
    } catch (e) {
      console.error('Load settings failed:', e);
    }
  },

  saveSettings() {
    try {
      localStorage.setItem('webscout-settings', JSON.stringify({
        theme: this.state.theme,
        lang: this.state.lang,
        showResourceLayer: this.state.showResourceLayer
      }));
    } catch (e) {
      console.error('Save settings failed:', e);
    }
  },

  // ===== 模块切换 =====
  switchModule(module) {
    this.state.currentModule = module;

    // 更新导航栏激活状态
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.module === module);
    });

    // 切换模块视图
    document.querySelectorAll('.module-view').forEach(view => {
      view.classList.remove('active');
    });
    const targetView = document.getElementById(module + 'View');
    if (targetView) targetView.classList.add('active');

    // 控制 BrowserView 显示/隐藏
    if (window.electronAPI?.setBrowserviewVisible) {
      window.electronAPI.setBrowserviewVisible(module === 'scraper');
    }

    // 加载模块数据
    if (module === 'settings') {
      // 切换到全局设置模块时刷新所有设置项
      if (typeof this.loadSettingsModule === 'function') {
        this.loadSettingsModule();
      }
    } else if (module === 'workflow' && typeof Workflow?.loadList === 'function') {
      Workflow.loadList();
    } else if (module === 'aiworkflow' && typeof AIWorkflow?.loadList === 'function') {
      AIWorkflow.loadList();
    }
  },

  toggleNav() {
    const nav = document.getElementById('leftNav');
    nav.classList.toggle('expanded');
    const isExpanded = nav.classList.contains('expanded');

    // 同步到主进程
    if (window.electronAPI?.setLeftNavWidth) {
      window.electronAPI.setLeftNavWidth(isExpanded ? 200 : 56);
    }

    // 延迟更新 BrowserView 布局
    setTimeout(() => {
      if (this.state.currentModule === 'scraper' && window.electronAPI?.updateBrowserViewBounds) {
        window.electronAPI.updateBrowserViewBounds();
      }
    }, 300);
  },

  // ===== 主题切换 =====
  toggleTheme() {
    this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
    this.updateThemeUI();
    this.saveSettings();
  },

  toggleThemeFromSettings() {
    const checkbox = document.getElementById('lightThemeToggle');
    this.state.theme = checkbox.checked ? 'light' : 'dark';
    this.updateThemeUI();
    this.saveSettings();
  },

  updateThemeUI() {
    const html = document.documentElement;
    if (this.state.theme === 'light') {
      html.classList.add('light-theme');
    } else {
      html.classList.remove('light-theme');
    }

    // 同步设置面板
    const checkbox = document.getElementById('lightThemeToggle');
    if (checkbox) checkbox.checked = this.state.theme === 'light';

    // 更新主题按钮图标
    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) themeBtn.textContent = this.state.theme === 'dark' ? '☀' : '🌙';
  },

  // ===== 语言切换 =====
  toggleLang() {
    this.state.lang = this.state.lang === 'zh' ? 'en' : 'zh';
    this.saveSettings();
    this.showToast(this.state.lang === 'zh' ? '已切换为中文' : 'Switched to English');
  },

  // ===== 设置面板 =====
  toggleSettings() {
    const overlay = document.getElementById('settingsOverlay');
    const willShow = !overlay.classList.contains('show');
    overlay.classList.toggle('show');

    // 弹出时隐藏 BrowserView（OS 级原生视图会覆盖 HTML 内容），关闭时恢复
    if (window.electronAPI?.setBrowserviewVisible) {
      window.electronAPI.setBrowserviewVisible(!willShow && this.state.currentModule === 'scraper');
    }

    // 同步设置面板状态
    const resourceToggle = document.getElementById('showResourceLayerToggle');
    if (resourceToggle) resourceToggle.checked = this.state.showResourceLayer;

    // Task 18.6: 打开设置面板时拉取 MCP 状态
    if (willShow) {
      this.initMcpSettings();
    }
  },

  // ===== Task 18.6: MCP 设置面板初始化 =====
  async initMcpSettings() {
    if (!window.electronAPI?.mcpAPI) return;
    try {
      const result = await window.electronAPI.mcpAPI.getStatus();
      if (result && result.success) {
        this.updateMcpStatusUI(result.data);
      }
    } catch (e) {
      console.error('initMcpSettings failed:', e);
    }
  },

  // 根据 mcp-status 数据更新 UI
  updateMcpStatusUI(data) {
    data = data || { running: false, readonly: true, toolCount: 0 };
    const dot = document.getElementById('mcpStatusDot');
    const text = document.getElementById('mcpStatusText');
    const modeText = document.getElementById('mcpModeText');
    const toolCountText = document.getElementById('mcpToolCountText');
    const modeDesc = document.getElementById('mcpModeDesc');
    const serviceToggle = document.getElementById('mcpServiceToggle');
    const readonlyToggle = document.getElementById('mcpReadonlyToggle');

    if (dot) {
      dot.className = 'mcp-status-dot ' + (data.running ? 'running' : 'stopped');
    }
    if (text) {
      text.textContent = data.running ? '运行中' : '已停止';
    }
    if (modeText) {
      modeText.textContent = '· ' + (data.readonly ? '只读模式' : '读写模式');
    }
    if (toolCountText) {
      toolCountText.textContent = '· ' + (data.toolCount || 0) + ' 个工具';
    }
    if (modeDesc) {
      const startedNote = data.running && data.startedAt
        ? ' · 启动于 ' + new Date(data.startedAt).toLocaleTimeString('zh-CN')
        : '';
      modeDesc.textContent = 'stdio 模式' + startedNote + ' · 启动后可在 Claude Desktop 配置接入';
    }
    if (serviceToggle) {
      serviceToggle.checked = !!data.running;
    }
    if (readonlyToggle) {
      // readonly=true 表示写操作关闭，所以 toggle 显示 !readonly
      readonlyToggle.checked = !data.readonly;
      // 未运行时禁用读写开关
      readonlyToggle.disabled = !data.running;
    }
  },

  // Task 18.4: MCP 服务开关
  async toggleMcpService() {
    if (!window.electronAPI?.mcpAPI) return;
    const checkbox = document.getElementById('mcpServiceToggle');
    const enabled = checkbox.checked;
    // 读取当前 readonly 开关状态
    const readonlyToggle = document.getElementById('mcpReadonlyToggle');
    const readonly = readonlyToggle ? !readonlyToggle.checked : true;
    try {
      const result = await window.electronAPI.mcpAPI.toggle(enabled, readonly);
      if (result && result.success) {
        this.updateMcpStatusUI(result.data);
        if (enabled) {
          this.showToast('MCP 服务已启动' + (readonly ? '（只读）' : '（读写）'));
        } else {
          this.showToast('MCP 服务已停止');
        }
      } else {
        // 失败时回滚开关状态
        checkbox.checked = !enabled;
        this.showToast('MCP 服务切换失败: ' + (result && result.error ? result.error : '未知错误'));
      }
    } catch (e) {
      checkbox.checked = !enabled;
      this.showToast('MCP 服务切换失败: ' + e.message);
    }
  },

  // Task 18.4: MCP 读写模式开关
  async toggleMcpReadonly() {
    if (!window.electronAPI?.mcpAPI) return;
    const checkbox = document.getElementById('mcpReadonlyToggle');
    const allowWrite = checkbox.checked; // toggle 开 = 允许写 = readonly=false
    const readonly = !allowWrite;
    try {
      const result = await window.electronAPI.mcpAPI.setReadonly(readonly);
      if (result && result.success) {
        // 切换后重新拉取状态
        const statusResult = await window.electronAPI.mcpAPI.getStatus();
        if (statusResult && statusResult.success) {
          this.updateMcpStatusUI(statusResult.data);
        }
        this.showToast(allowWrite ? '已允许 MCP 写操作（重启服务生效）' : '已切换为只读模式（重启服务生效）');
      } else {
        checkbox.checked = !allowWrite;
        this.showToast('切换读写模式失败: ' + (result && result.error ? result.error : '未知错误'));
      }
    } catch (e) {
      checkbox.checked = !allowWrite;
      this.showToast('切换读写模式失败: ' + e.message);
    }
  },

  // Task 18.4: 折叠/展开接入示例
  toggleMcpExample() {
    const el = document.getElementById('mcpExampleCollapsible');
    if (el) el.classList.toggle('expanded');
    // 展开时填入实际路径
    if (el && el.classList.contains('expanded')) {
      this.fillMcpExamplePath();
    }
  },

  // 填入实际的 mcp-stdio.js 路径
  async fillMcpExamplePath() {
    const codeEl = document.getElementById('mcpExampleCode');
    if (!codeEl) return;
    try {
      const appPath = await window.electronAPI?.getAppPath?.();
      const pathSep = (navigator.platform || '').indexOf('Win') >= 0 ? '\\' : '/';
      const mcpPath = (appPath || '<app-path>') + pathSep + 'src' + pathSep + 'main' + pathSep + 'mcp-stdio.js';
      codeEl.textContent = '{\n  "mcpServers": {\n    "web-scout": {\n      "command": "node",\n      "args": ["' + mcpPath + '"]\n    }\n  }\n}';
    } catch (e) {
      // 失败时保留占位符
    }
  },

  // Task 18.4: 复制接入示例 JSON
  async copyMcpExample() {
    const codeEl = document.getElementById('mcpExampleCode');
    if (!codeEl) return;
    const text = codeEl.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      this.showToast('已复制到剪贴板');
    } catch (e) {
      // 回退方案
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); this.showToast('已复制到剪贴板'); }
      catch (e2) { this.showToast('复制失败'); }
      document.body.removeChild(ta);
    }
  },

  // Task 18.4: 折叠/展开调用日志
  toggleMcpLogs() {
    const el = document.getElementById('mcpLogsCollapsible');
    if (el) el.classList.toggle('expanded');
    // 展开时自动刷新
    if (el && el.classList.contains('expanded')) {
      this.refreshMcpLogs();
    }
  },

  // Task 18.4: 刷新调用日志
  async refreshMcpLogs() {
    if (!window.electronAPI?.mcpAPI) return;
    const listEl = document.getElementById('mcpLogsList');
    const countEl = document.getElementById('mcpLogsCount');
    if (!listEl) return;
    try {
      const result = await window.electronAPI.mcpAPI.getLogs();
      if (result && result.success) {
        const logs = Array.isArray(result.data) ? result.data : [];
        if (countEl) countEl.textContent = '(' + logs.length + ')';
        if (logs.length === 0) {
          listEl.innerHTML = '<div class="mcp-logs-empty">暂无调用日志</div>';
          return;
        }
        // 倒序显示（最新在上）
        const self = this;
        const html = logs.slice().reverse().map(log => {
          const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString('zh-CN') : '';
          const statusCls = log.success ? 'ok' : 'fail';
          const statusText = log.success ? 'OK' : '失败';
          const argsStr = log.args ? JSON.stringify(log.args).slice(0, 120) : '';
          const errStr = log.error ? ' · ' + log.error : '';
          return '<div class="mcp-log-item">' +
            '<span class="log-tool">' + self.escapeHtml(log.tool || '') + '</span>' +
            '<span class="log-time">' + time + '</span>' +
            '<span class="log-status ' + statusCls + '">' + statusText + '</span>' +
            '<span class="log-args">' + self.escapeHtml(argsStr) + self.escapeHtml(errStr) + '</span>' +
            '</div>';
        }).join('');
        listEl.innerHTML = html;
      }
    } catch (e) {
      console.error('refreshMcpLogs failed:', e);
    }
  },

  toggleShowResourceLayer() {
    const checkbox = document.getElementById('showResourceLayerToggle') || document.getElementById('settingsShowResourceLayerToggle');
    this.state.showResourceLayer = checkbox.checked;
    this.saveSettings();
    this.updateResourceLayerVisibility();
  },

  // ============ 全局设置模块（替代仪表盘） ============

  // 切换到全局设置模块时加载所有设置项
  async loadSettingsModule() {
    // 同步外观开关
    const lightToggle = document.getElementById('settingsLightThemeToggle');
    if (lightToggle) lightToggle.checked = this.state.theme === 'light';
    const resToggle = document.getElementById('settingsShowResourceLayerToggle');
    if (resToggle) resToggle.checked = this.state.showResourceLayer;

    // 加载 MCP 状态
    await this.initSettingsMcpStatus();
    // 加载存储目录
    await this.loadSettingsDirs();
    // 加载 AI 配置
    await this.loadSettingsAiConfig();
    // 加载数据目录路径
    await this.loadSettingsDataDir();
  },

  // ===== MCP 状态（设置模块） =====
  async initSettingsMcpStatus() {
    if (!window.electronAPI?.mcpAPI) return;
    try {
      const result = await window.electronAPI.mcpAPI.getStatus();
      if (result && result.success) {
        this.updateSettingsMcpUI(result.data);
      }
      // 加载自启动配置（从主进程 settings）
      const autoStartResult = await window.electronAPI?.getMcpAutostart?.();
      const autoToggle = document.getElementById('settingsMcpAutostartToggle');
      if (autoToggle) autoToggle.checked = !!(autoStartResult && autoStartResult.success && autoStartResult.data);
    } catch (e) {
      console.error('initSettingsMcpStatus failed:', e);
    }
  },

  updateSettingsMcpUI(data) {
    data = data || { running: false, readonly: true, toolCount: 0 };
    const dot = document.getElementById('settingsMcpDot');
    const text = document.getElementById('settingsMcpStatusText');
    const modeTag = document.getElementById('settingsMcpModeTag');
    const toolCount = document.getElementById('settingsMcpToolCount');
    const startedAt = document.getElementById('settingsMcpStartedAt');
    const toggle = document.getElementById('settingsMcpToggle');
    const readonlyToggle = document.getElementById('settingsMcpReadonlyToggle');
    const masterCard = document.getElementById('settingsMcpMasterCard');

    // 主控卡片的左侧状态条颜色随状态变化
    if (masterCard) {
      masterCard.classList.remove('running', 'stopped');
      masterCard.classList.add(data.running ? 'running' : 'stopped');
    }
    if (dot) dot.className = 'dot ' + (data.running ? 'running' : 'stopped');
    if (text) text.textContent = data.running ? '运行中' : '未启动';
    if (modeTag) {
      modeTag.textContent = data.readonly ? '只读' : '读写';
      modeTag.className = 'mode-tag' + (data.readonly ? '' : ' write');
    }
    if (toolCount) toolCount.textContent = (data.toolCount || 0) + ' 个工具可用';
    if (startedAt) {
      startedAt.textContent = data.running && data.startedAt
        ? '启动于 ' + new Date(data.startedAt).toLocaleTimeString('zh-CN')
        : '';
    }
    if (toggle) toggle.checked = !!data.running;
    if (readonlyToggle) {
      readonlyToggle.checked = !data.readonly;
      readonlyToggle.disabled = !data.running;
    }
  },

  async toggleMcpServiceFromSettings() {
    if (!window.electronAPI?.mcpAPI) return;
    const checkbox = document.getElementById('settingsMcpToggle');
    const enabled = checkbox.checked;
    const readonlyToggle = document.getElementById('settingsMcpReadonlyToggle');
    const readonly = readonlyToggle ? !readonlyToggle.checked : true;
    try {
      const result = await window.electronAPI.mcpAPI.toggle(enabled, readonly);
      if (result && result.success) {
        this.updateSettingsMcpUI(result.data);
        // 同步右上角设置弹窗的开关
        const topToggle = document.getElementById('mcpServiceToggle');
        if (topToggle) topToggle.checked = enabled;
        this.showToast('MCP 服务已' + (enabled ? '启动' : '停止') + (enabled ? (readonly ? '（只读）' : '（读写）') : ''));
      } else {
        checkbox.checked = !enabled;
        this.showToast('MCP 切换失败: ' + (result && result.error ? result.error : '未知错误'));
      }
    } catch (e) {
      checkbox.checked = !enabled;
      this.showToast('MCP 切换失败: ' + e.message);
    }
  },

  async toggleMcpReadonlyFromSettings() {
    if (!window.electronAPI?.mcpAPI) return;
    const checkbox = document.getElementById('settingsMcpReadonlyToggle');
    const allowWrite = checkbox.checked;
    const readonly = !allowWrite;
    try {
      const result = await window.electronAPI.mcpAPI.setReadonly(readonly);
      if (result && result.success) {
        const statusResult = await window.electronAPI.mcpAPI.getStatus();
        if (statusResult && statusResult.success) {
          this.updateSettingsMcpUI(statusResult.data);
        }
        // 同步右上角设置弹窗
        const topReadonly = document.getElementById('mcpReadonlyToggle');
        if (topReadonly) topReadonly.checked = allowWrite;
        this.showToast(allowWrite ? '已允许 MCP 写操作（重启服务生效）' : '已切换为只读模式（重启服务生效）');
      } else {
        checkbox.checked = !allowWrite;
        this.showToast('切换读写模式失败: ' + (result && result.error ? result.error : '未知错误'));
      }
    } catch (e) {
      checkbox.checked = !allowWrite;
      this.showToast('切换读写模式失败: ' + e.message);
    }
  },

  async toggleMcpAutostart() {
    const checkbox = document.getElementById('settingsMcpAutostartToggle');
    const enabled = checkbox.checked;
    try {
      const result = await window.electronAPI?.setMcpAutostart?.(enabled);
      if (!result || !result.success) {
        checkbox.checked = !enabled;
        this.showToast('保存自启动设置失败');
        return;
      }
      this.showToast(enabled ? '已开启 MCP 开机自启' : '已关闭 MCP 开机自启');
    } catch (e) {
      checkbox.checked = !enabled;
      this.showToast('保存自启动设置失败: ' + e.message);
    }
  },

  toggleSettingsMcpCard(cardId) {
    const el = document.getElementById(cardId);
    if (!el) return;
    el.classList.toggle('expanded');
    // 展开日志卡片时自动刷新
    if (cardId === 'settingsMcpLogsCard' && el.classList.contains('expanded')) {
      this.refreshSettingsMcpLogs();
    }
    // 展开接入示例时填入实际路径
    if (cardId === 'settingsMcpStandaloneCard' && el.classList.contains('expanded')) {
      this.fillSettingsMcpStandalonePath();
    }
  },

  async fillSettingsMcpStandalonePath() {
    const codeEl = document.getElementById('settingsMcpStandaloneCode');
    if (!codeEl) return;
    try {
      const appPath = await window.electronAPI?.getAppPath?.();
      // appPath 返回的是 userData 目录，需要回退到项目根目录
      // 实际上对于 standalone MCP，应该使用项目源码路径
      // 这里使用 process.cwd() 的概念：在 TRAE Work 中打开项目时，路径就是项目根目录
      const sep = (navigator.platform || '').indexOf('Win') >= 0 ? '\\' : '/';
      // 优先使用当前可执行的项目路径（开发模式下）
      const projectPath = (typeof window !== 'undefined' && window.__WSS_PROJECT_PATH__) || '<项目路径>';
      const mcpPath = projectPath + sep + 'src' + sep + 'main' + sep + 'mcp-standalone.js';
      codeEl.textContent = '{\n  "mcpServers": {\n    "web-scout": {\n      "command": "node",\n      "args": ["' + mcpPath.replace(/\\/g, '\\\\') + '"],\n      "env": { "MCP_READONLY": "false" }\n    }\n  }\n}';
    } catch (e) {
      // 失败时保留占位符
    }
  },

  async copySettingsMcpStalone() {
    const codeEl = document.getElementById('settingsMcpStandaloneCode');
    if (!codeEl) return;
    const text = codeEl.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      this.showToast('已复制到剪贴板');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); this.showToast('已复制到剪贴板'); }
      catch (e2) { this.showToast('复制失败'); }
      document.body.removeChild(ta);
    }
  },

  // 兼容方法名（HTML 中使用的是 copySettingsMcpStandalone）
  async copySettingsMcpStandalone() {
    return this.copySettingsMcpStalone();
  },

  async refreshSettingsMcpLogs() {
    if (!window.electronAPI?.mcpAPI) return;
    const listEl = document.getElementById('settingsMcpLogsList');
    const countEl = document.getElementById('settingsMcpLogsCount');
    if (!listEl) return;
    try {
      const result = await window.electronAPI.mcpAPI.getLogs();
      if (result && result.success) {
        const logs = Array.isArray(result.data) ? result.data : [];
        if (countEl) countEl.textContent = '(' + logs.length + ')';
        if (logs.length === 0) {
          listEl.innerHTML = '<div class="mcp-logs-empty">暂无调用日志</div>';
          return;
        }
        const self = this;
        listEl.innerHTML = logs.slice().reverse().map(log => {
          const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString('zh-CN') : '';
          const statusCls = log.success ? 'ok' : 'fail';
          const statusText = log.success ? 'OK' : '失败';
          const argsStr = log.args ? JSON.stringify(log.args).slice(0, 120) : '';
          const errStr = log.error ? ' · ' + log.error : '';
          return '<div class="mcp-log-line">' +
            '<span class="log-tool">' + self.escapeHtml(log.tool || '') + '</span>' +
            '<span class="log-time">' + time + '</span>' +
            '<span class="log-status ' + statusCls + '">' + statusText + '</span>' +
            '<span class="log-args">' + self.escapeHtml(argsStr) + self.escapeHtml(errStr) + '</span>' +
            '</div>';
        }).join('');
      }
    } catch (e) {
      console.error('refreshSettingsMcpLogs failed:', e);
    }
  },

  async clearSettingsMcpLogs() {
    // 主进程暂未提供清空日志的 IPC，这里通过刷新模拟（实际清空需主进程支持）
    // 简单方案：直接清空 UI（下次刷新会重新拉取，但日志会持续累积）
    const listEl = document.getElementById('settingsMcpLogsList');
    const countEl = document.getElementById('settingsMcpLogsCount');
    if (listEl) listEl.innerHTML = '<div class="mcp-logs-empty">日志已清空（仅 UI，主进程日志仍保留）</div>';
    if (countEl) countEl.textContent = '(0)';
    this.showToast('日志 UI 已清空');
  },

  // ===== 存储目录设置 =====
  async loadSettingsDirs() {
    try {
      const [contentRes, templateRes] = await Promise.all([
        window.electronAPI?.getDefaultExportDir?.(),
        window.electronAPI?.getTemplateExportDir?.(),
      ]);
      const contentDir = contentRes?.data || '';
      const templateDir = templateRes?.data || '';
      this._updateSettingsDirDisplay('content', contentDir);
      this._updateSettingsDirDisplay('template', templateDir);
    } catch (e) {
      console.error('loadSettingsDirs failed:', e);
    }
  },

  _updateSettingsDirDisplay(target, dir) {
    const display = document.getElementById('settings' + (target === 'content' ? 'Content' : 'Template') + 'DirDisplay');
    const openBtn = document.getElementById('settings' + (target === 'content' ? 'Content' : 'Template') + 'DirOpen');
    const clearBtn = document.getElementById('settings' + (target === 'content' ? 'Content' : 'Template') + 'DirClear');
    if (display) {
      display.textContent = dir || '未设置';
      display.className = 'settings-dir-display' + (dir ? '' : ' empty');
    }
    if (openBtn) openBtn.disabled = !dir;
    if (clearBtn) clearBtn.style.visibility = dir ? 'visible' : 'hidden';
  },

  async pickSettingsDir(target) {
    try {
      const dir = await window.electronAPI?.selectDirectory?.();
      if (!dir) return;
      if (target === 'content') {
        await window.electronAPI?.setDefaultExportDir?.(dir);
      } else {
        await window.electronAPI?.setTemplateExportDir?.(dir);
      }
      this._updateSettingsDirDisplay(target, dir);
      this.showToast('目录已设置: ' + dir);
    } catch (e) {
      this.showToast('选择目录失败: ' + e.message);
    }
  },

  async openSettingsDir(target) {
    try {
      const res = target === 'content'
        ? await window.electronAPI?.getDefaultExportDir?.()
        : await window.electronAPI?.getTemplateExportDir?.();
      const dir = res?.data || '';
      if (!dir) {
        this.showToast('未设置目录');
        return;
      }
      await window.electronAPI?.openInExplorer?.(dir);
    } catch (e) {
      this.showToast('打开目录失败: ' + e.message);
    }
  },

  async clearSettingsDir(target) {
    try {
      if (target === 'content') {
        await window.electronAPI?.setDefaultExportDir?.('');
      } else {
        await window.electronAPI?.setTemplateExportDir?.('');
      }
      this._updateSettingsDirDisplay(target, '');
      this.showToast('目录已清除');
    } catch (e) {
      this.showToast('清除目录失败: ' + e.message);
    }
  },

  // ===== AI 配置 =====
  async loadSettingsAiConfig() {
    try {
      const result = await window.electronAPI?.aiConfigAPI?.get?.();
      if (result && result.success && result.data) {
        const cfg = result.data;
        const ep = document.getElementById('settingsAiEndpoint');
        const key = document.getElementById('settingsAiApiKey');
        const model = document.getElementById('settingsAiModel');
        const temp = document.getElementById('settingsAiTemperature');
        if (ep) ep.value = cfg.endpoint || '';
        if (key) key.value = cfg.apiKey || ''; // 已脱敏
        if (model) model.value = cfg.model || '';
        if (temp) temp.value = typeof cfg.temperature === 'number' ? cfg.temperature : 0.7;
      }
    } catch (e) {
      console.error('loadSettingsAiConfig failed:', e);
    }
  },

  async saveSettingsAiConfig() {
    const ep = document.getElementById('settingsAiEndpoint')?.value.trim() || '';
    const key = document.getElementById('settingsAiApiKey')?.value.trim() || '';
    const model = document.getElementById('settingsAiModel')?.value.trim() || '';
    const temp = parseFloat(document.getElementById('settingsAiTemperature')?.value || '0.7');
    if (!ep || !model) {
      this.showToast('请填写 API 端点和模型名');
      return;
    }
    try {
      const result = await window.electronAPI?.aiConfigAPI?.save?.({
        endpoint: ep,
        apiKey: key,
        model: model,
        temperature: temp,
        maxTokens: 2048
      });
      if (result && result.success) {
        this.showToast('AI 配置已保存');
        // 重新加载（apiKey 会显示为脱敏值）
        await this.loadSettingsAiConfig();
      } else {
        this.showToast('保存失败: ' + (result?.error || '未知错误'));
      }
    } catch (e) {
      this.showToast('保存失败: ' + e.message);
    }
  },

  async testSettingsAiConfig() {
    const ep = document.getElementById('settingsAiEndpoint')?.value.trim() || '';
    const key = document.getElementById('settingsAiApiKey')?.value.trim() || '';
    const model = document.getElementById('settingsAiModel')?.value.trim() || '';
    if (!ep || !model) {
      this.showToast('请填写 API 端点和模型名');
      return;
    }
    this.showToast('正在测试连接…');
    try {
      const result = await window.electronAPI?.aiConfigAPI?.test?.({
        endpoint: ep,
        apiKey: key,
        model: model
      });
      if (result && result.success) {
        this.showToast('✓ 连接成功');
      } else {
        this.showToast('✗ 连接失败: ' + (result?.error || '未知错误'));
      }
    } catch (e) {
      this.showToast('✗ 连接失败: ' + e.message);
    }
  },

  toggleSettingsAiKeyVisibility() {
    const keyInput = document.getElementById('settingsAiApiKey');
    const btn = document.getElementById('settingsAiKeyToggleBtn');
    if (!keyInput) return;
    if (keyInput.type === 'password') {
      keyInput.type = 'text';
      if (btn) btn.textContent = '👁 隐藏';
      // 5 秒后自动隐藏
      clearTimeout(this._aiKeyHideTimer);
      this._aiKeyHideTimer = setTimeout(() => {
        keyInput.type = 'password';
        if (btn) btn.textContent = '👁 显示';
      }, 5000);
    } else {
      keyInput.type = 'password';
      if (btn) btn.textContent = '👁 显示';
    }
  },

  // ===== 应用信息 =====
  async loadSettingsDataDir() {
    try {
      const appPath = await window.electronAPI?.getAppPath?.();
      const el = document.getElementById('settingsDataDirPath');
      if (el && appPath) el.textContent = appPath;
    } catch (e) { /* ignore */ }
  },

  async openSettingsDataDir() {
    try {
      const appPath = await window.electronAPI?.getAppPath?.();
      if (appPath) {
        await window.electronAPI?.openInExplorer?.(appPath);
      }
    } catch (e) {
      this.showToast('打开失败: ' + e.message);
    }
  },

  openGithubRepo() {
    window.electronAPI?.openExternal?.('https://github.com/HSyilin/web-scout');
  },


  updateResourceLayerVisibility() {
    const layerPanels = document.getElementById('layerPanels');
    if (!layerPanels) return;

    if (this.state.showResourceLayer) {
      // 打开资源层：显示所有内容
      layerPanels.style.display = 'block';

      // 显示"资源"tab按钮
      const resourceTab = document.querySelector('.resource-tab[data-tab="resources"]');
      if (resourceTab) resourceTab.style.display = '';

      // 显示 paneResources
      const paneResources = document.getElementById('paneResources');
      if (paneResources) paneResources.style.display = '';
    } else {
      // 关闭资源层：隐藏"资源"tab按钮和paneResources，但保留"已选"和"文本"
      layerPanels.style.display = 'block';

      // 隐藏"资源"tab按钮
      const resourceTab = document.querySelector('.resource-tab[data-tab="resources"]');
      if (resourceTab) resourceTab.style.display = 'none';

      // 隐藏 paneResources
      const paneResources = document.getElementById('paneResources');
      if (paneResources) {
        paneResources.style.display = 'none';
        paneResources.classList.remove('active');
      }

      // 如果当前激活的是"资源"标签，自动切换到"已选"标签
      if (resourceTab && resourceTab.classList.contains('active')) {
        this.switchResourceTab('selected');
      }
    }
  },

  // ===== 窗口控制 =====
  minimizeWindow() {
    if (window.electronAPI?.minimizeWindow) window.electronAPI.minimizeWindow();
  },

  maximizeWindow() {
    if (window.electronAPI?.maximizeWindow) window.electronAPI.maximizeWindow();
  },

  closeWindow() {
    if (window.electronAPI?.closeWindow) window.electronAPI.closeWindow();
  },

  // ===== 标签页管理 =====
  async addNewTab(url = '') {
    const targetUrl = url || 'https://www.baidu.com';

    // 有 url 参数时（通过超链接打开），标记需要自动切换到新标签
    if (url) this.state._pendingSwitch = true;

    // 通过主进程创建 BrowserView 标签
    if (window.electronAPI?.createTab) {
      await window.electronAPI.createTab(targetUrl);
      // 标签会通过 tab-created 事件自动添加
    }
  },

  closeTab(tabId) {
    const index = this.state.tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    this.state.tabs.splice(index, 1);

    // 通知主进程关闭 BrowserView
    if (window.electronAPI?.closeTab) {
      window.electronAPI.closeTab(tabId);
    }

    if (this.state.tabs.length === 0) {
      this.state.activeTabId = null;
      this.renderTabs();
      this.showEmptyState();
    } else if (this.state.activeTabId === tabId) {
      const newActive = this.state.tabs[Math.min(index, this.state.tabs.length - 1)];
      this.switchToTab(newActive.id);
    } else {
      this.renderTabs();
    }
  },

  switchToTab(tabId) {
    this.state.activeTabId = tabId;
    this.renderTabs();

    // 通知主进程切换 BrowserView
    if (window.electronAPI?.switchTab) {
      window.electronAPI.switchTab(tabId);
    }
  },

  renderTabs() {
    const tabBar = document.getElementById('tabBar');
    if (!tabBar) return;

    // 保留"新建标签页"按钮
    const addBtn = tabBar.querySelector('.tab-add');
    tabBar.innerHTML = '';

    this.state.tabs.forEach(tab => {
      const tabEl = document.createElement('button');
      tabEl.className = 'tab' + (tab.id === this.state.activeTabId ? ' active' : '');
      tabEl.onclick = () => this.switchToTab(tab.id);
      tabEl.innerHTML = `
        <span class="tab-title">${this.escapeHtml(tab.title)}</span>
        <button class="tab-close" aria-label="关闭标签页">×</button>
      `;
      // 用 addEventListener 绑定关闭事件，保持 tabId 为数字类型
      const closeBtn = tabEl.querySelector('.tab-close');
      if (closeBtn) {
        closeBtn.onclick = (e) => {
          e.stopPropagation();
          this.closeTab(tab.id);
        };
      }
      tabBar.appendChild(tabEl);
    });

    if (addBtn) {
      tabBar.appendChild(addBtn);
    } else {
      const newAddBtn = document.createElement('button');
      newAddBtn.className = 'tab-add';
      newAddBtn.onclick = () => this.addNewTab();
      newAddBtn.setAttribute('aria-label', '新建标签页');
      newAddBtn.textContent = '+';
      tabBar.appendChild(newAddBtn);
    }
  },

  showEmptyState() {
    const emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.style.display = 'flex';
  },

  hideEmptyState() {
    const emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.style.display = 'none';
  },

  // ===== 导航控制 =====
  async loadUrl(url) {
    const urlInput = document.getElementById('urlInput');
    const targetUrl = url || urlInput?.value?.trim();

    if (!targetUrl) {
      this.showToast('请输入网址');
      return;
    }

    let finalUrl = targetUrl;
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'https://' + finalUrl;
    }

    if (urlInput) urlInput.value = finalUrl;
    this.hideEmptyState();

    // 如果没有标签页，创建一个（addNewTab 已经会加载 URL，无需再调用 loadUrl）
    if (this.state.tabs.length === 0) {
      await this.addNewTab(finalUrl);
    } else {
      if (!this.state.activeTabId) {
        this.switchToTab(this.state.tabs[0].id);
      }
      // 通知主进程在当前活动标签加载 URL
      if (window.electronAPI?.loadUrl) {
        window.electronAPI.loadUrl(this.state.activeTabId, finalUrl);
      }
    }

    this.showLoading(true);
    this.setStatus('加载中…');

    // 添加到历史记录
    this.addToHistory(finalUrl);
  },

  goBack() {
    if (window.electronAPI?.goBack && this.state.activeTabId) {
      window.electronAPI.goBack(this.state.activeTabId);
    }
  },

  goForward() {
    if (window.electronAPI?.goForward && this.state.activeTabId) {
      window.electronAPI.goForward(this.state.activeTabId);
    }
  },

  // ===== 提取模式 =====
  toggleInspect() {
    this.state.inspectMode = !this.state.inspectMode;
    const btn = document.getElementById('inspectToggle');
    if (btn) btn.classList.toggle('active', this.state.inspectMode);

    if (window.electronAPI?.toggleInspect) {
      window.electronAPI.toggleInspect(this.state.activeTabId, this.state.inspectMode);
    }

    // 开启提取模式时自动展开资源侧栏
    if (this.state.inspectMode && !this.state.sidebarVisible) {
      this.toggleSidebar();
    }

    this.showToast(this.state.inspectMode ? '已开启提取模式' : '已关闭提取模式');
  },

  // ===== 侧边栏 =====
  toggleSidebar() {
    this.state.sidebarVisible = !this.state.sidebarVisible;
    const panel = document.getElementById('rightPanel');
    if (panel) panel.classList.toggle('collapsed', !this.state.sidebarVisible);

    // 控制浮动展开按钮显示/隐藏
    const expandBtn = document.getElementById('sidebarExpandBtn');
    if (expandBtn) expandBtn.classList.toggle('show', !this.state.sidebarVisible);

    // 更新折叠按钮图标和 title
    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn) {
      if (this.state.sidebarVisible) {
        toggleBtn.textContent = '◀';
        toggleBtn.title = '折叠侧栏';
      } else {
        toggleBtn.textContent = '▶';
        toggleBtn.title = '展开侧栏';
      }
    }

    if (window.electronAPI?.setSidebarVisible) {
      window.electronAPI.setSidebarVisible(this.state.sidebarVisible);
    }

    // 延迟更新 BrowserView 布局
    setTimeout(() => {
      if (this.state.currentModule === 'scraper' && window.electronAPI?.updateBrowserViewBounds) {
        window.electronAPI.updateBrowserViewBounds();
      }
    }, 300);
  },

  // ===== 资源面板 =====
  switchResourceTab(tabName) {
    document.querySelectorAll('.resource-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.remove('active');
    });

    const targetPane = document.getElementById('pane' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
    if (targetPane) targetPane.classList.add('active');
  },

  switchSubTab(parentTab, subTabName) {
    const parentPane = document.getElementById('pane' + parentTab.charAt(0).toUpperCase() + parentTab.slice(1));
    if (!parentPane) return;

    parentPane.querySelectorAll('.sub-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.subtab === subTabName);
    });

    parentPane.querySelectorAll('.sub-pane').forEach(pane => {
      pane.classList.remove('active');
    });

    const targetSubPane = parentPane.querySelector(`[data-subpane="${subTabName}"]`);
    if (targetSubPane) targetSubPane.classList.add('active');
  },

  // ===== 资源管理 =====
  updateResourceCounts() {
    const counts = {
      images: this.state.resources.images.length,
      videos: this.state.resources.videos.length,
      audios: this.state.resources.audios.length,
      links: this.state.resources.links.length,
      downloads: this.state.resources.downloads.length,
      texts: this.state.resources.texts.length
    };

    const selectedCounts = {
      images: this.state.selectedResources.images.length,
      videos: this.state.selectedResources.videos.length,
      audios: this.state.selectedResources.audios.length,
      links: this.state.selectedResources.links.length,
      downloads: this.state.selectedResources.downloads.length,
      texts: this.state.selectedResources.texts.length
    };

    // 更新标签计数
    this.updateCount('tabCountResources', counts.images + counts.videos + counts.audios + counts.links + counts.downloads);
    this.updateCount('tabCountSelected', selectedCounts.images + selectedCounts.videos + selectedCounts.audios + selectedCounts.links + selectedCounts.downloads + selectedCounts.texts);
    this.updateCount('tabCountTexts', counts.texts);

    // 更新子标签计数
    this.updateCount('subImageCount', counts.images);
    this.updateCount('subVideoCount', counts.videos);
    this.updateCount('subAudioCount', counts.audios);
    this.updateCount('subLinkCount', counts.links);
    this.updateCount('subDownloadCount', counts.downloads);

    this.updateCount('subSelectedImageCount', selectedCounts.images);
    this.updateCount('subSelectedVideoCount', selectedCounts.videos);
    this.updateCount('subSelectedAudioCount', selectedCounts.audios);
    this.updateCount('subSelectedLinkCount', selectedCounts.links);
    this.updateCount('subSelectedDownloadCount', selectedCounts.downloads);
    this.updateCount('subSelectedTextCount', selectedCounts.texts);

    // 更新已选计数
    const totalSelected = selectedCounts.images + selectedCounts.videos + selectedCounts.audios + selectedCounts.links + selectedCounts.downloads + selectedCounts.texts;
    this.updateCount('selectedCount', totalSelected);
  },

  updateCount(elementId, count) {
    const el = document.getElementById(elementId);
    if (el) el.textContent = count;
  },

  toggleResourceSelection(type, resource) {
    const list = this.state.selectedResources[type];
    // 使用 url 或 content 作为匹配条件（文本资源没有 url，使用 content）
    const matchKey = resource.url || resource.content;
    const index = list.findIndex(r => (r.url || r.content) === matchKey);

    if (index === -1) {
      list.push(resource);
    } else {
      list.splice(index, 1);
    }

    this.renderResources();
    this.updateResourceCounts();
  },

  clearAllSelected() {
    this.state.selectedResources = { images: [], videos: [], audios: [], links: [], downloads: [], texts: [] };
    this.state.batchSelected.clear();
    this.renderResources();
    this.updateResourceCounts();
    this.showToast('已清空所有已选资源');
  },

  // ===== 筛选器 =====
  applySelectedFilter() {
    const input = document.getElementById('selectedFilterInput');
    if (input) {
      this.state.selectedFilter = input.value.trim();
      this.renderResources();
    }
  },

  // ===== 批量处理 =====
  toggleBatchMode() {
    this.state.batchMode = !this.state.batchMode;
    if (!this.state.batchMode) {
      this.state.batchSelected.clear();
    }
    // 更新按钮显示
    const batchBtn = document.getElementById('batchModeBtn');
    if (batchBtn) {
      batchBtn.classList.toggle('active', this.state.batchMode);
      batchBtn.textContent = this.state.batchMode ? '☑ 退出批量' : '☑ 批量';
    }
    document.getElementById('batchSelectAllBtn').style.display = this.state.batchMode ? '' : 'none';
    document.getElementById('batchDeleteBtn').style.display = this.state.batchMode ? '' : 'none';
    document.getElementById('batchExportBtn').style.display = this.state.batchMode ? '' : 'none';
    this.renderResources();
  },

  toggleBatchSelect(batchKey, event) {
    if (event) event.stopPropagation();
    if (this.state.batchSelected.has(batchKey)) {
      this.state.batchSelected.delete(batchKey);
    } else {
      this.state.batchSelected.add(batchKey);
    }
    this.renderResources();
  },

  batchSelectAll() {
    // 选中当前筛选结果中的所有资源
    const types = ['images', 'videos', 'audios', 'links', 'texts'];
    types.forEach(type => {
      let list = this.state.selectedResources[type];
      if (this.state.selectedFilter) {
        const filter = this.state.selectedFilter.toLowerCase();
        list = list.filter(r => {
          const name = (r.name || r.text || '').toLowerCase();
          const url = (r.url || '').toLowerCase();
          return name.includes(filter) || url.includes(filter);
        });
      }
      list.forEach((_, i) => {
        const realIdx = this.state.selectedResources[type].indexOf(list[i] !== undefined ? list[i] : this.state.selectedResources[type][i]);
        // 直接用原始索引
      });
      // 直接遍历原始数组，用真实索引
      this.state.selectedResources[type].forEach((r, realIdx) => {
        if (this.state.selectedFilter) {
          const filter = this.state.selectedFilter.toLowerCase();
          const name = (r.name || r.text || '').toLowerCase();
          const url = (r.url || '').toLowerCase();
          if (!name.includes(filter) && !url.includes(filter)) return;
        }
        this.state.batchSelected.add(type + ':' + realIdx);
      });
    });
    this.renderResources();
    this.showToast('已全选当前筛选结果');
  },

  batchDelete() {
    if (this.state.batchSelected.size === 0) {
      this.showToast('请先选择要删除的资源');
      return;
    }
    if (!confirm('确定从已选资源中删除 ' + this.state.batchSelected.size + ' 项？')) return;
    // 按 type 分组，从后往前删除以保持索引正确
    const toDelete = {};
    this.state.batchSelected.forEach(key => {
      const [type, idx] = key.split(':');
      if (!toDelete[type]) toDelete[type] = [];
      toDelete[type].push(parseInt(idx));
    });
    Object.keys(toDelete).forEach(type => {
      toDelete[type].sort((a, b) => b - a).forEach(idx => {
        if (this.state.selectedResources[type] && this.state.selectedResources[type][idx]) {
          this.state.selectedResources[type].splice(idx, 1);
        }
      });
    });
    this.state.batchSelected.clear();
    this.renderResources();
    this.updateResourceCounts();
    this.showToast('已删除选中项');
  },

  async batchExport() {
    if (this.state.batchSelected.size === 0) {
      this.showToast('请先选择要导出的资源');
      return;
    }
    // 收集批量选中的资源
    const selected = [];
    this.state.batchSelected.forEach(key => {
      const [type, idx] = key.split(':');
      const resource = this.state.selectedResources[type] && this.state.selectedResources[type][parseInt(idx)];
      if (resource) selected.push(resource);
    });
    if (selected.length === 0) {
      this.showToast('没有可导出的资源');
      return;
    }
    // 选择导出目录
    const destDir = await window.electronAPI.selectDirectory();
    if (!destDir) return;
    this.showDownloadDialog(selected.length);
    this.setStatus('正在批量导出资源…');
    let successCount = 0;
    let failCount = 0;
    const total = selected.length;
    this.state.downloadCancelled = false;
    if (window.electronAPI?.resetDownloadCancel) {
      await window.electronAPI.resetDownloadCancel();
    }
    for (let i = 0; i < selected.length; i++) {
      if (this.state.downloadCancelled) break;
      const resource = selected[i];
      const isBili = this.isBilibiliVideo(resource);
      const fileId = isBili ? 'bili_' + i : (resource.type === 'video' ? 'video_' + i : (resource.type === 'text' ? 'text_' + i : 'img_' + i));
      this.updateDownloadDialogProgress(i, total);
      this.updateDownloadItemStatus(fileId, 'processing', resource.name || 'resource');
      try {
        const result = await this.exportSingleResource(resource, destDir, i, fileId, new Set());
        if (result && result.success) {
          successCount++;
          this.updateDownloadItemStatus(fileId, 'done', result.title || resource.name || 'resource');
        } else {
          failCount++;
          this.updateDownloadItemStatus(fileId, 'error', result?.error || '未知错误');
        }
      } catch (err) {
        failCount++;
        this.updateDownloadItemStatus(fileId, 'error', err.message || '异常');
      }
      this.updateDownloadDialogProgress(i + 1, total);
    }
    const wasCancelled = this.state.downloadCancelled;
    this.finishDownloadDialog(successCount, failCount, wasCancelled);
    this.showToast(wasCancelled ? '已取消' : '批量导出完成: ' + successCount + ' 成功');
    this.saveWorkflowRecord(selected, destDir);
  },

  renderResources() {
    // 渲染资源列表（type 使用复数形式，与 state.resources 的键名一致）
    this.renderResourceList('imageList', this.state.resources.images, 'images');
    this.renderResourceList('videoList', this.state.resources.videos, 'videos');
    this.renderResourceList('audioList', this.state.resources.audios, 'audios');
    this.renderLinkList('linkList', this.state.resources.links);
    this.renderDownloadList('downloadList', this.state.resources.downloads);
    this.renderTextList('textList', this.state.resources.texts);

    // 渲染已选资源
    this.renderResourceList('selectedImageList', this.state.selectedResources.images, 'images', true);
    this.renderResourceList('selectedVideoList', this.state.selectedResources.videos, 'videos', true);
    this.renderResourceList('selectedAudioList', this.state.selectedResources.audios, 'audios', true);
    this.renderLinkList('selectedLinkList', this.state.selectedResources.links, true);
    this.renderDownloadList('selectedDownloadList', this.state.selectedResources.downloads, true);
    this.renderTextList('selectedTextList', this.state.selectedResources.texts, true);
  },

  renderResourceList(containerId, resources, type, isSelected = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // 已选面板应用筛选器
    let displayResources = resources;
    if (isSelected && this.state.selectedFilter) {
      const filter = this.state.selectedFilter.toLowerCase();
      displayResources = resources.filter(r => {
        const name = (r.name || r.text || '').toLowerCase();
        const url = (r.url || '').toLowerCase();
        return name.includes(filter) || url.includes(filter);
      });
    }

    if (displayResources.length === 0) {
      const msg = (isSelected && this.state.selectedFilter) ? '无匹配资源' : '暂无资源';
      container.innerHTML = '<div style="color:var(--text2);font-size:12px;text-align:center;padding:20px">' + msg + '</div>';
      return;
    }

    // 已选面板引用 selectedResources，原始面板引用 resources
    const listPath = isSelected ? `selectedResources.${type}` : `resources.${type}`;
    // 单数形式用于显示（images → image）
    const displayType = type.replace(/s$/, '');

    container.innerHTML = displayResources.map((resource, index) => {
      // 找到资源在原数组中的真实索引（筛选后）
      const realIndex = isSelected ? resources.indexOf(resource) : index;
      const isSelectedItem = isSelected || this.isResourceSelected(type, resource);
      // 批量模式相关
      const batchKey = isSelected ? type + ':' + realIndex : '';
      const isBatchSelected = isSelected && this.state.batchMode && this.state.batchSelected.has(batchKey);
      const batchClass = isSelected && this.state.batchMode ? ' batch-mode' + (isBatchSelected ? ' batch-selected' : '') : '';
      const batchCheckbox = isSelected && this.state.batchMode
        ? '<input type="checkbox" class="batch-checkbox" ' + (isBatchSelected ? 'checked' : '') + ' onclick="App.toggleBatchSelect(\'' + batchKey + '\',event)">'
        : '';
      // 视频转码状态显示（不显示失败状态）
      let statusBadge = '';
      if (displayType === 'video' && resource.preprocessStatus) {
        if (resource.preprocessStatus === 'processing') {
          statusBadge = '<span style="color:#f39c12;font-size:10px">⏳ 转码中...</span>';
        } else if (resource.preprocessStatus === 'done') {
          statusBadge = '<span style="color:#27ae60;font-size:10px">✓ 已转码</span>';
        }
      }
      // B 站视频标记
      let biliBadge = '';
      if (displayType === 'video' && this.isBilibiliVideo(resource)) {
        biliBadge = '<span style="color:#00a1d6;font-size:10px">📺 B站</span>';
      }
      // 视频图标
      const previewIcon = displayType === 'video' ? '🎬' : (displayType === 'audio' ? '🎵' : '📄');
      const previewContent = displayType === 'image' && resource.url
        ? `<img src="${this.escapeHtml(resource.url)}" alt="${this.escapeHtml(resource.name || '')}" loading="lazy">`
        : `<span class="icon-large">${previewIcon}</span>`;
      // 批量模式下点击卡片切换选择，非批量模式下正常切换
      const onclickAction = isSelected && this.state.batchMode
        ? `App.toggleBatchSelect('${batchKey}')`
        : `App.toggleResourceSelection('${type}', App.state.${listPath}[${realIndex}])`;
      return `
        <div class="resource-card ${isSelectedItem ? 'selected' : ''}${batchClass}" onclick="${onclickAction}">
          ${batchCheckbox}
          <div class="card-preview">
            ${previewContent}
          </div>
          <div class="card-info">
            <div class="card-name">${this.escapeHtml(resource.name || '未命名')}</div>
            <div class="card-meta">
              <span>${resource.format || displayType}</span>
              ${biliBadge}${statusBadge}
            </div>
          </div>
          <div class="card-check"></div>
        </div>
      `;
    }).join('');
  },

  renderLinkList(containerId, links, isSelected = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // 已选面板应用筛选器
    let displayLinks = links;
    if (isSelected && this.state.selectedFilter) {
      const filter = this.state.selectedFilter.toLowerCase();
      displayLinks = links.filter(l => {
        const name = (l.text || l.name || '').toLowerCase();
        const url = (l.url || '').toLowerCase();
        return name.includes(filter) || url.includes(filter);
      });
    }

    if (displayLinks.length === 0) {
      const msg = (isSelected && this.state.selectedFilter) ? '无匹配链接' : '暂无链接';
      container.innerHTML = '<div style="color:var(--text2);font-size:12px;text-align:center;padding:20px">' + msg + '</div>';
      return;
    }

    const listPath = isSelected ? 'selectedResources.links' : 'resources.links';

    container.innerHTML = displayLinks.map((link, index) => {
      const realIndex = isSelected ? links.indexOf(link) : index;
      const isSelectedItem = isSelected || this.isResourceSelected('links', link);
      const batchKey = isSelected ? 'links:' + realIndex : '';
      const isBatchSelected = isSelected && this.state.batchMode && this.state.batchSelected.has(batchKey);
      const batchClass = isSelected && this.state.batchMode ? ' batch-mode' + (isBatchSelected ? ' batch-selected' : '') : '';
      const batchCheckbox = isSelected && this.state.batchMode
        ? '<input type="checkbox" class="batch-checkbox" ' + (isBatchSelected ? 'checked' : '') + ' onclick="App.toggleBatchSelect(\'' + batchKey + '\',event)">'
        : '';
      const onclickAction = isSelected && this.state.batchMode
        ? `App.toggleBatchSelect('${batchKey}')`
        : `App.toggleResourceSelection('links', App.state.${listPath}[${realIndex}])`;
      return `
        <div class="link-row ${isSelectedItem ? 'selected' : ''}${batchClass}" onclick="${onclickAction}">
          ${batchCheckbox}
          <span class="link-icon"></span>
          <span class="link-name">${this.escapeHtml(link.text || link.name || link.url)}</span>
          <div class="link-check"></div>
        </div>
      `;
    }).join('');
  },

  // 下载链接资源渲染（区别于普通链接：包含高速下载按钮和文件大小信息）
  renderDownloadList(containerId, downloads, isSelected = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // 已选面板应用筛选器
    let displayDownloads = downloads;
    if (isSelected && this.state.selectedFilter) {
      const filter = this.state.selectedFilter.toLowerCase();
      displayDownloads = downloads.filter(d => {
        const name = (d.name || d.text || '').toLowerCase();
        const url = (d.url || '').toLowerCase();
        return name.includes(filter) || url.includes(filter);
      });
    }

    if (displayDownloads.length === 0) {
      const msg = (isSelected && this.state.selectedFilter) ? '无匹配下载链接' : '暂无下载链接';
      container.innerHTML = '<div style="color:var(--text2);font-size:12px;text-align:center;padding:20px">' + msg + '</div>';
      return;
    }

    const listPath = isSelected ? 'selectedResources.downloads' : 'resources.downloads';

    container.innerHTML = displayDownloads.map((dl, index) => {
      const realIndex = isSelected ? downloads.indexOf(dl) : index;
      const isSelectedItem = isSelected || this.isResourceSelected('downloads', dl);
      const batchKey = isSelected ? 'downloads:' + realIndex : '';
      const isBatchSelected = isSelected && this.state.batchMode && this.state.batchSelected.has(batchKey);
      const batchClass = isSelected && this.state.batchMode ? ' batch-mode' + (isBatchSelected ? ' batch-selected' : '') : '';
      const batchCheckbox = isSelected && this.state.batchMode
        ? '<input type="checkbox" class="batch-checkbox" ' + (isBatchSelected ? 'checked' : '') + ' onclick="App.toggleBatchSelect(\'' + batchKey + '\',event)">'
        : '';
      const onclickAction = isSelected && this.state.batchMode
        ? `App.toggleBatchSelect('${batchKey}')`
        : `App.toggleResourceSelection('downloads', App.state.${listPath}[${realIndex}])`;
      // 文件大小格式化
      const sizeStr = dl.size ? this.formatFileSize(dl.size) : '';
      // 来源标记（github/gitlab/网盘等）
      const sourceBadge = dl.source ? `<span style="color:var(--primary);font-size:10px;background:var(--surface2);padding:1px 5px;border-radius:3px;">${this.escapeHtml(dl.source)}</span>` : '';
      // 高速下载按钮（仅未选中时显示）
      const fastDlBtn = !isSelected
        ? `<button class="batch-btn" style="padding:2px 8px;font-size:11px;" onclick="event.stopPropagation();App.fastDownload('${this.escapeHtml(dl.url)}','${this.escapeHtml(dl.name || 'download')}')" title="高速下载（多线程并行）">⚡ 下载</button>`
        : '';
      return `
        <div class="link-row ${isSelectedItem ? 'selected' : ''}${batchClass}" onclick="${onclickAction}" style="display:flex;align-items:center;gap:8px;">
          ${batchCheckbox}
          <span style="font-size:14px;">⬇</span>
          <div style="flex:1;min-width:0;">
            <div class="link-name">${this.escapeHtml(dl.name || dl.text || dl.url)}</div>
            <div style="font-size:10px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.escapeHtml(dl.url || '')}</div>
          </div>
          ${sizeStr ? `<span style="font-size:10px;color:var(--text2);">${sizeStr}</span>` : ''}
          ${sourceBadge}
          ${fastDlBtn}
          <div class="link-check"></div>
        </div>
      `;
    }).join('');
  },

  // 格式化文件大小
  formatFileSize(bytes) {
    if (!bytes || bytes < 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  },

  renderTextList(containerId, texts, isSelected = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // 已选面板应用筛选器
    let displayTexts = texts;
    if (isSelected && this.state.selectedFilter) {
      const filter = this.state.selectedFilter.toLowerCase();
      displayTexts = texts.filter(t => {
        const content = (t.content || '').toLowerCase();
        const name = (t.name || '').toLowerCase();
        return content.includes(filter) || name.includes(filter);
      });
    }

    if (displayTexts.length === 0) {
      const msg = (isSelected && this.state.selectedFilter) ? '无匹配文本' : '暂无文本';
      container.innerHTML = '<div style="color:var(--text2);font-size:12px;text-align:center;padding:20px">' + msg + '</div>';
      return;
    }

    const listPath = isSelected ? 'selectedResources.texts' : 'resources.texts';

    container.innerHTML = displayTexts.map((text, index) => {
      const realIndex = isSelected ? texts.indexOf(text) : index;
      const isSelectedItem = isSelected || this.isResourceSelected('texts', text);
      const batchKey = isSelected ? 'texts:' + realIndex : '';
      const isBatchSelected = isSelected && this.state.batchMode && this.state.batchSelected.has(batchKey);
      const batchClass = isSelected && this.state.batchMode ? ' batch-mode' + (isBatchSelected ? ' batch-selected' : '') : '';
      const batchCheckbox = isSelected && this.state.batchMode
        ? '<input type="checkbox" class="batch-checkbox" ' + (isBatchSelected ? 'checked' : '') + ' onclick="App.toggleBatchSelect(\'' + batchKey + '\',event)">'
        : '';
      const onclickAction = isSelected && this.state.batchMode
        ? `App.toggleBatchSelect('${batchKey}')`
        : `App.toggleResourceSelection('texts', App.state.${listPath}[${realIndex}])`;
      return `
        <div class="text-block ${isSelectedItem ? 'selected' : ''}${batchClass}" onclick="${onclickAction}">
          ${batchCheckbox}
          <div class="text-content">${this.escapeHtml(text.content || '')}</div>
        </div>
      `;
    }).join('');
  },

  isResourceSelected(type, resource) {
    const matchKey = resource.url || resource.content;
    return this.state.selectedResources[type].some(r => (r.url || r.content) === matchKey);
  },

  // ===== 导出功能 =====
  exportToWSW() {
    const selected = this.getAllSelectedResources();
    if (selected.length === 0) {
      this.showToast('请先选择要导出的资源');
      return;
    }

    if (window.electronAPI?.exportToWSW) {
      window.electronAPI.exportToWSW(selected, this.state.activeTabId);
    }
  },

  exportToExcel() {
    const selected = this.getAllSelectedResources();
    if (selected.length === 0) {
      this.showToast('请先选择要导出的资源');
      return;
    }

    if (window.electronAPI?.exportToExcel) {
      window.electronAPI.exportToExcel(selected, this.state.activeTabId);
    }
  },

  getAllSelectedResources() {
    const all = [];
    Object.values(this.state.selectedResources).forEach(list => {
      all.push(...list);
    });
    return all;
  },

  // ===== 视频预处理与智能导出 =====

  // 清理文件名中的非法字符
  safeFileName(name) {
    if (!name) return 'resource_' + Date.now();
    return name.replace(/[<>:"/\\|?*\s]/g, '_').replace(/_+/g, '_').substring(0, 80);
  },

  // 渲染进程的路径拼接（替代 Node.js path.join）
  pathJoin(dir, name) {
    const sep = dir.includes('\\') ? '\\' : '/';
    const cleanDir = dir.replace(/[\\/]+$/, '');
    const cleanName = name.replace(/^[\\/]+/, '');
    return cleanDir + sep + cleanName;
  },

  // 获取当前页面 URL（用于判断 B 站视频）
  getCurrentUrl() {
    const urlInput = document.getElementById('urlInput');
    return urlInput ? urlInput.value : '';
  },

  // 获取当前页面标题（用于视频命名）
  getCurrentPageTitle() {
    const activeTab = this.state.tabs.find(t => t.id === this.state.activeTabId);
    if (activeTab && activeTab.title) {
      return activeTab.title;
    }
    return '';
  },

  // 判断是否为 B 站视频页面
  isBilibiliPage() {
    const url = this.getCurrentUrl();
    return url.includes('bilibili.com/video/') || url.match(/^BV\w+/);
  },

  // 判断视频资源是否需要预处理（blob:、m3u8 需要提前处理）
  needsPreprocess(resource) {
    if (!resource || !resource.url) return false;
    const url = resource.url;
    // blob: URL 需要通过 BrowserView fetch 获取数据
    if (url.startsWith('blob:')) return true;
    // m3u8 流媒体需要下载合并 ts 片段
    if (url.includes('.m3u8') || url.includes('.ts')) return true;
    return false;
  },

  // 判断是否为 B 站视频资源（通过 streamType 或 URL 特征判断）
  isBilibiliVideo(resource) {
    if (!resource) return false;
    // 通过 streamType 标记判断
    if (resource.streamType && resource.streamType.includes('B站')) return true;
    // 通过 URL 域名判断
    if (resource.url) {
      try {
        const hostname = new URL(resource.url).hostname;
        if (hostname.includes('bilivideo.com') || hostname.includes('bilivideo.cn') || hostname.includes('hdslb.com')) {
          return true;
        }
      } catch {}
    }
    // 如果当前页面是 B 站视频页面,且资源是视频类型
    if (this.isBilibiliPage() && resource.type === 'video') return true;
    return false;
  },

  // 视频预处理：添加到已选后立即触发
  async preprocessVideoIfNeeded(resource) {
    if (!this.needsPreprocess(resource)) return;

    // 标记为转码中
    resource.preprocessStatus = 'processing';
    this.renderResources();

    try {
      const referer = this.getCurrentUrl();
      const result = await window.electronAPI.preprocessVideo(
        resource.url,
        referer,
        this.safeFileName(resource.name || 'video')
      );

      if (result && result.success) {
        resource.localPath = result.localPath;
        resource.preprocessExt = result.ext;
        resource.preprocessStatus = 'done';
        this.setStatus(`视频预处理完成: ${resource.name || 'video'}`);
      } else {
        resource.preprocessStatus = 'failed';
        this.setStatus(`视频预处理失败: ${result?.error || '未知错误'}`);
      }
    } catch (err) {
      resource.preprocessStatus = 'failed';
      console.error('Video preprocess failed:', err);
    }

    this.renderResources();
  },

  // 智能导出到文件夹（带下载进度对话框）
  async exportToFolder() {
    const selected = this.getAllSelectedResources();
    if (selected.length === 0) {
      this.showToast('请先选择要导出的资源');
      return;
    }

    // 选择导出目录
    const destDir = await window.electronAPI.selectDirectory();
    if (!destDir) return;

    // 打开下载进度对话框
    this.showDownloadDialog(selected.length);
    this.setStatus('正在导出资源…');

    let successCount = 0;
    let failCount = 0;
    const total = selected.length;
    this.state.downloadCancelled = false; // 重置渲染进程取消标志
    // 重置主进程全局取消标志
    if (window.electronAPI?.resetDownloadCancel) {
      await window.electronAPI.resetDownloadCancel();
    }
    const activeFileIds = new Set(); // 跟踪活跃的 B站视频 fileId

    // B站视频进度监听（全局，通过 fileId 分发到对应项）
    let biliProgressUnsubscribe = null;
    if (window.electronAPI.onBilibiliDownloadProgress) {
      biliProgressUnsubscribe = window.electronAPI.onBilibiliDownloadProgress((data) => {
        if (data.fileId && activeFileIds.has(data.fileId)) {
          this.updateDownloadItem(data.fileId, data);
        }
      });
    }

    for (let i = 0; i < selected.length; i++) {
      // 检查取消标志
      if (this.state.downloadCancelled) {
        // 将剩余项标记为已取消
        for (let j = i; j < selected.length; j++) {
          const res = selected[j];
          const isBili = this.isBilibiliVideo(res);
          const cancelFileId = isBili ? 'bili_' + j : (res.type === 'video' ? 'video_' + j : (res.type === 'text' ? 'text_' + j : 'img_' + j));
          this.updateDownloadItemStatus(cancelFileId, 'error', '已取消');
        }
        break;
      }

      const resource = selected[i];
      // 生成与 showDownloadDialog 一致的 fileId
      const isBili = this.isBilibiliVideo(resource);
      const fileId = isBili ? 'bili_' + i : (resource.type === 'video' ? 'video_' + i : (resource.type === 'text' ? 'text_' + i : 'img_' + i));

      // 更新对话框：开始处理第 i 项
      this.updateDownloadDialogProgress(i, total);
      this.updateDownloadItemStatus(fileId, 'processing', resource.name || 'resource');
      this.setStatus(`导出中 ${i + 1}/${total}…`);

      try {
        const result = await this.exportSingleResource(resource, destDir, i, fileId, activeFileIds);
        if (result && result.success) {
          successCount++;
          this.updateDownloadItemStatus(fileId, 'done', result.title || resource.name || 'resource');
        } else {
          failCount++;
          this.updateDownloadItemStatus(fileId, 'error', result?.error || '未知错误');
          console.error('Export failed:', resource.name, result?.error);
        }
      } catch (err) {
        failCount++;
        this.updateDownloadItemStatus(fileId, 'error', err.message || '异常');
        console.error('Export error:', resource.name, err);
      }

      // 更新总进度
      this.updateDownloadDialogProgress(i + 1, total);
    }

    // 移除 B站视频进度监听
    if (biliProgressUnsubscribe) biliProgressUnsubscribe();

    // 导出完成
    const wasCancelled = this.state.downloadCancelled;
    this.finishDownloadDialog(successCount, failCount, wasCancelled);
    if (wasCancelled) {
      this.setStatus(`下载已取消: ${successCount} 成功, ${failCount} 失败`);
      this.showToast(`下载已取消，已导出 ${successCount} 个资源`);
    } else {
      this.setStatus(`导出完成: ${successCount} 成功, ${failCount} 失败`);
      this.showToast(`已导出 ${successCount} 个资源${failCount > 0 ? `, ${failCount} 个失败` : ''}`);
    }

    // 记录工作流
    this.saveWorkflowRecord(selected, destDir);
  },

  // 导出单个资源
  async exportSingleResource(resource, destDir, index, fileId, activeFileIds) {
    // 文本资源：直接保存为 txt
    if (resource.type === 'text' || resource.content) {
      const fileName = this.safeFileName(resource.name || `text_${index}`) + '.txt';
      const filePath = this.pathJoin(destDir, fileName);
      return await window.electronAPI.saveTextFile(filePath, resource.content || '');
    }

    if (!resource.url) {
      return { success: false, error: '资源无 URL' };
    }

    // 视频资源优先使用页面标题作为文件名，其他资源用 resource.name
    const isVideo = resource.type === 'video';
    const isBili = this.isBilibiliVideo(resource);
    let baseName;
    if (isVideo) {
      // 视频使用页面标题命名，多个视频时追加序号避免覆盖
      const pageTitle = this.getCurrentPageTitle();
      if (pageTitle) {
        baseName = this.safeFileName(pageTitle);
        // 如果有多个视频资源，追加序号区分
        const videoCount = (this.state.selectedResources.videos || []).length;
        if (videoCount > 1) {
          baseName = baseName + '_' + (index + 1);
        }
      } else {
        baseName = this.safeFileName(resource.name || `video_${index}`);
      }
    } else {
      baseName = this.safeFileName(resource.name || `resource_${index}`);
    }

    // B 站视频：使用专用下载器（传入页面 URL）
    if (isVideo && isBili) {
      const pageUrl = this.getCurrentUrl();
      const fileName = baseName + '.mp4';
      const savePath = this.pathJoin(destDir, fileName);
      const biliFileId = 'bili_' + index;
      activeFileIds.add(biliFileId);

      this.updateDownloadItemStatus(biliFileId, 'processing', resource.name || 'B站视频');

      try {
        const result = await window.electronAPI.downloadBilibiliVideo(pageUrl, savePath, pageUrl, biliFileId);
        activeFileIds.delete(biliFileId);
        return result;
      } catch (err) {
        activeFileIds.delete(biliFileId);
        throw err;
      }
    }

    // 已预处理的视频：直接复制本地文件
    if (isVideo && resource.localPath) {
      const ext = resource.preprocessExt || 'mp4';
      const fileName = baseName + '.' + ext;
      const destPath = this.pathJoin(destDir, fileName);
      this.updateDownloadItemStatus(fileId, 'done', resource.name || 'video');
      return await window.electronAPI.copyLocalFile(resource.localPath, destPath);
    }

    // 普通视频：使用智能下载
    if (isVideo) {
      const fileName = baseName + '.mp4';
      const savePath = this.pathJoin(destDir, fileName);
      const videoFileId = 'video_' + index;
      activeFileIds.add(videoFileId);

      // 监听普通视频下载进度
      let progressUnsubscribe = null;
      if (window.electronAPI.onDownloadProgress) {
        progressUnsubscribe = window.electronAPI.onDownloadProgress((data) => {
          if (data.fileId === videoFileId || !data.fileId) {
            this.updateDownloadItem(videoFileId, data);
          }
        });
      }

      try {
        const result = await window.electronAPI.downloadVideoSmart(resource.url, savePath, this.getCurrentUrl(), videoFileId);
        activeFileIds.delete(videoFileId);
        if (progressUnsubscribe) progressUnsubscribe();
        return result;
      } catch (err) {
        activeFileIds.delete(videoFileId);
        if (progressUnsubscribe) progressUnsubscribe();
        throw err;
      }
    }

    // 图片/音频/链接：普通下载
    const ext = this.getExtFromUrl(resource.url) || (resource.format ? resource.format.toLowerCase() : 'bin');
    const fileName = baseName + '.' + ext;
    const savePath = this.pathJoin(destDir, fileName);
    const imgFileId = 'img_' + index;

    this.updateDownloadItemStatus(imgFileId, 'processing', resource.name || 'resource');
    const result = await window.electronAPI.downloadFile(resource.url, savePath, this.getCurrentUrl(), imgFileId);
    if (result && result.success) {
      this.updateDownloadItemStatus(imgFileId, 'done', resource.name || 'resource');
    }
    return result;
  },

  // ===== 下载进度对话框 =====
  showDownloadDialog(totalCount) {
    const overlay = document.getElementById('dlOverlay');
    const body = document.getElementById('dlBody');
    const closeBtn = document.getElementById('dlCloseBtn');
    if (!overlay || !body) return;

    // 隐藏 BrowserView（OS 级原生视图会覆盖 HTML 内容，导致对话框不可见）
    if (window.electronAPI?.setBrowserviewVisible) {
      window.electronAPI.setBrowserviewVisible(false);
    }

    // 构建下载项列表
    const selected = this.getAllSelectedResources();
    body.innerHTML = selected.map((resource, i) => {
      const name = this.escapeHtml(resource.name || resource.url || `资源 ${i + 1}`);
      const typeIcon = resource.type === 'video' ? '🎬' : (resource.type === 'image' ? '🖼' : (resource.type === 'text' ? '📝' : '📄'));
      const isBili = this.isBilibiliVideo(resource);
      const biliTag = isBili ? '<span style="color:#00a1d6;font-size:10px"> B站</span>' : '';
      const fileId = isBili ? 'bili_' + i : (resource.type === 'video' ? 'video_' + i : (resource.type === 'text' ? 'text_' + i : 'img_' + i));
      return `
        <div class="dl-item" data-file-id="${fileId}">
          <div class="dl-item-header">
            <span class="dl-item-name">${typeIcon} ${name}${biliTag}</span>
            <span class="dl-item-status" data-status>等待中</span>
          </div>
          <div class="dl-item-track"><div class="dl-item-fill" data-fill></div></div>
          <div class="dl-item-detail" data-detail style="display:none">
            <span data-downloaded>0 MB</span>
            <span data-speed></span>
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('dlCount').textContent = `0 / ${totalCount}`;
    document.getElementById('dlTotalPercent').textContent = '0%';
    document.getElementById('dlTotalFill').style.width = '0%';
    document.getElementById('dlTitle').textContent = '📥 正在导出资源';
    if (closeBtn) closeBtn.style.display = 'none';
    const cancelBtn = document.getElementById('dlCancelBtn');
    if (cancelBtn) cancelBtn.style.display = '';

    overlay.classList.add('show');
  },

  updateDownloadDialogProgress(current, total) {
    const countEl = document.getElementById('dlCount');
    const percentEl = document.getElementById('dlTotalPercent');
    const fillEl = document.getElementById('dlTotalFill');
    if (countEl) countEl.textContent = `${current} / ${total}`;
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    if (percentEl) percentEl.textContent = percent + '%';
    if (fillEl) fillEl.style.width = percent + '%';
  },

  updateDownloadItem(fileId, data) {
    const item = document.querySelector(`.dl-item[data-file-id="${fileId}"]`);
    if (!item) return;

    const fill = item.querySelector('[data-fill]');
    const status = item.querySelector('[data-status]');
    const detail = item.querySelector('[data-detail]');
    const downloadedEl = item.querySelector('[data-downloaded]');
    const speedEl = item.querySelector('[data-speed]');

    // 主进程发送的是 progress 字段（兼容 percent）
    const progress = data.progress !== undefined ? data.progress : data.percent;

    if (progress !== undefined && fill) {
      fill.style.width = progress + '%';
    }
    if (data.statusText && status) {
      status.textContent = data.statusText;
    } else if (data.stage === 'done' || data.status === 'done' || data.status === 'complete') {
      if (status) status.textContent = '✓ 完成';
      if (fill) { fill.style.width = '100%'; fill.classList.add('done'); }
    } else if (data.stage === 'error' || data.status === 'error') {
      if (status) status.textContent = '✗ 失败';
      if (fill) fill.classList.add('error');
    } else if (progress !== undefined && status) {
      status.textContent = Math.round(progress) + '%';
    }

    // 显示已下载大小和速度
    if ((data.downloaded !== undefined || data.total !== undefined) && detail) {
      detail.style.display = 'flex';
      if (downloadedEl && data.downloaded !== undefined) {
        const dl = data.total ? `${(data.downloaded / 1048576).toFixed(1)} / ${(data.total / 1048576).toFixed(1)} MB` : `${(data.downloaded / 1048576).toFixed(1)} MB`;
        downloadedEl.textContent = dl;
      }
      // statusText 中包含速度信息，提取显示
      if (speedEl && data.statusText) {
        speedEl.textContent = data.statusText;
      }
    }
  },

  updateDownloadItemStatus(fileId, status, name) {
    const item = document.querySelector(`.dl-item[data-file-id="${fileId}"]`);
    if (!item) return;

    const fill = item.querySelector('[data-fill]');
    const statusEl = item.querySelector('[data-status]');

    if (status === 'processing') {
      if (statusEl) statusEl.textContent = '⏳ 下载中…';
    } else if (status === 'done') {
      if (statusEl) statusEl.textContent = '✓ 完成';
      if (fill) { fill.style.width = '100%'; fill.classList.add('done'); }
    } else if (status === 'error') {
      if (statusEl) statusEl.textContent = '✗ ' + (name || '失败');
      if (fill) fill.classList.add('error');
    }
  },

  finishDownloadDialog(successCount, failCount, cancelled = false) {
    const titleEl = document.getElementById('dlTitle');
    const closeBtn = document.getElementById('dlCloseBtn');
    const cancelBtn = document.getElementById('dlCancelBtn');
    if (titleEl) {
      if (cancelled) {
        titleEl.textContent = `⏹ 已取消: ${successCount} 成功${failCount > 0 ? `, ${failCount} 失败` : ''}`;
      } else {
        titleEl.textContent = `✅ 导出完成: ${successCount} 成功${failCount > 0 ? `, ${failCount} 失败` : ''}`;
      }
    }
    if (closeBtn) closeBtn.style.display = '';
    if (cancelBtn) cancelBtn.style.display = 'none';
  },

  // 取消下载
  async cancelDownload() {
    this.state.downloadCancelled = true;
    // 通知主进程中止活跃的 HTTP 请求
    if (window.electronAPI?.cancelDownload) {
      await window.electronAPI.cancelDownload();
    }
    this.setStatus('正在取消下载…');
  },

  closeDownloadDialog() {
    const overlay = document.getElementById('dlOverlay');
    if (overlay) overlay.classList.remove('show');
    // 恢复 BrowserView 显示
    if (window.electronAPI?.setBrowserviewVisible) {
      window.electronAPI.setBrowserviewVisible(this.state.currentModule === 'scraper');
    }
  },

  // 从 URL 提取扩展名
  getExtFromUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      const pathname = u.pathname;
      const dot = pathname.lastIndexOf('.');
      if (dot > -1) return pathname.substring(dot + 1).toLowerCase();
    } catch {}
    // 从原始字符串提取
    const qIdx = url.indexOf('?');
    const path = qIdx > -1 ? url.substring(0, qIdx) : url;
    const dot = path.lastIndexOf('.');
    const slash = path.lastIndexOf('/');
    if (dot > slash && dot > -1) return path.substring(dot + 1).toLowerCase();
    return '';
  },

  // 保存工作流记录
  async saveWorkflowRecord(resources, outputPath) {
    try {
      const pageTitle = this.getCurrentPageTitle() || this.getCurrentUrl() || '未命名';
      const workflow = {
        title: pageTitle,
        url: this.getCurrentUrl(),
        time: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        resourceCount: resources.length,
        resources: resources.map(r => ({
          type: r.type,
          name: r.name || r.text || '',
          url: r.url,
          pageUrl: r.pageUrl || '',
          format: r.format,
          streamType: r.streamType,
          content: r.content || r.text || ''
        })),
        outputPath: outputPath
      };
      if (window.electronAPI?.saveWorkflow) {
        await window.electronAPI.saveWorkflow(workflow);
      }
    } catch (e) {
      console.error('Save workflow failed:', e);
    }
  },

  // ===== 历史记录 =====
  addToHistory(url) {
    this.state.history = this.state.history.filter(h => h !== url);
    this.state.history.unshift(url);
    if (this.state.history.length > 50) this.state.history.pop();
  },

  toggleHistory() {
    const dropdown = document.getElementById('historyDropdown');
    if (!dropdown) return;

    if (dropdown.style.display === 'none') {
      dropdown.style.display = 'block';
      this.renderHistory();
    } else {
      dropdown.style.display = 'none';
    }
  },

  renderHistory() {
    const dropdown = document.getElementById('historyDropdown');
    if (!dropdown) return;

    if (this.state.history.length === 0) {
      dropdown.innerHTML = '<div style="padding:16px;color:var(--text2);font-size:12px;text-align:center">暂无历史记录</div>';
      return;
    }

    dropdown.innerHTML = this.state.history.map(url => `
      <div style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" onclick="App.loadUrl('${this.escapeHtml(url)}'); App.toggleHistory()">
        ${this.escapeHtml(url)}
      </div>
    `).join('');
  },

  // ===== 辅助功能 =====
  showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.toggle('hidden', !show);
  },

  setStatus(text) {
    const statusText = document.getElementById('statusText');
    if (statusText) statusText.textContent = text;
  },

  // 高速下载（多线程分块并行，区别于普通浏览器下载）
  async fastDownload(url, name) {
    if (!url) { this.showToast('下载链接无效'); return; }
    try {
      // 选择保存路径
      const safeName = (name || 'download').replace(/[<>:"/\\|?*]/g, '_').substring(0, 80);
      const probe = await window.electronAPI?.probeDownload?.(url);
      let suggestedName = safeName;
      let totalSize = 0;
      let acceptRanges = false;
      if (probe && probe.success) {
        if (probe.filename) suggestedName = probe.filename;
        totalSize = probe.total || 0;
        acceptRanges = probe.acceptRanges;
      }
      // 补全扩展名
      if (!/\.[a-z0-9]{1,5}$/i.test(suggestedName)) {
        const m = url.match(/\.([a-z0-9]{1,5})(\?|#|$)/i);
        if (m) suggestedName += '.' + m[1].toLowerCase();
      }
      const savePath = await window.electronAPI?.selectSaveFile?.({
        defaultPath: suggestedName,
        filters: [{ name: '所有文件', extensions: ['*'] }]
      });
      if (!savePath) return;

      // 显示下载进度提示
      const mode = acceptRanges && totalSize > 1024 * 1024 ? '⚡ 多线程并行' : '🔄 单线程';
      const sizeStr = totalSize ? ' · ' + this.formatFileSize(totalSize) : '';
      this.showToast(`${mode}下载开始${sizeStr}`);

      const fileId = 'fast_' + Date.now();
      const result = await window.electronAPI?.fastDownload?.(url, savePath, url, fileId);
      if (result && result.success) {
        const speedStr = result.avgSpeed ? ' · 平均 ' + this.formatFileSize(result.avgSpeed) + '/s' : '';
        const modeStr = result.mode === 'parallel' ? '⚡ 多线程' : '🔄 单线程';
        this.showToast(`✓ 下载完成：${result.filename || suggestedName}${speedStr}（${modeStr}）`);
      } else {
        this.showToast('✗ 下载失败：' + (result?.error || '未知错误'));
      }
    } catch (e) {
      this.showToast('✗ 下载异常：' + (e.message || e));
    }
  },

  showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  },

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  hideSpaBanner() {
    const banner = document.getElementById('spaBanner');
    if (banner) banner.classList.add('hidden');
  },

  closeExportDialog() {
    const overlay = document.getElementById('exportOverlay');
    if (overlay) overlay.classList.remove('show');
  },

  // 导出对话框"开始导出"入口（默认导出到文件夹）
  startExport() {
    this.closeExportDialog();
    this.exportToFolder();
  }
};

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
