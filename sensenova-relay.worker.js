// SenseNova CORS 中转 —— Cloudflare Worker
// 用途：GitHub Pages / 纯静态托管时，浏览器无法直连 token.sensenova.cn（网关不支持 CORS），
//       把本文件部署为 Worker，工具设置里的「API 地址」填你的 Worker 地址（以 /v1 结尾）即可。
//
// 部署步骤：
//   1. 注册/登录 https://dash.cloudflare.com
//   2. 左侧 Workers & Pages → Create application → Worker → 起个名字（如 sensenova-relay）→ Get started
//   3. 把编辑器里的代码全部替换为本文件内容 → Deploy
//   4. 得到地址形如 https://sensenova-relay.<你的用户名>.workers.dev
//   5. 打开 GitHub Pages 上的生图工具 → 设置 → 提供商选「商汤 SenseNova」→
//      API 地址填：https://sensenova-relay.<你的用户名>.workers.dev/v1   ← 注意保留结尾的 /v1
//      API Key 填你自己的 sk-xxx（Key 只存在你浏览器 localStorage，本 Worker 不存储任何密钥）
//
// 安全说明：
//   - 仅转发到固定上游 token.sensenova.cn，不接受任意目标地址，不是开放代理
//   - 无 Key 的请求打过去只会从商汤收到 401，转发垃圾流量无利可图
//   - 把下方 ALLOWED_ORIGINS 填上你的 Pages 域名可进一步限制来源（可选）

const UPSTREAM = 'https://token.sensenova.cn';
// 例如 ['https://yourname.github.io']；留空数组则允许任意来源
const ALLOWED_ORIGINS = [];

function corsHeaders(req) {
  const origin = req.headers.get('Origin') || '';
  const allow = ALLOWED_ORIGINS.length === 0
    ? (origin || '*')
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(req) {
    const cors = corsHeaders(req);

    // 浏览器预检
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    // 只放行 /v1 前缀，其他一律 404
    if (url.pathname !== '/v1' && !url.pathname.startsWith('/v1/')) {
      return new Response(JSON.stringify({ error: { message: 'this relay only serves /v1/*' } }),
        { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const h = new Headers();
    const auth = req.headers.get('Authorization'); if (auth) h.set('Authorization', auth);
    const ct = req.headers.get('Content-Type');    if (ct)    h.set('Content-Type', ct);

    try {
      const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
        method: req.method,
        headers: h,
        body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : req.body,
        // Worker 环境：请求体以流的形式透传
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          ...cors,
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: { message: 'relay fetch failed: ' + e.message } }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  },
};
