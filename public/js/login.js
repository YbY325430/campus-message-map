const EMOJIS = ['🙂', '😺', '🦊', '🐼', '🐨', '🦉', '🐸', '🚀', '🌱', '⭐', '🎧', '📚'];
const COLORS = ['#5b8cff', '#ff8a3d', '#2fbf71', '#e94f6a', '#a259ff', '#f2c14e'];

let pickedEmoji = '🙂';
let pickedColor = COLORS[0];

const tabs = document.querySelectorAll('.tab');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const nickInput = registerForm.nickname;
const nickHint = document.getElementById('nick-hint');

// 登录状态检查：已登录直接进入地图
if (new URLSearchParams(location.search).get('signedout') === '1') {
  document.getElementById('auth-note').classList.remove('hidden');
  history.replaceState(null, '', '/');
}
api.get('/api/me').then(({ user }) => {
  if (user) location.href = '/map.html';
}).catch(() => {});

tabs.forEach((tab) => tab.addEventListener('click', () => {
  tabs.forEach((t) => t.classList.toggle('active', t === tab));
  const isLogin = tab.dataset.tab === 'login';
  loginForm.classList.toggle('hidden', !isLogin);
  registerForm.classList.toggle('hidden', isLogin);
}));

const emojiGrid = document.getElementById('emoji-grid');
const colorRow = document.getElementById('color-row');
const preview = document.getElementById('avatar-preview');

EMOJIS.forEach((e, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = e;
  if (i === 0) b.classList.add('active');
  b.addEventListener('click', () => {
    pickedEmoji = e;
    emojiGrid.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    syncPreview();
  });
  emojiGrid.appendChild(b);
});

COLORS.forEach((c, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.style.background = c;
  if (i === 0) b.classList.add('active');
  b.addEventListener('click', () => {
    pickedColor = c;
    colorRow.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    syncPreview();
  });
  colorRow.appendChild(b);
});

function syncPreview() {
  preview.textContent = pickedEmoji;
  preview.style.borderColor = pickedColor;
}

nickInput.addEventListener('input', () => {
  const len = [...nickInput.value].length;
  const ok = CN_NAME_RE.test(nickInput.value);
  nickHint.textContent = ok
    ? `已输入 ${len} / 7 个汉字`
    : '名称只能是汉字，最多 7 个';
  nickHint.classList.toggle('bad', !ok && nickInput.value.length > 0);
});

// 编码只用于区分身份：留空=学生，T2026=老师，G2026=官方模式
function codeOf(form) {
  return form.code.value.trim().toUpperCase();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const box = document.getElementById('login-error');
  box.textContent = '';
  try {
    await api.post('/api/login', {
      username: loginForm.username.value.trim(),
      password: loginForm.password.value,
      code: codeOf(loginForm),
    });
    location.href = '/map.html';
  } catch (err) {
    box.textContent = err.message;
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const box = document.getElementById('register-error');
  box.textContent = '';
  try {
    await api.post('/api/register', {
      username: registerForm.username.value.trim(),
      password: registerForm.password.value,
      nickname: nickInput.value.trim(),
      avatar: `${pickedEmoji}|${pickedColor}`,
      code: codeOf(registerForm),
    });
    location.href = '/map.html';
  } catch (err) {
    box.textContent = err.message;
  }
});
