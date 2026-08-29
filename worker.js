// Worker 入口：/v1/* 走商汤中转，其余交给静态资源系统
// 复用与原 Pages Functions 相同的中转实现（functions/v1/_relay.js）
import { relay } from './functions/v1/_relay.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/v1' || url.pathname.startsWith('/v1/')) {
      return relay(request);
    }
    // 非中转请求交给静态资源：命中则直接返回文件，
    // 未命中则按 wrangler.toml 的 not_found_handling 回退到 index.html
    return env.ASSETS.fetch(request);
  },
};
