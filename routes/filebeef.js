const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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

// ── DAILY LIMIT CHECK ──────────────────────────────────────────────────────
async function checkDailyLimit(req, res, next) {
  const user = req.filebeefUser;
  if (user.plan === "pro") return next();
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

// ── LOG USAGE ──────────────────────────────────────────────────────────────
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
  } catch (_) {}
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
        const expiresAt = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
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

const sharp = require("sharp");
const multer = require("multer");

// ── LIMITS PER TIER ────────────────────────────────────────────────────────
const LIMITS = {
  anon:       { daily: 1,  sizeMB: 5  },
  free:       { daily: 2,  sizeMB: 10 },
  pro:        { daily: 50, sizeMB: 15 }
};

// ── ALLOWED IMAGE TYPES ────────────────────────────────────────────────────
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg", "image/png", "image/webp",
  "image/avif", "image/gif", "image/heic", "image/heif"
];

// ── MULTER FOR IMAGES ──────────────────────────────────────────────────────
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.pro.sizeMB * 1024 * 1024, files: 1 }
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
  const limit = LIMITS[tier].daily;
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
    const limits = LIMITS[tier];

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

    // mime type check
    if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype)) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Unsupported file type. Allowed: PNG, JPG, WEBP, AVIF, GIF.",
        resErrorCode: 3
      });
    }

    // format check
    const format = req.body.format || "jpeg";
    const quality = Math.min(100, Math.max(1, parseInt(req.body.quality) || 75));
    const allowedFormats = ["jpeg", "png", "webp", "avif"];
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

    const inputFormat = req.file.mimetype.split("/")[1] || "unknown";
    const fileSizeKb = Math.round(req.file.size / 1024);

    try {
      let sharpInstance = sharp(req.file.buffer);

      switch (format) {
        case "jpeg":
          sharpInstance = sharpInstance.jpeg({ quality });
          break;
        case "png":
          sharpInstance = sharpInstance.png({ compressionLevel: Math.round((100 - quality) / 11) });
          break;
        case "webp":
          sharpInstance = sharpInstance.webp({ quality });
          break;
        case "avif":
          sharpInstance = sharpInstance.avif({ quality });
          break;
      }

      const outputBuffer = await sharpInstance.toBuffer();
      const ext = format === "jpeg" ? "jpg" : format;
      const mimeType = format === "jpeg" ? "image/jpeg" : `image/${format}`;
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
    const limits = LIMITS[tier];

    if (!req.file) {
      return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    }
    if (req.file.size > limits.sizeMB * 1024 * 1024) {
      return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB on your plan.`, resErrorCode: 2 });
    }
    if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype)) {
      return res.status(400).json({ resStatus: false, resMessage: "Unsupported file type.", resErrorCode: 3 });
    }

    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) {
      return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });
    }

    const quality = Math.min(100, Math.max(1, parseInt(req.body.quality) || 75));
    const width = req.body.width ? parseInt(req.body.width) : null;
    const height = req.body.height ? parseInt(req.body.height) : null;
    const inputFormat = req.file.mimetype.split("/")[1] || "unknown";
    const fileSizeKb = Math.round(req.file.size / 1024);

    try {
      let sharpInstance = sharp(req.file.buffer);

      if (width || height) {
        sharpInstance = sharpInstance.resize(width || null, height || null, { withoutEnlargement: true, fit: "inside" });
      }

      // output in same format as input, default jpeg
      const outputFormat = inputFormat === "png" ? "png" : inputFormat === "webp" ? "webp" : "jpeg";
      if (outputFormat === "png") sharpInstance = sharpInstance.png({ compressionLevel: Math.round((100 - quality) / 11) });
      else if (outputFormat === "webp") sharpInstance = sharpInstance.webp({ quality });
      else sharpInstance = sharpInstance.jpeg({ quality });

      const outputBuffer = await sharpInstance.toBuffer();
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
    }
  }
);

// ── FLIP & ROTATE ──────────────────────────────────────────────────────────
router.post("/api/post/filebeef/image/flip-rotate", optionalAuth, imageUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser;
    const ip = getClientIp(req);
    const tier = getTier(user);
    const limits = LIMITS[tier];

    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 2 });
    if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype)) return res.status(400).json({ resStatus: false, resMessage: "Unsupported file type.", resErrorCode: 3 });

    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });

    const rotate = parseInt(req.body.rotate) || 0;       // 0, 90, 180, 270
    const flipH = req.body.flipH === "true";              // horizontal flip
    const flipV = req.body.flipV === "true";              // vertical flip
    const inputFormat = req.file.mimetype.split("/")[1] || "unknown";
    const fileSizeKb = Math.round(req.file.size / 1024);

    try {
      let sharpInstance = sharp(req.file.buffer);
      if (rotate) sharpInstance = sharpInstance.rotate(rotate);
      if (flipH) sharpInstance = sharpInstance.flop();
      if (flipV) sharpInstance = sharpInstance.flip();

      const outputFormat = inputFormat === "png" ? "png" : inputFormat === "webp" ? "webp" : "jpeg";
      if (outputFormat === "png") sharpInstance = sharpInstance.png();
      else if (outputFormat === "webp") sharpInstance = sharpInstance.webp();
      else sharpInstance = sharpInstance.jpeg({ quality: 90 });

      const outputBuffer = await sharpInstance.toBuffer();
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
      console.error("Flip/rotate error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "image-flip-rotate", inputFormat, null, fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Operation failed.", resErrorCode: 99 });
    }
  }
);

// ── EXIF REMOVER ───────────────────────────────────────────────────────────
router.post("/api/post/filebeef/image/exif-remove", optionalAuth, imageUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser;
    const ip = getClientIp(req);
    const tier = getTier(user);
    const limits = LIMITS[tier];

    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 2 });
    if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype)) return res.status(400).json({ resStatus: false, resMessage: "Unsupported file type.", resErrorCode: 3 });

    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });

    const inputFormat = req.file.mimetype.split("/")[1] || "unknown";
    const fileSizeKb = Math.round(req.file.size / 1024);

    try {
      // sharp strips EXIF by default when converting
      const outputFormat = inputFormat === "png" ? "png" : inputFormat === "webp" ? "webp" : "jpeg";
      let sharpInstance = sharp(req.file.buffer).withMetadata(false);

      if (outputFormat === "png") sharpInstance = sharpInstance.png();
      else if (outputFormat === "webp") sharpInstance = sharpInstance.webp();
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

// ── HEIC TO JPG ────────────────────────────────────────────────────────────
router.post("/api/post/filebeef/image/heic-to-jpg", optionalAuth, imageUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser;
    const ip = getClientIp(req);
    const tier = getTier(user);
    const limits = LIMITS[tier];

    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 2 });

    const allowedHeic = ["image/heic", "image/heif"];
    if (!allowedHeic.includes(req.file.mimetype)) {
      return res.status(400).json({ resStatus: false, resMessage: "Please upload a HEIC or HEIF file.", resErrorCode: 3 });
    }

    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });

    const quality = Math.min(100, Math.max(1, parseInt(req.body.quality) || 90));
    const fileSizeKb = Math.round(req.file.size / 1024);

    try {
      const heicConvert = require("heic-convert");
      const outputBuffer = await heicConvert({
        buffer: req.file.buffer,
        format: "JPEG",
        quality: quality / 100
      });

      const originalName = req.file.originalname.replace(/\.[^.]+$/, "");
      await incrementUsage(user?.user_id, ip, tier, "heic-to-jpg", "heic", "jpeg", fileSizeKb, "success");

      res.set({
        "Content-Type": "image/jpeg",
        "Content-Disposition": `attachment; filename="${originalName}.jpg"`,
        "Content-Length": outputBuffer.length
      });
      return res.status(200).send(Buffer.from(outputBuffer));

    } catch (err) {
      console.error("HEIC convert error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "heic-to-jpg", "heic", "jpeg", fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "HEIC conversion failed.", resErrorCode: 99 });
    }
  }
);

// ── SVG OPTIMIZER ──────────────────────────────────────────────────────────
router.post("/api/post/filebeef/image/svg-optimize", optionalAuth, async (req, res) => {
    const user = req.filebeefUser;
    const ip = getClientIp(req);
    const tier = getTier(user);

    // SVG size limits (smaller than images)
    const svgLimits = { anon: 1, free: 2, pro: 5 };
    const sizeLimitMB = svgLimits[tier];

    const svgUpload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: svgLimits.pro * 1024 * 1024, files: 1 }
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
        const { optimize } = require("svgo");
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

// ── COLOR PALETTE ──────────────────────────────────────────────────────────
router.post("/api/post/filebeef/image/color-palette", optionalAuth, imageUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser;
    const ip = getClientIp(req);
    const tier = getTier(user);
    const limits = LIMITS[tier];

    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 2 });
    if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype)) return res.status(400).json({ resStatus: false, resMessage: "Unsupported file type.", resErrorCode: 3 });

    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });

    const fileSizeKb = Math.round(req.file.size / 1024);
    const colorCount = Math.min(10, Math.max(3, parseInt(req.body.colorCount) || 6));

    try {
      // resize to small thumbnail for fast color extraction
      const { data, info } = await sharp(req.file.buffer)
        .resize(150, 150, { fit: "cover" })
        .raw()
        .toBuffer({ resolveWithObject: true });

      // sample pixels and cluster into dominant colors
      const pixels = [];
      for (let i = 0; i < data.length; i += info.channels) {
        pixels.push([data[i], data[i + 1], data[i + 2]]);
      }

      // simple median cut — sample every Nth pixel for speed
      const step = Math.max(1, Math.floor(pixels.length / 500));
      const sampled = pixels.filter((_, idx) => idx % step === 0);

      // quantize into buckets by rounding to nearest 32
      const colorMap = {};
      for (const [r, g, b] of sampled) {
        const key = `${Math.round(r / 32) * 32},${Math.round(g / 32) * 32},${Math.round(b / 32) * 32}`;
        colorMap[key] = (colorMap[key] || 0) + 1;
      }

      const sorted = Object.entries(colorMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, colorCount)
        .map(([key]) => {
          const [r, g, b] = key.split(",").map(Number);
          const hex = "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
          return { r, g, b, hex };
        });

      await incrementUsage(user?.user_id, ip, tier, "color-palette", req.file.mimetype.split("/")[1], null, fileSizeKb, "success");

      return res.status(200).json({
        resStatus: true,
        resOkCode: 1,
        colors: sorted
      });

    } catch (err) {
      console.error("Color palette error:", err.message);
      await incrementUsage(user?.user_id, ip, tier, "color-palette", req.file.mimetype.split("/")[1], null, fileSizeKb, "failed");
      return res.status(500).json({ resStatus: false, resMessage: "Color extraction failed.", resErrorCode: 99 });
    }
  }
);

// ── IMAGE WATERMARK ────────────────────────────────────────────────────────
router.post("/api/post/filebeef/image/watermark", optionalAuth, imageUpload.single("file"), async (req, res) => {
    const user = req.filebeefUser;
    const ip = getClientIp(req);
    const tier = getTier(user);
    const limits = LIMITS[tier];

    if (!req.file) return res.status(400).json({ resStatus: false, resMessage: "No file uploaded", resErrorCode: 1 });
    if (req.file.size > limits.sizeMB * 1024 * 1024) return res.status(400).json({ resStatus: false, resMessage: `File too large. Max ${limits.sizeMB}MB.`, resErrorCode: 2 });
    if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype)) return res.status(400).json({ resStatus: false, resMessage: "Unsupported file type.", resErrorCode: 3 });

    const limitCheck = await checkConversionLimit(user?.user_id, ip, tier);
    if (!limitCheck.allowed) return res.status(403).json({ resStatus: false, resMessage: `Daily limit reached (${limitCheck.limit}/day).`, resErrorCode: 5, limitReached: true, tier });

    const text = (req.body.text || "FileBeef").substring(0, 50);
    const opacity = Math.min(1, Math.max(0.1, parseFloat(req.body.opacity) || 0.4));
    const position = req.body.position || "bottom-right";
    const inputFormat = req.file.mimetype.split("/")[1] || "unknown";
    const fileSizeKb = Math.round(req.file.size / 1024);

    try {
      const image = sharp(req.file.buffer);
      const meta = await image.metadata();
      const width = meta.width || 800;
      const height = meta.height || 600;

      const fontSize = Math.max(16, Math.round(Math.min(width, height) * 0.05));
      const opacityHex = Math.round(opacity * 255).toString(16).padStart(2, "0");

      const svgText = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <style>
            .wm { font-family: Arial, sans-serif; font-size: ${fontSize}px; fill: #ffffff; fill-opacity: ${opacity}; }
          </style>
          <text
            class="wm"
            x="${position.includes("right") ? width - 20 : position.includes("center") ? width / 2 : 20}"
            y="${position.includes("bottom") ? height - 20 : position.includes("middle") ? height / 2 : 40}"
            text-anchor="${position.includes("right") ? "end" : position.includes("center") ? "middle" : "start"}"
          >${text}</text>
        </svg>
      `;

      const outputFormat = inputFormat === "png" ? "png" : inputFormat === "webp" ? "webp" : "jpeg";
      let sharpInstance = sharp(req.file.buffer).composite([{ input: Buffer.from(svgText), top: 0, left: 0 }]);

      if (outputFormat === "png") sharpInstance = sharpInstance.png();
      else if (outputFormat === "webp") sharpInstance = sharpInstance.webp({ quality: 90 });
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
module.exports = router;