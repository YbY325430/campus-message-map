import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 允许通过环境变量指定数据库位置（测试隔离/部署自定义用）；默认仍在 server 目录下
export const DB_PATH = process.env.CAMPUS_DB || path.join(__dirname, 'map.db');

export function openDb() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON');
  // 写入撞锁时最多等 5 秒，而不是立刻报 database is locked
  db.exec('PRAGMA busy_timeout = 5000');
  db.get = (...sql) => db.prepare(sql[0]).get(...sql.slice(1));
  db.all = (...sql) => db.prepare(sql[0]).all(...sql.slice(1));
  db.run = (...sql) => db.prepare(sql[0]).run(...sql.slice(1));
  db.exec(SCHEMA);
  if (!hasColumn(db, 'users', 'role')) db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'student'`);
  if (!hasColumn(db, 'users', 'bio')) db.exec(`ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''`);
  if (!hasColumn(db, 'points', 'category')) db.exec(`ALTER TABLE points ADD COLUMN category TEXT NOT NULL DEFAULT 'study'`);
  if (!hasColumn(db, 'points', 'road_path')) db.exec(`ALTER TABLE points ADD COLUMN road_path TEXT`);
  if (!hasColumn(db, 'sessions', 'mode')) db.exec(`ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'normal'`);
  if (!hasColumn(db, 'points', 'board')) db.exec(`ALTER TABLE points ADD COLUMN board TEXT NOT NULL DEFAULT 'message'`);
  if (!hasColumn(db, 'points', 'capacity')) db.exec(`ALTER TABLE points ADD COLUMN capacity INTEGER`);
  if (!hasColumn(db, 'points', 'require_approval')) db.exec(`ALTER TABLE points ADD COLUMN require_approval INTEGER NOT NULL DEFAULT 0`);
  if (!hasColumn(db, 'points', 'warning')) db.exec(`ALTER TABLE points ADD COLUMN warning INTEGER NOT NULL DEFAULT 0`);
  return db;
}

export function hasColumn(db, table, column) {
  return db.all(`PRAGMA table_info(${table})`).some((c) => c.name === column);
}

export const CATEGORIES = { official: '学校发布', study: '学习', fun: '娱乐', life: '生活' };
export const TEAM_CATEGORIES = { course: '课程', contest: '竞赛', selfstudy: '自习', sport: '运动' };
export const BOARDS = { message: '留言', team: '组队' };

export function categoriesOf(board) {
  return board === 'team' ? TEAM_CATEGORIES : CATEGORIES;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  nickname      TEXT NOT NULL,
  avatar        TEXT NOT NULL DEFAULT '🙂|#5b8cff',
  role          TEXT NOT NULL DEFAULT 'student',
  bio           TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode       TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS points (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  x          REAL NOT NULL,
  y          REAL NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  category   TEXT NOT NULL DEFAULT 'study',
  board      TEXT NOT NULL DEFAULT 'message',
  capacity   INTEGER,
  require_approval INTEGER NOT NULL DEFAULT 0,
  -- 官方在详情里点的「标为警告」：1 时地图圆针变成感叹号
  warning     INTEGER NOT NULL DEFAULT 0,
  -- 封路类通知在地图上画出的拐点（JSON 数组，百分比坐标）
  road_path   TEXT,
  author_id  INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS team_members (
  point_id   INTEGER NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (point_id, user_id)
);

-- 需要审核的组队：别人点「申请加入」先落在这里，发起人同意后才进 team_members
CREATE TABLE IF NOT EXISTS team_applications (
  point_id   INTEGER NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (point_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  point_id   INTEGER NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_comments_point ON comments(point_id);

-- 复合主键已自带 (point_id, user_id) 索引；补 user_id 方向索引，加速「我加入的组队/我的申请」类查询
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_user ON team_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_points_board ON points(board);

-- 好友关系：一条记录代表一对用户，status 变化复用同一行，删除好友才物理删
CREATE TABLE IF NOT EXISTS friend_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  message      TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (requester_id <> addressee_id)
);

-- 同一对用户无论谁申请谁，全局只允许一条记录（防重复/防双向重复的兜底约束）
CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_pair
ON friend_requests (
  (MIN(requester_id, addressee_id)),
  (MAX(requester_id, addressee_id))
);

-- 两个方向的查询索引：我发出的、我收到的
CREATE INDEX IF NOT EXISTS idx_friend_addressee
ON friend_requests(addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requester
ON friend_requests(requester_id, status);
`;
