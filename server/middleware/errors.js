// API 兜底 404：所有未匹配的 /api 请求统一返回 JSON，而不是 HTML
export function notFoundHandler() {
  return (req, res) => {
    res.status(404).json({ error: req.path.startsWith('/api/') ? '接口不存在' : 'not found' });
  };
}

// 全局错误处理中间件（Express 靠 4 个参数识别）：
// 兜住 JSON 解析失败、请求体过大以及路由里漏网的异常，保证进程不崩、前端拿到 JSON
export function errorHandler() {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = Number(err.status || err.statusCode) || 500;
    let message = err.message || '服务器出错了，请稍后再试';
    if (err.type === 'entity.parse.failed') message = '发送的数据格式不正确';
    else if (err.type === 'entity.too.large') message = '发送的数据太大了';
    if (status >= 500) console.error('服务器内部错误：', err);
    res.status(status).json({ error: message });
  };
}
