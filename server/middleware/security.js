// 安全响应头中间件：不依赖第三方库，手动覆盖常用的浏览器安全策略
export function securityHeaders() {
  return (req, res, next) => {
    // 禁止浏览器猜测响应类型（防止把文本当脚本执行）
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // 本平台页面只能被自己同源 iframe 嵌套，防点击劫持
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // 只在同源请求时带上 Referer，减少地址泄露
    res.setHeader('Referrer-Policy', 'same-origin');
    // 不允许网页调用地理位置、麦克风、摄像头（本平台用不到）
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // HSTS 只在 HTTPS 下发送；本地 http 运行时不发，避免调试受影响
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  };
}
