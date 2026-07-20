/**
 * Simple in-memory sliding-window rate limiter (per process).
 * Good enough for single Railway instance; use Redis if you scale horizontally later.
 */
function createRateLimiter({
  windowMs = 60_000,
  max = 60,
  keyFn = (req) => req.ip || "unknown",
  message = "Too many requests. Please wait and try again.",
} = {}) {
  const hits = new Map();

  function prune(now) {
    if (hits.size < 2000) return;
    for (const [key, entry] of hits) {
      if (now - entry.start > windowMs) hits.delete(key);
    }
  }

  return function rateLimit(req, res, next) {
    const now = Date.now();
    prune(now);
    const key = keyFn(req);
    let entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
    }
    entry.count += 1;
    hits.set(key, entry);

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));

    if (entry.count > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { createRateLimiter };
