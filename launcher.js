import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT_TRIES = 20;
const READY_TIMEOUT_MS = 15000;

// 主动连接某个回环地址：连上=有服务在监听，ECONNREFUSED=没人占
function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

// 判断端口是否空闲：IPv4 回环和 IPv6 回环都连不上，才算真的空闲
// 不用“尝试 bind”探测，因为 Windows 上 SO_REUSEADDR 会让已占用端口也能 bind 成功
async function isPortFree(port) {
  if (await canConnect('127.0.0.1', port)) return false;
  if (await canConnect('::1', port)) return false;
  return true;
}

// 请求一个 HTTP 接口，返回状态码和响应体；连不上就返回 null
function httpGet(port, pathname) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: pathname, timeout: 2000 },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 5000) req.destroy();
        });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

// 占用端口的是不是校原行本平台：调 /api/locations，能返回 locations 数组就是
async function isOurPlatform(port) {
  const r = await httpGet(port, '/api/locations');
  if (!r || r.status !== 200) return false;
  try {
    return Array.isArray(JSON.parse(r.body).locations);
  } catch {
    return false;
  }
}

// 等待“自己的子进程”通过 IPC 回报 ready；子进程崩溃或超时都算失败
// 只认子进程发来的信号，不会把端口上别的程序误当成自己启动成功
function waitForChildReady(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('服务在规定时间内没有就绪'));
    }, timeoutMs);
    const onMessage = (msg) => {
      if (msg === 'ready' || msg?.type === 'ready') {
        cleanup();
        resolve();
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`服务进程提前退出（退出码 ${code}）`));
    };
    function cleanup() {
      clearTimeout(timer);
      child.removeListener('message', onMessage);
      child.removeListener('exit', onExit);
    }
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}

// 用系统自带 cmd 的 start 命令打开默认浏览器，不依赖 PATH
function openBrowser(url) {
  const cmd = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
  const opener = spawn(cmd, ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
  opener.unref();
}

// Windows 下连子进程一起结束（/T 进程树 /F 强制），避免关窗口后服务残留
function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32') {
      const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
      spawn(taskkill, ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  } catch {
    // 忽略清理时的异常
  }
}

async function main() {
  let port = DEFAULT_PORT;

  // 情况一：默认端口已被占用
  if (!(await isPortFree(port))) {
    // 1a. 占用的就是校原行 → 不重复启动，直接打开已有的
    if (await isOurPlatform(port)) {
      console.log(`检测到校原行平台已在运行，直接打开：http://localhost:${port}`);
      openBrowser(`http://localhost:${port}`);
      return;
    }
    // 1b. 被别的程序占用 → 自动往后找一个空闲端口
    let found = null;
    for (let candidate = DEFAULT_PORT + 1; candidate < DEFAULT_PORT + MAX_PORT_TRIES; candidate++) {
      if (await isPortFree(candidate)) {
        found = candidate;
        break;
      }
    }
    if (!found) {
      console.error(`端口 ${DEFAULT_PORT} 附近都被占用了，关掉一些程序后再试。`);
      process.exit(1);
    }
    console.log(`端口 ${DEFAULT_PORT} 被其他程序占用，自动改用 ${found}。`);
    port = found;
  }

  // 用当前这个便携 node 启动主服务；--no-warnings 关掉 SQLite 实验性提示
  // 第 4 个通道 ipc 用来接收子进程 listen 成功后的 ready 信号
  const server = spawn(
    process.execPath,
    ['--no-warnings', path.join(__dirname, 'server', 'index.js')],
    {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, PORT: String(port) },
    },
  );

  let opened = false;
  let exited = false;

  const shutdown = () => {
    if (exited) return;
    killTree(server);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 子进程一旦退出：没成功打开过浏览器就说明是启动失败，保留错误并以非 0 退出
  server.on('exit', (code) => {
    exited = true;
    if (!opened) {
      console.error(`\n服务启动失败（退出码 ${code}），请把本窗口里的报错信息截图发我。`);
      process.exit(code || 1);
    }
    process.exit(code || 0);
  });

  try {
    await waitForChildReady(server, READY_TIMEOUT_MS);
    const url = `http://localhost:${port}`;
    opened = true;
    console.log(`平台已就绪，正在打开浏览器：${url}`);
    console.log('请保持本窗口开着，关闭窗口就会停止平台。');
    openBrowser(url);
  } catch (err) {
    console.error(`\n等了 ${READY_TIMEOUT_MS / 1000} 秒服务仍未就绪：${err.message}`);
    killTree(server);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('启动器出错：', err);
  process.exit(1);
});
