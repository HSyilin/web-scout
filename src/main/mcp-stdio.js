// @ts-check
/**
 * Task 18: MCP stdio 子进程入口
 *
 * 该脚本作为独立 Node 子进程运行（由 Electron 主进程通过 child_process.fork 启动）。
 * - 通过 StdioServerTransport 与外部 MCP 客户端（如 Claude Desktop）通信
 * - 通过 process.send / process.on('message') 与 Electron 主进程通信以获取数据
 *
 * 协议（与主进程 IPC）：
 *   子 -> 父: process.send({ id, type, payload })    // type: 'request'
 *   父 -> 子: process.on('message', msg => ...)        // msg: { id, type:'response', payload } 或 { type:'response', id, error }
 *
 * 工具调用 -> 主进程请求数据 -> 等待主进程响应 -> 返回给 MCP 客户端
 */

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { createMcpServer } = require('./mcp-server.js');

// 请求计数器（用于关联父子消息）
let reqCounter = 0;
const pendingRequests = new Map(); // id -> {resolve, reject}

// 启动时间
const startedAt = Date.now();

/**
 * 向主进程发送请求并等待响应
 * @param {string} type - 请求类型（对应 opts 回调名）
 * @param {object} [payload]
 */
function requestFromParent(type, payload) {
  return new Promise((resolve, reject) => {
    if (!process.send) {
      reject(new Error('未通过 fork 启动，无法与主进程通信'));
      return;
    }
    const id = 'mcp_req_' + (++reqCounter);
    const timer = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('主进程响应超时（10s）：' + type));
      }
    }, 30000);
    pendingRequests.set(id, {
      resolve: (data) => { clearTimeout(timer); resolve(data); },
      reject: (err) => { clearTimeout(timer); reject(err); }
    });
    process.send({ id, type: 'request', method: type, payload: payload || {} });
  });
}

// 接收主进程响应
process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'response' && msg.id) {
    const pending = pendingRequests.get(msg.id);
    if (!pending) return;
    pendingRequests.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.payload);
    }
  } else if (msg.type === 'shutdown') {
    // 主进程主动要求关闭
    shutdown().catch(() => {}).finally(() => process.exit(0));
  }
});

// 构造注入回调（全部代理到主进程）
function buildOpts(readonly) {
  return {
    readonly: readonly,
    getWorkflows: async () => requestFromParent('getWorkflows'),
    getAiworkflows: async () => requestFromParent('getAiworkflows'),
    runTask: async (taskId) => requestFromParent('runTask', { taskId }),
    createTask: async (args) => requestFromParent('createTask', args),
    getTaskResults: async (taskId, batchId) => requestFromParent('getTaskResults', { taskId, batchId }),
    scrapePage: async (url, selector) => requestFromParent('scrapePage', { url, selector }),
    extractElements: async (url, selector, fields) => requestFromParent('extractElements', { url, selector, fields }),
    getTrackingStatus: async () => requestFromParent('getTrackingStatus'),
    onLog: (entry) => {
      // 上报日志到主进程
      if (process.send) {
        try { process.send({ type: 'log', payload: entry }); } catch (e) { /* ignore */ }
      }
    }
  };
}

let transport = null;
let mcpInstance = null;

async function start() {
  // 从环境变量读取 readonly 标志（由主进程 fork 时注入）
  const readonly = process.env.MCP_READONLY !== 'false';
  const opts = buildOpts(readonly);
  mcpInstance = createMcpServer(opts);
  mcpInstance.registerHandlers();

  transport = new StdioServerTransport();
  await mcpInstance.server.connect(transport);

  // 通知主进程已就绪
  if (process.send) {
    process.send({
      type: 'ready',
      payload: {
        readonly: readonly,
        toolCount: mcpInstance.readonly ? 6 : 8,
        startedAt: startedAt
      }
    });
  }
}

async function shutdown() {
  try {
    if (transport) await transport.close();
  } catch (e) { /* ignore */ }
}

// 处理退出
process.on('SIGINT', () => { shutdown().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { shutdown().finally(() => process.exit(0)); });
process.on('exit', () => {
  if (process.send) {
    try { process.send({ type: 'exited', payload: {} }); } catch (e) { /* ignore */ }
  }
});

// 捕获未处理异常，避免静默崩溃
process.on('uncaughtException', (err) => {
  if (process.send) {
    try { process.send({ type: 'error', payload: { message: err && err.message ? err.message : String(err) } }); } catch (e) { /* ignore */ }
  }
  // 写到 stderr 供调试（不要写到 stdout，会污染 MCP 协议）
  if (process.stderr) {
    process.stderr.write('[mcp-stdio] uncaughtException: ' + (err && err.stack ? err.stack : err) + '\n');
  }
});

start().catch((err) => {
  if (process.stderr) {
    process.stderr.write('[mcp-stdio] start failed: ' + (err && err.stack ? err.stack : err) + '\n');
  }
  process.exit(1);
});
