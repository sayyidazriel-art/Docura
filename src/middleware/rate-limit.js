
'use strict';

// Process-local protection for a single Node instance. For multi-instance production
// deployments, enforce equivalent limits at the reverse proxy/WAF or shared store.
const buckets = new Map();
let lastSweep = Date.now();

function rateLimit({ windowMs = 15 * 60 * 1000, max = 10, message = 'Terlalu banyak permintaan. Tunggu beberapa saat lalu coba lagi.' } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastSweep > 60 * 1000) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
      lastSweep = now;
    }
    // Do not trust arbitrary X-Forwarded-For values unless Express proxy trust is
    // configured by the deployment owner. req.ip is the framework's resolved address.
    const key = `${req.ip || req.socket?.remoteAddress || 'unknown'}:${req.baseUrl}${req.path}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.set('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ success: false, message });
    }
    return next();
  };
}

module.exports = { rateLimit };
