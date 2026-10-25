const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const axios = require("axios");
const { pool, supabase } = require("../db");
const sharp = require("sharp");
const path = require("path");

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const LANGAS_WEB_CLIENT_ID     = process.env.LANGAS_GOOGLE_WEB_CLIENT_ID;
const LANGAS_WEB_CLIENT_SECRET = process.env.LANGAS_GOOGLE_WEB_CLIENT_SECRET;
const LANGAS_SESSION_MS        = 1000 * 60 * 60 * 24 * 365; // 1 year
const LANGAS_POINTS_PER_CORRECT = 10;
const LANGAS_LEADERBOARD_LIMIT  = 50;
const LANGAS_MAX_ANSWERS        = 100;
const LANGAS_TOKEN_RE           = /^[a-f0-9]{128}$/;
const LANGAS_TIME_LIMIT_MS      = 7 * 60 * 1000;
const LANGAS_TIME_BONUS         = 20;
const LANGAS_FAST_MS            = 4 * 60 * 1000;
const LANGAS_FAST_BONUS         = 20;
const langasStartTimes          = new Map(); // "userId:exerciseId" -> ms when the lesson was opened

// ── AUDIO FILES (public, cached 30 days) ───────────────────────────────────
router.use("/audio", express.static(path.join(__dirname, "..", "langas_audio"), {
  maxAge: "30d",
  index: false
}));

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

// Typing questions: the player types the first 6 letters, the rest is shown.
// "pirmdiena" -> { head: "pirmdi", tail: "ena" }; 6 letters or fewer -> tail ""
const LANGAS_TYPE_LETTERS = 6;
function langasSplitTyping(answer) {
  const chars = Array.from(String(answer || "").normalize("NFC"));
  const isLetter = c => /\p{L}/u.test(c);
  let n = 0;
  for (let i = 0; i < chars.length; i++) {
    if (isLetter(chars[i]) && ++n === LANGAS_TYPE_LETTERS) {
      const tail = chars.slice(i + 1).join("");
      if (!/\p{L}/u.test(tail)) break;
      return { head: chars.slice(0, i + 1).join(""), tail };
    }
  }
  return { head: String(answer || ""), tail: "" };
}

function langasIsTyping(q) {
  return (q.type === "write" || q.type === "listen_write") &&
    Array.isArray(q.accepted_answers) && q.accepted_answers.length > 0;
}

function langasParseId(raw) {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 && String(n) === String(raw) ? n : null;
}

// Grammar rule card -> always the same shape for the app
function langasRuleDto(r) {
  const o = r && typeof r === "object" ? r : {};
  return {
    title: String(o.title || ""),
    intro: String(o.intro || ""),
    rows: Array.isArray(o.rows) ? o.rows.map(String) : [],
    note: String(o.note || "")
  };
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
      `SELECT s.id AS session_id, s.expires_at, u.id AS user_id,
              COALESCE(u.custom_name, u.display_name) AS display_name
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
       RETURNING id, COALESCE(custom_name, display_name) AS display_name`,
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
      `SELECT e.id, e.level_id, e.title, e.icon, (e.rule IS NOT NULL) AS is_grammar,
              (SELECT COUNT(*) FROM langas_questions q WHERE q.exercise_id = e.id AND q.min_app_version <= $2)::int AS question_count,
              COALESCE(s.best_score, 0)::int AS best_score,
              COALESCE(s.best_correct, 0)::int AS best_correct,
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
          icon: e.icon || "",
          grammar: e.is_grammar,
          questionCount: e.question_count,
          maxScore: e.question_count * LANGAS_POINTS_PER_CORRECT,
          bestScore: e.best_score,
          bestCorrect: e.best_correct,
          attempts: e.attempts
        }))
    }));

    const langasLevelsStats = await pool.query(
      `WITH totals AS (
         SELECT user_id, SUM(best_score)::int AS total
         FROM langas_scores GROUP BY user_id
       ), ranked AS (
         SELECT user_id, total, RANK() OVER (ORDER BY total DESC)::int AS rnk
         FROM totals
       )
       SELECT u.streak_days,
              (u.streak_last_date >= (NOW() AT TIME ZONE 'Europe/Riga')::date - 1) AS streak_alive,
              COALESCE(r.total, 0)::int AS total,
              COALESCE(r.rnk, 0)::int AS rnk
       FROM langas_users u
       LEFT JOIN ranked r ON r.user_id = u.id
       WHERE u.id = $1`,
      [req.langasUser.id]
    );
    const langasStatsRow = langasLevelsStats.rows[0] || {};

    return res.status(200).json({
      resStatus: true,
      levels: langasLevels,
      stats: {
        streak: langasStatsRow.streak_alive ? langasStatsRow.streak_days : 0,
        points: langasStatsRow.total || 0,
        rank: langasStatsRow.rnk || 0
      }
    });
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
      `SELECT id, title, rule, time_limit_sec FROM langas_exercises
       WHERE id = $1 AND is_active = TRUE AND min_app_version <= $2`,
      [langasExId, langasAppVersion(req)]
    );
    if (!langasExRow.rowCount) {
      return res.status(404).json({ resStatus: false, resMessage: "Exercise not found", resErrorCode: 2 });
    }
    const langasExQuestions = await pool.query(
      `SELECT id, type, prompt, options, media_url, instruction, accepted_answers
       FROM langas_questions WHERE exercise_id = $1 AND min_app_version <= $2 ORDER BY sort_order`,
      [langasExId, langasAppVersion(req)]
    );
    if (langasStartTimes.size > 20000) langasStartTimes.clear();
    const langasExLimitSec = langasExRow.rows[0].time_limit_sec || LANGAS_TIME_LIMIT_MS / 1000;
    langasStartTimes.set(req.langasUser.id + ":" + langasExId, { at: Date.now(), limitSec: langasExLimitSec });
    if (langasProgress.size > 20000) langasProgress.clear();
    langasProgress.set(req.langasUser.id + ":" + langasExId, {});

    return res.status(200).json({
      resStatus: true,
      exercise: {
        id: langasExRow.rows[0].id,
        title: langasExRow.rows[0].title,
        timeLimitSec: langasExLimitSec,
        rule: langasRuleDto(langasExRow.rows[0].rule),
        questions: langasExQuestions.rows.map(q => ({
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          options: Array.isArray(q.options) ? q.options : [],
          mediaUrl: q.media_url || "",
          instruction: q.instruction || "",
          given: langasIsTyping(q) ? langasSplitTyping(q.accepted_answers[0]).tail : ""
        }))
      }
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  INSTANT CHECK + HINTS (app version 4+)
// ══════════════════════════════════════════════════════════════════════════
const LANGAS_POINTS_FIRST = 10;
const LANGAS_POINTS_SECOND = 5;
const LANGAS_POINTS_AFTER_HINT = 2;
const langasProgress = new Map(); // "userId:exerciseId" -> { questionId: { tries, hinted, done, correct, points } }

function langasGrade(q, a) {
  let correct = false;
  let correctAnswer = "";
  if (q.correct_index !== null && q.correct_index !== undefined) {
    correct = !!a && Number(a.choiceIndex) === q.correct_index;
    correctAnswer = Array.isArray(q.options) ? String(q.options[q.correct_index] ?? "") : "";
  } else if (Array.isArray(q.accepted_answers) && q.accepted_answers.length) {
    const typed = langasNormalize(a?.text);
    correct = !!typed && q.accepted_answers.some(x => langasNormalize(x) === typed);
    // Typing questions: the first 6 letters are enough (the rest is shown in the app).
    if (!correct && typed && langasIsTyping(q)) {
      const split = langasSplitTyping(q.accepted_answers[0]);
      correct = split.tail !== "" && langasNormalize(split.head) === typed;
    }
    correctAnswer = String(q.accepted_answers[0]);
  }
  return { correct, correctAnswer };
}

// "Sveiki" -> "S _ _ _ _ i  (6 letters)"
function langasLetterHint(answer) {
  const chars = Array.from(String(answer || "").normalize("NFC"));
  const isLetter = c => /\p{L}/u.test(c);
  const letters = chars.map((c, i) => (isLetter(c) ? i : -1)).filter(i => i >= 0);
  if (!letters.length) return String(answer || "");
  const first = letters[0];
  const last = letters[letters.length - 1];
  const shown = chars
    .map((c, i) => {
      if (c === " ") return " ";
      if (!isLetter(c)) return c;
      return i === first || i === last ? c : "_";
    })
    .join(" ");
  return shown + "   (" + letters.length + " letters)";
}

// Listening hint: "Es runāju latviski." -> "E _   r u _ _ _ u   l _ _ _ _ _ _ _ ."  (~30% of letters)
function langasPartialHint(answer, seed) {
  const chars = Array.from(String(answer || "").normalize("NFC"));
  const isLetter = c => /\p{L}/u.test(c);
  const letters = chars.map((c, i) => (isLetter(c) ? i : -1)).filter(i => i >= 0);
  if (!letters.length) return String(answer || "");
  const shown = new Set();
  chars.forEach((c, i) => { if (isLetter(c) && (i === 0 || !isLetter(chars[i - 1]))) shown.add(i); });
  const target = Math.max(1, Math.round(letters.length * 0.3));
  const rest = letters.filter(i => !shown.has(i));
  let s = (Number(seed) || 1) >>> 0;
  while (shown.size < target && rest.length) {
    s = (s * 1103515245 + 12345) >>> 0;
    shown.add(rest.splice(s % rest.length, 1)[0]);
  }
  return chars
    .map((c, i) => (c === " " ? " " : !isLetter(c) ? c : shown.has(i) ? c : "_"))
    .join(" ");
}

async function langasLoadQuestion(exId, questionId) {
  const r = await pool.query(
    `SELECT id, type, options, correct_index, accepted_answers
     FROM langas_questions WHERE id = $1 AND exercise_id = $2`,
    [questionId, exId]
  );
  return r.rowCount ? r.rows[0] : null;
}

function langasEntry(prog, questionId) {
  if (!prog[questionId]) prog[questionId] = { tries: 0, hinted: false, done: false, correct: false, points: 0 };
  return prog[questionId];
}

function langasReveal(q) {
  const g = langasGrade(q, null);
  const isChoice = q.correct_index !== null && q.correct_index !== undefined;
  return { correctAnswer: g.correctAnswer, correctIndex: isChoice ? q.correct_index : -1 };
}

// Body: { questionId, choiceIndex, text, giveUp }
router.post("/exercises/:id/check", langasRateLimit(120), langasRequireAuth, async (req, res) => {
  const langasChkExId = langasParseId(req.params.id);
  const langasChkQid = Number(req.body?.questionId);
  if (!langasChkExId || !Number.isInteger(langasChkQid)) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid request", resErrorCode: 1 });
  }
  const langasChkProg = langasProgress.get(req.langasUser.id + ":" + langasChkExId);
  if (!langasChkProg) {
    return res.status(409).json({ resStatus: false, resMessage: "Lesson expired", resErrorCode: 2 });
  }
  try {
    const q = await langasLoadQuestion(langasChkExId, langasChkQid);
    if (!q) return res.status(404).json({ resStatus: false, resMessage: "Question not found", resErrorCode: 3 });

    const entry = langasEntry(langasChkProg, langasChkQid);
    if (entry.done) {
      return res.status(200).json({ resStatus: true, correct: entry.correct, done: true, ...langasReveal(q) });
    }
    if (req.body?.giveUp) {
      entry.done = true;
      return res.status(200).json({ resStatus: true, correct: false, done: true, ...langasReveal(q) });
    }

    entry.tries++;
    const g = langasGrade(q, req.body);
    if (g.correct) {
      entry.done = true;
      entry.correct = true;
      entry.points = entry.hinted ? LANGAS_POINTS_AFTER_HINT : (entry.tries === 1 ? LANGAS_POINTS_FIRST : LANGAS_POINTS_SECOND);
      return res.status(200).json({ resStatus: true, correct: true, done: true, correctAnswer: "", correctIndex: -1 });
    }
    if (entry.hinted || entry.tries >= 3) {
      entry.done = true;
      return res.status(200).json({ resStatus: true, correct: false, done: true, ...langasReveal(q) });
    }
    return res.status(200).json({ resStatus: true, correct: false, done: false, correctAnswer: "", correctIndex: -1 });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// Body: { questionId }  -> choice: removeIndices (2 wrong options); typing: hint text
router.post("/exercises/:id/hint", langasRateLimit(60), langasRequireAuth, async (req, res) => {
  const langasHntExId = langasParseId(req.params.id);
  const langasHntQid = Number(req.body?.questionId);
  if (!langasHntExId || !Number.isInteger(langasHntQid)) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid request", resErrorCode: 1 });
  }
  const langasHntProg = langasProgress.get(req.langasUser.id + ":" + langasHntExId);
  if (!langasHntProg) {
    return res.status(409).json({ resStatus: false, resMessage: "Lesson expired", resErrorCode: 2 });
  }
  try {
    const q = await langasLoadQuestion(langasHntExId, langasHntQid);
    if (!q) return res.status(404).json({ resStatus: false, resMessage: "Question not found", resErrorCode: 3 });

    langasEntry(langasHntProg, langasHntQid).hinted = true;

    // Sentence builder: the hint shows the first 2 words
    if (q.type === "build") {
      const words = String((q.accepted_answers || [])[0] || "").split(/\s+/).filter(Boolean);
      return res.status(200).json({ resStatus: true, hint: words.slice(0, 2).join(" ") + " …", removeIndices: [] });
    }

    // Match: put up to 2 right chips into slots that are empty or wrong (no points for them)
    if (q.type === "match") {
      const key = langasMatchKey(q);
      const chips = Array.isArray(req.body?.chips) ? req.body.chips.map(Number) : [];
      const entry = langasEntry(langasHntProg, langasHntQid);
      const open = key.map((_, i) => i).filter(i => chips[i] !== key[i]);
      const give = open.slice(0, 2);
      entry.hintSlots = (entry.hintSlots || []).concat(give);
      return res.status(200).json({
        resStatus: true, hint: "", removeIndices: [],
        matchSlots: give, matchChips: give.map(i => key[i])
      });
    }

    const isChoice = q.correct_index !== null && q.correct_index !== undefined;
    const listenText =
      (q.type === "listen" || q.type === "listen_write") &&
      Array.isArray(q.accepted_answers) && q.accepted_answers.length
        ? langasPartialHint(q.type === "listen_write" ? langasSplitTyping(q.accepted_answers[0]).head : q.accepted_answers[0], q.id)
        : "";
    if (isChoice) {
      const wrong = (Array.isArray(q.options) ? q.options : [])
        .map((_, i) => i)
        .filter(i => i !== q.correct_index)
        .sort((a, b) => ((q.id * 7 + a * 13) % 11) - ((q.id * 7 + b * 13) % 11));
      return res.status(200).json({ resStatus: true, hint: listenText, removeIndices: wrong.slice(0, 2) });
    }
    if (listenText) {
      return res.status(200).json({ resStatus: true, hint: listenText, removeIndices: [] });
    }
    const answer = Array.isArray(q.accepted_answers) && q.accepted_answers.length ? q.accepted_answers[0] : "";
    return res.status(200).json({ 
      resStatus: true, hint: langasLetterHint(langasSplitTyping(answer).head), removeIndices: [] 
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  MATCH THE PAIRS (app version 6+)
//  options = 5 words on the left, then 10 chips. accepted_answers = right chip (0-9) per left word.
// ══════════════════════════════════════════════════════════════════════════
const LANGAS_MATCH_TRIES = 3;

function langasMatchKey(q) {
  return Array.isArray(q.accepted_answers) ? q.accepted_answers.map(Number) : [];
}

// 2 points per right pair (pairs placed by a hint give nothing); 1st check x1, 2nd x0.5, 3rd x0.2
function langasMatchPoints(entry, key, chips) {
  const factor = entry.tries <= 1 ? 1 : entry.tries === 2 ? 0.5 : 0.2;
  const hinted = entry.hintSlots || [];
  let n = 0;
  key.forEach((k, i) => { if (chips[i] === k && !hinted.includes(i)) n++; });
  return Math.round(n * 2 * factor);
}

function langasMatchText(q) {
  const key = langasMatchKey(q);
  const opts = Array.isArray(q.options) ? q.options : [];
  const left = opts.slice(0, key.length);
  const chips = opts.slice(key.length);
  return left.map((w, i) => w + " · " + (chips[key[i]] ?? "")).join("\n");
}

// Body: { questionId, chips: [chip index per slot], giveUp }
router.post("/exercises/:id/match", langasRateLimit(120), langasRequireAuth, async (req, res) => {
  const langasMtExId = langasParseId(req.params.id);
  const langasMtQid = Number(req.body?.questionId);
  if (!langasMtExId || !Number.isInteger(langasMtQid)) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid request", resErrorCode: 1 });
  }
  const langasMtProg = langasProgress.get(req.langasUser.id + ":" + langasMtExId);
  if (!langasMtProg) {
    return res.status(409).json({ resStatus: false, resMessage: "Lesson expired", resErrorCode: 2 });
  }
  try {
    const q = await langasLoadQuestion(langasMtExId, langasMtQid);
    if (!q || q.type !== "match") {
      return res.status(404).json({ resStatus: false, resMessage: "Question not found", resErrorCode: 3 });
    }
    const key = langasMatchKey(q);
    const entry = langasEntry(langasMtProg, langasMtQid);
    if (entry.done) {
      return res.status(200).json({ resStatus: true, correct: entry.correct, done: true, wrongCount: 0, correctChips: key });
    }
    if (req.body?.giveUp) {
      entry.done = true;
      return res.status(200).json({ resStatus: true, correct: false, done: true, wrongCount: 0, correctChips: key });
    }
    const chips = Array.isArray(req.body?.chips) ? req.body.chips.map(Number) : [];
    if (chips.length !== key.length) {
      return res.status(400).json({ resStatus: false, resMessage: "Fill every slot", resErrorCode: 4 });
    }
    entry.tries++;
    const wrong = key.reduce((n, k, i) => n + (chips[i] === k ? 0 : 1), 0);
    if (wrong === 0) {
      entry.done = true;
      entry.correct = true;
      entry.points = langasMatchPoints(entry, key, chips);
      return res.status(200).json({ resStatus: true, correct: true, done: true, wrongCount: 0, correctChips: [] });
    }
    if (entry.tries >= LANGAS_MATCH_TRIES) {
      entry.done = true;
      entry.points = langasMatchPoints(entry, key, chips);
      return res.status(200).json({ resStatus: true, correct: false, done: true, wrongCount: wrong, correctChips: key });
    }
    // Not over: only say how many are wrong, never which ones.
    return res.status(200).json({ resStatus: true, correct: false, done: false, wrongCount: wrong, correctChips: [] });
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
      `SELECT id, type, options, correct_index, accepted_answers
       FROM langas_questions WHERE exercise_id = $1 AND min_app_version <= $2 ORDER BY sort_order`,
      [langasSubExId, langasAppVersion(req)]
    );

    const langasSubProg = langasProgress.get(req.langasUser.id + ":" + langasSubExId);
    langasProgress.delete(req.langasUser.id + ":" + langasSubExId);

    let langasSubScore = 0;
    const langasSubResults = langasSubQuestions.rows.map(q => {
      const g = langasGrade(q, langasSubAnswerMap.get(q.id));
      const entry = langasSubProg ? langasSubProg[q.id] : null;
      const langasSubAnswerText = q.type === "match" ? langasMatchText(q) : g.correctAnswer;
      if (entry && entry.done) {
        // App v4+: points come from the instant checks (1st try 10, 2nd 5, after hint 2).
        langasSubScore += entry.points;
        return { questionId: q.id, correct: entry.correct, correctAnswer: langasSubAnswerText };
      }
      if (q.type === "match") return { questionId: q.id, correct: false, correctAnswer: langasSubAnswerText };
      if (g.correct) langasSubScore += LANGAS_POINTS_PER_CORRECT;
      return { questionId: q.id, correct: g.correct, correctAnswer: langasSubAnswerText };
    });

    const langasSubMax = langasSubQuestions.rowCount * LANGAS_POINTS_PER_CORRECT;

    const langasSubKey = req.langasUser.id + ":" + langasSubExId;
    const langasSubStart = langasStartTimes.get(langasSubKey);
    langasStartTimes.delete(langasSubKey);
    const langasSubLimitMs = (langasSubStart ? langasSubStart.limitSec : LANGAS_TIME_LIMIT_MS / 1000) * 1000;
    const langasSubFastMs = langasSubLimitMs > LANGAS_TIME_LIMIT_MS ? 5 * 60 * 1000 : LANGAS_FAST_MS;
    const langasSubTook = langasSubStart ? Date.now() - langasSubStart.at : Infinity;
    const langasSubBonus =
      langasSubTook <= langasSubLimitMs + 10000 &&
      langasSubMax > 0 &&
      langasSubScore * 2 >= langasSubMax
        ? LANGAS_TIME_BONUS
        : 0;
    const langasSubSpeed =
      langasSubBonus > 0 &&
      langasSubTook <= langasSubFastMs + 5000 &&
      langasSubScore * 5 >= langasSubMax * 4
        ? LANGAS_FAST_BONUS
        : 0;

    const langasSubBest = await pool.query(
      `INSERT INTO langas_scores (user_id, exercise_id, best_score, best_correct, attempts)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (user_id, exercise_id)
       DO UPDATE SET best_score   = GREATEST(langas_scores.best_score, EXCLUDED.best_score),
                     best_correct = GREATEST(langas_scores.best_correct, EXCLUDED.best_correct),
                     attempts     = langas_scores.attempts + 1,
                     updated_at   = NOW()
       RETURNING best_score`,
      [req.langasUser.id, langasSubExId, langasSubScore + langasSubBonus + langasSubSpeed, langasSubScore]
    );

    await pool.query(
      `UPDATE langas_users SET
         streak_days = CASE
           WHEN streak_last_date = (NOW() AT TIME ZONE 'Europe/Riga')::date THEN streak_days
           WHEN streak_last_date = (NOW() AT TIME ZONE 'Europe/Riga')::date - 1 THEN streak_days + 1
           ELSE 1
         END,
         streak_last_date = (NOW() AT TIME ZONE 'Europe/Riga')::date
       WHERE id = $1`,
      [req.langasUser.id]
    );

    // Profile stats: best streak + time spent (capped at the lesson limit + 1 minute).
    await pool.query(`UPDATE langas_users SET best_streak = GREATEST(best_streak, streak_days) WHERE id = $1`,
      [req.langasUser.id]);
    const langasSubSeconds = langasSubStart
      ? Math.round(Math.min(langasSubTook, langasSubLimitMs + 60000) / 1000)
      : 0;
    await pool.query(
      `INSERT INTO langas_lesson_log (user_id, exercise_id, seconds, points, correct_count, question_count)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.langasUser.id, langasSubExId, langasSubSeconds, langasSubScore + langasSubBonus + langasSubSpeed,
       langasSubResults.filter(r => r.correct).length, langasSubQuestions.rowCount]
    );

    const langasSubNewAch = await langasAwardAchievements(req.langasUser.id, langasAppVersion(req), {
      perfect: langasSubResults.length > 0 && langasSubResults.every(r => r.correct),
      lightning: langasSubSpeed > 0
    });

    return res.status(200).json({
      resStatus: true,
      score: langasSubScore,
      maxScore: langasSubMax,
      timeBonus: langasSubBonus,
      speedBonus: langasSubSpeed,
      bestScore: langasSubBest.rows[0].best_score,
      results: langasSubResults,
      achievements: langasSubNewAch
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});


// ══════════════════════════════════════════════════════════════════════════
//  PROFILE (app version 6+): stats, custom name, photo
// ══════════════════════════════════════════════════════════════════════════
const LANGAS_AVATAR_BUCKET = "langas_storage";
const LANGAS_AVATAR_SIZE = 256;          // px, square
const LANGAS_AVATAR_MAX_BYTES = 200 * 1024;
const LANGAS_AVATAR_LINK_SEC = 60 * 60 * 24; // signed photo links live 24 h (bucket is private)
const LANGAS_NAME_MAX_SAME = 10;         // max players sharing one name
const LANGAS_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,18}[\p{L}\p{N}.]$/u; // 3–20 chars
const LANGAS_TZ = "Europe/Riga";

// ── ACHIEVEMENTS ───────────────────────────────────────────────────────────
// color: sun | coral | ink | mint | teal (badge colour in the app)
const LANGAS_ACHIEVEMENTS = [
  { code: "lessons_1",   title: "First lesson",    text: "Finish your first lesson",         icon: "star",    color: "sun" },
  { code: "lessons_10",  title: "10 lessons",      text: "Finish 10 lessons",                icon: "trophy",  color: "sun" },
  { code: "lessons_25",  title: "25 lessons",      text: "Finish 25 lessons",                icon: "trophy",  color: "sun" },
  { code: "lessons_50",  title: "50 lessons",      text: "Finish 50 lessons",                icon: "trophy",  color: "sun" },
  { code: "lessons_all", title: "All lessons",     text: "Finish every lesson",              icon: "trophy",  color: "coral" },
  { code: "crown_1",     title: "First crown",     text: "Score 90% or more in a lesson",    icon: "crown",   color: "sun" },
  { code: "crown_10",    title: "10 crowns",       text: "Earn 10 crowns",                   icon: "crown",   color: "sun" },
  { code: "crown_25",    title: "25 crowns",       text: "Earn 25 crowns",                   icon: "crown",   color: "sun" },
  { code: "perfect_1",   title: "Perfect!",        text: "Get every answer right",           icon: "star",    color: "coral" },
  { code: "streak_3",    title: "3-day streak",    text: "Practise 3 days in a row",         icon: "flame",   color: "coral" },
  { code: "streak_7",    title: "7-day streak",    text: "Practise 7 days in a row",         icon: "flame",   color: "coral" },
  { code: "streak_30",   title: "30-day streak",   text: "Practise 30 days in a row",        icon: "flame",   color: "coral" },
  { code: "lightning_1", title: "Lightning fast",  text: "Win a lightning bonus",            icon: "bolt",    color: "ink" },
  { code: "grammar_1",   title: "Grammar starter", text: "Finish a grammar lesson",          icon: "book",    color: "mint" },
  { code: "grammar_all", title: "Grammar master",  text: "Finish every grammar lesson",      icon: "book",    color: "mint" },
  { code: "time_60",     title: "1 hour",          text: "Practise for 1 hour in total",     icon: "clock",   color: "teal" },
  { code: "time_600",    title: "10 hours",        text: "Practise for 10 hours in total",   icon: "clock",   color: "teal" }
];
const LANGAS_ACH_BY_CODE = Object.fromEntries(LANGAS_ACHIEVEMENTS.map(a => [a.code, a]));

function langasAchDto(code, date) {
  const a = LANGAS_ACH_BY_CODE[code];
  return a ? { code: a.code, title: a.title, text: a.text, icon: a.icon, color: a.color, date: date || "" } : null;
}

// After a lesson: saves every achievement the player now qualifies for, returns only the new ones.
// lesson = { perfect, lightning }. Never throws (a failure here must not break the result screen).
async function langasAwardAchievements(userId, appVersion, lesson) {
  try {
    const r = await pool.query(
      `WITH qc AS (
         SELECT e.id, e.rule IS NOT NULL AS grammar,
                (SELECT COUNT(*) FROM langas_questions q WHERE q.exercise_id = e.id AND q.min_app_version <= $2) AS n
         FROM langas_exercises e WHERE e.is_active = TRUE AND e.min_app_version <= $2
       )
       SELECT
         (SELECT COUNT(*) FROM qc)::int AS total,
         (SELECT COUNT(*) FROM qc WHERE grammar)::int AS g_total,
         COUNT(s.exercise_id) FILTER (WHERE s.attempts > 0)::int AS done,
         COUNT(s.exercise_id) FILTER (WHERE s.attempts > 0 AND qc.grammar)::int AS g_done,
         COUNT(s.exercise_id) FILTER (WHERE s.attempts > 0 AND s.best_correct * 100 >= 90 * 10 * qc.n)::int AS crowns,
         (SELECT COALESCE(SUM(seconds), 0) FROM langas_lesson_log WHERE user_id = $1)::int AS secs,
         (SELECT GREATEST(streak_days, best_streak) FROM langas_users WHERE id = $1)::int AS streak
       FROM qc LEFT JOIN langas_scores s ON s.exercise_id = qc.id AND s.user_id = $1`,
      [userId, appVersion]
    );
    const st = r.rows[0] || {};
    const earned = [];
    const add = (cond, code) => { if (cond) earned.push(code); };
    add(st.done >= 1, "lessons_1");
    add(st.done >= 10, "lessons_10");
    add(st.done >= 25, "lessons_25");
    add(st.done >= 50, "lessons_50");
    add(st.total > 0 && st.done >= st.total, "lessons_all");
    add(st.crowns >= 1, "crown_1");
    add(st.crowns >= 10, "crown_10");
    add(st.crowns >= 25, "crown_25");
    add(lesson && lesson.perfect, "perfect_1");
    add(st.streak >= 3, "streak_3");
    add(st.streak >= 7, "streak_7");
    add(st.streak >= 30, "streak_30");
    add(lesson && lesson.lightning, "lightning_1");
    add(st.g_done >= 1, "grammar_1");
    add(st.g_total > 0 && st.g_done >= st.g_total, "grammar_all");
    add(st.secs >= 60 * 60, "time_60");
    add(st.secs >= 600 * 60, "time_600");
    if (!earned.length) return [];

    const ins = await pool.query(
      `INSERT INTO langas_achievements (user_id, code)
       SELECT $1, unnest($2::text[])
       ON CONFLICT (user_id, code) DO NOTHING
       RETURNING code`,
      [userId, earned]
    );
    const fresh = new Set(ins.rows.map(x => x.code));
    // Keep the list order (easy ones first) for the result screen.
    return earned.filter(c => fresh.has(c)).map(c => langasAchDto(c, "")).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function langasCleanName(raw) {
  return String(raw || "").normalize("NFC").replace(/\s+/g, " ").trim();
}

// Private bucket: the DB keeps the file path, the app gets a short-lived signed link.
async function langasAvatarLink(filePath) {
  if (!filePath) return "";
  try {
    const { data, error } = await supabase.storage
      .from(LANGAS_AVATAR_BUCKET)
      .createSignedUrl(filePath, LANGAS_AVATAR_LINK_SEC);
    return error || !data ? "" : data.signedUrl;
  } catch (e) {
    return "";
  }
}

function langasPeriod(row, prefix) {
  return {
    minutes: Math.round((row[prefix + "_sec"] || 0) / 60),
    lessons: row[prefix + "_lessons"] || 0,
    points: row[prefix + "_points"] || 0
  };
}

// Profile of any player (own or from the leaderboard).
async function langasSendProfile(req, res, langasPrUid) {
  const langasPrVer = langasAppVersion(req);
  try {
    const langasPrUser = await pool.query(
      `SELECT id, COALESCE(custom_name, display_name) AS name, avatar_path, streak_days, best_streak,
              (streak_last_date >= (NOW() AT TIME ZONE '${LANGAS_TZ}')::date - 1) AS streak_alive
       FROM langas_users WHERE id = $1`,
      [langasPrUid]
    );
    if (!langasPrUser.rowCount) {
      return res.status(404).json({ resStatus: false, resMessage: "User not found", resErrorCode: 1 });
    }
    const u = langasPrUser.rows[0];

    // Lessons per level (same filter as /levels) + crowns (90%+ without bonuses).
    const langasPrLevels = await pool.query(
      `SELECT l.id, l.code, l.title, l.sort_order,
              COUNT(e.id)::int AS total,
              COUNT(e.id) FILTER (WHERE COALESCE(s.attempts, 0) > 0)::int AS done,
              COUNT(e.id) FILTER (WHERE COALESCE(s.attempts, 0) > 0
                AND s.best_correct * 100 >= 90 * 10 * (SELECT COUNT(*) FROM langas_questions q
                                                     WHERE q.exercise_id = e.id AND q.min_app_version <= $2))::int AS crowns
       FROM langas_levels l
       JOIN langas_exercises e ON e.level_id = l.id AND e.is_active = TRUE AND e.min_app_version <= $2
       LEFT JOIN langas_scores s ON s.exercise_id = e.id AND s.user_id = $1
       GROUP BY l.id
       ORDER BY l.sort_order`,
      [langasPrUid, langasPrVer]
    );
    const langasPrLvRows = langasPrLevels.rows;
    const langasPrLevel =
      langasPrLvRows.find(l => l.done < l.total) || langasPrLvRows[langasPrLvRows.length - 1] || null;
    const langasPrCrowns = langasPrLvRows.reduce((n, l) => n + l.crowns, 0);

    // Time / lessons / points: today, this week (Mon–Sun), this month, all time. Riga days.
    const langasPrStats = await pool.query(
      `WITH t AS (SELECT (NOW() AT TIME ZONE '${LANGAS_TZ}')::date AS today),
       x AS (
         SELECT seconds, points, correct_count, question_count,
                (created_at AT TIME ZONE '${LANGAS_TZ}')::date AS d
         FROM langas_lesson_log WHERE user_id = $1
       )
       SELECT
         COALESCE(SUM(seconds) FILTER (WHERE d = t.today), 0)::int AS today_sec,
         COUNT(*) FILTER (WHERE d = t.today)::int AS today_lessons,
         COALESCE(SUM(points) FILTER (WHERE d = t.today), 0)::int AS today_points,
         COALESCE(SUM(seconds) FILTER (WHERE d >= date_trunc('week', t.today)::date), 0)::int AS week_sec,
         COUNT(*) FILTER (WHERE d >= date_trunc('week', t.today)::date)::int AS week_lessons,
         COALESCE(SUM(points) FILTER (WHERE d >= date_trunc('week', t.today)::date), 0)::int AS week_points,
         COALESCE(SUM(seconds) FILTER (WHERE d >= date_trunc('month', t.today)::date), 0)::int AS month_sec,
         COUNT(*) FILTER (WHERE d >= date_trunc('month', t.today)::date)::int AS month_lessons,
         COALESCE(SUM(points) FILTER (WHERE d >= date_trunc('month', t.today)::date), 0)::int AS month_points,
         COALESCE(SUM(seconds), 0)::int AS all_sec,
         COALESCE(SUM(correct_count), 0)::int AS all_correct,
         COALESCE(SUM(question_count), 0)::int AS all_questions,
         (t.today - date_trunc('week', t.today)::date)::int AS today_index
       FROM t LEFT JOIN x ON TRUE
       GROUP BY t.today`,
      [langasPrUid]
    );
    const st = langasPrStats.rows[0] || {};

    const langasPrWeek = await pool.query(
      `WITH t AS (SELECT date_trunc('week', (NOW() AT TIME ZONE '${LANGAS_TZ}')::date)::date AS mon)
       SELECT g.d::date AS d, COALESCE(SUM(l.seconds), 0)::int AS sec
       FROM t, generate_series(t.mon, t.mon + 6, INTERVAL '1 day') AS g(d)
       LEFT JOIN langas_lesson_log l
         ON l.user_id = $1 AND (l.created_at AT TIME ZONE '${LANGAS_TZ}')::date = g.d::date
       GROUP BY g.d ORDER BY g.d`,
      [langasPrUid]
    );

    const langasPrRank = await pool.query(
      `WITH totals AS (SELECT user_id, SUM(best_score)::int AS total FROM langas_scores GROUP BY user_id),
       ranked AS (SELECT user_id, total, RANK() OVER (ORDER BY total DESC)::int AS rnk FROM totals)
       SELECT total, rnk FROM ranked WHERE user_id = $1`,
      [langasPrUid]
    );
    const rk = langasPrRank.rows[0] || { total: 0, rnk: 0 };

    const langasPrAch = await pool.query(
      `SELECT code, to_char(earned_at AT TIME ZONE '${LANGAS_TZ}', 'FMDD Mon') AS d
       FROM langas_achievements WHERE user_id = $1
       ORDER BY earned_at DESC, id DESC LIMIT 5`,
      [langasPrUid]
    );

    const langasPrStreak = u.streak_alive ? u.streak_days : 0;
    return res.status(200).json({
      resStatus: true,
      profile: {
        id: u.id,
        name: u.name,
        avatarUrl: await langasAvatarLink(u.avatar_path),
        isMe: u.id === req.langasUser.id,
        levelCode: langasPrLevel ? langasPrLevel.code : "",
        levelTitle: langasPrLevel ? langasPrLevel.title : "",
        lessonsDone: langasPrLevel ? langasPrLevel.done : 0,
        lessonsTotal: langasPrLevel ? langasPrLevel.total : 0,
        today: langasPeriod(st, "today"),
        week: langasPeriod(st, "week"),
        month: langasPeriod(st, "month"),
        weekMinutes: langasPrWeek.rows.map(r => Math.round(r.sec / 60)),
        todayIndex: st.today_index || 0,
        crowns: langasPrCrowns,
        accuracy: st.all_questions > 0 ? Math.round((100 * st.all_correct) / st.all_questions) : 0,
        streak: langasPrStreak,
        bestStreak: Math.max(u.best_streak || 0, langasPrStreak),
        totalMinutes: Math.round((st.all_sec || 0) / 60),
        totalPoints: rk.total || 0,
        rank: rk.rnk || 0,
        achievements: langasPrAch.rows.map(a => langasAchDto(a.code, a.d)).filter(Boolean)
      }
    });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
}

router.get("/profile", langasRateLimit(30), langasRequireAuth, (req, res) =>
  langasSendProfile(req, res, req.langasUser.id));

router.get("/profile/:id", langasRateLimit(60), langasRequireAuth, (req, res) => {
  const langasPuId = langasParseId(req.params.id);
  if (!langasPuId) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid player", resErrorCode: 1 });
  }
  return langasSendProfile(req, res, langasPuId);
});

// Body: { name }. 3–20 letters/digits (space . _ - inside). Max 10 players per name.
router.post("/profile/name", langasRateLimit(10), langasRequireAuth, async (req, res) => {
  const langasNmName = langasCleanName(req.body?.name);
  if (!LANGAS_NAME_RE.test(langasNmName)) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Use 3–20 letters or numbers",
      resErrorCode: 1
    });
  }
  try {
    const langasNmCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM langas_users
       WHERE lower(COALESCE(custom_name, display_name)) = lower($1) AND id <> $2`,
      [langasNmName, req.langasUser.id]
    );
    if (langasNmCount.rows[0].n >= LANGAS_NAME_MAX_SAME) {
      return res.status(409).json({
        resStatus: false,
        resMessage: "Too many players use this name. Try another one",
        resErrorCode: 2
      });
    }
    await pool.query(`UPDATE langas_users SET custom_name = $1 WHERE id = $2`, [langasNmName, req.langasUser.id]);
    return res.status(200).json({ resStatus: true, resMessage: "Saved", name: langasNmName });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// Body: raw image bytes (jpg/png/webp/heic). Saved as a 256×256 JPEG, well under 200 KB, no metadata.
router.post(
  "/profile/photo",
  langasRateLimit(6),
  langasRequireAuth,
  express.raw({ type: () => true, limit: "8mb" }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) {
      return res.status(400).json({ resStatus: false, resMessage: "No photo", resErrorCode: 1 });
    }
    let langasPhJpg;
    try {
      let langasPhQuality = 82;
      do {
        langasPhJpg = await sharp(req.body, { limitInputPixels: 50_000_000 })
          .rotate()
          .resize(LANGAS_AVATAR_SIZE, LANGAS_AVATAR_SIZE, { fit: "cover", position: "attention" })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: langasPhQuality, mozjpeg: true })
          .toBuffer();
        langasPhQuality -= 15;
      } while (langasPhJpg.length > LANGAS_AVATAR_MAX_BYTES && langasPhQuality > 30);
    } catch (err) {
      return res.status(400).json({ resStatus: false, resMessage: "This photo can't be read", resErrorCode: 2 });
    }
    if (langasPhJpg.length > LANGAS_AVATAR_MAX_BYTES) {
      return res.status(400).json({ resStatus: false, resMessage: "Photo is too big", resErrorCode: 3 });
    }

    const langasPhPath = `avatars/${req.langasUser.id}_${Date.now()}.jpg`;
    try {
      const { error: langasPhUpErr } = await supabase.storage
        .from(LANGAS_AVATAR_BUCKET)
        .upload(langasPhPath, langasPhJpg, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
      if (langasPhUpErr) {
        return res.status(502).json({ resStatus: false, resMessage: "Upload failed, try again", resErrorCode: 4 });
      }
      const langasPhOld = await pool.query(`SELECT avatar_path FROM langas_users WHERE id = $1`, [req.langasUser.id]);
      await pool.query(`UPDATE langas_users SET avatar_path = $1 WHERE id = $2`, [langasPhPath, req.langasUser.id]);
      await langasRemoveAvatar(langasPhOld.rows[0]?.avatar_path);
      const langasPhUrl = await langasAvatarLink(langasPhPath);

      return res.status(200).json({ resStatus: true, resMessage: "Saved", avatarUrl: langasPhUrl });
    } catch (err) {
      return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
    }
  }
);

router.delete("/profile/photo", langasRateLimit(6), langasRequireAuth, async (req, res) => {
  try {
    const langasPdOld = await pool.query(`SELECT avatar_path FROM langas_users WHERE id = $1`, [req.langasUser.id]);
    await pool.query(`UPDATE langas_users SET avatar_path = NULL WHERE id = $1`, [req.langasUser.id]);
    await langasRemoveAvatar(langasPdOld.rows[0]?.avatar_path);
    return res.status(200).json({ resStatus: true, resMessage: "Removed", avatarUrl: "" });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

// Deletes an old avatar file from storage. Failures are ignored (the DB no longer points to it).
async function langasRemoveAvatar(filePath) {
  if (!filePath || !filePath.startsWith("avatars/")) return;
  try {
    await supabase.storage.from(LANGAS_AVATAR_BUCKET).remove([filePath]);
  } catch (e) { /* ignore */ }
}

// ══════════════════════════════════════════════════════════════════════════
//  LEADERBOARD
// ══════════════════════════════════════════════════════════════════════════
router.get("/leaderboard", langasRateLimit(30), langasRequireAuth, async (req, res) => {
  try {
    const langasLbRows = await pool.query(
      `WITH totals AS (
         SELECT u.id, COALESCE(u.custom_name, u.display_name) AS display_name, u.avatar_path,
                SUM(s.best_score)::int AS total
         FROM langas_users u
         JOIN langas_scores s ON s.user_id = u.id
         GROUP BY u.id
       ), ranked AS (
         SELECT id, display_name, avatar_path, total, RANK() OVER (ORDER BY total DESC)::int AS rnk
         FROM totals
       )
       SELECT id, display_name, avatar_path, total, rnk FROM ranked
       WHERE rnk <= $1 OR id = $2
       ORDER BY rnk, id`,
      [LANGAS_LEADERBOARD_LIMIT, req.langasUser.id]
    );

    // Signed links for the photos on this page (one call for all of them).
    const langasLbPaths = langasLbRows.rows.map(r => r.avatar_path).filter(Boolean);
    const langasLbLinks = {};
    if (langasLbPaths.length) {
      try {
        const { data } = await supabase.storage
          .from(LANGAS_AVATAR_BUCKET)
          .createSignedUrls(langasLbPaths, LANGAS_AVATAR_LINK_SEC);
        for (const l of data || []) if (l && l.path && l.signedUrl) langasLbLinks[l.path] = l.signedUrl;
      } catch (e) { /* no photos: the app shows first letters */ }
    }

    const langasLbEntries = [];
    let langasLbMe = { rank: 0, total: 0 };
    for (const r of langasLbRows.rows) {
      if (r.id === req.langasUser.id) langasLbMe = { rank: r.rnk, total: r.total };
      if (r.rnk <= LANGAS_LEADERBOARD_LIMIT) {
        langasLbEntries.push({
          rank: r.rnk,
          userId: r.id,
          displayName: r.display_name,
          avatarUrl: langasLbLinks[r.avatar_path] || "",
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

// ══════════════════════════════════════════════════════════════════════════
//  SPEAKING (app version 4+): the app sends a short WAV, the local
//  speech service (langas_asr, 127.0.0.1:8765) turns it into text,
//  and we compare that with the expected Latvian.
// ══════════════════════════════════════════════════════════════════════════
const LANGAS_ASR_URL = "http://127.0.0.1:8765/transcribe_raw";
const LANGAS_SPEAK_PASS = 0.8; // 80% of letters must match

// Lowercase, no punctuation, no long marks: "Labrīt!" -> "labrit"
function langasLoose(s) {
  return langasNormalize(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function langasSimilarity(a, b) {
  a = langasLoose(a);
  b = langasLoose(b);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}
// Body: raw WAV bytes. Query: ?questionId=123
router.post("/exercises/:id/speak", langasRateLimit(30), langasRequireAuth,
 express.raw({ type: () => true, limit: "2mb" }),
  async (req, res) => {
    const langasSpkExId = langasParseId(req.params.id);
    const langasSpkQid = Number(req.query.questionId);
    if (!langasSpkExId || !Number.isInteger(langasSpkQid)) {
      return res.status(400).json({ resStatus: false, resMessage: "Invalid request", resErrorCode: 1 });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) {
      return res.status(400).json({ resStatus: false, resMessage: "No recording", resErrorCode: 4 });
    }
    const langasSpkProg = langasProgress.get(req.langasUser.id + ":" + langasSpkExId);
    if (!langasSpkProg) {
      return res.status(409).json({ resStatus: false, resMessage: "Lesson expired", resErrorCode: 2 });
    }
    try {
      const q = await langasLoadQuestion(langasSpkExId, langasSpkQid);
      if (!q || !Array.isArray(q.accepted_answers) || !q.accepted_answers.length) {
        return res.status(404).json({ resStatus: false, resMessage: "Question not found", resErrorCode: 3 });
      }

      const entry = langasEntry(langasSpkProg, langasSpkQid);
      const expected = String(q.accepted_answers[0]);
      if (entry.done) {
        return res.status(200).json({ resStatus: true, correct: entry.correct, done: true, heard: "", correctAnswer: expected, correctIndex: -1 });
      }

      let heard = "";
      try {
        const asr = await axios.post(LANGAS_ASR_URL, req.body, {
          headers: { "Content-Type": "application/octet-stream" },
          timeout: 20000,
          maxBodyLength: 3 * 1024 * 1024
        });
        heard = String(asr.data?.text || "");
      } catch (e) {
        return res.status(503).json({ resStatus: false, resMessage: "Speech check is busy, please try again", resErrorCode: 5 });
      }

      const best = Math.max(...q.accepted_answers.map(x => langasSimilarity(heard, x)));
      entry.tries++;
      if (best >= LANGAS_SPEAK_PASS) {
        entry.done = true;
        entry.correct = true;
        entry.points = entry.hinted ? LANGAS_POINTS_AFTER_HINT : (entry.tries === 1 ? LANGAS_POINTS_FIRST : LANGAS_POINTS_SECOND);
        return res.status(200).json({ resStatus: true, correct: true, done: true, heard, correctAnswer: "", correctIndex: -1 });
      }
      if (entry.hinted || entry.tries >= 3) {
        entry.done = true;
        return res.status(200).json({ resStatus: true, correct: false, done: true, heard, correctAnswer: expected, correctIndex: -1 });
      }
      return res.status(200).json({ resStatus: true, correct: false, done: false, heard, correctAnswer: "", correctIndex: -1 });
    } catch (err) {
      return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════
//  REPORTS (🚩 on a question)
// ══════════════════════════════════════════════════════════════════════════
const LANGAS_REPORT_CATEGORIES = ["translation", "audio", "spelling", "other"];

router.post("/reports", langasRateLimit(10), langasRequireAuth, async (req, res) => {
  const langasRepQuestionId = Number(req.body?.questionId);
  const langasRepCategory = String(req.body?.category || "");
  const langasRepMessage = String(req.body?.message || "").trim().slice(0, 1000);
  const langasRepAppVersion = parseInt(req.body?.appVersion, 10);

  if (!LANGAS_REPORT_CATEGORIES.includes(langasRepCategory)) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid category", resErrorCode: 1 });
  }
  if (!Number.isInteger(langasRepQuestionId) || langasRepQuestionId <= 0) {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid question", resErrorCode: 2 });
  }

  try {
    await pool.query(
      `INSERT INTO langas_reports (user_id, question_id, category, message, app_version)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.langasUser.id,
        langasRepQuestionId,
        langasRepCategory,
        langasRepMessage,
        Number.isInteger(langasRepAppVersion) ? langasRepAppVersion : null
      ]
    );
    return res.status(200).json({ resStatus: true, resMessage: "Thanks" });
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
});

module.exports = router;