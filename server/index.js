import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, BOARDS, categoriesOf } from './db.js';
import { LOCATIONS } from './locations.js';
import { securityHeaders } from './middleware/security.js';
import { rateLimit } from './middleware/rate-limit.js';
import { notFoundHandler, errorHandler } from './middleware/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const db = openDb();
const app = express();

// 不暴露框架指纹；先挂安全头，再解析请求体
app.disable('x-powered-by');
app.use(securityHeaders());
app.use(express.json({ limit: '1mb' }));
// 静态资源：带一天的浏览器缓存（带 ETag，改动后仍会重新校验）
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// 写接口统一宽松限流：每分钟最多 90 次，防止脚本刷屏又不影响正常使用
const writeLimiter = rateLimit({ windowMs: 60_000, max: 90, message: '操作太频繁了，歇一会儿再试' });
// 登录单独严格限流：每分钟 10 次，缓解密码暴力破解
const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, message: '尝试次数过多，请 1 分钟后再登录' });
// 注册限流：每 10 分钟最多 12 次，防止批量注册小号
const registerLimiter = rateLimit({ windowMs: 10 * 60_000, max: 12, message: '注册尝试过多，请稍后再试' });

const NICKNAME_RE = /^[\u4e00-\u9fa5]{1,7}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{4,20}$/;
// 身份编码：留空=学生，T2026=老师（注册时确定身份），G2026=官方模式（登录时按会话生效）
const TEACHER_CODE = 'T2026';
const OFFICIAL_CODE = 'G2026';
const ROLE_LABEL = { student: '学生', teacher: '老师', official: '官方' };

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').map((p) => {
      const i = p.indexOf('=');
      // decodeURIComponent 遇到畸形转义（如孤立的 %）会抛错，这里兜底成原始字符串，保证请求不崩
      let value = p.slice(i + 1).trim();
      try {
        value = decodeURIComponent(value);
      } catch {
        // 保留未解码的原值
      }
      return [p.slice(0, i).trim(), value];
    }).filter(([k]) => k)
  );
}

function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const row = db.get(
    `SELECT u.id, u.username, u.nickname, u.avatar, u.role AS account_role, u.bio, u.created_at AS joined_at,
            s.mode AS session_mode
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    token
  );
  if (!row) return null;
  // 官方权限按会话生效：登录时输入官方编码才有 official=true，与账号身份（role）分开
  return { ...row, official: row.session_mode === 'official' };
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  req.user = user;
  next();
}

function publicUser(u) {
  return {
    id: u.id,
    nickname: u.nickname,
    avatar: u.avatar,
    role: u.account_role ?? u.role,
    role_label: ROLE_LABEL[u.account_role ?? u.role] ?? ROLE_LABEL.student,
    official: u.official === true,
  };
}

const USER_CARD_SQL = 'SELECT id, username, nickname, avatar, role, bio, created_at FROM users WHERE id = ?';

function userCard(userId, official) {
  const u = db.get(USER_CARD_SQL, userId);
  return {
    ...publicUser({ ...u, account_role: u.role, official }),
    username: u.username,
    bio: u.bio || '',
    created_at: u.created_at,
  };
}

app.post('/api/register', registerLimiter, (req, res) => {
  const { username, password, nickname, avatar } = req.body || {};
  if (!USERNAME_RE.test(String(username || ''))) {
    return res.status(400).json({ error: '账号需为 4-20 位字母、数字或下划线' });
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 64) {
    return res.status(400).json({ error: '密码长度需在 6-64 位之间' });
  }
  if (!isValidNickname(nickname)) {
    return res.status(400).json({ error: '名称必须是中文，且不超过 7 个字' });
  }
  const cleanAvatar = sanitizeAvatar(avatar);
  if (db.get('SELECT 1 AS x FROM users WHERE username = ?', username)) {
    return res.status(409).json({ error: '该账号已被注册' });
  }
  const code = normalizeCode(req.body?.code);
  if (code && code !== TEACHER_CODE && code !== OFFICIAL_CODE) {
    return res.status(400).json({ error: '编码不正确：学生留空，老师填 T2026，官方填 G2026' });
  }
  const role = code === OFFICIAL_CODE ? 'official' : code === TEACHER_CODE ? 'teacher' : 'student';
  const salt = crypto.randomBytes(16).toString('hex');
  const info = db.run(
    'INSERT INTO users (username, password_hash, salt, nickname, avatar, role) VALUES (?,?,?,?,?,?)',
    username, hashPassword(password, salt), salt, nickname, cleanAvatar, role
  );
  startSession(res, Number(info.lastInsertRowid), role === 'official' ? 'official' : 'normal');
  const created = db.get('SELECT id, username, nickname, avatar, role FROM users WHERE id = ?', info.lastInsertRowid);
  res.json({ user: publicUser({ ...created, account_role: created.role, official: role === 'official' }) });
});

function isValidNickname(v) {
  return typeof v === 'string' && NICKNAME_RE.test(v);
}

function sanitizeAvatar(avatar) {
  const raw = String(avatar || '');
  const [emoji, color] = raw.split('|');
  const safeEmoji = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]{1,4}$/u.test(emoji || '') ? emoji : '🙂';
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#5b8cff';
  return `${safeEmoji}|${safeColor}`;
}

function startSession(res, userId, mode = 'normal') {
  const token = crypto.randomBytes(32).toString('hex');
  db.run('INSERT INTO sessions (token, user_id, mode) VALUES (?,?,?)', token, userId, mode);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
}

app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const row = db.get('SELECT * FROM users WHERE username = ?', String(username || ''));
  if (!row) return res.status(400).json({ error: '账号或密码错误' });
  const expect = hashPassword(String(password || ''), row.salt);
  if (!crypto.timingSafeEqual(Buffer.from(expect, 'hex'), Buffer.from(row.password_hash, 'hex'))) {
    return res.status(400).json({ error: '账号或密码错误' });
  }
  const code = normalizeCode(req.body?.code);
  if (code && code !== TEACHER_CODE && code !== OFFICIAL_CODE) {
    return res.status(400).json({ error: '编码不正确：学生留空，老师填 T2026，官方模式填 G2026' });
  }
  const official = code === OFFICIAL_CODE;
  startSession(res, row.id, official ? 'official' : 'normal');
  res.json({ user: publicUser({ ...row, account_role: row.role, official }) });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req).sid;
  if (token) db.run('DELETE FROM sessions WHERE token = ?', token);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? publicUser(user) : null });
});

app.patch('/api/me', requireAuth, (req, res) => {
  const { nickname, avatar, bio } = req.body || {};
  if (nickname !== undefined && !isValidNickname(nickname)) {
    return res.status(400).json({ error: '名称必须是中文，且不超过 7 个字' });
  }
  if (bio !== undefined && (typeof bio !== 'string' || bio.trim().length > 200)) {
    return res.status(400).json({ error: '自我介绍不超过 200 个字' });
  }
  db.run(
    `UPDATE users SET nickname = COALESCE(?, nickname), avatar = COALESCE(?, avatar),
       bio = COALESCE(?, bio) WHERE id = ?`,
    nickname ?? null, avatar ? sanitizeAvatar(avatar) : null, bio === undefined ? null : bio.trim(), req.user.id);
  res.json({ user: userCard(req.user.id, req.user.official) });
});

const USER_STATS_SQL = `SELECT
   (SELECT COUNT(*) FROM points WHERE author_id = ?) AS points,
   (SELECT COUNT(*) FROM points WHERE author_id = ? AND road_path IS NOT NULL) AS roads,
   (SELECT COUNT(*) FROM comments WHERE author_id = ?) AS comments,
   (SELECT COUNT(*) FROM comments c JOIN points p ON p.id = c.point_id WHERE p.author_id = ?) AS received`;

function statsOf(userId) {
  return db.get(USER_STATS_SQL, userId, userId, userId, userId);
}

app.get('/api/profile', requireAuth, (req, res) => {
  res.json({ user: userCard(req.user.id, req.user.official), stats: statsOf(req.user.id) });
});

// 查看别人的公开资料：基础信息 + 自我介绍 + 统计（登录后可看）
// relation 用好友系统统一的状态判定（方案第 4 节的集成点），地图页和个人页的用户卡片共用
app.get('/api/users/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const u = Number.isInteger(id) && id > 0 ? db.get(USER_CARD_SQL, id) : null;
  if (!u) return res.status(404).json({ error: '没有这个用户' });
  res.json({
    user: userCard(id, u.role === 'official'),
    stats: statsOf(id),
    self: req.user.id === id,
    relation: relationOf(req.user.id, id),
  });
});

const MAP_CANDIDATES = ['/img/campus.png', '/img/campus.jpg', '/img/campus.jpeg', '/img/campus.webp', '/img/campus.svg'];

app.get('/api/map-image', (req, res) => {
  const dir = path.join(__dirname, '..', 'public');
  res.json({ src: MAP_CANDIDATES.find((url) => fs.existsSync(path.join(dir, url))) || null });
});

app.get('/api/locations', (req, res) => {
  res.json({ locations: LOCATIONS });
});

app.get('/api/points', (req, res) => {
  const board = BOARDS[req.query.board] ? req.query.board : null;
  const rows = db.all(
    `SELECT p.id, p.x, p.y, p.title, p.content, p.category, p.board, p.capacity, p.require_approval, p.road_path, p.warning, p.created_at, p.author_id,
            u.nickname AS author, u.avatar AS avatar, u.role AS author_role,
            (SELECT COUNT(*) FROM comments c WHERE c.point_id = p.id) AS comment_count
     FROM points p JOIN users u ON u.id = p.author_id
     ${board ? 'WHERE p.board = ?' : ''}
     ORDER BY p.id DESC`,
    ...(board ? [board] : [])
  );
  const members = membersByPoint();
  const me = currentUser(req);
  const pending = pendingByPoint();
  const mine = myApplications(me?.id);
  res.json({
    points: rows.map((r) => {
      const base = {
        ...r,
        road_path: parseRoad(r.road_path),
        members: members.get(r.id) || [],
        member_count: (members.get(r.id) || []).length,
      };
      if (r.board !== 'team') return base;
      base.my_application = mine.get(r.id) || null;
      // 待处理申请只有发起人自己看得到
      if (me && me.id === r.author_id) base.pending_count = pending.get(r.id) || 0;
      return base;
    }),
  });
});

function membersByPoint() {
  const rows = db.all(
    `SELECT m.point_id, m.created_at, u.id, u.nickname, u.avatar, u.role
     FROM team_members m JOIN users u ON u.id = m.user_id
     ORDER BY m.point_id ASC, m.rowid ASC`
  );
  const map = new Map();
  rows.forEach(({ point_id, ...m }) => {
    if (!map.has(point_id)) map.set(point_id, []);
    map.get(point_id).push(m);
  });
  return map;
}

// 每个组队点待处理的申请数（只有发起人看得到，用于「我发布的组队」上的红点）
function pendingByPoint() {
  const rows = db.all(
    `SELECT point_id, COUNT(*) AS n FROM team_applications WHERE status = 'pending' GROUP BY point_id`
  );
  return new Map(rows.map((r) => [r.point_id, r.n]));
}

// 我在各组队点的申请状态：pending 待处理 / approved 已通过 / rejected 被拒绝
function myApplications(userId) {
  if (!userId) return new Map();
  const rows = db.all('SELECT point_id, status FROM team_applications WHERE user_id = ?', userId);
  return new Map(rows.map((r) => [r.point_id, r.status]));
}

function parseRoad(raw) {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length >= 2 ? arr : null;
  } catch {
    return null;
  }
}

function normalizeRoad(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 80) return null;
  const pts = value.map((p) => (Array.isArray(p) ? p : [p?.x, p?.y]))
    .map(([x, y]) => [Number(x), Number(y)]);
  if (!pts.every(([x, y]) => Number.isFinite(x) && x >= 0 && x <= 100 && Number.isFinite(y) && y >= 0 && y <= 100)) {
    return null;
  }
  return pts;
}

app.post('/api/points', writeLimiter, requireAuth, (req, res) => {
  const { x, y, title, content, category, closure, roadPath, capacity, requireApproval } = req.body || {};
  const board = BOARDS[req.body?.board] ? req.body.board : 'message';
  const cats = categoriesOf(board);
  const word = board === 'team' ? '组队点' : '留言点';
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) {
    return res.status(400).json({ error: `${word}位置无效` });
  }
  const t = String(title || '').trim();
  const c = String(content || '').trim();
  if (t.length < 1 || t.length > 30) return res.status(400).json({ error: '标题需为 1-30 个字符' });
  if (c.length > 500) return res.status(400).json({ error: '正文不超过 500 个字符' });
  if (!cats[category]) return res.status(400).json({ error: `请选择${word}类型` });
  if (board === 'message' && category === 'official' && !req.user.official) {
    return res.status(403).json({ error: '「学校发布」类型需要登录时输入官方编码（官方模式）' });
  }
  let road = null;
  if (closure) {
    if (board !== 'message' || category !== 'official') return res.status(400).json({ error: '只有「学校发布」留言可以标注禁行路段' });
    road = normalizeRoad(roadPath);
    if (!road) return res.status(400).json({ error: '封路类留言必须先在地图上标出至少 2 个拐点的禁行路段' });
  }
  let cap = null;
  let needApproval = 0;
  if (board === 'team') {
    const n = Number(capacity);
    if (Number.isFinite(n) && n > 0) cap = Math.min(30, Math.max(2, Math.floor(n)));
    needApproval = requireApproval === true || requireApproval === 1 || requireApproval === '1' || requireApproval === 'true' ? 1 : 0;
  }
  const info = db.run(
    'INSERT INTO points (x, y, title, content, category, board, capacity, require_approval, road_path, author_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    x, y, t, c, category, board, cap, needApproval, road ? JSON.stringify(road) : null, req.user.id);
  const id = Number(info.lastInsertRowid);
  if (board === 'team') db.run('INSERT INTO team_members (point_id, user_id) VALUES (?,?)', id, req.user.id);
  const row = db.get(
    'SELECT id, x, y, title, content, category, board, capacity, require_approval, road_path, warning, created_at, author_id FROM points WHERE id = ?', id);
  res.json({
    point: {
      ...row,
      road_path: parseRoad(row.road_path),
      author: req.user.nickname,
      avatar: req.user.avatar,
      author_role: req.user.account_role,
      comment_count: 0,
      members: [{ id: req.user.id, nickname: req.user.nickname, avatar: req.user.avatar, role: req.user.account_role }],
      member_count: board === 'team' ? 1 : 0,
    },
  });
});

app.post('/api/points/:id/join', writeLimiter, requireAuth, (req, res) => {
  const point = getTeamPoint(Number(req.params.id));
  if (!point) return res.status(404).json({ error: '组队点不存在' });
  if (point.author_id === req.user.id) return res.status(409).json({ error: '你是这支队伍的发起人' });
  if (isMember(point.id, req.user.id)) return res.status(409).json({ error: '你已经在这支队伍里了' });
  if (point.capacity && memberCount(point.id) >= point.capacity) {
    return res.status(400).json({ error: `这支队伍已满（上限 ${point.capacity} 人）` });
  }
  if (point.require_approval) {
    // 需要审核：先记一条申请，等发起人同意才真正入队
    const existing = db.get('SELECT status FROM team_applications WHERE point_id = ? AND user_id = ?', point.id, req.user.id);
    if (existing && existing.status === 'pending') return res.status(409).json({ error: '你已经申请过了，等发起人同意吧' });
    if (existing) {
      db.run(
        `UPDATE team_applications SET status = 'pending', created_at = datetime('now','localtime')
         WHERE point_id = ? AND user_id = ?`, point.id, req.user.id);
    } else {
      db.run('INSERT INTO team_applications (point_id, user_id, status) VALUES (?,?,?)', point.id, req.user.id, 'pending');
    }
    return res.json({ applied: true, status: 'pending', members: memberList(point.id) });
  }
  db.run('INSERT OR IGNORE INTO team_members (point_id, user_id) VALUES (?,?)', point.id, req.user.id);
  res.json({ members: memberList(point.id) });
});

app.post('/api/points/:id/leave', writeLimiter, requireAuth, (req, res) => {
  const point = getTeamPoint(Number(req.params.id));
  if (!point) return res.status(404).json({ error: '组队点不存在' });
  const member = isMember(point.id, req.user.id);
  const applied = db.get('SELECT 1 AS x FROM team_applications WHERE point_id = ? AND user_id = ?', point.id, req.user.id);
  if (!member && !applied) return res.status(409).json({ error: '你还没有加入这支队伍' });
  db.run('DELETE FROM team_members WHERE point_id = ? AND user_id = ?', point.id, req.user.id);
  db.run('DELETE FROM team_applications WHERE point_id = ? AND user_id = ?', point.id, req.user.id);
  res.json({ members: memberList(point.id), withdrawn: !member });
});

// 申请列表：只有发起人看得到
app.get('/api/points/:id/applications', requireAuth, (req, res) => {
  const point = getTeamPoint(Number(req.params.id));
  if (!point) return res.status(404).json({ error: '组队点不存在' });
  if (point.author_id !== req.user.id) return res.status(403).json({ error: '只有发起人能看到申请列表' });
  const rows = db.all(
    `SELECT a.user_id, a.status, a.created_at, u.nickname, u.avatar, u.role
     FROM team_applications a JOIN users u ON u.id = a.user_id
     WHERE a.point_id = ? ORDER BY a.created_at ASC, a.user_id ASC`, point.id);
  res.json({ applications: rows });
});

app.post('/api/points/:id/applications/:userId/approve', writeLimiter, requireAuth, (req, res) => {
  const point = getTeamPoint(Number(req.params.id));
  if (!point) return res.status(404).json({ error: '组队点不存在' });
  if (point.author_id !== req.user.id) return res.status(403).json({ error: '只有发起人才能处理申请' });
  const userId = Number(req.params.userId);
  const application = db.get('SELECT status FROM team_applications WHERE point_id = ? AND user_id = ?', point.id, userId);
  if (!application) return res.status(404).json({ error: '这条申请不存在' });
  if (application.status === 'approved') return res.status(409).json({ error: '这条申请已经通过了' });
  if (!isMember(point.id, userId)) {
    if (point.capacity && memberCount(point.id) >= point.capacity) {
      return res.status(400).json({ error: `队伍已满（上限 ${point.capacity} 人），请先移除成员或调整人数上限` });
    }
    db.run('INSERT OR IGNORE INTO team_members (point_id, user_id) VALUES (?,?)', point.id, userId);
  }
  db.run('UPDATE team_applications SET status = ? WHERE point_id = ? AND user_id = ?', 'approved', point.id, userId);
  res.json({ ok: true, members: memberList(point.id) });
});

app.post('/api/points/:id/applications/:userId/reject', writeLimiter, requireAuth, (req, res) => {
  const point = getTeamPoint(Number(req.params.id));
  if (!point) return res.status(404).json({ error: '组队点不存在' });
  if (point.author_id !== req.user.id) return res.status(403).json({ error: '只有发起人才能处理申请' });
  const userId = Number(req.params.userId);
  const application = db.get('SELECT status FROM team_applications WHERE point_id = ? AND user_id = ?', point.id, userId);
  if (!application) return res.status(404).json({ error: '这条申请不存在' });
  db.run('UPDATE team_applications SET status = ? WHERE point_id = ? AND user_id = ?', 'rejected', point.id, userId);
  res.json({ ok: true, members: memberList(point.id) });
});

function getTeamPoint(id) {
  const row = db.get('SELECT id, board, capacity, require_approval, author_id FROM points WHERE id = ?', id);
  return row && row.board === 'team' ? row : null;
}
function isMember(pointId, userId) {
  return !!db.get('SELECT 1 AS x FROM team_members WHERE point_id = ? AND user_id = ?', pointId, userId);
}
function memberCount(pointId) {
  return db.get('SELECT COUNT(*) AS n FROM team_members WHERE point_id = ?', pointId).n;
}
function memberList(pointId) {
  return db.all(
    `SELECT u.id, u.nickname, u.avatar, u.role, m.created_at
     FROM team_members m JOIN users u ON u.id = m.user_id
     WHERE m.point_id = ? ORDER BY m.rowid ASC`, pointId);
}

app.delete('/api/points/:id', writeLimiter, requireAuth, (req, res) => {
  const row = db.get('SELECT author_id FROM points WHERE id = ?', Number(req.params.id));
  if (!row) return res.status(404).json({ error: '留言点不存在' });
  if (row.author_id !== req.user.id) return res.status(403).json({ error: '只能删除自己创建的留言点' });
  db.run('DELETE FROM points WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// 警告标：只有官方模式（登录时输官方编码）能加／撤；标上之后地图上这条显示成感叹号
app.post('/api/points/:id/warning', writeLimiter, requireAuth, (req, res) => {
  if (!req.user.official) {
    return res.status(403).json({ error: '标为警告需要官方模式（登录时输入官方编码）' });
  }
  const pointId = Number(req.params.id);
  const row = db.get('SELECT id, warning FROM points WHERE id = ?', pointId);
  if (!row) return res.status(404).json({ error: '留言点不存在' });
  const on = req.body?.on === undefined ? !row.warning : (req.body.on === true || req.body.on === 1 || req.body.on === '1' || req.body.on === 'true');
  const value = on ? 1 : 0;
  db.run('UPDATE points SET warning = ? WHERE id = ?', value, pointId);
  res.json({ warning: value });
});

app.get('/api/points/:id/comments', (req, res) => {
  const rows = db.all(
    `SELECT c.id, c.content, c.created_at, c.author_id, u.nickname AS author, u.avatar
     FROM comments c JOIN users u ON u.id = c.author_id
     WHERE c.point_id = ? ORDER BY c.id ASC`,
    Number(req.params.id)
  );
  res.json({ comments: rows });
});

app.post('/api/points/:id/comments', writeLimiter, requireAuth, (req, res) => {
  const pointId = Number(req.params.id);
  if (!db.get('SELECT 1 AS x FROM points WHERE id = ?', pointId)) {
    return res.status(404).json({ error: '留言点不存在' });
  }
  const content = String(req.body?.content || '').trim();
  if (content.length < 1 || content.length > 300) {
    return res.status(400).json({ error: '留言需为 1-300 个字符' });
  }
  const info = db.run('INSERT INTO comments (point_id, author_id, content) VALUES (?,?,?)',
    pointId, req.user.id, content);
  const row = db.get(
    `SELECT c.id, c.content, c.created_at, c.author_id, u.nickname AS author, u.avatar
     FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?`, info.lastInsertRowid);
  res.json({ comment: row });
});

app.delete('/api/comments/:id', writeLimiter, requireAuth, (req, res) => {
  const row = db.get('SELECT author_id FROM comments WHERE id = ?', Number(req.params.id));
  if (!row) return res.status(404).json({ error: '留言不存在' });
  if (row.author_id !== req.user.id) return res.status(403).json({ error: '只能删除自己发表的留言' });
  db.run('DELETE FROM comments WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// ---------- 好友系统（方案第四节）----------
// 约定：一对用户永远只占 friend_requests 一行，状态变化用 UPDATE，删除好友才物理 DELETE。
// 所有 SELECT 只列公开字段，任何好友接口都不返回 password_hash、salt。

const FRIEND_PUBLIC = 'id, username, nickname, avatar, role, bio, created_at';
const FRIEND_PUBLIC_U = 'u.id, u.username, u.nickname, u.avatar, u.role, u.bio, u.created_at';
const LIKE_ESCAPE = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// 一对用户之间的那条记录（不分方向）
function friendRecord(a, b) {
  return db.get(
    `SELECT id, requester_id, addressee_id, status, message, created_at, updated_at
     FROM friend_requests
     WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    a, b, b, a
  );
}

function friendRecordById(id) {
  if (!Number.isInteger(id) || id <= 0) return null;
  return db.get(
    `SELECT id, requester_id, addressee_id, status, message, created_at, updated_at
     FROM friend_requests WHERE id = ?`, id
  );
}

// 方案第三节的推导表：记录状态 + 我是哪一方 → 前端用的 relation
function relationOf(meId, targetId, record) {
  if (meId === targetId) return 'self';
  const rec = record === undefined ? friendRecord(meId, targetId) : record;
  if (!rec) return 'none';
  if (rec.status === 'accepted') return 'accepted';
  if (rec.status === 'pending') return rec.requester_id === meId ? 'pending_outgoing' : 'pending_incoming';
  // rejected：我被拒还能重新申请；我拒了对方则回到 none
  return rec.requester_id === meId ? 'rejected' : 'none';
}

// 用已经查出来的行拼卡片，避免在循环里再查一次用户
function friendCard(u, extra = {}) {
  return {
    ...publicUser({ ...u, account_role: u.role, official: u.role === 'official' }),
    username: u.username,
    bio: u.bio || '',
    created_at: u.created_at,
    ...extra,
  };
}

// 校验目标用户：正整数 + 不是自己 + 确实存在；返回错误标记或 null
function badTarget(req, res, target, selfError = '不能添加自己为好友') {
  if (!Number.isInteger(target) || target <= 0) {
    res.status(400).json({ error: '用户 ID 无效' });
    return 'invalid';
  }
  if (target === req.user.id) {
    res.status(400).json({ error: selfError });
    return 'self';
  }
  if (!db.get('SELECT 1 AS x FROM users WHERE id = ?', target)) {
    res.status(404).json({ error: '没有这个用户' });
    return 'missing';
  }
  return null;
}

app.get('/api/friends/summary', requireAuth, (req, res) => {
  const me = req.user.id;
  const friendsCount = db.get(
    `SELECT COUNT(*) AS n FROM friend_requests
     WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`, me, me
  ).n;
  const incomingCount = db.get(
    `SELECT COUNT(*) AS n FROM friend_requests WHERE status = 'pending' AND addressee_id = ?`, me
  ).n;
  res.json({ friendsCount, incomingCount });
});

app.get('/api/friends', requireAuth, (req, res) => {
  const me = req.user.id;
  const rows = db.all(
    `SELECT ${FRIEND_PUBLIC_U}, r.updated_at AS friend_since
     FROM friend_requests r
     JOIN users u ON u.id = CASE
       WHEN r.requester_id = ? THEN r.addressee_id
       ELSE r.requester_id END
     WHERE r.status = 'accepted' AND (r.requester_id = ? OR r.addressee_id = ?)
     ORDER BY r.updated_at DESC`, me, me, me
  );
  res.json({ friends: rows.map(({ friend_since, ...u }) => friendCard(u, { friend_since })) });
});

// 收到的申请（别人→我）与发出的申请（我→别人），都只看 pending，各一条 JOIN 查完。
// 申请自己的时间用别名返回，避免和用户表的 created_at 同名互相覆盖。
function requestEntries(sql, me) {
  return db.all(sql, me).map(({ request_id, request_message, request_created_at, request_updated_at, ...u }) => ({
    id: request_id,
    status: 'pending',
    message: request_message,
    created_at: request_created_at,
    updated_at: request_updated_at,
    user: friendCard(u),
  }));
}

const INCOMING_SQL = `SELECT r.id AS request_id, r.message AS request_message,
       r.created_at AS request_created_at, r.updated_at AS request_updated_at,
       ${FRIEND_PUBLIC_U}
     FROM friend_requests r JOIN users u ON u.id = r.requester_id
     WHERE r.addressee_id = ? AND r.status = 'pending'
     ORDER BY r.updated_at DESC, r.id DESC`;

const OUTGOING_SQL = `SELECT r.id AS request_id, r.message AS request_message,
       r.created_at AS request_created_at, r.updated_at AS request_updated_at,
       ${FRIEND_PUBLIC_U}
     FROM friend_requests r JOIN users u ON u.id = r.addressee_id
     WHERE r.requester_id = ? AND r.status = 'pending'
     ORDER BY r.updated_at DESC, r.id DESC`;

app.get('/api/friends/requests', requireAuth, (req, res) => {
  const me = req.user.id;
  res.json({ incoming: requestEntries(INCOMING_SQL, me), outgoing: requestEntries(OUTGOING_SQL, me) });
});

// 一批目标和我的关系记录，一次查完（搜索结果最多 20 条，不逐条单查）
function relationsMap(meId, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const ph = ids.map(() => '?').join(',');
  const rows = db.all(
    `SELECT requester_id, addressee_id, status FROM friend_requests
     WHERE (requester_id = ? AND addressee_id IN (${ph})) OR (addressee_id = ? AND requester_id IN (${ph}))`,
    meId, ...ids, meId, ...ids
  );
  rows.forEach((r) => map.set(r.requester_id === meId ? r.addressee_id : r.requester_id, r));
  return map;
}

// 搜索：账号精确或昵称模糊，最多 20 条、排除自己；LIKE 通配符转义防止一个 % 匹配全表
app.get('/api/friends/search', writeLimiter, requireAuth, (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.json({ results: [] });
  if (q.length > 20) return res.status(400).json({ error: '搜索关键词最长 20 个字符' });
  const me = req.user.id;
  const rows = db.all(
    `SELECT ${FRIEND_PUBLIC}
     FROM users
     WHERE id <> ? AND (username = ? OR nickname LIKE ? ESCAPE '\\')
     LIMIT 20`,
    me, q, `%${LIKE_ESCAPE(q)}%`
  );
  const records = relationsMap(me, rows.map((r) => r.id));
  res.json({ results: rows.map((u) => friendCard(u, { relation: relationOf(me, u.id, records.get(u.id) ?? null) })) });
});

// 批量查我和一批用户的关系：留言点/组队点面板一次拉全，避免逐人单查（只读，最多 50 个）
app.get('/api/friends/relations', requireAuth, (req, res) => {
  const me = req.user.id;
  const ids = [...new Set(
    String(req.query.ids ?? '').split(',').map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0 && n !== me)
  )].slice(0, 50);
  const records = relationsMap(me, ids);
  const relations = {};
  ids.forEach((id) => { relations[id] = relationOf(me, id, records.get(id) ?? null); });
  res.json({ relations });
});

app.post('/api/friends/requests', writeLimiter, requireAuth, (req, res) => {
  const me = req.user.id;
  const target = Number(req.body?.userId);
  const err = badTarget(req, res, target);
  if (err) return;
  const raw = req.body?.message;
  if (raw !== undefined && typeof raw !== 'string') {
    return res.status(400).json({ error: '验证消息需为字符串' });
  }
  const message = String(raw ?? '').trim();
  if (message.length > 50) return res.status(400).json({ error: '验证消息最长 50 个字符' });

  const rec = friendRecord(me, target);
  if (!rec) {
    try {
      db.run('INSERT INTO friend_requests (requester_id, addressee_id, status, message) VALUES (?,?,?,?)',
        me, target, 'pending', message);
    } catch (e) {
      // 并发下撞唯一索引：不抛 500，按当前真实状态回话
      if (!String(e.message).includes('UNIQUE')) throw e;
      return res.status(409).json({ error: '好友状态刚刚有变化，刷新后重试' });
    }
    return res.json({ relation: 'pending_outgoing' });
  }
  if (rec.status === 'accepted') return res.status(409).json({ error: '你们已经是好友' });
  if (rec.status === 'pending') {
    if (rec.requester_id === me) return res.status(409).json({ error: '已申请，等待验证' });
    // 对方先申请了我：点「加好友」直接成好友，不产生第二条记录
    db.run(`UPDATE friend_requests SET status = 'accepted', updated_at = datetime('now','localtime') WHERE id = ?`, rec.id);
    const other = db.get(`SELECT ${FRIEND_PUBLIC} FROM users WHERE id = ?`, target);
    return res.json({ relation: 'accepted', friend: friendCard(other) });
  }
  // rejected：任意方向都改成当前方向的重新申请，复用同一行
  db.run(
    `UPDATE friend_requests
     SET requester_id = ?, addressee_id = ?, status = 'pending', message = ?,
         updated_at = datetime('now','localtime')
     WHERE id = ?`, me, target, message, rec.id
  );
  res.json({ relation: 'pending_outgoing' });
});

// 处理一条申请：只有 addressee 本人、且仍是 pending 才允许
function pendingRequestFor(req, res) {
  const rec = friendRecordById(Number(req.params.id));
  if (!rec) {
    res.status(404).json({ error: '这条申请不存在' });
    return null;
  }
  if (rec.addressee_id !== req.user.id) {
    res.status(403).json({ error: '只有收到申请的人才能处理这条申请' });
    return null;
  }
  if (rec.status !== 'pending') {
    res.status(409).json({ error: '这条申请已经处理过了' });
    return null;
  }
  return rec;
}

app.post('/api/friends/requests/:id/accept', writeLimiter, requireAuth, (req, res) => {
  const rec = pendingRequestFor(req, res);
  if (!rec) return;
  db.run(`UPDATE friend_requests SET status = 'accepted', updated_at = datetime('now','localtime') WHERE id = ?`, rec.id);
  const other = db.get(`SELECT ${FRIEND_PUBLIC} FROM users WHERE id = ?`, rec.requester_id);
  res.json({ ok: true, relation: 'accepted', friend: friendCard(other) });
});

app.post('/api/friends/requests/:id/reject', writeLimiter, requireAuth, (req, res) => {
  const rec = pendingRequestFor(req, res);
  if (!rec) return;
  db.run(`UPDATE friend_requests SET status = 'rejected', updated_at = datetime('now','localtime') WHERE id = ?`, rec.id);
  // 我拒了对方：按状态机表，我这侧回到 none
  res.json({ ok: true, relation: 'none' });
});

// 撤回：只有发起人本人、且仍是 pending 才允许，物理删除后双方回到 none
app.post('/api/friends/requests/:id/cancel', writeLimiter, requireAuth, (req, res) => {
  const rec = friendRecordById(Number(req.params.id));
  if (!rec) return res.status(404).json({ error: '这条申请不存在' });
  if (rec.requester_id !== req.user.id) return res.status(403).json({ error: '只有发起人才能撤回这条申请' });
  if (rec.status !== 'pending') return res.status(409).json({ error: '这条申请已经处理过了' });
  db.run('DELETE FROM friend_requests WHERE id = ?', rec.id);
  res.json({ ok: true, relation: 'none' });
});

// 删除好友：记录必须是 accepted 且我是当事方，物理删除
app.delete('/api/friends/:userId', writeLimiter, requireAuth, (req, res) => {
  const me = req.user.id;
  const target = Number(req.params.userId);
  const err = badTarget(req, res, target, '不能把自己从好友里删除');
  if (err) return;
  const rec = friendRecord(me, target);
  if (!rec || rec.status !== 'accepted') return res.status(409).json({ error: '你们还不是好友' });
  db.run('DELETE FROM friend_requests WHERE id = ?', rec.id);
  res.json({ ok: true, relation: 'none' });
});

// 前端单页路由回退：非 API、不带文件扩展名的路径统一返回入口页（刷新/直接输入地址不 404）
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || /\.[a-z0-9]{1,8}$/i.test(req.path)) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
// 剩下的（主要是 /api 未匹配路径）返回 JSON 404；最后挂全局错误处理
app.use(notFoundHandler());
app.use(errorHandler());

// ---------- 过期会话清理：与 cookie 的 30 天有效期保持一致 ----------
function purgeExpiredSessions() {
  try {
    const result = db.run(
      `DELETE FROM sessions
       WHERE datetime(created_at) < datetime('now','localtime','-30 days')`
    );
    if (result.changes > 0) console.log(`已清理 ${result.changes} 个过期登录会话。`);
  } catch (err) {
    console.error('清理过期会话失败：', err);
  }
}
purgeExpiredSessions();
// 每 6 小时扫一次；unref 保证不拖住进程退出
const sessionSweeper = setInterval(purgeExpiredSessions, 6 * 60 * 60 * 1000);
if (typeof sessionSweeper.unref === 'function') sessionSweeper.unref();

const server = app.listen(PORT, () => {
  console.log(`校园留言地图已启动： http://localhost:${PORT}`);
  // 由启动器（launcher.js）通过 IPC 拉起时，回报就绪信号；直接 node 运行时 process.send 不存在，自动跳过
  if (typeof process.send === 'function') process.send({ type: 'ready' });
});
// 双保险：直接运行 node server/index.js 时端口被占，给出看得懂的提示而不是一堆英文堆栈
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用：请关闭占用它的程序，或直接双击“启动平台.bat”自动换端口。`);
  } else {
    console.error('服务启动出错：', err);
  }
  process.exit(1);
});

// 优雅关闭：先停接新请求，再关数据库，避免留下锁文件
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n收到 ${signal}，正在关闭平台…`);
  server.close(() => {
    try { db.close(); } catch { /* 忽略关闭异常 */ }
    process.exit(0);
  });
  // 5 秒还没关完就强制退出，防止挂死
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
