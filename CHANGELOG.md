# Changelog

## v2.0.0 - 2026-07-19

### 本次重大升级亮点

v2.0.0 是 Web Scout 的第一个正式跨平台发布版本，在 v1.0.0 的基础上完成 **Windows + Linux 双平台发布**、**HT 编辑器统计图能力大幅增强**、**抓取方案模板系统** 三大主线升级，并修复了多项关键缺陷。

### 新增功能

#### A. Windows 11 打包与发布（v2.0.0 首次支持）

- 清理 `package.json` 中失效的 `test:bili` / `test:bilibili` 脚本
- `build.win.target` 追加 `portable` 便携版，**同时生成 NSIS 安装包和免安装便携版**
- 重建 `assets/icon.ico` 为合法 PNG-compressed ICO 格式，解决 electron-builder 报错
- 通过 `npm run build:win` 生成产物，验证 Windows 11 环境下无语法错误

#### B. HT 编辑器统计图能力增强

- **CSV/JSON 数据导入**：Excel 容器配置面板新增「📂 导入数据」按钮，支持解析 CSV / JSON / XLSX 写入 `card.tableData`
- **主进程 `parse-spreadsheet` IPC**：复用 `xlsx ^0.18.5` 依赖，前端通过 `electronAPI` 调用
- **chartCard 内联数据源**：chartCard 支持「直接数据」模式，用户可在配置面板手工录入二元组表格
- **薪资分箱 / 分组聚合**：新增 `_aggregateData`（count/sum/avg）和 `_binValues`，配置面板新增「分组列 / 数值列 / 聚合方式 / 分箱大小」选项
- **修复导出 HTML 渲染统计图**：`_generateSelfContainedHTML` 内嵌运行时注入 4 个绘图函数（柱/饼/折线/词云）和 chartCard 渲染分支；导出前预计算 `chartData` 写入 `WSW_DATA.cards[i].chartData`

#### C. 抓取方案模板系统

- **4 个模板管理 IPC**：`list-templates`、`import-task-template`、`save-user-template`、`delete-user-template`
- **AI 工作流 Step 1 新增「📂 导入抓取方案模板」入口**：弹出对话框按 `recruitment/comments/products` 三分类展示，每分类再分「内置」和「我的」两组
- **Step 2 字段增删改能力**：字段名、selector、attr、extractType 均可内联编辑；新增「➕ 添加字段」按钮支持手动添加任意字段（如「企业融资阶段」「参保人数」）
- **Step 4 新增「💾 另存为模板」按钮**：当前任务配置可保存为用户模板，下次直接复用
- **6 个内置模板**：
  - 招聘方向：嵌入式工程师、机器人工程师、机械视觉工程师（覆盖 BOSS 直聘、智联、前程无忧、拉勾、猎聘）
  - 评论方向：热门视频评论统计（B 站/抖音/快手/微博/知乎，字段含评论内容/用户名/IP 属地/点赞数/回复时间）
  - 商品方向：商品性价比分析、同类商品横向对比（淘宝/天猫/京东/拼多多，含性价比指数 = 评分 / 价格 × 100）

#### D. 全局默认导出目录

- `settings.json` 持久化全局默认导出目录，所有卡片共用
- 任务级临时路径可覆盖全局默认（仅对当前任务生效）
- **内容存放地址和配置导出地址均为必选**，自动导出为可选项
- 导出配置文件以任务名称命名，用于快捷导入其他用户的抓取方案

#### E. 其他改进

- `.gitignore` 追加 `.electron-cache/`、`.electron-builder-cache/`、`test-*.js`
- 保留 `.trae/specs/` 下的规划文档（spec.md / tasks.md / checklist.md）
- 招聘信息字段支持用户自行添加/修改，修改后可另存为新模板

### 已知问题

- 未配置代码签名，Windows 11 首次运行会有 SmartScreen 「已保护你的电脑」警告，需点击「仍要运行」
- 主流招聘/电商/视频网站有反爬机制，部分网站需用户在 BrowserView 中手动登录后再抓取
- GitHub codeload archive 不支持 Range 请求，会自动回退单线程下载

### 技术栈

- Electron 28
- 原生 HTML/CSS/JS
- XLSX
- PDFKit
- docx
- @modelcontextprotocol/sdk

### 发布产物

#### Windows

- `Web Scout-2.0.0-Setup.exe`（NSIS 安装包，支持选择安装目录，约 81 MB）
- `Web Scout-2.0.0-portable.exe`（便携版，免安装，约 81 MB）

#### Linux

- `Web Scout-2.0.0.deb`（Debian/Ubuntu 安装包，x64）

### 系统要求

- Windows 10/11 x64
- Linux x64（Debian 10+ / Ubuntu 18.04+ / 其他基于 deb 的发行版）

---

## v1.0.0 - 2026-07-19（内部版本）

### 新增功能

- **可视化抓取模式**：左键选取元素、右键工具菜单、复数选取、综合资源提取
- **HT 编辑器**：Qt5 风格、标签页、文字框/表格/形状/视频容器/音频容器/文本容器/Excel容器/统计图/HTML块/AI工作流容器等多种卡片
- **AI 工作流**：crosspage 跨页抓取、template 末端抓取、tracking 追踪、链式运行、AI 辅助生成选择器/字段推断/结果分类/总结
- **抓取信息卡片管理**：批量导出、回收站、任务配置文件导出/导入
- **统计图**：柱状图/饼图/折线图/词云，Canvas 自绘
- **流媒体视频下载**：B站、m3u8、blob: URL 预处理，10MB 分块，多线程并行
- **MCP 服务端**：支持外部工具通过 MCP 协议调用应用功能
- **安全特性**：PIN 码保护、自动锁定、敏感数据加密存储、API Key 脱敏显示
- **多主题**：白天/黑夜模式，CSS 变量 + 0.3s 过渡
