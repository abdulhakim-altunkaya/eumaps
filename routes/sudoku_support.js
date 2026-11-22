// Sudoku Town: SUPPORT CHAT. One thread per player with the "Sudoku Town team".
// Players: read their thread, write (max 200 characters, max 5 messages in a row without a team reply).
// Admins (sudoku_profiles.is_admin = true): inbox of all threads, read a thread, reply as the team.
// Phone model, Android version and app version are saved with each player message.
// Loaded from routes/sudoku.js: require("./sudoku_support")({ ...helpers }).

module.exports = function sudokuSupport(h) {
  const { router, pool, sudokuRateLimit, sudokuRequireAuth, sudokuParseUuid, sudokuAvatarLinks, SUDOKU_TZ } = h;

  const MAX_CHARS = 200;
  const MAX_IN_A_ROW = 5;     // player messages without a team reply
  const PAGE = 100;           // newest messages shown in a thread

  const err = (res, code, msg, n) => res.status(code).json({ resStatus: false, resMessage: msg, resErrorCode: n });
  const clip = (v, n) => String(v ?? "").trim().slice(0, n);

  // "14:05" today, "27 Oct 14:05" earlier (Riga time)
  const TIME = col => `CASE
    WHEN (${col} AT TIME ZONE '${SUDOKU_TZ}')::date = (NOW() AT TIME ZONE '${SUDOKU_TZ}')::date
    THEN to_char(${col} AT TIME ZONE '${SUDOKU_TZ}', 'HH24:MI')
    ELSE to_char(${col} AT TIME ZONE '${SUDOKU_TZ}', 'FMDD Mon HH24:MI') END`;

  // "14:05" today, "Yesterday", "27 Oct" (inbox list)
  const DAY = col => `CASE
    WHEN (${col} AT TIME ZONE '${SUDOKU_TZ}')::date = (NOW() AT TIME ZONE '${SUDOKU_TZ}')::date
    THEN to_char(${col} AT TIME ZONE '${SUDOKU_TZ}', 'HH24:MI')
    WHEN (${col} AT TIME ZONE '${SUDOKU_TZ}')::date = (NOW() AT TIME ZONE '${SUDOKU_TZ}')::date - 1
    THEN 'Yesterday'
    ELSE to_char(${col} AT TIME ZONE '${SUDOKU_TZ}', 'FMDD Mon') END`;

  const cleanText = raw => String(raw ?? "").replace(/\s+/g, " ").trim();

  async function isAdmin(userId) {
    const r = await pool.query(`SELECT is_admin FROM sudoku_profiles WHERE id = $1`, [userId]);
    return r.rowCount > 0 && r.rows[0].is_admin === true;
  }

  async function requireAdmin(req, res, next) {
    try {
      if (!(await isAdmin(req.sudokuUser.id))) return err(res, 403, "Not allowed", 1);
      next();
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  }

  // Newest messages of one player's thread, oldest first. teamView: "mine" = team messages.
  async function thread(playerId, teamView) {
    const r = await pool.query(
      `SELECT * FROM (
         SELECT m.id, m.from_team, m.body, ${TIME("m.created_at")} AS t
         FROM sudoku_support_messages m WHERE m.user_id = $1
         ORDER BY m.id DESC LIMIT ${PAGE}
       ) x ORDER BY id`,
      [playerId]
    );
    return r.rows.map(m => ({ id: Number(m.id), mine: teamView ? m.from_team : !m.from_team, text: m.body, time: m.t }));
  }

  // ── PLAYER ─────────────────────────────────────────────────────────────────
  // GET /support -> { messages }. Marks team replies as read.
  router.get("/support", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    try {
      const messages = await thread(me, false);
      await pool.query(
        `UPDATE sudoku_support_messages SET read_at = NOW() WHERE user_id = $1 AND from_team AND read_at IS NULL`,
        [me]
      );
      return res.status(200).json({ resStatus: true, messages });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // GET /support/unread -> { count } team replies the player hasn't read (red dot on Contact)
  router.get("/support/unread", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT COUNT(*)::int AS n FROM sudoku_support_messages WHERE user_id = $1 AND from_team AND read_at IS NULL`,
        [req.sudokuUser.id]
      );
      return res.status(200).json({ resStatus: true, count: r.rows[0].n });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // POST /support { text, appVersion, device, os } -> { }
  router.post("/support", sudokuRateLimit(20), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    const text = cleanText(req.body?.text);
    if (!text) return err(res, 400, "Write something first", 2);
    if ([...text].length > MAX_CHARS) return err(res, 400, "Max " + MAX_CHARS + " characters", 3);
    try {
      const row = await pool.query(
        `SELECT COUNT(*)::int AS n FROM sudoku_support_messages
         WHERE user_id = $1 AND NOT from_team
           AND id > COALESCE((SELECT MAX(id) FROM sudoku_support_messages WHERE user_id = $1 AND from_team), 0)`,
        [me]
      );
      if (row.rows[0].n >= MAX_IN_A_ROW) {
        return err(res, 429, "You can send " + MAX_IN_A_ROW + " messages in a row. Please wait for our reply.", 4);
      }
      await pool.query(
        `INSERT INTO sudoku_support_messages (user_id, from_team, body, app_version, device, os)
         VALUES ($1, FALSE, $2, $3, $4, $5)`,
        [me, text, clip(req.body?.appVersion, 30), clip(req.body?.device, 120), clip(req.body?.os, 160)]
      );
      return res.status(200).json({ resStatus: true });
    } catch (e) {
      return err(res, 500, "Couldn't send. Try again.", 99);
    }
  });

  // ── ADMIN ──────────────────────────────────────────────────────────────────
  // GET /support/admin/unread -> { count } player messages no admin has read (red dot on the profile button)
  router.get("/support/admin/unread", sudokuRateLimit(60), sudokuRequireAuth, requireAdmin, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT COUNT(*)::int AS n FROM sudoku_support_messages WHERE NOT from_team AND read_at IS NULL`
      );
      return res.status(200).json({ resStatus: true, count: r.rows[0].n });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // GET /support/admin -> { chats } one row per player, newest first
  router.get("/support/admin", sudokuRateLimit(60), sudokuRequireAuth, requireAdmin, async (req, res) => {
    try {
      const r = await pool.query(
        `WITH last AS (
           SELECT DISTINCT ON (user_id) user_id, id, body, from_team, created_at
           FROM sudoku_support_messages ORDER BY user_id, id DESC
         )
         SELECT l.user_id, l.id, l.body, l.from_team, ${DAY("l.created_at")} AS t,
                u.username AS name, u.avatar_path, u.is_pro,
                (SELECT COUNT(*) FROM sudoku_support_messages x
                 WHERE x.user_id = l.user_id AND NOT x.from_team AND x.read_at IS NULL)::int AS unread
         FROM last l JOIN sudoku_profiles u ON u.id = l.user_id
         ORDER BY l.id DESC
         LIMIT 200`
      );
      const links = await sudokuAvatarLinks(r.rows.map(x => x.avatar_path));
      return res.status(200).json({
        resStatus: true,
        chats: r.rows.map(x => ({
          userId: x.user_id, name: x.name, avatarUrl: links[x.avatar_path] || "", pro: x.is_pro === true,
          text: x.body, mine: x.from_team, time: x.t, unread: x.unread || 0
        }))
      });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // GET /support/admin/:id -> { messages, info } one player's thread. Marks their messages as read.
  router.get("/support/admin/:id", sudokuRateLimit(60), sudokuRequireAuth, requireAdmin, async (req, res) => {
    const player = sudokuParseUuid(req.params.id);
    if (!player) return err(res, 400, "Invalid player", 2);
    try {
      const messages = await thread(player, true);
      const dev = await pool.query(
        `SELECT app_version, device, os FROM sudoku_support_messages
         WHERE user_id = $1 AND NOT from_team ORDER BY id DESC LIMIT 1`,
        [player]
      );
      const d = dev.rows[0];
      const info = d ? [d.device, d.os, d.app_version ? "v" + d.app_version : ""].filter(Boolean).join(" · ") : "";
      await pool.query(
        `UPDATE sudoku_support_messages SET read_at = NOW() WHERE user_id = $1 AND NOT from_team AND read_at IS NULL`,
        [player]
      );
      return res.status(200).json({ resStatus: true, messages, info });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // POST /support/admin/:id { text } -> reply as the team
  router.post("/support/admin/:id", sudokuRateLimit(30), sudokuRequireAuth, requireAdmin, async (req, res) => {
    const player = sudokuParseUuid(req.params.id);
    if (!player) return err(res, 400, "Invalid player", 2);
    const text = cleanText(req.body?.text);
    if (!text) return err(res, 400, "Write something first", 3);
    if ([...text].length > MAX_CHARS) return err(res, 400, "Max " + MAX_CHARS + " characters", 4);
    try {
      const ok = await pool.query(`SELECT 1 FROM sudoku_profiles WHERE id = $1`, [player]);
      if (!ok.rowCount) return err(res, 404, "Player not found", 5);
      await pool.query(
        `INSERT INTO sudoku_support_messages (user_id, from_team, admin_id, body) VALUES ($1, TRUE, $2, $3)`,
        [player, req.sudokuUser.id, text]
      );
      return res.status(200).json({ resStatus: true });
    } catch (e) {
      return err(res, 500, "Couldn't send. Try again.", 99);
    }
  });
};
