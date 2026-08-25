(function(){
'use strict';
const $ = id => document.getElementById(id);

const store = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
};
function fatal(msg){
  const el = $('fatal');
  el.textContent = '⚠️ 页面内部错误：' + msg;
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
  $('themeBtn').textContent = t === 'dark' ? '☀️' : '🌙';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#0b0d10' : '#f4f6f9';
  store.set('gptimg_theme', t);
}
$('themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
applyTheme(store.get('gptimg_theme') || ((window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark'));

/* ================= 尺寸选择器 ================= */
let sizeMode = 'auto';
let baseRes = 3840;
let ratioKey = '16:9';

function parseRatio(){
  if (ratioKey !== 'custom'){
    const p = ratioKey.split(':');
    return [parseFloat(p[0]) || 1, parseFloat(p[1]) || 1];
  }
  return [parseFloat($('ratioW').value) || 1, parseFloat($('ratioH').value) || 1];
}
function normalizeSize(w, h){
  w = Math.max(w, 1); h = Math.max(h, 1);
  if (w / h > 3) w = h * 3;
  if (h / w > 3) h = w * 3;
  const sMax = 3840 / Math.max(w, h);
  if (sMax < 1){ w *= sMax; h *= sMax; }
  const maxPx = 8294400, minPx = 655360;
  const px = w * h;
  if (px > maxPx){ const s = Math.sqrt(maxPx / px); w *= s; h *= s; }
  if (px < minPx){ const s = Math.sqrt(minPx / px); w *= s; h *= s; }
  w = Math.round(w / 16) * 16;
  h = Math.round(h / 16) * 16;
  w = Math.min(Math.max(w, 16), 3840);
  h = Math.min(Math.max(h, 16), 3840);
  while (w * h < minPx && (w < 3840 || h < 3840)){ if (w <= h) w = Math.min(w + 16, 3840); else h = Math.min(h + 16, 3840); }
  while (w * h > maxPx && (w > 16 || h > 16)){ if (w >= h) w = Math.max(w - 16, 16); else h = Math.max(h - 16, 16); }
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
  return normalizeSize(parseInt($('cw').value) || 1024, parseInt($('ch').value) || 1024);
}
function refreshWillUse(){
  const s = computeSize();
  $('willuse').innerHTML = s
    ? '将使用 <b>' + s[0] + 'x' + s[1] + '</b>（约 ' + (s[0] * s[1] / 1e6).toFixed(1) + ' MP）'
    : '将使用 <b>自动</b>（由模型自己决定生成尺寸）';
}
document.querySelectorAll('#sizeTabs .tab').forEach(t => {
  t.onclick = () => {
    sizeMode = t.dataset.s;
    document.querySelectorAll('#sizeTabs .tab').forEach(x => x.classList.toggle('active', x === t));
    $('panel-auto').style.display = sizeMode === 'auto' ? '' : 'none';
    $('panel-ratio').style.display = sizeMode === 'ratio' ? '' : 'none';
    $('panel-custom').style.display = sizeMode === 'custom' ? '' : 'none';
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
  btn.textContent = activeTasks ? ('🚀 生成图片（进行中：' + activeTasks + '）') : '🚀 生成图片';
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
  const badge = makeEl('span', 'task-badge', task.mode === 'gen' ? '文生图' : '图生图');
  const title = makeEl('div', 'task-title', '任务 #' + task.id + ' · ' + task.sizeLabel);
  head.appendChild(badge);
  head.appendChild(title);
  const promptEl = makeEl('div', 'task-prompt', task.prompt);
  const status = makeEl('div', 'task-status');
  status.appendChild(makeEl('span', 'spinner'));
  const statusText = makeEl('span', 'task-status-text');
  status.appendChild(statusText);
  const errorEl = makeEl('div', 'task-error hidden');
  const failActions = makeEl('div', 'task-actions hidden');
  const reuseBtn = makeEl('button', 'btn small', '🔄 复用配置');
  failActions.appendChild(reuseBtn);
  const result = makeEl('div', 'task-result hidden');
  const img = makeEl('img');
  img.alt = '生成结果';
  const meta = makeEl('div', 'task-meta');
  const actions = makeEl('div', 'task-actions');
  const viewBtn = makeEl('button', 'btn small', '🔍 查看大图');
  const saveBtn = makeEl('button', 'btn small', '⬇️ 保存图片');
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
  $('taskList').insertBefore(card, $('taskList').firstChild);
  task.el = {card: card, status: status, statusText: statusText, error: errorEl, failActions: failActions, result: result};
}
function setTaskStatus(task, text){
  task.statusBase = text;
  task.el.statusText.textContent = text + '…（已等待 ' + task.secs + ' 秒，生图通常要 10~60 秒）';
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
  task.el.statusText.textContent = '✅ 已完成，用时 ' + task.secs + ' 秒';
}
function failTask(task, msg){
  clearInterval(task.timer);
  task.timer = null;
  task.el.status.classList.add('fail');
  task.el.statusText.textContent = '❌ 生成失败';
  task.el.error.textContent = msg;
  task.el.error.classList.remove('hidden');
  task.el.failActions.classList.remove('hidden');
}


try{
  const saved = JSON.parse(store.get('gptimg_cfg') || '{}');
  if (saved.baseUrl) $('baseUrl').value = saved.baseUrl;
  if (saved.apiKey) $('apiKey').value = saved.apiKey;
  if (saved.model) $('model').value = saved.model;
}catch(e){}

$('cfgToggle').onclick = () => {
  const c = $('cfg');
  c.style.display = c.style.display === 'none' ? '' : 'none';
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
  $('quality').value = task.quality;
  switchMode(task.mode === 'edit' ? 'edit' : 'gen');

  const cfg = task.size || {};
  sizeMode = cfg.sizeMode || 'auto';
  baseRes = cfg.baseRes || 3840;
  ratioKey = cfg.ratioKey || '16:9';
  $('ratioW').value = cfg.ratioW || 1;
  $('ratioH').value = cfg.ratioH || 1;
  $('cw').value = cfg.cw || 1024;
  $('ch').value = cfg.ch || 1024;

  document.querySelectorAll('#sizeTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.s === sizeMode));
  $('panel-auto').style.display = sizeMode === 'auto' ? '' : 'none';
  $('panel-ratio').style.display = sizeMode === 'ratio' ? '' : 'none';
  $('panel-custom').style.display = sizeMode === 'custom' ? '' : 'none';
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
    let t = '📏 实际输出：<b>' + w + 'x' + h + '</b>（' + (w * h / 1e6).toFixed(2) + ' MP）';
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
    b.textContent = '⬇';
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
  const baseUrl = $('baseUrl').value.trim().replace(/\/+$/, '');
  const apiKey = $('apiKey').value.trim();
  if (!baseUrl || !apiKey){ showErr('请先在设置里填写 API 地址和 Key'); return; }
  if (mode === 'edit' && refImages.length === 0){ showErr('图生图模式请至少上传 1 张参考图'); return; }
  showErr('');

  const model = $('model').value.trim() || 'gpt-image-2';
  store.set('gptimg_cfg', JSON.stringify({baseUrl, apiKey, model: model}));
  const s = computeSize();
  const sizeVal = s ? (s[0] + 'x' + s[1]) : null;
  const sizeLabel = sizeVal || '自动';
  const task = {
    id: ++taskSeq,
    mode: mode,
    prompt: prompt,
    quality: $('quality').value,
    model: model,
    baseUrl: baseUrl,
    apiKey: apiKey,
    sizeVal: sizeVal,
    sizeLabel: sizeLabel,
    size: {
      sizeMode: sizeMode,
      baseRes: baseRes,
      ratioKey: ratioKey,
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
  const baseUrl = task.baseUrl;
  const apiKey = task.apiKey;
  const model = task.model;
  const sizeVal = task.sizeVal;
  const sizeLabel = task.sizeLabel;
  const q = task.quality;
  const useQ = q && q !== 'auto';
  let data;

  startTaskTimer(task, (task.mode === 'gen' ? '✍️ 文生图' : '🖼️ 图生图') + '（' + sizeLabel + '），正在生成');
  try{
    if (task.mode === 'gen'){
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
    }

    const item = data.data[0];
    const src = item.url || ('data:image/png;base64,' + item.b64_json);
    task.src = src;
    finishTask(task);
    task.el.result.classList.remove('hidden');
    task.el.result.querySelector('img').src = src;
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
    failTask(task, '生成失败：' + e.message);
  }finally{
    clearInterval(task.timer);
    task.timer = null;
  }
}

$('go').onclick = startTask;

$('prompt').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') startTask();
});

function showErr(msg){ $('err').textContent = msg || ''; }

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
