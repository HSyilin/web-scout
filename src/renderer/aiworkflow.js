// ===== AI 工作流模块（骨架） =====
// 详细功能将在后续 Task 中实现：
//   Task 4: 新建任务向导
//   Task 5: 任务运行
//   Task 10: 结果面板
//   Task 12: 编辑任务
//   Task 17: 从卡片导入

const AIWorkflow = {
  state: {
    tasks: [],
    activeTab: 'batch',
    runningTasks: new Set(),
    currentWizard: null,
  },

  async init() {
    await this.loadList();
  },

  async loadList() {
    try {
      const result = await window.electronAPI?.aiworkflowAPI?.getAll?.();
      if (result?.success) {
        this.state.tasks = result.data || [];
      } else {
        this.state.tasks = [];
      }
    } catch (e) {
      console.error('AIWorkflow.loadList failed:', e);
      this.state.tasks = [];
    }
    this.renderList();
  },

  filterTasksByTab() {
    return this.state.tasks.filter(t => t.type === this.state.activeTab);
  },

  renderList() {
    const grid = document.getElementById('aiworkflowTaskGrid');
    const empty = document.getElementById('aiworkflowEmpty');
    if (!grid || !empty) return;
    const tasks = this.filterTasksByTab();
    if (!tasks.length) {
      grid.innerHTML = '';
      grid.style.display = 'none';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    grid.style.display = '';
    // 改为桌面图标网格风格
    grid.innerHTML = '<div class="aiworkflow-desktop-grid">' + tasks.map(t => this.renderTaskCard(t)).join('') + '</div>';
  },

  renderTaskCard(task) {
    const type = task.type || 'batch';
    const typeLabel = { batch: '批量', crosspage: '跨页面', tracking: '追踪', template: '末端' }[type] || type;
    const name = this.escapeHtml(task.name || '未命名任务');
    const taskId = this.escapeHtml(String(task.id ?? ''));
    const rawId = String(task.id ?? '');

    const isRunning = this.state.runningTasks.has(rawId) || task.status === 'running';

    let statusDotClass;
    let statusText;
    if (task.type === 'tracking') {
      if (isRunning) { statusDotClass = 'running'; statusText = '运行中'; }
      else if (task.active === false || task.status === 'paused') { statusDotClass = 'idle'; statusText = '已暂停'; }
      else { statusDotClass = 'tracking'; statusText = '追踪中'; }
    } else {
      if (isRunning) { statusDotClass = 'running'; statusText = '运行中'; }
      else { statusDotClass = 'idle'; statusText = '空闲'; }
    }

    const lastRunText = task.lastRunAt ? this.formatTime(task.lastRunAt) : '未运行';

    const results = Array.isArray(task.results) ? task.results : [];
    let totalItems = 0;
    results.forEach(r => {
      if (r && Array.isArray(r.items)) totalItems += r.items.length;
      else if (r && typeof r.count === 'number') totalItems += r.count;
    });

    const typeIcons = { batch: '📦', crosspage: '🌐', tracking: '🔔', template: '📋' };
    const mainEmoji = typeIcons[type] || '📦';

    const runBtn = isRunning
      ? `<button class="wf-icon-action" disabled title="运行中">⏳</button>`
      : `<button class="wf-icon-action" onclick="event.stopPropagation();AIWorkflow.runTask('${taskId}')" title="运行">▶</button>`;
    const chainBtn = isRunning
      ? ''
      : `<button class="wf-icon-action" onclick="event.stopPropagation();AIWorkflow.chainRunTask('${taskId}')" title="链式运行（含下游任务）">🔗</button>`;
    const trackingBtn = task.type === 'tracking'
      ? (task.active === false || task.status === 'paused'
        ? `<button class="wf-icon-action" onclick="event.stopPropagation();AIWorkflow.resumeTracking('${taskId}')" title="恢复">⏯</button>`
        : `<button class="wf-icon-action" onclick="event.stopPropagation();AIWorkflow.pauseTracking('${taskId}')" title="暂停">⏸</button>`)
      : '';

    return `
      <div class="aiworkflow-desktop-icon" data-id="${taskId}"
           oncontextmenu="AIWorkflow.showTaskContextMenu(event,'${taskId}')">
        <div class="wf-icon-image">
          <div class="wf-icon-emoji">${mainEmoji}</div>
          <div class="wf-icon-count">${totalItems}</div>
        </div>
        <div class="wf-icon-title">${name}</div>
        <div class="wf-icon-meta">${this.escapeHtml(lastRunText)}</div>
        <div class="wf-icon-badges">
          <span class="wf-icon-badge task-type-badge ${type}">${this.escapeHtml(typeLabel)}</span>
          <span class="wf-icon-badge"><span class="status-dot ${statusDotClass}"></span> ${this.escapeHtml(statusText)}</span>
        </div>
        <div class="wf-icon-actions">
          ${runBtn}
          ${chainBtn}
          ${trackingBtn}
          <button class="wf-icon-action" onclick="event.stopPropagation();AIWorkflow.openResultPanel('${taskId}')" title="查看结果">👁</button>
          <button class="wf-icon-action" onclick="event.stopPropagation();AIWorkflow.editTask('${taskId}')" title="编辑">✎</button>
          <button class="wf-icon-action wf-icon-action-danger" onclick="event.stopPropagation();AIWorkflow.deleteTask('${taskId}')" title="删除" ${isRunning ? 'disabled' : ''}>🗑</button>
        </div>
      </div>
    `;
  },

  showTaskContextMenu(e, taskId) {
    e.preventDefault();
    e.stopPropagation();
    const existing = document.querySelector('.wf-context-menu');
    if (existing) existing.remove();
    const task = this.state.tasks.find(t => String(t.id) === taskId);
    if (!task) return;
    const isRunning = this.state.runningTasks.has(taskId) || task.status === 'running';
    const menu = document.createElement('div');
    menu.className = 'wf-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    let items = [
      { label: '▶ 运行', action: `AIWorkflow.runTask('${taskId}')`, disabled: isRunning },
      { label: '🔗 链式运行（含下游任务）', action: `AIWorkflow.chainRunTask('${taskId}')`, disabled: isRunning },
      { label: '👁 查看结果', action: `AIWorkflow.openResultPanel('${taskId}')` },
      { label: '✎ 编辑', action: `AIWorkflow.editTask('${taskId}')` },
    ];
    if (task.type === 'tracking') {
      if (task.active === false || task.status === 'paused') {
        items.push({ label: '⏯ 恢复追踪', action: `AIWorkflow.resumeTracking('${taskId}')` });
      } else {
        items.push({ label: '⏸ 暂停追踪', action: `AIWorkflow.pauseTracking('${taskId}')` });
      }
    }
    items.push({ label: '🗑 删除', action: `AIWorkflow.deleteTask('${taskId}')`, danger: true, disabled: isRunning });
    menu.innerHTML = items.map(item =>
      `<div class="wf-context-item${item.danger ? ' danger' : ''}"${item.disabled ? ' style="opacity:0.4;pointer-events:none;"' : ''} onclick="${item.action};this.parentElement.remove()">${item.label}</div>`
    ).join('');
    document.body.appendChild(menu);
    const closeMenu = (ev) => {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeMenu); }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  },

  switchTab(tab) {
    this.state.activeTab = tab;
    document.querySelectorAll('.aiworkflow-tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
    this.renderList();
  },

  // ===== Task 4: 任务创建向导 =====
  // type: 任务类型；existingTask（可选）：编辑模式时传入已有任务，预填配置；prefillConfig（可选）：新建任务的预填配置
  openCreateWizard(type, existingTask, prefillConfig) {
    type = type || 'batch';
    let totalSteps = 3;
    let data = {
      url: '',
      selector: '',
      classifyBy: 'none',
      preserveRelations: true,
      name: '',
    };
    if (type === 'crosspage') {
      totalSteps = 4;
      data = {
        urls: '',
        selector: '',
        fieldMappings: [],
        overrides: [],
        sourceTaskId: '',
        sourceField: 'href',
        name: '',
      };
    } else if (type === 'tracking') {
      totalSteps = 4;
      data = {
        url: '',
        selector: '',
        idField: 'href',
        intervalMinutes: 30,
        name: '',
      };
    } else if (type === 'template') {
      totalSteps = 4;
      data = {
        sampleUrls: '',      // 样本网页（1-2个，用于配置模板）
        fields: [],          // 模板字段配置
        urls: '',            // 目标网页（多选，按模板批量抓取）
        sourceTaskId: '',    // 链式数据源（样本）
        targetSourceTaskId: '', // 链式数据源（目标）
        sourceField: 'url',
        name: '',
      };
    }

    // 编辑模式：从 existingTask.config 预填字段
    let editingTaskId = null;
    if (existingTask && existingTask.id) {
      editingTaskId = String(existingTask.id);
      const cfg = existingTask.config || {};
      data.name = existingTask.name || '';
      if (type === 'crosspage') {
        if (Array.isArray(cfg.urls)) data.urls = cfg.urls.join('\n');
        else if (typeof cfg.urls === 'string') data.urls = cfg.urls;
        data.selector = cfg.selector || '';
        data.fieldMappings = Array.isArray(cfg.fieldMappings) ? cfg.fieldMappings.map(m => ({ name: m.name || '', selector: m.selector || '', attr: m.attr || 'text' })) : [];
        data.overrides = Array.isArray(cfg.overrides) ? cfg.overrides : [];
        data.sourceTaskId = cfg.sourceTaskId || '';
        data.sourceField = cfg.sourceField || 'href';
      } else if (type === 'tracking') {
        data.url = cfg.url || '';
        data.selector = cfg.selector || '';
        data.idField = cfg.idField || 'href';
        data.intervalMinutes = Number(cfg.intervalMinutes) || 30;
      } else if (type === 'template') {
        // 兼容旧版单 url 字段
        if (Array.isArray(cfg.sampleUrls)) data.sampleUrls = cfg.sampleUrls.join('\n');
        else if (typeof cfg.sampleUrls === 'string') data.sampleUrls = cfg.sampleUrls;
        else if (cfg.url) data.sampleUrls = cfg.url;
        if (Array.isArray(cfg.urls)) data.urls = cfg.urls.join('\n');
        else if (typeof cfg.urls === 'string') data.urls = cfg.urls;
        else if (cfg.url) data.urls = cfg.url;
        data.fields = Array.isArray(cfg.fields) ? cfg.fields.map(f => ({ name: f.name || '', selector: f.selector || '', attr: f.attr || 'text', extractType: f.extractType || 'text' })) : [];
        data.sourceTaskId = cfg.sourceTaskId || '';
        data.targetSourceTaskId = cfg.targetSourceTaskId || '';
        data.sourceField = cfg.sourceField || 'url';
      } else {
        // batch
        data.url = cfg.url || '';
        data.selector = cfg.selector || '';
        data.classifyBy = cfg.classifyBy || 'none';
        data.preserveRelations = (typeof cfg.preserveRelations === 'boolean') ? cfg.preserveRelations : true;
      }
    } else if (prefillConfig && typeof prefillConfig === 'object') {
      // Task 17.2: 新建任务的预填配置（从抓取信息卡片导入）
      const pc = prefillConfig;
      if (type === 'crosspage') {
        if (Array.isArray(pc.urls)) data.urls = pc.urls.join('\n');
        else if (typeof pc.urls === 'string') data.urls = pc.urls;
        data.selector = pc.selector || '';
        data.fieldMappings = Array.isArray(pc.fieldMappings) ? pc.fieldMappings.map(m => ({ name: m.name || '', selector: m.selector || '', attr: m.attr || 'text' })) : [];
        data.overrides = Array.isArray(pc.overrides) ? pc.overrides : [];
      } else if (type === 'tracking') {
        data.url = pc.url || '';
        data.selector = pc.selector || '';
        if (pc.idField) data.idField = pc.idField;
        if (pc.intervalMinutes) data.intervalMinutes = Number(pc.intervalMinutes) || 30;
      } else if (type === 'template') {
        if (pc.url) data.sampleUrls = pc.url;
        if (Array.isArray(pc.sampleUrls)) data.sampleUrls = pc.sampleUrls.join('\n');
        else if (typeof pc.sampleUrls === 'string') data.sampleUrls = pc.sampleUrls;
        if (Array.isArray(pc.urls)) data.urls = pc.urls.join('\n');
        else if (typeof pc.urls === 'string') data.urls = pc.urls;
        data.fields = Array.isArray(pc.fields) ? pc.fields.map(f => ({ name: f.name || '', selector: f.selector || '', attr: f.attr || 'text', extractType: f.extractType || 'text' })) : [];
      } else {
        // batch
        data.url = pc.url || '';
        data.selector = pc.selector || '';
        if (pc.classifyBy) data.classifyBy = pc.classifyBy;
        if (typeof pc.preserveRelations === 'boolean') data.preserveRelations = pc.preserveRelations;
      }
    }

    this.state.currentWizard = {
      type: type,
      step: 1,
      totalSteps: totalSteps,
      data: data,
      editingTaskId: editingTaskId,
      existingTask: existingTask || null,
      prefillConfig: prefillConfig || null,
    };
    this.renderWizard();
  },

  renderWizard() {
    const wiz = this.state.currentWizard;
    if (!wiz) return;

    // 移除已存在的向导模态
    const existing = document.getElementById('aiworkflowWizardModal');
    if (existing) existing.remove();

    const stepTitles = {
      batch: ['目标 URL', '选择器', '分类与保存'],
      crosspage: ['多 URL', '选择器', '字段映射', '保存'],
      tracking: ['目标 URL', '条目选择器', '标识与轮询', '保存'],
      template: ['样本网页', '字段配置', '目标网页', '保存'],
    };
    const titles = stepTitles[wiz.type] || stepTitles.batch;
    const isEditing = !!wiz.editingTaskId;
    const titleMap = {
      batch: isEditing ? '✎ 编辑批量抓取任务' : ' 新建批量抓取任务',
      crosspage: isEditing ? '✎ 编辑跨页面抓取任务' : '🌐 新建跨页面抓取任务',
      tracking: isEditing ? '✎ 编辑更新追踪任务' : '🔔 新建更新追踪任务',
      template: isEditing ? '✎ 编辑末端抓取任务' : '🎯 新建末端抓取任务',
    };
    const headerTitle = titleMap[wiz.type] || titleMap.batch;

    const stepsHtml = titles.map((t, i) => {
      const stepNum = i + 1;
      const cls = wiz.step === stepNum ? 'active' : (wiz.step > stepNum ? 'done' : '');
      return `<div class="wizard-step ${cls}">${stepNum}. ${this.escapeHtml(t)}</div>`;
    }).join('');

    const modal = document.createElement('div');
    modal.id = 'aiworkflowWizardModal';
    modal.className = 'aiworkflow-modal';
    modal.innerHTML = `
      <div class="aiworkflow-modal-content" style="max-width:640px;">
        <div class="aiworkflow-modal-header">
          <h3>${headerTitle}</h3>
          <button class="aiworkflow-modal-close" onclick="AIWorkflow.closeWizard()">×</button>
        </div>
        <div class="aiworkflow-wizard-steps">
          ${stepsHtml}
        </div>
        <div id="wizardBody"></div>
      </div>
    `;
    document.body.appendChild(modal);

    // 点击遮罩关闭
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeWizard();
    });

    this.renderWizardStep();
  },

  renderWizardStep() {
    const wiz = this.state.currentWizard;
    if (!wiz) return;
    const body = document.getElementById('wizardBody');
    if (!body) return;

    // Step 4 需要预加载全局默认导出目录（仅当未设置任务级临时路径时）
    if (wiz.step === 4 && wiz.data && !wiz.data._defaultExportDir) {
      window.electronAPI?.getDefaultExportDir?.().then(cur => {
        if (cur?.success && cur.data && wiz.data) {
          wiz.data._defaultExportDir = cur.data;
          // 仅在仍是 step 4 时刷新一次（避免递归）
          if (wiz.step === 4 && !wiz.data.exportPath) {
            const input = document.getElementById('wizardExportPath');
            if (input && !input.value) input.value = cur.data;
          }
        }
      }).catch(() => {});
    }

    if (wiz.type === 'crosspage') {
      this.renderCrosspageStep(wiz, body);
    } else if (wiz.type === 'tracking') {
      this.renderTrackingStep(wiz, body);
    } else if (wiz.type === 'template') {
      this.renderTemplateStep(wiz, body);
    } else {
      this.renderBatchStep(wiz, body);
    }
  },

  renderBatchStep(wiz, body) {
    if (wiz.step === 1) {
      body.innerHTML = `
        <div class="aiworkflow-form-group">
          <button class="task-action-btn" onclick="AIWorkflow.openTemplatePicker()" style="white-space:nowrap;margin-bottom:14px;">📂 导入抓取方案模板</button>
          <label>目标页面 URL</label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="wizardUrlInput" placeholder="https://example.com/page" value="${this.escapeHtml(wiz.data.url)}" style="flex:1;" />
            <button class="task-action-btn" onclick="AIWorkflow.pickUrlFromCards(false)" style="white-space:nowrap;">🗂 从卡片获取</button>
            <button class="task-action-btn" onclick="AIWorkflow.clearUrlField('wizardUrlInput','url')" style="white-space:nowrap;">🗑 清空</button>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:18px;">
          <button class="task-action-btn" onclick="AIWorkflow.closeWizard()">取消</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" onclick="AIWorkflow.wizardNext()">下一步 →</button>
        </div>
      `;
      const urlInput = document.getElementById('wizardUrlInput');
      urlInput.addEventListener('input', (e) => { wiz.data.url = e.target.value; });
    } else if (wiz.step === 2) {
      const matchMode = wiz.data.matchMode || 'all';
      const matchLimit = wiz.data.matchLimit || '';
      const hasPreview = Array.isArray(wiz.data.matchedPreview) && wiz.data.matchedPreview.length > 0;
      const previewHtml = hasPreview ? this.renderMatchPreview(wiz.data.matchedPreview) : '';
      // 计算 max：取页面选取和测试匹配中较大的总数
      const pagePickedCount = Array.isArray(wiz.data.pagePickedPreview) ? wiz.data.pagePickedPreview.length : 0;
      const testMatchedCount = Array.isArray(wiz.data.testMatchedPreview) ? wiz.data.testMatchedPreview.length : 0;
      const matchedCount = Array.isArray(wiz.data.matchedPreview) ? wiz.data.matchedPreview.length : 0;
      const maxLimit = Math.max(pagePickedCount, testMatchedCount, matchedCount, 1);
      const maxLimitStr = String(maxLimit);
      body.innerHTML = `
        <style>
          #wizardMatchLimit::-webkit-inner-spin-button,
          #wizardMatchLimit::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
          #wizardMatchLimit { -moz-appearance: textfield; }
        </style>
        <div class="aiworkflow-form-group">
          <label>CSS 选择器（用于定位要抓取的元素）<span style="color:var(--text2);font-size:11px;font-weight:normal;margin-left:8px;">提示：在页面选择时可点击 2-3 个同类元素自动生成通用选择器</span></label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <input type="text" id="wizardSelectorInput" placeholder="例如 .comment-item 或 article.post" value="${this.escapeHtml(wiz.data.selector)}" style="flex:1;min-width:160px;" />
            <button class="task-action-btn" onclick="AIWorkflow.pickSelector(AIWorkflow.state.currentWizard && AIWorkflow.state.currentWizard.data.url)" style="white-space:nowrap;">🎯 在页面选择</button>
            <button class="task-action-btn" id="wizardTestBtn" onclick="AIWorkflow.testSelector()" style="white-space:nowrap;">🧪 测试匹配</button>
            <button class="task-action-btn" onclick="AIWorkflow.aiGenerateSelector()" style="white-space:nowrap;">🤖 AI 生成</button>
          </div>
          <div style="margin-top:8px;">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text2);">
              <input type="checkbox" id="wizardTestScroll" style="width:auto;" checked />
              <span>滚动到底部（触发懒加载，获取全部元素）</span>
            </label>
          </div>
        </div>
        <div id="wizardTestResult" style="min-height:24px;font-size:12px;color:var(--text2);margin-top:6px;"></div>
        <div id="wizardPreviewArea">${previewHtml}</div>
        <div class="aiworkflow-form-group">
          <label>匹配数量控制${(pagePickedCount > 0 || testMatchedCount > 0) ? ` <span style="color:var(--text2);font-size:11px;font-weight:normal;">（页面选取 ${pagePickedCount} · 测试匹配 ${testMatchedCount} · 最大可选 ${maxLimit}）</span>` : ''}</label>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;">
              <input type="radio" name="wizardMatchMode" value="default" ${matchMode === 'default' ? 'checked' : ''} style="width:auto;" />
              <span>默认（当前页面匹配数）</span>
            </label>
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;">
              <input type="radio" name="wizardMatchMode" value="all" ${matchMode === 'all' ? 'checked' : ''} style="width:auto;" />
              <span>全部（all）</span>
            </label>
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;">
              <input type="radio" name="wizardMatchMode" value="limit" ${matchMode === 'limit' ? 'checked' : ''} style="width:auto;" />
              <span>指定数量：</span>
            </label>
            <input type="number" id="wizardMatchLimit" min="1" max="${maxLimitStr}" placeholder="如 100" value="${this.escapeHtml(matchLimit)}" style="width:120px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);color:var(--text);font-size:12px;${matchMode !== 'limit' ? 'opacity:0.4;' : ''}" ${matchMode !== 'limit' ? 'disabled' : ''} />
            ${(pagePickedCount > 0 || testMatchedCount > 0) ? `<span style="font-size:11px;color:var(--text2);">/ ${maxLimitStr}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:18px;">
          <button class="task-action-btn" onclick="AIWorkflow.wizardPrev()">← 上一步</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" onclick="AIWorkflow.wizardNext()">下一步 →</button>
        </div>
      `;
      const selInput = document.getElementById('wizardSelectorInput');
      selInput.addEventListener('input', (e) => { wiz.data.selector = e.target.value; });
      // 匹配数量控制
      const modeRadios = document.querySelectorAll('input[name="wizardMatchMode"]');
      const limitInput = document.getElementById('wizardMatchLimit');
      modeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
          wiz.data.matchMode = e.target.value;
          limitInput.disabled = e.target.value !== 'limit';
          limitInput.style.opacity = e.target.value !== 'limit' ? '0.4' : '1';
        });
      });
      limitInput.addEventListener('input', (e) => {
        // 限制输入范围 1 ~ maxLimit
        let v = e.target.value;
        if (v !== '') {
          let n = parseInt(v, 10);
          if (isNaN(n) || n < 1) n = 1;
          if (n > maxLimit) n = maxLimit;
          if (String(n) !== v) e.target.value = String(n);
          wiz.data.matchLimit = String(n);
        } else {
          wiz.data.matchLimit = '';
        }
      });
    } else if (wiz.step === 3) {
      // 问题2：添加数据源选择器
      const hasPagePicked = Array.isArray(wiz.data.pagePickedPreview) && wiz.data.pagePickedPreview.length > 0;
      const hasTestMatched = Array.isArray(wiz.data.testMatchedPreview) && wiz.data.testMatchedPreview.length > 0;
      const dataSource = wiz.data.dataSource || 'page'; // 'page' 或 'test'
      
      // 根据数据源选择使用不同的预览数据
      const currentPreview = dataSource === 'test' ? wiz.data.testMatchedPreview : wiz.data.pagePickedPreview;
      const hasPreview = Array.isArray(currentPreview) && currentPreview.length > 0;
      const classifyPreviewHtml = hasPreview ? this.renderClassifyPreview(currentPreview, wiz.data.classifyBy || 'none') : '';
      
      body.innerHTML = `
        ${hasPagePicked || hasTestMatched ? `
        <div class="aiworkflow-form-group">
          <label>数据源选择</label>
          <div style="display:flex;gap:16px;margin-bottom:8px;">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">
              <input type="radio" name="dataSource" value="page" ${dataSource === 'page' ? 'checked' : ''} style="width:auto;" />
              <span>页面选取元素${hasPagePicked ? ` (${wiz.data.pagePickedCount || wiz.data.pagePickedPreview.length} 个)` : ''}</span>
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">
              <input type="radio" name="dataSource" value="test" ${dataSource === 'test' ? 'checked' : ''} style="width:auto;" />
              <span>测试匹配元素${hasTestMatched ? ` (${wiz.data.testMatchedCount || wiz.data.testMatchedPreview.length} 个)` : ''}</span>
            </label>
          </div>
          <div style="font-size:11px;color:var(--text2);margin-top:4px;">
            ${hasPagePicked && hasTestMatched ? '✓ 两种数据源均可用，可选择更合适的' : 
              hasPagePicked ? '✓ 使用页面选取的元素（在抓取模式下选取）' :
              hasTestMatched ? '✓ 使用测试匹配的元素（通过测试匹配功能获取）' :
              '⚠ 暂无可用数据，请先在步骤2中选取或匹配元素'}
          </div>
        </div>
        ` : ''}
        <div class="aiworkflow-form-group">
          <label>分类规则</label>
          <select id="wizardClassifyBy">
            <option value="none" ${wiz.data.classifyBy === 'none' ? 'selected' : ''}>不分类</option>
            <option value="class" ${wiz.data.classifyBy === 'class' ? 'selected' : ''}>按 class 分组</option>
            <option value="data-attr" ${wiz.data.classifyBy === 'data-attr' ? 'selected' : ''}>按 data-属性 分组</option>
            <option value="dom-position" ${wiz.data.classifyBy === 'dom-position' ? 'selected' : ''}>按 DOM 位置（父元素 tag）</option>
          </select>
          <div id="classifyPreviewArea">${classifyPreviewHtml}</div>
        </div>
        <div class="aiworkflow-form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="wizardPreserveRelations" ${wiz.data.preserveRelations ? 'checked' : ''} style="width:auto;" />
            <span>保留楼层关系（提取 parentId / level，适用于评论楼层）</span>
          </label>
        </div>
        <div class="aiworkflow-form-group">
          <label>自动导出（任务执行完成后自动保存结果到文件）</label>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">
              <input type="checkbox" id="wizardAutoExport" ${wiz.data.autoExport ? 'checked' : ''} style="width:auto;" />
              <span>启用自动导出</span>
            </label>
          </div>
          <div id="exportConfigArea" style="${wiz.data.autoExport ? '' : 'display:none;'}">
            <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
              <label style="font-size:12px;color:var(--text2);white-space:nowrap;">导出格式：</label>
              <select id="wizardExportFormat" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);color:var(--text);font-size:12px;">
                <option value="json" ${wiz.data.exportFormat === 'json' ? 'selected' : ''}>JSON</option>
                <option value="csv" ${wiz.data.exportFormat === 'csv' ? 'selected' : ''}>CSV (Excel 可打开)</option>
                <option value="md" ${wiz.data.exportFormat === 'md' ? 'selected' : ''}>Markdown</option>
                <option value="txt" ${wiz.data.exportFormat === 'txt' ? 'selected' : ''}>纯文本</option>
              </select>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <label style="font-size:12px;color:var(--text2);white-space:nowrap;">目标文件夹：</label>
              <input type="text" id="wizardExportPath" placeholder="点击右侧按钮选择文件夹" value="${this.escapeHtml(wiz.data.exportPath || '')}" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);color:var(--text);font-size:12px;" readonly />
              <button class="task-action-btn" onclick="AIWorkflow.pickExportFolder()" style="white-space:nowrap;font-size:12px;">📁 选择文件夹</button>
            </div>
          </div>
        </div>
        <div class="aiworkflow-form-group">
          <label>任务名称</label>
          <input type="text" id="wizardNameInput" placeholder="例如：某页面评论批量抓取" value="${this.escapeHtml(wiz.data.name)}" />
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:18px;">
          <button class="task-action-btn" onclick="AIWorkflow.wizardPrev()">← 上一步</button>
          <div style="display:flex;gap:8px;">
            <button class="task-action-btn" onclick="AIWorkflow.saveAsTemplate()">💾 另存为模板</button>
            <button class="task-action-btn" style="background:var(--success);color:#fff;border-color:var(--success);" onclick="AIWorkflow.saveTask()">💾 保存任务</button>
          </div>
        </div>
      `;
      // 问题2：数据源切换事件
      const dataSourceRadios = document.querySelectorAll('input[name="dataSource"]');
      dataSourceRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
          wiz.data.dataSource = e.target.value;
          // 根据数据源更新matchedPreview
          if (e.target.value === 'test' && Array.isArray(wiz.data.testMatchedPreview)) {
            wiz.data.matchedPreview = wiz.data.testMatchedPreview;
            wiz.data.matchedCount = wiz.data.testMatchedCount;
          } else if (e.target.value === 'page' && Array.isArray(wiz.data.pagePickedPreview)) {
            wiz.data.matchedPreview = wiz.data.pagePickedPreview;
            wiz.data.matchedCount = wiz.data.pagePickedCount;
          }
          // 更新分类预览
          const previewArea = document.getElementById('classifyPreviewArea');
          if (previewArea && Array.isArray(wiz.data.matchedPreview) && wiz.data.matchedPreview.length) {
            previewArea.innerHTML = this.renderClassifyPreview(wiz.data.matchedPreview, wiz.data.classifyBy || 'none');
          }
        });
      });
      // 分类规则变化时实时更新分类预览
      document.getElementById('wizardClassifyBy').addEventListener('change', (e) => {
        wiz.data.classifyBy = e.target.value;
        const previewArea = document.getElementById('classifyPreviewArea');
        if (previewArea && Array.isArray(wiz.data.matchedPreview) && wiz.data.matchedPreview.length) {
          previewArea.innerHTML = this.renderClassifyPreview(wiz.data.matchedPreview, e.target.value);
        }
      });
      document.getElementById('wizardPreserveRelations').addEventListener('change', (e) => { wiz.data.preserveRelations = e.target.checked; });
      document.getElementById('wizardNameInput').addEventListener('input', (e) => { wiz.data.name = e.target.value; });
      // 自动导出开关
      const autoExportCb = document.getElementById('wizardAutoExport');
      if (autoExportCb) {
        autoExportCb.addEventListener('change', (e) => {
          wiz.data.autoExport = e.target.checked;
          const area = document.getElementById('exportConfigArea');
          if (area) area.style.display = e.target.checked ? '' : 'none';
        });
      }
      // 导出格式
      const exportFormatSel = document.getElementById('wizardExportFormat');
      if (exportFormatSel) {
        exportFormatSel.addEventListener('change', (e) => { wiz.data.exportFormat = e.target.value; });
      }
    }
  },

  renderCrosspageStep(wiz, body) {
    if (wiz.step === 1) {
      body.innerHTML = `
        <div class="aiworkflow-form-group">
          <button class="task-action-btn" onclick="AIWorkflow.openTemplatePicker()" style="white-space:nowrap;margin-bottom:14px;">📂 导入抓取方案模板</button>
          <label>目标页面 URL（每行一个）</label>
          <textarea id="wizardUrlsInput" rows="6" placeholder="https://example.com/page1&#10;https://example.com/page2" style="width:100%;font-family:inherit;resize:vertical;box-sizing:border-box;">${this.escapeHtml(wiz.data.urls || '')}</textarea>
          <div style="margin-top:6px;">
            <button class="task-action-btn" onclick="AIWorkflow.pickUrlFromCards(true)">🗂 从卡片获取（多选追加）</button>
            <button class="task-action-btn" onclick="AIWorkflow.clearUrlField('wizardUrlsInput','urls')">🗑 清空</button>
          </div>
        </div>
        <div class="aiworkflow-form-group">
          <label>链式数据源（可选：运行时自动从上游任务结果导入 URL）</label>
          <div id="sourceTaskSelectorArea"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:18px;">
          <button class="task-action-btn" onclick="AIWorkflow.closeWizard()">取消</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" onclick="AIWorkflow.wizardNext()">下一步 →</button>
        </div>
      `;
      const ta = document.getElementById('wizardUrlsInput');
      ta.addEventListener('input', (e) => { wiz.data.urls = e.target.value; });
      this.initSourceTaskSelector(wiz);
    } else if (wiz.step === 2) {
      const firstUrl = (wiz.data.urls || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
      body.innerHTML = `
        <div class="aiworkflow-form-group">
          <label>CSS 选择器（条目容器，可选；字段映射基于此容器内查找）</label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="wizardSelectorInput" placeholder="例如 .item 或 article（可留空）" value="${this.escapeHtml(wiz.data.selector || '')}" style="flex:1;" />
            <button class="task-action-btn" onclick="AIWorkflow.pickSelector(${JSON.stringify(firstUrl)})" style="white-space:nowrap;">🎯 在页面选择</button>
            <button class="task-action-btn" onclick="AIWorkflow.testSelector()" style="white-space:nowrap;">🧪 测试匹配</button>
          </div>
          <div style="font-size:11px;color:var(--text2);margin-top:4px;">目标页：${this.escapeHtml(firstUrl || '(未设置)')}</div>
        </div>
        <div id="wizardTestResult" style="min-height:24px;font-size:12px;color:var(--text2);margin-top:6px;"></div>
        <div style="display:flex;justify-content:space-between;margin-top:18px;">
          <button class="task-action-btn" onclick="AIWorkflow.wizardPrev()">← 上一步</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" onclick="AIWorkflow.wizardNext()">下一步 →</button>
        </div>
      `;
      const selInput = document.getElementById('wizardSelectorInput');
      selInput.addEventListener('input', (e) => { wiz.data.selector = e.target.value; });
    } else if (wiz.step === 3) {
      const mappings = Array.isArray(wiz.data.fieldMappings) ? wiz.data.fieldMappings : [];
      const rowsHtml = mappings.map((m, i) => this.renderFieldMappingRow(m.name, m.selector, m.attr, m.extractType, i)).join('');
      body.innerHTML = `
        <div class="aiworkflow-form-group">
          <label>字段映射（每行 = 字段名 + 子选择器 + 取值属性）</label>
          <div id="fieldMappingList">${rowsHtml}</div>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
            <button class="task-action-btn" onclick="AIWorkflow.addFieldMappingRow()">➕ 添加字段</button>
            <button class="task-action-btn" onclick="AIWorkflow.pickCardForFieldSample()">📋 从卡片导入样例</button>
            <button class="task-action-btn" onclick="AIWorkflow.aiInferFields()">🤖 AI 推断字段</button>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:18px;">
          <button class="task-action-btn" onclick="AIWorkflow.wizardPrev()">← 上一步</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" onclick="AIWorkflow.wizardNext()">下一步 →</button>
        </div>
      `;
    } else if (wiz.step === 4) {
      body.innerHTML = `
        <div class="aiworkflow-form-group">
          <label>任务名称</label>
          <input type="text" id="wizardNameInput" placeholder="例如：多页面文章抓取" value="${this.escapeHtml(wiz.data.name || '')}" />
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:18px;">
          <button class="task-action-btn" onclick="AIWorkflow.wizardPrev()">← 上一步</button>
          <div style="display:flex;gap:8px;">
            <button class="task-action-btn" onclick="AIWorkflow.saveAsTemplate()">💾 另存为模板</button>
            <button class="task-action-btn" style="background:var(--success);color:#fff;border-color:var(--success);" onclick="AIWorkflow.saveTask()">💾 保存任务</button>
          </div>
        </div>
      `;
      document.getElementById('wizardNameInput').addEventListener('input', (e) => { wiz.data.name = e.target.value; });
    }
  },

  renderTrackingStep(wiz, body) {
    if (wiz.step === 1) {
      body.innerHTML = `
        <div class="aiworkflow-form-group">
          <button class="task-action-btn" onclick="AIWorkflow.openTemplatePicker()" style="white-space:nowrap;margin-bottom:14px;">📂 导入抓取方案模板</button>
          <label>目标页面 URL</label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="wizardUrlInput" placeholder="https://example.com/page" value="${this.escapeHtml(wiz.data.url || '')}" style="flex:1;" />
            <button class="task-action-btn" onclick="AIWorkflow.pickUrlFromCards(false)" style="white-space:nowrap;">🗂 从卡片获取</button>
            <button class="task-action-btn" onclick="AIWorkflow.clearUrlField('wizardUrlInput','url')" style="white-space:nowrap;">🗑 清空</button>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:18px;">
          <button class="task-action-btn" onclick="AIWorkflow.closeWizard()">取消</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" onclick="AIWorkflow.wizardNext()">下一步 →</button>
        </div>
      `;
      const urlInput = document.getElementById('wizardUrlInput');
      urlInput.addEventListener('input', (e) => { wiz.data.url = e.target.value; });
    } else if (wiz.step === 2) {
      body.innerHTML = `
        <div class="aiworkflow-form-group">
          <label>条目选择器（定位要追踪的列表项）</label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="wizardSelectorInput" placeholder="例如 .list-item 或 article" value="${this.escapeHtml(wiz.data.selector || '')}" style="flex:1;" />
            <button class="task-action-btn" onclick="AIWorkflow.pickSelector(AIWorkflow.state.currentWizard && AIWorkflow.state.currentWizard.data.url)" style="white-space:nowrap;">🎯 在页面选择</button>
            <button class="task-action-btn" onclick="AIWorkflow.testSelector()" style="white-space:nowrap;">🧪 测试匹配</button>
          </div>
        </div>
        <div id="wizardTestResult" style="min-height:24px;font-size:12px;color:var(--text2);margin-top:6px;"></div>
        <div style="display:flex;justify-content:space-between;margin-top:18px;">
          <button class="task-action-btn" onclick="AIWorkflow.wizardPrev()">← 上一步</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" onclick="AIWorkflow.wizardNext()">下一步 →</button>
        </div>
      `;
      const selInput = document.getElementById('wizardSelectorInput');
      selInput.addEventListener('input', (e) => { wiz.data.selector = e.target.value; });
    } else if (wiz.step === 3) {
      const idFields = [
        { value: 'href', label: 'href（链接地址）' },
        { value: 'data-id', label: 'data-id' },
        { value: 'data-pid', label: 'data-pid' },
        { value: 'id', label: 'id' },
        { value: 'textContent', label: 'textContent（文本前200字）' },
      ];
      const idOpts = idFields.map(f => `<option value="${f.value}" ${wiz.data.idField === f.value ? 'selected' : ''}>${this.escapeHtml(f.label)}</option>`).join('');
      const intervals = [
        { value: 10, label: '10 分钟' },
        { value: 30, label: '30 分钟' },
        { value: 60, label: '1 小时' },
        { value: 360, label: '6 小时' },
        { value: 1440, label: '24 小时' },
      ];
      const intOpts = intervals.map(f => `<option value="${f.value}" ${Number(wiz.data.intervalMinutes) === f.value ? 'selected' : ''}>${this.escapeHtml(f.label)}</option>`).join('');
      body.innerHTML = `
        <div class="aiworkflow-form-group">
          <label>唯一标识字段</label>
          <select id="wizardIdField">${idOpts}</select>
        </div>
        <div class="aiworkflow-form-group">
          <label>轮询间隔</label>
          <select id="wizardInterval">${intOpts}</select>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:18px;">
          <button class="task-action-btn" onclick="AIWorkflow.wizardPrev()">← 上一步</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" onclick="AIWorkflow.wizardNext()">下一步 →</button>
        </div>
      `;
      document.getElementById('wizardIdField').addEventListener('change', (e) => { wiz.data.idField = e.target.value; });
      document.getElementById('wizardInterval').addEventListener('change', (e) => { wiz.data.intervalMinutes = Number(e.target.value); });
    } else if (wiz.step === 4) {
      body.innerHTML = `
        <div class="aiworkflow-form-group">
          <label>任务名称</label>
          <input type="text" id="wizardNameInput" placeholder="例如：某页面更新追踪" value="${this.escapeHtml(wiz.data.name || '')}" />
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:18px;">
          <button class="task-action-btn" onclick="AIWorkflow.wizardPrev()">← 上一步</button>
          <div style="display:flex;gap:8px;">
            <button class="task-action-btn" onclick="AIWorkflow.saveAsTemplate()">💾 另存为模板</button>
            <button class="task-action-btn" style="background:var(--success);color:#fff;border-color:var(--success);" onclick="AIWorkflow.saveTask()">💾 保存任务</button>
          </div>
        </div>
      `;
      document.getElementById('wizardNameInput').addEventListener('input', (e) => { wiz.data.name = e.target.value; });
    }
  },

  renderTemplateStep(wiz, body) {
    if (wiz.step === 1) {
      // Step 1: 样本网页（1-2个，用于配置模板字段）
      body.innerHTML = `
        <button class="task-action-btn" onclick="AIWorkflow.openTemplatePicker()" style="margin-bottom:12px;">📂 导入抓取方案模板</button>
        <div class="aiworkflow-form-group">
          <label>样本网页 URL（1-2个，用于配置模板字段）</label>
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px;">每行一个 URL。选取1-2个有代表性的网页，从中配置字段提取规则作为模板。</div>
          <div style="display:flex;gap:8px;">
            <textarea id="wizardSampleUrlsInput" placeholder="https://example.com/page1&#10;https://example.com/page2" style="flex:1;min-height:80px;resize:vertical;font-family:monospace;">${this.escapeHtml(wiz.data.sampleUrls || '')}</textarea>
            <button class="task-action-btn" onclick="AIWorkflow.pickUrlFromCards(false)" style="white-space:nowrap;">🗂 从卡片获取</button>
            <button class="task-action-btn" onclick="AIWorkflow.clearUrlField('wizardSampleUrlsInput','sampleUrls')" style="white-space:nowrap;">🗑 清空</button>
          </div>
        </div>
        <div class="aiworkflow-form-group">
          <label>链式数据源（可选：运行时从上游任务结果导入 URL 作为样本）</label>
          <div id="sourceTaskSelectorArea"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:18px;">
          <button class="task-action-btn" onclick="AIWorkflow.closeWizard()">取消</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" onclick="AIWorkflow.wizardNext()">下一步 →</button>
        </div>
      `;
      const sampleInput = document.getElementById('wizardSampleUrlsInput');
      if (sampleInput) sampleInput.addEventListener('input', (e) => { wiz.data.sampleUrls = e.target.value; });
      this.initSourceTaskSelector(wiz);
    } else if (wiz.step === 2) {
      // Step 2: 直接进入网页可视化选取元素（无需配置字段名/选择器）
      // D1：字段行改为可编辑（renderFieldMappingRow），支持 name/selector/attr/extractType 内联编辑
      const fields = Array.isArray(wiz.data.fields) ? wiz.data.fields : [];
      const sampleUrls = (wiz.data.sampleUrls || '').split('\n').map(s => s.trim()).filter(Boolean);
      const firstSampleUrl = sampleUrls[0] || '';
      const fieldsListHtml = fields.length ? fields.map((f, i) => {
        return this.renderFieldMappingRow(
          f.name || f._preview || '',
          f.selector || '',
          f.attr || 'text',
          f.extractType || 'text',
          i
        );
      }).join('') : '<div style="color:var(--text2);font-size:12px;padding:10px;text-align:center;border:1px dashed var(--border);border-radius:4px;">暂无已选元素，点击上方按钮进入网页选取或下方「➕ 添加字段」手动添加</div>';

      body.innerHTML = `
        <div class="aiworkflow-form-group">
          <label>在样本网页上选取元素（自动生成抓取字段）</label>
          <div style="font-size:11px;color:var(--text2);margin-bottom:8px;">点击按钮进入网页，<b>左键</b>选取元素（可累积多个），<b>右键</b>弹出工具菜单（含复数选取/自动匹配同类/清空/完成）。</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
            <button class="task-action-btn" onclick="AIWorkflow.pickFieldFromPage()" style="background:var(--primary);color:#fff;border-color:var(--primary);${firstSampleUrl ? '' : 'opacity:0.5;pointer-events:none;'}">🎯 进入网页选取元素</button>
            <button class="task-action-btn" onclick="AIWorkflow.testTemplateFields()" style="background:var(--info);color:#fff;border-color:var(--info);${fields.length ? '' : 'opacity:0.5;pointer-events:none;'}">🧪 测试模板</button>
            ${fields.length ? '<button class="task-action-btn danger" onclick="AIWorkflow.clearPickedFields()">🗑 清空已选</button>' : ''}
          </div>
          ${firstSampleUrl ? '' : '<div style="font-size:11px;color:var(--warning);margin-bottom:6px;">⚠ 请先在 Step 1 输入样本网页 URL</div>'}
          <div style="font-size:12px;color:var(--text2);margin-bottom:4px;">已选元素（${fields.length} 个）：</div>
          <div id="pickedFieldsList">${fieldsListHtml}</div>
          <div style="margin-top:6px;">
            <button class="task-action-btn" onclick="AIWorkflow.addTemplateField()" style="width:100%;border:1px dashed var(--border);background:transparent;">➕ 添加字段</button>
          </div>
        </div>
        <div id="templateTestResult" style="margin-top:10px;"></div>
        <div style="display:flex;justify-content:space-between;margin-top:18px;">
          <button class="task-action-btn" onclick="AIWorkflow.wizardPrev()">← 上一步</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" onclick="AIWorkflow.wizardNext()">下一步 →</button>
        </div>
      `;
      // D1：为 Step 2 可编辑行绑定 oninput/onchange，同步到 wiz.data.fields[i]
      const pickedList = document.getElementById('pickedFieldsList');
      if (pickedList) {
        pickedList.querySelectorAll('.field-mapping-row').forEach((row, i) => {
          const nameInput = row.querySelector('.fm-name');
          const selectorInput = row.querySelector('.fm-selector');
          const attrSelect = row.querySelector('.fm-attr');
          const extractTypeSelect = row.querySelector('.fm-extract-type');
          if (nameInput) nameInput.addEventListener('input', (e) => {
            if (Array.isArray(wiz.data.fields) && wiz.data.fields[i]) wiz.data.fields[i].name = e.target.value;
          });
          if (selectorInput) selectorInput.addEventListener('input', (e) => {
            if (Array.isArray(wiz.data.fields) && wiz.data.fields[i]) wiz.data.fields[i].selector = e.target.value;
          });
          if (attrSelect) attrSelect.addEventListener('change', (e) => {
            if (Array.isArray(wiz.data.fields) && wiz.data.fields[i]) wiz.data.fields[i].attr = e.target.value;
          });
          if (extractTypeSelect) extractTypeSelect.addEventListener('change', (e) => {
            if (Array.isArray(wiz.data.fields) && wiz.data.fields[i]) wiz.data.fields[i].extractType = e.target.value;
          });
        });
      }
    } else if (wiz.step === 3) {
      // Step 3: 目标网页（多选，按模板批量抓取）
      body.innerHTML = `
        <div class="aiworkflow-form-group">
          <label>目标网页 URL（多选，按模板批量抓取）</label>
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px;">每行一个 URL。将对每个网页应用上一步配置的模板字段提取内容。</div>
          <div style="display:flex;gap:8px;">
            <textarea id="wizardUrlsInput" placeholder="https://example.com/page1&#10;https://example.com/page2&#10;https://example.com/page3" style="flex:1;min-height:100px;resize:vertical;font-family:monospace;">${this.escapeHtml(wiz.data.urls || '')}</textarea>
            <button class="task-action-btn" onclick="AIWorkflow.pickUrlFromCards(true)" style="white-space:nowrap;">🗂 从卡片获取</button>
            <button class="task-action-btn" onclick="AIWorkflow.clearUrlField('wizardUrlsInput','urls')" style="white-space:nowrap;">🗑 清空</button>
          </div>
        </div>
        <div class="aiworkflow-form-group">
          <label>链式数据源（可选：运行时从上游任务结果导入 URL 作为目标）</label>
          <div id="targetSourceTaskSelectorArea"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:18px;">
          <button class="task-action-btn" onclick="AIWorkflow.wizardPrev()">← 上一步</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" onclick="AIWorkflow.wizardNext()">下一步 →</button>
        </div>
      `;
      const urlsInput = document.getElementById('wizardUrlsInput');
      if (urlsInput) urlsInput.addEventListener('input', (e) => { wiz.data.urls = e.target.value; });
      this.initSourceTaskSelector(wiz, 'targetSourceTaskId', 'targetSourceTaskSelectorArea');
    } else if (wiz.step === 4) {
      // Step 4: 保存（内容存放 + 配置导出地址，必选；自动导出可选）
      // 计算当前生效路径：任务级临时路径 > 全局默认路径
      const effectivePath = wiz.data.exportPath || wiz.data._defaultExportDir || '';
      body.innerHTML = `
        <div class="aiworkflow-form-group">
          <label>任务名称 <span style="color:var(--danger,#e74c3c);">*</span></label>
          <input type="text" id="wizardNameInput" placeholder="例如：B站视频信息模板" value="${this.escapeHtml(wiz.data.name || '')}" />
        </div>

        <div class="aiworkflow-form-group">
          <label>💾 内容存放 / 配置导出地址 <span style="color:var(--danger,#e74c3c);">*</span></label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input type="text" id="wizardExportPath" placeholder="必选：点击右侧选择目录…" value="${this.escapeHtml(effectivePath)}" style="flex:1;min-width:200px;cursor:default;background:${wiz.data.exportPath ? 'var(--bg,#fff)' : 'rgba(255,193,7,0.08)'};" readonly />
            <button class="task-action-btn" onclick="AIWorkflow.pickExportFolder()">📁 选择目录</button>
            ${wiz.data.exportPath ? `<button class="task-action-btn" onclick="AIWorkflow.resetExportFolder()">↩ 使用默认</button>` : ''}
            ${effectivePath ? `<button class="task-action-btn" onclick="AIWorkflow.openExportFolder()">📂 打开</button>` : ''}
          </div>
          <div style="font-size:11px;color:var(--text2);margin-top:6px;line-height:1.7;">
            💡 此目录用于保存<b>抓取内容</b>（<b>必选</b>，仅当勾选下方「自动导出」时按「页面标题\资源类型」分类保存）。
            <br>💡 <b>任务配置文件</b>（以任务名称命名，如「${this.escapeHtml(wiz.data.name || '任务名')}.json」）会优先保存到<b>模板/配置导出目录</b>，未设置时回退到此目录。可在「抓取信息卡片」顶部 📁 按钮统一设置。
            <br>💡 未选择目录时自动使用<b>全局默认导出目录</b>${wiz.data._defaultExportDir ? '（当前默认：<b>' + this.escapeHtml(wiz.data._defaultExportDir) + '</b>）' : '（未设置，可在「抓取信息卡片」顶部 📁 按钮设置）'}
            <br>💡 点击「📁 选择目录」可设置<b>仅本任务</b>使用的临时路径，覆盖默认目录；点击「↩ 使用默认」回退到全局默认。
          </div>
        </div>

        <div class="aiworkflow-form-group">
          <label>自动导出抓取内容（可选）</label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;">
              <input type="checkbox" id="wizardAutoExport" ${wiz.data.autoExport ? 'checked' : ''} style="width:auto;" />
              <span>勾选后运行任务时自动导出抓取内容到上述目录</span>
            </label>
            <select id="wizardExportFormat" style="width:90px;">
              <option value="json" ${wiz.data.exportFormat === 'json' ? 'selected' : ''}>JSON</option>
              <option value="txt" ${wiz.data.exportFormat === 'txt' ? 'selected' : ''}>TXT</option>
              <option value="md" ${wiz.data.exportFormat === 'md' ? 'selected' : ''}>MD</option>
              <option value="csv" ${wiz.data.exportFormat === 'csv' ? 'selected' : ''}>CSV</option>
            </select>
          </div>
          <div style="font-size:11px;color:var(--text2);margin-top:6px;line-height:1.6;">
            💡 <b>不勾选自动导出</b>：抓取内容仅保存在应用内「抓取信息卡片」中，但任务配置文件仍会保存到上述地址。
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;margin-top:18px;">
          <button class="task-action-btn" onclick="AIWorkflow.wizardPrev()">← 上一步</button>
          <div style="display:flex;gap:8px;">
            <button class="task-action-btn" onclick="AIWorkflow.saveAsTemplate()">💾 另存为模板</button>
            <button class="task-action-btn" style="background:var(--success);color:#fff;border-color:var(--success);" onclick="AIWorkflow.saveTask()">💾 保存任务</button>
          </div>
        </div>
      `;
      const nameInput = document.getElementById('wizardNameInput');
      if (nameInput) nameInput.addEventListener('input', (e) => { wiz.data.name = e.target.value; });
      const autoExportCb = document.getElementById('wizardAutoExport');
      if (autoExportCb) autoExportCb.addEventListener('change', (e) => { wiz.data.autoExport = e.target.checked; });
      const exportFormatSel = document.getElementById('wizardExportFormat');
      if (exportFormatSel) exportFormatSel.addEventListener('change', (e) => { wiz.data.exportFormat = e.target.value; });
      const exportPathInput = document.getElementById('wizardExportPath');
      if (exportPathInput) exportPathInput.addEventListener('input', (e) => { wiz.data.exportPath = e.target.value; });
    }
  },

  wizardNext() {
    const wiz = this.state.currentWizard;
    if (!wiz) return;
    if (wiz.type === 'crosspage') {
      if (wiz.step === 1) {
        const urls = (wiz.data.urls || '').split('\n').map(s => s.trim()).filter(Boolean);
        if (!urls.length) {
          this.showToast('请输入至少一个 URL');
          return;
        }
        const invalid = urls.find(u => !/^https?:\/\//i.test(u));
        if (invalid) {
          this.showToast('存在无效 URL：' + invalid);
          return;
        }
        wiz.data.urls = urls.join('\n');
      }
      if (wiz.step === 3) {
        this.syncFieldMappings();
        if (!Array.isArray(wiz.data.fieldMappings) || !wiz.data.fieldMappings.length) {
          this.showToast('请至少添加一个字段映射');
          return;
        }
      }
    } else if (wiz.type === 'tracking') {
      if (wiz.step === 1) {
        if (!wiz.data.url || !/^https?:\/\//i.test(wiz.data.url.trim())) {
          this.showToast('请输入有效的 http(s) URL');
          return;
        }
        wiz.data.url = wiz.data.url.trim();
      }
      if (wiz.step === 2) {
        if (!wiz.data.selector || !wiz.data.selector.trim()) {
          this.showToast('请输入或拾取 CSS 选择器');
          return;
        }
        wiz.data.selector = wiz.data.selector.trim();
      }
    } else if (wiz.type === 'template') {
      if (wiz.step === 1) {
        // 样本网页：至少一个有效 URL
        let sampleUrls = (wiz.data.sampleUrls || '').split('\n').map(s => s.trim()).filter(Boolean);
        if (!sampleUrls.length) {
          this.showToast('请输入至少一个样本网页 URL');
          return;
        }
        // 自动补全协议（支持 www.baidu.com 或 baidu.com 形式）
        sampleUrls = sampleUrls.map(u => {
          if (/^https?:\/\//i.test(u)) return u;
          if (/^\/\//.test(u)) return 'http:' + u;
          if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(u)) return 'http://' + u;
          return u;
        });
        const invalid = sampleUrls.find(u => !/^https?:\/\//i.test(u));
        if (invalid) {
          this.showToast('存在无效样本 URL：' + invalid);
          return;
        }
        wiz.data.sampleUrls = sampleUrls.join('\n');
      }
      if (wiz.step === 2) {
        this.syncFieldMappings();
        if (!Array.isArray(wiz.data.fields) || !wiz.data.fields.length) {
          this.showToast('请至少添加一个字段');
          return;
        }
      }
      if (wiz.step === 3) {
        // 目标网页：至少一个有效 URL（运行时也可从链式数据源导入）
        let targetUrls = (wiz.data.urls || '').split('\n').map(s => s.trim()).filter(Boolean);
        if (!targetUrls.length && !wiz.data.targetSourceTaskId) {
          this.showToast('请输入至少一个目标网页 URL，或选择链式数据源');
          return;
        }
        // 自动补全协议
        targetUrls = targetUrls.map(u => {
          if (/^https?:\/\//i.test(u)) return u;
          if (/^\/\//.test(u)) return 'http:' + u;
          if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(u)) return 'http://' + u;
          return u;
        });
        const invalid = targetUrls.find(u => !/^https?:\/\//i.test(u));
        if (invalid) {
          this.showToast('存在无效目标 URL：' + invalid);
          return;
        }
        wiz.data.urls = targetUrls.join('\n');
      }
    } else {
      // batch
      if (wiz.step === 1) {
        if (!wiz.data.url || !/^https?:\/\//i.test(wiz.data.url.trim())) {
          this.showToast('请输入有效的 http(s) URL');
          return;
        }
        wiz.data.url = wiz.data.url.trim();
      }
      if (wiz.step === 2) {
        if (!wiz.data.selector || !wiz.data.selector.trim()) {
          this.showToast('请输入或拾取 CSS 选择器');
          return;
        }
        wiz.data.selector = wiz.data.selector.trim();
      }
    }
    if (wiz.step < wiz.totalSteps) {
      wiz.step++;
      this.renderWizardStep();
      this.renderWizard(); // 更新步骤指示器
    }
  },

  wizardPrev() {
    const wiz = this.state.currentWizard;
    if (!wiz) return;
    if (wiz.step > 1) {
      wiz.step--;
      this.renderWizardStep();
      this.renderWizard();
    }
  },

  closeWizard() {
    const modal = document.getElementById('aiworkflowWizardModal');
    if (modal) modal.remove();
    this.state.currentWizard = null;
  },

  // ===== 渲染匹配元素预览 =====
  renderMatchPreview(previews) {
    if (!Array.isArray(previews) || !previews.length) return '';
    const rows = previews.map(p => {
      const text = this.escapeHtml(p.text || '(无文本)');
      const href = p.href ? this.escapeHtml(p.href) : '';
      const tag = this.escapeHtml(p.tag || '');
      const cls = p.class ? this.escapeHtml(String(p.class).slice(0, 60)) : '';
      return `<div style="padding:6px 8px;border-bottom:1px solid var(--border);font-size:11px;">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:2px;">
          <span style="background:var(--primary);color:#fff;padding:1px 5px;border-radius:3px;font-size:10px;">${p.index + 1}</span>
          <span style="color:var(--text2);">&lt;${tag}&gt;</span>
          ${cls ? `<span style="color:var(--text2);font-size:10px;">.${cls}</span>` : ''}
          ${href ? `<span style="color:var(--primary);font-size:10px;word-break:break-all;">href: ${href}</span>` : ''}
        </div>
        <div style="color:var(--text);word-break:break-all;max-height:40px;overflow:hidden;">${text}</div>
      </div>`;
    }).join('');
    return `<div style="margin-top:8px;border:1px solid var(--border);border-radius:var(--radius);max-height:260px;overflow-y:auto;background:var(--bg2);">
      <div style="padding:6px 10px;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg2);z-index:1;">
        📋 匹配元素预览（前 ${previews.length} 个）
      </div>
      ${rows}
    </div>`;
  },

  // 根据分类规则对匹配预览数据分组，辅助用户在 step 3 选择分类规则
  renderClassifyPreview(previews, classifyBy) {
    if (!Array.isArray(previews) || !previews.length) return '';
    const groups = {};
    for (const p of previews) {
      let key = 'default';
      if (classifyBy === 'class') {
        key = (p.class && typeof p.class === 'string' && p.class.trim())
          ? p.class.trim().split(/\s+/)[0]
          : 'no-class';
      } else if (classifyBy === 'data-attr') {
        // 预览数据无 data 属性信息，仅提示
        key = '(预览不含 data 属性)';
      } else if (classifyBy === 'dom-position') {
        key = p.tag || 'unknown-tag';
      } else {
        key = '不分类';
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    const keys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
    const groupRows = keys.map(k => {
      const count = groups[k].length;
      const sample = groups[k].slice(0, 2).map(p => {
        const t = this.escapeHtml((p.text || '').slice(0, 40));
        return `<div style="font-size:10px;color:var(--text2);padding:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">· ${t}</div>`;
      }).join('');
      return `<div style="padding:5px 8px;border-bottom:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;font-weight:600;color:var(--primary);">${this.escapeHtml(k)}</span>
          <span style="font-size:10px;color:var(--text2);background:var(--bg);padding:1px 6px;border-radius:8px;">${count} 个</span>
        </div>
        ${sample}
      </div>`;
    }).join('');
    return `<div style="margin-top:8px;border:1px solid var(--border);border-radius:var(--radius);max-height:200px;overflow-y:auto;background:var(--bg2);">
      <div style="padding:6px 10px;font-size:11px;color:var(--text2);border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg2);">
        🏷 分类预览（${keys.length} 组 · 基于 ${previews.length} 个样例）
      </div>
      ${groupRows}
    </div>`;
  },

  // 初始化链式数据源选择器（crosspage / template step 1 / template step 3）
  // fieldName: 存储到 wiz.data 的字段名（默认 sourceTaskId）
  // areaId: 容器元素 ID（默认 sourceTaskSelectorArea）
  async initSourceTaskSelector(wiz, fieldName, areaId) {
    fieldName = fieldName || 'sourceTaskId';
    areaId = areaId || 'sourceTaskSelectorArea';
    const area = document.getElementById(areaId);
    if (!area) return;
    area.innerHTML = '<div style="font-size:11px;color:var(--text2);">加载中...</div>';
    let tasks = [];
    try {
      const excludeId = wiz.editingTaskId || '';
      const result = await window.electronAPI?.aiworkflowAPI?.listSourceTasks?.(excludeId);
      if (result?.success) tasks = result.data || [];
    } catch (e) { /* ignore */ }
    const currentSourceId = wiz.data[fieldName] || '';
    const currentSourceField = wiz.data.sourceField || 'href';
    const fieldOptions = [
      { value: 'href', label: 'href（链接地址）' },
      { value: 'url', label: 'url（来源URL）' },
      { value: 'content', label: 'content（文本内容）' },
    ];
    const fieldOptsHtml = fieldOptions.map(f =>
      `<option value="${f.value}" ${f.value === currentSourceField ? 'selected' : ''}>${f.label}</option>`
    ).join('');
    const taskOptsHtml = tasks.length
      ? '<option value="">（不使用链式数据源）</option>' +
        tasks.map(t => {
          const label = `[${t.type || '?'}] ${this.escapeHtml(t.name)} (${t.resultCount}批/${t.latestItemCount}条)`;
          return `<option value="${this.escapeHtml(String(t.id))}" ${String(t.id) === String(currentSourceId) ? 'selected' : ''}>${label}</option>`;
        }).join('')
      : '<option value="">（暂无其他任务）</option>';
    area.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <select id="${areaId}_taskSelect" style="flex:1;min-width:200px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);color:var(--text);font-size:12px;">
          ${taskOptsHtml}
        </select>
        <select id="${areaId}_fieldSelect" style="width:140px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);color:var(--text);font-size:12px;" ${!currentSourceId ? 'disabled' : ''}>
          ${fieldOptsHtml}
        </select>
      </div>
      <div style="font-size:11px;color:var(--text2);margin-top:4px;">选择上游任务后，运行时自动从其最新结果提取 URL 作为本任务输入</div>
    `;
    const taskSel = document.getElementById(areaId + '_taskSelect');
    const fieldSel = document.getElementById(areaId + '_fieldSelect');
    if (taskSel) {
      taskSel.addEventListener('change', (e) => {
        wiz.data[fieldName] = e.target.value;
        if (fieldSel) fieldSel.disabled = !e.target.value;
      });
    }
    if (fieldSel) {
      fieldSel.addEventListener('change', (e) => { wiz.data.sourceField = e.target.value; });
    }
  },

  // ===== Task 4: 测试选择器匹配 =====
  async testSelector() {
    const wiz = this.state.currentWizard;
    if (!wiz) return;
    const url = wiz.data.url.trim();
    const selector = wiz.data.selector.trim();
    const resultEl = document.getElementById('wizardTestResult');
    const testBtn = document.getElementById('wizardTestBtn');
    const scrollCb = document.getElementById('wizardTestScroll');
    const doScroll = scrollCb ? scrollCb.checked : false;
    if (!url || !selector) {
      if (resultEl) resultEl.textContent = '⚠ 请先填写 URL 和选择器';
      return;
    }
    // 如果正在测试中，点击 = 停止
    if (this._testSelectorRunning) {
      window.electronAPI?.aiworkflowAPI?.abortTestSelector?.();
      return;
    }
    this._testSelectorRunning = true;
    if (testBtn) { testBtn.textContent = '⏹ 停止'; testBtn.style.background = 'var(--danger)'; }
    if (resultEl) {
      resultEl.textContent = doScroll ? '⏳ 正在加载页面并滚动...' : '⏳ 正在加载页面并测试...';
      resultEl.style.color = 'var(--primary)';
    }
    // 注册实时进度监听
    const progressHandler = (data) => {
      if (resultEl) {
        // Discourse API 模式：scrollCount=0，显示"API 分页"
        // 滚动模式：scrollCount>0，显示"滚动 N 次"
        const modeLabel = (data.scrollCount === 0) ? 'API 分页' : `滚动 ${data.scrollCount} 次`;
        resultEl.innerHTML = `⏳ ${modeLabel} | 当前匹配 <b style="color:var(--success);">${data.count}</b> 个元素`;
        resultEl.style.color = 'var(--text2)';
      }
    };
    window.electronAPI?.aiworkflowAPI?.onTestSelectorProgress?.(progressHandler);
    try {
      const result = await window.electronAPI?.aiworkflowAPI?.testSelector?.(url, selector, doScroll);
      if (result?.success) {
        // 存储预览数据到向导（问题2：保存到testMatchedPreview，与pagePickedPreview区分）
        wiz.data.testMatchedPreview = result.previews || [];
        wiz.data.testMatchedCount = result.count;
        // 根据当前数据源选择更新matchedPreview
        const dataSource = wiz.data.dataSource || 'test';
        if (dataSource === 'test') {
          wiz.data.matchedPreview = wiz.data.testMatchedPreview;
          wiz.data.matchedCount = wiz.data.testMatchedCount;
        }
        if (resultEl) {
          const scrollInfo = result.scrolled ? '（已滚动到底）' : '';
          resultEl.innerHTML = `✓ 匹配 <b style="color:var(--success);">${result.count}</b> 个元素${scrollInfo}`;
          resultEl.style.color = 'var(--text2)';
        }
        // 渲染预览
        const previewArea = document.getElementById('wizardPreviewArea');
        if (previewArea) {
          previewArea.innerHTML = this.renderMatchPreview(result.previews || []);
        }
      } else {
        if (resultEl) {
          resultEl.textContent = '✗ ' + (result?.error || '测试失败');
          resultEl.style.color = 'var(--danger)';
        }
      }
    } catch (e) {
      if (resultEl) {
        resultEl.textContent = '✗ 测试异常：' + (e.message || e);
        resultEl.style.color = 'var(--danger)';
      }
    } finally {
      this._testSelectorRunning = false;
      if (testBtn) { testBtn.textContent = '🧪 测试匹配'; testBtn.style.background = ''; }
    }
  },

  // ===== 选择导出目标文件夹 =====
  async pickExportFolder() {
    try {
      const result = await window.electronAPI?.selectDirectory?.();
      if (result?.success && result.data) {
        const wiz = this.state.currentWizard;
        if (wiz) {
          wiz.data.exportPath = result.data;
          const input = document.getElementById('wizardExportPath');
          if (input) input.value = result.data;
          // 重新渲染当前步骤，以显示「📂 打开」按钮
          this.renderWizardStep();
        }
      }
    } catch (e) {
      console.error('pickExportFolder failed:', e);
      this.showToast('选择目录失败：' + (e.message || e));
    }
  },

  // ===== 在文件管理器中打开已选的导出目录 =====
  async openExportFolder() {
    const wiz = this.state.currentWizard;
    // 优先任务级路径，其次全局默认路径
    const dir = (wiz && wiz.data && wiz.data.exportPath) || (wiz && wiz.data && wiz.data._defaultExportDir) || '';
    if (!dir) {
      this.showToast('请先选择存放目录');
      return;
    }
    try {
      const result = await window.electronAPI?.openInExplorer?.(dir);
      if (result?.success) {
        this.showToast('✓ 已打开目录：' + dir);
      } else {
        this.showToast('打开失败：' + (result?.error || '目录不存在'));
      }
    } catch (e) {
      this.showToast('打开异常：' + (e.message || e));
    }
  },

  // ===== 回退到全局默认导出目录（清空任务级临时路径） =====
  async resetExportFolder() {
    const wiz = this.state.currentWizard;
    if (!wiz || !wiz.data) return;
    // 清空任务级临时路径，回退到全局默认
    wiz.data.exportPath = '';
    // 重新拉取默认目录（可能已被用户在另一个窗口修改）
    try {
      const cur = await window.electronAPI?.getDefaultExportDir?.();
      wiz.data._defaultExportDir = cur?.data || '';
    } catch {}
    this.renderWizardStep();
    this.showToast(wiz.data._defaultExportDir ? '已回退到默认目录：' + wiz.data._defaultExportDir : '已清空临时路径（默认目录未设置，请选择目录）');
  },

  // ===== 测试模板字段（用样本网页验证字段提取效果） =====
  async testTemplateFields() {
    const wiz = this.state.currentWizard;
    if (!wiz || wiz.type !== 'template') return;
    this.syncFieldMappings();
    const fields = Array.isArray(wiz.data.fields) ? wiz.data.fields : [];
    if (!fields.length) {
      this.showToast('请先添加至少一个字段');
      return;
    }
    const sampleUrls = (wiz.data.sampleUrls || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!sampleUrls.length) {
      this.showToast('请先在 step 1 输入样本网页 URL');
      return;
    }
    const resultEl = document.getElementById('templateTestResult');
    if (resultEl) {
      resultEl.innerHTML = '<div style="padding:8px;color:var(--text2);font-size:12px;">⏳ 正在用样本网页测试字段提取...</div>';
    }
    try {
      // 用第一个样本 URL 测试
      const result = await window.electronAPI?.aiworkflowAPI?.testTemplateFields?.(sampleUrls[0], fields);
      if (result?.success) {
        const fieldResults = result.fields || {};
        const missing = result.missing || [];
        let html = '<div style="border:1px solid var(--border);border-radius:var(--radius);padding:8px;background:var(--bg2);font-size:12px;">';
        html += '<div style="font-weight:600;margin-bottom:6px;color:var(--success);">✓ 测试成功（样本：' + this.escapeHtml(sampleUrls[0].slice(0, 50)) + '）</div>';
        if (result.pageTitle) {
          html += '<div style="color:var(--text2);margin-bottom:4px;">页面标题：' + this.escapeHtml(result.pageTitle) + '</div>';
        }
        Object.keys(fieldResults).forEach(name => {
          const v = fieldResults[name];
          const cnt = (v && v.count != null) ? v.count : 0;
          const extType = (v && v.extractType) ? v.extractType : 'text';
          const vals = (v && Array.isArray(v.values)) ? v.values : [];
          html += '<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);">';
          html += '<div style="font-weight:600;color:var(--primary);">' + this.escapeHtml(name) + ' <span style="color:var(--text2);font-weight:normal;">(' + extType + ' · ' + cnt + '个)</span></div>';
          // 显示前3个值
          const previewVals = vals.slice(0, 3);
          previewVals.forEach(val => {
            const display = String(val).length > 80 ? String(val).slice(0, 80) + '…' : String(val);
            html += '<div style="color:var(--text);margin-left:12px;word-break:break-all;">• ' + this.escapeHtml(display) + '</div>';
          });
          if (vals.length > 3) {
            html += '<div style="color:var(--text2);margin-left:12px;">...还有 ' + (vals.length - 3) + ' 个</div>';
          }
          html += '</div>';
        });
        if (missing.length) {
          html += '<div style="margin-top:6px;color:var(--warning);">⚠ 缺失字段：' + this.escapeHtml(missing.join(', ')) + '</div>';
        }
        html += '</div>';
        if (resultEl) resultEl.innerHTML = html;
      } else {
        if (resultEl) resultEl.innerHTML = '<div style="padding:8px;color:var(--danger);font-size:12px;">✗ 测试失败：' + this.escapeHtml(result?.error || '未知错误') + '</div>';
      }
    } catch (e) {
      if (resultEl) resultEl.innerHTML = '<div style="padding:8px;color:var(--danger);font-size:12px;">✗ 测试异常：' + this.escapeHtml(e.message || String(e)) + '</div>';
    }
  },

  // ===== Task 4: 保存任务 =====
  async saveTask() {
    const wiz = this.state.currentWizard;
    if (!wiz) return;
    const d = wiz.data;
    if (!d.name || !d.name.trim()) {
      this.showToast('请填写任务名称');
      return;
    }
    // 校验：内容存放 / 配置导出地址必选（任务级临时路径 > 全局默认路径）
    const effectivePath = (d.exportPath || '').trim() || (d._defaultExportDir || '').trim() || '';
    if (!effectivePath) {
      this.showToast('请选择「内容存放 / 配置导出地址」（或在「抓取信息卡片」顶部设置默认目录）');
      return;
    }
    const isEditing = !!wiz.editingTaskId;
    let task;
    let updates; // 编辑模式时只提交 { name, config }
    if (wiz.type === 'crosspage') {
      this.syncFieldMappings();
      const urls = (d.urls || '').split('\n').map(s => s.trim()).filter(Boolean);
      const config = {
        urls: urls,
        selector: (d.selector || '').trim(),
        fieldMappings: Array.isArray(d.fieldMappings) ? d.fieldMappings : [],
        overrides: Array.isArray(d.overrides) ? d.overrides : [],
        sourceTaskId: d.sourceTaskId || '',
        sourceField: d.sourceField || 'href',
      };
      if (isEditing) {
        updates = { name: d.name.trim(), config };
      } else {
        task = {
          type: 'crosspage',
          name: d.name.trim(),
          config,
          results: [],
          createdAt: new Date().toISOString(),
          lastRunAt: null,
          status: 'idle',
        };
      }
    } else if (wiz.type === 'tracking') {
      const config = {
        url: d.url,
        selector: d.selector,
        idField: d.idField || 'href',
        intervalMinutes: Number(d.intervalMinutes) || 30,
      };
      if (isEditing) {
        updates = { name: d.name.trim(), config };
      } else {
        task = {
          type: 'tracking',
          name: d.name.trim(),
          config,
          knownIds: [],
          results: [],
          createdAt: new Date().toISOString(),
          lastRunAt: null,
          nextCheckAt: null,
          status: 'tracking',
          active: true,
        };
      }
    } else if (wiz.type === 'template') {
      // 末端抓取：多 URL 样本 + 模板字段 + 多 URL 目标批量抓取
      this.syncFieldMappings();
      const fields = Array.isArray(d.fields) ? d.fields : [];
      const sampleUrlsArr = (d.sampleUrls || '').split('\n').map(s => s.trim()).filter(Boolean);
      const targetUrlsArr = (d.urls || '').split('\n').map(s => s.trim()).filter(Boolean);
      const config = {
        sampleUrls: sampleUrlsArr,
        fields: fields,
        urls: targetUrlsArr,
        sourceTaskId: d.sourceTaskId || '',        // 样本链式数据源
        targetSourceTaskId: d.targetSourceTaskId || '', // 目标链式数据源
        sourceField: d.sourceField || 'url',
        autoExport: d.autoExport || false,
        exportFormat: d.exportFormat || 'json',
        exportPath: d.exportPath || '',
      };
      if (isEditing) {
        updates = { name: d.name.trim(), config };
      } else {
        task = {
          type: 'template',
          name: d.name.trim(),
          url: sampleUrlsArr[0] || '',
          config,
          results: [],
          createdAt: new Date().toISOString(),
          lastRunAt: null,
          status: 'idle',
        };
      }
    } else {
      // batch
      const config = {
        url: d.url,
        selector: d.selector,
        classifyBy: d.classifyBy,
        preserveRelations: d.preserveRelations,
        autoExport: d.autoExport || false,
        exportFormat: d.exportFormat || 'json',
        exportPath: d.exportPath || '',
        matchMode: d.matchMode || 'all',
        matchLimit: d.matchLimit ? Number(d.matchLimit) : null,
        dataSource: d.dataSource || 'page',
      };
      if (isEditing) {
        updates = { name: d.name.trim(), config };
      } else {
        task = {
          type: 'batch',
          name: d.name.trim(),
          url: d.url,
          config,
          results: [],
          createdAt: new Date().toISOString(),
          lastRunAt: null,
          status: 'idle',
        };
      }
    }
    try {
      let result;
      if (isEditing) {
        result = await window.electronAPI?.aiworkflowAPI?.update?.(wiz.editingTaskId, updates);
      } else {
        result = await window.electronAPI?.aiworkflowAPI?.save?.(task);
      }
      if (result?.success) {
        const newId = result.id || wiz.editingTaskId;
        const taskType = wiz.type;
        // 构造用于配置导出的 task 对象（编辑模式需合并 updates）
        const taskForExport = isEditing
          ? { id: newId, type: taskType, name: (updates && updates.name) || d.name.trim(), config: (updates && updates.config) || {} }
          : task;

        // 导出任务配置文件（以任务名称命名）
        // 优先使用模板/配置导出目录，回退到 effectivePath（内容存放目录）
        try {
          let configExportDir = effectivePath;
          try {
            const tplDirRes = await window.electronAPI?.getTemplateExportDir?.();
            if (tplDirRes?.success && tplDirRes.data) configExportDir = tplDirRes.data;
          } catch (_) { /* 回退到 effectivePath */ }
          const exportResult = await window.electronAPI?.exportTaskConfig?.(taskForExport, configExportDir);
          if (exportResult?.success) {
            this.showToast(isEditing ? '✓ 任务已更新，配置已导出' : '✓ 任务已保存，配置已导出');
            console.log('[AIWorkflow] 配置文件已导出:', exportResult.path);
          } else {
            this.showToast(isEditing ? '✓ 任务已更新（配置导出失败：' + (exportResult?.error || '未知') + '）' : '✓ 任务已保存（配置导出失败：' + (exportResult?.error || '未知') + '）');
          }
        } catch (e) {
          this.showToast(isEditing ? '✓ 任务已更新（配置导出异常）' : '✓ 任务已保存（配置导出异常）');
          console.error('[AIWorkflow] 配置导出异常:', e);
        }

        this.closeWizard();
        await this.loadList();
        // 新建追踪任务保存后自动启动调度器（编辑模式不重复启动）
        if (!isEditing && taskType === 'tracking' && newId) {
          try {
            await window.electronAPI?.aiworkflowAPI?.startTracking?.(newId);
          } catch (e) { /* ignore */ }
        }
      } else {
        this.showToast((isEditing ? '更新失败：' : '保存失败：') + (result?.error || '未知错误'));
      }
    } catch (e) {
      this.showToast((isEditing ? '更新异常：' : '保存异常：') + (e.message || e));
    }
  },

  // ===== Task 6: 字段映射表行渲染 =====
  // 对于 template（末端抓取），增加 extractType 选择器：text/link/video/audio/download
  // 阶段 C3：新增 index 参数，启用基于状态索引的删除（removeFieldMapping），保留旧 DOM 删除以兼容
  renderFieldMappingRow(name, selector, attr, extractType, index) {
    const wiz = this.state.currentWizard;
    const isTemplate = wiz && wiz.type === 'template';
    const attrs = ['text', 'html', 'href', 'src', 'data-id', 'data-pid', 'id', 'class', 'title', 'alt'];
    const options = attrs.map(a => `<option value="${a}" ${a === attr ? 'selected' : ''}>${a}</option>`).join('');
    const extractTypes = [
      { value: 'text', label: '📝 文本' },
      { value: 'link', label: '🔗 链接' },
      { value: 'video', label: '🎬 视频' },
      { value: 'audio', label: '🎵 音频' },
      { value: 'download', label: '⬇ 下载链接' },
    ];
    const extractTypeHtml = isTemplate ? (() => {
      const opts = extractTypes.map(t =>
        `<option value="${t.value}" ${t.value === (extractType || 'text') ? 'selected' : ''}>${t.label}</option>`
      ).join('');
      return `<select class="fm-extract-type" style="width:120px;" title="提取类型">${opts}</select>`;
    })() : '';
    const hasIndex = (typeof index === 'number' && !isNaN(index));
    const deleteBtnHtml = hasIndex
      ? `<button class="task-action-btn" onclick="AIWorkflow.removeFieldMapping(${index})" style="color:var(--danger,#e74c3c);background:transparent;border:none;padding:4px 8px;" title="删除">✕</button>`
      : `<button class="task-action-btn danger" onclick="AIWorkflow.removeFieldMappingRow(this)" style="padding:4px 8px;" title="删除">✕</button>`;
    return `
      <div class="field-mapping-row" style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">
        <input type="text" class="fm-name" placeholder="字段名" value="${this.escapeHtml(name || '')}" style="flex:1;min-width:80px;" />
        <input type="text" class="fm-selector" placeholder="子选择器 .title" value="${this.escapeHtml(selector || '')}" style="flex:1.5;min-width:100px;" />
        <select class="fm-attr" style="width:100px;">${options}</select>
        ${extractTypeHtml}
        ${deleteBtnHtml}
      </div>
    `;
  },

  addFieldMappingRow() {
    const wiz = this.state.currentWizard;
    if (!wiz || (wiz.type !== 'crosspage' && wiz.type !== 'template')) return;
    const container = document.getElementById('fieldMappingList');
    if (!container) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = this.renderFieldMappingRow('', '', 'text');
    container.appendChild(wrapper.firstElementChild);
  },

  removeFieldMappingRow(btn) {
    const row = btn.closest('.field-mapping-row');
    if (row) row.remove();
  },

  // 阶段 C3：基于索引删除字段（template 用 wiz.data.fields；crosspage 用 wiz.data.fieldMappings）
  // 删除后立即重渲染当前步骤，保证 UI 与状态同步
  removeFieldMapping(index) {
    const wiz = this.state.currentWizard;
    if (!wiz || !wiz.data) return;
    if (typeof index !== 'number' || isNaN(index)) return;
    if (wiz.type === 'template') {
      const fields = Array.isArray(wiz.data.fields) ? wiz.data.fields : [];
      if (index < 0 || index >= fields.length) return;
      fields.splice(index, 1);
      wiz.data.fields = fields;
      this.renderWizardStep();
    } else if (wiz.type === 'crosspage') {
      const mappings = Array.isArray(wiz.data.fieldMappings) ? wiz.data.fieldMappings : [];
      if (index < 0 || index >= mappings.length) return;
      mappings.splice(index, 1);
      wiz.data.fieldMappings = mappings;
      this.renderWizardStep();
    }
  },

  syncFieldMappings() {
    const wiz = this.state.currentWizard;
    if (!wiz || (wiz.type !== 'crosspage' && wiz.type !== 'template')) return;
    const container = document.getElementById('fieldMappingList');
    if (!container) return;
    const rows = container.querySelectorAll('.field-mapping-row');
    const mappings = [];
    rows.forEach(row => {
      const name = (row.querySelector('.fm-name')?.value || '').trim();
      const selector = (row.querySelector('.fm-selector')?.value || '').trim();
      const attr = row.querySelector('.fm-attr')?.value || 'text';
      const extractTypeEl = row.querySelector('.fm-extract-type');
      const extractType = extractTypeEl ? extractTypeEl.value : 'text';
      if (name || selector) {
        const m = { name, selector, attr };
        if (wiz.type === 'template') m.extractType = extractType;
        mappings.push(m);
      }
    });
    // crosspage 用 fieldMappings，template 用 fields
    if (wiz.type === 'template') {
      wiz.data.fields = mappings;
    } else {
      wiz.data.fieldMappings = mappings;
    }
  },

  // 清空向导中的 URL 字段（链接输入框 + 对应 wiz.data 字段）
  clearUrlField(inputId, dataField) {
    const wiz = this.state.currentWizard;
    if (!wiz || !wiz.data) return;
    // 输入框：input 或 textarea
    const el = document.getElementById(inputId);
    if (el) el.value = '';
    // 同步清空 wiz.data 中对应字段
    if (dataField) wiz.data[dataField] = '';
    this.showToast('已清空链接');
  },

  // ===== 阶段 C2: 导入抓取方案模板 =====
  async openTemplatePicker() {
    const wiz = this.state.currentWizard;
    if (!wiz) return;
    let templateData = null;
    try {
      const result = await window.electronAPI?.listTemplates?.();
      if (!result?.success) {
        this.showToast('加载模板列表失败：' + (result?.error || '未知错误'));
        return;
      }
      templateData = result.data || {};
    } catch (e) {
      this.showToast('加载模板列表失败：' + (e.message || e));
      return;
    }

    // 已存在则移除
    const existing = document.getElementById('aiworkflowTemplatePickerModal');
    if (existing) existing.remove();

    const CATEGORY_LABELS = {
      recruitment: '招聘',
      comments: '评论',
      products: '商品',
    };
    const categories = Object.keys(CATEGORY_LABELS);
    let activeCat = categories[0];

    const dlg = document.createElement('div');
    dlg.id = 'aiworkflowTemplatePickerModal';
    dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.45);z-index:100000;display:flex;align-items:center;justify-content:center;font-family:inherit;';
    dlg.innerHTML = `
      <div style="background:var(--bg,#fff);color:var(--text,#222);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,0.25);padding:20px 22px;width:560px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="margin:0;font-size:16px;">📂 导入抓取方案模板</h3>
          <button id="tplPickerClose" style="background:transparent;border:none;font-size:18px;cursor:pointer;color:var(--text2,#888);">✕</button>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:12px;border-bottom:1px solid var(--border,#ddd);">
          ${categories.map(c => `<button class="tpl-tab-btn" data-cat="${c}" style="padding:8px 14px;background:transparent;border:none;border-bottom:2px solid transparent;cursor:pointer;font-size:13px;color:var(--text2,#888);">${CATEGORY_LABELS[c]}</button>`).join('')}
        </div>
        <div id="tplPickerBody" style="flex:1;overflow-y:auto;min-height:160px;"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:14px;">
          <button id="tplPickerCancel" style="padding:7px 16px;border:1px solid var(--border,#ddd);border-radius:6px;background:var(--bg,#fff);color:var(--text,#222);cursor:pointer;font-size:13px;">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);

    const bodyEl = dlg.querySelector('#tplPickerBody');
    const close = () => dlg.remove();

    const renderEmpty = (msg) => `<div style="color:var(--text2,#888);font-size:12px;padding:20px;text-align:center;">${msg}</div>`;

    const renderTemplateList = (list, source, category) => {
      if (!list || !list.length) return renderEmpty(source === 'user' ? '（暂无我的模板）' : '（暂无内置模板）');
      return list.map(t => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border:1px solid var(--border,#ddd);border-radius:6px;margin-bottom:6px;">
          <div style="flex:1;min-width:0;font-size:13px;word-break:break-all;">${this.escapeHtml(t.name)}</div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="task-action-btn tpl-import-btn" data-source="${source}" data-category="${category}" data-file="${this.escapeHtml(t.file)}" style="padding:4px 10px;font-size:12px;">导入</button>
            ${source === 'user' ? `<button class="task-action-btn tpl-delete-btn" data-category="${category}" data-file="${this.escapeHtml(t.file)}" style="padding:4px 8px;font-size:12px;color:var(--danger,#e74c3c);background:transparent;border:1px solid var(--danger,#e74c3c);">🗑</button>` : ''}
          </div>
        </div>
      `).join('');
    };

    const renderCatBody = () => {
      const cat = activeCat;
      const catData = templateData[cat] || { builtin: [], user: [] };
      bodyEl.innerHTML = `
        <div style="margin-bottom:14px;">
          <div style="font-size:12px;font-weight:600;color:var(--text,#222);margin-bottom:6px;">🏠 内置模板</div>
          <div>${renderTemplateList(catData.builtin, 'builtin', cat)}</div>
        </div>
        <div>
          <div style="font-size:12px;font-weight:600;color:var(--text,#222);margin-bottom:6px;">⭐ 我的模板</div>
          <div>${renderTemplateList(catData.user, 'user', cat)}</div>
        </div>
      `;
    };

    const refreshAll = async () => {
      try {
        const result = await window.electronAPI?.listTemplates?.();
        if (result?.success) templateData = result.data || {};
      } catch (e) { /* ignore */ }
      renderCatBody();
    };

    renderCatBody();

    // 标签切换
    dlg.querySelectorAll('.tpl-tab-btn').forEach(btn => {
      btn.onclick = () => {
        activeCat = btn.dataset.cat;
        // 切换激活样式
        dlg.querySelectorAll('.tpl-tab-btn').forEach(b => {
          b.style.borderBottom = '2px solid transparent';
          b.style.color = 'var(--text2,#888)';
        });
        btn.style.borderBottom = '2px solid var(--primary,#3498db)';
        btn.style.color = 'var(--primary,#3498db)';
        renderCatBody();
      };
    });
    // 默认激活第一个标签
    const firstTab = dlg.querySelector('.tpl-tab-btn');
    if (firstTab) {
      firstTab.style.borderBottom = '2px solid var(--primary,#3498db)';
      firstTab.style.color = 'var(--primary,#3498db)';
    }

    // 关闭逻辑
    dlg.querySelector('#tplPickerClose').onclick = close;
    dlg.querySelector('#tplPickerCancel').onclick = close;
    dlg.onclick = (e) => { if (e.target === dlg) close(); };

    // 导入 / 删除按钮（事件代理）
    bodyEl.addEventListener('click', async (e) => {
      const importBtn = e.target.closest('.tpl-import-btn');
      const deleteBtn = e.target.closest('.tpl-delete-btn');
      if (importBtn) {
        const { source, category, file } = importBtn.dataset;
        try {
          const res = await window.electronAPI?.importTaskTemplate?.(source, category, file);
          if (!res?.success) {
            this.showToast('导入失败：' + (res?.error || '未知错误'));
            return;
          }
          const taskConfig = res.data || {};
          const cfg = (taskConfig.task && taskConfig.task.config) || {};
          if (taskConfig.task && taskConfig.task.name) wiz.data.name = taskConfig.task.name;
          // 按当前任务类型分发字段映射
          if (wiz.type === 'template') {
            // 末端抓取：sampleUrls + fields + urls
            if (Array.isArray(cfg.sampleUrls)) wiz.data.sampleUrls = cfg.sampleUrls.join('\n');
            if (Array.isArray(cfg.fields)) wiz.data.fields = cfg.fields;
            if (Array.isArray(cfg.urls)) wiz.data.urls = cfg.urls.join('\n');
            if (cfg.exportFormat) wiz.data.exportFormat = cfg.exportFormat;
            if (typeof cfg.autoExport !== 'undefined') wiz.data.autoExport = cfg.autoExport;
          } else if (wiz.type === 'crosspage') {
            // 跨页面抓取：urls + selector + fieldMappings
            if (Array.isArray(cfg.urls)) wiz.data.urls = cfg.urls.join('\n');
            if (typeof cfg.selector === 'string') wiz.data.selector = cfg.selector;
            if (Array.isArray(cfg.fieldMappings)) wiz.data.fieldMappings = cfg.fieldMappings;
          } else if (wiz.type === 'batch') {
            // 批量抓取：url + selector + classifyBy + matchMode
            if (typeof cfg.url === 'string') wiz.data.url = cfg.url;
            if (typeof cfg.selector === 'string') wiz.data.selector = cfg.selector;
            if (typeof cfg.classifyBy === 'string') wiz.data.classifyBy = cfg.classifyBy;
            if (typeof cfg.matchMode === 'string') wiz.data.matchMode = cfg.matchMode;
            if (cfg.matchLimit) wiz.data.matchLimit = cfg.matchLimit;
            if (cfg.exportFormat) wiz.data.exportFormat = cfg.exportFormat;
            if (typeof cfg.autoExport !== 'undefined') wiz.data.autoExport = cfg.autoExport;
          } else if (wiz.type === 'tracking') {
            // 更新追踪：url + selector + intervalMinutes
            if (typeof cfg.url === 'string') wiz.data.url = cfg.url;
            if (typeof cfg.selector === 'string') wiz.data.selector = cfg.selector;
            if (typeof cfg.idField === 'string') wiz.data.idField = cfg.idField;
            if (cfg.intervalMinutes) wiz.data.intervalMinutes = cfg.intervalMinutes;
          }
          // 不覆盖 wiz.data.exportPath 和 wiz.data._defaultExportDir（保留用户已选路径）
          this.showToast('✓ 已导入模板：' + (taskConfig.task?.name || file));
          close();
          this.renderWizardStep();
        } catch (err) {
          this.showToast('导入异常：' + (err.message || err));
        }
      } else if (deleteBtn) {
        const { category, file } = deleteBtn.dataset;
        if (!confirm(`确定删除模板 [${file}]？此操作不可撤销。`)) return;
        try {
          const res = await window.electronAPI?.deleteUserTemplate?.(category, file);
          if (!res?.success) {
            this.showToast('删除失败：' + (res?.error || '未知错误'));
            return;
          }
          this.showToast('✓ 已删除模板');
          await refreshAll();
        } catch (err) {
          this.showToast('删除异常：' + (err.message || err));
        }
      }
    });
  },

  // ===== 阶段 C4: 另存为模板 =====
  saveAsTemplate() {
    const wiz = this.state.currentWizard;
    if (!wiz || !wiz.data) return;

    // 已存在则移除
    const existing = document.getElementById('aiworkflowSaveAsTemplateModal');
    if (existing) existing.remove();

    const CATEGORY_OPTIONS = [
      { value: 'recruitment', label: '招聘' },
      { value: 'comments', label: '评论' },
      { value: 'products', label: '商品' },
      { value: 'custom', label: '自定义' },
    ];
    const defaultName = (wiz.data.name || '').toString().trim() || '我的模板';
    const optsHtml = CATEGORY_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('');

    const dlg = document.createElement('div');
    dlg.id = 'aiworkflowSaveAsTemplateModal';
    dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.45);z-index:100000;display:flex;align-items:center;justify-content:center;font-family:inherit;';
    dlg.innerHTML = `
      <div style="background:var(--bg,#fff);color:var(--text,#222);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,0.25);padding:20px 22px;width:440px;max-width:92vw;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="margin:0;font-size:16px;">💾 另存为模板</h3>
          <button id="tplSaveClose" style="background:transparent;border:none;font-size:18px;cursor:pointer;color:var(--text2,#888);">✕</button>
        </div>
        <div style="font-size:12px;color:var(--text2,#888);line-height:1.6;margin-bottom:12px;">
          将当前抓取方案保存为可复用模板，可在新建任务时通过「📂 导入抓取方案模板」快速加载。
        </div>
        <div class="aiworkflow-form-group" style="margin-bottom:12px;">
          <label style="font-size:12px;display:block;margin-bottom:6px;">模板名称</label>
          <input type="text" id="tplSaveName" value="${this.escapeHtml(defaultName)}" placeholder="请输入模板名称" style="width:100%;padding:8px 10px;border:1px solid var(--border,#ddd);border-radius:6px;background:var(--bg,#fff);color:var(--text,#222);font-size:13px;box-sizing:border-box;" />
        </div>
        <div class="aiworkflow-form-group" style="margin-bottom:18px;">
          <label style="font-size:12px;display:block;margin-bottom:6px;">分类</label>
          <select id="tplSaveCategory" style="width:100%;padding:8px 10px;border:1px solid var(--border,#ddd);border-radius:6px;background:var(--bg,#fff);color:var(--text,#222);font-size:13px;box-sizing:border-box;">
            ${optsHtml}
          </select>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button id="tplSaveCancel" style="padding:7px 16px;border:1px solid var(--border,#ddd);border-radius:6px;background:var(--bg,#fff);color:var(--text,#222);cursor:pointer;font-size:13px;">取消</button>
          <button id="tplSaveConfirm" style="padding:7px 18px;border:none;border-radius:6px;background:var(--primary,#3498db);color:#fff;cursor:pointer;font-size:13px;">💾 保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);

    const close = () => dlg.remove();
    dlg.querySelector('#tplSaveClose').onclick = close;
    dlg.querySelector('#tplSaveCancel').onclick = close;
    dlg.onclick = (e) => { if (e.target === dlg) close(); };

    const confirmBtn = dlg.querySelector('#tplSaveConfirm');
    confirmBtn.onclick = async () => {
      const name = (dlg.querySelector('#tplSaveName').value || '').trim();
      const category = dlg.querySelector('#tplSaveCategory').value || 'custom';
      if (!name) {
        this.showToast('请输入模板名称');
        return;
      }
      const taskConfig = {
        __type: 'aiworkflow-task-config',
        __version: 1,
        exportedAt: new Date().toISOString(),
        task: {
          type: wiz.type,
          name: name,
          config: (() => {
            // 按任务类型构造 config
            if (wiz.type === 'template') {
              return {
                sampleUrls: (wiz.data.sampleUrls || '').split('\n').map(s => s.trim()).filter(Boolean),
                fields: wiz.data.fields || [],
                urls: (wiz.data.urls || '').split('\n').map(s => s.trim()).filter(Boolean),
                sourceTaskId: wiz.data.sourceTaskId || '',
                targetSourceTaskId: wiz.data.targetSourceTaskId || '',
                sourceField: wiz.data.sourceField || 'url',
                autoExport: wiz.data.autoExport || false,
                exportFormat: wiz.data.exportFormat || 'json',
                exportPath: wiz.data.exportPath || '',
              };
            } else if (wiz.type === 'crosspage') {
              return {
                urls: (wiz.data.urls || '').split('\n').map(s => s.trim()).filter(Boolean),
                selector: wiz.data.selector || '',
                fieldMappings: Array.isArray(wiz.data.fieldMappings) ? wiz.data.fieldMappings : [],
                sourceTaskId: wiz.data.sourceTaskId || '',
                sourceField: wiz.data.sourceField || 'href',
              };
            } else if (wiz.type === 'batch') {
              return {
                url: wiz.data.url || '',
                selector: wiz.data.selector || '',
                classifyBy: wiz.data.classifyBy || '',
                matchMode: wiz.data.matchMode || 'all',
                matchLimit: wiz.data.matchLimit ? Number(wiz.data.matchLimit) : null,
                autoExport: wiz.data.autoExport || false,
                exportFormat: wiz.data.exportFormat || 'json',
                exportPath: wiz.data.exportPath || '',
              };
            } else if (wiz.type === 'tracking') {
              return {
                url: wiz.data.url || '',
                selector: wiz.data.selector || '',
                idField: wiz.data.idField || 'href',
                intervalMinutes: Number(wiz.data.intervalMinutes) || 30,
              };
            }
            return {};
          })()
        }
      };
      try {
        confirmBtn.disabled = true;
        confirmBtn.textContent = '保存中…';
        const res = await window.electronAPI?.saveUserTemplate?.(name, category, taskConfig);
        if (!res?.success) {
          this.showToast('保存失败：' + (res?.error || '未知错误'));
          confirmBtn.disabled = false;
          confirmBtn.textContent = '💾 保存';
          return;
        }
        this.showToast('✓ 模板已保存：' + name);
        close();
      } catch (err) {
        this.showToast('保存异常：' + (err.message || err));
        confirmBtn.disabled = false;
        confirmBtn.textContent = '💾 保存';
      }
    };

    // 自动聚焦名称输入框
    const nameInput = dlg.querySelector('#tplSaveName');
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); }
        if (e.key === 'Escape') { e.preventDefault(); close(); }
      });
    }
  },

  // ===== 模板管理（独立对话框：列表/预览/导入到新任务/导出/删除） =====
  async openTemplateManager() {
    let templateData = null;
    try {
      const result = await window.electronAPI?.listTemplates?.();
      if (!result?.success) {
        this.showToast('加载模板列表失败：' + (result?.error || '未知错误'));
        return;
      }
      templateData = result.data || {};
    } catch (e) {
      this.showToast('加载模板列表失败：' + (e.message || e));
      return;
    }

    // 已存在则移除
    const existing = document.getElementById('aiworkflowTemplateManagerModal');
    if (existing) existing.remove();

    const CATEGORY_LABELS = {
      recruitment: '招聘',
      comments: '评论',
      products: '商品',
    };
    const categories = Object.keys(CATEGORY_LABELS);
    let activeCat = categories[0];

    const dlg = document.createElement('div');
    dlg.id = 'aiworkflowTemplateManagerModal';
    dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.45);z-index:100000;display:flex;align-items:center;justify-content:center;font-family:inherit;';
    dlg.innerHTML = `
      <div style="background:var(--bg,#fff);color:var(--text,#222);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,0.25);padding:20px 22px;width:680px;max-width:92vw;max-height:85vh;display:flex;flex-direction:column;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="margin:0;font-size:16px;">📚 模板管理</h3>
          <button id="tplMgrClose" style="background:transparent;border:none;font-size:18px;cursor:pointer;color:var(--text2,#888);">✕</button>
        </div>
        <div style="font-size:12px;color:var(--text2,#888);line-height:1.6;margin-bottom:12px;">
          管理所有抓取方案模板：预览字段 / 导入到新任务 / 导出到文件 / 删除（仅自定义）。
        </div>
        <div style="display:flex;gap:6px;margin-bottom:12px;border-bottom:1px solid var(--border,#ddd);">
          ${categories.map(c => `<button class="tpl-mgr-tab-btn" data-cat="${c}" style="padding:8px 14px;background:transparent;border:none;border-bottom:2px solid transparent;cursor:pointer;font-size:13px;color:var(--text2,#888);">${CATEGORY_LABELS[c]}</button>`).join('')}
        </div>
        <div id="tplMgrBody" style="flex:1;overflow-y:auto;min-height:200px;"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:14px;">
          <button id="tplMgrCancel" style="padding:7px 16px;border:1px solid var(--border,#ddd);border-radius:6px;background:var(--bg,#fff);color:var(--text,#222);cursor:pointer;font-size:13px;">关闭</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);

    const bodyEl = dlg.querySelector('#tplMgrBody');
    const close = () => dlg.remove();

    const renderEmpty = (msg) => `<div style="color:var(--text2,#888);font-size:12px;padding:20px;text-align:center;">${msg}</div>`;

    // 单条模板行：含 预览/导入到新任务/导出/删除（仅 user）四个按钮
    const renderTemplateRow = (t, source, category) => {
      const typeLabel = { template: '末端抓取', crosspage: '跨页抓取', batch: '批量抓取', tracking: '更新追踪' }[t.taskType] || t.taskType || '';
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--border,#ddd);border-radius:6px;margin-bottom:8px;background:var(--bg,#fff);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;word-break:break-all;">${this.escapeHtml(t.name)} ${typeLabel ? `<span style="font-size:11px;color:var(--text2,#888);font-weight:normal;">[${typeLabel}]</span>` : ''}</div>
            <div style="font-size:11px;color:var(--text2,#888);margin-top:2px;">来源：${source === 'user' ? '⭐ 我的' : '🏠 内置'}${t.exportedAt ? ' · ' + t.exportedAt.slice(0,10) : ''}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="task-action-btn tpl-mgr-preview-btn" data-source="${source}" data-category="${category}" data-file="${this.escapeHtml(t.file)}" style="padding:4px 10px;font-size:12px;">👁 预览</button>
            <button class="task-action-btn tpl-mgr-newtask-btn" data-source="${source}" data-category="${category}" data-file="${this.escapeHtml(t.file)}" data-task-type="${this.escapeHtml(t.taskType)}" style="padding:4px 10px;font-size:12px;">📥 导入到新任务</button>
            <button class="task-action-btn tpl-mgr-export-btn" data-source="${source}" data-category="${category}" data-file="${this.escapeHtml(t.file)}" style="padding:4px 10px;font-size:12px;">📤 导出</button>
            ${source === 'user' ? `<button class="task-action-btn tpl-mgr-delete-btn" data-category="${category}" data-file="${this.escapeHtml(t.file)}" style="padding:4px 8px;font-size:12px;color:var(--danger,#e74c3c);background:transparent;border:1px solid var(--danger,#e74c3c);">🗑 删除</button>` : ''}
          </div>
        </div>
      `;
    };

    const renderCatBody = () => {
      const cat = activeCat;
      const catData = templateData[cat] || { builtin: [], user: [] };
      // 任务类型归一化（兼容旧模板没有 taskType 字段）
      const normalize = (list) => (list || []).map(t => ({
        ...t,
        taskType: t.taskType || (t.config && t.config.task && t.config.task.type) || 'template',
        exportedAt: t.exportedAt || (t.config && t.config.exportedAt) || '',
      }));
      const builtin = normalize(catData.builtin);
      const user = normalize(catData.user);
      bodyEl.innerHTML = `
        <div style="margin-bottom:14px;">
          <div style="font-size:12px;font-weight:600;color:var(--text,#222);margin-bottom:6px;">🏠 内置模板（${builtin.length}）</div>
          <div>${builtin.length ? builtin.map(t => renderTemplateRow(t, 'builtin', cat)).join('') : renderEmpty('（暂无内置模板）')}</div>
        </div>
        <div>
          <div style="font-size:12px;font-weight:600;color:var(--text,#222);margin-bottom:6px;">⭐ 我的模板（${user.length}）</div>
          <div>${user.length ? user.map(t => renderTemplateRow(t, 'user', cat)).join('') : renderEmpty('（暂无自定义模板，可在任务向导最后一步点击「💾 另存为模板」创建）')}</div>
        </div>
      `;
    };

    const refreshAll = async () => {
      try {
        const result = await window.electronAPI?.listTemplates?.();
        if (result?.success) templateData = result.data || {};
      } catch (e) { /* ignore */ }
      renderCatBody();
    };

    renderCatBody();

    // 标签切换
    dlg.querySelectorAll('.tpl-mgr-tab-btn').forEach(btn => {
      btn.onclick = () => {
        activeCat = btn.dataset.cat;
        dlg.querySelectorAll('.tpl-mgr-tab-btn').forEach(b => {
          b.style.borderBottom = '2px solid transparent';
          b.style.color = 'var(--text2,#888)';
        });
        btn.style.borderBottom = '2px solid var(--primary,#3498db)';
        btn.style.color = 'var(--primary,#3498db)';
        renderCatBody();
      };
    });
    const firstTab = dlg.querySelector('.tpl-mgr-tab-btn');
    if (firstTab) {
      firstTab.style.borderBottom = '2px solid var(--primary,#3498db)';
      firstTab.style.color = 'var(--primary,#3498db)';
    }

    dlg.querySelector('#tplMgrClose').onclick = close;
    dlg.querySelector('#tplMgrCancel').onclick = close;
    dlg.onclick = (e) => { if (e.target === dlg) close(); };

    // 事件代理：预览/导入到新任务/导出/删除
    bodyEl.addEventListener('click', async (e) => {
      const previewBtn = e.target.closest('.tpl-mgr-preview-btn');
      const newTaskBtn = e.target.closest('.tpl-mgr-newtask-btn');
      const exportBtn = e.target.closest('.tpl-mgr-export-btn');
      const deleteBtn = e.target.closest('.tpl-mgr-delete-btn');

      if (previewBtn) {
        const { source, category, file } = previewBtn.dataset;
        try {
          const res = await window.electronAPI?.importTaskTemplate?.(source, category, file);
          if (!res?.success) { this.showToast('预览失败：' + (res?.error || '未知错误')); return; }
          this._showTemplatePreview(res.data, file);
        } catch (err) { this.showToast('预览异常：' + (err.message || err)); }
      } else if (newTaskBtn) {
        const { source, category, file, taskType } = newTaskBtn.dataset;
        // 关闭模板管理对话框，打开对应类型的新任务向导，然后自动导入模板
        close();
        const type = taskType || 'template';
        // 切换到对应 tab
        this.switchTab(type);
        // 打开新建向导
        this.openCreateWizard(type);
        // 等待向导 DOM 就绪后导入模板
        setTimeout(async () => {
          try {
            const res = await window.electronAPI?.importTaskTemplate?.(source, category, file);
            if (!res?.success) { this.showToast('导入失败：' + (res?.error || '未知错误')); return; }
            const wiz = this.state.currentWizard;
            if (!wiz) return;
            const taskConfig = res.data || {};
            const cfg = (taskConfig.task && taskConfig.task.config) || {};
            if (taskConfig.task && taskConfig.task.name) wiz.data.name = taskConfig.task.name;
            // 复用 openTemplatePicker 中的分发逻辑
            if (type === 'template') {
              if (Array.isArray(cfg.sampleUrls)) wiz.data.sampleUrls = cfg.sampleUrls.join('\n');
              if (Array.isArray(cfg.fields)) wiz.data.fields = cfg.fields;
              if (Array.isArray(cfg.urls)) wiz.data.urls = cfg.urls.join('\n');
              if (cfg.exportFormat) wiz.data.exportFormat = cfg.exportFormat;
              if (typeof cfg.autoExport !== 'undefined') wiz.data.autoExport = cfg.autoExport;
            } else if (type === 'crosspage') {
              if (Array.isArray(cfg.urls)) wiz.data.urls = cfg.urls.join('\n');
              if (typeof cfg.selector === 'string') wiz.data.selector = cfg.selector;
              if (Array.isArray(cfg.fieldMappings)) wiz.data.fieldMappings = cfg.fieldMappings;
            } else if (type === 'batch') {
              if (typeof cfg.url === 'string') wiz.data.url = cfg.url;
              if (typeof cfg.selector === 'string') wiz.data.selector = cfg.selector;
              if (typeof cfg.classifyBy === 'string') wiz.data.classifyBy = cfg.classifyBy;
              if (typeof cfg.matchMode === 'string') wiz.data.matchMode = cfg.matchMode;
              if (cfg.matchLimit) wiz.data.matchLimit = cfg.matchLimit;
              if (cfg.exportFormat) wiz.data.exportFormat = cfg.exportFormat;
              if (typeof cfg.autoExport !== 'undefined') wiz.data.autoExport = cfg.autoExport;
            } else if (type === 'tracking') {
              if (typeof cfg.url === 'string') wiz.data.url = cfg.url;
              if (typeof cfg.selector === 'string') wiz.data.selector = cfg.selector;
              if (typeof cfg.idField === 'string') wiz.data.idField = cfg.idField;
              if (cfg.intervalMinutes) wiz.data.intervalMinutes = cfg.intervalMinutes;
            }
            this.showToast('✓ 已从模板加载：' + (taskConfig.task?.name || file));
            this.renderWizardStep();
          } catch (err) { this.showToast('导入异常：' + (err.message || err)); }
        }, 80);
      } else if (exportBtn) {
        const { source, category, file } = exportBtn.dataset;
        try {
          const res = await window.electronAPI?.importTaskTemplate?.(source, category, file);
          if (!res?.success) { this.showToast('读取模板失败：' + (res?.error || '未知错误')); return; }
          // 选择目录（导出会以 task.name.json 命名）
          const dirRes = await window.electronAPI?.selectDirectory?.();
          if (!dirRes?.success || !dirRes.data) return; // 用户取消
          const exportRes = await window.electronAPI?.exportTaskConfig?.(res.data.task, dirRes.data);
          if (exportRes?.success) {
            this.showToast('✓ 已导出到：' + exportRes.path);
          } else {
            this.showToast('导出失败：' + (exportRes?.error || '未知错误'));
          }
        } catch (err) { this.showToast('导出异常：' + (err.message || err)); }
      } else if (deleteBtn) {
        const { category, file } = deleteBtn.dataset;
        if (!confirm(`确定删除模板 [${file}]？此操作不可撤销。`)) return;
        try {
          const res = await window.electronAPI?.deleteUserTemplate?.(category, file);
          if (!res?.success) { this.showToast('删除失败：' + (res?.error || '未知错误')); return; }
          this.showToast('✓ 已删除模板');
          await refreshAll();
        } catch (err) { this.showToast('删除异常：' + (err.message || err)); }
      }
    });
  },

  // 模板预览子对话框
  _showTemplatePreview(taskConfig, fileLabel) {
    const existing = document.getElementById('aiworkflowTemplatePreviewModal');
    if (existing) existing.remove();
    const task = taskConfig?.task || {};
    const cfg = task.config || {};
    const typeLabel = { template: '末端抓取', crosspage: '跨页抓取', batch: '批量抓取', tracking: '更新追踪' }[task.type] || task.type || '';

    // 字段表渲染（template / crosspage 有 fields 或 fieldMappings）
    let fieldsHtml = '';
    const fields = cfg.fields || cfg.fieldMappings || [];
    if (Array.isArray(fields) && fields.length) {
      fieldsHtml = `
        <div style="margin-top:10px;">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px;">字段（${fields.length}）</div>
          <div style="border:1px solid var(--border,#ddd);border-radius:6px;overflow:hidden;">
            <table style="width:100%;border-collapse:collapse;font-size:11px;">
              <thead>
                <tr style="background:var(--bg2,#f5f5f5);">
                  <th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border,#ddd);">字段名</th>
                  <th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border,#ddd);">selector</th>
                  <th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border,#ddd);">attr</th>
                  <th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border,#ddd);">extractType</th>
                </tr>
              </thead>
              <tbody>
                ${fields.map(f => `
                  <tr>
                    <td style="padding:6px 8px;border-bottom:1px solid var(--border,#eee);">${this.escapeHtml(f.name || '')}</td>
                    <td style="padding:6px 8px;border-bottom:1px solid var(--border,#eee);font-family:monospace;word-break:break-all;">${this.escapeHtml(f.selector || '')}</td>
                    <td style="padding:6px 8px;border-bottom:1px solid var(--border,#eee);">${this.escapeHtml(f.attr || '')}</td>
                    <td style="padding:6px 8px;border-bottom:1px solid var(--border,#eee);">${this.escapeHtml(f.extractType || '')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // URL 列表
    let urlsHtml = '';
    const urls = cfg.urls || (cfg.url ? [cfg.url] : []) || [];
    const sampleUrls = cfg.sampleUrls || [];
    if (sampleUrls.length) {
      urlsHtml += `<div style="margin-top:10px;"><div style="font-size:12px;font-weight:600;margin-bottom:4px;">样本 URL（${sampleUrls.length}）</div><div style="font-size:11px;color:var(--text2,#888);max-height:80px;overflow-y:auto;background:var(--bg2,#f9f9f9);padding:6px 8px;border-radius:4px;">${sampleUrls.map(u => '<div style="word-break:break-all;">' + this.escapeHtml(u) + '</div>').join('')}</div></div>`;
    }
    if (urls.length) {
      urlsHtml += `<div style="margin-top:10px;"><div style="font-size:12px;font-weight:600;margin-bottom:4px;">目标 URL（${urls.length}）</div><div style="font-size:11px;color:var(--text2,#888);max-height:80px;overflow-y:auto;background:var(--bg2,#f9f9f9);padding:6px 8px;border-radius:4px;">${urls.map(u => '<div style="word-break:break-all;">' + this.escapeHtml(u) + '</div>').join('')}</div></div>`;
    }

    const dlg = document.createElement('div');
    dlg.id = 'aiworkflowTemplatePreviewModal';
    dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.45);z-index:100001;display:flex;align-items:center;justify-content:center;font-family:inherit;';
    dlg.innerHTML = `
      <div style="background:var(--bg,#fff);color:var(--text,#222);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,0.25);padding:20px 22px;width:600px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="margin:0;font-size:15px;">👁 模板预览：${this.escapeHtml(task.name || fileLabel)}</h3>
          <button id="tplPreviewClose" style="background:transparent;border:none;font-size:18px;cursor:pointer;color:var(--text2,#888);">✕</button>
        </div>
        <div style="flex:1;overflow-y:auto;font-size:12px;line-height:1.7;">
          <div><b>任务类型：</b>${typeLabel}</div>
          <div><b>任务名称：</b>${this.escapeHtml(task.name || '')}</div>
          ${cfg.selector ? `<div><b>条目选择器：</b><code style="font-family:monospace;background:var(--bg2,#f5f5f5);padding:1px 4px;border-radius:3px;">${this.escapeHtml(cfg.selector)}</code></div>` : ''}
          ${cfg.classifyBy ? `<div><b>分类依据：</b>${this.escapeHtml(cfg.classifyBy)}</div>` : ''}
          ${cfg.intervalMinutes ? `<div><b>检查间隔：</b>${cfg.intervalMinutes} 分钟</div>` : ''}
          ${cfg.autoExport !== undefined ? `<div><b>自动导出：</b>${cfg.autoExport ? '✓' : '✗'}（格式：${cfg.exportFormat || 'json'}）</div>` : ''}
          ${fieldsHtml}
          ${urlsHtml}
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:14px;">
          <button id="tplPreviewOk" style="padding:7px 18px;border:none;border-radius:6px;background:var(--primary,#3498db);color:#fff;cursor:pointer;font-size:13px;">关闭</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);
    const close = () => dlg.remove();
    dlg.querySelector('#tplPreviewClose').onclick = close;
    dlg.querySelector('#tplPreviewOk').onclick = close;
    dlg.onclick = (e) => { if (e.target === dlg) close(); };
  },

  // ===== Task 4: 从抓取信息卡片列表中选取 URL =====
  async pickUrlFromCards(multiSelect) {
    const wiz = this.state.currentWizard;
    let list = [];
    try {
      const result = await window.electronAPI?.getWorkflows?.();
      if (result?.success) {
        list = result.data || [];
      }
    } catch (e) {
      this.showToast('加载卡片列表失败：' + (e.message || e));
      return;
    }
    if (!list.length) {
      this.showToast('暂无可用的抓取信息卡片');
      return;
    }

    // 弹出选择对话框（模态）
    const existing = document.getElementById('aiworkflowCardPickerModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'aiworkflowCardPickerModal';
    modal.className = 'aiworkflow-modal';
    modal.innerHTML = `
      <div class="aiworkflow-modal-content" style="max-width:560px;">
        <div class="aiworkflow-modal-header">
          <h3>🗂 选择抓取信息卡片</h3>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="task-action-btn" id="cardPickerTrashBtn" style="font-size:12px;padding:4px 10px;" title="回收站">🗑 回收站</button>
            <button class="aiworkflow-modal-close" id="cardPickerClose">×</button>
          </div>
        </div>
        <div class="aiworkflow-form-group">
          <label style="font-size:12px;color:var(--text2);margin-bottom:6px;">导入模式</label>
          <div style="display:flex;gap:12px;margin-bottom:10px;">
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;">
              <input type="radio" name="cardPickerMode" value="url" checked style="width:auto;" />
              <span>卡片目标 URL</span>
            </label>
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;">
              <input type="radio" name="cardPickerMode" value="content" style="width:auto;" />
              <span>卡片内容（资源文本）</span>
            </label>
          </div>
        </div>
        <div class="aiworkflow-form-group">
          <input type="text" id="cardPickerSearch" placeholder="🔍 搜索标题或 URL..." />
        </div>
        <div id="cardPickerList" style="max-height:300px;overflow-y:auto;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
          <button class="task-action-btn" id="cardPickerCancel">取消</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" id="cardPickerConfirm">确认</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const listEl = modal.querySelector('#cardPickerList');
    const searchInput = modal.querySelector('#cardPickerSearch');
    const trashBtn = modal.querySelector('#cardPickerTrashBtn');
    let selectedIds = new Set();
    let trashList = [];
    let showingTrash = false;

    const renderCardList = (filter) => {
      filter = (filter || '').toLowerCase();
      const sourceList = showingTrash ? trashList : list;
      const filtered = sourceList.filter(w => {
        const title = (w.title || '').toLowerCase();
        const url = (w.url || '').toLowerCase();
        return !filter || title.includes(filter) || url.includes(filter);
      });
      if (!filtered.length) {
        listEl.innerHTML = '<div style="text-align:center;color:var(--text2);padding:24px;">' + (showingTrash ? '回收站为空' : '无匹配项') + '</div>';
        return;
      }
      listEl.innerHTML = filtered.map(w => {
        const id = this.escapeHtml(String(w.id ?? ''));
        const title = this.escapeHtml(w.title || '未命名');
        const url = this.escapeHtml(w.url || '');
        const icon = w.url ? '' : '📄';
        const deletedInfo = w.deletedAt ? `<div style="font-size:10px;color:var(--danger);">删除于 ${new Date(w.deletedAt).toLocaleString('zh-CN')}</div>` : '';
        const reasonInfo = w.deletedReason ? `<div style="font-size:10px;color:var(--warning);">${this.escapeHtml(w.deletedReason)}</div>` : '';
        if (showingTrash) {
          // 回收站视图：显示还原和永久删除按钮
          return `
            <div class="aiworkflow-card-pick-item" data-id="${id}" style="display:flex;gap:10px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;opacity:0.8;">
              <span style="font-size:18px;">${icon}</span>
              <div style="flex:1;overflow:hidden;">
                <div style="font-size:13px;font-weight:600;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</div>
                <div style="font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${url || '(无 URL)'}</div>
                ${deletedInfo}${reasonInfo}
              </div>
              <div style="display:flex;gap:6px;">
                <button class="task-action-btn trash-restore-btn" data-id="${id}" style="font-size:11px;padding:4px 8px;" title="还原">↩ 还原</button>
                <button class="task-action-btn trash-delete-btn" data-id="${id}" style="font-size:11px;padding:4px 8px;background:var(--danger);color:#fff;" title="永久删除"> 删除</button>
              </div>
            </div>
          `;
        } else {
          // 正常视图
          return `
            <div class="aiworkflow-card-pick-item" data-id="${id}" style="display:flex;gap:10px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;cursor:pointer;">
              <input type="radio" name="cardPick" value="${id}" style="width:auto;" ${selectedIds.has(id) ? 'checked' : ''} />
              <span style="font-size:18px;">${icon}</span>
              <div style="flex:1;overflow:hidden;">
                <div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</div>
                <div style="font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${url || '(无 URL)'}</div>
              </div>
            </div>
          `;
        }
      }).join('');

      // 绑定点击事件
      listEl.querySelectorAll('.aiworkflow-card-pick-item').forEach(item => {
        if (showingTrash) {
          // 回收站视图：绑定还原和删除按钮
          const restoreBtn = item.querySelector('.trash-restore-btn');
          const deleteBtn = item.querySelector('.trash-delete-btn');
          if (restoreBtn) {
            restoreBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const id = restoreBtn.dataset.id;
              try {
                const res = await window.electronAPI?.restoreWorkflow?.(id);
                if (res?.success) {
                  this.showToast('✓ 已还原');
                  // 从回收站列表移除
                  trashList = trashList.filter(w => String(w.id) !== id);
                  renderCardList(searchInput.value);
                } else {
                  this.showToast('还原失败：' + (res?.error || '未知错误'));
                }
              } catch (e) {
                this.showToast('还原异常：' + (e.message || e));
              }
            });
          }
          if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const id = deleteBtn.dataset.id;
              if (!confirm('确定永久删除该卡片？此操作不可撤销。')) return;
              try {
                const res = await window.electronAPI?.permanentDeleteWorkflow?.(id);
                if (res?.success) {
                  this.showToast('✓ 已永久删除');
                  trashList = trashList.filter(w => String(w.id) !== id);
                  renderCardList(searchInput.value);
                } else {
                  this.showToast('删除失败：' + (res?.error || '未知错误'));
                }
              } catch (e) {
                this.showToast('删除异常：' + (e.message || e));
              }
            });
          }
        } else {
          // 正常视图：选择卡片
          item.addEventListener('click', (e) => {
            const id = item.dataset.id;
            if (multiSelect) {
              if (selectedIds.has(id)) selectedIds.delete(id);
              else selectedIds.add(id);
              const cb = item.querySelector('input[type="radio"], input[type="checkbox"]');
              if (cb) cb.checked = selectedIds.has(id);
            } else {
              selectedIds.clear();
              selectedIds.add(id);
              listEl.querySelectorAll('input[name="cardPick"]').forEach(r => { r.checked = r.value === id; });
            }
          });
        }
      });
    };

    // 加载回收站数据
    const loadTrashList = async () => {
      try {
        const res = await window.electronAPI?.getTrashWorkflows?.();
        if (res?.success) {
          trashList = res.data || [];
        }
      } catch (e) {
        console.error('加载回收站失败:', e);
      }
    };

    // 回收站按钮切换
    trashBtn.addEventListener('click', async () => {
      showingTrash = !showingTrash;
      if (showingTrash) {
        await loadTrashList();
        trashBtn.textContent = '📋 返回卡片';
        trashBtn.style.background = 'var(--warning)';
        trashBtn.style.color = '#fff';
      } else {
        trashBtn.textContent = '🗑 回收站';
        trashBtn.style.background = '';
        trashBtn.style.color = '';
      }
      searchInput.value = '';
      renderCardList('');
    });

    renderCardList('');
    searchInput.addEventListener('input', (e) => renderCardList(e.target.value));

    // 关闭/确认
    const closeModal = () => modal.remove();
    modal.querySelector('#cardPickerClose').onclick = closeModal;
    modal.querySelector('#cardPickerCancel').onclick = closeModal;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    modal.querySelector('#cardPickerConfirm').onclick = async () => {
      const selected = list.filter(w => selectedIds.has(String(w.id)));
      if (!selected.length) {
        this.showToast('请选择一个卡片');
        return;
      }
      // 获取导入模式
      const modeRadio = modal.querySelector('input[name="cardPickerMode"]:checked');
      const importMode = modeRadio ? modeRadio.value : 'url';

      if (importMode === 'content') {
        // 内容模式：获取卡片资源内容 + 超链接 + 卡片页面 URL
        closeModal();
        // 有效 URL 判定：仅 http(s):// 或域名形式，过滤 blob:/data:/javascript:/about:
        const isValidUrl = (s) => {
          if (!s) return false;
          const t = String(s).trim();
          if (/^(blob|data|javascript|about|chrome|file):/i.test(t)) return false;
          if (/^https?:\/\//i.test(t)) return true;
          if (/^\/\/[^/]/.test(t)) return true;
          if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(t)) return true;
          return false;
        };
        const urlLikeContents = []; // content 中像 URL 的（写入 sampleUrls/urls）
        const textContents = [];     // content 中纯文本（不写入 URL 字段，仅统计）
        const allUrls = [];
        for (const card of selected) {
          try {
            const detail = await window.electronAPI?.getWorkflowDetail?.(card.id);
            const data = detail?.success ? detail.data : null;
            const resources = (data && data.resources) || [];
            // 卡片页面 URL（根 URL）：作为链接来源，B 站等视频卡片的 resources 可能只有 blob: URL，
            // 但卡片根 url（页面 URL）是有效的 http(s) URL，必须纳入
            if (data && data.url && isValidUrl(data.url)) {
              allUrls.push(String(data.url).trim());
            }
            for (const r of resources) {
              // 区分 content 是 URL 还是纯文本
              if (r.content) {
                if (isValidUrl(r.content)) {
                  urlLikeContents.push(String(r.content).trim());
                } else {
                  textContents.push(String(r.content));
                }
              }
              // 提取资源自身的 URL（需是有效 http(s) URL，过滤 blob: 等）
              if (r.url && isValidUrl(r.url)) {
                allUrls.push(r.url);
              }
              // 提取子链接（childLinks 中的 href）
              if (Array.isArray(r.childLinks)) {
                for (const cl of r.childLinks) {
                  if (cl.href && isValidUrl(cl.href)) allUrls.push(cl.href);
                }
              }
            }
          } catch (e) { /* ignore */ }
        }
        const allUrlCandidates = [...urlLikeContents, ...allUrls];
        if (!allUrlCandidates.length && !textContents.length) {
          this.showToast('所选卡片没有内容或链接资源');
          return;
        }
        if (wiz && wiz.data) {
          if (wiz.type === 'template' && wiz.step === 1) {
            // 末端抓取 Step 1：写入样本网页字段 sampleUrls（仅 URL，跳过纯文本）
            const existing = (wiz.data.sampleUrls || '').split('\n').map(s => s.trim()).filter(Boolean);
            const merged = Array.from(new Set([...existing, ...allUrlCandidates]));
            wiz.data.sampleUrls = merged.join('\n');
          } else if (wiz.type === 'crosspage' || wiz.type === 'template') {
            // 跨页面/末端抓取目标网页：写入 urls 字段（仅 URL，跳过纯文本）
            const existing = (wiz.data.urls || '').split('\n').map(s => s.trim()).filter(Boolean);
            const merged = Array.from(new Set([...existing, ...allUrlCandidates]));
            wiz.data.urls = merged.join('\n');
          } else {
            wiz.data.url = allUrlCandidates[0] || '';
          }
          this.renderWizardStep();
        }
        const total = allUrlCandidates.length;
        const skippedText = textContents.length;
        let msg = '✓ 已导入 ' + total + ' 条 URL';
        if (skippedText > 0) msg += '（已跳过 ' + skippedText + ' 条纯文本内容）';
        this.showToast(msg);
        return;
      }

      // URL 模式（原有逻辑）
      if (multiSelect) {
        // 过滤无效 URL：blob:/data:/javascript: 等不纳入（B 站视频卡片的 resource.url 可能是 blob:）
        const isValidUrl = (s) => {
          if (!s) return false;
          const t = String(s).trim();
          if (/^(blob|data|javascript|about|chrome|file):/i.test(t)) return false;
          if (/^https?:\/\//i.test(t)) return true;
          if (/^\/\/[^/]/.test(t)) return true;
          if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(t)) return true;
          return false;
        };
        const urls = selected.map(s => s.url).filter(isValidUrl);
        closeModal();
        if (wiz && wiz.data) {
          if (wiz.type === 'template' && wiz.step === 1) {
            // 末端抓取 Step 1：URL 作为样本网页
            const existing = (wiz.data.sampleUrls || '').split('\n').map(s => s.trim()).filter(Boolean);
            const merged = Array.from(new Set([...existing, ...urls]));
            wiz.data.sampleUrls = merged.join('\n');
          } else if (wiz.type === 'crosspage' || wiz.type === 'template') {
            // 跨页面/末端抓取：URL 作为目标列表（template 时写入目标网页字段 urls）
            const existing = (wiz.data.urls || '').split('\n').map(s => s.trim()).filter(Boolean);
            const merged = Array.from(new Set([...existing, ...urls]));
            wiz.data.urls = merged.join('\n');
          } else {
            wiz.data.url = urls[0] || '';
          }
          this.renderWizardStep();
        }
        return urls;
      } else {
        // 单选
        // 跨页面步骤3：从卡片导入样例字段映射
        if (wiz && wiz.type === 'crosspage' && wiz.step === 3) {
          const card = selected[0];
          closeModal();
          try {
            const detail = await window.electronAPI?.getWorkflowDetail?.(card.id);
            const resources = (detail?.success && detail.data?.resources) || [];
            if (!resources.length) {
              this.showToast('该卡片没有资源，无法推断字段映射');
              return;
            }
            const existing = Array.isArray(wiz.data.fieldMappings) ? wiz.data.fieldMappings : [];
            const seen = new Set(existing.map(f => f.name));
            let added = 0;
            for (const r of resources) {
              const name = (r.name || '').trim();
              if (!name || seen.has(name)) continue;
              seen.add(name);
              existing.push({ name, selector: '', attr: 'text' });
              added++;
            }
            wiz.data.fieldMappings = existing;
            this.renderWizardStep();
            this.showToast('✓ 已从卡片导入 ' + added + ' 个字段样例');
          } catch (e) {
            this.showToast('导入样例失败：' + (e.message || e));
          }
          return;
        }
        const url = selected[0].url;
        if (!url) {
          this.showToast('该卡片没有 URL');
          return;
        }
        if (wiz && wiz.data) {
          wiz.data.url = url;
          this.renderWizardStep();
        }
        closeModal();
        this.showToast('✓ 已填入 URL');
      }
    };
  },

  // ===== Task 9: 在抓取模块中拾取选择器 =====
  // onPickCallback(selector) 可选：若提供则独立回调（不依赖向导），用于微调场景
  async pickSelector(targetUrl, onPickCallback) {
    const wiz = this.state.currentWizard;
    // 检查目标 URL 是否与当前活动标签页一致（提示用户）
    // 由于无法直接读取 BrowserView URL（需通过 App.state），这里只做软提示
    if (targetUrl && typeof App !== 'undefined' && App.state) {
      const activeTab = App.state.tabs.find(t => String(t.id) === String(App.state.activeTabId));
      if (!activeTab || activeTab.url !== targetUrl) {
        // 尝试自动导航：如果有活动标签，加载目标 URL
        if (activeTab && window.electronAPI?.loadUrl) {
          try {
            await window.electronAPI.loadUrl(App.state.activeTabId, targetUrl);
            // 等待页面加载
            await new Promise(r => setTimeout(r, 3000));
          } catch (e) { /* 忽略，让用户手动导航 */ }
        } else {
          this.showToast('请先在抓取模块中导航到目标页面');
        }
      }
    }

    // 切换到抓取模块
    if (typeof App !== 'undefined' && App.switchModule) {
      App.switchModule('scraper');
    }

    // 注册一次性 picker-result 回调
    if (!window.electronAPI?.pickerAPI?.onPickerResult) {
      this.showToast('拾取模式 API 不可用');
      return;
    }
    // 退出旧的拾取模式（如果存在）
    try { await window.electronAPI.pickerAPI.exitPickerMode(); } catch (e) { /* ignore */ }

    // 进入拾取模式
    const enterResult = await window.electronAPI.pickerAPI.enterPickerMode();
    if (!enterResult?.success) {
      this.showToast('进入拾取模式失败：' + (enterResult?.error || '请先打开一个标签页'));
      return;
    }
    this.showToast('🎯 已进入拾取模式，请在页面上点击要抓取的元素');

    // 注册一次性回调
    const off = window.electronAPI.pickerAPI.onPickerResult((data) => {
      // 取消订阅
      if (typeof off === 'function') off();
      const switchBack = () => {
        if (typeof App !== 'undefined' && App.switchModule) {
          App.switchModule('aiworkflow');
        }
      };
      if (data && data.selector) {
        const msg = '✓ 已拾取选择器：' + (data.selector.length > 40 ? data.selector.slice(0, 40) + '...' : data.selector);
        if (typeof onPickCallback === 'function') {
          // 独立回调路径（微调场景 / 末端抓取字段选取）：不依赖向导
          // 回调返回 true 表示自行处理了 UI 切换，不自动 switchBack
          let handled = false;
          try { handled = onPickCallback(data.selector, data); } catch (e) { /* ignore */ }
          if (handled !== true) {
            this.showToast(msg);
            switchBack();
          }
        } else if (wiz && wiz.data) {
          // 向导路径：填入向导选择器字段
          wiz.data.selector = data.selector;
          // 使用 picker 提供的预览数据（问题1：避免重新加载页面导致数量不一致）
          if (data.matchCount !== undefined) {
            wiz.data.matchedCount = data.matchCount;
          }
          if (Array.isArray(data.previews)) {
            wiz.data.matchedPreview = data.previews;
            wiz.data.pagePickedPreview = data.previews; // 保存页面选取的预览数据（问题2）
            wiz.data.pagePickedCount = data.matchCount;
          }
          this.showToast(msg + (data.matchCount ? `，匹配 ${data.matchCount} 个元素` : ''));
          switchBack();
          this.renderWizardStep();
          // 不再自动运行 testSelector，直接使用 picker 提供的预览数据
        } else {
          this.showToast(msg);
          switchBack();
        }
      } else {
        this.showToast('已取消拾取');
        switchBack();
        if (wiz) this.renderWizardStep();
      }
    });
  },

  // ===== 末端抓取 Step 2: 在网页上可视化选取元素作为字段 =====
  // 选取流程：左键累积选取元素 → 右键工具菜单（含复数选取/自动匹配同类）→ Enter 或菜单"完成"提交
  // 提交后自动从 multiSelectors 批量生成 fields（无需用户配置字段名/选择器/属性）
  async pickFieldFromPage() {
    const wiz = this.state.currentWizard;
    if (!wiz || wiz.type !== 'template' || wiz.step !== 2) {
      this.showToast('仅在末端抓取 Step 2 可用');
      return;
    }
    const sampleUrls = (wiz.data.sampleUrls || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!sampleUrls.length) {
      this.showToast('请先在 Step 1 输入样本网页 URL');
      return;
    }
    const targetUrl = sampleUrls[0];

    // 调用 pickSelector，传入自定义回调（返回 true 表示自行处理 UI 切换）
    await this.pickSelector(targetUrl, (selector, data) => {
      // 切回 aiworkflow 模块
      if (typeof App !== 'undefined' && App.switchModule) {
        App.switchModule('aiworkflow');
      }
      // picker 取消（data 为 null）
      if (!data) {
        this.showToast('已取消选取');
        this.renderWizardStep();
        return true;
      }
      // 批量添加 fields
      this.addPickedFieldsFromPickerData(data);
      return true; // 自行处理 UI
    });
  },

  // 从 picker 返回的数据批量生成 fields（自动推断 extractType / attr / 字段名）
  addPickedFieldsFromPickerData(data) {
    const wiz = this.state.currentWizard;
    if (!wiz || wiz.type !== 'template') return;
    if (!Array.isArray(wiz.data.fields)) wiz.data.fields = [];

    // multiSelectors：每个元素一个独立 selector（左键多选场景）
    const multi = Array.isArray(data.multiSelectors) ? data.multiSelectors : [];
    // previews：每个 selector 对应的样本预览
    const previews = Array.isArray(data.previews) ? data.previews : [];
    // sample：旧字段（单选场景）
    const sampleText = (data.sample && typeof data.sample === 'object') ? (data.sample.text || '') : (data.sample || '');

    let added = 0;
    if (multi.length > 0) {
      // 多 selector 模式：每个 selector 生成一个 field
      multi.forEach((item, idx) => {
        const sel = item.selector || '';
        if (!sel) return;
        // 去重：避免重复添加同一 selector
        if (wiz.data.fields.some(f => f.selector === sel)) return;
        const pv = previews[idx];
        const preview = (typeof pv === 'string') ? pv
                      : (pv && pv.text) ? pv.text : '';
        const inferred = this.inferFieldFromSelector(sel, preview, pv);
        wiz.data.fields.push({
          name: inferred.name,
          selector: sel,
          attr: inferred.attr,
          extractType: inferred.extractType,
          _preview: preview || ''
        });
        added++;
      });
    } else if (data.selector) {
      // 单 selector 模式
      const sel = data.selector;
      if (!wiz.data.fields.some(f => f.selector === sel)) {
        const pv = previews[0];
        const preview = (typeof pv === 'string') ? pv
                      : (pv && pv.text) ? pv.text
                      : sampleText || '';
        const inferred = this.inferFieldFromSelector(sel, preview, pv);
        wiz.data.fields.push({
          name: inferred.name,
          selector: sel,
          attr: inferred.attr,
          extractType: inferred.extractType,
          _preview: preview || ''
        });
        added++;
      }
    }

    this.renderWizardStep();
    if (added > 0) {
      const cnt = data.matchCount || added;
      this.showToast('✓ 已添加 ' + added + ' 个字段（共 ' + wiz.data.fields.length + ' 个' + (cnt > added ? '，匹配 ' + cnt + ' 个元素' : '') + '）');
    } else {
      this.showToast('未添加新字段（可能已存在）');
    }
  },

  // 根据选择器推断字段类型/属性/默认名
  // selector 形如 "#id > div:nth-child(1) > a"，取最后一段标签名推断类型
  // 容器元素（div/section/article/li 等）→ extractType='all'（综合提取所有资源类型）
  inferFieldFromSelector(selector, preview, previewObj) {
    let extractType = 'text';
    let attr = 'text';
    // 优先从 previewObj.tag 推断（picker 返回的 previews[].tag 字段）
    let tag = '';
    if (previewObj && typeof previewObj === 'object' && previewObj.tag) {
      tag = String(previewObj.tag).toLowerCase();
    } else {
      // 从 selector 末尾提取标签名
      const sel = String(selector || '');
      // 处理带尖括号形式：<A class="..."> 或 <video ...>
      const tagInBrackets = sel.match(/<\s*([a-zA-Z0-9]+)/);
      if (tagInBrackets) {
        tag = tagInBrackets[1].toLowerCase();
      } else {
        // 处理 CSS 选择器形式：取最后一段，去掉属性/伪类，提取标签名
        const lastPart = sel.split('>').pop().trim().split(/\s+/).pop() || '';
        // 去掉 .class #id :nth-child 等
        const tagMatch = lastPart.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
        if (tagMatch) tag = tagMatch[1].toLowerCase();
      }
    }
    // 具体媒体元素：单一类型提取
    if (tag === 'a') {
      extractType = 'link';
      attr = 'href';
    } else if (tag === 'video') {
      extractType = 'video';
      attr = 'src';
    } else if (tag === 'audio') {
      extractType = 'audio';
      attr = 'src';
    } else if (tag === 'img') {
      extractType = 'image';
      attr = 'src';
    } else if (tag === 'source') {
      extractType = 'video';
      attr = 'src';
    } else if (tag === 'iframe') {
      extractType = 'link';
      attr = 'src';
    } else {
      // 容器元素（div/section/article/li/ul/ol/p/span/header/footer/main/nav/aside 等）：
      // 综合提取元素内所有资源类型（文本/图片/视频/音频/超链接/下载链接）
      const containerTags = ['div', 'section', 'article', 'li', 'ul', 'ol', 'p', 'span',
        'header', 'footer', 'main', 'nav', 'aside', 'figure', 'figcaption',
        'details', 'summary', 'form', 'fieldset', 'table', 'tr', 'td', 'th',
        'dd', 'dl', 'dt', 'address', 'blockquote', 'pre'];
      if (containerTags.indexOf(tag) >= 0 || tag === '') {
        extractType = 'all';
        attr = 'text';
      }
    }
    // 字段名：取 preview 前 20 字符，否则用 field_N
    let name = String(preview || '').replace(/[\s\r\n\t<>]+/g, ' ').trim().slice(0, 20);
    if (!name) name = 'field_' + ((Date.now() + Math.floor(Math.random() * 1000)) % 10000);
    return { name, extractType, attr };
  },

  // 删除已选字段
  removePickedField(index) {
    const wiz = this.state.currentWizard;
    if (!wiz || wiz.type !== 'template') return;
    if (!Array.isArray(wiz.data.fields)) return;
    if (index < 0 || index >= wiz.data.fields.length) return;
    wiz.data.fields.splice(index, 1);
    this.renderWizardStep();
  },

  // 清空所有已选字段
  clearPickedFields() {
    const wiz = this.state.currentWizard;
    if (!wiz || wiz.type !== 'template') return;
    if (!wiz.data.fields || !wiz.data.fields.length) return;
    if (!confirm('确定清空所有已选字段？')) return;
    wiz.data.fields = [];
    this.renderWizardStep();
    this.showToast('已清空');
  },

  // D2：手动添加一个空字段到 template Step 2（不依赖 addFieldMappingRow 的 crosspage 容器）
  addTemplateField() {
    const wiz = this.state.currentWizard;
    if (!wiz || wiz.type !== 'template') return;
    if (!Array.isArray(wiz.data.fields)) wiz.data.fields = [];
    wiz.data.fields.push({ name: '', selector: '', attr: 'text', extractType: 'text', _preview: '' });
    this.renderWizardStep();
  },

  // ===== Task 17: 从抓取信息卡片导入 =====
  async openImportFromCardsDialog() {
    // 拉取抓取信息卡片列表
    let list = [];
    try {
      const result = await window.electronAPI?.getWorkflows?.();
      if (result?.success) list = result.data || [];
    } catch (e) {
      this.showToast('加载卡片列表失败：' + (e.message || e));
      return;
    }
    if (!list.length) {
      this.showToast('暂无可用的抓取信息卡片');
      return;
    }

    // 弹出选择对话框（复用模态样式）
    const existing = document.getElementById('aiworkflowImportPickerModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'aiworkflowImportPickerModal';
    modal.className = 'aiworkflow-modal';
    modal.innerHTML = `
      <div class="aiworkflow-modal-content" style="max-width:600px;">
        <div class="aiworkflow-modal-header">
          <h3>📥 从抓取信息卡片导入</h3>
          <button class="aiworkflow-modal-close" id="importPickerClose">×</button>
        </div>
        <div class="aiworkflow-form-group">
          <input type="text" id="importPickerSearch" placeholder="🔍 搜索标题或 URL..." />
        </div>
        <div id="importPickerList" style="max-height:400px;overflow-y:auto;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
          <button class="task-action-btn" id="importPickerCancel">取消</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" id="importPickerConfirm">导入</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const listEl = modal.querySelector('#importPickerList');
    const searchInput = modal.querySelector('#importPickerSearch');
    let selectedId = null;

    const renderImportList = (filter) => {
      filter = (filter || '').toLowerCase();
      const filtered = list.filter(w => {
        const title = (w.title || '').toLowerCase();
        const url = (w.url || '').toLowerCase();
        return !filter || title.includes(filter) || url.includes(filter);
      });
      if (!filtered.length) {
        listEl.innerHTML = '<div style="text-align:center;color:var(--text2);padding:24px;">无匹配项</div>';
        return;
      }
      listEl.innerHTML = filtered.map(w => {
        const id = this.escapeHtml(String(w.id ?? ''));
        const title = this.escapeHtml(w.title || '未命名');
        const url = this.escapeHtml(w.url || '');
        const time = w.createdAt ? new Date(w.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        const isAiwf = (w.cardType || 'media') === 'aiworkflow-result';
        const badge = isAiwf
          ? '<span style="background:var(--primary);color:#fff;font-size:10px;padding:2px 6px;border-radius:3px;">⚙ 工作流</span>'
          : '<span style="background:var(--text3);color:#fff;font-size:10px;padding:2px 6px;border-radius:3px;">🎬 多媒体</span>';
        const typeIcon = isAiwf ? ({ batch: '📦', crosspage: '🌐', tracking: '🔔' }[w.sourceTaskType] || '🤖') : '🎬';
        return `
          <div class="aiworkflow-card-pick-item" data-id="${id}" style="display:flex;gap:10px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;cursor:pointer;">
            <input type="radio" name="importPick" value="${id}" style="width:auto;" ${selectedId === id ? 'checked' : ''} />
            <span style="font-size:18px;">${typeIcon}</span>
            <div style="flex:1;overflow:hidden;">
              <div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${badge} ${title}</div>
              <div style="font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${url || '(无 URL)'}</div>
              <div style="font-size:10px;color:var(--text3);">${time}</div>
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.aiworkflow-card-pick-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.dataset.id;
          selectedId = id;
          listEl.querySelectorAll('input[name="importPick"]').forEach(r => { r.checked = r.value === id; });
        });
      });
    };

    renderImportList('');
    searchInput.addEventListener('input', (e) => renderImportList(e.target.value));

    const closeModal = () => modal.remove();
    modal.querySelector('#importPickerClose').onclick = closeModal;
    modal.querySelector('#importPickerCancel').onclick = closeModal;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    modal.querySelector('#importPickerConfirm').onclick = async () => {
      if (!selectedId) {
        this.showToast('请选择一个卡片');
        return;
      }
      const card = list.find(w => String(w.id) === String(selectedId));
      if (!card) {
        this.showToast('未找到所选卡片');
        return;
      }
      const cardType = card.cardType || 'media';
      closeModal();

      if (cardType === 'aiworkflow-result') {
        // 工作流结果卡片：读取 sourceTaskId 完整任务，复用 config 创建同类型新任务
        const sourceTaskId = card.sourceTaskId;
        if (!sourceTaskId) {
          this.showToast('该卡片未关联源任务，无法复用配置');
          return;
        }
        try {
          const res = await window.electronAPI?.aiworkflowAPI?.getDetail?.(sourceTaskId);
          if (!res?.success || !res.data) {
            this.showToast('加载源任务失败：' + (res?.error || '未找到'));
            return;
          }
          const sourceTask = res.data;
          const sourceType = sourceTask.type || 'batch';
          const sourceConfig = sourceTask.config || {};
          this.openCreateWizard(sourceType, null, sourceConfig);
          // 跳到向导第二步（URL 已预填）
          if (this.state.currentWizard) {
            this.state.currentWizard.step = 2;
            this.renderWizardStep();
          }
          this.showToast('✓ 已复用任务配置，请确认并保存');
        } catch (e) {
          this.showToast('读取源任务异常：' + (e.message || e));
        }
      } else {
        // 多媒体卡片：以卡片 URL 创建批量抓取任务
        const url = card.url;
        if (!url) {
          this.showToast('该卡片没有 URL，无法创建批量任务');
          return;
        }
        this.openCreateWizard('batch', null, { url: url });
        // 跳到向导第二步（URL 已预填）
        if (this.state.currentWizard) {
          this.state.currentWizard.step = 2;
          this.renderWizardStep();
        }
        this.showToast('✓ 已填入 URL，请继续配置选择器');
      }
    };
  },

  // ===== Task 17.3: 跨页面向导"从卡片导入样例"按钮回调 =====
  // 弹出卡片选择对话框，将选中卡片的 resources 数组作为字段映射样例填入
  async pickCardForFieldSample() {
    const wiz = this.state.currentWizard;
    // crosspage 在 step 3 用 fieldMappings，template 在 step 2 用 fields
    const isCrosspageStep = (wiz && wiz.type === 'crosspage' && wiz.step === 3);
    const isTemplateStep = (wiz && wiz.type === 'template' && wiz.step === 2);
    if (!isCrosspageStep && !isTemplateStep) {
      this.showToast('请在字段配置步骤使用此功能');
      return;
    }
    let list = [];
    try {
      const result = await window.electronAPI?.getWorkflows?.();
      if (result?.success) list = result.data || [];
    } catch (e) {
      this.showToast('加载卡片列表失败：' + (e.message || e));
      return;
    }
    if (!list.length) {
      this.showToast('暂无可用的抓取信息卡片');
      return;
    }

    // 复用选择对话框样式
    const existing = document.getElementById('aiworkflowFieldSamplePickerModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'aiworkflowFieldSamplePickerModal';
    modal.className = 'aiworkflow-modal';
    modal.innerHTML = `
      <div class="aiworkflow-modal-content" style="max-width:560px;">
        <div class="aiworkflow-modal-header">
          <h3>📋 从卡片导入字段样例</h3>
          <button class="aiworkflow-modal-close" id="fsPickerClose">×</button>
        </div>
        <div class="aiworkflow-form-group">
          <input type="text" id="fsPickerSearch" placeholder="🔍 搜索标题或 URL..." />
        </div>
        <div id="fsPickerList" style="max-height:360px;overflow-y:auto;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
          <button class="task-action-btn" id="fsPickerCancel">取消</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" id="fsPickerConfirm">导入样例</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const listEl = modal.querySelector('#fsPickerList');
    const searchInput = modal.querySelector('#fsPickerSearch');
    let selectedId = null;

    const renderFsList = (filter) => {
      filter = (filter || '').toLowerCase();
      const filtered = list.filter(w => {
        const title = (w.title || '').toLowerCase();
        const url = (w.url || '').toLowerCase();
        return !filter || title.includes(filter) || url.includes(filter);
      });
      if (!filtered.length) {
        listEl.innerHTML = '<div style="text-align:center;color:var(--text2);padding:24px;">无匹配项</div>';
        return;
      }
      listEl.innerHTML = filtered.map(w => {
        const id = this.escapeHtml(String(w.id ?? ''));
        const title = this.escapeHtml(w.title || '未命名');
        const url = this.escapeHtml(w.url || '');
        const resCount = (w.resources || []).length;
        const isAiwf = (w.cardType || 'media') === 'aiworkflow-result';
        const badge = isAiwf ? '<span style="font-size:10px;color:var(--primary);">⚙</span>' : '';
        return `
          <div class="aiworkflow-card-pick-item" data-id="${id}" style="display:flex;gap:10px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;cursor:pointer;">
            <input type="radio" name="fsPick" value="${id}" style="width:auto;" ${selectedId === id ? 'checked' : ''} />
            <span style="font-size:18px;">📄</span>
            <div style="flex:1;overflow:hidden;">
              <div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${badge} ${title}</div>
              <div style="font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${url || '(无 URL)'} · ${resCount} 个资源</div>
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.aiworkflow-card-pick-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.dataset.id;
          selectedId = id;
          listEl.querySelectorAll('input[name="fsPick"]').forEach(r => { r.checked = r.value === id; });
        });
      });
    };

    renderFsList('');
    searchInput.addEventListener('input', (e) => renderFsList(e.target.value));

    const closeModal = () => modal.remove();
    modal.querySelector('#fsPickerClose').onclick = closeModal;
    modal.querySelector('#fsPickerCancel').onclick = closeModal;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    modal.querySelector('#fsPickerConfirm').onclick = async () => {
      if (!selectedId) {
        this.showToast('请选择一个卡片');
        return;
      }
      const card = list.find(w => String(w.id) === String(selectedId));
      if (!card) return;
      closeModal();
      // 拉取卡片详情以获取 resources 数组
      let resources = [];
      try {
        const detail = await window.electronAPI?.getWorkflowDetail?.(card.id);
        if (detail?.success && detail.data) {
          resources = detail.data.resources || [];
        }
      } catch (e) { /* ignore */ }
      if (!resources.length) {
        // 退回到列表中已有的 resources
        resources = card.resources || [];
      }
      if (!resources.length) {
        this.showToast('该卡片没有资源，无法推断字段映射');
        return;
      }
      // 将每条 resource 转为一行字段映射：字段名 = resource.name，子选择器留空，取值属性 = 'text'
      const isTemplate = (wiz.type === 'template');
      const fieldKey = isTemplate ? 'fields' : 'fieldMappings';
      const existingMappings = Array.isArray(wiz.data[fieldKey]) ? wiz.data[fieldKey] : [];
      const seen = new Set(existingMappings.map(f => f.name));
      let added = 0;
      for (const r of resources) {
        const name = (r.name || '').trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const m = { name: name, selector: '', attr: 'text' };
        if (isTemplate) m.extractType = 'text';
        existingMappings.push(m);
        added++;
      }
      wiz.data[fieldKey] = existingMappings;
      this.renderWizardStep();
      this.showToast('✓ 已从卡片导入 ' + added + ' 个字段样例');
    };
  },

  // ===== Task 5: 运行任务 =====
  async runTask(taskId) {
    if (!taskId) return;
    if (this.state.runningTasks.has(taskId)) {
      this.showToast('该任务正在运行中，请稍候');
      return;
    }
    this.state.runningTasks.add(taskId);
    // 立即重渲染，显示运行中状态
    this.renderList();
    this.showToast('⏳ 任务运行中...');

    try {
      const result = await window.electronAPI?.aiworkflowAPI?.runTask?.(taskId);
      if (result?.success) {
        if (typeof result.newCount === 'number') {
          this.showToast(`✓ 追踪完成：共 ${result.itemCount} 条，新增 ${result.newCount} 条`);
        } else {
          this.showToast(`✓ 抓取完成：${result.itemCount} 条结果`);
        }
      } else {
        this.showToast('✗ 任务失败：' + (result?.error || '未知错误'));
      }
    } catch (e) {
      this.showToast('✗ 任务异常：' + (e.message || e));
    } finally {
      this.state.runningTasks.delete(taskId);
      await this.loadList();
    }
  },

  // ===== 链式运行：运行任务及其所有下游依赖任务 =====
  async chainRunTask(taskId) {
    if (!taskId) return;
    if (this.state.runningTasks.has(taskId)) {
      this.showToast('该任务正在运行中，请稍候');
      return;
    }
    this.state.runningTasks.add(taskId);
    this.renderList();
    this.showToast('⏳ 链式运行中（含下游任务）...');

    try {
      const result = await window.electronAPI?.aiworkflowAPI?.chainRunTask?.(taskId);
      if (result?.success && Array.isArray(result.chainResults)) {
        const total = result.chainResults.length;
        const success = result.chainResults.filter(r => r.success).length;
        const failed = total - success;
        const totalItems = result.chainResults.reduce((sum, r) => sum + (r.itemCount || 0), 0);
        let msg = `✓ 链式运行完成：${success}/${total} 个任务成功`;
        if (totalItems > 0) msg += `，共 ${totalItems} 条结果`;
        if (failed > 0) {
          const failedNames = result.chainResults.filter(r => !r.success).map(r => r.taskName).join('、');
          msg += `（失败：${failedNames}）`;
        }
        this.showToast(msg);
      } else {
        this.showToast('✗ 链式运行失败：' + (result?.error || '未知错误'));
      }
    } catch (e) {
      this.showToast('✗ 链式运行异常：' + (e.message || e));
    } finally {
      this.state.runningTasks.delete(taskId);
      await this.loadList();
    }
  },

  // ===== Task 8: 追踪暂停/恢复 =====
  async pauseTracking(taskId) {
    if (!taskId) return;
    try {
      await window.electronAPI?.aiworkflowAPI?.pauseTracking?.(taskId);
      this.showToast('⏸ 已暂停追踪');
    } catch (e) {
      this.showToast('暂停失败：' + (e.message || e));
    }
    await this.loadList();
  },

  async resumeTracking(taskId) {
    if (!taskId) return;
    try {
      await window.electronAPI?.aiworkflowAPI?.resumeTracking?.(taskId);
      this.showToast('▶ 已恢复追踪');
    } catch (e) {
      this.showToast('恢复失败：' + (e.message || e));
    }
    await this.loadList();
  },

  // ===== Task 8: 接收追踪更新通知 =====
  handleTrackingUpdate(data) {
    this.loadList();
    if (data && data.taskName && data.newCount > 0) {
      this.showTrackingBanner(`🔔 追踪任务 [${data.taskName}] 发现 ${data.newCount} 条更新`);
    }
  },

  showTrackingBanner(message) {
    const existing = document.getElementById('aiworkflowTrackingBanner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.id = 'aiworkflowTrackingBanner';
    banner.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:var(--success);color:#fff;padding:10px 20px;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.3);z-index:2000;font-size:13px;font-weight:600;max-width:80vw;text-align:center;';
    banner.textContent = message;
    document.body.appendChild(banner);
    setTimeout(() => {
      if (banner && banner.parentNode) {
        banner.style.transition = 'opacity 0.4s';
        banner.style.opacity = '0';
        setTimeout(() => { if (banner && banner.parentNode) banner.remove(); }, 400);
      }
    }, 5000);
  },

  async deleteTask(taskId) {
    if (!taskId) return;
    // 查找任务名以在确认提示中显示
    const task = this.state.tasks.find(t => String(t.id) === String(taskId));
    const taskName = task ? (task.name || '未命名任务') : '该任务';
    const confirmed = confirm(`确定删除任务 [${taskName}]？此操作不可撤销。`);
    if (!confirmed) return;
    try {
      await window.electronAPI?.aiworkflowAPI?.delete?.(taskId);
    } catch (e) {
      console.error('AIWorkflow.deleteTask failed:', e);
    }
    await this.loadList();
  },

  // ===== Task 10: 结果面板 =====
  // 结果面板状态：{ taskId, task, currentBatchId, showAllTracking, visibleLimit }
  resultPanel: null,
  // 跨页面微调模态状态：{ taskId, sourceUrl, newSelectors:{fieldName: newSelector} }
  crosspageTune: null,

  async openResultPanel(taskId) {
    if (!taskId) return;
    let task;
    try {
      const res = await window.electronAPI?.aiworkflowAPI?.getDetail?.(taskId);
      if (!res?.success) {
        this.showToast('加载任务失败：' + (res?.error || '未知错误'));
        return;
      }
      task = res.data;
    } catch (e) {
      this.showToast('加载任务异常：' + (e.message || e));
      return;
    }
    const results = Array.isArray(task.results) ? task.results : [];
    this.resultPanel = {
      taskId: taskId,
      task: task,
      currentBatchId: results.length ? results[0].batchId : null,
      showAllTracking: false,
      visibleLimit: 500,
    };
    this.renderResultPanel();
  },

  renderResultPanel() {
    const rp = this.resultPanel;
    if (!rp) return;
    const existing = document.getElementById('aiworkflowResultModal');
    if (existing) existing.remove();

    const taskName = this.escapeHtml(rp.task.name || '未命名任务');
    const totalBatches = (rp.task.results || []).length;
    const taskType = this.escapeHtml(rp.task.type || 'batch');

    // Task 14: 批量任务工具栏增加"微调选择器"按钮 + 选择器历史下拉
    let batchTuneHtml = '';
    if (rp.task.type === 'batch') {
      batchTuneHtml += `<button class="task-action-btn" id="resultTuneSelectorBtn" title="重新拾取 CSS 选择器">✎ 微调选择器</button>`;
      const history = Array.isArray(rp.task.config?.selectorHistory) ? rp.task.config.selectorHistory : [];
      if (history.length) {
        const currentSel = rp.task.config?.selector || '';
        const opts = history.map((s, i) => {
          const trunc = (s || '').length > 40 ? (s.slice(0, 40) + '…') : (s || '');
          const sel = s === currentSel ? 'selected' : '';
          return `<option value="${this.escapeHtml(s)}" ${sel}>[${i + 1}] ${this.escapeHtml(trunc)}</option>`;
        }).join('');
        batchTuneHtml += `<select id="resultSelectorHistory" title="选择器历史（切换后重新运行查看效果）">${opts}</select>`;
      }
    }

    // Task 21.3/21.4: AI 分类（仅 batch）+ AI 摘要（所有类型）按钮
    let aiButtonsHtml = '<button class="task-action-btn" id="resultAiSummarizeBtn" title="用 AI 生成结果摘要">🤖 AI 摘要</button>';
    if (rp.task.type === 'batch') {
      aiButtonsHtml = '<button class="task-action-btn" id="resultAiClassifyBtn" title="用 AI 对结果分类">🤖 AI 分类</button>' + aiButtonsHtml;
    }

    const modal = document.createElement('div');
    modal.id = 'aiworkflowResultModal';
    modal.className = 'aiworkflow-modal';
    modal.innerHTML = `
      <div class="aiworkflow-modal-content result-panel">
        <div class="result-panel-sidebar">
          <div class="result-panel-sidebar-header">批次（${totalBatches}）</div>
          <div id="resultBatchList"></div>
        </div>
        <div class="result-panel-main">
          <div class="result-panel-toolbar">
            <div class="result-panel-title" title="${taskName}">${taskName} <span class="task-type-badge ${taskType}" style="margin-left:6px;">${taskType}</span> · 共 ${totalBatches} 批</div>
            <div class="result-panel-actions">
              ${batchTuneHtml}
              ${aiButtonsHtml}
              <select id="resultExportFormat" title="导出格式">
                <option value="txt">TXT</option>
                <option value="json">JSON</option>
                <option value="md">MD</option>
                <option value="csv">CSV</option>
              </select>
              <button class="task-action-btn" id="resultExportCurrentBtn" title="导出当前选中批次">📥 导出当前</button>
              <button class="task-action-btn" id="resultExportAllBtn" title="导出全部批次">📥 导出全部</button>
              <button class="task-action-btn" id="resultCloseBtn">✕ 关闭</button>
            </div>
          </div>
          <div class="result-panel-detail" id="resultDetail"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeResultPanel();
    });
    modal.querySelector('#resultCloseBtn').addEventListener('click', () => this.closeResultPanel());
    modal.querySelector('#resultExportCurrentBtn').addEventListener('click', () => this.exportFromPanel(false));
    modal.querySelector('#resultExportAllBtn').addEventListener('click', () => this.exportFromPanel(true));
    // Task 14: 绑定微调选择器按钮与历史下拉
    const tuneSelBtn = modal.querySelector('#resultTuneSelectorBtn');
    if (tuneSelBtn) tuneSelBtn.addEventListener('click', () => this.tuneBatchSelector(rp.taskId));
    const histSel = modal.querySelector('#resultSelectorHistory');
    if (histSel) histSel.addEventListener('change', (e) => this.applyBatchSelectorHistory(rp.taskId, e.target.value));
    // Task 21.3/21.4: 绑定 AI 分类 / AI 摘要按钮
    const aiClassifyBtn = modal.querySelector('#resultAiClassifyBtn');
    if (aiClassifyBtn) aiClassifyBtn.addEventListener('click', () => this.aiClassifyResults());
    const aiSummarizeBtn = modal.querySelector('#resultAiSummarizeBtn');
    if (aiSummarizeBtn) aiSummarizeBtn.addEventListener('click', () => this.aiSummarizeResults());

    this.renderBatchList();
    this.renderBatchDetail();
  },

  renderBatchList() {
    const rp = this.resultPanel;
    if (!rp) return;
    const container = document.getElementById('resultBatchList');
    if (!container) return;
    const results = Array.isArray(rp.task.results) ? rp.task.results : [];
    if (!results.length) {
      container.innerHTML = '<div class="result-empty">暂无批次</div>';
      return;
    }
    // 按 runAt 倒序
    const sorted = [...results].sort((a, b) => new Date(b.runAt || 0) - new Date(a.runAt || 0));
    container.innerHTML = sorted.map(b => {
      const bid = this.escapeHtml(String(b.batchId ?? ''));
      const active = b.batchId === rp.currentBatchId ? 'active' : '';
      const time = this.escapeHtml(this.formatTime(b.runAt));
      const count = Number(b.count || (b.items ? b.items.length : 0));
      let badges = '';
      if (b.isBaseline) badges += ' <span class="baseline-badge">基线</span>';
      if (b.newCount !== undefined) badges += ` <span style="color:var(--success);font-size:10px;">新增 ${b.newCount}</span>`;
      return `
        <div class="batch-list-item ${active}" data-bid="${bid}">
          <div class="batch-list-item-row">
            <span class="batch-list-item-time">${time}</span>
            <button class="batch-list-item-del" data-del="${bid}" title="删除批次">✕</button>
          </div>
          <div class="batch-list-item-count">${count} 条${badges}</div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.batch-list-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.dataset && e.target.dataset.del) return;
        this.selectBatch(el.dataset.bid);
      });
    });
    container.querySelectorAll('.batch-list-item-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteBatch(btn.dataset.del);
      });
    });
  },

  selectBatch(batchId) {
    const rp = this.resultPanel;
    if (!rp) return;
    rp.currentBatchId = batchId;
    rp.visibleLimit = 500;
    this.renderBatchList();
    this.renderBatchDetail();
  },

  async deleteBatch(batchId) {
    const rp = this.resultPanel;
    if (!rp || !batchId) return;
    if (!confirm('确认删除该批次结果？此操作不可撤销。')) return;
    const newResults = (rp.task.results || []).filter(b => b.batchId !== batchId);
    try {
      const res = await window.electronAPI?.aiworkflowAPI?.update?.(rp.taskId, { results: newResults });
      if (!res?.success) {
        this.showToast('删除批次失败：' + (res?.error || '未知错误'));
        return;
      }
      rp.task.results = newResults;
      if (rp.currentBatchId === batchId) {
        rp.currentBatchId = newResults.length ? newResults[0].batchId : null;
      }
      rp.visibleLimit = 500;
      this.renderBatchList();
      this.renderBatchDetail();
      this.showToast('✓ 已删除批次');
    } catch (e) {
      this.showToast('删除批次异常：' + (e.message || e));
    }
  },

  renderBatchDetail() {
    const rp = this.resultPanel;
    if (!rp) return;
    const container = document.getElementById('resultDetail');
    if (!container) return;
    const results = Array.isArray(rp.task.results) ? rp.task.results : [];
    if (!results.length || !rp.currentBatchId) {
      container.innerHTML = '<div class="result-empty">暂无结果数据</div>';
      return;
    }
    const batch = results.find(b => b.batchId === rp.currentBatchId);
    if (!batch) {
      container.innerHTML = '<div class="result-empty">未找到该批次</div>';
      return;
    }
    const type = rp.task.type;
    const items = Array.isArray(batch.items) ? batch.items : [];

    let toolbarHtml = `<div class="result-detail-toolbar"><span>批次 ${this.escapeHtml(String(batch.batchId))}</span><span>· ${items.length} 条</span>`;
    if (batch.isBaseline) toolbarHtml += '<span class="baseline-badge">基线</span>';
    if (batch.runAt) toolbarHtml += `<span>· ${this.escapeHtml(this.formatTime(batch.runAt))}</span>`;
    if (type === 'tracking') {
      toolbarHtml += `<label><input type="checkbox" id="resultShowAll" ${rp.showAllTracking ? 'checked' : ''} />显示全部</label>`;
    }
    toolbarHtml += '</div>';

    let bodyHtml = '';
    if (type === 'batch') {
      bodyHtml = this.renderBatchItemsHtml(items, rp);
    } else if (type === 'crosspage') {
      bodyHtml = this.renderCrosspageItemsHtml(items, rp);
    } else if (type === 'tracking') {
      bodyHtml = this.renderTrackingItemsHtml(items, rp);
    } else if (type === 'template') {
      bodyHtml = this.renderTemplateItemsHtml(items, rp);
    } else {
      bodyHtml = '<div class="result-empty">未知任务类型</div>';
    }

    container.innerHTML = toolbarHtml + bodyHtml;

    // 绑定 tracking 显示全部切换
    if (type === 'tracking') {
      const cb = document.getElementById('resultShowAll');
      if (cb) cb.addEventListener('change', (e) => {
        rp.showAllTracking = e.target.checked;
        rp.visibleLimit = 500;
        this.renderBatchDetail();
      });
    }
    // 绑定加载更多
    const lm = document.getElementById('resultLoadMore');
    if (lm) lm.addEventListener('click', () => {
      rp.visibleLimit += 500;
      this.renderBatchDetail();
    });
    // 绑定展开按钮
    container.querySelectorAll('.result-tree-expand').forEach(btn => {
      btn.addEventListener('click', () => {
        const wrapper = btn.closest('.result-tree-item-content');
        const span = wrapper ? wrapper.querySelector('.result-tree-item-text') : null;
        if (!span) return;
        if (btn.dataset.expanded === '1') {
          span.textContent = span.dataset.short || '';
          btn.textContent = '展开';
          btn.dataset.expanded = '0';
        } else {
          span.dataset.short = span.textContent;
          span.textContent = span.dataset.full || '';
          btn.textContent = '收起';
          btn.dataset.expanded = '1';
        }
      });
    });
  },

  // batch 类型：树形展示 + groupKey 分组
  renderBatchItemsHtml(items, rp) {
    if (!items.length) return '<div class="result-empty">无条目</div>';
    const hasGroups = items.some(it => it.groupKey && it.groupKey !== 'default');
    const limit = rp.visibleLimit || 500;
    let html = '';
    if (hasGroups) {
      const groups = {};
      const groupOrder = [];
      items.forEach(it => {
        const gk = it.groupKey || 'default';
        if (!groups[gk]) { groups[gk] = []; groupOrder.push(gk); }
        groups[gk].push(it);
      });
      let rendered = 0;
      for (const gk of groupOrder) {
        if (rendered >= limit) break;
        html += `<div class="result-group"><div class="result-group-header">📁 ${this.escapeHtml(gk)} (${groups[gk].length})</div>`;
        html += this.renderBatchTreeHtml(groups[gk], limit - rendered);
        rendered += groups[gk].length;
        html += '</div>';
      }
      if (items.length > limit) {
        html += `<div class="result-truncated-note">已显示 ${Math.min(limit, items.length)} / ${items.length} 条</div>`;
        html += `<button class="result-load-more" id="resultLoadMore">加载更多</button>`;
      }
    } else {
      html = this.renderBatchTreeHtml(items, limit);
      if (items.length > limit) {
        html += `<div class="result-truncated-note">已显示 ${Math.min(limit, items.length)} / ${items.length} 条</div>`;
        html += `<button class="result-load-more" id="resultLoadMore">加载更多</button>`;
      }
    }
    return html;
  },

  // 按 parentId 递归渲染嵌套树
  renderBatchTreeHtml(items, limit) {
    const map = new Map();
    items.forEach(it => map.set(it.id, it));
    const childrenMap = new Map();
    const roots = [];
    items.forEach(it => {
      const pid = it.parentId;
      if (pid && map.has(pid)) {
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid).push(it);
      } else {
        roots.push(it);
      }
    });
    let counter = 0;
    let truncated = false;
    const renderNode = (item, depth) => {
      if (counter >= limit) { truncated = true; return ''; }
      if (depth > 50) return ''; // 防止异常深递归
      counter++;
      const kids = childrenMap.get(item.id) || [];
      const full = item.textContent || item.innerText || '';
      const short = full.length > 200 ? full.slice(0, 200) + '…' : full;
      const showExpand = full.length > 200;
      let meta = `level ${item.level || 0}`;
      if (item.parentId) meta += ` · 父 ${this.escapeHtml(String(item.parentId))}`;
      if (item.tagName) meta += ` · <${this.escapeHtml(item.tagName)}>`;
      // 提取 href（优先 item.href，回退到 attributes.href）
      const href = item.href || (item.attributes && item.attributes.href) || '';
      if (href) meta += ` · 🔗 ${this.escapeHtml(href)}`;
      let html = `<li class="result-tree-item"><div class="result-tree-item-content"><span class="result-tree-item-text" data-full="${this.escapeHtml(full)}">${this.escapeHtml(short)}</span>`;
      if (showExpand) html += `<button class="result-tree-expand" data-expanded="0">展开</button>`;
      html += `</div><div class="result-tree-item-meta">${this.escapeHtml(meta)}</div>`;
      // 显示子链接（超链接）
      if (Array.isArray(item.childLinks) && item.childLinks.length > 0) {
        html += '<ul class="result-tree-child-links" style="margin:2px 0 4px 12px;padding:0;list-style:none;">';
        for (const cl of item.childLinks) {
          const clHref = this.escapeHtml(cl.href || '');
          const clText = this.escapeHtml((cl.text || '').slice(0, 60));
          html += `<li style="font-size:10px;color:var(--text2);padding:1px 0;">↳ <a href="${clHref}" target="_blank" style="color:var(--primary);text-decoration:none;">${clText}</a> <span style="word-break:break-all;">${clHref}</span></li>`;
        }
        html += '</ul>';
      }
      if (kids.length) {
        html += '<ul class="result-tree">';
        for (const k of kids) {
          html += renderNode(k, depth + 1);
          if (truncated) break;
        }
        html += '</ul>';
      }
      html += '</li>';
      return html;
    };
    let html = '<ul class="result-tree">';
    for (const r of roots) {
      if (truncated) break;
      html += renderNode(r, 0);
    }
    html += '</ul>';
    return html;
  },

  // template 类型（末端抓取）：按 sourceUrl 分组，每个 URL 下展示各字段的 values
  // 多 URL 批量结果：每个 item = { sourceUrl, pageTitle, fields: { [name]: { values, extractType, count } }, missing, error? }
  renderTemplateItemsHtml(items, rp) {
    if (!items.length) return '<div class="result-empty">无条目</div>';
    const limit = rp.visibleLimit || 500;
    const groups = {};
    const groupOrder = [];
    items.forEach(it => {
      const url = it.sourceUrl || '(无 URL)';
      if (!groups[url]) { groups[url] = []; groupOrder.push(url); }
      groups[url].push(it);
    });
    let html = '';
    let rendered = 0;
    for (const url of groupOrder) {
      if (rendered >= limit) break;
      const groupItems = groups[url];
      html += `<details class="result-group" open><summary class="result-group-header">🌐 ${this.escapeHtml(url)} (${groupItems.length})</summary>`;
      for (const it of groupItems) {
        if (rendered >= limit) break;
        rendered++;
        if (it.error) {
          html += `<div class="result-tree-item"><div class="result-tree-item-content"><span class="result-tree-item-text" style="color:var(--danger);">⚠ 错误：${this.escapeHtml(it.error)}</span></div></div>`;
          continue;
        }
        if (it.pageTitle) {
          html += `<div class="result-tree-item"><div class="result-tree-item-content"><span class="result-tree-item-text" style="color:var(--text2);font-size:11px;">📄 ${this.escapeHtml(it.pageTitle)}</span></div></div>`;
        }
        const fields = it.fields || {};
        const keys = Object.keys(fields);
        if (!keys.length) {
          html += '<div class="result-tree-item"><div class="result-tree-item-content"><span class="result-tree-item-text" style="color:var(--text2);">(无字段数据)</span></div></div>';
          continue;
        }
        html += '<table class="result-field-table">';
        keys.forEach(k => {
          const fv = fields[k];
          const extType = (fv && fv.extractType) || 'text';
          const cnt = (fv && fv.count != null) ? fv.count : 0;
          const vals = (fv && Array.isArray(fv.values)) ? fv.values : [];
          let vHtml = '';
          if (!vals.length) {
            vHtml = '<span style="color:var(--text2);">(空)</span>';
          } else if (vals.length === 1) {
            const v = String(vals[0]);
            const vShort = v.length > 300 ? v.slice(0, 300) + '…' : v;
            vHtml = this.escapeHtml(vShort);
          } else {
            vHtml = `<span style="color:var(--text2);font-size:11px;">${cnt} 个：</span><ul style="margin:2px 0 2px 14px;padding:0;list-style:none;">`;
            const maxShow = Math.min(vals.length, 10);
            for (let i = 0; i < maxShow; i++) {
              const v = String(vals[i]);
              const vShort = v.length > 200 ? v.slice(0, 200) + '…' : v;
              vHtml += `<li style="font-size:11px;">• ${this.escapeHtml(vShort)}</li>`;
            }
            if (vals.length > maxShow) {
              vHtml += `<li style="font-size:11px;color:var(--text2);">...还有 ${vals.length - maxShow} 个</li>`;
            }
            vHtml += '</ul>';
          }
          html += `<tr><td style="white-space:nowrap;">${this.escapeHtml(k)}<div style="font-size:10px;color:var(--text2);">${this.escapeHtml(extType)}</div></td><td>${vHtml}</td></tr>`;
        });
        html += '</table>';
        if (Array.isArray(it.missing) && it.missing.length) {
          html += `<div style="font-size:11px;color:var(--warning);margin:2px 0;">⚠ 缺失字段：${this.escapeHtml(it.missing.join(', '))}</div>`;
        }
      }
      html += '</details>';
    }
    if (items.length > limit) {
      html += `<div class="result-truncated-note">已显示 ${Math.min(limit, items.length)} / ${items.length} 条</div>`;
      html += `<button class="result-load-more" id="resultLoadMore">加载更多</button>`;
    }
    return html;
  },

  // crosspage 类型：按 sourceUrl 分组折叠面板
  // Task 13: 分组顶部显示"微调此页面"按钮，被微调的分组显示"已微调"徽章 + "重置微调"按钮
  renderCrosspageItemsHtml(items, rp) {
    if (!items.length) return '<div class="result-empty">无条目</div>';
    const taskId = rp && rp.taskId ? String(rp.taskId) : '';
    const overrides = (rp && rp.task && Array.isArray(rp.task.config?.overrides)) ? rp.task.config.overrides : [];
    const groups = {};
    const groupOrder = [];
    items.forEach(it => {
      const url = it.sourceUrl || '(无 URL)';
      if (!groups[url]) { groups[url] = []; groupOrder.push(url); }
      groups[url].push(it);
    });
    let html = '';
    groupOrder.forEach(url => {
      const groupItems = groups[url];
      // Task 13.5: 以 config.overrides 为权威来源判断是否已微调（比 item.overridden 更可靠）
      const overrideEntry = overrides.find(o => o.url === url);
      const isTuned = !!(overrideEntry && overrideEntry.fieldOverrides && Object.keys(overrideEntry.fieldOverrides).length);
      const badge = isTuned ? '<span class="tuned-badge">已微调</span>' : '';
      // 将 URL 编码为可安全嵌入 onclick 双引号属性的 JS 字符串字面量
      const urlJsLiteral = this.escapeHtml(JSON.stringify(url));
      // 重置按钮仅在已微调时显示
      const resetBtn = isTuned
        ? `<button class="task-action-btn tune-btn" style="margin-left:6px;padding:2px 8px;font-size:11px;" onclick="AIWorkflow.resetCrosspageOverride('${this.escapeHtml(taskId)}', ${urlJsLiteral})">↺ 重置微调</button>`
        : '';
      // Task 13.1: 微调此页面按钮
      const tuneBtn = `<button class="task-action-btn tune-btn" style="margin-left:6px;padding:2px 8px;font-size:11px;" onclick="AIWorkflow.tuneCrosspagePage('${this.escapeHtml(taskId)}', ${urlJsLiteral})">✎ 微调此页面</button>`;
      html += `<details class="result-group" open><summary class="result-group-header">🌐 ${this.escapeHtml(url)} (${groupItems.length}) ${badge}${tuneBtn}${resetBtn}</summary>`;
      groupItems.forEach(it => {
        if (it.error) {
          html += `<div class="result-tree-item"><div class="result-tree-item-content"><span class="result-tree-item-text" style="color:var(--danger);">⚠ 错误：${this.escapeHtml(it.error)}</span></div></div>`;
          return;
        }
        const fields = it.fields || {};
        const keys = Object.keys(fields);
        if (!keys.length) {
          html += '<div class="result-tree-item"><div class="result-tree-item-content"><span class="result-tree-item-text" style="color:var(--text2);">(无字段数据)</span></div></div>';
          return;
        }
        html += '<table class="result-field-table">';
        keys.forEach(k => {
          const v = fields[k] == null ? '' : String(fields[k]);
          const vShort = v.length > 300 ? v.slice(0, 300) + '…' : v;
          html += `<tr><td>${this.escapeHtml(k)}</td><td>${this.escapeHtml(vShort)}</td></tr>`;
        });
        html += '</table>';
      });
      html += '</details>';
    });
    return html;
  },

  // tracking 类型：默认仅显示新增，可切换显示全部
  renderTrackingItemsHtml(items, rp) {
    if (!items.length) return '<div class="result-empty">无条目</div>';
    const showAll = rp.showAllTracking;
    let filtered = items;
    if (!showAll) {
      filtered = items.filter(it => it.isNew);
    }
    if (!filtered.length) {
      return `<div class="result-empty">${showAll ? '无条目' : '本批次无新增条目（可勾选"显示全部"查看所有条目）'}</div>`;
    }
    const limit = rp.visibleLimit || 500;
    const shown = filtered.slice(0, limit);
    let html = '<ul class="result-tree">';
    shown.forEach(it => {
      const isNew = it.isNew;
      const badge = isNew ? '<span class="new-badge">🆕 新增</span>' : '';
      let meta = '';
      if (it.detectedAt) meta += `检测于 ${this.escapeHtml(this.formatTime(it.detectedAt))}`;
      if (it.id) meta += (meta ? ' · ' : '') + `ID: ${this.escapeHtml(String(it.id))}`;
      const full = it.textContent || '';
      const short = full.length > 200 ? full.slice(0, 200) + '…' : full;
      const showExpand = full.length > 200;
      html += `<li class="result-tree-item"><div class="result-tree-item-content"><span class="result-tree-item-text" data-full="${this.escapeHtml(full)}">${this.escapeHtml(short)}</span>${badge}${showExpand ? '<button class="result-tree-expand" data-expanded="0">展开</button>' : ''}</div>`;
      if (meta) html += `<div class="result-tree-item-meta">${this.escapeHtml(meta)}</div>`;
      html += '</li>';
    });
    html += '</ul>';
    if (filtered.length > limit) {
      html += `<div class="result-truncated-note">已显示 ${limit} / ${filtered.length} 条</div>`;
      html += `<button class="result-load-more" id="resultLoadMore">加载更多</button>`;
    }
    return html;
  },

  // ===== Task 11: 导出按钮调用 =====
  async exportFromPanel(allBatches) {
    const rp = this.resultPanel;
    if (!rp) return;
    const formatSel = document.getElementById('resultExportFormat');
    const format = formatSel ? formatSel.value : 'txt';
    const batchId = allBatches ? null : rp.currentBatchId;
    if (!allBatches && !batchId) {
      this.showToast('请先选择一个批次，或使用"导出全部"');
      return;
    }
    try {
      const res = await window.electronAPI?.aiworkflowAPI?.exportResults?.(rp.taskId, batchId, format);
      if (res?.success) {
        this.showToast('✓ 已导出到 ' + res.path);
      } else if (res && res.error === '取消') {
        // 用户取消，不提示
      } else {
        this.showToast('导出失败：' + (res?.error || '未知错误'));
      }
    } catch (e) {
      this.showToast('导出异常：' + (e.message || e));
    }
  },

  closeResultPanel() {
    const modal = document.getElementById('aiworkflowResultModal');
    if (modal) modal.remove();
    this.resultPanel = null;
  },

  // ===== Task 13: 跨页面任务字段选择器覆盖 =====

  // SubTask 13.2: 打开微调模态，预填已有 fieldOverrides
  async tuneCrosspagePage(taskId, sourceUrl) {
    if (!taskId || !sourceUrl) return;
    const rp = this.resultPanel;
    let task = (rp && String(rp.taskId) === String(taskId)) ? rp.task : null;
    if (!task) {
      task = this.state.tasks.find(t => String(t.id) === String(taskId));
    }
    if (!task) {
      this.showToast('未找到任务');
      return;
    }
    if (!task.config) task.config = {};
    if (!Array.isArray(task.config.fieldMappings) || !task.config.fieldMappings.length) {
      this.showToast('该任务没有字段映射，无法微调');
      return;
    }
    // 预填：检查是否已有该 URL 的覆盖
    const overrides = Array.isArray(task.config.overrides) ? task.config.overrides : [];
    const existing = overrides.find(o => o.url === sourceUrl);
    const existingFieldOverrides = (existing && existing.fieldOverrides) ? existing.fieldOverrides : {};

    this.crosspageTune = {
      taskId: String(taskId),
      sourceUrl: sourceUrl,
      newSelectors: Object.assign({}, existingFieldOverrides),
    };
    this.renderCrosspageTuneModal();
  },

  // SubTask 13.2: 渲染微调模态
  renderCrosspageTuneModal() {
    const tune = this.crosspageTune;
    if (!tune) return;
    const existing = document.getElementById('aiworkflowTuneModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'aiworkflowTuneModal';
    modal.className = 'aiworkflow-modal';
    modal.innerHTML = `
      <div class="aiworkflow-modal-content" style="max-width:640px;">
        <div class="aiworkflow-modal-header">
          <h3>微调页面字段 - ${this.escapeHtml(tune.sourceUrl)}</h3>
          <button class="aiworkflow-modal-close" onclick="AIWorkflow.closeCrosspageTuneModal()">×</button>
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:8px;">为每个字段重新拾取选择器（可跳过保留默认）。保存后重新运行任务生效。</div>
        <div id="crosspageTuneBody" style="max-height:55vh;overflow-y:auto;"></div>
        <div style="display:flex;justify-content:space-between;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">
          <button class="task-action-btn" id="tuneUseDefaultsBtn" title="清空所有字段的新选择器">全部使用默认</button>
          <div style="display:flex;gap:8px;">
            <button class="task-action-btn" onclick="AIWorkflow.closeCrosspageTuneModal()">取消</button>
            <button class="task-action-btn" style="background:var(--success);color:#fff;border-color:var(--success);" id="tuneSaveBtn">💾 保存微调</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeCrosspageTuneModal();
    });
    modal.querySelector('#tuneUseDefaultsBtn').addEventListener('click', () => {
      tune.newSelectors = {};
      this.renderCrosspageTuneBody();
      this.showToast('已清空所有字段的新选择器，保存后该页面将使用默认选择器');
    });
    modal.querySelector('#tuneSaveBtn').addEventListener('click', () => this.saveCrosspageTune());

    this.renderCrosspageTuneBody();
  },

  // SubTask 13.2: 渲染微调模态主体（可重复调用以刷新）
  renderCrosspageTuneBody() {
    const tune = this.crosspageTune;
    if (!tune) return;
    const body = document.getElementById('crosspageTuneBody');
    if (!body) return;
    const rp = this.resultPanel;
    const task = (rp && String(rp.taskId) === tune.taskId) ? rp.task : null;
    if (!task) {
      body.innerHTML = '<div class="result-empty">任务数据不可用，请关闭后重试</div>';
      return;
    }
    const fieldMappings = Array.isArray(task.config?.fieldMappings) ? task.config.fieldMappings : [];
    const newSelectors = tune.newSelectors || {};

    if (!fieldMappings.length) {
      body.innerHTML = '<div class="result-empty">该任务没有字段映射</div>';
      return;
    }

    body.innerHTML = fieldMappings.map((fm, idx) => {
      const name = fm.name || '(未命名)';
      const defaultSel = fm.selector || '';
      const newSel = newSelectors[fm.name] || '';
      return `
        <div style="padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <strong>${this.escapeHtml(name)}</strong>
            <button class="task-action-btn tune-btn" data-pick-idx="${idx}" style="padding:2px 8px;font-size:11px;white-space:nowrap;">🎯 重新拾取</button>
          </div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px;">默认选择器：<code>${this.escapeHtml(defaultSel) || '(空)'}</code> · 属性：<code>${this.escapeHtml(fm.attr || 'text')}</code></div>
          <input type="text" class="tune-new-sel" data-field="${this.escapeHtml(fm.name)}" value="${this.escapeHtml(newSel)}" placeholder="留空则使用默认选择器，也可手动输入" style="width:100%;box-sizing:border-box;" />
        </div>
      `;
    }).join('');

    // 绑定重新拾取按钮
    body.querySelectorAll('[data-pick-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.pickIdx, 10);
        const fm = fieldMappings[idx];
        if (fm) this.pickCrosspageField(fm.name);
      });
    });
  },

  // SubTask 13.2: 为指定字段触发拾取模式
  pickCrosspageField(fieldName) {
    const tune = this.crosspageTune;
    if (!tune) return;
    this.pickSelector(tune.sourceUrl, (sel) => {
      if (!tune.newSelectors) tune.newSelectors = {};
      tune.newSelectors[fieldName] = sel;
      // 刷新模态主体以显示新选择器
      this.renderCrosspageTuneBody();
    });
  },

  // SubTask 13.2: 保存微调到 task.config.overrides
  async saveCrosspageTune() {
    const tune = this.crosspageTune;
    if (!tune) return;
    const rp = this.resultPanel;
    if (!rp || !rp.task || String(rp.taskId) !== tune.taskId) {
      this.showToast('结果面板已关闭，无法保存');
      this.closeCrosspageTuneModal();
      return;
    }
    const task = rp.task;
    // 从 DOM 读取当前输入值（捕获手动编辑）
    const inputs = document.querySelectorAll('#crosspageTuneBody .tune-new-sel');
    const fieldMappings = Array.isArray(task.config?.fieldMappings) ? task.config.fieldMappings : [];
    const newSelectors = {};
    inputs.forEach(inp => {
      const fieldName = inp.dataset.field;
      const val = (inp.value || '').trim();
      if (!val) return; // 留空 = 使用默认
      const fm = fieldMappings.find(m => m.name === fieldName);
      const defaultSel = fm ? (fm.selector || '') : '';
      if (val !== defaultSel) {
        newSelectors[fieldName] = val;
      }
    });

    if (!task.config) task.config = {};
    if (!Array.isArray(task.config.overrides)) task.config.overrides = [];

    const existingIdx = task.config.overrides.findIndex(o => o.url === tune.sourceUrl);
    if (Object.keys(newSelectors).length === 0) {
      // 无覆盖 - 移除已有条目
      if (existingIdx >= 0) {
        task.config.overrides.splice(existingIdx, 1);
      }
    } else {
      const entry = { url: tune.sourceUrl, fieldOverrides: newSelectors };
      if (existingIdx >= 0) {
        task.config.overrides[existingIdx] = entry;
      } else {
        task.config.overrides.push(entry);
      }
    }

    try {
      const res = await window.electronAPI?.aiworkflowAPI?.update?.(tune.taskId, { config: task.config });
      if (res?.success) {
        this.showToast('✓ 微调已保存，重新运行任务后生效');
        this.closeCrosspageTuneModal();
        // 刷新结果面板以更新徽章/按钮
        this.renderResultPanel();
      } else {
        this.showToast('保存失败：' + (res?.error || '未知错误'));
      }
    } catch (e) {
      this.showToast('保存异常：' + (e.message || e));
    }
  },

  closeCrosspageTuneModal() {
    const modal = document.getElementById('aiworkflowTuneModal');
    if (modal) modal.remove();
    this.crosspageTune = null;
  },

  // SubTask 13.6: 重置某 URL 的字段覆盖
  async resetCrosspageOverride(taskId, sourceUrl) {
    if (!taskId || !sourceUrl) return;
    const rp = this.resultPanel;
    if (!rp || !rp.task || String(rp.taskId) !== String(taskId)) {
      this.showToast('结果面板已关闭，无法重置');
      return;
    }
    const task = rp.task;
    if (!Array.isArray(task.config?.overrides)) {
      this.showToast('该页面未微调，无需重置');
      return;
    }
    const idx = task.config.overrides.findIndex(o => o.url === sourceUrl);
    if (idx < 0) {
      this.showToast('该页面未微调，无需重置');
      return;
    }
    if (!confirm(`确定重置 [${sourceUrl}] 的字段微调？将恢复使用默认选择器。`)) return;
    task.config.overrides.splice(idx, 1);
    try {
      const res = await window.electronAPI?.aiworkflowAPI?.update?.(taskId, { config: task.config });
      if (res?.success) {
        this.showToast('✓ 已重置微调，重新运行任务后生效');
        this.renderResultPanel();
      } else {
        this.showToast('重置失败：' + (res?.error || '未知错误'));
      }
    } catch (e) {
      this.showToast('重置异常：' + (e.message || e));
    }
  },

  // ===== Task 14: 批量抓取任务选择器微调 =====

  // SubTask 14.2: 进入拾取模式重新选择器，新选择器存入 selectorHistory
  async tuneBatchSelector(taskId) {
    if (!taskId) return;
    const rp = this.resultPanel;
    let task = (rp && String(rp.taskId) === String(taskId)) ? rp.task : null;
    // 从服务器加载最新任务
    try {
      const res = await window.electronAPI?.aiworkflowAPI?.getDetail?.(taskId);
      if (res?.success) {
        task = res.data;
        if (rp && String(rp.taskId) === String(taskId)) rp.task = task;
      }
    } catch (e) { /* 使用本地副本 */ }
    if (!task || !task.config || !task.config.url) {
      this.showToast('任务配置缺少 URL，无法微调');
      return;
    }
    if (!confirm('将进入拾取模式重新选择 CSS 选择器。继续？')) return;

    await this.pickSelector(task.config.url, async (newSelector) => {
      if (!newSelector) return;
      // 再次加载最新配置，避免覆盖并发修改
      let latest = task;
      try {
        const res = await window.electronAPI?.aiworkflowAPI?.getDetail?.(taskId);
        if (res?.success) latest = res.data;
      } catch (e) { /* 使用已有副本 */ }
      if (!latest.config) latest.config = {};
      // 初始化 selectorHistory（若不存在则包含当前选择器）
      if (!Array.isArray(latest.config.selectorHistory)) {
        latest.config.selectorHistory = [latest.config.selector];
      }
      // 避免连续重复
      if (latest.config.selectorHistory[latest.config.selectorHistory.length - 1] !== newSelector) {
        latest.config.selectorHistory.push(newSelector);
      }
      latest.config.selector = newSelector;
      try {
        const res = await window.electronAPI?.aiworkflowAPI?.update?.(taskId, { config: latest.config });
        if (res?.success) {
          this.showToast('✓ 选择器已更新，可重新运行任务查看效果');
          if (rp && String(rp.taskId) === String(taskId)) {
            rp.task = latest;
            this.renderResultPanel();
          }
        } else {
          this.showToast('更新失败：' + (res?.error || '未知错误'));
        }
      } catch (e) {
        this.showToast('更新异常：' + (e.message || e));
      }
    });
  },

  // SubTask 14.3: 从历史下拉切换选择器
  async applyBatchSelectorHistory(taskId, selector) {
    if (!taskId || !selector) return;
    const rp = this.resultPanel;
    let task = (rp && String(rp.taskId) === String(taskId)) ? rp.task : null;
    // 从服务器加载最新任务
    try {
      const res = await window.electronAPI?.aiworkflowAPI?.getDetail?.(taskId);
      if (res?.success) {
        task = res.data;
        if (rp && String(rp.taskId) === String(taskId)) rp.task = task;
      }
    } catch (e) { /* 使用本地副本 */ }
    if (!task || !task.config) {
      this.showToast('任务数据不可用');
      return;
    }
    task.config.selector = selector;
    try {
      const res = await window.electronAPI?.aiworkflowAPI?.update?.(taskId, { config: task.config });
      if (res?.success) {
        this.showToast('✓ 已切换选择器，重新运行任务查看效果');
        if (rp && String(rp.taskId) === String(taskId)) {
          this.renderResultPanel();
        }
      } else {
        this.showToast('切换失败：' + (res?.error || '未知错误'));
      }
    } catch (e) {
      this.showToast('切换异常：' + (e.message || e));
    }
  },

  // ===== Task 20.5: AI 配置对话框 =====
  async openAiConfigDialog() {
    // 先尝试读取已保存配置
    let saved = null;
    try {
      const res = await window.electronAPI?.aiConfigAPI?.get?.();
      if (res?.success) saved = res.data;
    } catch (e) { /* ignore */ }

    const existing = document.getElementById('aiConfigModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'aiConfigModal';
    modal.className = 'aiworkflow-modal';
    modal.innerHTML = `
      <div class="aiworkflow-modal-content" style="max-width:520px;">
        <div class="aiworkflow-modal-header">
          <h3>⚙ AI 模型配置</h3>
          <button class="aiworkflow-modal-close" id="aiConfigClose">×</button>
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:14px;">配置 OpenAI 兼容 API（支持 OpenAI / DeepSeek / Moonshot / 通义千问等）。API Key 加密存储。</div>
        <div class="aiworkflow-form-group">
          <label>API 端点</label>
          <input type="text" id="aiCfgEndpoint" placeholder="https://api.openai.com/v1" value="${this.escapeHtml(saved?.endpoint || '')}" />
        </div>
        <div class="aiworkflow-form-group">
          <label>API Key</label>
          <div style="display:flex;gap:6px;">
            <input type="password" id="aiCfgApiKey" placeholder="sk-..." value="${this.escapeHtml(saved?.apiKey || '')}" style="flex:1;" autocomplete="off" />
            <button class="task-action-btn" id="aiCfgToggleKey" type="button" style="white-space:nowrap;">👁</button>
          </div>
          <div style="font-size:11px;color:var(--text2);margin-top:4px;">${saved?.hasKey ? '已保存密钥（显示为脱敏值，留空保存则不变）' : '尚未保存密钥'}</div>
        </div>
        <div class="aiworkflow-form-group">
          <label>模型名</label>
          <input type="text" id="aiCfgModel" placeholder="gpt-4o-mini" value="${this.escapeHtml(saved?.model || '')}" />
        </div>
        <div style="display:flex;gap:12px;">
          <div class="aiworkflow-form-group" style="flex:1;">
            <label>温度（0-2）</label>
            <input type="number" id="aiCfgTemp" min="0" max="2" step="0.1" value="${saved?.temperature ?? 0.7}" />
          </div>
          <div class="aiworkflow-form-group" style="flex:1;">
            <label>最大 Tokens</label>
            <input type="number" id="aiCfgMaxTokens" min="1" step="1" value="${saved?.maxTokens ?? 2048}" />
          </div>
        </div>
        <div id="aiConfigTestResult" style="min-height:24px;font-size:12px;margin-bottom:8px;"></div>
        <div style="display:flex;justify-content:space-between;gap:8px;margin-top:8px;">
          <button class="task-action-btn" id="aiCfgTestBtn">🧪 测试连接</button>
          <div style="display:flex;gap:8px;">
            <button class="task-action-btn" id="aiCfgCancelBtn">取消</button>
            <button class="task-action-btn" style="background:var(--success);color:#fff;border-color:var(--success);" id="aiCfgSaveBtn">💾 保存</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('#aiConfigClose').onclick = closeModal;
    modal.querySelector('#aiCfgCancelBtn').onclick = closeModal;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    // 眼睛切换 API Key 显示
    const keyInput = modal.querySelector('#aiCfgApiKey');
    const toggleBtn = modal.querySelector('#aiCfgToggleKey');
    toggleBtn.addEventListener('click', () => {
      keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
      toggleBtn.textContent = keyInput.type === 'password' ? '👁' : '🙈';
    });

    const getFormConfig = () => {
      const temp = parseFloat(modal.querySelector('#aiCfgTemp').value);
      const maxTokens = parseInt(modal.querySelector('#aiCfgMaxTokens').value, 10);
      return {
        endpoint: modal.querySelector('#aiCfgEndpoint').value.trim(),
        apiKey: keyInput.value.trim(),
        model: modal.querySelector('#aiCfgModel').value.trim(),
        temperature: isNaN(temp) ? 0.7 : Math.max(0, Math.min(2, temp)),
        maxTokens: isNaN(maxTokens) ? 2048 : maxTokens,
      };
    };

    // 测试连接
    modal.querySelector('#aiCfgTestBtn').addEventListener('click', async () => {
      const cfg = getFormConfig();
      const resultEl = modal.querySelector('#aiConfigTestResult');
      const testBtn = modal.querySelector('#aiCfgTestBtn');
      if (!cfg.endpoint || !cfg.model) {
        resultEl.textContent = '⚠ 请填写 API 端点和模型名';
        resultEl.style.color = 'var(--danger)';
        return;
      }
      this.setAiButtonLoading(testBtn, true, '测试中...');
      resultEl.textContent = '⏳ 正在测试连接...';
      resultEl.style.color = 'var(--primary)';
      try {
        const res = await window.electronAPI?.aiConfigAPI?.test?.(cfg);
        if (res?.success) {
          resultEl.innerHTML = '✓ 连接成功' + (res.response ? '：' + this.escapeHtml(res.response.slice(0, 80)) : '');
          resultEl.style.color = 'var(--success)';
        } else {
          resultEl.textContent = '✗ ' + this.aiErrorMessage(res?.error);
          resultEl.style.color = 'var(--danger)';
        }
      } catch (e) {
        resultEl.textContent = '✗ 测试异常：' + (e.message || e);
        resultEl.style.color = 'var(--danger)';
      } finally {
        this.setAiButtonLoading(testBtn, false);
      }
    });

    // 保存
    modal.querySelector('#aiCfgSaveBtn').addEventListener('click', async () => {
      const cfg = getFormConfig();
      if (!cfg.endpoint || !cfg.model) {
        this.showToast('请填写 API 端点和模型名');
        return;
      }
      try {
        const res = await window.electronAPI?.aiConfigAPI?.save?.(cfg);
        if (res?.success) {
          this.showToast('✓ AI 配置已保存');
          closeModal();
        } else {
          this.showToast('保存失败：' + this.aiErrorMessage(res?.error));
        }
      } catch (e) {
        this.showToast('保存异常：' + (e.message || e));
      }
    });
  },

  // ===== Task 21.5: AI 按钮加载态 =====
  setAiButtonLoading(btn, loading, loadingText) {
    if (!btn) return;
    if (loading) {
      if (!btn.dataset._origHtml) btn.dataset._origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.style.cursor = 'wait';
      btn.innerHTML = '⏳ ' + this.escapeHtml(loadingText || 'AI 思考中...');
    } else {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.style.cursor = '';
      if (btn.dataset._origHtml) {
        btn.innerHTML = btn.dataset._origHtml;
        delete btn.dataset._origHtml;
      }
    }
  },

  // 友好错误提示
  aiErrorMessage(err) {
    if (!err) return '未知错误';
    const msg = String(err);
    if (/未配置/.test(msg)) return msg;
    if (/超时|timeout/i.test(msg)) return 'AI 请求超时，请稍后重试';
    if (/401|无效|未授权/.test(msg)) return 'API Key 无效或未授权（401）';
    if (/429|配额|频率/.test(msg)) return 'API 配额不足或请求频率超限（429）';
    if (/403|拒绝访问/.test(msg)) return 'API 拒绝访问（403）';
    if (/网络错误|ECONN|ENOTFOUND|fetch|socket/i.test(msg)) return '网络错误：' + msg;
    if (/5\d{2}/.test(msg)) return 'AI 服务端错误：' + msg;
    return msg;
  },

  // ===== Task 21.1: AI 生成选择器（批量向导步骤2） =====
  async aiGenerateSelector() {
    const wiz = this.state.currentWizard;
    if (!wiz) return;
    const url = (wiz.data.url || '').trim();
    if (!url) {
      this.showToast('请先填写目标页面 URL');
      return;
    }
    const existing = document.getElementById('aiGenSelectorModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'aiGenSelectorModal';
    modal.className = 'aiworkflow-modal';
    modal.innerHTML = `
      <div class="aiworkflow-modal-content" style="max-width:520px;">
        <div class="aiworkflow-modal-header">
          <h3>🤖 AI 生成选择器</h3>
          <button class="aiworkflow-modal-close" id="aiGenSelClose">×</button>
        </div>
        <div class="aiworkflow-form-group">
          <label>描述你想抓取的内容</label>
          <input type="text" id="aiGenSelDesc" placeholder="例如：所有评论 / 文章标题 / 商品价格" />
        </div>
        <div id="aiGenSelCandidates" style="max-height:300px;overflow-y:auto;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
          <button class="task-action-btn" id="aiGenSelCancel">取消</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" id="aiGenSelConfirm">🤖 生成</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('#aiGenSelClose').onclick = closeModal;
    modal.querySelector('#aiGenSelCancel').onclick = closeModal;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    const descInput = modal.querySelector('#aiGenSelDesc');
    descInput.focus();
    const confirmBtn = modal.querySelector('#aiGenSelConfirm');
    const candContainer = modal.querySelector('#aiGenSelCandidates');

    confirmBtn.addEventListener('click', async () => {
      const desc = descInput.value.trim();
      if (!desc) {
        this.showToast('请描述要抓取的内容');
        return;
      }
      this.setAiButtonLoading(confirmBtn, true, 'AI 思考中...');
      candContainer.innerHTML = '<div style="text-align:center;color:var(--text2);padding:20px;">⏳ 正在加载页面并生成选择器...</div>';
      try {
        const res = await window.electronAPI?.aiworkflowAPI?.aiGenerateSelector?.(url, desc);
        if (!res?.success) {
          candContainer.innerHTML = '<div style="color:var(--danger);padding:12px;">✗ ' + this.escapeHtml(this.aiErrorMessage(res?.error)) + '</div>';
          return;
        }
        const candidates = Array.isArray(res.data) ? res.data : [];
        if (!candidates.length) {
          candContainer.innerHTML = '<div style="color:var(--text2);padding:12px;">AI 未返回有效选择器，请尝试更具体的描述</div>';
          return;
        }
        candContainer.innerHTML = candidates.map((c, i) => {
          const sel = this.escapeHtml(c.selector || '');
          const d = this.escapeHtml(c.description || '');
          return `
            <div class="aiworkflow-card-pick-item" data-idx="${i}" style="display:flex;gap:8px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;cursor:pointer;">
              <input type="radio" name="aiGenSelPick" value="${i}" style="width:auto;" />
              <div style="flex:1;overflow:hidden;">
                <div style="font-family:monospace;font-size:12px;color:var(--primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sel}</div>
                <div style="font-size:11px;color:var(--text2);">${d}</div>
              </div>
            </div>
          `;
        }).join('');
        let selectedIdx = 0;
        const radios = candContainer.querySelectorAll('input[name="aiGenSelPick"]');
        if (radios[0]) radios[0].checked = true;
        candContainer.querySelectorAll('.aiworkflow-card-pick-item').forEach(item => {
          item.addEventListener('click', () => {
            selectedIdx = parseInt(item.dataset.idx, 10);
            radios.forEach(r => { r.checked = (parseInt(r.value, 10) === selectedIdx); });
          });
        });
        // 替换确认按钮为"应用选择器"
        this.setAiButtonLoading(confirmBtn, false);
        confirmBtn.textContent = '✓ 应用选择器';
        confirmBtn.onclick = async () => {
          const picked = candidates[selectedIdx];
          if (!picked || !picked.selector) {
            this.showToast('未选择有效选择器');
            return;
          }
          wiz.data.selector = picked.selector;
          closeModal();
          this.renderWizardStep();
          this.showToast('✓ 已填入选择器，正在验证...');
          // 自动触发 testSelector 验证
          setTimeout(() => { try { this.testSelector(); } catch (e) { /* ignore */ } }, 100);
        };
      } catch (e) {
        candContainer.innerHTML = '<div style="color:var(--danger);padding:12px;">✗ 异常：' + this.escapeHtml(e.message || e) + '</div>';
      } finally {
        this.setAiButtonLoading(confirmBtn, false);
      }
    });
  },

  // ===== Task 21.2: AI 推断字段（跨页面向导步骤3） =====
  async aiInferFields() {
    const wiz = this.state.currentWizard;
    if (!wiz || wiz.type !== 'crosspage') {
      this.showToast('请在跨页面字段映射步骤使用此功能');
      return;
    }
    const firstUrl = (wiz.data.urls || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
    if (!firstUrl) {
      this.showToast('请先填写目标页面 URL');
      return;
    }
    // 先同步已有字段映射（避免被覆盖）
    this.syncFieldMappings();
    const existing = document.getElementById('aiInferFieldsModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'aiInferFieldsModal';
    modal.className = 'aiworkflow-modal';
    modal.innerHTML = `
      <div class="aiworkflow-modal-content" style="max-width:480px;">
        <div class="aiworkflow-modal-header">
          <h3>🤖 AI 推断字段映射</h3>
          <button class="aiworkflow-modal-close" id="aiInferClose">×</button>
        </div>
        <div class="aiworkflow-form-group">
          <label>内容描述（可选，帮助 AI 聚焦）</label>
          <input type="text" id="aiInferDesc" placeholder="例如：文章的标题、作者、发布时间、正文" />
        </div>
        <div id="aiInferResult" style="min-height:24px;font-size:12px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
          <button class="task-action-btn" id="aiInferCancel">取消</button>
          <button class="task-action-btn" style="background:var(--primary);color:#fff;border-color:var(--primary);" id="aiInferConfirm">🤖 推断</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('#aiInferClose').onclick = closeModal;
    modal.querySelector('#aiInferCancel').onclick = closeModal;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    const descInput = modal.querySelector('#aiInferDesc');
    const confirmBtn = modal.querySelector('#aiInferConfirm');
    const resultEl = modal.querySelector('#aiInferResult');

    confirmBtn.addEventListener('click', async () => {
      const desc = descInput.value.trim();
      this.setAiButtonLoading(confirmBtn, true, 'AI 思考中...');
      resultEl.textContent = '⏳ 正在加载页面并推断字段...';
      resultEl.style.color = 'var(--primary)';
      try {
        const res = await window.electronAPI?.aiworkflowAPI?.aiInferFields?.(firstUrl, desc);
        if (!res?.success) {
          resultEl.textContent = '✗ ' + this.aiErrorMessage(res?.error);
          resultEl.style.color = 'var(--danger)';
          return;
        }
        const fields = Array.isArray(res.data) ? res.data : [];
        if (!fields.length) {
          resultEl.textContent = 'AI 未返回有效字段映射';
          resultEl.style.color = 'var(--text2)';
          return;
        }
        // 追加到现有字段映射（不覆盖）
        const existingMappings = Array.isArray(wiz.data.fieldMappings) ? wiz.data.fieldMappings : [];
        const seen = new Set(existingMappings.map(f => f.name));
        let added = 0;
        for (const f of fields) {
          const name = (f.fieldName || '').trim();
          if (!name || seen.has(name)) continue;
          seen.add(name);
          existingMappings.push({ name: name, selector: f.selector || '', attr: f.attr || 'text' });
          added++;
        }
        wiz.data.fieldMappings = existingMappings;
        closeModal();
        this.renderWizardStep();
        this.showToast('✓ AI 推断了 ' + added + ' 个字段（已追加到映射表）');
      } catch (e) {
        resultEl.textContent = '✗ 异常：' + (e.message || e);
        resultEl.style.color = 'var(--danger)';
      } finally {
        this.setAiButtonLoading(confirmBtn, false);
      }
    });
  },

  // ===== Task 21.3: AI 分类（批量结果面板） =====
  async aiClassifyResults() {
    const rp = this.resultPanel;
    if (!rp || !rp.taskId) {
      this.showToast('请先打开结果面板');
      return;
    }
    if (rp.task.type !== 'batch') {
      this.showToast('AI 分类仅支持批量抓取结果');
      return;
    }
    const btn = document.getElementById('resultAiClassifyBtn');
    this.setAiButtonLoading(btn, true, 'AI 思考中...');
    try {
      const res = await window.electronAPI?.aiworkflowAPI?.aiClassifyResults?.(rp.taskId, rp.currentBatchId);
      if (!res?.success) {
        this.showToast('✗ ' + this.aiErrorMessage(res?.error));
        return;
      }
      const classifications = Array.isArray(res.data) ? res.data : [];
      const catMap = {};
      classifications.forEach(c => {
        if (c.itemId) catMap[String(c.itemId)] = c.category || '未分类';
      });
      // 重新渲染明细，按 AI 分类分组
      this.renderBatchDetailWithAiCategories(catMap);
      this.showToast('✓ AI 分类完成，共 ' + Object.keys(catMap).length + ' 条');
    } catch (e) {
      this.showToast('✗ 分类异常：' + (e.message || e));
    } finally {
      this.setAiButtonLoading(btn, false);
    }
  },

  // 按 AI 分类重新渲染批量结果明细
  renderBatchDetailWithAiCategories(catMap) {
    const rp = this.resultPanel;
    if (!rp) return;
    const container = document.getElementById('resultDetail');
    if (!container) return;
    const results = Array.isArray(rp.task.results) ? rp.task.results : [];
    const batch = results.find(b => b.batchId === rp.currentBatchId);
    if (!batch) return;
    const items = Array.isArray(batch.items) ? batch.items : [];
    const limit = rp.visibleLimit || 500;

    // 按 category 分组
    const groups = {};
    const groupOrder = [];
    items.forEach((it, idx) => {
      const itemId = String(it.id || ('item_' + idx));
      const cat = catMap[itemId] || '未分类';
      if (!groups[cat]) { groups[cat] = []; groupOrder.push(cat); }
      groups[cat].push(it);
    });

    let html = '<div class="result-detail-toolbar"><span>AI 分类视图</span><span>· ' + items.length + ' 条 · ' + groupOrder.length + ' 个分类</span>';
    html += ' <button class="task-action-btn" id="resultAiClassifyReset" style="padding:2px 8px;font-size:11px;">↺ 退出分类视图</button></div>';

    let rendered = 0;
    for (const cat of groupOrder) {
      if (rendered >= limit) break;
      const groupItems = groups[cat];
      html += `<div class="result-group"><div class="result-group-header">🏷 <span style="background:var(--accent);color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">AI 分类</span> ${this.escapeHtml(cat)} (${groupItems.length})</div>`;
      html += this.renderBatchTreeHtml(groupItems, limit - rendered);
      rendered += groupItems.length;
      html += '</div>';
    }
    if (items.length > limit) {
      html += `<div class="result-truncated-note">已显示 ${Math.min(limit, items.length)} / ${items.length} 条</div>`;
      html += `<button class="result-load-more" id="resultLoadMore">加载更多</button>`;
    }
    container.innerHTML = html;

    const resetBtn = document.getElementById('resultAiClassifyReset');
    if (resetBtn) resetBtn.addEventListener('click', () => this.renderBatchDetail());
    const lm = document.getElementById('resultLoadMore');
    if (lm) lm.addEventListener('click', () => {
      rp.visibleLimit += 500;
      this.renderBatchDetailWithAiCategories(catMap);
    });
    container.querySelectorAll('.result-tree-expand').forEach(b => {
      b.addEventListener('click', () => {
        const wrapper = b.closest('.result-tree-item-content');
        const span = wrapper ? wrapper.querySelector('.result-tree-item-text') : null;
        if (!span) return;
        if (b.dataset.expanded === '1') {
          span.textContent = span.dataset.short || '';
          b.textContent = '展开';
          b.dataset.expanded = '0';
        } else {
          span.dataset.short = span.textContent;
          span.textContent = span.dataset.full || '';
          b.textContent = '收起';
          b.dataset.expanded = '1';
        }
      });
    });
  },

  // ===== Task 21.4: AI 摘要（结果面板，所有任务类型） =====
  async aiSummarizeResults() {
    const rp = this.resultPanel;
    if (!rp || !rp.taskId) {
      this.showToast('请先打开结果面板');
      return;
    }
    const btn = document.getElementById('resultAiSummarizeBtn');
    this.setAiButtonLoading(btn, true, 'AI 思考中...');
    try {
      const res = await window.electronAPI?.aiworkflowAPI?.aiSummarizeResults?.(rp.taskId, rp.currentBatchId);
      if (!res?.success) {
        this.showToast('✗ ' + this.aiErrorMessage(res?.error));
        return;
      }
      const data = res.data || {};
      this.renderAiSummaryCard(data.summary || '', data.itemCount || 0, data.taskType || '');
    } catch (e) {
      this.showToast('✗ 摘要异常：' + (e.message || e));
    } finally {
      this.setAiButtonLoading(btn, false);
    }
  },

  // 渲染 AI 摘要卡片（显示在结果面板顶部，可关闭/复制）
  renderAiSummaryCard(summary, itemCount, taskType) {
    const rp = this.resultPanel;
    if (!rp) return;
    const detail = document.getElementById('resultDetail');
    if (!detail) return;
    // 移除已有摘要卡片
    const oldCard = document.getElementById('aiSummaryCard');
    if (oldCard) oldCard.remove();
    const card = document.createElement('div');
    card.id = 'aiSummaryCard';
    card.style.cssText = 'background:var(--surface2);border:1px solid var(--accent);border-radius:6px;padding:12px;margin-bottom:14px;position:relative;';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <strong style="color:var(--accent);font-size:13px;">🤖 AI 摘要</strong>
        <div style="display:flex;gap:6px;">
          <button class="task-action-btn" id="aiSummaryCopy" style="padding:2px 8px;font-size:11px;">📋 复制</button>
          <button class="task-action-btn" id="aiSummaryClose" style="padding:2px 8px;font-size:11px;">✕ 关闭</button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text);line-height:1.6;white-space:pre-wrap;">${this.escapeHtml(summary)}</div>
      <div style="font-size:10px;color:var(--text2);margin-top:6px;">基于 ${itemCount} 条 ${this.escapeHtml(taskType)} 数据生成</div>
    `;
    detail.insertBefore(card, detail.firstChild);
    card.querySelector('#aiSummaryClose').addEventListener('click', () => card.remove());
    card.querySelector('#aiSummaryCopy').addEventListener('click', () => {
      try {
        navigator.clipboard.writeText(summary).then(() => {
          this.showToast('✓ 摘要已复制到剪贴板');
        }).catch(() => {
          // 降级：用 textarea
          const ta = document.createElement('textarea');
          ta.value = summary;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          this.showToast('✓ 摘要已复制');
        });
      } catch (e) {
        this.showToast('复制失败：' + (e.message || e));
      }
    });
  },

  editTask(taskId) {
    if (!taskId) return;
    const task = this.state.tasks.find(t => String(t.id) === String(taskId));
    if (!task) {
      this.showToast('未找到要编辑的任务');
      return;
    }
    // 复用创建向导，进入编辑模式
    this.openCreateWizard(task.type, task);
  },

  formatTime(iso) {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (e) {
      return String(iso);
    }
  },

  escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  // 复用 App.showToast；若 App 不可用则降级到 alert
  showToast(message) {
    if (typeof App !== 'undefined' && App.showToast) {
      App.showToast(message);
    } else {
      try { console.log('[AIWorkflow]', message); } catch (e) { /* ignore */ }
    }
  },
};

window.AIWorkflow = AIWorkflow;

// 注册追踪更新回调（Task 8）
if (window.electronAPI?.aiworkflowAPI?.onTrackingUpdate) {
  window.electronAPI.aiworkflowAPI.onTrackingUpdate((data) => {
    AIWorkflow.handleTrackingUpdate(data);
  });
}

// 模块加载时若已在 aiworkflow 视图则自动 init
document.addEventListener('DOMContentLoaded', () => {
  // 占位：实际初始化由 App.switchModule('aiworkflow') 触发
});
