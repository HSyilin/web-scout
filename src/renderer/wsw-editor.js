// HT 编辑器模块（完整功能版）
const WSWEditor = {
  state: {
    doc: null,
    zoom: 1,
    showGrid: true,
    selectedCards: new Set(),
    editingCardId: null,
    isDragging: false,
    isResizing: false,
    isPanning: false,
    dragOffset: { x: 0, y: 0 },
    panX: 0,
    panY: 0,
    maxZ: 1,
    undoStack: [],
    spaceHeld: false,
    clipboard: [],
    // 标签页功能
    tabs: [],
    activeTabId: null
  },

  init() {
    this.bindEvents();
    // Task 16.3: 监听 AI 工作流任务删除事件，将关联容器显示为"任务已删除"占位
    try {
      if (window.electronAPI?.aiworkflowAPI?.onTaskDeleted) {
        window.electronAPI.aiworkflowAPI.onTaskDeleted((taskId) => {
          this.handleAiworkflowTaskDeleted(taskId);
        });
      }
    } catch (e) { /* ignore */ }
  },

  // Task 16.3: 任务删除联动——标记关联容器
  handleAiworkflowTaskDeleted(taskId) {
    if (!this.state.doc || !taskId) return;
    let changed = false;
    this.state.doc.cards.forEach(card => {
      if (card.type === 'aiworkflow' && String(card.taskId) === String(taskId)) {
        card.taskDeleted = true;
        card.taskId = null;
        card.lastResultSummary = null;
        card.lastRunAt = null;
        changed = true;
      }
    });
    if (changed) this.renderCanvas();
  },

  bindEvents() {
    const wrap = document.getElementById('wswCanvasWrap');
    const canvas = document.getElementById('wswCanvas');
    if (!wrap || !canvas) return;

    // 画布点击 - 取消选中
    wrap.addEventListener('mousedown', (e) => {
      if (e.target === wrap || e.target === canvas || e.target.classList.contains('wsw-canvas-inner')) {
        this.deselectAll();
        // 关闭编辑
        if (this.state.editingCardId !== null) {
          this.commitEdit();
        }
      }
      // 关闭右键菜单
      this.hideContextMenu();
    });

    // 画布右键菜单
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showCanvasContextMenu(e);
    });

    // 滚轮缩放
    wrap.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        this.setZoom(this.state.zoom + delta);
      }
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      if (App.state.currentModule !== 'wsw') return;
      // 编辑中不拦截快捷键
      if (this.state.editingCardId !== null && e.target.contentEditable === 'true') return;

      if (e.key === 'Delete' && this.state.selectedCards.size > 0) {
        e.preventDefault();
        this.deleteSelected();
      }
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        this.saveDoc();
      }
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        this.undo();
      }
      if (e.ctrlKey && e.key === 'd' && this.state.selectedCards.size > 0) {
        e.preventDefault();
        this.duplicateSelected();
      }
      if (e.ctrlKey && e.key === 'c' && this.state.selectedCards.size > 0) {
        e.preventDefault();
        this.copySelected();
      }
      if (e.ctrlKey && e.key === 'x' && this.state.selectedCards.size > 0) {
        e.preventDefault();
        this.cutSelected();
      }
      if (e.ctrlKey && e.key === 'v' && this.state.clipboard && this.state.clipboard.length > 0) {
        e.preventDefault();
        this.paste();
      }
      if (e.ctrlKey && e.key === 'a') {
        e.preventDefault();
        this.selectAll();
      }
    });
  },

  // 全选
  selectAll() {
    if (!this.state.doc) return;
    this.state.selectedCards.clear();
    this.state.doc.cards.forEach(c => this.state.selectedCards.add(c.id));
    this.updateCardSelection();
  },

  // ===== 画布背景设置 =====
  showBackgroundPanel() {
    if (!this.state.doc) return;
    const bg = this.state.doc.background || { type: 'color', value: '#1a1a2e' };
    const overlay = document.createElement('div');
    overlay.className = 'wsw-link-overlay';

    // 预设颜色
    const presets = ['#1a1a2e', '#0f0f1a', '#16213e', '#0d1b2a', '#1b263b', '#2c3e50', '#ffffff', '#f0f1f5', '#f5f6fa'];

    overlay.innerHTML = '<div class="wsw-link-panel" style="width:480px">' +
      '<div class="wsw-link-header"><span>🎨 画布背景设置</span><button class="wsw-link-close">✕</button></div>' +
      '<div class="wsw-link-body">' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">背景类型</label>' +
          '<div class="wsw-bg-type-tabs">' +
            '<button class="wsw-bg-type-tab' + (bg.type === 'color' ? ' active' : '') + '" data-type="color">🎨 纯色</button>' +
            '<button class="wsw-bg-type-tab' + (bg.type === 'gradient' ? ' active' : '') + '" data-type="gradient">🌈 渐变</button>' +
          '</div>' +
        '</div>' +
        '<div class="wsw-link-section" id="bgColorSection" style="display:' + (bg.type === 'color' ? 'block' : 'none') + '">' +
          '<label class="wsw-link-label">选择颜色</label>' +
          '<div class="wsw-color-presets">' +
            presets.map(c => '<button class="wsw-color-preset' + (bg.value === c ? ' selected' : '') + '" style="background:' + c + '" data-color="' + c + '"></button>').join('') +
          '</div>' +
          '<div style="margin-top:10px"><input type="color" id="bgColorPicker" value="' + (bg.value || '#1a1a2e') + '" style="width:60px;height:36px;cursor:pointer;border:1px solid var(--border);border-radius:6px;background:none"></div>' +
        '</div>' +
        '<div class="wsw-link-section" id="bgGradientSection" style="display:' + (bg.type === 'gradient' ? 'block' : 'none') + '">' +
          '<label class="wsw-link-label">渐变颜色1</label>' +
          '<input type="color" id="bgGrad1" value="' + (bg.grad1 || '#667eea') + '" style="width:60px;height:36px;cursor:pointer;border:1px solid var(--border);border-radius:6px;background:none">' +
          '<label class="wsw-link-label" style="margin-top:8px">渐变颜色2</label>' +
          '<input type="color" id="bgGrad2" value="' + (bg.grad2 || '#764ba2') + '" style="width:60px;height:36px;cursor:pointer;border:1px solid var(--border);border-radius:6px;background:none">' +
          '<label class="wsw-link-label" style="margin-top:8px">渐变方向</label>' +
          '<select id="bgGradDir" class="wsw-link-select">' +
            '<option value="135"' + (bg.direction === '135' ? ' selected' : '') + '>↘ 左上→右下</option>' +
            '<option value="90"' + (bg.direction === '90' ? ' selected' : '') + '>→ 左→右</option>' +
            '<option value="180"' + (bg.direction === '180' ? ' selected' : '') + '>↓ 上→下</option>' +
            '<option value="45"' + (bg.direction === '45' ? ' selected' : '') + '>↗ 左下→右上</option>' +
          '</select>' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">预览</label>' +
          '<div id="bgPreview" class="wsw-bg-preview" style="height:60px;border-radius:6px;border:1px solid var(--border)"></div>' +
        '</div>' +
      '</div>' +
      '<div class="wsw-link-footer">' +
        '<button class="wsw-link-btn cancel-btn">取消</button>' +
        '<button class="wsw-link-btn save-btn primary">应用</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);

    let bgType = bg.type || 'color';

    const updatePreview = () => {
      const preview = document.getElementById('bgPreview');
      if (bgType === 'color') {
        const color = document.getElementById('bgColorPicker').value;
        preview.style.background = color;
      } else {
        const g1 = document.getElementById('bgGrad1').value;
        const g2 = document.getElementById('bgGrad2').value;
        const dir = document.getElementById('bgGradDir').value;
        preview.style.background = 'linear-gradient(' + dir + 'deg, ' + g1 + ', ' + g2 + ')';
      }
    };

    // 类型切换
    overlay.querySelectorAll('.wsw-bg-type-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        bgType = tab.dataset.type;
        overlay.querySelectorAll('.wsw-bg-type-tab').forEach(t => t.classList.toggle('active', t === tab));
        document.getElementById('bgColorSection').style.display = bgType === 'color' ? 'block' : 'none';
        document.getElementById('bgGradientSection').style.display = bgType === 'gradient' ? 'block' : 'none';
        updatePreview();
      });
    });

    // 预设颜色
    overlay.querySelectorAll('.wsw-color-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.wsw-color-preset').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('bgColorPicker').value = btn.dataset.color;
        updatePreview();
      });
    });

    // 颜色变化
    ['bgColorPicker', 'bgGrad1', 'bgGrad2', 'bgGradDir'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updatePreview);
    });

    updatePreview();

    const close = () => overlay.remove();
    overlay.querySelector('.wsw-link-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.save-btn').addEventListener('click', () => {
      this.saveUndo();
      if (bgType === 'color') {
        this.state.doc.background = {
          type: 'color',
          value: document.getElementById('bgColorPicker').value
        };
      } else {
        this.state.doc.background = {
          type: 'gradient',
          grad1: document.getElementById('bgGrad1').value,
          grad2: document.getElementById('bgGrad2').value,
          direction: document.getElementById('bgGradDir').value
        };
      }
      this.applyBackground();
      close();
      App.showToast('背景已更新');
    });
  },

  applyBackground() {
    if (!this.state.doc || !this.state.doc.background) return;
    const canvas = document.getElementById('wswCanvas');
    if (!canvas) return;
    const bg = this.state.doc.background;
    if (bg.type === 'gradient') {
      canvas.style.background = 'linear-gradient(' + (bg.direction || '135') + 'deg, ' + (bg.grad1 || '#667eea') + ', ' + (bg.grad2 || '#764ba2') + ')';
    } else {
      canvas.style.background = bg.value || '#1a1a2e';
    }
  },

  // ===== 全局TTL设置 =====
  showTTLPanel() {
    if (!this.state.doc) return;
    const overlay = document.createElement('div');
    overlay.className = 'wsw-link-overlay';
    const currentTTL = this.state.doc.defaultTTL || 0;

    // TTL 预设
    const presets = [
      { label: '永不过期', value: 0 },
      { label: '5分钟', value: 300000 },
      { label: '30分钟', value: 1800000 },
      { label: '1小时', value: 3600000 },
      { label: '6小时', value: 21600000 },
      { label: '1天', value: 86400000 },
      { label: '3天', value: 259200000 },
      { label: '1周', value: 604800000 }
    ];

    overlay.innerHTML = '<div class="wsw-link-panel" style="width:440px">' +
      '<div class="wsw-link-header"><span>⏱ 全局TTL时间设置</span><button class="wsw-link-close">✕</button></div>' +
      '<div class="wsw-link-body">' +
        '<div class="wsw-link-hint">TTL（Time To Live）控制容器资源的过期时间。过期的容器在打开文件时会自动从工作流重新获取资源。</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">预设时间</label>' +
          '<div class="wsw-ttl-presets">' +
            presets.map(p => '<button class="wsw-ttl-preset' + (currentTTL === p.value ? ' active' : '') + '" data-ttl="' + p.value + '">' + p.label + '</button>').join('') +
          '</div>' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">自定义时间（毫秒）</label>' +
          '<input type="number" id="ttlCustom" value="' + currentTTL + '" min="0" step="60000" class="wsw-link-input" placeholder="0=永不过期">' +
          '<div class="wsw-link-hint">1秒=1000 ｜ 1分钟=60000 ｜ 1小时=3600000 ｜ 1天=86400000</div>' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">当前容器统计</label>' +
          '<div class="wsw-ttl-stats" id="ttlStats"></div>' +
        '</div>' +
      '</div>' +
      '<div class="wsw-link-footer">' +
        '<button class="wsw-link-btn cancel-btn">取消</button>' +
        '<button class="wsw-link-btn save-btn primary">应用</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);

    // 显示容器统计
    const containers = this.state.doc.cards.filter(c => ['videoContainer', 'audioContainer', 'textContainer', 'excelContainer'].includes(c.type));
    const stats = document.getElementById('ttlStats');
    if (containers.length === 0) {
      stats.innerHTML = '<div class="wsw-link-hint">暂无容器</div>';
    } else {
      let expiredCount = 0;
      let linkedCount = 0;
      containers.forEach(c => {
        if (c.workflowLink) linkedCount++;
        if (this.isContainerExpired(c)) expiredCount++;
      });
      stats.innerHTML =
        '<div class="wsw-link-preview-row"><b>容器总数:</b> ' + containers.length + '</div>' +
        '<div class="wsw-link-preview-row"><b>已链接工作流:</b> ' + linkedCount + '</div>' +
        '<div class="wsw-link-preview-row"><b>已过期:</b> ' + expiredCount + '</div>';
    }

    // 预设按钮
    overlay.querySelectorAll('.wsw-ttl-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.wsw-ttl-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('ttlCustom').value = btn.dataset.ttl;
      });
    });

    // 自定义输入时取消预设选中
    document.getElementById('ttlCustom').addEventListener('input', () => {
      const val = document.getElementById('ttlCustom').value;
      overlay.querySelectorAll('.wsw-ttl-preset').forEach(b => {
        b.classList.toggle('active', b.dataset.ttl === val);
      });
    });

    const close = () => overlay.remove();
    overlay.querySelector('.wsw-link-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.save-btn').addEventListener('click', () => {
      const ttl = parseInt(document.getElementById('ttlCustom').value) || 0;
      this.state.doc.defaultTTL = ttl;
      close();
      const label = ttl === 0 ? '永不过期' : '已设置全局TTL: ' + ttl + 'ms';
      App.showToast(label);

      // 重新渲染以更新状态显示
      this.renderCanvas();
    });
  },

  // ===== 文档操作 =====
  newDoc() {
    // 创建新标签页
    const now = Date.now();
    const newDoc = {
      version: '2.0',
      title: '未命名文档',
      cards: [],
      background: { type: 'color', value: '#1a1a2e' },
      showGrid: true,
      globalTimestamp: {
        created: now,
        modified: now,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
      },
      defaultTTL: 0
    };

    const tabId = 'tab_' + now;
    const tab = {
      id: tabId,
      doc: newDoc,
      zoom: 1,
      panX: 0,
      panY: 0,
      maxZ: 1,
      showGrid: true
    };

    this.state.tabs.push(tab);
    this.switchTab(tabId);
    this.renderTabs();
    App.showToast('已创建新文档');
  },

  // 切换标签页
  switchTab(tabId) {
    // 保存当前标签页状态
    if (this.state.activeTabId && this.state.doc) {
      const currentTab = this.state.tabs.find(t => t.id === this.state.activeTabId);
      if (currentTab) {
        currentTab.doc = this.state.doc;
        currentTab.zoom = this.state.zoom;
        currentTab.panX = this.state.panX;
        currentTab.panY = this.state.panY;
        currentTab.maxZ = this.state.maxZ;
        currentTab.showGrid = this.state.showGrid;
      }
    }

    // 切换到新标签页
    const tab = this.state.tabs.find(t => t.id === tabId);
    if (!tab) return;

    this.state.activeTabId = tabId;
    this.state.doc = tab.doc;
    this.state.zoom = tab.zoom;
    this.state.panX = tab.panX;
    this.state.panY = tab.panY;
    this.state.maxZ = tab.maxZ;
    this.state.showGrid = tab.showGrid;
    this.state.selectedCards.clear();
    this.state.editingCardId = null;
    this.state.undoStack = [];

    this.renderTabs();
    this.renderCanvas();
  },

  // 关闭标签页
  closeTab(tabId) {
    const idx = this.state.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    // 如果关闭的是当前标签页，切换到相邻标签页
    if (this.state.activeTabId === tabId) {
      if (this.state.tabs.length === 1) {
        // 最后一个标签页，清空
        this.state.tabs = [];
        this.state.activeTabId = null;
        this.state.doc = null;
        this.renderCanvas();
        document.getElementById('wswTabBar').style.display = 'none';
        document.getElementById('wswEmpty').style.display = 'flex';
        return;
      } else {
        // 切换到相邻标签页
        const newIdx = idx === 0 ? 1 : idx - 1;
        this.switchTab(this.state.tabs[newIdx].id);
      }
    }

    // 移除标签页
    this.state.tabs.splice(idx, 1);
    this.renderTabs();
  },

  // 渲染标签页栏
  renderTabs() {
    const tabBar = document.getElementById('wswTabBar');
    const tabsContainer = document.getElementById('wswTabs');

    if (this.state.tabs.length === 0) {
      tabBar.style.display = 'none';
      return;
    }

    tabBar.style.display = 'flex';
    tabsContainer.innerHTML = '';

    this.state.tabs.forEach(tab => {
      const tabEl = document.createElement('div');
      tabEl.className = 'wsw-tab' + (tab.id === this.state.activeTabId ? ' active' : '');
      tabEl.onclick = (e) => {
        if (!e.target.classList.contains('wsw-tab-close')) {
          this.switchTab(tab.id);
        }
      };

      const title = document.createElement('span');
      title.textContent = tab.doc.title || '未命名文档';
      title.style.flex = '1';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'wsw-tab-close';
      closeBtn.innerHTML = '×';
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      };

      tabEl.appendChild(title);
      tabEl.appendChild(closeBtn);
      tabsContainer.appendChild(tabEl);
    });
  },

  // 更新当前标签页标题
  updateTabTitle() {
    if (!this.state.activeTabId || !this.state.doc) return;
    const tab = this.state.tabs.find(t => t.id === this.state.activeTabId);
    if (tab) {
      tab.doc.title = this.state.doc.title;
      this.renderTabs();
    }
  },

  openDoc() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm,.wsw,.json';

    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const text = ev.target.result;
          let docData;

          // 检测文件类型：HTML 或 JSON
          if (text.trim().startsWith('<')) {
            // HTML 格式的 WSW 文件（自包含 HTML）
            const m = text.match(/const\s+WSW_DATA\s*=\s*(\{[\s\S]*?\});/);
            if (!m) throw new Error('Invalid WSW HTML: cannot find WSW_DATA');
            docData = JSON.parse(m[1]);
          } else {
            // JSON 格式的 WSW 文件
            docData = JSON.parse(text);
          }

          // 版本兼容：v1.0 文件升级到 v2.0
          if (!docData.version || docData.version < '2.0') {
            const now = Date.now();
            docData.version = '2.0';
            docData.globalTimestamp = docData.globalTimestamp || {
              created: now, modified: now,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
            };
            docData.defaultTTL = docData.defaultTTL || 0;
          }

          // 创建新标签页
          const tabId = 'tab_' + Date.now();
          const maxZ = (docData.cards || []).reduce((m, c) => Math.max(m, c.z || 1), 0);
          const tab = {
            id: tabId,
            doc: docData,
            zoom: 1,
            panX: 0,
            panY: 0,
            maxZ: maxZ,
            showGrid: docData.showGrid !== undefined ? docData.showGrid : true
          };

          this.state.tabs.push(tab);
          this.switchTab(tabId);
          this.renderTabs();

          // 迁移旧容器到新架构（三源分离）
          (this.state.doc.cards || []).forEach(c => {
            if (['videoContainer', 'audioContainer', 'textContainer', 'excelContainer'].includes(c.type)) {
              // 确保新字段存在
              if (c.playMode === undefined) c.playMode = 'none';
              if (c.localSource === undefined) c.localSource = null;
              if (c.onlineSource === undefined) c.onlineSource = null;
              if (c.workflowDownload === undefined) c.workflowDownload = null;
              // 从旧字段迁移
              if (c.localPath && !c.localSource) {
                const fileName = c.localPath.split(/[\\/]/).pop() || '本地文件';
                c.localSource = {
                  path: c.localPath, name: fileName,
                  format: (fileName.split('.').pop() || '').toLowerCase(),
                  downloadedAt: c.timestamp?.lastUpdated || Date.now()
                };
                if (c.currentResource?.content) c.localSource.content = c.currentResource.content;
                if (c.sourceType === 'local') c.playMode = 'local';
              }
              if (c.urlSource && !c.onlineSource) {
                c.onlineSource = {
                  url: c.urlSource,
                  name: c.urlSource.split('/').pop() || '网络资源',
                  streamType: c.urlSource.indexOf('.m3u8') > -1 ? 'm3u8' : (c.urlSource.startsWith('blob:') ? 'blob' : 'http'),
                  cachedAt: c.timestamp?.lastUpdated || Date.now()
                };
                if (c.sourceType === 'url') c.playMode = 'online';
              }
              if (c.currentResource && !c.onlineSource && !c.localSource && c.sourceType !== 'local') {
                // 从 currentResource 迁移到 onlineSource
                c.onlineSource = {
                  url: c.currentResource.url,
                  name: c.currentResource.name || '',
                  format: c.currentResource.format || '',
                  streamType: c.currentResource.streamType || 'http',
                  content: c.currentResource.content || '',
                  cachedAt: c.currentResource.cachedAt || Date.now()
                };
                if (c.playMode === 'none') c.playMode = 'online';
              }
              // 从 workflowLink 迁移到 workflowDownload
              if (c.workflowLink && !c.workflowDownload) {
                c.workflowDownload = {
                  workflowId: c.workflowLink.workflowId,
                  workflowTitle: '',
                  cardIndex: c.workflowLink.cardIndex,
                  resourceType: c.workflowLink.resourceType,
                  autoDownload: c.workflowLink.autoRefresh || false,
                  lastDownloadAt: null,
                  downloadPath: null,
                  downloadStatus: 'idle'
                };
              }
            }
          });

          document.getElementById('wswDocTitle').textContent = this.state.doc.title || '未命名文档';
          document.getElementById('wswEmpty').style.display = 'none';
          this.renderCanvas();
          App.showToast('已打开: ' + file.name);
          // 自动检查TTL，刷新过期容器资源
          await this.refreshAllExpiredContainers();
        } catch (err) {
          App.showToast('打开失败: 文件格式错误');
          console.error('openDoc error:', err);
        }
      };
      reader.readAsText(file);
    };

    input.click();
  },

  saveDoc() {
    if (!this.state.doc) {
      App.showToast('请先创建文档');
      return;
    }
    // 提交当前编辑
    if (this.state.editingCardId !== null) {
      this.commitEdit();
    }
    // 更新全局时间戳
    if (this.state.doc.globalTimestamp) {
      this.state.doc.globalTimestamp.modified = Date.now();
    }

    // 使用 generateWSW 生成自包含 HTML 文件（浏览器可直接打开）
    const html = this._generateSelfContainedHTML(this.state.doc);
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (this.state.doc.title || 'HT文档') + '.html';
    a.click();
    URL.revokeObjectURL(a.href);

    App.showToast('文档已保存为 HTML（浏览器可直接打开）');
  },

  // 在浏览器中打开预览（导出临时 HTML 并用系统浏览器打开）
  async openInBrowser() {
    if (!this.state.doc) {
      App.showToast('请先创建文档');
      return;
    }
    // 提交当前编辑
    if (this.state.editingCardId !== null) {
      this.commitEdit();
    }

    const html = this._generateSelfContainedHTML(this.state.doc);

    // 保存到临时文件
    const result = await App.ipc('save-temp-html', html);
    if (!result || !result.success) {
      // 降级：用 Blob URL 方式打开
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      App.showToast('已在浏览器中打开（临时页面）');
      return;
    }

    // 用系统浏览器打开
    const browserResult = await App.ipc('open-in-browser', result.filePath);
    if (browserResult && browserResult.success) {
      App.showToast('已在浏览器中打开');
    } else {
      App.showToast('打开失败：' + (browserResult?.error || '未知错误'));
    }
  },

  // 生成自包含 HTML（浏览器可直接打开的 .wsw 文件）
  _generateSelfContainedHTML(doc) {
    const cards = (doc.cards || []).map(c => {
      const card = { ...c };
      // 确保所有资源以 base64 嵌入
      if (card.type === 'image' && card.src && !card.src.startsWith('data:')) {
        card.src = 'data:image/png;base64,' + card.src;
      }
      return card;
    });

    // 预计算 chartCard 数据：确保导出 HTML 内 chartData 已就绪
    cards.forEach(card => {
      if (card.type !== 'chartCard') return;
      if (card.inlineData) {
        card.chartData = {
          labels: (card.inlineData.labels || []).slice(),
          values: (card.inlineData.values || []).slice()
        };
      } else if (card.sourceCardId) {
        const sourceCard = cards.find(c => c.id === card.sourceCardId);
        if (sourceCard) {
          try {
            card.chartData = this._extractChartData(sourceCard, card.chartType, card);
          } catch (e) {
            card.chartData = { labels: [], values: [] };
          }
        } else {
          card.chartData = { labels: [], values: [] };
        }
      } else {
        card.chartData = card.chartData || { labels: [], values: [] };
      }
    });

    const wswData = {
      version: doc.version || '2.0',
      title: doc.title || 'HT 演示',
      url: doc.url || '',
      createdAt: doc.createdAt || new Date().toISOString(),
      background: doc.background || { type: 'color', value: '#1a1a2e' },
      showGrid: doc.showGrid !== undefined ? doc.showGrid : true,
      cards: cards
    };

    // 构建完整的自包含 HTML
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${this._escHtml(doc.title || 'HT 演示')} - HT</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1a1a2e;color:#eee}
#canvas{position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;cursor:default}
#canvas.panning{cursor:grabbing}
#canvas-inner{position:absolute;transform-origin:0 0;will-change:transform}
.grid-bg{position:absolute;top:-5000px;left:-5000px;width:10000px;height:10000px;background-image:radial-gradient(circle,#2a2a4a 1px,transparent 1px);background-size:30px 30px;pointer-events:none}
.res-card{position:absolute;background:#12122e;border:1px solid #2a2a5a;border-radius:10px;overflow:hidden;min-width:120px;min-height:80px;box-shadow:0 4px 16px rgba(0,0,0,.4);transition:box-shadow .15s,border-color .15s}
.res-card:hover{border-color:#3a3a6a;box-shadow:0 6px 20px rgba(0,0,0,.5)}
.res-card.selected{border-color:#e94560;box-shadow:0 0 0 2px rgba(233,69,96,.25),0 6px 20px rgba(0,0,0,.5)}
.res-card.dragging{opacity:.85;box-shadow:0 12px 40px rgba(0,0,0,.6);border-color:#e94560;transition:none;z-index:9999!important}
.text-box{position:absolute;min-width:80px;min-height:40px;border:1px dashed transparent;border-radius:6px;padding:12px;font-size:15px;line-height:1.7;color:#eee;background:transparent;cursor:move;transition:border-color .15s,box-shadow .15s}
.text-box:hover{border-color:#3a3a6a}
.text-box.selected{border-color:#e94560;border-style:solid;box-shadow:0 0 0 2px rgba(233,69,96,.2)}
.text-box.dragging{opacity:.85;box-shadow:0 8px 30px rgba(0,0,0,.5);transition:none;z-index:9999!important}
.text-box .tb-content{outline:none;min-height:20px;white-space:pre-wrap;word-break:break-word;user-select:text}
.text-box .tb-content:empty::before{content:attr(data-placeholder);color:#555}
.text-box .resize-handle{position:absolute;bottom:0;right:0;width:14px;height:14px;cursor:nwse-resize}
.text-box .resize-handle::after{content:'';position:absolute;bottom:3px;right:3px;width:8px;height:8px;border-right:2px solid #555;border-bottom:2px solid #555}
.wsw-table{position:absolute;min-width:100px;min-height:60px;border:1px solid #2a2a5a;border-radius:8px;overflow:hidden;background:#12122e;box-shadow:0 4px 16px rgba(0,0,0,.4);cursor:move;transition:box-shadow .15s,border-color .15s}
.wsw-table:hover{border-color:#3a3a6a}
.wsw-table.selected{border-color:#e94560;box-shadow:0 0 0 2px rgba(233,69,96,.25),0 6px 20px rgba(0,0,0,.5)}
.wsw-table.dragging{opacity:.85;box-shadow:0 12px 40px rgba(0,0,0,.6);transition:none;z-index:9999!important}
.wsw-table table{width:100%;border-collapse:collapse}
.wsw-table th,.wsw-table td{border:1px solid #2a2a5a;padding:8px 12px;font-size:13px;color:#ccc;text-align:left;outline:none;min-width:40px}
.wsw-table th{background:#0e0e24;font-weight:600;color:#e94560}
.wsw-table td:focus,.wsw-table th:focus{background:rgba(233,69,96,.08)}
.wsw-table .table-header-bar{height:26px;background:linear-gradient(180deg,#161640,#0e0e24);display:flex;align-items:center;padding:0 8px;gap:6px;cursor:grab;border-bottom:1px solid #1e1e4a}
.wsw-table .table-header-bar:active{cursor:grabbing}
.wsw-table .table-header-bar .th-title{font-size:10px;color:#888;flex:1}
.wsw-table .table-header-bar .th-icon{font-size:12px}
.wsw-table .resize-handle{position:absolute;bottom:0;right:0;width:14px;height:14px;cursor:nwse-resize}
.wsw-table .resize-handle::after{content:'';position:absolute;bottom:3px;right:3px;width:8px;height:8px;border-right:2px solid #444;border-bottom:2px solid #444}
.shape-box{position:absolute;min-width:40px;min-height:40px;cursor:move;transition:box-shadow .15s}
.shape-box.selected{box-shadow:0 0 0 2px rgba(233,69,96,.3)}
.shape-box.dragging{opacity:.85;transition:none;z-index:9999!important}
.shape-box svg{width:100%;height:100%}
.shape-box .resize-handle{position:absolute;bottom:0;right:0;width:14px;height:14px;cursor:nwse-resize}
.shape-box .resize-handle::after{content:'';position:absolute;bottom:3px;right:3px;width:8px;height:8px;border-right:2px solid #555;border-bottom:2px solid #555}
.snap-line{position:absolute;background:#e94560;z-index:9998;pointer-events:none;opacity:.6}
.snap-line.horizontal{height:1px;left:0;right:0}
.snap-line.vertical{width:1px;top:0;bottom:0}
.card-header{height:30px;background:linear-gradient(180deg,#161640,#0e0e24);display:flex;align-items:center;padding:0 10px;cursor:grab;gap:8px;flex-shrink:0;border-bottom:1px solid #1e1e4a}
.card-header:active{cursor:grabbing}
.card-header .card-icon{font-size:13px;flex-shrink:0}
.card-header .card-title{font-size:11px;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.card-header .card-type{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:2px 6px;border-radius:4px;flex-shrink:0}
.type-image{color:#4fc3f7;background:rgba(79,195,247,.15)}
.type-video{color:#f06292;background:rgba(240,98,146,.15)}
.type-audio{color:#ffb74d;background:rgba(255,183,77,.15)}
.type-text{color:#81c784;background:rgba(129,199,132,.15)}
.type-link{color:#ba68c8;background:rgba(186,104,200,.15)}
.card-body{flex:1;overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center;background:#0a0a1a}
.card-body img{max-width:100%;max-height:100%;object-fit:contain;display:block;pointer-events:none}
.card-body video{max-width:100%;max-height:100%;object-fit:contain;display:block}
.card-body audio{width:90%;display:block}
.card-body .text-body{padding:14px;font-size:13px;line-height:1.8;color:#ccc;overflow-y:auto;white-space:pre-wrap;word-break:break-word;width:100%;height:100%;user-select:text}
.card-body .link-body{display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px}
.card-body .link-body a{color:#6c9fff;font-size:14px;text-decoration:none;word-break:break-all;text-align:center}
.card-body .link-body a:hover{text-decoration:underline}
.resize-handle{position:absolute;bottom:0;right:0;width:18px;height:18px;cursor:nwse-resize;z-index:10}
.resize-handle::after{content:'';position:absolute;bottom:4px;right:4px;width:10px;height:10px;border-right:2px solid #444;border-bottom:2px solid #444;transition:border-color .15s}
.res-card:hover .resize-handle::after{border-color:#e94560}
.toolbar{position:fixed;top:12px;left:50%;transform:translateX(-50%);background:rgba(18,18,46,.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid #2a2a5a;border-radius:14px;padding:8px 18px;display:flex;align-items:center;gap:10px;z-index:1000;box-shadow:0 4px 20px rgba(0,0,0,.4)}
.toolbar-title{font-size:14px;font-weight:600;color:#e94560;white-space:nowrap}
.toolbar-sep{width:1px;height:22px;background:#2a2a5a}
.toolbar-btn{background:none;border:1px solid transparent;color:#aaa;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px;transition:all .15s;white-space:nowrap}
.toolbar-btn:hover{background:rgba(255,255,255,.06);color:#fff;border-color:#2a2a5a}
.toolbar-btn:active{transform:scale(.95)}
.zoom-display{font-size:12px;color:#888;min-width:50px;text-align:center;font-variant-numeric:tabular-nums}
.hint{position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:rgba(18,18,46,.92);backdrop-filter:blur(12px);border:1px solid #2a2a5a;border-radius:10px;padding:10px 20px;font-size:12px;color:#aaa;z-index:1000;pointer-events:none;opacity:0;transition:opacity .3s;white-space:nowrap}
.hint.show{opacity:1}
.minimap{position:fixed;bottom:16px;right:16px;width:180px;height:120px;background:rgba(18,18,46,.92);backdrop-filter:blur(12px);border:1px solid #2a2a5a;border-radius:10px;z-index:1000;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.3)}
.minimap-viewport{position:absolute;border:1.5px solid rgba(233,69,96,.6);background:rgba(233,69,96,.06);pointer-events:none;transition:left .1s,top .1s,width .1s,height .1s}
.minimap-dot{position:absolute;width:5px;height:4px;background:#e94560;border-radius:1px;opacity:.7}
.fs-btn{position:fixed;bottom:16px;left:16px;background:rgba(18,18,46,.92);backdrop-filter:blur(12px);border:1px solid #2a2a5a;border-radius:10px;padding:9px 16px;color:#aaa;cursor:pointer;font-size:12px;z-index:1000;display:flex;align-items:center;gap:6px;transition:all .15s;box-shadow:0 4px 16px rgba(0,0,0,.3)}
.fs-btn:hover{background:rgba(233,69,96,.12);color:#e94560;border-color:#e94560}
.fs-btn:active{transform:scale(.95)}
.help-panel{position:fixed;top:70px;right:16px;background:rgba(18,18,46,.95);backdrop-filter:blur(16px);border:1px solid #2a2a5a;border-radius:12px;padding:16px 20px;z-index:1000;font-size:12px;color:#aaa;display:none;box-shadow:0 8px 32px rgba(0,0,0,.4);min-width:220px}
.help-panel.show{display:block}
.help-panel h3{color:#e94560;font-size:13px;margin-bottom:10px}
.help-row{display:flex;justify-content:space-between;padding:4px 0;gap:20px}
.help-key{background:#0e0e24;padding:2px 8px;border-radius:4px;font-size:11px;color:#ccc;font-family:monospace;white-space:nowrap}
.context-menu{position:fixed;background:rgba(18,18,46,.96);backdrop-filter:blur(16px);border:1px solid #2a2a5a;border-radius:10px;padding:5px;z-index:2000;min-width:170px;box-shadow:0 8px 32px rgba(0,0,0,.6);display:none}
.context-menu.show{display:block}
.ctx-item{padding:9px 14px;font-size:13px;color:#ccc;cursor:pointer;border-radius:6px;display:flex;align-items:center;gap:10px;transition:background .1s}
.ctx-item:hover{background:rgba(233,69,96,.12);color:#fff}
.ctx-item .ctx-icon{width:18px;text-align:center;font-size:13px}
.ctx-sep{height:1px;background:#2a2a5a;margin:4px 0}
</style>
</head>
<body>
<div class="toolbar">
  <span class="toolbar-title" id="toolbarTitle">${this._escHtml(doc.title || 'HT 演示')}</span>
  <div class="toolbar-sep"></div>
  <button class="toolbar-btn" id="btnLoad" title="导入布局"> 导入</button>
  <input type="file" id="fileInput" accept=".wsw,.json" style="display:none">
  <div class="toolbar-sep"></div>
  <button class="toolbar-btn" id="btnZoomOut" title="缩小">−</button>
  <span class="zoom-display" id="zoomDisplay">100%</span>
  <button class="toolbar-btn" id="btnZoomIn" title="放大">+</button>
  <button class="toolbar-btn" id="btnFitView" title="适应视图">适应</button>
  <div class="toolbar-sep"></div>
  <button class="toolbar-btn" id="btnHelp" title="快捷键">?</button>
  <button class="toolbar-btn" id="btnReset" title="重置视图">重置</button>
</div>
<div id="canvas"><div id="canvas-inner"><div class="grid-bg" id="gridBg"></div><div id="cards-container"></div><div id="snap-lines-container"></div></div></div>
<div class="minimap" id="minimap"><div class="minimap-viewport" id="minimapViewport"></div></div>
<button class="fs-btn" id="btnFullscreen"> 全屏</button>
<div class="hint" id="hint"></div>
<div class="help-panel" id="helpPanel">
  <h3>快捷键</h3>
  <div class="help-row"><span>平移画布</span><span class="help-key">中键 / 空格+拖拽</span></div>
  <div class="help-row"><span>移动元素</span><span class="help-key">拖拽标题栏</span></div>
  <div class="help-row"><span>调整大小</span><span class="help-key">拖拽右下角</span></div>
  <div class="help-row"><span>缩放画布</span><span class="help-key">滚轮 / Ctrl+±</span></div>
  <div class="help-row"><span>适应视图</span><span class="help-key">Ctrl+0</span></div>
  <div class="help-row"><span>删除</span><span class="help-key">Delete</span></div>
  <div class="help-row"><span>复制</span><span class="help-key">Ctrl+D</span></div>
  <div class="help-row"><span>全选</span><span class="help-key">Ctrl+A</span></div>
  <div class="help-row"><span>撤销</span><span class="help-key">Ctrl+Z</span></div>
  <div class="help-row"><span>全屏</span><span class="help-key">F11</span></div>
</div>
<div class="context-menu" id="contextMenu">
  <div class="ctx-item" data-action="bring-front"><span class="ctx-icon">⬆</span>置顶</div>
  <div class="ctx-item" data-action="send-back"><span class="ctx-icon">⬇</span>置底</div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" data-action="duplicate"><span class="ctx-icon"></span>复制</div>
  <div class="ctx-item" data-action="delete"><span class="ctx-icon">✕</span>删除</div>
</div>
<script>
(function(){'use strict';
const WSW_DATA=${JSON.stringify(wswData)};
document.getElementById('toolbarTitle').textContent=WSW_DATA.title;
let panX=0,panY=0,zoom=1,isPanning=false,panStartX=0,panStartY=0,spaceHeld=false;
let dragCard=null,dragOffX=0,dragOffY=0,dragOrigX=0,dragOrigY=0;
let resizeCard=null,resizeStartX=0,resizeStartY=0,resizeStartW=0,resizeStartH=0;
let maxZ=1,selectedCards=new Set(),contextTarget=null,undoStack=[];
const SNAP_DIST=10;
const canvas=document.getElementById('canvas'),canvasInner=document.getElementById('canvas-inner'),cardsContainer=document.getElementById('cards-container'),snapContainer=document.getElementById('snap-lines-container'),zoomDisplay=document.getElementById('zoomDisplay'),hint=document.getElementById('hint'),contextMenu=document.getElementById('contextMenu'),helpPanel=document.getElementById('helpPanel'),gridBg=document.getElementById('gridBg');
function applyBackground(){const bg=WSW_DATA.background;if(bg.type==='color'){canvas.style.background=bg.value;canvas.style.backgroundImage='none'}else if(bg.type==='gradient'){canvas.style.background=bg.value}else if(bg.type==='image'){canvas.style.background='url('+bg.value+') center/cover no-repeat'}gridBg.style.display=WSW_DATA.showGrid?'':'none'}
function renderCards(){cardsContainer.innerHTML='';WSW_DATA.cards.forEach(card=>{const el=createElementByType(card);if(el)cardsContainer.appendChild(el)})}
function createElementByType(card){if(card.type==='textbox')return createTextBox(card);if(card.type==='table')return createTable(card);if(card.type==='chartCard')return createChartCard(card);if(['rect','circle','triangle','line','arrow','star'].includes(card.type))return createShape(card);return createCardElement(card)}
function createCardElement(card){const el=document.createElement('div');el.className='res-card'+(selectedCards.has(card.id)?' selected':'');el.dataset.id=card.id;el.style.left=card.x+'px';el.style.top=card.y+'px';el.style.width=card.w+'px';el.style.height=card.h+'px';el.style.zIndex=card.z||1;let bodyHtml='';switch(card.type){case'image':bodyHtml=card.src?'<img src="'+card.src+'" alt="'+esc(card.name)+'" draggable="false">':card.url?'<img src="'+card.url+'" alt="'+esc(card.name)+'" draggable="false" onerror="this.parentElement.innerHTML=\\'<div style=\\'color:#555;font-size:13px\\'>图片加载失败</div>\\'">':'<div style="color:#555;font-size:13px">图片加载失败</div>';break;case'video':if(card.src)bodyHtml='<video src="'+card.src+'" controls preload="metadata"'+(card.poster?' poster="'+card.poster+'"':'')+'></video>';else bodyHtml=card.poster?'<img src="'+card.poster+'" style="opacity:.6;pointer-events:none"><div style="position:absolute;font-size:48px;color:#e94560;pointer-events:none">&#x25B6;</div>':'<div style="color:#555;font-size:13px">视频未嵌入</div>';break;case'audio':bodyHtml=card.src?'<audio src="'+card.src+'" controls></audio>':'<div style="color:#555;font-size:13px;display:flex;flex-direction:column;align-items:center;gap:6px"><span style="font-size:24px">&#x1F3B5;</span><span>音频未嵌入</span></div>';break;case'text':bodyHtml='<div class="text-body">'+esc(card.content||'')+'</div>';break;case'link':bodyHtml='<div class="link-body"><span style="font-size:24px">&#x1F517;</span><a href="'+esc(card.url||'#')+'" target="_blank" onclick="event.stopPropagation()">'+esc(card.displayUrl||card.url||'')+'</a></div>';break}el.innerHTML='<div class="card-header" draggable="false"><span class="card-icon">'+typeIcon(card.type)+'</span><span class="card-title">'+esc(card.name)+'</span><span class="card-type type-'+card.type+'">'+card.type.toUpperCase()+'</span></div><div class="card-body">'+bodyHtml+'</div><div class="resize-handle"></div>';const header=el.querySelector('.card-header');header.addEventListener('mousedown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();startDragElement(e,el,card)});el.querySelector('.resize-handle').addEventListener('mousedown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();saveUndoState();resizeCard=card;resizeStartX=e.clientX;resizeStartY=e.clientY;resizeStartW=card.w;resizeStartH=card.h});el.addEventListener('mousedown',e=>{if(e.button===0)handleSelect(e,card,el)});el.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();handleContext(e,card,el)});return el}
function createTextBox(card){const el=document.createElement('div');el.className='text-box'+(selectedCards.has(card.id)?' selected':'');el.dataset.id=card.id;el.style.left=card.x+'px';el.style.top=card.y+'px';el.style.width=card.w+'px';el.style.height=card.h+'px';el.style.zIndex=card.z||1;const content=document.createElement('div');content.className='tb-content';content.contentEditable='true';content.setAttribute('data-placeholder','输入文字...');content.textContent=card.content||'';content.style.fontSize=(card.fontSize||15)+'px';content.style.color=card.color||'#eee';content.style.fontWeight=card.bold?'bold':'normal';el.appendChild(content);const rh=document.createElement('div');rh.className='resize-handle';el.appendChild(rh);el.addEventListener('mousedown',e=>{if(e.button!==0)return;if(e.target===content||content.contains(e.target))return;if(e.target.classList.contains('resize-handle'))return;e.preventDefault();startDragElement(e,el,card)});content.addEventListener('dblclick',e=>{e.stopPropagation();content.focus()});content.addEventListener('input',()=>{card.content=content.textContent});content.addEventListener('mousedown',e=>e.stopPropagation());rh.addEventListener('mousedown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();saveUndoState();resizeCard=card;resizeStartX=e.clientX;resizeStartY=e.clientY;resizeStartW=card.w;resizeStartH=card.h});el.addEventListener('mousedown',e=>{if(e.button===0)handleSelect(e,card,el)});el.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();handleContext(e,card,el)});return el}
function createTable(card){const el=document.createElement('div');el.className='wsw-table'+(selectedCards.has(card.id)?' selected':'');el.dataset.id=card.id;el.style.left=card.x+'px';el.style.top=card.y+'px';el.style.width=card.w+'px';el.style.height=card.h+'px';el.style.zIndex=card.z||1;const rows=card.rows||3,cols=card.cols||3,data=card.data||[];let tableHtml='<div class="table-header-bar"><span class="th-icon">📊</span><span class="th-title">表格</span></div><table><tbody>';for(let r=0;r<rows;r++){tableHtml+='<tr>';for(let c=0;c<cols;c++){const tag=r===0?'th':'td';const val=(data[r]&&data[r][c])||'';tableHtml+='<'+tag+' contenteditable="true" data-row="'+r+'" data-col="'+c+'">'+esc(val)+'</'+tag+'>'}tableHtml+='</tr>'}tableHtml+='</tbody></table><div class="resize-handle"></div>';el.innerHTML=tableHtml;const headerBar=el.querySelector('.table-header-bar');headerBar.addEventListener('mousedown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();startDragElement(e,el,card)});el.querySelectorAll('td,th').forEach(cell=>{cell.addEventListener('mousedown',e=>e.stopPropagation());cell.addEventListener('input',()=>{const r=parseInt(cell.dataset.row),c=parseInt(cell.dataset.col);if(!card.data[r])card.data[r]=[];card.data[r][c]=cell.textContent})});el.querySelector('.resize-handle').addEventListener('mousedown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();saveUndoState();resizeCard=card;resizeStartX=e.clientX;resizeStartY=e.clientY;resizeStartW=card.w;resizeStartH=card.h});el.addEventListener('mousedown',e=>{if(e.button===0)handleSelect(e,card,el)});el.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();handleContext(e,card,el)});return el}
function createShape(card){const el=document.createElement('div');el.className='shape-box'+(selectedCards.has(card.id)?' selected':'');el.dataset.id=card.id;el.style.left=card.x+'px';el.style.top=card.y+'px';el.style.width=card.w+'px';el.style.height=card.h+'px';el.style.zIndex=card.z||1;const color=card.color||'#e94560',fill=card.fill||'none',sw=card.strokeWidth||2;let svgContent='';switch(card.type){case'rect':svgContent='<rect x="4" y="4" width="calc(100% - 8px)" height="calc(100% - 8px)" rx="6" fill="'+fill+'" stroke="'+color+'" stroke-width="'+sw+'"/>';break;case'circle':svgContent='<ellipse cx="50%" cy="50%" rx="48%" ry="48%" fill="'+fill+'" stroke="'+color+'" stroke-width="'+sw+'"/>';break;case'triangle':svgContent='<polygon points="50%,4 96%,96% 4%,96%" fill="'+fill+'" stroke="'+color+'" stroke-width="'+sw+'"/>';break;case'line':svgContent='<line x1="4" y1="50%" x2="calc(100% - 4px)" y2="50%" stroke="'+color+'" stroke-width="'+(sw+1)+'"/>';break;case'arrow':svgContent='<line x1="4" y1="50%" x2="calc(100% - 20px)" y2="50%" stroke="'+color+'" stroke-width="'+(sw+1)+'"/><polygon points="calc(100% - 4px),50% calc(100% - 20px),42% calc(100% - 20px),58%" fill="'+color+'"/>';break;case'star':svgContent='<polygon points="50%,4 61%,38 97%,38 68%,59 79%,93 50%,72 21%,93 32%,59 3%,38 39%,38" fill="'+fill+'" stroke="'+color+'" stroke-width="'+sw+'"/>';break}el.innerHTML='<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%">'+svgContent+'</svg><div class="resize-handle"></div>';el.addEventListener('mousedown',e=>{if(e.button!==0)return;if(e.target.classList.contains('resize-handle'))return;e.preventDefault();startDragElement(e,el,card);handleSelect(e,card,el)});el.querySelector('.resize-handle').addEventListener('mousedown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();saveUndoState();resizeCard=card;resizeStartX=e.clientX;resizeStartY=e.clientY;resizeStartW=card.w;resizeStartH=card.h});el.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();handleContext(e,card,el)});return el}
function createChartCard(card){const el=document.createElement('div');el.className='res-card'+(selectedCards.has(card.id)?' selected':'');el.dataset.id=card.id;el.style.left=card.x+'px';el.style.top=card.y+'px';el.style.width=card.w+'px';el.style.height=card.h+'px';el.style.zIndex=card.z||1;const chartType=card.chartType||'bar';const chartTypeLabel={bar:'柱状图',pie:'饼图',line:'折线图',wordcloud:'词云'}[chartType]||'柱状图';const chartTypeIcon={bar:'📊',pie:'🥧',line:'📈',wordcloud:'☁️'}[chartType]||'📊';const data=card.chartData||{labels:[],values:[]};const dataCount=(data.labels?data.labels.length:0);const bodyHtml='<div style="position:absolute;top:0;left:0;right:0;bottom:0"><canvas id="chartCard_'+card.id+'" data-chart-card-id="'+card.id+'" data-chart-type="'+chartType+'" style="display:block;width:100%;height:100%"></canvas><div style="position:absolute;bottom:2px;left:8px;font-size:10px;color:#8888a8;pointer-events:none">📊 数据点: '+dataCount+'</div></div>';el.innerHTML='<div class="card-header" draggable="false"><span class="card-icon">'+chartTypeIcon+'</span><span class="card-title">'+esc(card.name||'统计图')+'</span><span class="card-type type-text">'+esc(chartTypeLabel)+'</span></div><div class="card-body" style="padding:0;display:block;position:relative">'+bodyHtml+'</div><div class="resize-handle"></div>';const header=el.querySelector('.card-header');header.addEventListener('mousedown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();startDragElement(e,el,card)});el.querySelector('.resize-handle').addEventListener('mousedown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();saveUndoState();resizeCard=card;resizeStartX=e.clientX;resizeStartY=e.clientY;resizeStartW=card.w;resizeStartH=card.h});el.addEventListener('mousedown',e=>{if(e.button===0)handleSelect(e,card,el)});el.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();handleContext(e,card,el)});return el}
function renderAllCharts(){WSW_DATA.cards.forEach(card=>{if(card.type!=='chartCard')return;const canvas=document.querySelector('canvas[data-chart-card-id="'+card.id+'"]');if(!canvas)return;const data=card.chartData||{labels:[],values:[]};const chartType=card.chartType||'bar';try{if(chartType==='bar')_drawChartBar(canvas,data);else if(chartType==='pie')_drawChartPie(canvas,data);else if(chartType==='line')_drawChartLine(canvas,data);else if(chartType==='wordcloud')_drawWordCloud(canvas,data)}catch(e){console&&console.error&&console.error('chart render error:',e)}})}
function _drawChartBar(canvas, data) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth || 360;
  const h = canvas.offsetHeight || 220;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (!data.labels || data.labels.length === 0) {
    ctx.fillStyle = '#8888a8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('无数据', w / 2, h / 2);
    return;
  }
  const padding = { top: 16, right: 12, bottom: 32, left: 36 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;
  const maxVal = Math.max.apply(null, data.values.concat([1]));
  const barW = chartW / data.values.length * 0.6;
  const gap = chartW / data.values.length * 0.4;
  const colors = ['#4fc3f7', '#b39ddb', '#4dd0c8', '#ffd54f', '#ff8a65', '#f06292', '#7986cb', '#aed581'];
  ctx.strokeStyle = '#8888a8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + chartH);
  ctx.lineTo(padding.left + chartW, padding.top + chartH);
  ctx.stroke();
  data.values.forEach(function(val, i) {
    const x = padding.left + i * (barW + gap) + gap / 2;
    const barH = (val / maxVal) * chartH;
    const y = padding.top + chartH - barH;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = '#e0e0ee';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(val), x + barW / 2, y - 3);
    ctx.fillStyle = '#8888a8';
    ctx.font = '9px sans-serif';
    const label = data.labels[i].length > 6 ? data.labels[i].substring(0, 6) : data.labels[i];
    ctx.fillText(label, x + barW / 2, padding.top + chartH + 14);
  });
}
function _drawChartPie(canvas, data) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth || 360;
  const h = canvas.offsetHeight || 220;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (!data.values || data.values.length === 0) {
    ctx.fillStyle = '#8888a8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('无数据', w / 2, h / 2);
    return;
  }
  const total = data.values.reduce(function(a, v){ return a + v; }, 0);
  if (total <= 0) return;
  const cx = w / 2 - 40;
  const cy = h / 2;
  const radius = Math.min(w - 100, h - 40) / 2;
  let startAngle = -Math.PI / 2;
  const colors = ['#4fc3f7', '#b39ddb', '#4dd0c8', '#ffd54f', '#ff8a65', '#f06292', '#7986cb', '#aed581'];
  data.values.forEach(function(val, i) {
    const angle = (val / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, startAngle + angle);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    ctx.strokeStyle = '#16162a';
    ctx.lineWidth = 1;
    ctx.stroke();
    startAngle += angle;
  });
  const legendX = cx + radius + 16;
  let legendY = 12;
  ctx.font = '10px sans-serif';
  data.labels.forEach(function(label, i) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(legendX, legendY, 10, 10);
    ctx.fillStyle = '#e0e0ee';
    ctx.textAlign = 'left';
    const pct = ((data.values[i] / total) * 100).toFixed(1) + '%';
    const txt = (label.length > 6 ? label.substring(0, 6) : label) + ' ' + pct;
    ctx.fillText(txt, legendX + 14, legendY + 9);
    legendY += 16;
  });
}
function _drawChartLine(canvas, data) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth || 360;
  const h = canvas.offsetHeight || 220;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (!data.values || data.values.length === 0) {
    ctx.fillStyle = '#8888a8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('无数据', w / 2, h / 2);
    return;
  }
  const padding = { top: 16, right: 12, bottom: 32, left: 36 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;
  const maxVal = Math.max.apply(null, data.values.concat([1]));
  const stepX = data.values.length > 1 ? chartW / (data.values.length - 1) : chartW;
  ctx.strokeStyle = '#8888a8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + chartH);
  ctx.lineTo(padding.left + chartW, padding.top + chartH);
  ctx.stroke();
  ctx.strokeStyle = '#4fc3f7';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.values.forEach(function(val, i) {
    const x = padding.left + i * stepX;
    const y = padding.top + chartH - (val / maxVal) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  data.values.forEach(function(val, i) {
    const x = padding.left + i * stepX;
    const y = padding.top + chartH - (val / maxVal) * chartH;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#b39ddb';
    ctx.fill();
    ctx.fillStyle = '#e0e0ee';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(val), x, y - 8);
    ctx.fillStyle = '#8888a8';
    ctx.font = '9px sans-serif';
    const label = data.labels[i].length > 6 ? data.labels[i].substring(0, 6) : data.labels[i];
    ctx.fillText(label, x, padding.top + chartH + 14);
  });
}
function _drawWordCloud(canvas, data) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth || 360;
  const h = canvas.offsetHeight || 220;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (!data.labels || data.labels.length === 0) {
    ctx.fillStyle = '#8888a8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('无数据', w / 2, h / 2);
    return;
  }
  const maxVal = Math.max.apply(null, data.values.concat([1]));
  const colors = ['#4fc3f7', '#b39ddb', '#4dd0c8', '#ffd54f', '#ff8a65', '#f06292', '#7986cb', '#aed581'];
  const placed = [];
  const cx = w / 2;
  const cy = h / 2;
  data.labels.forEach(function(word, i) {
    const freq = data.values[i];
    const size = 10 + (freq / maxVal) * 24;
    ctx.font = size + 'px sans-serif';
    const metrics = ctx.measureText(word);
    const tw = metrics.width;
    const th = size;
    let angle = i * 0.5;
    let radius = 0;
    let x = cx - tw / 2;
    let y = cy - th / 2;
    let attempts = 0;
    while (attempts < 60) {
      const overlap = placed.some(function(p) {
        return x < p.x + p.w + 2 && x + tw + 2 > p.x &&
               y < p.y + p.h + 2 && y + th + 2 > p.y;
      });
      if (!overlap) break;
      radius += 4;
      angle += 0.4;
      x = cx + Math.cos(angle) * radius - tw / 2;
      y = cy + Math.sin(angle) * radius - th / 2;
      attempts++;
    }
    placed.push({ x: x, y: y, w: tw, h: th });
    ctx.fillStyle = colors[i % colors.length];
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(word, x, y);
  });
}
function startDragElement(e,el,card){saveUndoState();dragCard=card;dragOrigX=card.x;dragOrigY=card.y;const elRect=el.getBoundingClientRect();dragOffX=(e.clientX-elRect.left)/zoom;dragOffY=(e.clientY-elRect.top)/zoom;card.z=++maxZ;el.style.zIndex=maxZ;el.classList.add('dragging');if(!selectedCards.has(card.id)){selectedCards.clear();selectedCards.add(card.id);document.querySelectorAll('.selected').forEach(c=>c.classList.remove('selected'));el.classList.add('selected')}}
function handleSelect(e,card,el){if(e.target.closest('.resize-handle'))return;if(e.ctrlKey||e.metaKey){if(selectedCards.has(card.id)){selectedCards.delete(card.id);el.classList.remove('selected')}else{selectedCards.add(card.id);el.classList.add('selected')}}else{if(!selectedCards.has(card.id)){selectedCards.clear();document.querySelectorAll('.selected').forEach(c=>c.classList.remove('selected'));selectedCards.add(card.id);el.classList.add('selected')}}card.z=++maxZ;el.style.zIndex=maxZ}
function handleContext(e,card,el){if(!selectedCards.has(card.id)){selectedCards.clear();document.querySelectorAll('.selected').forEach(c=>c.classList.remove('selected'));selectedCards.add(card.id);el.classList.add('selected')}contextTarget={card,el};showContextMenu(e.clientX,e.clientY)}
function typeIcon(type){return{image:'📷',video:'',audio:'🎵',text:'',link:'🔗'}[type]||''}
canvas.addEventListener('mousedown',e=>{if(e.button===1){e.preventDefault();startPan(e);return}if(e.button===0&&spaceHeld){e.preventDefault();startPan(e);return}if(e.button===0&&!e.target.closest('.res-card')&&!e.target.closest('.text-box')&&!e.target.closest('.wsw-table')&&!e.target.closest('.shape-box')){selectedCards.clear();document.querySelectorAll('.selected').forEach(c=>c.classList.remove('selected'))}});
function startPan(e){isPanning=true;panStartX=e.clientX-panX;panStartY=e.clientY-panY;canvas.classList.add('panning')}
document.addEventListener('mousemove',e=>{if(isPanning){panX=e.clientX-panStartX;panY=e.clientY-panStartY;updateTransform();return}if(dragCard){const canvasRect=canvas.getBoundingClientRect();const newX=(e.clientX-canvasRect.left-panX)/zoom-dragOffX;const newY=(e.clientY-canvasRect.top-panY)/zoom-dragOffY;const dx=Math.round(newX/SNAP_DIST)*SNAP_DIST-dragOrigX;const dy=Math.round(newY/SNAP_DIST)*SNAP_DIST-dragOrigY;selectedCards.forEach(id=>{const c=WSW_DATA.cards.find(c=>c.id===id);if(!c)return;if(c===dragCard){c.x=Math.round(newX/SNAP_DIST)*SNAP_DIST;c.y=Math.round(newY/SNAP_DIST)*SNAP_DIST}else{c.x=dragOrigX+dx;c.y=dragOrigY+dy}const el=document.querySelector('[data-id="'+c.id+'"]');if(el){el.style.left=c.x+'px';el.style.top=c.y+'px'}});showSnapLines();updateMinimap();return}if(resizeCard){const dw=(e.clientX-resizeStartX)/zoom;const dh=(e.clientY-resizeStartY)/zoom;resizeCard.w=Math.max(80,Math.round((resizeStartW+dw)/SNAP_DIST)*SNAP_DIST);resizeCard.h=Math.max(40,Math.round((resizeStartH+dh)/SNAP_DIST)*SNAP_DIST);const el=document.querySelector('[data-id="'+resizeCard.id+'"]');if(el){el.style.width=resizeCard.w+'px';el.style.height=resizeCard.h+'px'}}});
document.addEventListener('mouseup',()=>{const wasResize=!!resizeCard;if(isPanning){isPanning=false;canvas.classList.remove('panning')}if(dragCard){const el=document.querySelector('[data-id="'+dragCard.id+'"]');if(el)el.classList.remove('dragging');clearSnapLines();dragCard=null}resizeCard=null;if(wasResize)renderAllCharts()});
canvas.addEventListener('auxclick',e=>{if(e.button===1)e.preventDefault()});
canvas.addEventListener('dblclick',e=>{if(e.target!==canvas&&!e.target.classList.contains('grid-bg'))return;const canvasRect=canvas.getBoundingClientRect();const x=Math.round((e.clientX-canvasRect.left-panX)/zoom/SNAP_DIST)*SNAP_DIST;const y=Math.round((e.clientY-canvasRect.top-panY)/zoom/SNAP_DIST)*SNAP_DIST;const newCard={id:Date.now(),type:'textbox',name:'文字框',content:'',x,y,w:240,h:60,fontSize:15,color:'#eee',bold:false,z:++maxZ};WSW_DATA.cards.push(newCard);const el=createTextBox(newCard);cardsContainer.appendChild(el);selectedCards.clear();document.querySelectorAll('.selected').forEach(c=>c.classList.remove('selected'));selectedCards.add(newCard.id);el.classList.add('selected');const content=el.querySelector('.tb-content');setTimeout(()=>{content.focus()},50);saveUndoState();showHint('已创建文字框，直接输入文字')});
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.repeat&&document.activeElement.tagName!=='INPUT'&&document.activeElement.contentEditable!=='true'){e.preventDefault();spaceHeld=true;canvas.style.cursor='grab'}});
document.addEventListener('keyup',e=>{if(e.code==='Space'){spaceHeld=false;canvas.style.cursor='';if(isPanning){isPanning=false;canvas.classList.remove('panning')}}});
canvas.addEventListener('wheel',e=>{e.preventDefault();const delta=e.deltaY>0?-0.08:0.08;const newZoom=Math.max(0.1,Math.min(5,zoom+delta));const rect=canvas.getBoundingClientRect();const mx=e.clientX-rect.left,my=e.clientY-rect.top;panX=mx-(mx-panX)*(newZoom/zoom);panY=my-(my-panY)*(newZoom/zoom);zoom=newZoom;updateTransform()},{passive:false});
function updateTransform(){canvasInner.style.transform='translate('+panX+'px,'+panY+'px) scale('+zoom+')';zoomDisplay.textContent=Math.round(zoom*100)+'%';updateMinimap()}
document.getElementById('btnZoomIn').onclick=()=>zoomAtCenter(Math.min(5,zoom+0.2));
document.getElementById('btnZoomOut').onclick=()=>zoomAtCenter(Math.max(0.1,zoom-0.2));
document.getElementById('btnFitView').onclick=fitView;
document.getElementById('btnReset').onclick=()=>{panX=0;panY=0;zoom=1;updateTransform()};
document.getElementById('btnFullscreen').onclick=toggleFullscreen;
document.getElementById('btnHelp').onclick=()=>{helpPanel.classList.toggle('show')};
document.getElementById('btnLoad').onclick=()=>document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange=loadLayout;
function loadLayout(e){const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{try{const text=ev.target.result;let layout;if(text.trim().startsWith('<')){const m=text.match(/const WSW_DATA=(\\{[\\s\\S]*?\\});/);if(!m)throw new Error('Invalid WSW HTML');layout=JSON.parse(m[1])}else{layout=JSON.parse(text)}if(!layout.cards||!Array.isArray(layout.cards))throw new Error('Invalid layout');WSW_DATA.title=layout.title||WSW_DATA.title;WSW_DATA.url=layout.url||WSW_DATA.url;WSW_DATA.createdAt=layout.createdAt||WSW_DATA.createdAt;WSW_DATA.background=layout.background||{type:'color',value:'#1a1a2e'};WSW_DATA.showGrid=layout.showGrid!==undefined?layout.showGrid:true;WSW_DATA.cards=layout.cards;document.getElementById('toolbarTitle').textContent=WSW_DATA.title;applyBackground();selectedCards.clear();renderCards();renderAllCharts();setTimeout(()=>{fitView();showHint('布局已导入：'+file.name)},100)}catch(err){showHint('导入失败：文件格式错误')}};reader.readAsText(file);e.target.value=''}
document.addEventListener('click',e=>{if(!e.target.closest('#helpPanel')&&!e.target.closest('#btnHelp'))helpPanel.classList.remove('show')});
function zoomAtCenter(newZoom){const cw=canvas.clientWidth,ch=canvas.clientHeight;panX=cw/2-(cw/2-panX)*(newZoom/zoom);panY=ch/2-(ch/2-panY)*(newZoom/zoom);zoom=newZoom;updateTransform()}
function fitView(){if(WSW_DATA.cards.length===0)return;let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;WSW_DATA.cards.forEach(c=>{minX=Math.min(minX,c.x);minY=Math.min(minY,c.y);maxX=Math.max(maxX,c.x+c.w);maxY=Math.max(maxY,c.y+c.h)});const pad=100,cw=canvas.clientWidth,ch=canvas.clientHeight;zoom=Math.min(cw/(maxX-minX+pad*2),ch/(maxY-minY+pad*2),1.5);panX=(cw-(maxX+minX)*zoom)/2;panY=(ch-(maxY+minY)*zoom)/2;updateTransform()}
function toggleFullscreen(){if(!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});else document.exitFullscreen().catch(()=>{})}
function showSnapLines(){clearSnapLines();const cards=WSW_DATA.cards,draggingIds=new Set(selectedCards);selectedCards.forEach(id=>{const card=cards.find(c=>c.id===id);if(!card)return;const cx1=card.x,cy1=card.y,cx2=card.x+card.w,cy2=card.y+card.h,cmx=card.x+card.w/2,cmy=card.y+card.h/2;cards.forEach(other=>{if(draggingIds.has(other.id))return;const ox1=other.x,oy1=other.y,ox2=other.x+other.w,oy2=other.y+other.h,omx=other.x+other.w/2,omy=other.y+other.h/2;if(Math.abs(cy1-oy1)<SNAP_DIST)addSnapLine('horizontal',oy1);if(Math.abs(cy2-oy2)<SNAP_DIST)addSnapLine('horizontal',oy2);if(Math.abs(cmy-omy)<SNAP_DIST)addSnapLine('horizontal',omy);if(Math.abs(cx1-ox1)<SNAP_DIST)addSnapLine('vertical',ox1);if(Math.abs(cx2-ox2)<SNAP_DIST)addSnapLine('vertical',ox2);if(Math.abs(cmx-omx)<SNAP_DIST)addSnapLine('vertical',omx)})})}
function addSnapLine(dir,pos){const line=document.createElement('div');line.className='snap-line '+dir;if(dir==='horizontal')line.style.top=pos+'px';else line.style.left=pos+'px';snapContainer.appendChild(line)}
function clearSnapLines(){snapContainer.innerHTML=''}
function updateMinimap(){const mm=document.getElementById('minimap'),vp=document.getElementById('minimapViewport');const cw=canvas.clientWidth,ch=canvas.clientHeight;let maxX=0,maxY=0;WSW_DATA.cards.forEach(c=>{maxX=Math.max(maxX,c.x+c.w);maxY=Math.max(maxY,c.y+c.h)});maxX=Math.max(maxX,cw);maxY=Math.max(maxY,ch);const scale=Math.min(170/maxX,110/maxY);mm.querySelectorAll('.minimap-dot').forEach(d=>d.remove());WSW_DATA.cards.forEach(c=>{const dot=document.createElement('div');dot.className='minimap-dot';dot.style.left=(c.x*scale)+'px';dot.style.top=(c.y*scale)+'px';mm.appendChild(dot)});const vx=(-panX/zoom)*scale,vy=(-panY/zoom)*scale;vp.style.left=vx+'px';vp.style.top=vy+'px';vp.style.width=Math.min((cw/zoom)*scale,170)+'px';vp.style.height=Math.min((ch/zoom)*scale,110)+'px'}
function showContextMenu(x,y){contextMenu.style.left=x+'px';contextMenu.style.top=y+'px';contextMenu.classList.add('show')}
document.addEventListener('click',()=>contextMenu.classList.remove('show'));
contextMenu.querySelectorAll('.ctx-item').forEach(item=>{item.addEventListener('click',()=>{if(!contextTarget)return;const{card,el}=contextTarget;switch(item.dataset.action){case'bring-front':saveUndoState();card.z=++maxZ;el.style.zIndex=maxZ;break;case'send-back':saveUndoState();card.z=0;el.style.zIndex=0;break;case'duplicate':saveUndoState();duplicateSelected();break;case'delete':saveUndoState();deleteSelected();break}contextMenu.classList.remove('show')})});
function saveUndoState(){undoStack.push(JSON.parse(JSON.stringify(WSW_DATA.cards)));if(undoStack.length>50)undoStack.shift()}
function undo(){if(undoStack.length===0)return;WSW_DATA.cards=undoStack.pop();selectedCards.clear();renderCards();showHint('已撤销')}
function deleteSelected(){if(selectedCards.size===0)return;WSW_DATA.cards=WSW_DATA.cards.filter(c=>!selectedCards.has(c.id));selectedCards.clear();renderCards()}
function duplicateSelected(){if(selectedCards.size===0)return;const newIds=new Set();WSW_DATA.cards.forEach(c=>{if(selectedCards.has(c.id)){const dup={...c,id:Date.now()+Math.random(),x:c.x+20,y:c.y+20,z:++maxZ};if(c.data)dup.data=JSON.parse(JSON.stringify(c.data));WSW_DATA.cards.push(dup);newIds.add(dup.id)}});selectedCards=newIds;renderCards()}
document.addEventListener('keydown',e=>{const isInput=document.activeElement.tagName==='INPUT'||document.activeElement.contentEditable==='true';if(isInput)return;if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();saveUndoState();deleteSelected()}if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undo()}if((e.ctrlKey||e.metaKey)&&e.key==='d'){e.preventDefault();saveUndoState();duplicateSelected()}if((e.ctrlKey||e.metaKey)&&e.key==='a'){e.preventDefault();selectAll()}if((e.ctrlKey||e.metaKey)&&e.key==='0'){e.preventDefault();fitView()}if((e.ctrlKey||e.metaKey)&&e.key==='='){e.preventDefault();zoomAtCenter(Math.min(5,zoom+0.2))}if((e.ctrlKey||e.metaKey)&&e.key==='-'){e.preventDefault();zoomAtCenter(Math.max(0.1,zoom-0.2))}if(e.key==='F11'){e.preventDefault();toggleFullscreen()}if(e.key==='Escape'){selectedCards.clear();document.querySelectorAll('.selected').forEach(c=>c.classList.remove('selected'));helpPanel.classList.remove('show')}});
function selectAll(){selectedCards.clear();WSW_DATA.cards.forEach(c=>selectedCards.add(c.id));document.querySelectorAll('.res-card,.text-box,.wsw-table,.shape-box').forEach(el=>el.classList.add('selected'))}
let hintTimer;function showHint(msg){hint.textContent=msg;hint.classList.add('show');clearTimeout(hintTimer);hintTimer=setTimeout(()=>hint.classList.remove('show'),2500)}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
applyBackground();renderCards();renderAllCharts();setTimeout(()=>{fitView();showHint('双击空白处创建文字框 · 滚轮缩放 · 中键平移画布')},400)})();
</script>
</body>
</html>`;
  },

  _escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  },

  // ===== 撤销系统 =====
  saveUndo() {
    if (!this.state.doc) return;
    // 深拷贝当前状态
    const snapshot = JSON.parse(JSON.stringify(this.state.doc));
    this.state.undoStack.push(snapshot);
    if (this.state.undoStack.length > 50) {
      this.state.undoStack.shift();
    }
  },

  undo() {
    if (this.state.undoStack.length === 0) {
      App.showToast('无可撤销操作');
      return;
    }
    const prev = this.state.undoStack.pop();
    this.state.doc = prev;
    this.state.selectedCards.clear();
    this.state.editingCardId = null;
    this.renderCanvas();
    App.showToast('已撤销');
  },

  // ===== 元素添加 =====
  addTextBox() {
    if (!this.state.doc) { App.showToast('请先创建文档'); return; }
    this.saveUndo();

    // 在视图中心添加
    const wrap = document.getElementById('wswCanvasWrap');
    const cx = wrap ? wrap.clientWidth / 2 - 120 : 100;
    const cy = wrap ? wrap.clientHeight / 2 - 60 : 100;

    const card = {
      id: Date.now(),
      type: 'textbox',
      name: '文字框',
      content: '# 标题\n\n双击编辑文字...',
      mdView: true,
      x: cx,
      y: cy,
      w: 280,
      h: 160,
      z: ++this.state.maxZ
    };

    this.state.doc.cards.push(card);
    document.getElementById('wswEmpty').style.display = 'none';
    this.renderCanvas();
    App.showToast('已添加文字框');
    // 自动进入编辑
    setTimeout(() => this.enterTextEdit(card.id), 100);
  },

  addTable() {
    if (!this.state.doc) { App.showToast('请先创建文档'); return; }
    this.saveUndo();

    const wrap = document.getElementById('wswCanvasWrap');
    const cx = wrap ? wrap.clientWidth / 2 - 160 : 100;
    const cy = wrap ? wrap.clientHeight / 2 - 80 : 100;

    const card = {
      id: Date.now(),
      type: 'table',
      name: '表格',
      tableData: [['列1', '列2', '列3'], ['数据', '数据', '数据'], ['数据', '数据', '数据']],
      x: cx,
      y: cy,
      w: 320,
      h: 160,
      z: ++this.state.maxZ
    };

    this.state.doc.cards.push(card);
    document.getElementById('wswEmpty').style.display = 'none';
    this.renderCanvas();
    App.showToast('已添加表格');
  },

  addShape(shapeType) {
    if (!this.state.doc) { App.showToast('请先创建文档'); return; }
    this.saveUndo();

    const wrap = document.getElementById('wswCanvasWrap');
    const cx = wrap ? wrap.clientWidth / 2 - 60 : 100;
    const cy = wrap ? wrap.clientHeight / 2 - 60 : 100;

    const colorMap = { rect: '#e94560', circle: '#3498db', triangle: '#2ecc71' };
    const card = {
      id: Date.now(),
      type: 'shape',
      shapeType: shapeType,
      name: shapeType === 'rect' ? '矩形' : shapeType === 'circle' ? '圆形' : '三角形',
      color: colorMap[shapeType] || '#e94560',
      x: cx,
      y: cy,
      w: 120,
      h: 120,
      z: ++this.state.maxZ
    };

    this.state.doc.cards.push(card);
    document.getElementById('wswEmpty').style.display = 'none';
    this.renderCanvas();
    App.showToast('已添加' + card.name);
  },

  // ===== 容器添加（视频/音频/文本，支持工作流链接） =====
  _createContainer(type, name, w, h) {
    if (!this.state.doc) { App.showToast('请先创建文档'); return null; }
    this.saveUndo();
    const wrap = document.getElementById('wswCanvasWrap');
    const cx = wrap ? wrap.clientWidth / 2 - w / 2 : 100;
    const cy = wrap ? wrap.clientHeight / 2 - h / 2 : 100;
    const now = Date.now();
    const card = {
      id: Date.now(),
      type: type,
      name: name,
      x: cx, y: cy, w: w, h: h,
      z: ++this.state.maxZ,
      timestamp: {
        created: now,
        lastUpdated: now,
        ttl: null  // null=使用全局defaultTTL，0=永不过期，>0=自定义毫秒
      },
      // 播放模式：'local'=本地, 'online'=网络, 'none'=未设置
      playMode: 'none',
      // 本地源（已下载或手动选择的本地文件）
      localSource: null,
      // 网络源（直接输入的URL或从工作流获取的URL）
      onlineSource: null,
      // 工作流下载源（定时从工作流下载到本地）
      workflowDownload: null,
      // 兼容旧字段
      sourceType: 'workflow',
      workflowLink: null,
      localPath: null,
      urlSource: null,
      browserSource: null,
      currentResource: null
    };

    // 根据容器类型设置特有字段
    if (type === 'textContainer') {
      // 文本容器：装图片、文本、超链接
      card.items = [];  // [{ type: 'image'|'text'|'link', url, name, content, localPath }]
    } else if (type === 'excelContainer') {
      // Excel容器：网格表格 + 统计图
      card.tableRows = 5;   // 默认5行
      card.tableCols = 3;   // 默认3列
      card.tableData = [];  // 二维数组 [[cell, cell, cell], ...]
      // 初始化 tableData
      for (let r = 0; r < card.tableRows; r++) {
        card.tableData[r] = [];
        for (let c = 0; c < card.tableCols; c++) {
          card.tableData[r][c] = '';
        }
      }
      card.viewMode = 'table';  // 'table'=表格视图, 'chart'=统计图视图
    } else if (type === 'chartCard') {
      // 统计图卡片：连接Excel/文本容器，展示图表
      card.sourceCardId = null;  // 连接的容器ID
      card.chartType = 'bar';    // 'bar'=柱状图, 'pie'=饼图, 'line'=折线图, 'wordcloud'=词云
      card.chartData = null;     // 缓存的图表数据 {labels:[], values:[]}
    }

    this.state.doc.cards.push(card);
    document.getElementById('wswEmpty').style.display = 'none';
    return card;
  },

  addVideoContainer() {
    const card = this._createContainer('videoContainer', '视频容器', 360, 240);
    if (!card) return;
    this.renderCanvas();
    App.showToast('已添加视频容器（仅装视频文件）');
  },

  addAudioContainer() {
    const card = this._createContainer('audioContainer', '音频容器', 320, 110);
    if (!card) return;
    this.renderCanvas();
    App.showToast('已添加音频容器（仅装音频文件）');
  },

  addTextContainer() {
    const card = this._createContainer('textContainer', '文本容器', 340, 240);
    if (!card) return;
    this.renderCanvas();
    App.showToast('已添加文本容器（图片/文本/超链接）');
  },

  addExcelContainer() {
    const card = this._createContainer('excelContainer', 'Excel容器', 460, 360);
    if (!card) return;
    this.renderCanvas();
    App.showToast('已添加Excel容器（表格+统计图）');
  },

  addChartCard() {
    const card = this._createContainer('chartCard', '统计图', 400, 300);
    if (!card) return;
    this.renderCanvas();
    App.showToast('已添加统计图卡片（连接 Excel/文本容器）');
  },

  // 添加 HTML 块卡片
  addHtmlBlock() {
    const card = this._createContainer('htmlBlock', 'HTML 块', 400, 300);
    if (!card) return;
    card.htmlContent = '<div style="padding:20px;text-align:center;color:#666;"><h3>HTML 块</h3><p>双击编辑 HTML/CSS 内容</p></div>';
    card.cssContent = '';
    this.renderCanvas();
    App.showToast('已添加 HTML 块卡片（支持 HTML/CSS 渲染）');
  },

  // Task 16: 添加 AI 工作流容器
  addAiworkflowContainer() {
    if (!this.state.doc) { App.showToast('请先创建文档'); return; }
    this.saveUndo();
    const wrap = document.getElementById('wswCanvasWrap');
    const w = 280, h = 200;
    const cx = wrap ? wrap.clientWidth / 2 - w / 2 : 100;
    const cy = wrap ? wrap.clientHeight / 2 - h / 2 : 100;
    const now = Date.now();
    const card = {
      id: Date.now(),
      type: 'aiworkflow',
      name: 'AI 工作流',
      x: cx, y: cy, w: w, h: h,
      z: ++this.state.maxZ,
      timestamp: { created: now, lastUpdated: now, ttl: null },
      taskId: null,
      taskName: null,
      taskType: null,
      lastRunAt: null,
      lastResultSummary: null,
      taskDeleted: false,
      running: false
    };
    this.state.doc.cards.push(card);
    document.getElementById('wswEmpty').style.display = 'none';
    this.renderCanvas();
    App.showToast('已添加 AI 工作流容器（点击 ⚙ 配置任务）');
  },

  // 选择本地文件并加载到容器
  chooseLocalFile(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || !['videoContainer', 'audioContainer', 'textContainer'].includes(card.type)) return;

    const input = document.createElement('input');
    input.type = 'file';
    // 根据容器类型设置不同的 accept
    if (card.type === 'videoContainer') {
      input.accept = 'video/*,.mp4,.webm,.avi,.mov,.mkv,.flv';
    } else if (card.type === 'audioContainer') {
      input.accept = 'audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a';
    } else if (card.type === 'textContainer') {
      // 文本容器：图片、文本、超链接（HTML）
      input.accept = 'image/*,.txt,.md,.json,.csv,.log,.xml,.html,.htm,.js,.css,.py,.java,.cpp';
    }

    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      card.sourceType = 'local';
      card.localPath = file.path;
      card.timestamp.lastUpdated = Date.now();

      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff'].includes(ext);

      if (card.type === 'textContainer') {
        // 文本容器：图片/文本/超链接
        if (isImage) {
          // 图片文件
          const fileUrl = 'file://' + file.path.replace(/\\/g, '/');
          if (!card.items) card.items = [];
          card.items.push({
            type: 'image',
            url: fileUrl,
            localPath: file.path,
            name: file.name,
            size: file.size
          });
          card.playMode = 'local';
          this.renderCanvas();
          App.showToast('已添加图片: ' + file.name);
        } else {
          // 文本文件读取内容
          const reader = new FileReader();
          reader.onload = (ev) => {
            if (!card.items) card.items = [];
            card.items.push({
              type: 'text',
              content: ev.target.result,
              name: file.name,
              localPath: file.path,
              format: ext,
              size: file.size
            });
            card.playMode = 'local';
            this.renderCanvas();
            App.showToast('已添加文本: ' + file.name);
          };
          reader.readAsText(file);
        }
      } else {
        // 视频/音频容器：单一文件播放
        card.localSource = {
          path: file.path,
          name: file.name,
          format: ext,
          size: file.size,
          downloadedAt: Date.now()
        };
        card.playMode = 'local';
        const fileUrl = 'file://' + file.path.replace(/\\/g, '/');
        card.currentResource = {
          url: fileUrl,
          name: file.name,
          format: ext,
          streamType: 'local',
          cachedAt: Date.now(),
          isLocal: true,
          localPath: file.path,
          size: file.size
        };
        this.renderCanvas();
        App.showToast('已加载本地文件: ' + file.name);
      }
    };

    input.click();
  },

  // 设置网络URL直接播放
  setUrlSource(cardId, url) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || !['videoContainer', 'audioContainer', 'textContainer'].includes(card.type)) return;
    if (!url || !url.trim()) {
      App.showToast('请输入有效的URL');
      return;
    }
    url = url.trim();
    card.sourceType = 'url';
    card.urlSource = url;
    card.timestamp.lastUpdated = Date.now();

    // 根据URL推断格式和类型
    let format = '';
    const extMatch = url.match(/\.([a-z0-9]+)(\?|$|#)/i);
    if (extMatch) format = extMatch[1].toLowerCase();

    const streamType = url.indexOf('.m3u8') > -1 ? 'm3u8' : (url.startsWith('blob:') ? 'blob' : 'http');
    const resName = url.split('/').pop().split('?')[0] || '网络资源';
    const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff'];
    const isImage = imgExts.includes(format);

    if (card.type === 'textContainer') {
      // 文本容器：判断是图片还是超链接
      if (!card.items) card.items = [];
      if (isImage) {
        card.items.push({ type: 'image', url: url, name: resName });
      } else {
        card.items.push({ type: 'link', url: url, name: resName });
      }
      card.playMode = 'online';
      this.renderCanvas();
      App.showToast('已添加' + (isImage ? '图片' : '超链接'));
    } else {
      // 视频/音频容器
      card.onlineSource = {
        url: url,
        name: resName,
        format: format,
        streamType: streamType,
        cachedAt: Date.now()
      };
      card.playMode = 'online';
      card.currentResource = {
        url: url,
        name: resName,
        format: format,
        streamType: streamType,
        cachedAt: Date.now(),
        isLocal: false
      };
      this.renderCanvas();
      App.showToast('已设置网络URL: ' + url.substring(0, 50));
    }
  },

  // 显示URL输入面板（网络URL配置）
  showUrlInputPanel(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || !['videoContainer', 'audioContainer', 'textContainer'].includes(card.type)) return;

    const overlay = document.createElement('div');
    overlay.className = 'wsw-link-overlay';
    const currentUrl = card.urlSource || '';
    const typeLabel = card.type === 'videoContainer' ? '视频' : card.type === 'audioContainer' ? '音频' : '文本';

    overlay.innerHTML = '<div class="wsw-link-panel" style="width:460px">' +
      '<div class="wsw-link-header"><span>🌐 网络' + typeLabel + 'URL</span><button class="wsw-link-close">✕</button></div>' +
      '<div class="wsw-link-body">' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">资源URL地址</label>' +
          '<input type="text" id="urlInputField" value="' + this.esc(currentUrl) + '" placeholder="https://example.com/video.mp4" class="wsw-link-input" style="font-size:12px">' +
          '<div class="wsw-link-hint">支持 http/https 直链，m3u8 流媒体将显示链接需外部播放器打开</div>' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">常见格式</label>' +
          '<div class="wsw-url-presets">' +
            (card.type === 'videoContainer' ?
              '<button class="wsw-url-preset" data-url=".mp4">MP4视频</button>' +
              '<button class="wsw-url-preset" data-url=".webm">WebM</button>' +
              '<button class="wsw-url-preset" data-url=".m3u8">HLS流</button>'
            : card.type === 'audioContainer' ?
              '<button class="wsw-url-preset" data-url=".mp3">MP3音频</button>' +
              '<button class="wsw-url-preset" data-url=".wav">WAV</button>' +
              '<button class="wsw-url-preset" data-url=".ogg">OGG</button>'
            :
              '<button class="wsw-url-preset" data-url=".txt">TXT文本</button>' +
              '<button class="wsw-url-preset" data-url=".md">Markdown</button>' +
              '<button class="wsw-url-preset" data-url=".json">JSON</button>'
            ) +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="wsw-link-footer">' +
        '<button class="wsw-link-btn cancel-btn">取消</button>' +
        '<button class="wsw-link-btn save-btn primary">加载</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);
    const urlInput = document.getElementById('urlInputField');
    urlInput.focus();
    urlInput.select();

    const close = () => overlay.remove();
    overlay.querySelector('.wsw-link-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // 预设按钮仅追加扩展名提示
    overlay.querySelectorAll('.wsw-url-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const ext = btn.dataset.url;
        if (!urlInput.value.endsWith(ext)) {
          urlInput.value = (urlInput.value || 'https://') + (urlInput.value && !urlInput.value.endsWith('/') ? '' : '') + ext;
        }
        urlInput.focus();
      });
    });

    overlay.querySelector('.save-btn').addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (!url) {
        App.showToast('请输入URL');
        return;
      }
      this.setUrlSource(cardId, url);
      close();
    });

    // 回车提交
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        overlay.querySelector('.save-btn').click();
      }
    });
  },

  // ===== 时间戳与时效性 =====
  // 检查容器是否过期（true=过期需要刷新）
  isContainerExpired(card) {
    if (!card || !card.timestamp) return false;
    const ttl = card.timestamp.ttl !== null ? card.timestamp.ttl : (this.state.doc.defaultTTL || 0);
    if (ttl === 0) return false;  // 永不过期
    const lastUpdated = card.timestamp.lastUpdated || card.timestamp.created || 0;
    return (Date.now() - lastUpdated) > ttl;
  },

  // 刷新所有过期容器（打开文件时自动调用）
  async refreshAllExpiredContainers() {
    if (!this.state.doc || !this.state.doc.cards) return;
    const expired = this.state.doc.cards.filter(c =>
      (c.type === 'videoContainer' || c.type === 'audioContainer' || c.type === 'textContainer' || c.type === 'excelContainer') &&
      c.workflowLink && c.workflowLink.autoRefresh && this.isContainerExpired(c)
    );
    if (expired.length === 0) return;
    App.showToast('检测到 ' + expired.length + ' 个过期容器，正在刷新...');
    let successCount = 0;
    for (const card of expired) {
      if (card.type === 'excelContainer') {
        await this.refreshExcelStats(card.id);
        successCount++;
      } else if (card.type === 'textContainer') {
        await this.refreshTextWorkflow(card.id);
        successCount++;
      } else {
        const ok = await this.refreshContainerResource(card.id);
        if (ok) successCount++;
      }
    }
    App.showToast('已刷新 ' + successCount + '/' + expired.length + ' 个容器');
    this.renderCanvas();
  },

  // 刷新单个容器资源（从工作流重新获取）
  async refreshContainerResource(cardId) {
    if (!this.state.doc) return false;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || !card.workflowLink) return false;
    try {
      if (!window.electronAPI?.getWorkflowDetail) return false;
      const result = await window.electronAPI.getWorkflowDetail(card.workflowLink.workflowId);
      if (!result.success || !result.data || !result.data.resources) return false;
      const resource = result.data.resources[card.workflowLink.cardIndex];
      if (!resource) return false;
      // 更新容器资源（新架构：作为在线播放源）
      const streamType = resource.streamType || (resource.url && resource.url.indexOf('.m3u8') > -1 ? 'm3u8' : (resource.url && resource.url.startsWith('blob:') ? 'blob' : 'http'));
      card.onlineSource = {
        url: resource.url,
        name: resource.name || resource.text || '',
        format: resource.format || '',
        streamType: streamType,
        content: resource.content || '',
        cachedAt: Date.now()
      };
      // 兼容旧字段
      card.currentResource = {
        url: resource.url,
        name: resource.name || resource.text || '',
        format: resource.format || '',
        streamType: streamType,
        content: resource.content || '',
        cachedAt: Date.now()
      };
      // 如果当前播放模式未设置或已是网络模式，保持/切换为网络播放
      if (card.playMode === 'none' || card.playMode === 'online') {
        card.playMode = 'online';
      }
      // 同步工作流下载源标题和资源链接（双链接：页面来源URL + 资源URL）
      if (card.workflowDownload) {
        card.workflowDownload.workflowTitle = result.data.title || card.workflowDownload.workflowTitle || '';
        card.workflowDownload.resourceUrl = resource.url || '';
        card.workflowDownload.pageUrl = resource.pageUrl || result.data.url || '';
        card.workflowDownload.resourceName = resource.name || resource.text || '';
      }
      // 同步onlineSource的pageUrl
      if (card.onlineSource) {
        card.onlineSource.pageUrl = resource.pageUrl || result.data.url || '';
      }
      card.timestamp.lastUpdated = Date.now();
      return true;
    } catch (e) {
      console.error('refreshContainerResource error:', e);
      return false;
    }
  },

  // ===== 链接配置面板 =====
  async showLinkConfigPanel(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card) return;
    if (!['videoContainer', 'audioContainer', 'textContainer'].includes(card.type)) return;

    // 获取工作流列表
    let workflows = [];
    if (window.electronAPI?.getWorkflows) {
      const result = await window.electronAPI.getWorkflows();
      if (result.success) workflows = result.data || [];
    }

    // 构建配置面板HTML
    const overlay = document.createElement('div');
    overlay.className = 'wsw-link-overlay';
    const link = card.workflowLink || {};
    const ts = card.timestamp || {};
    const ttlValue = ts.ttl !== null && ts.ttl !== undefined ? ts.ttl : '';

    // 筛选匹配当前容器类型的资源
    const expectedType = card.type === 'videoContainer' ? 'video' : card.type === 'audioContainer' ? 'audio' : 'text';

    overlay.innerHTML = '<div class="wsw-link-panel">' +
      '<div class="wsw-link-header"><span>⚙️ 容器资源配置</span><button class="wsw-link-close">✕</button></div>' +
      '<div class="wsw-link-body">' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">容器名称</label>' +
          '<input type="text" id="linkContainerName" value="' + this.esc(card.name) + '" class="wsw-link-input">' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">资源来源</label>' +
          '<div class="wsw-source-tabs">' +
            '<button class="wsw-source-tab' + (card.sourceType === 'workflow' ? ' active' : '') + '" data-source="workflow">🔗 工作流链接</button>' +
            '<button class="wsw-source-tab' + (card.sourceType === 'local' ? ' active' : '') + '" data-source="local">💾 本地文件</button>' +
            '<button class="wsw-source-tab' + (card.sourceType === 'url' ? ' active' : '') + '" data-source="url">🌐 网络URL</button>' +
          '</div>' +
        '</div>' +
        '<div id="sourceWorkflowPanel" style="display:' + (card.sourceType === 'workflow' ? 'block' : 'none') + '">' +
          '<div class="wsw-link-section">' +
            '<label class="wsw-link-label">选择工作流记录</label>' +
            '<select id="linkWorkflowSelect" class="wsw-link-select">' +
              '<option value="">-- 请选择 --</option>' +
              workflows.map(wf => '<option value="' + wf.id + '"' + (link.workflowId === wf.id ? ' selected' : '') + '>' +
                this.esc((wf.title || '未命名') + ' (' + (wf.resourceCount || 0) + '个资源)') + '</option>'
              ).join('') +
            '</select>' +
          '</div>' +
          '<div class="wsw-link-section">' +
            '<label class="wsw-link-label">选择资源卡片</label>' +
            '<select id="linkCardSelect" class="wsw-link-select">' +
              '<option value="">-- 请先选择工作流 --</option>' +
            '</select>' +
            '<div class="wsw-link-hint" id="linkCardHint"></div>' +
          '</div>' +
        '</div>' +
        '<div id="sourceLocalPanel" style="display:' + (card.sourceType === 'local' ? 'block' : 'none') + '">' +
          '<div class="wsw-link-section">' +
            '<label class="wsw-link-label">本地文件</label>' +
            '<div class="wsw-local-file-row">' +
              '<input type="text" id="linkLocalPath" value="' + this.esc(card.localPath || '') + '" placeholder="点击下方按钮选择文件" class="wsw-link-input" readonly>' +
              '<button class="wsw-link-btn" id="linkChooseFileBtn">📁 选择</button>' +
            '</div>' +
            '<div class="wsw-link-hint">本地文件不会过期，无需TTL设置</div>' +
          '</div>' +
        '</div>' +
        '<div id="sourceUrlPanel" style="display:' + (card.sourceType === 'url' ? 'block' : 'none') + '">' +
          '<div class="wsw-link-section">' +
            '<label class="wsw-link-label">网络URL地址</label>' +
            '<input type="text" id="linkUrlSource" value="' + this.esc(card.urlSource || '') + '" placeholder="https://example.com/resource.mp4" class="wsw-link-input" style="font-size:12px">' +
            '<div class="wsw-link-hint">支持 http/https 直链和 m3u8 流媒体</div>' +
          '</div>' +
        '</div>' +
        '<div class="wsw-link-section"' + (card.sourceType === 'local' ? ' style="display:none"' : '') + ' id="ttlSection">' +
          '<label class="wsw-link-label">TTL 过期时间（毫秒，留空=使用全局默认，0=永不过期）</label>' +
          '<input type="text" id="linkTTL" value="' + ttlValue + '" placeholder="如 3600000=1小时" class="wsw-link-input">' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-checkbox-label">' +
            '<input type="checkbox" id="linkAutoRefresh" ' + (link.autoRefresh ? 'checked' : '') + '>' +
            '<span>自动刷新（打开文件时自动更新过期资源）</span>' +
          '</label>' +
        '</div>' +
        '<div class="wsw-link-preview" id="linkPreview"></div>' +
      '</div>' +
      '<div class="wsw-link-footer">' +
        '<button class="wsw-link-btn refresh-btn">🔄 立即刷新</button>' +
        '<button class="wsw-link-btn unlink-btn">🔓 取消链接</button>' +
        '<button class="wsw-link-btn cancel-btn">取消</button>' +
        '<button class="wsw-link-btn save-btn primary">保存</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);

    // 加载选中工作流的资源列表
    const loadResources = async (wfId) => {
      const cardSelect = document.getElementById('linkCardSelect');
      const hint = document.getElementById('linkCardHint');
      if (!wfId) {
        cardSelect.innerHTML = '<option value="">-- 请先选择工作流 --</option>';
        hint.textContent = '';
        return;
      }
      if (!window.electronAPI?.getWorkflowDetail) return;
      const result = await window.electronAPI.getWorkflowDetail(wfId);
      if (!result.success || !result.data || !result.data.resources) {
        cardSelect.innerHTML = '<option value="">加载失败</option>';
        return;
      }
      const resources = result.data.resources;
      // 显示所有资源，但标记匹配类型
      cardSelect.innerHTML = '<option value="">-- 请选择 --</option>' +
        resources.map((r, i) => {
          const typeMatch = r.type === expectedType;
          const icon = { image: '🖼️', video: '🎬', audio: '🎵', link: '🔗', text: '📝' }[r.type] || '📄';
          const label = (r.name || r.text || '资源' + (i + 1)).substring(0, 50);
          return '<option value="' + i + '"' + (link.cardIndex === i ? ' selected' : '') + '>' +
            icon + (typeMatch ? '✓' : '⚠') + ' ' + this.esc(label) + '</option>';
        }).join('');
      hint.textContent = '✓=类型匹配  ⚠=类型不匹配（' + expectedType + '）';
      // 显示预览
      updatePreview(wfId, cardSelect.value);
    };

    const updatePreview = async (wfId, idx) => {
      const preview = document.getElementById('linkPreview');
      if (!wfId || idx === '') {
        preview.innerHTML = '';
        return;
      }
      if (!window.electronAPI?.getWorkflowDetail) return;
      const result = await window.electronAPI.getWorkflowDetail(wfId);
      if (!result.success) return;
      const res = result.data.resources[parseInt(idx)];
      if (!res) return;
      preview.innerHTML = '<div class="wsw-link-preview-title">资源预览：</div>' +
        '<div class="wsw-link-preview-row"><b>类型:</b> ' + (res.type || '') + '</div>' +
        '<div class="wsw-link-preview-row"><b>名称:</b> ' + this.esc(res.name || res.text || '') + '</div>' +
        '<div class="wsw-link-preview-row"><b>URL:</b> ' + this.esc((res.url || '').substring(0, 80)) + '</div>' +
        (res.format ? '<div class="wsw-link-preview-row"><b>格式:</b> ' + res.format + '</div>' : '') +
        (res.streamType ? '<div class="wsw-link-preview-row"><b>流类型:</b> ' + res.streamType + '</div>' : '');
    };

    // 初始加载
    if (link.workflowId && card.sourceType === 'workflow') await loadResources(link.workflowId);

    // 资源来源切换
    let activeSource = card.sourceType || 'workflow';
    overlay.querySelectorAll('.wsw-source-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeSource = tab.dataset.source;
        overlay.querySelectorAll('.wsw-source-tab').forEach(t => t.classList.toggle('active', t === tab));
        document.getElementById('sourceWorkflowPanel').style.display = activeSource === 'workflow' ? 'block' : 'none';
        document.getElementById('sourceLocalPanel').style.display = activeSource === 'local' ? 'block' : 'none';
        document.getElementById('sourceUrlPanel').style.display = activeSource === 'url' ? 'block' : 'none';
        document.getElementById('ttlSection').style.display = activeSource === 'local' ? 'none' : 'block';
      });
    });

    // 本地文件选择按钮
    const chooseBtn = document.getElementById('linkChooseFileBtn');
    if (chooseBtn) {
      chooseBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        if (card.type === 'videoContainer') {
          input.accept = 'video/*,.mp4,.webm,.avi,.mov,.mkv,.flv';
        } else if (card.type === 'audioContainer') {
          input.accept = 'audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a';
        } else if (card.type === 'textContainer') {
          input.accept = '.txt,.md,.json,.csv,.log,.xml,.html,.js,.css,.py,.java,.cpp';
        }
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          card.localPath = file.path;
          document.getElementById('linkLocalPath').value = file.path;
        };
        input.click();
      });
    }

    // 工作流选择变化
    document.getElementById('linkWorkflowSelect').addEventListener('change', (e) => {
      loadResources(e.target.value);
    });
    document.getElementById('linkCardSelect').addEventListener('change', (e) => {
      updatePreview(document.getElementById('linkWorkflowSelect').value, e.target.value);
    });

    // 按钮事件
    const close = () => overlay.remove();
    overlay.querySelector('.wsw-link-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.save-btn').addEventListener('click', async () => {
      const name = document.getElementById('linkContainerName').value.trim();
      if (name) card.name = name;

      if (activeSource === 'workflow') {
        const wfId = document.getElementById('linkWorkflowSelect').value;
        const idx = document.getElementById('linkCardSelect').value;
        const autoRefresh = document.getElementById('linkAutoRefresh').checked;
        card.sourceType = 'workflow';
        if (wfId && idx !== '') {
          card.workflowLink = {
            workflowId: wfId,
            cardIndex: parseInt(idx),
            resourceType: expectedType,
            autoRefresh: autoRefresh
          };
          await this.refreshContainerResource(card.id);
        }
      } else if (activeSource === 'local') {
        const localPath = document.getElementById('linkLocalPath').value.trim();
        card.sourceType = 'local';
        if (localPath) {
          card.localPath = localPath;
          // 直接调用 chooseLocalFile 不行（会弹窗），这里手动构建
          const fileName = localPath.split(/[\\/]/).pop() || '本地文件';
          const ext = (fileName.split('.').pop() || '').toLowerCase();
          if (card.type === 'textContainer') {
            try {
              const response = await fetch('file://' + localPath.replace(/\\/g, '/'));
              const content = await response.text();
              card.currentResource = {
                url: 'local://' + localPath, name: fileName, format: ext,
                content: content, cachedAt: Date.now(), isLocal: true, localPath: localPath
              };
            } catch (e) {
              App.showToast('读取本地文件失败');
            }
          } else {
            card.currentResource = {
              url: 'file://' + localPath.replace(/\\/g, '/'),
              name: fileName, format: ext, streamType: 'local',
              cachedAt: Date.now(), isLocal: true, localPath: localPath
            };
          }
          card.timestamp.lastUpdated = Date.now();
        }
      } else if (activeSource === 'url') {
        const url = document.getElementById('linkUrlSource').value.trim();
        card.sourceType = 'url';
        if (url) {
          this.setUrlSource(card.id, url);
        }
      }

      // TTL 设置（仅非本地）
      if (activeSource !== 'local') {
        const ttlStr = document.getElementById('linkTTL').value.trim();
        if (ttlStr === '') {
          card.timestamp.ttl = null;
        } else {
          const ttl = parseInt(ttlStr);
          card.timestamp.ttl = isNaN(ttl) ? null : ttl;
        }
      } else {
        card.timestamp.ttl = 0;  // 本地文件永不过期
      }

      this.renderCanvas();
      close();
      App.showToast('资源配置已保存');
    });

    overlay.querySelector('.refresh-btn').addEventListener('click', async () => {
      if (activeSource === 'workflow') {
        const wfId = document.getElementById('linkWorkflowSelect').value;
        const idx = document.getElementById('linkCardSelect').value;
        if (!wfId || idx === '') {
          App.showToast('请先选择工作流和资源');
          return;
        }
        card.workflowLink = {
          workflowId: wfId,
          cardIndex: parseInt(idx),
          resourceType: expectedType,
          autoRefresh: document.getElementById('linkAutoRefresh').checked
        };
        const ok = await this.refreshContainerResource(card.id);
        App.showToast(ok ? '资源已刷新' : '刷新失败');
        if (ok) updatePreview(wfId, idx);
      } else {
        App.showToast('请使用保存按钮重新加载');
      }
    });

    overlay.querySelector('.unlink-btn').addEventListener('click', () => {
      card.workflowLink = null;
      card.localPath = null;
      card.urlSource = null;
      card.currentResource = null;
      card.sourceType = 'workflow';
      this.renderCanvas();
      close();
      App.showToast('已清除资源配置');
    });
  },

  // ===== 拖拽链接（从工作流列表拖到容器） =====
  handleWorkflowDrop(cardId, workflowId, cardIndex) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || !['videoContainer', 'audioContainer', 'textContainer', 'excelContainer'].includes(card.type)) return;

    if (card.type === 'excelContainer') {
      // Excel容器：从工作流加载图片/文本/超链接
      card.workflowDownload = {
        workflowId: workflowId,
        workflowTitle: '',
        autoDownload: true,
        lastDownloadAt: null,
        downloadStatus: 'idle'
      };
      card.workflowLink = {
        workflowId: workflowId,
        cardIndex: 0,
        resourceType: 'all',
        autoRefresh: true
      };
      this.refreshExcelStats(card.id);
      return;
    }

    if (card.type === 'textContainer') {
      // 文本容器：从工作流加载图片/文本/超链接
      card.workflowDownload = {
        workflowId: workflowId,
        workflowTitle: '',
        autoDownload: true,
        lastDownloadAt: null,
        downloadStatus: 'idle'
      };
      card.workflowLink = {
        workflowId: workflowId,
        cardIndex: 0,
        resourceType: 'all',
        autoRefresh: true
      };
      this.refreshTextWorkflow(card.id);
      return;
    }

    // 视频和音频容器：单一资源链接
    const expectedType = card.type === 'videoContainer' ? 'video' : 'audio';
    card.workflowDownload = {
      workflowId: workflowId,
      workflowTitle: '',
      cardIndex: cardIndex,
      resourceType: expectedType,
      autoDownload: true,
      lastDownloadAt: null,
      downloadPath: null,
      downloadStatus: 'idle'
    };
    card.workflowLink = {
      workflowId: workflowId,
      cardIndex: cardIndex,
      resourceType: expectedType,
      autoRefresh: true
    };
    // 立即加载资源作为网络播放源（在线播放）
    this.refreshContainerResource(card.id).then(ok => {
      if (ok) {
        const res = card.currentResource;
        if (res && res.url) {
          card.onlineSource = {
            url: res.url,
            name: res.name || '',
            format: res.format || '',
            streamType: res.streamType || '',
            cachedAt: Date.now()
          };
          if (card.playMode === 'none') card.playMode = 'online';
        }
        this.renderCanvas();
        App.showToast('已链接资源（在线播放可用，点击⬇立即下载到本地）');
      } else {
        this.renderCanvas();
        App.showToast('链接失败：无法获取资源');
      }
    });
  },

  // ===== 视频容器统一配置面板（三源分离） =====
  async showVideoConfigPanel(cardId, focusTab) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || !['videoContainer', 'audioContainer', 'textContainer'].includes(card.type)) return;

    let workflows = [];
    if (window.electronAPI?.getWorkflows) {
      const result = await window.electronAPI.getWorkflows();
      if (result.success) workflows = result.data || [];
    }

    const overlay = document.createElement('div');
    overlay.className = 'wsw-link-overlay';
    const local = card.localSource || {};
    const online = card.onlineSource || {};
    const dl = card.workflowDownload || {};
    const playMode = card.playMode || 'none';
    const expectedType = card.type === 'videoContainer' ? 'video' : card.type === 'audioContainer' ? 'audio' : 'text';
    const typeLabel = card.type === 'videoContainer' ? '视频' : card.type === 'audioContainer' ? '音频' : '文本';

    overlay.innerHTML = '<div class="wsw-link-panel" style="width:540px">' +
      '<div class="wsw-link-header"><span>⚙️ ' + typeLabel + '容器配置（三源）</span><button class="wsw-link-close">✕</button></div>' +
      '<div class="wsw-link-body">' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">容器名称</label>' +
          '<input type="text" id="vcName" value="' + this.esc(card.name) + '" class="wsw-link-input">' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">当前播放模式</label>' +
          '<div class="wsw-source-tabs">' +
            '<button class="wsw-source-tab' + (playMode === 'local' ? ' active' : '') + '" data-mode="local">💾 本地播放</button>' +
            '<button class="wsw-source-tab' + (playMode === 'online' ? ' active' : '') + '" data-mode="online">🌐 网络播放</button>' +
            '<button class="wsw-source-tab' + (playMode === 'none' ? ' active' : '') + '" data-mode="none">⏸ 未设置</button>' +
          '</div>' +
          '<div class="wsw-link-hint">选择当前用哪种方式播放。三种源可同时配置，互不影响。</div>' +
        '</div>' +
        // 本地源
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">💾 本地播放源（已下载或手动选择的本地文件）</label>' +
          '<div class="wsw-local-file-row">' +
            '<input type="text" id="vcLocalPath" value="' + this.esc(local.path || '') + '" placeholder="点击选择本地文件" class="wsw-link-input" readonly>' +
            '<button class="wsw-link-btn" id="vcChooseLocal">📁 选择</button>' +
          '</div>' +
          (local.name ? '<div class="wsw-link-hint">当前: ' + this.esc(local.name) + '</div>' : '') +
        '</div>' +
        // 网络源
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">🌐 网络在线播放源（直接输入URL）</label>' +
          '<input type="text" id="vcOnlineUrl" value="' + this.esc(online.url || '') + '" placeholder="https://example.com/video.mp4" class="wsw-link-input" style="font-size:12px">' +
          (online.name ? '<div class="wsw-link-hint">当前: ' + this.esc(online.name) + '</div>' : '') +
        '</div>' +
        // 工作流下载源
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">🔗 工作流下载源（定时从工作流下载到本地）</label>' +
          '<select id="vcWorkflowSelect" class="wsw-link-select">' +
            '<option value="">-- 不配置 --</option>' +
            workflows.map(wf => '<option value="' + wf.id + '"' + (dl.workflowId === wf.id ? ' selected' : '') + '>' +
              this.esc((wf.title || '未命名') + ' (' + (wf.resources?.length || 0) + '个资源)') + '</option>'
            ).join('') +
          '</select>' +
          '<select id="vcCardSelect" class="wsw-link-select" style="margin-top:6px">' +
            '<option value="">-- 请先选择工作流 --</option>' +
          '</select>' +
          '<div class="wsw-link-hint" id="vcCardHint"></div>' +
          '<div id="vcResourceUrl" style="margin-top:6px;display:none">' +
            '<label class="wsw-link-label"> 资源链接</label>' +
            '<input type="text" id="vcResourceUrlInput" class="wsw-link-input" readonly style="font-size:11px;color:var(--primary);cursor:pointer" onclick="navigator.clipboard?.writeText(this.value);App.showToast(\'已复制链接\')">' +
          '</div>' +
          '<label class="wsw-link-checkbox-label">' +
            '<input type="checkbox" id="vcAutoDownload" ' + (dl.autoDownload ? 'checked' : '') + '>' +
            '<span>自动下载（TTL到期时自动从工作流下载到本地）</span>' +
          '</label>' +
          '<div class="wsw-link-section">' +
            '<label class="wsw-link-label">TTL 过期时间（毫秒，留空=全局默认，0=永不过期）</label>' +
            '<input type="text" id="vcTTL" value="' + (card.timestamp?.ttl !== null && card.timestamp?.ttl !== undefined ? card.timestamp.ttl : '') + '" placeholder="如 3600000=1小时" class="wsw-link-input">' +
          '</div>' +
        '</div>' +
        '<div class="wsw-link-preview" id="vcPreview"></div>' +
      '</div>' +
      '<div class="wsw-link-footer">' +
        '<button class="wsw-link-btn download-btn">⬇ 立即下载</button>' +
        '<button class="wsw-link-btn cancel-btn">取消</button>' +
        '<button class="wsw-link-btn save-btn primary">保存</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);

    let selectedMode = playMode;
    let chosenLocalPath = local.path || '';

    // 播放模式切换
    overlay.querySelectorAll('.wsw-source-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        selectedMode = tab.dataset.mode;
        overlay.querySelectorAll('.wsw-source-tab').forEach(t => t.classList.toggle('active', t === tab));
      });
    });

    // 本地文件选择
    document.getElementById('vcChooseLocal').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      if (card.type === 'videoContainer') input.accept = 'video/*,.mp4,.webm,.avi,.mov,.mkv,.flv';
      else if (card.type === 'audioContainer') input.accept = 'audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a';
      else input.accept = '.txt,.md,.json,.csv,.log,.xml,.html,.js,.css,.py';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        chosenLocalPath = file.path;
        document.getElementById('vcLocalPath').value = file.path;
      };
      input.click();
    });

    // 加载工作流资源列表
    let _wfResources = [];
    let _wfPageUrl = '';
    const showResourceUrl = (idx) => {
      const urlDiv = document.getElementById('vcResourceUrl');
      const urlInput = document.getElementById('vcResourceUrlInput');
      if (idx !== '' && idx >= 0 && idx < _wfResources.length) {
        const r = _wfResources[idx];
        // 优先显示页面链接(pageUrl)，其次显示工作流页面URL，最后显示资源链接
        const url = r.pageUrl || _wfPageUrl || r.url || '';
        if (url) {
          urlInput.value = url;
          urlDiv.style.display = 'block';
        } else {
          urlDiv.style.display = 'none';
        }
      } else {
        urlDiv.style.display = 'none';
      }
    };

    const loadResources = async (wfId) => {
      const cardSelect = document.getElementById('vcCardSelect');
      const hint = document.getElementById('vcCardHint');
      const urlDiv = document.getElementById('vcResourceUrl');
      if (!wfId) {
        cardSelect.innerHTML = '<option value="">-- 请先选择工作流 --</option>';
        hint.textContent = '';
        urlDiv.style.display = 'none';
        _wfResources = [];
        return;
      }
      if (!window.electronAPI?.getWorkflowDetail) return;
      const result = await window.electronAPI.getWorkflowDetail(wfId);
      if (!result.success || !result.data || !result.data.resources) {
        cardSelect.innerHTML = '<option value="">加载失败</option>';
        hint.textContent = '';
        urlDiv.style.display = 'none';
        _wfResources = [];
        return;
      }
      _wfResources = result.data.resources;
      _wfPageUrl = result.data.url || '';  // 保存工作流页面URL
      cardSelect.innerHTML = '<option value="">-- 请选择资源 --</option>' +
        _wfResources.map((r, i) => {
          const typeMatch = r.type === expectedType;
          const icon = { image: '️', video: '🎬', audio: '🎵', link: '🔗', text: '📝' }[r.type] || '📄';
          const label = (r.name || r.text || '资源' + (i + 1)).substring(0, 50);
          return '<option value="' + i + '"' + (dl.cardIndex === i ? ' selected' : '') + '>' +
            icon + (typeMatch ? '✓' : '⚠') + ' ' + this.esc(label) + '</option>';
        }).join('');
      hint.textContent = '✓=类型匹配  ⚠=类型不匹配（' + expectedType + '）';
      // 如果已有选中项，显示其URL
      if (dl.cardIndex !== undefined && dl.cardIndex !== null) {
        showResourceUrl(dl.cardIndex);
      }
    };

    if (dl.workflowId) await loadResources(dl.workflowId);

    document.getElementById('vcWorkflowSelect').addEventListener('change', (e) => {
      loadResources(e.target.value);
    });

    document.getElementById('vcCardSelect').addEventListener('change', (e) => {
      showResourceUrl(e.target.value === '' ? '' : parseInt(e.target.value));
    });

    const close = () => overlay.remove();
    overlay.querySelector('.wsw-link-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // 保存
    overlay.querySelector('.save-btn').addEventListener('click', () => {
      const name = document.getElementById('vcName').value.trim();
      if (name) card.name = name;

      // 本地源
      if (chosenLocalPath) {
        const fileName = chosenLocalPath.split(/[\\/]/).pop() || '本地文件';
        const ext = (fileName.split('.').pop() || '').toLowerCase();
        card.localSource = {
          path: chosenLocalPath,
          name: fileName,
          format: ext,
          downloadedAt: card.localSource?.downloadedAt || Date.now()
        };
      }

      // 网络源
      const onlineUrl = document.getElementById('vcOnlineUrl').value.trim();
      if (onlineUrl) {
        let streamType = 'http';
        if (onlineUrl.indexOf('.m3u8') > -1) streamType = 'm3u8';
        else if (onlineUrl.startsWith('blob:')) streamType = 'blob';
        card.onlineSource = {
          url: onlineUrl,
          name: onlineUrl.split('/').pop() || onlineUrl,
          streamType: streamType,
          cachedAt: Date.now()
        };
      }

      // 工作流下载源
      const wfId = document.getElementById('vcWorkflowSelect').value;
      const cardIdx = document.getElementById('vcCardSelect').value;
      const autoDownload = document.getElementById('vcAutoDownload').checked;
      if (wfId && cardIdx !== '') {
        const wf = workflows.find(w => w.id === wfId);
        card.workflowDownload = {
          workflowId: wfId,
          workflowTitle: wf?.title || '',
          cardIndex: parseInt(cardIdx),
          resourceType: expectedType,
          autoDownload: autoDownload,
          lastDownloadAt: card.workflowDownload?.lastDownloadAt || null,
          downloadPath: card.workflowDownload?.downloadPath || null,
          downloadStatus: card.workflowDownload?.downloadStatus || 'idle'
        };
        card.workflowLink = {
          workflowId: wfId,
          cardIndex: parseInt(cardIdx),
          resourceType: expectedType,
          autoRefresh: autoDownload
        };
      }

      // 播放模式
      card.playMode = selectedMode;

      // TTL
      const ttlStr = document.getElementById('vcTTL').value.trim();
      if (ttlStr === '') card.timestamp.ttl = null;
      else { const ttl = parseInt(ttlStr); card.timestamp.ttl = isNaN(ttl) ? null : ttl; }

      card.timestamp.lastUpdated = Date.now();
      this.renderCanvas();
      close();
      App.showToast('配置已保存');
    });

    // 立即下载
    overlay.querySelector('.download-btn').addEventListener('click', async () => {
      const wfId = document.getElementById('vcWorkflowSelect').value;
      const cardIdx = document.getElementById('vcCardSelect').value;
      if (!wfId || cardIdx === '') {
        App.showToast('请先选择工作流和资源');
        return;
      }
      // 先保存配置
      const wf = workflows.find(w => w.id === wfId);
      card.workflowDownload = {
        workflowId: wfId,
        workflowTitle: wf?.title || '',
        cardIndex: parseInt(cardIdx),
        resourceType: expectedType,
        autoDownload: document.getElementById('vcAutoDownload').checked,
        lastDownloadAt: null,
        downloadPath: null,
        downloadStatus: 'idle'
      };
      card.workflowLink = {
        workflowId: wfId,
        cardIndex: parseInt(cardIdx),
        resourceType: expectedType,
        autoRefresh: true
      };
      close();
      await this.downloadNow(card.id);
    });
  },

  // ===== 音频容器配置面板（仅音频文件） =====
  async showAudioConfigPanel(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || card.type !== 'audioContainer') return;

    let workflows = [];
    if (window.electronAPI?.getWorkflows) {
      const result = await window.electronAPI.getWorkflows();
      if (result.success) workflows = result.data || [];
    }

    const overlay = document.createElement('div');
    overlay.className = 'wsw-link-overlay';
    const local = card.localSource || {};
    const online = card.onlineSource || {};
    const dl = card.workflowDownload || {};
    const playMode = card.playMode || 'none';

    overlay.innerHTML = '<div class="wsw-link-panel" style="width:520px">' +
      '<div class="wsw-link-header"><span>🎵 音频容器配置（仅音频文件）</span><button class="wsw-link-close">✕</button></div>' +
      '<div class="wsw-link-body">' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">容器名称</label>' +
          '<input type="text" id="acName" value="' + this.esc(card.name) + '" class="wsw-link-input">' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">当前播放模式</label>' +
          '<div class="wsw-source-tabs">' +
            '<button class="wsw-source-tab' + (playMode === 'local' ? ' active' : '') + '" data-mode="local">💾 本地音频</button>' +
            '<button class="wsw-source-tab' + (playMode === 'online' ? ' active' : '') + '" data-mode="online">🌐 网络音频</button>' +
            '<button class="wsw-source-tab' + (playMode === 'none' ? ' active' : '') + '" data-mode="none">⏸ 未设置</button>' +
          '</div>' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">💾 本地音频文件</label>' +
          '<div class="wsw-local-file-row">' +
            '<input type="text" id="acLocalPath" value="' + this.esc(local.path || '') + '" placeholder="点击选择本地音频文件" class="wsw-link-input" readonly>' +
            '<button class="wsw-link-btn" id="acChooseLocal">📁 选择</button>' +
          '</div>' +
          (local.name ? '<div class="wsw-link-hint">当前: ' + this.esc(local.name) + '</div>' : '') +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">🌐 网络音频URL</label>' +
          '<input type="text" id="acOnlineUrl" value="' + this.esc(online.url || '') + '" placeholder="https://example.com/audio.mp3" class="wsw-link-input" style="font-size:12px">' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">🔗 工作流下载源（定时从工作流下载音频）</label>' +
          '<select id="acWorkflowSelect" class="wsw-link-select">' +
            '<option value="">-- 不配置 --</option>' +
            workflows.map(wf => '<option value="' + wf.id + '"' + (dl.workflowId === wf.id ? ' selected' : '') + '>' +
              this.esc((wf.title || '未命名') + ' (' + (wf.resources?.length || 0) + '个资源)') + '</option>'
            ).join('') +
          '</select>' +
          '<select id="acCardSelect" class="wsw-link-select" style="margin-top:6px">' +
            '<option value="">-- 请先选择工作流 --</option>' +
          '</select>' +
          '<div id="acResourceUrl" style="margin-top:6px;display:none">' +
            '<label class="wsw-link-label"> 资源链接</label>' +
            '<input type="text" id="acResourceUrlInput" class="wsw-link-input" readonly style="font-size:11px;color:var(--primary);cursor:pointer" onclick="navigator.clipboard?.writeText(this.value);App.showToast(\'已复制链接\')">' +
          '</div>' +
          '<label class="wsw-link-checkbox-label">' +
            '<input type="checkbox" id="acAutoDownload" ' + (dl.autoDownload ? 'checked' : '') + '>' +
            '<span>自动下载（TTL到期时自动下载）</span>' +
          '</label>' +
          '<label class="wsw-link-label" style="margin-top:8px">TTL 过期时间（毫秒，留空=全局默认）</label>' +
          '<input type="text" id="acTTL" value="' + (card.timestamp?.ttl !== null && card.timestamp?.ttl !== undefined ? card.timestamp.ttl : '') + '" placeholder="如 3600000=1小时" class="wsw-link-input">' +
        '</div>' +
      '</div>' +
      '<div class="wsw-link-footer">' +
        '<button class="wsw-link-btn download-btn">⬇ 立即下载</button>' +
        '<button class="wsw-link-btn cancel-btn">取消</button>' +
        '<button class="wsw-link-btn save-btn primary">保存</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);

    let selectedMode = playMode;
    let chosenLocalPath = local.path || '';

    overlay.querySelectorAll('.wsw-source-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        selectedMode = tab.dataset.mode;
        overlay.querySelectorAll('.wsw-source-tab').forEach(t => t.classList.toggle('active', t === tab));
      });
    });

    document.getElementById('acChooseLocal').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        chosenLocalPath = file.path;
        document.getElementById('acLocalPath').value = file.path;
      };
      input.click();
    });

    let _acResources = [];
    const showAcResourceUrl = (idx) => {
      const urlDiv = document.getElementById('acResourceUrl');
      const urlInput = document.getElementById('acResourceUrlInput');
      if (idx !== '' && idx >= 0 && idx < _acResources.length) {
        const r = _acResources[idx];
        // 优先显示页面链接，其次显示资源链接
        const url = r.pageUrl || r.url || '';
        if (url) { urlInput.value = url; urlDiv.style.display = 'block'; }
        else { urlDiv.style.display = 'none'; }
      } else { urlDiv.style.display = 'none'; }
    };

    const loadResources = async (wfId) => {
      const cardSelect = document.getElementById('acCardSelect');
      const urlDiv = document.getElementById('acResourceUrl');
      if (!wfId) {
        cardSelect.innerHTML = '<option value="">-- 请先选择工作流 --</option>';
        urlDiv.style.display = 'none';
        _acResources = [];
        return;
      }
      if (!window.electronAPI?.getWorkflowDetail) return;
      const result = await window.electronAPI.getWorkflowDetail(wfId);
      if (!result.success || !result.data || !result.data.resources) { urlDiv.style.display = 'none'; _acResources = []; return; }
      _acResources = result.data.resources;
      cardSelect.innerHTML = '<option value="">-- 请选择资源 --</option>' +
        _acResources.map((r, i) => {
          const typeMatch = r.type === 'audio';
          const icon = { image: '🖼️', video: '🎬', audio: '🎵', link: '', text: '📝' }[r.type] || '📄';
          const label = (r.name || r.text || '资源' + (i + 1)).substring(0, 50);
          return '<option value="' + i + '"' + (dl.cardIndex === i ? ' selected' : '') + '>' +
            icon + (typeMatch ? '✓' : '⚠') + ' ' + this.esc(label) + '</option>';
        }).join('');
      if (dl.cardIndex !== undefined && dl.cardIndex !== null) showAcResourceUrl(dl.cardIndex);
    };

    if (dl.workflowId) await loadResources(dl.workflowId);
    document.getElementById('acWorkflowSelect').addEventListener('change', (e) => { loadResources(e.target.value); });
    document.getElementById('acCardSelect').addEventListener('change', (e) => { showAcResourceUrl(e.target.value === '' ? '' : parseInt(e.target.value)); });

    const close = () => overlay.remove();
    overlay.querySelector('.wsw-link-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.save-btn').addEventListener('click', () => {
      const name = document.getElementById('acName').value.trim();
      if (name) card.name = name;
      if (chosenLocalPath) {
        const fileName = chosenLocalPath.split(/[\\/]/).pop() || '本地音频';
        card.localSource = { path: chosenLocalPath, name: fileName, format: (fileName.split('.').pop() || '').toLowerCase(), downloadedAt: card.localSource?.downloadedAt || Date.now() };
      }
      const onlineUrl = document.getElementById('acOnlineUrl').value.trim();
      if (onlineUrl) {
        card.onlineSource = { url: onlineUrl, name: onlineUrl.split('/').pop() || onlineUrl, streamType: onlineUrl.indexOf('.m3u8') > -1 ? 'm3u8' : (onlineUrl.startsWith('blob:') ? 'blob' : 'http'), cachedAt: Date.now() };
      }
      const wfId = document.getElementById('acWorkflowSelect').value;
      const cardIdx = document.getElementById('acCardSelect').value;
      if (wfId && cardIdx !== '') {
        const wf = workflows.find(w => w.id === wfId);
        card.workflowDownload = { workflowId: wfId, workflowTitle: wf?.title || '', cardIndex: parseInt(cardIdx), resourceType: 'audio', autoDownload: document.getElementById('acAutoDownload').checked, lastDownloadAt: card.workflowDownload?.lastDownloadAt || null, downloadPath: null, downloadStatus: 'idle' };
        card.workflowLink = { workflowId: wfId, cardIndex: parseInt(cardIdx), resourceType: 'audio', autoRefresh: document.getElementById('acAutoDownload').checked };
      }
      card.playMode = selectedMode;
      const ttlStr = document.getElementById('acTTL').value.trim();
      if (ttlStr === '') card.timestamp.ttl = null;
      else { const ttl = parseInt(ttlStr); card.timestamp.ttl = isNaN(ttl) ? null : ttl; }
      card.timestamp.lastUpdated = Date.now();
      this.renderCanvas();
      close();
      App.showToast('配置已保存');
    });

    overlay.querySelector('.download-btn').addEventListener('click', async () => {
      const wfId = document.getElementById('acWorkflowSelect').value;
      const cardIdx = document.getElementById('acCardSelect').value;
      if (!wfId || cardIdx === '') { App.showToast('请先选择工作流和资源'); return; }
      const wf = workflows.find(w => w.id === wfId);
      card.workflowDownload = { workflowId: wfId, workflowTitle: wf?.title || '', cardIndex: parseInt(cardIdx), resourceType: 'audio', autoDownload: document.getElementById('acAutoDownload').checked, lastDownloadAt: null, downloadPath: null, downloadStatus: 'idle' };
      card.workflowLink = { workflowId: wfId, cardIndex: parseInt(cardIdx), resourceType: 'audio', autoRefresh: true };
      close();
      await this.downloadNow(card.id);
    });
  },

  // ===== 文本容器配置面板（图片/文本/超链接） =====
  async showTextConfigPanel(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || card.type !== 'textContainer') return;

    let workflows = [];
    if (window.electronAPI?.getWorkflows) {
      const result = await window.electronAPI.getWorkflows();
      if (result.success) workflows = result.data || [];
    }

    const overlay = document.createElement('div');
    overlay.className = 'wsw-link-overlay';
    const items = card.items || [];
    const dl = card.workflowDownload || {};
    const imageCount = items.filter(i => i.type === 'image').length;
    const textCount = items.filter(i => i.type === 'text').length;
    const linkCount = items.filter(i => i.type === 'link').length;

    overlay.innerHTML = '<div class="wsw-link-panel" style="width:540px">' +
      '<div class="wsw-link-header"><span>📝 文本容器配置（图片/文本/超链接）</span><button class="wsw-link-close">✕</button></div>' +
      '<div class="wsw-link-body">' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">容器名称</label>' +
          '<input type="text" id="tcName" value="' + this.esc(card.name) + '" class="wsw-link-input">' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">当前内容</label>' +
          '<div class="wsw-chart-stats">' +
            '<span class="wsw-chart-stat"><b>🖼️ 图片:</b> ' + imageCount + '</span>' +
            '<span class="wsw-chart-stat"><b>📝 文本:</b> ' + textCount + '</span>' +
            '<span class="wsw-chart-stat"><b>🔗 超链接:</b> ' + linkCount + '</span>' +
            '<span class="wsw-chart-stat"><b>总计:</b> ' + items.length + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">📁 添加本地文件</label>' +
          '<div class="wsw-link-hint">支持图片（jpg/png/gif等）和文本文件（txt/md/json等）</div>' +
          '<button class="wsw-link-btn" id="tcAddLocal" style="margin-top:6px">📁 选择文件添加</button>' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">🌐 添加网络URL</label>' +
          '<input type="text" id="tcNewUrl" placeholder="https://example.com/image.png 或网页链接" class="wsw-link-input" style="font-size:12px">' +
          '<button class="wsw-link-btn" id="tcAddUrl" style="margin-top:6px">➕ 添加URL</button>' +
          '<div class="wsw-link-hint">图片URL自动识别为图片，其他URL作为超链接</div>' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">🔗 工作流数据源（自动导入图片/文本/超链接）</label>' +
          '<select id="tcWorkflowSelect" class="wsw-link-select">' +
            '<option value="">-- 不配置 --</option>' +
            workflows.map(wf => '<option value="' + wf.id + '"' + (dl.workflowId === wf.id ? ' selected' : '') + '>' +
              this.esc((wf.title || '未命名') + ' (' + (wf.resources?.length || 0) + '个资源)') + '</option>'
            ).join('') +
          '</select>' +
          '<label class="wsw-link-checkbox-label">' +
            '<input type="checkbox" id="tcAutoDownload" ' + (dl.autoDownload ? 'checked' : '') + '>' +
            '<span>自动刷新（TTL到期时自动更新）</span>' +
          '</label>' +
          '<label class="wsw-link-label" style="margin-top:8px">TTL 过期时间（毫秒，留空=全局默认）</label>' +
          '<input type="text" id="tcTTL" value="' + (card.timestamp?.ttl !== null && card.timestamp?.ttl !== undefined ? card.timestamp.ttl : '') + '" placeholder="如 3600000=1小时" class="wsw-link-input">' +
        '</div>' +
      '</div>' +
      '<div class="wsw-link-footer">' +
        '<button class="wsw-link-btn clear-btn">🗑 清空内容</button>' +
        '<button class="wsw-link-btn refresh-btn">🔄 从工作流加载</button>' +
        '<button class="wsw-link-btn cancel-btn">取消</button>' +
        '<button class="wsw-link-btn save-btn primary">保存</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);

    // 添加本地文件
    document.getElementById('tcAddLocal').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,.txt,.md,.json,.csv,.log,.xml,.html,.htm,.js,.css,.py';
      input.multiple = true;
      input.onchange = (e) => {
        const files = Array.from(e.target.files);
        if (!card.items) card.items = [];
        let processed = 0;
        files.forEach(file => {
          const ext = (file.name.split('.').pop() || '').toLowerCase();
          const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff'].includes(ext);
          if (isImage) {
            card.items.push({ type: 'image', url: 'file://' + file.path.replace(/\\/g, '/'), localPath: file.path, name: file.name, size: file.size });
            processed++;
            if (processed === files.length) { this.renderCanvas(); App.showToast('已添加 ' + files.length + ' 个文件'); }
          } else {
            const reader = new FileReader();
            reader.onload = (ev) => {
              card.items.push({ type: 'text', content: ev.target.result, name: file.name, localPath: file.path, format: ext, size: file.size });
              processed++;
              if (processed === files.length) { this.renderCanvas(); App.showToast('已添加 ' + files.length + ' 个文件'); }
            };
            reader.readAsText(file);
          }
        });
      };
      input.click();
    });

    // 添加URL
    document.getElementById('tcAddUrl').addEventListener('click', () => {
      const url = document.getElementById('tcNewUrl').value.trim();
      if (!url) { App.showToast('请输入URL'); return; }
      if (!card.items) card.items = [];
      const ext = (url.match(/\.([a-z0-9]+)(\?|$|#)/i) || [])[1] || '';
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff'].includes(ext.toLowerCase());
      card.items.push({ type: isImage ? 'image' : 'link', url: url, name: url.split('/').pop().split('?')[0] || url });
      document.getElementById('tcNewUrl').value = '';
      this.renderCanvas();
      App.showToast('已添加' + (isImage ? '图片' : '超链接'));
    });

    const close = () => overlay.remove();
    overlay.querySelector('.wsw-link-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // 清空内容
    overlay.querySelector('.clear-btn').addEventListener('click', () => {
      if (!confirm('确定清空所有内容？')) return;
      card.items = [];
      this.renderCanvas();
      App.showToast('已清空');
    });

    // 保存
    overlay.querySelector('.save-btn').addEventListener('click', () => {
      const name = document.getElementById('tcName').value.trim();
      if (name) card.name = name;
      const wfId = document.getElementById('tcWorkflowSelect').value;
      const autoDownload = document.getElementById('tcAutoDownload').checked;
      if (wfId) {
        const wf = workflows.find(w => w.id === wfId);
        card.workflowDownload = { workflowId: wfId, workflowTitle: wf?.title || '', autoDownload, lastDownloadAt: card.workflowDownload?.lastDownloadAt || null, downloadStatus: 'idle' };
        card.workflowLink = { workflowId: wfId, cardIndex: 0, resourceType: 'all', autoRefresh: autoDownload };
      } else {
        card.workflowDownload = null;
        card.workflowLink = null;
      }
      const ttlStr = document.getElementById('tcTTL').value.trim();
      if (ttlStr === '') card.timestamp.ttl = null;
      else { const ttl = parseInt(ttlStr); card.timestamp.ttl = isNaN(ttl) ? null : ttl; }
      card.timestamp.lastUpdated = Date.now();
      this.renderCanvas();
      close();
      App.showToast('配置已保存');
    });

    // 从工作流加载
    overlay.querySelector('.refresh-btn').addEventListener('click', async () => {
      const wfId = document.getElementById('tcWorkflowSelect').value;
      if (!wfId) { App.showToast('请先选择工作流'); return; }
      const wf = workflows.find(w => w.id === wfId);
      card.workflowDownload = { workflowId: wfId, workflowTitle: wf?.title || '', autoDownload: document.getElementById('tcAutoDownload').checked, lastDownloadAt: null, downloadStatus: 'idle' };
      card.workflowLink = { workflowId: wfId, cardIndex: 0, resourceType: 'all', autoRefresh: true };
      close();
      await this.refreshTextWorkflow(card.id);
    });
  },

  // 刷新文本容器的工作流资源
  async refreshTextWorkflow(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || !card.workflowDownload) { App.showToast('未配置工作流数据源'); return; }
    const dl = card.workflowDownload;
    App.showToast('正在加载工作流资源...');
    try {
      if (!window.electronAPI?.getWorkflowDetail) return;
      const result = await window.electronAPI.getWorkflowDetail(dl.workflowId);
      if (!result.success || !result.data || !result.data.resources) {
        App.showToast('获取工作流数据失败');
        return;
      }
      const resources = result.data.resources || [];
      // 只导入图片、文本、超链接资源
      const validTypes = ['image', 'text', 'link'];
      const newItems = [];
      resources.forEach(r => {
        if (r.type === 'image') {
          newItems.push({ type: 'image', url: r.url, name: r.name || '图片' });
        } else if (r.type === 'text') {
          newItems.push({ type: 'text', content: r.content || r.text || '', name: r.name || '文本', url: r.url });
        } else if (r.type === 'link') {
          newItems.push({ type: 'link', url: r.url, name: r.name || r.url || '链接' });
        }
      });
      card.items = newItems;
      card.playMode = newItems.length > 0 ? 'online' : 'none';
      // 将文本资源拼接为 textContent，供统计图卡片（词云/词频）使用
      const textParts = [];
      newItems.forEach(it => {
        if (it.type === 'text' && it.content) textParts.push(it.content);
        else if (it.name) textParts.push(it.name);
      });
      card.textContent = textParts.join('\n');
      card.timestamp.lastUpdated = Date.now();
      dl.lastDownloadAt = Date.now();
      dl.downloadStatus = 'done';
      dl.resourceCount = newItems.length;
      this.renderCanvas();
      App.showToast('已加载 ' + newItems.length + ' 个资源');
    } catch (e) {
      App.showToast('加载失败: ' + e.message);
    }
  },

  // ===== 立即从工作流下载资源到本地 =====
  async downloadNow(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || !card.workflowDownload) {
      App.showToast('未配置工作流下载源');
      return;
    }
    const dl = card.workflowDownload;
    if (!dl.workflowId || dl.cardIndex === undefined || dl.cardIndex === null) {
      App.showToast('请先配置工作流和资源');
      return;
    }

    // 设置下载中状态
    dl.downloadStatus = 'downloading';
    this.renderCanvas();
    App.showToast('开始下载...');

    try {
      // 从工作流获取资源URL
      if (!window.electronAPI?.getWorkflowDetail) {
        App.showToast('无法获取工作流详情');
        dl.downloadStatus = 'failed';
        this.renderCanvas();
        return;
      }
      const result = await window.electronAPI.getWorkflowDetail(dl.workflowId);
      if (!result.success || !result.data || !result.data.resources) {
        App.showToast('获取工作流数据失败');
        dl.downloadStatus = 'failed';
        this.renderCanvas();
        return;
      }
      const resource = result.data.resources[dl.cardIndex];
      if (!resource || !resource.url) {
        App.showToast('资源不存在或无URL');
        dl.downloadStatus = 'failed';
        this.renderCanvas();
        return;
      }

      // 选择保存路径
      const safeName = (resource.name || resource.text || 'download').replace(/[\\/:*?"<>|]/g, '_').substring(0, 80);
      let ext = resource.format || '';
      if (!ext && resource.url) {
        try {
          const u = new URL(resource.url);
          ext = (u.pathname.split('.').pop() || '').split('?')[0];
        } catch {}
      }
      const expectedType = card.type === 'videoContainer' ? 'video' : card.type === 'audioContainer' ? 'audio' : 'text';
      if (!ext) {
        ext = expectedType === 'video' ? 'mp4' : expectedType === 'audio' ? 'mp3' : 'txt';
      }
      const fileName = safeName + '.' + ext;

      // 获取下载路径
      let saveDir;
      if (window.electronAPI?.getDownloadsPath) {
        const result = await window.electronAPI.getDownloadsPath();
        saveDir = result.success ? result.data : null;
      }
      if (!saveDir) saveDir = require('path')?.join?.(require('os')?.homedir?.() || '.', 'Downloads') || 'C:\\Downloads';
      const savePath = saveDir + (process.platform === 'win32' ? '\\' : '/') + fileName;
      dl.downloadPath = savePath;

      // 根据资源类型选择下载方式
      const url = resource.url;
      const referer = result.data.url || '';
      const fileId = 'wsw_' + card.id;

      let downloadResult;
      if (expectedType === 'video' && window.electronAPI?.downloadVideoSmart) {
        downloadResult = await window.electronAPI.downloadVideoSmart(url, savePath, referer, fileId);
      } else if (window.electronAPI?.downloadFile) {
        downloadResult = await window.electronAPI.downloadFile(url, savePath, referer, fileId);
      } else {
        App.showToast('下载功能不可用');
        dl.downloadStatus = 'failed';
        this.renderCanvas();
        return;
      }

      if (downloadResult && downloadResult.success) {
        // 下载成功，更新本地源
        card.localSource = {
          path: savePath,
          name: fileName,
          format: ext,
          size: downloadResult.size || 0,
          downloadedAt: Date.now()
        };
        // 自动切换到本地播放模式
        card.playMode = 'local';
        card.timestamp.lastUpdated = Date.now();
        dl.lastDownloadAt = Date.now();
        dl.downloadStatus = 'done';
        this.renderCanvas();
        App.showToast('下载完成: ' + fileName);
      } else {
        dl.downloadStatus = 'failed';
        this.renderCanvas();
        App.showToast('下载失败: ' + (downloadResult?.error || '未知错误'));
      }
    } catch (e) {
      console.error('downloadNow error:', e);
      dl.downloadStatus = 'failed';
      this.renderCanvas();
      App.showToast('下载失败: ' + e.message);
    }
  },

  // ===== 画布控制 =====
  setZoom(zoom) {
    this.state.zoom = Math.max(0.3, Math.min(3, zoom));
    document.getElementById('wswZoomDisplay').textContent = Math.round(this.state.zoom * 100) + '%';
    this.applyTransform();
  },

  applyTransform() {
    const inner = document.getElementById('wswCanvasInner');
    if (inner) {
      inner.style.transform = 'translate(' + this.state.panX + 'px,' + this.state.panY + 'px) scale(' + this.state.zoom + ')';
    }
  },

  zoomIn() { this.setZoom(this.state.zoom + 0.1); },
  zoomOut() { this.setZoom(this.state.zoom - 0.1); },

  fitView() {
    if (!this.state.doc || this.state.doc.cards.length === 0) {
      this.setZoom(1);
      this.state.panX = 0;
      this.state.panY = 0;
      this.applyTransform();
      return;
    }
    // 计算所有卡片的边界
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.state.doc.cards.forEach(c => {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.w);
      maxY = Math.max(maxY, c.y + c.h);
    });
    const wrap = document.getElementById('wswCanvasWrap');
    const ww = wrap ? wrap.clientWidth : 800;
    const wh = wrap ? wrap.clientHeight : 600;
    const cw = maxX - minX + 80;
    const ch = maxY - minY + 80;
    const zoomX = ww / cw;
    const zoomY = wh / ch;
    this.state.zoom = Math.min(1, zoomX, zoomY);
    this.state.panX = (ww - (maxX - minX) * this.state.zoom) / 2 - minX * this.state.zoom;
    this.state.panY = (wh - (maxY - minY) * this.state.zoom) / 2 - minY * this.state.zoom;
    document.getElementById('wswZoomDisplay').textContent = Math.round(this.state.zoom * 100) + '%';
    this.applyTransform();
  },

  // ===== 卡片选择 =====
  selectCard(cardId, ctrlKey) {
    if (ctrlKey) {
      if (this.state.selectedCards.has(cardId)) {
        this.state.selectedCards.delete(cardId);
      } else {
        this.state.selectedCards.add(cardId);
      }
    } else {
      this.state.selectedCards.clear();
      this.state.selectedCards.add(cardId);
    }
    // 提升 z-index
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (card) {
      card.z = ++this.state.maxZ;
    }
    this.updateCardSelection();
  },

  deselectAll() {
    this.state.selectedCards.clear();
    this.updateCardSelection();
  },

  updateCardSelection() {
    document.querySelectorAll('.wsw-card').forEach(el => {
      const id = parseInt(el.dataset.cardId);
      el.classList.toggle('selected', this.state.selectedCards.has(id));
    });
  },

  deleteSelected() {
    if (this.state.selectedCards.size === 0) return;
    this.saveUndo();
    const ids = Array.from(this.state.selectedCards);
    this.state.doc.cards = this.state.doc.cards.filter(c => !ids.includes(c.id));
    this.state.selectedCards.clear();
    if (this.state.doc.cards.length === 0) {
      document.getElementById('wswEmpty').style.display = 'flex';
    }
    this.renderCanvas();
    App.showToast('已删除 ' + ids.length + ' 个元素');
  },

  duplicateSelected() {
    if (this.state.selectedCards.size === 0) return;
    this.saveUndo();
    const newIds = [];
    this.state.selectedCards.forEach(id => {
      const card = this.state.doc.cards.find(c => c.id === id);
      if (card) {
        const copy = JSON.parse(JSON.stringify(card));
        copy.id = Date.now() + Math.random();
        copy.x += 20;
        copy.y += 20;
        copy.z = ++this.state.maxZ;
        this.state.doc.cards.push(copy);
        newIds.push(copy.id);
      }
    });
    this.state.selectedCards.clear();
    newIds.forEach(id => this.state.selectedCards.add(id));
    this.renderCanvas();
    App.showToast('已复制 ' + newIds.length + ' 个元素');
  },

  // ===== 文字框编辑 =====
  enterTextEdit(cardId) {
    // 先提交之前的编辑
    if (this.state.editingCardId !== null) {
      this.commitEdit();
    }
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || card.type !== 'textbox') return;

    this.state.editingCardId = cardId;
    card.mdView = false;

    // 重新渲染该卡片
    const oldEl = document.querySelector('[data-card-id="' + cardId + '"]');
    if (!oldEl) return;

    const newEl = this.createCardElement(card);
    oldEl.replaceWith(newEl);

    // 进入编辑模式
    newEl.classList.add('editing');
    const body = newEl.querySelector('.wsw-card-body');
    if (body) {
      body.contentEditable = 'true';
      body.focus();
      // 光标移到末尾
      const range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      // blur 时提交
      body.addEventListener('blur', () => {
        setTimeout(() => {
          if (this.state.editingCardId === cardId) {
            this.commitEdit();
          }
        }, 150);
      });

      // 阻止 mousedown 冒泡（防止触发拖拽）
      body.addEventListener('mousedown', e => e.stopPropagation());
    }
  },

  commitEdit() {
    if (this.state.editingCardId === null) return;
    const card = this.state.doc.cards.find(c => c.id === this.state.editingCardId);
    if (!card) { this.state.editingCardId = null; return; }

    const el = document.querySelector('[data-card-id="' + this.state.editingCardId + '"]');
    if (el) {
      el.classList.remove('editing');
      const body = el.querySelector('.wsw-card-body');
      if (body) {
        body.contentEditable = 'false';
        card.content = body.innerText.replace(/\n$/, '');
      }
    }

    card.mdView = true;
    this.state.editingCardId = null;

    // 重新渲染该卡片为预览模式
    if (el) {
      const newEl = this.createCardElement(card);
      if (this.state.selectedCards.has(card.id)) {
        newEl.classList.add('selected');
      }
      el.replaceWith(newEl);
    }
  },

  // ===== Markdown 渲染 =====
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  },

  esc(s) { return this.escapeHtml(s); },

  renderMarkdown(src) {
    if (!src) return '';
    // 提取代码块
    const codeBlocks = [];
    src = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      const id = '\u0000CB' + codeBlocks.length + '\u0000';
      codeBlocks.push({ id, lang: lang || '', code: code.replace(/\n$/, '') });
      return id;
    });

    src = this.esc(src);

    // 标题
    src = src.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    src = src.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    src = src.replace(/^# (.+)$/gm, '<h3>$1</h3>');

    // 分隔线
    src = src.replace(/^---+$/gm, '<hr>');

    // 引用（esc 后 > 变为 &gt;）
    src = src.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // 粗体
    src = src.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 斜体
    src = src.replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

    // 行内代码
    src = src.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 链接
    src = src.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // 无序列表
    src = src.replace(/^- (.+)$/gm, '<li>$1</li>');
    src = src.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>');

    // 有序列表
    src = src.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // 段落（将连续非标签行包裹）
    src = src.split(/\n\n+/).map(block => {
      block = block.trim();
      if (!block) return '';
      if (block.startsWith('<')) return block;
      return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');

    // 还原代码块
    codeBlocks.forEach(cb => {
      const highlighted = this.syntaxHighlight(cb.code, cb.lang);
      const langLabel = cb.lang ? '<span class="code-lang">' + this.esc(cb.lang) + '</span>' : '';
      const html = '<pre>' + langLabel + '<code class="hljs">' + highlighted + '</code></pre>';
      src = src.replace(cb.id, html);
    });

    return src;
  },

  syntaxHighlight(code, lang) {
    let e = this.esc(code);
    const placeholders = [];
    const protect = (html) => {
      const id = '\u0000PH' + placeholders.length + '\u0000';
      placeholders.push({ id, html });
      return id;
    };

    if (['bash', 'sh', 'shell'].includes(lang)) {
      e = e.replace(/(#[^\n]*)/g, m => protect('<span class="hljs-comment">' + m + '</span>'));
      e = e.replace(/("[^"\n]*"|'[^'\n]*')/g, m => protect('<span class="hljs-string">' + m + '</span>'));
      e = e.replace(/(\$[A-Za-z_][A-Za-z0-9_]*)/g, m => protect('<span class="hljs-variable">' + m + '</span>'));
      e = e.replace(/\b(npm|node|git|cd|ls|mkdir|rm|cp|mv|echo|export|source|sudo|apt|yum|brew|pip|python|java|gcc|make|curl|wget|chmod|chown|cat|grep|sed|awk|tar|zip|unzip)\b/g, m => protect('<span class="hljs-keyword">' + m + '</span>'));
    } else if (['javascript', 'js'].includes(lang)) {
      e = e.replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, m => protect('<span class="hljs-comment">' + m + '</span>'));
      e = e.replace(/("[^"\n]*"|'[^'\n]*'|`[^`]*`)/g, m => protect('<span class="hljs-string">' + m + '</span>'));
      e = e.replace(/\b(const|let|var|function|return|if|else|for|while|class|extends|new|this|import|export|from|async|await|try|catch|finally|throw|typeof|instanceof)\b/g, m => protect('<span class="hljs-keyword">' + m + '</span>'));
      e = e.replace(/\b(console|document|window|Math|JSON|Object|Array|String|Number|Boolean|Promise|Date|RegExp)\b/g, m => protect('<span class="hljs-built_in">' + m + '</span>'));
      e = e.replace(/\b(\d+\.?\d*)\b/g, m => protect('<span class="hljs-number">' + m + '</span>'));
    } else if (['python', 'py'].includes(lang)) {
      e = e.replace(/(#[^\n]*)/g, m => protect('<span class="hljs-comment">' + m + '</span>'));
      e = e.replace(/("[^"\n]*"|'[^'\n]*')/g, m => protect('<span class="hljs-string">' + m + '</span>'));
      e = e.replace(/\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|with|lambda|yield|global|nonlocal|pass|break|continue|raise|assert|in|not|and|or|is|None|True|False)\b/g, m => protect('<span class="hljs-keyword">' + m + '</span>'));
      e = e.replace(/\b(print|len|range|input|open|str|int|float|list|dict|set|tuple|type|isinstance|enumerate|zip|map|filter|sorted|reversed)\b/g, m => protect('<span class="hljs-built_in">' + m + '</span>'));
      e = e.replace(/\b(\d+\.?\d*)\b/g, m => protect('<span class="hljs-number">' + m + '</span>'));
    } else if (lang) {
      // 通用高亮
      e = e.replace(/(#[^\n]*|\/\/[^\n]*)/g, m => protect('<span class="hljs-comment">' + m + '</span>'));
      e = e.replace(/("[^"\n]*"|'[^'\n]*')/g, m => protect('<span class="hljs-string">' + m + '</span>'));
    }

    placeholders.forEach(p => { e = e.replace(p.id, p.html); });
    return e;
  },

  // ===== 表格操作 =====
  tableOp(card, action) {
    if (!card || !card.tableData) return;
    this.saveUndo();
    if (action === 'addRow') {
      const cols = card.tableData[0].length;
      card.tableData.push(new Array(cols).fill(''));
    } else if (action === 'addCol') {
      card.tableData.forEach(row => row.push(''));
    } else if (action === 'delRow') {
      if (card.tableData.length > 1) card.tableData.pop();
    } else if (action === 'delCol') {
      if (card.tableData[0].length > 1) card.tableData.forEach(row => row.pop());
    }
    this.renderCanvas();
  },

  // ===== 渲染 =====
  renderCanvas() {
    if (!this.state.doc) return;
    const canvas = document.getElementById('wswCanvas');
    if (!canvas) return;

    // 应用背景（使用 backgroundColor 保留网格背景图）
    const bg = this.state.doc.background;
    if (bg && bg.type === 'color' && bg.value) {
      canvas.style.backgroundColor = bg.value;
    } else if (bg && bg.type === 'gradient' && bg.value) {
      canvas.style.background = bg.value;
    } else if (bg && bg.type === 'image' && bg.value) {
      canvas.style.background = 'url(' + bg.value + ') center/cover no-repeat';
    }

    canvas.classList.toggle('no-grid', !this.state.showGrid);

    // 空文档处理
    if (this.state.doc.cards.length === 0) {
      // 清空画布内容但保留网格背景
      const inner = document.getElementById('wswCanvasInner');
      if (inner) inner.innerHTML = '';
      // 不显示 wswEmpty（新建文档时不应显示提示）
      return;
    }

    document.getElementById('wswEmpty').style.display = 'none';

    // 构建 canvasInner 结构
    let inner = document.getElementById('wswCanvasInner');
    if (!inner) {
      inner = document.createElement('div');
      inner.id = 'wswCanvasInner';
      inner.className = 'wsw-canvas-inner';
      canvas.appendChild(inner);
    }

    inner.innerHTML = '';
    this.state.doc.cards.forEach(card => {
      const el = this.createCardElement(card);
      if (el) inner.appendChild(el);
    });

    // 如果有暂存的工作流链接，高亮所有容器
    if (App.state.pendingWswLink) {
      inner.querySelectorAll('.wsw-container').forEach(c => c.classList.add('pending-link'));
    }

    this.applyBackground();
    this.applyTransform();

    // 渲染Excel容器中的图表（canvas需要在DOM中后才能绘制）
    setTimeout(() => this._renderCharts(), 0);
  },

  createCardElement(card) {
    const el = document.createElement('div');
    el.className = this.getCardClassName(card);
    if (this.state.selectedCards.has(card.id)) el.classList.add('selected');
    el.dataset.cardId = card.id;
    el.style.left = card.x + 'px';
    el.style.top = card.y + 'px';
    el.style.width = card.w + 'px';
    el.style.height = card.h + 'px';
    el.style.zIndex = card.z || 1;

    if (card.type === 'textbox') {
      el.innerHTML = this.renderTextBox(card);
    } else if (card.type === 'table') {
      el.innerHTML = this.renderTable(card);
    } else if (card.type === 'shape') {
      el.innerHTML = this.renderShape(card);
    } else if (card.type === 'videoContainer') {
      el.innerHTML = this.renderVideoContainer(card);
    } else if (card.type === 'audioContainer') {
      el.innerHTML = this.renderAudioContainer(card);
    } else if (card.type === 'textContainer') {
      el.innerHTML = this.renderTextContainer(card);
    } else if (card.type === 'excelContainer') {
      el.innerHTML = this.renderExcelContainer(card);
    } else if (card.type === 'chartCard') {
      el.innerHTML = this.renderChartCard(card);
    } else if (card.type === 'htmlBlock') {
      el.innerHTML = this.renderHtmlBlock(card);
    } else if (card.type === 'aiworkflow') {
      el.innerHTML = this.renderAiworkflowContainer(card);
    } else {
      el.innerHTML = '<div class="wsw-card-header"><span>' + this.esc(card.name || '') + '</span></div><div class="wsw-card-body">' + this.esc(card.content || '') + '</div><div class="wsw-resize"></div>';
    }

    this.bindCardEvents(el, card);
    return el;
  },

  // 删除卡片
  deleteCard(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card) return;
    this.saveUndo();
    this.state.doc.cards = this.state.doc.cards.filter(c => c.id !== cardId);
    this.state.selectedCards.delete(cardId);
    if (this.state.doc.cards.length === 0) {
      document.getElementById('wswEmpty').style.display = 'flex';
    }
    this.renderCanvas();
    App.showToast('已删除: ' + (card.name || card.type));
  },

  // 卡片头部删除按钮HTML
  cardDeleteBtn(cardId) {
    return '<button class="wsw-md-btn wsw-del-btn" data-action="deleteCard" data-id="' + cardId + '" title="删除">✕</button>';
  },

  getCardClassName(card) {
    if (card.type === 'textbox') return 'wsw-card wsw-text-box';
    if (card.type === 'table') return 'wsw-card wsw-table-card';
    if (card.type === 'shape') return 'wsw-card wsw-shape-card';
    if (card.type === 'videoContainer') return 'wsw-card wsw-container wsw-video-container';
    if (card.type === 'audioContainer') return 'wsw-card wsw-container wsw-audio-container';
    if (card.type === 'textContainer') return 'wsw-card wsw-container wsw-text-container';
    if (card.type === 'excelContainer') return 'wsw-card wsw-container wsw-excel-container';
    if (card.type === 'chartCard') return 'wsw-card wsw-container wsw-chart-card';
    if (card.type === 'aiworkflow') return 'wsw-card wsw-container wsw-aiworkflow-container';
    return 'wsw-card';
  },

  renderTextBox(card) {
    const isPreview = card.mdView !== false;
    const bodyClass = isPreview ? 'wsw-card-body markdown-view' : 'wsw-card-body';
    const bodyContent = isPreview ? this.renderMarkdown(card.content || '') : (card.content ? this.esc(card.content) : '');
    const editBtnActive = !isPreview ? ' active' : '';
    const previewBtnActive = isPreview ? ' active' : '';
    return '<div class="wsw-card-header" data-action="drag">' +
      '<span>📝</span>' +
      '<span class="wsw-card-title">' + this.esc(card.name || '文字框') + '</span>' +
      '<div class="wsw-md-toolbar">' +
        '<button class="wsw-md-btn' + editBtnActive + '" data-action="edit" data-id="' + card.id + '">✏️</button>' +
        '<button class="wsw-md-btn' + previewBtnActive + '" data-action="preview" data-id="' + card.id + '">👁</button>' +
        this.cardDeleteBtn(card.id) +
      '</div></div>' +
      '<div class="' + bodyClass + '" data-placeholder="双击或点击✏️编辑 Markdown...">' + bodyContent + '</div>' +
      '<div class="wsw-resize" data-action="resize"></div>';
  },

  renderTable(card) {
    let rows = card.tableData;
    if (!rows || rows.length === 0) rows = [['列1', '列2', '列3'], ['', '', '']];
    card.tableData = rows;
    let html = '<div class="wsw-card-header" data-action="drag"><span>📊</span><span class="wsw-card-title">' + this.esc(card.name || '表格') + '</span>' +
      '<div class="wsw-md-toolbar">' + this.cardDeleteBtn(card.id) + '</div></div>';
    html += '<div class="wsw-table-toolbar">' +
      '<button class="wsw-tb-btn" data-action="addRow" data-id="' + card.id + '">+行</button>' +
      '<button class="wsw-tb-btn" data-action="addCol" data-id="' + card.id + '">+列</button>' +
      '<button class="wsw-tb-btn" data-action="delRow" data-id="' + card.id + '">-行</button>' +
      '<button class="wsw-tb-btn" data-action="delCol" data-id="' + card.id + '">-列</button>' +
      '</div>';
    html += '<div class="wsw-card-body"><table class="wsw-table"><thead><tr>';
    rows[0].forEach((cell, i) => {
      html += '<th contenteditable="true" data-r="0" data-c="' + i + '">' + this.esc(cell) + '</th>';
    });
    html += '</tr></thead><tbody>';
    for (let r = 1; r < rows.length; r++) {
      html += '<tr>';
      rows[r].forEach((cell, c) => {
        html += '<td contenteditable="true" data-r="' + r + '" data-c="' + c + '">' + this.esc(cell) + '</td>';
      });
      html += '</tr>';
    }
    html += '</tbody></table></div><div class="wsw-resize" data-action="resize"></div>';
    return html;
  },

  renderShape(card) {
    const st = card.shapeType || 'rect';
    const color = card.color || '#e94560';
    let inner = '';
    if (st === 'rect') {
      inner = '<div class="wsw-shape-rect" style="background:' + color + '"></div>';
    } else if (st === 'circle') {
      inner = '<div class="wsw-shape-circle" style="background:' + color + '"></div>';
    } else if (st === 'triangle') {
      inner = '<div class="wsw-shape-triangle" style="border-bottom-color:' + color + '"></div>';
    }
    return inner + '<div class="wsw-shape-label">' + this.esc(card.name || st) + '</div><div class="wsw-resize" data-action="resize"></div>';
  },

  // ===== 容器渲染 =====
  // 生成容器状态标记（资源来源+链接状态+时效状态）
  renderContainerStatus(card) {
    const res = card.currentResource;
    const sourceType = card.sourceType || 'workflow';
    let statusHtml = '';

    // 来源标签
    const sourceLabels = {
      'workflow': '🔗 工作流',
      'local': '💾 本地',
      'url': '🌐 网络'
    };
    const sourceClass = sourceType === 'local' ? 'local' : (sourceType === 'url' ? 'url' : 'linked');

    if (!res && sourceType === 'workflow' && !card.workflowLink) {
      statusHtml = '<span class="wsw-container-status unlinked">未配置</span>';
    } else if (!res) {
      statusHtml = '<span class="wsw-container-status loading">加载中</span>';
    } else if (sourceType === 'local') {
      // 本地文件不过期
      statusHtml = '<span class="wsw-container-status ' + sourceClass + '">' + (sourceLabels[sourceType] || '') + ' · ' + this.esc(res.name || '') + '</span>';
    } else if (sourceType === 'url') {
      statusHtml = '<span class="wsw-container-status ' + sourceClass + '">' + (sourceLabels[sourceType] || '') + '</span>';
    } else {
      // workflow 类型检查时效性
      const expired = this.isContainerExpired(card);
      if (expired) {
        statusHtml = '<span class="wsw-container-status expired">' + (sourceLabels[sourceType] || '') + ' · 已过期</span>';
      } else {
        const lastTime = new Date(card.timestamp.lastUpdated || card.timestamp.created || 0);
        const timeStr = lastTime.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        statusHtml = '<span class="wsw-container-status ' + sourceClass + '">' + (sourceLabels[sourceType] || '') + ' · ' + timeStr + '</span>';
      }
    }
    return statusHtml;
  },

  // ===== 视频容器渲染（只装视频文件） =====
  renderVideoContainer(card) {
    const playMode = card.playMode || 'none';
    const local = card.localSource;
    const online = card.onlineSource;
    const dl = card.workflowDownload;

    let mediaHtml = '';
    // 获取可用于webview播放的页面URL
    const webviewUrl = (online && online.pageUrl) || (dl && dl.pageUrl) || (online && online.url && !/\.(mp4|webm|ogg|mov|m3u8)(\?|$)/i.test(online.url) && !online.url.startsWith('blob:') ? online.url : '') || '';

    if (card.webviewPlaying && webviewUrl) {
      // webview在线播放模式：嵌入完整浏览器上下文播放网页视频
      mediaHtml = '<webview class="wsw-video-webview" src="' + this.esc(webviewUrl) + '" ' +
        'allowpopups disablewebsecurity ' +
        'data-card-id="' + card.id + '"></webview>' +
        '<div class="wsw-webview-controls">' +
          '<button class="wsw-md-btn" data-action="stopOnline" data-id="' + card.id + '" title="停止播放">⏹ 停止</button>' +
          '<button class="wsw-md-btn" data-action="reloadWebview" data-id="' + card.id + '" title="重新加载">🔄</button>' +
          '<small style="color:var(--text2)">📺 网页视频播放中</small>' +
        '</div>';
    } else if (playMode === 'local' && local && local.path) {
      // 本地文件播放
      const fileUrl = 'file://' + local.path.replace(/\\/g, '/');
      mediaHtml = '<video class="wsw-container-video" src="' + this.esc(fileUrl) + '" controls preload="metadata" ' +
        'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"></video>' +
        '<div class="wsw-container-error" style="display:none"> 本地视频无法播放<br><small>' + this.esc(local.name || '') + '</small><br><button class="wsw-container-link" onclick="WSWEditor.chooseLocalFile(' + card.id + ')">重新选择</button></div>';
    } else if (dl && dl.downloadStatus === 'done' && dl.downloadPath) {
      // 工作流下载完成后，用本地文件播放
      const fileUrl = 'file://' + dl.downloadPath.replace(/\\/g, '/');
      mediaHtml = '<video class="wsw-container-video" src="' + this.esc(fileUrl) + '" controls preload="metadata" ' +
        'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"></video>' +
        '<div class="wsw-container-error" style="display:none">🎬 下载的视频无法播放<br><small>' + this.esc(dl.resourceName || '') + '</small><br><button class="wsw-container-link" onclick="WSWEditor.downloadNow(' + card.id + ')">重新下载</button></div>';
    } else if (dl && dl.downloadStatus === 'downloading') {
      mediaHtml = '<div class="wsw-container-placeholder"> 视频下载中...<br><small>下载完成后自动播放</small></div>';
    } else if (playMode === 'online' && online && online.url) {
      // 用户手动输入的网络URL
      const isVideoUrl = /\.(mp4|webm|ogg|mov)(\?|$)/i.test(online.url);
      if (online.streamType === 'm3u8' || online.url.indexOf('.m3u8') > -1) {
        // m3u8流媒体：优先webview播放，备选下载
        mediaHtml = '<div class="wsw-container-placeholder"> HLS流媒体 (m3u8)<br>' +
          (webviewUrl ? '<button class="wsw-md-btn" data-action="playOnline" data-id="' + card.id + '" style="margin-top:6px">▶ 在线播放</button>' : '') +
          '<button class="wsw-md-btn" data-action="downloadNow" data-id="' + card.id + '" style="margin-top:6px">⬇ 下载</button></div>';
      } else if (online.url.startsWith('blob:') || online.streamType === 'blob') {
        // blob资源：用webview从原页面播放
        mediaHtml = '<div class="wsw-container-placeholder">🎬 Blob视频资源<br><small>需从原页面播放</small>' +
          (webviewUrl ? '<br><button class="wsw-md-btn" data-action="playOnline" data-id="' + card.id + '" style="margin-top:6px">▶ 在线播放</button>' : '') +
          '</div>';
      } else if (isVideoUrl) {
        // 直链视频，尝试直接播放
        mediaHtml = '<video class="wsw-container-video" src="' + this.esc(online.url) + '" controls preload="metadata" ' +
          'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"></video>' +
          '<div class="wsw-container-error" style="display:none">🎬 在线视频加载失败<br><small>链接可能已过期或需要登录</small><br><button class="wsw-container-link" onclick="WSWEditor.downloadNow(' + card.id + ')">下载后播放</button></div>';
      } else {
        // 页面URL（如B站）：用webview嵌入播放
        mediaHtml = '<div class="wsw-container-placeholder">🎬 网页视频<br><small style="color:var(--text2)">' + this.esc(online.url.length > 50 ? online.url.substring(0, 50) + '...' : online.url) + '</small><br>' +
          '<button class="wsw-md-btn" data-action="playOnline" data-id="' + card.id + '" style="margin-top:6px">▶ 在线播放</button>' +
          '<button class="wsw-md-btn" data-action="downloadNow" data-id="' + card.id + '" style="margin-top:6px">⬇ 下载后播放</button></div>';
      }
    } else if (dl) {
      // 已配置工作流但未下载
      const pageUrl = dl.pageUrl || '';
      const pageUrlDisplay = pageUrl ? (pageUrl.length > 40 ? pageUrl.substring(0, 40) + '...' : pageUrl) : '未知';
      mediaHtml = '<div class="wsw-container-placeholder">🎬 工作流视频资源<br><small style="color:var(--text2)">页面: ' + this.esc(pageUrlDisplay) + '</small><br>' +
        '<button class="wsw-md-btn" data-action="playOnline" data-id="' + card.id + '" style="margin-top:6px">▶ 在线播放</button>' +
        '<button class="wsw-md-btn" data-action="downloadNow" data-id="' + card.id + '" style="margin-top:6px">⬇ 下载后播放</button></div>';
    } else {
      mediaHtml = '<div class="wsw-container-placeholder">🎬 视频容器（仅装视频）<br><small>点击⚙配置 / 📁本地视频 / 🌐网络视频</small><br><small style="color:var(--text2)">工作流视频需下载到本地后播放</small></div>';
    }

    // 下载状态区域
    let downloadHtml = '';
    if (dl) {
      const lastDl = dl.lastDownloadAt ? new Date(dl.lastDownloadAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '从未下载';
      const status = dl.downloadStatus || 'idle';
      let statusText = '';
      if (status === 'downloading') statusText = '<span class="wsw-dl-status downloading">⏳ 下载中...</span>';
      else if (status === 'done') statusText = '<span class="wsw-dl-status done">✓ 已下载</span>';
      else if (status === 'failed') statusText = '<span class="wsw-dl-status failed">✗ 下载失败</span>';
      else statusText = '<span class="wsw-dl-status idle">○ 待下载</span>';
      const expired = this.isContainerExpired(card);
      const expiredBadge = expired && dl.autoDownload ? '<span class="wsw-dl-status expired">⚠ 已过期</span>' : '';
      // 页面链接（主要展示）+ 资源链接
      const pageUrl = dl.pageUrl || (online && online.pageUrl) || '';
      const resUrl = dl.resourceUrl || (online && online.url) || '';
      const pageUrlDisplay = pageUrl ? (pageUrl.length > 60 ? pageUrl.substring(0, 60) + '...' : pageUrl) : '未获取';
      const pageUrlHtml = pageUrl
        ? '<div class="wsw-dl-row"><b>页面:</b> <a href="' + this.esc(pageUrl) + '" target="_blank" class="wsw-dl-link" title="' + this.esc(pageUrl) + '">' + this.esc(pageUrlDisplay) + '</a></div>'
        : '<div class="wsw-dl-row"><b>页面:</b> <span style="color:var(--text2)">未获取</span></div>';
      const resUrlDisplay = resUrl ? (resUrl.length > 60 ? resUrl.substring(0, 60) + '...' : resUrl) : '';
      const resUrlHtml = resUrl
        ? '<div class="wsw-dl-row"><b>资源:</b> <a href="' + this.esc(resUrl) + '" target="_blank" class="wsw-dl-link" title="' + this.esc(resUrl) + '">' + this.esc(resUrlDisplay) + '</a></div>'
        : '';
      downloadHtml = '<div class="wsw-dl-info">' +
        '<div class="wsw-dl-row"><b>工作流:</b> ' + this.esc((dl.workflowTitle || '工作流') + ' #' + (dl.cardIndex + 1)) + '</div>' +
        pageUrlHtml +
        resUrlHtml +
        '<div class="wsw-dl-row"><b>上次下载:</b> ' + lastDl + '</div>' +
        '<div class="wsw-dl-row"><b>状态:</b> ' + statusText + ' ' + expiredBadge + '</div>' +
        '<div class="wsw-dl-actions">' +
          '<button class="wsw-md-btn" data-action="downloadNow" data-id="' + card.id + '" title="立即下载"> 立即下载</button>' +
          '<button class="wsw-md-btn" data-action="configVideo" data-id="' + card.id + '" title="配置">⚙ 配置</button>' +
        '</div></div>';
    } else {
      downloadHtml = '<div class="wsw-container-placeholder"><small>未配置工作流下载源</small><br><button class="wsw-md-btn" data-action="configVideo" data-id="' + card.id + '">⚙ 配置</button></div>';
    }

    const modeBadges = '<span class="wsw-mode-badge ' + (playMode === 'local' ? 'active' : (local ? 'ready' : 'disabled')) + '">💾本地</span>' +
      '<span class="wsw-mode-badge ' + (playMode === 'online' ? 'active' : (online ? 'ready' : 'disabled')) + '">🌐网络</span>' +
      '<span class="wsw-mode-badge ' + (dl ? 'ready' : 'disabled') + '">🔗下载</span>';

    return '<div class="wsw-card-header" data-action="drag">' +
      '<span>🎬</span>' +
      '<span class="wsw-card-title">' + this.esc(card.name || '视频容器') + '</span>' +
      '<div class="wsw-md-toolbar">' +
        '<button class="wsw-md-btn" data-action="configVideo" data-id="' + card.id + '" title="配置">⚙</button>' +
        '<button class="wsw-md-btn" data-action="chooseLocal" data-id="' + card.id + '" title="选择本地视频">📁</button>' +
        '<button class="wsw-md-btn" data-action="setUrl" data-id="' + card.id + '" title="网络视频URL">🌐</button>' +
        this.cardDeleteBtn(card.id) +
      '</div></div>' +
      '<div class="wsw-container-body' + (card.webviewPlaying ? ' wsw-webview-body' : '') + '">' + mediaHtml + '</div>' +
      '<div class="wsw-container-dl-section' + (card.dlSectionCollapsed !== false ? ' wsw-dl-collapsed' : '') + '">' + downloadHtml + '</div>' +
      '<div class="wsw-dl-toggle" data-action="toggleDlSection" data-id="' + card.id + '" title="' + (card.dlSectionCollapsed !== false ? '展开信息' : '折叠信息') + '">' + (card.dlSectionCollapsed !== false ? '▼' : '▲') + '</div>' +
      '<div class="wsw-container-footer">' + modeBadges + '</div>' +
      '<div class="wsw-resize" data-action="resize"></div>';
  },

  // ===== webview在线播放方法 =====
  startWebviewPlayback(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || card.type !== 'videoContainer') return;
    const online = card.onlineSource || {};
    const dl = card.workflowDownload || {};
    const webviewUrl = (online.pageUrl) || (dl.pageUrl) || (online.url && !/\.(mp4|webm|ogg|mov|m3u8)(\?|$)/i.test(online.url) && !online.url.startsWith('blob:') ? online.url : '') || '';
    if (!webviewUrl) {
      App.showToast('未找到可播放的页面URL');
      return;
    }
    card.webviewPlaying = true;
    card.playMode = 'online';
    this.renderCanvas();
    App.showToast('正在加载网页视频...');
  },

  stopWebviewPlayback(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card) return;
    card.webviewPlaying = false;
    this.renderCanvas();
    App.showToast('已停止在线播放');
  },

  reloadWebview(cardId) {
    const webview = document.querySelector('webview[data-card-id="' + cardId + '"]');
    if (webview) {
      webview.reload();
      App.showToast('正在重新加载...');
    }
  },

  // 折叠/展开信息栏
  toggleDlSection(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card) return;
    card.dlSectionCollapsed = !card.dlSectionCollapsed;
    this.renderCanvas();
  },

  // 注入webview自动播放脚本：不隐藏网页，只将视频元素放大覆盖整个卡片
  _injectWebviewAutoplay(webview, cardId) {
    if (!webview) return;

    // 注入CSS隐藏遮挡元素和滚动条
    const injectHideOverlayCSS = () => {
      try {
        webview.insertCSS(`
          /* 隐藏B站顶部导航栏 */
          .bili-header__bar, .mini-header, div[class*="header__bar"], div[class*="mini-header"] {
            display: none !important;
          }
          /* 隐藏常见遮挡元素 */
          .video-page-card, .recom-wrap, .slide-guest, .pop-live-small,
          .danmaku-wrap, .bpx-player-dm-setting, .bpx-player-sending-area,
          .bpx-player-control-wrap, .bpx-player-toast-wrap,
          [class*="danmaku"], [class*="control-wrap"], [class*="toast-wrap"] {
            display: none !important;
          }
          /* 隐藏滚动条 */
          ::-webkit-scrollbar {
            display: none !important;
            width: 0 !important;
            height: 0 !important;
          }
          html, body {
            overflow: hidden !important;
            scrollbar-width: none !important;
            -ms-overflow-style: none !important;
          }
        `).catch(function() {});
      } catch (e) {
        console.error('[WebScout] Failed to inject hide CSS:', e);
      }
    };

    // 核心脚本：查找视频并放大覆盖整个视口（带防重复标记）
    const videoExtractorScript = `
      (function() {
        // 防止重复执行
        if (window.__wsw_video_locked__) return true;

        // 递归查找所有视频元素（包括shadow DOM和iframe）
        function findAllVideos(root) {
          var videos = [];
          if (!root) return videos;
          var directVideos = root.querySelectorAll ? root.querySelectorAll('video') : [];
          for (var i = 0; i < directVideos.length; i++) {
            videos.push(directVideos[i]);
          }
          var allElements = root.querySelectorAll ? root.querySelectorAll('*') : [];
          for (var i = 0; i < allElements.length; i++) {
            var el = allElements[i];
            if (el.shadowRoot) {
              var shadowVideos = findAllVideos(el.shadowRoot);
              videos = videos.concat(shadowVideos);
            }
            if (el.tagName === 'IFRAME' && el.contentDocument) {
              var iframeVideos = findAllVideos(el.contentDocument);
              videos = videos.concat(iframeVideos);
            }
          }
          return videos;
        }

        var videos = findAllVideos(document);
        console.log('[WebScout] Found videos:', videos.length);

        if (videos.length === 0) {
          return false;
        }

        // 选取最大的视频元素
        var mainVideo = null;
        var maxArea = 0;
        for (var i = 0; i < videos.length; i++) {
          var v = videos[i];
          var rect = v.getBoundingClientRect();
          var area = rect.width * rect.height;
          console.log('[WebScout] Video', i, 'area:', area);
          if (area > maxArea) {
            maxArea = area;
            mainVideo = v;
          }
        }
        if (!mainVideo) mainVideo = videos[0];

        // 标记已锁定，防止重复执行
        window.__wsw_video_locked__ = true;

        // 将视频元素设为fixed定位，覆盖整个视口（不隐藏其他元素）
        mainVideo.style.setProperty('position', 'fixed', 'important');
        mainVideo.style.setProperty('top', '0', 'important');
        mainVideo.style.setProperty('left', '0', 'important');
        mainVideo.style.setProperty('width', '100vw', 'important');
        mainVideo.style.setProperty('height', '100vh', 'important');
        mainVideo.style.setProperty('object-fit', 'contain', 'important');
        mainVideo.style.setProperty('background', '#000', 'important');
        mainVideo.style.setProperty('z-index', '999999', 'important');
        mainVideo.style.setProperty('display', 'block', 'important');
        mainVideo.controls = true;

        // 自动播放（先静音）
        mainVideo.muted = true;
        mainVideo.play().then(function() {
          console.log('[WebScout] Video playing');
          // 2秒后取消静音（仅执行一次）
          setTimeout(function() {
            if (!window.__wsw_unmuted__) {
              mainVideo.muted = false;
              window.__wsw_unmuted__ = true;
              console.log('[WebScout] Video unmuted');
            }
          }, 2000);
        }).catch(function(err) {
          console.error('[WebScout] Play failed:', err);
          mainVideo.click();
        });

        return true;
      })();
    `;

    // 查找并播放视频
    const findAndPlayVideo = () => {
      try {
        webview.executeJavaScript(videoExtractorScript).then(function(found) {
          if (!found) {
            setTimeout(findAndPlayVideo, 500);
          }
        }).catch(function(err) {
          console.error('[WebScout] executeJavaScript failed:', err);
        });
      } catch (e) {
        console.error('[WebScout] findAndPlayVideo error:', e);
      }
    };

    // 页面DOM就绪时
    webview.addEventListener('dom-ready', () => {
      console.log('[WebScout] webview dom-ready');
      injectHideOverlayCSS();
      findAndPlayVideo();
    });

    // 页面完全加载后
    webview.addEventListener('did-stop-loading', () => {
      console.log('[WebScout] webview did-stop-loading');
      injectHideOverlayCSS();
      setTimeout(findAndPlayVideo, 300);
      setTimeout(findAndPlayVideo, 1000);
      setTimeout(findAndPlayVideo, 2000);
    });

    // 持续监听DOM变化（带防重复）
    webview.addEventListener('did-attach', () => {
      console.log('[WebScout] webview did-attach');
      try {
        webview.executeJavaScript(`
          (function() {
            var observer = new MutationObserver(function() {
              // 如果视频已锁定，断开观察器
              if (window.__wsw_video_locked__) {
                observer.disconnect();
                return;
              }
              var videos = document.querySelectorAll('video');
              if (videos.length > 0) {
                console.log('[WebScout] MutationObserver found video');
                observer.disconnect();
                // 执行视频提取（内部有防重复检查）
                ${videoExtractorScript}
              }
            });
            if (document.body) {
              observer.observe(document.body, { childList: true, subtree: true });
            }
          })();
        `).catch(function() {});
      } catch (e) {}
    });

    // 监听加载失败
    webview.addEventListener('did-fail-load', (e) => {
      console.error('[WebScout] webview failed to load:', e.errorDescription);
    });
  },

  // ===== 音频容器渲染（只装音频文件） =====
  renderAudioContainer(card) {
    const playMode = card.playMode || (card.currentResource ? (card.currentResource.isLocal ? 'local' : 'online') : 'none');
    const local = card.localSource || (card.currentResource && card.currentResource.isLocal ? {
      path: card.currentResource.localPath || card.localPath, name: card.currentResource.name, format: card.currentResource.format
    } : null);
    const online = card.onlineSource || (card.currentResource && !card.currentResource.isLocal ? {
      url: card.currentResource.url, name: card.currentResource.name, streamType: card.currentResource.streamType
    } : null);
    const dl = card.workflowDownload;

    let mediaHtml = '';
    if (playMode === 'local' && local && local.path) {
      const fileUrl = 'file://' + local.path.replace(/\\/g, '/');
      mediaHtml = '<audio class="wsw-container-audio" src="' + this.esc(fileUrl) + '" controls preload="metadata" ' +
        'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"></audio>' +
        '<div class="wsw-container-error" style="display:none">🎵 本地音频无法播放<br><small>' + this.esc(local.name || '') + '</small><br><button class="wsw-container-link" onclick="WSWEditor.chooseLocalFile(' + card.id + ')">重新选择</button></div>';
    } else if (playMode === 'online' && online && online.url) {
      if (online.streamType === 'm3u8' || online.url.indexOf('.m3u8') > -1) {
        mediaHtml = '<div class="wsw-container-placeholder">🎵 HLS流媒体<br><a href="' + this.esc(online.url) + '" target="_blank" class="wsw-container-link">打开链接</a></div>';
      } else if (online.url.startsWith('blob:') || online.streamType === 'blob') {
        mediaHtml = '<div class="wsw-container-placeholder">🎵 Blob音频资源<br><a href="' + this.esc(online.url) + '" target="_blank" class="wsw-container-link">打开链接</a></div>';
      } else {
        mediaHtml = '<audio class="wsw-container-audio" src="' + this.esc(online.url) + '" controls preload="metadata" ' +
          'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"></audio>' +
          '<div class="wsw-container-error" style="display:none">🎵 在线音频加载失败<br><a href="' + this.esc(online.url) + '" target="_blank" class="wsw-container-link">直接打开链接</a></div>';
      }
    } else {
      mediaHtml = '<div class="wsw-container-placeholder">🎵 音频容器（仅装音频）<br><small>点击⚙配置 / 📁本地音频 / 🌐网络音频</small></div>';
    }

    // 下载状态区域
    let downloadHtml = '';
    if (dl) {
      const lastDl = dl.lastDownloadAt ? new Date(dl.lastDownloadAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '从未下载';
      const status = dl.downloadStatus || 'idle';
      let statusText = '';
      if (status === 'downloading') statusText = '<span class="wsw-dl-status downloading">⏳ 下载中...</span>';
      else if (status === 'done') statusText = '<span class="wsw-dl-status done">✓ 已下载</span>';
      else if (status === 'failed') statusText = '<span class="wsw-dl-status failed">✗ 下载失败</span>';
      else statusText = '<span class="wsw-dl-status idle">○ 待下载</span>';
      const expired = this.isContainerExpired(card);
      const expiredBadge = expired && dl.autoDownload ? '<span class="wsw-dl-status expired">⚠ 已过期</span>' : '';
      // 页面链接（主要展示）+ 资源链接
      const pageUrl = dl.pageUrl || (online && online.pageUrl) || '';
      const resUrl = dl.resourceUrl || (online && online.url) || '';
      const pageUrlDisplay = pageUrl ? (pageUrl.length > 60 ? pageUrl.substring(0, 60) + '...' : pageUrl) : '未获取';
      const pageUrlHtml = pageUrl
        ? '<div class="wsw-dl-row"><b>页面:</b> <a href="' + this.esc(pageUrl) + '" target="_blank" class="wsw-dl-link" title="' + this.esc(pageUrl) + '">' + this.esc(pageUrlDisplay) + '</a></div>'
        : '<div class="wsw-dl-row"><b>页面:</b> <span style="color:var(--text2)">未获取</span></div>';
      const resUrlDisplay = resUrl ? (resUrl.length > 60 ? resUrl.substring(0, 60) + '...' : resUrl) : '';
      const resUrlHtml = resUrl
        ? '<div class="wsw-dl-row"><b>资源:</b> <a href="' + this.esc(resUrl) + '" target="_blank" class="wsw-dl-link" title="' + this.esc(resUrl) + '">' + this.esc(resUrlDisplay) + '</a></div>'
        : '';
      downloadHtml = '<div class="wsw-dl-info">' +
        '<div class="wsw-dl-row"><b>工作流:</b> ' + this.esc((dl.workflowTitle || '工作流') + ' #' + (dl.cardIndex + 1)) + '</div>' +
        pageUrlHtml +
        resUrlHtml +
        '<div class="wsw-dl-row"><b>上次下载:</b> ' + lastDl + '</div>' +
        '<div class="wsw-dl-row"><b>状态:</b> ' + statusText + ' ' + expiredBadge + '</div>' +
        '<div class="wsw-dl-actions">' +
          '<button class="wsw-md-btn" data-action="downloadNow" data-id="' + card.id + '" title="立即下载">⬇ 立即下载</button>' +
          '<button class="wsw-md-btn" data-action="configAudio" data-id="' + card.id + '" title="配置">⚙ 配置</button>' +
        '</div></div>';
    }

    const modeBadges = '<span class="wsw-mode-badge ' + (playMode === 'local' ? 'active' : (local ? 'ready' : 'disabled')) + '">💾本地</span>' +
      '<span class="wsw-mode-badge ' + (playMode === 'online' ? 'active' : (online ? 'ready' : 'disabled')) + '">🌐网络</span>' +
      '<span class="wsw-mode-badge ' + (dl ? 'ready' : 'disabled') + '">🔗下载</span>';

    return '<div class="wsw-card-header" data-action="drag">' +
      '<span>🎵</span>' +
      '<span class="wsw-card-title">' + this.esc(card.name || '音频容器') + '</span>' +
      '<div class="wsw-md-toolbar">' +
        '<button class="wsw-md-btn" data-action="configAudio" data-id="' + card.id + '" title="配置">⚙</button>' +
        '<button class="wsw-md-btn" data-action="chooseLocal" data-id="' + card.id + '" title="选择本地音频">📁</button>' +
        '<button class="wsw-md-btn" data-action="setUrl" data-id="' + card.id + '" title="网络音频URL">🌐</button>' +
        this.cardDeleteBtn(card.id) +
      '</div></div>' +
      '<div class="wsw-container-body">' + mediaHtml + '</div>' +
      (dl ? '<div class="wsw-container-dl-section">' + downloadHtml + '</div>' : '') +
      '<div class="wsw-container-footer">' + modeBadges + '</div>' +
      '<div class="wsw-resize" data-action="resize"></div>';
  },

  // ===== 文本容器渲染（装图片、文本、超链接） =====
  renderTextContainer(card) {
    const items = card.items || [];
    const dl = card.workflowDownload;
    const textContent = card.textContent || '';

    // 文本编辑区域
    let contentHtml = '<div class="wsw-text-editor" contenteditable="true" data-card-id="' + card.id + '" ' +
      'oninput="WSWEditor.onTextEdit(' + card.id + ', this)" ' +
      'onblur="WSWEditor.onTextEdit(' + card.id + ', this)" ' +
      'placeholder="输入文本或从工作流导入...">' + this.esc(textContent) + '</div>';

    // 如果有图片/链接项，在文本下方显示
    const mediaItems = items.filter(item => item.type === 'image' || item.type === 'link');
    if (mediaItems.length > 0) {
      const mediaHtml = mediaItems.map((item, idx) => {
        const realIdx = items.indexOf(item);
        if (item.type === 'image') {
          return '<div class="wsw-text-item wsw-text-image">' +
            '<img src="' + this.esc(item.url) + '" alt="' + this.esc(item.name || '') + '" style="max-width:100%;border-radius:4px" ' +
            'onerror="this.style.display=\'none\'">' +
            '<div class="wsw-text-item-name">' + this.esc(item.name || '图片') + '</div>' +
            '<button class="wsw-text-item-del" onclick="WSWEditor.removeTextItem(' + card.id + ',' + realIdx + ')">✕</button></div>';
        } else if (item.type === 'link') {
          return '<div class="wsw-text-item wsw-text-link">' +
            '<span>🔗</span>' +
            '<a href="' + this.esc(item.url) + '" target="_blank" title="' + this.esc(item.url) + '">' + this.esc(item.name || item.url) + '</a>' +
            '<button class="wsw-text-item-del" onclick="WSWEditor.removeTextItem(' + card.id + ',' + realIdx + ')">✕</button></div>';
        }
        return '';
      }).join('');
      contentHtml += '<div class="wsw-text-media-items">' + mediaHtml + '</div>';
    }

    // download status section
    let downloadHtml = '';
    if (dl) {
      const lastDl = dl.lastDownloadAt ? new Date(dl.lastDownloadAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '从未加载';
      const expired = this.isContainerExpired(card);
      const expiredBadge = expired && dl.autoDownload ? '<span class="wsw-dl-status expired">⚠ 已过期</span>' : '';
      downloadHtml = '<div class="wsw-container-dl-section"><div class="wsw-dl-info">' +
        '<div class="wsw-dl-row"><b>来源:</b> ' + this.esc(dl.workflowTitle || '工作流') + ' (' + (dl.resourceCount || 0) + '项)</div>' +
        '<div class="wsw-dl-row"><b>上次加载:</b> ' + lastDl + ' ' + expiredBadge + '</div>' +
        '<div class="wsw-dl-actions">' +
          '<button class="wsw-md-btn" data-action="refreshTextWorkflow" data-id="' + card.id + '" title="重新加载">🔄 刷新</button>' +
          '<button class="wsw-md-btn" data-action="configText" data-id="' + card.id + '" title="配置">⚙ 配置</button>' +
        '</div></div></div>';
    }

    const modeBadges = '<span class="wsw-mode-badge ' + (textContent || items.length > 0 ? 'active' : 'disabled') + '">📝' + (textContent ? textContent.length + '字' : items.length + '项') + '</span>' +
      '<span class="wsw-mode-badge ' + (dl ? 'ready' : 'disabled') + '">工作流</span>';

    return '<div class="wsw-card-header" data-action="drag">' +
      '<span>📝</span>' +
      '<span class="wsw-card-title">' + this.esc(card.name || '文本容器') + '</span>' +
      '<div class="wsw-md-toolbar">' +
        '<button class="wsw-md-btn" data-action="configText" data-id="' + card.id + '" title="配置">⚙</button>' +
        '<button class="wsw-md-btn" data-action="chooseLocal" data-id="' + card.id + '" title="添加本地文件">📁</button>' +
        '<button class="wsw-md-btn" data-action="setUrl" data-id="' + card.id + '" title="添加URL">🔗</button>' +
        this.cardDeleteBtn(card.id) +
      '</div></div>' +
      '<div class="wsw-container-body wsw-text-body">' + contentHtml + '</div>' +
      downloadHtml +
      '<div class="wsw-container-footer">' + modeBadges + '</div>' +
      '<div class="wsw-resize" data-action="resize"></div>';
  },

  // 删除文本容器中的某个项目
  removeTextItem(cardId, itemIndex) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || !card.items || itemIndex < 0 || itemIndex >= card.items.length) return;
    this.saveUndo();
    card.items.splice(itemIndex, 1);
    card.timestamp.lastUpdated = Date.now();
    this.renderCanvas();
  },

  // 文本编辑器输入/失焦时保存内容
  onTextEdit(cardId, el) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card) return;
    card.textContent = el.innerText || el.textContent || '';
    card.timestamp.lastUpdated = Date.now();
  },

  // ===== Excel容器渲染（表格+统计图展示图片/文本/超链接） =====
  renderExcelContainer(card) {
    const dl = card.workflowDownload;
    const viewMode = card.viewMode || 'table';
    const rows = card.tableRows || 5;
    const cols = card.tableCols || 3;
    
    // Initialize tableData if not exists or size mismatch
    if (!card.tableData || card.tableData.length !== rows || (card.tableData[0] && card.tableData[0].length !== cols)) {
      card.tableData = [];
      for (let r = 0; r < rows; r++) {
        card.tableData[r] = [];
        for (let c = 0; c < cols; c++) {
          card.tableData[r][c] = '';
        }
      }
    }

    let bodyHtml = '';
    if (!dl || !dl.workflowId) {
      bodyHtml = '<div class="wsw-container-placeholder">📊 Excel容器<br><small>点击⚙配置工作流数据源</small><br><small>数据将按顺序填入表格格子</small></div>';
    } else if (viewMode === 'table') {
      // 可编辑网格表格
      let rowsHtml = '';
      for (let r = 0; r < rows; r++) {
        rowsHtml += '<tr>';
        for (let c = 0; c < cols; c++) {
          const val = card.tableData[r] ? (card.tableData[r][c] || '') : '';
          rowsHtml += '<td><span contenteditable="true" class="wsw-excel-grid-cell" data-card="' + card.id + '" data-r="' + r + '" data-c="' + c + '" ' +
            'onblur="WSWEditor.onExcelGridEdit(this)">' + this.esc(val) + '</span></td>';
        }
        rowsHtml += '</tr>';
      }
      bodyHtml = '<div class="wsw-excel-grid-wrap">' +
        '<div class="wsw-excel-grid-toolbar">' +
        '<button class="wsw-tb-btn" data-action="excelAddRow" data-id="' + card.id + '">+行</button>' +
        '<button class="wsw-tb-btn" data-action="excelDelRow" data-id="' + card.id + '">-行</button>' +
        '<button class="wsw-tb-btn" data-action="excelAddCol" data-id="' + card.id + '">+列</button>' +
        '<button class="wsw-tb-btn" data-action="excelDelCol" data-id="' + card.id + '">-列</button>' +
        '</div>' +
        '<table class="wsw-excel-grid-table"><tbody>' + rowsHtml + '</tbody></table></div>';
    } else {
      // 统计图视图 - show chart based on table data
      bodyHtml = '<div class="wsw-excel-chart-wrap">' +
        '<canvas id="excelChart_' + card.id + '" width="' + (card.w - 20) + '" height="' + (card.h - 80) + '"></canvas>' +
        '</div>';
    }

    // download status (keep existing logic)
    let downloadHtml = '';
    if (dl) {
      const lastDl = dl.lastDownloadAt ? new Date(dl.lastDownloadAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '从未加载';
      downloadHtml = '<div class="wsw-container-dl-section"><div class="wsw-dl-info">' +
        '<div class="wsw-dl-row"><b>来源:</b> ' + this.esc(dl.workflowTitle || '工作流') + ' (' + (dl.resourceCount || 0) + '项)</div>' +
        '<div class="wsw-dl-row"><b>上次加载:</b> ' + lastDl + '</div>' +
        '<div class="wsw-dl-actions">' +
        '<button class="wsw-md-btn" data-action="refreshExcel" data-id="' + card.id + '" title="重新加载">🔄 刷新</button>' +
        '<button class="wsw-md-btn" data-action="configExcel" data-id="' + card.id + '" title="配置"> 配置</button>' +
        '</div></div></div>';
    }

    const modeBadges = '<span class="wsw-mode-badge ' + (dl ? 'ready' : 'disabled') + '">📊 ' + rows + '行×' + cols + '列</span>' +
      '<span class="wsw-mode-badge ' + (viewMode === 'chart' ? 'active' : 'disabled') + '">📈 图表</span>';

    return '<div class="wsw-card-header" data-action="drag">' +
      '<span>📊</span>' +
      '<span class="wsw-card-title">' + this.esc(card.name || 'Excel容器') + '</span>' +
      '<div class="wsw-md-toolbar">' +
      '<button class="wsw-md-btn" data-action="toggleExcelView" data-id="' + card.id + '" title="切换视图">' + (viewMode === 'table' ? '📈' : '📋') + '</button>' +
      '<button class="wsw-md-btn" data-action="configExcel" data-id="' + card.id + '" title="配置">⚙</button>' +
      this.cardDeleteBtn(card.id) +
      '</div></div>' +
      '<div class="wsw-container-body">' + bodyHtml + '</div>' +
      downloadHtml +
      '<div class="wsw-container-footer">' + modeBadges + '</div>' +
      '<div class="wsw-resize" data-action="resize"></div>';
  },

  // ===== 统计图卡片渲染 =====
  renderChartCard(card) {
    const chartType = card.chartType || 'bar';
    const chartTypeLabel = { bar: '柱状图', pie: '饼图', line: '折线图', wordcloud: '词云' }[chartType] || '柱状图';
    const chartTypeIcon = { bar: '📊', pie: '🥧', line: '📈', wordcloud: '☁️' }[chartType] || '📊';

    // 查找源容器
    let sourceCard = null;
    let sourceName = card.inlineData ? '内联数据' : '未连接';
    if (!card.inlineData && card.sourceCardId) {
      sourceCard = this.state.doc.cards.find(c => c.id === card.sourceCardId);
      if (sourceCard) sourceName = sourceCard.name || ({ excelContainer: 'Excel容器', textContainer: '文本容器' }[sourceCard.type] || '容器');
    }

    let bodyHtml = '';
    if (!sourceCard && !card.inlineData) {
      bodyHtml = '<div class="wsw-chart-empty">' +
        '<div class="wsw-chart-empty-icon">📈</div>' +
        '<div class="wsw-chart-empty-text">未连接数据源</div>' +
        '<div class="wsw-chart-empty-hint">点击⚙配置按钮选择 Excel/文本容器，或使用直接数据模式</div>' +
        '<button class="wsw-md-btn" data-action="configChart" data-id="' + card.id + '" style="margin-top:8px">⚙ 配置数据源</button>' +
        '</div>';
    } else {
      // 提取数据：inline 模式直接用 inlineData，否则从 sourceCard 提取
      const data = card.inlineData
        ? { labels: (card.inlineData.labels || []).slice(), values: (card.inlineData.values || []).slice() }
        : this._extractChartData(sourceCard, chartType, card);
      card.chartData = data;
      bodyHtml = '<canvas class="wsw-chart-canvas" id="chartCard_' + card.id + '" data-chart-type="' + chartType + '" data-source-card="' + (sourceCard ? sourceCard.id : '') + '"></canvas>' +
        '<div class="wsw-chart-data-info">' +
          '<small>📊 数据点: ' + (data.labels ? data.labels.length : 0) + ' | 来源: ' + this.esc(sourceName) + '</small>' +
        '</div>';
    }

    const hasData = !!(sourceCard || card.inlineData);
    const modeBadges = '<span class="wsw-mode-badge ' + (hasData ? 'active' : 'disabled') + '">' + chartTypeIcon + ' ' + chartTypeLabel + '</span>' +
      '<span class="wsw-mode-badge ' + (hasData ? 'ready' : 'disabled') + '">' + this.esc(sourceName) + '</span>';

    return '<div class="wsw-card-header" data-action="drag">' +
      '<span>' + chartTypeIcon + '</span>' +
      '<span class="wsw-card-title">' + this.esc(card.name || '统计图') + '</span>' +
      '<div class="wsw-md-toolbar">' +
        '<button class="wsw-md-btn" data-action="refreshChart" data-id="' + card.id + '" title="刷新">🔄</button>' +
        '<button class="wsw-md-btn" data-action="configChart" data-id="' + card.id + '" title="配置">⚙</button>' +
        this.cardDeleteBtn(card.id) +
      '</div></div>' +
      '<div class="wsw-container-body wsw-chart-body">' + bodyHtml + '</div>' +
      '<div class="wsw-container-footer">' + modeBadges + '</div>' +
      '<div class="wsw-resize" data-action="resize"></div>';
  },

  // ===== Task 16: AI 工作流容器渲染 =====
  renderAiworkflowContainer(card) {
    let bodyHtml = '';
    let modeBadges = '';

    if (card.taskDeleted) {
      // 任务已删除占位
      bodyHtml = '<div class="wsw-container-placeholder">⚠️ 任务已删除<br><small>点击 ⚙ 重新配置任务</small></div>';
      modeBadges = '<span class="wsw-mode-badge disabled">⚠ 任务已删除</span>';
    } else if (!card.taskId) {
      // 未配置任务
      bodyHtml = '<div class="wsw-container-placeholder">🤖 AI 工作流<br><small>点击 ⚙ 配置任务</small></div>';
      modeBadges = '<span class="wsw-mode-badge disabled">未配置</span>';
    } else {
      // 已配置任务
      const taskName = this.esc(card.taskName || '已配置任务');
      const typeLabel = { batch: '📦 批量', crosspage: '🌐 跨页面', tracking: '🔔 追踪' }[card.taskType] || '📦';
      const runBtn = card.running
        ? '<button class="wsw-md-btn" disabled>运行中...</button>'
        : '<button class="wsw-md-btn" data-action="runAiworkflow" data-id="' + card.id + '" title="运行">▶ 运行</button>';

      let resultHtml = '';
      if (card.lastResultSummary) {
        const sum = card.lastResultSummary;
        const itemCount = sum.itemCount || 0;
        const time = sum.runAt ? new Date(sum.runAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        const samples = Array.isArray(sum.samples) ? sum.samples.slice(0, 3) : [];
        const samplesHtml = samples.map(s => '<div class="wsw-aiwf-sample">· ' + this.esc(String(s).slice(0, 40)) + '</div>').join('');
        resultHtml = '<div class="wsw-aiwf-result">' +
          '<div class="wsw-aiwf-result-head"><b>✓ ' + itemCount + ' 条结果</b> <small>' + time + '</small></div>' +
          samplesHtml +
          (itemCount > 3 ? '<div class="wsw-aiwf-more">...' : '<div class="wsw-aiwf-more" style="display:none">') +
            '<a href="javascript:void(0)" data-action="openAiworkflowResult" data-id="' + card.id + '" style="color:var(--primary);cursor:pointer;">查看完整结果 →</a>' +
          '</div>' +
        '</div>';
      } else if (card.running) {
        resultHtml = '<div class="wsw-aiwf-result"><div class="wsw-aiwf-loading">⏳ 正在运行...</div></div>';
      }

      bodyHtml = '<div class="wsw-aiwf-body">' +
        '<div class="wsw-aiwf-task-info"><span class="wsw-aiwf-type">' + typeLabel + '</span> <b>' + taskName + '</b></div>' +
        '<div class="wsw-aiwf-actions">' + runBtn +
          '<button class="wsw-md-btn" data-action="configAiworkflow" data-id="' + card.id + '" title="配置">⚙ 配置</button>' +
        '</div>' +
        resultHtml +
      '</div>';
      modeBadges = '<span class="wsw-mode-badge ' + (card.running ? 'active' : 'ready') + '">' + typeLabel + (card.lastRunAt ? ' · ' + new Date(card.lastRunAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '') + '</span>';
    }

    return '<div class="wsw-card-header" data-action="drag">' +
      '<span>🤖</span>' +
      '<span class="wsw-card-title">' + this.esc(card.name || 'AI 工作流') + '</span>' +
      '<div class="wsw-md-toolbar">' +
        '<button class="wsw-md-btn" data-action="configAiworkflow" data-id="' + card.id + '" title="配置">⚙</button>' +
        this.cardDeleteBtn(card.id) +
      '</div></div>' +
      '<div class="wsw-container-body">' + bodyHtml + '</div>' +
      '<div class="wsw-container-footer">' + modeBadges + '</div>' +
      '<div class="wsw-resize" data-action="resize"></div>';
  },

  // Task 16: AI 工作流容器配置面板
  async showAiworkflowConfigPanel(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || card.type !== 'aiworkflow') return;

    // 拉取所有 AI 工作流任务
    let tasks = [];
    try {
      const result = await window.electronAPI?.aiworkflowAPI?.getAll?.();
      if (result?.success) tasks = result.data || [];
    } catch (e) { /* ignore */ }

    // 按类型分组
    const groups = { batch: [], crosspage: [], tracking: [], template: [] };
    tasks.forEach(t => {
      const g = groups[t.type] || (groups[t.type] = []);
      g.push(t);
    });
    const typeLabel = { batch: '📦 批量抓取', crosspage: '🌐 跨页面抓取', tracking: '🔔 更新追踪', template: '🎯 末端抓取' };
    const optionsHtml = ['batch', 'crosspage', 'tracking', 'template'].map(type => {
      const arr = groups[type] || [];
      if (!arr.length) return '';
      const opts = arr.map(t => {
        const sel = String(card.taskId) === String(t.id) ? ' selected' : '';
        return '<option value="' + this.esc(String(t.id)) + '"' + sel + '>' + this.esc(t.name || '未命名') + ' (' + (t.type || type) + ')</option>';
      }).join('');
      return '<optgroup label="' + (typeLabel[type] || type) + '">' + opts + '</optgroup>';
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'wsw-link-overlay';
    overlay.innerHTML = '<div class="wsw-link-panel" style="width:520px">' +
      '<div class="wsw-link-header"><span>🤖 AI 工作流容器配置</span><button class="wsw-link-close">✕</button></div>' +
      '<div class="wsw-link-body">' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">容器名称</label>' +
          '<input type="text" id="aiwfName" value="' + this.esc(card.name) + '" class="wsw-link-input">' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">关联任务</label>' +
          '<select id="aiwfTaskSelect" class="wsw-link-select">' +
            '<option value="">-- 请选择任务 --</option>' +
            optionsHtml +
          '</select>' +
          '<div class="wsw-link-hint">选择一个 AI 工作流任务，容器将可在此直接运行并显示结果摘要</div>' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">从抓取信息卡片导入</label>' +
          '<div style="display:flex;gap:8px;margin-bottom:6px;">' +
            '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;"><input type="radio" name="aiwfImportMode" value="url" checked style="width:auto;">卡片目标 URL</label>' +
            '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;"><input type="radio" name="aiwfImportMode" value="content" style="width:auto;">卡片内容</label>' +
          '</div>' +
          '<button class="wsw-link-btn refresh-btn" id="aiwfImportCardsBtn" style="width:100%;">🗂 从卡片获取</button>' +
          '<div class="wsw-link-hint">将选中卡片的 URL 或内容导入到关联任务的配置中</div>' +
        '</div>' +
        '<div class="wsw-link-preview" id="aiwfPreview"></div>' +
      '</div>' +
      '<div class="wsw-link-footer">' +
        '<button class="wsw-link-btn refresh-btn" id="aiwfRunNowBtn">▶ 立即运行</button>' +
        '<button class="wsw-link-btn refresh-btn" id="aiwfChainRunBtn">🔗 链式运行</button>' +
        '<button class="wsw-link-btn cancel-btn">取消</button>' +
        '<button class="wsw-link-btn save-btn primary">保存</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);

    // 预览任务信息
    const previewTask = (taskId) => {
      const preview = overlay.querySelector('#aiwfPreview');
      const t = tasks.find(x => String(x.id) === String(taskId));
      if (!t) { preview.innerHTML = ''; return; }
      const results = Array.isArray(t.results) ? t.results : [];
      let totalItems = 0;
      results.forEach(r => { totalItems += (r.items ? r.items.length : (r.count || 0)); });
      preview.innerHTML = '<div class="wsw-link-preview-title">任务预览：</div>' +
        '<div class="wsw-link-preview-row"><b>名称:</b> ' + this.esc(t.name || '') + '</div>' +
        '<div class="wsw-link-preview-row"><b>类型:</b> ' + (typeLabel[t.type] || t.type) + '</div>' +
        '<div class="wsw-link-preview-row"><b>批次:</b> ' + results.length + ' · <b>条目:</b> ' + totalItems + '</div>' +
        '<div class="wsw-link-preview-row"><b>上次运行:</b> ' + (t.lastRunAt ? new Date(t.lastRunAt).toLocaleString('zh-CN') : '从未') + '</div>';
    };
    if (card.taskId) previewTask(card.taskId);

    overlay.querySelector('#aiwfTaskSelect').addEventListener('change', (e) => {
      previewTask(e.target.value);
    });

    // 从卡片导入
    overlay.querySelector('#aiwfImportCardsBtn').addEventListener('click', async () => {
      const taskId = overlay.querySelector('#aiwfTaskSelect').value;
      if (!taskId) { App.showToast('请先选择关联任务'); return; }
      const modeRadio = overlay.querySelector('input[name="aiwfImportMode"]:checked');
      const importMode = modeRadio ? modeRadio.value : 'url';
      const t = tasks.find(x => String(x.id) === String(taskId));
      if (!t) { App.showToast('任务未找到'); return; }

      // 拉取卡片列表
      let cardList = [];
      try {
        const result = await window.electronAPI?.getWorkflows?.();
        if (result?.success) cardList = result.data || [];
      } catch (e) { App.showToast('加载卡片失败'); return; }
      if (!cardList.length) { App.showToast('暂无卡片'); return; }

      // 弹出卡片选择
      const pickModal = document.createElement('div');
      pickModal.className = 'wsw-link-overlay';
      pickModal.innerHTML = '<div class="wsw-link-panel" style="width:460px">' +
        '<div class="wsw-link-header"><span>🗂 选择卡片（模式：' + (importMode === 'url' ? 'URL' : '内容') + '）</span><button class="wsw-link-close">✕</button></div>' +
        '<div class="wsw-link-body"><div id="aiwfCardPickList" style="max-height:300px;overflow-y:auto;"></div></div>' +
        '<div class="wsw-link-footer"><button class="wsw-link-btn cancel-btn">取消</button><button class="wsw-link-btn save-btn primary">确认导入</button></div>' +
      '</div>';
      document.body.appendChild(pickModal);
      const pickListEl = pickModal.querySelector('#aiwfCardPickList');
      let pickedIds = new Set();
      pickListEl.innerHTML = cardList.map(w => {
        const id = this.esc(String(w.id ?? ''));
        const title = this.esc(w.title || '未命名');
        const url = this.esc(w.url || '');
        return '<div style="display:flex;gap:8px;align-items:center;padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;cursor:pointer;" data-pick-id="' + id + '">' +
          '<input type="checkbox" style="width:auto;" data-pick-cb="' + id + '">' +
          '<div style="flex:1;overflow:hidden;"><div style="font-size:13px;font-weight:600;">' + title + '</div>' +
          '<div style="font-size:11px;color:var(--text2);">' + (url || '(无URL)') + '</div></div></div>';
      }).join('');
      pickListEl.querySelectorAll('[data-pick-id]').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.dataset.pickId;
          const cb = item.querySelector('input[type="checkbox"]');
          if (pickedIds.has(id)) { pickedIds.delete(id); cb.checked = false; }
          else { pickedIds.add(id); cb.checked = true; }
        });
      });
      const closePick = () => pickModal.remove();
      pickModal.querySelector('.wsw-link-close').onclick = closePick;
      pickModal.querySelector('.cancel-btn').onclick = closePick;
      pickModal.addEventListener('click', (e) => { if (e.target === pickModal) closePick(); });

      pickModal.querySelector('.save-btn').addEventListener('click', async () => {
        const selectedCards = cardList.filter(w => pickedIds.has(String(w.id)));
        if (!selectedCards.length) { App.showToast('请选择卡片'); return; }
        closePick();

        // 获取内容或 URL
        const values = [];
        if (importMode === 'content') {
          for (const c of selectedCards) {
            try {
              const detail = await window.electronAPI?.getWorkflowDetail?.(c.id);
              const resources = (detail?.success && detail.data?.resources) || [];
              resources.forEach(r => { if (r.content) values.push(r.content); });
            } catch (e) { /* ignore */ }
          }
        } else {
          selectedCards.forEach(c => { if (c.url) values.push(c.url); });
        }
        if (!values.length) { App.showToast('所选卡片没有可导入的数据'); return; }

        // 更新任务配置
        const cfg = t.config || {};
        if (t.type === 'crosspage') {
          const existing = Array.isArray(cfg.urls) ? cfg.urls : ((typeof cfg.urls === 'string') ? cfg.urls.split('\n').map(s => s.trim()).filter(Boolean) : []);
          cfg.urls = Array.from(new Set([...existing, ...values]));
        } else if (t.type === 'batch' || t.type === 'tracking' || t.type === 'template') {
          cfg.url = values[0];
        }
        t.config = cfg;
        // 保存更新
        try {
          await window.electronAPI?.aiworkflowAPI?.update?.(String(t.id), { name: t.name, config: cfg });
          App.showToast('✓ 已导入 ' + values.length + ' 条' + (importMode === 'url' ? ' URL' : '内容') + ' 到任务「' + t.name + '」');
        } catch (e) {
          App.showToast('保存失败：' + (e.message || e));
        }
      });
    });

    const close = () => overlay.remove();
    overlay.querySelector('.wsw-link-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // 保存配置
    overlay.querySelector('.save-btn').addEventListener('click', () => {
      const name = overlay.querySelector('#aiwfName').value.trim();
      const taskId = overlay.querySelector('#aiwfTaskSelect').value;
      if (name) card.name = name;
      if (taskId) {
        const t = tasks.find(x => String(x.id) === String(taskId));
        card.taskId = taskId;
        card.taskName = t?.name || '';
        card.taskType = t?.type || null;
        card.taskDeleted = false;
      } else {
        card.taskId = null;
        card.taskName = null;
        card.taskType = null;
      }
      card.timestamp.lastUpdated = Date.now();
      this.renderCanvas();
      close();
      App.showToast('配置已保存');
    });

    // 立即运行
    overlay.querySelector('#aiwfRunNowBtn').addEventListener('click', async () => {
      const taskId = overlay.querySelector('#aiwfTaskSelect').value;
      if (!taskId) { App.showToast('请先选择任务'); return; }
      // 先保存配置
      const t = tasks.find(x => String(x.id) === String(taskId));
      card.taskId = taskId;
      card.taskName = t?.name || '';
      card.taskType = t?.type || null;
      card.taskDeleted = false;
      card.timestamp.lastUpdated = Date.now();
      close();
      await this.runAiworkflowContainer(cardId);
    });

    // 链式运行（含下游任务）
    overlay.querySelector('#aiwfChainRunBtn').addEventListener('click', async () => {
      const taskId = overlay.querySelector('#aiwfTaskSelect').value;
      if (!taskId) { App.showToast('请先选择任务'); return; }
      const t = tasks.find(x => String(x.id) === String(taskId));
      card.taskId = taskId;
      card.taskName = t?.name || '';
      card.taskType = t?.type || null;
      card.taskDeleted = false;
      card.timestamp.lastUpdated = Date.now();
      close();
      if (card.running) { App.showToast('该任务正在运行中，请稍候'); return; }
      card.running = true;
      this.renderCanvas();
      App.showToast('⏳ 链式运行中（含下游任务）...');
      try {
        const result = await window.electronAPI?.aiworkflowAPI?.chainRunTask?.(card.taskId);
        if (result?.success && Array.isArray(result.chainResults)) {
          const total = result.chainResults.length;
          const success = result.chainResults.filter(r => r.success).length;
          const totalItems = result.chainResults.reduce((s, r) => s + (r.itemCount || 0), 0);
          let msg = `✓ 链式运行完成：${success}/${total} 个任务成功`;
          if (totalItems > 0) msg += `，共 ${totalItems} 条结果`;
          const failed = total - success;
          if (failed > 0) {
            const failedNames = result.chainResults.filter(r => !r.success).map(r => r.taskName).join('、');
            msg += `（失败：${failedNames}）`;
          }
          App.showToast(msg);
        } else {
          App.showToast('✗ 链式运行失败：' + (result?.error || '未知错误'));
        }
      } catch (e) {
        App.showToast('✗ 链式运行异常：' + (e.message || e));
      } finally {
        card.running = false;
        this.renderCanvas();
      }
    });
  },

  // Task 16: 在容器内运行关联任务
  async runAiworkflowContainer(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || card.type !== 'aiworkflow') return;
    if (!card.taskId || card.taskDeleted) {
      App.showToast('未配置任务，请先点击 ⚙ 配置');
      return;
    }
    if (card.running) {
      App.showToast('该任务正在运行中，请稍候');
      return;
    }
    card.running = true;
    this.renderCanvas();
    App.showToast('⏳ 任务运行中...');
    try {
      const result = await window.electronAPI?.aiworkflowAPI?.runTask?.(card.taskId);
      if (result?.success) {
        // 拉取任务详情以提取前 3 条摘要
        let samples = [];
        let runAt = result.batchId ? new Date().toISOString() : null;
        try {
          const detail = await window.electronAPI?.aiworkflowAPI?.getDetail?.(card.taskId);
          if (detail?.success && detail.data) {
            const results = Array.isArray(detail.data.results) ? detail.data.results : [];
            const latest = results.find(b => b && b.batchId === result.batchId) || results[results.length - 1];
            if (latest) {
              runAt = latest.runAt || runAt;
              const items = Array.isArray(latest.items) ? latest.items : [];
              samples = items.slice(0, 3).map(it => {
                if (card.taskType === 'crosspage') {
                  const f = it.fields || {};
                  return Object.keys(f).map(k => k + ':' + String(f[k] || '').slice(0, 20)).join(' | ');
                }
                return (it.textContent || it.content || it.id || '').slice(0, 60);
              });
            }
          }
        } catch (e) { /* ignore */ }

        const itemCount = (typeof result.itemCount === 'number') ? result.itemCount : (result.count || 0);
        card.lastRunAt = runAt || new Date().toISOString();
        card.lastResultSummary = {
          itemCount: itemCount,
          runAt: card.lastRunAt,
          newCount: (typeof result.newCount === 'number') ? result.newCount : null,
          samples: samples
        };
        const newInfo = (typeof result.newCount === 'number') ? '（新增 ' + result.newCount + '）' : '';
        App.showToast('✓ 完成：' + itemCount + ' 条结果' + newInfo);
      } else {
        App.showToast('✗ 运行失败：' + (result?.error || '未知错误'));
      }
    } catch (e) {
      App.showToast('✗ 运行异常：' + (e.message || e));
    } finally {
      card.running = false;
      card.timestamp.lastUpdated = Date.now();
      this.renderCanvas();
    }
  },

  // Task 16: 查看完整结果——跳转到 AI 工作流模块
  openAiworkflowResultPanel(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || card.type !== 'aiworkflow' || !card.taskId) return;
    if (typeof App === 'undefined' || !App.switchModule) {
      App.showToast('无法切换到 AI 工作流模块');
      return;
    }
    const taskId = String(card.taskId);
    App.switchModule('aiworkflow');
    setTimeout(() => {
      try {
        if (typeof AIWorkflow === 'undefined') return;
        if (card.taskType && AIWorkflow.switchTab) {
          AIWorkflow.switchTab(card.taskType);
        }
        if (AIWorkflow.openResultPanel) {
          AIWorkflow.openResultPanel(taskId);
        }
      } catch (e) {
        App.showToast('打开结果面板失败：' + (e.message || e));
      }
    }, 300);
  },

  // 数据聚合：按 groupByCol 分组，对 valueCol 执行 op（count/sum/avg）
  _aggregateData(rawRows, groupByCol, valueCol, op) {
    if (!rawRows || rawRows.length < 2) return { labels: [], values: [] };
    const headers = rawRows[0];
    const groupIdx = Math.max(0, Math.min(groupByCol, headers.length - 1));
    const valueIdx = Math.max(0, Math.min(valueCol, headers.length - 1));
    const groups = {};
    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!row) continue;
      const key = String(row[groupIdx] != null ? row[groupIdx] : '(空)');
      const val = parseFloat(String(row[valueIdx] != null ? row[valueIdx] : '0').replace(/[^\d.-]/g, '')) || 0;
      if (!groups[key]) groups[key] = [];
      groups[key].push(val);
    }
    const labels = Object.keys(groups);
    const values = labels.map(k => {
      const arr = groups[k];
      if (op === 'sum') return arr.reduce((a, b) => a + b, 0);
      if (op === 'avg') return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      return arr.length; // count
    });
    return { labels, values };
  },

  // 数值分箱：把 values 按 binSize 分桶统计频次
  _binValues(values, binSize) {
    if (!binSize || binSize <= 0 || !values.length) return { labels: ['全部'], values: [values.length] };
    const max = Math.max(...values);
    const binCount = Math.ceil(max / binSize);
    const labels = [];
    const counts = [];
    for (let i = 0; i < binCount; i++) {
      const lo = i * binSize;
      const hi = (i + 1) * binSize;
      labels.push(lo + '-' + hi);
      counts.push(values.filter(v => v >= lo && v < hi).length);
    }
    return { labels, values: counts };
  },

  // 从源容器提取图表数据
  // chartCard 参数可选：若提供且带 chartConfig，则按聚合配置处理 Excel 数据
  _extractChartData(sourceCard, chartType, chartCard) {
    if (!sourceCard) return { labels: [], values: [] };

    if (sourceCard.type === 'excelContainer' && sourceCard.tableData) {
      // 若提供 chartCard.chartConfig，按聚合 + 分箱处理
      if (chartCard && chartCard.chartConfig) {
        const cfg = chartCard.chartConfig;
        const agg = this._aggregateData(sourceCard.tableData, cfg.groupByCol || 0, cfg.valueCol != null ? cfg.valueCol : 1, cfg.op || 'count');
        if (cfg.binSize && cfg.binSize > 0) {
          return this._binValues(agg.values, cfg.binSize);
        }
        return agg;
      }
      // Excel容器：第一列作为标签，第二列作为数值
      const data = sourceCard.tableData;
      const labels = [];
      const values = [];
      for (let r = 0; r < data.length; r++) {
        const label = data[r][0] || '';
        const valStr = data[r][1] !== undefined ? String(data[r][1]) : '';
        const val = parseFloat(valStr);
        if (label || !isNaN(val)) {
          labels.push(label || ('行' + (r + 1)));
          values.push(isNaN(val) ? 0 : val);
        }
      }
      return { labels: labels, values: values };
    } else if (sourceCard.type === 'textContainer' && sourceCard.textContent) {
      // 文本容器：词频统计
      const text = sourceCard.textContent;
      const words = this._tokenizeText(text);
      const freq = {};
      words.forEach(w => {
        if (w.length < 2) return;
        freq[w] = (freq[w] || 0) + 1;
      });
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
      if (chartType === 'wordcloud') {
        // 词云模式：取前30个词
        const top = sorted.slice(0, 30);
        return { labels: top.map(s => s[0]), values: top.map(s => s[1]) };
      } else {
        // 柱状图/饼图/折线图：词频统计，取前15个词
        const top = sorted.slice(0, 15);
        if (top.length > 0) {
          return { labels: top.map(s => s[0]), values: top.map(s => s[1]) };
        }
        // 无有效词汇时回退到基础统计
        const charCount = text.length;
        const wordCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length + (text.match(/[a-zA-Z]+/g) || []).length;
        const lineCount = text.split(/\r?\n/).length;
        return {
          labels: ['字符数', '词数', '行数'],
          values: [charCount, wordCount, lineCount]
        };
      }
    }
    return { labels: [], values: [] };
  },

  // 高频词提取（基于重复模式的真正词频统计）
  _tokenizeText(text) {
    const ngramFreq = {};
    // 英文单词直接提取
    const enMatches = text.match(/[a-zA-Z]{2,}/g);
    if (enMatches) enMatches.forEach(w => { ngramFreq[w.toLowerCase()] = (ngramFreq[w.toLowerCase()] || 0) + 1; });
    // 中文连续片段提取 2-4 字 n-gram
    const chineseChars = text.match(/[\u4e00-\u9fa5]+/g) || [];
    chineseChars.forEach(segment => {
      for (let len = 2; len <= 4 && len <= segment.length; len++) {
        for (let i = 0; i <= segment.length - len; i++) {
          const ngram = segment.substring(i, i + len);
          ngramFreq[ngram] = (ngramFreq[ngram] || 0) + 1;
        }
      }
    });
    // 过滤停用词
    const stopWords = new Set(['的','了','在','是','我','有','和','就','不','人','都','一','一个','上','也','很','到','说','要','去','你','会','着','没有','看','好','自己','这','他','她','它','们','那','些','什么','怎么','为什么','哪里','谁','哪','这个','那个','这样','那样','因为','所以','但是','而且','或者','如果','虽然','然后','可以','已经','正在','将','被','把','从','向','对','于','与','及','等','之','而','其','以','由','为','所','该','各','每','某','另','此','本','大','小','多','少','新','旧','长','短','高','低','前','后','左','右','下','里','外','中','间','旁','边','面','头','尾','端','部','分','点','些','个','只','条','张','片','块','册','页','行','列','排','组','套','类','种','样','式','型','号','码','数','量','度','次','回','遍','趟','阵','场','番','通','顿','遭','项','款','件','桩','宗','起','例','则','目']);
    // 只保留出现 ≥ 2 次的 n-gram（真正的"词"会重复出现，随机组合不会）
    const realWords = Object.entries(ngramFreq)
      .filter(([word, count]) => count >= 2 && !stopWords.has(word) && word.length >= 2)
      .sort((a, b) => b[1] - a[1]);
    // 去重：如果短词已被长词完全覆盖且频率相同，优先保留长词
    const result = [];
    const used = new Set();
    for (const [word, count] of realWords) {
      if (used.has(word)) continue;
      // 检查是否被更长的高频词覆盖
      let covered = false;
      for (const [longer, lcount] of realWords) {
        if (longer.length > word.length && longer.includes(word) && lcount >= count) {
          covered = true;
          break;
        }
      }
      if (!covered) {
        result.push(word);
        used.add(word);
      }
    }
    return result;
  },

  // 刷新统计图数据
  refreshChartData(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || card.type !== 'chartCard') return;
    // 内联模式：直接使用 inlineData
    if (card.inlineData) {
      card.chartData = { labels: (card.inlineData.labels || []).slice(), values: (card.inlineData.values || []).slice() };
      this.renderCanvas();
      setTimeout(() => this._renderChartCardCanvas(card), 50);
      App.showToast('统计图已刷新');
      return;
    }
    if (!card.sourceCardId) {
      App.showToast('未连接数据源，请先配置');
      return;
    }
    const sourceCard = this.state.doc.cards.find(c => c.id === card.sourceCardId);
    if (!sourceCard) {
      App.showToast('数据源容器已删除');
      card.sourceCardId = null;
      this.renderCanvas();
      return;
    }
    card.chartData = this._extractChartData(sourceCard, card.chartType, card);
    this.renderCanvas();
    setTimeout(() => this._renderChartCardCanvas(card), 50);
    App.showToast('统计图已刷新');
  },

  // 渲染统计图卡片的canvas
  _renderChartCardCanvas(card) {
    const canvas = document.getElementById('chartCard_' + card.id);
    if (!canvas) return;
    const data = card.chartData || { labels: [], values: [] };
    const chartType = card.chartType || 'bar';
    if (chartType === 'bar') this._drawChartBar(canvas, data);
    else if (chartType === 'pie') this._drawChartPie(canvas, data);
    else if (chartType === 'line') this._drawChartLine(canvas, data);
    else if (chartType === 'wordcloud') this._drawWordCloud(canvas, data);
  },

  // 绘制柱状图（统计图卡片专用）
  _drawChartBar(canvas, data) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 360;
    const h = canvas.offsetHeight || 220;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (!data.labels || data.labels.length === 0) {
      ctx.fillStyle = '#8888a8';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('无数据', w / 2, h / 2);
      return;
    }
    const padding = { top: 16, right: 12, bottom: 32, left: 36 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;
    const maxVal = Math.max(...data.values, 1);
    const barW = chartW / data.values.length * 0.6;
    const gap = chartW / data.values.length * 0.4;
    const colors = ['#4fc3f7', '#b39ddb', '#4dd0c8', '#ffd54f', '#ff8a65', '#f06292', '#7986cb', '#aed581'];

    // 坐标轴
    ctx.strokeStyle = '#8888a8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartH);
    ctx.lineTo(padding.left + chartW, padding.top + chartH);
    ctx.stroke();

    // 柱子
    data.values.forEach((val, i) => {
      const x = padding.left + i * (barW + gap) + gap / 2;
      const barH = (val / maxVal) * chartH;
      const y = padding.top + chartH - barH;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x, y, barW, barH);
      // 数值
      ctx.fillStyle = '#e0e0ee';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(val), x + barW / 2, y - 3);
      // 标签
      ctx.fillStyle = '#8888a8';
      ctx.font = '9px sans-serif';
      const label = data.labels[i].length > 6 ? data.labels[i].substring(0, 6) : data.labels[i];
      ctx.fillText(label, x + barW / 2, padding.top + chartH + 14);
    });
  },

  // 绘制饼图
  _drawChartPie(canvas, data) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 360;
    const h = canvas.offsetHeight || 220;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (!data.values || data.values.length === 0) {
      ctx.fillStyle = '#8888a8';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('无数据', w / 2, h / 2);
      return;
    }
    const total = data.values.reduce((a, v) => a + v, 0);
    if (total <= 0) return;
    const cx = w / 2 - 40;
    const cy = h / 2;
    const radius = Math.min(w - 100, h - 40) / 2;
    let startAngle = -Math.PI / 2;
    const colors = ['#4fc3f7', '#b39ddb', '#4dd0c8', '#ffd54f', '#ff8a65', '#f06292', '#7986cb', '#aed581'];

    data.values.forEach((val, i) => {
      const angle = (val / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, startAngle + angle);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      ctx.strokeStyle = '#16162a';
      ctx.lineWidth = 1;
      ctx.stroke();
      startAngle += angle;
    });

    // 图例
    const legendX = cx + radius + 16;
    let legendY = 12;
    ctx.font = '10px sans-serif';
    data.labels.forEach((label, i) => {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(legendX, legendY, 10, 10);
      ctx.fillStyle = '#e0e0ee';
      ctx.textAlign = 'left';
      const pct = ((data.values[i] / total) * 100).toFixed(1) + '%';
      const txt = (label.length > 6 ? label.substring(0, 6) : label) + ' ' + pct;
      ctx.fillText(txt, legendX + 14, legendY + 9);
      legendY += 16;
    });
  },

  // 绘制折线图
  _drawChartLine(canvas, data) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 360;
    const h = canvas.offsetHeight || 220;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (!data.values || data.values.length === 0) {
      ctx.fillStyle = '#8888a8';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('无数据', w / 2, h / 2);
      return;
    }
    const padding = { top: 16, right: 12, bottom: 32, left: 36 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;
    const maxVal = Math.max(...data.values, 1);
    const stepX = data.values.length > 1 ? chartW / (data.values.length - 1) : chartW;

    // 坐标轴
    ctx.strokeStyle = '#8888a8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartH);
    ctx.lineTo(padding.left + chartW, padding.top + chartH);
    ctx.stroke();

    // 折线
    ctx.strokeStyle = '#4fc3f7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.values.forEach((val, i) => {
      const x = padding.left + i * stepX;
      const y = padding.top + chartH - (val / maxVal) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 数据点
    ctx.fillStyle = '#b39ddb';
    data.values.forEach((val, i) => {
      const x = padding.left + i * stepX;
      const y = padding.top + chartH - (val / maxVal) * chartH;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      // 数值
      ctx.fillStyle = '#e0e0ee';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(val), x, y - 8);
      ctx.fillStyle = '#b39ddb';
      // 标签
      ctx.fillStyle = '#8888a8';
      ctx.font = '9px sans-serif';
      const label = data.labels[i].length > 6 ? data.labels[i].substring(0, 6) : data.labels[i];
      ctx.fillText(label, x, padding.top + chartH + 14);
      ctx.fillStyle = '#b39ddb';
    });
  },

  // 绘制词云（简化版）
  _drawWordCloud(canvas, data) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 360;
    const h = canvas.offsetHeight || 220;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (!data.labels || data.labels.length === 0) {
      ctx.fillStyle = '#8888a8';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('无数据', w / 2, h / 2);
      return;
    }
    const maxVal = Math.max(...data.values, 1);
    const colors = ['#4fc3f7', '#b39ddb', '#4dd0c8', '#ffd54f', '#ff8a65', '#f06292', '#7986cb', '#aed581'];
    const placed = [];
    const cx = w / 2;
    const cy = h / 2;

    data.labels.forEach((word, i) => {
      const freq = data.values[i];
      const size = 10 + (freq / maxVal) * 24;
      ctx.font = size + 'px sans-serif';
      const metrics = ctx.measureText(word);
      const tw = metrics.width;
      const th = size;

      // 螺旋放置算法
      let angle = i * 0.5;
      let radius = 0;
      let x = cx - tw / 2;
      let y = cy - th / 2;
      let attempts = 0;
      while (attempts < 60) {
        const overlap = placed.some(p =>
          x < p.x + p.w + 2 && x + tw + 2 > p.x &&
          y < p.y + p.h + 2 && y + th + 2 > p.y
        );
        if (!overlap) break;
        radius += 4;
        angle += 0.4;
        x = cx + Math.cos(angle) * radius - tw / 2;
        y = cy + Math.sin(angle) * radius - th / 2;
        attempts++;
      }
      placed.push({ x: x, y: y, w: tw, h: th });
      ctx.fillStyle = colors[i % colors.length];
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(word, x, y);
    });
  },

  // ===== 统计图配置面板 =====
  showChartConfigPanel(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || card.type !== 'chartCard') return;

    // 查找可选的源容器
    const sourceCards = this.state.doc.cards.filter(c => c.type === 'excelContainer' || c.type === 'textContainer');

    const chartTypes = [
      { id: 'bar', name: '柱状图', icon: '📊', desc: '对比各类别数据大小' },
      { id: 'pie', name: '饼图', icon: '🥧', desc: '显示各部分占比' },
      { id: 'line', name: '折线图', icon: '📈', desc: '展示数据变化趋势' },
      { id: 'wordcloud', name: '词云', icon: '☁️', desc: '文本词频可视化（仅文本源）' }
    ];

    const sourceOptions = sourceCards.length
      ? sourceCards.map(c => {
          const sel = c.id === card.sourceCardId ? ' selected' : '';
          const typeName = c.type === 'excelContainer' ? 'Excel' : '文本';
          return '<option value="' + c.id + '"' + sel + '>' + this.esc(typeName + ' - ' + (c.name || '容器')) + '</option>';
        }).join('')
      : '<option value="">（无可用容器）</option>';

    const chartTypeOptions = chartTypes.map(t => {
      const sel = t.id === (card.chartType || 'bar') ? ' selected' : '';
      return '<option value="' + t.id + '"' + sel + '>' + t.icon + ' ' + t.name + ' - ' + t.desc + '</option>';
    }).join('');

    // 数据模式：source=绑定源容器 / inline=直接数据
    const dataMode = card.inlineData ? 'inline' : 'source';
    const cfg = card.chartConfig || { groupByCol: 0, valueCol: 1, op: 'count', binSize: 0 };

    // 内联数据初始行（若已有 inlineData 用之，否则给 3 行空模板）
    let inlineRows = [];
    if (card.inlineData && card.inlineData.labels) {
      for (let i = 0; i < card.inlineData.labels.length; i++) {
        inlineRows.push([card.inlineData.labels[i] || '', card.inlineData.values[i] != null ? card.inlineData.values[i] : '']);
      }
    }
    if (!inlineRows.length) inlineRows = [['', ''], ['', ''], ['', '']];
    const inlineRowsHtml = inlineRows.map((r, i) =>
      '<tr data-row="' + i + '"><td><input type="text" class="wsw-config-input chartInlineLabel" value="' + this.esc(String(r[0] || '')) + '" placeholder="标签"></td>' +
      '<td><input type="number" class="wsw-config-input chartInlineValue" value="' + this.esc(String(r[1] || '')) + '" placeholder="数值"></td>' +
      '<td><button class="btn chartInlineDel" type="button">✕</button></td></tr>'
    ).join('');

    // 聚合方式选项
    const opOptions = ['count', 'sum', 'avg'].map(op =>
      '<option value="' + op + '"' + (cfg.op === op ? ' selected' : '') + '>' + op + '</option>'
    ).join('');

    const panel = document.createElement('div');
    panel.className = 'wsw-config-panel';
    panel.innerHTML = '<div class="wsw-config-mask" onclick="this.parentElement.remove()"></div>' +
      '<div class="wsw-config-dialog" style="max-width:560px">' +
        '<div class="wsw-config-header">' +
          '<span>📈 统计图配置</span>' +
          '<button class="wsw-config-close" onclick="this.closest(\'.wsw-config-panel\').remove()">✕</button>' +
        '</div>' +
        '<div class="wsw-config-body">' +
          '<div class="wsw-config-row">' +
            '<label>数据模式</label>' +
            '<label style="font-weight:normal"><input type="radio" name="chartDataMode_' + cardId + '" value="source" ' + (dataMode === 'source' ? 'checked' : '') + '> 绑定源容器</label> ' +
            '<label style="font-weight:normal"><input type="radio" name="chartDataMode_' + cardId + '" value="inline" ' + (dataMode === 'inline' ? 'checked' : '') + '> 直接数据</label>' +
            '<small style="color:var(--text2);display:block;margin-top:4px">绑定源容器：从 Excel/文本容器提取数据；直接数据：手动输入标签与数值</small>' +
          '</div>' +
          '<div class="wsw-config-row chart-source-section" style="' + (dataMode === 'source' ? '' : 'display:none') + '">' +
            '<label>数据源容器</label>' +
            '<select id="chartSource_' + cardId + '" class="wsw-config-select">' + sourceOptions + '</select>' +
            '<small style="color:var(--text2);display:block;margin-top:4px">选择 Excel容器（表格数据）或 文本容器（词频/字符统计）</small>' +
          '</div>' +
          '<div class="wsw-config-row chart-source-section" style="' + (dataMode === 'source' ? '' : 'display:none') + '">' +
            '<label>数据聚合（仅对 Excel 源生效）</label>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
              '<div><small>分组列</small><br><input type="number" id="chartGroupByCol_' + cardId + '" class="wsw-config-input" value="' + (cfg.groupByCol != null ? cfg.groupByCol : 0) + '" min="0" style="width:80px"></div>' +
              '<div><small>数值列</small><br><input type="number" id="chartValueCol_' + cardId + '" class="wsw-config-input" value="' + (cfg.valueCol != null ? cfg.valueCol : 1) + '" min="0" style="width:80px"></div>' +
              '<div><small>聚合方式</small><br><select id="chartOp_' + cardId + '" class="wsw-config-select" style="width:96px">' + opOptions + '</select></div>' +
              '<div><small>分箱大小（0=不分箱）</small><br><input type="number" id="chartBinSize_' + cardId + '" class="wsw-config-input" value="' + (cfg.binSize != null ? cfg.binSize : 0) + '" min="0" step="any" style="width:100px"></div>' +
            '</div>' +
            '<small style="color:var(--text2);display:block;margin-top:4px">分组列默认第1列(0基)，数值列默认第2列；分箱对聚合后的数值再分桶统计</small>' +
          '</div>' +
          '<div class="wsw-config-row chart-inline-section" style="' + (dataMode === 'inline' ? '' : 'display:none') + '">' +
            '<label>内联数据（标签 / 数值）</label>' +
            '<table class="wsw-excel-grid-table" style="width:100%"><tbody id="chartInlineTable_' + cardId + '">' + inlineRowsHtml + '</tbody></table>' +
            '<div style="margin-top:6px"><button class="btn" type="button" id="chartInlineAddRow_' + cardId + '">+ 添加行</button></div>' +
          '</div>' +
          '<div class="wsw-config-row">' +
            '<label>图表类型</label>' +
            '<select id="chartType_' + cardId + '" class="wsw-config-select">' + chartTypeOptions + '</select>' +
          '</div>' +
          '<div class="wsw-config-row">' +
            '<label>卡片名称</label>' +
            '<input type="text" id="chartName_' + cardId + '" class="wsw-config-input" value="' + this.esc(card.name || '统计图') + '" placeholder="输入卡片名称">' +
          '</div>' +
        '</div>' +
        '<div class="wsw-config-footer">' +
          '<button class="btn" onclick="this.closest(\'.wsw-config-panel\').remove()">取消</button>' +
          '<button class="btn btn-primary" onclick="WSWEditor.applyChartConfig(' + cardId + ')">应用</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);

    // 数据模式切换：显示/隐藏 source / inline 段
    const radios = panel.querySelectorAll('input[name="chartDataMode_' + cardId + '"]');
    radios.forEach(r => r.addEventListener('change', (e) => {
      const mode = e.target.value;
      panel.querySelectorAll('.chart-source-section').forEach(el => el.style.display = (mode === 'source' ? '' : 'none'));
      panel.querySelectorAll('.chart-inline-section').forEach(el => el.style.display = (mode === 'inline' ? '' : 'none'));
    }));

    // 内联表：添加/删除行
    const inlineTable = panel.querySelector('#chartInlineTable_' + cardId);
    panel.querySelector('#chartInlineAddRow_' + cardId).addEventListener('click', () => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><input type="text" class="wsw-config-input chartInlineLabel" placeholder="标签"></td>' +
        '<td><input type="number" class="wsw-config-input chartInlineValue" placeholder="数值"></td>' +
        '<td><button class="btn chartInlineDel" type="button">✕</button></td>';
      inlineTable.appendChild(tr);
    });
    inlineTable.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.chartInlineDel');
      if (!delBtn) return;
      const tr = delBtn.closest('tr');
      if (tr && inlineTable.querySelectorAll('tr').length > 1) tr.remove();
    });
  },

  // 应用统计图配置
  applyChartConfig(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card) return;
    const panel = document.querySelector('.wsw-config-panel');
    if (!panel) return;
    const modeRadio = panel.querySelector('input[name="chartDataMode_' + cardId + '"]:checked');
    const dataMode = modeRadio ? modeRadio.value : 'source';
    const typeSel = document.getElementById('chartType_' + cardId);
    const nameInput = document.getElementById('chartName_' + cardId);
    if (!typeSel) return;
    this.saveUndo();
    card.chartType = typeSel.value;
    card.name = nameInput ? (nameInput.value || '统计图') : '统计图';

    if (dataMode === 'inline') {
      // 内联模式：从表读取 labels/values
      const labels = [];
      const values = [];
      const rows = panel.querySelectorAll('#chartInlineTable_' + cardId + ' tr');
      rows.forEach(tr => {
        const labelInput = tr.querySelector('.chartInlineLabel');
        const valueInput = tr.querySelector('.chartInlineValue');
        if (!labelInput || !valueInput) return;
        const label = (labelInput.value || '').trim();
        const valStr = (valueInput.value || '').trim();
        if (!label && !valStr) return;
        labels.push(label || ('项' + (labels.length + 1)));
        const val = parseFloat(valStr);
        values.push(isNaN(val) ? 0 : val);
      });
      card.inlineData = { labels: labels, values: values };
      card.sourceCardId = null;
      card.chartConfig = null;
    } else {
      // 源模式：读取源容器 + 聚合配置
      const sourceSel = document.getElementById('chartSource_' + cardId);
      const groupByInput = document.getElementById('chartGroupByCol_' + cardId);
      const valueColInput = document.getElementById('chartValueCol_' + cardId);
      const opSel = document.getElementById('chartOp_' + cardId);
      const binSizeInput = document.getElementById('chartBinSize_' + cardId);
      if (sourceSel && sourceSel.value) {
        card.sourceCardId = parseInt(sourceSel.value, 10);
      } else {
        card.sourceCardId = null;
      }
      card.inlineData = null;
      card.chartConfig = {
        groupByCol: groupByInput ? Math.max(0, parseInt(groupByInput.value, 10) || 0) : 0,
        valueCol: valueColInput ? Math.max(0, parseInt(valueColInput.value, 10) || 1) : 1,
        op: opSel ? opSel.value : 'count',
        binSize: binSizeInput ? (parseFloat(binSizeInput.value) || 0) : 0
      };
    }
    card.timestamp.lastUpdated = Date.now();
    panel.remove();
    this.renderCanvas();
    setTimeout(() => this._renderChartCardCanvas(card), 50);
    App.showToast('统计图配置已应用');
  },

  // Excel单元格编辑后保存
  onExcelCellEdit(el) {
    if (!this.state.doc) return;
    const cardId = parseInt(el.dataset.card);
    const idx = parseInt(el.dataset.idx);
    const field = el.dataset.field;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || !card.items || idx < 0 || idx >= card.items.length) return;
    card.items[idx][field] = el.innerText || el.textContent || '';
    card.timestamp.lastUpdated = Date.now();
    // 如果当前是图表视图，刷新图表
    if (card.viewMode === 'chart') {
      this.renderCanvas();
    }
  },

  // Excel网格单元格编辑
  onExcelGridEdit(el) {
    if (!this.state.doc) return;
    const cardId = parseInt(el.dataset.card);
    const r = parseInt(el.dataset.r);
    const c = parseInt(el.dataset.c);
    const card = this.state.doc.cards.find(c2 => c2.id === cardId);
    if (!card || !card.tableData) return;
    if (!card.tableData[r]) card.tableData[r] = [];
    card.tableData[r][c] = el.innerText || el.textContent || '';
    card.timestamp.lastUpdated = Date.now();
  },

  // Excel添加行
  excelAddRow(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card) return;
    card.tableRows = (card.tableRows || 5) + 1;
    if (!card.tableData) card.tableData = [];
    const cols = card.tableCols || 3;
    card.tableData.push(new Array(cols).fill(''));
    this.renderCanvas();
  },

  // Excel删除行
  excelDelRow(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || !card.tableData || card.tableData.length <= 1) return;
    card.tableRows = Math.max(1, card.tableRows - 1);
    card.tableData.pop();
    this.renderCanvas();
  },

  // Excel添加列
  excelAddCol(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card) return;
    card.tableCols = (card.tableCols || 3) + 1;
    if (!card.tableData) card.tableData = [];
    for (let r = 0; r < card.tableData.length; r++) {
      card.tableData[r].push('');
    }
    this.renderCanvas();
  },

  // Excel删除列
  excelDelCol(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || !card.tableData || card.tableCols <= 1) return;
    card.tableCols = Math.max(1, card.tableCols - 1);
    for (let r = 0; r < card.tableData.length; r++) {
      card.tableData[r].pop();
    }
    this.renderCanvas();
  },

  // Excel切换视图
  toggleExcelView(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card) return;
    card.viewMode = card.viewMode === 'table' ? 'chart' : 'table';
    this.renderCanvas();
    if (card.viewMode === 'chart') {
      setTimeout(() => this._renderExcelChart(card), 50);
    }
  },

  // 渲染Excel统计图
  _renderExcelChart(card) {
    const canvas = document.getElementById('excelChart_' + card.id);
    if (!canvas || !card.tableData) return;
    const ctx = canvas.getContext('2d');
    const data = card.tableData;
    if (!data || data.length === 0) return;
    
    // 简单柱状图：第一列作为标签，第二列作为数值
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const labels = [];
    const values = [];
    for (let r = 0; r < data.length; r++) {
      if (data[r][0]) labels.push(data[r][0]);
      if (data[r][1]) {
        const v = parseFloat(data[r][1]);
        values.push(isNaN(v) ? 0 : v);
      }
    }
    
    if (values.length === 0) {
      ctx.fillStyle = '#888';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('请输入数据（第1列=标签，第2列=数值）', canvas.width/2, canvas.height/2);
      return;
    }
    
    const maxVal = Math.max(...values, 1);
    const barWidth = Math.min(40, (canvas.width - 60) / values.length - 10);
    const chartHeight = canvas.height - 60;
    const startX = 40;
    
    // 绘制坐标轴
    ctx.strokeStyle = '#555';
    ctx.beginPath();
    ctx.moveTo(startX, 10);
    ctx.lineTo(startX, chartHeight + 10);
    ctx.lineTo(canvas.width - 10, chartHeight + 10);
    ctx.stroke();
    
    // 绘制柱状图
    const colors = ['#e94560', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e74c3c', '#f1c40f'];
    for (let i = 0; i < values.length; i++) {
      const barHeight = (values[i] / maxVal) * chartHeight;
      const x = startX + 10 + i * (barWidth + 10);
      const y = chartHeight + 10 - barHeight;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x, y, barWidth, barHeight);
      
      // 标签
      ctx.fillStyle = '#ccc';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      const label = labels[i] || ('' + (i+1));
      ctx.fillText(label.length > 4 ? label.substring(0,4) : label, x + barWidth/2, chartHeight + 25);
      
      // 数值
      ctx.fillStyle = '#fff';
      ctx.fillText('' + values[i], x + barWidth/2, y - 5);
    }
    
    // 标题
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('数据统计图', 10, 20);
  },

  // 图表颜色
  _getChartColor(type) {
    const colors = { image: '#3498db', video: '#e74c3c', audio: '#9b59b6', link: '#2ecc71', text: '#f39c12' };
    return colors[type] || '#95a5a6';
  },

  // 格式化字节
  _formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  },

  // 渲染画布上的图表（renderCanvas后调用）
  _renderCharts() {
    document.querySelectorAll('canvas[data-chart-type]').forEach(canvas => {
      // 统计图卡片canvas（id以chartCard_开头，数据源存储在card.chartData）
      if (canvas.id && canvas.id.indexOf('chartCard_') === 0) {
        const cardId = parseInt(canvas.id.substring(10), 10);
        const card = this.state.doc.cards.find(c => c.id === cardId);
        if (card) this._renderChartCardCanvas(card);
        return;
      }
      // Excel容器的图表canvas
      const type = canvas.dataset.chartType;
      const data = JSON.parse(canvas.dataset.chartData || '[]');
      if (type === 'bar') this._drawBarChart(canvas, data);
      else if (type === 'pie') this._drawPieChart(canvas, data);
    });
  },

  // 绘制柱状图
  _drawBarChart(canvas, data) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 300;
    const h = canvas.offsetHeight || 120;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (!data || data.length === 0) return;
    const padding = { top: 8, right: 8, bottom: 20, left: 24 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;
    const maxVal = Math.max(...data.map(d => d.value || 0), 1);
    const barW = chartW / data.length * 0.6;
    const gap = chartW / data.length * 0.4;

    // 坐标轴
    ctx.strokeStyle = '#8888a8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartH);
    ctx.lineTo(padding.left + chartW, padding.top + chartH);
    ctx.stroke();

    // 柱子
    data.forEach((d, i) => {
      const x = padding.left + i * (barW + gap) + gap / 2;
      const barH = (d.value / maxVal) * chartH;
      const y = padding.top + chartH - barH;
      const color = d.color || this._getChartColor(d.label.split(' ')[1]) || '#4fc3f7';
      ctx.fillStyle = color;
      ctx.fillRect(x, y, barW, barH);

      // 数值
      ctx.fillStyle = '#e0e0ee';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      const valText = d.display || String(d.value);
      ctx.fillText(valText, x + barW / 2, y - 3);

      // 标签
      ctx.fillStyle = '#8888a8';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      const label = d.label.length > 8 ? d.label.substring(0, 8) : d.label;
      ctx.fillText(label, x + barW / 2, padding.top + chartH + 12);
    });
  },

  // 绘制饼图
  _drawPieChart(canvas, data) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 300;
    const h = canvas.offsetHeight || 120;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (!data || data.length === 0) return;
    const total = data.reduce((a, d) => a + (d.value || 0), 0);
    if (total <= 0) return;

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2 - 8;
    let startAngle = -Math.PI / 2;

    data.forEach(d => {
      const angle = (d.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, startAngle + angle);
      ctx.closePath();
      const color = d.color || this._getChartColor(d.label.split(' ')[1]) || '#4fc3f7';
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 1;
      ctx.stroke();
      startAngle += angle;
    });
  },

  // 刷新Excel统计数据
  async refreshExcelStats(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || card.type !== 'excelContainer') return;
    const dl = card.workflowDownload;
    if (!dl || !dl.workflowId) {
      App.showToast('未配置工作流数据源');
      return;
    }
    App.showToast('正在加载数据...');
    try {
      if (!window.electronAPI?.getWorkflowDetail) return;
      const result = await window.electronAPI.getWorkflowDetail(dl.workflowId);
      if (!result.success || !result.data || !result.data.resources) {
        App.showToast('获取工作流数据失败');
        return;
      }
      const resources = result.data.resources || [];
      // 只导入图片、文本、超链接
      const validTypes = ['image', 'text', 'link'];
      const newItems = [];
      resources.forEach(r => {
        if (r.type === 'image') {
          newItems.push({ type: 'image', url: r.url, name: r.name || '图片', size: r.size || 0 });
        } else if (r.type === 'text') {
          newItems.push({ type: 'text', content: r.content || r.text || '', name: r.name || '文本', url: r.url, size: r.size || 0 });
        } else if (r.type === 'link') {
          newItems.push({ type: 'link', url: r.url, name: r.name || r.url || '链接', size: r.size || 0 });
        }
      });
      card.items = newItems;

      // 将资源按顺序填入 tableData 网格（逐行填充）
      const rows = card.tableRows || 5;
      const cols = card.tableCols || 3;
      if (!card.tableData || card.tableData.length !== rows) {
        card.tableData = [];
        for (let r = 0; r < rows; r++) {
          card.tableData[r] = new Array(cols).fill('');
        }
      }
      let idx = 0;
      for (let r = 0; r < rows && idx < newItems.length; r++) {
        for (let c = 0; c < cols && idx < newItems.length; c++) {
          const item = newItems[idx];
          const icon = { image: '🖼️', text: '📝', link: '🔗' }[item.type] || '📄';
          card.tableData[r][c] = icon + ' ' + (item.name || '');
          idx++;
        }
      }
      dl.resourceCount = newItems.length;

      // 统计数据
      const typeCount = {};
      const typeSize = {};
      newItems.forEach(item => {
        typeCount[item.type] = (typeCount[item.type] || 0) + 1;
        typeSize[item.type] = (typeSize[item.type] || 0) + (item.size || 0);
      });
      card.statsData = {
        total: newItems.length,
        typeCount: typeCount,
        typeSize: typeSize,
        workflowTitle: result.data.title || '',
        updatedAt: Date.now()
      };
      card.timestamp.lastUpdated = Date.now();
      dl.lastDownloadAt = Date.now();
      dl.downloadStatus = 'done';
      this.renderCanvas();
      if (card.viewMode === 'chart') {
        setTimeout(() => this._renderExcelChart(card), 50);
      }
      App.showToast('已加载 ' + newItems.length + ' 个资源（图片/文本/超链接）');
    } catch (e) {
      console.error('refreshExcelStats error:', e);
      App.showToast('加载失败: ' + e.message);
    }
  },

  // Excel容器配置面板
  async showExcelConfigPanel(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || card.type !== 'excelContainer') return;

    let workflows = [];
    if (window.electronAPI?.getWorkflows) {
      const result = await window.electronAPI.getWorkflows();
      if (result.success) workflows = result.data || [];
    }

    const overlay = document.createElement('div');
    overlay.className = 'wsw-link-overlay';
    const dl = card.workflowDownload || {};

    overlay.innerHTML = '<div class="wsw-link-panel" style="width:480px">' +
      '<div class="wsw-link-header"><span>📊 Excel统计容器配置</span><button class="wsw-link-close">✕</button></div>' +
      '<div class="wsw-link-body">' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">容器名称</label>' +
          '<input type="text" id="excelName" value="' + this.esc(card.name) + '" class="wsw-link-input">' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">工作流数据源</label>' +
          '<select id="excelWorkflowSelect" class="wsw-link-select">' +
            '<option value="">-- 请选择 --</option>' +
            workflows.map(wf => '<option value="' + wf.id + '"' + (dl.workflowId === wf.id ? ' selected' : '') + '>' +
              this.esc((wf.title || '未命名') + ' (' + (wf.resources?.length || wf.resourceCount || 0) + '个资源)') + '</option>'
            ).join('') +
          '</select>' +
          '<div class="wsw-link-hint">统计所选工作流中所有资源的类型、数量和大小</div>' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">TTL 过期时间（毫秒，留空=全局默认，0=永不过期）</label>' +
          '<input type="text" id="excelTTL" value="' + (card.timestamp?.ttl !== null && card.timestamp?.ttl !== undefined ? card.timestamp.ttl : '') + '" placeholder="如 3600000=1小时" class="wsw-link-input">' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-checkbox-label">' +
            '<input type="checkbox" id="excelAutoRefresh" ' + (dl.autoDownload ? 'checked' : '') + '>' +
            '<span>自动刷新（打开文件时自动更新过期数据）</span>' +
          '</label>' +
        '</div>' +
        '<div class="wsw-link-preview" id="excelPreview"></div>' +
      '</div>' +
      '<div class="wsw-link-footer">' +
        '<button class="wsw-link-btn import-btn">📂 导入数据</button>' +
        '<button class="wsw-link-btn refresh-btn">🔄 立即加载</button>' +
        '<button class="wsw-link-btn cancel-btn">取消</button>' +
        '<button class="wsw-link-btn save-btn primary">保存</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);

    // 预览工作流资源概况
    const previewWf = async (wfId) => {
      const preview = document.getElementById('excelPreview');
      if (!wfId) { preview.innerHTML = ''; return; }
      if (!window.electronAPI?.getWorkflowDetail) return;
      const result = await window.electronAPI.getWorkflowDetail(wfId);
      if (!result.success) return;
      const resources = result.data.resources || [];
      const typeCount = {};
      resources.forEach(r => { typeCount[r.type] = (typeCount[r.type] || 0) + 1; });
      preview.innerHTML = '<div class="wsw-link-preview-title">资源预览：</div>' +
        '<div class="wsw-link-preview-row"><b>标题:</b> ' + this.esc(result.data.title || '') + '</div>' +
        '<div class="wsw-link-preview-row"><b>总数:</b> ' + resources.length + '</div>' +
        '<div class="wsw-link-preview-row"><b>类型分布:</b> ' + Object.entries(typeCount).map(([k, v]) => k + '=' + v).join(', ') + '</div>';
    };

    if (dl.workflowId) previewWf(dl.workflowId);

    document.getElementById('excelWorkflowSelect').addEventListener('change', (e) => {
      previewWf(e.target.value);
    });

    const close = () => overlay.remove();
    overlay.querySelector('.wsw-link-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.import-btn').addEventListener('click', async () => {
      close();
      await this.importTableData(cardId);
    });

    overlay.querySelector('.save-btn').addEventListener('click', async () => {
      const name = document.getElementById('excelName').value.trim();
      const wfId = document.getElementById('excelWorkflowSelect').value;
      const autoRefresh = document.getElementById('excelAutoRefresh').checked;
      const ttlStr = document.getElementById('excelTTL').value.trim();
      if (name) card.name = name;

      if (wfId) {
        const wf = workflows.find(w => w.id === wfId);
        card.workflowDownload = {
          workflowId: wfId,
          workflowTitle: wf?.title || '',
          autoDownload: autoRefresh,
          lastDownloadAt: card.workflowDownload?.lastDownloadAt || null,
          downloadStatus: 'idle'
        };
        card.workflowLink = {
          workflowId: wfId,
          cardIndex: 0,
          resourceType: 'all',
          autoRefresh: autoRefresh
        };
      } else {
        card.workflowDownload = null;
        card.workflowLink = null;
      }

      if (ttlStr === '') card.timestamp.ttl = null;
      else { const ttl = parseInt(ttlStr); card.timestamp.ttl = isNaN(ttl) ? null : ttl; }

      this.renderCanvas();
      close();
      App.showToast('配置已保存');

      // 如果配置了工作流，立即加载统计数据
      if (wfId) {
        setTimeout(() => this.refreshExcelStats(cardId), 200);
      }
    });

    overlay.querySelector('.refresh-btn').addEventListener('click', async () => {
      const wfId = document.getElementById('excelWorkflowSelect').value;
      if (!wfId) { App.showToast('请先选择工作流'); return; }
      // 先保存配置
      const wf = workflows.find(w => w.id === wfId);
      card.workflowDownload = {
        workflowId: wfId,
        workflowTitle: wf?.title || '',
        autoDownload: document.getElementById('excelAutoRefresh').checked,
        lastDownloadAt: null,
        downloadStatus: 'idle'
      };
      card.workflowLink = {
        workflowId: wfId, cardIndex: 0, resourceType: 'all',
        autoRefresh: document.getElementById('excelAutoRefresh').checked
      };
      close();
      await this.refreshExcelStats(cardId);
    });
  },

  // 导入数据文件到 Excel 容器（CSV/TSV/TXT/JSON/XLSX/XLS）
  async importTableData(cardId) {
    if (!this.state.doc) return;
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || card.type !== 'excelContainer') return;
    try {
      if (!window.electronAPI?.selectOpenFile) {
        App.showToast('当前环境不支持文件选择');
        return;
      }
      const filePath = await window.electronAPI.selectOpenFile({
        title: '选择数据文件',
        filters: [{ name: '数据文件', extensions: ['csv', 'tsv', 'txt', 'json', 'xlsx', 'xls'] }]
      });
      if (!filePath) return;
      App.showToast('正在解析数据文件...');
      if (!window.electronAPI?.parseSpreadsheet) {
        App.showToast('当前环境不支持表格解析');
        return;
      }
      const result = await window.electronAPI.parseSpreadsheet(filePath);
      if (!result || !result.success || !result.data || !result.data.rows || !result.data.rows.length) {
        App.showToast('解析失败: ' + (result?.error || '文件为空'));
        return;
      }
      const rows = result.data.rows;
      // 规范化：保证二维数组每行长度一致（按最大列数补齐）
      const maxCols = rows.reduce((m, r) => Math.max(m, r ? r.length : 0), 0);
      const normalized = rows.map(r => {
        const arr = (r || []).map(c => (c == null ? '' : String(c)));
        while (arr.length < maxCols) arr.push('');
        return arr;
      });
      card.tableData = normalized;
      card.tableRows = normalized.length;
      card.tableCols = maxCols || 1;
      this.renderCanvas();
      App.showToast('已导入 ' + normalized.length + ' 行 × ' + (maxCols || 1) + ' 列 数据');
    } catch (e) {
      console.error('importTableData error:', e);
      App.showToast('导入失败: ' + e.message);
    }
  },

  // ===== 事件绑定 =====
  bindCardEvents(el, card) {
    // 拖拽（header）- 统一从卡片头部拖拽
    const header = el.querySelector('[data-action="drag"]');
    if (header) {
      header.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (this.state.editingCardId !== null) return;
        // 检查是否点击了头部内的按钮（如配置、删除等），这些按钮有独立的 data-action
        const actionBtn = e.target.closest('.wsw-md-btn');
        if (actionBtn) return; // 点击了按钮，不拖拽
        e.preventDefault();
        e.stopPropagation();
        this.selectCard(card.id, e.ctrlKey || e.metaKey);
        this.startDrag(e, card);
      });
    }

    // 形状/容器整体可拖拽（点击任意位置先提到最前，解决堆叠遮挡问题）
    if (card.type === 'shape' || ['videoContainer', 'audioContainer', 'textContainer', 'excelContainer', 'chartCard', 'aiworkflow'].includes(card.type)) {
      el.addEventListener('mousedown', (e) => {
        // 检查是否有暂存的工作流链接
        if (App.state.pendingWswLink && ['videoContainer', 'audioContainer', 'textContainer', 'excelContainer'].includes(card.type)) {
          e.preventDefault();
          e.stopPropagation();
          // 应用暂存链接
          const link = App.state.pendingWswLink;
          const expectedType = card.type === 'videoContainer' ? 'video' : card.type === 'audioContainer' ? 'audio' : 'text';
          card.workflowLink = {
            workflowId: link.workflowId,
            cardIndex: link.cardIndex,
            resourceType: expectedType,
            autoRefresh: true
          };
          const pendingInfo = App.state.pendingWswLink;
          App.state.pendingWswLink = null;
          // 移除高亮样式
          document.querySelectorAll('.wsw-container.pending-link').forEach(c => c.classList.remove('pending-link'));
          this.refreshContainerResource(card.id).then(ok => {
            this.renderCanvas();
            if (ok) {
              App.showToast('已链接资源: ' + (pendingInfo.resourceInfo?.name || ''));
            } else {
              App.showToast('链接失败：无法获取资源');
            }
          });
          return;
        }
        if (e.button !== 0) return;
        if (this.state.editingCardId !== null) return;
        // 点击卡片任意位置先提到最前面（解决堆叠遮挡）
        this.selectCard(card.id, e.ctrlKey || e.metaKey);
        // 以下元素不触发拖拽
        if (e.target.closest('[data-action]')) return;
        if (e.target.classList.contains('wsw-resize')) return;
        if (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO') return;
        if (e.target.closest('video') || e.target.closest('audio')) return;
        if (e.target.tagName === 'WEBVIEW' || e.target.closest('webview')) return;
        if (e.target.tagName === 'A') return;
        if (e.target.closest('[contenteditable="true"]')) return;
        e.preventDefault();
        e.stopPropagation();
        this.startDrag(e, card);
      });
    }

    // resize
    const rh = el.querySelector('[data-action="resize"]');
    if (rh) {
      rh.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.startResize(e, card);
      });
    }

    // webview自动播放注入（视频容器在线播放模式）
    if (card.type === 'videoContainer' && card.webviewPlaying) {
      const webview = el.querySelector('webview');
      if (webview) {
        // 阻止webview区域的拖拽事件，让用户可以正常操作网页
        webview.addEventListener('mousedown', (e) => e.stopPropagation());
        // 注入自动播放脚本
        this._injectWebviewAutoplay(webview, card.id);
      }
    }

    // 双击编辑（仅文字框和形状）
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (card.type === 'textbox') {
        this.enterTextEdit(card.id);
      } else if (card.type === 'table') {
        App.showToast('点击单元格直接编辑');
      } else if (card.type === 'shape') {
        const colors = ['#e94560', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e74c3c'];
        const idx = colors.indexOf(card.color);
        card.color = colors[(idx + 1) % colors.length];
        this.renderCanvas();
      }
      // 容器类型不再响应双击，统一通过 ⚙ 按钮配置
    });

    // 工具栏按钮
    el.querySelectorAll('[data-action]').forEach(btn => {
      if (btn.dataset.action === 'drag' || btn.dataset.action === 'resize') return;
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = parseInt(btn.dataset.id, 10);
        const view = btn.dataset.view;
        if (action === 'setViewMode' && view) {
          const card2 = this.state.doc.cards.find(c => c.id === id);
          if (card2) {
            card2.viewMode = view;
            this.renderCanvas();
            if (view === 'chart') {
              setTimeout(() => this._renderCharts(), 0);
            }
          }
        } else {
          this.handleAction(action, id);
        }
      });
    });

    // 表格单元格
    if (card.type === 'table') {
      el.querySelectorAll('[contenteditable="true"]').forEach(cell => {
        cell.addEventListener('mousedown', (e) => e.stopPropagation());
        cell.addEventListener('blur', () => {
          this.saveTableCell(card);
        });
      });
    }

    // 文字框 body 阻止冒泡（编辑模式下）
    if (card.type === 'textbox' && card.mdView === false) {
      const body = el.querySelector('.wsw-card-body');
      if (body) {
        body.addEventListener('mousedown', (e) => e.stopPropagation());
      }
    }
  },

  handleAction(action, id) {
    const card = this.state.doc.cards.find(c => c.id === id);
    if (!card) return;
    if (action === 'edit') {
      this.enterTextEdit(id);
    } else if (action === 'preview') {
      this.commitEdit();
      card.mdView = true;
      this.renderCanvas();
    } else if (['addRow', 'addCol', 'delRow', 'delCol'].includes(action)) {
      this.tableOp(card, action);
    } else if (action === 'refreshContainer') {
      // 刷新容器资源（根据来源类型）
      if (card.sourceType === 'local') {
        // 本地文件重新加载
        if (card.localPath) {
          this.chooseLocalFile(id);
        } else {
          App.showToast('未配置本地文件');
        }
      } else if (card.sourceType === 'url') {
        // 网络URL重新加载
        if (card.urlSource) {
          this.setUrlSource(id, card.urlSource);
          App.showToast('已重新加载网络URL');
        } else {
          App.showToast('未配置网络URL');
        }
      } else {
        // 工作流链接刷新
        if (!card.workflowLink) {
          App.showToast('未配置工作流链接');
          return;
        }
        App.showToast('正在刷新...');
        this.refreshContainerResource(card.id).then(ok => {
          if (ok) {
            this.renderCanvas();
            App.showToast('资源已刷新');
          } else {
            App.showToast('刷新失败：无法获取资源');
          }
        });
      }
    } else if (action === 'chooseLocal') {
      // 选择本地文件
      this.chooseLocalFile(id);
    } else if (action === 'setUrl') {
      // 输入网络URL
      this.showUrlInputPanel(id);
    } else if (action === 'configVideo') {
      // 视频容器配置面板（仅视频）
      this.showVideoConfigPanel(id);
    } else if (action === 'configAudio') {
      // 音频容器配置面板（仅音频）
      this.showAudioConfigPanel(id);
    } else if (action === 'configText') {
      // 文本容器配置面板（图片/文本/超链接）
      this.showTextConfigPanel(id);
    } else if (action === 'downloadNow') {
      // 立即从工作流下载资源到本地
      this.downloadNow(id);
    } else if (action === 'configDownload') {
      // 配置工作流下载源
      this.showVideoConfigPanel(id, 'download');
    } else if (action === 'configExcel') {
      // Excel容器配置
      this.showExcelConfigPanel(id);
    } else if (action === 'refreshExcel') {
      // 刷新Excel统计数据
      this.refreshExcelStats(id);
    } else if (action === 'refreshTextWorkflow') {
      // 刷新文本容器的工作流资源
      this.refreshTextWorkflow(id);
    } else if (action === 'setViewMode') {
      // 切换Excel容器视图模式
      const card2 = this.state.doc.cards.find(c => c.id === id);
      if (card2) {
        card2.viewMode = card2.viewMode === 'table' ? 'chart' : 'table';
        this.renderCanvas();
        if (card2.viewMode === 'chart') {
          setTimeout(() => this._renderCharts(), 0);
        }
      }
    } else if (action === 'excelAddRow') {
      // Excel容器添加行
      this.excelAddRow(id);
    } else if (action === 'excelDelRow') {
      // Excel容器删除行
      this.excelDelRow(id);
    } else if (action === 'excelAddCol') {
      // Excel容器添加列
      this.excelAddCol(id);
    } else if (action === 'excelDelCol') {
      // Excel容器删除列
      this.excelDelCol(id);
    } else if (action === 'toggleExcelView') {
      // Excel容器切换视图
      this.toggleExcelView(id);
    } else if (action === 'deleteCard') {
      // 卡片头部删除按钮
      this.deleteCard(id);
    } else if (action === 'configChart') {
      // 统计图配置面板
      this.showChartConfigPanel(id);
    } else if (action === 'refreshChart') {
      // 刷新统计图数据
      this.refreshChartData(id);
    } else if (action === 'playOnline') {
      // webview在线播放网页视频
      this.startWebviewPlayback(id);
    } else if (action === 'stopOnline') {
      // 停止webview播放
      this.stopWebviewPlayback(id);
    } else if (action === 'reloadWebview') {
      // 重新加载webview
      this.reloadWebview(id);
    } else if (action === 'toggleDlSection') {
      // 折叠/展开信息栏
      this.toggleDlSection(id);
    } else if (action === 'configAiworkflow') {
      // Task 16: AI 工作流容器配置面板
      this.showAiworkflowConfigPanel(id);
    } else if (action === 'runAiworkflow') {
      // Task 16: 在容器内运行关联任务
      this.runAiworkflowContainer(id);
    } else if (action === 'openAiworkflowResult') {
      // Task 16: 查看完整结果（跳转到 AI 工作流模块）
      this.openAiworkflowResultPanel(id);
    }
  },

  // ===== 右键菜单 =====
  showCanvasContextMenu(e) {
    this.hideContextMenu();
    // 检测是否点击在卡片上
    const cardEl = e.target.closest('.wsw-card');
    const hasSelection = this.state.selectedCards.size > 0;
    const isOnCard = !!cardEl;
    const cardId = isOnCard ? parseInt(cardEl.dataset.cardId) : null;
    const card = isOnCard ? this.state.doc.cards.find(c => c.id === cardId) : null;
    const isContainer = card && ['videoContainer', 'audioContainer', 'textContainer', 'excelContainer', 'chartCard', 'aiworkflow'].includes(card.type);

    const menu = document.createElement('div');
    menu.id = 'wswContextMenu';
    menu.className = 'wsw-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    let items = '';
    // 添加元素子菜单
    items += '<div class="wsw-ctx-item has-submenu">➕ 添加元素 <span class="submenu-arrow">▶</span>' +
      '<div class="wsw-ctx-submenu">' +
        '<div class="wsw-ctx-item" onclick="WSWEditor.addTextBox();WSWEditor.hideContextMenu()">📝 文字框</div>' +
        '<div class="wsw-ctx-item" onclick="WSWEditor.addTable();WSWEditor.hideContextMenu()">📊 表格</div>' +
        '<div class="wsw-ctx-item" onclick="WSWEditor.addShape(\'rect\');WSWEditor.hideContextMenu()">⬜ 矩形</div>' +
        '<div class="wsw-ctx-item" onclick="WSWEditor.addShape(\'circle\');WSWEditor.hideContextMenu()">⭕ 圆形</div>' +
        '<div class="wsw-ctx-item" onclick="WSWEditor.addShape(\'triangle\');WSWEditor.hideContextMenu()">🔺 三角形</div>' +
        '<div class="wsw-ctx-sep"></div>' +
        '<div class="wsw-ctx-item" onclick="WSWEditor.addVideoContainer();WSWEditor.hideContextMenu()">🎬 视频容器</div>' +
        '<div class="wsw-ctx-item" onclick="WSWEditor.addAudioContainer();WSWEditor.hideContextMenu()">🎵 音频容器</div>' +
        '<div class="wsw-ctx-item" onclick="WSWEditor.addTextContainer();WSWEditor.hideContextMenu()">📄 文本容器</div>' +
        '<div class="wsw-ctx-item" onclick="WSWEditor.addExcelContainer();WSWEditor.hideContextMenu()">📊 Excel容器</div>' +
        '<div class="wsw-ctx-item" onclick="WSWEditor.addChartCard();WSWEditor.hideContextMenu()">📈 统计图</div>' +
        '<div class="wsw-ctx-item" onclick="WSWEditor.addAiworkflowContainer();WSWEditor.hideContextMenu()">🤖 AI 工作流容器</div>' +
      '</div></div>';

    // 导入工作流卡片内容
    items += '<div class="wsw-ctx-item" onclick="WSWEditor.showImportWorkflowPanel();WSWEditor.hideContextMenu()">📋 导入工作流卡片内容</div>';

    // 从浏览器捕获视频（B站式预览播放）
    items += '<div class="wsw-ctx-item" onclick="WSWEditor.captureFromBrowser();WSWEditor.hideContextMenu()">🌐 从浏览器捕获视频</div>';

    if (isOnCard) {
      items += '<div class="wsw-ctx-sep"></div>';
      // 复制
      items += '<div class="wsw-ctx-item" onclick="WSWEditor.copySelected();WSWEditor.hideContextMenu()">📋 复制 <small>Ctrl+C</small></div>';
      // 剪切
      items += '<div class="wsw-ctx-item" onclick="WSWEditor.cutSelected();WSWEditor.hideContextMenu()">✂️ 剪切</div>';
      // 粘贴（如果有剪贴板内容）
      if (this.state.clipboard && this.state.clipboard.length > 0) {
        items += '<div class="wsw-ctx-item" onclick="WSWEditor.paste();WSWEditor.hideContextMenu()">📎 粘贴 <small>Ctrl+V</small></div>';
      }
      // 复制为Markdown（仅文本框）
      if (card.type === 'textbox') {
        items += '<div class="wsw-ctx-item" onclick="WSWEditor.copyAsMarkdown(' + cardId + ');WSWEditor.hideContextMenu()">📝 复制为Markdown</div>';
      }
      // 编辑链接（仅容器）
      if (isContainer) {
        if (card.type === 'videoContainer') {
          items += '<div class="wsw-ctx-item" onclick="WSWEditor.showVideoConfigPanel(' + cardId + ');WSWEditor.hideContextMenu()">⚙️ 配置视频源</div>';
        } else if (card.type === 'audioContainer') {
          items += '<div class="wsw-ctx-item" onclick="WSWEditor.showAudioConfigPanel(' + cardId + ');WSWEditor.hideContextMenu()">⚙️ 配置音频源</div>';
        } else if (card.type === 'textContainer') {
          items += '<div class="wsw-ctx-item" onclick="WSWEditor.showTextConfigPanel(' + cardId + ');WSWEditor.hideContextMenu()">⚙️ 配置内容</div>';
        } else if (card.type === 'excelContainer') {
          items += '<div class="wsw-ctx-item" onclick="WSWEditor.showExcelConfigPanel(' + cardId + ');WSWEditor.hideContextMenu()">⚙️ 配置数据源</div>';
        } else if (card.type === 'chartCard') {
          items += '<div class="wsw-ctx-item" onclick="WSWEditor.showChartConfigPanel(' + cardId + ');WSWEditor.hideContextMenu()">⚙️ 配置统计图</div>';
          items += '<div class="wsw-ctx-item" onclick="WSWEditor.refreshChartData(' + cardId + ');WSWEditor.hideContextMenu()">🔄 刷新数据</div>';
        } else if (card.type === 'aiworkflow') {
          items += '<div class="wsw-ctx-item" onclick="WSWEditor.showAiworkflowConfigPanel(' + cardId + ');WSWEditor.hideContextMenu()">⚙️ 配置任务</div>';
          items += '<div class="wsw-ctx-item" onclick="WSWEditor.runAiworkflowContainer(' + cardId + ');WSWEditor.hideContextMenu()">▶ 运行任务</div>';
        }
      }
      items += '<div class="wsw-ctx-sep"></div>';
      // 删除
      items += '<div class="wsw-ctx-item danger" onclick="WSWEditor.deleteSelected();WSWEditor.hideContextMenu()">🗑 删除 <small>Del</small></div>';
    } else if (hasSelection) {
      items += '<div class="wsw-ctx-sep"></div>';
      items += '<div class="wsw-ctx-item" onclick="WSWEditor.copySelected();WSWEditor.hideContextMenu()">📋 复制</div>';
      if (this.state.clipboard && this.state.clipboard.length > 0) {
        items += '<div class="wsw-ctx-item" onclick="WSWEditor.paste();WSWEditor.hideContextMenu()">📎 粘贴</div>';
      }
      items += '<div class="wsw-ctx-item danger" onclick="WSWEditor.deleteSelected();WSWEditor.hideContextMenu()">🗑 删除选中</div>';
    } else {
      // 空白处
      if (this.state.clipboard && this.state.clipboard.length > 0) {
        items += '<div class="wsw-ctx-sep"></div>';
        items += '<div class="wsw-ctx-item" onclick="WSWEditor.paste();WSWEditor.hideContextMenu()">📎 粘贴 <small>Ctrl+V</small></div>';
      }
      items += '<div class="wsw-ctx-sep"></div>';
      items += '<div class="wsw-ctx-item" onclick="WSWEditor.showBackgroundPanel();WSWEditor.hideContextMenu()">🎨 画布背景</div>';
      items += '<div class="wsw-ctx-item" onclick="WSWEditor.showTTLPanel();WSWEditor.hideContextMenu()">⏱ TTL时间设置</div>';
      items += '<div class="wsw-ctx-sep"></div>';
      items += '<div class="wsw-ctx-item" onclick="WSWEditor.fitView();WSWEditor.hideContextMenu()">🔍 适应窗口</div>';
      items += '<div class="wsw-ctx-item" onclick="WSWEditor.saveDoc();WSWEditor.hideContextMenu()">💾 保存文档 <small>Ctrl+S</small></div>';
    }

    menu.innerHTML = items;
    document.body.appendChild(menu);

    // 确保菜单不超出视窗
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
    }

    // 点击其他地方关闭
    setTimeout(() => {
      document.addEventListener('click', this._hideCtxOnce, { once: true });
    }, 0);
  },

  _hideCtxOnce: () => {
    const menu = document.getElementById('wswContextMenu');
    if (menu) menu.remove();
  },

  hideContextMenu() {
    const menu = document.getElementById('wswContextMenu');
    if (menu) menu.remove();
  },

  // ===== 复制/剪切/粘贴 =====
  copySelected() {
    if (this.state.selectedCards.size === 0) {
      App.showToast('请先选中要复制的元素');
      return;
    }
    this.state.clipboard = [];
    this.state.selectedCards.forEach(id => {
      const card = this.state.doc.cards.find(c => c.id === id);
      if (card) {
        // 深拷贝
        this.state.clipboard.push(JSON.parse(JSON.stringify(card)));
      }
    });
    App.showToast('已复制 ' + this.state.clipboard.length + ' 个元素');
  },

  cutSelected() {
    if (this.state.selectedCards.size === 0) {
      App.showToast('请先选中要剪切的元素');
      return;
    }
    this.copySelected();
    this.deleteSelected();
    App.showToast('已剪切');
  },

  paste() {
    if (!this.state.clipboard || this.state.clipboard.length === 0) {
      App.showToast('剪贴板为空');
      return;
    }
    this.saveUndo();
    const newIds = [];
    this.state.clipboard.forEach(card => {
      const copy = JSON.parse(JSON.stringify(card));
      copy.id = Date.now() + Math.random();
      copy.x += 20;
      copy.y += 20;
      copy.z = ++this.state.maxZ;
      this.state.doc.cards.push(copy);
      newIds.push(copy.id);
    });
    this.state.selectedCards.clear();
    newIds.forEach(id => this.state.selectedCards.add(id));
    this.renderCanvas();
    App.showToast('已粘贴 ' + newIds.length + ' 个元素');
  },

  copyAsMarkdown(cardId) {
    const card = this.state.doc.cards.find(c => c.id === cardId);
    if (!card || card.type !== 'textbox') return;
    const text = card.content || '';
    navigator.clipboard.writeText(text).then(() => {
      App.showToast('已复制Markdown内容');
    }).catch(() => {
      App.showToast('复制失败');
    });
  },

  // ===== 导入工作流卡片内容 =====
  async showImportWorkflowPanel() {
    if (!this.state.doc) {
      App.showToast('请先创建文档');
      return;
    }

    let workflows = [];
    if (window.electronAPI?.getWorkflows) {
      const result = await window.electronAPI.getWorkflows();
      if (result.success) workflows = result.data || [];
    }

    if (workflows.length === 0) {
      App.showToast('暂无工作流记录');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'wsw-link-overlay';

    overlay.innerHTML = '<div class="wsw-link-panel" style="width:540px">' +
      '<div class="wsw-link-header"><span>📋 导入工作流卡片内容</span><button class="wsw-link-close">✕</button></div>' +
      '<div class="wsw-link-body">' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">选择工作流</label>' +
          '<select id="importWfSelect" class="wsw-link-select">' +
            '<option value="">-- 请选择 --</option>' +
            workflows.map(wf => '<option value="' + wf.id + '">' +
              this.esc((wf.title || '未命名') + ' (' + (wf.resourceCount || 0) + '个资源)') + '</option>'
            ).join('') +
          '</select>' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">导入方式</label>' +
          '<div class="wsw-import-mode">' +
            '<label class="wsw-link-checkbox-label"><input type="radio" name="importMode" value="grid" checked><span>网格排列（每个资源一个卡片）</span></label>' +
            '<label class="wsw-link-checkbox-label"><input type="radio" name="importMode" value="single"><span>合并到一个文字框</span></label>' +
            '<label class="wsw-link-checkbox-label"><input type="radio" name="importMode" value="containers"><span>创建容器（视频/音频/文本）</span></label>' +
          '</div>' +
        '</div>' +
        '<div class="wsw-link-section">' +
          '<label class="wsw-link-label">资源预览</label>' +
          '<div id="importPreview" class="wsw-link-preview" style="max-height:200px;overflow-y:auto">请选择工作流</div>' +
        '</div>' +
      '</div>' +
      '<div class="wsw-link-footer">' +
        '<button class="wsw-link-btn cancel-btn">取消</button>' +
        '<button class="wsw-link-btn save-btn primary">导入</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);

    const preview = document.getElementById('importPreview');
    const wfSelect = document.getElementById('importWfSelect');
    const typeIcons = { image: '🖼️', video: '🎬', audio: '🎵', link: '🔗', text: '📝' };

    const updatePreview = async () => {
      const wfId = wfSelect.value;
      if (!wfId) {
        preview.innerHTML = '请选择工作流';
        return;
      }
      if (!window.electronAPI?.getWorkflowDetail) return;
      const result = await window.electronAPI.getWorkflowDetail(wfId);
      if (!result.success || !result.data) {
        preview.innerHTML = '加载失败';
        return;
      }
      const resources = result.data.resources || [];
      preview.innerHTML = resources.map((r, i) => {
        const icon = typeIcons[r.type] || '📄';
        const name = (r.name || r.text || '资源' + (i + 1)).substring(0, 40);
        return '<div class="wsw-link-preview-row">' + icon + ' ' + this.esc(name) + ' <small style="color:var(--text2)">(' + (r.type || '') + ')</small></div>';
      }).join('');
    };

    wfSelect.addEventListener('change', updatePreview);

    const close = () => overlay.remove();
    overlay.querySelector('.wsw-link-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.save-btn').addEventListener('click', async () => {
      const wfId = wfSelect.value;
      if (!wfId) {
        App.showToast('请选择工作流');
        return;
      }
      const mode = overlay.querySelector('input[name="importMode"]:checked').value;
      if (!window.electronAPI?.getWorkflowDetail) return;
      const result = await window.electronAPI.getWorkflowDetail(wfId);
      if (!result.success) {
        App.showToast('获取工作流失败');
        return;
      }
      const resources = result.data.resources || [];
      if (resources.length === 0) {
        App.showToast('工作流无资源');
        return;
      }

      this.saveUndo();
      const now = Date.now();

      if (mode === 'single') {
        // 合并到一个文字框
        let md = '# ' + (result.data.title || '工作流资源') + '\n\n';
        md += '**来源**: ' + (result.data.url || '') + '\n\n';
        resources.forEach((r, i) => {
          const icon = typeIcons[r.type] || '📄';
          md += '## ' + icon + ' ' + (r.name || r.text || '资源' + (i + 1)) + '\n';
          md += '- 类型: ' + (r.type || '') + '\n';
          if (r.url) md += '- URL: ' + r.url + '\n';
          if (r.format) md += '- 格式: ' + r.format + '\n';
          if (r.content) md += '\n```\n' + r.content.substring(0, 500) + '\n```\n';
          md += '\n';
        });
        const card = {
          id: now, type: 'textbox', name: result.data.title || '工作流资源',
          content: md, mdView: true,
          x: 80, y: 60, w: 500, h: 400, z: ++this.state.maxZ
        };
        this.state.doc.cards.push(card);
      } else if (mode === 'containers') {
        // 创建容器
        let col = 0, row = 0;
        resources.forEach((r, i) => {
          let containerType = null;
          if (r.type === 'video') containerType = 'videoContainer';
          else if (r.type === 'audio') containerType = 'audioContainer';
          else if (r.type === 'text') containerType = 'textContainer';
          else return;  // 图片和链接不创建容器

          const card = {
            id: now + i, type: containerType,
            name: (r.name || r.text || '资源' + (i + 1)).substring(0, 30),
            x: 80 + col * 380, y: 60 + row * 280,
            w: containerType === 'videoContainer' ? 360 : containerType === 'audioContainer' ? 320 : 320,
            h: containerType === 'videoContainer' ? 240 : containerType === 'audioContainer' ? 100 : 200,
            z: ++this.state.maxZ,
            timestamp: { created: now, lastUpdated: now, ttl: null },
            sourceType: 'workflow',
            workflowLink: {
              workflowId: wfId, cardIndex: i, resourceType: r.type, autoRefresh: true
            },
            currentResource: {
              url: r.url || '', name: r.name || r.text || '', format: r.format || '',
              streamType: r.streamType || '', content: r.content || '', cachedAt: now, isLocal: false
            }
          };
          this.state.doc.cards.push(card);
          col++;
          if (col >= 3) { col = 0; row++; }
        });
      } else {
        // 网格排列（每个资源一个文字框卡片）
        let col = 0, row = 0;
        resources.forEach((r, i) => {
          const icon = typeIcons[r.type] || '📄';
          let md = '### ' + icon + ' ' + (r.name || r.text || '资源' + (i + 1)) + '\n';
          md += '- 类型: ' + (r.type || '') + '\n';
          if (r.url) md += '- URL: [' + (r.url.substring(0, 40) + '...') + '](' + r.url + ')\n';
          if (r.format) md += '- 格式: ' + r.format + '\n';
          if (r.streamType) md += '- 流类型: ' + r.streamType + '\n';
          if (r.content) md += '\n' + r.content.substring(0, 300) + '\n';

          const card = {
            id: now + i, type: 'textbox',
            name: (r.name || r.text || '资源' + (i + 1)).substring(0, 30),
            content: md, mdView: true,
            x: 80 + col * 320, y: 60 + row * 200,
            w: 280, h: 160, z: ++this.state.maxZ
          };
          this.state.doc.cards.push(card);
          col++;
          if (col >= 3) { col = 0; row++; }
        });
      }

      this.renderCanvas();
      close();
      App.showToast('已导入 ' + resources.length + ' 个资源');
    });
  },

  // ===== 从浏览器捕获视频（B站式预览播放） =====
  async captureFromBrowser() {
    if (!this.state.doc) {
      App.showToast('请先创建文档');
      return;
    }

    // 通过 IPC 从主进程获取当前活动标签页的视频资源
    if (!window.electronAPI?.getActiveTabVideos) {
      // 回退：从已选资源中找视频
      this._captureFromSelectedVideos();
      return;
    }

    try {
      const result = await window.electronAPI.getActiveTabVideos();
      if (!result.success || !result.data || result.data.length === 0) {
        App.showToast('当前页面未检测到视频');
        this._captureFromSelectedVideos();
        return;
      }

      const videos = result.data;
      const overlay = document.createElement('div');
      overlay.className = 'wsw-link-overlay';

      overlay.innerHTML = '<div class="wsw-link-panel" style="width:540px">' +
        '<div class="wsw-link-header"><span>🌐 从浏览器捕获视频</span><button class="wsw-link-close">✕</button></div>' +
        '<div class="wsw-link-body">' +
          '<div class="wsw-link-hint">检测到 ' + videos.length + ' 个视频，选择要添加到画布的视频：</div>' +
          '<div class="wsw-browser-video-list">' +
            videos.map((v, i) => {
              const title = (v.title || v.name || '视频' + (i + 1)).substring(0, 40);
              const src = v.src || v.url || '';
              const srcShort = src.substring(0, 60);
              return '<label class="wsw-browser-video-item">' +
                '<input type="radio" name="browserVideo" value="' + i + '"' + (i === 0 ? ' checked' : '') + '>' +
                '<div class="wsw-browser-video-info">' +
                  '<div class="wsw-browser-video-title">🎬 ' + this.esc(title) + '</div>' +
                  '<div class="wsw-browser-video-src">' + this.esc(srcShort) + '</div>' +
                  (v.poster ? '<img class="wsw-browser-video-poster" src="' + this.esc(v.poster) + '" onerror="this.style.display=\'none\'">' : '') +
                '</div>' +
              '</label>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="wsw-link-footer">' +
          '<button class="wsw-link-btn cancel-btn">取消</button>' +
          '<button class="wsw-link-btn save-btn primary">添加到画布</button>' +
        '</div>' +
      '</div>';

      document.body.appendChild(overlay);

      const close = () => overlay.remove();
      overlay.querySelector('.wsw-link-close').addEventListener('click', close);
      overlay.querySelector('.cancel-btn').addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

      overlay.querySelector('.save-btn').addEventListener('click', () => {
        const selectedIdx = parseInt(overlay.querySelector('input[name="browserVideo"]:checked').value);
        const video = videos[selectedIdx];
        if (!video) return;

        // 创建视频容器
        const card = this._createContainer('videoContainer', (video.title || '浏览器视频').substring(0, 30), 360, 240);
        if (!card) return;
        const videoUrl = video.src || video.url || '';
        const streamType = videoUrl.startsWith('blob:') ? 'blob' : (videoUrl.indexOf('.m3u8') > -1 ? 'm3u8' : 'http');
        card.sourceType = 'browser';
        card.browserSource = {
          pageUrl: video.pageUrl || '',
          pageTitle: video.title || '',
          videoUrl: videoUrl
        };
        // 新架构：浏览器捕获作为网络播放源
        card.onlineSource = {
          url: videoUrl,
          name: video.title || '浏览器视频',
          format: videoUrl.match(/\.([a-z0-9]+)(\?|$|#)/i)?.[1]?.toLowerCase() || 'mp4',
          streamType: streamType,
          cachedAt: Date.now()
        };
        card.playMode = 'online';
        // 兼容旧字段
        card.currentResource = {
          url: videoUrl,
          name: video.title || '浏览器视频',
          format: card.onlineSource.format,
          streamType: streamType,
          cachedAt: Date.now(),
          isLocal: false,
          poster: video.poster || ''
        };
        card.timestamp.ttl = 0;  // 浏览器捕获不过期
        this.renderCanvas();
        close();
        App.showToast('已添加浏览器视频到画布');
      });
    } catch (e) {
      console.error('captureFromBrowser error:', e);
      App.showToast('捕获失败: ' + e.message);
      this._captureFromSelectedVideos();
    }
  },

  // 从已选资源中找视频（回退方案）
  _captureFromSelectedVideos() {
    const selectedVideos = App.state.selectedResources?.videos || [];
    if (selectedVideos.length === 0) {
      App.showToast('请在抓取模式中先提取视频资源');
      return;
    }

    if (selectedVideos.length === 1) {
      const v = selectedVideos[0];
      const card = this._createContainer('videoContainer', (v.name || '浏览器视频').substring(0, 30), 360, 240);
      if (!card) return;
      const streamType = v.streamType || (v.url && v.url.indexOf('.m3u8') > -1 ? 'm3u8' : (v.url && v.url.startsWith('blob:') ? 'blob' : 'http'));
      card.sourceType = 'browser';
      card.browserSource = { pageUrl: App.getCurrentUrl?.() || '', pageTitle: App.getCurrentPageTitle?.() || '', videoUrl: v.url };
      card.onlineSource = {
        url: v.url || '', name: v.name || '浏览器视频',
        format: v.format || '', streamType: streamType, cachedAt: Date.now()
      };
      card.playMode = 'online';
      card.currentResource = {
        url: v.url || '', name: v.name || '浏览器视频',
        format: v.format || '', streamType: streamType,
        cachedAt: Date.now(), isLocal: false
      };
      card.timestamp.ttl = 0;
      this.renderCanvas();
      App.showToast('已添加视频到画布');
      return;
    }

    // 多个视频时弹出选择
    const overlay = document.createElement('div');
    overlay.className = 'wsw-link-overlay';
    overlay.innerHTML = '<div class="wsw-link-panel" style="width:540px">' +
      '<div class="wsw-link-header"><span>🎬 选择已抓取的视频</span><button class="wsw-link-close">✕</button></div>' +
      '<div class="wsw-link-body">' +
        '<div class="wsw-browser-video-list">' +
          selectedVideos.map((v, i) => {
            const name = (v.name || v.text || '视频' + (i + 1)).substring(0, 40);
            return '<label class="wsw-browser-video-item">' +
              '<input type="radio" name="selVideo" value="' + i + '"' + (i === 0 ? ' checked' : '') + '>' +
              '<div class="wsw-browser-video-info">' +
                '<div class="wsw-browser-video-title">🎬 ' + this.esc(name) + '</div>' +
                '<div class="wsw-browser-video-src">' + this.esc((v.url || '').substring(0, 60)) + '</div>' +
              '</div>' +
            '</label>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="wsw-link-footer">' +
        '<button class="wsw-link-btn cancel-btn">取消</button>' +
        '<button class="wsw-link-btn save-btn primary">添加到画布</button>' +
      '</div>' +
    '</div>';

    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.wsw-link-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.save-btn').addEventListener('click', () => {
      const idx = parseInt(overlay.querySelector('input[name="selVideo"]:checked').value);
      const v = selectedVideos[idx];
      if (!v) return;
      const card = this._createContainer('videoContainer', (v.name || '浏览器视频').substring(0, 30), 360, 240);
      if (!card) return;
      const streamType = v.streamType || (v.url && v.url.indexOf('.m3u8') > -1 ? 'm3u8' : (v.url && v.url.startsWith('blob:') ? 'blob' : 'http'));
      card.sourceType = 'browser';
      card.browserSource = { pageUrl: App.getCurrentUrl?.() || '', pageTitle: App.getCurrentPageTitle?.() || '', videoUrl: v.url };
      card.onlineSource = {
        url: v.url || '', name: v.name || '浏览器视频',
        format: v.format || '', streamType: streamType, cachedAt: Date.now()
      };
      card.playMode = 'online';
      card.currentResource = {
        url: v.url || '', name: v.name || '浏览器视频',
        format: v.format || '', streamType: streamType,
        cachedAt: Date.now(), isLocal: false
      };
      card.timestamp.ttl = 0;
      this.renderCanvas();
      close();
      App.showToast('已添加视频到画布');
    });
  },

  saveTableCell(card) {
    if (!card || !card.tableData) return;
    const el = document.querySelector('[data-card-id="' + card.id + '"]');
    if (!el) return;
    el.querySelectorAll('[contenteditable="true"]').forEach(cell => {
      const r = parseInt(cell.dataset.r, 10);
      const c = parseInt(cell.dataset.c, 10);
      if (card.tableData[r] && c < card.tableData[r].length) {
        card.tableData[r][c] = cell.innerText;
      }
    });
  },

  // ===== 拖拽 =====
  startDrag(e, card) {
    this.state.isDragging = true;
    const cardEl = e.target.closest('.wsw-card');
    if (!cardEl) return;
    // 记录初始鼠标位置和卡片位置
    this.state.dragStartX = e.clientX;
    this.state.dragStartY = e.clientY;
    this.state.dragCardOrigX = card.x;
    this.state.dragCardOrigY = card.y;
    cardEl.classList.add('dragging');
    // 提升 z-index 确保拖拽时在最上层
    card.z = ++this.state.maxZ;
    cardEl.style.zIndex = card.z;

    const onMove = (ev) => {
      if (!this.state.isDragging) return;
      ev.preventDefault();
      // 计算鼠标移动距离，考虑缩放比例
      const dx = (ev.clientX - this.state.dragStartX) / this.state.zoom;
      const dy = (ev.clientY - this.state.dragStartY) / this.state.zoom;
      // 网格吸附（10px）
      card.x = Math.round((this.state.dragCardOrigX + dx) / 10) * 10;
      card.y = Math.round((this.state.dragCardOrigY + dy) / 10) * 10;
      cardEl.style.left = card.x + 'px';
      cardEl.style.top = card.y + 'px';
    };

    const onUp = () => {
      this.state.isDragging = false;
      cardEl.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
  },

  // ===== 缩放 =====
  startResize(e, card) {
    this.state.isResizing = true;
    const cardEl = e.target.closest('.wsw-card');
    if (!cardEl) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = card.w;
    const startH = card.h;

    const onMove = (ev) => {
      if (!this.state.isResizing) return;
      const dx = (ev.clientX - startX) / this.state.zoom;
      const dy = (ev.clientY - startY) / this.state.zoom;
      card.w = Math.max(80, Math.round((startW + dx) / 10) * 10);
      card.h = Math.max(40, Math.round((startH + dy) / 10) * 10);
      cardEl.style.width = card.w + 'px';
      cardEl.style.height = card.h + 'px';
    };

    const onUp = () => {
      this.state.isResizing = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  WSWEditor.init();
});
