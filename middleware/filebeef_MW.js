// ── FILEBEEF MIDDLEWARE ──────────────────────────────────────────────────────
// Per-IP daily attempt limiter (in-memory). Usage in a route file:
//   const { ipDailyLimit } = require("../middleware/filebeef_MW");
//   router.post("/some/route", ipDailyLimit("unlock", 20), handler);
// Each `name` gets its own independent counter bucket, so the same IP can
// have e.g. 20 unlock attempts AND 20 of something else per day.

const attemptStore = new Map(); // "name:ip" -> { count, day }

function getClientIp(req) {
  return (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "").trim();
}

function ipDailyLimit(name, max = 20, message = "Too many attempts today. Try again tomorrow.") {
  return (req, res, next) => {
    const ip = getClientIp(req);
    const key = `${name}:${ip}`;
    const today = new Date().toISOString().slice(0, 10);
    const entry = attemptStore.get(key);
    if (!entry || entry.day !== today) {
      attemptStore.set(key, { count: 1, day: today });
      return next();
    }
    if (entry.count >= max) {
      return res.status(429).json({ resStatus: false, resMessage: message, resErrorCode: 7, rateLimited: true });
    }
    entry.count++;
    return next();
  };
}

// Sweep stale entries every 6h so memory doesn't grow forever
setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  for (const [key, e] of attemptStore) if (e.day !== today) attemptStore.delete(key);
}, 6 * 60 * 60 * 1000).unref();

module.exports = { ipDailyLimit };