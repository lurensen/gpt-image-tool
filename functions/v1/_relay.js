// 商汤中转的共享实现（下划线开头的文件不会成为路由，只被同目录的 index.js / [[path]].js 引用）
//
// 为什么需要它：token.sensenova.cn 网关不支持浏览器 CORS 预检，网页无法直连。
// 放在 Cloudflare Pages 的 functions/v1/ 下后，中转与页面同属一个 pages.dev 域名，
// 浏览器侧是同源请求，连预检都省了 —— 工具设置里「API 地址」填 /v1 即可。
//
// 安全：仅转发到固定上游，不接受任意目标；不存储、不打印任何密钥。

const UPSTREAM = 'https://token.sensenova.cn';

// 允许使用本中转的跨域来源。留空数组 = 不限制（个人自用够用，免费额度 10 万请求/天）。
// 担心被别人当免费代理的话，填成你自己的 Pages 域名，例如：
// const ALLOWED_ORIGINS = ['https://gpt-image-tool.pages.dev'];
// 说明：同源请求浏览器不带 Origin 头，因此始终放行；只有跨域请求才受此名单约束。
const ALLOWED_ORIGINS = [];

export async function relay(request) {
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.length === 0
    ? (origin || '*')
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);

  const cors = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

  // 开启了白名单，且是跨域请求但不来自白名单 → 拒绝
  if (ALLOWED_ORIGINS.length > 0 && origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: { message: 'origin not allowed' } }, 403);
  }

  // 预检
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url = new URL(request.url);
  // 双保险：即便路由配置有出入，也只放行 /v1 前缀
  if (url.pathname !== '/v1' && !url.pathname.startsWith('/v1/')) {
    return json({ error: { message: 'this relay only serves /v1/*' } }, 404);
  }

  const h = new Headers();
  const auth = request.headers.get('Authorization'); if (auth) h.set('Authorization', auth);
  const ct = request.headers.get('Content-Type');    if (ct)   h.set('Content-Type', ct);

  try {
    const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
      method: request.method,
      headers: h,
      body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body,
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
    return json({ error: { message: 'relay fetch failed: ' + e.message } }, 502);
  }
}
