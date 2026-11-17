import crypto from 'node:crypto';
import { openDb } from './db.js';

const db = openDb();

const userCount = db.get('SELECT COUNT(*) AS n FROM users').n;
if (userCount === 0) {
  console.log('未检测到用户，写入演示数据…');
  seed(db);
} else {
  console.log(`数据库就绪（已有 ${userCount} 个用户）。`);
}
if (!db.get(`SELECT 1 AS x FROM users WHERE role = 'official'`)) {
  mkUser(db, 'guanli01', '校务小助手', '📣|#e94f6a', 'official');
  console.log('已创建官方账号：guanli01 / 123456（校务小助手）');
}
if (!db.get(`SELECT 1 AS x FROM users WHERE role = 'teacher'`)) {
  mkUser(db, 'laoshi01', '周老师', '📖|#2fbf71', 'teacher');
  console.log('已创建老师账号：laoshi01 / 123456（周老师）');
}
seedTeams(db);
db.close();
console.log(`数据库文件：server/map.db`);

function byName(username) {
  return db.get('SELECT id FROM users WHERE username = ?', username)?.id || null;
}

// 组队板块的演示数据：只在一条组队点都没有时写入，跑第二遍不会重复插
function seedTeams(db) {
  if (db.get(`SELECT 1 AS x FROM points WHERE board = 'team'`)) return;
  const a = byName('demo01');
  const b = byName('demo02');
  const t = byName('laoshi01');
  if (!a) return;
  const teams = [
    [40.0, 66.0, '数据结构·课程组队', '第三次作业组队，还差 1 人，周末在南区自习室写代码。', a, 'course', 4, [b]],
    [74.0, 66.5, '田径场·夜跑打卡队', '每晚八点后刷圈，能坚持的来，不要求配速。', b, 'sport', 8, [a]],
    [57.0, 60.5, '数学建模竞赛·找队友', '校赛报名前组满三人，我负责编程，缺建模和写作。', t || a, 'contest', 3, []],
    [33.0, 72.0, '图书馆·考研座位搭子', '互相签到占座，早七晚十，能来的举手。', a, 'selfstudy', null, [b]],
  ];
  teams.forEach(([x, y, title, content, author, category, capacity, extra]) => {
    const id = Number(db.run(
      'INSERT INTO points (x, y, title, content, category, board, capacity, author_id) VALUES (?,?,?,?,?,?,?,?)',
      x, y, title, content, category, 'team', capacity, author).lastInsertRowid);
    [author, ...extra.filter((u) => u && u !== author)].forEach((u) =>
      db.run('INSERT INTO team_members (point_id, user_id) VALUES (?,?)', id, u));
  });
  console.log(`已写入 ${teams.length} 个演示组队点（切到「组队」板块可见，可在界面上删除）。`);
}

function mkUser(db, username, nickname, avatar, role = 'student') {
  const salt = crypto.randomBytes(16).toString('hex');
  const info = db.run(
    'INSERT INTO users (username, password_hash, salt, nickname, avatar, role) VALUES (?,?,?,?,?,?)',
    username, crypto.scryptSync('123456', salt, 64).toString('hex'), salt, nickname, avatar, role);
  return Number(info.lastInsertRowid);
}

function seed(db) {
  const official = mkUser(db, 'guanli01', '校务小助手', '📣|#e94f6a', 'official');
  const t = mkUser(db, 'laoshi01', '周老师', '📖|#2fbf71', 'teacher');
  const a = mkUser(db, 'demo01', '林晓', '🦊|#ff8a3d');
  const b = mkUser(db, 'demo02', '陈默', '🐼|#5b8cff');

  const points = [
    [95.0, 60.0, '施工封路通知', '东侧书院路本周围挡施工，非机动车请绕行北门，预计周五恢复。', official, 'official',
      [[88.5, 53.5], [92.0, 57.5], [95.5, 61.5], [99.0, 65.5]]],
    [30.0, 79.0, '南苑路·非机动车禁行', '外卖车与施工车辆混行，南苑路（南门段）今日 8:00-18:00 禁止非机动车通行，请走北侧环路。', official, 'official',
      [[12.0, 79.5], [24.0, 80.5], [36.0, 80.5], [45.0, 79.5]]],
    [53.5, 68.0, '食堂窗口优惠', '第二食堂二楼锅盔窗口今日 8 折，11:00 前人流较少。', official, 'official', null],
    [31.7, 69.6, '教学楼南区·自习占座', '南区 2 楼空教室多，考试周建议 7 点半前到。', t, 'study', null],
    [84.0, 58.0, '篮球场·组局', '周三下午常有人打球，缺人可以直接加。', a, 'fun', null],
    [72.0, 62.0, '田径场·夜跑搭子', '每晚八点后跑道最空，欢迎一起刷圈。', a, 'fun', null],
    [89.0, 52.0, '大门·等人提醒', '校门口风大，等人建议站便利店那侧。', b, 'study', null],
    [89.4, 52.3, '东门·等外卖的地方', '外卖车只能停在外侧，取餐别站在大门正中间。', a, 'fun', null],
    [88.7, 51.6, '东门·共享单车堆放点', '闸机右侧这一小片经常堆满车，赶时间建议提前两分钟出来。', b, 'study', null],
    [72.5, 62.3, '田径场·器材借用', '看台下面借羽毛球拍，登记学号即可，天黑前还。', b, 'study', null],
  ];
  const ids = points.map(([x, y, title, content, author, category, road]) =>
    Number(db.run('INSERT INTO points (x, y, title, content, author_id, category, road_path) VALUES (?,?,?,?,?,?,?)',
      x, y, title, content, author, category, road ? JSON.stringify(road) : null).lastInsertRowid));
  const comments = [
    [ids[0], a, '早上经过已经围起来了，骑车确实过不去。'],
    [ids[0], b, '北门应急门会一起开吗？'],
    [ids[2], a, '谢谢，明天试试。'],
  ];
  comments.forEach(([pid, uid, content]) =>
    db.run('INSERT INTO comments (point_id, author_id, content) VALUES (?,?,?)', pid, uid, content));
  console.log('演示账号：guanli01 / 123456（校务小助手·官方，登录填 G2026）、laoshi01 / 123456（周老师·老师）、demo01 / 123456（林晓）、demo02 / 123456（陈默）');
}
