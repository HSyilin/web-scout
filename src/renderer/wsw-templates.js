// HT 编辑器文档模板库
// 提供内置文档模板，用户可在 HT 编辑器中一键应用
// 每个模板结构对齐 _generateSelfContainedHTML 输出的 wswData 格式

const WSW_TEMPLATES = {
  // ===== 职业行情分析报告（嵌入式工程师） =====
  'career-report-embedded': {
    name: '职业行情分析报告 · 嵌入式工程师',
    icon: '📊',
    category: '行业报告',
    description: '基于招聘网站抓取数据的职业行情深度分析报告，含薪资分布、城市分布、学历经验要求、技能词云、行业分布、岗位详情、求职招聘建议等完整章节',
    doc: {
      version: '2.0',
      title: '嵌入式工程师职业行情分析报告',
      background: { type: 'color', value: '#1a1a2e' },
      showGrid: false,
      globalTimestamp: {
        created: 0,
        modified: 0,
        timezone: 'Asia/Shanghai'
      },
      defaultTTL: 0,
      cards: [
        // ============ Row 1: 封面 ============
        {
          id: 1001,
          type: 'htmlBlock',
          name: '报告封面',
          x: 30, y: 30, w: 820, h: 200, z: 1,
          htmlContent: '<div class="report-cover">' +
            '<div class="report-tag">INDUSTRY REPORT · 2026 Q3</div>' +
            '<h1>嵌入式工程师职业行情分析报告</h1>' +
            '<div class="report-subtitle">基于 BOSS 直聘 / 智联招聘 / 前程无忧 多平台抓取数据</div>' +
            '<div class="report-meta">' +
              '<span>📅 报告周期：2026-07-01 至 2026-07-21</span>' +
              '<span>📦 样本量：1,247 条有效岗位</span>' +
              '<span>🗺 覆盖城市：28 个</span>' +
              '<span>🏢 覆盖企业：896 家</span>' +
            '</div>' +
            '<div class="report-footer">Web Scout · 智能数据洞察 | 自动生成于 ' + new Date().toLocaleString('zh-CN') + '</div>' +
          '</div>',
          cssContent: '.report-cover{padding:28px 36px;height:100%;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);color:#fff;border-radius:10px;font-family:"Microsoft YaHei",sans-serif;box-sizing:border-box;}' +
            '.report-tag{display:inline-block;padding:4px 14px;background:rgba(79,195,247,0.2);border:1px solid #4fc3f7;color:#4fc3f7;font-size:11px;letter-spacing:2px;border-radius:20px;margin-bottom:12px;}' +
            '.report-cover h1{font-size:28px;font-weight:700;margin:0 0 8px 0;background:linear-gradient(90deg,#4fc3f7,#b39ddb);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}' +
            '.report-subtitle{font-size:13px;color:#a8a8c8;margin-bottom:18px;}' +
            '.report-meta{display:flex;flex-wrap:wrap;gap:18px;font-size:12px;color:#e0e0ee;margin-bottom:18px;}' +
            '.report-footer{font-size:11px;color:#7a7a9a;border-top:1px solid rgba(255,255,255,0.1);padding-top:10px;}'
        },

        // ============ Row 2: 核心摘要 ============
        {
          id: 1002,
          type: 'textbox',
          name: '核心摘要',
          x: 30, y: 260, w: 820, h: 240, z: 2,
          mdView: true,
          content: '## 📌 核心摘要\n\n' +
            '> **关键发现**：嵌入式工程师岗位需求稳定增长，**平均薪资 ¥18,547/月**，中位数 ¥17,000/月，薪资分位数 P75 达 ¥24,000/月。\n\n' +
            '### 🎯 核心指标\n' +
            '| 指标 | 数值 | 同比变化 |\n' +
            '|------|------|----------|\n' +
            '| 样本岗位数 | 1,247 | +12.3% |\n' +
            '| 平均月薪 | ¥18,547 | +8.6% |\n' +
            '| 薪资中位数 | ¥17,000 | +6.2% |\n' +
            '| 招聘企业数 | 896 | +15.8% |\n' +
            '| 主要城市集中度 | TOP5 占 68.4% | -2.1% |\n\n' +
            '### 💡 三大趋势\n' +
            '1. **薪资上涨**：受物联网、新能源汽车、机器人产业拉动，资深嵌入式工程师薪资同比上涨 8.6%\n' +
            '2. **城市扩散**：除北上深杭外，成都、武汉、西安岗位增速超过 20%\n' +
            '3. **技能升级**：RTOS（FreeRTOS/RT-Thread）、Linux 驱动、ARM Cortex-M 成为高频要求，传统 51 单片机需求下降'
        },

        // ============ Row 3: 薪资分布 ============
        {
          id: 1003,
          type: 'chartCard',
          name: '薪资分布柱状图',
          x: 30, y: 540, w: 400, h: 300, z: 3,
          chartType: 'bar',
          sourceCardId: null,
          inlineData: {
            labels: ['<8K', '8-12K', '12-18K', '18-25K', '25-35K', '35-50K', '>50K'],
            values: [78, 187, 342, 298, 213, 98, 31]
          },
          chartData: null
        },
        {
          id: 1004,
          type: 'textbox',
          name: '薪资分布解读',
          x: 440, y: 540, w: 410, h: 300, z: 3,
          mdView: true,
          content: '## 💰 薪资分布分析\n\n' +
            '### 分布特征\n' +
            '- **主峰区间**：12-18K（27.4%）+ 18-25K（23.9%），合计占 51.3%\n' +
            '- **高薪区间**：25K+ 占比 27.4%（25-35K 17.1% + 35-50K 7.9% + 50K+ 2.5%）\n' +
            '- **入门区间**：<8K 仅占 6.3%，多为应届或实习岗\n\n' +
            '### 关键洞察\n' +
            '1. **薪资中位数高于平均数**：表明高薪岗位拉高了均值，多数岗位集中在 12-25K 区间\n' +
            '2. **35K+ 高薪岗位占比 10.4%**：主要分布在自动驾驶、芯片、AIoT 领域\n' +
            '3. **薪资跨度大**：最低 6K 到最高 80K，反映资深程度差异显著\n\n' +
            '> 💡 **建议**：3 年以下经验聚焦 12-18K 区间合理，5 年以上可冲击 25K+'
        },

        // ============ Row 4: 城市分布 ============
        {
          id: 1005,
          type: 'chartCard',
          name: '城市分布饼图',
          x: 30, y: 890, w: 400, h: 320, z: 4,
          chartType: 'pie',
          sourceCardId: null,
          inlineData: {
            labels: ['深圳', '上海', '北京', '杭州', '广州', '成都', '武汉', '西安', '其他'],
            values: [218, 187, 165, 124, 98, 89, 76, 68, 222]
          },
          chartData: null
        },
        {
          id: 1006,
          type: 'table',
          name: '城市薪资对比表',
          x: 440, y: 890, w: 410, h: 320, z: 4,
          tableData: [
            ['城市', '岗位数', '平均薪资', '中位数', '最低', '最高'],
            ['深圳', '218', '¥21,348', '¥20,000', '¥8K', '¥65K'],
            ['上海', '187', '¥22,108', '¥21,000', '¥9K', '¥70K'],
            ['北京', '165', '¥21,876', '¥20,500', '¥10K', '¥80K'],
            ['杭州', '124', '¥19,542', '¥18,500', '¥8K', '¥55K'],
            ['广州', '98', '¥17,234', '¥16,000', '¥7K', '¥45K'],
            ['成都', '89', '¥15,876', '¥15,000', '¥6K', '¥35K'],
            ['武汉', '76', '¥14,892', '¥14,000', '¥6K', '¥32K'],
            ['西安', '68', '¥13,548', '¥13,000', '¥5K', '¥28K']
          ]
        },

        // ============ Row 5: 学历 + 经验 ============
        {
          id: 1007,
          type: 'chartCard',
          name: '学历要求分布',
          x: 30, y: 1260, w: 400, h: 280, z: 5,
          chartType: 'bar',
          sourceCardId: null,
          inlineData: {
            labels: ['不限', '大专', '本科', '硕士', '博士'],
            values: [45, 168, 856, 172, 6]
          },
          chartData: null
        },
        {
          id: 1008,
          type: 'chartCard',
          name: '经验-薪资关系图',
          x: 440, y: 1260, w: 410, h: 280, z: 5,
          chartType: 'line',
          sourceCardId: null,
          inlineData: {
            labels: ['应届', '1年', '2年', '3年', '5年', '7年', '10年+'],
            values: [9500, 12500, 15500, 18500, 24000, 32000, 45000]
          },
          chartData: null
        },

        // ============ Row 6: 技能词云 + 表 ============
        {
          id: 1009,
          type: 'chartCard',
          name: '技能需求词云',
          x: 30, y: 1600, w: 400, h: 320, z: 6,
          chartType: 'wordcloud',
          sourceCardId: null,
          inlineData: {
            labels: ['C语言', 'C++', 'RTOS', 'Linux', 'ARM', 'STM32', 'FreeRTOS', '驱动开发', 'UART', 'SPI', 'I2C', 'CAN', '嵌入式', 'MCU', 'PCB', '硬件', '通信', '协议', 'Python', 'Shell', 'Git', '硬件设计', 'DSP', 'FPGA', '电机控制', '电源', '物联网', 'BLE', 'WiFi', 'USB'],
            values: [986, 642, 524, 712, 468, 398, 287, 412, 256, 234, 218, 287, 1024, 387, 198, 312, 267, 245, 178, 156, 213, 287, 134, 167, 198, 156, 234, 178, 145, 167]
          },
          chartData: null
        },
        {
          id: 1010,
          type: 'table',
          name: '高频技能 TOP 20',
          x: 440, y: 1600, w: 410, h: 320, z: 6,
          tableData: [
            ['排名', '技能', '出现次数', '占比', '同比变化'],
            ['1', 'C 语言', '986', '79.1%', '+3.2%'],
            ['2', '嵌入式开发', '1024', '82.1%', '+5.8%'],
            ['3', 'Linux', '712', '57.1%', '+8.4%'],
            ['4', 'C++', '642', '51.5%', '+4.1%'],
            ['5', 'RTOS', '524', '42.0%', '+12.6%'],
            ['6', 'ARM', '468', '37.5%', '+6.7%'],
            ['7', '驱动开发', '412', '33.0%', '+9.2%'],
            ['8', 'STM32', '398', '31.9%', '+2.1%'],
            ['9', 'MCU', '387', '31.0%', '-1.4%'],
            ['10', '硬件设计', '312', '25.0%', '+4.8%'],
            ['11', 'FreeRTOS', '287', '23.0%', '+18.5%'],
            ['12', 'CAN 总线', '287', '23.0%', '+15.2%'],
            ['13', '物联网', '234', '18.8%', '+22.1%'],
            ['14', 'SPI', '234', '18.8%', '+1.2%'],
            ['15', 'Git', '213', '17.1%', '+8.7%'],
            ['16', 'UART', '256', '20.5%', '-0.8%'],
            ['17', '通信协议', '245', '19.6%', '+3.4%'],
            ['18', 'I2C', '218', '17.5%', '+0.5%'],
            ['19', 'PCB 设计', '198', '15.9%', '+2.3%'],
            ['20', '电机控制', '198', '15.9%', '+16.8%']
          ]
        },

        // ============ Row 7: 行业 + 企业规模 ============
        {
          id: 1011,
          type: 'chartCard',
          name: '行业分布饼图',
          x: 30, y: 1970, w: 400, h: 300, z: 7,
          chartType: 'pie',
          sourceCardId: null,
          inlineData: {
            labels: ['物联网/IoT', '汽车电子', '智能制造', '消费电子', '通信设备', '医疗器械', '机器人', '芯片半导体', '其他'],
            values: [218, 187, 156, 142, 124, 89, 78, 156, 97]
          },
          chartData: null
        },
        {
          id: 1012,
          type: 'table',
          name: '企业规模分布',
          x: 440, y: 1970, w: 410, h: 300, z: 7,
          tableData: [
            ['企业规模', '岗位数', '占比', '平均薪资', '典型代表'],
            ['10000+ 人', '287', '23.0%', '¥21,548', '华为/比亚迪/大疆'],
            ['1000-9999 人', '342', '27.4%', '¥19,876', '中兴/汇川/海康'],
            ['500-999 人', '198', '15.9%', '¥18,234', '兆易创新/全志'],
            ['100-499 人', '267', '21.4%', '¥16,548', '中小型科技公司'],
            ['20-99 人', '124', '9.9%', '¥15,234', '初创公司'],
            ['<20 人', '29', '2.3%', '¥13,876', '工作室/小微']
          ]
        },

        // ============ Row 8: 精选岗位详情 ============
        {
          id: 1013,
          type: 'table',
          name: '精选岗位详情',
          x: 30, y: 2330, w: 820, h: 400, z: 8,
          tableData: [
            ['职位名称', '公司', '薪资', '城市', '学历', '经验', '核心技能'],
            ['嵌入式软件工程师', '深圳·大疆创新', '¥25-40K·14薪', '深圳', '本科', '3-5年', 'C/RTOS/Linux/ARM'],
            ['高级嵌入式工程师', '上海·比亚迪汽车', '¥30-50K·15薪', '上海', '本科', '5-7年', 'C++/CAN/电机控制'],
            ['嵌入式Linux开发工程师', '北京·华为', '¥35-60K·14薪', '北京', '硕士', '5-10年', 'Linux/驱动/ARM'],
            ['MCU嵌入式工程师', '杭州·海康威视', '¥18-30K·13薪', '杭州', '本科', '3-5年', 'STM32/FreeRTOS/C'],
            ['嵌入式系统工程师', '广州·汇川技术', '¥20-35K·14薪', '广州', '本科', '3-5年', 'C/RTOS/电机控制'],
            ['嵌入式软件专家', '北京·地平线机器人', '¥45-70K·14薪', '北京', '硕士', '7-10年', 'C++/Linux/AI芯片'],
            ['嵌入式开发工程师', '成都·中电科', '¥15-25K·13薪', '成都', '本科', '3-5年', 'C/ARM/通信协议'],
            ['汽车电子嵌入式工程师', '上海·蔚来汽车', '¥28-45K·14薪', '上海', '本科', '5-7年', 'C/CAN/AUTOSAR'],
            ['IoT嵌入式工程师', '深圳·涂鸦智能', '¥18-30K·13薪', '深圳', '本科', '3-5年', 'C/WiFi/BLE/云对接'],
            ['嵌入式驱动工程师', '武汉·烽火通信', '¥15-25K·13薪', '武汉', '本科', '3-5年', 'Linux/驱动/设备树']
          ]
        },

        // ============ Row 9: 三栏建议 ============
        {
          id: 1014,
          type: 'textbox',
          name: '求职者建议',
          x: 30, y: 2790, w: 265, h: 280, z: 9,
          mdView: true,
          content: '## 🎯 求职者建议\n\n' +
            '### 技能提升路径\n' +
            '1. **基础扎实**：C 语言 + 操作系统原理 + 计算机组成\n' +
            '2. **进阶方向**：\n' +
            '   - RTOS 方向：FreeRTOS / RT-Thread\n' +
            '   - Linux 方向：驱动开发 / 内核裁剪\n' +
            '   - 行业方向：汽车电子 / IoT / 机器人\n' +
            '3. **加分技能**：Python / Shell / Git / 硬件设计\n\n' +
            '### 薪资谈判策略\n' +
            '- **3 年经验**：瞄准 18-25K 区间\n' +
            '- **5 年经验**：可冲 25-35K\n' +
            '- **高薪赛道**：汽车电子、AI 芯片、自动驾驶\n\n' +
            '### 城市选择\n' +
            '- **一线**：北上深杭薪资高但压力大\n' +
            '- **新一线**：成都/武汉/西安性价比高'
        },
        {
          id: 1015,
          type: 'textbox',
          name: '招聘方建议',
          x: 305, y: 2790, w: 265, h: 280, z: 9,
          mdView: true,
          content: '## 🏢 招聘方建议\n\n' +
            '### 薪资定位策略\n' +
            '- **一线城市**：3 年经验 20K+，5 年 30K+\n' +
            '- **新一线城市**：可比一线低 15-25%\n' +
            '- **稀缺岗位**：自动驾驶/AI 芯片需溢价 20-30%\n\n' +
            '### 人才吸引\n' +
            '1. **突出技术栈**：明确 RTOS/Linux/ARM 等具体方向\n' +
            '2. **股权激励**：初创公司可用期权弥补现金差距\n' +
            '3. **远程办公**：扩大人才池至全国\n' +
            '4. **项目亮点**：强调产品落地与行业前景\n\n' +
            '### 渠道选择\n' +
            '- **主力渠道**：BOSS 直聘 / 智联 / 前程无忧\n' +
            '- **高端人才**：猎聘 / 内推\n' +
            '- **应届生**：校招 + 实习转正'
        },
        {
          id: 1016,
          type: 'textbox',
          name: '行业趋势预测',
          x: 580, y: 2790, w: 270, h: 280, z: 9,
          mdView: true,
          content: '## 📈 行业趋势预测\n\n' +
            '### 2026-2027 增长点\n' +
            '1. **新能源汽车**：车载嵌入式需求持续爆发\n' +
            '2. **AIoT**：边缘 AI 推理芯片带动高薪岗位\n' +
            '3. **机器人**：人形机器人/工业机器人双轮驱动\n' +
            '4. **工业互联网**：制造业升级释放大量需求\n\n' +
            '### 风险与挑战\n' +
            '- **同质化竞争**：基础 MCU 岗位或被 AI 辅助工具替代\n' +
            '- **跨学科要求**：纯软件背景需补充硬件知识\n' +
            '- **地域集中**：一线高房价劝退部分人才\n\n' +
            '### 未来 3 年薪资预测\n' +
            '| 经验 | 2026 | 2027 | 2028 |\n' +
            '|------|------|------|------|\n' +
            '| 3年 | 18K | 20K | 22K |\n' +
            '| 5年 | 25K | 28K | 32K |\n' +
            '| 7年 | 35K | 39K | 44K |'
        },

        // ============ Row 10: 数据说明 ============
        {
          id: 1017,
          type: 'textbox',
          name: '数据说明与方法论',
          x: 30, y: 3110, w: 820, h: 220, z: 10,
          mdView: true,
          content: '## 📋 数据说明与分析方法\n\n' +
            '### 数据来源\n' +
            '- **抓取平台**：BOSS 直聘、智联招聘、前程无忧、拉勾网、猎聘（用户登录后手动抓取模式）\n' +
            '- **抓取时间**：2026-07-01 至 2026-07-21，共 21 天\n' +
            '- **样本规模**：1,247 条有效岗位（去重后），896 家企业，覆盖 28 个城市\n' +
            '- **数据采集**：通过 Web Scout 应用抓取方案模板「嵌入式工程师招聘抓取」执行\n\n' +
            '### 分析方法\n' +
            '1. **薪资标准化**：将"15-25K·14薪"转换为月度等效薪资（年薪/14）\n' +
            '2. **城市归一化**：将"深圳·南山"等区域信息归并到城市级别\n' +
            '3. **技能分词**：基于 Jieba 分词 + 自定义专业词典提取技能关键词\n' +
            '4. **去重策略**：相同公司 + 相同职位名 + 相同薪资视为重复\n\n' +
            '### 局限性\n' +
            '- **样本偏差**：仅覆盖主动发布招聘的企业，未含猎头/内推岗位\n' +
            '- **时效性**：数据为 7 月单月快照，季节性波动未完全消除\n' +
            '- **地域偏向**：一线城市样本占比 56%，可能高估全国平均薪资\n' +
            '- **平台差异**：不同平台用户群体不同，综合数据可能存在偏差\n\n' +
            '> ⚠️ **免责声明**：本报告基于公开抓取数据，仅供求职/招聘参考，不构成投资或职业决策的唯一依据。'
        },

        // ============ Row 11: 关联工作流 ============
        {
          id: 1018,
          type: 'htmlBlock',
          name: '关联工作流说明',
          x: 30, y: 3360, w: 820, h: 180, z: 11,
          htmlContent: '<div class="workflow-link-card">' +
            '<div class="wlc-title">🤖 关联 AI 工作流</div>' +
            '<div class="wlc-desc">本报告由 Web Scout 的 AI 工作流自动抓取 + HT 编辑器可视化生成。点击下方「🤖 AI 工作流」按钮可绑定招聘抓取任务，实现数据自动更新。</div>' +
            '<div class="wlc-steps">' +
              '<div class="wlc-step"><span class="num">1</span><span>在「AI 工作流」模块导入招聘抓取方案模板</span></div>' +
              '<div class="wlc-step"><span class="num">2</span><span>执行任务抓取 BOSS/智联/前程无忧招聘数据</span></div>' +
              '<div class="wlc-step"><span class="num">3</span><span>回到 HT 编辑器，右键图表 → 配置 → 数据源选择 Excel 容器</span></div>' +
              '<div class="wlc-step"><span class="num">4</span><span>从 Excel 容器导入抓取数据，图表自动刷新</span></div>' +
            '</div>' +
            '<div class="wlc-tip">💡 提示：可在「全局设置 → MCP 服务」开启 MCP，让外部 AI（如 TRAE Work）直接调用本应用自动生成报告</div>' +
          '</div>',
          cssContent: '.workflow-link-card{padding:18px 24px;background:linear-gradient(135deg,#1e1e35,#16213e);border:1px solid #2a2a45;border-radius:10px;color:#e0e0ee;font-family:"Microsoft YaHei",sans-serif;height:100%;box-sizing:border-box;}' +
            '.wlc-title{font-size:15px;font-weight:700;color:#4fc3f7;margin-bottom:8px;}' +
            '.wlc-desc{font-size:11px;color:#a8a8c8;line-height:1.6;margin-bottom:12px;}' +
            '.wlc-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px;}' +
            '.wlc-step{display:flex;align-items:center;gap:8px;font-size:10px;color:#e0e0ee;background:rgba(79,195,247,0.08);padding:8px 10px;border-radius:6px;}' +
            '.wlc-step .num{width:18px;height:18px;border-radius:50%;background:#4fc3f7;color:#0f0f1a;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0;}' +
            '.wlc-tip{font-size:10px;color:#ffd54f;background:rgba(255,213,79,0.08);padding:6px 10px;border-radius:4px;}'
        }
      ]
    }
  },

  // ===== 职业行情分析报告 · 科幻风格 =====
  'career-report-scifi': {
    name: '职业行情分析报告 · 科幻风格',
    icon: '🌌',
    category: '行业报告',
    description: '硬核科幻风格的职业行情分析报告模板：赛博朋克网格背景 + 霓虹青/品红/紫色卡片 + 扫描线特效 + HUD 装饰元素，适合大屏展示与展览模式',
    doc: {
      version: '2.0',
      title: '嵌入式工程师职业行情分析报告 · 科幻版',
      // 直接使用科幻背景类型，应用内会自动渲染网格 + 扫描线 + 光晕
      background: { type: 'scifi-cyber' },
      showGrid: false,
      globalTimestamp: { created: 0, modified: 0, timezone: 'Asia/Shanghai' },
      defaultTTL: 0,
      cards: [
        // ============ 封面：赛博朋克风 ============
        {
          id: 2001,
          type: 'htmlBlock',
          name: '报告封面',
          x: 30, y: 30, w: 820, h: 220, z: 1,
          htmlContent: '<div class="scifi-cover">' +
            '<div class="scan-line"></div>' +
            '<div class="cover-tag">// INDUSTRY_REPORT · 2026.Q3 · EMBEDDED //</div>' +
            '<h1 class="cover-title">嵌入式工程师<br><span class="title-glow">职业行情分析报告</span></h1>' +
            '<div class="cover-sub">> DATA_SOURCE: BOSS_ZHIPIN / ZHILIAN / 51JOB</div>' +
            '<div class="cover-meta">' +
              '<div class="meta-item"><span class="meta-label">PERIOD</span><span class="meta-val">2026-07-01 → 07-21</span></div>' +
              '<div class="meta-item"><span class="meta-label">SAMPLES</span><span class="meta-val">1,247</span></div>' +
              '<div class="meta-item"><span class="meta-label">CITIES</span><span class="meta-val">28</span></div>' +
              '<div class="meta-item"><span class="meta-label">CORPS</span><span class="meta-val">896</span></div>' +
            '</div>' +
            '<div class="cover-footer">> WEB_SCOUT :: DATA_INSIGHT_ENGINE :: AUTO_GENERATED</div>' +
          '</div>',
          cssContent: '.scifi-cover{position:relative;padding:30px 40px;height:100%;background:linear-gradient(135deg,rgba(10,20,40,0.85) 0%,rgba(20,10,40,0.85) 50%,rgba(40,10,30,0.85) 100%);border:1px solid rgba(0,212,255,0.4);border-radius:8px;color:#e0f7ff;font-family:"Consolas","Microsoft YaHei",monospace;box-sizing:border-box;overflow:hidden;}' +
            '.scifi-cover::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#00d4ff,#ff00aa,transparent);}' +
            '.scifi-cover::after{content:"";position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#ff00aa,#00d4ff,transparent);}' +
            '.scan-line{position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#00d4ff,transparent);animation:scanMove 3s linear infinite;}' +
            '@keyframes scanMove{0%{transform:translateY(0)}100%{transform:translateY(220px)}}' +
            '.cover-tag{font-size:11px;color:#00d4ff;letter-spacing:2px;margin-bottom:14px;text-shadow:0 0 8px rgba(0,212,255,0.6);}' +
            '.cover-title{font-size:32px;font-weight:900;margin:0 0 12px 0;color:#fff;line-height:1.2;letter-spacing:1px;}' +
            '.title-glow{background:linear-gradient(90deg,#00d4ff,#ff00aa,#9d4edd);-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:hueShift 6s linear infinite;}' +
            '@keyframes hueShift{0%{filter:hue-rotate(0deg)}100%{filter:hue-rotate(360deg)}}' +
            '.cover-sub{font-size:12px;color:#7df9ff;margin-bottom:18px;font-family:"Consolas",monospace;}' +
            '.cover-meta{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px;}' +
            '.meta-item{background:rgba(0,212,255,0.08);border-left:2px solid #00d4ff;padding:8px 12px;border-radius:0 4px 4px 0;}' +
            '.meta-label{display:block;font-size:9px;color:#00d4ff;letter-spacing:1.5px;margin-bottom:3px;}' +
            '.meta-val{display:block;font-size:14px;color:#fff;font-weight:700;}' +
            '.cover-footer{font-size:10px;color:#5a8aa8;border-top:1px dashed rgba(0,212,255,0.3);padding-top:10px;font-family:"Consolas",monospace;}'
        },

        // ============ 核心摘要：HUD 终端风 ============
        {
          id: 2002,
          type: 'htmlBlock',
          name: '核心摘要',
          x: 30, y: 290, w: 820, h: 260, z: 2,
          htmlContent: '<div class="scifi-summary">' +
            '<div class="summary-header">▌ CORE_SUMMARY</div>' +
            '<div class="summary-grid">' +
              '<div class="metric"><div class="metric-val">1,247</div><div class="metric-label">SAMPLES</div><div class="metric-delta up">▲ +12.3%</div></div>' +
              '<div class="metric"><div class="metric-val">¥18.5K</div><div class="metric-label">AVG_SALARY</div><div class="metric-delta up">▲ +8.6%</div></div>' +
              '<div class="metric"><div class="metric-val">¥17.0K</div><div class="metric-label">MEDIAN</div><div class="metric-delta up">▲ +6.2%</div></div>' +
              '<div class="metric"><div class="metric-val">896</div><div class="metric-label">EMPLOYERS</div><div class="metric-delta up">▲ +15.8%</div></div>' +
            '</div>' +
            '<div class="summary-trends">' +
              '<div class="trend-item"><span class="trend-num">01</span><span class="trend-text"><b>薪资上涨</b>：物联网、新能源汽车、机器人产业拉动，资深岗位薪资同比 +8.6%</span></div>' +
              '<div class="trend-item"><span class="trend-num">02</span><span class="trend-text"><b>城市扩散</b>：成都、武汉、西安岗位增速超过 20%，新一线崛起</span></div>' +
              '<div class="trend-item"><span class="trend-num">03</span><span class="trend-text"><b>技能升级</b>：RTOS / Linux 驱动 / ARM Cortex-M 成高频要求，51 单片机需求下降</span></div>' +
            '</div>' +
          '</div>',
          cssContent: '.scifi-summary{padding:22px 28px;height:100%;background:rgba(5,15,30,0.85);border:1px solid rgba(0,212,255,0.3);border-radius:6px;color:#e0f7ff;font-family:"Consolas","Microsoft YaHei",monospace;box-sizing:border-box;position:relative;}' +
            '.scifi-summary::before{content:"";position:absolute;top:-1px;left:20px;width:40px;height:3px;background:#00d4ff;box-shadow:0 0 8px #00d4ff;}' +
            '.summary-header{font-size:13px;color:#00d4ff;letter-spacing:2px;margin-bottom:14px;text-shadow:0 0 6px rgba(0,212,255,0.5);}' +
            '.summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;}' +
            '.metric{background:linear-gradient(180deg,rgba(0,212,255,0.08),rgba(0,212,255,0.02));border:1px solid rgba(0,212,255,0.25);border-radius:4px;padding:10px;text-align:center;}' +
            '.metric-val{font-size:22px;font-weight:900;color:#fff;text-shadow:0 0 10px rgba(0,212,255,0.6);}' +
            '.metric-label{font-size:9px;color:#00d4ff;letter-spacing:1.5px;margin-top:2px;}' +
            '.metric-delta{font-size:10px;margin-top:3px;}' +
            '.metric-delta.up{color:#00ff9d;}' +
            '.summary-trends{display:flex;flex-direction:column;gap:6px;}' +
            '.trend-item{display:flex;align-items:flex-start;gap:10px;font-size:11px;color:#c0e8ff;line-height:1.5;padding:6px 10px;background:rgba(0,212,255,0.04);border-left:2px solid #ff00aa;}' +
            '.trend-num{color:#ff00aa;font-weight:900;font-size:13px;min-width:24px;text-shadow:0 0 6px rgba(255,0,170,0.6);}' +
            '.trend-text b{color:#00ff9d;}'
        },

        // ============ 薪资分布图：保留原 chartCard ============
        {
          id: 2003,
          type: 'chartCard',
          name: '薪资分布',
          x: 30, y: 590, w: 400, h: 300, z: 3,
          chartType: 'bar',
          sourceCardId: null,
          inlineData: {
            labels: ['<8K', '8-12K', '12-18K', '18-25K', '25-35K', '35-50K', '>50K'],
            values: [78, 187, 342, 298, 213, 98, 31]
          },
          chartData: null
        },

        // ============ 薪资解读：科幻卡片 ============
        {
          id: 2004,
          type: 'htmlBlock',
          name: '薪资分布解读',
          x: 440, y: 590, w: 410, h: 300, z: 3,
          htmlContent: '<div class="scifi-panel">' +
            '<div class="panel-header">▌ SALARY_DISTRIBUTION_ANALYSIS</div>' +
            '<div class="panel-section"><div class="section-title">> 分布特征</div>' +
              '<div class="kv"><span class="k">主峰区间</span><span class="v">12-18K (27.4%) + 18-25K (23.9%) = 51.3%</span></div>' +
              '<div class="kv"><span class="k">高薪区间</span><span class="v">25K+ 占比 27.4%</span></div>' +
              '<div class="kv"><span class="k">入门区间</span><span class="v"><8K 仅 6.3%（应届/实习）</span></div>' +
            '</div>' +
            '<div class="panel-section"><div class="section-title">> 关键洞察</div>' +
              '<div class="insight"><span class="dot"></span>薪资中位数高于平均数 → 高薪岗位拉高均值</div>' +
              '<div class="insight"><span class="dot"></span>35K+ 占比 10.4% → 集中在自动驾驶/芯片/AIoT</div>' +
              '<div class="insight"><span class="dot"></span>薪资跨度 6K~80K → 资深程度差异显著</div>' +
            '</div>' +
            '<div class="panel-tip">> 建议：3 年以下聚焦 12-18K，5 年以上可冲 25K+</div>' +
          '</div>',
          cssContent: '.scifi-panel{padding:18px 22px;height:100%;background:rgba(5,15,30,0.85);border:1px solid rgba(0,212,255,0.3);border-radius:6px;color:#e0f7ff;font-family:"Consolas","Microsoft YaHei",monospace;box-sizing:border-box;}' +
            '.panel-header{font-size:12px;color:#00d4ff;letter-spacing:1.5px;margin-bottom:14px;text-shadow:0 0 6px rgba(0,212,255,0.5);border-bottom:1px solid rgba(0,212,255,0.2);padding-bottom:8px;}' +
            '.panel-section{margin-bottom:12px;}' +
            '.section-title{font-size:11px;color:#ff00aa;margin-bottom:6px;letter-spacing:1px;}' +
            '.kv{display:flex;font-size:10px;color:#c0e8ff;margin-bottom:3px;gap:8px;}' +
            '.k{color:#7df9ff;min-width:70px;}' +
            '.v{color:#e0f7ff;}' +
            '.insight{display:flex;align-items:center;gap:8px;font-size:10px;color:#c0e8ff;margin-bottom:4px;}' +
            '.dot{width:6px;height:6px;border-radius:50%;background:#00ff9d;box-shadow:0 0 6px #00ff9d;flex-shrink:0;}' +
            '.panel-tip{font-size:10px;color:#ffd54f;background:rgba(255,213,79,0.08);padding:6px 10px;border-left:2px solid #ffd54f;margin-top:8px;}'
        },

        // ============ 城市分布饼图 ============
        {
          id: 2005,
          type: 'chartCard',
          name: '城市分布',
          x: 30, y: 930, w: 400, h: 320, z: 4,
          chartType: 'pie',
          sourceCardId: null,
          inlineData: {
            labels: ['深圳', '上海', '北京', '杭州', '广州', '成都', '武汉', '西安', '其他'],
            values: [218, 187, 165, 124, 98, 89, 76, 68, 222]
          },
          chartData: null
        },

        // ============ 城市薪资表 ============
        {
          id: 2006,
          type: 'table',
          name: '城市薪资对比',
          x: 440, y: 930, w: 410, h: 320, z: 4,
          tableData: [
            ['城市', '岗位数', '平均薪资', '中位数', '最低', '最高'],
            ['深圳', '218', '¥21,348', '¥20,000', '¥8K', '¥65K'],
            ['上海', '187', '¥22,108', '¥21,000', '¥9K', '¥70K'],
            ['北京', '165', '¥21,876', '¥20,500', '¥10K', '¥80K'],
            ['杭州', '124', '¥19,542', '¥18,500', '¥8K', '¥55K'],
            ['广州', '98', '¥17,234', '¥16,000', '¥7K', '¥45K'],
            ['成都', '89', '¥15,876', '¥15,000', '¥6K', '¥35K'],
            ['武汉', '76', '¥14,892', '¥14,000', '¥6K', '¥32K'],
            ['西安', '68', '¥13,548', '¥13,000', '¥5K', '¥28K']
          ]
        },

        // ============ 学历 + 经验 ============
        {
          id: 2007,
          type: 'chartCard',
          name: '学历要求分布',
          x: 30, y: 1290, w: 400, h: 280, z: 5,
          chartType: 'bar',
          sourceCardId: null,
          inlineData: { labels: ['不限', '大专', '本科', '硕士', '博士'], values: [45, 168, 856, 172, 6] },
          chartData: null
        },
        {
          id: 2008,
          type: 'chartCard',
          name: '经验-薪资关系',
          x: 440, y: 1290, w: 410, h: 280, z: 5,
          chartType: 'line',
          sourceCardId: null,
          inlineData: {
            labels: ['应届', '1年', '2年', '3年', '5年', '7年', '10年+'],
            values: [9500, 12500, 15500, 18500, 24000, 32000, 45000]
          },
          chartData: null
        },

        // ============ 技能词云 + TOP 表 ============
        {
          id: 2009,
          type: 'chartCard',
          name: '技能需求词云',
          x: 30, y: 1620, w: 400, h: 320, z: 6,
          chartType: 'wordcloud',
          sourceCardId: null,
          inlineData: {
            labels: ['C语言', 'C++', 'RTOS', 'Linux', 'ARM', 'STM32', 'FreeRTOS', '驱动开发', 'UART', 'SPI', 'I2C', 'CAN', '嵌入式', 'MCU', 'PCB', '硬件', '通信', '协议', 'Python', 'Shell', 'Git', '硬件设计', 'DSP', 'FPGA', '电机控制', '电源', '物联网', 'BLE', 'WiFi', 'USB'],
            values: [986, 642, 524, 712, 468, 398, 287, 412, 256, 234, 218, 287, 1024, 387, 198, 312, 267, 245, 178, 156, 213, 287, 134, 167, 198, 156, 234, 178, 145, 167]
          },
          chartData: null
        },
        {
          id: 2010,
          type: 'table',
          name: '高频技能 TOP 10',
          x: 440, y: 1620, w: 410, h: 320, z: 6,
          tableData: [
            ['排名', '技能', '出现次数', '占比', '同比'],
            ['01', '嵌入式开发', '1024', '82.1%', '+5.8%'],
            ['02', 'C 语言', '986', '79.1%', '+3.2%'],
            ['03', 'Linux', '712', '57.1%', '+8.4%'],
            ['04', 'C++', '642', '51.5%', '+4.1%'],
            ['05', 'RTOS', '524', '42.0%', '+12.7%'],
            ['06', 'ARM', '468', '37.5%', '+6.3%'],
            ['07', '驱动开发', '412', '33.0%', '+9.1%'],
            ['08', 'STM32', '398', '31.9%', '+2.4%'],
            ['09', 'MCU', '387', '31.0%', '+1.8%'],
            ['10', '硬件设计', '287', '23.0%', '+4.5%']
          ]
        },

        // ============ 行业分布饼图 ============
        {
          id: 2011,
          type: 'chartCard',
          name: '行业分布',
          x: 30, y: 1980, w: 400, h: 300, z: 7,
          chartType: 'pie',
          sourceCardId: null,
          inlineData: {
            labels: ['物联网/IoT', '汽车电子', '消费电子', '通信设备', '工业控制', '医疗器械', '智能硬件', '其他'],
            values: [287, 213, 198, 156, 134, 89, 98, 72]
          },
          chartData: null
        },
        {
          id: 2012,
          type: 'table',
          name: '企业规模分布',
          x: 440, y: 1980, w: 410, h: 300, z: 7,
          tableData: [
            ['规模', '企业数', '占比', '平均薪资'],
            ['>10000人', '87', '9.7%', '¥24,580'],
            ['1000-10000', '234', '26.1%', '¥21,340'],
            ['500-1000', '198', '22.1%', '¥18,760'],
            ['100-500', '213', '23.8%', '¥16,540'],
            ['50-100', '98', '10.9%', '¥14,890'],
            ['<50人', '66', '7.4%', '¥13,250']
          ]
        },

        // ============ 精选岗位详情表 ============
        {
          id: 2013,
          type: 'table',
          name: '精选高薪岗位',
          x: 30, y: 2320, w: 820, h: 320, z: 8,
          tableData: [
            ['公司', '职位', '薪资', '城市', '经验', '学历'],
            ['蔚来汽车', '嵌入式资深工程师(自动驾驶)', '40-65K·15薪', '上海', '5-10年', '本科'],
            ['大疆创新', '嵌入式软件工程师(飞控)', '35-55K·14薪', '深圳', '3-5年', '本科'],
            ['华为', '嵌入式底层开发工程师', '30-50K·16薪', '深圳', '5-10年', '本科'],
            ['比亚迪', '嵌入式MCU开发工程师', '25-40K·13薪', '深圳', '3-5年', '本科'],
            ['小鹏汽车', '嵌入式系统工程师(域控)', '32-48K·14薪', '广州', '5-10年', '本科'],
            ['中兴通讯', '嵌入式协议栈开发工程师', '25-38K·14薪', '深圳', '3-5年', '本科'],
            ['海康威视', '嵌入式Linux开发工程师', '22-35K·14薪', '杭州', '3-5年', '本科'],
            ['兆易创新', '嵌入式驱动工程师(MCU)', '20-32K·13薪', '北京', '1-3年', '本科'],
            ['汇川技术', '嵌入式电机控制工程师', '22-35K·13薪', '深圳', '3-5年', '本科'],
            ['地平线', '嵌入式AI部署工程师', '35-55K·14薪', '北京', '3-5年', '硕士']
          ]
        },

        // ============ 三栏求职建议 ============
        {
          id: 2014,
          type: 'htmlBlock',
          name: '求职建议',
          x: 30, y: 2680, w: 820, h: 280, z: 9,
          htmlContent: '<div class="scifi-advice">' +
            '<div class="advice-header">▌ STRATEGIC_ADVICE</div>' +
            '<div class="advice-grid">' +
              '<div class="advice-col junior">' +
                '<div class="col-title">[ 应届生 / 0-1年 ]</div>' +
                '<div class="col-salary">期望薪资：8-12K</div>' +
                '<div class="col-items">' +
                  '<div class="item">▸ 主攻 STM32 + FreeRTOS 基础项目实战</div>' +
                  '<div class="item">▸ 补全 UART/SPI/I2C/CAN 通信协议栈</div>' +
                  '<div class="item">▸ GitHub 维护 2-3 个完整嵌入式项目</div>' +
                  '<div class="item">▸ 优先投递中型企业（100-500人）</div>' +
                '</div>' +
              '</div>' +
              '<div class="advice-col mid">' +
                '<div class="col-title">[ 中级 / 3-5年 ]</div>' +
                '<div class="col-salary">期望薪资：18-25K</div>' +
                '<div class="col-items">' +
                  '<div class="item">▸ 深入 Linux 驱动开发 + 设备树</div>' +
                  '<div class="item">▸ 掌握 ARM Cortex-A 架构与裸机开发</div>' +
                  '<div class="item">▸ 主攻自动驾驶 / 新能源 / IoT 赛道</div>' +
                  '<div class="item">▸ 优先投递深圳/上海/北京大厂</div>' +
                '</div>' +
              '</div>' +
              '<div class="advice-col senior">' +
                '<div class="col-title">[ 资深 / 5年+ ]</div>' +
                '<div class="col-salary">期望薪资：30-50K+</div>' +
                '<div class="col-items">' +
                  '<div class="item">▸ 系统架构能力 + 跨模块协同设计</div>' +
                  '<div class="item">▸ 团队带教 + 技术选型决策</div>' +
                  '<div class="item">▸ 关注芯片原厂 / 头部 Tier1 机会</div>' +
                  '<div class="item">▸ 谈薪关注股权 + 多薪制（14-16薪）</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>',
          cssContent: '.scifi-advice{padding:20px 24px;height:100%;background:rgba(5,15,30,0.85);border:1px solid rgba(0,212,255,0.3);border-radius:6px;color:#e0f7ff;font-family:"Consolas","Microsoft YaHei",monospace;box-sizing:border-box;}' +
            '.advice-header{font-size:13px;color:#00d4ff;letter-spacing:2px;margin-bottom:14px;text-shadow:0 0 6px rgba(0,212,255,0.5);}' +
            '.advice-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}' +
            '.advice-col{background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.2);border-radius:4px;padding:12px;}' +
            '.col-title{font-size:12px;color:#ff00aa;font-weight:700;margin-bottom:6px;text-shadow:0 0 6px rgba(255,0,170,0.5);}' +
            '.col-salary{font-size:11px;color:#00ff9d;margin-bottom:8px;font-weight:700;}' +
            '.col-items{display:flex;flex-direction:column;gap:5px;}' +
            '.item{font-size:10px;color:#c0e8ff;line-height:1.5;}'
        },

        // ============ 数据说明 + 工作流关联（科幻 HUD 风）============
        {
          id: 2015,
          type: 'htmlBlock',
          name: '数据说明与工作流',
          x: 30, y: 3000, w: 820, h: 320, z: 10,
          htmlContent: '<div class="scifi-footer">' +
            '<div class="footer-header">▌ DATA_NOTES & WORKFLOW_LINK</div>' +
            '<div class="footer-cols">' +
              '<div class="footer-col">' +
                '<div class="col-header">> 数据采集方法</div>' +
                '<div class="col-line">通过 Web Scout 抓取方案「嵌入式工程师招聘抓取」</div>' +
                '<div class="col-line">▸ 薪资标准化：年薪/14 转月度等效</div>' +
                '<div class="col-line">▸ 城市归一化：区域信息归并到城市级</div>' +
                '<div class="col-line">▸ 技能分词：Jieba + 自定义专业词典</div>' +
                '<div class="col-line">▸ 去重：同公司+同职位+同薪资视为重复</div>' +
              '</div>' +
              '<div class="footer-col">' +
                '<div class="col-header">> 关联 AI 工作流</div>' +
                '<div class="workflow-steps">' +
                  '<div class="wf-step"><span class="wf-num">01</span> AI 工作流导入招聘抓取模板</div>' +
                  '<div class="wf-step"><span class="wf-num">02</span> 执行任务抓取 BOSS/智联/前程</div>' +
                  '<div class="wf-step"><span class="wf-num">03</span> HT 编辑器右键图表→配置→Excel</div>' +
                  '<div class="wf-step"><span class="wf-num">04</span> 导入数据，图表自动刷新</div>' +
                '</div>' +
                '<div class="wf-tip">> 提示：开启 MCP 后可让 TRAE Work 自动生成报告</div>' +
              '</div>' +
            '</div>' +
            '<div class="footer-warn">⚠ 免责声明：基于公开抓取数据，仅供求职/招聘参考，不构成决策唯一依据</div>' +
            '<div class="footer-meta">> WEB_SCOUT :: v1.0 :: GENERATED ' + new Date().toLocaleString('zh-CN') + '</div>' +
          '</div>',
          cssContent: '.scifi-footer{padding:20px 24px;height:100%;background:rgba(5,15,30,0.85);border:1px solid rgba(0,212,255,0.3);border-radius:6px;color:#e0f7ff;font-family:"Consolas","Microsoft YaHei",monospace;box-sizing:border-box;}' +
            '.footer-header{font-size:13px;color:#00d4ff;letter-spacing:2px;margin-bottom:14px;text-shadow:0 0 6px rgba(0,212,255,0.5);border-bottom:1px dashed rgba(0,212,255,0.2);padding-bottom:8px;}' +
            '.footer-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px;}' +
            '.footer-col{background:rgba(0,212,255,0.04);border-left:2px solid #00d4ff;padding:10px 12px;}' +
            '.col-header{font-size:11px;color:#ff00aa;margin-bottom:8px;letter-spacing:1px;}' +
            '.col-line{font-size:10px;color:#c0e8ff;line-height:1.7;}' +
            '.workflow-steps{display:flex;flex-direction:column;gap:5px;}' +
            '.wf-step{display:flex;align-items:center;gap:8px;font-size:10px;color:#c0e8ff;background:rgba(0,212,255,0.05);padding:5px 8px;border-radius:3px;}' +
            '.wf-num{color:#00d4ff;font-weight:900;min-width:20px;text-shadow:0 0 4px rgba(0,212,255,0.6);}' +
            '.wf-tip{font-size:10px;color:#ffd54f;margin-top:6px;padding:5px 8px;background:rgba(255,213,79,0.08);border-left:2px solid #ffd54f;}' +
            '.footer-warn{font-size:10px;color:#ff6b6b;background:rgba(255,107,107,0.08);padding:6px 10px;border-left:2px solid #ff6b6b;margin-bottom:8px;}' +
            '.footer-meta{font-size:10px;color:#5a8aa8;border-top:1px dashed rgba(0,212,255,0.2);padding-top:8px;}'
        }
      ]
    }
  },

  // ===== 数据仪表盘模板（强调多卡片组合的数据洞察）=====
  'data-dashboard': {
    name: '数据仪表盘 · 业务洞察',
    icon: '📈',
    category: '数据洞察',
    description: '数据仪表盘模板：KPI 指标矩阵 + 仪表盘 + 漏斗 + 趋势图 + 进度对比 + 流程图，适合周报/月报/运营复盘',
    doc: {
      version: '2.0',
      title: '业务数据仪表盘',
      background: { type: 'color', value: '#0f1419' },
      showGrid: false,
      globalTimestamp: { created: 0, modified: 0, timezone: 'Asia/Shanghai' },
      defaultTTL: 0,
      cards: [
        // Row 1: 标题栏 + 时间范围
        {
          id: 3001, type: 'htmlBlock', name: '仪表盘标题',
          x: 30, y: 30, w: 820, h: 80, z: 1,
          htmlContent: '<div style="padding:18px 28px;background:linear-gradient(90deg,#1a2332 0%,#0d1b2a 100%);border-left:4px solid #4fc3f7;border-radius:6px;height:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between">' +
            '<div><div style="font-size:10px;color:#4fc3f7;letter-spacing:2px;margin-bottom:4px">DASHBOARD · WEEKLY</div>' +
            '<h1 style="font-size:20px;color:#fff;margin:0">业务运营数据仪表盘</h1></div>' +
            '<div style="text-align:right"><div style="font-size:10px;color:#888">报告周期</div>' +
            '<div style="font-size:13px;color:#4fc3f7;font-family:monospace">2026-07-15 → 07-21</div></div></div>',
          cssContent: ''
        },
        // Row 2: 4 个 KPI 指标卡
        {
          id: 3002, type: 'statCard', name: '核心指标矩阵',
          x: 30, y: 130, w: 820, h: 130, z: 2,
          statItems: [
            { label: '总营收', value: '¥1.2M', sub: '+18.5%', color: '#4fc3f7' },
            { label: '活跃用户', value: '48.6K', sub: '+5.6%', color: '#4dd0c8' },
            { label: '转化率', value: '3.42%', sub: '-0.8%', color: '#ffb74d' },
            { label: '客单价', value: '¥287', sub: '+12.3%', color: '#b39ddb' }
          ]
        },
        // Row 3: 仪表盘 + 漏斗图
        {
          id: 3003, type: 'gaugeCard', name: '月度目标完成率',
          x: 30, y: 280, w: 260, h: 220, z: 3,
          gaugeValue: 78, gaugeMax: 100, gaugeLabel: '月度目标完成', gaugeUnit: '%', gaugeColor: '#4dd0c8'
        },
        {
          id: 3004, type: 'funnelCard', name: '用户转化漏斗',
          x: 310, y: 280, w: 280, h: 220, z: 3,
          funnelStages: [
            { name: '访问', value: 48600, color: '#4fc3f7' },
            { name: '注册', value: 12450, color: '#4dd0c8' },
            { name: '激活', value: 5820, color: '#b39ddb' },
            { name: '付费', value: 1660, color: '#ffb74d' },
            { name: '复购', value: 480, color: '#ff8a65' }
          ]
        },
        {
          id: 3005, type: 'radarCard', name: '业务健康度',
          x: 610, y: 280, w: 240, h: 220, z: 3,
          radarLabels: ['增长', '留存', '变现', '满意度', '活跃'],
          radarValues: [85, 72, 68, 90, 78], radarMax: 100
        },
        // Row 4: 趋势图 + 进度对比
        {
          id: 3006, type: 'chartCard', name: '近 7 日营收趋势',
          x: 30, y: 520, w: 410, h: 260, z: 4,
          chartType: 'line',
          inlineData: {
            labels: ['7/15', '7/16', '7/17', '7/18', '7/19', '7/20', '7/21'],
            values: [158000, 172000, 165000, 189000, 205000, 198000, 224000]
          }, chartData: null
        },
        {
          id: 3007, type: 'progressCard', name: '各部门目标进度',
          x: 460, y: 520, w: 390, h: 260, z: 4,
          progressItems: [
            { label: '销售部', value: 92, color: '#4fc3f7' },
            { label: '市场部', value: 78, color: '#4dd0c8' },
            { label: '产品部', value: 65, color: '#b39ddb' },
            { label: '客服部', value: 88, color: '#ffb74d' },
            { label: '技术部', value: 54, color: '#ff8a65' }
          ], progressMax: 100
        },
        // Row 5: 流程图 + 对比 + 结论
        {
          id: 3008, type: 'flowCard', name: '数据处理流程',
          x: 30, y: 800, w: 820, h: 110, z: 5,
          flowSteps: [
            { name: '数据采集', desc: '多源接入', color: '#4fc3f7' },
            { name: '清洗加工', desc: 'ETL 处理', color: '#4dd0c8' },
            { name: '指标计算', desc: '实时聚合', color: '#b39ddb' },
            { name: '可视化', desc: '图表渲染', color: '#ffb74d' },
            { name: '洞察输出', desc: 'AI 解读', color: '#ff8a65' }
          ]
        },
        {
          id: 3009, type: 'compareCard', name: '本周 vs 上周',
          x: 30, y: 930, w: 410, h: 280, z: 6,
          compareLeftTitle: '上周',
          compareRightTitle: '本周',
          compareLeftItems: ['营收 ¥1.02M', '新增 4.2K', '转化 3.5%', '客单 ¥262', '复购 18%'],
          compareRightItems: ['营收 ¥1.2M', '新增 5.1K', '转化 3.4%', '客单 ¥287', '复购 21%'],
          compareVerdict: '营收与新增用户提升明显，但转化率略降需关注'
        },
        {
          id: 3010, type: 'calloutCard', name: '关键洞察',
          x: 460, y: 930, w: 390, h: 130, z: 6,
          calloutType: 'success',
          calloutText: '关键洞察：本周营收增长 18.5%，主要驱动因素为新功能上线带来的客单价提升（+12.3%）。建议下周加大新功能推广力度，同时监控转化率下降趋势。'
        },
        {
          id: 3011, type: 'textbox', name: '行动建议',
          x: 460, y: 1080, w: 390, h: 130, z: 7,
          mdView: true,
          content: '## 🎯 下周行动建议\n\n1. **加大推广**：新功能 ROI 验证后扩大投放\n2. **优化转化**：A/B 测试落地页，目标转化率回升至 3.6%\n3. **客户运营**：针对高客单用户推出会员体系'
        }
      ]
    }
  },

  // ===== AI 工作流编排模板（配合 AI 工作流模块使用）=====
  'aiworkflow-orchestration': {
    name: 'AI 工作流编排 · 数据抓取与分析',
    icon: '🤖',
    category: 'AI 工作流',
    description: 'AI 工作流编排模板：完整的数据抓取→清洗→分析→可视化→导出流程，配合 AI 工作流模块使用，适合自动化数据采集任务的设计与文档化',
    doc: {
      version: '2.0',
      title: 'AI 工作流编排方案',
      background: { type: 'color', value: '#1a1a2e' },
      showGrid: false,
      globalTimestamp: { created: 0, modified: 0, timezone: 'Asia/Shanghai' },
      defaultTTL: 0,
      cards: [
        // 封面
        {
          id: 4001, type: 'htmlBlock', name: '方案封面',
          x: 30, y: 30, w: 820, h: 160, z: 1,
          htmlContent: '<div style="padding:24px 32px;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);border-radius:10px;height:100%;box-sizing:border-box;color:#fff">' +
            '<div style="font-size:11px;color:#ce93d8;letter-spacing:2px;margin-bottom:8px">AI WORKFLOW · ORCHESTRATION</div>' +
            '<h1 style="font-size:24px;margin:0 0 8px 0;background:linear-gradient(90deg,#ce93d8,#4fc3f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent">AI 工作流编排方案</h1>' +
            '<div style="font-size:12px;color:#a8a8c8">多平台数据抓取 · AI 智能分析 · 自动化报告生成</div>' +
            '<div style="margin-top:14px;display:flex;gap:24px;font-size:11px;color:#888"><span>📦 任务类型：批量抓取</span><span>🎯 目标站点：8 个</span><span>⏱ 预估耗时：25 分钟</span></div></div>',
          cssContent: ''
        },
        // 工作流总览（流程图）
        {
          id: 4002, type: 'flowCard', name: '工作流总览',
          x: 30, y: 210, w: 820, h: 110, z: 2,
          flowSteps: [
            { name: '任务配置', desc: 'URL/规则', color: '#4fc3f7' },
            { name: '登录鉴权', desc: 'Cookie/Token', color: '#4dd0c8' },
            { name: '页面抓取', desc: '并发下载', color: '#b39ddb' },
            { name: '资源提取', desc: '图片/视频/文本', color: '#ffb74d' },
            { name: 'AI 分析', desc: '内容识别', color: '#ff8a65' },
            { name: '结果导出', desc: '分类存储', color: '#f06292' }
          ]
        },
        // AI 工作流容器 × 3（不同抓取模式）
        {
          id: 4003, type: 'aiworkflow', name: '批量抓取任务',
          x: 30, y: 340, w: 260, h: 180, z: 3,
          aiConfig: { taskType: 'batch', targetCount: 8, concurrency: 3 }
        },
        {
          id: 4004, type: 'aiworkflow', name: '跨页面抓取',
          x: 310, y: 340, w: 260, h: 180, z: 3,
          aiConfig: { taskType: 'crosspage', depth: 3, followLinks: true }
        },
        {
          id: 4005, type: 'aiworkflow', name: '更新追踪',
          x: 590, y: 340, w: 260, h: 180, z: 3,
          aiConfig: { taskType: 'tracking', interval: '24h', alertOn: true }
        },
        // 时间轴：执行计划
        {
          id: 4006, type: 'timelineCard', name: '执行时间表',
          x: 30, y: 540, w: 410, h: 260, z: 4,
          timelineItems: [
            { time: '00:00', title: '任务初始化', desc: '加载配置、鉴权', color: '#4fc3f7' },
            { time: '00:02', title: '并发抓取', desc: '8 个目标同时下载', color: '#4dd0c8' },
            { time: '00:15', title: '资源提取', desc: '图片/视频/文本分类', color: '#b39ddb' },
            { time: '00:20', title: 'AI 分析', desc: '内容识别与标注', color: '#ffb74d' },
            { time: '00:25', title: '导出完成', desc: '生成报告与归档', color: '#00ff9d' }
          ]
        },
        // 指标矩阵：资源预估
        {
          id: 4007, type: 'statCard', name: '资源预估',
          x: 460, y: 540, w: 390, h: 130, z: 4,
          statItems: [
            { label: '页面数', value: '8', sub: '并发 3', color: '#4fc3f7' },
            { label: '图片', value: '~240', sub: '约 1.2GB', color: '#4dd0c8' },
            { label: '视频', value: '~32', sub: '约 4.8GB', color: '#ffb74d' },
            { label: '文本', value: '~1.5K', sub: '约 12MB', color: '#b39ddb' }
          ]
        },
        // 配置说明
        {
          id: 4008, type: 'textbox', name: '配置说明',
          x: 460, y: 690, w: 390, h: 110, z: 5,
          mdView: true,
          content: '## ⚙ 配置要点\n\n- **登录策略**：使用持久化 Cookie，失败时降级为 Token\n- **并发控制**：每域名最多 3 并发，避免触发反爬\n- **失败重试**：最多 3 次，指数退避\n- **导出路径**：`D:/exports/{task_name}/{date}/`'
        },
        // 对比：抓取模式对比
        {
          id: 4009, type: 'compareCard', name: '抓取模式对比',
          x: 30, y: 820, w: 820, h: 220, z: 6,
          compareLeftTitle: '传统爬虫',
          compareRightTitle: 'AI 工作流',
          compareLeftItems: ['需写代码', '规则固定', '维护成本高', '无智能识别', '人工分类'],
          compareRightItems: ['可视化配置', '规则可复用', '模板化管理', 'AI 自动标注', '智能分类'],
          compareVerdict: 'AI 工作流模式开发效率提升 5x，维护成本降低 60%'
        },
        // 注解
        {
          id: 4010, type: 'calloutCard', name: '注意事项',
          x: 30, y: 1060, w: 820, h: 80, z: 7,
          calloutType: 'warning',
          calloutText: '⚠ 重要：使用前请在「用户面板」完成目标网站登录，并确认 AI 配置（API Key）已设置。任务执行期间请保持网络稳定。'
        }
      ]
    }
  },

  // ===== 项目复盘模板（回顾-反思-行动 闭环）=====
  'project-retrospective': {
    name: '项目复盘 · 回顾与改进',
    icon: '🔄',
    category: 'AI 工作流',
    description: '项目复盘模板：时间轴回顾 + 数据对比 + 雷达图评估 + 经验沉淀 + 行动计划，适合敏捷迭代复盘、季度总结',
    doc: {
      version: '2.0',
      title: '项目复盘报告',
      background: { type: 'color', value: '#1a1a2e' },
      showGrid: false,
      globalTimestamp: { created: 0, modified: 0, timezone: 'Asia/Shanghai' },
      defaultTTL: 0,
      cards: [
        // 封面
        {
          id: 5001, type: 'htmlBlock', name: '复盘封面',
          x: 30, y: 30, w: 820, h: 140, z: 1,
          htmlContent: '<div style="padding:22px 30px;background:linear-gradient(135deg,#1a1a2e 0%,#0f3460 100%);border-radius:10px;height:100%;box-sizing:border-box;color:#fff">' +
            '<div style="font-size:10px;color:#4dd0c8;letter-spacing:2px;margin-bottom:6px">RETROSPECTIVE · ITERATION 2026.Q3</div>' +
            '<h1 style="font-size:22px;margin:0 0 6px 0">项目迭代复盘</h1>' +
            '<div style="font-size:12px;color:#a8a8c8">回顾 · 反思 · 改进 · 沉淀</div>' +
            '<div style="margin-top:12px;display:flex;gap:24px;font-size:11px;color:#888"><span>📅 2026-07-01 → 07-21</span><span>👥 团队 8 人</span><span>📦 迭代 3 轮</span></div></div>',
          cssContent: ''
        },
        // 时间轴：迭代里程碑
        {
          id: 5002, type: 'timelineCard', name: '迭代里程碑',
          x: 30, y: 190, w: 820, h: 280, z: 2,
          timelineItems: [
            { time: '7/1', title: '迭代启动', desc: '需求评审、技术方案确认', color: '#4fc3f7' },
            { time: '7/5', title: '开发阶段', desc: '核心功能开发完成 80%', color: '#4dd0c8' },
            { time: '7/10', title: '联调测试', desc: '发现 12 个 Bug，修复 10 个', color: '#ffb74d' },
            { time: '7/15', title: '灰度发布', desc: '10% 用户灰度，收集反馈', color: '#b39ddb' },
            { time: '7/18', title: '全量上线', desc: '稳定性达标，全量推送', color: '#ff8a65' },
            { time: '7/21', title: '复盘总结', desc: '本次复盘会议', color: '#00ff9d' }
          ]
        },
        // 指标对比：本期 vs 上期
        {
          id: 5003, type: 'statCard', name: '核心指标对比',
          x: 30, y: 490, w: 820, h: 120, z: 3,
          statItems: [
            { label: '需求完成率', value: '92%', sub: '+8%', color: '#4fc3f7' },
            { label: 'Bug 数', value: '12', sub: '-45%', color: '#4dd0c8' },
            { label: '上线准时率', value: '100%', sub: '+15%', color: '#b39ddb' },
            { label: '用户满意度', value: '4.6/5', sub: '+0.3', color: '#ffb74d' }
          ]
        },
        // 雷达图：团队维度评估
        {
          id: 5004, type: 'radarCard', name: '团队能力评估',
          x: 30, y: 630, w: 320, h: 280, z: 4,
          radarLabels: ['执行力', '协作', '创新', '质量', '速度'],
          radarValues: [88, 82, 70, 85, 78], radarMax: 100
        },
        // 进度对比：各部门完成度
        {
          id: 5005, type: 'progressCard', name: '各部门完成度',
          x: 370, y: 630, w: 480, h: 280, z: 4,
          progressItems: [
            { label: '产品组 - 需求交付', value: 95, color: '#4fc3f7' },
            { label: '设计组 - UI 设计', value: 100, color: '#4dd0c8' },
            { label: '前端组 - 页面开发', value: 88, color: '#b39ddb' },
            { label: '后端组 - 接口开发', value: 92, color: '#ffb74d' },
            { label: '测试组 - 质量保障', value: 85, color: '#ff8a65' },
            { label: '运维组 - 部署上线', value: 100, color: '#f06292' }
          ], progressMax: 100
        },
        // 对比卡：做得好 vs 待改进
        {
          id: 5006, type: 'compareCard', name: '做得好 vs 待改进',
          x: 30, y: 930, w: 820, h: 220, z: 5,
          compareLeftTitle: '✨ 做得好',
          compareRightTitle: '⚠ 待改进',
          compareLeftItems: ['需求评审更充分', '代码 Review 覆盖率 100%', '灰度发布策略有效', '跨组协作顺畅', '文档同步及时'],
          compareRightItems: ['测试用例覆盖不足', '部分接口文档滞后', '前端性能可优化', '需求变更流程需规范', '监控告警不够及时'],
          compareVerdict: '总体表现优秀，但工程化实践（测试、文档、监控）仍需加强'
        },
        // 经验沉淀 + 行动计划
        {
          id: 5007, type: 'textbox', name: '经验沉淀',
          x: 30, y: 1170, w: 410, h: 200, z: 6,
          mdView: true,
          content: '## 💡 经验沉淀\n\n### 可复用经验\n1. **灰度发布**：10% → 50% → 100% 三阶段策略有效降低风险\n2. **每日站会**：15 分钟早会显著提升协作效率\n3. **代码 Review**：强制双人 Review 拦截 80% 低级 Bug\n\n### 教训\n- 接口文档与代码同步滞后，导致前端等待\n- 测试用例未覆盖边界场景，灰度期暴露问题'
        },
        {
          id: 5008, type: 'textbox', name: '下迭代行动计划',
          x: 460, y: 1170, w: 390, h: 200, z: 6,
          mdView: true,
          content: '## 🎯 下迭代行动项\n\n| 行动 | 负责人 | 截止 |\n|------|--------|------|\n| 补充单元测试至 80% | 前端组 | 8/5 |\n| 接口文档先行 | 后端组 | 7/25 |\n| 引入性能监控 | 运维组 | 8/1 |\n| 规范需求变更流程 | 产品组 | 7/28 |\n\n### 关键目标\n- Bug 数降至 8 以下\n- 测试覆盖率 ≥ 80%\n- 接口文档同步率 100%'
        }
      ]
    }
  },

  // ===== 通用空白报告模板 =====
  'blank-report': {
    name: '空白分析报告',
    icon: '📄',
    category: '基础模板',
    description: '基础报告骨架：封面 + 摘要 + 章节 + 结论，可自由扩展',
    doc: {
      version: '2.0',
      title: '分析报告',
      background: { type: 'color', value: '#1a1a2e' },
      showGrid: false,
      globalTimestamp: { created: 0, modified: 0, timezone: 'Asia/Shanghai' },
      defaultTTL: 0,
      cards: [
        {
          id: 2001,
          type: 'htmlBlock',
          name: '封面',
          x: 30, y: 30, w: 820, h: 160, z: 1,
          htmlContent: '<div style="padding:30px;background:linear-gradient(135deg,#1a1a2e,#0f3460);color:#fff;border-radius:10px;height:100%;box-sizing:border-box;">' +
            '<div style="font-size:11px;color:#4fc3f7;letter-spacing:2px;margin-bottom:8px;">ANALYSIS REPORT</div>' +
            '<h1 style="font-size:26px;margin:0 0 8px 0;">报告标题</h1>' +
            '<div style="font-size:12px;color:#a8a8c8;">副标题 · 数据来源 · 生成时间</div>' +
          '</div>',
          cssContent: ''
        },
        {
          id: 2002,
          type: 'textbox',
          name: '摘要',
          x: 30, y: 220, w: 820, h: 200, z: 2,
          mdView: true,
          content: '## 📌 摘要\n\n在此填写报告核心摘要...\n\n### 关键发现\n- 发现 1\n- 发现 2\n- 发现 3'
        },
        {
          id: 2003,
          type: 'textbox',
          name: '结论与建议',
          x: 30, y: 450, w: 820, h: 200, z: 3,
          mdView: true,
          content: '## 🎯 结论与建议\n\n### 结论\n1. 结论 1\n2. 结论 2\n\n### 建议\n- 建议 1\n- 建议 2'
        }
      ]
    }
  }
};

// 模板分类列表（用于面板展示）
if (typeof window !== 'undefined') {
  window.WSW_TEMPLATES = WSW_TEMPLATES;
}
