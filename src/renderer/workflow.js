// 抓取信息卡片模块
const Workflow = {
  state: {
    workflows: [],
    trashList: [],          // 回收站卡片列表
    selectedId: null,       // 单选（用于右键菜单/查看信息）
    selectedIds: new Set(), // 多选（用于批量操作）
    searchQuery: '',
    filterType: 'all',      // all, image, video, audio, link, text
    showingTrash: false,    // 是否在查看回收站
    // 拉框选择状态
    dragSelect: {
      active: false,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      boxEl: null,
      preSelected: new Set() // 拖拽前已选中的（用于 Shift 累加）
    }
  },

  init() {
    this.loadList();
    this.initDragSelect();
  },

  async loadList() {
    try {
      const result = await window.electronAPI?.getWorkflows();
      if (result?.success) {
        this.state.workflows = result.data || [];
      } else {
        this.state.workflows = [];
      }
      this.renderList();
    } catch (e) {
      console.error('Load workflows failed:', e);
      this.state.workflows = [];
      this.showEmpty();
    }
  },

  // 加载回收站数据
  async loadTrashList() {
    try {
      const result = await window.electronAPI?.getTrashWorkflows?.();
      if (result?.success) {
        this.state.trashList = result.data || [];
      } else {
        this.state.trashList = [];
      }
    } catch (e) {
      console.error('Load trash failed:', e);
      this.state.trashList = [];
    }
  },

  // 切换回收站视图
  async toggleTrash() {
    this.state.showingTrash = !this.state.showingTrash;
    const btn = document.getElementById('wfTrashBtn');
    const batchDeleteBtn = document.getElementById('wfBatchDeleteBtn');
    if (this.state.showingTrash) {
      await this.loadTrashList();
      if (btn) {
        btn.textContent = '📋 返回卡片';
        btn.style.background = 'var(--warning)';
        btn.style.color = '#fff';
      }
      if (batchDeleteBtn) batchDeleteBtn.style.display = 'none';
    } else {
      if (btn) {
        btn.textContent = '🗑 回收站';
        btn.style.background = '';
        btn.style.color = '';
      }
      if (batchDeleteBtn) batchDeleteBtn.style.display = '';
    }
    // 清空选中
    this.state.selectedId = null;
    this.state.selectedIds.clear();
    this.updateSelectionInfo();
    this.renderList();
  },

  // 获取过滤后的工作流列表（根据当前视图：正常 or 回收站）
  getFilteredWorkflows() {
    let list = this.state.showingTrash ? this.state.trashList : this.state.workflows;
    // 按类型筛选
    if (this.state.filterType !== 'all') {
      list = list.filter(wf => {
        const resources = wf.resources || [];
        return resources.some(r => r.type === this.state.filterType);
      });
    }
    // 按搜索关键词筛选（自然语言搜索：标题、URL、资源名称）
    if (this.state.searchQuery) {
      const q = this.state.searchQuery.toLowerCase();
      list = list.filter(wf => {
        const title = (wf.title || '').toLowerCase();
        const url = (wf.url || '').toLowerCase();
        const resources = wf.resources || [];
        const resMatch = resources.some(r => {
          const name = (r.name || r.text || '').toLowerCase();
          const rUrl = (r.url || '').toLowerCase();
          const content = (r.content || '').toLowerCase();
          return name.includes(q) || rUrl.includes(q) || content.includes(q);
        });
        return title.includes(q) || url.includes(q) || resMatch;
      });
    }
    return list;
  },

  renderList() {
    const body = document.getElementById('workflowBody');
    if (!body) return;

    const sourceList = this.state.showingTrash ? this.state.trashList : this.state.workflows;
    if (sourceList.length === 0) {
      this.showEmpty();
      return;
    }

    const filtered = this.getFilteredWorkflows();
    if (filtered.length === 0) {
      body.innerHTML = `
        <div class="workflow-empty-state">
          <div class="icon">🔍</div>
          <h3>${this.state.showingTrash ? '回收站为空' : '未找到匹配的工作流'}</h3>
          <p>${this.state.showingTrash ? '回收站中没有已删除的卡片' : '尝试调整搜索关键词或筛选条件'}</p>
        </div>
      `;
      return;
    }

    const typeIcons = { image: '📷', video: '🎬', audio: '🎵', link: '🔗', text: '📝' };
    // Task 15.4: 工作流结果卡片按任务类型显示小图标
    const taskTypeIcon = { batch: '📦', crosspage: '🌐', tracking: '🔔', template: '📋' };

    // Windows 桌面图标排列样式
    body.innerHTML = '<div class="workflow-desktop-grid" id="wfDesktopGrid">' + filtered.map(wf => {
      const id = String(wf.id);
      const isSelected = this.state.showingTrash
        ? false
        : this.state.selectedIds.has(id);
      const resources = wf.resources || [];
      const title = this.escapeHtml(wf.title || '未命名');
      const url = this.escapeHtml(wf.url || '');
      const time = wf.createdAt ? new Date(wf.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

      // Task 15.4: 按 cardType 区分徽章
      const cardType = wf.cardType || 'media';
      const isAiworkflowResult = cardType === 'aiworkflow-result';
      let typeBadges = '';
      let mainEmoji = '📋';
      if (isAiworkflowResult) {
        // 工作流结果卡片：⚙ 工作流徽章 + 任务类型小图标
        const tIcon = taskTypeIcon[wf.sourceTaskType] || '📦';
        mainEmoji = tIcon;
        typeBadges = '<span class="wf-icon-badge">⚙ 工作流</span><span class="wf-icon-badge">' + tIcon + ' ' + (resources.length) + '</span>';
      } else {
        // 多媒体卡片：原有逻辑
        const typeCount = {};
        resources.forEach(r => {
          typeCount[r.type] = (typeCount[r.type] || 0) + 1;
        });
        typeBadges = Object.entries(typeCount).map(([type, count]) =>
          '<span class="wf-icon-badge">' + (typeIcons[type] || '📄') + ' ' + count + '</span>'
        ).join('');
        mainEmoji = typeBadges ? typeBadges.split('</span>')[0].replace('<span class="wf-icon-badge">', '') : '📋';
      }

      // 回收站视图：显示还原/永久删除按钮 + 删除时间
      let trashActions = '';
      let trashInfo = '';
      let trashClass = '';
      if (this.state.showingTrash) {
        trashClass = ' trash-item';
        const deletedAt = wf.deletedAt ? new Date(wf.deletedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        trashInfo = '<div class="wf-trash-deleted-info">删除于 ' + deletedAt + '</div>';
        trashActions = '<div class="wf-trash-actions">' +
          '<button class="wf-trash-btn restore" onclick="event.stopPropagation();Workflow.restoreFromTrash(\'' + id + '\')" title="还原">↩</button>' +
          '<button class="wf-trash-btn delete" onclick="event.stopPropagation();Workflow.permanentDelete(\'' + id + '\')" title="永久删除">✕</button>' +
          '</div>';
      }

      // 正常视图：多选 checkbox + 单选删除按钮
      const checkboxHtml = this.state.showingTrash ? '' :
        '<input type="checkbox" class="wf-icon-checkbox" onclick="event.stopPropagation();Workflow.toggleMultiSelect(\'' + id + '\')" ' + (isSelected ? 'checked' : '') + '>';
      const deleteBtnHtml = (this.state.showingTrash || !this.state.selectedId || this.state.selectedId !== id) ? '' :
        '<button class="wf-icon-delete" onclick="event.stopPropagation();Workflow.deleteWorkflow(\'' + id + '\')" title="删除">✕</button>';

      return '<div class="workflow-desktop-icon' + (isSelected ? ' selected' : '') + trashClass + '" ' +
        'data-id="' + this.escapeHtml(id) + '" ' +
        'onclick="Workflow.select(\'' + id + '\')" ' +
        'oncontextmenu="Workflow.showContextMenu(event, \'' + id + '\')" ' +
        'title="' + title + '\n' + url + '\n' + time + '\n' + resources.length + '个资源">' +
        checkboxHtml +
        '<div class="wf-icon-image">' +
          '<div class="wf-icon-emoji">' + mainEmoji + '</div>' +
          '<div class="wf-icon-count">' + resources.length + '</div>' +
        '</div>' +
        '<div class="wf-icon-title">' + title + '</div>' +
        '<div class="wf-icon-meta">' + time + '</div>' +
        '<div class="wf-icon-badges">' + typeBadges + '</div>' +
        trashInfo +
        trashActions +
        deleteBtnHtml +
      '</div>';
    }).join('') + '</div>';

    // 更新搜索结果计数
    const countEl = document.getElementById('workflowSearchCount');
    if (countEl) {
      const total = this.state.showingTrash ? this.state.trashList.length : this.state.workflows.length;
      countEl.textContent = filtered.length + '/' + total;
    }
    this.updateSelectionInfo();
  },

  showEmpty() {
    const body = document.getElementById('workflowBody');
    if (!body) return;

    body.innerHTML = `
      <div class="workflow-empty-state">
        <div class="icon">📋</div>
        <h3>暂无工作流记录</h3>
        <p>完成资源抓取并导出后，工作流将自动记录在此</p>
      </div>
    `;
  },

  // 选择/取消选择工作流（点击图标：单选切换；Ctrl+点击：加入多选；Shift+点击：范围选择）
  select(id, event) {
    if (this.state.showingTrash) {
      // 回收站视图不进入多选模式
      this.state.selectedId = id;
      this.renderList();
      return;
    }
    // 修饰键检测
    const hasCtrl = event && (event.ctrlKey || event.metaKey);
    const hasShift = event && event.shiftKey;
    if (hasCtrl) {
      // Ctrl+点击：切换多选
      this.toggleMultiSelect(id);
      return;
    }
    if (hasShift) {
      // Shift+点击：从上次单选到当前的范围全选
      const list = this.getFilteredWorkflows();
      const ids = list.map(w => String(w.id));
      const startIdx = this.state.selectedId ? ids.indexOf(this.state.selectedId) : -1;
      const endIdx = ids.indexOf(id);
      if (startIdx >= 0 && endIdx >= 0) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        for (let i = from; i <= to; i++) {
          this.state.selectedIds.add(ids[i]);
        }
      } else {
        this.state.selectedIds.add(id);
      }
      this.state.selectedId = id;
      this.renderList();
      return;
    }
    // 普通点击：如果已多选，点击的 id 切换其多选状态；否则单选切换
    if (this.state.selectedIds.size > 0 && this.state.selectedIds.has(id)) {
      // 已在多选中，点击则取消
      this.state.selectedIds.delete(id);
      if (this.state.selectedIds.size === 0) {
        this.state.selectedId = null;
      }
    } else if (this.state.selectedIds.size > 0) {
      // 多选模式下点击新项：加入多选
      this.state.selectedIds.add(id);
      this.state.selectedId = id;
    } else {
      // 单选切换
      if (this.state.selectedId === id) {
        this.state.selectedId = null;
      } else {
        this.state.selectedId = id;
      }
    }
    this.renderList();
  },

  // 切换多选（checkbox 点击）
  toggleMultiSelect(id) {
    if (this.state.selectedIds.has(id)) {
      this.state.selectedIds.delete(id);
    } else {
      this.state.selectedIds.add(id);
    }
    this.renderList();
  },

  // 全选/取消全选
  selectAll() {
    const list = this.getFilteredWorkflows();
    if (this.state.selectedIds.size === list.length) {
      this.state.selectedIds.clear();
    } else {
      list.forEach(w => this.state.selectedIds.add(String(w.id)));
    }
    this.renderList();
  },

  // 更新选择信息显示
  updateSelectionInfo() {
    const infoEl = document.getElementById('wfSelectionInfo');
    const countEl = document.getElementById('wfSelectedCount');
    const batchDeleteBtn = document.getElementById('wfBatchDeleteBtn');
    const count = this.state.selectedIds.size;
    if (infoEl) infoEl.style.display = count > 0 ? '' : 'none';
    if (countEl) countEl.textContent = String(count);
    if (batchDeleteBtn) batchDeleteBtn.style.display = (count > 0 && !this.state.showingTrash) ? '' : 'none';
  },

  // 批量删除（移入回收站）
  async batchDelete() {
    const ids = Array.from(this.state.selectedIds);
    if (!ids.length) {
      App.showToast('请先选择要删除的卡片');
      return;
    }
    if (!confirm('确定删除选中的 ' + ids.length + ' 个卡片？将移入回收站，可还原。')) return;
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        const res = await window.electronAPI?.deleteWorkflow(id);
        if (res?.success) {
          ok++;
          this.state.workflows = this.state.workflows.filter(w => String(w.id) !== id);
        } else {
          fail++;
        }
      } catch (e) {
        fail++;
      }
    }
    this.state.selectedIds.clear();
    this.state.selectedId = null;
    this.renderList();
    App.showToast('已删除 ' + ok + ' 个卡片' + (fail > 0 ? '，' + fail + ' 个失败' : '') + '（可从回收站还原）');
  },

  // 从回收站还原
  async restoreFromTrash(id) {
    try {
      const res = await window.electronAPI?.restoreWorkflow?.(id);
      if (res?.success) {
        this.state.trashList = this.state.trashList.filter(w => String(w.id) !== id);
        // 同步刷新主列表
        await this.loadList();
        this.renderList();
        App.showToast('✓ 已还原');
      } else {
        App.showToast('还原失败：' + (res?.error || '未知错误'));
      }
    } catch (e) {
      App.showToast('还原异常：' + (e.message || e));
    }
  },

  // 从回收站永久删除
  async permanentDelete(id) {
    const wf = this.state.trashList.find(w => String(w.id) === String(id));
    const name = wf ? (wf.title || '未命名') : '该卡片';
    if (!confirm('确定永久删除「' + name + '」？此操作不可撤销。')) return;
    try {
      const res = await window.electronAPI?.permanentDeleteWorkflow?.(id);
      if (res?.success) {
        this.state.trashList = this.state.trashList.filter(w => String(w.id) !== String(id));
        this.renderList();
        App.showToast('✓ 已永久删除');
      } else {
        App.showToast('删除失败：' + (res?.error || '未知错误'));
      }
    } catch (e) {
      App.showToast('删除异常：' + (e.message || e));
    }
  },

  // 清空回收站
  async emptyTrash() {
    if (!this.state.trashList.length) {
      App.showToast('回收站已为空');
      return;
    }
    if (!confirm('确定清空回收站？将永久删除 ' + this.state.trashList.length + ' 个卡片，此操作不可撤销。')) return;
    try {
      const res = await window.electronAPI?.emptyTrash?.();
      if (res?.success) {
        this.state.trashList = [];
        this.renderList();
        App.showToast('✓ 已清空回收站');
      } else {
        App.showToast('清空失败：' + (res?.error || '未知错误'));
      }
    } catch (e) {
      App.showToast('清空异常：' + (e.message || e));
    }
  },

  // ===== 拉框批量选择 =====
  initDragSelect() {
    document.addEventListener('mousedown', (e) => {
      // 仅在抓取信息卡片模块且非回收站视图时启用
      const body = document.getElementById('workflowBody');
      if (!body || !body.contains(e.target)) return;
      // 排除点击卡片/checkbox/按钮的情况
      if (e.target.closest('.workflow-desktop-icon')) return;
      if (e.target.closest('.wf-icon-checkbox')) return;
      if (e.target.closest('button')) return;
      if (e.button !== 0) return; // 仅左键
      this.startDragSelect(e);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.state.dragSelect.active) return;
      this.updateDragSelect(e);
    });
    document.addEventListener('mouseup', (e) => {
      if (!this.state.dragSelect.active) return;
      this.endDragSelect(e);
    });
  },

  startDragSelect(e) {
    const body = document.getElementById('workflowBody');
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const ds = this.state.dragSelect;
    ds.active = true;
    ds.startX = e.clientX;
    ds.startY = e.clientY;
    ds.currentX = e.clientX;
    ds.currentY = e.clientY;
    // 保存拖拽前已选中（用于 Shift 累加模式）
    ds.preSelected = new Set(this.state.selectedIds);
    // 创建选择框元素
    if (ds.boxEl) ds.boxEl.remove();
    ds.boxEl = document.createElement('div');
    ds.boxEl.className = 'wf-selection-box';
    ds.boxEl.style.left = (e.clientX - rect.left + body.scrollLeft) + 'px';
    ds.boxEl.style.top = (e.clientY - rect.top + body.scrollTop) + 'px';
    ds.boxEl.style.width = '0px';
    ds.boxEl.style.height = '0px';
    body.appendChild(ds.boxEl);
    e.preventDefault();
  },

  updateDragSelect(e) {
    const body = document.getElementById('workflowBody');
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const ds = this.state.dragSelect;
    ds.currentX = e.clientX;
    ds.currentY = e.clientY;
    // 计算相对于 body 的坐标
    const x1 = ds.startX - rect.left + body.scrollLeft;
    const y1 = ds.startY - rect.top + body.scrollTop;
    const x2 = ds.currentX - rect.left + body.scrollLeft;
    const y2 = ds.currentY - rect.top + body.scrollTop;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    if (ds.boxEl) {
      ds.boxEl.style.left = left + 'px';
      ds.boxEl.style.top = top + 'px';
      ds.boxEl.style.width = width + 'px';
      ds.boxEl.style.height = height + 'px';
    }
    // 检测哪些卡片在框内
    const grid = document.getElementById('wfDesktopGrid');
    if (!grid) return;
    const boxRect = {
      left: Math.min(ds.startX, ds.currentX),
      top: Math.min(ds.startY, ds.currentY),
      right: Math.max(ds.startX, ds.currentX),
      bottom: Math.max(ds.startY, ds.currentY)
    };
    // Shift 键累加模式
    const shiftMode = e.shiftKey;
    const baseSelected = shiftMode ? ds.preSelected : new Set();
    const newSelected = new Set(baseSelected);
    grid.querySelectorAll('.workflow-desktop-icon').forEach(item => {
      const itemRect = item.getBoundingClientRect();
      // 矩形相交检测
      const intersects = !(
        itemRect.right < boxRect.left ||
        itemRect.left > boxRect.right ||
        itemRect.bottom < boxRect.top ||
        itemRect.top > boxRect.bottom
      );
      if (intersects) {
        const id = item.dataset.id;
        if (id) newSelected.add(id);
      }
    });
    this.state.selectedIds = newSelected;
    // 仅更新视觉状态，不重新渲染（性能）
    grid.querySelectorAll('.workflow-desktop-icon').forEach(item => {
      const id = item.dataset.id;
      const cb = item.querySelector('.wf-icon-checkbox');
      if (newSelected.has(id)) {
        item.classList.add('selected');
        if (cb) cb.checked = true;
      } else {
        item.classList.remove('selected');
        if (cb) cb.checked = false;
      }
    });
    this.updateSelectionInfo();
  },

  endDragSelect(e) {
    const ds = this.state.dragSelect;
    ds.active = false;
    if (ds.boxEl) {
      ds.boxEl.remove();
      ds.boxEl = null;
    }
    // 重新渲染以同步 checkbox 状态
    this.renderList();
  },

  // 搜索
  search(query) {
    this.state.searchQuery = query;
    this.renderList();
  },

  // 设置类型筛选
  setFilter(type) {
    this.state.filterType = type;
    // 更新筛选按钮状态
    document.querySelectorAll('.wf-filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === type);
    });
    this.renderList();
  },

  // 删除工作流（移入回收站）
  async deleteWorkflow(id) {
    const wf = this.state.workflows.find(w => String(w.id) === String(id));
    if (!wf) return;
    if (!confirm('确定删除工作流「' + (wf.title || '未命名') + '」？将移入回收站，可还原。')) return;

    try {
      const result = await window.electronAPI?.deleteWorkflow(id);
      if (result?.success) {
        this.state.workflows = this.state.workflows.filter(w => String(w.id) !== String(id));
        this.state.selectedIds.delete(String(id));
        if (this.state.selectedId === id) {
          this.state.selectedId = null;
        }
        this.renderList();
        App.showToast('已删除工作流（可从回收站还原）');
      } else {
        App.showToast('删除失败: ' + (result?.error || '未知错误'));
      }
    } catch (e) {
      App.showToast('删除失败: ' + e.message);
    }
  },

  // 右键菜单
  showContextMenu(event, id) {
    event.preventDefault();
    // 回收站视图右键菜单
    if (this.state.showingTrash) {
      this.showTrashContextMenu(event, id);
      return;
    }
    const wf = this.state.workflows.find(w => String(w.id) === String(id));
    if (!wf) return;

    // 选中该工作流
    this.state.selectedId = id;
    this.renderList();

    // 创建右键菜单
    let menu = document.getElementById('wfContextMenu');
    if (menu) menu.remove();

    menu = document.createElement('div');
    menu.id = 'wfContextMenu';
    menu.className = 'wf-context-menu';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
    // Task 15.5: 工作流结果卡片额外加"在 AI 工作流打开"项
    const isAiwfResult = (wf.cardType || 'media') === 'aiworkflow-result';
    const aiwfItem = isAiwfResult
      ? '<div class="wf-context-item" onclick="Workflow.openInAiworkflow(\'' + id + '\');Workflow.hideContextMenu()">🤖 在 AI 工作流打开</div>'
      : '';
    // 多选模式下的批量操作项
    const multiSelectedCount = this.state.selectedIds.size;
    const batchItems = multiSelectedCount > 1
      ? '<div class="wf-context-item" onclick="Workflow.exportSelected();Workflow.hideContextMenu()">📤 导出选中 (' + multiSelectedCount + ')</div>' +
        '<div class="wf-context-item" onclick="Workflow.batchDelete();Workflow.hideContextMenu()">🗑 批量删除 (' + multiSelectedCount + ')</div>' +
        '<div class="wf-context-item" onclick="Workflow.state.selectedIds.clear();Workflow.renderList();Workflow.hideContextMenu()">✓ 清除多选</div>'
      : '';
    // 全选/取消全选项
    const allCount = this.getFilteredWorkflows().length;
    const selectAllItem = '<div class="wf-context-item" onclick="Workflow.selectAll();Workflow.hideContextMenu()">☑ 全选 (' + allCount + ')</div>';
    menu.innerHTML =
      '<div class="wf-context-item" onclick="Workflow.showCardInfo(\'' + id + '\');Workflow.hideContextMenu()"> 查看信息</div>' +
      aiwfItem +
      '<div class="wf-context-divider"></div>' +
      '<div class="wf-context-item" onclick="Workflow.exportSelected();Workflow.hideContextMenu()">📤 导出</div>' +
      '<div class="wf-context-item" onclick="Workflow.deleteWorkflow(\'' + id + '\');Workflow.hideContextMenu()">🗑 删除</div>' +
      '<div class="wf-context-divider"></div>' +
      batchItems +
      selectAllItem +
      '<div class="wf-context-item" onclick="Workflow.state.selectedIds.clear();Workflow.state.selectedId=null;Workflow.renderList();Workflow.hideContextMenu()">✓ 取消选中</div>';
    document.body.appendChild(menu);

    // 点击其他地方关闭菜单
    setTimeout(() => {
      document.addEventListener('click', this.hideContextMenuOnce, { once: true });
    }, 0);
  },

  // 回收站右键菜单
  showTrashContextMenu(event, id) {
    let menu = document.getElementById('wfContextMenu');
    if (menu) menu.remove();
    menu = document.createElement('div');
    menu.id = 'wfContextMenu';
    menu.className = 'wf-context-menu';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
    menu.innerHTML =
      '<div class="wf-context-item" onclick="Workflow.restoreFromTrash(\'' + id + '\');Workflow.hideContextMenu()">↩ 还原</div>' +
      '<div class="wf-context-item" onclick="Workflow.permanentDelete(\'' + id + '\');Workflow.hideContextMenu()">✕ 永久删除</div>' +
      '<div class="wf-context-divider"></div>' +
      '<div class="wf-context-item" onclick="Workflow.emptyTrash();Workflow.hideContextMenu()">🗑 清空回收站</div>';
    document.body.appendChild(menu);
    setTimeout(() => {
      document.addEventListener('click', this.hideContextMenuOnce, { once: true });
    }, 0);
  },

  // 展开卡片信息面板
  showCardInfo(id) {
    const wf = this.state.workflows.find(w => w.id === id);
    if (!wf) return;

    // 移除已有面板
    let existing = document.getElementById('wfCardInfoPanel');
    if (existing) existing.remove();

    const resources = wf.resources || [];
    const time = wf.createdAt ? new Date(wf.createdAt).toLocaleString('zh-CN') : '';
    const typeIcons = { image: '', video: '🎬', audio: '🎵', link: '🔗', text: '📝' };

    // 资源列表
    const resHtml = resources.map((r, i) => {
      const icon = typeIcons[r.type] || '📄';
      const name = this.escapeHtml(r.name || r.text || '资源' + (i + 1));
      const url = this.escapeHtml(r.url || '');
      const pageUrl = this.escapeHtml(r.pageUrl || '');
      const urlDisplay = url.length > 50 ? url.substring(0, 50) + '...' : url;
      const pageUrlDisplay = pageUrl ? (pageUrl.length > 50 ? pageUrl.substring(0, 50) + '...' : pageUrl) : '';
      let rows = '<div class="wf-info-row"><b>' + icon + ' ' + name + '</b> <span class="wf-info-type">(' + (r.type || 'unknown') + ')</span></div>';
      if (pageUrl) rows += '<div class="wf-info-row wf-info-sub"><b>页面:</b> <a href="' + pageUrl + '" target="_blank" class="wf-info-link" title="' + pageUrl + '">' + pageUrlDisplay + '</a></div>';
      if (url) rows += '<div class="wf-info-row wf-info-sub"><b>资源:</b> <a href="' + url + '" target="_blank" class="wf-info-link" title="' + url + '">' + urlDisplay + '</a></div>';
      return rows;
    }).join('');

    const panel = document.createElement('div');
    panel.id = 'wfCardInfoPanel';
    panel.className = 'wf-card-info-panel';
    panel.innerHTML =
      '<div class="wf-card-info-header">' +
        '<span class="wf-card-info-title">📋 ' + this.escapeHtml(wf.title || '未命名') + '</span>' +
        '<button class="wf-card-info-close" onclick="document.getElementById(\'wfCardInfoPanel\').remove()">✕</button>' +
      '</div>' +
      '<div class="wf-card-info-body">' +
        '<div class="wf-info-section"><b>页面:</b> <a href="' + this.escapeHtml(wf.url || '') + '" target="_blank" class="wf-info-link">' + this.escapeHtml(wf.url || '') + '</a></div>' +
        '<div class="wf-info-section"><b>时间:</b> ' + time + '</div>' +
        '<div class="wf-info-section"><b>资源:</b> ' + resources.length + ' 个</div>' +
        '<div class="wf-info-divider"></div>' +
        '<div class="wf-info-resources">' + resHtml + '</div>' +
      '</div>';
    document.body.appendChild(panel);

    // 点击面板外部关闭
    setTimeout(() => {
      const closeHandler = (e) => {
        if (!panel.contains(e.target)) {
          panel.remove();
          document.removeEventListener('click', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
    }, 0);
  },

  hideContextMenu() {
    const menu = document.getElementById('wfContextMenu');
    if (menu) menu.remove();
  },

  hideContextMenuOnce: () => {
    const menu = document.getElementById('wfContextMenu');
    if (menu) menu.remove();
  },

  async refresh() {
    this.state.selectedId = null;
    this.state.selectedIds.clear();
    if (this.state.showingTrash) {
      await this.loadTrashList();
    } else {
      await this.loadList();
    }
    this.renderList();
    App.showToast(this.state.showingTrash ? '回收站已刷新' : '工作流列表已刷新');
  },

  // ===== 默认导出目录（全局通用，所有 AI 工作流任务未设置路径时回退到此目录） =====
  async openDefaultExportDirDialog() {
    // 已存在则聚焦
    const existing = document.getElementById('wfDefaultExportDialog');
    if (existing) { existing.remove(); }

    const cur = await window.electronAPI?.getDefaultExportDir?.();
    const curDir = cur?.data || '';

    const dlg = document.createElement('div');
    dlg.id = 'wfDefaultExportDialog';
    dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.45);z-index:100000;display:flex;align-items:center;justify-content:center;font-family:inherit;';
    dlg.innerHTML = `
      <div style="background:var(--bg,#fff);color:var(--text,#222);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,0.25);padding:20px 22px;width:520px;max-width:92vw;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="margin:0;font-size:16px;">📁 默认导出目录</h3>
          <button id="wfDefExpClose" style="background:transparent;border:none;font-size:18px;cursor:pointer;color:var(--text2,#888);">✕</button>
        </div>
        <div style="font-size:12px;color:var(--text2,#888);line-height:1.7;margin-bottom:10px;">
          此目录为<b>全局通用</b>默认导出路径。AI 工作流任务（批量抓取 / 末端抓取）若勾选「自动导出」但未设置任务级路径，将自动保存到此目录下。
          <br>所有卡片共用此设置。
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;">
          <input type="text" id="wfDefExpPath" value="${this.escapeHtml(curDir)}" placeholder="未设置（点击右侧选择目录）" style="flex:1;padding:8px 10px;border:1px solid var(--border,#ddd);border-radius:6px;background:var(--bg,#fff);color:var(--text,#222);font-size:13px;" readonly />
          <button id="wfDefExpPick" style="padding:7px 12px;border:1px solid var(--border,#ddd);border-radius:6px;background:var(--bg,#fff);color:var(--text,#222);cursor:pointer;font-size:13px;white-space:nowrap;">📁 选择</button>
          <button id="wfDefExpOpen" style="padding:7px 12px;border:1px solid var(--border,#ddd);border-radius:6px;background:var(--bg,#fff);color:var(--text,#222);cursor:pointer;font-size:13px;white-space:nowrap;" ${curDir ? '' : 'disabled'}>📂 打开</button>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <button id="wfDefExpClear" style="padding:7px 12px;border:1px solid var(--danger,#e74c3c);border-radius:6px;background:transparent;color:var(--danger,#e74c3c);cursor:pointer;font-size:13px;${curDir ? '' : 'visibility:hidden;'}">❌ 清除默认目录</button>
          <div style="display:flex;gap:8px;">
            <button id="wfDefExpCancel" style="padding:7px 16px;border:1px solid var(--border,#ddd);border-radius:6px;background:var(--bg,#fff);color:var(--text,#222);cursor:pointer;font-size:13px;">取消</button>
            <button id="wfDefExpSave" style="padding:7px 18px;border:none;border-radius:6px;background:var(--primary,#3498db);color:#fff;cursor:pointer;font-size:13px;">💾 保存</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);

    let pendingDir = curDir;
    const pathInput = dlg.querySelector('#wfDefExpPath');
    const openBtn = dlg.querySelector('#wfDefExpOpen');
    const clearBtn = dlg.querySelector('#wfDefExpClear');
    const saveBtn = dlg.querySelector('#wfDefExpSave');

    const close = () => dlg.remove();
    const refreshPathUI = () => {
      pathInput.value = pendingDir || '';
      if (pendingDir) {
        openBtn.removeAttribute('disabled');
        clearBtn.style.visibility = 'visible';
      } else {
        openBtn.setAttribute('disabled', '');
        clearBtn.style.visibility = 'hidden';
      }
    };

    dlg.querySelector('#wfDefExpClose').onclick = close;
    dlg.querySelector('#wfDefExpCancel').onclick = close;
    dlg.onclick = (e) => { if (e.target === dlg) close(); };

    dlg.querySelector('#wfDefExpPick').onclick = async () => {
      const result = await window.electronAPI?.selectDirectory?.();
      if (result?.success && result.data) {
        pendingDir = result.data;
        refreshPathUI();
      }
    };

    openBtn.onclick = async () => {
      if (!pendingDir) return;
      const result = await window.electronAPI?.openInExplorer?.(pendingDir);
      if (!result?.success) App.showToast('打开失败：' + (result?.error || '目录不存在'));
    };

    clearBtn.onclick = async () => {
      const result = await window.electronAPI?.setDefaultExportDir?.('');
      if (result?.success) {
        pendingDir = '';
        refreshPathUI();
        App.showToast('✓ 已清除默认导出目录');
      } else {
        App.showToast('清除失败：' + (result?.error || '未知错误'));
      }
    };

    saveBtn.onclick = async () => {
      const result = await window.electronAPI?.setDefaultExportDir?.(pendingDir || '');
      if (result?.success) {
        App.showToast(pendingDir ? '✓ 默认导出目录已保存：' + pendingDir : '✓ 已清除默认导出目录');
        close();
      } else {
        App.showToast('保存失败：' + (result?.error || '未知错误'));
      }
    };
  },

  async exportSelected() {
    // 多选优先：批量导出选中的
    if (this.state.selectedIds.size > 0) {
      const ids = Array.from(this.state.selectedIds);
      const wfs = ids.map(id => this.state.workflows.find(w => String(w.id) === id)).filter(Boolean);
      if (!wfs.length) {
        App.showToast('选中的卡片不存在');
        return;
      }
      let ok = 0, fail = 0;
      let lastPath = '';
      for (const wf of wfs) {
        try {
          const result = await window.electronAPI?.exportWorkflow(wf);
          if (result?.success) {
            ok++;
            lastPath = result.path || '';
          } else {
            fail++;
          }
        } catch (e) {
          fail++;
        }
      }
      App.showToast('已导出 ' + ok + ' 个工作流' + (fail > 0 ? '，' + fail + ' 个失败' : '') + (ok === 1 && lastPath ? '：' + lastPath : ''));
      return;
    }
    // 单选导出
    if (!this.state.selectedId) {
      App.showToast('请先选择一个工作流（或拉框/勾选多个进行批量导出）');
      return;
    }
    try {
      const wf = this.state.workflows.find(w => String(w.id) === String(this.state.selectedId));
      if (!wf) {
        App.showToast('工作流不存在');
        return;
      }
      const result = await window.electronAPI?.exportWorkflow(wf);
      if (result?.success) {
        App.showToast('工作流已导出: ' + result.path);
      } else {
        App.showToast('导出失败: ' + (result?.error || '未知错误'));
      }
    } catch (e) {
      App.showToast('导出失败: ' + e.message);
    }
  },

  // Task 15.5: 在 AI 工作流模块打开来源任务（工作流结果卡片右键菜单项）
  openInAiworkflow(id) {
    const wf = this.state.workflows.find(w => w.id === id);
    if (!wf) return;
    const sourceTaskId = wf.sourceTaskId;
    if (!sourceTaskId) {
      App.showToast('该卡片未关联 AI 工作流任务');
      return;
    }
    if (typeof App === 'undefined' || !App.switchModule) {
      App.showToast('无法切换到 AI 工作流模块');
      return;
    }
    // 切换到 AI 工作流模块并定位任务
    App.switchModule('aiworkflow');
    // 等待模块加载后定位任务（loadList 是异步的）
    setTimeout(() => {
      try {
        if (typeof AIWorkflow === 'undefined' || !AIWorkflow.state) return;
        // 切换到对应类型标签
        if (wf.sourceTaskType && AIWorkflow.switchTab) {
          AIWorkflow.switchTab(wf.sourceTaskType);
        }
        // 设置高亮任务 id，便于 renderList 高亮（若实现）
        AIWorkflow.state.highlightTaskId = String(sourceTaskId);
        const task = (AIWorkflow.state.tasks || []).find(t => String(t.id) === String(sourceTaskId));
        if (task && AIWorkflow.openResultPanel) {
          AIWorkflow.openResultPanel(String(sourceTaskId));
        } else {
          App.showToast('已定位到任务（若未找到，可能任务已删除）');
        }
        AIWorkflow.renderList && AIWorkflow.renderList();
      } catch (e) {
        App.showToast('定位任务失败：' + (e.message || e));
      }
    }, 300);
  },

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  Workflow.init();
});
