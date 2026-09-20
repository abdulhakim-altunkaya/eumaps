const express = require("express");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { pool, supabase } = require("../db");
const { applyReadRateLimit, applyWriteRateLimit, blockMaliciousIPs } = require("../middleware/masters_MW");
const { verifyAppleIdentityToken } = require("../services/langasAppleAuth");
const { verifyStoreSubscription } = require("../services/langasSubscriptionVerifier");
const { scorePronunciation } = require("../services/langasPronunciation");

const router = express.Router();
const googleClient = new OAuth2Client(process.env.LANGAS_GOOGLE_CLIENT_ID);
const FREE_LESSONS = 5;

function sid() {
  return crypto.randomBytes(32).toString("hex");
}

async function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ resStatus: false, resMessage: "Authentication required" });

  try {
    const q = await pool.query(`SELECT s.user_id,u.* FROM langas_sessions s JOIN langas_users u ON u.id=s.user_id WHERE s.session_id=$1 AND s.expires_at>now() LIMIT 1`, [token]);
    if (!q.rowCount) return res.status(401).json({ resStatus: false, resMessage: "Invalid session" });
    req.langasUser = q.rows[0];
    next();
  } catch (e) {
    console.error("Langas auth middleware", e);
    return res.status(500).json({ resStatus: false, resMessage: "Authentication error" });
  }
}

router.post("/auth", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  let client;

  try {
    const { provider, idToken, guestProgress } = req.body || {};
    let p;

    if (provider === "google") {
      const t = await googleClient.verifyIdToken({ idToken, audience: process.env.LANGAS_GOOGLE_CLIENT_ID });
      const x = t.getPayload();
      p = { id: x.sub, email: x.email, name: x.name || null, avatar: x.picture || null };
    } else if (provider === "apple") {
      p = await verifyAppleIdentityToken(idToken);
    } else {
      return res.status(400).json({ resStatus: false, resMessage: "Unsupported provider" });
    }

    client = await pool.connect();
    await client.query("BEGIN");

    const u = await client.query(`INSERT INTO langas_users(provider,provider_user_id,email,display_name,avatar_url) VALUES($1,$2,$3,$4,$5) ON CONFLICT(provider,provider_user_id) DO UPDATE SET email=COALESCE(EXCLUDED.email,langas_users.email),display_name=COALESCE(EXCLUDED.display_name,langas_users.display_name),avatar_url=COALESCE(EXCLUDED.avatar_url,langas_users.avatar_url),updated_at=now() RETURNING *`, [provider, p.id, p.email || null, p.name || null, p.avatar || null]);

    const user = u.rows[0];
    const session = sid();

    await client.query(`INSERT INTO langas_sessions(session_id,user_id,expires_at) VALUES($1,$2,now()+interval '90 days')`, [session, user.id]);

    if (guestProgress && typeof guestProgress === "object") {
      const highest = Math.max(0, Math.min(Number(guestProgress.highestCompletedLesson) || 0, FREE_LESSONS));
      const guestXp = Math.max(0, Number(guestProgress.xp) || 0);
      for (let lessonId = 1; lessonId <= highest; lessonId++) {
        await client.query(`INSERT INTO langas_lesson_progress(user_id,lesson_id,best_score,attempts,completed,completed_at,last_attempt_at) VALUES($1,$2,100,1,true,now(),now()) ON CONFLICT(user_id,lesson_id) DO UPDATE SET completed=true,completed_at=COALESCE(langas_lesson_progress.completed_at,now()),best_score=GREATEST(langas_lesson_progress.best_score,100),last_attempt_at=now()`, [user.id, lessonId]);
      }
      await client.query(`UPDATE langas_users SET xp=GREATEST(xp,$2),level=GREATEST(1,FLOOR(GREATEST(xp,$2)/500)+1),updated_at=now() WHERE id=$1`, [user.id, guestXp]);
      await client.query(`INSERT INTO langas_guest_migrations(migration_id,user_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [crypto.randomUUID(), user.id, guestProgress]);
    }

    await client.query("COMMIT");
    return res.json({ resStatus: true, resData: { sessionId: session, user } });
  } catch (e) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    console.error("Langas auth", e);
    return res.status(401).json({ resStatus: false, resMessage: "Sign-in failed" });
  } finally {
    if (client) client.release();
  }
});

router.get("/lessons/:id", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 120) return res.status(400).json({ resStatus: false, resMessage: "Invalid lesson" });

  let user = null;
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  if (token) {
    const q = await pool.query(`SELECT u.* FROM langas_sessions s JOIN langas_users u ON u.id=s.user_id WHERE s.session_id=$1 AND s.expires_at>now()`, [token]);
    user = q.rows[0] || null;
  }

  if (id > FREE_LESSONS && (!user || user.subscription_status !== "active" || !user.subscription_expires_at || new Date(user.subscription_expires_at) <= new Date())) {
    return res.status(402).json({ resStatus: false, resMessage: "Subscription required", resErrorCode: 4021 });
  }

  const q = await pool.query(`SELECT id,level,lesson_order,title,is_free,content,version FROM langas_lessons WHERE id=$1 AND is_active=true`, [id]);
  if (!q.rowCount) return res.status(404).json({ resStatus: false, resMessage: "Lesson not found" });

  return res.json({ resStatus: true, resData: q.rows[0] });
});

router.get("/audio/:lessonId/:exerciseId", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
  try {
    const lessonId = Number(req.params.lessonId);
    const exerciseId = String(req.params.exerciseId || "");

    if (!Number.isInteger(lessonId) || lessonId < 1 || lessonId > 120)
      return res.status(400).json({ resStatus: false, resMessage: "Invalid lesson" });

    const q = await pool.query(`SELECT content FROM langas_lessons WHERE id=$1 AND is_active=true`, [lessonId]);
    if (!q.rowCount) return res.status(404).json({ resStatus: false, resMessage: "Lesson not found" });

    const content = typeof q.rows[0].content === "string" ? JSON.parse(q.rows[0].content) : q.rows[0].content;
    const exercise = (content.exercises || []).find(x => x.id === exerciseId);
    if (!exercise) return res.status(404).json({ resStatus: false, resMessage: "Exercise not found" });

    const filename = exercise.audio || exercise.referenceAudio;
    if (!filename) return res.status(404).json({ resStatus: false, resMessage: "Exercise has no audio" });

    if (lessonId > FREE_LESSONS) {
      const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return res.status(401).json({ resStatus: false, resMessage: "Authentication required" });

      const u = await pool.query(`SELECT u.subscription_status,u.subscription_expires_at FROM langas_sessions s JOIN langas_users u ON u.id=s.user_id WHERE s.session_id=$1 AND s.expires_at>now() LIMIT 1`, [token]);
      const user = u.rows[0];

      if (!user || user.subscription_status !== "active" || !user.subscription_expires_at || new Date(user.subscription_expires_at) <= new Date())
        return res.status(402).json({ resStatus: false, resMessage: "Subscription required", resErrorCode: 4021 });
    }

    const { data, error } = await supabase.storage.from("langas_audio").createSignedUrl(filename, 600);

    if (error || !data?.signedUrl) {
      console.error("Langas audio signed URL", error);
      return res.status(404).json({ resStatus: false, resMessage: "Audio not found" });
    }

    return res.json({ resStatus: true, resData: { url: data.signedUrl, expiresIn: 600 } });
  } catch (e) {
    console.error("Langas audio", e);
    return res.status(500).json({ resStatus: false, resMessage: "Audio unavailable" });
  }
});

router.post("/progress/exercise", blockMaliciousIPs, applyWriteRateLimit, auth, async (req, res) => {
  const { lessonId, exerciseId, skill, score, xp = 10 } = req.body || {};
  const n = Number(score);

  if (!Number.isFinite(n) || n < 0 || n > 100) return res.status(400).json({ resStatus: false, resMessage: "Invalid score" });

  const l = await pool.query(`SELECT content FROM langas_lessons WHERE id=$1`, [lessonId]);
  if (!l.rowCount) return res.status(404).json({ resStatus: false, resMessage: "Lesson not found" });

  const exercise = (l.rows[0].content.exercises || []).find(x => x.id === exerciseId);
  if (!exercise) return res.status(400).json({ resStatus: false, resMessage: "Exercise not found" });

  const passed = n >= Number(exercise.passRate || 0.8) * 100;
  const award = passed ? Math.max(0, Math.min(Number(xp) || 10, 50)) : 0;
  const uid = req.langasUser.user_id;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO langas_exercise_attempts(user_id,lesson_id,exercise_id,skill,score,passed,xp_awarded) VALUES($1,$2,$3,$4,$5,$6,$7)`, [uid, lessonId, exerciseId, skill, n, passed, award]);
    await client.query(`UPDATE langas_users SET xp=xp+$2,level=GREATEST(1,FLOOR((xp+$2)/500)+1),updated_at=now() WHERE id=$1`, [uid, award]);
    await client.query(`INSERT INTO langas_daily_activity(user_id,activity_date,exercises_completed,xp_earned) VALUES($1,current_date,1,$2) ON CONFLICT(user_id,activity_date) DO UPDATE SET exercises_completed=langas_daily_activity.exercises_completed+1,xp_earned=langas_daily_activity.xp_earned+$2`, [uid, award]);
    await client.query(`INSERT INTO langas_weekly_leaderboard(week_start,user_id,xp) VALUES(date_trunc('week',current_date)::date,$1,$2) ON CONFLICT(week_start,user_id) DO UPDATE SET xp=langas_weekly_leaderboard.xp+$2`, [uid, award]);
    await client.query("COMMIT");
    return res.json({ resStatus: true, resData: { passed, xpAwarded: award } });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Langas exercise progress", e);
    return res.status(500).json({ resStatus: false, resMessage: "Progress could not be saved" });
  } finally {
    client.release();
  }
});

router.post("/progress/lesson", blockMaliciousIPs, applyWriteRateLimit, auth, async (req, res) => {
  const { lessonId, score } = req.body || {};
  const uid = req.langasUser.user_id;
  const n = Number(score);

  if (!Number.isFinite(n) || n < 0 || n > 100) return res.status(400).json({ resStatus: false, resMessage: "Invalid score" });

  const l = await pool.query(`SELECT completion_pass_rate FROM langas_lessons WHERE id=$1`, [lessonId]);
  if (!l.rowCount) return res.status(404).json({ resStatus: false, resMessage: "Lesson not found" });

  const completed = n >= Number(l.rows[0].completion_pass_rate) * 100;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`INSERT INTO langas_lesson_progress(user_id,lesson_id,best_score,attempts,completed,completed_at,last_attempt_at) VALUES($1,$2,$3,1,$4,CASE WHEN $4 THEN now() END,now()) ON CONFLICT(user_id,lesson_id) DO UPDATE SET best_score=GREATEST(langas_lesson_progress.best_score,$3),attempts=langas_lesson_progress.attempts+1,completed=langas_lesson_progress.completed OR $4,completed_at=CASE WHEN langas_lesson_progress.completed_at IS NULL AND $4 THEN now() ELSE langas_lesson_progress.completed_at END,last_attempt_at=now()`, [uid, lessonId, n, completed]);

    let streak = null;

    if (completed) {
      const u = await client.query(`SELECT streak_days,longest_streak,last_learning_date,streak_protections FROM langas_users WHERE id=$1 FOR UPDATE`, [uid]);
      const user = u.rows[0];

      const s = await client.query(`
        UPDATE langas_users SET
          streak_days=CASE
            WHEN last_learning_date=current_date THEN streak_days
            WHEN last_learning_date=current_date-1 THEN streak_days+1
            WHEN last_learning_date=current_date-2 AND streak_protections>0 THEN streak_days+1
            ELSE 1
          END,
          streak_protections=CASE
            WHEN last_learning_date=current_date-2 AND streak_protections>0 THEN streak_protections-1
            ELSE streak_protections
          END,
          last_learning_date=current_date,
          updated_at=now()
        WHERE id=$1
        RETURNING streak_days,streak_protections
      `, [uid]);

      const streakDays = s.rows[0].streak_days;

      await client.query(`UPDATE langas_users SET longest_streak=GREATEST(longest_streak,$2) WHERE id=$1`, [uid, streakDays]);

      streak = { streakDays, streakProtections: s.rows[0].streak_protections };
    }

    await client.query("COMMIT");
    return res.json({ resStatus: true, resData: { completed, streak } });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Langas lesson progress", e);
    return res.status(500).json({ resStatus: false, resMessage: "Lesson progress could not be saved" });
  } finally {
    client.release();
  }
});

router.get("/leaderboard/:scope", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
  const scope = req.params.scope;
  let q;

  if (scope === "weekly") {
    q = await pool.query(`SELECT u.display_name,u.avatar_url,w.xp FROM langas_weekly_leaderboard w JOIN langas_users u ON u.id=w.user_id WHERE w.week_start=date_trunc('week',current_date)::date ORDER BY w.xp DESC LIMIT 100`);
  } else if (scope === "all") {
    q = await pool.query(`SELECT display_name,avatar_url,xp FROM langas_users ORDER BY xp DESC LIMIT 100`);
  } else {
    return res.status(400).json({ resStatus: false, resMessage: "Invalid scope" });
  }

  return res.json({ resStatus: true, resData: q.rows });
});

router.put("/settings", blockMaliciousIPs, applyWriteRateLimit, auth, async (req, res) => {
  const { dailyGoalExercises, reminderEnabled, reminderTime } = req.body || {};
  const g = Math.max(1, Math.min(Number(dailyGoalExercises) || 11, 55));

  await pool.query(`UPDATE langas_users SET daily_goal_exercises=$2,reminder_enabled=$3,reminder_time=$4,updated_at=now() WHERE id=$1`, [req.langasUser.user_id, g, !!reminderEnabled, reminderTime || null]);

  return res.json({ resStatus: true });
});

router.post("/subscription/verify", blockMaliciousIPs, applyWriteRateLimit, auth, async (req, res) => {
  let client;

  try {
    const v = await verifyStoreSubscription(req.body || {});
    if (!v.valid) return res.status(400).json({ resStatus: false, resMessage: "Subscription could not be verified" });

    client = await pool.connect();
    await client.query("BEGIN");

    await client.query(`INSERT INTO langas_subscription_receipts(user_id,store,product_id,transaction_id,raw_receipt,verified,expires_at) VALUES($1,$2,$3,$4,$5,true,$6) ON CONFLICT(transaction_id) DO UPDATE SET verified=true,expires_at=EXCLUDED.expires_at`, [req.langasUser.user_id, v.store, v.productId, v.transactionId, v.rawReceipt, v.expiresAt]);

    await client.query(`UPDATE langas_users SET subscription_status='active',subscription_store=$2,subscription_expires_at=$3,updated_at=now() WHERE id=$1`, [req.langasUser.user_id, v.store, v.expiresAt]);

    await client.query("COMMIT");
    return res.json({ resStatus: true, resData: { expiresAt: v.expiresAt } });
  } catch (e) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    console.error("Langas subscription verify", e);
    return res.status(500).json({ resStatus: false, resMessage: "Verification error" });
  } finally {
    if (client) client.release();
  }
});

router.post("/pronunciation", blockMaliciousIPs, applyWriteRateLimit, auth, express.raw({ type: "audio/*", limit: "5mb" }), async (req, res) => {
  try {
    const expected = String(req.query.expected || "").slice(0, 300);
    if (!expected || !Buffer.isBuffer(req.body)) return res.status(400).json({ resStatus: false, resMessage: "Audio and expected text required" });

    const result = await scorePronunciation(req.body, expected);
    return res.json({ resStatus: true, resData: result });
  } catch (e) {
    console.error("Langas pronunciation", e);
    return res.status(503).json({ resStatus: false, resMessage: "Pronunciation service unavailable" });
  }
});

module.exports = router;