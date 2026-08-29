// 路由 /v1（兜底，实际请求一般走 /v1/images/generations 等子路径）
import { relay } from './_relay.js';

export async function onRequest({ request }) {
  return relay(request);
}
