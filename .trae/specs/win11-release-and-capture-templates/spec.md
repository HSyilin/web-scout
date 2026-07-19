# Windows 11 发布与抓取方案模板 Spec

## Why
用户计划在 GitHub 上发布 v1.0.0 的 Windows 11 安装包，需要确保整个程序在 Windows 11 环境下不报错；同时希望以「专业 HR/BOSS 视角」的招聘抓取流程和多个开箱即用的抓取方案模板（评论统计、商品性价比等）让用户快速体验应用价值。当前 HT 编辑器的统计图无法从外部数据文件导入、且导出 HTML 后图表不渲染，导致招聘数据可视化与分享链路断裂。

## What Changes

### A. Windows 11 打包与发布
- 对全部 11 个源文件做 `node --check` 语法验证，确保 Windows 11 运行时无语法错误
- 清理 `package.json` 中引用了不存在文件的 `test:bili` / `test:bilibili` 脚本
- 执行 `npm run build:win` 生成 NSIS x64 安装包 `Web Scout-1.0.0-Setup.exe`
- 追加 `portable` 便携版 target，同时生成免安装 exe
- 创建 `CHANGELOG.md` 记录 v1.0.0 功能清单和已知问题，用于 GitHub Release 说明

### B. HT 编辑器统计图能力增强
- **CSV/JSON 数据导入**：Excel 容器配置面板新增「📂 导入数据」按钮，支持解析 CSV / JSON / XLSX 写入 `card.tableData`
- **主进程 `parse-spreadsheet` IPC**：复用项目已声明依赖 `xlsx ^0.18.5`，主进程提供解析能力，前端通过 `electronAPI` 调用
- **chartCard 内联数据源**：chartCard 支持直接绑定一个 Excel 容器作为数据源（已有），同时支持「直接数据」模式（用户在配置面板手工录入二元组表格）
- **薪资分箱 / 分组聚合**：`_extractChartData` 前置增加 `_aggregateData(rawRows, groupByCol, valueCol, op)` 和 `_binValues(values, binSize)`，配置面板新增「分组列 / 数值列 / 聚合方式 / 分箱大小」选项
- **导出 HTML 渲染统计图**（**BREAKING** 修复）：`_generateSelfContainedHTML` 内嵌运行时注入 4 个绘图函数（柱/饼/折线/词云）和 chartCard 渲染分支；导出前预计算 `chartData` 写入 `WSW_DATA.cards[i].chartData`，避免导出 HTML 重复实现 sourceCardId 查找

### C. 招聘抓取方案模板（嵌入式/机器人/机械视觉）
- 提供一个可导入的 `aiworkflow-task-config` JSON 模板文件，覆盖三个方向：嵌入式工程师、机器人工程师、机械视觉工程师
- 模板字段：职位名、薪资范围、地区、学历、经验、技能关键词、公司名、公司规模、公司行业、招聘来源
- 模板支持多 URL 批量抓取（BOSS 直聘、智联、前程无忧、拉勾、猎聘）
- 模板配置文件放置在 `assets/templates/recruitment/` 目录，用户可在 Step 1 通过「📂 导入模板」按钮加载
- **前置依赖**：抓取信息卡片 Step 1 需新增「导入任务配置」入口（消费 `export-task-config` 生成的 JSON 文件）

### D. 评论统计抓取方案模板
- 模板字段：评论内容、用户名、IP 属地、点赞数、回复时间
- 适配场景：B 站、抖音、快手、微博、知乎热门帖子和短视频
- 通过 textContainer 词频统计能力生成高频词词云（已有 `_tokenizeText`）
- 模板文件放置在 `assets/templates/comments/`

### E. 商品性价比抓取方案模板
- 模板字段：商品名、价格、销量、评分、店铺名、店铺评分、URL
- 适配场景：淘宝、天猫、京东、拼多多
- 配套 Excel 容器统计模板：按价格升序、评分降序、销量降序三种排序，自动计算「性价比指数 = 评分 / 价格 × 100」
- 性价比指数计算逻辑通过 chartCard 内联数据源 + 薪资分箱同款的 `_binValues` 复用实现
- 模板文件放置在 `assets/templates/products/`

### F. 模板导入入口与「另存为模板」能力
- 在 AI 工作流 Step 1（URL 输入页）顶部新增「📂 导入抓取方案模板」按钮
- 主进程新增 `list-templates` IPC 扫描 `assets/templates/` 目录（内置模板）和 `userData/data/user_templates/` 目录（用户自定义模板）
- 主进程新增 `import-task-template` IPC 读取模板 JSON 并返回结构化数据
- 主进程新增 `save-user-template` IPC 把当前任务配置保存为用户模板（写入 `userData/data/user_templates/<分类>/<名称>.json`）
- preload 暴露 `listTemplates()`、`importTaskTemplate(relativePath)`、`saveUserTemplate(name, category, taskConfig)` 三个 API
- AI 工作流 Step 4 保存任务时新增「💾 另存为模板」按钮：把当前向导数据保存为用户模板
- 用户模板与内置模板在「导入模板」对话框中分组显示（内置模板不可覆盖，用户模板可删除/覆盖）
- 主进程新增 `delete-user-template` IPC，支持在模板对话框中删除用户模板
- preload 暴露 `deleteUserTemplate(relativePath)` API

### G. 招聘信息的可编辑性
- 招聘抓取模板导入后，向导中所有字段（sampleUrls、fields、urls、任务名）均可由用户自由修改后再保存任务
- 模板字段定义支持在 Step 2 增删改：用户可添加新字段（如「企业融资阶段」「参保人数」）、删除不需要的字段、修改字段名/选择器/extractType
- 保存任务后，已抓取的招聘信息卡片支持在「抓取信息卡片」面板中编辑（已有能力，确保不被破坏）
- 用户修改后的任务可通过 Step 4 的「💾 另存为模板」按钮另存为新模板，下次直接复用

## Impact
- **Affected specs**: `redesign-ai-workflow`（末端抓取向导 Step 1 需新增模板导入入口，Step 2 字段增删改能力增强，Step 4 新增「另存为模板」按钮）
- **Affected code**:
  - `package.json`（清理 scripts、追加 portable target）
  - `CHANGELOG.md`（新建）
  - `src/main/index.js`（新增 `parse-spreadsheet`、`list-templates`、`import-task-template`、`save-user-template`、`delete-user-template` 五个 IPC；自动导出逻辑已支持任务级路径回退默认目录）
  - `src/preload/index.js`（暴露 `parseSpreadsheet`、`listTemplates`、`importTaskTemplate`、`saveUserTemplate`、`deleteUserTemplate` API）
  - `src/renderer/wsw-editor.js`（统计图增强主体：CSV/JSON 导入、内联数据源、分箱/聚合、导出 HTML 渲染）
  - `src/renderer/aiworkflow.js`（Step 1 模板导入入口按钮 + 加载逻辑；Step 2 字段增删改；Step 4「另存为模板」按钮）
  - `assets/templates/recruitment/*.json`、`assets/templates/comments/*.json`、`assets/templates/products/*.json`（新建内置模板文件）
  - `userData/data/user_templates/<分类>/*.json`（运行时由用户通过「另存为模板」生成）

## ADDED Requirements

### Requirement: Windows 11 安装包生成
系统 SHALL 通过 `npm run build:win` 生成 NSIS x64 安装包和 portable 便携版，产物位于 `dist/` 目录。

#### Scenario: 正常打包
- **WHEN** 开发者在 Windows 11 上执行 `npm run build:win`
- **THEN** `dist/` 目录下生成 `Web Scout-1.0.0-Setup.exe`（NSIS 安装包）和 `Web Scout-1.0.0-portable.exe`（便携版）

#### Scenario: 安装包可正常安装并启动
- **WHEN** 用户在 Windows 11 上双击 `Web Scout-1.0.0-Setup.exe`
- **THEN** 安装向导出现，允许选择安装目录，安装完成后开始菜单出现「Web Scout」快捷方式，启动后主窗口正常显示

### Requirement: HT 编辑器统计图数据导入
系统 SHALL 支持从 CSV / JSON / XLSX 文件导入结构化数据到 Excel 容器，作为统计图数据源。

#### Scenario: 导入 CSV 文件
- **WHEN** 用户在 Excel 容器配置面板点击「📂 导入数据」并选择一个 CSV 文件
- **THEN** 主进程解析 CSV 为二维数组，写入 `card.tableData`，容器网格重新渲染显示数据，统计图刷新

#### Scenario: 导入 XLSX 文件
- **WHEN** 用户选择一个 .xlsx 文件
- **THEN** 主进程使用 `xlsx` 库解析第一个 sheet 为二维数组，后续流程同 CSV

### Requirement: 统计图薪资分箱与分组聚合
系统 SHALL 支持对统计图数据源执行分组聚合（count/sum/avg）和数值分箱，以支持薪资分布等场景。

#### Scenario: 薪资分布分箱
- **WHEN** 用户在 chartCard 配置面板选择「分箱大小 = 5k」并将数值列设为「薪资上限」
- **THEN** 统计图按 0-5k、5k-10k、10k-15k... 分箱统计职位数量，渲染为柱状图

### Requirement: 导出 HTML 渲染统计图
系统 SHALL 在导出的自包含 HTML 文件中正确渲染统计图卡片。

#### Scenario: 导出含统计图的 HTML
- **WHEN** 用户在画布上有 chartCard 并执行「保存为 HTML」
- **THEN** 生成的 .html 文件用浏览器打开后，统计图位置正确渲染对应图表（柱/饼/折线/词云），不显示空白

### Requirement: 招聘抓取方案模板
系统 SHALL 提供嵌入式/机器人/机械视觉三个方向的招聘抓取方案模板文件，用户可一键导入。

#### Scenario: 导入嵌入式招聘模板
- **WHEN** 用户在 AI 工作流 Step 1 点击「📂 导入抓取方案模板」并选择「嵌入式工程师招聘」
- **THEN** 向导自动填入预设的 sampleUrls、fields、urls、exportPath（默认目录），用户可直接保存或调整后保存

### Requirement: 评论统计抓取方案模板
系统 SHALL 提供适用于 B 站/抖音/快手/微博/知乎的评论抓取模板，字段含评论内容、用户名、IP 属地、点赞数、回复时间。

#### Scenario: 抓取 B 站视频评论
- **WHEN** 用户导入「热门视频评论统计」模板并粘贴 B 站视频 URL
- **THEN** 任务运行后生成包含评论列表的 textContainer，用户可在 HT 编辑器中生成词云和高频词柱状图

### Requirement: 商品性价比抓取方案模板
系统 SHALL 提供适用于淘宝/天猫/京东/拼多多的商品抓取模板，并配套性价比指数计算（评分 / 价格 × 100）。

#### Scenario: 同类商品性价比排名
- **WHEN** 用户导入「商品性价比分析」模板并抓取某类商品多个商品页
- **THEN** 导出数据后可在 Excel 容器中按性价比指数降序排序，统计图按价格区间分箱显示商品分布

### Requirement: 模板文件目录结构
系统 SHALL 在 `assets/templates/` 下按场景分子目录存放内置模板 JSON 文件，每个文件符合 `aiworkflow-task-config` 格式；同时支持在 `userData/data/user_templates/` 下保存用户自定义模板。

#### Scenario: 列出可用模板
- **WHEN** 用户点击「📂 导入抓取方案模板」
- **THEN** 弹出模板选择对话框，按 `recruitment/`、`comments/`、`products/` 三个分类展示可用模板，内置模板和用户模板分组显示

#### Scenario: 另存为模板
- **WHEN** 用户在 Step 4 点击「💾 另存为模板」按钮，输入模板名称并选择分类
- **THEN** 当前向导数据被保存为 `userData/data/user_templates/<分类>/<名称>.json`，下次打开「导入模板」对话框时该模板出现在用户模板分组中

#### Scenario: 删除用户模板
- **WHEN** 用户在模板对话框中选中一个用户模板并点击删除
- **THEN** 对应的 `userData/data/user_templates/<分类>/<名称>.json` 文件被删除，内置模板不可删除

### Requirement: 招聘信息可编辑性
系统 SHALL 允许用户在导入招聘抓取模板后自由修改所有字段定义、URL、任务名，并支持把修改后的配置另存为新模板。

#### Scenario: 修改模板字段
- **WHEN** 用户导入嵌入式招聘模板后，在 Step 2 添加一个「企业融资阶段」字段
- **THEN** 新字段被加入 `wiz.data.fields`，后续步骤和保存的任务配置包含该字段

#### Scenario: 另存修改后的招聘模板
- **WHEN** 用户在 Step 4 点击「💾 另存为模板」，输入名称「嵌入式招聘-含融资阶段」
- **THEN** 修改后的字段定义被保存为用户模板，下次可直接导入使用

## MODIFIED Requirements

### Requirement: AI 工作流向导 Step 1
在原有 URL 输入框上方新增「📂 导入抓取方案模板」按钮，点击后弹出模板选择对话框，选择后自动填入向导数据。原有手动输入流程不受影响。

## REMOVED Requirements

### Requirement: 旧 test:bili / test:bilibili 脚本
**Reason**: 引用的脚本文件 `test-bili-download.js` / `test-bilibili-download.js` 不存在，运行会报错
**Migration**: 直接从 `package.json` 的 scripts 中移除这两个条目
