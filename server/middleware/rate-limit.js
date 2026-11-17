// 轻量内存速率限制：固定时间窗口内按 key（默认客户端 IP）计数，超限返回 429
// 不依赖外部存储，适合本地/单机部署；重启进程后计数自动清零
export function rateLimit({
  windowMs = 60_000,
  max = 100,
  message = '操作过于频繁，请稍后再试',
  keyGenerator,
} = {}) {
  const buckets = new Map();

  // 周期性清掉过期桶，避免 Map 无限增长；unref 保证定时器不拖住进程退出
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, windowMs);
  if (typeof sweeper.unref === 'function') sweeper.unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator
      ? keyGenerator(req)
      : (req.ip || req.socket?.remoteAddress || 'unknown');
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
