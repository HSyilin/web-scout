# Tasks

## 阶段 A：Windows 11 打包与发布（最高优先级，无依赖）

- [x] Task A1：清理 `package.json` 无效脚本
  - [x] 移除 `scripts.test:bili` 和 `scripts.test:bilibili` 两个条目
  - [x] 在 `build.win.target` 数组追加 `{ "target": "portable", "arch": ["x64"] }`，同时生成 NSIS 安装包和便携版
  - [x] 验证：`node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` 无报错

- [x] Task A2：创建 `CHANGELOG.md`
  - [x] 记录 v1.0.0 功能清单：可视化抓取、HT 编辑器、AI 工作流、抓取信息卡片、统计图、模板系统
  - [x] 记录已知问题：未签名导致 SmartScreen 警告、招聘网站反爬需用户自行登录
  - [x] 内容用于 GitHub Release 说明

- [x] Task A3：执行 Windows 11 打包
  - [x] 运行 `npm run build:win`
  - [x] 验证 `dist/` 目录下生成 `Web Scout-1.0.0-Setup.exe` 和 `Web Scout-1.0.0-portable.exe`
  - [x] 验证 `dist/builder-effective-config.yaml` 中 portable target 已生效（实际为 builder-debug.yml，portable target 已生效）
  - [x] 记录安装包大小，准备 GitHub Release 上传

## 阶段 B：HT 编辑器统计图增强（与阶段 A 并行）

- [x] Task B1：主进程新增 `parse-spreadsheet` IPC
  - [x] 在 `src/main/index.js` 新增 `ipcMain.handle('parse-spreadsheet', ...)` 
  - [x] 支持 CSV（自动检测分隔符 `,` / `\t` / `;`）、JSON（数组或对象数组）、XLSX（用 `xlsx` 库读第一个 sheet）
  - [x] 返回 `{ success, data: { rows: string[][], headers: string[] } }` 统一结构
  - [x] 在 `src/preload/index.js` 暴露 `parseSpreadsheet(filePath)`

- [x] Task B2：Excel 容器新增「导入数据」按钮
  - [x] 在 `wsw-editor.js` 的 `showExcelConfigPanel` 方法中添加「📂 导入数据」按钮
  - [x] 新增 `importTableData(cardId)` 方法：调用 `selectOpenFile` 选文件 → 调用 `parseSpreadsheet` → 写入 `card.tableData` → 触发 `renderExcelContainer` 重渲染
  - [x] 支持文件类型：`.csv,.json,.xlsx,.xls`
  - [x] 新增 `select-open-file` IPC 和 preload API（原项目无此 API）

- [x] Task B3：chartCard 配置面板增强
  - [x] 在 `showChartConfigPanel` 增加「数据模式」选择：`source`（绑定源容器）/ `inline`（直接数据）
  - [x] `inline` 模式：渲染可编辑二元组表格（标签 / 数值），数据存入 `card.inlineData = { labels, values }`
  - [x] `_extractChartData` 优先读 `card.inlineData`，其次读 sourceCardId
  - [x] 新增「分组列 / 数值列 / 聚合方式（count/sum/avg）/ 分箱大小」4 个下拉（仅 source 模式可用）

- [x] Task B4：实现 `_aggregateData` 和 `_binValues` 工具函数
  - [x] `_aggregateData(rawRows, groupByCol, valueCol, op)`：按 groupByCol 分组，对 valueCol 执行 count/sum/avg
  - [x] `_binValues(values, binSize)`：把数值数组按 binSize 分箱，返回 `{ labels: ['0-5k','5k-10k',...], values: [count...] }`
  - [x] 在 `_extractChartData` 中按配置面板选项调用上述函数

- [x] Task B5：修复导出 HTML 渲染统计图（**BREAKING** 修复）
  - [x] 在 `_generateSelfContainedHTML` 内嵌的运行时脚本中注入 4 个绘图函数：`_drawChartBar / _drawChartPie / _drawChartLine / _drawWordCloud`
  - [x] 扩展内嵌 `createElementByType` 增加 `chartCard` 分支：渲染 canvas 容器
  - [x] 导出前预计算每个 chartCard 的 `chartData`（调用 `_extractChartData`），写入 `WSW_DATA.cards[i].chartData`
  - [x] 在内嵌运行时的 `renderCards` 末尾遍历 chartCard 调用对应绘图函数
  - [x] 验证：保存的 .html 用浏览器打开，统计图正确渲染

## 阶段 C：抓取方案模板系统（依赖阶段 B 完成）

- [x] Task C1：主进程新增模板管理 IPC（含用户模板 CRUD）
  - [x] 新增 `ipcMain.handle('list-templates', ...)`：扫描 `assets/templates/`（内置）和 `userData/data/user_templates/`（用户自定义）两个目录
  - [x] 返回结构：`{ recruitment: { builtin: [...], user: [...] }, comments: {...}, products: {...} }`
  - [x] 新增 `ipcMain.handle('import-task-template', ...)`：读取指定模板 JSON（参数含 `source: 'builtin'|'user'` 和 `relativePath`）
  - [x] 新增 `ipcMain.handle('save-user-template', ...)`：参数 `{ name, category, taskConfig }`，保存到 `userData/data/user_templates/<category>/<name>.json`，自动 sanitize 文件名
  - [x] 新增 `ipcMain.handle('delete-user-template', ...)`：参数 `{ category, name }`，删除对应用户模板文件（内置模板不可删）
  - [x] 在 `src/preload/index.js` 暴露 `listTemplates()`、`importTaskTemplate(source, relativePath)`、`saveUserTemplate(name, category, taskConfig)`、`deleteUserTemplate(category, name)` 四个 API

- [x] Task C2：AI 工作流向导 Step 1 新增「导入模板」入口
  - [x] 在 `aiworkflow.js` 的 `renderTemplateStep` step 1 顶部添加「📂 导入抓取方案模板」按钮
  - [x] 新增 `openTemplatePicker()` 方法：调用 `listTemplates` → 弹出选择对话框
  - [x] 对话框按分类（recruitment/comments/products）分三栏，每栏内再分「内置」和「我的」两组
  - [x] 用户模板条目右侧显示「🗑」删除按钮（内置模板不显示）
  - [x] 选择后调用 `importTaskTemplate` → 把 taskConfig 写入 `wiz.data`（sampleUrls/fields/urls/name/exportFormat/autoExport）→ `renderWizardStep` 刷新
  - [x] 不影响原有手动输入流程

- [x] Task C3：Step 2 字段增删改能力增强
  - [x] 确认现有 `addFieldMappingRow` 方法可正常添加新字段（如「企业融资阶段」「参保人数」）
  - [x] 每行字段末尾显示「✕」删除按钮，点击后从 `wiz.data.fields` 移除该字段并重渲染
  - [x] 字段名、selector、attr、extractType 均可编辑修改
  - [x] 验证：导入嵌入式招聘模板后，能添加「企业融资阶段」字段并保存任务

- [x] Task C4：Step 4 新增「💾 另存为模板」按钮
  - [x] 在 Step 4 保存任务按钮旁新增「💾 另存为模板」按钮
  - [x] 新增 `saveAsTemplate()` 方法：弹出对话框输入模板名称 + 选择分类（recruitment/comments/products/其他）
  - [x] 构造 `taskConfig`（含 type/name/config，与 `export-task-config` 格式一致）
  - [x] 调用 `saveUserTemplate(name, category, taskConfig)` 保存
  - [x] Toast 反馈保存结果，下次打开「导入模板」对话框时新模板出现在用户模板分组

- [x] Task C5：创建招聘抓取方案模板
  - [x] `assets/templates/recruitment/embedded-engineer.json`：嵌入式工程师招聘（字段含职位名/薪资/地区/学历/经验/技能/公司名/规模/行业）
  - [x] `assets/templates/recruitment/robot-engineer.json`：机器人工程师招聘
  - [x] `assets/templates/recruitment/machine-vision-engineer.json`：机械视觉工程师招聘
  - [x] 每个模板 `sampleUrls` 提供 1-2 个示例 URL，`fields` 包含完整字段定义，`urls` 为空（用户自行追加）
  - [x] 从专业 HR/BOSS 视角完善字段（含融资阶段、参保人数等企业经营维度提示）

- [x] Task C6：创建评论统计抓取方案模板
  - [x] `assets/templates/comments/hot-video-comments.json`：热门视频评论统计
  - [x] 字段：评论内容、用户名、IP 属地、点赞数、回复时间
  - [x] `sampleUrls` 提供 B 站、抖音示例 URL
  - [x] 配套说明：导入后可在 HT 编辑器生成词云和高频词柱状图

- [x] Task C7：创建商品性价比抓取方案模板
  - [x] `assets/templates/products/product-value.json`：商品性价比分析
  - [x] 字段：商品名、价格、销量、评分、店铺名、店铺评分、URL
  - [x] `sampleUrls` 提供京东、淘宝示例 URL
  - [x] 配套说明：导入后可在 Excel 容器按性价比指数（评分/价格×100）排序、按价格分箱统计
  - [x] 额外创建 `product-compare.json`：同类商品横向对比

## 阶段 D：C3 修复（验证发现的偏差）

- [x] Task D1：template Step 2 字段编辑能力接线
  - [x] 在 `aiworkflow.js` 的 `renderTemplateStep` Step 2 分支中，把 `#pickedFieldsList` 的只读渲染改为调用 `renderFieldMappingRow(index, 'template')` 生成可编辑行
  - [x] 确保字段名、selector、attr、extractType 输入框的 `oninput` / `onchange` 事件正确同步到 `wiz.data.fields[index]`
  - [x] 保留 `removePickedField(i)` 的 ✕ 删除按钮（已被 renderFieldMappingRow 内置或外置）
  - [x] 验证：导入嵌入式招聘模板后，可修改某字段的 name 为「企业融资阶段」并保存任务

- [x] Task D2：template Step 2 手动添加字段按钮
  - [x] 在 Step 2 字段列表底部新增「➕ 添加字段」按钮
  - [x] 点击调用 `addFieldMappingRow('template')`，但要适配 template 类型的 `#pickedFieldsList` 容器（或把容器 id 统一为 `#fieldMappingList`）
  - [x] 新增字段默认 name 为空、selector 为空、extractType 为 'text'，用户填入后保存
  - [x] 验证：可在 template Step 2 手动添加「参保人数」字段并保存任务

# Task Dependencies

- **Task A1 → Task A3**：清理 scripts 后才能打包
- **Task A2 与 A1 并行**：可同时进行
- **Task A3 独立于 B/C**：打包不依赖统计图增强
- **Task B1 → Task B2**：导入数据按钮依赖主进程 IPC
- **Task B3 → Task B4**：聚合分箱函数被配置面板调用
- **Task B1-B4 → Task B5**：导出 HTML 渲染依赖统计图核心逻辑稳定
- **Task C1 → Task C2/C3/C4**：模板入口、字段编辑、另存为模板均依赖 IPC
- **Task C1 → Task C5/C6/C7**：模板文件需先有目录结构
- **Task C5/C6/C7 可并行**：三个模板文件互相独立
- **阶段 B 与阶段 A 完全并行**：互不依赖
- **阶段 C 依赖阶段 B 的 Excel 容器导入能力**（模板配套说明中提到导入数据）

# Parallelizable Work

- 阶段 A（A1+A2 并行 → A3）和阶段 B（B1→B2、B3→B4、B1-B4→B5）可由两个独立 Sub-Agent 同时推进
- 阶段 C 的 C5/C6/C7 三个模板文件可由三个 Sub-Agent 并行创建
- 阶段 C 的 C1 必须先完成，C2/C3/C4 可串行也可部分并行（C2 和 C4 都改 aiworkflow.js，建议串行）
- C3 是对现有 `addFieldMappingRow` 的增强，与 C2/C4 无冲突，可并行
