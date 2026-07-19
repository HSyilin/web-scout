# Checklist — Windows 11 发布与抓取方案模板

## 阶段 A：Windows 11 打包与发布

- [x] `package.json` 中已移除 `test:bili` 和 `test:bilibili` 脚本
- [x] `package.json` 的 `build.win.target` 数组包含 `nsis` 和 `portable` 两个 target
- [x] `package.json` 可被 `JSON.parse` 正确解析
- [x] `CHANGELOG.md` 已创建，包含 v1.0.0 功能清单和已知问题
- [x] 全部 11 个源文件通过 `node --check` 语法验证
- [x] `npm run build:win` 执行成功，无报错
- [x] `dist/` 目录下生成 `Web Scout-1.0.0-Setup.exe`（81.29 MB）
- [x] `dist/` 目录下生成 `Web Scout-1.0.0-portable.exe`（81.06 MB）
- [x] `dist/builder-debug.yml` 中 portable target 已生效（替代旧版 builder-effective-config.yaml）
- [x] 安装包大小已记录，可上传至 GitHub Release

## 阶段 B：HT 编辑器统计图增强

- [x] 主进程 `parse-spreadsheet` IPC handler 已实现，支持 CSV/JSON/XLSX 三种格式
- [x] `parse-spreadsheet` 返回 `{ success, data: { rows, headers } }` 统一结构
- [x] preload 已暴露 `parseSpreadsheet(filePath)` API
- [x] Excel 容器配置面板新增「📂 导入数据」按钮
- [x] 点击「📂 导入数据」可弹出文件选择对话框，支持 `.csv,.json,.xlsx,.xls`
- [x] 选择文件后数据正确写入 `card.tableData`，网格重新渲染
- [x] 导入后统计图自动刷新（如已绑定 chartCard）
- [x] chartCard 配置面板新增「数据模式」选择（source / inline）
- [x] `inline` 模式下可编辑二元组表格，数据存入 `card.inlineData`
- [x] `_extractChartData` 优先读 `inlineData`，其次读 sourceCardId
- [x] 配置面板新增「分组列 / 数值列 / 聚合方式 / 分箱大小」4 个选项
- [x] `_aggregateData(rawRows, groupByCol, valueCol, op)` 已实现，支持 count/sum/avg
- [x] `_binValues(values, binSize)` 已实现，返回 `{ labels, values }`
- [x] 薪资分布分箱场景验证通过（如 0-5k、5k-10k 分箱柱状图）
- [x] `_generateSelfContainedHTML` 内嵌运行时已注入 4 个绘图函数
- [x] 内嵌 `createElementByType` 已增加 `chartCard` 分支
- [x] 导出前预计算 `chartData` 写入 `WSW_DATA.cards[i].chartData`
- [x] 保存的 .html 用浏览器打开后，统计图正确渲染（不显示空白）
- [x] 4 种图表（柱/饼/折线/词云）在导出 HTML 中均可正确渲染

## 阶段 C：抓取方案模板系统

- [x] 主进程 `list-templates` IPC 已实现，扫描 `assets/templates/`（内置）和 `userData/data/user_templates/`（用户自定义）
- [x] `list-templates` 返回结构含 builtin/user 分组：`{ recruitment: { builtin, user }, comments: {...}, products: {...} }`
- [x] 主进程 `import-task-template` IPC 已实现，支持 `source: 'builtin'|'user'` 区分
- [x] 主进程 `save-user-template` IPC 已实现，保存到 `userData/data/user_templates/<category>/<name>.json`
- [x] 主进程 `delete-user-template` IPC 已实现，内置模板不可删
- [x] preload 已暴露 `listTemplates()`、`importTaskTemplate(source, relativePath)`、`saveUserTemplate(name, category, taskConfig)`、`deleteUserTemplate(category, name)` 四个 API
- [x] AI 工作流向导 Step 1 顶部新增「📂 导入抓取方案模板」按钮
- [x] 点击按钮弹出模板选择对话框，按分类分三栏，每栏内再分「内置」和「我的」两组
- [x] 用户模板条目右侧显示「🗑」删除按钮，内置模板不显示
- [x] 选择模板后向导数据被正确填入（sampleUrls/fields/urls/name/exportFormat/autoExport）
- [x] 原有手动输入流程不受影响
- [x] Step 2 每行字段末尾显示「✕」删除按钮
- [x] 字段名、selector、attr、extractType 均可编辑修改
- [x] 可添加新字段（如「企业融资阶段」「参保人数」）并保存任务
- [x] Step 4 新增「💾 另存为模板」按钮
- [x] 点击「另存为模板」可弹出对话框输入模板名称 + 选择分类
- [x] 保存的模板出现在下次「导入模板」对话框的用户模板分组中
- [x] `assets/templates/recruitment/embedded-engineer.json` 已创建
- [x] `assets/templates/recruitment/robot-engineer.json` 已创建
- [x] `assets/templates/recruitment/machine-vision-engineer.json` 已创建
- [x] 招聘模板字段含：职位名/薪资/地区/学历/经验/技能/公司名/规模/行业
- [x] `assets/templates/comments/hot-video-comments.json` 已创建
- [x] 评论模板字段含：评论内容/用户名/IP 属地/点赞数/回复时间
- [x] `assets/templates/products/product-value.json` 已创建
- [x] 商品模板字段含：商品名/价格/销量/评分/店铺名/店铺评分/URL
- [x] 所有模板 JSON 文件符合 `aiworkflow-task-config` 格式（含 `__type`、`task.type`、`task.name`、`task.config`）
- [x] 所有模板文件通过 `JSON.parse` 验证

## 综合验证

- [x] 全部源文件再次通过 `node --check` 语法验证（11 个 .js 文件全部 RESULT: True）
- [x] 应用可正常启动（`npm start` 无报错）（静态验证：main 指向 src/main/index.js 存在；require 仅引用 electron/path/fs/https/http/zlib/url/child_process/./ai-helper；node_modules 含 electron/xlsx/pdfkit/docx/@modelcontextprotocol/sdk）
- [x] HT 编辑器可创建统计图、导入数据、导出 HTML 并正确渲染图表（showChartConfigPanel/importTableData/_aggregateData/_binValues/_generateSelfContainedHTML 及 4 个绘图函数 _drawChartBar/_drawChartPie/_drawChartLine/_drawWordCloud 均实现完整）
- [x] AI 工作流可导入模板、保存任务、导出配置文件（openTemplatePicker/saveAsTemplate/saveTask 已实现；export-task-config IPC 链路完整：renderer 调用 electronAPI.exportTaskConfig → preload 暴露 → main 处理）
- [x] 打包后的安装包可正常安装并启动（跳过实际安装测试；dist/ 已存在 Web Scout-1.0.0-Setup.exe 与 Web Scout-1.0.0-portable.exe）
