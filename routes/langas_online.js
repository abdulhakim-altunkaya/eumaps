// Routes for the langas.online website (Netlify proxies https://langas.online/api/* here).
// Mounted in server.js:  app.use("/api/langas-web", require("./routes/langas_online"));
const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const useragent = require("useragent");
const { pool, supabase } = require("../db");
const {
  blockMaliciousIPs,
  applyReadRateLimit,
  applyWriteRateLimit
} = require("../middleware/masters_MW");

const LANGAS_WEB_AVATAR_BUCKET = "langas_storage";   // same private bucket as the app
const LANGAS_WEB_AVATAR_LINK_SEC = 60 * 60;          // photo links on invite pages live 1 h
const LANGAS_WEB_VISIT_COOLDOWN_MS = 3 * 60 * 1000;  // same visitor + same page counted once per 3 min
const LANGAS_WEB_FORM_COOLDOWN_MS = 60 * 1000;       // one form per IP per minute
const LANGAS_WEB_VISIT_KEEP_MONTHS = 12;             // privacy policy: visits kept up to 12 months
const LANGAS_WEB_BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|headless|lighthouse|curl|wget|python|axios/i;
const LANGAS_WEB_EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const LANGAS_WEB_TOPICS = ["general", "lesson", "purchase", "account", "idea"];

const langasWebVisitCache = new Map();
const langasWebFormCache = new Map();

// Real visitor IP: Netlify's proxy sends it in x-nf-client-connection-ip
function langasWebIp(req) {
  let ip = req.headers["x-nf-client-connection-ip"] ||
    (req.headers["x-forwarded-for"] ? req.headers["x-forwarded-for"].split(",")[0].trim() : "") ||
    req.socket?.remoteAddress || req.ip || "";
  ip = String(ip).trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
}

// One-way hash: lets us count unique visitors without storing the IP itself (see privacy policy)
function langasWebIpHash(ip) {
  return crypto.createHash("sha256").update("langas.online|" + ip).digest("hex").slice(0, 32);
}

function langasWebText(v, max) {
  return String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

// Forms: one per IP per minute
function langasWebFormCooldown(req, res, next) {
  const key = langasWebIp(req);
  const now = Date.now();
  const last = langasWebFormCache.get(key);
  if (last && now - last < LANGAS_WEB_FORM_COOLDOWN_MS) {
    return res.status(429).json({ resStatus: false, resMessage: "Please wait a minute before sending again.", resErrorCode: 429 });
  }
  langasWebFormCache.set(key, now);
  if (langasWebFormCache.size > 20000) langasWebFormCache.clear();
  next();
}

// ══════════════════════════════════════════════════════════════════════════
//  VISIT LOG  — POST /visit  { path, referrer }
// ══════════════════════════════════════════════════════════════════════════
router.post("/visit", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const langasWebUa = req.get("User-Agent") || "";
  if (!langasWebUa || LANGAS_WEB_BOT_RE.test(langasWebUa)) {
    return res.status(200).json({ resStatus: true, resMessage: "Skipped", resOkCode: 2 });
  }
  const langasWebPath = langasWebText(req.body?.path, 200) || "/";
  if (!langasWebPath.startsWith("/")) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid path", resErrorCode: 1 });
  }
  const langasWebIpVal = langasWebIp(req);
  const langasWebCacheKey = langasWebIpVal + "|" + langasWebPath;
  const langasWebNow = Date.now();
  const langasWebLast = langasWebVisitCache.get(langasWebCacheKey);
  if (langasWebLast && langasWebNow - langasWebLast < LANGAS_WEB_VISIT_COOLDOWN_MS) {
    return res.status(200).json({ resStatus: true, resMessage: "Already counted", resOkCode: 3 });
  }
  langasWebVisitCache.set(langasWebCacheKey, langasWebNow);
  if (langasWebVisitCache.size > 50000) langasWebVisitCache.clear();

  // Only the referring site's host (e.g. "google.com"), never the full URL
  let langasWebRef = "";
  try {
    const r = langasWebText(req.body?.referrer, 500);
    if (r) {
      const host = new URL(r).hostname.replace(/^www\./, "");
      if (host && !host.endsWith("langas.online")) langasWebRef = host.slice(0, 120);
    }
  } catch (e) { /* not a URL: ignore */ }

  const langasWebAgent = useragent.parse(langasWebUa);
  try {
    await pool.query(
      `INSERT INTO langas_web_visits (path, referrer, ip_hash, os, browser, is_mobile)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        langasWebPath,
        langasWebRef || null,
        langasWebIpHash(langasWebIpVal),
        langasWebText(langasWebAgent.os.toString(), 60),
        langasWebText(langasWebAgent.toAgent(), 60),
        /Mobi|Android|iPhone|iPad/i.test(langasWebUa)
      ]
    );
    return res.status(200).json({ resStatus: true, resMessage: "Visit saved", resOkCode: 1 });
  } catch (err) {
    console.error("Langas web visit error:", err.message);
    return res.status(200).json({ resStatus: false, resMessage: "Visit not saved", resErrorCode: 2 });
  }
});

// Daily clean-up: visits older than 12 months are deleted
async function langasWebCleanVisits() {
  try {
    await pool.query(
      `DELETE FROM langas_web_visits WHERE created_at < NOW() - ($1 || ' months')::interval`,
      [String(LANGAS_WEB_VISIT_KEEP_MONTHS)]
    );
  } catch (e) {
    console.error("Langas web visit clean-up failed:", e.message);
  }
}
setTimeout(langasWebCleanVisits, 2 * 60 * 1000);
setInterval(langasWebCleanVisits, 24 * 60 * 60 * 1000);

// ══════════════════════════════════════════════════════════════════════════
//  CONTACT FORM — POST /contact  { name, email, topic, message, website }
// ══════════════════════════════════════════════════════════════════════════
router.post("/contact", blockMaliciousIPs, applyWriteRateLimit, langasWebFormCooldown, async (req, res) => {
  // Hidden "website" field: only bots fill it. Pretend success, save nothing.
  if (langasWebText(req.body?.website, 200)) {
    return res.status(200).json({ resStatus: true, resMessage: "Message sent", resOkCode: 1 });
  }
  const langasWebName = langasWebText(req.body?.name, 80);
  const langasWebEmail = langasWebText(req.body?.email, 160).toLowerCase();
  const langasWebTopicRaw = langasWebText(req.body?.topic, 20);
  const langasWebTopic = LANGAS_WEB_TOPICS.includes(langasWebTopicRaw) ? langasWebTopicRaw : "general";
  const langasWebMessage = langasWebText(req.body?.message, 2000);

  if (langasWebName.length < 2) {
    return res.status(400).json({ resStatus: false, resMessage: "Please write your name.", resErrorCode: 1 });
  }
  if (!LANGAS_WEB_EMAIL_RE.test(langasWebEmail)) {
    return res.status(400).json({ resStatus: false, resMessage: "Please enter a valid email address.", resErrorCode: 2 });
  }
  if (langasWebMessage.length < 5) {
    return res.status(400).json({ resStatus: false, resMessage: "Please write a message.", resErrorCode: 3 });
  }
  try {
    await pool.query(
      `INSERT INTO langas_web_contacts (name, email, topic, message, ip_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [langasWebName, langasWebEmail, langasWebTopic, langasWebMessage, langasWebIpHash(langasWebIp(req))]
    );
    return res.status(200).json({ resStatus: true, resMessage: "Message sent", resOkCode: 1 });
  } catch (err) {
    console.error("Langas web contact error:", err.message);
    return res.status(500).json({ resStatus: false, resMessage: "Server error. Please try again later.", resErrorCode: 99 });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  ACCOUNT DELETION REQUEST — POST /delete-request  { email, displayName, note, website }
// ══════════════════════════════════════════════════════════════════════════
router.post("/delete-request", blockMaliciousIPs, applyWriteRateLimit, langasWebFormCooldown, async (req, res) => {
  if (langasWebText(req.body?.website, 200)) {
    return res.status(200).json({ resStatus: true, resMessage: "Request received", resOkCode: 1 });
  }
  const langasWebEmail = langasWebText(req.body?.email, 160).toLowerCase();
  const langasWebDisplay = langasWebText(req.body?.displayName, 40);
  const langasWebNote = langasWebText(req.body?.note, 500);

  if (!LANGAS_WEB_EMAIL_RE.test(langasWebEmail)) {
    return res.status(400).json({ resStatus: false, resMessage: "Please enter a valid email address.", resErrorCode: 2 });
  }
  if (langasWebDisplay.length < 2) {
    return res.status(400).json({ resStatus: false, resMessage: "Please write your Langas display name.", resErrorCode: 3 });
  }
  try {
    await pool.query(
      `INSERT INTO langas_web_delete_requests (email, display_name, note, ip_hash)
       VALUES ($1, $2, $3, $4)`,
      [langasWebEmail, langasWebDisplay, langasWebNote || null, langasWebIpHash(langasWebIp(req))]
    );
    return res.status(200).json({ resStatus: true, resMessage: "Request received", resOkCode: 1 });
  } catch (err) {
    console.error("Langas web delete request error:", err.message);
    return res.status(500).json({ resStatus: false, resMessage: "Server error. Please try again later.", resErrorCode: 99 });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  INVITE PREVIEW — GET /u/:id   (public, nothing private)
//  -> { player: { name, avatarUrl, levelCode, levelTitle, points, streak, crowns } }
// ══════════════════════════════════════════════════════════════════════════
router.get("/u/:id", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
  const langasWebId = /^\d{1,12}$/.test(String(req.params.id)) ? Number(req.params.id) : 0;
  if (!langasWebId) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid player", resErrorCode: 1 });
  }
  try {
    const langasWebUser = await pool.query(
      `SELECT u.id, COALESCE(u.custom_name, u.display_name) AS name, u.avatar_path,
              CASE WHEN u.streak_last_date >= (NOW() AT TIME ZONE 'Europe/Riga')::date - 1
                   THEN u.streak_days ELSE 0 END AS streak,
              COALESCE((SELECT SUM(s.best_score) FROM langas_scores s WHERE s.user_id = u.id), 0)::int AS points
       FROM langas_users u WHERE u.id = $1`,
      [langasWebId]
    );
    if (!langasWebUser.rowCount) {
      return res.status(404).json({ resStatus: false, resMessage: "Player not found", resErrorCode: 2 });
    }
    const u = langasWebUser.rows[0];

    // Level they're on (first level with an unplayed lesson) + crowns (90%+ lessons)
    const langasWebLevels = await pool.query(
      `SELECT l.code, l.title, l.sort_order,
              COUNT(e.id)::int AS total,
              COUNT(e.id) FILTER (WHERE COALESCE(s.attempts, 0) > 0)::int AS done,
              COUNT(e.id) FILTER (WHERE COALESCE(s.attempts, 0) > 0
                AND s.best_correct * 100 >= 90 * 10 * (SELECT COUNT(*) FROM langas_questions q
                                                     WHERE q.exercise_id = e.id))::int AS crowns
       FROM langas_levels l
       JOIN langas_exercises e ON e.level_id = l.id AND e.is_active = TRUE
       LEFT JOIN langas_scores s ON s.exercise_id = e.id AND s.user_id = $1
       GROUP BY l.id
       ORDER BY l.sort_order`,
      [langasWebId]
    );
    const langasWebRows = langasWebLevels.rows;
    const langasWebLevel = langasWebRows.find(l => l.done < l.total) || langasWebRows[langasWebRows.length - 1] || null;
    const langasWebCrowns = langasWebRows.reduce((n, l) => n + l.crowns, 0);

    let langasWebAvatar = "";
    if (u.avatar_path) {
      try {
        const { data } = await supabase.storage
          .from(LANGAS_WEB_AVATAR_BUCKET)
          .createSignedUrl(u.avatar_path, LANGAS_WEB_AVATAR_LINK_SEC);
        langasWebAvatar = data?.signedUrl || "";
      } catch (e) { /* no photo: first letter */ }
    }

    res.set("Cache-Control", "public, max-age=300");
    return res.status(200).json({
      resStatus: true,
      player: {
        name: u.name,
        avatarUrl: langasWebAvatar,
        levelCode: langasWebLevel ? langasWebLevel.code : "",
        levelTitle: langasWebLevel ? langasWebLevel.title : "",
        points: u.points || 0,
        streak: u.streak || 0,
        crowns: langasWebCrowns
      }
    });
  } catch (err) {
    console.error("Langas web invite error:", err.message);
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

module.exports = router;
