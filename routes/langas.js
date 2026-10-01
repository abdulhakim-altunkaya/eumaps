const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const axios = require("axios");
const { pool } = require("../db");

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const LANGAS_WEB_CLIENT_ID     = process.env.LANGAS_GOOGLE_WEB_CLIENT_ID;
const LANGAS_WEB_CLIENT_SECRET = process.env.LANGAS_GOOGLE_WEB_CLIENT_SECRET;
const LANGAS_SESSION_MS        = 1000 * 60 * 60 * 24 * 365; // 1 year
const LANGAS_POINTS_PER_CORRECT = 10;
const LANGAS_LEADERBOARD_LIMIT  = 50;
const LANGAS_MAX_ANSWERS        = 100;
const LANGAS_TOKEN_RE           = /^[a-f0-9]{128}$/;

// ── HELPERS ────────────────────────────────────────────────────────────────
function langasGetIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (cf) return cf.trim();
  const xf = req.headers["x-forwarded-for"];
  let ip = xf ? xf.split(",")[0].trim() : req.socket?.remoteAddress || req.ip;
  if (ip?.startsWith("::ffff:")) ip = ip.slice(7);
  return ip || "unknown";
}

function langasAppVersion(req) {
  const v = parseInt(req.query.appVersion, 10);
  return Number.isInteger(v) && v > 0 ? v : 1;
}

function langasNormalize(s) {
  return String(s || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[.,!?;:"'()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function langasParseId(raw) {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 && String(n) === String(raw) ? n : null;
}

// ── RATE LIMITER ───────────────────────────────────────────────────────────
const langasRateStore = Object.create(null);
function langasRateLimit(limitPerMinute) {
  return function (req, res, next) {
    const key = langasGetIp(req) + "|" + limitPerMinute;
    const now = Date.now();
    const w = langasRateStore[key];
    if (!w || now - w.start > 60_000) {
      langasRateStore[key] = { count: 1, start: now };
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
async function langasRequireAuth(req, res, next) {
  const langasAuthHeader = req.headers["authorization"] || "";
  const langasAuthToken = langasAuthHeader.startsWith("Bearer ") ? langasAuthHeader.slice(7).trim() : "";
  if (!LANGAS_TOKEN_RE.test(langasAuthToken)) {
    return res.status(401).json({ resStatus: false, resMessage: "Unauthorized", resErrorCode: 1 });
  }
  try {
    const langasAuthResult = await pool.query(
      `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.display_name
       FROM langas_sessions s
       JOIN langas_users u ON u.id = s.user_id
       WHERE s.token = $1 LIMIT 1`,
      [langasAuthToken]
    );
    if (!langasAuthResult.rowCount) {
      return res.status(401).json({ resStatus: false, resMessage: "Invalid session", resErrorCode: 2 });
    }
    const langasSession = langasAuthResult.rows[0];
    if (new Date(langasSession.expires_at) < new Date()) {
      await pool.query(`DELETE FROM langas_sessions WHERE id = $1`, [langasSession.session_id]);
      return res.status(401).json({ resStatus: false, resMessage: "Session expired", resErrorCode: 3 });
    }
    req.langasUser = {
      id: langasSession.user_id,
      displayName: langasSession.display_name,
      sessionId: langasSession.session_id
    };
    next();
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════════════════

// Unity sends the Play Games server auth code; we exchange it with Google.
router.post("/auth/google", langasRateLimit(10), async (req, res) => {
  const langasLoginCode = String(req.body?.serverAuthCode || "").trim();
  if (!langasLoginCode || langasLoginCode.length > 2048) {
    return res.status(400).json({ resStatus: false, resMessage: "Missing auth code", resErrorCode: 1 });
  }
  if (!LANGAS_WEB_CLIENT_ID || !LANGAS_WEB_CLIENT_SECRET) {
    return res.status(500).json({ resStatus: false, resMessage: "Server not configured", resErrorCode: 98 });
  }

  let langasLoginAccessToken;
  try {
    const langasLoginTokenRes = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code: langasLoginCode,
        client_id: LANGAS_WEB_CLIENT_ID,
        client_secret: LANGAS_WEB_CLIENT_SECRET,
        redirect_uri: "",
        grant_type: "authorization_code"
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 }
    );
    langasLoginAccessToken = langasLoginTokenRes.data?.access_token;
  } catch (err) {
    return res.status(401).json({ resStatus: false, resMessage: "Google verification failed", resErrorCode: 2 });
  }
  if (!langasLoginAccessToken) {
    return res.status(401).json({ resStatus: false, resMessage: "Google verification failed", resErrorCode: 2 });
  }

  let langasLoginPlayerId, langasLoginDisplayName;
  try {
    const langasLoginPlayerRes = await axios.get(
      "https://games.googleapis.com/games/v1/players/me",
      { headers: { Authorization: `Bearer ${langasLoginAccessToken}` }, timeout: 10000 }
    );
    langasLoginPlayerId = String(langasLoginPlayerRes.data?.playerId || "").trim();
    langasLoginDisplayName = String(langasLoginPlayerRes.data?.displayName || "Player").trim().slice(0, 60) || "Player";
  } catch (err) {
    return res.status(401).json({ resStatus: false, resMessage: "Player lookup failed", resErrorCode: 3 });
  }
  if (!langasLoginPlayerId) {
    return res.status(401).json({ resStatus: false, resMessage: "Player lookup failed", resErrorCode: 3 });
  }

  try {
    const langasLoginUser = await pool.query(
      `INSERT INTO langas_users (google_player_id, display_name)
       VALUES ($1, $2)
       ON CONFLICT (google_player_id)
       DO UPDATE SET display_name = EXCLUDED.display_name, last_login_at = NOW()
       RETURNING id, display_name`,
      [langasLoginPlayerId, langasLoginDisplayName]
    );
    const langasLoginUserId = langasLoginUser.rows[0].id;

    await pool.query(`DELETE FROM langas_sessions WHERE user_id = $1 AND expires_at < NOW()`, [langasLoginUserId]);

    const langasLoginToken = crypto.randomBytes(64).toString("hex");
    await pool.query(
      `INSERT INTO langas_sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [langasLoginUserId, langasLoginToken, new Date(Date.now() + LANGAS_SESSION_MS)]
    );

    return res.status(200).json({
      resStatus: true,
      resMessage: "Logged in",
      token: langasLoginToken,
      user: { id: langasLoginUserId, displayName: langasLoginUser.rows[0].display_name }
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

router.get("/auth/me", langasRateLimit(60), langasRequireAuth, (req, res) => {
  return res.status(200).json({
    resStatus: true,
    user: { id: req.langasUser.id, displayName: req.langasUser.displayName }
  });
});

router.post("/auth/logout", langasRateLimit(30), langasRequireAuth, async (req, res) => {
  try {
    await pool.query(`DELETE FROM langas_sessions WHERE id = $1`, [req.langasUser.sessionId]);
    return res.status(200).json({ resStatus: true, resMessage: "Logged out" });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  CONTENT
// ══════════════════════════════════════════════════════════════════════════

// Levels with their exercises + this user's best scores.
router.get("/levels", langasRateLimit(60), langasRequireAuth, async (req, res) => {
  const langasLevelsAppVersion = langasAppVersion(req);
  try {
    const langasLevelsRows = await pool.query(
      `SELECT id, code, title FROM langas_levels ORDER BY sort_order`
    );
    const langasLevelsExRows = await pool.query(
      `SELECT e.id, e.level_id, e.title,
              (SELECT COUNT(*) FROM langas_questions q WHERE q.exercise_id = e.id)::int AS question_count,
              COALESCE(s.best_score, 0)::int AS best_score,
              COALESCE(s.attempts, 0)::int AS attempts
       FROM langas_exercises e
       LEFT JOIN langas_scores s ON s.exercise_id = e.id AND s.user_id = $1
       WHERE e.is_active = TRUE AND e.min_app_version <= $2
       ORDER BY e.sort_order`,
      [req.langasUser.id, langasLevelsAppVersion]
    );

    const langasLevels = langasLevelsRows.rows.map(l => ({
      id: l.id,
      code: l.code,
      title: l.title,
      exercises: langasLevelsExRows.rows
        .filter(e => e.level_id === l.id)
        .map(e => ({
          id: e.id,
          title: e.title,
          questionCount: e.question_count,
          maxScore: e.question_count * LANGAS_POINTS_PER_CORRECT,
          bestScore: e.best_score,
          attempts: e.attempts
        }))
    }));

    return res.status(200).json({ resStatus: true, levels: langasLevels });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// Questions of one exercise — correct answers are NOT sent.
router.get("/exercises/:id", langasRateLimit(60), langasRequireAuth, async (req, res) => {
  const langasExId = langasParseId(req.params.id);
  if (!langasExId) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid exercise", resErrorCode: 1 });
  }
  try {
    const langasExRow = await pool.query(
      `SELECT id, title FROM langas_exercises
       WHERE id = $1 AND is_active = TRUE AND min_app_version <= $2`,
      [langasExId, langasAppVersion(req)]
    );
    if (!langasExRow.rowCount) {
      return res.status(404).json({ resStatus: false, resMessage: "Exercise not found", resErrorCode: 2 });
    }
    const langasExQuestions = await pool.query(
      `SELECT id, type, prompt, options, media_url, instruction
       FROM langas_questions WHERE exercise_id = $1 ORDER BY sort_order`,
      [langasExId]
    );
    return res.status(200).json({
      resStatus: true,
      exercise: {
        id: langasExRow.rows[0].id,
        title: langasExRow.rows[0].title,
        questions: langasExQuestions.rows.map(q => ({
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          options: Array.isArray(q.options) ? q.options : [],
          mediaUrl: q.media_url || "",
          instruction: q.instruction || ""
        }))
      }
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// Grade answers on the server, keep best score.
// Body: { answers: [ { questionId, choiceIndex, text } ] }  (choiceIndex -1 when unused)
router.post("/exercises/:id/submit", langasRateLimit(30), langasRequireAuth, async (req, res) => {
  const langasSubExId = langasParseId(req.params.id);
  if (!langasSubExId) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid exercise", resErrorCode: 1 });
  }
  const langasSubAnswers = req.body?.answers;
  if (!Array.isArray(langasSubAnswers) || langasSubAnswers.length > LANGAS_MAX_ANSWERS) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid answers", resErrorCode: 2 });
  }

  const langasSubAnswerMap = new Map();
  for (const a of langasSubAnswers) {
    const qid = Number(a?.questionId);
    if (Number.isInteger(qid)) langasSubAnswerMap.set(qid, a);
  }

  try {
    const langasSubExRow = await pool.query(
      `SELECT id FROM langas_exercises WHERE id = $1 AND is_active = TRUE`,
      [langasSubExId]
    );
    if (!langasSubExRow.rowCount) {
      return res.status(404).json({ resStatus: false, resMessage: "Exercise not found", resErrorCode: 3 });
    }

    const langasSubQuestions = await pool.query(
      `SELECT id, options, correct_index, accepted_answers
       FROM langas_questions WHERE exercise_id = $1 ORDER BY sort_order`,
      [langasSubExId]
    );

    let langasSubCorrectCount = 0;
    const langasSubResults = langasSubQuestions.rows.map(q => {
      const a = langasSubAnswerMap.get(q.id);
      let correct = false;
      let correctAnswer = "";

      if (q.correct_index !== null && q.correct_index !== undefined) {
        correct = !!a && Number(a.choiceIndex) === q.correct_index;
        correctAnswer = Array.isArray(q.options) ? String(q.options[q.correct_index] ?? "") : "";
      } else if (Array.isArray(q.accepted_answers) && q.accepted_answers.length) {
        const given = langasNormalize(a?.text);
        correct = !!given && q.accepted_answers.some(x => langasNormalize(x) === given);
        correctAnswer = String(q.accepted_answers[0]);
      }

      if (correct) langasSubCorrectCount++;
      return { questionId: q.id, correct, correctAnswer };
    });

    const langasSubScore = langasSubCorrectCount * LANGAS_POINTS_PER_CORRECT;
    const langasSubMax = langasSubQuestions.rowCount * LANGAS_POINTS_PER_CORRECT;

    const langasSubBest = await pool.query(
      `INSERT INTO langas_scores (user_id, exercise_id, best_score, attempts)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (user_id, exercise_id)
       DO UPDATE SET best_score = GREATEST(langas_scores.best_score, EXCLUDED.best_score),
                     attempts   = langas_scores.attempts + 1,
                     updated_at = NOW()
       RETURNING best_score`,
      [req.langasUser.id, langasSubExId, langasSubScore]
    );

    return res.status(200).json({
      resStatus: true,
      score: langasSubScore,
      maxScore: langasSubMax,
      bestScore: langasSubBest.rows[0].best_score,
      results: langasSubResults
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  LEADERBOARD
// ══════════════════════════════════════════════════════════════════════════
router.get("/leaderboard", langasRateLimit(30), langasRequireAuth, async (req, res) => {
  try {
    const langasLbRows = await pool.query(
      `WITH totals AS (
         SELECT u.id, u.display_name, SUM(s.best_score)::int AS total
         FROM langas_users u
         JOIN langas_scores s ON s.user_id = u.id
         GROUP BY u.id
       ), ranked AS (
         SELECT id, display_name, total, RANK() OVER (ORDER BY total DESC)::int AS rnk
         FROM totals
       )
       SELECT id, display_name, total, rnk FROM ranked
       WHERE rnk <= $1 OR id = $2
       ORDER BY rnk, id`,
      [LANGAS_LEADERBOARD_LIMIT, req.langasUser.id]
    );

    const langasLbEntries = [];
    let langasLbMe = { rank: 0, total: 0 };
    for (const r of langasLbRows.rows) {
      if (r.id === req.langasUser.id) langasLbMe = { rank: r.rnk, total: r.total };
      if (r.rnk <= LANGAS_LEADERBOARD_LIMIT) {
        langasLbEntries.push({
          rank: r.rnk,
          displayName: r.display_name,
          total: r.total,
          isMe: r.id === req.langasUser.id
        });
      }
    }

    return res.status(200).json({ resStatus: true, entries: langasLbEntries, me: langasLbMe });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

module.exports = router;