# AI 工作流重设计 Spec

## Why
当前 "AI 工作流" 模块实质上只是抓取记录归档器（保存导出过的资源列表），并不具备真正的"工作流"能力。用户需要的是一个能主动批量抓取、追踪更新、跨页面同元素提取的智能工作区。原模块改名"抓取信息卡片"以保留其归档价值，新建一个真正的 "AI 工作流" 模块承载新能力。

## What Changes
- **重命名**：当前 `#workflowView`（data-module=`workflow`）UI 文案 "AI 工作流" → "抓取信息卡片"（保留 data-module 键名 `workflow` 以最小化影响）
- **新增模块**：新增 `data-module="aiworkflow"` 模块 "AI 工作流"，含独立视图 `#aiworkflowView` 与脚本 `aiworkflow.js`
- **新增三类任务**：
  1. **批量抓取任务**（Batch）：在单个页面选定元素后，复数提取所有同类元素，支持按字段分类、保留楼层/父子关系
  2. **跨页面同元素抓取任务**（CrossPage）：给定元素选择器 + URL 列表，从多个相同布局的页面提取同名字段
  3. **更新追踪任务**（Tracking）：给定 Up 主空间/博客 URL 与条目选择器，定期轮询，仅拉取自上次以来新增的条目
- **新增数据层**：`AIWORKFLOWS_DIR = path.join(DATA_DIR, 'aiworkflows')`，每个任务一个 JSON 文件
- **新增 IPC**：`save-aiworkflow` / `get-aiworkflows` / `get-aiworkflow-detail` / `delete-aiworkflow` / `update-aiworkflow` / `run-aiworkflow-task` / `pause-tracking` / `resume-tracking` / `export-aiworkflow-results` / `enter-picker-mode` / `picker-result` / `import-card-to-task`
- **新增主进程调度器**：追踪任务的后台轮询（应用启动时自动恢复活跃追踪）
- **抓取模式联动**：任务创建时通过抓取模式的检查模式在目标页面选择元素，复用 `webview-preload.js` 的 `extractResourcesFromElement`
- **结果查看与导出**：每个任务可查看历次执行结果，支持 TXT/JSON/MD/CSV 导出
- **URL 来源双通道**：所有任务向导 URL 输入支持手动输入或从"抓取信息卡片"模块已有卡片连接获取
- **手动微调机制**：跨页面任务可针对个别页面通过抓取模式重新拾取字段选择器作为覆盖配置；批量任务可微调主选择器并保留历史可回滚
- **工作流结果回写**：AI 工作流每次执行后将结果作为 `cardType:'aiworkflow-result'` 卡片写入 `WORKFLOWS_DIR`，与多媒体卡片（`cardType:'media'`）区分展示
- **HT 编辑器 AI 工作流容器**：新增 `aiworkflow` 容器类型，关联任务后可在画布上快速执行并预览结果
- **AI 工作流导入抓取记录**：支持从"抓取信息卡片"模块导入已有卡片作为新任务配置来源或字段映射样例
- **MCP 服务端**：应用内启动 MCP（Model Context Protocol）服务端，暴露抓取能力为 MCP 工具，供外部 AI 模型（Claude/GPT 等）调用
- **AI 工作流接入大模型**：任务向导与执行流程可选接入大模型 API，用于智能生成选择器、智能字段映射、智能分类、结果摘要等

## Impact
- Affected code:
  - `src/renderer/index.html`（导航栏新增 `aiworkflow` 项 + 新增 `#aiworkflowView` 视图 + 重命名 workflow 文案 + 引入 `aiworkflow.js` + HT 编辑器工具栏新增"AI 工作流"容器按钮）
  - `src/renderer/app.js`（`switchModule` 增加 `aiworkflow` 分支）
  - `src/renderer/aiworkflow.js`（新建：UI 渲染、任务管理、结果展示、导入抓取记录）
  - `src/renderer/aiworkflow.css`（新建：UI 样式，沿用 Qt5 风格变量）
  - `src/main/index.js`（新增 AIWORKFLOWS_DIR、IPC handler、追踪调度器初始化、`run-aiworkflow-task` 执行后回写工作流结果卡片到 `WORKFLOWS_DIR`）
  - `src/preload/index.js`（暴露 `aiworkflowAPI`）
  - `src/renderer/webview-preload.js`（新增"任务选择模式"：选定元素后回传选择器与样例数据，区别于普通检查模式）
  - `src/renderer/workflow.js`（"抓取信息卡片"模块渲染列表时按 `cardType` 区分多媒体卡片与工作流结果卡片，工作流结果卡片右键菜单新增"在 AI 工作流打开"选项）
  - `src/renderer/wsw-editor.js`（新增 `aiworkflow` 容器类型的 `createCardElement` 分支、配置面板、运行按钮、结果预览、任务删除联动）
- 保留不变：原 `workflow` 模块的 IPC（`save-workflow` 等）完全保留；旧多媒体卡片无 `cardType` 字段时默认视为 `media`，向后兼容

## ADDED Requirements

### Requirement: 抓取信息卡片模块（重命名）
系统 SHALL 将原 "AI 工作流" 模块在 UI 上更名为 "抓取信息卡片"，保留其抓取记录归档、资源详情、二次导出、与 HT 编辑器联动等全部既有能力。

#### Scenario: 用户查看导航栏
- **WHEN** 用户打开应用查看左侧导航
- **THEN** 看到"抓取信息卡片"项（图标 🗂️ 或保留 🤖）替代原"AI 工作流"
- **AND** 点击进入后标题显示"抓取信息卡片"，原有工作流列表与右键菜单功能正常

### Requirement: AI 工作流模块入口
系统 SHALL 在左侧导航栏新增 "AI 工作流" 模块入口，点击进入独立的 `#aiworkflowView` 视图。

#### Scenario: 切换到 AI 工作流
- **WHEN** 用户点击导航栏 "AI 工作流" 项
- **THEN** 主内容区切换到 `#aiworkflowView`
- **AND** BrowserView 自动隐藏（与 HT 编辑器、仪表盘一致）
- **AND** 加载已保存的任务列表（按创建时间倒序）

### Requirement: 任务类型分类
系统 SHALL 支持三种任务类型：`batch`（批量抓取）、`crosspage`（跨页面同元素）、`tracking`（更新追踪）。每种类型有独立的创建向导与配置表单。

### Requirement: 批量抓取任务（Batch）
系统 SHALL 允许用户在单个页面选择元素后，提取页面中所有同类元素，并对结果进行分类与关系保留。

#### Scenario: 创建批量抓取任务
- **WHEN** 用户点击"新建任务" → 选择"批量抓取"
- **THEN** 弹出向导：① 输入目标 URL → ② 点击"在页面选择元素"进入抓取模式选定一个样例元素 → ③ 系统自动生成 CSS 选择器并预览匹配数量 → ④ 配置分类规则（按 class / data-* 属性 / DOM 位置 / 不分类）与是否保留楼层关系（父子结构）→ ⑤ 命名并保存

#### Scenario: 立即执行批量抓取
- **WHEN** 用户在任务卡片点击"运行"
- **THEN** 系统在后台 BrowserView 中加载目标 URL
- **AND** 注入选择器提取所有匹配元素
- **AND** 按分类规则聚合并保留楼层关系
- **AND** 结果存入任务的 `results[]`，UI 显示本次执行条目数

#### Scenario: 保留楼层关系
- **GIVEN** 任务配置了 `preserveRelations: true`
- **WHEN** 执行批量抓取
- **THEN** 每条结果记录 `parentId`（父评论 ID）与 `level`（楼层深度）
- **AND** 结果视图以树形缩进展示楼层关系

### Requirement: URL 来源
系统 SHALL 在所有任务创建向导的 URL 输入处提供两种获取方式：① 手动输入；② 从"抓取信息卡片"模块的已有卡片连接获取（弹窗列表选择，回填 URL 与页面标题）。

#### Scenario: 手动输入 URL
- **WHEN** 用户在向导 URL 字段直接输入或粘贴 URL
- **THEN** 系统接受输入并继续向导后续步骤

#### Scenario: 从抓取信息卡片连接 URL
- **WHEN** 用户点击 URL 字段旁的"从卡片获取"按钮
- **THEN** 弹出"抓取信息卡片"列表（显示标题 + URL + 缩略图标），支持搜索筛选
- **AND** 用户选中一张或多张卡片后，URL 列表自动回填（跨页面任务支持多选）
- **AND** 单 URL 任务（批量抓取/追踪）仅取首张卡片 URL

### Requirement: 跨页面同元素抓取任务（CrossPage）
系统 SHALL 允许用户给定元素选择器 + 多个 URL，从多个相同布局的页面提取同名字段。

#### Scenario: 创建跨页面任务
- **WHEN** 用户点击"新建任务" → 选择"跨页面抓取"
- **THEN** 向导：① 输入多个 URL（手动输入或从抓取信息卡片连接）→ ② 输入 CSS 选择器（支持从抓取模式拾取）→ ③ 配置字段映射（如标题=`.title`、链接=`a.href`）→ ④ 命名保存

#### Scenario: 执行跨页面抓取
- **WHEN** 用户点击"运行"
- **THEN** 系统依次（或并发上限 3）加载每个 URL
- **AND** 对每个页面应用同一选择器提取字段
- **AND** 每条结果记录 `sourceUrl`，UI 按来源分组展示

### Requirement: 手动微调机制（字段选择器覆盖）
系统 SHALL 允许用户在跨页面任务运行后，针对个别页面（A 页面与 B 页面同语义元素选择器不同的情况）通过抓取模式重新拾取该页面的字段选择器，作为该 URL 的覆盖配置。

#### Scenario: 发现某页面抓取内容不对
- **GIVEN** 跨页面任务已运行，结果面板按 sourceUrl 分组展示
- **WHEN** 用户发现某个 sourceUrl 分组的结果为空或字段错误
- **THEN** 用户点击该分组顶部的"✎ 微调此页面"按钮
- **AND** 系统进入抓取模式并加载该 sourceUrl
- **AND** 用户按字段映射逐个重新拾取选择器（如重新选 `.article-title` 替代默认 `.title`）
- **AND** 确认后将覆盖配置 `{url, fieldOverrides: {字段名: 新选择器}}` 存入 `task.config.overrides[]`

#### Scenario: 应用覆盖配置重新运行
- **GIVEN** 任务 `config.overrides` 中存在某 URL 的字段覆盖
- **WHEN** 任务执行到该 URL 时
- **THEN** 优先使用 `overrides` 中的字段选择器，而非默认选择器
- **AND** 其他未覆盖的 URL 仍使用默认选择器
- **AND** 结果面板中该 URL 分组标记"已微调"徽章

#### Scenario: 微调入口的通用性
- **WHEN** 用户在批量抓取任务结果为空时
- **THEN** 同样提供"✎ 微调选择器"入口，重新进入抓取模式拾取该任务 URL 的新选择器
- **AND** 微调结果作为 `config.selector` 的新候选保存，可回滚到原选择器

### Requirement: 更新追踪任务（Tracking）
系统 SHALL 允许用户给定 Up 主空间/博客 URL 与条目选择器，定期轮询页面，仅拉取新增条目。

#### Scenario: 创建追踪任务
- **WHEN** 用户点击"新建任务" → 选择"更新追踪"
- **THEN** 向导：① 输入目标 URL → ② 选择条目选择器（从抓取模式拾取）→ ③ 选择唯一标识字段（如链接 href 或 data-id）作为去重键 → ④ 配置轮询间隔（最短 10 分钟，最长 24 小时）→ ⑤ 命名保存

#### Scenario: 首次执行追踪
- **WHEN** 任务首次运行
- **THEN** 系统抓取当前所有条目作为基线存入 `knownIds`
- **AND** 全部条目作为首次结果存档，标记 `isNew: false`

#### Scenario: 检测到更新
- **GIVEN** 任务已运行过至少一次
- **WHEN** 调度器触发轮询
- **THEN** 系统提取当前条目，与 `knownIds` 比对
- **AND** 仅将新出现的条目追加到 `results[]`，标记 `isNew: true` 与 `detectedAt` 时间戳
- **AND** 更新 `knownIds`
- **AND** 通过应用内通知（非系统通知）提醒用户"追踪任务 [名称] 发现 N 条更新"

#### Scenario: 应用重启后恢复追踪
- **WHEN** 应用启动
- **THEN** 主进程读取所有 `type=tracking` 且 `active=true` 的任务
- **AND** 按 `nextCheckAt` 恢复定时器
- **AND** 错过的轮询不补执行，按当前时间重新调度

### Requirement: 任务列表与卡片
系统 SHALL 在 `#aiworkflowView` 顶部显示三个子标签（批量抓取 / 跨页面抓取 / 更新追踪），每个子标签下以卡片网格展示对应类型的任务。

#### Scenario: 任务卡片信息
- **WHEN** 渲染任务卡片
- **THEN** 卡片显示：任务名、类型徽章、状态（空闲/运行中/追踪中）、上次运行时间、结果总数
- **AND** 卡片操作按钮：运行、查看结果、编辑、删除、（仅追踪任务）暂停/恢复

### Requirement: 结果查看与导出
系统 SHALL 为每个任务提供结果查看面板，支持按执行批次或时间筛选，并导出为 TXT/JSON/MD/CSV。

#### Scenario: 查看结果
- **WHEN** 用户点击任务卡片"查看结果"
- **THEN** 弹出结果面板，左侧为执行批次列表（时间 + 条目数），右侧为该批次的结果明细
- **AND** 批量抓取任务按楼层关系树形展示
- **AND** 跨页面任务按来源 URL 分组展示
- **AND** 追踪任务仅显示 `isNew: true` 的更新条目（可切换"显示全部"）

#### Scenario: 导出结果
- **WHEN** 用户在结果面板点击"导出"
- **THEN** 弹出系统保存对话框，可选 TXT/JSON/MD/CSV
- **AND** 仅导出当前筛选范围内（如某批次或全部更新）的结果

### Requirement: 抓取模式拾取选择器
系统 SHALL 在任务创建向导中提供"在页面选择元素"按钮，进入抓取模式的"选择器拾取"子模式，用户点击元素后回传该元素的 CSS 选择器与样例数据。

#### Scenario: 拾取选择器
- **WHEN** 用户在向导中点击"在页面选择元素"
- **THEN** 切换到抓取模块并进入拾取模式
- **AND** 用户点击目标元素后，高亮显示同选择器匹配的所有元素并显示数量
- **AND** 用户确认后回传选择器字符串与样例数据到向导
- **AND** 退出拾取模式返回向导

### Requirement: 敏感数据与安全
系统 SHALL 遵循现有安全约定：追踪任务的轮询 URL 与结果中若含敏感信息，按现有 SecurityService 处理；任务文件存储在用户数据目录下，不外传。

### Requirement: 工作流结果回写抓取信息卡片
系统 SHALL 在 AI 工作流任务每次执行后，将本次结果作为一张"工作流结果卡片"保存到"抓取信息卡片"模块（`WORKFLOWS_DIR`），与原有"多媒体资源卡片"通过 `cardType` 字段区分。

#### Scenario: 任务执行后生成结果卡片
- **WHEN** AI 工作流任务（任一类型）执行完成
- **THEN** 系统在 `WORKFLOWS_DIR` 新建一张 JSON 卡片，字段：`cardType: 'aiworkflow-result'`、`sourceTaskId`、`sourceTaskType`、`sourceTaskName`、`title`（任务名 + 执行时间）、`url`（任务 URL 或跨页面首 URL）、`time`、`createdAt`、`resources`（结果项数组，结构适配原 resources 字段：type='text'、name=字段名/条目摘要、content=条目内容、pageUrl=sourceUrl）、`resourceCount`、`aiworkflowBatchId`（关联批次）
- **AND** 卡片保存到 `WORKFLOWS_DIR`（与原多媒体卡片同目录不同 cardType）
- **AND** 不影响原多媒体卡片的存储与展示

#### Scenario: 抓取信息卡片模块区分展示
- **WHEN** 用户进入"抓取信息卡片"模块
- **THEN** 列表同时显示多媒体卡片（`cardType: 'media'` 或无 cardType）与工作流结果卡片（`cardType: 'aiworkflow-result'`）
- **AND** 工作流结果卡片显示"⚙ 工作流"徽章与任务类型小图标，区别于多媒体卡片的"🖼️/🎬/🎵"徽章
- **AND** 右键菜单保留原多媒体卡片的所有操作；工作流结果卡片额外提供"在 AI 工作流打开"选项，跳转到对应任务

#### Scenario: 历史多媒体卡片兼容
- **WHEN** 加载已存在的旧多媒体卡片（无 `cardType` 字段）
- **THEN** 默认视为 `cardType: 'media'`，展示与功能不受影响

### Requirement: HT 编辑器 AI 工作流容器
系统 SHALL 在 HT 编辑器新增 "aiworkflow" 容器类型，允许用户在画布上放置一个关联 AI 工作流任务的容器，支持快速执行该任务并预览结果。

#### Scenario: 创建 AI 工作流容器
- **WHEN** 用户在 HT 编辑器工具栏选择"AI 工作流"容器类型并点击画布
- **THEN** 在画布生成一个 aiworkflow 容器卡片
- **AND** 容器配置面板（⚙ 按钮）提供：任务下拉列表（列出所有 AI 工作流任务，按类型分组）+ "立即运行"按钮 + 结果预览区

#### Scenario: 容器内快速执行任务
- **WHEN** 用户在容器上点击"▶ 运行"小按钮
- **THEN** 系统调用 `run-aiworkflow-task` 执行关联的任务
- **AND** 容器内显示运行状态（运行中/完成/失败）
- **AND** 完成后容器内迷你列表显示本次结果的条目数与前 3 条摘要
- **AND** 点击"查看完整结果"打开 AI 工作流模块的结果面板

#### Scenario: 容器与任务联动
- **GIVEN** 容器已关联某任务
- **WHEN** 用户在 AI 工作流模块删除该任务
- **THEN** 容器显示"任务已删除"占位提示，配置面板的任务下拉重置为空
- **AND** 不影响其他容器与画布元素

### Requirement: 导入抓取记录到 AI 工作流
系统 SHALL 在 AI 工作流模块支持导入"抓取信息卡片"模块的已有卡片（多媒体卡片或工作流结果卡片），作为新任务的配置来源或现有任务的补充数据。

#### Scenario: 从卡片导入创建新任务
- **WHEN** 用户在 AI 工作流模块点击"从卡片导入"按钮
- **THEN** 弹出"抓取信息卡片"列表（含多媒体卡片与工作流结果卡片）
- **AND** 用户选中一张卡片后，根据卡片类型推断任务类型：
  - 多媒体卡片（`cardType:'media'`）：以卡片 URL 创建批量抓取任务，预填 URL，进入向导第二步（选择器拾取）
  - 工作流结果卡片（`cardType:'aiworkflow-result'`）：复用源任务的 config 创建同类型新任务，预填所有配置，用户可调整后保存
- **AND** 创建后任务列表刷新

#### Scenario: 导入卡片资源作为任务参考样例
- **GIVEN** 用户在任务创建向导中
- **WHEN** 用户点击"从卡片导入样例"
- **THEN** 弹出"抓取信息卡片"列表
- **AND** 选中卡片后，将该卡片的 `resources` 数组作为字段映射的样例数据填入向导（自动推断字段名与取值属性）
- **AND** 用户可在此基础上调整字段映射

### Requirement: MCP 服务端
系统 SHALL 在主进程内启动一个 MCP（Model Context Protocol）服务端，暴露 web-scout 的抓取能力为标准化 MCP 工具，使外部 AI 模型（如 Claude Desktop、Cursor、其他支持 MCP 的客户端）能通过 MCP 协议直接调用本应用的抓取功能。

#### Scenario: 启用 MCP 服务
- **WHEN** 用户在设置面板开启"MCP 服务"开关
- **THEN** 主进程启动 MCP server（默认 stdio 或 http 模式，配置端口）
- **AND** 应用在设置面板显示 MCP 服务状态（运行中/已停止）与接入示例（如 JSON 配置片段供 Claude Desktop 使用）

#### Scenario: MCP 暴露的工具集
- **GIVEN** MCP 服务已启动
- **THEN** 外部 AI 客户端能列举并调用以下工具：
  - `scrape_page`：参数 `{url, selector?}`，加载 URL 并提取全页资源或匹配选择器的元素
  - `extract_elements`：参数 `{url, selector, fields?}`，提取页面中匹配选择器的元素及指定字段
  - `list_workflows`：列出所有 AI 工作流任务
  - `run_workflow`：参数 `{taskId}`，运行指定 AI 工作流任务
  - `create_workflow`：参数 `{type, name, config}`，创建新任务
  - `get_workflow_results`：参数 `{taskId, batchId?}`，获取任务执行结果
  - `list_cards`：列出抓取信息卡片
  - `tracking_status`：查询追踪任务状态
- **AND** 每个工具返回标准 MCP 响应格式

#### Scenario: 外部 AI 调用抓取
- **GIVEN** Claude Desktop 配置接入本应用 MCP 服务
- **WHEN** 用户在 Claude 中说"抓取 example.com 的所有图片"
- **THEN** Claude 调用 `scrape_page` 工具，本应用后台 BrowserView 加载页面并提取图片
- **AND** 结果以 MCP 响应返回给 Claude，Claude 可继续基于结果对话

#### Scenario: 安全与权限
- **WHEN** MCP 工具调用涉及删除任务、修改配置等敏感操作
- **THEN** 系统默认仅暴露只读工具；写操作工具（create_workflow、run_workflow、delete）需用户在设置面板显式开启"允许写操作"开关
- **AND** 所有 MCP 调用记录日志，可在设置面板查看最近 100 条调用历史

### Requirement: AI 工作流接入大模型
系统 SHALL 允许 AI 工作流任务接入大模型 API（如 GPT、Claude、DeepSeek 等），在向导与执行流程中提供 AI 辅助能力，包括智能生成选择器、智能字段映射、智能分类、结果摘要。

#### Scenario: 配置模型 API
- **WHEN** 用户在 AI 工作流设置面板点击"配置大模型"
- **THEN** 弹出模型配置对话框：API 端点、API Key、模型名称、温度参数
- **AND** 配置保存到加密存储（沿用 SecurityService）
- **AND** 提供"测试连接"按钮验证配置有效性

#### Scenario: 智能生成选择器
- **GIVEN** 用户在批量抓取向导已输入 URL，模型已配置
- **WHEN** 用户点击"AI 生成选择器"按钮并输入自然语言描述（如"所有评论"）
- **THEN** 系统将页面 HTML 片段（截断到合理大小）+ 用户描述发送给大模型
- **AND** 大模型返回候选 CSS 选择器列表
- **AND** 向导显示候选选择器，用户选择后自动填入并执行"测试匹配"验证数量

#### Scenario: 智能字段映射
- **GIVEN** 用户在跨页面向导已输入 URL
- **WHEN** 用户点击"AI 推断字段"
- **THEN** 系统将页面 HTML 与同类型页面样例发送给大模型
- **AND** 大模型返回建议的字段映射（字段名 + 选择器 + 取值属性）
- **AND** 用户可在向导中调整

#### Scenario: 智能分类
- **GIVEN** 批量抓取任务已执行，结果包含多条文本
- **WHEN** 用户在结果面板点击"AI 分类"
- **THEN** 系统将结果条目发送给大模型
- **AND** 大模型返回分类标签与每条结果的归属
- **AND** 结果面板按 AI 分类重新分组展示，标注"AI 分类"徽章

#### Scenario: 结果摘要
- **GIVEN** 任务结果较多
- **WHEN** 用户点击"AI 摘要"
- **THEN** 系统将结果发送给大模型生成摘要
- **AND** 摘要显示在结果面板顶部，可复制

## MODIFIED Requirements

### Requirement: 模块导航
原导航栏四项（抓取 / HT 编辑器 / AI 工作流 / 仪表盘）修改为五项（抓取 / HT 编辑器 / 抓取信息卡片 / AI 工作流 / 仪表盘）。新增项插在"抓取信息卡片"与"仪表盘"之间。

## REMOVED Requirements
无移除项。原 "AI 工作流" 模块功能完整保留，仅改名。
