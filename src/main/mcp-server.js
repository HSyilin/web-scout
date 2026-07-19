// @ts-check
/**
 * Task 18 + Task 19: MCP 服务端实现
 *
 * 该模块导出 createMcpServer(opts) 工厂函数，用于创建一个 MCP Server 实例。
 * 通过 opts 注入回调函数（避免直接 require 主进程模块造成循环依赖）。
 *
 * 工具列表（Task 19）：
 *   只读：scrape_page / extract_elements / list_workflows / get_workflow_results / list_cards / tracking_status
 *   读写：run_workflow / create_workflow（仅在 readonly=false 时注册）
 *
 * 调用日志：每次工具调用追加到 callLogs 数组（保留最近 100 条）。
 */

const { Server } = require('@modelcontextprotocol/sdk/server');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');

// 调用日志保留数量上限
const MAX_LOGS = 100;

/**
 * 包装工具调用：记录调用日志、计时、错误处理
 * @param {string} toolName
 * @param {object} args
 * @param {Function} fn
 * @param {Array} callLogs
 * @param {Function} [onLog] - 可选日志上报回调（用于子进程向父进程转发）
 */
async function invokeWithLog(toolName, args, fn, callLogs, onLog) {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();
  const entry = {
    tool: toolName,
    args: truncateArgs(args),
    timestamp,
    durationMs: 0,
    success: false
  };
  try {
    const data = await fn(args);
    entry.durationMs = Date.now() - startedAt;
    entry.success = true;
    pushLog(callLogs, entry);
    if (onLog) { try { onLog(entry); } catch (e) { /* ignore */ } }
    return toTextResult(data);
  } catch (err) {
    entry.durationMs = Date.now() - startedAt;
    entry.success = false;
    entry.error = (err && err.message) ? err.message : String(err);
    pushLog(callLogs, entry);
    if (onLog) { try { onLog(entry); } catch (e) { /* ignore */ } }
    return toErrorResult(entry.error);
  }
}

function pushLog(callLogs, entry) {
  callLogs.push(entry);
  if (callLogs.length > MAX_LOGS) {
    callLogs.splice(0, callLogs.length - MAX_LOGS);
  }
}

function truncateArgs(args) {
  if (!args || typeof args !== 'object') return args;
  try {
    const json = JSON.stringify(args);
    if (json.length > 800) {
      return JSON.parse(json.slice(0, 800) + '…(truncated)');
    }
    return JSON.parse(json);
  } catch (e) {
    return { _note: 'unserializable args' };
  }
}

function toTextResult(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: 'text', text }],
    isError: false
  };
}

function toErrorResult(message) {
  return {
    content: [{ type: 'text', text: message || '工具调用失败' }],
    isError: true
  };
}

/**
 * 工具 schema 定义
 * @param {boolean} readonly
 */
function buildToolDefinitions(readonly) {
  const tools = [
    {
      name: 'scrape_page',
      description: '加载指定 URL 并提取页面资源摘要或匹配元素。selector 为空时返回页面所有资源摘要（标题/链接/图片/视频等），否则返回匹配元素的 text/html/attrs。',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要抓取的目标 URL' },
          selector: { type: 'string', description: '可选 CSS 选择器，匹配后返回元素明细' }
        },
        required: ['url']
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    {
      name: 'extract_elements',
      description: '从指定 URL 加载页面并按字段映射提取元素，返回字段映射结果数组。',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '目标 URL' },
          selector: { type: 'string', description: 'CSS 选择器' },
          fields: {
            type: 'array',
            description: '可选字段映射列表：{name, selector, attr(text/html/href/src/...)}',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                selector: { type: 'string' },
                attr: { type: 'string' }
              }
            }
          }
        },
        required: ['url', 'selector']
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    {
      name: 'list_workflows',
      description: '列出所有 AI 工作流任务摘要（id/name/type/status/lastRunAt/resultCount）。',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'get_workflow_results',
      description: '获取指定 AI 工作流任务的结果批次。可选 batchId 筛选特定批次。',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务 id' },
          batchId: { type: 'string', description: '可选批次 id' }
        },
        required: ['taskId']
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'list_cards',
      description: '列出所有抓取信息卡片（多媒体卡片 + AI 工作流结果卡片）。',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'tracking_status',
      description: '返回所有 tracking 类型任务的运行状态（taskId/name/active/lastRunAt/nextCheckAt/newCount）。',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true }
    }
  ];

  if (!readonly) {
    tools.push({
      name: 'run_workflow',
      description: '执行指定 AI 工作流任务并返回结果摘要。需要写权限。',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务 id' }
        },
        required: ['taskId']
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    });
    tools.push({
      name: 'create_workflow',
      description: '创建新的 AI 工作流任务，返回 taskId。需要写权限。',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['batch', 'crosspage', 'tracking'], description: '任务类型' },
          name: { type: 'string', description: '任务名称' },
          config: { type: 'object', description: '任务配置（与对应类型一致）' }
        },
        required: ['type', 'name', 'config']
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    });
  }

  return tools;
}

/**
 * 工具分发路由
 * @param {string} name
 * @param {object} args
 * @param {object} opts
 */
async function dispatchTool(name, args, opts) {
  switch (name) {
    case 'scrape_page':
      return await opts.scrapePage(args.url, args.selector);
    case 'extract_elements':
      return await opts.extractElements(args.url, args.selector, args.fields);
    case 'list_workflows':
      return await opts.getAiworkflows();
    case 'get_workflow_results':
      return await opts.getTaskResults(args.taskId, args.batchId);
    case 'list_cards':
      return await opts.getWorkflows();
    case 'tracking_status':
      return await opts.getTrackingStatus();
    case 'run_workflow':
      return await opts.runTask(args.taskId);
    case 'create_workflow':
      return await opts.createTask(args);
    default:
      throw new Error('未知工具: ' + name);
  }
}

/**
 * Task 18.2: 创建 MCP Server 工厂
 * @param {object} opts - 回调注入
 *   { readonly, getWorkflows, getAiworkflows, runTask, createTask,
 *     getTaskResults, scrapePage, extractElements, getTrackingStatus }
 * @returns {{server: object, callLogs: Array, registerHandlers: Function}}
 */
function createMcpServer(opts) {
  opts = opts || {};
  const readonly = opts.readonly !== false; // 默认只读
  const callLogs = [];
  const onLog = typeof opts.onLog === 'function' ? opts.onLog : null;

  const server = new Server(
    { name: 'web-scout-mcp', version: '1.0.0' },
    {
      capabilities: {
        tools: {}
      },
      instructions: 'Web Scout MCP - 暴露本应用的页面抓取与 AI 工作流能力供外部 AI 调用。' +
        (readonly ? ' 当前为只读模式，仅可调用查询类工具。' : ' 当前为读写模式，可创建/运行任务。')
    }
  );

  function registerHandlers() {
    // 工具列表
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: buildToolDefinitions(readonly) };
    });

    // 工具调用
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const params = (request && request.params) || {};
      const name = params.name;
      const args = params.arguments || {};
      return await invokeWithLog(name, args, (a) => dispatchTool(name, a, opts), callLogs, onLog);
    });
  }

  return {
    server,
    callLogs,
    readonly,
    registerHandlers
  };
}

module.exports = {
  createMcpServer,
  buildToolDefinitions,
  MAX_LOGS
};
