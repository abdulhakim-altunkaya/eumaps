const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const axios = require("axios");
const { pool, supabase } = require("../db");
const sharp = require("sharp");

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const SUDOKU_WEB_CLIENT_ID     = process.env.SUDOKU_GOOGLE_WEB_CLIENT_ID;
const SUDOKU_WEB_CLIENT_SECRET = process.env.SUDOKU_GOOGLE_WEB_CLIENT_SECRET;
const SUDOKU_SESSION_MS        = 1000 * 60 * 60 * 24 * 365; // 1 year
const SUDOKU_TOKEN_RE          = /^[a-f0-9]{128}$/;
const SUDOKU_UUID_RE           = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUDOKU_DIFFICULTIES      = ["easy", "medium", "hard", "ultra_hard"];
const SUDOKU_AVATAR_BUCKET     = "sudoku_storage";   // private Supabase bucket
const SUDOKU_AVATAR_SIZE       = 512;                // px, square
const SUDOKU_AVATAR_MAX_BYTES  = 200 * 1024;
const SUDOKU_AVATAR_LINK_SEC   = 60 * 60 * 24;       // signed photo links live 24 h
const SUDOKU_NAME_MAX_SAME     = 10;                 // max players sharing one name
const SUDOKU_NAME_RE           = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,18}[\p{L}\p{N}.]$/u; // 3–20 chars
const SUDOKU_MAX_PENDING_OUT   = 20;                 // open friend requests a player can have
const SUDOKU_FRIEND_ACTIONS    = ["request", "accept", "decline", "cancel", "remove"];
const SUDOKU_MIN_SOLVE_SEC     = 10;
const SUDOKU_MAX_SOLVE_SEC     = 24 * 60 * 60;
const SUDOKU_SOLVE_REWARD      = { easy: 1, medium: 2, hard: 4, ultra_hard: 8 }; // palladium grams, first solve only
const SUDOKU_TZ                = "Europe/Riga";      // weekly leaderboard resets Monday 00:00 here

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

// ══════════════════════════════════════════════════════════════════════════
//  SOCIAL HELPERS
// ══════════════════════════════════════════════════════════════════════════
function sudokuParseUuid(raw) {
  const s = String(raw || "");
  return SUDOKU_UUID_RE.test(s) ? s.toLowerCase() : null;
}

function sudokuCleanName(raw) {
  return String(raw || "").normalize("NFC").replace(/\s+/g, " ").trim();
}

// Signed links for several photo paths at once -> { path: url }
async function sudokuAvatarLinks(paths) {
  const links = {};
  const list = (paths || []).filter(Boolean);
  if (!list.length) return links;
  try {
    const { data } = await supabase.storage
      .from(SUDOKU_AVATAR_BUCKET)
      .createSignedUrls(list, SUDOKU_AVATAR_LINK_SEC);
    for (const l of data || []) if (l && l.path && l.signedUrl) links[l.path] = l.signedUrl;
  } catch (e) { /* no photos: the app shows first letters */ }
  return links;
}

async function sudokuAvatarLink(filePath) {
  if (!filePath) return "";
  const links = await sudokuAvatarLinks([filePath]);
  return links[filePath] || "";
}

async function sudokuRemoveAvatar(filePath) {
  if (!filePath || !filePath.startsWith("avatars/")) return;
  try {
    await supabase.storage.from(SUDOKU_AVATAR_BUCKET).remove([filePath]);
  } catch (e) { /* ignore */ }
}

// "me" | "none" | "sent" (I asked) | "incoming" (they asked) | "friends"
async function sudokuFriendState(me, other) {
  if (me === other) return "me";
  const r = await pool.query(
    `SELECT user_id, status FROM sudoku_friendships
     WHERE LEAST(user_id, friend_id) = LEAST($1::uuid, $2::uuid)
       AND GREATEST(user_id, friend_id) = GREATEST($1::uuid, $2::uuid)`,
    [me, other]
  );
  if (!r.rowCount) return "none";
  const f = r.rows[0];
  if (f.status === "accepted") return "friends";
  return f.user_id === me ? "sent" : "incoming";
}

async function sudokuFriendCount(userId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM sudoku_friendships
     WHERE status = 'accepted' AND (user_id = $1 OR friend_id = $1)`,
    [userId]
  );
  return r.rows[0].n;
}

// Both players must have a free friend slot.
async function sudokuCheckCapacity(me, other) {
  const r = await pool.query(
    `SELECT id, friend_capacity FROM sudoku_profiles WHERE id = ANY($1::uuid[])`,
    [[me, other]]
  );
  for (const row of r.rows) {
    const n = await sudokuFriendCount(row.id);
    if (n >= row.friend_capacity) {
      return row.id === me
        ? `Your friends list is full (${row.friend_capacity})`
        : "Their friends list is full";
    }
  }
  return null;
}

// Own lists: friends + incoming requests (declined ones are hidden), each with a photo link.
async function sudokuFriendLists(me) {
  const r = await pool.query(
    `WITH pairs AS (
       SELECT CASE WHEN user_id = $1 THEN friend_id ELSE user_id END AS other,
              status, user_id = $1 AS mine, declined_at IS NOT NULL AS declined,
              COALESCE(accepted_at, created_at) AS at
       FROM sudoku_friendships
       WHERE user_id = $1 OR friend_id = $1
     )
     SELECT p.other AS id, p.status, p.mine, p.declined, u.username AS name, u.avatar_path,
            (SELECT COUNT(*) FROM sudoku_solved_logs l WHERE l.user_id = u.id)::int AS solved
     FROM pairs p JOIN sudoku_profiles u ON u.id = p.other
     WHERE p.status = 'accepted' OR (p.status = 'pending' AND NOT p.mine AND NOT p.declined)
     ORDER BY (p.status = 'accepted'), solved DESC, p.at DESC
     LIMIT 120`,
    [me]
  );
  const links = await sudokuAvatarLinks(r.rows.map(x => x.avatar_path));
  const dto = x => ({
    userId: x.id, name: x.name, avatarUrl: links[x.avatar_path] || "",
    solved: x.solved || 0, friendState: x.status === "accepted" ? "friends" : "incoming"
  });
  return {
    friends: r.rows.filter(x => x.status === "accepted").map(dto),
    requests: r.rows.filter(x => x.status === "pending").map(dto)
  };
}

// ══════════════════════════════════════════════════════════════════════════
//  PUZZLES + SOLVES
// ══════════════════════════════════════════════════════════════════════════

// GET /puzzle?difficulty=easy -> a random puzzle the player hasn't solved yet.
// The handout time is saved: a solve only earns palladium for a puzzle the server gave out,
// and never faster than the time since it was given out.
router.get("/puzzle", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
  const difficulty = String(req.query.difficulty || "");
  if (!SUDOKU_DIFFICULTIES.includes(difficulty)) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid difficulty", resErrorCode: 1 });
  }
  try {
    let r = await pool.query(
      `SELECT s.id, s.difficulty, s.initial_board, s.solution_board
       FROM sudoku_seeds s
       WHERE s.difficulty = $1
         AND NOT EXISTS (SELECT 1 FROM sudoku_solved_logs l WHERE l.user_id = $2 AND l.puzzle_id = s.id)
       ORDER BY random() LIMIT 1`,
      [difficulty, req.sudokuUser.id]
    );
    if (!r.rowCount) {
      // Everything solved: any puzzle of this difficulty
      r = await pool.query(
        `SELECT id, difficulty, initial_board, solution_board FROM sudoku_seeds
         WHERE difficulty = $1 ORDER BY random() LIMIT 1`,
        [difficulty]
      );
    }
    if (!r.rowCount) {
      return res.status(404).json({ resStatus: false, resMessage: "No puzzles", resErrorCode: 2 });
    }
    const p = r.rows[0];
    await pool.query(
      `INSERT INTO sudoku_puzzle_issues (user_id, puzzle_id, issued_at) VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, puzzle_id) DO UPDATE SET issued_at = NOW()`,
      [req.sudokuUser.id, p.id]
    );
    return res.status(200).json({
      resStatus: true,
      puzzle: { id: p.id, difficulty: p.difficulty, initial: p.initial_board, solution: p.solution_board }
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// POST /solve { puzzleId, seconds } -> one row per player per puzzle, keeps the best time.
// First solve of a server-given puzzle earns palladium (Easy 1 g, Medium 2, Hard 4, Ultra Hard 8).
router.post("/solve", sudokuRateLimit(30), sudokuRequireAuth, async (req, res) => {
  const me = req.sudokuUser.id;
  const puzzleId = Number(req.body?.puzzleId);
  const seconds = Number(req.body?.seconds);
  if (!Number.isInteger(puzzleId) || puzzleId <= 0 ||
      !Number.isInteger(seconds) || seconds < SUDOKU_MIN_SOLVE_SEC || seconds > SUDOKU_MAX_SOLVE_SEC) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid solve", resErrorCode: 1 });
  }
  const client = await pool.connect();
  try {
    const seed = await client.query(`SELECT id, difficulty FROM sudoku_seeds WHERE id = $1`, [puzzleId]);
    if (!seed.rowCount) {
      return res.status(404).json({ resStatus: false, resMessage: "Puzzle not found", resErrorCode: 2 });
    }
    const difficulty = seed.rows[0].difficulty;

    // Given out by the server, and the claimed time fits since then (+60 s slack)?
    const issue = await client.query(
      `SELECT EXTRACT(EPOCH FROM (NOW() - issued_at))::int AS since
       FROM sudoku_puzzle_issues WHERE user_id = $1 AND puzzle_id = $2`,
      [me, puzzleId]
    );
    const issued = issue.rowCount > 0;
    if (issued && seconds > issue.rows[0].since + 60) {
      return res.status(400).json({ resStatus: false, resMessage: "Invalid solve", resErrorCode: 3 });
    }

    await client.query("BEGIN");
    const r = await client.query(
      `INSERT INTO sudoku_solved_logs (user_id, puzzle_id, time_seconds)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, puzzle_id)
       DO UPDATE SET time_seconds = LEAST(sudoku_solved_logs.time_seconds, EXCLUDED.time_seconds)
       RETURNING time_seconds, (xmax = 0) AS first`,
      [me, puzzleId, seconds]
    );
    const first = r.rows[0].first;
    let reward = 0;
    if (first && issued) {
      reward = SUDOKU_SOLVE_REWARD[difficulty] || 0;
      await client.query(`UPDATE sudoku_profiles SET palladium_grams = palladium_grams + $2 WHERE id = $1`, [me, reward]);
      await client.query(
        `INSERT INTO sudoku_palladium_ledger (user_id, amount, source, puzzle_id) VALUES ($1, $2, 'solve', $3)`,
        [me, reward, puzzleId]
      );
      await client.query(
        `UPDATE sudoku_solved_logs SET reward_claimed = TRUE WHERE user_id = $1 AND puzzle_id = $2`,
        [me, puzzleId]
      );
    }
    const bal = await client.query(`SELECT palladium_grams FROM sudoku_profiles WHERE id = $1`, [me]);
    await client.query("COMMIT");

    return res.status(200).json({
      resStatus: true,
      first,
      best: r.rows[0].time_seconds,
      reward,
      palladium: bal.rows[0].palladium_grams
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (e) { /* not in a transaction */ }
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  LEADERBOARD: palladium earned from solves this week (Mon 00:00 Riga time)
// ══════════════════════════════════════════════════════════════════════════
const SUDOKU_WEEK_START = `(date_trunc('week', NOW() AT TIME ZONE '${SUDOKU_TZ}') AT TIME ZONE '${SUDOKU_TZ}')`;

function sudokuEndsIn(sec) {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return d + " d " + h + " h";
  if (h > 0) return h + " h " + m + " m";
  return m + " m";
}

// GET /leaderboard?scope=everyone|friends -> { rows (top 100), me, endsIn }
router.get("/leaderboard", sudokuRateLimit(30), sudokuRequireAuth, async (req, res) => {
  const me = req.sudokuUser.id;
  const scope = req.query.scope === "friends" ? "friends" : "everyone";
  try {
    let rows;
    if (scope === "everyone") {
      const r = await pool.query(
        `WITH earned AS (
           SELECT user_id, SUM(amount)::int AS grams
           FROM sudoku_palladium_ledger
           WHERE source = 'solve' AND created_at >= ${SUDOKU_WEEK_START}
           GROUP BY user_id
         ), ranked AS (
           SELECT user_id, grams, RANK() OVER (ORDER BY grams DESC)::int AS rnk FROM earned
         )
         SELECT r.user_id, r.grams, r.rnk, u.username, u.avatar_path
         FROM ranked r JOIN sudoku_profiles u ON u.id = r.user_id
         WHERE r.rnk <= 100 OR r.user_id = $1
         ORDER BY r.rnk, u.username`,
        [me]
      );
      rows = r.rows;
    } else {
      const r = await pool.query(
        `WITH ppl AS (
           SELECT $1::uuid AS id
           UNION
           SELECT CASE WHEN user_id = $1 THEN friend_id ELSE user_id END
           FROM sudoku_friendships WHERE status = 'accepted' AND (user_id = $1 OR friend_id = $1)
         ), earned AS (
           SELECT user_id, SUM(amount)::int AS grams
           FROM sudoku_palladium_ledger
           WHERE source = 'solve' AND created_at >= ${SUDOKU_WEEK_START}
             AND user_id IN (SELECT id FROM ppl)
           GROUP BY user_id
         )
         SELECT p.id AS user_id, COALESCE(e.grams, 0) AS grams,
                RANK() OVER (ORDER BY COALESCE(e.grams, 0) DESC)::int AS rnk,
                u.username, u.avatar_path
         FROM ppl p JOIN sudoku_profiles u ON u.id = p.id
         LEFT JOIN earned e ON e.user_id = p.id
         ORDER BY rnk, u.username`,
        [me]
      );
      rows = r.rows;
    }

    const links = await sudokuAvatarLinks(rows.map(x => x.avatar_path));
    const dto = x => ({
      rank: x.rnk, userId: x.user_id, name: x.username, avatarUrl: links[x.avatar_path] || "",
      grams: x.grams, isMe: x.user_id === me
    });
    const all = rows.map(dto);
    const mine = all.find(x => x.isMe) || null;
    const top = all.filter(x => x.rank <= 100);

    const ends = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (${SUDOKU_WEEK_START} + INTERVAL '7 days' - NOW()))::int AS sec`
    );

    return res.status(200).json({
      resStatus: true,
      scope,
      rows: top,
      me: mine || { rank: 0, userId: me, name: "", avatarUrl: "", grams: 0, isMe: true },
      endsIn: sudokuEndsIn(ends.rows[0].sec)
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  PROFILE
// ══════════════════════════════════════════════════════════════════════════
async function sudokuSendProfile(req, res, userId) {
  try {
    const u = await pool.query(
      `SELECT id, username, avatar_path, palladium_grams, friend_capacity FROM sudoku_profiles WHERE id = $1`,
      [userId]
    );
    if (!u.rowCount) {
      return res.status(404).json({ resStatus: false, resMessage: "Player not found", resErrorCode: 2 });
    }
    const p = u.rows[0];
    const me = req.sudokuUser.id;

    const st = await pool.query(
      `SELECT s.difficulty, COUNT(*)::int AS solved, MIN(l.time_seconds)::int AS best
       FROM sudoku_solved_logs l JOIN sudoku_seeds s ON s.id = l.puzzle_id
       WHERE l.user_id = $1 GROUP BY s.difficulty`,
      [userId]
    );
    const byDiff = {};
    for (const row of st.rows) byDiff[row.difficulty] = row;
    const stats = SUDOKU_DIFFICULTIES.map(d => ({
      difficulty: d,
      solved: byDiff[d] ? byDiff[d].solved : 0,
      bestSeconds: byDiff[d] ? byDiff[d].best : 0
    }));

    const state = await sudokuFriendState(me, p.id);
    const lists = state === "me" ? await sudokuFriendLists(p.id) : { friends: [], requests: [] };

    return res.status(200).json({
      resStatus: true,
      profile: {
        id: p.id,
        name: p.username,
        avatarUrl: await sudokuAvatarLink(p.avatar_path),
        isMe: state === "me",
        palladium: p.palladium_grams,
        friendCapacity: p.friend_capacity,
        friendCount: await sudokuFriendCount(p.id),
        totalSolved: stats.reduce((a, s) => a + s.solved, 0),
        stats,
        friendState: state,
        friends: lists.friends,
        requests: lists.requests
      }
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
}

router.get("/profile", sudokuRateLimit(30), sudokuRequireAuth, (req, res) =>
  sudokuSendProfile(req, res, req.sudokuUser.id));

router.get("/profile/:id", sudokuRateLimit(60), sudokuRequireAuth, (req, res) => {
  const id = sudokuParseUuid(req.params.id);
  if (!id) return res.status(400).json({ resStatus: false, resMessage: "Invalid player", resErrorCode: 1 });
  return sudokuSendProfile(req, res, id);
});

// Body: { name }. 3–20 letters/digits (space . _ - inside). Max 10 players per name.
router.post("/profile/name", sudokuRateLimit(10), sudokuRequireAuth, async (req, res) => {
  const name = sudokuCleanName(req.body?.name);
  if (!SUDOKU_NAME_RE.test(name)) {
    return res.status(400).json({ resStatus: false, resMessage: "Use 3–20 letters or numbers", resErrorCode: 1 });
  }
  try {
    const same = await pool.query(
      `SELECT COUNT(*)::int AS n FROM sudoku_profiles WHERE lower(username) = lower($1) AND id <> $2`,
      [name, req.sudokuUser.id]
    );
    if (same.rows[0].n >= SUDOKU_NAME_MAX_SAME) {
      return res.status(409).json({ resStatus: false, resMessage: "Too many players use this name. Try another one", resErrorCode: 2 });
    }
    await pool.query(`UPDATE sudoku_profiles SET username = $1 WHERE id = $2`, [name, req.sudokuUser.id]);
    return res.status(200).json({ resStatus: true, resMessage: "Saved", name });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// Body: raw image bytes. Saved as a 512×512 JPEG, under 200 KB, no metadata.
router.post(
  "/profile/photo",
  sudokuRateLimit(6),
  sudokuRequireAuth,
  express.raw({ type: () => true, limit: "8mb" }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) {
      return res.status(400).json({ resStatus: false, resMessage: "No photo", resErrorCode: 1 });
    }
    let jpg;
    try {
      let quality = 82;
      do {
        jpg = await sharp(req.body, { limitInputPixels: 50_000_000 })
          .rotate()
          .resize(SUDOKU_AVATAR_SIZE, SUDOKU_AVATAR_SIZE, { fit: "cover", position: "attention" })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();
        quality -= 15;
      } while (jpg.length > SUDOKU_AVATAR_MAX_BYTES && quality > 30);
    } catch (err) {
      return res.status(400).json({ resStatus: false, resMessage: "This photo can't be read", resErrorCode: 2 });
    }
    if (jpg.length > SUDOKU_AVATAR_MAX_BYTES) {
      return res.status(400).json({ resStatus: false, resMessage: "Photo is too big", resErrorCode: 3 });
    }

    const filePath = `avatars/${req.sudokuUser.id}_${Date.now()}.jpg`;
    try {
      const { error } = await supabase.storage
        .from(SUDOKU_AVATAR_BUCKET)
        .upload(filePath, jpg, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
      if (error) {
        return res.status(502).json({ resStatus: false, resMessage: "Upload failed, try again", resErrorCode: 4 });
      }
      const old = await pool.query(`SELECT avatar_path FROM sudoku_profiles WHERE id = $1`, [req.sudokuUser.id]);
      await pool.query(`UPDATE sudoku_profiles SET avatar_path = $1 WHERE id = $2`, [filePath, req.sudokuUser.id]);
      await sudokuRemoveAvatar(old.rows[0]?.avatar_path);
      return res.status(200).json({ resStatus: true, resMessage: "Saved", avatarUrl: await sudokuAvatarLink(filePath) });
    } catch (err) {
      return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
    }
  }
);

router.delete("/profile/photo", sudokuRateLimit(6), sudokuRequireAuth, async (req, res) => {
  try {
    const old = await pool.query(`SELECT avatar_path FROM sudoku_profiles WHERE id = $1`, [req.sudokuUser.id]);
    await pool.query(`UPDATE sudoku_profiles SET avatar_path = NULL WHERE id = $1`, [req.sudokuUser.id]);
    await sudokuRemoveAvatar(old.rows[0]?.avatar_path);
    return res.status(200).json({ resStatus: true, resMessage: "Removed", avatarUrl: "" });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  FRIENDS (request + accept). One row per pair of players.
// ══════════════════════════════════════════════════════════════════════════

// POST /friends/:id/request | accept | decline | cancel | remove  -> { state }
router.post("/friends/:id/:action", sudokuRateLimit(30), sudokuRequireAuth, async (req, res) => {
  const other = sudokuParseUuid(req.params.id);
  const action = String(req.params.action || "");
  const me = req.sudokuUser.id;
  if (!other || !SUDOKU_FRIEND_ACTIONS.includes(action)) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid request", resErrorCode: 1 });
  }
  if (other === me) {
    return res.status(400).json({ resStatus: false, resMessage: "That's you", resErrorCode: 2 });
  }
  const pair = `LEAST(user_id, friend_id) = LEAST($1::uuid, $2::uuid)
     AND GREATEST(user_id, friend_id) = GREATEST($1::uuid, $2::uuid)`;
  try {
    const exists = await pool.query(`SELECT id FROM sudoku_profiles WHERE id = $1`, [other]);
    if (!exists.rowCount) {
      return res.status(404).json({ resStatus: false, resMessage: "Player not found", resErrorCode: 3 });
    }
    const now = await sudokuFriendState(me, other);

    if (action === "request" && now === "none") {
      const open = await pool.query(
        `SELECT COUNT(*)::int AS n FROM sudoku_friendships WHERE user_id = $1 AND status = 'pending'`, [me]);
      if (open.rows[0].n >= SUDOKU_MAX_PENDING_OUT) {
        return res.status(403).json({ resStatus: false, resMessage: "Too many open requests. Wait for answers first", resErrorCode: 4 });
      }
      const full = await sudokuCheckCapacity(me, other);
      if (full) return res.status(403).json({ resStatus: false, resMessage: full, resErrorCode: 5 });
      await pool.query(
        `INSERT INTO sudoku_friendships (user_id, friend_id, status) VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING`,
        [me, other]
      );
    } else if ((action === "request" || action === "accept") && now === "incoming") {
      // They already asked: asking back means yes.
      const full = await sudokuCheckCapacity(me, other);
      if (full) return res.status(403).json({ resStatus: false, resMessage: full, resErrorCode: 5 });
      await pool.query(
        `UPDATE sudoku_friendships SET status = 'accepted', accepted_at = NOW(), declined_at = NULL
         WHERE user_id = $2 AND friend_id = $1 AND status = 'pending'`,
        [me, other]
      );
    } else if (action === "decline" && now === "incoming") {
      // Only the receiver knows: the sender still sees "Requested".
      await pool.query(
        `UPDATE sudoku_friendships SET declined_at = COALESCE(declined_at, NOW())
         WHERE user_id = $2 AND friend_id = $1 AND status = 'pending'`,
        [me, other]
      );
    } else if (action === "cancel" && now === "sent") {
      await pool.query(`DELETE FROM sudoku_friendships WHERE user_id = $1 AND friend_id = $2 AND status = 'pending'`, [me, other]);
    } else if (action === "remove" && now === "friends") {
      await pool.query(`DELETE FROM sudoku_friendships WHERE ${pair} AND status = 'accepted'`, [me, other]);
    }
    return res.status(200).json({ resStatus: true, state: await sudokuFriendState(me, other) });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// GET /users/search?q=an -> up to 20 players whose name contains the text (never you), with friend state
router.get("/users/search", sudokuRateLimit(30), sudokuRequireAuth, async (req, res) => {
  const me = req.sudokuUser.id;
  const q = String(req.query.q || "").trim().slice(0, 20);
  if (q.length < 2) return res.status(200).json({ resStatus: true, users: [] });
  const esc = q.replace(/[\\%_]/g, c => "\\" + c); // % and _ are typed letters, not wildcards
  try {
    const r = await pool.query(
      `SELECT u.id, u.username AS name, u.avatar_path,
              (SELECT COUNT(*) FROM sudoku_solved_logs l WHERE l.user_id = u.id)::int AS solved,
              f.user_id AS requester, f.status
       FROM sudoku_profiles u
       LEFT JOIN sudoku_friendships f
         ON LEAST(f.user_id, f.friend_id) = LEAST(u.id, $3::uuid)
        AND GREATEST(f.user_id, f.friend_id) = GREATEST(u.id, $3::uuid)
       WHERE u.id <> $3 AND u.username ILIKE $1
       ORDER BY (u.username ILIKE $2) DESC, solved DESC, u.id
       LIMIT 20`,
      ["%" + esc + "%", esc + "%", me]
    );
    const links = await sudokuAvatarLinks(r.rows.map(x => x.avatar_path));
    const state = x => !x.status ? "none"
      : x.status === "accepted" ? "friends"
      : x.requester === me ? "sent" : "incoming";
    return res.status(200).json({
      resStatus: true,
      users: r.rows.map(x => ({
        userId: x.id, name: x.name, avatarUrl: links[x.avatar_path] || "",
        solved: x.solved || 0, friendState: state(x)
      }))
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

module.exports = router;
