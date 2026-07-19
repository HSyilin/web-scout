# WebScout - 可视化智能网页资源提取器

![version](https://img.shields.io/badge/version-2.0.0-blue)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey)
![license](https://img.shields.io/badge/license-MIT-green)

一款基于 Electron 的跨平台桌面应用，在普通浏览器的基础上，额外提供一套**可视化抓取模式**，让用户可以像浏览网页一样简单地获取图片、音视频、文档和文本内容。v2.0.0 新增**抓取方案模板系统**与**HT 编辑器统计图能力增强**，让数据采集到可视化分析的链路一键打通。

---

## v2.0.0 重大升级亮点

- **跨平台发布**：首次同时提供 Windows（NSIS 安装包 + 便携版）和 Linux（deb）安装包
- **HT 编辑器统计图增强**：支持 CSV/JSON/XLSX 数据导入、分组聚合、薪资分箱、导出 HTML 渲染统计图
- **抓取方案模板系统**：内置 6 个开箱即用的模板（招聘×3 / 评论×1 / 商品×2），用户可另存为自定义模板
- **字段增删改能力**：模板导入后所有字段均可内联编辑，可手动添加「企业融资阶段」「参保人数」等任意字段
- **全局默认导出目录**：`settings.json` 持久化，任务级临时路径可覆盖

详细变更见 [CHANGELOG.md](./CHANGELOG.md)。

---

## Demo 简介

**是什么：** 一款轻量级跨平台桌面应用（Electron），内置浏览器 + 可视化资源提取引擎 + HT 编辑器 + AI 工作流。

**面向谁：** 内容创作者、研究人员、自媒体运营者、HR、电商运营、学生群体——任何需要从网页中批量获取多媒体资源并进行统计分析的人。

**核心功能：**

| 功能 | 说明 |
|------|------|
| 双模式切换 | 默认浏览模式（与普通浏览器无异），一键开启抓取模式 |
| 资源自动识别 | 自动扫描页面中的图片、视频、音频、PDF文档和文本内容 |
| 可视化操作 | 鼠标悬停高亮资源，点击查看详情，支持多选 |
| IDM式并行下载 | 将文件分成多块并行下载，实时显示下载进度 |
| 多种导出方式 | 文件夹输出 / WSW演示文件 / Excel/CSV/MD/TXT 表格导出 |
| 任务流记录 | 自动记录每次抓取操作的时间、URL、资源数量与耗时 |
| HT 编辑器 | Qt5 风格，文字框/表格/形状/视频/音频/文本/Excel/统计图/HTML块/AI工作流容器 |
| 统计图 | 柱状图/饼图/折线图/词云，Canvas 自绘，支持分箱/聚合，导出 HTML 可渲染 |
| AI 工作流 | crosspage 跨页抓取、template 末端抓取、tracking 追踪、链式运行、AI 辅助 |
| 抓取方案模板 | 内置招聘/评论/商品模板，用户可另存为自定义模板 |
| MCP 服务端 | 支持外部工具通过 MCP 协议调用应用功能 |
| 安全特性 | PIN 码保护、自动锁定、敏感数据加密存储、API Key 脱敏显示 |
| 多主题 | 白天/黑夜模式，CSS 变量 + 0.3s 过渡 |

---

## 下载安装

### Windows

- **安装版**：下载 [Web Scout-2.0.0-Setup.exe](https://github.com/HSyilin/web-scout/releases/download/v2.0.0/Web.Scout-2.0.0-Setup.exe)，双击安装，支持选择安装目录
- **便携版**：下载 [Web Scout-2.0.0-portable.exe](https://github.com/HSyilin/web-scout/releases/download/v2.0.0/Web.Scout-2.0.0-portable.exe)，免安装双击运行

> Windows 11 首次运行会有 SmartScreen 警告，点击「仍要运行」即可（应用未签名）。

### Linux

- **deb 包**：下载 [Web Scout-2.0.0.deb](https://github.com/HSyilin/web-scout/releases/download/v2.0.0/Web.Scout-2.0.0.deb)，执行 `sudo dpkg -i Web\ Scout-2.0.0.deb` 安装

适用 Debian 10+ / Ubuntu 18.04+ / 其他基于 deb 的发行版。

### 从源码运行

```bash
# 环境要求：Node.js 18+
git clone https://github.com/HSyilin/web-scout
cd web-scout
npm install
npm start
```

### 构建安装包

```bash
# Windows（需在 Windows 上执行）
npm run build:win

# Linux（需在 Linux 上执行，或在 Windows 上安装 wine）
npm run build:linux
```

---

## 使用流程

### 1. 基础抓取流程

1. **启动应用** → 输入网址浏览网页
2. **开启抓取模式** → 点击右上角「抓取模式」开关
3. **自动扫描** → 页面资源自动分类显示（图片/视频/音频/链接/文本）
4. **选择资源** → 点击资源卡片查看详情，勾选需要的资源
5. **导出数据** → 支持文件夹输出、WSW演示文件、Excel/CSV/MD/TXT 表格

### 2. 使用抓取方案模板（v2.0.0 新增）

1. 进入「AI 工作流」模块
2. 点击「➕ 新建任务」→ 选择任务类型（template 末端抓取 / crosspage 跨页抓取）
3. Step 1 顶部点击「📂 导入抓取方案模板」
4. 选择内置模板（如「嵌入式工程师招聘」）或用户自定义模板
5. 模板自动填入 sampleUrls / fields / urls / 任务名
6. Step 2 可自由修改字段（增删改）或通过可视化拾取添加新字段
7. Step 3 填入目标 URL（多个）
8. Step 4 设置存放地址（必选）和自动导出选项，保存任务
9. 点击「▶ 运行」执行任务，结果自动保存到指定目录
10. 可选：Step 4 点击「💾 另存为模板」把当前配置保存为用户模板供下次复用

### 3. HT 编辑器统计图分析（v2.0.0 增强）

1. 进入「HT 编辑器」模块，新建文档
2. 添加 Excel 容器，点击⚙ → 「📂 导入数据」选择 CSV/JSON/XLSX 文件
3. 添加 chartCard，点击⚙ 选择数据模式：
   - `source` 模式：绑定 Excel 容器作为数据源，可配置分组列/数值列/聚合方式/分箱大小
   - `inline` 模式：直接在配置面板手工录入二元组表格
4. 选择图表类型（柱状图/饼图/折线图/词云）
5. 点击「保存为 HTML」导出自包含 HTML，浏览器打开即可查看统计图

### 4. 招聘数据抓取与分析（HR/BOSS 视角）

1. 导入「嵌入式工程师招聘」模板
2. 在 Step 3 填入 BOSS 直聘/智联/前程无忧等目标 URL
3. 运行任务，抓取字段含：职位名/薪资/地区/学历/经验/技能/公司名/规模/行业/融资阶段/参保人数
4. 进入 HT 编辑器，导入抓取结果 JSON
5. 用 chartCard 按薪资分箱生成柱状图（如 0-5k、5k-10k、10k-15k 职位数量分布）
6. 按地区分组生成饼图（各地区职位占比）
7. 按公司规模聚合生成折线图（不同规模公司的薪资趋势）

---

## 内置抓取方案模板

| 分类 | 模板 | 字段 |
|------|------|------|
| 招聘 | 嵌入式工程师 | 职位名/薪资/地区/学历/经验/技能/公司名/规模/行业 |
| 招聘 | 机器人工程师 | 同上 + 机器人方向 |
| 招聘 | 机械视觉工程师 | 同上 + 视觉方向 |
| 评论 | 热门视频评论 | 评论内容/用户名/IP 属地/点赞数/回复时间 |
| 商品 | 商品性价比 | 商品名/价格/销量/评分/店铺名/店铺评分/URL |
| 商品 | 同类商品对比 | 同上 + 品牌/规格/售后服务 |

模板文件位于 `assets/templates/`，用户自定义模板保存在 `userData/data/user_templates/`。

---

## 项目结构

```
web-scout/
├── src/
│   ├── main/                  # Electron 主进程
│   │   ├── index.js           # 主进程入口（窗口管理、IPC、下载、模板系统）
│   │   ├── ai-helper.js       # AI 辅助（选择器生成、字段推断、结果分类、总结）
│   │   ├── mcp-server.js      # MCP 服务端
│   │   └── mcp-stdio.js       # MCP stdio 传输
│   ├── preload/
│   │   └── index.js           # 安全 API 桥
│   └── renderer/              # 渲染进程（界面）
│       ├── index.html         # 主界面（抓取模块）
│       ├── app.js             # 应用逻辑（标签管理、资源渲染、导出）
│       ├── webview-preload.js # 网页注入脚本（资源扫描、元素高亮）
│       ├── aiworkflow.js      # AI 工作流（任务向导、模板系统）
│       ├── aiworkflow.css      # AI 工作流样式
│       ├── workflow.js        # 抓取信息卡片管理
│       ├── workflow.html
│       ├── wsw-editor.js      # HT 编辑器（Canvas 自绘统计图）
│       ├── wsw-editor.html
│       ├── wsw-engine.js      # WSW 引擎
│       └── dashboard.html
├── assets/
│   ├── icon.ico               # Windows 图标
│   ├── icon.png               # Linux 图标
│   └── templates/             # 内置抓取方案模板
│       ├── recruitment/       # 招聘模板×3
│       ├── comments/          # 评论模板×1
│       └── products/          # 商品模板×2
├── .trae/specs/               # Spec 驱动开发规划文档
├── CHANGELOG.md               # 变更日志
├── package.json
└── README.md
```

---

## 技术栈

- **Electron 28** - 桌面应用框架
- **原生 HTML/CSS/JS** - 轻量级界面，无前端框架依赖
- **XLSX** - Excel 文件读写
- **PDFKit** - PDF 文档生成
- **docx** - Word 文档生成
- **@modelcontextprotocol/sdk** - MCP 协议支持

---

## 开发日志（TRAE 实践过程）

本项目全程使用 **TRAE IDE** 开发，采用 Spec 驱动开发模式（spec.md / tasks.md / checklist.md 三件套），规划文档保存在 `.trae/specs/`。

### 阶段一：基础浏览器框架
- 使用 TRAE 搭建 Electron 主进程 + 渲染进程架构
- 实现多标签页浏览、地址栏导航、前进后退

### 阶段二：资源扫描引擎
- 通过 `webview-preload.js` 注入页面，自动识别图片/视频/音频/链接/文本
- 实现鼠标悬停高亮、点击选中交互

### 阶段三：IDM式并行下载
- 实现 HTTP Range 分块并行下载
- 实时进度条显示（已下载MB / 总大小MB）
- 支持 B站视频专用下载通道

### 阶段四：多格式导出
- 文件夹输出：按类型分类保存
- WSW演示文件：网格布局展示资源
- Excel/CSV/MD/TXT 表格：多媒体按行列输出

### 阶段五：HT 编辑器与 AI 工作流
- Qt5 风格画布，多种卡片类型
- AI 工作流：crosspage/template/tracking 任务类型，链式运行
- MCP 服务端，支持外部工具调用

### 阶段六：v2.0.0 升级
- HT 编辑器统计图增强：CSV/JSON/XLSX 导入、分组聚合、薪资分箱、导出 HTML 渲染
- 抓取方案模板系统：6 个内置模板 + 用户模板 CRUD
- 全局默认导出目录 + 任务级临时路径覆盖
- Windows + Linux 双平台发布

---

## 注意事项

- 本应用仅供合法合规的数据采集使用
- 请遵守目标网站的 robots.txt 协议
- 不要用于爬取受版权保护的内容
- 仅供学习和个人使用
- 主流招聘/电商/视频网站有反爬机制，部分网站需手动登录后再抓取

---

## License

MIT
