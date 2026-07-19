# 验收清单

## 阶段一：模块重命名与新模块骨架
- [ ] 左侧导航栏原 "AI 工作流" 项文案已改为 "抓取信息卡片"，图标改为 🗂️
- [ ] `#workflowView` 内标题、描述、仪表盘快速入口文字均已改为"抓取信息卡片"
- [ ] 原模块的全部功能（列表加载、右键菜单、删除、导出、与 HT 编辑器联动）保持正常
- [ ] 导航栏新增 "AI 工作流" 项（🤖 图标），位于"抓取信息卡片"与"仪表盘"之间
- [ ] 点击 "AI 工作流" 能切换到 `#aiworkflowView`，BrowserView 自动隐藏，无 JS 报错
- [ ] `aiworkflow.js`、`aiworkflow.css` 已被 index.html 正确引入
- [ ] `App.switchModule` 包含 `aiworkflow` 分支，切换时调用 `AIWorkflow.loadList()`

## 阶段二：数据层与 IPC
- [ ] `AIWORKFLOWS_DIR` 目录在应用启动时自动创建
- [ ] `save-aiworkflow` 能写入 JSON 文件到 `aiworkflows/` 目录，返回 id
- [ ] `get-aiworkflows` 返回所有任务，按 `createdAt` 倒序
- [ ] `get-aiworkflow-detail` 返回完整任务对象（含 results）
- [ ] `delete-aiworkflow` 能删除文件，若任务追踪中先停止定时器
- [ ] `update-aiworkflow` 能合并更新指定字段
- [ ] `preload/index.js` 暴露的 `aiworkflowAPI` 包含 save/getAll/getDetail/delete/update 五个方法

## 阶段三：批量抓取任务
- [ ] 创建向导"批量抓取"类型包含：URL 输入（含"从卡片获取"按钮）、选择器输入、测试匹配按钮、分类规则下拉、保留楼层复选框、任务名
- [ ] "测试匹配"能在隐藏 BrowserView 加载 URL 后返回 `document.querySelectorAll(selector).length`
- [ ] 任务保存后出现在"批量抓取"子标签的卡片网格中
- [ ] 点击"运行"能在后台 BrowserView 执行提取，返回结果条目数
- [ ] 提取结果每条包含：id、parentId、level、textContent、attributes、outerHTML 片段
- [ ] 配置 `preserveRelations:true` 时，结果能正确记录父子楼层关系
- [ ] 按 `classifyBy` 规则能对结果分组
- [ ] 运行完成后任务卡片显示最新运行时间与结果总数

## 阶段四：跨页面同元素抓取
- [ ] 创建向导"跨页面抓取"包含：多行 URL 输入（含"从卡片获取"按钮支持多选）、选择器、字段映射表（动态增删）、任务名
- [ ] 字段映射每行支持：字段名 + 子选择器 + 取值属性（text/href/src/data-*）
- [ ] 执行时并发上限 3，对每个 URL 加载并按映射提取
- [ ] 每条结果记录 `sourceUrl` 与 `fields` 对象
- [ ] 结果面板按 `sourceUrl` 分组折叠展示

## URL 来源（贯穿所有任务类型）
- [ ] 批量抓取向导 URL 输入框旁有"从卡片获取"按钮
- [ ] 跨页面向导 URL textarea 旁有"从卡片获取"按钮（支持多选）
- [ ] 追踪向导 URL 输入框旁有"从卡片获取"按钮
- [ ] 点击"从卡片获取"弹出"抓取信息卡片"列表，显示标题+URL+图标
- [ ] 列表支持搜索筛选
- [ ] 单 URL 任务选中卡片后取首张 URL 回填
- [ ] 跨页面任务多选后追加到 textarea（每行一个 URL）
- [ ] 取消选择不修改原 URL 字段

## 阶段五：更新追踪任务
- [ ] 创建向导"更新追踪"包含：URL、条目选择器、唯一标识字段下拉、轮询间隔下拉、任务名
- [ ] 唯一标识字段下拉自动列出元素常见属性（id/data-id/href）+ textContent 选项
- [ ] 首次执行建立 `knownIds` 基线，全部条目标记 `isNew:false`
- [ ] 后续执行仅追加新条目，标记 `isNew:true` 与 `detectedAt` 时间戳
- [ ] 检测到新条目时通过 `mainWindow.webContents.send('tracking-update', ...)` 通知渲染进程
- [ ] 渲染进程收到通知后刷新任务卡片并显示顶部 banner（5 秒自动消失）
- [ ] 应用重启后 `TrackingScheduler.checkAll()` 自动恢复所有 `active=true` 的追踪任务定时器
- [ ] 错过的轮询不补执行，按当前时间重新调度
- [ ] `pause-tracking` / `resume-tracking` IPC 能正确启停定时器并更新 `active` 字段
- [ ] 轮询间隔最短 10 分钟，最长 24 小时

## 阶段六：抓取模式拾取选择器
- [ ] 向导中"在页面选择元素"按钮可触发进入拾取模式
- [ ] 拾取模式下点击元素不触发原 inspect 提取，而是计算并高亮同选择器匹配的所有元素
- [ ] 拾取模式浮层显示匹配数量与"确认/取消"按钮
- [ ] 确认后选择器字符串与样例数据回传到向导对应字段
- [ ] 取消或 ESC 退出拾取模式不修改向导内容
- [ ] 若当前活动标签页 URL 与目标 URL 不一致，提示用户先导航

## 阶段七：结果查看与导出
- [ ] 结果面板左侧显示执行批次列表（时间 + 条目数 + 删除按钮）
- [ ] 批量抓取结果以树形缩进展示楼层关系
- [ ] 跨页面结果按 sourceUrl 分组折叠
- [ ] 追踪结果默认仅显示 `isNew:true` 条目（带 🆕 徽章），可切换"显示全部"
- [ ] 导出格式下拉支持 TXT/JSON/MD/CSV
- [ ] JSON 导出为完整结构化数组
- [ ] CSV 导出按任务类型展平为表头+数据行
- [ ] MD 导出按任务类型生成层级标题与列表
- [ ] TXT 导出为简单 key:value 格式
- [ ] 导出仅包含当前筛选范围（某批次或全部更新）的结果
- [ ] 保存对话框可选路径，文件可正常打开

## 阶段八：任务管理与卡片交互
- [ ] 任务卡片显示：任务名、类型徽章（batch=蓝/crosspage=紫/tracking=橙）、状态指示灯、上次运行时间、结果总数
- [ ] 状态指示灯：空闲灰、运行中蓝脉冲、追踪中绿
- [ ] 卡片操作按钮：运行、查看结果、编辑、删除；追踪任务额外有暂停/恢复
- [ ] 编辑功能复用创建向导，预填配置，保存调用 `update-aiworkflow`
- [ ] 删除前弹出确认；追踪任务删除时先 `pause-tracking`
- [ ] 每个子标签无任务时显示"新建任务"引导按钮
- [ ] 运行中任务卡片显示加载态，禁用运行按钮

## 阶段九：手动微调机制
- [ ] 跨页面结果面板每个 sourceUrl 分组顶部有"✎ 微调此页面"按钮
- [ ] 点击"微调此页面"切换到抓取模块并加载该 URL 进入拾取模式
- [ ] 拾取模式逐字段提示重新拾取，显示当前选择器与新选择器对比
- [ ] 用户可跳过某字段或"全部使用默认"取消微调
- [ ] 微调确认后 `{url, fieldOverrides}` 写入 `task.config.overrides`
- [ ] 跨页面任务执行时按 URL 匹配 overrides，命中则用覆盖选择器
- [ ] 被微调的分组显示"已微调"徽章 + "重置微调"按钮
- [ ] "重置微调"按钮能删除该 URL 的 override 记录并刷新
- [ ] 批量任务结果面板有"✎ 微调选择器"按钮
- [ ] 批量任务微调后新选择器存入 `config.selectorHistory`，当前选择器设为新值
- [ ] 结果面板提供"选择器历史"下拉，可切换回滚到任一历史选择器
- [ ] 微调 A 页面 `.title`、B 页面 `.article-title` 后重新运行，B 页面结果正确且带"已微调"徽章

## 阶段十：工作流结果回写与跨模块联动
- [ ] 任务执行完成后在 `WORKFLOWS_DIR` 生成 `cardType:'aiworkflow-result'` 卡片
- [ ] 结果卡片包含 sourceTaskId、sourceTaskType、sourceTaskName、title、url、time、resources、resourceCount、aiworkflowBatchId
- [ ] 结果 resources 适配原 schema（type='text'、name、content、pageUrl）
- [ ] "抓取信息卡片"模块列表同时显示多媒体卡片与工作流结果卡片
- [ ] 多媒体卡片（无 cardType 或 'media'）显示原徽章
- [ ] 工作流结果卡片显示"⚙ 工作流"徽章 + 任务类型小图标
- [ ] 工作流结果卡片右键菜单有"在 AI 工作流打开"选项
- [ ] "在 AI 工作流打开"能切换到 AI 工作流模块并定位到对应任务
- [ ] 旧多媒体卡片（无 cardType）默认视为 'media'，显示与功能不受影响
- [ ] HT 编辑器工具栏新增"AI 工作流"容器按钮
- [ ] 容器配置面板有任务下拉（按类型分组）+ 立即运行按钮 + 结果预览区
- [ ] 容器内"▶ 运行"小按钮能执行关联任务
- [ ] 运行中显示加载态，完成后显示条目数 + 前 3 条摘要
- [ ] "查看完整结果"能跳转到 AI 工作流结果面板
- [ ] 任务被删除后，关联容器显示"任务已删除"占位
- [ ] 容器数据持久化到 HT 文档（taskId、lastRunAt、lastResultSummary）
- [ ] AI 工作流模块顶部有"从卡片导入"按钮
- [ ] 导入对话框显示"抓取信息卡片"列表（含 cardType 徽章），支持搜索
- [ ] 导入多媒体卡片创建批量任务，预填 URL
- [ ] 导入工作流结果卡片复用源任务 config 创建同类型新任务
- [ ] 跨页面向导有"从卡片导入样例"按钮，能将卡片 resources 填入字段映射表

## 阶段十一：MCP 服务端
- [ ] package.json 已添加 @modelcontextprotocol/sdk 依赖
- [ ] `src/main/mcp-server.js` 导出 createMcpServer 工厂，支持 stdio/http 模式
- [ ] IPC `mcp-toggle` 能启动/停止 MCP 服务
- [ ] IPC `mcp-status` 返回服务状态（运行中/已停止 + 端口）
- [ ] IPC `mcp-set-readonly` 能切换写权限
- [ ] 设置面板有"MCP 服务"开关 + 状态显示 + 接入示例 JSON 片段（可复制）
- [ ] `preload/index.js` 暴露 `mcpAPI: {toggle, getStatus, setReadonly}`
- [ ] MCP `scrape_page` 工具能加载 URL 提取资源
- [ ] MCP `extract_elements` 工具能按选择器+字段提取
- [ ] MCP `list_workflows` 工具返回任务列表
- [ ] MCP `run_workflow` 工具（需写权限）能运行任务
- [ ] MCP `create_workflow` 工具（需写权限）能创建任务
- [ ] MCP `get_workflow_results` 工具返回结果
- [ ] MCP `list_cards` 工具返回抓取信息卡片
- [ ] MCP `tracking_status` 工具返回追踪任务状态
- [ ] readonly=true 时写操作工具不注册
- [ ] 调用日志保留最近 100 条，设置面板可查看
- [ ] Claude Desktop 接入后能列举工具并调用只读工具

## 阶段十二：AI 工作流接入大模型
- [ ] IPC `save-ai-config`/`get-ai-config`/`test-ai-config` 实现
- [ ] AI 配置字段：endpoint/apiKey/model/temperature/maxTokens
- [ ] AI 配置加密存储
- [ ] `test-ai-config` 能发送测试消息验证 API
- [ ] `preload/index.js` 暴露 `aiConfigAPI`
- [ ] AI 工作流模块设置区有"配置大模型"按钮与对话框
- [ ] `src/main/ai-helper.js` 封装 `callLLM` 通用调用
- [ ] 批量抓取向导有"AI 生成选择器"按钮，能返回候选选择器列表
- [ ] 跨页面向导有"AI 推断字段"按钮，能自动填入字段映射
- [ ] 批量抓取结果面板有"AI 分类"按钮，能按 AI 分类重新分组
- [ ] 结果面板有"AI 摘要"按钮，能生成摘要显示在顶部
- [ ] AI 调用显示加载态，失败时友好提示

## 通用与回归
- [ ] 原 `workflow` 模块（现"抓取信息卡片"）的 IPC（save-workflow 等）未受影响
- [ ] WSW 编辑器对工作流的联动（`get-workflow-detail` 等）仍正常
- [ ] 应用启动无 JS 报错，DevTools Console 干净
- [ ] 跨平台：路径处理使用 path.join，Windows 下验证通过
- [ ] 暗色/亮色主题切换后 AI 工作流模块 UI 正确响应
- [ ] 任务 JSON 文件大小合理（单文件 < 5MB），大量结果时考虑分批存储
