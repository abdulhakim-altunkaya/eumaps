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
const SUDOKU_FRIEND_REQUESTS_PER_MONTH = 20;         // new friend requests per player, rolling 30 days
const SUDOKU_FRIEND_ACTIONS    = ["request", "accept", "decline", "cancel", "remove"];
const SUDOKU_MIN_SOLVE_SEC     = 10;
const SUDOKU_MAX_SOLVE_SEC     = 24 * 60 * 60;
const SUDOKU_SOLVE_REWARD      = { easy: 1, medium: 2, hard: 4, ultra_hard: 8 }; // palladium grams, first solve only
// Slow solves earn less: Easy 0 after 20 min, Medium/Hard/Ultra Hard half after 30/50/60 min.
const SUDOKU_SLOW_AFTER_SEC    = { easy: 20 * 60, medium: 30 * 60, hard: 50 * 60, ultra_hard: 60 * 60 };

function sudokuSolveReward(difficulty, seconds) {
  const full = SUDOKU_SOLVE_REWARD[difficulty] || 0;
  if (seconds <= (SUDOKU_SLOW_AFTER_SEC[difficulty] || Infinity)) return full;
  return difficulty === "easy" ? 0 : Math.floor(full / 2);
}
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
    `SELECT user_id, status, cancelled_at FROM sudoku_friendships
     WHERE LEAST(user_id, friend_id) = LEAST($1::uuid, $2::uuid)
       AND GREATEST(user_id, friend_id) = GREATEST($1::uuid, $2::uuid)`,
    [me, other]
  );
  if (!r.rowCount) return "none";
  const f = r.rows[0];
  if (f.status === "accepted") return "friends";
  if (f.cancelled_at) return "none"; // a withdrawn request
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

// Own lists: friends (with unread messages), incoming requests, and requests you declined
// (only you see those; the sender still sees "Requested"). Each with a photo link.
async function sudokuFriendLists(me) {
  const r = await pool.query(
    `WITH pairs AS (
       SELECT CASE WHEN user_id = $1 THEN friend_id ELSE user_id END AS other,
              status, user_id = $1 AS mine, declined_at IS NOT NULL AS declined,
              COALESCE(accepted_at, created_at) AS at
       FROM sudoku_friendships
       WHERE (user_id = $1 OR friend_id = $1) AND cancelled_at IS NULL
     )
     SELECT p.other AS id, p.status, p.mine, p.declined, u.username AS name, u.avatar_path,
            (SELECT COUNT(*) FROM sudoku_solved_logs l WHERE l.user_id = u.id)::int AS solved,
            (SELECT COUNT(*) FROM sudoku_messages m
             WHERE m.sender_id = u.id AND m.receiver_id = $1 AND m.read_at IS NULL)::int AS unread
     FROM pairs p JOIN sudoku_profiles u ON u.id = p.other
     WHERE p.status = 'accepted' OR (p.status = 'pending' AND NOT p.mine)
     ORDER BY (p.status = 'accepted'), solved DESC, p.at DESC
     LIMIT 200`,
    [me]
  );
  const links = await sudokuAvatarLinks(r.rows.map(x => x.avatar_path));
  const dto = x => ({
    userId: x.id, name: x.name, avatarUrl: links[x.avatar_path] || "",
    solved: x.solved || 0, unread: x.unread || 0,
    friendState: x.status === "accepted" ? "friends" : "incoming"
  });
  return {
    friends: r.rows.filter(x => x.status === "accepted").map(dto),
    requests: r.rows.filter(x => x.status === "pending" && !x.declined).map(dto),
    declined: r.rows.filter(x => x.status === "pending" && x.declined).map(dto)
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
      reward = sudokuSolveReward(difficulty, seconds);
      if (reward > 0) {
        await client.query(`UPDATE sudoku_profiles SET palladium_grams = palladium_grams + $2 WHERE id = $1`, [me, reward]);
        await client.query(
          `INSERT INTO sudoku_palladium_ledger (user_id, amount, source, puzzle_id) VALUES ($1, $2, 'solve', $3)`,
          [me, reward, puzzleId]
        );
      }
      await client.query(
        `UPDATE sudoku_solved_logs SET reward_claimed = TRUE WHERE user_id = $1 AND puzzle_id = $2`,
        [me, puzzleId]
      );
    }
    const bal = await client.query(`SELECT palladium_grams FROM sudoku_profiles WHERE id = $1`, [me]);
    await client.query("COMMIT");
    if (issued) await sudokuWeekAddPoints(me, reward); // joins the weekly group, even with 0 points
    const achievements = await sudokuAwardAchievements(me);

    return res.status(200).json({
      resStatus: true,
      first,
      best: r.rows[0].time_seconds,
      reward,
      palladium: bal.rows[0].palladium_grams,
      achievements
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (e) { /* not in a transaction */ }
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  WEEKLY RACE (same as Langas): groups of 38, Monday 00:00 Riga reset,
//  palladium prizes. Race points = palladium earned from solves this week.
// ══════════════════════════════════════════════════════════════════════════
const SUDOKU_WEEK_GROUP = 38;  // Monday: groups fill up to 38, then a new group opens
const SUDOKU_WEEK_SQL = `date_trunc('week', NOW() AT TIME ZONE '${SUDOKU_TZ}')::date`; // this Monday

// Palladium (grams) for a place in the group. Needs at least 1 point.
function sudokuWeekReward(rank) {
  if (rank === 1) return 7;
  if (rank === 2) return 6;
  if (rank === 3) return 5;
  if (rank === 4) return 4;
  if (rank <= 10) return 3;
  if (rank <= 20) return 2;
  if (rank <= 30) return 1;
  return 0;
}

// Adds race points. The first solve of the week puts the player in a group:
// Monday = first group with room (< 38) or a new one; from Tuesday = the smallest group.
async function sudokuWeekAddPoints(userId, points) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7201)"); // one join at a time
    const wk = (await client.query(
      `SELECT to_char(${SUDOKU_WEEK_SQL}, 'YYYY-MM-DD') AS w,
              (NOW() AT TIME ZONE '${SUDOKU_TZ}') < (${SUDOKU_WEEK_SQL} + 1) AS monday`
    )).rows[0];
    const mem = await client.query(
      `SELECT group_id FROM sudoku_week_members WHERE week_start = $1 AND user_id = $2`,
      [wk.w, userId]
    );
    if (!mem.rowCount) {
      const groups = await client.query(
        `SELECT g.id, COUNT(m.user_id)::int AS n
         FROM sudoku_week_groups g
         LEFT JOIN sudoku_week_members m ON m.group_id = g.id
         WHERE g.week_start = $1
         GROUP BY g.id ORDER BY g.id`,
        [wk.w]
      );
      let gid = null;
      if (wk.monday) {
        const open = groups.rows.find(g => g.n < SUDOKU_WEEK_GROUP);
        if (open) gid = open.id;
      } else if (groups.rowCount) {
        gid = groups.rows.reduce((a, b) => (b.n < a.n ? b : a)).id;
      }
      if (!gid) {
        gid = (await client.query(
          `INSERT INTO sudoku_week_groups (week_start) VALUES ($1) RETURNING id`, [wk.w]
        )).rows[0].id;
      }
      await client.query(
        `INSERT INTO sudoku_week_members (week_start, user_id, group_id, points) VALUES ($1, $2, $3, $4)`,
        [wk.w, userId, gid, points]
      );
    } else if (points > 0) {
      await client.query(
        `UPDATE sudoku_week_members SET points = points + $3, reached_at = NOW()
         WHERE week_start = $1 AND user_id = $2`,
        [wk.w, userId, points]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (e2) { /* ignore */ }
    console.error("Sudoku week points error:", e.message);
  } finally {
    client.release();
  }
}

// Ends finished weeks: ranks every group, saves the results, adds the palladium.
async function sudokuWeekFinish() {
  const client = await pool.connect();
  const finished = []; // players with a new result: check race achievements after saving
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7202)");
    const groups = await client.query(
      `SELECT id, to_char(week_start, 'YYYY-MM-DD') AS w FROM sudoku_week_groups
       WHERE finalized = FALSE AND week_start < ${SUDOKU_WEEK_SQL} ORDER BY id`
    );
    for (const g of groups.rows) {
      const m = await client.query(
        `SELECT user_id, points FROM sudoku_week_members WHERE group_id = $1
         ORDER BY points DESC, reached_at ASC, user_id ASC`,
        [g.id]
      );
      let rank = 0;
      for (const r of m.rows) {
        rank++;
        const pd = r.points >= 1 ? sudokuWeekReward(rank) : 0;
        const ins = await client.query(
          `INSERT INTO sudoku_week_results (week_start, user_id, group_id, rank, group_size, points, palladium)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
          [g.w, r.user_id, g.id, rank, m.rowCount, r.points, pd]
        );
        if (ins.rowCount) finished.push(r.user_id);
        if (ins.rowCount && pd > 0) {
          await client.query(`UPDATE sudoku_profiles SET palladium_grams = palladium_grams + $2 WHERE id = $1`, [r.user_id, pd]);
          await client.query(
            `INSERT INTO sudoku_palladium_ledger (user_id, amount, source) VALUES ($1, $2, 'race')`,
            [r.user_id, pd]
          );
        }
      }
      await client.query(`UPDATE sudoku_week_groups SET finalized = TRUE WHERE id = $1`, [g.id]);
    }
    await client.query("COMMIT");
    for (const u of finished) sudokuAchCheck(u);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (e2) { /* ignore */ }
    console.error("Sudoku week finish error:", e.message);
  } finally {
    client.release();
  }
}
setTimeout(sudokuWeekFinish, 90 * 1000);
setInterval(sudokuWeekFinish, 10 * 60 * 1000);

function sudokuEndsIn(sec) {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return d + " d " + h + " h";
  if (h > 0) return h + " h " + m + " m";
  return m + " m";
}

// Monday popup: last week's result, once (marked as seen when sent).
router.get("/week/last", sudokuRateLimit(30), sudokuRequireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE sudoku_week_results SET seen = TRUE
       WHERE user_id = $1 AND seen = FALSE
       RETURNING week_start, rank, group_size, points, palladium`,
      [req.sudokuUser.id]
    );
    if (!r.rowCount) return res.status(200).json({ resStatus: true, has: false });
    const last = r.rows.reduce((a, b) => (b.week_start > a.week_start ? b : a));
    const tot = await pool.query(`SELECT palladium_grams FROM sudoku_profiles WHERE id = $1`, [req.sudokuUser.id]);
    return res.status(200).json({
      resStatus: true,
      has: true,
      rank: last.rank,
      groupSize: last.group_size,
      points: last.points,
      palladium: last.palladium,
      total: tot.rowCount ? tot.rows[0].palladium_grams : 0
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// GET /leaderboard?scope=group|friends
//  group:   your group of 38 this week, with the palladium each place would win now
//  friends: you + your friends, by this week's race points
router.get("/leaderboard", sudokuRateLimit(30), sudokuRequireAuth, async (req, res) => {
  const me = req.sudokuUser.id;
  const scope = req.query.scope === "friends" ? "friends" : "group";
  try {
    const wk = (await pool.query(
      `SELECT GREATEST(0, EXTRACT(EPOCH FROM
                (((${SUDOKU_WEEK_SQL} + 7)::timestamp AT TIME ZONE '${SUDOKU_TZ}') - NOW())))::int AS ends,
              (SELECT group_id FROM sudoku_week_members
               WHERE week_start = ${SUDOKU_WEEK_SQL} AND user_id = $1) AS gid`,
      [me]
    )).rows[0];

    let rows = [];
    if (scope === "group") {
      if (wk.gid) {
        rows = (await pool.query(
          `SELECT m.user_id, m.points, u.username, u.avatar_path,
                  ROW_NUMBER() OVER (ORDER BY m.points DESC, m.reached_at ASC, m.user_id ASC)::int AS rnk
           FROM sudoku_week_members m JOIN sudoku_profiles u ON u.id = m.user_id
           WHERE m.group_id = $1
           ORDER BY rnk`,
          [wk.gid]
        )).rows;
      }
    } else {
      rows = (await pool.query(
        `WITH ppl AS (
           SELECT $1::uuid AS id
           UNION
           SELECT CASE WHEN user_id = $1 THEN friend_id ELSE user_id END
           FROM sudoku_friendships WHERE status = 'accepted' AND (user_id = $1 OR friend_id = $1)
         )
         SELECT p.id AS user_id, COALESCE(m.points, 0) AS points, u.username, u.avatar_path,
                ROW_NUMBER() OVER (ORDER BY COALESCE(m.points, 0) DESC, m.reached_at ASC NULLS LAST, p.id ASC)::int AS rnk
         FROM ppl p
         JOIN sudoku_profiles u ON u.id = p.id
         LEFT JOIN sudoku_week_members m ON m.user_id = p.id AND m.week_start = ${SUDOKU_WEEK_SQL}
         ORDER BY rnk`,
        [me]
      )).rows;
    }

    const links = await sudokuAvatarLinks(rows.map(x => x.avatar_path));
    const out = rows.map(x => ({
      rank: x.rnk,
      userId: x.user_id,
      name: x.username,
      avatarUrl: links[x.avatar_path] || "",
      grams: x.points,
      prize: scope === "group" && x.points >= 1 ? sudokuWeekReward(x.rnk) : 0,
      isMe: x.user_id === me
    }));

    return res.status(200).json({
      resStatus: true,
      scope,
      joined: !!wk.gid,
      groupSize: scope === "group" ? out.length : 0,
      rows: out,
      me: out.find(x => x.isMe) || { rank: 0, userId: me, name: "", avatarUrl: "", grams: 0, prize: 0, isMe: true },
      endsIn: sudokuEndsIn(wk.ends)
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
      `SELECT s.difficulty, COUNT(*)::int AS solved, MIN(l.time_seconds)::int AS best,
              COALESCE(SUM(l.time_seconds), 0)::int AS total
       FROM sudoku_solved_logs l JOIN sudoku_seeds s ON s.id = l.puzzle_id
       WHERE l.user_id = $1 GROUP BY s.difficulty`,
      [userId]
    );
    const byDiff = {};
    for (const row of st.rows) byDiff[row.difficulty] = row;
    const pc = await pool.query(`SELECT difficulty, COUNT(*)::int AS n FROM sudoku_seeds GROUP BY difficulty`);
    const poolSize = {};
    for (const row of pc.rows) poolSize[row.difficulty] = row.n;
    const stats = SUDOKU_DIFFICULTIES.map(d => ({
      difficulty: d,
      solved: byDiff[d] ? byDiff[d].solved : 0,
      bestSeconds: byDiff[d] ? byDiff[d].best : 0,
      totalSeconds: byDiff[d] ? byDiff[d].total : 0,
      puzzles: poolSize[d] || 0
    }));

    const state = await sudokuFriendState(me, p.id);
    const lists = state === "me" ? await sudokuFriendLists(p.id) : { friends: [], requests: [], declined: [] };
    const ach = await sudokuProfileAchievements(p.id, me);

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
        requests: lists.requests,
        declined: lists.declined,
        achievements: ach.list,
        achievementCount: ach.count,
        achievementTotal: ach.total
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
    await pool.query(`UPDATE sudoku_profiles SET username = $1, name_changed = TRUE WHERE id = $2`, [name, req.sudokuUser.id]);
    sudokuAchCheck(req.sudokuUser.id);
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
      sudokuAchCheck(req.sudokuUser.id);
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
      const log = await pool.query(
        `SELECT COUNT(*)::int AS n, MIN(created_at) AS first FROM sudoku_friend_request_log
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
        [me]
      );
      if (log.rows[0].n >= SUDOKU_FRIEND_REQUESTS_PER_MONTH) {
        const next = new Date(new Date(log.rows[0].first).getTime() + 30 * 24 * 60 * 60 * 1000);
        const day = next.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: SUDOKU_TZ });
        return res.status(403).json({
          resStatus: false, resErrorCode: 4,
          resMessage: "You can send " + SUDOKU_FRIEND_REQUESTS_PER_MONTH + " friend requests a month. Next one on " + day + "."
        });
      }
      const full = await sudokuCheckCapacity(me, other);
      if (full) return res.status(403).json({ resStatus: false, resMessage: full, resErrorCode: 5 });
      // A withdrawn request comes back (if they declined it, it stays declined); otherwise a new row
      const back = await pool.query(
        `UPDATE sudoku_friendships
         SET status = 'pending', created_at = NOW(), cancelled_at = NULL,
             declined_at = CASE WHEN user_id = $1 THEN declined_at ELSE NULL END,
             user_id = $1, friend_id = $2
         WHERE ${pair} AND status = 'pending' AND cancelled_at IS NOT NULL`,
        [me, other]
      );
      if (!back.rowCount) {
        await pool.query(
          `INSERT INTO sudoku_friendships (user_id, friend_id, status) VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING`,
          [me, other]
        );
      }
      await pool.query(`INSERT INTO sudoku_friend_request_log (user_id, to_id) VALUES ($1, $2)`, [me, other]);
    } else if ((action === "request" || action === "accept") && now === "incoming") {
      // They already asked: asking back means yes. Works for declined requests too.
      const full = await sudokuCheckCapacity(me, other);
      if (full) return res.status(403).json({ resStatus: false, resMessage: full, resErrorCode: 5 });
      await pool.query(
        `UPDATE sudoku_friendships SET status = 'accepted', accepted_at = NOW(), declined_at = NULL
         WHERE user_id = $2 AND friend_id = $1 AND status = 'pending' AND cancelled_at IS NULL`,
        [me, other]
      );
    } else if (action === "decline" && now === "incoming") {
      // Only the receiver knows: it moves to her Declined list, the sender still sees "Requested".
      await pool.query(
        `UPDATE sudoku_friendships SET declined_at = COALESCE(declined_at, NOW())
         WHERE user_id = $2 AND friend_id = $1 AND status = 'pending' AND cancelled_at IS NULL`,
        [me, other]
      );
    } else if (action === "cancel" && now === "sent") {
      // Kept as withdrawn, so a declined request can't be sent again as a fresh one
      await pool.query(
        `UPDATE sudoku_friendships SET cancelled_at = NOW()
         WHERE user_id = $1 AND friend_id = $2 AND status = 'pending' AND cancelled_at IS NULL`,
        [me, other]
      );
    } else if (action === "remove" && now === "friends") {
      await pool.query(`DELETE FROM sudoku_friendships WHERE ${pair} AND status = 'accepted'`, [me, other]);
    }
    sudokuAchCheck(me);
    sudokuAchCheck(other);
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
              f.user_id AS requester, f.status, f.cancelled_at
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
    const state = x => !x.status || (x.status !== "accepted" && x.cancelled_at) ? "none"
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

// ══════════════════════════════════════════════════════════════════════════
//  MESSAGES (friends only, short notes up to 200 characters — same as Langas)
// ══════════════════════════════════════════════════════════════════════════
const SUDOKU_MSG_MAX = 200;
const SUDOKU_MSG_PAGE = 50;           // newest messages shown in a conversation
const SUDOKU_MSG_PER_MINUTE = 10;     // per sender

// "14:05" today, "27 Oct 14:05" earlier (Riga time)
const SUDOKU_MSG_TIME = `CASE
    WHEN (m.created_at AT TIME ZONE '${SUDOKU_TZ}')::date = (NOW() AT TIME ZONE '${SUDOKU_TZ}')::date
    THEN to_char(m.created_at AT TIME ZONE '${SUDOKU_TZ}', 'HH24:MI')
    ELSE to_char(m.created_at AT TIME ZONE '${SUDOKU_TZ}', 'FMDD Mon HH24:MI') END`;

// Unread messages from current friends only (a removed friend's old messages don't keep a dot)
const SUDOKU_MSG_FROM_FRIEND = `EXISTS (
    SELECT 1 FROM sudoku_friendships f
    WHERE f.status = 'accepted'
      AND LEAST(f.user_id, f.friend_id) = LEAST(m.sender_id, m.receiver_id)
      AND GREATEST(f.user_id, f.friend_id) = GREATEST(m.sender_id, m.receiver_id))`;

function sudokuMsgDto(m, me) {
  return { id: Number(m.id), mine: m.sender_id === me, text: m.body, time: m.t };
}

// Messages screen: your friends (newest chat first) with the last message, time and unread count.
router.get("/messages", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
  const me = req.sudokuUser.id;
  try {
    const r = await pool.query(
      `WITH fr AS (
         SELECT CASE WHEN user_id = $1 THEN friend_id ELSE user_id END AS other
         FROM sudoku_friendships
         WHERE status = 'accepted' AND (user_id = $1 OR friend_id = $1)
       ), last AS (
         SELECT DISTINCT ON (LEAST(m.sender_id, m.receiver_id), GREATEST(m.sender_id, m.receiver_id))
                CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END AS other,
                m.id, m.sender_id, m.body,
                CASE
                  WHEN (m.created_at AT TIME ZONE '${SUDOKU_TZ}')::date = (NOW() AT TIME ZONE '${SUDOKU_TZ}')::date
                  THEN to_char(m.created_at AT TIME ZONE '${SUDOKU_TZ}', 'HH24:MI')
                  WHEN (m.created_at AT TIME ZONE '${SUDOKU_TZ}')::date = (NOW() AT TIME ZONE '${SUDOKU_TZ}')::date - 1
                  THEN 'Yesterday'
                  ELSE to_char(m.created_at AT TIME ZONE '${SUDOKU_TZ}', 'FMDD Mon')
                END AS t
         FROM sudoku_messages m
         WHERE m.sender_id = $1 OR m.receiver_id = $1
         ORDER BY LEAST(m.sender_id, m.receiver_id), GREATEST(m.sender_id, m.receiver_id), m.id DESC
       )
       SELECT fr.other AS id, u.username AS name, u.avatar_path,
              l.id AS last_id, l.sender_id, l.body, l.t,
              (SELECT COUNT(*) FROM sudoku_messages x
               WHERE x.sender_id = fr.other AND x.receiver_id = $1 AND x.read_at IS NULL)::int AS unread
       FROM fr
       JOIN sudoku_profiles u ON u.id = fr.other
       LEFT JOIN last l ON l.other = fr.other
       ORDER BY l.id DESC NULLS LAST, name
       LIMIT 200`,
      [me]
    );
    const links = await sudokuAvatarLinks(r.rows.map(x => x.avatar_path));
    const person = x => ({ userId: x.id, name: x.name, avatarUrl: links[x.avatar_path] || "", unread: x.unread || 0 });
    return res.status(200).json({
      resStatus: true,
      chats: r.rows.filter(x => x.last_id).map(x => ({
        ...person(x),
        text: x.body,
        mine: x.sender_id === me,
        time: x.t
      })),
      friends: r.rows.map(person)
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// Red dots: unread messages + friend requests waiting for you.
router.get("/messages/unread", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM sudoku_messages m
          WHERE m.receiver_id = $1 AND m.read_at IS NULL AND ${SUDOKU_MSG_FROM_FRIEND})::int AS messages,
         (SELECT COUNT(*) FROM sudoku_friendships
          WHERE friend_id = $1 AND status = 'pending' AND declined_at IS NULL AND cancelled_at IS NULL)::int AS requests`,
      [req.sudokuUser.id]
    );
    const x = r.rows[0] || { messages: 0, requests: 0 };
    return res.status(200).json({
      resStatus: true, messages: x.messages, requests: x.requests, total: x.messages + x.requests
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// Conversation with a friend (newest 50, oldest first). Marks their messages as read.
router.get("/messages/:id", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
  const other = sudokuParseUuid(req.params.id);
  const me = req.sudokuUser.id;
  if (!other || other === me) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid request", resErrorCode: 1 });
  }
  try {
    if (await sudokuFriendState(me, other) !== "friends") {
      return res.status(403).json({ resStatus: false, resMessage: "Only friends can send messages", resErrorCode: 2 });
    }
    const r = await pool.query(
      `SELECT * FROM (
         SELECT m.id, m.sender_id, m.body, ${SUDOKU_MSG_TIME} AS t
         FROM sudoku_messages m
         WHERE LEAST(m.sender_id, m.receiver_id) = LEAST($1::uuid, $2::uuid)
           AND GREATEST(m.sender_id, m.receiver_id) = GREATEST($1::uuid, $2::uuid)
         ORDER BY m.id DESC
         LIMIT ${SUDOKU_MSG_PAGE}
       ) x ORDER BY id`,
      [me, other]
    );
    await pool.query(
      `UPDATE sudoku_messages SET read_at = NOW()
       WHERE sender_id = $2 AND receiver_id = $1 AND read_at IS NULL`,
      [me, other]
    );
    return res.status(200).json({ resStatus: true, messages: r.rows.map(m => sudokuMsgDto(m, me)) });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// Body: { text }  -> { message }
router.post("/messages/:id", sudokuRateLimit(30), sudokuRequireAuth, async (req, res) => {
  const other = sudokuParseUuid(req.params.id);
  const me = req.sudokuUser.id;
  if (!other || other === me) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid request", resErrorCode: 1 });
  }
  const text = String(req.body?.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return res.status(400).json({ resStatus: false, resMessage: "Write something first", resErrorCode: 3 });
  }
  if ([...text].length > SUDOKU_MSG_MAX) {
    return res.status(400).json({ resStatus: false, resMessage: "Max 200 characters", resErrorCode: 4 });
  }
  try {
    if (await sudokuFriendState(me, other) !== "friends") {
      return res.status(403).json({ resStatus: false, resMessage: "Only friends can send messages", resErrorCode: 2 });
    }
    const recent = await pool.query(
      `SELECT COUNT(*)::int AS n FROM sudoku_messages
       WHERE sender_id = $1 AND created_at > NOW() - INTERVAL '1 minute'`,
      [me]
    );
    if (recent.rows[0].n >= SUDOKU_MSG_PER_MINUTE) {
      return res.status(429).json({ resStatus: false, resMessage: "Slow down a little", resErrorCode: 5 });
    }
    const ins = await pool.query(
      `INSERT INTO sudoku_messages (sender_id, receiver_id, body) VALUES ($1, $2, $3)
       RETURNING id, sender_id, body, to_char(created_at AT TIME ZONE '${SUDOKU_TZ}', 'HH24:MI') AS t`,
      [me, other, text]
    );
    sudokuAchCheck(me);
    return res.status(200).json({ resStatus: true, message: sudokuMsgDto(ins.rows[0], me) });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  ACHIEVEMENTS (same as Langas): earned automatically, friends can congratulate
// ══════════════════════════════════════════════════════════════════════════
// color: sun | coral | ink | mint | teal (badge colour in the app). Order = easy first.
const SUDOKU_LEVEL_NAMES = { easy: "Easy", medium: "Medium", hard: "Hard", ultra_hard: "Ultra Hard" };
const SUDOKU_LEVEL_ICONS = { easy: "house", medium: "building", hard: "skyscraper", ultra_hard: "castle" };
const SUDOKU_SPEED = { // seconds, slow → fast
  easy: [300, 180, 120], medium: [480, 360, 240], hard: [900, 720, 480], ultra_hard: [1800, 1200, 900]
};

const SUDOKU_ACHIEVEMENTS = (() => {
  const A = [];
  const add = (code, title, text, icon, color) => A.push({ code, title, text, icon, color });
  const plural = n => (n === 1 ? "puzzle" : "puzzles");

  for (const n of [1, 5, 10, 25, 50, 100, 200, 250, 500, 750, 1000, 2000, 3000, 4000]) {
    add("solved_" + n, n === 1 ? "First puzzle" : n + " puzzles", "Solve " + n + " " + plural(n),
      n >= 100 ? "trophy" : "star", n >= 2000 ? "ink" : n >= 500 ? "coral" : "sun");
  }
  for (const d of SUDOKU_DIFFICULTIES) {
    add("first_" + d, "First " + SUDOKU_LEVEL_NAMES[d], "Solve your first " + SUDOKU_LEVEL_NAMES[d] + " puzzle",
      SUDOKU_LEVEL_ICONS[d], "mint");
  }
  for (const n of [10, 100, 500]) {
    for (const d of SUDOKU_DIFFICULTIES) {
      add("level_" + d + "_" + n, SUDOKU_LEVEL_NAMES[d] + " " + n, "Solve " + n + " " + SUDOKU_LEVEL_NAMES[d] + " puzzles",
        SUDOKU_LEVEL_ICONS[d], n >= 500 ? "ink" : n >= 100 ? "teal" : "mint");
    }
  }
  for (const d of SUDOKU_DIFFICULTIES) {
    add("master_" + d, SUDOKU_LEVEL_NAMES[d] + " master", "Solve every " + SUDOKU_LEVEL_NAMES[d] + " puzzle", "crown", "coral");
  }
  add("grand_master", "Grand master", "Solve every puzzle in Sudoku Town", "crown", "ink");
  for (const d of SUDOKU_DIFFICULTIES) {
    SUDOKU_SPEED[d].forEach((sec, i) => {
      add("speed_" + d + "_" + (i + 1), SUDOKU_LEVEL_NAMES[d] + " in " + sec / 60 + " min",
        "Solve " + SUDOKU_LEVEL_NAMES[d] + " in under " + sec / 60 + " minutes", "bolt", ["sun", "coral", "ink"][i]);
    });
  }
  add("patience", "Patience", "Finish a puzzle that took over 1 hour", "turtle", "teal");
  for (const n of [3, 7, 14, 30, 60, 100, 200, 365]) {
    add("streak_" + n, n + "-day streak", "Solve puzzles " + n + " days in a row", "flame", n >= 60 ? "ink" : "coral");
  }
  for (const h of [1, 5, 10, 25, 50, 100]) {
    add("time_" + h, h === 1 ? "1 hour" : h + " hours", "Solve for " + h + (h === 1 ? " hour" : " hours") + " in total",
      "clock", h >= 25 ? "ink" : "teal");
  }
  add("day_5", "Busy day", "Solve 5 puzzles in one day", "calendar", "mint");
  add("day_10", "Marathon", "Solve 10 puzzles in one day", "calendar", "coral");
  add("day_20", "Super marathon", "Solve 20 puzzles in one day", "calendar", "ink");
  add("all_rounder", "All-rounder", "Solve all 4 levels in one day", "star", "teal");
  add("early_bird", "Early bird", "Solve a puzzle before 08:00", "sun", "sun");
  add("night_owl", "Night owl", "Solve a puzzle after 23:00", "clock", "ink");
  add("midnight", "Midnight solver", "Solve a puzzle between 00:00 and 01:00", "hourglass", "ink");
  add("weekend", "Weekend warrior", "Solve on Saturday and Sunday of the same weekend", "calendar", "sun");
  add("comeback", "Comeback", "Solve again after 30 days away", "arrow", "mint");
  for (const n of [1, 5, 10, 25, 50]) {
    add("friend_" + n, n === 1 ? "First friend" : n + " friends", n === 1 ? "Make your first friend" : "Have " + n + " friends",
      "friends", n >= 25 ? "teal" : "mint");
  }
  add("message_1", "First message", "Send a message to a friend", "chat", "sun");
  add("message_100", "Chatterbox", "Send 100 messages", "chat", "teal");
  add("cheer_1", "Cheerleader", "Congratulate someone's achievement", "thumb", "sun");
  add("cheer_10", "Big fan", "Congratulate 10 achievements", "thumb", "coral");
  add("cheer_50", "Super fan", "Congratulate 50 achievements", "thumb", "ink");
  add("popular_10", "Popular", "Get 10 congratulations", "heart", "coral");
  add("popular_50", "Star", "Get 50 congratulations", "heart", "ink");
  add("photo_1", "Say cheese", "Add a profile photo", "camera", "mint");
  add("name_1", "New name", "Change your name", "pencil", "sun");
  for (const g of [1, 10, 50, 100, 250, 500]) {
    add("pd_" + g, g === 1 ? "First palladium" : g + " g palladium",
      g === 1 ? "Earn your first palladium" : "Collect " + g + " g of palladium", "palladium",
      g >= 250 ? "coral" : g >= 50 ? "teal" : "ink");
  }
  add("top10_1", "Top 10", "Finish top 10 in your weekly group", "trophy", "mint");
  add("podium_1", "Podium", "Finish top 3 in your weekly group", "trophy", "sun");
  add("podium_5", "Podium regular", "Finish top 3 five times", "trophy", "coral");
  add("champion_1", "Champion", "Finish #1 in your weekly group", "trophy", "coral");
  add("champion_5", "Town legend", "Finish #1 five times", "crown", "ink");
  for (const n of [4, 12, 26, 52]) {
    add("racer_" + n, n === 4 ? "Racer" : n + " races", "Finish " + n + " weekly races", "flag", n >= 26 ? "ink" : "mint");
  }
  return A;
})();
const SUDOKU_ACH_BY_CODE = Object.fromEntries(SUDOKU_ACHIEVEMENTS.map(a => [a.code, a]));

function sudokuAchDto(code, date) {
  const a = SUDOKU_ACH_BY_CODE[code];
  return a ? { code: a.code, title: a.title, text: a.text, icon: a.icon, color: a.color, date: date || "" } : null;
}

// Saves every achievement the player now qualifies for, returns only the new ones. Never throws.
// Speed and patience count only puzzles the server gave out (no made-up times).
async function sudokuAwardAchievements(userId) {
  try {
    const r = await pool.query(
      `WITH l AS (
         SELECT l.time_seconds AS t, s.difficulty AS d, COALESCE(l.reward_claimed, FALSE) AS fair,
                l.solved_at AT TIME ZONE '${SUDOKU_TZ}' AS at
         FROM sudoku_solved_logs l JOIN sudoku_seeds s ON s.id = l.puzzle_id
         WHERE l.user_id = $1
       ), days AS (
         SELECT DISTINCT at::date AS day FROM l WHERE at IS NOT NULL
       ), lvl AS (
         SELECT d, COUNT(*)::int AS n, MIN(t) FILTER (WHERE fair)::int AS best FROM l GROUP BY d
       ), pool AS (
         SELECT difficulty AS d, COUNT(*)::int AS n FROM sudoku_seeds GROUP BY difficulty
       )
       SELECT
         (SELECT COUNT(*) FROM l)::int AS solved,
         (SELECT json_object_agg(d, n) FROM lvl) AS per_level,
         (SELECT json_object_agg(d, best) FROM lvl) AS best,
         (SELECT json_object_agg(d, n) FROM pool) AS pool,
         EXISTS (SELECT 1 FROM l WHERE fair AND t > 3600) AS patience,
         (SELECT COALESCE(SUM(t), 0) FROM l)::bigint AS secs,
         (SELECT COALESCE(MAX(c), 0) FROM (SELECT COUNT(*) AS c FROM l GROUP BY at::date) x)::int AS day_max,
         EXISTS (SELECT 1 FROM l GROUP BY at::date HAVING COUNT(DISTINCT d) >= 4) AS all_rounder,
         EXISTS (SELECT 1 FROM l WHERE EXTRACT(HOUR FROM at) < 8) AS early,
         EXISTS (SELECT 1 FROM l WHERE EXTRACT(HOUR FROM at) >= 23) AS night,
         EXISTS (SELECT 1 FROM l WHERE EXTRACT(HOUR FROM at) = 0) AS midnight,
         EXISTS (SELECT 1 FROM days a JOIN days b ON b.day = a.day + 1 WHERE EXTRACT(ISODOW FROM a.day) = 6) AS weekend,
         EXISTS (SELECT 1 FROM (SELECT day - LAG(day) OVER (ORDER BY day) AS gap FROM days) g WHERE g.gap >= 30) AS comeback,
         (SELECT COALESCE(MAX(c), 0) FROM (
            SELECT COUNT(*) AS c FROM (SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day))::int AS grp FROM days) z
            GROUP BY grp) y)::int AS streak,
         (SELECT COUNT(*) FROM sudoku_friendships
          WHERE status = 'accepted' AND (user_id = $1 OR friend_id = $1))::int AS friends,
         (SELECT COUNT(*) FROM sudoku_messages WHERE sender_id = $1)::int AS messages,
         (SELECT COUNT(*) FROM sudoku_achievement_cheers WHERE user_id = $1)::int AS cheers_given,
         (SELECT COUNT(*) FROM sudoku_achievement_cheers c JOIN sudoku_achievements a ON a.id = c.achievement_id
          WHERE a.user_id = $1)::int AS cheers_got,
         (SELECT avatar_path IS NOT NULL FROM sudoku_profiles WHERE id = $1) AS photo,
         (SELECT name_changed FROM sudoku_profiles WHERE id = $1) AS named,
         (SELECT COALESCE(SUM(amount), 0) FROM sudoku_palladium_ledger
          WHERE user_id = $1 AND source IN ('solve', 'race'))::int AS pd,
         (SELECT COUNT(*) FROM sudoku_week_results WHERE user_id = $1 AND rank <= 10 AND points >= 1)::int AS top10,
         (SELECT COUNT(*) FROM sudoku_week_results WHERE user_id = $1 AND rank <= 3 AND points >= 1)::int AS podiums,
         (SELECT COUNT(*) FROM sudoku_week_results WHERE user_id = $1 AND rank = 1 AND points >= 1)::int AS champions,
         (SELECT COUNT(*) FROM sudoku_week_results WHERE user_id = $1)::int AS races`,
      [userId]
    );
    const st = r.rows[0] || {};
    const per = st.per_level || {}, best = st.best || {}, pool_ = st.pool || {};
    const secs = Number(st.secs || 0);
    const earned = [];
    const add = (cond, code) => { if (cond) earned.push(code); };

    for (const n of [1, 5, 10, 25, 50, 100, 200, 250, 500, 750, 1000, 2000, 3000, 4000]) add(st.solved >= n, "solved_" + n);
    for (const d of SUDOKU_DIFFICULTIES) add((per[d] || 0) >= 1, "first_" + d);
    for (const n of [10, 100, 500]) for (const d of SUDOKU_DIFFICULTIES) add((per[d] || 0) >= n, "level_" + d + "_" + n);
    let masters = 0;
    for (const d of SUDOKU_DIFFICULTIES) {
      const all = (pool_[d] || 0) > 0 && (per[d] || 0) >= pool_[d];
      if (all) masters++;
      add(all, "master_" + d);
    }
    add(masters === SUDOKU_DIFFICULTIES.length, "grand_master");
    for (const d of SUDOKU_DIFFICULTIES) {
      SUDOKU_SPEED[d].forEach((sec, i) => add(best[d] != null && best[d] < sec, "speed_" + d + "_" + (i + 1)));
    }
    add(st.patience, "patience");
    for (const n of [3, 7, 14, 30, 60, 100, 200, 365]) add(st.streak >= n, "streak_" + n);
    for (const h of [1, 5, 10, 25, 50, 100]) add(secs >= h * 3600, "time_" + h);
    add(st.day_max >= 5, "day_5");
    add(st.day_max >= 10, "day_10");
    add(st.day_max >= 20, "day_20");
    add(st.all_rounder, "all_rounder");
    add(st.early, "early_bird");
    add(st.night, "night_owl");
    add(st.midnight, "midnight");
    add(st.weekend, "weekend");
    add(st.comeback, "comeback");
    for (const n of [1, 5, 10, 25, 50]) add(st.friends >= n, "friend_" + n);
    add(st.messages >= 1, "message_1");
    add(st.messages >= 100, "message_100");
    add(st.cheers_given >= 1, "cheer_1");
    add(st.cheers_given >= 10, "cheer_10");
    add(st.cheers_given >= 50, "cheer_50");
    add(st.cheers_got >= 10, "popular_10");
    add(st.cheers_got >= 50, "popular_50");
    add(st.photo, "photo_1");
    add(st.named, "name_1");
    for (const g of [1, 10, 50, 100, 250, 500]) add(st.pd >= g, "pd_" + g);
    add(st.top10 >= 1, "top10_1");
    add(st.podiums >= 1, "podium_1");
    add(st.podiums >= 5, "podium_5");
    add(st.champions >= 1, "champion_1");
    add(st.champions >= 5, "champion_5");
    for (const n of [4, 12, 26, 52]) add(st.races >= n, "racer_" + n);
    if (!earned.length) return [];

    const ins = await pool.query(
      `INSERT INTO sudoku_achievements (user_id, code)
       SELECT $1, unnest($2::text[])
       ON CONFLICT (user_id, code) DO NOTHING
       RETURNING code`,
      [userId, earned]
    );
    const fresh = new Set(ins.rows.map(x => x.code));
    // List order (easy ones first): the app shows the last new one as the biggest.
    return SUDOKU_ACHIEVEMENTS.filter(a => fresh.has(a.code)).map(a => sudokuAchDto(a.code, ""));
  } catch (e) {
    return [];
  }
}

// After a friend / message / cheer / photo / name / weekly reset: check in the background.
function sudokuAchCheck(userId) {
  if (userId) sudokuAwardAchievements(userId).catch(() => {});
}

// Latest 7 for a profile, with congratulations (cheered = the viewer congratulated).
async function sudokuProfileAchievements(userId, viewerId) {
  const r = await pool.query(
    `SELECT a.id, a.code, to_char(a.earned_at AT TIME ZONE '${SUDOKU_TZ}', 'FMDD Mon') AS d,
            (SELECT COUNT(*) FROM sudoku_achievement_cheers c WHERE c.achievement_id = a.id)::int AS cheers,
            EXISTS (SELECT 1 FROM sudoku_achievement_cheers c
                    WHERE c.achievement_id = a.id AND c.user_id = $2) AS cheered
     FROM sudoku_achievements a WHERE a.user_id = $1
     ORDER BY a.earned_at DESC, a.id DESC LIMIT 7`,
    [userId, viewerId]
  );
  const n = await pool.query(`SELECT COUNT(*)::int AS n FROM sudoku_achievements WHERE user_id = $1`, [userId]);
  return {
    list: r.rows
      .map(a => {
        const dto = sudokuAchDto(a.code, a.d);
        return dto ? { ...dto, id: Number(a.id), cheers: a.cheers, cheered: a.cheered } : null;
      })
      .filter(Boolean),
    count: n.rows[0].n,
    total: SUDOKU_ACHIEVEMENTS.length
  };
}

// "5 min ago" · "3 h ago" · "2 d ago" · "14 Oct"
function sudokuAgo(date) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  if (s < 7 * 86400) return Math.floor(s / 86400) + " d ago";
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: SUDOKU_TZ });
}

// Who congratulated one of your achievements.
router.get("/achievements/:id/cheers", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid achievement", resErrorCode: 1 });
  }
  try {
    const own = await pool.query(`SELECT user_id FROM sudoku_achievements WHERE id = $1`, [id]);
    if (!own.rowCount) {
      return res.status(404).json({ resStatus: false, resMessage: "Achievement not found", resErrorCode: 2 });
    }
    if (own.rows[0].user_id !== req.sudokuUser.id) {
      return res.status(403).json({ resStatus: false, resMessage: "Only for your own achievements", resErrorCode: 3 });
    }
    const r = await pool.query(
      `SELECT u.id, u.username AS name, u.avatar_path, c.created_at
       FROM sudoku_achievement_cheers c JOIN sudoku_profiles u ON u.id = c.user_id
       WHERE c.achievement_id = $1
       ORDER BY c.created_at DESC
       LIMIT 100`,
      [id]
    );
    const links = await sudokuAvatarLinks(r.rows.map(x => x.avatar_path));
    return res.status(200).json({
      resStatus: true,
      people: r.rows.map(x => ({
        userId: x.id, name: x.name, avatarUrl: links[x.avatar_path] || "", ago: sudokuAgo(x.created_at)
      }))
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// Congratulate another player's achievement; calling it again takes it back.
router.post("/achievements/:id/cheer", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const me = req.sudokuUser.id;
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid achievement", resErrorCode: 1 });
  }
  try {
    const own = await pool.query(`SELECT user_id FROM sudoku_achievements WHERE id = $1`, [id]);
    if (!own.rowCount) {
      return res.status(404).json({ resStatus: false, resMessage: "Achievement not found", resErrorCode: 2 });
    }
    if (own.rows[0].user_id === me) {
      return res.status(400).json({ resStatus: false, resMessage: "You can't congratulate yourself", resErrorCode: 3 });
    }
    const del = await pool.query(
      `DELETE FROM sudoku_achievement_cheers WHERE achievement_id = $1 AND user_id = $2`, [id, me]
    );
    if (!del.rowCount) {
      await pool.query(
        `INSERT INTO sudoku_achievement_cheers (achievement_id, user_id) VALUES ($1, $2)
         ON CONFLICT (achievement_id, user_id) DO NOTHING`,
        [id, me]
      );
      sudokuAchCheck(me);                  // Cheerleader
      sudokuAchCheck(own.rows[0].user_id); // Popular
    }
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM sudoku_achievement_cheers WHERE achievement_id = $1`, [id]);
    return res.status(200).json({ resStatus: true, cheered: del.rowCount === 0, cheers: n.rows[0].n });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

module.exports = router;
