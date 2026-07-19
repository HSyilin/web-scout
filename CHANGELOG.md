# Changelog

## v1.0.0 - 2026-07-19

### 新增功能

- **可视化抓取模式**：左键选取元素、右键工具菜单、复数选取、综合资源提取
- **HT 编辑器**：Qt5 风格、标签页、文字框/表格/形状/视频容器/音频容器/文本容器/Excel容器/统计图/HTML块/AI工作流容器等多种卡片
- **AI 工作流**：crosspage 跨页抓取、template 末端抓取、tracking 追踪、链式运行、AI 辅助生成选择器/字段推断/结果分类/总结
- **抓取信息卡片管理**：默认导出目录、批量导出、回收站、任务配置文件导出/导入
- **统计图**：柱状图/饼图/折线图/词云，Canvas 自绘
- **模板系统**：内置招聘/评论/商品抓取方案模板，用户自定义模板另存为
- **流媒体视频下载**：B站、m3u8、blob: URL 预处理，10MB 分块，多线程并行
- **MCP 服务端**：支持外部工具通过 MCP 协议调用应用功能
- **安全特性**：PIN 码保护、自动锁定、敏感数据加密存储、API Key 脱敏显示
- **多主题**：白天/黑夜模式，CSS 变量 + 0.3s 过渡

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

- `Web Scout-1.0.0-Setup.exe`（NSIS 安装包，支持选择安装目录）
- `Web Scout-1.0.0-portable.exe`（便携版，免安装）

### 系统要求

- Windows 10/11 x64
