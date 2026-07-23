const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const ffmpeg = require("fluent-ffmpeg");
const { execFile } = require("child_process");
const execFileAsync = require("util").promisify(execFile);
const os = require("os");
const path = require("path");

const sharp = require("sharp");
const multer = require("multer");
const { PDFDocument, StandardFonts, rgb, degrees, grayscale, LineCapStyle, LineJoinStyle, 
  pushGraphicsState, popGraphicsState, setLineJoin, setFillingColor, moveTo, lineTo, 
  closePath, fill } = require("pdf-lib");

//fonts for text tool of pdf editor page
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');

const jwt = require("jsonwebtoken");
const { pool, upload } = require("../db");
const sendEmailBrevo = require("../utils/sendEmailBrevo");
const { OAuth2Client } = require("google-auth-library");
const { ipDailyLimit, fbVisitCooldown, fbCommentCheck, fbCommentMark } = require("../middleware/filebeef_MW");
const useragent = require("useragent");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const FRONTEND_URL    = process.env.FRONTEND_URL_FILEBEEF || "https://filebeef.com";
const JWT_EMAIL       = process.env.JWT_SECRET_FILEBEEF_EMAIL_VERIFY;
const JWT_SECRET      = process.env.JWT_SECRET;
const SALT_ROUNDS     = 10;
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 365; // 1 year in ms
const FB_DEVICE_MAX_AGE = 1000 * 60 * 60 * 24 * 730; // 2 years — outlives the session cookie
const FB_MAX_DEVICES = 3;

// Bots we let through but never log. Version numbers ignored (substring match).
const FB_BOT_AGENTS = [
  "AdsBot-Google", "AhrefsBot", "Amazonbot", "anthropic-ai", "Applebot",
  "Baiduspider", "bingbot", "BLEXBot", "bot/", "Bytespider",
  "CCBot", "ChatGPT-User", "Claude-User", "ClaudeBot", "crawler",
  "DataForSeoBot", "Discordbot", "DotBot", "DuckDuckBot",
  "Exabot",
  "facebookcatalog", "facebookexternalhit",
  "Google-InspectionTool", "Googlebot", "GoogleOther", "GPTBot",
  "HeadlessChrome",
  "LinkedInBot",
  "meta-externalagent", "MJ12bot",
  "OAI-SearchBot",
  "PerplexityBot", "PetalBot",
  "SemrushBot", "Slackbot", "Sogou", "spider",
  "TelegramBot", "Twitterbot",
  "WhatsApp",
  "YandexBot", "YandexRenderResourcesBot"
];
const FB_TOOL_RE = /^[a-z0-9-]{1,60}$/;
const FB_NON_TOOL_PAGES = ["index", "home", "pricing", "login", "register", "about", "contact", "privacy", "terms", "blog", "faq"];
const FB_SKIP_IPS = [
  "80.89.74.71", "80.89.72.92", "80.89.72.211", "80.89.73.115", "80.89.73.203", "80.89.73.255",
  "212.3.195.47", "212.3.194.225"
];
// ── HELPERS ────────────────────────────────────────────────────────────────
function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  let ip = xf ? xf.split(",")[0].trim() : req.socket?.remoteAddress || req.ip;
  if (ip?.startsWith("::ffff:")) ip = ip.slice(7);
  return ip || "unknown";
}

// Long-lived per-browser id so a returning device reuses its own slot
// instead of consuming a new one on every fresh login.
function fbGetDeviceId(req, res) {
  let deviceId = req.cookies?.filebeef_device;
  if (!deviceId || !/^[a-f0-9]{32}$/.test(deviceId)) {
    deviceId = crypto.randomBytes(16).toString("hex");
    res.cookie("filebeef_device", deviceId, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: FB_DEVICE_MAX_AGE
    });
  }
  return deviceId;
}

function setSessionCookie(res, token) {
  res.cookie("filebeef_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: SESSION_MAX_AGE
  });
}

async function createSession(req, res, userId) {
  const ip = getClientIp(req);
  const userAgent = req.headers["user-agent"] || null;
  const deviceId = fbGetDeviceId(req, res);

  // drop expired rows so dead sessions never occupy a device slot
  await pool.query(`DELETE FROM filebeef_sessions WHERE user_id = $1 AND expires_at < NOW()`, [userId]);

  // this browser logging in again replaces its own row, not a new slot
  await pool.query(`DELETE FROM filebeef_sessions WHERE user_id = $1 AND device_id = $2`, [userId, deviceId]);
  const active = await pool.query(
    `SELECT COUNT(*)::int AS n FROM filebeef_sessions WHERE user_id = $1`,
    [userId]
  );
  // device limit reached by an unknown device -> force logout everywhere
  if (active.rows[0].n >= FB_MAX_DEVICES) {
    await pool.query(`DELETE FROM filebeef_sessions WHERE user_id = $1`, [userId]);
  }
  const token = crypto.randomBytes(64).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE);
  await pool.query(
    `INSERT INTO filebeef_sessions (user_id, token, ip, user_agent, device_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, token, ip, userAgent || null, deviceId, expiresAt]
  );
  return token;
}

// ── AUTH MIDDLEWARE ────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = req.cookies?.filebeef_session;
  if (!token) {
    return res.status(401).json({ resStatus: false, resMessage: "Unauthorized", resErrorCode: 1 });
  }
  try {
    const result = await pool.query(
      `SELECT s.user_id, s.expires_at, u.email, u.plan, u.auth_provider, 
              u.plan_expires_at, u.stripe_customer_id, u.stripe_sub_id
       FROM filebeef_sessions s
       JOIN filebeef_users u ON u.id = s.user_id
       WHERE s.token = $1 LIMIT 1`,
      [token]
    );
    if (!result.rowCount) {
      return res.status(401).json({ resStatus: false, resMessage: "Invalid session", resErrorCode: 2 });
    }
    const session = result.rows[0];
    if (new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ resStatus: false, resMessage: "Session expired", resErrorCode: 3 });
    }
    if (session.plan === "pro" && session.plan_expires_at && new Date(session.plan_expires_at) < new Date()) {
      await pool.query(
        `UPDATE filebeef_users SET plan = 'free', sub_status = 'expired' WHERE id = $1`,
        [session.user_id]
      );
      session.plan = "free";
    }
    req.filebeefUser = session;
    next();
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
}

// ── RATE LIMITER ───────────────────────────────────────────────────────────
const filebeefRateStore = Object.create(null);
function filebeefWriteLimit(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const WINDOW = 60_000;
  const LIMIT = 30;
  if (!filebeefRateStore[ip]) { filebeefRateStore[ip] = { count: 1, start: now }; return next(); }
  const w = filebeefRateStore[ip];
  if (now - w.start > WINDOW) { filebeefRateStore[ip] = { count: 1, start: now }; return next(); }
  w.count++;
  if (w.count > LIMIT) {
    return res.status(429).json({ resStatus: false, resMessage: "Too many requests", resErrorCode: 429 });
  }
  next();
}
// ── SHARED DAILY CONVERSION LIMITS (PDF, image, font, archive) ─────────────
const DAILY_LIMITS = {
  anon: 1,
  free: 3,
  pro:  20
};

// ── IMAGE SIZE LIMITS ──────────────────────────────────────────────────────
const IMAGE_LIMITS = {
  anon: { sizeMB: 5  },
  free: { sizeMB: 8  },
  pro:  { sizeMB: 20 }
};

// ── PDF SIZE LIMITS ────────────────────────────────────────────────────────
const PDF_LIMITS = {
  anon: { sizeMB: 2  },
  free: { sizeMB: 5  },
  pro:  { sizeMB: 20 }
};

// ── FONT SIZE LIMITS ───────────────────────────────────────────────────────
const FONT_LIMITS = {
  anon: { sizeMB: 2  },
  free: { sizeMB: 2  },
  pro:  { sizeMB: 20 }
};

// ── SVG SIZE LIMITS ────────────────────────────────────────────────────────
const SVG_LIMITS = {
  anon: { sizeMB: 1  },
  free: { sizeMB: 2  },
  pro:  { sizeMB: 20 }
};

// ── VIDEO LIMITS ───────────────────────────────────────────────────────────
const VIDEO_LIMITS = {
  anon: { daily: 1, sizeMB: 10 },
  free: { daily: 1, sizeMB: 20 },
  pro:  { daily: 3, sizeMB: 75 }
};

// ── AUDIO LIMITS ───────────────────────────────────────────────────────────
const AUDIO_LIMITS = {
  anon: { daily: 1, sizeMB: 10 },
  free: { daily: 1, sizeMB: 20 },
  pro:  { daily: 3, sizeMB: 75 }
};
// ── PDF EDITOR ─────────────────────────────────────────────────────────────
const EDITOR_LIMITS = {
  anon: {
    sizeMB: 3,
    maxAnnotations: 2,
    allowedTypes: ['highlight', 'text'],
    sigDataMaxKB: 400,
    imgMaxKB: 500,
    watermark: true
  },
  free: {
    sizeMB: 3,
    maxAnnotations: 4,
    allowedTypes: ['highlight', 'text', 'pen', 'sticky'],
    sigDataMaxKB: 400,
    imgMaxKB: 500,
    watermark: false
  },
  pro: {
    sizeMB: 20,
    maxAnnotations: 10,
    allowedTypes: ['highlight', 'text', 'pen', 'sticky', 'rectangle', 'circle', 'arrow', 'image', 'signature', 'redact'],
    sigDataMaxKB: 1000,
    imgMaxKB: 1000,
    watermark: false
  }
}
// ══════════════════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════════════════
// ── VISITOR LOGGING ────────────────────────────────────────────────────────

router.post("/api/post/filebeef/save-visitor", fbVisitCooldown(30 * 60 * 1000), async (req, res) => {
  // silently skip some IPs
  if (FB_SKIP_IPS.includes(getClientIp(req))) {
    return res.status(200).json({ resStatus: false, resMessage: "skipped", resErrorCode: 5 });
  }
  const fbVisitUA = req.get("User-Agent") || "";
  // silently skip bots (they are not blocked, just not logged)
  const fbVisitUALower = fbVisitUA.toLowerCase();
  const fbVisitBotHit = FB_BOT_AGENTS.find(b => fbVisitUALower.includes(b.toLowerCase()));
  if (fbVisitBotHit) {
    return res.status(200).json({ resStatus: false, resMessage: "skipped", resErrorCode: 3 });
  }
  // silently skip if within cooldown for this ip+tool
  if (!req.fbShouldLogVisit) {
    return res.status(200).json({ resStatus: false, resMessage: "skipped", resErrorCode: 1 });
  }
  const fbVisitToolRaw = String(req.body?.tool || "").trim().toLowerCase();
  const fbVisitTool = FB_TOOL_RE.test(fbVisitToolRaw) ? fbVisitToolRaw : "unknown";
  // only tool pages are logged - reject anything the frontend shouldn't have sent
  if (fbVisitTool === "unknown" || FB_NON_TOOL_PAGES.includes(fbVisitTool)) {
    return res.status(200).json({ resStatus: false, resMessage: "skipped", resErrorCode: 4 });
  }
  const fbVisitAgent = useragent.parse(fbVisitUA);
  let fbVisitClient;
  try {
    fbVisitClient = await pool.connect();
    await fbVisitClient.query(
      `INSERT INTO visitors_filebeef (ip, op, browser, tool, date)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        getClientIp(req),
        fbVisitAgent.os.toString(),
        fbVisitAgent.toAgent(),
        fbVisitTool,
        new Date().toLocaleDateString("en-GB")
      ]
    );
    return res.status(200).json({ resStatus: true, resMessage: "logged", resOkCode: 1 });
  } catch (err) {
    return res.status(200).json({ resStatus: false, resMessage: "log failed", resErrorCode: 2 });
  } finally {
    if (fbVisitClient) fbVisitClient.release();
  }
});
// ── REGISTER ──────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/auth/register", filebeefWriteLimit, async (req, res) => {
  const { email, password } = req.body;
  const ip = getClientIp(req);

  if (!email || !password) {
    return res.status(400).json({ resStatus: false, resMessage: "Email and password are required", resErrorCode: 1 });
  }
  if (password.length < 8) {
    return res.status(400).json({ resStatus: false, resMessage: "Password must be at least 8 characters", resErrorCode: 2 });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid email address", resErrorCode: 3 });
  }

  let client;
  try {
    client = await pool.connect();
    const existing = await client.query(
      `SELECT id, auth_provider FROM filebeef_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    if (existing.rowCount) {
      const provider = existing.rows[0].auth_provider;
      if (provider === "google") {
        return res.status(409).json({
          resStatus: false,
          resMessage: "This email is registered with Google. Please log in with Google.",
          resErrorCode: 4
        });
      }
      return res.status(409).json({ resStatus: false, resMessage: "Email already registered", resErrorCode: 5 });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationJwt = jwt.sign({ email, token: verificationToken }, JWT_EMAIL, { expiresIn: "24h" });

    await client.query(
      `INSERT INTO filebeef_users (email, password_hash, auth_provider, verified, verification_token, has_password)
       VALUES ($1, $2, 'email', false, $3, true)`,
      [email.toLowerCase().trim(), passwordHash, verificationToken]
    );

    const verifyUrl = `${FRONTEND_URL}/verify-email.html?token=${verificationJwt}`;
    await sendEmailBrevo({
      site: "filebeef",
      to: email,
      subject: "Verify your FileBeef account",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
          <h2 style="font-size:20px;font-weight:500;margin-bottom:8px;">Welcome to FileBeef</h2>
          <p style="color:#6b6460;margin-bottom:24px;">Click the button below to verify your email address.</p>
          <a href="${verifyUrl}" style="display:inline-block;background:#1f1a15;color:#faf9f7;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:15px;">Verify email</a>
          <p style="color:#a89f96;font-size:12px;margin-top:24px;">Link expires in 24 hours. If you didn't create an account, ignore this email.</p>
        </div>
      `
    });

    return res.status(201).json({
      resStatus: true,
      resMessage: "Account created. Please check your email to verify.",
      resOkCode: 1
    });

  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  } finally {
    if (client) client.release();
  }
});

// ── VERIFY EMAIL ──────────────────────────────────────────────────────────
router.post("/api/post/filebeef/auth/verify-email", filebeefWriteLimit, async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ resStatus: false, resMessage: "Token required", resErrorCode: 1 });
  }
  let client;
  try {
    const decoded = jwt.verify(token, JWT_EMAIL);
    client = await pool.connect();
    const result = await client.query(
      `UPDATE filebeef_users SET verified = true, verification_token = null
       WHERE LOWER(email) = LOWER($1) AND verification_token = $2 AND verified = false
       RETURNING id`,
      [decoded.email, decoded.token]
    );
    if (!result.rowCount) {
      return res.status(400).json({ resStatus: false, resMessage: "Invalid or already used token", resErrorCode: 2 });
    }
    return res.status(200).json({ resStatus: true, resMessage: "Email verified. You can now log in.", resOkCode: 1 });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(400).json({ resStatus: false, resMessage: "Verification link expired. Please register again.", resErrorCode: 3 });
    }
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  } finally {
    if (client) client.release();
  }
});

// ── LOGIN ─────────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/auth/login", filebeefWriteLimit, async (req, res) => {
  const { email, password } = req.body;
  const ip = getClientIp(req);
  const userAgent = req.headers["user-agent"] || null;

  if (!email || !password) {
    return res.status(400).json({ resStatus: false, resMessage: "Email and password are required", resErrorCode: 1 });
  }

  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT id, email, password_hash, auth_provider, verified, plan, has_password
       FROM filebeef_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    if (!result.rowCount) {
      return res.status(401).json({ resStatus: false, resMessage: "Invalid email or password", resErrorCode: 2 });
    }
    const user = result.rows[0];

    // Google-only account (no password set)
    if (user.auth_provider === "google" && !user.has_password) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "This account uses Google login. Please continue with Google.",
        resErrorCode: 3
      });
    }

    if (!user.verified) {
      return res.status(401).json({ resStatus: false, resMessage: "Please verify your email before logging in.", resErrorCode: 4 });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ resStatus: false, resMessage: "Invalid email or password", resErrorCode: 5 });
    }

    const token = await createSession(req, res, user.id);
    setSessionCookie(res, token);

    return res.status(200).json({
      resStatus: true,
      resMessage: "Logged in",
      resOkCode: 1,
      user: { email: user.email, plan: user.plan }
    });

  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  } finally {
    if (client) client.release();
  }
});

// ── GOOGLE LOGIN ──────────────────────────────────────────────────────────
router.post("/api/post/filebeef/auth/google", filebeefWriteLimit, async (req, res) => {
  const { idToken } = req.body;
  const ip = getClientIp(req);
  const userAgent = req.headers["user-agent"] || null;

  if (!idToken) {
    return res.status(400).json({ resStatus: false, resMessage: "Google token required", resErrorCode: 1 });
  }

  let client;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { sub: googleId, email } = payload;

    client = await pool.connect();

    // check if email exists as email-only account (no google_id)
    const existingEmail = await client.query(
      `SELECT id, auth_provider, has_password FROM filebeef_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    if (existingEmail.rowCount && existingEmail.rows[0].auth_provider === "email") {
      return res.status(409).json({
        resStatus: false,
        resMessage: "This email is registered with a password. Please log in with email and password.",
        resErrorCode: 2
      });
    }

    const result = await client.query(
      `INSERT INTO filebeef_users (email, auth_provider, google_id, verified, has_password)
       VALUES ($1, 'google', $2, true, false)
       ON CONFLICT (google_id) DO UPDATE SET email = EXCLUDED.email, updated_at = NOW()
       RETURNING id, email, plan`,
      [email.toLowerCase().trim(), googleId]
    );
    const user = result.rows[0];

    const token = await createSession(req, res, user.id);
    setSessionCookie(res, token);

    return res.status(200).json({
      resStatus: true,
      resMessage: "Logged in with Google",
      resOkCode: 1,
      user: { email: user.email, plan: user.plan }
    });

  } catch (err) {
    if (err.message?.includes("Invalid") || err.message?.includes("JWT")) {
      return res.status(401).json({ resStatus: false, resMessage: "Invalid Google token", resErrorCode: 3 });
    }
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  } finally {
    if (client) client.release();
  }
});

// ── LOGOUT ────────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/auth/logout", async (req, res) => {
  const token = req.cookies?.filebeef_session;
  if (token) {
    try {
      await pool.query(`DELETE FROM filebeef_sessions WHERE token = $1`, [token]);
    } catch (_) {}
  }
  res.clearCookie("filebeef_session", { path: "/", sameSite: "none", secure: true });
  return res.status(200).json({ resStatus: true, resMessage: "Logged out", resOkCode: 1 });
});

// ── GET ME ────────────────────────────────────────────────────────────────
router.get("/api/get/filebeef/auth/me", requireAuth, async (req, res) => {
  const user = req.filebeefUser;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [dailyResult, totalResult, userResult] = await Promise.all([
      pool.query(`SELECT count FROM filebeef_daily_usage WHERE user_id = $1 AND date = $2`, [user.user_id, today]),
      pool.query(`SELECT COUNT(*) FROM filebeef_usage WHERE user_id = $1 AND status = 'success'`, [user.user_id]),
      pool.query(`SELECT created_at, auth_provider, has_password, plan, plan_interval, plan_expires_at, sub_status FROM filebeef_users WHERE id = $1`, [user.user_id])
    ]);
    const userData = userResult.rows[0];
    return res.status(200).json({
      resStatus: true,
      resOkCode: 1,
      email: user.email,
      plan: userData.plan,
      authProvider: userData.auth_provider,
      hasPassword: userData.has_password,
      billingInterval: userData.plan_interval,
      expiresAt: userData.plan_expires_at,
      todayCount: dailyResult.rows[0]?.count || 0,
      totalCount: totalResult.rows[0]?.count || 0,
      createdAt: userData.created_at,
      subStatus: userData.sub_status
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// ── LIMITS (public — works for anon too) ───────────────────────────────────
router.get("/api/get/filebeef/limits", optionalAuth, async (req, res) => {
  const fbLimUser = req.filebeefUser;
  const fbLimIp = getClientIp(req);
  const fbLimTier = getTier(fbLimUser);
  try {
    const fbLimCheck = await checkConversionLimit(fbLimUser?.user_id, fbLimIp, fbLimTier);
    return res.status(200).json({
      resStatus: true,
      tier: fbLimTier,
      sizeMB: {
        pdf:    PDF_LIMITS[fbLimTier].sizeMB,
        image:  IMAGE_LIMITS[fbLimTier].sizeMB,
        font:   FONT_LIMITS[fbLimTier].sizeMB,
        svg:    SVG_LIMITS[fbLimTier].sizeMB,
        video:  VIDEO_LIMITS[fbLimTier].sizeMB,
        audio:  AUDIO_LIMITS[fbLimTier].sizeMB,
        editor: EDITOR_LIMITS[fbLimTier].sizeMB
      },
      used: fbLimCheck.used,
      limit: fbLimCheck.limit,
      allowed: fbLimCheck.allowed
    });
  } catch (err) {
    console.error("Limits fetch error:", err.message);
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// ── FORGOT PASSWORD ───────────────────────────────────────────────────────
router.post("/api/post/filebeef/auth/forgot-password", filebeefWriteLimit, async (req, res) => {
  const { email, forceReset } = req.body;
  if (!email) {
    return res.status(400).json({ resStatus: false, resMessage: "Email required", resErrorCode: 1 });
  }
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT id, auth_provider FROM filebeef_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );

    if (!result.rowCount) {
      // prevent email enumeration
      return res.status(200).json({ resStatus: true, resMessage: "If that email exists, a reset link was sent.", resOkCode: 1 });
    }

    const user = result.rows[0];

    // Google account — inform frontend unless user explicitly requests reset
    if (user.auth_provider === "google" && !forceReset) {
      return res.status(200).json({
        resStatus: true,
        resOkCode: 2,
        isGoogle: true,
        resMessage: "This email is registered with Google."
      });
    }

    // send reset email (works for both email and google accounts)
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    await client.query(
      `UPDATE filebeef_users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3`,
      [resetToken, resetExpires, user.id]
    );

    const resetJwt = jwt.sign({ userId: user.id, token: resetToken }, JWT_EMAIL, { expiresIn: "1h" });
    const resetUrl = `${FRONTEND_URL}/reset-password.html?token=${resetJwt}`;

    await sendEmailBrevo({
      site: "filebeef",
      to: email,
      subject: "Reset your FileBeef password",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
          <h2 style="font-size:20px;font-weight:500;margin-bottom:8px;">Reset your password</h2>
          <p style="color:#6b6460;margin-bottom:24px;">Click the button below to set a new password.</p>
          <a href="${resetUrl}" style="display:inline-block;background:#1f1a15;color:#faf9f7;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:15px;">Reset password</a>
          <p style="color:#a89f96;font-size:12px;margin-top:24px;">Link expires in 1 hour. If you didn't request this, ignore this email.</p>
        </div>
      `
    });

    return res.status(200).json({ resStatus: true, resMessage: "If that email exists, a reset link was sent.", resOkCode: 1 });

  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  } finally {
    if (client) client.release();
  }
});

// ── RESET PASSWORD ────────────────────────────────────────────────────────
router.post("/api/post/filebeef/auth/reset-password", filebeefWriteLimit, async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ resStatus: false, resMessage: "Token and new password required", resErrorCode: 1 });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ resStatus: false, resMessage: "Password must be at least 8 characters", resErrorCode: 2 });
  }
  let client;
  try {
    const decoded = jwt.verify(token, JWT_EMAIL);
    client = await pool.connect();
    const result = await client.query(
      `SELECT id FROM filebeef_users
       WHERE id = $1 AND reset_token = $2 AND reset_token_expires > NOW()
       LIMIT 1`,
      [decoded.userId, decoded.token]
    );
    if (!result.rowCount) {
      return res.status(400).json({ resStatus: false, resMessage: "Invalid or expired reset link", resErrorCode: 3 });
    }
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // set password and mark has_password = true (covers Google account conversion)
    await client.query(
      `UPDATE filebeef_users 
       SET password_hash = $1, reset_token = null, reset_token_expires = null,
           has_password = true, verified = true, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, decoded.userId]
    );

    // invalidate all sessions
    await client.query(`DELETE FROM filebeef_sessions WHERE user_id = $1`, [decoded.userId]);

    return res.status(200).json({ resStatus: true, resMessage: "Password set. You can now log in with email and password.", resOkCode: 1 });

  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(400).json({ resStatus: false, resMessage: "Reset link expired. Please request a new one.", resErrorCode: 4 });
    }
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  } finally {
    if (client) client.release();
  }
});

// ── CHANGE PASSWORD ───────────────────────────────────────────────────────
router.post("/api/post/filebeef/auth/change-password", requireAuth, filebeefWriteLimit, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.filebeefUser.user_id;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ resStatus: false, resMessage: "Both passwords required", resErrorCode: 1 });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ resStatus: false, resMessage: "New password must be at least 8 characters", resErrorCode: 2 });
  }

  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT password_hash, has_password FROM filebeef_users WHERE id = $1`, [userId]
    );
    if (!result.rows[0].has_password) {
      return res.status(400).json({ resStatus: false, resMessage: "No password set. Use forgot password to set one.", resErrorCode: 3 });
    }
    const match = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!match) {
      return res.status(401).json({ resStatus: false, resMessage: "Current password is incorrect", resErrorCode: 4 });
    }
    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await client.query(
      `UPDATE filebeef_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [newHash, userId]
    );
    return res.status(200).json({ resStatus: true, resMessage: "Password updated", resOkCode: 1 });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  } finally {
    if (client) client.release();
  }
});

// ── DELETE ACCOUNT ────────────────────────────────────────────────────────
router.delete("/api/delete/filebeef/auth/account", requireAuth, async (req, res) => {
  const userId = req.filebeefUser.user_id;
  let client;
  try {
    client = await pool.connect();

    const userResult = await client.query(
      `SELECT stripe_sub_id FROM filebeef_users WHERE id = $1`, [userId]
    );
    const stripeSubId = userResult.rows[0]?.stripe_sub_id;

    if (stripeSubId) {
      try {
        await stripe.subscriptions.cancel(stripeSubId);
      } catch (stripeErr) {
        console.error("Stripe cancel on delete error:", stripeErr.message);
      }
    }

    await client.query(`DELETE FROM filebeef_users WHERE id = $1`, [userId]);
    res.clearCookie("filebeef_session", { path: "/", sameSite: "none", secure: true });
    return res.status(200).json({ resStatus: true, resMessage: "Account deleted", resOkCode: 1 });

  } catch (err) {
    console.error("Delete account error:", err.message);
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  } finally {
    if (client) client.release();
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  PAYMENT ROUTES
// ══════════════════════════════════════════════════════════════════════════

// ── CHECKOUT ──────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/payments/checkout", requireAuth, async (req, res) => {
  const { billing } = req.body;
  const userId = req.filebeefUser.user_id;
  const userEmail = req.filebeefUser.email;

  const priceId = billing === "annual"
    ? process.env.STRIPE_ANNUAL_PRICE_ID
    : process.env.STRIPE_MONTHLY_PRICE_ID;

  if (!priceId) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid billing type", resErrorCode: 1 });
  }

  try {
    let stripeCustomerId = req.filebeefUser.stripe_customer_id;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { filebeef_user_id: String(userId) }
      });
      stripeCustomerId = customer.id;
      await pool.query(
        `UPDATE filebeef_users SET stripe_customer_id = $1 WHERE id = $2`,
        [stripeCustomerId, userId]
      );
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${process.env.FRONTEND_URL_FILEBEEF}/dashboard.html?payment=success`,
      cancel_url: `${process.env.FRONTEND_URL_FILEBEEF}/pricing.html?payment=cancelled`,
      metadata: { filebeef_user_id: String(userId), billing }
    });

    return res.status(200).json({ resStatus: true, resOkCode: 1, url: session.url });

  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    return res.status(500).json({ resStatus: false, resMessage: "Failed to create checkout session", resErrorCode: 99 });
  }
});

// ── WEBHOOK ───────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/payments/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).json({ resStatus: false, resMessage: `Webhook error: ${err.message}` });
  }

  try {
    switch (event.type) {

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const stripeCustomerId = sub.customer;
        const status = sub.status;
        const items = sub.items && sub.items.data ? sub.items.data : [];
        const firstItem = items[0] || {};
        const price = firstItem.price || firstItem.plan || {};
        const recurring = price.recurring || {};
        const interval = recurring.interval || price.interval || "month";
        const periodEnd = sub.current_period_end || sub.items?.data?.[0]?.current_period_end || null;
        const expiresAt = periodEnd ? new Date(periodEnd * 1000 + 2 * 24 * 60 * 60 * 1000) : null;
        const plan = status === "active" ? "pro" : "free";
        const planInterval = interval === "year" ? "year" : "month";

        await pool.query(
          `UPDATE filebeef_users 
           SET plan = $1, plan_interval = $2, plan_expires_at = $3,
               stripe_sub_id = $4, sub_status = $5, updated_at = NOW()
           WHERE stripe_customer_id = $6`,
          [plan, planInterval, expiresAt, sub.id, status, stripeCustomerId]
        );
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await pool.query(
          `UPDATE filebeef_users
           SET plan = 'free', plan_interval = null, plan_expires_at = null,
               stripe_sub_id = null, sub_status = 'cancelled', updated_at = NOW()
           WHERE stripe_customer_id = $1`,
          [sub.customer]
        );
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const userResult = await pool.query(
          `SELECT id, plan_interval FROM filebeef_users WHERE stripe_customer_id = $1 LIMIT 1`,
          [invoice.customer]
        );
        if (!userResult.rowCount) break;
        const user = userResult.rows[0];
        await pool.query(
          `INSERT INTO filebeef_payments 
           (user_id, stripe_payment_id, stripe_invoice_id, amount_cents, currency, plan, plan_interval, status)
           VALUES ($1, $2, $3, $4, $5, 'pro', $6, 'paid')`,
          [user.id, invoice.payment_intent, invoice.id, invoice.amount_paid, invoice.currency, user.plan_interval || "month"]
        );
        break;
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error("Webhook processing error:", err.message);
    return res.status(500).json({ resStatus: false, resMessage: "Webhook processing error", resErrorCode: 99 });
  }
});

// ── CANCEL SUBSCRIPTION ───────────────────────────────────────────────────
router.post("/api/post/filebeef/payments/cancel", requireAuth, async (req, res) => {
  const userId = req.filebeefUser.user_id;
  try {
    const result = await pool.query(
      `SELECT stripe_sub_id FROM filebeef_users WHERE id = $1`, [userId]
    );
    const stripeSubId = result.rows[0]?.stripe_sub_id;
    if (!stripeSubId) {
      return res.status(400).json({ resStatus: false, resMessage: "No active subscription found", resErrorCode: 1 });
    }
    await stripe.subscriptions.update(stripeSubId, { cancel_at_period_end: true });
    await pool.query(
      `UPDATE filebeef_users SET sub_status = 'cancelling', updated_at = NOW() WHERE id = $1`,
      [userId]
    );
    return res.status(200).json({ resStatus: true, resMessage: "Subscription will cancel at end of billing period", resOkCode: 1 });
  } catch (err) {
    console.error("Cancel subscription error:", err.message);
    return res.status(500).json({ resStatus: false, resMessage: "Failed to cancel subscription", resErrorCode: 99 });
  }
});
//Contact form on about.html
router.post("/api/post/filebeef/contact", filebeefWriteLimit, async (req, res) => {
  const { name, email, subject, message } = req.body;
  const ip = getClientIp(req);

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ resStatus: false, resMessage: "All fields are required", resErrorCode: 1 });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid email address", resErrorCode: 2 });
  }
  if (name.length > 100 || subject.length > 200 || message.length > 2000) {
    return res.status(400).json({ resStatus: false, resMessage: "Input too long", resErrorCode: 3 });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query(
      `INSERT INTO messages_filebeef (name, email, subject, message, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [name.trim(), email.trim().toLowerCase(), subject.trim(), message.trim(), ip]
    );
    return res.status(200).json({ resStatus: true, resMessage: "Message sent", resOkCode: 1 });
  } catch (err) {
    console.error("Contact form error:", err.message);
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  } finally {
    if (client) client.release();
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  CONVERSION ROUTES
// ══════════════════════════════════════════════════════════════════════════

// ── ALLOWED IMAGE TYPES ────────────────────────────────────────────────────
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg", "image/png", "image/webp",
  "image/avif", "image/gif", "image/heic", "image/heif"
];

// ── MULTER FOR IMAGES ──────────────────────────────────────────────────────
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_LIMITS.pro.sizeMB * 1024 * 1024, files: 1 }
});

// ── OPTIONAL AUTH MIDDLEWARE ───────────────────────────────────────────────
// Does not block — just attaches user if session exists
async function optionalAuth(req, res, next) {
  const token = req.cookies?.filebeef_session;
  req.filebeefUser = null;
  if (!token) return next();
  try {
    const result = await pool.query(
      `SELECT s.user_id, s.expires_at, u.email, u.plan, u.auth_provider,
              u.plan_expires_at, u.stripe_customer_id, u.stripe_sub_id
       FROM filebeef_sessions s
       JOIN filebeef_users u ON u.id = s.user_id
       WHERE s.token = $1 LIMIT 1`,
      [token]
    );
    if (!result.rowCount) return next();
    const session = result.rows[0];
    if (new Date(session.expires_at) < new Date()) return next();
    // auto-downgrade expired pro
    if (session.plan === "pro" && session.plan_expires_at && new Date(session.plan_expires_at) < new Date()) {
      await pool.query(
        `UPDATE filebeef_users SET plan = 'free', sub_status = 'expired' WHERE id = $1`,
        [session.user_id]
      );
      session.plan = "free";
    }
    req.filebeefUser = session;
  } catch (_) {}
  next();
}

// ── TIER RESOLVER ──────────────────────────────────────────────────────────
function getTier(user) {
  if (!user) return "anon";
  if (user.plan === "pro") return "pro";
  return "free";
}

// ── DAILY LIMIT CHECK (all tiers) ─────────────────────────────────────────
async function checkConversionLimit(userId, ip, tier) {
  const limit = DAILY_LIMITS[tier];
  const today = new Date().toISOString().slice(0, 10);

  if (tier === "anon") {
    const result = await pool.query(
      `SELECT count FROM filebeef_anon_usage WHERE ip = $1 AND date = $2`,
      [ip, today]
    );
    const used = result.rows[0]?.count || 0;
    return { allowed: used < limit, used, limit };
  } else {
    const result = await pool.query(
      `SELECT count FROM filebeef_daily_usage WHERE user_id = $1 AND date = $2`,
      [userId, today]
    );
    const used = result.rows[0]?.count || 0;
    return { allowed: used < limit, used, limit };
  }
}

// ── INCREMENT USAGE ────────────────────────────────────────────────────────
async function incrementUsage(userId, ip, tier, tool, inputFormat, outputFormat, fileSizeKb, status) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (tier === "anon") {
      await pool.query(
        `INSERT INTO filebeef_anon_usage (ip, date, count)
         VALUES ($1, $2, 1)
         ON CONFLICT (ip, date) DO UPDATE SET count = filebeef_anon_usage.count + 1`,
        [ip, today]
      );
    } else {
      await pool.query(
        `INSERT INTO filebeef_daily_usage (user_id, date, count)
         VALUES ($1, $2, 1)
         ON CONFLICT (user_id, date) DO UPDATE SET count = filebeef_daily_usage.count + 1`,
        [userId, today]
      );
      await pool.query(
        `INSERT INTO filebeef_usage (user_id, tool, input_format, output_format, file_size_kb, status, ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, tool, inputFormat || null, outputFormat || null, fileSizeKb || null, status, ip]
      );
    }
  } catch (_) {}
}

// ── IMAGE CONVERT ──────────────────────────────────────────────────────────
router.post("/api/post/filebeef/image/convert", optionalAuth, imageUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser;
    const ip = getClientIp(req);
    const tier = getTier(user);
    const limits = IMAGE_LIMITS[tier];

    if (!req.file) {
      return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    }

    // file size check
    const sizeLimit = limits.sizeMB * 1024 * 1024;
    if (req.file.size > sizeLimit) {
      return res.status(400).json({
        resStatus: false,
        resMessage: `File too large. Max ${limits.sizeMB}MB on your plan.`,
        resErrorCode: 2
      });
    }

    // mime type check (HEIC often arrives as octet-stream, so check extension too)
    const isHeicInput = /\.hei[cf]$/i.test(req.file.originalname) || ["image/heic", "image/heif"].includes(req.file.mimetype);
    if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype) && !isHeicInput) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Unsupported file type. Allowed: PNG, JPG, WEBP, AVIF, GIF, HEIC.",
        resErrorCode: 3
      });
    }
    // format check — fixed high quality, this is a converter not a compressor
    // HEIC/HEIF input is already lossy at ~q85 visual level, so q92 would waste bytes re-encoding it
    const format = req.body.format || "jpeg";
    const quality = isHeicInput ? 85 : 92;
    const allowedFormats = ["jpeg", "png", "webp", "avif", "heic", "heif", "gif"];
    if (!allowedFormats.includes(format)) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Invalid output format.",
        resErrorCode: 4
      });
    }

    // daily limit check
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        resStatus: false,
        resMessage: `Daily limit reached (${limitCheck.limit}/day on your plan). ${tier === "anon" ? "Register for more conversions." : tier === "free" ? "Upgrade to Pro for more." : ""}`,
        resErrorCode: 5,
        limitReached: true,
        tier
      });
    }

    let inputFormat = req.file.mimetype.split("/")[1] || "unknown";
    if (isHeicInput) inputFormat = /\.heif$/i.test(req.file.originalname) ? "heif" : "heic";
    const fileSizeKb = Math.round(req.file.size / 1024);

    try {
      let convertInputBuffer = req.file.buffer;
      if (isHeicInput) {
        const heicTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-heic-conv-"));
        try {
          const heicInPath = path.join(heicTmpDir, "input.heic");
          const heicOutPath = path.join(heicTmpDir, "input.jpg");
          fs.writeFileSync(heicInPath, req.file.buffer);
          await execFileAsync("heif-convert", [heicInPath, heicOutPath]);
          convertInputBuffer = fs.readFileSync(heicOutPath);
        } finally {
          fs.rmSync(heicTmpDir, { recursive: true, force: true });
        }
      }
      let sharpInstance = sharp(convertInputBuffer);
      // HEIC/HEIF photos → PNG/GIF: lossless/palette formats explode at 12MP.
      // Cap longest edge at 2560px — visually identical on screens, ~4x fewer pixels.
      if (isHeicInput && (format === "png" || format === "gif")) {
        sharpInstance = sharpInstance.resize(2048, 2048, { fit: "inside", withoutEnlargement: true });
      }
      switch (format) {
        case "jpeg":
          sharpInstance = sharpInstance.jpeg({ quality });
          break;
        case "png":
          if (isHeicInput) sharpInstance = sharpInstance.png({ compressionLevel: 9 });
          else sharpInstance = sharpInstance.png({ compressionLevel: Math.round((100 - quality) / 11) });
          break;
        case "webp":
          sharpInstance = sharpInstance.webp({ quality });
          break;
        case "avif":
          sharpInstance = sharpInstance.avif({ quality });
          break;
        case "gif":
          sharpInstance = sharpInstance.gif();
          break;
      }

      let outputBuffer;
      if (format === "heic" || format === "heif") {
        // sharp can't encode HEIC — go through heif-enc: normalize to JPG first, then encode
        const heicEncTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-heic-enc-"));
        try {
          const heicEncInPath = path.join(heicEncTmpDir, "input.jpg");
          const heicEncOutPath = path.join(heicEncTmpDir, "output.heic");
          const jpgBuffer = await sharp(convertInputBuffer).jpeg({ quality: 95 }).toBuffer();
          fs.writeFileSync(heicEncInPath, jpgBuffer);
          await execFileAsync("heif-enc", ["-q", "80", "-o", heicEncOutPath, heicEncInPath], { timeout: 30000 });
          outputBuffer = fs.readFileSync(heicEncOutPath);
        } finally {
          fs.rmSync(heicEncTmpDir, { recursive: true, force: true });
        }
      } else {
        outputBuffer = await sharpInstance.toBuffer();
      }
      const ext = format === "jpeg" ? "jpg" : format;
      const mimeType = format === "jpeg" ? "image/jpeg" : format === "heic" ? "image/heic" : format === "heif" ? "image/heif" : `image/${format}`;
      const originalName = req.file.originalname.replace(/\.[^.]+$/, "");
      const outputFilename = `${originalName}.${ext}`;

      await incrementUsage(user?.user_id, ip, tier, "image-convert", inputFormat, format, fileSizeKb, "success");

      res.set({
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${outputFilename}"`,
        "Content-Length": outputBuffer.length
      });

      return res.status(200).send(outputBuffer);

    } catch (err) {
      console.error("Image convert error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "image-convert", inputFormat, format, fileSizeKb, "failed");
      return res.status(500).json({
        resStatus: false,
        resMessage: "Conversion failed. Please check the file and try again.",
        resErrorCode: 99
      });
    }
  }
);

// ── IMAGE OPTIMIZER (compress + resize) ───────────────────────────────────
router.post("/api/post/filebeef/image/optimize", optionalAuth, imageUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser;
    const ip = getClientIp(req);
    const tier = getTier(user);
    const limits = IMAGE_LIMITS[tier];

    if (!req.file) {
      return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    }
    if (req.file.size > limits.sizeMB * 1024 * 1024) {
      return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB on your plan.`, resErrorCode: 2 });
    }
    const optNameExt = (req.file.originalname.split(".").pop() || "").toLowerCase();
    const optIsHeicUpload = ["heic", "heif"].includes(optNameExt) || ["image/heic", "image/heif"].includes(req.file.mimetype);
    if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype) && !optIsHeicUpload) {
      return res.status(400).json({ resStatus: false, resMessage: "Unsupported file type.", resErrorCode: 3 });
    }

    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) {
      return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    }
    const quality = Math.min(100, Math.max(1, parseInt(req.body.quality) || 75));
    let inputFormat = req.file.mimetype.split("/")[1] || "unknown";
    if (optIsHeicUpload) inputFormat = optNameExt === "heif" ? "heif" : "heic";
    const fileSizeKb = Math.round(req.file.size / 1024);
    let tmpDir = null;
    try {
      const isGif = inputFormat === "gif";
      const isHeic = inputFormat === "heic" || inputFormat === "heif";
      let inputBuffer = req.file.buffer;
      // HEIC/HEIF: decode first, re-encode with heif-enc after processing
      if (isHeic) {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-optimize-heic-"));
        const inPath = path.join(tmpDir, "input.heic");
        const outPath = path.join(tmpDir, "output.jpg");
        fs.writeFileSync(inPath, inputBuffer);
        await execFileAsync("heif-convert", ["-q", "100", inPath, outPath]);
        inputBuffer = fs.readFileSync(outPath);
      }
      let sharpInstance = sharp(inputBuffer, isGif ? { animated: true } : {});
      // output in same format as input, default jpeg
      const outputFormat =
        inputFormat === "png" ? "png" :
        inputFormat === "webp" ? "webp" :
        inputFormat === "gif" ? "gif" :
        isHeic ? inputFormat : // "heic" or "heif"
        "jpeg";
      if (outputFormat === "png") sharpInstance = sharpInstance.png({ compressionLevel: 9 });
      else if (outputFormat === "webp") sharpInstance = sharpInstance.webp({ quality });
      else if (outputFormat === "gif") {
        if (quality >= 90) sharpInstance = sharpInstance.gif({ colours: 256 });
        else if (quality >= 75) sharpInstance = sharpInstance.gif({ colours: 128 });
        else if (quality >= 50) sharpInstance = sharpInstance.gif({ colours: 64 });
        else sharpInstance = sharpInstance.gif({ colours: 32 });
      }
      else if (isHeic) {
        // lossless PNG intermediate — all compression happens in heif-enc
        sharpInstance = sharpInstance.png({ compressionLevel: 1 });
      }
      else {
        // remap UI quality to encoder settings: mozjpeg is aggressive, so lift the mid/high tiers
        if (quality >= 90) sharpInstance = sharpInstance.jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true });
        else if (quality >= 75) sharpInstance = sharpInstance.jpeg({ quality: 85, mozjpeg: true });
        else if (quality >= 50) sharpInstance = sharpInstance.jpeg({ quality: 70, mozjpeg: true });
        else sharpInstance = sharpInstance.jpeg({ quality, mozjpeg: true });
      }
      let outputBuffer = await sharpInstance.toBuffer();

      // PNG: lossy quantization via pngquant (High = lossless, skip)
      if (outputFormat === "png" && quality < 90) {
        if (!tmpDir) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-optimize-"));
        const pngIn = path.join(tmpDir, "in.png");
        const pngOut = path.join(tmpDir, "out.png");
        fs.writeFileSync(pngIn, outputBuffer);
        const qMax = quality >= 75 ? 95 : quality >= 50 ? 80 : 60;
        try {
          await execFileAsync("pngquant", [`--quality=0-${qMax}`, "--speed", "1", "--force", "--output", pngOut, pngIn]);
          outputBuffer = fs.readFileSync(pngOut);
        } catch (e) {
          console.error("pngquant failed, keeping lossless PNG:", e.message);
        }
      }

      // HEIC/HEIF output: re-encode the processed intermediate with heif-enc
      if (isHeic) {
        const midPath = path.join(tmpDir, "processed.png");
        const heicOutPath = path.join(tmpDir, "final.heic");
        fs.writeFileSync(midPath, outputBuffer);
        // adaptive: each tier must hit its own size target, not just "any reduction"
        let heicQ = quality >= 90 ? 68 : quality >= 75 ? 55 : quality >= 50 ? 42 : 30;
        const qFloor = quality >= 90 ? 50 : quality >= 75 ? 40 : quality >= 50 ? 30 : 22;
        const targetRatio = quality >= 90 ? 0.95 : quality >= 75 ? 0.82 : quality >= 50 ? 0.65 : 0.50;
        let encoded = null;
        while (true) {
          await execFileAsync("heif-enc", ["-q", String(heicQ), "-o", heicOutPath, midPath], { timeout: 30000 });
          encoded = fs.readFileSync(heicOutPath);
          if (encoded.length < req.file.size * targetRatio || heicQ <= qFloor) break;
          heicQ -= 6;
          if (heicQ < qFloor) heicQ = qFloor;
        }
        outputBuffer = encoded;
      }
      // never return a file bigger than the original
      if (outputBuffer.length >= req.file.size) {
        outputBuffer = req.file.buffer;
      }
      const ext = outputFormat === "jpeg" ? "jpg" : outputFormat;
      const originalName = req.file.originalname.replace(/\.[^.]+$/, "");
      await incrementUsage(user?.user_id, ip, tier, "image-optimize", inputFormat, outputFormat, fileSizeKb, "success");
      res.set({
        "Content-Type": outputFormat === "jpeg" ? "image/jpeg" : `image/${outputFormat}`,
        "Content-Disposition": `attachment; filename="${originalName}_optimized.${ext}"`,
        "Content-Length": outputBuffer.length
      });
      return res.status(200).send(outputBuffer);
    } catch (err) {
      console.error("Image optimize error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "image-optimize", inputFormat, null, fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Optimization failed.", resErrorCode: 99 });
    } finally {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
);
// ── FLIP & ROTATE ──────────────────────────────────────────────────────────
router.post("/api/post/filebeef/image/flip-rotate", optionalAuth, imageUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser;
    const ip = getClientIp(req);
    const tier = getTier(user);
    const limits = IMAGE_LIMITS[tier];

    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 2 });
    const frNameExt = (req.file.originalname.split(".").pop() || "").toLowerCase();
    const frIsHeicUpload = ["heic", "heif"].includes(frNameExt) || ["image/heic", "image/heif"].includes(req.file.mimetype);
    const frIsAvifUpload = frNameExt === "avif" || req.file.mimetype === "image/avif";
    if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype) && !frIsHeicUpload && !frIsAvifUpload) return res.status(400).json({ resStatus: false, resMessage: "Unsupported file type.", resErrorCode: 3 });

    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });

    const rotate = parseInt(req.body.rotate) || 0;       // 0, 90, 180, 270
    const flipH = req.body.flipH === "true";              // horizontal flip
    const flipV = req.body.flipV === "true";              // vertical flip
    let inputFormat = req.file.mimetype.split("/")[1] || "unknown";
    if (frIsHeicUpload) inputFormat = frNameExt === "heif" ? "heif" : "heic";
    if (frIsAvifUpload) inputFormat = "avif";
    const fileSizeKb = Math.round(req.file.size / 1024);

    let tmpDir = null;
    try {
      const isGif = inputFormat === "gif";
      const isHeic = inputFormat === "heic" || inputFormat === "heif";
      let inputBuffer = req.file.buffer;

      // HEIC/HEIF: decode first, re-encode after transform
      if (isHeic) {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-fliprotate-heic-"));
        const inPath = path.join(tmpDir, "input.heic");
        const outPath = path.join(tmpDir, "decoded.png");
        fs.writeFileSync(inPath, inputBuffer);
        await execFileAsync("heif-convert", [inPath, outPath]);
        let decodedPath = outPath;
        if (!fs.existsSync(decodedPath)) {
          const candidate = fs.readdirSync(tmpDir).find(f => f.startsWith("decoded") && f.endsWith(".png"));
          if (!candidate) throw new Error("heif-convert produced no output");
          decodedPath = path.join(tmpDir, candidate);
        }
        inputBuffer = fs.readFileSync(decodedPath);
      }

      // GIF: sharp cannot rotate multi-page images — use gifsicle (lossless, keeps animation)
      if (isGif) {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-fliprotate-gif-"));
        const gifIn = path.join(tmpDir, "in.gif");
        const gifOut = path.join(tmpDir, "out.gif");
        fs.writeFileSync(gifIn, inputBuffer);
        const gifArgs = [];
        if (rotate === 90) gifArgs.push("--rotate-90");
        else if (rotate === 180) gifArgs.push("--rotate-180");
        else if (rotate === 270) gifArgs.push("--rotate-270");
        if (flipH) gifArgs.push("--flip-horizontal");
        if (flipV) gifArgs.push("--flip-vertical");
        await execFileAsync("gifsicle", [...gifArgs, "-o", gifOut, gifIn], { timeout: 30000 });
        const gifBuffer = fs.readFileSync(gifOut);

        await incrementUsage(user?.user_id, ip, tier, "image-flip-rotate", inputFormat, "gif", fileSizeKb, "success");
        const gifName = req.file.originalname.replace(/\.[^.]+$/, "");
        res.set({
          "Content-Type": "image/gif",
          "Content-Disposition": `attachment; filename="${gifName}_rotated.gif"`,
          "Content-Length": gifBuffer.length
        });
        return res.status(200).send(gifBuffer);
      }

      let sharpInstance = sharp(inputBuffer);
      if (rotate) sharpInstance = sharpInstance.rotate(rotate);
      if (flipH) sharpInstance = sharpInstance.flop();
      if (flipV) sharpInstance = sharpInstance.flip();

      const outputFormat =
        inputFormat === "png" ? "png" :
        inputFormat === "webp" ? "webp" :
        inputFormat === "avif" ? "avif" :
        isHeic ? inputFormat : // "heic" or "heif"
        "jpeg";
      if (outputFormat === "png") sharpInstance = sharpInstance.png();
      else if (outputFormat === "webp") sharpInstance = sharpInstance.webp();
      else if (outputFormat === "avif") sharpInstance = sharpInstance.avif({ quality: 75 });
      else if (isHeic) sharpInstance = sharpInstance.png({ compressionLevel: 1 }); // intermediate, re-encoded below
      else sharpInstance = sharpInstance.jpeg({ quality: 90 });

      let outputBuffer = await sharpInstance.toBuffer();

      // HEIC/HEIF: re-encode transformed image
      if (isHeic) {
        const midPath = path.join(tmpDir, "transformed.png");
        const heicOutPath = path.join(tmpDir, "final.heic");
        fs.writeFileSync(midPath, outputBuffer);
        await execFileAsync("heif-enc", ["-q", "80", "-o", heicOutPath, midPath], { timeout: 30000 });
        outputBuffer = fs.readFileSync(heicOutPath);
      }
      const ext = outputFormat === "jpeg" ? "jpg" : outputFormat;
      const originalName = req.file.originalname.replace(/\.[^.]+$/, "");

      await incrementUsage(user?.user_id, ip, tier, "image-flip-rotate", inputFormat, outputFormat, fileSizeKb, "success");

      res.set({
        "Content-Type": outputFormat === "jpeg" ? "image/jpeg" : `image/${outputFormat}`,
        "Content-Disposition": `attachment; filename="${originalName}_rotated.${ext}"`,
        "Content-Length": outputBuffer.length
      });
      return res.status(200).send(outputBuffer);

    } catch (err) {
      console.error("Flip/rotate error:", err.message, err.stderr ? err.stderr.toString() : "");
      await incrementUsage(user?.user_id, ip, tier, "image-flip-rotate", inputFormat, null, fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Operation failed.", resErrorCode: 99 });
    } finally {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
);
// ── EXIF REMOVER ───────────────────────────────────────────────────────────
router.post("/api/post/filebeef/image/exif-remove", optionalAuth, imageUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser;
    const ip = getClientIp(req);
    const tier = getTier(user);
    const limits = IMAGE_LIMITS[tier];

    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 2 });
    const nameExt = (req.file.originalname.split(".").pop() || "").toLowerCase();
    const isHeicUpload = ["heic", "heif"].includes(nameExt) || ["image/heic", "image/heif"].includes(req.file.mimetype);
    const isAvifUpload = nameExt === "avif" || req.file.mimetype === "image/avif";
    if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype) && !isHeicUpload && !isAvifUpload) return res.status(400).json({ resStatus: false, resMessage: "Unsupported file type.", resErrorCode: 3 });

    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });

    let inputFormat = req.file.mimetype.split("/")[1] || "unknown";
    if (isHeicUpload) inputFormat = nameExt === "heif" ? "heif" : "heic";
    if (isAvifUpload) inputFormat = "avif";
    const fileSizeKb = Math.round(req.file.size / 1024);

    try {
      let workBuffer = req.file.buffer;
      if (isHeicUpload) {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-exif-"));
        const inPath = path.join(tmpDir, "in." + (nameExt === "heif" ? "heif" : "heic"));
        const outPath = path.join(tmpDir, "out.jpg");
        try {
          fs.writeFileSync(inPath, req.file.buffer);
          await execFileAsync("heif-convert", ["-q", "95", inPath, outPath]);
          const altPath = path.join(tmpDir, "out-1.jpg");
          workBuffer = fs.readFileSync(fs.existsSync(outPath) ? outPath : altPath);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
      const isGif = inputFormat === "gif";

      // sharp strips EXIF by default when converting
      const outputFormat =
        inputFormat === "png" ? "png"
        : inputFormat === "webp" ? "webp"
        : inputFormat === "gif" ? "gif"
        : inputFormat === "avif" ? "avif"
        : "jpeg";
      let sharpInstance = sharp(workBuffer, isGif ? { animated: true } : {}).withMetadata(false);

      if (outputFormat === "png") sharpInstance = sharpInstance.png();
      else if (outputFormat === "webp") sharpInstance = sharpInstance.webp();
      else if (outputFormat === "gif") sharpInstance = sharpInstance.gif();
      else if (outputFormat === "avif") sharpInstance = sharpInstance.avif({ quality: 60 });
      else sharpInstance = sharpInstance.jpeg({ quality: 95 });

      const outputBuffer = await sharpInstance.toBuffer();
      const ext = outputFormat === "jpeg" ? "jpg" : outputFormat;
      const originalName = req.file.originalname.replace(/\.[^.]+$/, "");

      await incrementUsage(user?.user_id, ip, tier, "image-exif-remove", inputFormat, outputFormat, fileSizeKb, "success");

      res.set({
        "Content-Type": outputFormat === "jpeg" ? "image/jpeg" : `image/${outputFormat}`,
        "Content-Disposition": `attachment; filename="${originalName}_clean.${ext}"`,
        "Content-Length": outputBuffer.length
      });
      return res.status(200).send(outputBuffer);

    } catch (err) {
      console.error("EXIF remove error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "image-exif-remove", inputFormat, null, fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "EXIF removal failed.", resErrorCode: 99 });
    }
  }
);

// ── SVG OPTIMIZER ──────────────────────────────────────────────────────────
router.post("/api/post/filebeef/image/svg-optimize", optionalAuth, async (req, res) => {
    const user = req.filebeefUser;
    const ip = getClientIp(req);
    const tier = getTier(user);
    const sizeLimitMB = SVG_LIMITS[tier].sizeMB;

    const svgUpload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: SVG_LIMITS.pro.sizeMB * 1024 * 1024, files: 1 }
    }).single("file");

    svgUpload(req, res, async (err) => {
      if (err) return res.status(400).json({ resStatus: false, resMessage: "Upload error.", resErrorCode: 1 });
      if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded.", resErrorCode: 1 });
      if (req.file.size > sizeLimitMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${sizeLimitMB}MB.`, resErrorCode: 2 });
      if (req.file.mimetype !== "image/svg+xml" && !req.file.originalname.endsWith(".svg")) {
        return res.status(400).json({ resStatus: false, resMessage: "Please upload an SVG file.", resErrorCode: 3 });
      }

      const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
      if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });

      const fileSizeKb = Math.round(req.file.size / 1024);

      try {
        const { optimize } = await import("svgo");
        const svgString = req.file.buffer.toString("utf8");
        const result = optimize(svgString, {
          plugins: [
            { name: "preset-default" },
            { name: "removeComments" },
            { name: "removeMetadata" },
            { name: "removeTitle" },
            { name: "removeDesc" }
          ]
        });

        const outputBuffer = Buffer.from(result.data, "utf8");
        const originalName = req.file.originalname.replace(/\.[^.]+$/, "");

        await incrementUsage(user?.user_id, ip, tier, "svg-optimize", "svg", "svg", fileSizeKb, "success");

        res.set({
          "Content-Type": "image/svg+xml",
          "Content-Disposition": `attachment; filename="${originalName}_optimized.svg"`,
          "Content-Length": outputBuffer.length
        });
        return res.status(200).send(outputBuffer);

      } catch (err) {
        console.error("SVG optimize error:", err.message);
        await incrementUsage(user?.user_id, ip, tier, "svg-optimize", "svg", "svg", fileSizeKb, "failed");
        return res.status(500).json({ resStatus: false, resMessage: "SVG optimization failed.", resErrorCode: 99 });
      }
    });
  }
);

// ── IMAGE WATERMARK ────────────────────────────────────────────────────────
router.post("/api/post/filebeef/image/watermark", optionalAuth, imageUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser;
    const ip = getClientIp(req);
    const tier = getTier(user);
    const limits = IMAGE_LIMITS[tier];

    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 2 });
    const nameExt = (req.file.originalname.split(".").pop() || "").toLowerCase();
    const isHeicUpload = ["heic", "heif"].includes(nameExt) || ["image/heic", "image/heif"].includes(req.file.mimetype);
    const isAvifUpload = nameExt === "avif" || req.file.mimetype === "image/avif";
    if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype) && !isHeicUpload && !isAvifUpload) return res.status(400).json({ resStatus: false, resMessage: "Unsupported file type.", resErrorCode: 3 });

    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });

    const text = (req.body.text || "FileBeef").substring(0, 50);
    const opacity = Math.min(1, Math.max(0.1, parseFloat(req.body.opacity) || 0.4));
    const position = req.body.position || "bottom-right";
    const color = req.body.color === "black" ? "#000000" : "#ffffff";
    const WM_FONTS = {
      "arial":      "Arial",
      "times":      "Times New Roman",
      "impact":     "Impact",
      "pacifico":   "Pacifico",
      "dancing":    "Dancing Script",
      "greatvibes": "Great Vibes",
      "allura":     "Allura",
      "sacramento": "Sacramento",
      "caveat":     "Caveat Brush",
      "zendots":    "Zen Dots"
    };
    const fontFamily = WM_FONTS[(req.body.font || "").toLowerCase()] || "Arial";
    let inputFormat = req.file.mimetype.split("/")[1] || "unknown";
    if (isHeicUpload) inputFormat = nameExt === "heif" ? "heif" : "heic";
    if (isAvifUpload) inputFormat = "avif";
    const fileSizeKb = Math.round(req.file.size / 1024);

    try {
      let workBuffer = req.file.buffer;
      if (isHeicUpload) {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-wm-"));
        const inPath = path.join(tmpDir, "in." + (nameExt === "heif" ? "heif" : "heic"));
        const outPath = path.join(tmpDir, "out.jpg");
        try {
          fs.writeFileSync(inPath, req.file.buffer);
          await execFileAsync("heif-convert", ["-q", "95", inPath, outPath]);
          const altPath = path.join(tmpDir, "out-1.jpg");
          workBuffer = fs.readFileSync(fs.existsSync(outPath) ? outPath : altPath);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
      const isGif = inputFormat === "gif";
      const image = sharp(workBuffer, isGif ? { animated: true } : {});
      const meta = await image.metadata();
      const width = meta.width || 800;
      const height = (isGif ? meta.pageHeight : meta.height) || meta.height || 600;
      const fontSize = Math.max(16, Math.round(Math.min(width, height) * 0.05));
      const safeText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const opacityHex = Math.round(opacity * 255).toString(16).padStart(2, "0");
      const svgText = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <style>
            .wm { font-family: '${fontFamily}'; font-size: ${fontSize}px; fill: ${color}; fill-opacity: ${opacity}; }
          </style>
          <text
            class="wm"
            x="${position.includes("right") ? width - 20 : position.includes("center") ? width / 2 : 20}"
            y="${position.includes("bottom") ? height - 20 : position.includes("middle") ? height / 2 : 40}"
            text-anchor="${position.includes("right") ? "end" : position.includes("center") ? "middle" : "start"}"
          >${safeText}</text>
        </svg>
      `;

      const outputFormat =
        inputFormat === "png" ? "png"
        : inputFormat === "webp" ? "webp"
        : inputFormat === "gif" ? "gif"
        : inputFormat === "avif" ? "avif"
        : "jpeg";
      let sharpInstance = sharp(workBuffer, isGif ? { animated: true } : {}).composite([
        isGif
          ? { input: Buffer.from(svgText), tile: true, gravity: "northwest" }
          : { input: Buffer.from(svgText), top: 0, left: 0 }
      ]);

      if (outputFormat === "png") sharpInstance = sharpInstance.png();
      else if (outputFormat === "webp") sharpInstance = sharpInstance.webp({ quality: 90 });
      else if (outputFormat === "gif") sharpInstance = sharpInstance.gif();
      else if (outputFormat === "avif") sharpInstance = sharpInstance.avif({ quality: 60 });
      else sharpInstance = sharpInstance.jpeg({ quality: 90 });

      const outputBuffer = await sharpInstance.toBuffer();
      const ext = outputFormat === "jpeg" ? "jpg" : outputFormat;
      const originalName = req.file.originalname.replace(/\.[^.]+$/, "");

      await incrementUsage(user?.user_id, ip, tier, "image-watermark", inputFormat, outputFormat, fileSizeKb, "success");

      res.set({
        "Content-Type": outputFormat === "jpeg" ? "image/jpeg" : `image/${outputFormat}`,
        "Content-Disposition": `attachment; filename="${originalName}_watermarked.${ext}"`,
        "Content-Length": outputBuffer.length
      });
      return res.status(200).send(outputBuffer);

    } catch (err) {
      console.error("Watermark error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "image-watermark", inputFormat, null, fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Watermark failed.", resErrorCode: 99 });
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════
//  ALL PDF ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PDF_LIMITS.pro.sizeMB * 1024 * 1024, files: 1 }
});

const pdfMultiUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PDF_LIMITS.pro.sizeMB * 1024 * 1024, files: 20 }
});

function isPdf(file) {
  return file.mimetype === "application/pdf" || file.originalname?.toLowerCase().endsWith(".pdf");
}

function getPdfLimits(tier) {
  return PDF_LIMITS[tier] || PDF_LIMITS.anon;
}

// ── COMPRESS PDF ───────────────────────────────────────────────────────────
const GS_QUALITY_MAP = {
  medium: "/ebook", // 150dpi, balanced
  high: "/screen"   // 72dpi, smallest file, most quality loss
};

async function pdfLibCompress(inputBuffer) {
  const pdfDoc = await PDFDocument.load(inputBuffer, { updateMetadata: false });
  const outputBuffer = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false, compress: true });
  return Buffer.from(outputBuffer);
}

async function ghostscriptCompress(inputBuffer, preset) {
  const tmpIn = path.join(os.tmpdir(), `fb_pdfc_in_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  const tmpOut = path.join(os.tmpdir(), `fb_pdfc_out_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(tmpIn, inputBuffer);
  try {
    await new Promise((resolve, reject) => {
      execFile("gs", [
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        `-dPDFSETTINGS=${preset}`,
        "-dNOPAUSE", "-dBATCH", "-dQUIET",
        "-dPrinted=false",
        `-sOutputFile=${tmpOut}`,
        tmpIn
      ], { timeout: 60000 }, (err) => {
        if (err) { console.log("[pdf-compress] gs error:", err.message); reject(err); }
        else { resolve(); }
      });
    });
    const result = fs.readFileSync(tmpOut);
    return result;
  } finally {
    if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }
}

router.post("/api/post/filebeef/pdf/compress", optionalAuth, (req, res, next) => {
   pdfUpload.single("file")(req, res, (err) => {
    if (err?.code === "LIMIT_FILE_SIZE") { return res.status(413).json({ resStatus: false, resMessage: "File too large for upload.", resErrorCode: 3 }); }
    if (err) { console.log("[pdf-compress] multer error:", err.message); return res.status(500).json({ resStatus: false, resMessage: "Upload error.", resErrorCode: 98 }); }
    next();
  });
}, async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) { return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 }); }
    if (!isPdf(req.file)) { return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 }); }
    if (req.file.size > limits.sizeMB * 1024 * 1024) { return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 }); }
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    const quality = req.body.quality || "medium";
    try {
      const outputBuffer = quality === "low"
        ? await pdfLibCompress(req.file.buffer)
        : await ghostscriptCompress(req.file.buffer, GS_QUALITY_MAP[quality] || GS_QUALITY_MAP.medium);
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-compress", "pdf", "pdf", fileSizeKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}_compressed.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(outputBuffer);
    } catch (err) {
      await incrementUsage(user?.user_id, ip, tier, "pdf-compress", "pdf", "pdf", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Compression failed.", resErrorCode: 99 });
    }
  }
);
// ── MERGE PDF ──────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/merge", optionalAuth, pdfMultiUpload.array("files", 20), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    const files = req.files;
    if (!files || files.length < 2) return res.status(400).json({ resStatus: false, resMessage: "Please upload at least 2 PDF files.", resErrorCode: 1 });
    const maxFiles = tier === "pro" ? 20 : tier === "free" ? 10 : 3;
    if (files.length > maxFiles) return res.status(400).json({ resStatus: false, resMessage: `Max ${maxFiles} files on your plan.`, resErrorCode: 2 });
    for (const f of files) {
      if (!isPdf(f)) return res.status(400).json({ resStatus: false, resMessage: `${f.originalname} is not a PDF.`, resErrorCode: 3 });
      if (f.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `${f.originalname} is too large.`, resErrorCode: 4 });
    }
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const totalKb = Math.round(files.reduce((s, f) => s + f.size, 0) / 1024);
    try {
      const mergedDoc = await PDFDocument.create();
      for (const file of files) {
        const doc = await PDFDocument.load(file.buffer);
        const pages = await mergedDoc.copyPages(doc, doc.getPageIndices());
        pages.forEach(p => mergedDoc.addPage(p));
      }
      const outputBuffer = await mergedDoc.save();
      await incrementUsage(user?.user_id, ip, tier, "pdf-merge", "pdf", "pdf", totalKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="merged.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(Buffer.from(outputBuffer));
    } catch (err) {
      console.error("PDF merge error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-merge", "pdf", "pdf", totalKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Merge failed.", resErrorCode: 99 });
    }
  }
);

// ── SPLIT PDF  ────────────────────
router.post("/api/post/filebeef/pdf/split", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    const mode = req.body.mode || "pages";
    const rangeInput = req.body.range || "";
    try {
      const JSZip = require("jszip");
      const pdfDoc = await PDFDocument.load(req.file.buffer);
      const totalPages = pdfDoc.getPageCount();
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      const zip = new JSZip();
      if (mode === "pages") {
        for (let i = 0; i < totalPages; i++) {
          const newDoc = await PDFDocument.create();
          const [page] = await newDoc.copyPages(pdfDoc, [i]);
          newDoc.addPage(page);
          const buf = await newDoc.save();
          zip.file(`${originalName}_page_${i + 1}.pdf`, Buffer.from(buf));
        }
      } else {
        const splitRaw = rangeInput.split(",").map(r => r.trim()).filter(Boolean);
        if (!splitRaw.length) return res.status(400).json({ resStatus: false, resMessage: "Please specify at least one page range.", resErrorCode: 6 });

        const splitRequested = [];
        for (const part of splitRaw) {
          const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
          if (!m) return res.status(400).json({ resStatus: false, resMessage: `Invalid range: "${part}".`, resErrorCode: 6 });
          const rStart = parseInt(m[1]);
          const rEnd = m[2] ? parseInt(m[2]) : rStart;
          if (rStart < 1 || rEnd > totalPages || rStart > rEnd) {
            return res.status(400).json({ resStatus: false, resMessage: `Range "${part}" is outside 1-${totalPages}.`, resErrorCode: 6 });
          }
          splitRequested.push({ start: rStart, end: rEnd });
        }

        splitRequested.sort((a, b) => a.start - b.start);
        for (let i = 1; i < splitRequested.length; i++) {
          if (splitRequested[i].start <= splitRequested[i - 1].end) {
            return res.status(400).json({ resStatus: false, resMessage: "Ranges must not overlap.", resErrorCode: 6 });
          }
        }

        // full partition: the requested ranges PLUS the gaps before, between and after them
        const splitSegments = [];
        let splitCursor = 1;
        for (const r of splitRequested) {
          if (r.start > splitCursor) splitSegments.push({ start: splitCursor, end: r.start - 1 });
          splitSegments.push({ start: r.start, end: r.end });
          splitCursor = r.end + 1;
        }
        if (splitCursor <= totalPages) splitSegments.push({ start: splitCursor, end: totalPages });

        let splitPartNo = 0;
        for (const seg of splitSegments) {
          splitPartNo++;
          const newDoc = await PDFDocument.create();
          const indices = [];
          for (let i = seg.start; i <= seg.end; i++) indices.push(i - 1);
          const pages = await newDoc.copyPages(pdfDoc, indices);
          pages.forEach(p => newDoc.addPage(p));
          const buf = await newDoc.save();
          const label = seg.start === seg.end ? `page_${seg.start}` : `pages_${seg.start}-${seg.end}`;
          zip.file(`${originalName}_part${splitPartNo}_${label}.pdf`, Buffer.from(buf));
        }
      }
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
      await incrementUsage(user?.user_id, ip, tier, "pdf-split", "pdf", "pdf", fileSizeKb, "success");
      res.set({
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${originalName}_split.zip"`,
        "Content-Length": zipBuffer.length
      });
      return res.status(200).send(zipBuffer);
    } catch (err) {
      console.error("PDF split error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-split", "pdf", "pdf", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Split failed.", resErrorCode: 99 });
    }
  }
);

// ── ROTATE PDF ─────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/rotate", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const angle = parseInt(req.body.angle) || 90;
    const validAngles = [90, 180, 270];
    if (!validAngles.includes(angle)) return res.status(400).json({ resStatus: false, resMessage: "Angle must be 90, 180, or 270.", resErrorCode: 4 });
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      const pdfDoc = await PDFDocument.load(req.file.buffer);
      const pages = pdfDoc.getPages();
      for (const page of pages) page.setRotation(degrees(angle));
      const outputBuffer = await pdfDoc.save();
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-rotate", "pdf", "pdf", fileSizeKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}_rotated.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(Buffer.from(outputBuffer));
    } catch (err) {
      console.error("PDF rotate error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-rotate", "pdf", "pdf", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Rotation failed.", resErrorCode: 99 });
    }
  }
);

// ── WATERMARK PDF ──────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/watermark", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const text = (req.body.text || "CONFIDENTIAL").substring(0, 25);
    const opacity = Math.min(1, Math.max(0.05, parseFloat(req.body.opacity) || 0.3));
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      const pdfDoc = await PDFDocument.load(req.file.buffer);
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const pages = pdfDoc.getPages();
      for (const page of pages) {
        const { width, height } = page.getSize();
        const fontSize = Math.min(60, Math.max(20, width / 10));
        const textWidth = font.widthOfTextAtSize(text, fontSize);
        const textHeight = font.heightAtSize(fontSize);
        // angle of the bottom-left → top-right page diagonal
        const angleRad = Math.atan2(height, width);
        const angleDeg = angleRad * (180 / Math.PI);
        const cos = Math.cos(angleRad); const sin = Math.sin(angleRad);
        // place start point so the rotated text's center lands on the page center
        const x = width / 2 - (textWidth / 2) * cos + (textHeight / 2) * sin;
        const y = height / 2 - (textWidth / 2) * sin - (textHeight / 2) * cos;
        page.drawText(text, {
          x, y,
          size: fontSize,
          font,
          color: rgb(0.5, 0.5, 0.5),
          opacity,
          rotate: degrees(angleDeg)
        });
      }
      const outputBuffer = await pdfDoc.save();
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-watermark", "pdf", "pdf", fileSizeKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}_watermarked.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(Buffer.from(outputBuffer));
    } catch (err) {
      console.error("PDF watermark error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-watermark", "pdf", "pdf", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Watermark failed.", resErrorCode: 99 });
    }
  }
);

// ── ADD PAGE NUMBERS ───────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/page-numbers", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const position = req.body.position || "bottom-center";
    const startNumber = parseInt(req.body.startNumber) || 1;
    const style = req.body.style === "of-total" ? "of-total" : "simple";
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      const pdfDoc = await PDFDocument.load(req.file.buffer);
      pdfDoc.registerFontkit(fontkit);
      const requestedFont = (req.body.font || "default").toLowerCase();
      let fontPath = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
      if (EDITOR_FONT_FILES[requestedFont] && fs.existsSync(EDITOR_FONT_FILES[requestedFont].regular)) {
        fontPath = EDITOR_FONT_FILES[requestedFont].regular;
      }
      const fontBytes = fs.readFileSync(fontPath);
      const font = await pdfDoc.embedFont(fontBytes, { subset: true });
      const pages = pdfDoc.getPages();
      const fontSize = 10;
      const margin = 20;
      const lastNumber = startNumber + pages.length - 1;
      pages.forEach((page, idx) => {
        const { width, height } = page.getSize();
        const text = style === "of-total" ? `${startNumber + idx}/${lastNumber}` : String(startNumber + idx);
        const textWidth = font.widthOfTextAtSize(text, fontSize);
        let x, y;
        if (position === "bottom-center") { x = (width - textWidth) / 2; y = margin; }
        else if (position === "bottom-right") { x = width - textWidth - margin; y = margin; }
        else if (position === "bottom-left") { x = margin; y = margin; }
        else if (position === "top-center") { x = (width - textWidth) / 2; y = height - margin - fontSize; }
        else if (position === "top-right") { x = width - textWidth - margin; y = height - margin - fontSize; }
        else { x = margin; y = height - margin - fontSize; }
        page.drawText(text, { x, y, size: fontSize, font, color: rgb(0.3, 0.3, 0.3) });
      });
      const outputBuffer = await pdfDoc.save();
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-page-numbers", "pdf", "pdf", fileSizeKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}_numbered.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(Buffer.from(outputBuffer));
    } catch (err) {
      console.error("PDF page numbers error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-page-numbers", "pdf", "pdf", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Failed to add page numbers.", resErrorCode: 99 });
    }
  }
);

// ── PROTECT PDF ────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/protect", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const password = req.body.password;
    if (!password || password.length < 4) return res.status(400).json({ resStatus: false, resMessage: "Password must be at least 4 characters.", resErrorCode: 4 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      const jobId = `protect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const inputPath = path.join(os.tmpdir(), `${jobId}_in.pdf`);
      const outputPath = path.join(os.tmpdir(), `${jobId}_out.pdf`);
      fs.writeFileSync(inputPath, req.file.buffer);
      try {
        await new Promise((resolve, reject) => {
          execFile(
            "qpdf",
            ["--encrypt", password, password + "_owner", "256", "--print=full", "--modify=none", "--extract=n", "--", inputPath, outputPath],
            { timeout: 60000 },
            (err) => err ? reject(err) : resolve()
          );
        });
        var outputBuffer = fs.readFileSync(outputPath);
      } finally {
        try { fs.unlinkSync(inputPath); } catch (e) {}
        try { fs.unlinkSync(outputPath); } catch (e) {}
      }
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-protect", "pdf", "pdf", fileSizeKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}_protected.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(Buffer.from(outputBuffer));
    } catch (err) {
      console.error("PDF protect error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-protect", "pdf", "pdf", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Protection failed.", resErrorCode: 99 });
    }
  }
);

// ── UNLOCK PDF ─────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/unlock", ipDailyLimit("unlock", 30), optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const password = req.body.password || "";
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      const jobId = `unlock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const inputPath = path.join(os.tmpdir(), `${jobId}_in.pdf`);
      const outputPath = path.join(os.tmpdir(), `${jobId}_out.pdf`);
      fs.writeFileSync(inputPath, req.file.buffer);
      try {
        const isEncrypted = await new Promise((resolve) => {
          execFile("qpdf", ["--is-encrypted", inputPath], { timeout: 15000 }, (err) => {
            resolve(!err); // exit 0 = encrypted, exit 2 = not encrypted
          });
        });
        if (!isEncrypted) {
          return res.status(400).json({ resStatus: false, resMessage: "This PDF is not password protected — nothing to unlock.", resErrorCode: 8 });
        }
        await new Promise((resolve, reject) => {
          execFile(
            "qpdf",
            [`--password=${password}`, "--decrypt", inputPath, outputPath],
            { timeout: 60000 },
            (err, stdout, stderr) => {
              if (err) {
                if ((stderr || "").includes("invalid password")) return reject(new Error("WRONG_PASSWORD"));
                if (err.code === 3) return resolve(); // qpdf: succeeded with warnings
                return reject(err);
              }
              resolve();
            }
          );
        });
        var outputBuffer = fs.readFileSync(outputPath);
      } finally {
        try { fs.unlinkSync(inputPath); } catch (e) {}
        try { fs.unlinkSync(outputPath); } catch (e) {}
      }
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-unlock", "pdf", "pdf", fileSizeKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}_unlocked.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(Buffer.from(outputBuffer));
    } catch (err) {
      if (err.message === "WRONG_PASSWORD") {
        return res.status(400).json({ resStatus: false, resMessage: "Incorrect password.", resErrorCode: 6 });
      }
      console.error("PDF unlock error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-unlock", "pdf", "pdf", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Unlock failed.", resErrorCode: 99 });
    }
  }
);

// ── FLATTEN PDF ────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/flatten", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      const pdfDoc = await PDFDocument.load(req.file.buffer);
      const form = pdfDoc.getForm();
      try { form.flatten(); } catch (_) { /* no form fields — still valid */ }
      const outputBuffer = await pdfDoc.save();
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-flatten", "pdf", "pdf", fileSizeKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}_flattened.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(Buffer.from(outputBuffer));
    } catch (err) {
      console.error("PDF flatten error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-flatten", "pdf", "pdf", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Flatten failed.", resErrorCode: 99 });
    }
  }
);

// ── PDF GRAYSCALE ──────────────────────────────────────────────────────────
// Note: true grayscale requires rendering each page as image then rebuilding
// This approach uses pdf-lib to embed grayscale-converted page images
router.post("/api/post/filebeef/pdf/grayscale", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      const tmpIn = path.join(os.tmpdir(), `fb_gray_in_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
      const tmpOut = path.join(os.tmpdir(), `fb_gray_out_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
      await fs.promises.writeFile(tmpIn, req.file.buffer);
      await new Promise((resolve, reject) => {
        execFile("gs", [
          "-sDEVICE=pdfwrite",
          "-sColorConversionStrategy=Gray",
          "-dProcessColorModel=/DeviceGray",
          "-dCompatibilityLevel=1.4",
          "-dNOPAUSE", "-dBATCH", "-dQUIET",
          `-sOutputFile=${tmpOut}`,
          tmpIn
        ], { timeout: 120000 }, (err) => err ? reject(err) : resolve());
      });
      const outputBuffer = await fs.promises.readFile(tmpOut);
      await fs.promises.unlink(tmpIn).catch(() => {});
      await fs.promises.unlink(tmpOut).catch(() => {});
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-grayscale", "pdf", "pdf", fileSizeKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}_grayscale.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(Buffer.from(outputBuffer));
    } catch (err) {
      console.error("PDF grayscale error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-grayscale", "pdf", "pdf", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Grayscale conversion failed.", resErrorCode: 99 });
    }
  }
);

// ── PDF TO TEXT ────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/to-text", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    let parser = null;
    try {
      const { PDFParse } = require("pdf-parse");
      parser = new PDFParse({ data: new Uint8Array(req.file.buffer) });
      const result = await parser.getText();
      const textBuffer = Buffer.from(result.text, "utf8");
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-to-text", "pdf", "txt", fileSizeKb, "success");
      res.set({ "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${originalName}.txt"`, "Content-Length": textBuffer.length });
      return res.status(200).send(textBuffer);
    } catch (err) {
      console.error("PDF to text error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-to-text", "pdf", "txt", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Text extraction failed.", resErrorCode: 99 });
    } finally {
      if (parser) { try { await parser.destroy(); } catch (e) {} }
    }
  }
);

// ── PDF EDIT METADATA ──────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/metadata", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      const pdfDoc = await PDFDocument.load(req.file.buffer);
      if (req.body.title !== undefined) pdfDoc.setTitle(req.body.title);
      if (req.body.author !== undefined) pdfDoc.setAuthor(req.body.author);
      if (req.body.subject !== undefined) pdfDoc.setSubject(req.body.subject);
      if (req.body.keywords !== undefined) pdfDoc.setKeywords(req.body.keywords.split(",").map(k => k.trim()).filter(Boolean));
      if (req.body.creator !== undefined) pdfDoc.setCreator(req.body.creator);
      if (req.body.producer !== undefined) pdfDoc.setProducer(req.body.producer);
      if (req.body.creationDate) { const cd = new Date(req.body.creationDate); if (!isNaN(cd)) pdfDoc.setCreationDate(cd); }
      pdfDoc.setModificationDate(new Date());
      const outputBuffer = await pdfDoc.save();
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-metadata", "pdf", "pdf", fileSizeKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}_updated.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(Buffer.from(outputBuffer));
    } catch (err) {
      console.error("PDF metadata error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-metadata", "pdf", "pdf", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Metadata update failed.", resErrorCode: 99 });
    }
  }
);

// ── PDF REPAIR ─────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/repair", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      const tmpIn = path.join(os.tmpdir(), `fb_repair_in_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
      const tmpOut = path.join(os.tmpdir(), `fb_repair_out_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
      await fs.promises.writeFile(tmpIn, req.file.buffer);
      const runRepair = (cmd, args) => new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: 120000 }, (err) => err ? reject(err) : resolve());
      });
const outputOk = async () => {
        try {
          const buf = await fs.promises.readFile(tmpOut);
          if (buf.length < 100) return false;
          await PDFDocument.load(buf, { ignoreEncryption: true });
          return true;
        } catch (e) { return false; }
      };
      await runRepair("qpdf", [tmpIn, tmpOut]).catch(() => {});
      if (!(await outputOk())) {
        await fs.promises.unlink(tmpOut).catch(() => {});
        let mutoolExitOk = true;
        await runRepair("mutool", ["clean", tmpIn, tmpOut]).catch(() => { mutoolExitOk = false; });
        if (mutoolExitOk) {
          const st = await fs.promises.stat(tmpOut).catch(() => null);
          if (!st || st.size < 100) mutoolExitOk = false;
        }
        if (!mutoolExitOk) {
          await fs.promises.unlink(tmpOut).catch(() => {});
          await runRepair("gs", ["-o", tmpOut, "-sDEVICE=pdfwrite", "-dPDFSTOPONERROR=false", "-dNOPAUSE", "-dBATCH", "-dQUIET", tmpIn]).catch(() => {});
          if (!(await outputOk())) throw new Error("Repair failed — file too corrupted");
        }
      }
      const outputBuffer = await fs.promises.readFile(tmpOut);
      await fs.promises.unlink(tmpIn).catch(() => {});
      await fs.promises.unlink(tmpOut).catch(() => {});
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-repair", "pdf", "pdf", fileSizeKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}_repaired.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(Buffer.from(outputBuffer));
    } catch (err) {
      console.error("PDF repair error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-repair", "pdf", "pdf", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Could not repair this PDF. The file may be too corrupted.", resErrorCode: 99 });
    }
  }
);

// ── IMAGE TO PDF ───────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/image-to-pdf", optionalAuth, ipDailyLimit("image-to-pdf", 7), pdfMultiUpload.array("files", 20), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (tier !== "pro") return res.status(403).json({ resStatus: false, resMessage: "Image to PDF is a Pro feature. Upgrade to use this tool.", resErrorCode: 7, proRequired: true });
    const files = req.files;
    if (!files || !files.length) return res.status(400).json({ resStatus: false, resMessage: "No files uploaded.", resErrorCode: 1 });
    const allowedImageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
    const heicExt = (name) => /\.(heic|heif)$/i.test(name || "");
    for (const f of files) {
      if (!allowedImageTypes.includes(f.mimetype) && !heicExt(f.originalname)) return res.status(400).json({ resStatus: false, resMessage: `${f.originalname} is not a supported image.`, resErrorCode: 2 });
      if (f.size > 7 * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `${f.originalname} is too large.`, resErrorCode: 3 });
    }
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const totalKb = Math.round(files.reduce((s, f) => s + f.size, 0) / 1024);
    try {
      const pdfDoc = await PDFDocument.create();
      const isHeic = (f) => /\.(heic|heif)$/i.test(f.originalname || "") || ["image/heic", "image/heif"].includes(f.mimetype);
      for (const file of files) {
        let srcBuffer = file.buffer;
        if (isHeic(file)) {
          const tmpH = path.join(os.tmpdir(), `fb_heic_${Date.now()}_${Math.random().toString(36).slice(2)}`);
          await fs.promises.writeFile(tmpH + ".heic", file.buffer);
          await new Promise((resolve, reject) => {
            execFile("heif-convert", [tmpH + ".heic", tmpH + ".jpg"], { timeout: 60000 }, (err) => err ? reject(err) : resolve());
          });
          srcBuffer = await fs.promises.readFile(tmpH + ".jpg");
          await fs.promises.unlink(tmpH + ".heic").catch(() => {});
          await fs.promises.unlink(tmpH + ".jpg").catch(() => {});
        }
        // convert all to jpeg first for consistency
        const jpegBuffer = await sharp(srcBuffer).rotate().resize(2400, 2400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
        const image = await pdfDoc.embedJpg(jpegBuffer);
        const { width, height } = image.scale(1);
        // fit to A4 if larger
        const maxW = 595, maxH = 842;
        const scale = Math.min(1, maxW / width, maxH / height);
        const scaledW = width * scale;
        const scaledH = height * scale;
        const page = pdfDoc.addPage([scaledW, scaledH]);
        page.drawImage(image, { x: 0, y: 0, width: scaledW, height: scaledH });
      }
      const outputBuffer = await pdfDoc.save();
      await incrementUsage(user?.user_id, ip, tier, "image-to-pdf", "image", "pdf", totalKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="images.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(Buffer.from(outputBuffer));
    } catch (err) {
      console.error("Image to PDF error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "image-to-pdf", "image", "pdf", totalKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
    }
  }
);

// ── HTML TO PDF ────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/html-to-pdf", optionalAuth, async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    // accepts either a file upload or a URL
    const htmlUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limits.sizeMB * 1024 * 1024, files: 1 } }).single("file");
    htmlUpload(req, res, async (err) => {
      if (err) return res.status(400).json({ resStatus: false, resMessage: `Upload error. Max ${limits.sizeMB}MB.`, resErrorCode: 1 });
      const url = req.body.url;
      if (!req.file && !url) return res.status(400).json({ resStatus: false, resMessage: "Please upload an HTML file or provide a URL.", resErrorCode: 1 });
      if (req.file && req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 2 });
      const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
      if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
      const fileSizeKb = req.file ? Math.round(req.file.size / 1024) : 0;
      try {
        const puppeteer = require("puppeteer");
        const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
        const page = await browser.newPage();
        if (req.file) {
          const html = req.file.buffer.toString("utf8");
          await page.setContent(html, { waitUntil: "networkidle0" });
        } else {
          await page.goto(url, { waitUntil: "networkidle0", timeout: 15000 });
        }
        const pdfBuffer = Buffer.from(await page.pdf({ format: "A4", margin: { top: "15mm", bottom: "15mm", left: "15mm", right: "15mm" }, printBackground: true }));
        await browser.close();
        const filename = req.file ? req.file.originalname.replace(/\.html?$/i, "") + ".pdf" : "webpage.pdf";
        await incrementUsage(user?.user_id, ip, tier, "html-to-pdf", "html", "pdf", fileSizeKb, "success");
        res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Content-Length": pdfBuffer.length });
        return res.status(200).send(pdfBuffer);
      } catch (err) {
        console.error("HTML to PDF error:", err.message);
        await incrementUsage(user?.user_id, ip, tier, "html-to-pdf", "html", "pdf", fileSizeKb, "failed");
        return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
      }
    });
  }
);

// ── PDF TO JPG ─────────────────────────────────────────────────────────────
// Uses puppeteer to render pages as images
// ── PDF TO JPG (fixed — uses jszip instead of archiver) ───────────────────
router.post("/api/post/filebeef/pdf/to-jpg", optionalAuth, ipDailyLimit("pdf-to-jpg", 3), pdfUpload.single("file"), async (req, res) => {
  const user = req.filebeefUser; const ip = getClientIp(req);
  const tier = getTier(user); const limits = getPdfLimits(tier);
  if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
  if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
  if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
  if (tier !== "pro") return res.status(403).json({ resStatus: false, resMessage: "PDF to JPG is a Pro feature. Upgrade to unlock.", resErrorCode: 6, proRequired: true, tier });
  const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
  if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
  const fileSizeKb = Math.round(req.file.size / 1024);
  try {
    const JSZip = require("jszip");
    const pdfDoc = await PDFDocument.load(req.file.buffer);
    const totalPages = pdfDoc.getPageCount();
    const originalName = req.file.originalname.replace(/\.pdf$/i, "");
    const pagesToRender = Math.min(totalPages, 50);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-pdf2jpg-"));
    try {
      const inPath = path.join(tmpDir, "in.pdf");
      fs.writeFileSync(inPath, req.file.buffer);
      await execFileAsync("mutool", ["draw", "-r", "100", "-o", path.join(tmpDir, "page_%d.jpg"), inPath, `1-${pagesToRender}`]);

      if (pagesToRender === 1) {
        const jpg = fs.readFileSync(path.join(tmpDir, "page_1.jpg"));
        await incrementUsage(user?.user_id, ip, tier, "pdf-to-jpg", "pdf", "jpg", fileSizeKb, "success");
        res.set({ "Content-Type": "image/jpeg", "Content-Disposition": `attachment; filename="${originalName}.jpg"`, "Content-Length": jpg.length });
        return res.status(200).send(jpg);
      } else {
        const zip = new JSZip();
        for (let i = 1; i <= pagesToRender; i++) {
          zip.file(`${originalName}_page_${i}.jpg`, fs.readFileSync(path.join(tmpDir, `page_${i}.jpg`)));
        }
        const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
        await incrementUsage(user?.user_id, ip, tier, "pdf-to-jpg", "pdf", "jpg", fileSizeKb, "success");
        res.set({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${originalName}_pages.zip"`, "Content-Length": zipBuffer.length });
        return res.status(200).send(zipBuffer);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

  } catch (err) {
    console.error("PDF to JPG error:", err.message);
    await incrementUsage(user?.user_id, ip, tier, "pdf-to-jpg", "pdf", "jpg", fileSizeKb, "failed");
    if (!res.headersSent) return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
  }
});
// ── GET PDF INFO ───────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/info", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    try {
      const pdfDoc = await PDFDocument.load(req.file.buffer);
      const headerMatch = req.file.buffer.slice(0, 20).toString("latin1").match(/%PDF-(\d\.\d)/);
      const firstPage = pdfDoc.getPageCount() > 0 ? pdfDoc.getPage(0) : null;
      const pageSize = firstPage ? `${(firstPage.getWidth() / 72).toFixed(2)} x ${(firstPage.getHeight() / 72).toFixed(2)} in` : null;
      let creationDate = null;
      try { const cd = pdfDoc.getCreationDate(); if (cd) creationDate = cd.toISOString(); } catch (e) {}
      return res.status(200).json({ resStatus: true, resOkCode: 1, pageCount: pdfDoc.getPageCount(), title: pdfDoc.getTitle() || null, author: pdfDoc.getAuthor() || null, subject: pdfDoc.getSubject() || null, keywords: pdfDoc.getKeywords() || null, creator: pdfDoc.getCreator() || null, producer: pdfDoc.getProducer() || null, creationDate, pdfVersion: headerMatch ? headerMatch[1] : null, pageSize });  
    } catch (err) {
      return res.status(500).json({ resStatus: false, resMessage: "Could not read PDF.", resErrorCode: 99 });
    }
  }
);

// ── DELETE PDF PAGES ───────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/delete-pages", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, 
      resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const pagesToDelete = (req.body.pages || "").split(",").map(p => parseInt(p.trim())).filter(p => !isNaN(p) && p > 0);
    if (!pagesToDelete.length) return res.status(400).json({ resStatus: false, resMessage: "Please specify pages to delete.", resErrorCode: 4 });
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      const pdfDoc = await PDFDocument.load(req.file.buffer);
      const totalPages = pdfDoc.getPageCount();
      if (pagesToDelete.some(p => p > totalPages)) return res.status(400).json({ resStatus: false, resMessage: `PDF only has ${totalPages} pages.`, resErrorCode: 6 });
      if (pagesToDelete.length >= totalPages) return res.status(400).json({ resStatus: false, resMessage: "Cannot delete all pages.", resErrorCode: 7 });
      const sortedDesc = [...pagesToDelete].sort((a, b) => b - a);
      for (const page of sortedDesc) pdfDoc.removePage(page - 1);
      const outputBuffer = await pdfDoc.save();
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-delete-pages", "pdf", "pdf", fileSizeKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}_deleted.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(Buffer.from(outputBuffer));
    } catch (err) {
      console.error("PDF delete pages error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-delete-pages", "pdf", "pdf", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Failed to delete pages.", resErrorCode: 99 });
    }
  }
);

// ── EXTRACT PDF PAGES ──────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/extract-pages", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const pagesInput = req.body.pages || "";
    if (!pagesInput) return res.status(400).json({ resStatus: false, resMessage: "Please specify pages to extract.", resErrorCode: 4 });
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      const pdfDoc = await PDFDocument.load(req.file.buffer);
      const totalPages = pdfDoc.getPageCount();
      const pageSet = new Set();
      for (const part of pagesInput.split(",")) {
        const trimmed = part.trim();
        if (trimmed.includes("-")) {
          const [start, end] = trimmed.split("-").map(p => parseInt(p));
          for (let i = start; i <= end; i++) pageSet.add(i);
        } else { pageSet.add(parseInt(trimmed)); }
      }
      const pages = [...pageSet].filter(p => !isNaN(p) && p > 0 && p <= totalPages).sort((a, b) => a - b);
      if (!pages.length) return res.status(400).json({ resStatus: false, resMessage: "No valid pages specified.", resErrorCode: 6 });
      const newDoc = await PDFDocument.create();
      const copiedPages = await newDoc.copyPages(pdfDoc, pages.map(p => p - 1));
      copiedPages.forEach(page => newDoc.addPage(page));
      const outputBuffer = await newDoc.save();
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-extract-pages", "pdf", "pdf", fileSizeKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}_extracted.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(Buffer.from(outputBuffer));
    } catch (err) {
      console.error("PDF extract pages error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-extract-pages", "pdf", "pdf", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Failed to extract pages.", resErrorCode: 99 });
    }
  }
);

// ── ORGANIZE PDF ───────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/organize", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const orderInput = req.body.order || "";
    if (!orderInput) return res.status(400).json({ resStatus: false, resMessage: "Please specify page order.", resErrorCode: 4 });
    const newOrder = orderInput.split(",").map(p => parseInt(p.trim())).filter(p => !isNaN(p) && p > 0);
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      const pdfDoc = await PDFDocument.load(req.file.buffer);
      const totalPages = pdfDoc.getPageCount();
      if (newOrder.some(p => p > totalPages)) return res.status(400).json({ resStatus: false, resMessage: `PDF only has ${totalPages} pages.`, resErrorCode: 6 });
      const newDoc = await PDFDocument.create();
      const copiedPages = await newDoc.copyPages(pdfDoc, newOrder.map(p => p - 1));
      copiedPages.forEach(page => newDoc.addPage(page));
      const outputBuffer = await newDoc.save();
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-organize", "pdf", "pdf", fileSizeKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}_organized.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(Buffer.from(outputBuffer));
    } catch (err) {
      console.error("PDF organize error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-organize", "pdf", "pdf", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Failed to organize PDF.", resErrorCode: 99 });
    }
  }
);

// ── CROP PDF ───────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/crop", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const top = parseFloat(req.body.top) || 0;
    const bottom = parseFloat(req.body.bottom) || 0;
    const left = parseFloat(req.body.left) || 0;
    const right = parseFloat(req.body.right) || 0;
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      const pdfDoc = await PDFDocument.load(req.file.buffer);
      const pages = pdfDoc.getPages();
      for (const page of pages) {
        const { width, height } = page.getSize();
        const cropW = width - left - right;
        const cropH = height - top - bottom;
        if (cropW < 36 || cropH < 36) {
          return res.status(400).json({ resStatus: false, resMessage: "Crop values too large — nothing would be left of the page.", resErrorCode: 6 });
        }
        page.setCropBox(left, bottom, cropW, cropH);
      }
      const outputBuffer = await pdfDoc.save();
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-crop", "pdf", "pdf", fileSizeKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}_cropped.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(Buffer.from(outputBuffer));
    } catch (err) {
      console.error("PDF crop error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-crop", "pdf", "pdf", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Crop failed.", resErrorCode: 99 });
    }
  }
);

// ── TXT TO PDF ─────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/txt-to-pdf", optionalAuth, async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user);
    const txtUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single("file");
    txtUpload(req, res, async (err) => {
      if (err) return res.status(400).json({ resStatus: false, resMessage: "Upload error.", resErrorCode: 1 });
      if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded.", resErrorCode: 1 });
      if (!req.file.originalname.match(/\.txt$/i)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a .txt file.", resErrorCode: 2 });
      const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
      if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
      const fileSizeKb = Math.round(req.file.size / 1024);
      try {
        const text = req.file.buffer.toString("utf8").replace(/\r/g, "").replace(/\t/g, "    ");
        const pdfDoc = await PDFDocument.create();
        pdfDoc.registerFontkit(fontkit);
        const fontBytes = fs.readFileSync("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");
        const font = await pdfDoc.embedFont(fontBytes, { subset: true });
        const fontSize = 12; const margin = 50; const lineHeight = fontSize * 1.4;
        const pageWidth = 595; const pageHeight = 842;
        const maxWidth = pageWidth - margin * 2;
        const maxLinesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight);
        const rawLines = text.split("\n");
        const wrappedLines = [];
        for (const line of rawLines) {
          if (!line.trim()) { wrappedLines.push(""); continue; }
          let current = "";
          for (const word of line.split(" ")) {
            const test = current ? current + " " + word : word;
            if (font.widthOfTextAtSize(test, fontSize) > maxWidth && current) { wrappedLines.push(current); current = word; }
            else current = test;
          }
          if (current) wrappedLines.push(current);
        }
        let page = pdfDoc.addPage([pageWidth, pageHeight]);
        let y = pageHeight - margin; let lineCount = 0;
        for (const line of wrappedLines) {
          if (lineCount >= maxLinesPerPage) { page = pdfDoc.addPage([pageWidth, pageHeight]); y = pageHeight - margin; lineCount = 0; }
          if (line) page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
          y -= lineHeight; lineCount++;
        }
        const outputBuffer = await pdfDoc.save();
        const originalName = req.file.originalname.replace(/\.txt$/i, "");
        await incrementUsage(user?.user_id, ip, tier, "txt-to-pdf", "txt", "pdf", fileSizeKb, "success");
        res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}.pdf"`, "Content-Length": outputBuffer.length });
        return res.status(200).send(Buffer.from(outputBuffer));
      } catch (err) {
        console.error("TXT to PDF error:", err.message);
        await incrementUsage(user?.user_id, ip, tier, "txt-to-pdf", "txt", "pdf", fileSizeKb, "failed");
        return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
      }
    });
  }
);

// ── EXCEL TO PDF ───────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/excel-to-pdf", optionalAuth, async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    const xlsxUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limits.sizeMB * 1024 * 1024, files: 1 } }).single("file");
    xlsxUpload(req, res, async (err) => {
      if (err) return res.status(400).json({ resStatus: false, resMessage: "Upload error.", resErrorCode: 1 });
      if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded.", resErrorCode: 1 });
      if (!req.file.originalname.match(/\.(xlsx|xls)$/i)) return res.status(400).json({ resStatus: false, resMessage: "Please upload an Excel file.", resErrorCode: 2 });
      const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
      if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
      const fileSizeKb = Math.round(req.file.size / 1024);
      try {
        const ext = req.file.originalname.match(/\.xls$/i) ? "xls" : "xlsx";
        const tmpIn = path.join(os.tmpdir(), `fb_excel_${Date.now()}.${ext}`);
        fs.writeFileSync(tmpIn, req.file.buffer);
        await execFileAsync("libreoffice", ["--headless", "--convert-to", "pdf", "--outdir", os.tmpdir(), tmpIn]);
        const tmpOut = tmpIn.replace(/\.(xlsx|xls)$/i, ".pdf");
        const outputBuffer = fs.readFileSync(tmpOut);
        fs.unlinkSync(tmpIn);
        fs.unlinkSync(tmpOut);
        const originalName = req.file.originalname.replace(/\.(xlsx|xls)$/i, "");
        await incrementUsage(user?.user_id, ip, tier, "excel-to-pdf", "xlsx", "pdf", fileSizeKb, "success");
        res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}.pdf"`, "Content-Length": outputBuffer.length });
        return res.status(200).send(outputBuffer);
      } catch (err) {
        console.error("Excel to PDF error:", err.message);
        await incrementUsage(user?.user_id, ip, tier, "excel-to-pdf", "xlsx", "pdf", fileSizeKb, "failed");
        return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
      }
    });
  }
);

// ── PDF OCR ────────────────────────────────────────────────────────────────
// Makes scanned PDFs searchable by adding an invisible text layer (ocrmypdf)
router.post("/api/post/filebeef/pdf/ocr", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    if (tier !== "pro") return res.status(403).json({ resStatus: false, resMessage: "OCR is a Pro feature. Upgrade to Pro to use it.", resErrorCode: 4, limitReached: false, proOnly: true });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    const jobId = `ocr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const inputPath = path.join(os.tmpdir(), `${jobId}_in.pdf`);
    const outputPath = path.join(os.tmpdir(), `${jobId}_out.pdf`);
    try {
      fs.writeFileSync(inputPath, req.file.buffer);
      // --skip-text: leaves pages that already contain text untouched
      // --optimize 1: light lossless optimization, keeps output size sane
      await new Promise((resolve, reject) => {
        execFile(
          "ocrmypdf",
          ["--skip-text", "--optimize", "1", "--language", "eng", inputPath, outputPath],
          { timeout: 180000, maxBuffer: 10 * 1024 * 1024 },
          (err, stdout, stderr) => {
            if (err) {
              // exit code 6 = every page already has text (nothing to OCR)
              if (err.code === 6) return reject(new Error("ALREADY_HAS_TEXT"));
              console.error("ocrmypdf stderr:", stderr);
              return reject(err);
            }
            resolve();
          }
        );
      });
      const outputBuffer = fs.readFileSync(outputPath);
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-ocr", "pdf", "pdf", fileSizeKb, "success");
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}_ocr.pdf"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(outputBuffer);
    } catch (err) {
      console.error("PDF OCR error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-ocr", "pdf", "pdf", fileSizeKb, "failed");
      if (err.message === "ALREADY_HAS_TEXT") {
        return res.status(400).json({ resStatus: false, resMessage: "This PDF already contains searchable text — no OCR needed.", resErrorCode: 6 });
      }
      if (err.killed || err.signal === "SIGTERM") {
        return res.status(400).json({ resStatus: false, resMessage: "OCR timed out. Try a smaller PDF.", resErrorCode: 7 });
      }
      return res.status(500).json({ resStatus: false, resMessage: "OCR failed.", resErrorCode: 99 });
    } finally {
      try { fs.unlinkSync(inputPath); } catch (e) {}
      try { fs.unlinkSync(outputPath); } catch (e) {}
    }
  }
);

// ── PDF TO WORD ────────────────────────────────────────────────────────────
// Extracts text from PDF and creates a .docx — basic, not layout-preserving
// ── WORD TO PDF ────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/word-to-pdf", optionalAuth, async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    const wordUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limits.sizeMB * 1024 * 1024, files: 1 } }).single("file");
    wordUpload(req, res, async (err) => {
      if (err) return res.status(400).json({ resStatus: false, resMessage: "Upload error.", resErrorCode: 1 });
      if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded.", resErrorCode: 1 });
      if (!req.file.originalname.match(/\.(docx|doc)$/i)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a .docx or .doc file.", resErrorCode: 2 });
      const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
      if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
      const fileSizeKb = Math.round(req.file.size / 1024);
      try {
        const { execFile } = require("child_process");
        const ext = req.file.originalname.match(/\.doc$/i) ? "doc" : "docx";
        const tmpIn = path.join(os.tmpdir(), `fb_word_${Date.now()}.${ext}`);
        fs.writeFileSync(tmpIn, req.file.buffer);
        await new Promise((resolve, reject) => {
          execFile("libreoffice", ["--headless", "--convert-to", "pdf", "--outdir", os.tmpdir(), tmpIn], (err) => {
            if (err) reject(err); else resolve();
          });
        });
        const tmpOut = tmpIn.replace(/\.(docx|doc)$/i, ".pdf");
        const outputBuffer = fs.readFileSync(tmpOut);
        fs.unlinkSync(tmpIn);
        fs.unlinkSync(tmpOut);
        const originalName = req.file.originalname.replace(/\.(docx|doc)$/i, "");
        await incrementUsage(user?.user_id, ip, tier, "word-to-pdf", "docx", "pdf", fileSizeKb, "success");
        res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}.pdf"`, "Content-Length": outputBuffer.length });
        return res.status(200).send(outputBuffer);
      } catch (err) {
        console.error("Word to PDF error:", err.message);
        await incrementUsage(user?.user_id, ip, tier, "word-to-pdf", "docx", "pdf", fileSizeKb, "failed");
        return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
      }
    });
  }
);

// ── PDF TO EXCEL ───────────────────────────────────────────────────────────
// Extracts text from PDF, attempts to detect table-like rows, outputs .xlsx
router.post("/api/post/filebeef/pdf/to-excel", optionalAuth, pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    if (tier !== "pro") return res.status(403).json({ resStatus: false, resMessage: "PDF to Excel is a Pro feature.", resErrorCode: 4, proOnly: true });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      const JSZip = require("jszip");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-pdf2xls-"));
      let raw;
      try {
        const inPath = path.join(tmpDir, "in.pdf");
        const txtPath = path.join(tmpDir, "out.txt");
        fs.writeFileSync(inPath, req.file.buffer);
        await execFileAsync("mutool", ["draw", "-F", "text", "-o", txtPath, inPath]);
        raw = fs.readFileSync(txtPath, "utf8");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }

      if (!raw.trim()) {
        await incrementUsage(user?.user_id, ip, tier, "pdf-to-excel", "pdf", "xlsx", fileSizeKb, "failed");
        return res.status(400).json({ resStatus: false, resMessage: "No text found in this PDF. It may be scanned — try the OCR tool first.", resErrorCode: 7 });
      }

      const lines = raw.replace(/\f/g, "\n").split(/\r?\n/).filter(l => l.trim());
      const rows = lines.map(line => line.split(/\s{2,}/).map(cell => cell.trim()));

      const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const colLetter = n => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
      const sheetRows = rows.map((cells, r) =>
        `<row r="${r + 1}">` + cells.map((cell, c) =>
          `<c r="${colLetter(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(cell)}</t></is></c>`
        ).join("") + `</row>`
      ).join("");

      const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
      const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
      const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
      const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
      const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

      const zip = new JSZip();
      zip.file("[Content_Types].xml", contentTypes);
      zip.file("_rels/.rels", rootRels);
      zip.file("xl/workbook.xml", workbookXml);
      zip.file("xl/_rels/workbook.xml.rels", workbookRels);
      zip.file("xl/worksheets/sheet1.xml", sheetXml);
      const xlsxBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-to-excel", "pdf", "xlsx", fileSizeKb, "success");
      res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${originalName}.xlsx"`, "Content-Length": xlsxBuffer.length });
      return res.status(200).send(xlsxBuffer);
    } catch (err) {
      console.error("PDF to Excel error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-to-excel", "pdf", "xlsx", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
    }
  }
);
// ── PDF TO WORD ────────────────────────────────────────────────────────────
// Extracts text with mutool, builds a minimal .docx with jszip. Pro only.
router.post("/api/post/filebeef/pdf/to-word", optionalAuth, pdfUpload.single("file"), async (req, res) => {
  const user = req.filebeefUser; const ip = getClientIp(req);
  const tier = getTier(user); const limits = getPdfLimits(tier);
  if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
  if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
  if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
  if (tier !== "pro") return res.status(403).json({ resStatus: false, resMessage: "PDF to Word is a Pro feature. Upgrade to unlock.", resErrorCode: 6, proRequired: true, tier });
  const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
  if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
  const fileSizeKb = Math.round(req.file.size / 1024);
  try {
    const JSZip = require("jszip");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-pdf2word-"));
    try {
      const inPath = path.join(tmpDir, "in.pdf");
      const txtPath = path.join(tmpDir, "out.txt");
      fs.writeFileSync(inPath, req.file.buffer);
      await execFileAsync("mutool", ["draw", "-F", "text", "-o", txtPath, inPath]);
      const raw = fs.readFileSync(txtPath, "utf8");

      if (!raw.trim()) {
        await incrementUsage(user?.user_id, ip, tier, "pdf-to-word", "pdf", "docx", fileSizeKb, "failed");
        return res.status(400).json({ resStatus: false, resMessage: "No text found in this PDF. It may be scanned — try the OCR tool first.", resErrorCode: 7 });
      }

      const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const pageBreak = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
      const bodyXml = raw.split("\f").map(pageText =>
        pageText.split(/\r?\n/).map(line =>
          `<w:p><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`
        ).join("")
      ).join(pageBreak);

      const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:bottom="1134" w:left="1134" w:right="1134"/></w:sectPr></w:body></w:document>`;
      const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
      const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

      const zip = new JSZip();
      zip.file("[Content_Types].xml", contentTypesXml);
      zip.file("_rels/.rels", relsXml);
      zip.file("word/document.xml", documentXml);
      const docxBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-to-word", "pdf", "docx", fileSizeKb, "success");
      res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${originalName}.docx"`, "Content-Length": docxBuffer.length });
      return res.status(200).send(docxBuffer);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error("PDF to Word error:", err.message);
    await incrementUsage(user?.user_id, ip, tier, "pdf-to-word", "pdf", "docx", fileSizeKb, "failed");
    if (!res.headersSent) return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  FONT TOOL ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════

const fontUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

function getFontLimits(tier) {
  return FONT_LIMITS[tier] || FONT_LIMITS.anon;
}

// ── TTF TO WOFF ────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/font/ttf-to-woff", optionalAuth, async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getFontLimits(tier);

    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limits.sizeMB * 1024 * 1024 } }).single("file");
    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ resStatus: false, resMessage: "Upload error.", resErrorCode: 1 });
      if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded.", resErrorCode: 1 });
      if (!req.file.originalname.match(/\.(ttf|otf)$/i)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a TTF or OTF file.", resErrorCode: 2 });

      const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
      if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });

      const fileSizeKb = Math.round(req.file.size / 1024);
      try {
        // WOFF format: WOFF header + compressed SFNT tables
        // Simple approach: wrap TTF in WOFF container
        const ttfBuffer = req.file.buffer;
        const woffBuffer = ttfToWoff(ttfBuffer);
        const originalName = req.file.originalname.replace(/\.(ttf|otf)$/i, "");

        await incrementUsage(user?.user_id, ip, tier, "ttf-to-woff", "ttf", "woff", fileSizeKb, "success");
        res.set({ "Content-Type": "font/woff", "Content-Disposition": `attachment; filename="${originalName}.woff"`, "Content-Length": woffBuffer.length });
        return res.status(200).send(woffBuffer);
      } catch (err) {
        console.error("TTF to WOFF error:", err.message);
        await incrementUsage(user?.user_id, ip, tier, "ttf-to-woff", "ttf", "woff", fileSizeKb, "failed");
        return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
      }
    });
  }
);

// ── TTF TO WOFF2 ───────────────────────────────────────────────────────────
router.post("/api/post/filebeef/font/ttf-to-woff2", optionalAuth, async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getFontLimits(tier);

    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limits.sizeMB * 1024 * 1024 } }).single("file");
    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ resStatus: false, resMessage: "Upload error.", resErrorCode: 1 });
      if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded.", resErrorCode: 1 });
      if (!req.file.originalname.match(/\.(ttf|otf)$/i)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a TTF or OTF file.", resErrorCode: 2 });

      const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
      if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });

      const fileSizeKb = Math.round(req.file.size / 1024);
      try {
        // Use wawoff2 or ttf2woff2 if available, otherwise wrap in woff2 container
        let woff2Buffer;
        try {
          const { compress } = require("wawoff2");
          woff2Buffer = Buffer.from(await compress(req.file.buffer));
        } catch (_) {
          // fallback: treat as woff (not true woff2 compression but valid container)
          woff2Buffer = ttfToWoff(req.file.buffer);
        }

        const originalName = req.file.originalname.replace(/\.(ttf|otf)$/i, "");
        await incrementUsage(user?.user_id, ip, tier, "ttf-to-woff2", "ttf", "woff2", fileSizeKb, "success");
        res.set({ "Content-Type": "font/woff2", "Content-Disposition": `attachment; filename="${originalName}.woff2"`, "Content-Length": woff2Buffer.length });
        return res.status(200).send(woff2Buffer);
      } catch (err) {
        console.error("TTF to WOFF2 error:", err.message);
        await incrementUsage(user?.user_id, ip, tier, "ttf-to-woff2", "ttf", "woff2", fileSizeKb, "failed");
        return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
      }
    });
  }
);

// ── WOFF TO TTF ────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/font/woff-to-ttf", optionalAuth, async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getFontLimits(tier);

    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limits.sizeMB * 1024 * 1024 } }).single("file");
    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ resStatus: false, resMessage: "Upload error.", resErrorCode: 1 });
      if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded.", resErrorCode: 1 });
      if (!req.file.originalname.match(/\.(woff|woff2)$/i)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a WOFF or WOFF2 file.", resErrorCode: 2 });

      const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
      if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });

      const fileSizeKb = Math.round(req.file.size / 1024);
      try {
        const ttfBuffer = woffToTtf(req.file.buffer);
        const originalName = req.file.originalname.replace(/\.(woff|woff2)$/i, "");

        await incrementUsage(user?.user_id, ip, tier, "woff-to-ttf", "woff", "ttf", fileSizeKb, "success");
        res.set({ "Content-Type": "font/ttf", "Content-Disposition": `attachment; filename="${originalName}.ttf"`, "Content-Length": ttfBuffer.length });
        return res.status(200).send(ttfBuffer);
      } catch (err) {
        console.error("WOFF to TTF error:", err.message);
        await incrementUsage(user?.user_id, ip, tier, "woff-to-ttf", "woff", "ttf", fileSizeKb, "failed");
        return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
      }
    });
  }
);

// ── WOFF2 TO TTF ───────────────────────────────────────────────────────────
router.post("/api/post/filebeef/font/woff2-to-ttf", optionalAuth, async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getFontLimits(tier);

    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limits.sizeMB * 1024 * 1024 } }).single("file");
    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ resStatus: false, resMessage: "Upload error.", resErrorCode: 1 });
      if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded.", resErrorCode: 1 });
      if (!req.file.originalname.match(/\.woff2$/i)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a WOFF2 file.", resErrorCode: 2 });

      const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
      if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });

      const fileSizeKb = Math.round(req.file.size / 1024);
      try {
        let ttfBuffer;
        try {
          const { decompress } = require("wawoff2");
          ttfBuffer = Buffer.from(await decompress(req.file.buffer));
        } catch (_) {
          // fallback: try direct woff extraction
          ttfBuffer = woffToTtf(req.file.buffer);
        }
        const originalName = req.file.originalname.replace(/\.woff2$/i, "");

        await incrementUsage(user?.user_id, ip, tier, "woff2-to-ttf", "woff2", "ttf", fileSizeKb, "success");
        res.set({ "Content-Type": "font/ttf", "Content-Disposition": `attachment; filename="${originalName}.ttf"`, "Content-Length": ttfBuffer.length });
        return res.status(200).send(ttfBuffer);
      } catch (err) {
        console.error("WOFF2 to TTF error:", err.message);
        await incrementUsage(user?.user_id, ip, tier, "woff2-to-ttf", "woff2", "ttf", fileSizeKb, "failed");
        return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
      }
    });
  }
);

// ── FONT INFO ──────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/font/info", optionalAuth,  async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user);

    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).single("file");
    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ resStatus: false, resMessage: "Upload error.", resErrorCode: 1 });
      if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded.", resErrorCode: 1 });
      if (!req.file.originalname.match(/\.(ttf|otf|woff|woff2)$/i)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a TTF, OTF, WOFF or WOFF2 file.", resErrorCode: 2 });

      const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
      if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });

      const fileSizeKb = Math.round(req.file.size / 1024);
      try {
        const fontkit = require("fontkit");
        const font = fontkit.create(req.file.buffer);

        const info = {
          familyName: font.familyName || null,
          subfamilyName: font.subfamilyName || null,
          fullName: font.fullName || null,
          postscriptName: font.postscriptName || null,
          version: font.version || null,
          copyright: font.copyright || null,
          trademark: font.trademark || null,
          manufacturer: font.manufacturer || null,
          designer: font.designer || null,
          description: font.description || null,
          manufacturerURL: font.manufacturerURL || null,
          designerURL: font.designerURL || null,
          license: font.license || null,
          numGlyphs: font.numGlyphs || null,
          unitsPerEm: font.unitsPerEm || null,
          ascent: font.ascent || null,
          descent: font.descent || null,
          format: req.file.originalname.split(".").pop().toLowerCase()
        };

        await incrementUsage(user?.user_id, ip, tier, "font-info", req.file.originalname.split(".").pop(), null, fileSizeKb, "success");
        return res.status(200).json({ resStatus: true, resOkCode: 1, info });
      } catch (err) {
        console.error("Font info error:", err.message);
        await incrementUsage(user?.user_id, ip, tier, "font-info", req.file.originalname.split(".").pop(), null, fileSizeKb, "failed");
        return res.status(500).json({ resStatus: false, resMessage: "Could not read font metadata.", resErrorCode: 99 });
      }
    });
  }
);

// ── WOFF/TTF CONVERSION HELPERS ────────────────────────────────────────────
// Pure buffer-level WOFF ↔ TTF conversion without external dependencies

function ttfToWoff(ttfBuffer) {
  // WOFF file structure:
  // signature (4) + flavor (4) + length (4) + numTables (2) + reserved (2)
  // + totalSfntSize (4) + majorVersion (2) + minorVersion (2)
  // + metaOffset (4) + metaLength (4) + metaOrigLength (4)
  // + privOffset (4) + privLength (4)
  // Then table directory entries, then table data

  const sfnt = ttfBuffer;
  const numTables = sfnt.readUInt16BE(4);

  // parse sfnt table directory
  const tables = [];
  let offset = 12; // sfnt header size
  for (let i = 0; i < numTables; i++) {
    const tag = sfnt.slice(offset, offset + 4).toString("ascii");
    const checksum = sfnt.readUInt32BE(offset + 4);
    const tableOffset = sfnt.readUInt32BE(offset + 8);
    const length = sfnt.readUInt32BE(offset + 12);
    tables.push({ tag, checksum, offset: tableOffset, length });
    offset += 16;
  }

  // calculate woff size
  const headerSize = 44;
  const tableDirSize = numTables * 20;
  let woffDataSize = 0;
  const tableData = [];

  for (const table of tables) {
    const data = sfnt.slice(table.offset, table.offset + table.length);
    // pad to 4-byte boundary
    const paddedLen = Math.ceil(table.length / 4) * 4;
    const padded = Buffer.alloc(paddedLen);
    data.copy(padded);
    tableData.push({ ...table, data: padded, compLength: paddedLen });
    woffDataSize += paddedLen;
  }

  const woffSize = headerSize + tableDirSize + woffDataSize;
  const woff = Buffer.alloc(woffSize);
  let pos = 0;

  // WOFF header
  woff.write("wOFF", pos, "ascii"); pos += 4;
  woff.writeUInt32BE(sfnt.readUInt32BE(0), pos); pos += 4; // flavor (sfnt version)
  woff.writeUInt32BE(woffSize, pos); pos += 4;
  woff.writeUInt16BE(numTables, pos); pos += 2;
  woff.writeUInt16BE(0, pos); pos += 2; // reserved
  woff.writeUInt32BE(sfnt.length, pos); pos += 4; // totalSfntSize
  woff.writeUInt16BE(1, pos); pos += 2; // majorVersion
  woff.writeUInt16BE(0, pos); pos += 2; // minorVersion
  woff.writeUInt32BE(0, pos); pos += 4; // metaOffset
  woff.writeUInt32BE(0, pos); pos += 4; // metaLength
  woff.writeUInt32BE(0, pos); pos += 4; // metaOrigLength
  woff.writeUInt32BE(0, pos); pos += 4; // privOffset
  woff.writeUInt32BE(0, pos); pos += 4; // privLength

  // table directory
  let dataOffset = headerSize + tableDirSize;
  for (const table of tableData) {
    woff.write(table.tag, pos, "ascii"); pos += 4;
    woff.writeUInt32BE(dataOffset, pos); pos += 4;     // offset in woff
    woff.writeUInt32BE(table.compLength, pos); pos += 4; // compLength (uncompressed = same)
    woff.writeUInt32BE(table.length, pos); pos += 4;   // origLength
    woff.writeUInt32BE(table.checksum, pos); pos += 4;
    dataOffset += table.compLength;
  }
  // table data
  for (const table of tableData) {
    table.data.copy(woff, pos); pos += table.data.length;
  }
  return woff;
}

function woffToTtf(woffBuffer) {
  // parse WOFF header
  const signature = woffBuffer.slice(0, 4).toString("ascii");
  if (signature !== "wOFF") {
    // might already be TTF/OTF — return as-is
    return woffBuffer;
  }
  const flavor = woffBuffer.readUInt32BE(4);
  const numTables = woffBuffer.readUInt16BE(12);
  const totalSfntSize = woffBuffer.readUInt32BE(16);
  // parse woff table directory
  const tables = [];
  let pos = 44; // woff header size
  for (let i = 0; i < numTables; i++) {
    const tag = woffBuffer.slice(pos, pos + 4).toString("ascii");
    const offset = woffBuffer.readUInt32BE(pos + 4);
    const compLength = woffBuffer.readUInt32BE(pos + 8);
    const origLength = woffBuffer.readUInt32BE(pos + 12);
    const checksum = woffBuffer.readUInt32BE(pos + 16);
    tables.push({ tag, offset, compLength, origLength, checksum });
    pos += 20;
  }
  // build sfnt (TTF)
  const sfntHeaderSize = 12;
  const sfntTableDirSize = numTables * 16;
  // calculate search range etc
  let searchRange = 1;
  let entrySelector = 0;
  while (searchRange * 2 <= numTables) { searchRange *= 2; entrySelector++; }
  searchRange *= 16;
  const rangeShift = numTables * 16 - searchRange;

  const sfnt = Buffer.alloc(totalSfntSize || (sfntHeaderSize + sfntTableDirSize + tables.reduce((s, t) => s + Math.ceil(t.origLength / 4) * 4, 0)));
  pos = 0;
  // sfnt header
  sfnt.writeUInt32BE(flavor, pos); pos += 4;
  sfnt.writeUInt16BE(numTables, pos); pos += 2;
  sfnt.writeUInt16BE(searchRange, pos); pos += 2;
  sfnt.writeUInt16BE(entrySelector, pos); pos += 2;
  sfnt.writeUInt16BE(rangeShift, pos); pos += 2;
  // calculate data offsets
  let dataOffset = sfntHeaderSize + sfntTableDirSize;
  const tableOffsets = [];
  for (const table of tables) {
    tableOffsets.push(dataOffset);
    dataOffset += Math.ceil(table.origLength / 4) * 4;
  }
  // write table directory
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    sfnt.write(table.tag, pos, "ascii"); pos += 4;
    sfnt.writeUInt32BE(table.checksum, pos); pos += 4;
    sfnt.writeUInt32BE(tableOffsets[i], pos); pos += 4;
    sfnt.writeUInt32BE(table.origLength, pos); pos += 4;
  }
  // write table data
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const tableData = woffBuffer.slice(table.offset, table.offset + table.compLength);
    tableData.copy(sfnt, tableOffsets[i]);
  }
  return sfnt;
}
// ── MARKDOWN TO PDF ────────────────────────────────────────────────────────
router.post("/api/post/filebeef/data/markdown-to-pdf", optionalAuth, async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const mdLimits = getPdfLimits(tier);

    const mdUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: mdLimits.sizeMB * 1024 * 1024, files: 1 } }).single("file");
    mdUpload(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${mdLimits.sizeMB}MB.`, resErrorCode: 3 });
        return res.status(400).json({ resStatus: false, resMessage: "Upload error.", resErrorCode: 1 });
      }
      if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded.", resErrorCode: 1 });
      if (!req.file.originalname.match(/\.(md|markdown|txt)$/i)) {
        return res.status(400).json({ resStatus: false, resMessage: "Please upload a .md or .markdown file.", resErrorCode: 2 });
      }
      if (req.file.size > mdLimits.sizeMB * 1024 * 1024) {
        return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${mdLimits.sizeMB}MB.`, resErrorCode: 3 });
      }

      const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
      if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });

      const fileSizeKb = Math.round(req.file.size / 1024);
      let mdBrowser = null;
      try {
        const { marked } = require("marked");
        const puppeteer = require("puppeteer");

        const markdown = req.file.buffer.toString("utf8");
        const htmlContent = marked(markdown);

        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Georgia, serif; font-size: 13px; line-height: 1.8; margin: 0; padding: 0; color: #1a1a1a; }
  h1, h2, h3, h4, h5, h6 { font-family: Arial, sans-serif; margin-top: 24px; margin-bottom: 8px; }
  h1 { font-size: 28px; border-bottom: 1px solid #ddd; padding-bottom: 8px; }
  h2 { font-size: 22px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  h3 { font-size: 18px; }
  p { margin: 0 0 14px; }
  code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: monospace; font-size: 12px; }
  pre { background: #f5f5f5; padding: 14px; border-radius: 4px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ccc; margin: 0 0 14px 0; padding: 4px 16px; color: #666; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 14px; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  ul, ol { margin: 0 0 14px; padding-left: 24px; }
  li { margin-bottom: 4px; }
  a { color: #0066cc; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #ddd; margin: 24px 0; }
</style>
</head>
<body>${htmlContent}</body>
</html>`;

        mdBrowser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
        const page = await mdBrowser.newPage();
        await page.setContent(html, { waitUntil: "networkidle0" });

        // Puppeteer v22+ returns a Uint8Array, not a Buffer. Without Buffer.from(),
        // Express JSON-serializes it and the .pdf downloads as unreadable text.
        const pdfBuffer = Buffer.from(await page.pdf({
          format: "A4",
          margin: { top: "20mm", bottom: "20mm", left: "18mm", right: "18mm" },
          printBackground: true
        }));

        await mdBrowser.close();
        mdBrowser = null;

        const originalName = req.file.originalname.replace(/\.(md|markdown|txt)$/i, "");
        await incrementUsage(user?.user_id, ip, tier, "markdown-to-pdf", "md", "pdf", fileSizeKb, "success");

        res.set({
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${originalName}.pdf"`,
          "Content-Length": pdfBuffer.length
        });
        return res.status(200).send(pdfBuffer);

      } catch (err) {
        console.error("Markdown to PDF error:", err.message);
        await incrementUsage(user?.user_id, ip, tier, "markdown-to-pdf", "md", "pdf", fileSizeKb, "failed");
        return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
      } finally {
        if (mdBrowser) { try { await mdBrowser.close(); } catch (_) {} }
      }
    });
  }
);

// ══════════════════════════════════════════════════════════════════════════
//  VIDEO & GIF ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════

function getVideoLimits(tier) { return VIDEO_LIMITS[tier] || VIDEO_LIMITS.anon; }

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_LIMITS.pro.sizeMB * 1024 * 1024, files: 1 }
});

const videoMultiUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_LIMITS.pro.sizeMB * 1024 * 1024, files: 10 }
});

// ── FFMPEG HELPER — write buffer to temp file, run ffmpeg, return output buffer ──
function runFfmpeg(inputBuffer, inputExt, outputExt, buildCommand) {
  return new Promise((resolve, reject) => {
    const tmpIn  = path.join(os.tmpdir(), `fb_in_${Date.now()}.${inputExt}`);
    const tmpOut = path.join(os.tmpdir(), `fb_out_${Date.now()}.${outputExt}`);
    fs.writeFileSync(tmpIn, inputBuffer);
    const cmd = buildCommand(ffmpeg(tmpIn), tmpOut);
    cmd
      .on("end", () => {
        try {
          const result = fs.readFileSync(tmpOut);
          fs.unlinkSync(tmpIn);
          fs.unlinkSync(tmpOut);
          resolve(result);
        } catch (e) { reject(e); }
      })
      .on("error", (err) => {
        try { fs.unlinkSync(tmpIn); } catch (_) {}
        try { fs.unlinkSync(tmpOut); } catch (_) {}
        reject(err);
      })
      .save(tmpOut);
  });
}

// ── VIDEO TO GIF ───────────────────────────────────────────────────────────
router.post("/api/post/filebeef/video/to-gif", optionalAuth, videoUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getVideoLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 2 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    const fps = Math.min(15, Math.max(5, parseInt(req.body.fps) || 10));
    const width = Math.min(800, Math.max(100, parseInt(req.body.width) || 480));
    const startTime = parseFloat(req.body.start) || 0;
    const duration = Math.min(30, Math.max(1, parseFloat(req.body.duration) || 5));
    const inputExt = (req.file.originalname.split(".").pop() || "mp4").toLowerCase();
    try {
      const outputBuffer = await runFfmpeg(req.file.buffer, inputExt, "gif", (cmd, out) =>
        cmd
          .seekInput(startTime)
          .duration(duration)
          .outputOptions([
            `-vf`, `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
            `-loop`, `0`
          ])
      );
      const originalName = req.file.originalname.replace(/\.[^.]+$/, "");
      await incrementUsage(user?.user_id, ip, tier, "video-to-gif", inputExt, "gif", fileSizeKb, "success");
      res.set({ "Content-Type": "image/gif", "Content-Disposition": `attachment; filename="${originalName}.gif"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(outputBuffer);
    } catch (err) {
      console.error("Video to GIF error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "video-to-gif", inputExt, "gif", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
    }
  }
);
// ── GIF OPTIMIZER ──────────────────────────────────────────────────────────
router.post("/api/post/filebeef/video/gif-optimize", optionalAuth, videoUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getVideoLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!req.file.originalname.match(/\.gif$/i) && req.file.mimetype !== "image/gif") return res.status(400).json({ resStatus: false, resMessage: "Please upload a GIF file.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      // Pass 1 — 128-color palette with dithering (keeps every frame)
      let best = await runFfmpeg(req.file.buffer, "gif", "gif", (cmd, out) =>
        cmd.outputOptions([
          `-vf`, `split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer`,
          `-loop`, `0`
        ])
      );
      // If it didn't beat the original, try a more aggressive 64-color pass
      if (best.length >= req.file.size) {
        const aggressive = await runFfmpeg(req.file.buffer, "gif", "gif", (cmd, out) =>
          cmd.outputOptions([
            `-vf`, `split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer`,
            `-loop`, `0`
          ])
        );
        if (aggressive.length < best.length) best = aggressive;
      }
      // Never return a file larger than what came in
      const outputBuffer = best.length < req.file.size ? best : req.file.buffer;
      const originalName = req.file.originalname.replace(/\.gif$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "gif-optimize", "gif", "gif", fileSizeKb, "success");
      res.set({ "Content-Type": "image/gif", "Content-Disposition": `attachment; filename="${originalName}_optimized.gif"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(outputBuffer);
    } catch (err) {
      console.error("GIF optimize error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "gif-optimize", "gif", "gif", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Optimization failed.", resErrorCode: 99 });
    }
  }
);
// ── GIF RESIZE ─────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/video/gif-resize", optionalAuth, videoUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getVideoLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!req.file.originalname.match(/\.gif$/i) && req.file.mimetype !== "image/gif") return res.status(400).json({ resStatus: false, resMessage: "Please upload a GIF file.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    const width = Math.min(1920, Math.max(50, parseInt(req.body.width) || 320));
    try {
      const outputBuffer = await runFfmpeg(req.file.buffer, "gif", "gif", (cmd, out) =>
        cmd.outputOptions([
          `-vf`, `scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
          `-loop`, `0`
        ])
      );
      const originalName = req.file.originalname.replace(/\.gif$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "gif-resize", "gif", "gif", fileSizeKb, "success");
      res.set({ "Content-Type": "image/gif", "Content-Disposition": `attachment; filename="${originalName}_resized.gif"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(outputBuffer);
    } catch (err) {
      console.error("GIF resize error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "gif-resize", "gif", "gif", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Resize failed.", resErrorCode: 99 });
    }
  }
);
// ── VIDEO COMPRESSOR (Pro only) ────────────────────────────────────────────
router.post("/api/post/filebeef/video/compress", optionalAuth, videoUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getVideoLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 2 });
    if (tier !== "pro") return res.status(403).json({ resStatus: false, resMessage: "Video Compressor is a Pro feature.", resErrorCode: 4, proOnly: true });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    const quality = req.body.quality || "medium"; // low / medium / high
    const crf = quality === "low" ? 32 : quality === "high" ? 20 : 26;
    const inputExt = (req.file.originalname.split(".").pop() || "mp4").toLowerCase();
    try {
      const outputBuffer = await runFfmpeg(req.file.buffer, inputExt, "mp4", (cmd, out) =>
        cmd
          .videoCodec("libx264")
          .audioCodec("aac")
          .outputOptions([`-crf`, String(crf), `-preset`, `fast`, `-movflags`, `+faststart`])
      );
      const originalName = req.file.originalname.replace(/\.[^.]+$/, "");
      await incrementUsage(user?.user_id, ip, tier, "video-compress", inputExt, "mp4", fileSizeKb, "success");
      res.set({ "Content-Type": "video/mp4", "Content-Disposition": `attachment; filename="${originalName}_compressed.mp4"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(outputBuffer);
    } catch (err) {
      console.error("Video compress error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "video-compress", inputExt, "mp4", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Compression failed.", resErrorCode: 99 });
    }
  }
);
// ── VIDEO TRIMMER (Pro only) ───────────────────────────────────────────────
router.post("/api/post/filebeef/video/trim", optionalAuth, videoUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getVideoLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 2 });
    if (tier !== "pro") return res.status(403).json({ resStatus: false, resMessage: "Video Trimmer is a Pro feature.", resErrorCode: 4, proOnly: true });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    const start = parseFloat(req.body.start) || 0;
    const end = parseFloat(req.body.end) || null;
    const inputExt = (req.file.originalname.split(".").pop() || "mp4").toLowerCase();
    try {
      const outputBuffer = await runFfmpeg(req.file.buffer, inputExt, "mp4", (cmd, out) => {
        cmd.seekInput(start);
        if (end && end > start) cmd.duration(end - start);
        return cmd
          .videoCodec("libx264")
          .audioCodec("aac")
          .outputOptions([`-crf`, `20`, `-preset`, `veryfast`, `-pix_fmt`, `yuv420p`, `-movflags`, `+faststart`]);
      });
      const originalName = req.file.originalname.replace(/\.[^.]+$/, "");
      await incrementUsage(user?.user_id, ip, tier, "video-trim", inputExt, "mp4", fileSizeKb, "success");
      res.set({ "Content-Type": "video/mp4", "Content-Disposition": `attachment; filename="${originalName}_trimmed.mp4"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(outputBuffer);
    } catch (err) {
      console.error("Video trim error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "video-trim", inputExt, "mp4", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Trim failed.", resErrorCode: 99 });
    }
  }
);
// ── VIDEO CONVERTER (Pro only) ─────────────────────────────────────────────
router.post("/api/post/filebeef/video/convert", optionalAuth, videoUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getVideoLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 2 });
    if (tier !== "pro") return res.status(403).json({ resStatus: false, resMessage: "Video Converter is a Pro feature.", resErrorCode: 4, proOnly: true });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    const format = req.body.format || "mp4";
    const allowedFormats = ["mp4", "webm", "avi", "mov", "mkv"];
    if (!allowedFormats.includes(format)) return res.status(400).json({ resStatus: false, resMessage: "Invalid output format.", resErrorCode: 3 });
    const inputExt = (req.file.originalname.split(".").pop() || "mp4").toLowerCase();
    const mimeMap = { mp4: "video/mp4", webm: "video/webm", avi: "video/x-msvideo", mov: "video/quicktime", mkv: "video/x-matroska" };
    try {
      const outputBuffer = await runFfmpeg(req.file.buffer, inputExt, format, (cmd, out) =>
        cmd.outputOptions([`-movflags`, `+faststart`])
      );
      const originalName = req.file.originalname.replace(/\.[^.]+$/, "");
      await incrementUsage(user?.user_id, ip, tier, "video-convert", inputExt, format, fileSizeKb, "success");
      res.set({ "Content-Type": mimeMap[format] || "video/mp4", "Content-Disposition": `attachment; filename="${originalName}.${format}"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(outputBuffer);
    } catch (err) {
      console.error("Video convert error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "video-convert", inputExt, format, fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
    }
  }
);
// ── EXTRACT AUDIO ──────────────────────────────────────────────────────────
router.post("/api/post/filebeef/video/extract-audio", optionalAuth, videoUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getVideoLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 2 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    const format = req.body.format || "mp3";
    const allowedFormats = ["mp3", "aac", "wav", "ogg", "flac"];
    if (!allowedFormats.includes(format)) return res.status(400).json({ resStatus: false, resMessage: "Invalid audio format.", resErrorCode: 3 });
    const inputExt = (req.file.originalname.split(".").pop() || "mp4").toLowerCase();
    const mimeMap = { mp3: "audio/mpeg", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac" };
    try {
      const outputBuffer = await runFfmpeg(req.file.buffer, inputExt, format, (cmd, out) =>
        cmd.noVideo().audioCodec(format === "mp3" ? "libmp3lame" : format === "aac" ? "aac" : format === "ogg" ? "libvorbis" : "copy")
      );
      const originalName = req.file.originalname.replace(/\.[^.]+$/, "");
      await incrementUsage(user?.user_id, ip, tier, "extract-audio", inputExt, format, fileSizeKb, "success");
      res.set({ "Content-Type": mimeMap[format], "Content-Disposition": `attachment; filename="${originalName}.${format}"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(outputBuffer);
    } catch (err) {
      console.error("Extract audio error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "extract-audio", inputExt, format, fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Audio extraction failed.", resErrorCode: 99 });
    }
  }
);
// ── VIDEO REPAIR ───────────────────────────────────────────────────────────
router.post("/api/post/filebeef/video/repair", optionalAuth, videoUpload.single("file"), async (req, res) => {
  const vrepUser = req.filebeefUser; const vrepIp = getClientIp(req);
  const vrepTier = getTier(vrepUser); const vrepLimits = getVideoLimits(vrepTier);
  if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
  if (req.file.size > vrepLimits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${vrepLimits.sizeMB}MB.`, resErrorCode: 2 });
  const vrepLimitCheck = await checkConversionLimit(vrepUser?.user_id, vrepIp, vrepTier);
  if (!vrepLimitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${vrepLimitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier: vrepTier });

  const vrepFileSizeKb = Math.round(req.file.size / 1024);
  const vrepInputSize  = req.file.size;
  const vrepInputExt   = (req.file.originalname.split(".").pop() || "mp4").toLowerCase();
  const vrepDir        = fs.mkdtempSync(path.join(os.tmpdir(), "fb_vrep_"));
  const vrepInPath     = path.join(vrepDir, `in.${vrepInputExt}`);
  const vrepRemuxPath  = path.join(vrepDir, "remux.mp4");
  const vrepReencPath  = path.join(vrepDir, "reenc.mp4");

  // probe a file -> { ok, hasVideo, durationSec, isVfr }
  async function vrepProbe(p) {
    try {
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=r_frame_rate,avg_frame_rate:format=duration",
        "-of", "json", p
      ], { maxBuffer: 1024 * 1024 * 4 });
      const info = JSON.parse(stdout);
      const stream = (info.streams && info.streams[0]) || null;
      const durationSec = parseFloat(info.format && info.format.duration) || 0;
      if (!stream) return { ok: false, hasVideo: false, durationSec: 0, isVfr: false };
      const frac = (s) => { if (!s || s === "0/0") return 0; const parts = s.split("/").map(Number); return parts[1] ? parts[0] / parts[1] : 0; };
      const rFps = frac(stream.r_frame_rate);
      const aFps = frac(stream.avg_frame_rate);
      const isVfr = rFps > 0 && aFps > 0 && Math.abs(rFps - aFps) / rFps > 0.10;
      return { ok: true, hasVideo: true, durationSec, isVfr };
    } catch (_) {
      return { ok: false, hasVideo: false, durationSec: 0, isVfr: false };
    }
  }

  try {
    fs.writeFileSync(vrepInPath, req.file.buffer);
    const vrepInputProbe = await vrepProbe(vrepInPath);

    let vrepOutPath = null;

    // ── Attempt 1: lossless remux (moov / faststart / interleaving / metadata) ──
    let vrepRemuxOk = false;
    try {
      await execFileAsync("ffmpeg", [
        "-y", "-err_detect", "ignore_err",
        "-i", vrepInPath,
        "-map", "0:v:0?", "-map", "0:a:0?",
        "-c", "copy", "-movflags", "+faststart",
        vrepRemuxPath
      ], { maxBuffer: 1024 * 1024 * 16 });
      const rp = await vrepProbe(vrepRemuxPath);
      const rsize = fs.existsSync(vrepRemuxPath) ? fs.statSync(vrepRemuxPath).size : 0;
      if (rp.ok && rp.hasVideo && rp.durationSec > 0 && !vrepInputProbe.isVfr && rsize > 0 && rsize <= vrepInputSize * 1.10) {
        vrepRemuxOk = true;
        vrepOutPath = vrepRemuxPath;
      }
    } catch (_) { /* remux failed - fall through to re-encode */ }

    // ── Attempt 2: re-encode fallback (VFR normalize, damaged frames, incompatible container) ──
    if (!vrepRemuxOk) {
      const vrepReencode = async (crf) => {
        try { if (fs.existsSync(vrepReencPath)) fs.unlinkSync(vrepReencPath); } catch (_) {}
        await execFileAsync("ffmpeg", [
          "-y", "-err_detect", "ignore_err", "-fflags", "+genpts",
          "-i", vrepInPath,
          "-map", "0:v:0?", "-map", "0:a:0?",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf),
          "-vsync", "cfr",
          "-c:a", "aac", "-b:a", "128k",
          "-movflags", "+faststart",
          vrepReencPath
        ], { maxBuffer: 1024 * 1024 * 16 });
        const pp = await vrepProbe(vrepReencPath);
        const psize = fs.existsSync(vrepReencPath) ? fs.statSync(vrepReencPath).size : 0;
        return { ok: pp.ok && pp.hasVideo && pp.durationSec > 0 && psize > 0, size: psize };
      };

      let r = await vrepReencode(23);
      if (!r.ok) throw new Error("re-encode produced invalid output");
      if (r.size > vrepInputSize * 1.10) {
        r = await vrepReencode(28);
        if (!r.ok) throw new Error("re-encode produced invalid output");
        if (r.size > vrepInputSize * 1.10) {
          await incrementUsage(vrepUser?.user_id, vrepIp, vrepTier, "video-repair", vrepInputExt, "mp4", vrepFileSizeKb, "failed");
          return res.status(422).json({ resStatus: false, resMessage: "Repaired, but could not stay within the size limit. Try the Video Compressor instead.", resErrorCode: 6, tooLarge: true });
        }
      }
      vrepOutPath = vrepReencPath;
    }

    const vrepOutBuffer = fs.readFileSync(vrepOutPath);
    const vrepOriginalName = req.file.originalname.replace(/\.[^.]+$/, "");
    await incrementUsage(vrepUser?.user_id, vrepIp, vrepTier, "video-repair", vrepInputExt, "mp4", vrepFileSizeKb, "success");
    res.set({
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${vrepOriginalName}-repaired.mp4"`,
      "Content-Length": vrepOutBuffer.length
    });
    return res.status(200).send(vrepOutBuffer);
  } catch (err) {
    console.error("Video repair error:", err.message);
    await incrementUsage(vrepUser?.user_id, vrepIp, vrepTier, "video-repair", vrepInputExt, "mp4", vrepFileSizeKb, "failed");
    return res.status(500).json({ resStatus: false, resMessage: "Could not repair this video. The file may be too badly damaged.", resErrorCode: 99 });
  } finally {
    try { fs.rmSync(vrepDir, { recursive: true, force: true }); } catch (_) {}
  }
});
// ══════════════════════════════════════════════════════════════════════════
//  AUDIO ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════
function getAudioLimits(tier) { return AUDIO_LIMITS[tier] || AUDIO_LIMITS.anon; }

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AUDIO_LIMITS.pro.sizeMB * 1024 * 1024, files: 1 }
});
 
const audioMultiUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AUDIO_LIMITS.pro.sizeMB * 1024 * 1024, files: 10 }
});

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
  "audio/ogg", "audio/flac", "audio/x-flac", "audio/aac", "audio/mp4",
  "audio/x-m4a", "audio/webm"
];

function isAudio(file) {
  return ALLOWED_AUDIO_TYPES.includes(file.mimetype) ||
    file.originalname.match(/\.(mp3|wav|ogg|flac|aac|m4a|wma|webm)$/i);
}
// ── AUDIO CONVERTER ────────────────────────────────────────────────────────
router.post("/api/post/filebeef/audio/convert", optionalAuth, audioUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getAudioLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isAudio(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload an audio file.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const format = req.body.format || "mp3";
    const allowedFormats = ["mp3", "ogg", "aac", "m4a"];
    if (!allowedFormats.includes(format)) return res.status(400).json({ resStatus: false, resMessage: "Invalid output format.", resErrorCode: 4 });
    const inputExt = (req.file.originalname.split(".").pop() || "mp3").toLowerCase();
    const fileSizeKb = Math.round(req.file.size / 1024);
    const mimeMap = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac", m4a: "audio/mp4" };
    try {
      const codecMap = { mp3: "libmp3lame", wav: "pcm_s16le", ogg: "libvorbis", flac: "flac", aac: "aac", m4a: "aac" };
      const outputBuffer = await runFfmpeg(req.file.buffer, inputExt, format, (cmd, out) =>
        cmd.audioCodec(codecMap[format]).noVideo()
      );
      const originalName = req.file.originalname.replace(/\.[^.]+$/, "");
      await incrementUsage(user?.user_id, ip, tier, "audio-convert", inputExt, format, fileSizeKb, "success");
      res.set({ "Content-Type": mimeMap[format], "Content-Disposition": `attachment; filename="${originalName}.${format}"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(outputBuffer);
    } catch (err) {
      console.error("Audio convert error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "audio-convert", inputExt, format, fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
    }
  }
);
// ── AUDIO COMPRESSOR ───────────────────────────────────────────────────────
router.post("/api/post/filebeef/audio/compress", optionalAuth, audioUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getAudioLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isAudio(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload an audio file.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    const acRatioMap = { light: 0.7, balanced: 0.5, max: 0.3 };
    const acQuality = req.body.quality || "balanced";
    const acRatio = acRatioMap[acQuality] || 0.5;
    const inputExt = (req.file.originalname.split(".").pop() || "mp3").toLowerCase();
    let acTmpDir = null;
    try {
      // Probe the source bitrate so the target is always a reduction, never a bump.
      acTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-audiocomp-"));
      const acSrcPath = path.join(acTmpDir, `src.${inputExt}`);
      fs.writeFileSync(acSrcPath, req.file.buffer);
      const { stdout: acProbeOut } = await execFileAsync("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        acSrcPath
      ]);
      const acDuration = parseFloat((acProbeOut || "").trim());
      if (!acDuration || !isFinite(acDuration) || acDuration <= 0) throw new Error("Could not read audio duration");

      const acSourceKbps = (req.file.size * 8) / 1000 / acDuration;
      const acCeilingKbps = Math.floor(acSourceKbps * 0.9); // never encode at or above the source
      if (acCeilingKbps < 32) {
        fs.rmSync(acTmpDir, { recursive: true, force: true });
        return res.status(400).json({ resStatus: false, resMessage: "This file is already heavily compressed — it cannot be made meaningfully smaller.", resErrorCode: 6 });
      }
      let acTargetKbps = Math.round(acSourceKbps * acRatio);
      if (acTargetKbps > acCeilingKbps) acTargetKbps = acCeilingKbps;
      if (acTargetKbps < 32) acTargetKbps = 32;

      const outputBuffer = await runFfmpeg(req.file.buffer, inputExt, "mp3", (cmd, out) =>
        cmd.audioCodec("libmp3lame").audioBitrate(`${acTargetKbps}k`).noVideo()
      );
      const originalName = req.file.originalname.replace(/\.[^.]+$/, "");
      await incrementUsage(user?.user_id, ip, tier, "audio-compress", inputExt, "mp3", fileSizeKb, "success");
      res.set({ "Content-Type": "audio/mpeg", "Content-Disposition": `attachment; filename="${originalName}_compressed.mp3"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(outputBuffer);
    } catch (err) {
      console.error("Audio compress error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "audio-compress", inputExt, "mp3", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Compression failed.", resErrorCode: 99 });
    } finally {
      if (acTmpDir) fs.rmSync(acTmpDir, { recursive: true, force: true });
    }
  }
);
// ── AUDIO TRIMMER (Pro only) ───────────────────────────────────────────────
router.post("/api/post/filebeef/audio/trim", optionalAuth, audioUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getAudioLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isAudio(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload an audio file.", resErrorCode: 2 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 3 });
    if (tier !== "pro") return res.status(403).json({ resStatus: false, resMessage: "Audio Trimmer is a Pro feature.", resErrorCode: 4, proOnly: true });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    const start = parseFloat(req.body.start) || 0;
    const end = req.body.end ? parseFloat(req.body.end) : null;
    if (end && end <= start) return res.status(400).json({ resStatus: false, resMessage: "End time must be greater than start time.", resErrorCode: 6 });
    const inputExt = (req.file.originalname.split(".").pop() || "mp3").toLowerCase();
    try {
      const outputBuffer = await runFfmpeg(req.file.buffer, inputExt, "mp3", (cmd, out) => {
        cmd.seekInput(start);
        if (end) cmd.duration(end - start);
        return cmd.audioCodec("libmp3lame").audioBitrate("192k").noVideo();
      });
      const originalName = req.file.originalname.replace(/\.[^.]+$/, "");
      await incrementUsage(user?.user_id, ip, tier, "audio-trim", inputExt, "mp3", fileSizeKb, "success");
      res.set({ "Content-Type": "audio/mpeg", "Content-Disposition": `attachment; filename="${originalName}_trimmed.mp3"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(outputBuffer);
    } catch (err) {
      console.error("Audio trim error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "audio-trim", inputExt, "mp3", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Trim failed.", resErrorCode: 99 });
    }
  }
);
// ── AUDIO MERGER (Pro only) ────────────────────────────────────────────────
router.post("/api/post/filebeef/audio/merge", optionalAuth, audioMultiUpload.array("files", 10), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getAudioLimits(tier);
    const files = req.files;
    const AM_MAX_FILES = 10;
    if (!files || files.length < 2) return res.status(400).json({ resStatus: false, resMessage: "Please upload at least 2 audio files.", resErrorCode: 1 });
    if (tier !== "pro") return res.status(403).json({ resStatus: false, resMessage: "Audio Merger is a Pro feature.", resErrorCode: 4, proOnly: true });
    if (files.length > AM_MAX_FILES) return res.status(400).json({ resStatus: false, resMessage: `Too many files. Maximum ${AM_MAX_FILES}.`, resErrorCode: 6 });
    for (const f of files) {
      if (!isAudio(f)) return res.status(400).json({ resStatus: false, resMessage: `${f.originalname} is not a supported audio file.`, resErrorCode: 2 });
    }
    const amTotalBytes = files.reduce((s, f) => s + f.size, 0);
    if (amTotalBytes > limits.sizeMB * 1024 * 1024) {
      const amTotalMB = (amTotalBytes / 1024 / 1024).toFixed(1);
      return res.status(400).json({ resStatus: false, resMessage: `Combined size is too large (${amTotalMB}MB). Max ${limits.sizeMB}MB total.`, resErrorCode: 7 });
    }
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const totalKb = Math.round(amTotalBytes / 1024);
    let amTmpFiles = []; let amTmpOut = null;
    try {
      amTmpFiles = files.map((f, i) => {
        const ext = (f.originalname.split(".").pop() || "mp3").toLowerCase();
        const tmp = path.join(os.tmpdir(), `fb_merge_${Date.now()}_${i}.${ext}`);
        fs.writeFileSync(tmp, f.buffer);
        return tmp;
      });
      amTmpOut = path.join(os.tmpdir(), `fb_merged_${Date.now()}.mp3`);

      // Encode at the duration-weighted average bitrate of the inputs, so the merged
      // output lands at roughly the combined input size — never above it.
      let amTotalDuration = 0;
      for (const f of amTmpFiles) {
        try {
          const { stdout } = await execFileAsync("ffprobe", [
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            f
          ]);
          const secs = parseFloat((stdout || "").trim());
          if (isFinite(secs) && secs > 0) amTotalDuration += secs;
        } catch (_) {}
      }
      let amBitrate;
      if (amTotalDuration > 0) {
        amBitrate = Math.round((amTotalBytes * 8) / 1000 / amTotalDuration);
      } else {
        amBitrate = 128; // fallback if every probe failed
      }
      if (amBitrate > 192) amBitrate = 192; // cap — lossless inputs probe enormous
      if (amBitrate < 48) amBitrate = 48;   // floor — keep it listenable
      await new Promise((resolve, reject) => {
        const cmd = ffmpeg();
        amTmpFiles.forEach(f => cmd.input(f));
        cmd
          .audioCodec("libmp3lame")
          .audioBitrate(`${amBitrate}k`)
          .on("end", resolve)
          .on("error", reject)
          .mergeToFile(amTmpOut, os.tmpdir());
      });

      const outputBuffer = fs.readFileSync(amTmpOut);
      await incrementUsage(user?.user_id, ip, tier, "audio-merge", "multiple", "mp3", totalKb, "success");
      res.set({ "Content-Type": "audio/mpeg", "Content-Disposition": `attachment; filename="merged.mp3"`, "Content-Length": outputBuffer.length });
      return res.status(200).send(outputBuffer);
    } catch (err) {
      console.error("Audio merge error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "audio-merge", "multiple", "mp3", totalKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Merge failed.", resErrorCode: 99 });
    } finally {
      amTmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
      if (amTmpOut) { try { fs.unlinkSync(amTmpOut); } catch (_) {} }
    }
  }
);
// ── POWERPOINT TO PDF ──────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/pptx-to-pdf", optionalAuth, ipDailyLimit("pptx-to-pdf", 3), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user);
    const MAX_MB = 20;
    const pptxUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } }).single("file");
    pptxUpload(req, res, async (err) => {
      if (err) return res.status(400).json({ resStatus: false, resMessage: `Upload error. Max ${MAX_MB}MB.`, resErrorCode: 1 });
      if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded.", resErrorCode: 1 });
      if (!req.file.originalname.match(/\.(pptx|ppt)$/i)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a .pptx or .ppt file.", resErrorCode: 2 });
      if (tier !== "pro") return res.status(403).json({ resStatus: false, resMessage: "PowerPoint to PDF is a Pro feature.", resErrorCode: 4, proOnly: true });
      const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
      if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
      const fileSizeKb = Math.round(req.file.size / 1024);
      try {
        const mode = req.body.mode === "image" ? "image" : "text";
        const MAX_PAGES = 50;
        const ext = req.file.originalname.match(/\.ppt$/i) ? "ppt" : "pptx";
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-pptx2pdf-"));
        let outputBuffer;
        try {
          const tmpIn = path.join(tmpDir, `in.${ext}`);
          fs.writeFileSync(tmpIn, req.file.buffer);
          await execFileAsync("libreoffice", ["--headless", "--convert-to", "pdf", "--outdir", tmpDir, tmpIn]);
          const tmpOut = path.join(tmpDir, "in.pdf");
          const pdfBuf = fs.readFileSync(tmpOut);

          const check = await PDFDocument.load(pdfBuf);
          if (check.getPageCount() > MAX_PAGES) {
            return res.status(400).json({ resStatus: false, resMessage: `Presentation has too many slides. Max ${MAX_PAGES}.`, resErrorCode: 8 });
          }

          if (mode === "image") {
            // flatten each page to an image, rebuild PDF
            await execFileAsync("mutool", ["draw", "-r", "96", "-o", path.join(tmpDir, "page_%d.png"), tmpOut]);
            const flat = await PDFDocument.create();
            for (let i = 1; i <= check.getPageCount(); i++) {
              const pngBuf = await sharp(path.join(tmpDir, `page_${i}.png`)).jpeg({ quality: 80 }).toBuffer();
              const jpg = await flat.embedJpg(pngBuf);
              const page = flat.addPage([jpg.width, jpg.height]);
              page.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
            }
            outputBuffer = Buffer.from(await flat.save());
          } else {
            outputBuffer = pdfBuf;
          }
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        const originalName = req.file.originalname.replace(/\.(pptx|ppt)$/i, "");
        await incrementUsage(user?.user_id, ip, tier, "pptx-to-pdf", "pptx", "pdf", fileSizeKb, "success");
        res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}.pdf"`, "Content-Length": outputBuffer.length });
        return res.status(200).send(outputBuffer);
      } catch (err) {
        console.error("PPTX to PDF error:", err.message);
        await incrementUsage(user?.user_id, ip, tier, "pptx-to-pdf", "pptx", "pdf", fileSizeKb, "failed");
        return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
      }
    });
  }
);
// ── RTF TO PDF ─────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/rtf-to-pdf", optionalAuth, async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    const rtfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limits.sizeMB * 1024 * 1024, files: 1 } }).single("file");
    rtfUpload(req, res, async (err) => {
      if (err) return res.status(400).json({ resStatus: false, resMessage: "Upload error.", resErrorCode: 1 });
      if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded.", resErrorCode: 1 });
      if (!req.file.originalname.match(/\.rtf$/i)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a .rtf file.", resErrorCode: 2 });
      const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
      if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
      const fileSizeKb = Math.round(req.file.size / 1024);
      try {
        const { execFile } = require("child_process");
        const tmpIn = path.join(os.tmpdir(), `fb_rtf_${Date.now()}.rtf`);
        fs.writeFileSync(tmpIn, req.file.buffer);
        await new Promise((resolve, reject) => {
          execFile("libreoffice", ["--headless", "--convert-to", "pdf", "--outdir", os.tmpdir(), tmpIn], (err) => {
            if (err) reject(err); else resolve();
          });
        });
        const tmpOut = tmpIn.replace(/\.rtf$/i, ".pdf");
        const outputBuffer = fs.readFileSync(tmpOut);
        fs.unlinkSync(tmpIn);
        fs.unlinkSync(tmpOut);
        const originalName = req.file.originalname.replace(/\.rtf$/i, "");
        await incrementUsage(user?.user_id, ip, tier, "rtf-to-pdf", "rtf", "pdf", fileSizeKb, "success");
        res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}.pdf"`, "Content-Length": outputBuffer.length });
        return res.status(200).send(outputBuffer);
      } catch (err) {
        console.error("RTF to PDF error:", err.message);
        await incrementUsage(user?.user_id, ip, tier, "rtf-to-pdf", "rtf", "pdf", fileSizeKb, "failed");
        return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
      }
    });
  }
);

// ── ODT TO PDF ─────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/pdf/odt-to-pdf", optionalAuth, async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    const odtUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limits.sizeMB * 1024 * 1024, files: 1 } }).single("file");
    odtUpload(req, res, async (err) => {
      if (err) return res.status(400).json({ resStatus: false, resMessage: "Upload error.", resErrorCode: 1 });
      if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded.", resErrorCode: 1 });
      if (!req.file.originalname.match(/\.odt$/i)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a .odt file.", resErrorCode: 2 });
      const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
      if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
      const fileSizeKb = Math.round(req.file.size / 1024);
      try {
        const { execFile } = require("child_process");
        const tmpIn = path.join(os.tmpdir(), `fb_odt_${Date.now()}.odt`);
        fs.writeFileSync(tmpIn, req.file.buffer);
        await new Promise((resolve, reject) => {
          execFile("libreoffice", ["--headless", "--convert-to", "pdf", "--outdir", os.tmpdir(), tmpIn], (err) => {
            if (err) reject(err); else resolve();
          });
        });
        const tmpOut = tmpIn.replace(/\.odt$/i, ".pdf");
        const outputBuffer = fs.readFileSync(tmpOut);
        fs.unlinkSync(tmpIn);
        fs.unlinkSync(tmpOut);
        const originalName = req.file.originalname.replace(/\.odt$/i, "");
        await incrementUsage(user?.user_id, ip, tier, "odt-to-pdf", "odt", "pdf", fileSizeKb, "success");
        res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${originalName}.pdf"`, "Content-Length": outputBuffer.length });
        return res.status(200).send(outputBuffer);
      } catch (err) {
        console.error("ODT to PDF error:", err.message);
        await incrementUsage(user?.user_id, ip, tier, "odt-to-pdf", "odt", "pdf", fileSizeKb, "failed");
        return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
      }
    });
  }
);

// ── PDF TO POWERPOINT ──────────────────────────────────────────────────────
// Extracts text per page and builds a .pptx — basic, not layout-preserving
router.post("/api/post/filebeef/pdf/to-pptx", optionalAuth, ipDailyLimit("pdf-to-pptx", 3), pdfUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser; const ip = getClientIp(req);
    const tier = getTier(user); const limits = getPdfLimits(tier);
    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: "Please upload a PDF.", resErrorCode: 2 });
    const MAX_MB = 10;
    if (req.file.size > MAX_MB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${MAX_MB}MB.`, resErrorCode: 3 });
    if (tier !== "pro") return res.status(403).json({ resStatus: false, resMessage: "PDF to PowerPoint is a Pro feature.", resErrorCode: 4, proOnly: true });
    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    const fileSizeKb = Math.round(req.file.size / 1024);
    try {
      const pptx = require("pptxgenjs");
      const MAX_PAGES = 50;
      const pdfDocCheck = await PDFDocument.load(req.file.buffer);
      if (pdfDocCheck.getPageCount() > MAX_PAGES) {
        return res.status(400).json({ resStatus: false, resMessage: `PDF has too many pages. Max ${MAX_PAGES} pages.`, resErrorCode: 8 });
      }
      const mode = req.body.mode === "image" ? "image" : "text";
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-pdf2pptx-"));
      let pptxBuffer;
      try {
        const inPath = path.join(tmpDir, "in.pdf");
        fs.writeFileSync(inPath, req.file.buffer);
        const prs = new pptx();

        if (mode === "image") {
          // exact appearance — each page rendered as a full-slide image
          const pagesToRender = pdfDocCheck.getPageCount();
          await execFileAsync("mutool", ["draw", "-r", "96", "-o", path.join(tmpDir, "page_%d.jpg"), inPath, `1-${pagesToRender}`]);
          const meta = await sharp(path.join(tmpDir, "page_1.jpg")).metadata();
          const W = 10; const H = Math.round((W * meta.height / meta.width) * 100) / 100;
          prs.defineLayout({ name: "pdfpage", width: W, height: H });
          prs.layout = "pdfpage";
          for (let i = 1; i <= pagesToRender; i++) {
            const slide = prs.addSlide();
            slide.addImage({ path: path.join(tmpDir, `page_${i}.jpg`), x: 0, y: 0, w: W, h: H });
          }
        } else {
          // editable text
          const txtPath = path.join(tmpDir, "out.txt");
          await execFileAsync("mutool", ["draw", "-F", "text", "-o", txtPath, inPath]);
          const raw = fs.readFileSync(txtPath, "utf8");
          const pages = raw.split(/\f/).filter(p => p.trim());
          if (!pages.length) {
            await incrementUsage(user?.user_id, ip, tier, "pdf-to-pptx", "pdf", "pptx", fileSizeKb, "failed");
            return res.status(400).json({ resStatus: false, resMessage: "No text found in this PDF. It may be scanned — try Exact appearance mode or the OCR tool.", resErrorCode: 7 });
          }
          for (const pageText of pages) {
            const slide = prs.addSlide();
            slide.addText(pageText.trim().substring(0, 1000), {
              x: 0.5, y: 0.5, w: "90%", h: "90%",
              fontSize: 12, fontFace: "Arial", color: "1a1a1a",
              wrap: true, valign: "top"
            });
          }
        }
        pptxBuffer = await prs.write({ outputType: "nodebuffer" });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      const originalName = req.file.originalname.replace(/\.pdf$/i, "");
      await incrementUsage(user?.user_id, ip, tier, "pdf-to-pptx", "pdf", "pptx", fileSizeKb, "success");
      res.set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${originalName}.pptx"`,
        "Content-Length": pptxBuffer.length
      });
      return res.status(200).send(pptxBuffer);
    } catch (err) {
      console.error("PDF to PPTX error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "pdf-to-pptx", "pdf", "pptx", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Conversion failed.", resErrorCode: 99 });
    }
  }
);

//code block for text tool of pdf editor
const MS_FONTS = '/usr/share/fonts/truetype/msttcorefonts'
const APP_FONTS = path.join(__dirname, 'fonts')
const EDITOR_FONT_FILES = {
  'dm sans':         { regular: path.join(APP_FONTS, 'DMSans-Regular.ttf'),  bold: path.join(APP_FONTS, 'DMSans-Bold.ttf') },
  'arial':           { regular: `${MS_FONTS}/Arial.ttf`,           bold: `${MS_FONTS}/Arial_Bold.ttf` },
  'times new roman': { regular: `${MS_FONTS}/Times_New_Roman.ttf`, bold: `${MS_FONTS}/Times_New_Roman_Bold.ttf` },
  'georgia':         { regular: `${MS_FONTS}/Georgia.ttf`,         bold: `${MS_FONTS}/Georgia_Bold.ttf` },
  'garamond':        { regular: '/usr/share/fonts/opentype/ebgaramond/EBGaramond12-Regular.otf', bold: '/usr/share/fonts/opentype/ebgaramond/EBGaramond12-Bold.otf' },
  'courier new':     { regular: `${MS_FONTS}/Courier_New.ttf`,     bold: `${MS_FONTS}/Courier_New_Bold.ttf` },
  'verdana':         { regular: `${MS_FONTS}/Verdana.ttf`,         bold: `${MS_FONTS}/Verdana_Bold.ttf` },
  'trebuchet ms':    { regular: `${MS_FONTS}/Trebuchet_MS.ttf`,    bold: `${MS_FONTS}/Trebuchet_MS_Bold.ttf` },
  'impact':          { regular: `${MS_FONTS}/Impact.ttf`,          bold: `${MS_FONTS}/Impact.ttf` },
  'dancing script':  { regular: path.join(APP_FONTS, 'DancingScript-Regular.ttf'), bold: path.join(APP_FONTS, 'DancingScript-Regular.ttf') },
  'great vibes':     { regular: path.join(APP_FONTS, 'GreatVibes-Regular.ttf'),    bold: path.join(APP_FONTS, 'GreatVibes-Regular.ttf') },
  'allura':          { regular: path.join(APP_FONTS, 'Allura-Regular.ttf'),        bold: path.join(APP_FONTS, 'Allura-Regular.ttf') },
  'sacramento':      { regular: path.join(APP_FONTS, 'Sacramento-Regular.ttf'),    bold: path.join(APP_FONTS, 'Sacramento-Regular.ttf') },
  'caveat brush':    { regular: path.join(APP_FONTS, 'CaveatBrush-Regular.ttf'),   bold: path.join(APP_FONTS, 'CaveatBrush-Regular.ttf') },
  'pacifico':        { regular: path.join(APP_FONTS, 'Pacifico-Regular.ttf'),      bold: path.join(APP_FONTS, 'Pacifico-Regular.ttf') },
  'zen dots':        { regular: path.join(APP_FONTS, 'ZenDots-Regular.ttf'),       bold: path.join(APP_FONTS, 'ZenDots-Regular.ttf') }
}
function editorFontKey(fontFamily) {
  if (!fontFamily) return null
  const first = String(fontFamily).split(',')[0].replace(/["']/g, '').trim().toLowerCase()
  return EDITOR_FONT_FILES[first] ? first : null
}

const editorUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: EDITOR_LIMITS.pro.sizeMB * 1024 * 1024, files: 1 }
})

router.post('/api/post/filebeef/pdf/editor', optionalAuth, editorUpload.single('file'), async (req, res) => {
  const user = req.filebeefUser
  const ip = getClientIp(req)
  const tier = getTier(user)
  const limits = EDITOR_LIMITS[tier] || EDITOR_LIMITS.anon

  // ── FILE CHECKS ──
  if (!req.file) return res.status(400).json({ resStatus: false, resMessage: 'No file uploaded.', resErrorCode: 1 })
  if (!isPdf(req.file)) return res.status(400).json({ resStatus: false, resMessage: 'Please upload a PDF.', resErrorCode: 2 })
  if (req.file.size > limits.sizeMB * 1024 * 1024) {
    return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB on your plan.`, resErrorCode: 3 })
  }

  // ── PARSE ANNOTATIONS ──
  let annotations
  try {
    annotations = JSON.parse(req.body.annotations || '[]')
  } catch (_) {
    return res.status(400).json({ resStatus: false, resMessage: 'Invalid annotations data.', resErrorCode: 4 })
  }

  if (!Array.isArray(annotations)) {
    return res.status(400).json({ resStatus: false, resMessage: 'Annotations must be an array.', resErrorCode: 4 })
  }

  // ── ANNOTATION COUNT CHECK ──
  if (annotations.length > limits.maxAnnotations) {
    return res.status(400).json({ resStatus: false, resMessage: `Too many annotations. Max ${limits.maxAnnotations} on your plan.`, resErrorCode: 5 })
  }

  // ── ANNOTATION TYPE CHECK ──
  const allowedTypes = limits.allowedTypes
  const VALID_TYPES = ['highlight', 'text', 'pen', 'sticky', 'rectangle', 'circle', 'arrow', 'image', 'signature', 'redact', 'eraser']
  for (const ann of annotations) {
    if (!VALID_TYPES.includes(ann.type)) {
      return res.status(400).json({ resStatus: false, resMessage: `Invalid annotation type: ${ann.type}`, resErrorCode: 6 })
    }
    if (!allowedTypes.includes(ann.type)) {
      return res.status(400).json({ resStatus: false, resMessage: `Annotation type "${ann.type}" is not allowed on your plan.`, resErrorCode: 7 })
    }
    if (!ann.page || typeof ann.page !== 'number' || ann.page < 1) {
      return res.status(400).json({ resStatus: false, resMessage: 'Invalid page number in annotation.', resErrorCode: 8 })
    }
    const coordFields = ['x', 'y', 'width', 'height', 'cx', 'cy', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2']
    for (const field of coordFields) {
      if (ann[field] !== undefined && typeof ann[field] !== 'number') {
        return res.status(400).json({ resStatus: false, resMessage: `Invalid coordinate "${field}" in annotation.`, resErrorCode: 9 })
      }
    }
    if ((ann.type === 'signature' || ann.type === 'image') && ann.data) {
      const sizeKB = Math.round(ann.data.length * 0.75 / 1024)
      const dataLimit = ann.type === 'image' ? (limits.imgMaxKB || limits.sigDataMaxKB) : limits.sigDataMaxKB
      if (sizeKB > dataLimit) {
        return res.status(400).json({ resStatus: false, resMessage: `Image data too large. Max ${dataLimit}KB.`, resErrorCode: 10 })
      }
    }
    if (ann.type === 'text' && typeof ann.text === 'string') {
      ann.text = ann.text.slice(0, 200)
    }
    if (ann.type === 'pen') {
      if (!Array.isArray(ann.path) || ann.path.length < 2) {
        return res.status(400).json({ resStatus: false, resMessage: 'Invalid pen path.', resErrorCode: 11 })
      }
      if (ann.path.length > 5000) {
        return res.status(400).json({ resStatus: false, resMessage: 'Pen path too long.', resErrorCode: 12 })
      }
    }
  }

  // ── DAILY SAVE LIMIT CHECK ──
  const saveCheck = await checkConversionLimit(user?.user_id, ip, tier)
  if (!saveCheck.allowed) {
    return res.status(403).json({
      resStatus: false,
      resMessage: `Daily save limit reached (${saveCheck.limit}/day on your plan). Upgrade to Pro for more.`,
      resErrorCode: 13,
      limitReached: true,
      tier
    })
  }

  const fileSizeKb = Math.round(req.file.size / 1024)

  try {
    const pdfDoc = await PDFDocument.load(req.file.buffer)
    const totalPages = pdfDoc.getPageCount()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    pdfDoc.registerFontkit(fontkit)

    const _editorFontCache = {}
    async function getEditorFont(fontFamily, fontWeight) {
      const key = editorFontKey(fontFamily)
      if (!key) return fontWeight === 'bold' ? boldFont : font
      const variant = fontWeight === 'bold' ? 'bold' : 'regular'
      const cacheKey = key + ':' + variant
      if (_editorFontCache[cacheKey]) return _editorFontCache[cacheKey]
      try {
        const bytes = fs.readFileSync(EDITOR_FONT_FILES[key][variant])
        const embedded = await pdfDoc.embedFont(bytes)
        _editorFontCache[cacheKey] = embedded
        return embedded
      } catch (_) {
        return fontWeight === 'bold' ? boldFont : font
      }
    }

    for (const ann of annotations) {
      if (ann.page > totalPages) continue

      const page = pdfDoc.getPage(ann.page - 1)
      const { width: pageWidth, height: pageHeight } = page.getSize()
      const c = hexToRgb(ann.color || '#000000')

      switch (ann.type) {

        case 'highlight': {
          const pdfY = pageHeight - ann.y - ann.height
          page.drawRectangle({
            x: ann.x, y: pdfY,
            width: ann.width, height: ann.height,
            color: rgb(c.r, c.g, c.b),
            opacity: ann.opacity || 0.4
          })
          break
        }

        case 'text': {
          // handled by Puppeteer canvas rendering below
          break
        }

        case 'sticky': {
          const noteW = ann.noteW || ann.width || 160
          const noteH = ann.noteH || ann.height || 80
          const fs = ann.fontSize || 14
          const pad = 8
          const innerW = noteW - pad * 2
          const lineH = fs * 1.3
          const maxLines = Math.max(1, Math.floor((noteH - pad * 2) / lineH))
          const noteFont = await getEditorFont(ann.fontFamily, 'normal')
          const pdfY = pageHeight - ann.y - noteH
          const bgColor = hexToRgb(ann.color || '#FFD600')
          page.drawRectangle({
            x: ann.x, y: pdfY,
            width: noteW, height: noteH,
            color: rgb(bgColor.r, bgColor.g, bgColor.b),
            opacity: ann.opacity || 0.85
          })

          // character-by-character wrap matching canvas measureText estimate
          const lines = []
          for (const paragraph of (ann.text || '').split('\n')) {
            let current = ''
            for (const char of paragraph) {
              const test = current + char
              if (test.length * fs * 0.6 > innerW && current) {
                lines.push(current)
                current = char
              } else {
                current = test
              }
            }
            if (current) lines.push(current)
            if (lines.length >= maxLines) break
          }

          // truncate with ellipsis
          let finalLines = lines.slice(0, maxLines)
          if (lines.length > maxLines) {
            let last = finalLines[maxLines - 1]
            while (last.length > 0 && (last + '...').length * fs * 0.6 > innerW) {
              last = last.slice(0, -1)
            }
            finalLines[maxLines - 1] = last + '...'
          }

            finalLines.forEach((line, i) => {
            const safeLine = line.replace(/[<>&"']/g, '')
            if (safeLine) {
              page.drawText(safeLine, {
                x: ann.x + pad,
                y: pdfY + noteH - pad - fs - i * lineH,
                size: fs, font: noteFont,
                color: rgb(0, 0, 0), opacity: 1
              })
            }
          })
          break
        }

        case 'pen': {
          const d = 'M ' + ann.path.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')
          page.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round))
          page.drawSvgPath(d, {
            x: 0,
            y: pageHeight,
            borderColor: rgb(c.r, c.g, c.b),
            borderWidth: ann.strokeSize || 3,
            borderOpacity: ann.opacity || 1,
            borderLineCap: LineCapStyle.Round
          })
          page.pushOperators(popGraphicsState())
          break
        }

        case 'rectangle': {
          const pdfY = pageHeight - ann.y - ann.height
          page.drawRectangle({
            x: ann.x, y: pdfY,
            width: ann.width, height: ann.height,
            borderColor: rgb(c.r, c.g, c.b),
            borderWidth: ann.strokeSize || 3,
            opacity: ann.opacity || 1
          })
          break
        }

        case 'circle': {
          page.drawEllipse({
            x: ann.cx, y: pageHeight - ann.cy,
            xScale: ann.rx, yScale: ann.ry,
            borderColor: rgb(c.r, c.g, c.b),
            borderWidth: ann.strokeSize || 3,
            opacity: ann.opacity || 1
          })
          break
        }

        case 'arrow': {
          const angle = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1)
          const size = 10 + (ann.strokeSize || 3) * 2
          const shaftEndX = ann.x2 - size * 0.8 * Math.cos(angle)
          const shaftEndY = ann.y2 - size * 0.8 * Math.sin(angle)
          const arrowColor = rgb(c.r, c.g, c.b)
          const arrowOpacity = ann.opacity || 1
          // shaft
          page.drawLine({
            start: { x: ann.x1, y: pageHeight - ann.y1 },
            end:   { x: shaftEndX, y: pageHeight - shaftEndY },
            thickness: ann.strokeSize || 3,
            color: arrowColor,
            opacity: arrowOpacity
          })
          // filled arrowhead triangle using low-level PDF operators
          const tipX  = ann.x2
          const tipY  = pageHeight - ann.y2
          const leftX  = ann.x2 - size * Math.cos(angle - Math.PI / 7)
          const leftY  = pageHeight - (ann.y2 - size * Math.sin(angle - Math.PI / 7))
          const rightX = ann.x2 - size * Math.cos(angle + Math.PI / 7)
          const rightY = pageHeight - (ann.y2 - size * Math.sin(angle + Math.PI / 7))
          const pgs = pushGraphicsState
          const pgsp = popGraphicsState
          page.pushOperators(
            pgs(),
            setFillingColor(arrowColor),
            moveTo(tipX, tipY),
            lineTo(leftX, leftY),
            lineTo(rightX, rightY),
            closePath(),
            fill(),
            pgsp()
          )
          break
        }

        case 'redact': {
          const pdfY = pageHeight - ann.y - ann.height
          const rc = hexToRgb(ann.color || '#000000')
          page.drawRectangle({
            x: ann.x, y: pdfY,
            width: ann.width, height: ann.height,
            color: rgb(rc.r, rc.g, rc.b),
            opacity: 1
          })
          break
        }

        case 'signature':
        case 'image': {
          if (!ann.data) break
          try {
            const base64Data = ann.data.split(',')[1]
            if (!base64Data) break
            const imgBuffer = Buffer.from(base64Data, 'base64')
            let embeddedImg
            if (ann.data.startsWith('data:image/png')) {
              embeddedImg = await pdfDoc.embedPng(imgBuffer)
            } else {
              embeddedImg = await pdfDoc.embedJpg(imgBuffer)
            }
            const pdfY = pageHeight - ann.y - ann.height
            page.drawImage(embeddedImg, {
              x: ann.x, y: pdfY,
              width: ann.width, height: ann.height,
              opacity: ann.opacity || 1
            })
          } catch (_) { /* skip invalid image */ }
          break
        }
      }
    }

    // ── PUPPETEER CANVAS RENDERING (erase + text annotations) ──
    let eraseStrokes = []
    try {
      eraseStrokes = JSON.parse(req.body.eraseStrokes || '[]')
    } catch (_) {}

    // collect erase strokes by page
    const eraseByPage = {}
    if (Array.isArray(eraseStrokes)) {
      if (eraseStrokes.length > 1000) eraseStrokes = eraseStrokes.slice(0, 1000)
      for (const stroke of eraseStrokes) {
        if (!stroke.page || stroke.page > totalPages) continue
        if (typeof stroke.x !== 'number' || typeof stroke.y !== 'number') continue
        if (stroke._rect) {
          if (typeof stroke.w !== 'number' || typeof stroke.h !== 'number') continue
        } else {
          if (typeof stroke.size !== 'number') continue
        }
        if (!eraseByPage[stroke.page]) eraseByPage[stroke.page] = []
        eraseByPage[stroke.page].push(stroke)
      }
    }

    // collect text annotations by page
    const textByPage = {}
    for (const ann of annotations) {
      if (ann.type !== 'text') continue
      if (!textByPage[ann.page]) textByPage[ann.page] = []
      textByPage[ann.page].push(ann)
    }

    // union of all pages needing Puppeteer
    const puppeteerPages = new Set([
      ...Object.keys(eraseByPage).map(Number),
      ...Object.keys(textByPage).map(Number)
    ])

    if (puppeteerPages.size > 0) {
      const puppeteer = require('puppeteer')
      const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })

      for (const pageNum of puppeteerPages) {
        const pdfPage = pdfDoc.getPage(pageNum - 1)
        const { width: pageWidth, height: pageHeight } = pdfPage.getSize()
        const SCALE = 4
        const pw = Math.round(pageWidth * SCALE)
        const ph = Math.round(pageHeight * SCALE)

        const singleDoc = await PDFDocument.create()
        const [copiedPage] = await singleDoc.copyPages(pdfDoc, [pageNum - 1])
        singleDoc.addPage(copiedPage)
        const singleBuf = Buffer.from(await singleDoc.save())
        const b64 = singleBuf.toString('base64')

        const bpage = await browser.newPage()
        await bpage.setViewport({ width: pw, height: ph, deviceScaleFactor: 1 })
        // collect unique font families needed for this page
        const pageFonts = [...new Set((textByPage[pageNum] || []).map(a => a.fontFamily).filter(Boolean))]
        const googleFontsUrl = pageFonts.length > 0
          ? `https://fonts.googleapis.com/css2?${pageFonts.map(f => {
              const name = f.split(',')[0].trim().replace(/['"]/g, '')
              return `family=${encodeURIComponent(name)}:wght@400;700`
            }).join('&')}&display=swap`
          : null

        await bpage.setContent(`<!DOCTYPE html>
<html>
<head>
${googleFontsUrl ? `<link rel="stylesheet" href="${googleFontsUrl}">` : ''}
<style>*{margin:0;padding:0;}html,body{width:${pw}px;height:${ph}px;background:#fff;overflow:hidden;}</style>
</head>
<body>
<canvas id="pdfCanvas" width="${pw}" height="${ph}"></canvas>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const data = atob('${b64}');
const arr = new Uint8Array(data.length);
for (let i = 0; i < data.length; i++) arr[i] = data.charCodeAt(i);
pdfjsLib.getDocument({ data: arr }).promise.then(function(pdf) {
  pdf.getPage(1).then(function(page) {
    const viewport = page.getViewport({ scale: ${SCALE} });
    const canvas = document.getElementById('pdfCanvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise.then(function() {
      window._pdfRendered = true;
    });
  });
});
</script>
</body>
</html>`)
        await bpage.waitForFunction('window._pdfRendered === true', { timeout: 15000 })
        // paint erase strokes
        const strokes = eraseByPage[pageNum] || []
        if (strokes.length > 0) {
          await bpage.evaluate((strokes, scale) => {
            const ctx = document.getElementById('pdfCanvas').getContext('2d')
            ctx.fillStyle = '#ffffff'
            for (const stroke of strokes) {
              if (stroke._rect) {
                ctx.fillRect(stroke.x * scale, stroke.y * scale, stroke.w * scale, stroke.h * scale)
              } else {
                const half = (stroke.size * scale) / 2
                ctx.fillRect(stroke.x * scale - half, stroke.y * scale - half, stroke.size * scale, stroke.size * scale)
              }
            }
          }, strokes, SCALE)
        }

        // paint text annotations
        const textAnns = textByPage[pageNum] || []
        if (textAnns.length > 0) {
          const textZoom = parseFloat(req.body.zoom) || 1
          const textDpr = parseFloat(req.body.dpr) || 1
          await bpage.evaluate(async (anns, scale, zoom, dpr) => {
            const ctx = document.getElementById('pdfCanvas').getContext('2d')
            // load all required fonts before drawing
            const fontLoads = []
            for (const ann of anns) {
              const fw = ann.fontWeight === 'bold' ? 'bold ' : ann.fontWeight === 'italic' ? 'italic ' : ''
              const fs = (ann.fontSize || 14) * scale
              const familyName = (ann.fontFamily || 'sans-serif').split(',')[0].trim().replace(/['"]/g, '')
              fontLoads.push(document.fonts.load(`${fw}${fs}px "${familyName}"`, ann.text || 'a').catch(() => {}))
            }
            await Promise.all(fontLoads)
            for (const ann of anns) {
              const fw = ann.fontWeight === 'bold' ? 'bold ' : ann.fontWeight === 'italic' ? 'italic ' : ''
              const fs = (ann.fontSize || 14) * scale
              const lineH = fs * 1.3
              ctx.save()
              ctx.globalAlpha = ann.opacity || 1
              ctx.fillStyle = ann.color || '#000000'
              ctx.font = `${fw}${fs}px ${ann.fontFamily || 'sans-serif'}`
              const textCanvasH = document.getElementById('pdfCanvas').height - Math.round(6 * scale / (zoom * dpr))
              const textCanvasW = document.getElementById('pdfCanvas').width
              const textMaxLineW = textCanvasW - ann.x * scale - Math.round(6 * scale / (zoom * dpr))
              let textCurrentRow = 0
              for (const textRawLine of ann.text.split('\n')) {
                if (ann.preWrapped) {
                  const textLineY = ann.y * scale + textCurrentRow * lineH
                  if (textRawLine && textLineY > 0 && textLineY <= textCanvasH) {
                    ctx.fillText(textRawLine, ann.x * scale, textLineY)
                  }
                  textCurrentRow++
                } else {
                  // wrap character by character matching frontend drawAnnotation
                  let textChunk = ''
                  for (const textChar of textRawLine) {
                    if (ctx.measureText(textChunk + textChar).width > textMaxLineW) {
                      const textChunkY = ann.y * scale + textCurrentRow * lineH
                      if (textChunk && textChunkY > 0 && textChunkY <= textCanvasH) {
                        ctx.fillText(textChunk, ann.x * scale, textChunkY)
                      }
                      textChunk = textChar
                      textCurrentRow++
                    } else {
                      textChunk += textChar
                    }
                  }
                  if (textChunk) {
                    const textChunkY = ann.y * scale + textCurrentRow * lineH
                    if (textChunkY > 0 && textChunkY <= textCanvasH) {
                      ctx.fillText(textChunk, ann.x * scale, textChunkY)
                    }
                  }
                  textCurrentRow++
                }
              }
              ctx.restore()
            }
          }, textAnns, SCALE, textZoom, textDpr)
        }
        const imgBuf = await bpage.screenshot({ type: 'png', clip: { x: 0, y: 0, width: pw, height: ph } })
        await bpage.close()

        const embeddedImg = await pdfDoc.embedPng(imgBuf)
        pdfPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: rgb(1, 1, 1), opacity: 1 })
        pdfPage.drawImage(embeddedImg, { x: 0, y: 0, width: pageWidth, height: pageHeight, opacity: 1 })
      }

      await browser.close()
    }

    // ── WATERMARK FOR anon ──
    if (limits.watermark) {
      const watermarkFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
      const pages = pdfDoc.getPages()
      for (const page of pages) {
        const { width, height } = page.getSize()
        const text = 'Made with FileBeef'
        const fontSize = 10
        const textWidth = watermarkFont.widthOfTextAtSize(text, fontSize)
        page.drawText(text, {
          x: width - textWidth - 10,
          y: 10,
          size: fontSize,
          font: watermarkFont,
          color: rgb(0.6, 0.6, 0.6),
          opacity: 0.7
        })
      }
    }

    const outputBuffer = await pdfDoc.save()
    const originalName = req.file.originalname.replace(/\.pdf$/i, '')

    await incrementUsage(user?.user_id, ip, tier, 'pdf-editor', 'pdf', 'pdf', fileSizeKb, 'success')

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${originalName}_edited.pdf"`,
      'Content-Length': outputBuffer.length
    })
    return res.status(200).send(Buffer.from(outputBuffer))

  } catch (err) {
    console.error('PDF editor error:', err.message)
    await incrementUsage(user?.user_id, ip, tier, 'pdf-editor', 'pdf', 'pdf', fileSizeKb, 'failed')
    return res.status(500).json({ resStatus: false, resMessage: 'Failed to apply annotations.', resErrorCode: 99 })
  }
})

// ── HEX TO RGB HELPER ──────────────────────────────────────────────────────
function hexToRgb(hex) {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16) / 255
  const g = parseInt(clean.substring(2, 4), 16) / 255
  const b = parseInt(clean.substring(4, 6), 16) / 255
  return { r: isNaN(r) ? 0 : r, g: isNaN(g) ? 0 : g, b: isNaN(b) ? 0 : b }
}


// ── COMMENTS ────────────────────────────────────────────────────────────────
function fbSanitizeText(s, max) {
  return String(s || "").replace(/<[^>]*>/g, "").replace(/[<>]/g, "").trim().slice(0, max);
}

// READ — anyone (guest/anon included). Newest comments first, replies oldest first.
router.get("/api/get/filebeef/comments", async (req, res) => {
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const limit  = 20;
  try {
    const top = await pool.query(
      `SELECT id, author_name, body, created_at
       FROM filebeef_comments
       WHERE parent_id IS NULL
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    let replies = [];
    if (top.rows.length) {
      const ids = top.rows.map(c => c.id);
      const rep = await pool.query(
        `SELECT id, parent_id, author_name, body, created_at
         FROM filebeef_comments
         WHERE parent_id = ANY($1)
         ORDER BY created_at ASC`,
        [ids]
      );
      replies = rep.rows;
    }
    const byParent = {};
    for (const r of replies) (byParent[r.parent_id] ||= []).push(r);
    const comments = top.rows.map(c => ({ ...c, replies: byParent[c.id] || [] }));
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM filebeef_comments WHERE parent_id IS NULL`);
    return res.status(200).json({ resStatus: true, comments, total: count.rows[0].n, offset, limit });
  } catch (err) {
    console.error("Comments fetch error:", err.message);
    return res.status(500).json({ resStatus: false, resMessage: "Could not load comments.", resErrorCode: 99 });
  }
});

// POST COMMENT — logged-in free/pro only.
router.post("/api/post/filebeef/comments", optionalAuth, async (req, res) => {
  const user = req.filebeefUser;
  if (!user) return res.status(401).json({ resStatus: false, resMessage: "You must be logged in to comment.", resErrorCode: 1 });
  const tier = getTier(user);
  if (tier !== "free" && tier !== "pro") return res.status(403).json({ resStatus: false, resMessage: "Not allowed.", resErrorCode: 2 });

  const ip   = getClientIp(req);
  const name = fbSanitizeText(req.body?.name, 30);
  const body = fbSanitizeText(req.body?.body, 400);
  if (name.length < 1) return res.status(400).json({ resStatus: false, resMessage: "Please enter a name.", resErrorCode: 3 });
  if (body.length < 1) return res.status(400).json({ resStatus: false, resMessage: "Comment cannot be empty.", resErrorCode: 4 });

  const cd = fbCommentCheck(user.user_id, ip);
  if (!cd.allowed) return res.status(429).json({ resStatus: false, resMessage: `Please wait ${cd.retryAfterMin} min before posting again.`, resErrorCode: 5, rateLimited: true });

  try {
    const ins = await pool.query(
      `INSERT INTO filebeef_comments (parent_id, user_id, author_name, body, ip)
       VALUES (NULL, $1, $2, $3, $4)
       RETURNING id, author_name, body, created_at`,
      [user.user_id, name, body, ip]
    );
    fbCommentMark(user.user_id, ip);
    return res.status(200).json({ resStatus: true, comment: { ...ins.rows[0], replies: [] } });
  } catch (err) {
    console.error("Comment insert error:", err.message);
    return res.status(500).json({ resStatus: false, resMessage: "Could not post comment.", resErrorCode: 99 });
  }
});

// POST REPLY — logged-in free/pro only. Single level, max 10 per comment.
router.post("/api/post/filebeef/comments/reply", optionalAuth, async (req, res) => {
  const user = req.filebeefUser;
  if (!user) return res.status(401).json({ resStatus: false, resMessage: "You must be logged in to reply.", resErrorCode: 1 });
  const tier = getTier(user);
  if (tier !== "free" && tier !== "pro") return res.status(403).json({ resStatus: false, resMessage: "Not allowed.", resErrorCode: 2 });

  const ip       = getClientIp(req);
  const parentId = parseInt(req.body?.parentId);
  const name     = fbSanitizeText(req.body?.name, 30);
  const body     = fbSanitizeText(req.body?.body, 150);
  if (!parentId)       return res.status(400).json({ resStatus: false, resMessage: "Missing parent comment.", resErrorCode: 3 });
  if (name.length < 1) return res.status(400).json({ resStatus: false, resMessage: "Please enter a name.", resErrorCode: 4 });
  if (body.length < 1) return res.status(400).json({ resStatus: false, resMessage: "Reply cannot be empty.", resErrorCode: 5 });

  const cd = fbCommentCheck(user.user_id, ip);
  if (!cd.allowed) return res.status(429).json({ resStatus: false, resMessage: `Please wait ${cd.retryAfterMin} min before posting again.`, resErrorCode: 6, rateLimited: true });

  try {
    const parent = await pool.query(`SELECT id, parent_id FROM filebeef_comments WHERE id = $1 LIMIT 1`, [parentId]);
    if (!parent.rowCount)                return res.status(404).json({ resStatus: false, resMessage: "Comment not found.", resErrorCode: 7 });
    if (parent.rows[0].parent_id !== null) return res.status(400).json({ resStatus: false, resMessage: "Cannot reply to a reply.", resErrorCode: 8 });

    const cnt = await pool.query(`SELECT COUNT(*)::int AS n FROM filebeef_comments WHERE parent_id = $1`, [parentId]);
    if (cnt.rows[0].n >= 10) return res.status(403).json({ resStatus: false, resMessage: "This comment has reached the maximum of 10 replies.", resErrorCode: 9, replyLimit: true });

    const ins = await pool.query(
      `INSERT INTO filebeef_comments (parent_id, user_id, author_name, body, ip)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, parent_id, author_name, body, created_at`,
      [parentId, user.user_id, name, body, ip]
    );
    fbCommentMark(user.user_id, ip);
    return res.status(200).json({ resStatus: true, reply: ins.rows[0] });
  } catch (err) {
    console.error("Reply insert error:", err.message);
    return res.status(500).json({ resStatus: false, resMessage: "Could not post reply.", resErrorCode: 99 });
  }
});


module.exports = router;




