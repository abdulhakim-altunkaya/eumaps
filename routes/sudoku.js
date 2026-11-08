const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const axios = require("axios");
const { pool } = require("../db");

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const SUDOKU_WEB_CLIENT_ID     = process.env.SUDOKU_GOOGLE_WEB_CLIENT_ID;
const SUDOKU_WEB_CLIENT_SECRET = process.env.SUDOKU_GOOGLE_WEB_CLIENT_SECRET;
const SUDOKU_SESSION_MS        = 1000 * 60 * 60 * 24 * 365; // 1 year
const SUDOKU_TOKEN_RE          = /^[a-f0-9]{128}$/;

// ── HELPERS ────────────────────────────────────────────────────────────────
function sudokuGetIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (cf) return cf.trim();
  const xf = req.headers["x-forwarded-for"];
  let ip = xf ? xf.split(",")[0].trim() : req.socket?.remoteAddress || req.ip;
  if (ip?.startsWith("::ffff:")) ip = ip.slice(7);
  return ip || "unknown";
}

// Profile row -> what the app receives
function sudokuProfileDto(p) {
  return {
    id: p.id,
    username: p.username,
    palladium: p.palladium_grams,
    friendCapacity: p.friend_capacity,
    noAds: p.has_no_ads,
    equippedTheme: p.equipped_theme,
    equippedPen: p.equipped_pen,
    equippedSfx: p.equipped_sfx
  };
}

const SUDOKU_PROFILE_COLS = `id, username, palladium_grams, friend_capacity, has_no_ads,
  equipped_theme, equipped_pen, equipped_sfx`;

// ── RATE LIMITER ───────────────────────────────────────────────────────────
const sudokuRateStore = Object.create(null);
function sudokuRateLimit(limitPerMinute) {
  return function (req, res, next) {
    const key = sudokuGetIp(req) + "|" + limitPerMinute;
    const now = Date.now();
    const w = sudokuRateStore[key];
    if (!w || now - w.start > 60_000) {
      sudokuRateStore[key] = { count: 1, start: now };
      return next();
    }
    w.count++;
    if (w.count > limitPerMinute) {
      return res.status(429).json({ resStatus: false, resMessage: "Too many requests", resErrorCode: 429 });
    }
    next();
  };
}

// ── AUTH MIDDLEWARE (Bearer token) ─────────────────────────────────────────
async function sudokuRequireAuth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!SUDOKU_TOKEN_RE.test(token)) {
    return res.status(401).json({ resStatus: false, resMessage: "Unauthorized", resErrorCode: 1 });
  }
  try {
    const r = await pool.query(
      `SELECT s.id AS session_id, s.expires_at, s.user_id
       FROM sudoku_sessions s
       WHERE s.token = $1 LIMIT 1`,
      [token]
    );
    if (!r.rowCount) {
      return res.status(401).json({ resStatus: false, resMessage: "Invalid session", resErrorCode: 2 });
    }
    const session = r.rows[0];
    if (new Date(session.expires_at) < new Date()) {
      await pool.query(`DELETE FROM sudoku_sessions WHERE id = $1`, [session.session_id]);
      return res.status(401).json({ resStatus: false, resMessage: "Session expired", resErrorCode: 3 });
    }
    req.sudokuUser = { id: session.user_id, sessionId: session.session_id };
    next();
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════════════════

// Unity sends the Play Games server auth code; we exchange it with Google.
router.post("/auth/google", sudokuRateLimit(10), async (req, res) => {
  const code = String(req.body?.serverAuthCode || "").trim();
  if (!code || code.length > 2048) {
    return res.status(400).json({ resStatus: false, resMessage: "Missing auth code", resErrorCode: 1 });
  }
  if (!SUDOKU_WEB_CLIENT_ID || !SUDOKU_WEB_CLIENT_SECRET) {
    return res.status(500).json({ resStatus: false, resMessage: "Server not configured", resErrorCode: 98 });
  }

  let accessToken;
  try {
    const tokenRes = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: SUDOKU_WEB_CLIENT_ID,
        client_secret: SUDOKU_WEB_CLIENT_SECRET,
        redirect_uri: "",
        grant_type: "authorization_code"
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 }
    );
    accessToken = tokenRes.data?.access_token;
  } catch (err) {
    return res.status(401).json({ resStatus: false, resMessage: "Google verification failed", resErrorCode: 2 });
  }
  if (!accessToken) {
    return res.status(401).json({ resStatus: false, resMessage: "Google verification failed", resErrorCode: 2 });
  }

  let playerId, displayName;
  try {
    const playerRes = await axios.get(
      "https://games.googleapis.com/games/v1/players/me",
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 }
    );
    playerId = String(playerRes.data?.playerId || "").trim();
    displayName = String(playerRes.data?.displayName || "Player").trim().slice(0, 60) || "Player";
  } catch (err) {
    return res.status(401).json({ resStatus: false, resMessage: "Player lookup failed", resErrorCode: 3 });
  }
  if (!playerId) {
    return res.status(401).json({ resStatus: false, resMessage: "Player lookup failed", resErrorCode: 3 });
  }

  try {
    // Username is set from Google only on first login; later renames are kept.
    const profile = await pool.query(
      `INSERT INTO sudoku_profiles (google_play_id, username)
       VALUES ($1, $2)
       ON CONFLICT (google_play_id)
       DO UPDATE SET last_login_at = NOW()
       RETURNING ${SUDOKU_PROFILE_COLS}`,
      [playerId, displayName]
    );
    const userId = profile.rows[0].id;

    await pool.query(`DELETE FROM sudoku_sessions WHERE user_id = $1 AND expires_at < NOW()`, [userId]);

    const token = crypto.randomBytes(64).toString("hex");
    await pool.query(
      `INSERT INTO sudoku_sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [userId, token, new Date(Date.now() + SUDOKU_SESSION_MS)]
    );

    return res.status(200).json({
      resStatus: true,
      resMessage: "Logged in",
      token,
      user: sudokuProfileDto(profile.rows[0])
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

router.get("/auth/me", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${SUDOKU_PROFILE_COLS} FROM sudoku_profiles WHERE id = $1`,
      [req.sudokuUser.id]
    );
    if (!r.rowCount) {
      return res.status(401).json({ resStatus: false, resMessage: "Unauthorized", resErrorCode: 1 });
    }
    return res.status(200).json({ resStatus: true, user: sudokuProfileDto(r.rows[0]) });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

router.post("/auth/logout", sudokuRateLimit(30), sudokuRequireAuth, async (req, res) => {
  try {
    await pool.query(`DELETE FROM sudoku_sessions WHERE id = $1`, [req.sudokuUser.sessionId]);
    return res.status(200).json({ resStatus: true, resMessage: "Logged out" });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

module.exports = router;
