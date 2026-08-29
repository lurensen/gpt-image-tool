// 路由 /v1/* —— 例如 /v1/images/generations、/v1/images/edits
import { relay } from './_relay.js';

export async function onRequest({ request }) {
  return relay(request);
}
