const canvas = document.getElementById('map-canvas');
const stage = document.getElementById('map-stage');
const bg = document.getElementById('map-bg');
const sharpenKernel = document.getElementById('sharpen-kernel');
const layer = document.getElementById('marker-layer');
const roadLayer = document.getElementById('road-layer');
const roadTagLayer = document.getElementById('road-tag-layer');
const pop = document.getElementById('create-pop');
const popSave = document.getElementById('pop-save');
const closureBox = document.getElementById('closure-box');
const closureCheck = document.getElementById('pop-closure');
const pathTools = document.getElementById('path-tools');
const pathHint = document.getElementById('path-hint');
const pathDrawBtn = document.getElementById('path-draw');
const pathCountEl = document.getElementById('path-count');
const miniCount = document.getElementById('mini-count');
const capBox = document.getElementById('cap-box');
const capInput = document.getElementById('pop-capacity');
const approvalBox = document.getElementById('approval-box');
const approvalCheck = document.getElementById('pop-approval');
const teamSec = document.getElementById('p-team');
const applyBox = document.getElementById('apply-box');
const applyList = document.getElementById('apply-list');
const joinBtn = document.getElementById('p-join');
const board = document.getElementById('board');
const idle = document.getElementById('panel-idle');
const spotList = document.getElementById('spot-list');
const boardMeta = document.getElementById('board-meta');
const boardTitle = document.getElementById('board-title');
const panelBody = document.getElementById('panel-body');
const layoutEl = document.getElementById('layout');
const panelEl = document.getElementById('detail-panel');
const panelToggle = document.getElementById('panel-toggle');
const panelLabel = document.getElementById('panel-label');
const boardSwitch = document.getElementById('board-switch');
const filterBar = document.getElementById('filter-bar');
const filterRow = document.querySelector('.filter-row');
const locPanel = document.getElementById('loc-panel');
const catRow = document.getElementById('cat-row');
const zoomLevel = document.getElementById('zoom-level');
const hint = document.querySelector('.map-hint');

const FALLBACK_SOURCE = '/img/campus-fallback.svg';
const MIN_K = 1;
const MAX_K = 8;
// 底图顶部按高度比例剪掉一点（0.12 = 剪掉 12%），剩下的窗口在画布里居中；拖动仍可看到被剪掉的部分
const MAP_CROP_TOP = 0.12;
// 地图整体按比例略微缩小（0.92 = 缩到 92%），四周留一圈等宽的边；改 1 即铺满
const MAP_FIT_SCALE = 0.92;
// 宽屏右侧浮着留言板：380px 宽、浮在窗口右缘，占 398px（地点目录是下拉，不遮地图右边）
const PANEL_COVER = 398;
let sharpFrom = 1;
const mapNat = { w: 0, h: 0 };
let vectorMap = false;
const CATS = {
  message: { official: '学校发布', study: '学习', fun: '娱乐', life: '生活' },
  team: { course: '课程', contest: '竞赛', selfstudy: '自习', sport: '运动' },
};
const POINT_WORD = { message: '留言点', team: '组队点' };
const ROLE_LABEL = { student: '学生', teacher: '老师', official: '官方' };
const BOARD_PANEL_NAME = { message: '留言板', team: '组队板' };

let me = null;
let points = [];
let current = null;
let pendingPos = null;
let pendingCat = 'study';
let filter = 'all';
let boardKey = 'message';
let clusters = [];
let openSpot = null;
let locOpen = false;
let drawPath = [];
let drawing = false;
let stageW = 0;
let stageH = 0;
let fitBox = null;
const view = { k: 1, tx: 0, ty: 0 };

api.get('/api/me').then(({ user }) => {
  if (!user) { location.href = '/'; return null; }
  me = user;
  document.getElementById('chip-nickname').textContent = user.nickname;
  const tag = document.getElementById('chip-role');
  tag.textContent = me.official ? '官方模式' : ROLE_LABEL[me.role];
  tag.className = `role-tag role-${me.official ? 'official' : me.role}`;
  tag.hidden = !me.official && me.role === 'student';
  tag.title = me.official
    ? '本次登录使用了官方编码：可发布「学校发布」通知并标注禁行路段；退出后不填编码重新登录即回到普通身份'
    : me.role === 'teacher' ? '老师身份：注册时使用了老师编码 T2026' : '';
  renderAvatar(document.getElementById('chip-avatar'), user.avatar);
  return boot();
}).catch((err) => {
  if (!me) location.href = '/';
  else console.error('地图初始化失败', err);
});

async function boot() {
  setupCategories();
  renderFilterBar();
  renderCatRow();
  await mountMap();
  await loadPoints();
  await loadLocations();
  const targetId = Number(new URLSearchParams(location.search).get('point')) || 0;
  if (!targetId) return;
  history.replaceState(null, '', location.pathname);
  const target = points.find((it) => it.id === targetId);
  if (!target) return;
  if (target.board !== boardKey) switchBoard(target.board);
  await openPoint(targetId);
  focusLocation(target);
}

document.getElementById('user-chip').addEventListener('click', () => {
  location.href = '/profile.html';
});

document.getElementById('btn-logout').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = '退出中…';
  try {
    await api.post('/api/logout');
  } catch (err) {
    console.error('退出请求失败', err);
  }
  location.href = '/?signedout=1';
});

document.getElementById('btn-help').addEventListener('click', () => {
  document.getElementById('help-box').classList.toggle('hidden');
});

function setupCategories() {
  document.getElementById('cat-row').addEventListener('click', (e) => {
    const btn = e.target.closest('.cat');
    if (!btn || btn.disabled) return;
    pendingCat = btn.dataset.cat;
    syncCatButtons();
    syncClosureUi();
  });
  document.getElementById('filter-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    if (btn.classList.contains('loc-chip')) { setLocPanel(!locOpen); return; }
    setFilter(btn.dataset.filter);
  });
  closureCheck.addEventListener('change', () => {
    if (!closureCheck.checked) { drawing = false; drawPath = []; }
    else drawing = true;
    syncClosureUi();
  });
  const undoNode = () => { if (drawPath.length) { drawPath.pop(); syncClosureUi(); } };
  const clearNodes = () => { drawPath = []; syncClosureUi(); };
  pathDrawBtn.addEventListener('click', () => { drawing = true; syncClosureUi(); });
  document.getElementById('path-undo').addEventListener('click', undoNode);
  document.getElementById('path-clear').addEventListener('click', clearNodes);
  document.getElementById('mini-undo').addEventListener('click', undoNode);
  document.getElementById('mini-clear').addEventListener('click', clearNodes);
  document.getElementById('mini-expand').addEventListener('click', () => { drawing = false; syncClosureUi(); });
  document.getElementById('mini-cancel').addEventListener('click', closePop);
}

function syncClosureUi() {
  const allowed = pendingCat === 'official' && me.official;
  if (!allowed) { closureCheck.checked = false; drawing = false; drawPath = []; }
  closureBox.classList.toggle('hidden', !allowed);
  const closure = closureCheck.checked;
  pathTools.classList.toggle('hidden', !closure);
  pathDrawBtn.textContent = '收起并标注';
  pathHint.textContent = closure
    ? (drawPath.length >= 2
      ? `已圈定 ${drawPath.length} 个拐点、${drawPath.length - 1} 段禁行路段，填写标题后即可发布；需要改动点「收起并标注」。`
      : '点「收起并标注」，面板会缩到左上角，左键沿道路点出起点与转折点（至少 2 个），标完回来展开编辑。')
    : '';
  pathCountEl.textContent = `已标 ${drawPath.length} 个拐点`;
  miniCount.textContent = `已标 ${drawPath.length} 个拐点`;
  pop.classList.toggle('mini', drawing);
  canvas.classList.toggle('drawing', drawing);
  if (drawing) {
    pop.style.left = '12px';
    pop.style.top = '12px';
  } else if (pendingPos) {
    placePop(pendingPos);
  }
  popSave.disabled = closure && drawPath.length < 2;
  popSave.title = popSave.disabled ? '请先在地图上标出禁行路段' : '';
  renderRoads();
}

function setMarking(on) {
  drawing = on && closureCheck.checked;
  syncClosureUi();
}

document.addEventListener('keydown', (e) => {
  if (!drawing || pop.classList.contains('hidden')) return;
  if (e.key === 'Escape') setMarking(false);
  else if (e.key === 'Backspace' && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) {
    e.preventDefault();
    drawPath.pop();
    syncClosureUi();
  }
});

function setFilter(f) {
  filter = f;
  document.querySelectorAll('#filter-bar .chip').forEach((it) => it.classList.toggle('active', it.dataset.filter === f));
  syncPoints();
}

function syncCatButtons() {
  document.querySelectorAll('#cat-row .cat').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.cat === pendingCat && !btn.disabled);
  });
}

const boardCats = () => CATS[boardKey] || CATS.message;
const boardWord = () => POINT_WORD[boardKey] || '内容';
const catLabel = (p) => (CATS[p.board || 'message'] || {})[p.category] || p.category;
const boardPoints = () => points.filter((p) => (p.board || 'message') === boardKey);

// 分类按钮与筛选条按板块重建：留言是学校发布／学习／娱乐／生活，组队是课程／竞赛／自习／运动
function renderCatRow() {
  catRow.innerHTML = Object.entries(boardCats()).map(([key, label]) => {
    const locked = key === 'official' && !me.official;
    const attrs = locked ? ' disabled title="「学校发布」类型需要登录时输入官方编码（官方模式）"' : '';
    return `<button class="cat cat-${key}${pendingCat === key && !locked ? ' active' : ''}" type="button" data-cat="${key}"${attrs}>${label}</button>`;
  }).join('');
}

function renderFilterBar() {
  filterBar.innerHTML = [['all', '全部'], ...Object.entries(boardCats())].map(([key, label]) => {
    const cls = key === 'all' ? '' : ` cat-${key}`;
    return `<button class="chip${cls}${filter === key ? ' active' : ''}" type="button" data-filter="${key}">${label} <span class="chip-n">0</span></button>`;
  }).join('') + '<button class="chip loc-chip" type="button" aria-expanded="false" title="打开地点目录">地点目录</button>';
  syncLocChip();
  placeLocPanel();
}

async function mountMap() {
  const { src: found } = await api.get('/api/map-image').catch(() => ({ src: null }));
  const loader = await loadImage(found || FALLBACK_SOURCE).catch(() => loadImage(FALLBACK_SOURCE));
  const src = loader.src;
  vectorMap = /\.svg$/i.test(src);
  mapNat.w = loader.img.naturalWidth;
  mapNat.h = loader.img.naturalHeight;
  if (mapNat.w && mapNat.h) {
    canvas.style.setProperty('--map-aspect', `${mapNat.w} / ${+(mapNat.h * (1 - MAP_CROP_TOP)).toFixed(2)}`);
  }
  bg.style.backgroundImage = `url("${src}")`;
  hint.textContent = '滚轮缩放、按住左键拖动平移；右键单击空地创建留言点，双击圆针查看内容并留言。';
  fitView();
}

function setSharpen(oversample) {
  const s = +Math.min(0.42, Math.max(0.14, 0.14 * oversample)).toFixed(3);
  sharpenKernel.setAttribute('kernelMatrix', `0 ${-s} 0 ${-s} ${+(1 + 4 * s).toFixed(3)} ${-s} 0 ${-s} 0`);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve({ img: im, src: url });
    im.onerror = () => reject(new Error('底图加载失败'));
    im.src = url;
  });
}

// 右侧面板浮在地图右端之上时遮住的宽度：折叠、或窄屏（面板不浮层）时不遮
const narrowScreen = window.matchMedia('(max-width: 1080px)');
let coverCache = 0;

function refreshPanelCover() {
  if (narrowScreen.matches) { coverCache = 0; return; }
  coverCache = layoutEl.classList.contains('panel-collapsed') ? 0 : PANEL_COVER;
}

narrowScreen.addEventListener('change', () => { refreshPanelCover(); placeLocPanel(); });
refreshPanelCover();

function panelCover() {
  return coverCache;
}

function viewBox() {
  const rect = canvas.getBoundingClientRect();
  return {
    left: rect.left + canvas.clientLeft,
    top: rect.top + canvas.clientTop,
    w: canvas.clientWidth,
    h: canvas.clientHeight,
  };
}

function fitView() {
  const box = viewBox();
  fitBox = box;
  const nat = mapNat.w / mapNat.h || 1.5;
  const frac = 1 - MAP_CROP_TOP;
  // 先按「剪顶后的窗口」做 contain：stage 始终是整张底图（百分比坐标不受剪贴影响），
  // 高出来的那一截正是被剪掉的顶部；再整体乘 MAP_FIT_SCALE 略微缩小，四周按同比例留边。
  // 窗口高 = stageH × frac、宽 = stageH × nat，两者都不得超过画布，所以 stageH 取两者的上限。
  stageH = Math.min(box.w / nat, box.h / frac);
  stageW = stageH * nat;
  stageW *= MAP_FIT_SCALE;
  stageH *= MAP_FIT_SCALE;
  stage.style.width = `${stageW}px`;
  stage.style.height = `${stageH}px`;
  sharpFrom = vectorMap ? Infinity
    : (mapNat.w || stageW * 2) / (stageW * (window.devicePixelRatio || 1));
  view.k = 1;
  centerView();
  applyView();
  zoomLevel.title = sharpFrom === Infinity
    ? '矢量底图，放大不损失清晰度'
    : `超过 ${Math.round(sharpFrom * 100)}% 后底图进入放大区间，已自动锐化补偿`;
}

function centerView() {
  const box = viewBox();
  view.tx = (box.w - stageW) / 2;
  view.ty = box.h / 2 - stageH * ((1 + MAP_CROP_TOP) / 2);
}

function ensureFit() {
  const box = viewBox();
  if (fitBox && Math.abs(box.w - fitBox.w) < 0.5 && Math.abs(box.h - fitBox.h) < 0.5) return;
  const k = view.k;
  fitView();
  view.k = Math.min(MAX_K, Math.max(MIN_K, k));
  clampView();
  applyView();
}

function clampView() {
  const box = viewBox();
  const w = stageW * view.k;
  const h = stageH * view.k;
  const off = h * MAP_CROP_TOP;
  const winH = h - off;
  // 右侧被面板盖住的那一段不算可见区域：地图右缘最多停到面板左缘，保证露出来的部分始终有内容
  const cover = panelCover();
  view.tx = w <= box.w ? (box.w - w) / 2 : Math.min(0, Math.max(box.w - cover - w, view.tx));
  // 夹取按「可视窗口」而不是整张图算：窗口比画布小（整体缩小后）时居中钉住，放大后才允许在窗口内拖到边
  view.ty = winH <= box.h ? box.h / 2 - (off + winH / 2) : Math.min(-off, Math.max(box.h - off - winH, view.ty));
}

function applyView() {
  const box = viewBox();
  const w = stageW * view.k;
  const h = stageH * view.k;
  clampView();
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  stage.style.transform = `translate(${view.tx}px, ${view.ty}px)`;
  bg.style.backgroundSize = `${w}px ${h}px`;
  bg.style.backgroundPosition = `${view.tx}px ${view.ty}px`;
  // 顶部裁掉的那一截不能露在画布里：把它裁掉，可见的地图就在画布里上下等距留白
  const bandTop = view.ty + MAP_CROP_TOP * h;
  bg.style.clipPath = bandTop > 0.5 ? `inset(${bandTop}px 0 0 0)` : 'none';
  bg.classList.toggle('upscaled', view.k > sharpFrom);
  if (view.k > sharpFrom) setSharpen(view.k / sharpFrom);
  zoomLevel.textContent = `${Math.round(view.k * 100)}%`;
  if (pendingPos && !drawing) placePop(pendingPos);
}

function zoomAt(nextK, sx, sy) {
  const k = Math.min(MAX_K, Math.max(MIN_K, nextK));
  view.tx = sx - ((sx - view.tx) / view.k) * k;
  view.ty = sy - ((sy - view.ty) / view.k) * k;
  view.k = k;
  clampView();
  applyView();
}

function pctToScreen(x, y) {
  return { sx: view.tx + view.k * (x / 100 * stageW), sy: view.ty + view.k * (y / 100 * stageH) };
}

function screenToPct(sx, sy) {
  return {
    x: ((sx - view.tx) / view.k / stageW) * 100,
    y: ((sy - view.ty) / view.k / stageH) * 100,
  };
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const box = viewBox();
  zoomAt(view.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - box.left, e.clientY - box.top);
}, { passive: false });

let drag = null;
let rightSlide = null;
canvas.addEventListener('pointerdown', (e) => {
  rightSlide = e.button === 2 ? { x: e.clientX, y: e.clientY, moved: false } : null;
  if (e.target.closest('.marker') || e.target.closest('.create-pop') || e.target.closest('.road-label')) return;
  // 平移只认左键：右键（含中键）滑动不再触发任何手势
  if (e.button !== 0) return;
  e.preventDefault();
  drag = { startX: e.clientX, startY: e.clientY, tx: view.tx, ty: view.ty, moved: false };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (rightSlide && !rightSlide.moved && Math.hypot(e.clientX - rightSlide.x, e.clientY - rightSlide.y) >= 4) rightSlide.moved = true;
  if (!drag) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true;
  canvas.classList.add('panning');
  view.tx = drag.tx + dx;
  view.ty = drag.ty + dy;
  clampView();
  applyView();
});

canvas.addEventListener('pointerup', (e) => {
  if (!drag) return;
  canvas.classList.remove('panning');
  const wasDrag = drag.moved;
  drag = null;
  if (drawing && !wasDrag && !pop.classList.contains('hidden')) {
    const box = viewBox();
    const { x, y } = screenToPct(e.clientX - box.left, e.clientY - box.top);
    if (x >= 0.5 && x <= 99.5 && y >= 0.5 && y <= 99.5) {
      drawPath.push([+x.toFixed(2), +y.toFixed(2)]);
      syncClosureUi();
    }
  } else if (!wasDrag) {
    dismissMapOverlays();
  }
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (rightSlide && rightSlide.moved) return; // 右键滑动过：不当作「右键点空地」，不弹创建窗
  if (e.target.closest('.marker') || e.target.closest('.create-pop')) return;
  if (drawing) return; // 标注中：右键不再结束标注，只有「取消」或「展开编辑」才退出
  ensureFit();
  const box = viewBox();
  const { x, y } = screenToPct(e.clientX - box.left, e.clientY - box.top);
  if (x < 0.5 || x > 99.5 || y < 0.5 || y > 99.5) return;
  openPop({ x, y });
});

document.getElementById('zoom-in').addEventListener('click', () => {
  const box = viewBox();
  zoomAt(view.k * 1.3, box.w / 2, box.h / 2);
});
document.getElementById('zoom-out').addEventListener('click', () => {
  const box = viewBox();
  zoomAt(view.k / 1.3, box.w / 2, box.h / 2);
});
document.getElementById('zoom-reset').addEventListener('click', () => {
  view.k = 1;
  centerView();
  applyView();
});
new ResizeObserver(ensureFit).observe(canvas);

async function loadPoints() {
  const data = await api.get('/api/points');
  points = data.points;
  syncPoints();
}

function syncPoints() {
  const list = visiblePoints();
  const onBoard = boardPoints();
  document.querySelectorAll('#filter-bar .chip').forEach((chip) => {
    const f = chip.dataset.filter;
    if (!f) return;   // 末尾的「地点目录」是动作按钮，没有计数
    chip.querySelector('.chip-n').textContent = f === 'all' ? onBoard.length : onBoard.filter((p) => p.category === f).length;
  });
  // 封路类留言只用警戒线表示，不再画圆针
  clusters = clusterPoints(list.filter((p) => !roadSegs(p)));
  drawMarkers();
  renderRoads();
  refreshBoard();
  renderMine();
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function roadPoints(pts) {
  return pts.map((p) => `${p[0]},${p[1]}`).join(' ');
}

function roadSegs(p) {
  return Array.isArray(p.road_path) && p.road_path.length >= 2 ? p.road_path : null;
}

function midOfPath(pts) {
  const i = Math.floor((pts.length - 1) / 2);
  const a = pts[i];
  const b = pts[i + 1] ?? pts[i];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function renderRoads() {
  roadLayer.innerHTML = '';
  roadTagLayer.innerHTML = '';
  visiblePoints().forEach((p) => {
    const seg = roadSegs(p);
    if (!seg) return;
    const pts = roadPoints(seg);
    roadLayer.appendChild(svgEl('polyline', { points: pts, class: 'road-halo' }));
    roadLayer.appendChild(svgEl('polyline', { points: pts, class: 'road-line' }));
    const mid = midOfPath(seg);
    // 留言入口只挂在「修路」这两个字上：警戒线本身不再可点
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'road-label';
    label.style.left = `${mid[0]}%`;
    label.style.top = `${mid[1]}%`;
    label.textContent = '修路';
    label.title = `禁行路段｜${p.author}：${p.title}（单击查看并留言）`;
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      closePop();
      openPoint(p.id);
    });
    roadTagLayer.appendChild(label);
  });
  if (drawPath.length) {
    if (drawPath.length >= 2) {
      roadLayer.appendChild(svgEl('polyline', { points: roadPoints(drawPath), class: 'road-draft' }));
    }
    drawPath.forEach((pt, i) => {
      const node = document.createElement('span');
      node.className = 'road-node' + (i === 0 ? ' first' : '');
      node.style.left = `${pt[0]}%`;
      node.style.top = `${pt[1]}%`;
      node.textContent = String(i + 1);
      roadTagLayer.appendChild(node);
    });
  }
}

function visiblePoints() {
  // 每个板块只看自己的点：圆针、警戒线、筛选计数全部走这一个出口
  const list = boardPoints();
  return filter === 'all' ? list : list.filter((p) => p.category === filter);
}

function drawMarkers() {
  layer.innerHTML = '';
  clusters.forEach((c) => {
    const single = c.pts.length === 1 ? c.pts[0] : null;
    const warned = c.pts.some((p) => p.warning);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'marker'
      + (c.cat ? ` cat-${c.cat}` : '')
      + (single ? (single.author_id === me.id ? ' mine' : '') : ' stack')
      + (warned ? ' warn' : '')
      + (openSpot && openSpot === clusterKey(c.pts) ? ' active' : '');
    b.style.left = `${c.cx}%`;
    b.style.top = `${c.cy}%`;
    b.title = (warned ? '⚠ 警告｜' : '') + (single
      ? `${catLabel(single)}｜${single.author}：${single.title}${
        single.board === 'team' ? `（${single.member_count || 0}${single.capacity ? `/${single.capacity}` : ''} 人）` : ''
      }（双击打开）`
      : `同一地点 ${c.pts.length} 个${boardWord()}（双击展开）：${c.pts.map((p) => p.title).join('、')}`);
    const inner = document.createElement('span');
    inner.className = 'marker-inner';
    inner.textContent = single ? (warned ? '!' : (single.avatar || '🙂').split('|')[0]) : String(c.pts.length);
    const label = document.createElement('span');
    label.className = 'marker-label';
    label.textContent = single ? single.title : `${c.pts.length} 个${boardWord()}`;
    inner.appendChild(label);
    const comments = c.pts.reduce((n, p) => n + p.comment_count, 0);
    if (comments) {
      const badge = document.createElement('span');
      badge.className = 'marker-badge';
      badge.textContent = comments;
      inner.appendChild(badge);
    }
    b.appendChild(inner);
    b.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      closePop();
      if (single) openPoint(single.id);
      else openSpotList(c);
    });
    layer.appendChild(b);
  });
}

const CLUSTER_R = 0.022; // 约等于两个圆针互相压住的距离，只有同一地点才堆叠

function clusterPoints(list) {
  const parent = list.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const limit = CLUSTER_R * stageW;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const dx = (list[i].x - list[j].x) / 100 * stageW;
      const dy = (list[i].y - list[j].y) / 100 * stageH;
      if (Math.hypot(dx, dy) <= limit) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  list.forEach((p, i) => {
    const key = find(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  return [...groups.values()].map((pts) => {
    const sorted = pts.slice().sort((a, b) => b.id - a.id);
    const xs = sorted.map((p) => p.x);
    const ys = sorted.map((p) => p.y);
    return {
      pts: sorted,
      cat: sorted.every((p) => p.category === sorted[0].category) ? sorted[0].category : null,
      cx: (Math.min(...xs) + Math.max(...xs)) / 2,
      cy: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
  });
}

function clusterKey(pts) {
  return pts.map((p) => p.id).sort((a, b) => a - b).join(',');
}

function spotPoints() {
  if (!openSpot) return [];
  const ids = openSpot.split(',').map(Number);
  const list = points.filter((p) => ids.includes(p.id)).sort((a, b) => b.id - a.id);
  return filter === 'all' ? list : list.filter((p) => p.category === filter);
}

function setPanel(open) {
  const name = BOARD_PANEL_NAME[boardKey];
  layoutEl.classList.toggle('panel-collapsed', !open);
  panelToggle.setAttribute('aria-expanded', String(open));
  panelToggle.title = open ? `收起右侧${name}` : `展开右侧${name}`;
  panelLabel.textContent = open ? '收起面板' : name;
  refreshPanelCover();
  // 面板遮挡宽度变了但画布尺寸没变（宽屏浮层），ResizeObserver 不会触发；这里主动重算视图，
  // 否则关闭留言点收起面板后，view.tx 还停在「为让出面板而左移」处，地图右侧会空出一条。
  applyView();
  placeLocPanel();
  updateLocGuide();
}

panelToggle.addEventListener('click', () => setPanel(layoutEl.classList.contains('panel-collapsed')));

// 地点目录是筛选条上「地点目录」按钮的下拉：点开就出现在按钮下方，跟右侧留言板互不影响
function setLocPanel(open) {
  locOpen = open;
  layoutEl.classList.toggle('loc-open', open);
  locToggle.setAttribute('aria-expanded', String(open));
  syncLocChip();
  placeLocPanel();
  updateLocGuide();
  if (!open) hideLocPreview();
}

function syncLocChip() {
  const chip = filterBar.querySelector('.loc-chip');
  if (!chip) return;
  chip.setAttribute('aria-expanded', String(locOpen));
  chip.title = locOpen ? '收起地点目录' : '打开地点目录';
}

// 下拉紧贴筛选条左侧、出现在按钮下方，高度不超过地图画布下沿
function placeLocPanel() {
  if (!locOpen) return;
  const chip = filterBar.querySelector('.loc-chip');
  if (!chip) return;
  const rowBox = filterRow.getBoundingClientRect();
  const chipBox = chip.getBoundingClientRect();
  const top = chipBox.bottom - rowBox.top + 8;
  locPanel.style.left = '0px';
  locPanel.style.top = `${top}px`;
  const room = canvas.getBoundingClientRect().bottom - (rowBox.top + top) - 8;
  locPanel.style.maxHeight = `${Math.max(180, Math.round(room))}px`;
}

window.addEventListener('resize', placeLocPanel);

// 右侧空态文案按板块走：留言说双击圆针，组队说成员名单与加入
const IDLE_HINT = {
  message: idle.querySelector('span').textContent,
  team: '双击地图上的组队点查看队伍：右侧能看到成员名单并点「我要加入」，也可以在下面留言和队伍沟通。',
};

function syncIdleText() {
  idle.querySelector('p').textContent = `右侧${BOARD_PANEL_NAME[boardKey]}`;
  idle.querySelector('span').textContent = IDLE_HINT[boardKey];
}

function applyBoard() {
  closePop();
  current = null;
  openSpot = null;
  filter = 'all';
  pendingCat = boardKey === 'team' ? 'course' : 'study';
  renderFilterBar();
  renderCatRow();
  showIdle();
  syncIdleText();
  syncPoints();
}

function switchBoard(key) {
  const buttons = [...boardSwitch.querySelectorAll('.bs-btn')];
  const btn = buttons.find((b) => b.dataset.board === key);
  if (!btn || btn.classList.contains('active')) return;
  buttons.forEach((b, i) => {
    const on = b === btn;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
    if (on) boardSwitch.style.setProperty('--bs-i', i);
  });
  boardKey = key;
  setPanel(!layoutEl.classList.contains('panel-collapsed'));
  applyBoard();
}

boardSwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('.bs-btn');
  if (btn) switchBoard(btn.dataset.board);
});

function openSpotList(c) {
  openSpot = clusterKey(c.pts);
  current = null;
  setPanel(true);
  board.classList.remove('hidden');
  idle.classList.add('hidden');
  panelBody.classList.add('hidden');
  renderSpotBoard(spotPoints());
  drawMarkers();
}

function refreshBoard() {
  if (current) return;
  if (!openSpot) { showIdle(); return; }
  const list = spotPoints();
  if (!list.length) { openSpot = null; showIdle(); return; }
  if (list.length === 1) { openPoint(list[0].id); return; }
  board.classList.remove('hidden');
  idle.classList.add('hidden');
  renderSpotBoard(list);
}

function renderSpotBoard(list) {
  boardTitle.textContent = '同一地点';
  boardMeta.textContent = `${list.length} 个${boardWord()} · ${filter === 'all' ? '全部类型' : boardCats()[filter] || filter}`;
  spotList.innerHTML = list.map((p) => `
    <li class="spot-item cat-${p.category}" data-id="${p.id}">
      <span class="mini"></span>
      <span class="sp-main">
        <span class="sp-title">${escapeHtml(p.title)}</span>
        <span class="sp-sub">${escapeHtml(p.author)} · ${p.created_at} · ${p.comment_count} 条留言${p.board === 'team' ? ` · ${p.member_count || 0} 人` : ''}</span>
      </span>
      <span class="tag cat-${p.category}">${escapeHtml(catLabel(p))}</span>
    </li>`).join('');
  spotList.querySelectorAll('.mini').forEach((el, i) => renderAvatar(el, list[i].avatar));
}

function showIdle() {
  board.classList.add('hidden');
  panelBody.classList.add('hidden');
  idle.classList.remove('hidden');
}

function closeBoard() {
  openSpot = null;
  current = null;
  showIdle();
  drawMarkers();
}

spotList.addEventListener('click', (e) => {
  const li = e.target.closest('.spot-item');
  if (!li) return;
  closePop();
  openPoint(Number(li.dataset.id));
});

const mineToggle = document.getElementById('mine-toggle');
const mineBody = document.getElementById('mine-body');
const mineList = document.getElementById('mine-list');
const mineEmpty = document.getElementById('mine-empty');

/* ---------- 地点目录 ---------- */
const locList = document.getElementById('loc-list');
const locSearch = document.getElementById('loc-search');
const locEmpty = document.getElementById('loc-empty');
const locToggle = document.getElementById('loc-panel-toggle');
const locGuide = document.getElementById('loc-guide');
let locations = [];
let selectedLoc = null;

async function loadLocations() {
  const data = await api.get('/api/locations').catch(() => ({ locations: [] }));
  locations = data.locations || [];
  document.getElementById('loc-n').textContent = locations.length;
  renderLocations();
}

function renderLocations() {
  const kw = locSearch.value.trim();
  const list = kw
    ? locations.filter((l) => l.name.includes(kw) || l.type.includes(kw) || l.remark.includes(kw))
    : locations;
  locList.innerHTML = list.map((l) => `
    <li class="loc-item" data-id="${l.id}">
      <span class="loc-row1">
        <span class="loc-name">${escapeHtml(l.name)}</span>
        <span class="loc-type">${escapeHtml(l.type)}</span>
      </span>
      <span class="loc-pos">${escapeHtml(l.position)}</span>
      <span class="loc-remark">${escapeHtml(l.remark)}</span>
    </li>`).join('');
  locEmpty.classList.toggle('hidden', list.length > 0);
}

// 指引箭头：只有「地点目录展开 + 选中了某个地点」时才浮在地图上，收起目录就没了
function updateLocGuide() {
  const on = !!selectedLoc && locOpen;
  locGuide.classList.toggle('hidden', !on);
  if (!on) return;
  locGuide.style.left = `${selectedLoc.x}%`;
  locGuide.style.top = `${selectedLoc.y}%`;
}

// 把地图移到指定地点：放大，并把该点摆到没有被右侧面板遮住的那一段画面中间
function focusLocation(loc) {
  ensureFit();
  const box = viewBox();
  const usable = Math.max(120, box.w - panelCover());
  const k = Math.min(MAX_K, Math.max(view.k, 2.4));
  view.k = k;
  view.tx = usable / 2 - k * (loc.x / 100 * stageW);
  view.ty = box.h / 2 - k * (loc.y / 100 * stageH);
  clampView();
  applyView();
}

locSearch.addEventListener('input', () => { hideLocPreview(); renderLocations(); });

locList.addEventListener('click', (e) => {
  const li = e.target.closest('.loc-item');
  if (!li) return;
  const loc = locations.find((l) => l.id === Number(li.dataset.id));
  if (!loc) return;
  hideLocPreview();
  locList.querySelectorAll('.loc-item.active').forEach((n) => n.classList.remove('active'));
  li.classList.add('active');
  selectedLoc = loc;
  updateLocGuide();
  focusLocation(loc);
});

locToggle.addEventListener('click', () => setLocPanel(false));

/* ---------- 地点目录：悬停 1 秒预览该地点附近的留言 ---------- */
const locPreview = document.getElementById('loc-preview');
const lpName = document.getElementById('lp-name');
const lpN = document.getElementById('lp-n');
const lpList = document.getElementById('lp-list');
const lpEmpty = document.getElementById('lp-empty');
const lpTip = document.getElementById('lp-tip');
const LOC_PREVIEW_R = 3;          // 附近半径：按画布宽度归一化的百分比（y 先按宽高比折算）
const LOC_PREVIEW_DELAY = 1000;   // 悬停多久才弹出（毫秒）
let locHoverTimer = null;
let locPreviewHideTimer = null;
let locPreviewLoc = null;

function nearbyMessages(loc) {
  const aspect = stageW > 0 ? stageH / stageW : 0.5;
  return points
    .filter((p) => p.board !== 'team')
    .map((p) => ({ p, d: Math.hypot(p.x - loc.x, (p.y - loc.y) * aspect) }))
    .filter((it) => it.d <= LOC_PREVIEW_R)
    .sort((a, b) => a.d - b.d)
    .map((it) => it.p);
}

function placeLocPreview(li) {
  const ib = li.getBoundingClientRect();
  const w = locPreview.offsetWidth;
  const h = locPreview.offsetHeight;
  let left = ib.right + 12;
  if (left + w > innerWidth - 8) left = ib.left - w - 12;
  left = Math.max(8, Math.min(left, innerWidth - w - 8));
  let top = ib.top;
  if (top + h > innerHeight - 8) top = innerHeight - h - 8;
  top = Math.max(8, top);
  locPreview.style.left = `${Math.round(left)}px`;
  locPreview.style.top = `${Math.round(top)}px`;
}

function showLocPreview(loc, li) {
  const msgs = nearbyMessages(loc);
  locPreviewLoc = loc;
  lpName.textContent = loc.name;
  lpN.textContent = msgs.length;
  lpList.innerHTML = msgs.map((p) => `
    <li class="lp-item cat-${p.category}" data-id="${p.id}" tabindex="0" role="button" title="在地图上打开这条留言">
      <span class="sp-main">
        <span class="sp-title">${escapeHtml(p.title)}</span>
        <span class="sp-sub">${escapeHtml(p.author)} · ${p.comment_count} 条留言</span>
      </span>
      <span class="tag cat-${p.category}">${escapeHtml(catLabel(p))}</span>
    </li>`).join('');
  lpEmpty.classList.toggle('hidden', msgs.length > 0);
  lpTip.classList.toggle('hidden', msgs.length === 0);
  locPreview.classList.remove('hidden');
  placeLocPreview(li);
}

function hideLocPreview() {
  clearTimeout(locHoverTimer);
  clearTimeout(locPreviewHideTimer);
  locPreview.classList.add('hidden');
  locPreviewLoc = null;
}

function openPreviewPoint(li) {
  const p = points.find((it) => it.id === Number(li.dataset.id));
  if (!p) return;
  hideLocPreview();
  openPoint(p.id);
  focusLocation(p);
}

locList.addEventListener('mouseover', (e) => {
  const li = e.target.closest('.loc-item');
  if (!li || li.contains(e.relatedTarget)) return;
  clearTimeout(locPreviewHideTimer);
  clearTimeout(locHoverTimer);
  const loc = locations.find((l) => l.id === Number(li.dataset.id));
  if (!loc) return;
  if (locPreviewLoc && locPreviewLoc.id !== loc.id) hideLocPreview();
  locHoverTimer = setTimeout(() => showLocPreview(loc, li), LOC_PREVIEW_DELAY);
});
locList.addEventListener('mouseout', (e) => {
  const li = e.target.closest('.loc-item');
  if (!li || li.contains(e.relatedTarget)) return;
  clearTimeout(locHoverTimer);
  clearTimeout(locPreviewHideTimer);
  locPreviewHideTimer = setTimeout(hideLocPreview, 160);
});
locPreview.addEventListener('mouseenter', () => clearTimeout(locPreviewHideTimer));
locPreview.addEventListener('mouseleave', () => {
  clearTimeout(locPreviewHideTimer);
  locPreviewHideTimer = setTimeout(hideLocPreview, 160);
});
locList.addEventListener('scroll', hideLocPreview);
lpList.addEventListener('click', (e) => {
  const li = e.target.closest('.lp-item');
  if (li) openPreviewPoint(li);
});
lpList.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const li = e.target.closest('.lp-item');
  if (!li) return;
  e.preventDefault();
  openPreviewPoint(li);
});

function renderMine() {
  const mine = boardPoints().filter((p) => p.author_id === me.id);
  const pendingTotal = mine.reduce((n, p) => n + (p.pending_count || 0), 0);
  document.getElementById('mine-n').textContent = mine.length;
  document.getElementById('mine-title').textContent = `我发布的${boardKey === 'team' ? '组队' : '留言'}`;
  const headDot = document.getElementById('mine-dot');
  headDot.classList.toggle('hidden', pendingTotal === 0);
  headDot.title = pendingTotal ? `有 ${pendingTotal} 条加入申请待你确认` : '';
  mineList.innerHTML = mine.map((p) => `
    <li class="mine-item cat-${p.category}" data-id="${p.id}">
      <span class="sp-main">
        <span class="sp-title">${escapeHtml(p.title)}</span>
        <span class="sp-sub">${p.created_at} · ${p.comment_count} 条留言${p.board === 'team' ? ` · ${p.member_count || 0} 人` : ''}${roadSegs(p) ? ' · 已标封路路段' : ''}</span>
      </span>
      ${p.pending_count ? `<span class="red-dot" title="有 ${p.pending_count} 人申请加入，等你确认"></span>` : ''}
      <span class="tag cat-${p.category}">${escapeHtml(catLabel(p))}</span>
      <button class="mine-del" type="button" data-del="${p.id}" title="删除这个${boardWord()}（连同它下面的留言）">删除</button>
    </li>`).join('');
  mineEmpty.classList.toggle('hidden', mine.length > 0);
  mineEmpty.textContent = boardKey === 'team'
    ? '你还没有发起过组队：右键地图空地即可创建队伍。'
    : '你还没有发布过留言：右键地图空地即可创建。';
}

mineToggle.addEventListener('click', () => {
  const collapsed = mineBody.classList.toggle('hidden');
  mineToggle.setAttribute('aria-expanded', String(!collapsed));
  document.getElementById('mine-caret').textContent = collapsed ? '▸' : '▾';
});

mineList.addEventListener('click', async (e) => {
  const li = e.target.closest('.mine-item');
  if (!li) return;
  const id = Number(li.dataset.id);
  const del = e.target.closest('.mine-del');
  if (del) {
    const p = points.find((it) => it.id === id);
    if (!p) return;
    if (!confirm(`删除「${p.title}」以及它下面的全部留言？`)) return;
    const box = document.getElementById('mine-error');
    box.textContent = '';
    try {
      await api.del(`/api/points/${id}`);
      points = points.filter((it) => it.id !== id);
      if (current && current.id === id) closePoint();
      syncPoints();
    } catch (err) {
      box.textContent = err.message;
    }
    return;
  }
  closePop();
  openPoint(id);
});
document.getElementById('board-close').addEventListener('click', closeBoard);

function openPop(pos) {
  pendingPos = pos;
  pendingCat = boardKey === 'team' ? 'course' : 'study';
  renderCatRow();
  closureCheck.checked = false;
  drawPath = [];
  drawing = false;
  document.getElementById('pop-heading').textContent = `在这里创建${boardWord()}`;
  capBox.classList.toggle('hidden', boardKey !== 'team');
  approvalBox.classList.toggle('hidden', boardKey !== 'team');
  approvalCheck.checked = false;
  syncClosureUi();
  pop.classList.remove('hidden');
  placePop(pos);
  document.getElementById('pop-title').focus();
}

function placePop(pos) {
  const box = viewBox();
  const { sx, sy } = pctToScreen(pos.x, pos.y);
  const w = pop.offsetWidth || 280;
  // 面板展开时浮在地图右端之上，弹窗要让出这一段才不会被盖住
  const clearRight = panelCover() || 8;
  pop.style.left = `${Math.min(Math.max(sx - w / 2, 8), Math.max(8, box.w - w - clearRight))}px`;
  pop.style.top = `${Math.max(8, Math.min(sy + 14, box.h - pop.offsetHeight - 8))}px`;
}

function closePop() {
  pop.classList.add('hidden');
  document.getElementById('pop-title').value = '';
  document.getElementById('pop-content').value = '';
  document.getElementById('pop-error').textContent = '';
  pendingPos = null;
  if (drawing || drawPath.length) { drawing = false; drawPath = []; syncClosureUi(); }
}

// 左键点地图空白处：关掉当前开着的创建窗／详情面板／地点目录／附近留言小窗／帮助
// （拖动平移、标注封路时的落点、点圆针或「修路」标签都不算空白，不会触发）
function dismissMapOverlays() {
  if (!pop.classList.contains('hidden')) closePop();
  hideLocPreview();
  if (locOpen) setLocPanel(false);
  document.getElementById('help-box').classList.add('hidden');
  if (!layoutEl.classList.contains('panel-collapsed')) {
    closePoint(false);
    setPanel(false);
  }
}

document.getElementById('pop-cancel').addEventListener('click', closePop);
popSave.addEventListener('click', async () => {
  const box = document.getElementById('pop-error');
  box.textContent = '';
  const title = document.getElementById('pop-title').value.trim();
  const content = document.getElementById('pop-content').value.trim();
  if (!title) { box.textContent = '请填写标题'; return; }
  const closure = closureCheck.checked;
  if (closure && drawPath.length < 2) {
    setMarking(true);
    box.textContent = '请先在地图上点出不能走的路段（至少 2 个拐点）';
    return;
  }
  try {
    const { point } = await api.post('/api/points', {
      x: pendingPos.x, y: pendingPos.y, title, content,
      category: pendingCat, board: boardKey,
      closure, roadPath: closure ? drawPath : null,
      capacity: boardKey === 'team' ? capInput.value.trim() : '',
      requireApproval: boardKey === 'team' && approvalCheck.checked,
    });
    points.unshift(point);
    closePop();
    if (filter !== 'all' && filter !== point.category) setFilter('all');
    syncPoints();
    openPoint(point.id);
  } catch (err) {
    box.textContent = err.message;
  }
});

// 警告标：按钮只给官方模式看；提示行所有人可见（被标警告时）
function syncWarnUi(p) {
  const btn = document.getElementById('p-warn');
  btn.classList.toggle('hidden', !me.official);
  btn.textContent = p.warning ? '撤掉警告' : '标为警告';
  btn.title = p.warning ? '取消这条的警告标' : '把这条标为警告：地图上的圆针会变成感叹号';
  document.getElementById('p-warn-note').classList.toggle('hidden', !p.warning);
}

async function openPoint(id) {
  const p = points.find((it) => it.id === id);
  if (!p) return;
  current = p;
  inlineRelations = {};   // 新面板：清掉上一个点的关系缓存
  setPanel(true);
  // 先把作者和成员的关系拉好，下面渲染时按钮状态才准确
  await ensureRelations([p.author_id, ...(p.members || []).map((m) => m.id)]);
  if (filter !== 'all' && filter !== p.category) setFilter(p.category);
  board.classList.add('hidden');
  idle.classList.add('hidden');
  panelBody.classList.remove('hidden');
  document.getElementById('p-title').textContent = p.title;
  const cat = document.getElementById('p-cat');
  cat.textContent = catLabel(p);
  cat.className = `tag cat-${p.category}`;
  document.getElementById('p-content').textContent = p.content || `（该${boardWord()}没有正文，只有标题）`;
  const meta = document.getElementById('p-meta');
  const roleTag = p.author_role && p.author_role !== 'student'
    ? `<span class="role-tag role-${p.author_role}">${ROLE_LABEL[p.author_role]}</span>` : '';
  meta.innerHTML = `<span class="person-link" data-uid="${p.author_id}" data-name="${escapeHtml(p.author)}" role="button" tabindex="0" title="查看 TA 的个人介绍；右键可回复 TA"><span class="mini"></span><span class="person-name">${escapeHtml(p.author)}</span>${roleTag}</span>${inlineFriend(p.author_id)}<span>·</span><span>${p.created_at}</span>`;
  renderAvatar(meta.querySelector('.mini'), p.avatar);
  document.getElementById('p-delete').classList.toggle('hidden', p.author_id !== me.id);
  document.getElementById('p-delete').textContent = p.board === 'team' ? '删除这个组队' : '删除此留言点';
  syncWarnUi(p);
  renderTeam(p);
  drawMarkers();
  await loadComments();
  await loadApplications(p);
}

function renderTeam(p) {
  const isTeam = p.board === 'team';
  teamSec.classList.toggle('hidden', !isTeam);
  if (!isTeam) { applyBox.classList.add('hidden'); return; }
  const members = p.members || [];
  const tstate = document.getElementById('t-state');
  tstate.classList.remove('err');
  document.getElementById('t-count').textContent = `(${members.length}${p.capacity ? `/${p.capacity}` : ''})`;
  const row = document.getElementById('member-row');
  row.innerHTML = members.map((m) => `
    <span class="member-cell">
      <span class="member person-link${m.id === p.author_id ? ' owner' : ''}" data-uid="${m.id}" data-name="${escapeHtml(m.nickname)}" role="button" tabindex="0" title="查看 TA 的个人介绍；右键可回复 TA">
        <span class="mini"></span><span class="person-name">${escapeHtml(m.nickname)}${m.id === p.author_id ? ' · 发起' : ''}</span>
      </span>
      ${inlineFriend(m.id)}
    </span>`).join('') || '<span class="team-state">这支队伍还没有成员</span>';
  row.querySelectorAll('.mini').forEach((el, i) => renderAvatar(el, members[i].avatar));
  const joined = members.some((m) => m.id === me.id);
  const isOwner = p.author_id === me.id;
  const full = !!p.capacity && members.length >= p.capacity;
  const needApply = !!p.require_approval;
  const applied = p.my_application === 'pending';
  joinBtn.className = 'small';
  if (isOwner && !joined) {
    joinBtn.textContent = '你是发起人';
    joinBtn.classList.add('ghost');
    joinBtn.disabled = true;
    joinBtn.title = '';
  } else if (joined) {
    joinBtn.textContent = '退出队伍';
    joinBtn.classList.add('danger');
    joinBtn.disabled = false;
    joinBtn.title = '';
  } else if (applied) {
    joinBtn.textContent = '取消申请';
    joinBtn.classList.add('ghost');
    joinBtn.disabled = false;
    joinBtn.title = '发起人同意后你就会自动入队';
  } else {
    joinBtn.textContent = needApply ? '申请加入' : '我要加入';
    joinBtn.classList.add('submit');
    joinBtn.disabled = full;
    joinBtn.title = full ? `队伍已满（上限 ${p.capacity} 人）` : '';
  }
  tstate.textContent = isOwner && p.pending_count ? `有 ${p.pending_count} 条申请等你确认`
    : joined ? '你已在这支队伍里'
    : applied ? '申请已发出，等发起人确认'
    : full ? '名额已满'
    : needApply ? '这支队伍需要发起人同意才能加入' : '';
}

async function loadApplications(p) {
  if (!p || p.board !== 'team' || p.author_id !== me.id || !p.require_approval) {
    applyBox.classList.add('hidden');
    return;
  }
  try {
    const { applications } = await api.get(`/api/points/${p.id}/applications`);
    await ensureRelations((applications || []).map((a) => a.user_id));
    renderApplications(applications);
  } catch {
    applyBox.classList.add('hidden');
  }
}

function renderApplications(list) {
  const pending = (list || []).filter((a) => a.status === 'pending');
  applyBox.classList.toggle('hidden', pending.length === 0);
  document.getElementById('apply-n').textContent = pending.length ? `(${pending.length})` : '';
  applyList.innerHTML = pending.map((a) => `
    <li class="apply-item">
      <span class="person-link" data-uid="${a.user_id}" data-name="${escapeHtml(a.nickname)}" role="button" tabindex="0" title="查看 TA 的个人介绍；右键可回复 TA"><span class="mini"></span><span class="person-name ap-name">${escapeHtml(a.nickname)}</span></span>
      ${inlineFriend(a.user_id)}
      <span class="ap-time">${a.created_at}</span>
      <button class="ap-ok" type="button" data-ok="${a.user_id}">同意</button>
      <button class="ap-no" type="button" data-no="${a.user_id}">拒绝</button>
    </li>`).join('');
  applyList.querySelectorAll('.mini').forEach((el, i) => renderAvatar(el, pending[i].avatar));
}

// 同意／拒绝之后重新拉一遍数据：成员名单、申请列表和「我发布的组队」上的红点一起更新
async function refreshPoint(id) {
  await loadPoints();
  const p = points.find((it) => it.id === id);
  if (!p) return;
  current = p;
  await ensureRelations((p.members || []).map((m) => m.id));   // 新加入的成员也要有准确的关系按钮
  renderTeam(p);
  await loadApplications(p);
}

applyList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.ap-ok, .ap-no');
  if (!btn || !current) return;
  const userId = Number(btn.dataset.ok || btn.dataset.no);
  const action = btn.dataset.ok ? 'approve' : 'reject';
  const tstate = document.getElementById('t-state');
  tstate.textContent = '';
  tstate.classList.remove('err');
  btn.disabled = true;
  try {
    await api.post(`/api/points/${current.id}/applications/${userId}/${action}`, {});
    await refreshPoint(current.id);
  } catch (err) {
    tstate.textContent = err.message;
    tstate.classList.add('err');
    btn.disabled = false;
  }
});

joinBtn.addEventListener('click', async () => {
  if (!current || current.board !== 'team') return;
  const joined = (current.members || []).some((m) => m.id === me.id);
  const applied = current.my_application === 'pending';
  const tstate = document.getElementById('t-state');
  tstate.textContent = '';
  tstate.classList.remove('err');
  joinBtn.disabled = true;
  try {
    if (joined || applied) {
      await api.post(`/api/points/${current.id}/leave`, {});
    } else {
      const res = await api.post(`/api/points/${current.id}/join`, {});
      if (res.applied) current.my_application = 'pending';
    }
    await refreshPoint(current.id);
  } catch (err) {
    tstate.textContent = err.message;
    tstate.classList.add('err');
    joinBtn.disabled = false;
  }
});

async function loadComments() {
  const { comments } = await api.get(`/api/points/${current.id}/comments`);
  await ensureRelations(comments.map((c) => c.author_id));
  const ul = document.getElementById('comment-list');
  document.getElementById('c-count').textContent = comments.length ? `(${comments.length})` : '';
  ul.innerHTML = comments.length
    ? comments.map((c) => `
        <li>
          <div class="who">
            <span class="person-link" data-uid="${c.author_id}" data-name="${escapeHtml(c.author)}" role="button" tabindex="0" title="查看 TA 的个人介绍；右键可回复 TA"><span class="mini"></span><span class="person-name">${escapeHtml(c.author)}</span></span>
            ${inlineFriend(c.author_id)}
            <span>${c.created_at}</span>
            ${c.author_id === me.id ? `<button class="c-del" type="button" data-id="${c.id}" title="删除这条留言">删除</button>` : ''}
          </div>
          <div class="text">${escapeHtml(c.content)}</div>
        </li>`).join('')
    : '<li>还没有留言，来写第一条吧。</li>';
  ul.querySelectorAll('.mini').forEach((el, i) => renderAvatar(el, comments[i]?.avatar));
  const local = points.find((it) => it.id === current.id);
  if (local) local.comment_count = comments.length;
}

document.getElementById('comment-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('.c-del');
  if (!btn) return;
  if (!confirm('删除这条留言？')) return;
  const box = document.getElementById('comment-error');
  box.textContent = '';
  try {
    await api.del(`/api/comments/${btn.dataset.id}`);
    await loadComments();
    syncPoints();
  } catch (err) {
    box.textContent = err.message;
  }
});

document.getElementById('comment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('comment-input');
  const box = document.getElementById('comment-error');
  box.textContent = '';
  const content = input.value.trim();
  if (!content) { box.textContent = '留言不能为空'; return; }
  try {
    await api.post(`/api/points/${current.id}/comments`, { content });
    input.value = '';
    await loadComments();
    syncPoints();
  } catch (err) {
    box.textContent = err.message;
  }
});

// ---------- 点人物 → 个人介绍小窗 ----------
const userModal = document.getElementById('user-modal');
const umBody = document.getElementById('um-body');
let userLastFocus = null;
let userReqSeq = 0;
let ucUid = null;

// ---------- 留言点/组队点面板内的紧凑好友按钮（作者、成员、申请人、留言者旁直接加好友） ----------
let inlineRelations = {};   // uid -> relation，仅缓存当前面板，打开新点时重置

// 只拉还没缓存的用户关系，一次批量请求，避免逐人单查
async function ensureRelations(ids) {
  const want = [...new Set((ids || []).filter(
    (x) => Number.isInteger(x) && x > 0 && x !== me.id && !(x in inlineRelations)
  ))];
  if (!want.length) return;
  const { relations } = await api.get('/api/friends/relations?ids=' + want.join(','));
  inlineRelations = { ...inlineRelations, ...relations };
}

// 紧凑按钮只给一个高频主动作；完整操作（拒绝 incoming 等）仍可点人物名打开用户卡片
function inlineFriend(uid) {
  if (!uid || uid === me.id) return '';
  const rel = inlineRelations[uid] || 'none';
  const map = {
    none: ['＋好友', 'add'],
    rejected: ['重新申请', 'add'],
    pending_outgoing: ['撤回申请', 'cancel'],
    pending_incoming: ['接受申请', 'accept'],
    accepted: ['✓ 已是好友', 'unfriend'],
  };
  const [text, act] = map[rel] || map.none;
  const title = {
    add: '加为好友', cancel: '撤回好友申请', accept: '接受好友申请（拒绝请点名字进卡片）', unfriend: '已是好友，点击删除',
  }[act];
  const cls = (act === 'add' || act === 'accept') ? 'if-btn if-primary' : 'if-btn';
  return `<button class="${cls}" type="button" data-inline="${act}" data-uid="${uid}" title="${title}">${text}</button>`;
}

// 操作后把面板里所有指向该用户的紧凑按钮替换成新状态，不整页重载
function refreshInline(uid) {
  panelBody.querySelectorAll(`button[data-inline][data-uid="${uid}"]`).forEach((b) => {
    const holder = document.createElement('span');
    holder.innerHTML = inlineFriend(uid);
    b.replaceWith(holder.firstElementChild);
  });
}

async function inlineFriendAction(btn) {
  const uid = Number(btn.dataset.uid);
  const act = btn.dataset.inline;
  btn.disabled = true;
  try {
    let relation;
    if (act === 'add') {
      relation = (await api.post('/api/friends/requests', { userId: uid })).relation;
    } else if (act === 'unfriend') {
      if (!confirm('确定删除这个好友吗？删除后可以重新申请。')) return;
      relation = (await api.del(`/api/friends/${uid}`)).relation;
    } else {
      const rid = await friendRequestId(uid, act === 'cancel' ? 'out' : 'in');
      if (!rid) throw new Error('这条申请已经不在了，刷新后重试');
      relation = (await api.post(`/api/friends/requests/${rid}/${act}`)).relation;
    }
    inlineRelations[uid] = relation;
    refreshInline(uid);
  } catch (err) {
    const box = document.getElementById('comment-error');
    if (box) box.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

// ---------- 好友关系按钮（方案 6.3：地图页和个人页的用户卡片共用同一套接口） ----------
function relButtons(relation, uid) {
  if (!relation || relation === 'self') return '';
  if (relation === 'accepted') {
    return `<button class="ghost small" type="button" data-friend="unfriend" data-uid="${uid}">已是好友（删除）</button>`;
  }
  if (relation === 'pending_outgoing') {
    return `<button class="ghost small" type="button" data-friend="cancel" data-uid="${uid}">已申请（撤回）</button>`;
  }
  if (relation === 'pending_incoming') {
    return `<button class="submit small" type="button" data-friend="accept" data-uid="${uid}">接受</button>`
      + `<button class="ghost small" type="button" data-friend="reject" data-uid="${uid}">拒绝</button>`;
  }
  return `<button class="submit small" type="button" data-friend="add" data-uid="${uid}">${relation === 'rejected' ? '重新申请' : '加好友'}</button>`;
}

// pending 状态的接口只认申请 id，卡片里没有，就按对方 id 现查一次
async function friendRequestId(uid, dir) {
  const { incoming, outgoing } = await api.get('/api/friends/requests');
  const pool = dir === 'out' ? outgoing : incoming;
  return pool.find((r) => r.user.id === uid)?.id ?? null;
}

async function friendAction(btn) {
  const uid = Number(btn.dataset.uid);
  const kind = btn.dataset.friend;
  btn.disabled = true;
  try {
    let relation;
    if (kind === 'add') {
      relation = (await api.post('/api/friends/requests', { userId: uid })).relation;
    } else if (kind === 'unfriend') {
      if (!confirm('确定删除这个好友吗？删除后可以重新申请。')) return;
      relation = (await api.del(`/api/friends/${uid}`)).relation;
    } else {
      const rid = await friendRequestId(uid, kind === 'cancel' ? 'out' : 'in');
      if (!rid) throw new Error('这条申请已经不在了，刷新后重试');
      relation = (await api.post(`/api/friends/requests/${rid}/${kind}`)).relation;
    }
    const box = document.getElementById('uc-rel');
    if (box && ucUid === uid) box.innerHTML = relButtons(relation, uid);
  } catch (err) {
    const box = document.getElementById('uc-rel');
    if (box && ucUid === uid) box.innerHTML = `<span class="friend-note">${escapeHtml(err.message)}</span>`;
  } finally {
    btn.disabled = false;
  }
}

function renderUserCard(u, stats, self, relation) {
  const tagText = u.official ? (self ? '官方模式' : '官方') : ROLE_LABEL[u.role];
  const tag = u.official || u.role !== 'student'
    ? `<span class="role-tag role-${u.official ? 'official' : u.role}">${tagText}</span>` : '';
  const relRow = self ? '' : relButtons(relation, u.id);
  umBody.innerHTML = `
    <div class="uc-top">
      <span class="uc-avatar"></span>
      <span class="uc-id">
        <span class="uc-name"><span>${escapeHtml(u.nickname)}</span>${tag}${self ? '<span class="uc-self">这是你</span>' : ''}</span>
        <span class="uc-username">@${escapeHtml(u.username)}</span>
      </span>
    </div>
    ${relRow ? `<div class="uc-rel" id="uc-rel">${relRow}</div>` : ''}
    <div class="pm-section">
      <h4 class="section-title">自我介绍</h4>
      <p class="p-content uc-bio">${escapeHtml(u.bio || '还没有填写自我介绍。')}</p>
    </div>
    <div class="uc-rows">
      <div class="uc-row"><span>身份</span><b>${escapeHtml(u.role_label)}</b></div>
      <div class="uc-row"><span>注册时间</span><b>${escapeHtml(u.created_at)}</b></div>
    </div>
    <div class="pm-section">
      <h4 class="section-title">${self ? '我的动态' : 'TA 的动态'}</h4>
      <div class="uc-stats">
        <span class="uc-stat"><b>${stats.points}</b><span>发布</span></span>
        <span class="uc-stat"><b>${stats.roads}</b><span>封路</span></span>
        <span class="uc-stat"><b>${stats.comments}</b><span>留言</span></span>
        <span class="uc-stat"><b>${stats.received}</b><span>收到</span></span>
      </div>
    </div>`;
  renderAvatar(umBody.querySelector('.uc-avatar'), u.avatar);
}

async function openUserCard(uid) {
  if (!uid) return;
  userLastFocus = document.activeElement;
  const seq = ++userReqSeq;
  umBody.innerHTML = '<p class="pm-note">加载中…</p>';
  userModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  document.getElementById('um-close').focus();
  try {
    const { user, stats, self, relation } = await api.get(`/api/users/${uid}`);
    if (seq !== userReqSeq) return;
    ucUid = uid;
    renderUserCard(user, stats, self, relation);
  } catch (err) {
    if (seq !== userReqSeq) return;
    umBody.innerHTML = `<p class="um-error">${escapeHtml(err.message)}</p>`;
  }
}

function closeUserCard() {
  userReqSeq++;
  userModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  if (userLastFocus && document.contains(userLastFocus)) userLastFocus.focus();
  userLastFocus = null;
}

panelBody.addEventListener('click', (e) => {
  const ib = e.target.closest('[data-inline]');
  if (ib) { inlineFriendAction(ib); return; }
  const el = e.target.closest('.person-link');
  if (el) openUserCard(Number(el.dataset.uid));
});
panelBody.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('.person-link');
  if (!el) return;
  e.preventDefault();
  openUserCard(Number(el.dataset.uid));
});
// 右键详情里的人物（作者／成员／留言者／申请人）→ 在「写留言」框里 @TA，接着输入就是回复
panelBody.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('.person-link');
  if (!el) return;
  e.preventDefault();
  const uid = Number(el.dataset.uid);
  if (!uid || uid === me.id) return;   // 不能回复自己
  const name = el.dataset.name || el.querySelector('.person-name')?.textContent || '';
  if (!name) return;
  const input = document.getElementById('comment-input');
  const mention = `@${name}`;
  if (!input.value.split(/[\s,，。！!？?]+/).includes(mention)) input.value = `${mention} ${input.value}`;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
});
document.getElementById('um-close').addEventListener('click', closeUserCard);
umBody.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-friend]');
  if (btn) friendAction(btn);
});
userModal.addEventListener('click', (e) => { if (e.target === userModal) closeUserCard(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !userModal.classList.contains('hidden')) closeUserCard();
});

function closePoint(keepSpot = true) {
  current = null;
  if (!keepSpot) openSpot = null;
  panelBody.classList.add('hidden');
  refreshBoard();
  drawMarkers();
}
document.getElementById('p-close').addEventListener('click', () => closePoint(false));
document.getElementById('p-back').addEventListener('click', () => closePoint());

document.getElementById('p-delete').addEventListener('click', async () => {
  if (!current || !confirm('确定删除这个留言点及其全部留言吗？')) return;
  const deletedId = current.id;
  try {
    await api.del(`/api/points/${deletedId}`);
  } catch (err) {
    alert(`删除失败：${err.message}`);
    return;
  }
  points = points.filter((p) => p.id !== deletedId);
  document.getElementById('p-close').click();
  syncPoints();
});

document.getElementById('p-warn').addEventListener('click', async () => {
  if (!current) return;
  const btn = document.getElementById('p-warn');
  const was = current.warning;
  btn.disabled = true;
  try {
    const { warning } = await api.post(`/api/points/${current.id}/warning`, { on: !was });
    current.warning = warning;
    const local = points.find((it) => it.id === current.id);
    if (local) local.warning = warning;
    syncWarnUi(current);
    syncPoints();
  } catch (err) {
    btn.textContent = err.message.slice(0, 12);
    setTimeout(() => syncWarnUi(current), 1600);
  } finally {
    btn.disabled = false;
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
