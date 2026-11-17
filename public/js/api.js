async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    // fetch 本身失败：平台窗口被关掉、断网等，给一个看得懂的提示
    throw new Error('无法连接平台，请确认“启动平台.bat”的黑窗口还开着');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `请求失败（${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
};

const CN_NAME_RE = /^[\u4e00-\u9fa5]{1,7}$/;

function renderAvatar(el, avatarString) {
  const [emoji = '🙂', color = '#5b8cff'] = String(avatarString || '').split('|');
  el.textContent = emoji;
  el.style.borderColor = color;
  el.style.color = emoji ? undefined : color;
}

// 兜底：任何漏网的异步异常都记录到控制台，避免静默失败、方便排查
window.addEventListener('unhandledrejection', (event) => {
  console.error('未处理的异步异常：', event.reason);
});
