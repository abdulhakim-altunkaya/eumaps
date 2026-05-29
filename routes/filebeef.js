const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcrypt");


const { pool, supabase, upload } = require("../db");
const useragent = require("useragent");
const axios = require("axios");

const jwt = require("jsonwebtoken");
const { pool, upload } = require("../db");
const sendEmailBrevo = require("../utils/sendEmailBrevo");
const { OAuth2Client } = require("google-auth-library");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const FRONTEND_URL    = process.env.FRONTEND_URL_FILEBEEF || "https://filebeef.com";
const JWT_EMAIL       = process.env.JWT_SECRET_FILEBEEF_EMAIL_VERIFY;
const JWT_SECRET      = process.env.JWT_SECRET;
const SALT_ROUNDS     = 10;
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 365; // 1 year in ms
const FREE_DAILY_LIMIT = 10;

// ── HELPERS ────────────────────────────────────────────────────────────────
function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  let ip = xf ? xf.split(",")[0].trim() : req.socket?.remoteAddress || req.ip;
  if (ip?.startsWith("::ffff:")) ip = ip.slice(7);
  return ip || "unknown";
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

async function createSession(userId, ip, userAgent) {
  const token = crypto.randomBytes(64).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE);
  await pool.query(
    `INSERT INTO filebeef_sessions (user_id, token, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, token, ip, userAgent || null, expiresAt]
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
    // auto-downgrade expired pro plans
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

// ── RATE LIMITER (filebeef-specific, in-memory) ───────────────────────────
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

// ── DAILY LIMIT CHECK ─────────────────────────────────────────────────────
async function checkDailyLimit(req, res, next) {
  const user = req.filebeefUser;
  if (user.plan === "pro") return next(); // pro = unlimited
  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await pool.query(
      `SELECT count FROM filebeef_daily_usage WHERE user_id = $1 AND date = $2`,
      [user.user_id, today]
    );
    const used = result.rows[0]?.count || 0;
    if (used >= FREE_DAILY_LIMIT) {
      return res.status(403).json({
        resStatus: false,
        resMessage: `Daily limit reached (${FREE_DAILY_LIMIT}/day on free plan). Upgrade to Pro for unlimited conversions.`,
        resErrorCode: 403
      });
    }
    next();
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
}

// ── LOG USAGE ─────────────────────────────────────────────────────────────
async function logUsage(userId, tool, inputFormat, outputFormat, fileSizeKb, status, ip) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO filebeef_usage (user_id, tool, input_format, output_format, file_size_kb, status, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, tool, inputFormat || null, outputFormat || null, fileSizeKb || null, status, ip]
    );
    await pool.query(
      `INSERT INTO filebeef_daily_usage (user_id, date, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (user_id, date) DO UPDATE SET count = filebeef_daily_usage.count + 1`,
      [userId, today]
    );
  } catch (_) {
    // silent — don't break conversion if logging fails
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════════════════

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

    // check if email already exists
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
      `INSERT INTO filebeef_users (email, password_hash, auth_provider, verified, verification_token)
       VALUES ($1, $2, 'email', false, $3)`,
      [email.toLowerCase().trim(), passwordHash, verificationToken]
    );

    // send verification email
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
      `SELECT id, email, password_hash, auth_provider, verified, plan
       FROM filebeef_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    if (!result.rowCount) {
      return res.status(401).json({ resStatus: false, resMessage: "Invalid email or password", resErrorCode: 2 });
    }
    const user = result.rows[0];

    if (user.auth_provider === "google") {
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

    const token = await createSession(user.id, ip, userAgent);
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

    // check if email exists with password auth
    const existingEmail = await client.query(
      `SELECT id, auth_provider FROM filebeef_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    if (existingEmail.rowCount && existingEmail.rows[0].auth_provider === "email") {
      return res.status(409).json({
        resStatus: false,
        resMessage: "This email is registered with a password. Please log in with email and password.",
        resErrorCode: 2
      });
    }

    // upsert user
    const result = await client.query(
      `INSERT INTO filebeef_users (email, auth_provider, google_id, verified)
       VALUES ($1, 'google', $2, true)
       ON CONFLICT (google_id) DO UPDATE SET email = EXCLUDED.email, updated_at = NOW()
       RETURNING id, email, plan`,
      [email.toLowerCase().trim(), googleId]
    );
    const user = result.rows[0];

    const token = await createSession(user.id, ip, userAgent);
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
      pool.query(`SELECT created_at, auth_provider, plan, plan_interval, plan_expires_at FROM filebeef_users WHERE id = $1`, [user.user_id])
    ]);
    const userData = userResult.rows[0];
    return res.status(200).json({
      resStatus: true,
      resOkCode: 1,
      email: user.email,
      plan: userData.plan,
      authProvider: userData.auth_provider,
      billingInterval: userData.plan_interval,
      expiresAt: userData.plan_expires_at,
      todayCount: dailyResult.rows[0]?.count || 0,
      totalCount: totalResult.rows[0]?.count || 0,
      createdAt: userData.created_at
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// ── FORGOT PASSWORD ───────────────────────────────────────────────────────
router.post("/api/post/filebeef/auth/forgot-password", filebeefWriteLimit, async (req, res) => {
  const { email } = req.body;
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
    // always return success to prevent email enumeration
    if (!result.rowCount || result.rows[0].auth_provider === "google") {
      return res.status(200).json({ resStatus: true, resMessage: "If that email exists, a reset link was sent.", resOkCode: 1 });
    }
    const userId = result.rows[0].id;
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    await client.query(
      `UPDATE filebeef_users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3`,
      [resetToken, resetExpires, userId]
    );

    const resetJwt = jwt.sign({ userId, token: resetToken }, JWT_EMAIL, { expiresIn: "1h" });
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
    await client.query(
      `UPDATE filebeef_users SET password_hash = $1, reset_token = null, reset_token_expires = null, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, decoded.userId]
    );
    // invalidate all sessions after password reset
    await client.query(`DELETE FROM filebeef_sessions WHERE user_id = $1`, [decoded.userId]);

    return res.status(200).json({ resStatus: true, resMessage: "Password updated. Please log in.", resOkCode: 1 });

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
  if (req.filebeefUser.auth_provider === "google") {
    return res.status(400).json({ resStatus: false, resMessage: "Google accounts cannot change password here", resErrorCode: 3 });
  }

  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT password_hash FROM filebeef_users WHERE id = $1`, [userId]
    );
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
    // cascades handle sessions, usage, daily_usage, payments
    await client.query(`DELETE FROM filebeef_users WHERE id = $1`, [userId]);
    res.clearCookie("filebeef_session", { path: "/", sameSite: "none", secure: true });
    return res.status(200).json({ resStatus: true, resMessage: "Account deleted", resOkCode: 1 });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  } finally {
    if (client) client.release();
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  EXPORTS (conversion routes will be added below in next steps)
// ══════════════════════════════════════════════════════════════════════════
module.exports = router;