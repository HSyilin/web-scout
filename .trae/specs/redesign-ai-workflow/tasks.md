# Tasks

## 阶段一：模块重命名与新模块骨架

- [x] Task 1: 重命名原 "AI 工作流" 模块为 "抓取信息卡片"
  - [x] SubTask 1.1: 修改 `src/renderer/index.html` 第 1618-1621 行 nav-item 的 `aria-label` / `nav-label` 文案为 "抓取信息卡片"，图标改为 🗂️
  - [x] SubTask 1.2: 修改 `src/renderer/index.html` 第 1842 行 `#workflowView` 标题 `<h2>🤖 AI 工作流</h2>` 为 `🗂️ 抓取信息卡片`，描述文字同步调整
  - [x] SubTask 1.3: 修改 `src/renderer/index.html` 第 1895-1899 行仪表盘快速入口的"AI 工作流"文字为"抓取信息卡片"
  - [x] SubTask 1.4: 验证 `workflow.js` 中所有"AI 工作流"字样改为"抓取信息卡片"（搜索并替换，不影响 data-module 键名）
  - [x] SubTask 1.5: 启动应用验证原模块功能（列表加载、右键菜单、删除、导出）正常

- [x] Task 2: 新增 "AI 工作流" 模块骨架
  - [x] SubTask 2.1: 在 `src/renderer/index.html` 导航栏（约第 1622 行后）新增 `<button class="nav-item" data-module="aiworkflow">` 项，图标 🤖，文案"AI 工作流"
  - [x] SubTask 2.2: 在 `src/renderer/index.html` `#workflowView` 之后新增 `<div class="module-view" id="aiworkflowView">`，含 header-bar（标题+新建任务按钮）、子标签栏（批量抓取/跨页面抓取/更新追踪）、任务网格容器、空状态提示
  - [x] SubTask 2.3: 新建 `src/renderer/aiworkflow.css`，沿用 Qt5 风格 CSS 变量（var(--bg)、var(--surface) 等），定义任务卡片、向导弹窗、结果面板样式
  - [x] SubTask 2.4: 新建 `src/renderer/aiworkflow.js`，定义全局对象 `AIWorkflow = { state, init(), loadList(), renderList(), switchTab() }`，state 含 `tasks: []`、`activeTab: 'batch'`、`runningTasks: Set`
  - [x] SubTask 2.5: 在 `src/renderer/index.html` 底部 `<script src="workflow.js">` 后引入 `aiworkflow.js` 与 `aiworkflow.css`（`<link>`）
  - [x] SubTask 2.6: 在 `src/renderer/app.js` 的 `switchModule` 方法（第 469-495 行）增加 `else if (module === 'aiworkflow' && typeof AIWorkflow?.loadList === 'function') AIWorkflow.loadList()` 分支
  - [x] SubTask 2.7: 启动应用验证：点击"AI 工作流"导航能切换到空视图，BrowserView 隐藏，不报错

## 阶段二：数据层与 IPC

- [x] Task 3: 主进程数据目录与 IPC 基础
  - [x] SubTask 3.1: 在 `src/main/index.js` `initDataDirs()`（第 109-113 行）新增 `AIWORKFLOWS_DIR = path.join(DATA_DIR, 'aiworkflows')` 并 mkdirSync
  - [x] SubTask 3.2: 新增 IPC `save-aiworkflow`：接收 task 对象，生成 id（Date.now().toString(36)），写入 `AIWORKFLOWS_DIR/{id}.json`，返回 `{success, id}`
  - [x] SubTask 3.3: 新增 IPC `get-aiworkflows`：读取目录所有 JSON，按 `createdAt` 倒序返回
  - [x] SubTask 3.4: 新增 IPC `get-aiworkflow-detail`：按 id 读取单个任务完整 JSON（含 results）
  - [x] SubTask 3.5: 新增 IPC `delete-aiworkflow`：删除指定 id 的 JSON 文件，并停止该任务若在追踪中
  - [x] SubTask 3.6: 新增 IPC `update-aiworkflow`：部分更新任务字段（如 results、knownIds、lastRunAt、nextCheckAt、active），合并写回
  - [x] SubTask 3.7: 在 `src/preload/index.js` 暴露 `aiworkflowAPI`：`save`、`getAll`、`getDetail`、`delete`、`update` 方法
  - [x] SubTask 3.8: 验证：用 DevTools 调用 `window.electronAPI.aiworkflowAPI.save({...})` 能写入文件

## 阶段三：批量抓取任务（Batch）

- [x] Task 4: 任务创建向导 UI
  - [x] SubTask 4.1: 在 `aiworkflow.js` 实现 `openCreateWizard(type)`：弹出模态向导，根据 type 渲染不同表单
  - [x] SubTask 4.2: 批量抓取向导步骤：① URL 输入框（含"从卡片获取"按钮，见 SubTask 4.5）→ ② "在页面选择元素"按钮（暂用文本输入选择器作为占位，Task 9 接入拾取模式）→ ③ 实时显示选择器输入框 + "测试匹配"按钮 → ④ 分类规则下拉（不分类/按 class/按 data-属性/DOM 位置）+ "保留楼层关系"复选框 → ⑤ 任务名输入 + 保存按钮
  - [x] SubTask 4.3: 实现 `testSelector(url, selector)`：通过隐藏 BrowserView 加载 URL 后注入 `document.querySelectorAll(selector).length` 返回匹配数
  - [x] SubTask 4.4: 实现 `saveTask()`：构造 task 对象 `{type:'batch', name, config:{url, selector, classifyBy, preserveRelations}, results:[], createdAt, lastRunAt:null, status:'idle'}`，调用 `aiworkflowAPI.save` 后刷新列表
  - [x] SubTask 4.5: 实现 `pickUrlFromCards(multiSelect)`：点击"从卡片获取"按钮时调用 `electronAPI.workflowAPI.getAll()` 拉取"抓取信息卡片"列表，弹出选择对话框（显示标题+URL+图标，支持搜索），确认后回填 URL 字段（批量/追踪取首张，跨页面多选追加到 textarea）

- [x] Task 5: 批量抓取执行引擎
  - [x] SubTask 5.1: 在 `src/main/index.js` 新增隐藏 BrowserView 池（最多 3 个复用），用于任务执行时加载页面
  - [x] SubTask 5.2: 新增 IPC `run-aiworkflow-task`：接收 taskId，读取任务配置，加载 URL，注入 JS 提取所有匹配元素（含每个元素的 parentId、level、textContent、attributes、outerHTML 片段）
  - [x] SubTask 5.3: 提取脚本逻辑：对每个匹配元素，向上查找最近的可识别"楼层容器"（带 data-pid/data-parent/comment-id 属性的祖先），记录父子关系；若找不到楼层容器，parentId=null
  - [x] SubTask 5.4: 按 `classifyBy` 规则对结果分组（如按 class：取元素首个 class 作为分组键）
  - [x] SubTask 5.5: 将本次执行结果 `{batchId: timestamp, runAt, items:[...], groups:{}}` 追加到 `task.results`，更新 `lastRunAt`、`status`
  - [x] SubTask 5.6: 在 `aiworkflow.js` 实现 `runTask(taskId)`：调用 IPC，运行中显示加载态，完成后弹通知"批量抓取完成：N 条结果"
  - [x] SubTask 5.7: 验证：在 B 站评论页创建任务，运行后能提取评论列表并保留楼层关系

## 阶段四：跨页面同元素抓取（CrossPage）

- [x] Task 6: 跨页面任务向导与执行
  - [x] SubTask 6.1: 跨页面向导步骤：① 多行 URL 输入框（textarea，含"从卡片获取"按钮支持多选）→ ② 选择器输入 + "在页面选择"按钮 → ③ 字段映射表（动态增删行：字段名 + 子选择器 + 取值属性 text/href/src）→ ④ 任务名 + 保存
  - [x] SubTask 6.2: 在 `run-aiworkflow-task` IPC 中处理 `type='crosspage'`：遍历 URL 列表，并发上限 3，对每个 URL 加载后按字段映射提取；若 `config.overrides` 中存在该 URL 的字段覆盖，使用覆盖选择器
  - [x] SubTask 6.3: 每条结果记录 `{sourceUrl, fields:{ fieldName: value }, overridden: bool}`，整批结果 `{batchId, runAt, items:[...]}`
  - [x] SubTask 6.4: 在 `aiworkflow.js` 结果面板中，跨页面任务按 `sourceUrl` 分组渲染；被微调的分组显示"已微调"徽章
  - [x] SubTask 6.5: 验证：在 3 个相同布局的文章页提取标题与正文，结果按来源分组显示

## 阶段五：更新追踪任务（Tracking）

- [x] Task 7: 追踪任务向导与基线建立
  - [x] SubTask 7.1: 追踪向导步骤：① 目标 URL → ② 条目选择器 + "在页面选择" → ③ 唯一标识字段下拉（自动列出元素的属性，或选择 textContent）→ ④ 轮询间隔（下拉：10分钟/30分钟/1小时/6小时/24小时）→ ⑤ 任务名 + 保存
  - [x] SubTask 7.2: 在 `run-aiworkflow-task` 中处理 `type='tracking'` 首次执行：提取所有条目，取每条的唯一标识存入 `task.knownIds`（Set 转 Array），全部条目存入 `results` 标记 `isNew:false`
  - [x] SubTask 7.3: 任务保存时 `status='tracking'`、`active=true`、`nextCheckAt = now + interval`

- [x] Task 8: 追踪调度器（主进程）
  - [x] SubTask 8.1: 在 `src/main/index.js` 新建 `TrackingScheduler` 对象：`timers: Map<taskId, setTimeout_handle>`、`start(task)`、`stop(taskId)`、`checkAll()`、`tick(taskId)`
  - [x] SubTask 8.2: `tick(taskId)`：读取任务 → 加载 URL → 提取条目 → 与 `knownIds` 比对 → 新增条目追加到 `results` 标记 `isNew:true, detectedAt:now` → 更新 `knownIds` → 通过 `mainWindow.webContents.send('tracking-update', {taskId, newCount})` 通知渲染进程 → 设置下次 `nextCheckAt` 并 `setTimeout` 排程
  - [x] SubTask 8.3: 应用 `ready` 后调用 `TrackingScheduler.checkAll()`：扫描所有 `type=tracking && active=true` 的任务，对 `nextCheckAt <= now` 的立即执行 `tick`，对未来的按差值 `setTimeout`
  - [x] SubTask 8.4: 新增 IPC `pause-tracking(taskId)` / `resume-tracking(taskId)`：设置 `active=false/true` 并 stop/start 定时器
  - [x] SubTask 8.5: 在 `preload/index.js` 暴露 `onTrackingUpdate(callback)`
  - [x] SubTask 8.6: 在 `aiworkflow.js` 注册 `onTrackingUpdate` 回调：刷新任务卡片状态 + 显示应用内通知（顶部 banner，5 秒自动消失）
  - [x] SubTask 8.7: 验证：创建一个 10 分钟间隔的追踪任务，模拟新条目（手动改 knownIds），等待调度触发后能看到通知

## 阶段六：抓取模式拾取选择器

- [x] Task 9: 拾取模式接入
  - [x] SubTask 9.1: 在 `src/renderer/webview-preload.js` 新增"拾取模式"状态：`window.__wsw_picker_mode__`，监听 `ipcRenderer.on('enter-picker-mode')` 进入，`exit-picker-mode` 退出
  - [x] SubTask 9.2: 拾取模式下，点击元素不触发原有 inspect 提取，而是计算该元素的 CSS 选择器（优先 id → 唯一 class → tag+nth-child 路径），调用 `document.querySelectorAll(selector)` 高亮所有匹配元素并显示数量浮层
  - [x] SubTask 9.3: 浮层显示"匹配 N 个元素 [确认] [取消]"，确认后通过 `ipcRenderer.send('picker-result', {selector, sample:{text, html, attrs}})` 回传并退出
  - [x] SubTask 9.4: 在 `src/main/index.js` 新增 IPC `enter-picker-mode`（向当前活动 BrowserView 注入状态）与 `picker-result` 转发到渲染进程
  - [x] SubTask 9.5: 在 `preload/index.js` 暴露 `enterPickerMode()` 与 `onPickerResult(callback)`
  - [x] SubTask 9.6: 在 `aiworkflow.js` 向导中实现 `pickSelector(targetUrl?)`：若 targetUrl 与当前活动标签页 URL 不一致，先提示用户导航到目标页；调用 `enterPickerMode()`，等待 `onPickerResult` 回调填充向导的选择器字段
  - [x] SubTask 9.7: 验证：在向导中点击"在页面选择元素"后切到抓取模块，点击元素高亮匹配项，确认后选择器自动填入向导

## 阶段七：结果查看与导出

- [x] Task 10: 结果面板 UI
  - [x] SubTask 10.1: 在 `aiworkflow.js` 实现 `openResultPanel(taskId)`：弹出全屏模态，左侧批次列表（时间 + 条目数 + 删除批次按钮），右侧明细
  - [x] SubTask 10.2: 批量抓取结果：树形展示（用嵌套 `<ul>`，按 parentId 递归渲染），每条显示 textContent 截断 + 展开
  - [x] SubTask 10.3: 跨页面结果：按 sourceUrl 分组折叠面板，每组列出字段表
  - [x] SubTask 10.4: 追踪结果：默认仅显示 `isNew:true` 条目（带"🆕 新增"徽章），顶部切换"显示全部"
  - [x] SubTask 10.5: 顶部"导出"按钮 + 格式下拉（TXT/JSON/MD/CSV）

- [x] Task 11: 导出实现
  - [x] SubTask 11.1: 在 `src/main/index.js` 新增 IPC `export-aiworkflow-results`：接收 `{taskId, batchId?, format}`，读取任务筛选结果
  - [x] SubTask 11.2: JSON 格式：直接序列化结果数组
  - [x] SubTask 11.3: CSV 格式：批量任务展平为 id/parentId/level/text；跨页面任务展平为 sourceUrl/字段1/字段2；追踪任务展平为 detectedAt/标识/字段
  - [x] SubTask 11.4: MD 格式：批量任务按楼层缩进列表；跨页面按 URL 二级标题；追踪按时间线
  - [x] SubTask 11.5: TXT 格式：简单 `key: value` 行格式
  - [x] SubTask 11.6: 通过 `dialog.showSaveDialogSync` 选择保存路径后写文件
  - [x] SubTask 11.7: 验证：每种任务类型导出 4 种格式，文件可正常打开

## 阶段八：任务管理与卡片交互

- [x] Task 12: 任务卡片完善
  - [x] SubTask 12.1: 任务卡片渲染：任务名、类型徽章（颜色区分：batch=蓝、crosspage=紫、tracking=橙）、状态指示灯（空闲灰/运行中蓝脉冲/追踪中绿）、上次运行时间、结果总数
  - [x] SubTask 12.2: 卡片操作按钮：▶运行、👁查看结果、✎编辑、🗑删除；追踪任务额外显示 ⏸暂停/▶恢复
  - [x] SubTask 12.3: 编辑功能：复用创建向导，预填已有配置，保存调用 `update-aiworkflow`
  - [x] SubTask 12.4: 删除前确认对话框；追踪任务删除时先 `pause-tracking`
  - [x] SubTask 12.5: 空状态：每个子标签在无任务时显示"新建任务"引导按钮
  - [x] SubTask 12.6: 验证：CRUD 操作完整，状态实时更新

## 阶段九：手动微调机制

- [x] Task 13: 跨页面任务字段选择器覆盖
  - [x] SubTask 13.1: 在结果面板的跨页面 sourceUrl 分组顶部添加"✎ 微调此页面"按钮
  - [x] SubTask 13.2: 点击后切换到抓取模块，加载该 sourceUrl，进入拾取模式
  - [x] SubTask 13.3: 拾取模式下逐字段提示用户重新拾取（按字段映射顺序，每字段显示当前选择器与新选择器对比）
  - [x] SubTask 13.4: 用户可跳过某字段（保留默认选择器），也可"全部使用默认"取消微调
  - [x] SubTask 13.5: 确认后将 `{url, fieldOverrides: {字段名: 新选择器}}` 追加到 `task.config.overrides`，调用 `update-aiworkflow` 保存
  - [x] SubTask 13.6: 在 `run-aiworkflow-task` 执行跨页面任务时，按 URL 匹配 overrides，命中则用 `fieldOverrides[fieldName]` 替代默认 `fieldMappings[fieldName].selector`
  - [x] SubTask 13.7: 结果项标记 `overridden: bool`，结果面板对应分组显示"已微调"徽章 + "重置微调"按钮（删除该 URL 的 override 记录）
  - [x] SubTask 13.8: 验证：A 页面 `.title`、B 页面 `.article-title`，微调 B 页面后重新运行，B 页面分组结果正确且带"已微调"徽章

- [x] Task 14: 批量抓取任务选择器微调
  - [x] SubTask 14.1: 在批量任务结果面板（结果为空或条目过少时高亮）添加"✎ 微调选择器"按钮
  - [x] SubTask 14.2: 点击后切换到抓取模块，加载任务 URL，进入拾取模式重新拾取主选择器
  - [x] SubTask 14.3: 拾取后保存为 `config.selectorHistory`（数组，保留历次选择器），当前选择器设为新值
  - [x] SubTask 14.4: 结果面板提供"选择器历史"下拉，可切换回滚到任一历史选择器重新运行
  - [x] SubTask 14.5: 验证：原选择器无结果 → 微调新选择器 → 有结果 → 可回滚到原选择器

## 阶段十：工作流结果回写与跨模块联动

- [x] Task 15: 工作流结果回写抓取信息卡片
  - [x] SubTask 15.1: 在 `src/main/index.js` 的 `run-aiworkflow-task` handler 中，任务执行完成后构造结果卡片对象：`{cardType:'aiworkflow-result', sourceTaskId, sourceTaskType, sourceTaskName, title: 任务名+' '+执行时间, url: 任务URL或跨页面首URL, time: ISO, createdAt: ISO, resources: [...], resourceCount, aiworkflowBatchId}`
  - [x] SubTask 15.2: 结果项 `resources` 适配原 schema：每条 `{type:'text', name: 字段名或条目摘要前30字, content: 完整内容, pageUrl: sourceUrl}`
  - [x] SubTask 15.3: 调用现有 `save-workflow` IPC 逻辑将结果卡片写入 `WORKFLOWS_DIR`（与多媒体卡片同目录），返回卡片 id 关联到 task.results[batchId].cardId
  - [x] SubTask 15.4: 在 `src/renderer/workflow.js` 的 `renderList` 中按 `cardType` 区分：无 cardType 或 `cardType='media'` 显示多媒体徽章；`cardType='aiworkflow-result'` 显示"⚙ 工作流"徽章 + 任务类型小图标
  - [x] SubTask 15.5: 工作流结果卡片的右键菜单额外加"在 AI 工作流打开"项，点击后调用 `App.switchModule('aiworkflow')` 并定位到 sourceTaskId 对应任务
  - [x] SubTask 15.6: 验证：运行任一任务后，"抓取信息卡片"模块出现新卡片且徽章正确；旧多媒体卡片显示不受影响

- [x] Task 16: HT 编辑器 AI 工作流容器
  - [x] SubTask 16.1: 在 `src/renderer/index.html` HT 编辑器工具栏新增"AI 工作流"容器按钮（图标 🤖）
  - [x] SubTask 16.2: 在 `src/renderer/wsw-editor.js` 的 `createCardElement` 新增 `aiworkflow` 分支：渲染容器外框 + 任务下拉 + "▶ 运行"按钮 + 结果预览区
  - [x] SubTask 16.3: 容器配置面板（⚙ 按钮）：任务下拉列表调用 `aiworkflowAPI.getAll()` 按类型分组填充；"立即运行"按钮调用 `run-aiworkflow-task`
  - [x] SubTask 16.4: 容器内"▶ 运行"小按钮：调用 `run-aiworkflow-task`，运行中显示加载态，完成后迷你列表显示条目数 + 前 3 条摘要
  - [x] SubTask 16.5: "查看完整结果"链接调用 `App.switchModule('aiworkflow')` 并打开结果面板
  - [x] SubTask 16.6: 任务删除联动：`delete-aiworkflow` handler 被调用时，通过 `mainWindow.webContents.send('aiworkflow-task-deleted', taskId)` 通知渲染进程；wsw-editor 监听该事件，将关联该 taskId 的容器显示"任务已删除"占位
  - [x] SubTask 16.7: 容器数据持久化到 HT 文档的 `WSW_DATA`：`{type:'aiworkflow', taskId, lastRunAt, lastResultSummary}`
  - [x] SubTask 16.8: 验证：在画布放置 AI 工作流容器，关联任务后点"▶ 运行"，结果在容器内显示；删除任务后容器显示占位

- [x] Task 17: AI 工作流导入抓取记录
  - [x] SubTask 17.1: 在 `#aiworkflowView` 顶部"新建任务"按钮旁新增"从卡片导入"按钮
  - [x] SubTask 17.2: 点击后调用 `workflowAPI.getAll()`（原 `get-workflows` IPC）拉取"抓取信息卡片"列表，弹出选择对话框（显示 cardType 徽章 + 标题 + URL + 时间，支持搜索）
  - [x] SubTask 17.3: 选中卡片后按 cardType 推断：
    - `media`（多媒体）：以卡片 URL 创建批量抓取任务，预填 URL，跳到向导第二步（选择器拾取）
    - `aiworkflow-result`：读取 `sourceTaskId` 的完整 config（调用 `get-aiworkflow-detail`），复用 config 创建同类型新任务，预填所有字段，用户可调整后保存
  - [x] SubTask 17.4: 在跨页面任务创建向导字段映射步骤新增"从卡片导入样例"按钮：选中卡片后将 `resources` 数组作为样例填入字段映射表（自动推断字段名 = resource.name，取值属性 = 'text'）
  - [x] SubTask 17.5: 验证：从多媒体卡片导入能创建批量任务；从工作流结果卡片导入能复用配置；跨页面向导能从卡片资源填字段映射

## 阶段十一：MCP 服务端

- [x] Task 18: MCP 服务端基础设施
  - [x] SubTask 18.1: 在 `package.json` 添加 `@modelcontextprotocol/sdk` 依赖
  - [x] SubTask 18.2: 新建 `src/main/mcp-server.js`，导出 `createMcpServer(opts)` 工厂，返回 MCP server 实例（默认 stdio + 可选 http 模式）
  - [x] SubTask 18.3: 在 `src/main/index.js` 新增 IPC `mcp-toggle`（启动/停止 MCP 服务）、`mcp-status`（查询状态）、`mcp-set-readonly`（开启/关闭写操作工具）
  - [x] SubTask 18.4: 在设置面板（或仪表盘）新增"MCP 服务"开关 + 状态显示 + 接入示例 JSON 片段（供 Claude Desktop 配置复制）
  - [x] SubTask 18.5: 在 `preload/index.js` 暴露 `mcpAPI: {toggle, getStatus, setReadonly}`
  - [x] SubTask 18.6: 验证：开关 MCP 服务后状态正确切换；接入示例可复制

- [x] Task 19: MCP 工具实现
  - [x] SubTask 19.1: 实现 `scrape_page` 工具：参数 `{url, selector?}`，复用现有 BrowserView 池加载 URL，selector 为空时调用 `extractAllResources` 逻辑，否则返回匹配元素
  - [x] SubTask 19.2: 实现 `extract_elements` 工具：参数 `{url, selector, fields?}`，提取匹配元素的指定字段
  - [x] SubTask 19.3: 实现 `list_workflows` 工具：返回所有 AI 工作流任务摘要（id/name/type/status/lastRunAt）
  - [x] SubTask 19.4: 实现 `run_workflow` 工具（需写权限）：参数 `{taskId}`，调用 `run-aiworkflow-task` 逻辑
  - [x] SubTask 19.5: 实现 `create_workflow` 工具（需写权限）：参数 `{type, name, config}`，调用 `save-aiworkflow` 逻辑
  - [x] SubTask 19.6: 实现 `get_workflow_results` 工具：参数 `{taskId, batchId?}`，返回结果
  - [x] SubTask 19.7: 实现 `list_cards` 工具：返回抓取信息卡片列表
  - [x] SubTask 19.8: 实现 `tracking_status` 工具：返回所有追踪任务状态
  - [x] SubTask 19.9: 写权限控制：`run_workflow`/`create_workflow` 工具仅在 readonly=false 时注册
  - [x] SubTask 19.10: 调用日志：每次 MCP 工具调用记录 `{tool, args, timestamp, result}`，内存保留最近 100 条
  - [x] SubTask 19.11: 新增 IPC `mcp-get-logs` 返回调用日志，设置面板显示日志列表
  - [x] SubTask 19.12: 验证：用 Claude Desktop 接入后能列举工具并调用 `list_workflows` 等只读工具

## 阶段十二：AI 工作流接入大模型

- [x] Task 20: 模型配置与连接
  - [x] SubTask 20.1: 在 `src/main/index.js` 新增 IPC `save-ai-config`/`get-ai-config`/`test-ai-config`，配置存到加密存储（沿用 SecurityService 或 AES）
  - [x] SubTask 20.2: 配置字段：`{endpoint, apiKey, model, temperature, maxTokens}`
  - [x] SubTask 20.3: `test-ai-config`：发送一条简单消息验证 API 可用，返回成功/失败与模型回包
  - [x] SubTask 20.4: 在 `preload/index.js` 暴露 `aiConfigAPI`
  - [x] SubTask 20.5: 在 AI 工作流模块设置区添加"配置大模型"按钮与配置对话框（API 端点/Key/模型名/温度/测试连接）
  - [x] SubTask 20.6: 新建 `src/main/ai-helper.js`，封装 `callLLM(messages, opts)` 通用调用函数，供后续 Task 21 使用

- [x] Task 21: AI 辅助功能接入
  - [x] SubTask 21.1: 在批量抓取向导新增"AI 生成选择器"按钮：点击后获取页面 HTML 片段（截断 30KB）+ 用户描述，调用 `callLLM` 让模型返回候选选择器 JSON 数组，向导显示候选列表供选择
  - [x] SubTask 21.2: 在跨页面向导新增"AI 推断字段"按钮：将页面 HTML + 描述发送给模型，返回字段映射建议（字段名+选择器+属性），自动填入字段映射表
  - [x] SubTask 21.3: 在批量抓取结果面板新增"AI 分类"按钮：将结果条目发送给模型，返回分类标签与归属，按 AI 分类重新分组展示（"AI 分类"徽章）
  - [x] SubTask 21.4: 在结果面板新增"AI 摘要"按钮：将结果发送给模型生成摘要，显示在面板顶部，可复制
  - [x] SubTask 21.5: 所有 AI 调用显示加载态，失败时友好提示（API 错误/配额不足等）
  - [x] SubTask 21.6: 验证：配置有效 API 后，4 个 AI 辅助功能均可用

# Task Dependencies
- Task 2 依赖 Task 1（重命名后才能新增模块避免导航混淆）
- Task 3 是所有后续任务的基础（IPC 层）
- Task 4 依赖 Task 2、Task 3
- Task 5 依赖 Task 4（向导先有配置才能执行）
- Task 6 依赖 Task 2、Task 3（与 Task 4/5 可并行）
- Task 7 依赖 Task 2、Task 3（与 Task 4/5/6 可并行）
- Task 8 依赖 Task 7（追踪向导先有配置）
- Task 9 依赖 Task 2、Task 3（拾取模式独立，可与 Task 4-8 并行开发，最后接入向导；Task 13/14 也依赖此）
- Task 10 依赖 Task 5、6、7（需要有结果数据才能展示）
- Task 11 依赖 Task 10
- Task 12 依赖 Task 5、6、7、8（所有任务类型可用后完善卡片）
- Task 13 依赖 Task 6（跨页面执行）、Task 9（拾取模式）、Task 10（结果面板）
- Task 14 依赖 Task 5（批量执行）、Task 9（拾取模式）、Task 10（结果面板）
- Task 15 依赖 Task 5、6、7（任务能执行产生结果）、Task 1（抓取信息卡片模块已就绪）
- Task 16 依赖 Task 3（IPC 层）、Task 5/6/7（任务能执行）
- Task 17 依赖 Task 3（IPC 层）、Task 4/6/7（向导已就绪）、Task 15（工作流结果卡片已能产生）
- Task 18 依赖 Task 3（IPC 层，复用 BrowserView 池需 Task 5 的池实现；可先做无 BrowserView 池的纯任务管理工具，BrowserView 工具待 Task 5 后接入）
- Task 19 依赖 Task 18（MCP 基础设施）、Task 5（scrape_page 复用 BrowserView 池）、Task 3（任务管理 IPC）
- Task 20 独立性强，可与 Task 18/19 并行（仅需 Task 3 完成做 IPC 层）
- Task 21 依赖 Task 20（AI 配置与 callLLM）、Task 4/6（向导已就绪）、Task 10（结果面板）
