// gpt-image 工具本地服务器：静态文件 + /v1/* 反向代理到 SenseNova
// 用法：node server.js  → 浏览器打开 http://localhost:8788
// 说明：token.sensenova.cn 网关不支持浏览器 CORS 预检（OPTIONS 返回 404），
// 网页无法直连；本代理把页面与 API 变成同源，浏览器侧不再受跨域限制。
// Node 侧 fetch 不受 CORS 约束，由它转发请求（Authorization 头原样透传，不落盘、不打印）。
import http from 'node:http';
import path from 'node:path';
import { readFile, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const UPSTREAM = process.env.SENSENOVA_UPSTREAM || 'https://token.sensenova.cn';
const PORT = parseInt(process.env.PORT || '8788', 10);
// 默认只听本机；共享给手机/局域网时：HOST=0.0.0.0 node server.js
const HOST = process.env.HOST || '127.0.0.1';
const CRASH_LOG = path.join(ROOT, 'server-crash.log');

function logCrash(msg) {
  try { appendFileSync(CRASH_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
  console.error(msg);
}
process.on('uncaughtException', e => { logCrash('uncaughtException: ' + (e.stack || e.message)); process.exit(1); });
process.on('unhandledRejection', e => { logCrash('unhandledRejection: ' + (e && e.stack || e)); });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function handler(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  /* ---------- 1) /v1/* 反向代理到 SenseNova ---------- */
  if (url.pathname === '/v1' || url.pathname.startsWith('/v1/')) {
    const t0 = Date.now();
    try {
      const headers = {};
      if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];
      if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
      const body = (req.method === 'GET' || req.method === 'HEAD') ? undefined : await readBody(req);
      const upstreamRes = await fetch(UPSTREAM + url.pathname + url.search, {
        method: req.method, headers, body,
      });
      const buf = Buffer.from(await upstreamRes.arrayBuffer());
      res.writeHead(upstreamRes.status, {
        'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(buf);
      console.log(`[proxy] ${req.method} ${url.pathname} → ${upstreamRes.status} (${Date.now() - t0}ms)`);
    } catch (e) {
      console.log(`[proxy] ${req.method} ${url.pathname} → 转发失败: ${e.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: '本地代理转发失败：' + e.message } }));
    }
    return;
  }

  /* ---------- 2) 静态文件 ---------- */
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(ROOT, '.' + pathname);
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;   // 防目录穿越
  }
  readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + pathname);
      return;
    }
    // 禁缓存：保证代码更新后浏览器刷新即生效（防止旧 app.js 缓存复活已修复的 bug）
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

/* ---------- 双栈监听：主机名 + IPv6 回环（避免浏览器把 localhost 解析成 ::1 时连不上） ---------- */
const hosts = HOST === '0.0.0.0' ? ['0.0.0.0', '::'] : ['127.0.0.1', '::1'];
let primaryOk = false;
for (const h of hosts) {
  const srv = http.createServer(handler);
  srv.on('error', err => {
    if (err.code === 'EADDRINUSE' && h === HOST) {
      logCrash(`端口 ${PORT} 已被占用（EADDRINUSE）。如果服务本来就在跑，直接用浏览器访问即可；否则关闭占用程序或改端口：set PORT=8888 后重试。`);
      process.exit(1);
    }
    // ::1 在无 IPv6 的机器上绑定失败不影响使用
    logCrash(`监听 ${h}:${PORT} 失败：${err.message}（不影响其他地址）`);
  });
  srv.listen(PORT, h, () => {
    if (h === HOST) primaryOk = true;
    console.log(`  listening  http://${h === '::' || h === '::1' ? '[' + h + ']' : h}:${PORT}`);
  });
}
setTimeout(() => {
  if (!primaryOk) { logCrash(`主监听地址 ${HOST}:${PORT} 未就绪`); process.exit(1); }
  console.log(`gpt-image 本地服务器已启动：`);
  console.log(`  页面      http://localhost:${PORT}`);
  console.log(`  API 代理  /v1/*  →  ${UPSTREAM}/v1/*`);
  console.log(`在工具设置里选「商汤 SenseNova」后，地址保持默认的官方地址即可，`);
  console.log(`工具会自动把实际请求改走本机的 /v1 代理（设置里的「本机代理兜底」开关控制）。`);
  console.log(`注意：本代理只在通过本服务器打开的页面里生效；部署到 GitHub Pages 等静态托管时，`);
  console.log(`      请改用 sensenova-relay.worker.js 部署 Cloudflare Worker 中转。`);
  console.log(`若异常退出，查看同目录 server-crash.log。`);
}, 300);
