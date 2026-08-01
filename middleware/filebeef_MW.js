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

// ── VISITOR LOG COOLDOWN (keyed by IP + tool) ────────────────────────────────
// Same IP visiting a DIFFERENT tool is logged immediately. Same IP + same tool
// within the cooldown window is skipped. This keeps tool-hopping visible.
const visitStore = new Map(); // "ip:tool" -> timestamp(ms)

function fbVisitCooldown(windowMs = 30 * 60 * 1000) {
  return (req, res, next) => {
    const ip = getClientIp(req) || "unknown";
    const tool = String(req.body?.tool || "unknown").slice(0, 60);
    const key = `${ip}:${tool}`;
    const now = Date.now();
    const last = visitStore.get(key);
    req.fbShouldLogVisit = !last || now - last > windowMs;
    if (req.fbShouldLogVisit) visitStore.set(key, now);
    return next();
  };
}

// Sweep visit entries older than 24h
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, ts] of visitStore) if (ts < cutoff) visitStore.delete(key);
}, 6 * 60 * 60 * 1000).unref();

// ── SESSION COOKIE PRESENCE CHECK ────────────────────────────────────────
// Cheap pre-multer gate for tool routes — rejects requests with no session
// cookie at all BEFORE file upload buffering happens. Not a substitute for
// optionalAuth/requireAuth (which validate the cookie against the DB) —
// this only blocks the zero-cookie case early to save bandwidth on anon spam.
function requireSessionCookie(req, res, next) {
  if (!req.cookies?.filebeef_session) {
    return res.status(401).json({ resStatus: false, resMessage: "Account required", resErrorCode: 1 });
  }
  next();
}

// ── COMMENT COOLDOWN (10 min per USER and per IP) ────────────────────────────
const commentUserStore = new Map(); // userId -> ts(ms)
const commentIpStore   = new Map(); // ip -> ts(ms)
const COMMENT_WINDOW_MS = 10 * 60 * 1000;

function fbCommentCheck(userId, ip) {
  const now = Date.now();
  const uLast = commentUserStore.get(String(userId));
  if (uLast && now - uLast < COMMENT_WINDOW_MS) {
    return { allowed: false, retryAfterMin: Math.ceil((COMMENT_WINDOW_MS - (now - uLast)) / 60000) };
  }
  const ipLast = commentIpStore.get(ip);
  if (ipLast && now - ipLast < COMMENT_WINDOW_MS) {
    return { allowed: false, retryAfterMin: Math.ceil((COMMENT_WINDOW_MS - (now - ipLast)) / 60000) };
  }
  return { allowed: true };
}

// Only called AFTER a successful insert, so failed validations never lock a user out.
function fbCommentMark(userId, ip) {
  const now = Date.now();
  commentUserStore.set(String(userId), now);
  if (ip) commentIpStore.set(ip, now);
}

setInterval(() => {
  const cutoff = Date.now() - COMMENT_WINDOW_MS;
  for (const [k, ts] of commentUserStore) if (ts < cutoff) commentUserStore.delete(k);
  for (const [k, ts] of commentIpStore)   if (ts < cutoff) commentIpStore.delete(k);
}, 30 * 60 * 1000).unref();

module.exports = { ipDailyLimit, fbVisitCooldown, fbCommentCheck, fbCommentMark, requireSessionCookie };