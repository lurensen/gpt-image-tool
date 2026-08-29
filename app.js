(function(){
'use strict';
const $ = id => document.getElementById(id);

const store = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
};
function fatal(msg){
  const el = $('fatal');
  el.textContent = '页面内部错误：' + msg;
  el.style.display = 'block';
}
window.addEventListener('error', e => {
  if (!(e instanceof ErrorEvent)) return;
  const fname = (e.filename || '').split('/').pop() || '';
  if (!e.message || !(fname === 'app.js' || e.filename === location.href)) return;
  fatal(e.message + '（第 ' + e.lineno + ' 行）');
});
window.addEventListener('unhandledrejection', e => fatal(String(e.reason)));

let toastTimer;
function toast(msg){
  $('toast').textContent = msg;
  $('toast').classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> $('toast').classList.remove('on'), 3500);
}

/* ================= 主题 ================= */
function applyTheme(t){
  document.documentElement.dataset.theme = t;
  // 图标（日/月）由 CSS 按 data-theme 控制显示，这里只同步无障碍标签
  $('themeBtn').title = t === 'dark' ? '切换到浅色模式' : '切换到深色模式';
  $('themeBtn').setAttribute('aria-label', $('themeBtn').title);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#09090B' : '#FAFAFA';
  store.set('gptimg_theme', t);
}
$('themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
applyTheme(store.get('gptimg_theme') || ((window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark'));

/* ================= 配置存储（按 provider 独立保存） =================
   每个接口一份配置：gptimg_cfg_<provider> = {baseUrl, apiKey, model}
   全部存在本机 localStorage，不随页面文件分发。 */
const CFG_PREFIX = 'gptimg_cfg_';
const CFG_PROVIDERS = ['gpt', 'sensenova'];

function loadCfg(p){
  try{
    const o = JSON.parse(store.get(CFG_PREFIX + p) || '{}');
    return (o && typeof o === 'object') ? o : {};
  }catch(e){ return {}; }
}
function saveCfg(p, patch){
  if (CFG_PROVIDERS.indexOf(p) === -1) return;
  const next = Object.assign(loadCfg(p), patch || {});
  store.set(CFG_PREFIX + p, JSON.stringify(next));
}
function dropKey(p){
  const c = loadCfg(p);
  delete c.apiKey;
  store.set(CFG_PREFIX + p, JSON.stringify(c));
}
/* 读取当前输入框的值 */
function readInputs(){
  return {
    baseUrl: $('baseUrl').value.trim(),
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim()
  };
}
/* 迁移旧版单份配置（含明文密钥），迁移后立即删除旧键 */
(function migrateLegacyCfg(){
  const raw = store.get('gptimg_cfg');
  if (!raw) return;
  try{
    const o = JSON.parse(raw);
    if (o && o.provider && CFG_PROVIDERS.indexOf(o.provider) !== -1){
      const cur = loadCfg(o.provider);
      if (!cur.baseUrl && o.baseUrl) saveCfg(o.provider, {baseUrl: o.baseUrl});
      if (!cur.apiKey && o.apiKey) saveCfg(o.provider, {apiKey: o.apiKey});
      if (!cur.model && o.model) saveCfg(o.provider, {model: o.model});
    }
  }catch(e){}
  try{ localStorage.removeItem('gptimg_cfg'); }catch(e){}
})();

/* ================= Provider 预设 ================= */
const PROVIDERS = {
  gpt: {
    baseUrl: '',
    model: 'gpt-image-2',
    sizeAlign: 16,
    sizeMin: 16,
    sizeMax: 3840,
    pxMin: 655360,
    pxMax: 8294400,
    sizeNote: 'ⓘ 由于模型限制，最终输出会自动规整到合法尺寸：宽高均为 16 的倍数，最大边长 3840px，宽高比不超过 3:1，总像素限制为 655360–8294400。',
    resChips: [{res:1024,label:'1K'},{res:2048,label:'2K'},{res:3840,label:'4K'}],
  },
  sensenova: {
    // 商汤网关不支持浏览器 CORS 直连，需通过 server.js 本地代理：
    // node server.js 后打开 http://localhost:8788，相对路径 /v1 由同源代理转发到 token.sensenova.cn
    // 这里填完整的官方地址，实际请求由「本机代理兜底」开关决定是否改走 /v1
    baseUrl: 'https://token.sensenova.cn/v1',
    model: 'sensenova-u1.5-lite',
    sizeAlign: 32,
    sizeMin: 512,
    sizeMax: 4096,
    pxMin: 262144,    // 512*512
    pxMax: 16777216,  // 4096*4096
    sizeNote: 'ⓘ 商汤 U1.5 Lite 尺寸规则：宽高均为 32 的倍数，最小 512px，最大 4096px，宽高比不超过 3:1。推荐尺寸：2048×2048(1:1)、2720×1536(16:9)、1536×2720(9:16)、1664×2496(2:3)、2496×1664(3:2)、4096×4096(4K)。',
    resChips: [{res:2048,label:'2K'},{res:4096,label:'4K'}],
  },
};
let currentProvider = 'gpt';
const APP_VER = '2026-08-28-2150';
try{ $('jsVer').textContent = '前端代码版本 ' + APP_VER + ' —— 看不到此行/版本过旧 = 浏览器缓存了旧代码，请按 Ctrl+F5 强制刷新'; }catch(e){}

/* 商汤官方域名浏览器直连必被 CORS 拦截（网关不支持预检）。
   当页面由本地 server.js 承载（localhost / 局域网 IP）时，把「实际请求」改走同源代理 /v1。
   重要：只返回用于请求的地址，绝不回写输入框 —— 用户填的完整地址始终原样显示。
   远程托管（GitHub Pages）或非官方域名（如 Cloudflare Worker）不改写。
   用户可在设置里关掉「本机代理兜底」开关以完全自己控制。 */
function effectiveBaseUrl(raw, provider){
  const u = String(raw || '').trim().replace(/\/+$/, '');
  if (provider !== 'sensenova') return u;
  const box = $('autoProxy');
  if (!box || !box.checked) return u;
  if (!isSensenovaOfficial(u)) return u;
  return isLocalHost() ? '/v1' : u;
}

/* 页面是否运行在本机/局域网（此时才用得上 server.js 的同源代理） */
function isLocalHost(){
  const h = location.hostname;
  return /^(localhost|127\.|::1|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(h);
}
function isSensenovaOfficial(u){
  return /^https?:\/\/token\.sensenova\.cn/i.test(String(u || ''));
}
/* 远程托管（GitHub Pages 等）+ 直连商汤官方域名 = 必定 CORS 失败：
   Pages 是纯静态托管，跑不了 server.js，本地代理无从生效，必须换 Worker 中转。 */
function needsRelay(u, provider){
  return provider === 'sensenova' && isSensenovaOfficial(u) && !isLocalHost();
}

/* 命中「必被 CORS 拦截」的组合时，在设置面板给出明确指引，而不是让用户等一个莫名其妙的失败 */
function refreshRelayHint(){
  const el = $('relayWarn');
  if (!el) return;
  if (needsRelay($('baseUrl').value.trim(), currentProvider)){
    el.style.display = '';
    el.innerHTML = '<b>远程托管提示</b>：当前页面运行在 <code>' + location.hostname
      + '</code>，浏览器无法直连商汤（网关不支持跨域），本地 <code>server.js</code> 代理在远程页面上也用不上。'
      + '请挑一种中转方式：'
      + '<div class="opt"><b>1) 同源中转（推荐）</b>：把项目里的 <code>functions/v1/</code> 一并部署到当前 Pages，'
      + '上面的地址直接填 <code>/v1</code> —— 与页面同源，不用跨域、也不必另建 Worker。</div>'
      + '<div class="opt"><b>2) 独立 Worker</b>：另建一个 Cloudflare Worker，地址填 '
      + '<code>https://&lt;你的worker&gt;.workers.dev/v1</code>（脚本见 <code>sensenova-relay.worker.js</code>）。</div>'
      + '<div class="opt"><b>3) 回本机</b>：运行 <code>node server.js</code>，用 <code>http://localhost:8788</code> 打开。</div>';
  } else {
    el.style.display = 'none';
  }
}

let providerReady = false;

function applyProvider(p){
  const changed = (p !== currentProvider);
  // 切换到别的接口前，先把当前接口填的内容存下来（首次初始化时不存，避免空值覆盖）
  if (providerReady && changed) saveCfg(currentProvider, readInputs());

  currentProvider = p;
  const cfg = PROVIDERS[p];
  // 切换参数面板
  $('panel-gpt').style.display = p === 'gpt' ? '' : 'none';
  $('panel-sensenova').style.display = p === 'sensenova' ? '' : 'none';
  // 切换尺寸说明
  $('sizeNote').textContent = cfg.sizeNote;
  // 第二个尺寸 tab：商汤给的是官方建议分辨率（绝对值），GPT 是「基准 × 比例」
  const rt = $('tabRatio');
  if (p === 'sensenova'){ rt.textContent = '推荐尺寸'; rt.dataset.s = 'sn'; }
  else { rt.textContent = '按比例'; rt.dataset.s = 'ratio'; }
  // 当前模式不适用于该接口时回落到「自动」
  if (p === 'sensenova' && sizeMode === 'ratio') sizeMode = 'sn';
  if (p === 'gpt' && sizeMode === 'sn') sizeMode = 'ratio';
  syncSizePanels();
  // 本机代理兜底开关仅商汤显示
  $('proxyRow').style.display = p === 'sensenova' ? '' : 'none';
  // 载入该接口自己保存的配置（互不覆盖）
  if (changed || !providerReady){
    const saved = loadCfg(p);
    $('baseUrl').value = saved.baseUrl || cfg.baseUrl || '';
    $('apiKey').value = saved.apiKey || '';
    $('model').value = saved.model || cfg.model || '';
  }
  // 调整默认 baseRes
  if (p === 'sensenova'){
    baseRes = baseRes === 1024 ? 2048 : baseRes;
    // 如果当前选了 1K 但商汤不支持，切到 2K
    document.querySelectorAll('#resChips .chip').forEach(c => {
      if (parseInt(c.dataset.res) === 1024) c.classList.remove('active');
    });
    // 激活商汤芯片的第一个
    const firstSn = document.querySelector('#snResChips .chip');
    if (firstSn && !document.querySelector('#snResChips .chip.active')){
      firstSn.classList.add('active');
      const parts = firstSn.dataset.size.split('x');
      $('cw').value = parts[0]; $('ch').value = parts[1];
    }
  } else {
    // GPT 模式恢复
    if (!document.querySelector('#resChips .chip.active')){
      const c4096 = [...document.querySelectorAll('#resChips .chip')].find(c => parseInt(c.dataset.res) === 3840);
      if (c4096) c4096.classList.add('active');
      baseRes = 3840;
    }
  }
  // 重新渲染分辨率芯片激活状态
  refreshResChips();
  refreshWillUse();
  refreshRelayHint();
  store.set('gptimg_provider', p);
  providerReady = true;
}

function refreshResChips(){
  const chips = currentProvider === 'sensenova'
    ? document.querySelectorAll('#snResChips .chip')
    : document.querySelectorAll('#resChips .chip');
  if (currentProvider === 'sensenova'){
    document.querySelectorAll('#snResChips .chip').forEach(c => {
      c.classList.toggle('active', c.dataset.size === snSize);
    });
  } else {
    document.querySelectorAll('#resChips .chip').forEach(c => {
      c.classList.toggle('active', parseInt(c.dataset.res) === baseRes);
    });
  }
}

// 商汤建议分辨率：选中即用。官方接口接受任意符合规则的 WIDTHxHEIGHT，
// 这些是官方给的推荐值，直接用即可 —— 不再往自定义面板跳。
document.querySelectorAll('#snResChips .chip').forEach(c => {
  c.onclick = () => {
    snSize = c.dataset.size;
    document.querySelectorAll('#snResChips .chip').forEach(x => x.classList.toggle('active', x === c));
    refreshWillUse();
  };
});

$('provider').onchange = () => {
  // applyProvider 内部会先保存当前接口的配置，再载入新接口的
  applyProvider($('provider').value);
};

// 输入时自动保存（防抖），地址/密钥/模型按当前接口分开设存
let cfgSaveTimer;
['baseUrl', 'apiKey', 'model'].forEach(id => {
  $(id).addEventListener('input', () => {
    if (id === 'baseUrl') refreshRelayHint();
    clearTimeout(cfgSaveTimer);
    cfgSaveTimer = setTimeout(() => saveCfg(currentProvider, readInputs()), 400);
  });
});

// 本机代理兜底开关：记住用户选择，并在切换时给出提示
$('autoProxy').checked = store.get('gptimg_autoproxy') !== '0';
$('autoProxy').onchange = () => {
  store.set('gptimg_autoproxy', $('autoProxy').checked ? '1' : '0');
  refreshRelayHint();
};

// 清除本机保存的密钥（地址保留）
$('clearKeys').onclick = () => {
  if (!window.confirm('将清除本机保存的全部 API Key（两个接口的都会清掉，地址保留）。\n\n确定继续？')) return;
  CFG_PROVIDERS.forEach(dropKey);
  $('apiKey').value = '';
  try{ localStorage.removeItem('gptimg_cfg'); }catch(e){}
  toast('已清除本机保存的 API Key');
};

// 商汤水印开关文案联动
$('watermark').onchange = () => {
  $('watermarkLabel').textContent = $('watermark').checked ? '开启水印' : '关闭水印（公测期间免费）';
};
$('watermarkLabel').textContent = $('watermark').checked ? '开启水印' : '关闭水印（公测期间免费）';

// 恢复上次选择
const savedProvider = store.get('gptimg_provider') || 'gpt';
$('provider').value = savedProvider;

/* ================= 尺寸选择器 ================= */
let sizeMode = 'auto';
let baseRes = 3840;
let ratioKey = '16:9';
let snSize = '4096x4096';   // 商汤「官方建议分辨率」当前选中项

function parseRatio(){
  if (ratioKey !== 'custom'){
    const p = ratioKey.split(':');
    return [parseFloat(p[0]) || 1, parseFloat(p[1]) || 1];
  }
  return [parseFloat($('ratioW').value) || 1, parseFloat($('ratioH').value) || 1];
}
function normalizeSize(w, h){
  const cfg = PROVIDERS[currentProvider];
  const align = cfg.sizeAlign, sMin = cfg.sizeMin, sMax = cfg.sizeMax, maxPx = cfg.pxMax, minPx = cfg.pxMin;
  w = Math.max(w, 1); h = Math.max(h, 1);
  if (w / h > 3) w = h * 3;
  if (h / w > 3) h = w * 3;
  const sMaxFactor = sMax / Math.max(w, h);
  if (sMaxFactor < 1){ w *= sMaxFactor; h *= sMaxFactor; }
  const px = w * h;
  if (px > maxPx){ const s = Math.sqrt(maxPx / px); w *= s; h *= s; }
  if (px < minPx){ const s = Math.sqrt(minPx / px); w *= s; h *= s; }
  w = Math.round(w / align) * align;
  h = Math.round(h / align) * align;
  w = Math.min(Math.max(w, sMin), sMax);
  h = Math.min(Math.max(h, sMin), sMax);
  while (w * h < minPx && (w < sMax || h < sMax)){ if (w <= h) w = Math.min(w + align, sMax); else h = Math.min(h + align, sMax); }
  while (w * h > maxPx && (w > sMin || h > sMin)){ if (w >= h) w = Math.max(w - align, sMin); else h = Math.max(h - align, sMin); }
  return [w, h];
}
function computeSize(){
  if (sizeMode === 'auto') return null;
  if (sizeMode === 'ratio'){
    const [rw, rh] = parseRatio();
    let w, h;
    if (rw >= rh){ w = baseRes; h = baseRes * rh / rw; }
    else { h = baseRes; w = baseRes * rw / rh; }
    return normalizeSize(w, h);
  }
  // 商汤建议分辨率：官方给定的合法值，直接采用，不再二次规整
  if (sizeMode === 'sn'){
    const p = snSize.split('x');
    return [parseInt(p[0]) || 2048, parseInt(p[1]) || 2048];
  }
  return normalizeSize(parseInt($('cw').value) || 1024, parseInt($('ch').value) || 1024);
}
function refreshWillUse(){
  const s = computeSize();
  $('willuse').innerHTML = s
    ? '将使用 <b>' + s[0] + 'x' + s[1] + '</b>（约 ' + (s[0] * s[1] / 1e6).toFixed(1) + ' MP）'
    : '将使用 <b>自动</b>（由模型自己决定生成尺寸）';
}

/* 统一同步尺寸面板的显示与 tab 高亮，供 tab 点击 / 切换接口 / 复用配置共用 */
function syncSizePanels(){
  document.querySelectorAll('#sizeTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.s === sizeMode));
  $('panel-auto').style.display   = sizeMode === 'auto'   ? '' : 'none';
  $('panel-ratio').style.display  = sizeMode === 'ratio'  ? '' : 'none';
  $('panel-sn').style.display     = sizeMode === 'sn'     ? '' : 'none';
  $('panel-custom').style.display = sizeMode === 'custom' ? '' : 'none';
}

document.querySelectorAll('#sizeTabs .tab').forEach(t => {
  t.onclick = () => {
    sizeMode = t.dataset.s;
    syncSizePanels();
    refreshWillUse();
  };
});
document.querySelectorAll('#resChips .chip').forEach(c => {
  c.onclick = () => {
    baseRes = parseInt(c.dataset.res);
    document.querySelectorAll('#resChips .chip').forEach(x => x.classList.toggle('active', x === c));
    refreshWillUse();
  };
});
document.querySelectorAll('#ratioChips .chip').forEach(c => {
  c.onclick = () => {
    ratioKey = c.dataset.r;
    document.querySelectorAll('#ratioChips .chip').forEach(x => x.classList.toggle('active', x === c));
    $('customRatio').style.display = ratioKey === 'custom' ? '' : 'none';
    refreshWillUse();
  };
});
['ratioW','ratioH','cw','ch'].forEach(id => $(id).addEventListener('input', refreshWillUse));
refreshWillUse();

/* ================= 其余逻辑 ================= */
let mode = 'gen';
let refImages = [];
const history = [];
let currentSrc = '';
let taskSeq = 0;
let activeTasks = 0;

function makeEl(tag, cls, text){
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
function updateGoButton(){
  const btn = $('go');
  btn.disabled = false;
  btn.textContent = activeTasks ? ('生成图片（进行中：' + activeTasks + '）') : '生成图片';
}
function showMainResult(src, sizeVal){
  currentSrc = src;
  $('resultImg').dataset.requested = sizeVal || '';
  $('resultImg').src = src;
  $('emptyState').style.display = 'none';
  $('resultBox').style.display = '';
}
function createTaskCard(task){
  const card = makeEl('div', 'card task-card');
  const head = makeEl('div', 'task-head');
  const badge = makeEl('span', 'task-badge', (task.mode === 'gen' ? '文生图' : '图生图') + (task.provider === 'sensenova' ? '·商汤' : ''));
  const title = makeEl('div', 'task-title', '任务 #' + task.id + ' · ' + task.sizeLabel);
  const chip = makeEl('span', 'task-chip', '生成中');
  const thumb = makeEl('div', 'task-thumb');
  const thumbImg = makeEl('img');
  thumbImg.alt = '';
  thumb.appendChild(thumbImg);
  const toggle = makeEl('span', 'task-toggle');
  head.appendChild(badge);
  head.appendChild(title);
  head.appendChild(chip);
  head.appendChild(thumb);
  head.appendChild(toggle);
  const promptEl = makeEl('div', 'task-prompt', task.prompt);
  const status = makeEl('div', 'task-status');
  status.appendChild(makeEl('span', 'spinner'));
  const statusText = makeEl('span', 'task-status-text');
  status.appendChild(statusText);
  const errorEl = makeEl('div', 'task-error hidden');
  const failActions = makeEl('div', 'task-actions hidden');
  const reuseBtn = makeEl('button', 'btn small ghost', '复用配置');
  failActions.appendChild(reuseBtn);
  const result = makeEl('div', 'task-result hidden');
  const img = makeEl('img');
  img.alt = '生成结果';
  const meta = makeEl('div', 'task-meta');
  const actions = makeEl('div', 'task-actions');
  const viewBtn = makeEl('button', 'btn small ghost', '查看大图');
  const saveBtn = makeEl('button', 'btn small', '保存图片');
  actions.appendChild(viewBtn);
  actions.appendChild(saveBtn);
  result.appendChild(img);
  result.appendChild(meta);
  result.appendChild(actions);
  card.appendChild(head);
  card.appendChild(promptEl);
  card.appendChild(status);
  card.appendChild(errorEl);
  card.appendChild(failActions);
  card.appendChild(result);
  img.onload = () => {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (w) meta.textContent = '实际输出：' + w + 'x' + h + '（' + (w * h / 1e6).toFixed(2) + ' MP）' + (task.sizeVal ? '｜请求：' + task.sizeVal : '');
  };
  img.onclick = () => {
    if (!task.src) return;
    showMainResult(task.src, task.sizeVal);
    openViewer(task.src);
  };
  viewBtn.onclick = () => {
    if (!task.src) return;
    showMainResult(task.src, task.sizeVal);
    openViewer(task.src);
  };
  saveBtn.onclick = () => { if (task.src) saveOrView(task.src); };
  reuseBtn.onclick = () => {
    applyTaskConfig(task);
    toast('已把任务 #' + task.id + ' 的配置恢复到左侧');
    $('prompt').focus();
  };
  document.querySelectorAll('.task-card').forEach(c => {
    if (c.querySelector('.task-status.done, .task-status.fail') && !c.classList.contains('collapsed')) c.classList.add('collapsed');
  });
  head.addEventListener('click', () => card.classList.toggle('collapsed'));
  thumbImg.onclick = e => { e.stopPropagation(); if (task.src){ showMainResult(task.src, task.sizeVal); openViewer(task.src); } };
  $('taskList').insertBefore(card, $('taskList').firstChild);
  task.el = {card: card, status: status, statusText: statusText, error: errorEl, failActions: failActions, result: result, chip: chip, thumb: thumbImg};
}
function setTaskStatus(task, text){
  task.statusBase = text;
  task.el.statusText.textContent = text + '…（已等待 ' + task.secs + ' 秒，生图通常要 10~60 秒）';
  task.el.chip.textContent = '生成中';
}
function startTaskTimer(task, text){
  clearInterval(task.timer);
  task.secs = 0;
  setTaskStatus(task, text);
  task.timer = setInterval(() => {
    task.secs++;
    setTaskStatus(task, task.statusBase);
  }, 1000);
}
function finishTask(task){
  clearInterval(task.timer);
  task.timer = null;
  task.el.status.classList.add('done');
  task.el.card.classList.add('done');
  task.el.statusText.textContent = '已完成 · 用时 ' + task.secs + ' 秒';
  task.el.chip.textContent = '完成';
}
function failTask(task, msg){
  clearInterval(task.timer);
  task.timer = null;
  task.el.status.classList.add('fail');
  task.el.card.classList.add('fail');
  task.el.statusText.textContent = '生成失败';
  task.el.chip.textContent = '失败';
  task.el.error.textContent = msg;
  task.el.error.classList.remove('hidden');
  task.el.failActions.classList.remove('hidden');
}


try{
  // 恢复上次选择的接口；applyProvider 会载入该接口自己保存的地址/密钥/模型
  $('provider').value = savedProvider;
  applyProvider(savedProvider);
}catch(e){}

$('cfgToggle').onclick = () => {
  const c = $('cfg');
  const open = c.style.display === 'none';
  c.style.display = open ? '' : 'none';
  $('cfgToggle').classList.toggle('on', open);
};

function switchMode(m){
  mode = m;
  $('tab-gen').classList.toggle('active', m === 'gen');
  $('tab-edit').classList.toggle('active', m === 'edit');
  $('edit-panel').style.display = m === 'edit' ? '' : 'none';
}
function restoreRefImages(list){
  refImages.forEach(r => { try{ URL.revokeObjectURL(r.url); }catch(e){} });
  refImages = (list || []).map(r => ({file: r.file, url: URL.createObjectURL(r.file)}));
  renderThumbs();
}
function applyTaskConfig(task){
  $('prompt').value = task.prompt;
  // 恢复 provider
  if (task.provider){
    $('provider').value = task.provider;
    applyProvider(task.provider);
  }
  // 恢复商汤参数
  if (task.provider === 'sensenova'){
    if (task.watermark !== undefined) $('watermark').checked = task.watermark;
    if (task.promptExtend !== undefined) $('promptExtend').checked = task.promptExtend;
  } else {
    $('quality').value = task.quality || 'auto';
  }
  switchMode(task.mode === 'edit' ? 'edit' : 'gen');

  const cfg = task.size || {};
  sizeMode = cfg.sizeMode || 'auto';
  baseRes = cfg.baseRes || 3840;
  ratioKey = cfg.ratioKey || '16:9';
  if (cfg.snSize) snSize = cfg.snSize;
  $('ratioW').value = cfg.ratioW || 1;
  $('ratioH').value = cfg.ratioH || 1;
  $('cw').value = cfg.cw || 1024;
  $('ch').value = cfg.ch || 1024;

  syncSizePanels();
  document.querySelectorAll('#snResChips .chip').forEach(c => c.classList.toggle('active', c.dataset.size === snSize));
  document.querySelectorAll('#resChips .chip').forEach(c => c.classList.toggle('active', parseInt(c.dataset.res) === baseRes));
  document.querySelectorAll('#ratioChips .chip').forEach(c => c.classList.toggle('active', c.dataset.r === ratioKey));
  $('customRatio').style.display = ratioKey === 'custom' ? '' : 'none';

  showErr('');
  restoreRefImages(task.refImages || []);
  refreshWillUse();
  $('prompt').focus();
  if (window.innerWidth < 960) $('prompt').scrollIntoView({behavior: 'smooth', block: 'center'});
}
$('tab-gen').onclick = () => switchMode('gen');
$('tab-edit').onclick = () => switchMode('edit');

function addFiles(fileList){
  for (const f of fileList){
    if (!f.type || !f.type.startsWith('image/')) continue;
    refImages.push({file:f, url:URL.createObjectURL(f)});
  }
  renderThumbs();
}
function renderThumbs(){
  const box = $('thumbs');
  box.innerHTML = '';
  refImages.forEach((r,i)=>{
    const d = document.createElement('div');
    d.className = 'thumb';
    const img = document.createElement('img');
    img.src = r.url;
    img.onclick = () => openViewer(r.url);
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
    del.onclick = e => { e.stopPropagation(); URL.revokeObjectURL(r.url); refImages.splice(i,1); renderThumbs(); };
    d.appendChild(img); d.appendChild(del);
    box.appendChild(d);
  });
}
$('drop').onclick = () => $('file').click();
$('file').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
['dragover','dragenter'].forEach(ev => $('drop').addEventListener(ev, e => {e.preventDefault(); $('drop').classList.add('over');}));
['dragleave','drop'].forEach(ev => $('drop').addEventListener(ev, e => {e.preventDefault(); $('drop').classList.remove('over');}));
$('drop').addEventListener('drop', e => addFiles(e.dataTransfer.files));
document.addEventListener('paste', e => {
  if (mode === 'edit' && e.clipboardData && e.clipboardData.files.length) addFiles(e.clipboardData.files);
});

let viewerSrc = '';
let viewerScale = 1;
let viewerTx = 0;
let viewerTy = 0;
let viewerDragPointer = null;
let viewerLastX = 0;
let viewerLastY = 0;
const VIEWER_MIN_SCALE = 0.5;
const VIEWER_MAX_SCALE = 10;

function applyViewerTransform(){
  const img = $('viewerImg');
  if (viewerScale === 1 && viewerTx === 0 && viewerTy === 0){
    img.style.transform = '';
  } else {
    img.style.transform = 'translate(' + viewerTx + 'px,' + viewerTy + 'px) scale(' + viewerScale + ')';
  }
}
function resetViewerZoom(){
  viewerScale = 1;
  viewerTx = 0;
  viewerTy = 0;
  applyViewerTransform();
}
function getViewerImgRect(){
  const img = $('viewerImg');
  if (!img.naturalWidth || !img.naturalHeight) return null;
  const old = img.style.transform;
  img.style.transform = '';
  const r = img.getBoundingClientRect();
  img.style.transform = old;
  return r;
}
function zoomViewerAt(clientX, clientY, nextScale){
  const r = getViewerImgRect();
  if (!r || !r.width || !r.height) return;
  nextScale = Math.min(VIEWER_MAX_SCALE, Math.max(VIEWER_MIN_SCALE, nextScale));
  const ratio = nextScale / viewerScale;
  viewerTx = (clientX - r.left) * (1 - ratio) + viewerTx * ratio;
  viewerTy = (clientY - r.top) * (1 - ratio) + viewerTy * ratio;
  viewerScale = nextScale;
  applyViewerTransform();
}
function openViewer(src){
  if (!src) return;
  viewerSrc = src;
  resetViewerZoom();
  $('viewerImg').src = src;
  $('viewer').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeViewer(){
  $('viewer').style.display = 'none';
  document.body.style.overflow = '';
  resetViewerZoom();
}
$('viewerClose').onclick = closeViewer;
$('viewer').onclick = e => { if (e.target === $('viewer')) closeViewer(); };
$('viewerSave').onclick = async () => {
  const ok = await saveImage(viewerSrc);
  if (!ok) toast('请长按上方图片，选择「保存到相册」');
};
$('viewer').addEventListener('wheel', e => {
  e.preventDefault();
  const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 120 : e.deltaY;
  zoomViewerAt(e.clientX, e.clientY, viewerScale * Math.exp(-step * 0.0015));
}, {passive:false});

$('viewerImg').addEventListener('pointerdown', e => {
  if (viewerScale <= 1 || e.pointerType !== 'mouse' || e.button !== 0) return;
  viewerDragPointer = e.pointerId;
  viewerLastX = e.clientX;
  viewerLastY = e.clientY;
  $('viewerImg').classList.add('dragging');
  try{ $('viewerImg').setPointerCapture(e.pointerId); }catch(err){}
  e.preventDefault();
});
$('viewerImg').addEventListener('pointermove', e => {
  if (viewerDragPointer !== e.pointerId) return;
  viewerTx += e.clientX - viewerLastX;
  viewerTy += e.clientY - viewerLastY;
  viewerLastX = e.clientX;
  viewerLastY = e.clientY;
  applyViewerTransform();
});
function endViewerDrag(e){
  if (viewerDragPointer !== e.pointerId) return;
  viewerDragPointer = null;
  $('viewerImg').classList.remove('dragging');
}
$('viewerImg').addEventListener('pointerup', endViewerDrag);
$('viewerImg').addEventListener('pointercancel', endViewerDrag);
$('viewerImg').addEventListener('dblclick', resetViewerZoom);
$('resultImg').onclick = () => openViewer(currentSrc);
$('resultImg').onload = () => {
  const w = $('resultImg').naturalWidth, h = $('resultImg').naturalHeight;
  if (w){
    $('expW').value = w; $('expH').value = h;
    let t = '实际输出：<b>' + w + 'x' + h + '</b>（' + (w * h / 1e6).toFixed(2) + ' MP）';
    const requested = $('resultImg').dataset.requested;
    if (requested) t += '｜请求：' + requested;
    $('realSize').innerHTML = t;
  }
};
$('viewBtn').onclick = () => openViewer(currentSrc);

async function deliverBlob(blob, name){
  try{
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
    return true;
  }catch(e){ return false; }
}
function dataURLtoBlob(dataURL){
  const parts = dataURL.split(',');
  const mime = (parts[0].match(/:(.*?);/) || [,'image/png'])[1];
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8 = new Uint8Array(n);
  while(n--) u8[n] = bstr.charCodeAt(n);
  return new Blob([u8], {type: mime});
}
async function saveImage(src){
  if (!src) return false;
  try{
    const blob = src.startsWith('data:') ? dataURLtoBlob(src) : await (await fetch(src)).blob();
    return await deliverBlob(blob, 'gpt-image-' + Date.now() + '.png');
  }catch(e){ return false; }
}
async function saveOrView(src){
  const ok = await saveImage(src);
  if (!ok){ openViewer(src); toast('无法直接下载，请长按大图保存到相册'); }
}
$('dlBtn').onclick = () => saveOrView(currentSrc);

$('expBtn').onclick = () => {
  const w = parseInt($('expW').value), h = parseInt($('expH').value);
  if (!w || !h || w < 16 || h < 16){ toast('请输入有效的宽高（不小于 16）'); return; }
  if (!currentSrc){ toast('请先生成图片'); return; }
  toast('正在转换…');
  const img = new Image();
  if (/^https?:/i.test(currentSrc)) img.crossOrigin = 'anonymous';
  img.onload = () => {
    try{
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      if ($('expMode').value === 'crop'){
        const scale = Math.max(w / img.width, h / img.height);
        const sw = w / scale, sh = h / scale;
        ctx.drawImage(img, (img.width - sw)/2, (img.height - sh)/2, sw, sh, 0, 0, w, h);
      } else {
        ctx.drawImage(img, 0, 0, w, h);
      }
      cv.toBlob(async blob => {
        if (!blob){ toast('导出失败'); return; }
        const ok = await deliverBlob(blob, 'gpt-image-' + w + 'x' + h + '.png');
        if (ok) toast('已导出 ' + w + 'x' + h + ' PNG');
        else { openViewer(cv.toDataURL('image/png')); toast('请长按大图保存'); }
      }, 'image/png');
    }catch(e){
      toast('导出失败：可能受跨域限制，请先「保存图片」再裁剪');
    }
  };
  img.onerror = () => toast('图片加载失败，无法导出');
  img.src = currentSrc;
};

function renderHistory(){
  const box = $('history');
  box.innerHTML = '';
  history.slice(0, 12).forEach(s => {
    const d = document.createElement('div');
    d.className = 'hitem';
    const img = document.createElement('img');
    img.src = s;
    img.onclick = () => {
      showMainResult(s, null);
      openViewer(s);
    };
    const b = document.createElement('button');
    b.className = 'hbtn';
    b.title = '保存图片';
    b.setAttribute('aria-label', '保存图片');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 20h14"/></svg>';
    b.onclick = ev => { ev.stopPropagation(); saveOrView(s); };
    d.appendChild(img); d.appendChild(b);
    box.appendChild(d);
  });
}

async function readJson(res){
  let data;
  try{ data = await res.json(); }
  catch(e){
    const t = await res.text().catch(()=> '');
    throw new Error('HTTP ' + res.status + '，响应不是 JSON（上游可能报错）：\n' + t.slice(0, 300));
  }
  if (!res.ok || data.error){
    const e = data.error || {};
    const parts = [];
    if (typeof e.message === 'string' && e.message) parts.push(e.message);
    else if (typeof e.msg === 'string' && e.msg) parts.push(e.msg);
    if (e.param) parts.push('param: ' + e.param);
    if (e.code) parts.push('code: ' + e.code);
    if (e.type) parts.push('type: ' + e.type);
    if (!parts.length) parts.push(JSON.stringify(data.error || data));
    const reqId = data.request_id || e.request_id;
    if (reqId) parts.push('request_id: ' + reqId);
    parts.push('HTTP ' + res.status);
    throw new Error(parts.join('\n'));
  }
  if (!data.data || !data.data[0]) throw new Error('响应中没有图片数据：' + JSON.stringify(data).slice(0, 300));
  return data;
}

// 备用：multipart 方式提交 edits（A6API 的 gpt-image-2 渠道已确认不收 multipart，
// 本函数保留给其他 OpenAI 兼容网关使用）
async function doEdit(baseUrl, apiKey, opts){
  const fd = new FormData();
  fd.append('model', opts.model);
  fd.append('prompt', opts.prompt);
  if (opts.sizeVal) fd.append('size', opts.sizeVal);
  if (opts.quality) fd.append('quality', opts.quality);
  const imgs = opts.many ? refImages : refImages.slice(0, 1);
  imgs.forEach(r => fd.append(opts.field || 'image', r.file, r.file.name || 'ref.png'));
  const res = await fetch(baseUrl + '/images/edits', {
    method: 'POST',
    headers: {'Authorization': 'Bearer ' + apiKey},
    body: fd
  });
  return readJson(res);
}

function startTask(){
  const prompt = $('prompt').value.trim();
  if (!prompt){ showErr('请输入提示词'); return; }
  const typedUrl = $('baseUrl').value.trim().replace(/\/+$/, '');
  const baseUrl = effectiveBaseUrl(typedUrl, currentProvider);
  const apiKey = $('apiKey').value.trim();
  if (!baseUrl || !apiKey){ showErr('请先在设置里填写 API 地址和 Key'); return; }
  // 远程页面直连商汤必然被 CORS 拦截，与其等一个看不懂的报错，不如提前说清楚
  if (needsRelay(typedUrl, currentProvider)){
    showErr('商汤无法在这个页面上直连：页面运行在 ' + location.hostname
      + '（远程托管），浏览器会被跨域策略拦截，而本地 server.js 代理在远程页面上也用不上。\n\n请选择一种方式：\n'
      + '1) 把项目的 functions/v1/ 一起部署到当前 Pages，API 地址填 /v1（同源中转，推荐）；\n'
      + '2) 改用已部署的 Cloudflare Worker 中转地址（https://<你的worker>.workers.dev/v1）；\n'
      + '3) 改用支持跨域的网关，例如切回「GPT」通道；\n'
      + '4) 回到本机运行 node server.js，用 http://localhost:8788 打开。');
    return;
  }
  if (mode === 'edit' && refImages.length === 0){ showErr('图生图模式请至少上传 1 张参考图'); return; }
  showErr('');

  const model = $('model').value.trim() || 'gpt-image-2';
  // 只保存用户实际填写的地址，不保存自动改写后的代理路径
  saveCfg(currentProvider, {baseUrl: typedUrl, apiKey: apiKey, model: model});
  const s = computeSize();
  const sizeVal = s ? (s[0] + 'x' + s[1]) : null;
  const sizeLabel = sizeVal || '自动';
  const task = {
    id: ++taskSeq,
    mode: mode,
    provider: currentProvider,
    prompt: prompt,
    quality: $('quality').value,
    watermark: $('watermark').checked,
    promptExtend: $('promptExtend').checked,
    model: model,
    baseUrl: baseUrl,
    apiKey: apiKey,
    sizeVal: sizeVal,
    sizeLabel: sizeLabel,
    size: {
      sizeMode: sizeMode,
      baseRes: baseRes,
      ratioKey: ratioKey,
      snSize: snSize,
      ratioW: parseFloat($('ratioW').value) || 1,
      ratioH: parseFloat($('ratioH').value) || 1,
      cw: parseInt($('cw').value) || 1024,
      ch: parseInt($('ch').value) || 1024
    },
    refImages: refImages.slice(),
    src: null,
    secs: 0,
    timer: null,
    statusBase: ''
  };

  createTaskCard(task);
  $('emptyState').style.display = 'none';
  activeTasks++;
  updateGoButton();
  runTask(task).finally(() => {
    activeTasks = Math.max(0, activeTasks - 1);
    updateGoButton();
  }).catch(()=>{});
}

async function runTask(task){
  const prompt = task.prompt;
  const baseUrl = effectiveBaseUrl(task.baseUrl, task.provider);
  const apiKey = task.apiKey;
  const model = task.model;
  const sizeVal = task.sizeVal;
  const sizeLabel = task.sizeLabel;
  const q = task.quality;
  const useQ = q && q !== 'auto';
  let data;

  startTaskTimer(task, (task.mode === 'gen' ? '文生图' : '图生图') + '（' + sizeLabel + '），正在生成');
  try{
    if (task.mode === 'gen'){
      if (task.provider === 'sensenova'){
        // 商汤 U1.5 Lite 文生图：/v1/images/generations
        // 参数：model, prompt, size, watermark, response_format, prompt_extend（无 quality）
        const body = {model, prompt, response_format: 'b64_json', watermark: task.watermark};
        if (sizeVal) body.size = sizeVal;
        if (task.promptExtend) body.prompt_extend = true;
        setTaskStatus(task, '文生图 ' + sizeLabel + '：SenseNova U1.5 Lite');
        const res = await fetch(baseUrl + '/images/generations', {
          method: 'POST',
          headers: {'Content-Type':'application/json', 'Authorization':'Bearer ' + apiKey},
          body: JSON.stringify(body)
        });
        data = await readJson(res);
      } else {
      // 文生图：gpt-image-2 的 generations 仅支持 model/prompt/size/image/quality（不支持 n），
      // 按“由全到简”自动降级，避免不支持的字段导致 400
      const plans = [];
      plans.push({size: sizeVal, quality: useQ ? q : null});
      if (useQ) plans.push({size: sizeVal, quality: null});
      if (sizeVal) plans.push({size: null, quality: null});
      const paramErr = /(字段|参数|quality|size|格式|json|body)/i;
      const fatalErr = /(401|402|404|429|余额|额度|限流|令牌|not found|model_not_found|forbidden|auth)/i;
      let lastErr = null;
      const logs = [];
      for (const p of plans){
        const desc = '尝试' + (logs.length + 1) + ': model+prompt' + (p.quality ? '+quality' : '') + (p.size ? '+size(' + p.size + ')' : '');
        setTaskStatus(task, '文生图 ' + sizeLabel + '：' + desc);
        const body = {model, prompt};
        if (p.size) body.size = p.size;
        if (p.quality) body.quality = p.quality;
        const res = await fetch(baseUrl + '/images/generations', {
          method: 'POST',
          headers: {'Content-Type':'application/json', 'Authorization':'Bearer ' + apiKey},
          body: JSON.stringify(body)
        });
        try{
          data = await readJson(res);
          break;
        }catch(e){
          lastErr = e;
          logs.push(desc + ' → ' + String(e.message).split('\n').join(' | ').slice(0, 220));
          // 致命错误（余额不足、模型不存在、限流、鉴权失败）直接抛出，重试无意义
          if (fatalErr.test(String(e.message))) throw e;
          // 参数类错误或上游不可用 → 继续尝试下一个方案
        }
      }
      if (!data){
        const err = lastErr ? new Error(lastErr.message) : new Error('文生图请求失败（多次重试均未成功）');
        err.message += '\n\n—— 各次尝试诊断 ——\n' + logs.join('\n');
        if (lastErr && /上游|不可用|upstream|unavailable|503|5\d\d/i.test(String(lastErr.message))){
          err.message += '\n\n💡 说明：当前是 A6API 上游渠道暂时不可用（与参数无关）：\n1) 稍等 1~2 分钟重试；\n2) 在 A6API 控制台对当前模型开启「智能优选」或切换固定商家；\n3) 换一个模型试试（如 gpt-image-1）。';
        }
        throw err;
      }
      } // end of GPT 文生图 else
    } else {
      if (task.provider === 'sensenova'){
        // 商汤 U1.5 Lite 图编辑：/v1/images/edits
        // 参数：model, prompt, images: [{image_url: dataURL}], size, watermark, prompt_extend, response_format
        const toDataURL = file => new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = () => rej(new Error('读取图片失败'));
          r.readAsDataURL(file);
        });
        const imgs = task.refImages.length > 1 ? task.refImages : task.refImages.slice(0, 1);
        setTaskStatus(task, '图生图：正在读取 ' + imgs.length + ' 张参考图…');
        const dataURLs = await Promise.all(imgs.map(r => toDataURL(r.file)));
        const body = {
          model, prompt,
          images: dataURLs.map(u => ({image_url: u})),
          watermark: task.watermark,
          response_format: 'b64_json'
        };
        if (sizeVal) body.size = sizeVal;
        if (task.promptExtend) body.prompt_extend = true;
        setTaskStatus(task, '图生图 ' + sizeLabel + '：SenseNova images 格式');
        const res = await fetch(baseUrl + '/images/edits', {
          method: 'POST',
          headers: {'Content-Type':'application/json', 'Authorization':'Bearer ' + apiKey},
          body: JSON.stringify(body)
        });
        data = await readJson(res);
      } else {
      // 图生图：A6API 对 multipart 的 edits 请求体校验严格（疑似仅接受 JSON），
      // 优先用 JSON 请求体 + base64 传参考图，multipart 作为兜底
      const toDataURL = file => new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(new Error('读取图片失败'));
        r.readAsDataURL(file);
      });
      const imgs = task.refImages.length > 1 ? task.refImages : task.refImages.slice(0, 1);
      setTaskStatus(task, '图生图：正在读取 ' + imgs.length + ' 张参考图…');
      const dataURLs = await Promise.all(imgs.map(r => toDataURL(r.file)));

      const paramErr = /(字段|参数|quality|size|image|格式|json|body|multipart|file)/i;
      const fatalErr = /(401|402|404|429|余额|额度|限流|令牌|not found|model_not_found|forbidden|auth)/i;
      const logs = [];
      const attempts = [];
      // 1) JSON edits：image 为数组（base64 data URL）
      attempts.push({
        name: 'JSON /images/edits (image数组)',
        run: () => fetch(baseUrl + '/images/edits', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey},
          body: JSON.stringify({model, prompt, image: dataURLs, ...(sizeVal ? {size: sizeVal} : {}), ...(useQ ? {quality: q} : {})})
        })
      });
      // 2) JSON edits：image 为单值
      attempts.push({
        name: 'JSON /images/edits (image单值)',
        run: () => fetch(baseUrl + '/images/edits', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey},
          body: JSON.stringify({model, prompt, image: dataURLs[0]})
        })
      });
      // 3) JSON generations：image 数组（gpt-image-2 generations 官方支持 image 输入做参考图）
      attempts.push({
        name: 'JSON /images/generations (image数组)',
        run: () => fetch(baseUrl + '/images/generations', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey},
          body: JSON.stringify({model, prompt, image: dataURLs, ...(sizeVal ? {size: sizeVal} : {}), ...(useQ ? {quality: q} : {})})
        })
      });
      // multipart edits 已确认不被 A6API 接受，不再尝试（doEdit 保留备用）

      let lastErr = null;
      for (const a of attempts){
        setTaskStatus(task, '图生图 ' + sizeLabel + '：' + a.name);
        try{
          data = await readJson(await a.run());
          break;
        }catch(e){
          lastErr = e;
          logs.push(a.name + ' → ' + String(e.message).split('\n').join(' | ').slice(0, 220));
          // 致命错误（余额不足、模型不存在、限流、鉴权失败）直接抛出，重试无意义
          if (fatalErr.test(String(e.message))) throw e;
          // 网络层失败（CORS/断网/连接重置）换参数格式重试无意义，直接结束循环
          if (isNetErr(e)) break;
          // 参数类错误或上游不可用 → 继续尝试下一个方案
        }
      }
      if (!data){
        const err = lastErr ? new Error(lastErr.message) : new Error('图生图请求失败（多次重试均未成功）');
        err.message += '\n\n—— 各次尝试诊断 ——\n' + logs.join('\n');
        if (lastErr && /上游|不可用|upstream|unavailable|503|5\d\d/i.test(String(lastErr.message))){
          err.message += '\n\n💡 说明：JSON 参数已被网关接受（格式正确），当前是 A6API 上游渠道暂时不可用：\n1) 稍等 1~2 分钟重试；\n2) 在 A6API 控制台对当前模型开启「智能优选」或切换固定商家；\n3) 换一个模型试试（如 gpt-image-1）。';
        }
        throw err;
      }
      if (logs.length > 0) toast('已自动改用兼容格式请求成功');
      } // end of GPT 图生图 else
    }

    const item = data.data[0];
    const src = item.url || ('data:image/png;base64,' + item.b64_json);
    task.src = src;
    finishTask(task);
    task.el.result.classList.remove('hidden');
    task.el.result.querySelector('img').src = src;
    task.el.thumb.src = src;
    task.el.card.classList.add('has-result');
    showMainResult(src, sizeVal);
    history.unshift(src);
    renderHistory();
    const cache = window.GPTImageCache;
    if (cache && typeof cache.save === 'function'){
      cache.save(src).then(ok => {
        if (ok) toast('已缓存：1 小时内刷新页面仍可查看这张图片');
      }).catch(()=>{});
    }
  }catch(e){
    let msg = '生成失败：' + e.message;
    if (isNetErr(e)) msg += '\n\n' + netErrHint();
    failTask(task, msg);
  }finally{
    clearInterval(task.timer);
    task.timer = null;
  }
}

$('go').onclick = startTask;

$('prompt').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') startTask();
});

/* ================= 提示词放大编辑 ================= */
const peBox = $('promptEditor');
const peText = $('peText');
const peModeSel = $('peMode');
const peStat = $('peStat');
const peUndoBtn = $('peUndo');
const peHistory = [];        // 排版前的内容快照，可连续撤销
let peInternal = false;      // 由脚本改写 textarea 时置位，避免误清撤销栈

function openPromptEditor(){
  peText.value = $('prompt').value;
  peBox.style.display = 'flex';
  peHistory.length = 0;
  syncPeUndo();
  syncPeStat();
  document.body.style.overflow = 'hidden';
  peText.focus();
  const n = peText.value.length;
  try{ peText.setSelectionRange(n, n); peText.scrollTop = peText.scrollHeight; }catch(e){}
}
function closePromptEditor(save){
  if (save) $('prompt').value = peText.value;
  peBox.style.display = 'none';
  document.body.style.overflow = '';
  $('prompt').focus();
}
function setPeValue(v){
  peInternal = true; peText.value = v; peInternal = false;
  syncPeStat();
  try{ peText.setSelectionRange(0, 0); }catch(e){}
  peText.scrollTop = 0;
  peText.focus();
}
function syncPeStat(){
  const v = peText.value;
  peStat.textContent = v.length + ' 字 · ' + (v ? v.split('\n').length : 0) + ' 行';
}
function syncPeUndo(){ peUndoBtn.disabled = peHistory.length === 0; }

$('zoomPrompt').onclick = openPromptEditor;
$('peConfirm').onclick = () => closePromptEditor(true);
$('peCancel').onclick = () => closePromptEditor(false);
peBox.addEventListener('click', e => { if (e.target === peBox) closePromptEditor(false); });
peText.addEventListener('input', () => {
  if (!peInternal){ peHistory.length = 0; syncPeUndo(); }   // 手动改过，撤销栈作废
  syncPeStat();
});
peText.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter'){ e.preventDefault(); closePromptEditor(true); }
  else if (e.key === 'Escape'){ e.preventDefault(); closePromptEditor(false); }
});

/* ---------------- 提示词排版 ----------------
   只做三件事：把字面 "\n" 还原成真实换行；在合适的位置**插入**换行（字段标签前额外留一行空行）；
   清理行尾空格与 3 个以上连续空行。除此之外不删、不改任何字符，发给模型的语义不变。 */
const PE_WS = /[\s\u3000]/;
const PE_CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const PE_HARD_CN = '。！？；';          // 强标点：无条件断行
const PE_SOFT_CN = '，、,';             // 软标点：攒够字数才断（冒号不断，"风格：xxx""16:9" 保持在一行）
const PE_CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
// 常见提示词字段名；长的排前面，避免 "负面提示词" 被拆成 "负面 / 提示词"
const PE_LABELS = ['负面提示词','正向提示词','画面主体','画面描述','主体描述','参考图','提示词','关键词','负面提示','正向提示',
  '主体','人物','角色','场景','背景','环境','前景','中景','远景','构图','视角','机位','镜头','景别','光线','光影','打光',
  '氛围','情绪','风格','画风','流派','色彩','配色','色调','服装','服饰','造型','发型','表情','神态','动作','姿势','道具',
  '细节','材质','质感','画质','清晰度','渲染','后期','参数','负面','文字','标题','标语','排版','水印','画面','主题',
  '描述','备注','要求','说明','注意','其他','补充','输出','尺寸','比例']
  .sort((a, b) => b.length - a.length);
const PE_LABEL_RE = new RegExp('(?:' + PE_LABELS.join('|') + ')$');
const PE_MODES = {
  smart: {soft: 30,  blank: true},    // 智能分段：强标点必断，逗号满 30 字断，字段标签前留空行
  line:  {soft: 1,   blank: false},   // 逐句换行：一个标点一行，最清晰
  block: {soft: 140, blank: false}    // 只断长句：改动最少，适合本来就有分段的一段话
};
function peDigit(c){ return c >= '0' && c <= '9'; }

function typesetPrompt(src, mode){
  const o = PE_MODES[mode] || PE_MODES.smart;
  let s = String(src === null || src === undefined ? '' : src);
  s = s.replace(/\r\n?/g, '\n').replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
  const out = [];
  const blocks = s.split('\n');
  for (let b = 0; b < blocks.length; b++){
    const pieces = peSplitLine(blocks[b], o);
    for (let k = 0; k < pieces.length; k++){
      if (out.length && pieces[k].blank && out[out.length - 1] !== '') out.push('');
      out.push(pieces[k].t);
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

// 把一行拆成若干小段，返回 [{t, blank}]，blank = 该段前面要不要留一行空行
function peSplitLine(line, o){
  const res = [];
  if (!line) return res;
  let start = 0, since = 0, blank = false;
  function flush(end){                       // 结束 [start, end) 这一段
    const t = line.slice(start, end).replace(/^[\s\u3000]+/, '').replace(/[\s\u3000]+$/, '');   // 只去首尾空白，不动正文
    if (t) res.push({t: t, blank: blank});
    blank = false;
    start = end;
    while (start < line.length && PE_WS.test(line[start])) start++;   // 段首空格丢掉
    since = 0;
  }
  for (let i = 0; i < line.length; i++){
    const ch = line[i], prev = line[i - 1] || '', next = line[i + 1] || '';
    if (!PE_WS.test(ch)) since++;
    const nn = PE_WS.test(next) ? (line[i + 2] || '') : next;         // 下一个非空白字符

    /* ① 字段标签（风格：… / 【构图】…）：标签单独起一段，前面留空行 */
    if (o.blank && (ch === '：' || ch === ':') && i > start){
      const raw = line.slice(start, i);
      const lead = raw.length - raw.replace(/^[\s\u3000]+/, '').length;   // 段首空白长度
      const body = raw.replace(/[\s\u3000]+$/, '').slice(lead);           // 去掉首尾空白后的文本
      if (body && body.length <= 12){                                        // 只在标签很短时认定为字段名
        const m = PE_LABEL_RE.exec(body);
        if (m){
          const j = start + lead + (body.length - m[0].length);              // 标签在原文中的真实起点
          if (j > start){ flush(j); since = i - j + 1; }
          blank = true;                 // 是否真的留空行，由拼接处判断（首段不会多出空行）
        }
      }
    } else if (o.blank && ch === '】'){
      const j = line.lastIndexOf('【', i);
      if (j >= start && i - j <= 26){
        if (j > start){ flush(j); since = i - j + 1; }
        blank = true;
      }
    }

    /* ② 强标点断行（英文句号排除小数 3.5 与缩写 e.g.） */
    let hard = PE_HARD_CN.indexOf(ch) >= 0;
    if (!hard && (ch === '!' || ch === '?' || ch === ';')) hard = true;
    if (!hard && ch === '.' && prev !== '.' && !peDigit(nn) && /[A-Z\u3400-\u4dbf\u4e00-\u9fff]/.test(nn)) hard = true;
    if (hard && i + 1 < line.length){ flush(i + 1); continue; }

    /* ③ 编号与项目符号：在标记前断行，让标记跟着自己的内容 */
    if (i > start){
      let brk = false;
      if (PE_CIRCLED.indexOf(ch) >= 0) brk = true;
      else if ((ch === '•' || ch === '·' || ch === '*') && PE_WS.test(prev)) brk = since >= 6;
      else if (ch === '-' && PE_WS.test(prev) && !PE_WS.test(next) && !peDigit(next)) brk = since >= 10;
      else if (peDigit(ch) && !peDigit(prev) && !/[A-Za-z]/.test(prev) && since >= 3 &&
               (prev === '' || PE_WS.test(prev) || (PE_HARD_CN + '，,、：:').indexOf(prev) >= 0)){
        const m2 = /^(\d{1,3})([、)）.])(\s*)/.exec(line.slice(i, i + 6));
        if (m2){
          const after = line[i + m2[0].length] || '';
          if (m2[2] !== '.' || PE_WS.test(m2[3]) || PE_CJK.test(after) || /[A-Z]/.test(after)) brk = true;
        }
      }
      if (brk) flush(i);
    }

    /* ④ 软标点断行（千分位 1,024 与编号 "1、" 后面的顿号不断） */
    if (PE_SOFT_CN.indexOf(ch) >= 0 && i + 1 < line.length){
      const skip = (ch === ',' && peDigit(prev) && peDigit(next)) || (ch === '、' && peDigit(prev));
      if (!skip && since >= o.soft) flush(i + 1);
    }
  }
  flush(line.length);
  return res;
}

peModeSel.value = store.get('gptimg_pe_mode') || 'smart';
peModeSel.onchange = () => store.set('gptimg_pe_mode', peModeSel.value);
$('peFormat').onclick = () => {
  const before = peText.value;
  if (!before.trim()){ toast('提示词还是空的，先把内容粘进来再排版'); return; }
  const after = typesetPrompt(before, peModeSel.value);
  if (after === before){ toast('这段提示词已经很规整了，没有需要断行的地方'); return; }
  peHistory.push(before);
  if (peHistory.length > 20) peHistory.shift();
  syncPeUndo();
  setPeValue(after);
  toast('已排版：只插入换行，没删任何字（点 ↩️ 撤销 可还原）');
};
peUndoBtn.onclick = () => {
  if (!peHistory.length) return;
  setPeValue(peHistory.pop());
  syncPeUndo();
  toast('已撤销上一次排版');
};

function showErr(msg){ $('err').textContent = msg || ''; }

/* ================= 连接测试 / 网络层错误诊断 ================= */
// fetch 抛出 TypeError（Failed to fetch / NetworkError / Load failed）= 网络层失败，
// 说明请求没有拿到任何 HTTP 响应，与"服务端是否接收参数"无关（参数问题会返回 HTTP 4xx/5xx + 错误详情）。
function isNetErr(e){
  return e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(e && e.message));
}
function netErrHint(){
  const tips = ['💡 "Failed to fetch" 是浏览器网络层错误：服务器没有返回任何 HTTP 响应，不是参数格式问题（参数问题会收到 HTTP 4xx/5xx 及错误详情）。请按顺序排查：'];
  if (location.protocol === 'file:'){
    tips.push('1) 你正以 file:// 直接打开页面，浏览器来源为 null，绝大多数 API 网关不允许跨域 → 请用本地静态服务器打开本目录（如 npx serve . 或 python -m http.server），再从 http://localhost 访问；');
  } else {
    tips.push('1) 跨域（CORS）被拦：网关未返回 Access-Control-Allow-Origin → 换支持 CORS 的网关，或自建反向代理转发；');
  }
  tips.push('2) 混合内容：若本页是 https:// 而 API 地址填的 http://，浏览器会直接拦截 → 把 API 地址改成 https://；');
  tips.push('3) 地址错误 / 服务宕机 / 代理拦截：确认 API 地址拼写正确且以 /v1 结尾；');
  tips.push('4) 图生图时 base64 请求体过大被网关重置连接：减少参考图数量，或先把图片压缩到 1MB 以内。');
  tips.push('👉 点击设置面板里的「🔌 测试连接」可一键定位是哪一种。');
  return tips.join('\n');
}

$('testConn').onclick = async () => {
  const typedUrl = $('baseUrl').value.trim().replace(/\/+$/, '');
  const baseUrl = effectiveBaseUrl(typedUrl, $('provider').value);
  const apiKey = $('apiKey').value.trim();
  const out = $('connResult');
  if (!baseUrl){ out.textContent = '请先填写 API 地址'; return; }
  if (needsRelay(typedUrl, $('provider').value)){
    out.textContent = '不用测了，这个组合一定失败：页面运行在 ' + location.hostname
      + '（远程托管），而地址是商汤官方域名 —— 浏览器会被跨域拦截，本地 server.js 代理也用不上。\n'
      + '请把 API 地址改成 Cloudflare Worker 中转地址（https://xxxx.workers.dev/v1），'
      + '或回到本机用 http://localhost:8788 打开。';
    return;
  }
  out.textContent = '正在测试 ' + baseUrl + ' …'
    + (baseUrl !== typedUrl ? '（已按本机代理兜底改用 ' + baseUrl + '，设置里填的地址不变）' : '');
  const t0 = Date.now();
  try{
    const res = await fetch(baseUrl + '/models', {
      headers: apiKey ? {'Authorization': 'Bearer ' + apiKey} : {}
    });
    const ms = Date.now() - t0;
    if (res.ok){
      out.textContent = '✅ 连接成功（HTTP ' + res.status + '，' + ms + 'ms）\n网络和跨域都正常，若生图仍失败才是参数/上游问题。';
    } else if (res.status === 401 || res.status === 403){
      out.textContent = '🔑 网络和跨域正常，但鉴权失败（HTTP ' + res.status + '）→ 检查 API Key 是否正确、有无该模型权限。';
    } else if (res.status === 404){
      out.textContent = '⚠️ 能连上服务器，但 /models 返回 404 → 检查地址是否以 /v1 结尾（有些网关没有 /models 接口，404 不影响生图，可忽略直接试生成）。';
    } else {
      out.textContent = '⚠️ 服务器返回 HTTP ' + res.status + '（' + ms + 'ms）：网络通、跨域正常，问题在参数或上游渠道。';
    }
  }catch(e){
    out.textContent = '❌ 网络层失败（' + e.message + '）\n' + netErrHint();
  }
};

/* ================= 背景跟随动效 =================
   仅在有精确指针（鼠标）且未开启「减少动效」时启用。
   水墨感：光晕由「移动能量」驱动 —— 笔走得越快越亮，停手后按指数衰减慢慢敛去，
   只留一层极淡的余韵；移动时光晕还会微微放大，像墨在纸上晕开。
   触屏、键盘导航、prefers-reduced-motion 下完全不启用。 */
(function pointerFx(){
  if (!window.matchMedia || !window.requestAnimationFrame) return;
  if (!matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const bg = $('bg');
  if (!bg) return;

  /* ---- 手感参数（想更黏/更飘就调这几个） ---- */
  const DECAY     = 0.955;  // 每帧衰减系数，越小敛得越快（满亮→余韵约 1 秒）
  const RESTING   = 0.12;   // 停手后保留的余韵亮度（0 = 完全熄灭）
  const SENS      = 180;    // 灵敏度：每帧移动多少像素算「满笔」，越小越容易亮
  const MAX_RISE  = 0.85;   // 单次事件的能量增量上限，防止瞬移/切窗口时爆亮
  const EASE      = 0.12;   // 视差跟随的插值系数，越小越飘

  let mx = window.innerWidth / 2, my = window.innerHeight * 0.32;
  let px = 0, py = 0, tpx = 0, tpy = 0;   // 点阵视差：当前值 / 目标值
  let energy = 0;                          // 移动能量 0~1
  let inside = false;                      // 光标是否在窗口内
  let raf = null, last = 0;
  let hoverCard = null, cardRect = null;

  // ts 用 rAF 提供的时间戳，按真实帧间隔衰减，保证 60Hz / 120Hz 屏幕手感一致
  function frame(ts){
    raf = null;
    const now = (typeof ts === 'number' && ts > 0) ? ts : Date.now();
    const step = last ? Math.min(64, now - last) / 16.7 : 1;  // 以 60fps 归一化，掉帧时钳制
    last = now;

    // 停笔即敛：能量按指数衰减
    energy *= Math.pow(DECAY, step);
    if (energy < 0.003) energy = 0;

    // 视差缓动跟随（同样按帧间隔归一化）
    const k = 1 - Math.pow(1 - EASE, step);
    px += (tpx - px) * k;
    py += (tpy - py) * k;
    if (Math.abs(tpx - px) < 0.05) px = tpx;
    if (Math.abs(tpy - py) < 0.05) py = tpy;

    const base = inside ? RESTING : 0;
    bg.style.setProperty('--px', px.toFixed(2) + 'px');
    bg.style.setProperty('--py', py.toFixed(2) + 'px');
    bg.style.setProperty('--mx', mx.toFixed(1) + 'px');
    bg.style.setProperty('--my', my.toFixed(1) + 'px');
    bg.style.setProperty('--glow-op', (base + (1 - base) * energy).toFixed(3));
    bg.style.setProperty('--glow-scale', (0.94 + 0.16 * energy).toFixed(3));

    // 能量散尽且视差到位就停掉循环，静止时不占 CPU
    if (energy > 0 || px !== tpx || py !== tpy) raf = window.requestAnimationFrame(frame);
  }
  function kick(){ if (!raf){ last = 0; raf = window.requestAnimationFrame(frame); } }

  document.addEventListener('pointermove', e => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const dx = e.clientX - mx, dy = e.clientY - my;
    mx = e.clientX; my = e.clientY;
    inside = true;

    // 走得越快，墨越浓（上限 1）
    energy = Math.min(1, energy + Math.min(MAX_RISE, Math.sqrt(dx * dx + dy * dy) / SENS));

    // 点阵反向位移，最大 ±26px（.bg-grid 用 inset:-8% 外扩，不会露出边缘）
    tpx = (mx / window.innerWidth - 0.5) * -52;
    tpy = (my / window.innerHeight - 0.5) * -52;

    kick();

    // 卡片内的光标高亮（rect 缓存，滚动/缩放时失效重取）
    const t = e.target;
    const card = (t && t.closest) ? t.closest('.card') : null;
    if (card !== hoverCard){
      if (hoverCard) hoverCard.classList.remove('fx-hover');
      hoverCard = card;
      cardRect = null;
      if (card) card.classList.add('fx-hover');
    }
    if (!card) return;
    if (!cardRect) cardRect = card.getBoundingClientRect();
    card.style.setProperty('--cx', (mx - cardRect.left).toFixed(1) + 'px');
    card.style.setProperty('--cy', (my - cardRect.top).toFixed(1) + 'px');
  }, {passive: true});

  // 光标移出窗口 → 墨迹完全敛去
  document.addEventListener('mouseleave', () => {
    inside = false;
    energy = 0;
    if (hoverCard){ hoverCard.classList.remove('fx-hover'); hoverCard = null; }
    kick();
  });

  // 滚动（含内部滚动容器，用捕获）与缩放后卡片位置变了，缓存作废
  window.addEventListener('scroll', () => { cardRect = null; }, {passive: true, capture: true});
  window.addEventListener('resize', () => { cardRect = null; }, {passive: true});
})();

/* ================= 本地缓存恢复 ================= */
function restoreCachedImages(){
  const cache = window.GPTImageCache;
  if (!cache || typeof cache.load !== 'function') return;
  cache.load().then(entries => {
    if (!entries || !entries.length) return;
    entries.forEach(en => {
      if (en.src && history.indexOf(en.src) === -1) history.push(en.src);
    });
    renderHistory();
    if (!currentSrc && history.length){
      showMainResult(history[0], null);
    }
  }).catch(e => {
    if (window.console) console.warn('恢复本地图片缓存失败', e);
  });
}
restoreCachedImages();
})();
