const nickForm = document.getElementById('nick-form');
const nickInput = document.getElementById('nick-input');
const nickError = document.getElementById('nick-error');
const bioForm = document.getElementById('bio-form');
const bioInput = document.getElementById('bio-input');
const bioError = document.getElementById('bio-error');
const bioCount = document.getElementById('bio-count');

const IDENTITY_NOTE = {
  student: '学生（登录／注册时不填编码）',
  teacher: '老师（注册编码 T2026）',
  official: '官方账号（登录时输入 G2026 即进入官方模式）',
};

function syncBioCount() {
  bioCount.textContent = `${[...bioInput.value].length} / 200`;
}

function render(user, stats) {
  renderAvatar(document.getElementById('pf-avatar'), user.avatar);
  document.getElementById('pf-name').textContent = user.nickname;
  document.getElementById('pf-username').textContent = `@${user.username}`;
  const tag = document.getElementById('pf-role');
  tag.textContent = user.official ? '官方模式' : user.role_label;
  tag.className = `role-tag role-${user.official ? 'official' : user.role}`;
  tag.hidden = !user.official && user.role === 'student';
  document.getElementById('pf-account').textContent = user.username;
  document.getElementById('pf-identity').textContent = user.official
    ? '官方模式 · 可以发布「学校发布」通知与封路路段'
    : IDENTITY_NOTE[user.role] || '学生';
  document.getElementById('pf-joined').textContent = user.created_at;
  document.getElementById('pf-points').textContent = `${stats.points} 条`;
  document.getElementById('pf-roads').textContent = `${stats.roads} 段`;
  document.getElementById('pf-comments').textContent = `${stats.comments} 条`;
  document.getElementById('pf-received').textContent = `${stats.received} 条`;
  nickInput.value = user.nickname;
  bioInput.value = user.bio || '';
  document.getElementById('bio-preview').textContent = user.bio || '还没有填写。';
  syncBioCount();
}

async function boot() {
  try {
    const [{ user, stats }, { points }] = await Promise.all([
      api.get('/api/profile'),
      api.get('/api/points'),
    ]);
    render(user, stats);
    allPoints = points;
    meId = user.id;
    renderMyContent(points, user.id);
    loadFriends();   // 好友那块单独拉，失败了不影响本页其他内容
  } catch (err) {
    if (err.status === 401) {
      location.href = '/';
      return;
    }
    nickError.textContent = err.message;
  }
}

bioInput.addEventListener('input', syncBioCount);

const MSG_CATS = { official: '学校发布', study: '学习', fun: '娱乐', life: '生活' };
const TEAM_CATS = { course: '课程', contest: '竞赛', selfstudy: '自习', sport: '运动' };
const APP_STATUS = { pending: '待处理', approved: '已通过', rejected: '已拒绝' };
const ROLE_LABEL = { student: '学生', teacher: '老师', official: '官方' };

let allPoints = [];
let meId = null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function catLabel(p) {
  return (p.board === 'team' ? TEAM_CATS : MSG_CATS)[p.category] || '其他';
}

function pItem(p, sub, extra = '') {
  return `
    <li class="mine-item cat-${p.category}" data-id="${p.id}" tabindex="0" role="button" title="点击查看详细信息">
      <span class="sp-main">
        <span class="sp-title">${escapeHtml(p.title)}</span>
        <span class="sp-sub">${escapeHtml(sub)}</span>
      </span>
      ${extra}
      <span class="tag cat-${p.category}">${escapeHtml(catLabel(p))}</span>
    </li>`;
}

// 红点提醒基线（按账号存 localStorage）：首次见到某条只建档、不报红点；
// 「我发的组队」人数比基线多 → 有新成员加入；「我加入的组队」申请 pending→approved → 组队成功。
// 点开该条目（openDetail）时把基线更新为当前值，红点随之消失。
function seenStore() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(`campusProfileSeen:${meId}`)); } catch { s = null; }
  return s && typeof s === 'object' ? { members: s.members || {}, apps: s.apps || {} } : { members: {}, apps: {} };
}
function saveSeen(s) {
  try { localStorage.setItem(`campusProfileSeen:${meId}`, JSON.stringify(s)); } catch { /* 隐私模式存不下也不影响功能 */ }
}
function markSeen(p, s) {
  if (p.board === 'team' && p.author_id === meId) s.members[p.id] = p.member_count || 0;
  if (p.board === 'team' && p.my_application) s.apps[p.id] = p.my_application || 'pending';
}

function renderMyContent(points, meId) {
  const msgs = points.filter((p) => p.board !== 'team' && p.author_id === meId);
  const teams = points.filter((p) => p.board === 'team' && p.author_id === meId);
  const apps = points.filter((p) => p.board === 'team' && p.author_id !== meId && p.my_application
    && p.my_application !== 'approved');
  const joined = points.filter((p) => p.board === 'team' && p.author_id !== meId
    && (p.members || []).some((m) => m.id === meId));

  const seen = seenStore();
  const newMembers = (p) => (seen.members[p.id] === undefined
    ? 0 : Math.max(0, (p.member_count || 0) - seen.members[p.id]));
  const justIn = (p) => p.my_application && seen.apps[p.id] === 'pending' && p.my_application === 'approved';

  const hasRoad = (p) => Array.isArray(p.road_path) && p.road_path.length >= 2;

  // 只要弹窗里任意一条会亮红点，个人信息卡上的按钮也带红点，不用点开才知道有新消息
  let hasNotice = false;

  document.getElementById('my-msg-n').textContent = msgs.length;
  document.getElementById('my-msg-list').innerHTML = msgs.map((p) => pItem(p,
    `${p.created_at} · ${p.comment_count} 条留言${hasRoad(p) ? ' · 已标封路路段' : ''}`
  )).join('');
  document.getElementById('my-msg-empty').classList.toggle('hidden', msgs.length > 0);

  document.getElementById('my-team-n').textContent = teams.length;
  document.getElementById('my-team-list').innerHTML = teams.map((p) => {
    const tips = [];
    if (p.pending_count) tips.push(`有 ${p.pending_count} 人申请加入，等你确认`);
    const nc = newMembers(p);
    if (nc > 0) tips.push(`上次查看后有 ${nc} 位新成员加入`);
    if (tips.length) hasNotice = true;
    return pItem(p,
      `${p.created_at} · ${p.member_count || 0} 人${p.pending_count ? ` · ${p.pending_count} 条待处理申请` : ''}`,
      tips.length ? `<span class="red-dot" title="${escapeHtml(tips.join('；'))}"></span>` : ''
    );
  }).join('');
  document.getElementById('my-team-empty').classList.toggle('hidden', teams.length > 0);

  document.getElementById('my-joined-n').textContent = joined.length;
  document.getElementById('my-joined-list').innerHTML = joined.map((p) => {
    const inNow = justIn(p);
    if (inNow) hasNotice = true;
    return pItem(p,
      `${p.created_at} · 发起人：${p.author} · ${p.member_count || 0} 人`,
      (p.my_application ? `<span class="app-status ${p.my_application}">${APP_STATUS[p.my_application] || '已加入'}</span>` : '')
      + (inNow ? '<span class="red-dot" title="申请已通过，组队成功"></span>' : '')
    );
  }).join('');
  document.getElementById('my-joined-empty').classList.toggle('hidden', joined.length > 0);

  document.getElementById('my-app-n').textContent = apps.length;
  document.getElementById('my-app-list').innerHTML = apps.map((p) => pItem(p,
    `${p.created_at} · 发起人：${p.author} · ${p.member_count || 0} 人`,
    `<span class="app-status ${p.my_application}">${APP_STATUS[p.my_application] || '待处理'}</span>`
  )).join('');
  document.getElementById('my-app-empty').classList.toggle('hidden', apps.length > 0);

  // 给没有基线的条目建档（当前值），避免功能上线第一次打开就满屏红点
  let changed = false;
  teams.forEach((p) => { if (seen.members[p.id] === undefined) { seen.members[p.id] = p.member_count || 0; changed = true; } });
  apps.forEach((p) => { if (seen.apps[p.id] === undefined) { seen.apps[p.id] = p.my_application || 'pending'; changed = true; } });
  // 已经通过的申请只在「我加入的组队」里出现，基线直接记 approved，避免重复出现时误报红点
  joined.forEach((p) => {
    if (p.my_application === 'approved' && seen.apps[p.id] === undefined) { seen.apps[p.id] = 'approved'; changed = true; }
  });
  if (changed) saveSeen(seen);
  document.getElementById('my-content-dot').classList.toggle('hidden', !hasNotice);
}

const myContentCard = document.getElementById('my-content-card');
const myContentModal = document.getElementById('my-content-modal');
const pointModal = document.getElementById('point-modal');
let lastFocus = null;

function renderPointModal(p) {
  document.getElementById('pm-title').textContent = p.title;
  const cat = document.getElementById('pm-cat');
  cat.textContent = catLabel(p);
  cat.className = `tag cat-${p.category}`;

  const meta = document.getElementById('pm-meta');
  const roleTag = p.author_role && p.author_role !== 'student'
    ? `<span class="role-tag role-${p.author_role}">${ROLE_LABEL[p.author_role] || ''}</span>` : '';
  meta.innerHTML = `<span class="person-link" data-uid="${p.author_id}" role="button" tabindex="0" title="查看 TA 的个人介绍"><span class="mini"></span><span class="person-name">${escapeHtml(p.author)}</span>${roleTag}</span><span>·</span><span>${escapeHtml(p.created_at)}</span>`;
  renderAvatar(meta.querySelector('.mini'), p.avatar);

  const isTeam = p.board === 'team';
  const hasRoad = Array.isArray(p.road_path) && p.road_path.length >= 2;
  let html = `<p class="p-content">${escapeHtml(p.content) || `（该${isTeam ? '组队' : '留言'}没有正文，只有标题）`}</p>`;

  if (isTeam) {
    const members = p.members || [];
    const memberHtml = members.map((m) => `
      <span class="member person-link${m.id === p.author_id ? ' owner' : ''}" data-uid="${m.id}" role="button" tabindex="0" title="查看 TA 的个人介绍">
        <span class="mini"></span><span class="person-name">${escapeHtml(m.nickname)}${m.id === p.author_id ? ' · 发起' : ''}</span>
      </span>`).join('') || '<span class="team-state">这支队伍还没有成员</span>';
    html += `
      <div class="pm-section">
        <p class="section-title">队伍成员（${members.length}${p.capacity ? `/${p.capacity}` : ''}）</p>
        <div class="member-row">${memberHtml}</div>
      </div>`;
    const stateText = p.author_id === meId
      ? (p.pending_count ? `有 ${p.pending_count} 条申请等你确认` : '你是这支队伍的发起人')
      : (p.my_application ? `你的申请：${APP_STATUS[p.my_application] || '待处理'}` : '');
    if (stateText) html += `<p class="pm-note">${escapeHtml(stateText)}</p>`;
  } else {
    html += `<p class="pm-note">${p.comment_count} 条留言${hasRoad ? ' · 已标封路路段' : ''}</p>`;
  }

  // 收到的留言直接在这个小窗里列出来（点开即可看，不用回地图）
  html += `
      <div class="pm-section">
        <p class="section-title">${isTeam ? '这支队伍的留言' : '收到的留言'} <span id="pm-c-n"></span></p>
        <ul class="comment-list" id="pm-c-list"></ul>
      </div>`;

  const body = document.getElementById('pm-body');
  body.innerHTML = html;
  body.querySelectorAll('.member').forEach((el, i) => {
    const m = (p.members || [])[i];
    if (m) renderAvatar(el.querySelector('.mini'), m.avatar);
  });
  document.getElementById('pm-map-link').href = `/map.html?point=${p.id}`;
  loadPointComments(p.id);
}

// 详情小窗里的留言列表：切换得快时用序号丢弃过期响应
let commentsSeq = 0;

async function loadPointComments(pointId) {
  const token = ++commentsSeq;
  const ul = document.getElementById('pm-c-list');
  const count = document.getElementById('pm-c-n');
  if (!ul || !count) return;
  ul.innerHTML = '<li>正在加载留言…</li>';
  try {
    const { comments } = await api.get(`/api/points/${pointId}/comments`);
    if (token !== commentsSeq) return;
    count.textContent = comments.length ? `（${comments.length}）` : '';
    ul.innerHTML = comments.length
      ? comments.map((c) => `
        <li>
          <div class="who">
            <span class="person-link" data-uid="${c.author_id}" data-name="${escapeHtml(c.author)}" role="button" tabindex="0" title="查看 TA 的个人介绍"><span class="mini"></span><span class="person-name">${escapeHtml(c.author)}</span></span>
            <span>${escapeHtml(c.created_at)}</span>
          </div>
          <div class="text">${escapeHtml(c.content)}</div>
        </li>`).join('')
      : '<li>还没有留言：回地图点开这条就能写第一条。</li>';
    ul.querySelectorAll('.mini').forEach((el, i) => renderAvatar(el, comments[i]?.avatar));
  } catch {
    if (token !== commentsSeq) return;
    ul.innerHTML = '<li>留言加载失败，点下方「在地图上打开」查看。</li>';
  }
}

function openDetail(li) {
  const p = allPoints.find((it) => it.id === Number(li.dataset.id));
  if (!p) return;
  lastFocus = li;
  renderPointModal(p);
  pointModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  document.getElementById('pm-close').focus();
  const seen = seenStore();
  markSeen(p, seen);
  saveSeen(seen);
}

function closePointModal() {
  commentsSeq++;          // 让还在飞的留言请求作废，别写进已关闭的小窗
  pointModal.classList.add('hidden');
  if (myContentModal.classList.contains('hidden')) document.body.classList.remove('modal-open');
  if (lastFocus) lastFocus.focus();
  renderMyContent(allPoints, meId);   // 基线已更新：刚看过的条目红点消失
}

myContentCard.addEventListener('click', (e) => {
  const li = e.target.closest('.mine-item');
  if (li) openDetail(li);
});
myContentCard.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const li = e.target.closest('.mine-item');
  if (!li) return;
  e.preventDefault();
  openDetail(li);
});
document.getElementById('pm-close').addEventListener('click', closePointModal);
pointModal.addEventListener('click', (e) => {
  if (e.target === pointModal) closePointModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !userModal.classList.contains('hidden')) return;
  if (!pointModal.classList.contains('hidden')) closePointModal();
  else if (!myContentModal.classList.contains('hidden')) closeMyContent();
});

// ---------- 个人信息卡上的按钮 → 打开「我的发布与申请」小窗 ----------
let mcLastFocus = null;

function openMyContent() {
  mcLastFocus = document.activeElement;
  renderMyContent(allPoints, meId);
  myContentModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  document.getElementById('mc-close').focus();
}

function closeMyContent() {
  myContentModal.classList.add('hidden');
  if (pointModal.classList.contains('hidden') && userModal.classList.contains('hidden')) {
    document.body.classList.remove('modal-open');
  }
  if (mcLastFocus && document.contains(mcLastFocus)) mcLastFocus.focus();
  mcLastFocus = null;
}

document.getElementById('btn-my-content').addEventListener('click', openMyContent);
document.getElementById('mc-close').addEventListener('click', closeMyContent);
myContentModal.addEventListener('click', (e) => {
  if (e.target === myContentModal) closeMyContent();
});

// ---------- 详情小窗里点人物 → 个人介绍小窗（叠在详情窗之上） ----------
const userModal = document.getElementById('user-modal');
const umBody = document.getElementById('um-body');
let userLastFocus = null;
let userReqSeq = 0;

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
  if (pointModal.classList.contains('hidden')) document.body.classList.remove('modal-open');
  if (userLastFocus && document.contains(userLastFocus)) userLastFocus.focus();
  userLastFocus = null;
}

pointModal.addEventListener('click', (e) => {
  const el = e.target.closest('.person-link');
  if (el) openUserCard(Number(el.dataset.uid));
});
pointModal.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('.person-link');
  if (!el) return;
  e.preventDefault();
  openUserCard(Number(el.dataset.uid));
});
document.getElementById('um-close').addEventListener('click', closeUserCard);
userModal.addEventListener('click', (e) => { if (e.target === userModal) closeUserCard(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !userModal.classList.contains('hidden')) closeUserCard();
});

function say(el, text, ok = false) {
  el.textContent = text;
  el.classList.toggle('ok', ok);
}

nickForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  say(nickError, '');
  try {
    const { user } = await api.patch('/api/me', { nickname: nickInput.value.trim() });
    document.getElementById('pf-name').textContent = user.nickname;
    document.getElementById('pf-account').textContent = user.username;
    nickInput.value = user.nickname;
    say(nickError, '已保存', true);
  } catch (err) {
    say(nickError, err.message);
  }
});

bioForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  say(bioError, '');
  try {
    const { user } = await api.patch('/api/me', { bio: bioInput.value });
    document.getElementById('bio-preview').textContent = user.bio || '还没有填写。';
    bioInput.value = user.bio;
    syncBioCount();
    say(bioError, '已保存', true);
  } catch (err) {
    say(bioError, err.message);
  }
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

// ---------- 好友系统（方案 6.1／6.2：卡片 + 搜索弹窗 + 申请弹窗，红点用服务端 incomingCount） ----------
const friendsCard = document.getElementById('friends-card');
const friendBadge = document.getElementById('friend-badge');
const searchModal = document.getElementById('friend-search-modal');
const requestsModal = document.getElementById('friend-requests-modal');
const fsInput = document.getElementById('fs-input');
const fsNote = document.getElementById('fs-note');
const fsMsg = document.getElementById('fs-msg');
const fsList = document.getElementById('fs-list');

let friendRows = [];                      // GET /api/friends
let friendReq = { incoming: [], outgoing: [] };
let ucUid = null;                         // 当前用户卡片小窗对应的用户 id

function roleTagOf(u) {
  if (!u || (!u.official && u.role === 'student')) return '';
  return `<span class="role-tag role-${u.official ? 'official' : u.role}">${u.official ? '官方' : ROLE_LABEL[u.role] || ''}</span>`;
}

// 方案 6.3：按 relation 渲染按钮，self 不显示
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

function fillAvatars(root, list) {
  root.querySelectorAll('.mini').forEach((el, i) => renderAvatar(el, list[i]?.avatar));
}

function friendRowHtml(u) {
  return `<li class="friend-row">
    <span class="mini"></span>
    <span class="friend-id">
      <span class="person-link friend-name" data-uid="${u.id}" role="button" tabindex="0" title="查看 TA 的个人介绍"><span class="person-name">${escapeHtml(u.nickname)}</span>${roleTagOf(u)}</span>
      <span class="friend-sub">@${escapeHtml(u.username)}${u.friend_since ? ` · ${escapeHtml(u.friend_since)} 成为好友` : ''}</span>
    </span>
    <span class="rel-actions">${relButtons('accepted', u.id)}</span>
  </li>`;
}

function requestRowHtml(r, dir) {
  const note = r.message ? `<span class="friend-note">验证消息：${escapeHtml(r.message)}</span>` : '';
  const actions = dir === 'in'
    ? `<button class="submit small" type="button" data-request="accept" data-id="${r.id}">接受</button>`
      + `<button class="ghost small" type="button" data-request="reject" data-id="${r.id}">拒绝</button>`
    : `<button class="ghost small" type="button" data-request="cancel" data-id="${r.id}">撤回</button>`;
  return `<li class="friend-row">
    <span class="mini"></span>
    <span class="friend-id">
      <span class="friend-name">${escapeHtml(r.user.nickname)}${roleTagOf(r.user)}</span>
      <span class="friend-sub">@${escapeHtml(r.user.username)} · ${escapeHtml(r.created_at)}</span>
      ${note}
    </span>
    <span class="rel-actions">${actions}</span>
  </li>`;
}

function foundRowHtml(u) {
  return `<li class="friend-row">
    <span class="mini"></span>
    <span class="friend-id">
      <span class="friend-name">${escapeHtml(u.nickname)}${roleTagOf(u)}</span>
      <span class="friend-sub">@${escapeHtml(u.username)}</span>
    </span>
    <span class="rel-actions">${relButtons(u.relation, u.id)}</span>
  </li>`;
}

function renderFriendCard() {
  document.getElementById('friends-n').textContent = friendRows.length;
  const ul = document.getElementById('friend-list');
  ul.innerHTML = friendRows.map(friendRowHtml).join('');
  fillAvatars(ul, friendRows);
  document.getElementById('friend-empty').classList.toggle('hidden', friendRows.length > 0);
}

function renderRequests() {
  const { incoming, outgoing } = friendReq;
  document.getElementById('fr-in-n').textContent = incoming.length ? `（${incoming.length}）` : '';
  document.getElementById('fr-out-n').textContent = outgoing.length ? `（${outgoing.length}）` : '';
  const inUl = document.getElementById('fr-in-list');
  const outUl = document.getElementById('fr-out-list');
  inUl.innerHTML = incoming.map((r) => requestRowHtml(r, 'in')).join('');
  outUl.innerHTML = outgoing.map((r) => requestRowHtml(r, 'out')).join('');
  fillAvatars(inUl, incoming.map((r) => r.user));
  fillAvatars(outUl, outgoing.map((r) => r.user));
  document.getElementById('fr-in-empty').classList.toggle('hidden', incoming.length > 0);
  document.getElementById('fr-out-empty').classList.toggle('hidden', outgoing.length > 0);
}

function renderFriendBadge(count) {
  friendBadge.textContent = count;
  friendBadge.classList.toggle('hidden', !count);
}

async function loadFriends() {
  try {
    const [summary, friends, requests] = await Promise.all([
      api.get('/api/friends/summary'),
      api.get('/api/friends'),
      api.get('/api/friends/requests'),
    ]);
    friendRows = friends.friends;
    friendReq = requests;
    renderFriendBadge(summary.incomingCount);
    renderFriendCard();
    renderRequests();
  } catch (err) {
    console.error('好友数据加载失败', err);
  }
}

async function runFriendSearch() {
  const q = fsInput.value.trim();
  say(fsMsg, '');
  if (!q) {
    fsList.innerHTML = '<li class="friend-hint">输入完整账号或部分昵称，再点搜索。</li>';
    return;
  }
  fsList.innerHTML = '<li class="friend-hint">正在搜索…</li>';
  try {
    const { results } = await api.get('/api/friends/search?q=' + encodeURIComponent(q));
    fsList.innerHTML = results.length
      ? results.map(foundRowHtml).join('')
      : '<li class="friend-hint">没有搜到符合条件的用户（账号需完整，昵称可部分匹配，不显示你自己）。</li>';
    fillAvatars(fsList, results);
  } catch (err) {
    fsList.innerHTML = '';
    say(fsMsg, err.message);
  }
}

// pending 状态的按钮只有申请 id，没有 id 就按对方 id 现查一次（同时把本地缓存刷新）
async function requestIdFor(uid, dir) {
  friendReq = await api.get('/api/friends/requests');
  renderRequests();
  const pool = dir === 'out' ? friendReq.outgoing : friendReq.incoming;
  return pool.find((r) => r.user.id === uid)?.id ?? null;
}

// 错误提示只写进「当前看得见的那块」：搜索弹窗开着写弹窗里，否则写卡片下方
function friendError(text) {
  if (!searchModal.classList.contains('hidden')) say(fsMsg, text);
  else say(document.getElementById('friends-msg'), text);
}

async function friendAction(btn) {
  const uid = Number(btn.dataset.uid);
  const kind = btn.dataset.friend || btn.dataset.request;
  const id = btn.dataset.id ? Number(btn.dataset.id) : null;
  btn.disabled = true;
  try {
    let relation = null;
    if (kind === 'add') {
      const body = { userId: uid };
      // 验证消息只在搜索弹窗里可编辑，别的地方点加好友就不带上一次留下的草稿
      const note = !searchModal.classList.contains('hidden') ? fsNote.value.trim() : '';
      if (note) body.message = note;
      relation = (await api.post('/api/friends/requests', body)).relation;
    } else if (kind === 'unfriend') {
      if (!confirm('确定删除这个好友吗？删除后可以重新申请。')) return;
      relation = (await api.del(`/api/friends/${uid}`)).relation;
    } else if (kind === 'cancel' || kind === 'accept' || kind === 'reject') {
      const rid = id ?? await requestIdFor(uid, kind === 'cancel' ? 'out' : 'in');
      if (!rid) { friendError('这条申请已经不在了，刷新后重试'); return; }
      relation = (await api.post(`/api/friends/requests/${rid}/${kind}`)).relation;
    }
    await loadFriends();
    // 弹窗开着就当场把这一片按钮刷新，不用整页重载（方案 6.3）
    if (!requestsModal.classList.contains('hidden')) renderRequests();
    if (!searchModal.classList.contains('hidden')) await runFriendSearch();
    const ucRel = document.getElementById('uc-rel');
    if (ucRel && ucUid === uid) ucRel.innerHTML = relButtons(relation, uid);
  } catch (err) {
    friendError(err.message);
    const ucRel = document.getElementById('uc-rel');
    if (ucRel && ucUid === uid) ucRel.innerHTML = `<span class="friend-note">${escapeHtml(err.message)}</span>`;
  } finally {
    btn.disabled = false;
  }
}

function openFriendModal(el, focusId) {
  el.classList.remove('hidden');
  document.body.classList.add('modal-open');
  document.getElementById(focusId).focus();
}

function closeFriendModal(el) {
  el.classList.add('hidden');
  if (pointModal.classList.contains('hidden') && userModal.classList.contains('hidden')) {
    document.body.classList.remove('modal-open');
  }
}

document.getElementById('btn-friend-search').addEventListener('click', () => {
  fsMsg.textContent = '';
  fsList.innerHTML = '<li class="friend-hint">输入完整账号或部分昵称，再点搜索。</li>';
  openFriendModal(searchModal, 'fs-input');
});
document.getElementById('btn-friend-requests').addEventListener('click', () => {
  renderRequests();
  openFriendModal(requestsModal, 'fr-close');
});
document.getElementById('fs-go').addEventListener('click', runFriendSearch);
fsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runFriendSearch(); } });
document.getElementById('fs-close').addEventListener('click', () => closeFriendModal(searchModal));
document.getElementById('fr-close').addEventListener('click', () => closeFriendModal(requestsModal));
searchModal.addEventListener('click', (e) => { if (e.target === searchModal) closeFriendModal(searchModal); });
requestsModal.addEventListener('click', (e) => { if (e.target === requestsModal) closeFriendModal(requestsModal); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !userModal.classList.contains('hidden')) return;
  if (!searchModal.classList.contains('hidden')) closeFriendModal(searchModal);
  else if (!requestsModal.classList.contains('hidden')) closeFriendModal(requestsModal);
});

// 三处列表 + 用户卡片小窗的关系按钮都走同一个委托入口
friendsCard.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-friend]');
  if (btn) { friendAction(btn); return; }
  const el = e.target.closest('.person-link');
  if (el) openUserCard(Number(el.dataset.uid));
});
searchModal.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-friend]');
  if (btn) friendAction(btn);
});
requestsModal.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-request]');
  if (btn) friendAction(btn);
});
umBody.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-friend]');
  if (btn) friendAction(btn);
});

boot();
