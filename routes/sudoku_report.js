// Sudoku Town: REPORT + BLOCK players.
// Block: removes the friendship (and any friend request) both ways. While blocked, neither player can send
// a friend request, message, gift or play the other's challenges. Leaderboards stay as they are.
// The blocked player is not told. Unblock any time (Friends screen or their profile).
// Report: reason (name | photo | messages | other) + optional note (200 characters). Admins (is_admin) see one row
// per reported player: Remove photo, Rename, Lock (name and photo can't be changed), Dismiss (report handled).
// Locked players stay in a LOCKED list until unlocked.
// Loaded from routes/sudoku.js: require("./sudoku_report")({ ...helpers }).

module.exports = function sudokuReport(h) {
  const {
    router, pool, sudokuRateLimit, sudokuRequireAuth, sudokuParseUuid, sudokuAvatarLinks, sudokuRemoveAvatar,
    sudokuTitleInfo, SUDOKU_EARNED_SQL, SUDOKU_TZ
  } = h;

  const REASONS = { name: "Name", photo: "Photo", messages: "Messages", other: "Other" };
  const NOTE_MAX = 200;
  const REPORTS_PER_DAY = 20;
  const err = (res, code, msg, n) => res.status(code).json({ resStatus: false, resMessage: msg, resErrorCode: n });

  async function requireAdmin(req, res, next) {
    try {
      const r = await pool.query(`SELECT is_admin FROM sudoku_profiles WHERE id = $1`, [req.sudokuUser.id]);
      if (!r.rowCount || r.rows[0].is_admin !== true) return err(res, 403, "Not allowed", 1);
      next();
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  }

  // ── used by sudoku.js, sudoku_pro.js, sudoku_townhall.js ───────────────────
  // "me" = I blocked them · "them" = they blocked me · null = no block
  async function blockState(me, other) {
    const r = await pool.query(
      `SELECT blocker_id FROM sudoku_blocks
       WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
      [me, other]
    );
    if (!r.rowCount) return null;
    return r.rows.some(x => x.blocker_id === me) ? "me" : "them";
  }

  async function iBlocked(me, other) {
    return (await blockState(me, other)) === "me";
  }

  // Players I blocked (own Friends screen), newest first
  async function blockedList(me) {
    const r = await pool.query(
      `SELECT u.id, u.username, u.avatar_path, u.is_pro, ${SUDOKU_EARNED_SQL("u.id")} AS earned
       FROM sudoku_blocks b JOIN sudoku_profiles u ON u.id = b.blocked_id
       WHERE b.blocker_id = $1 AND NOT u.deletion_requested
       ORDER BY b.created_at DESC LIMIT 200`,
      [me]
    );
    const links = await sudokuAvatarLinks(r.rows.map(x => x.avatar_path));
    return r.rows.map(x => {
      const t = sudokuTitleInfo(x.earned);
      return {
        userId: x.id, name: x.username, avatarUrl: links[x.avatar_path] || "", solved: 0, unread: 0,
        friendState: "none", pro: x.is_pro === true, title: t.title, titleShort: t.titleShort
      };
    });
  }

  async function block(me, other) {
    await pool.query(
      `INSERT INTO sudoku_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me, other]
    );
    await pool.query(
      `DELETE FROM sudoku_friendships
       WHERE LEAST(user_id, friend_id) = LEAST($1::uuid, $2::uuid)
         AND GREATEST(user_id, friend_id) = GREATEST($1::uuid, $2::uuid)`,
      [me, other]
    );
  }

  async function otherPlayer(req, res) {
    const other = sudokuParseUuid(req.params.id);
    if (!other) { err(res, 400, "Invalid player", 1); return null; }
    if (other === req.sudokuUser.id) { err(res, 400, "That's you", 2); return null; }
    const r = await pool.query(`SELECT id FROM sudoku_profiles WHERE id = $1 AND deleted_at IS NULL`, [other]);
    if (!r.rowCount) { err(res, 404, "Player not found", 3); return null; }
    return other;
  }

  // ── PLAYER ─────────────────────────────────────────────────────────────────
  // POST /block/:id -> { }
  router.post("/block/:id", sudokuRateLimit(30), sudokuRequireAuth, async (req, res) => {
    try {
      const other = await otherPlayer(req, res);
      if (!other) return;
      await block(req.sudokuUser.id, other);
      return res.status(200).json({ resStatus: true });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // POST /unblock/:id -> { } (they are not friends again; either can send a new request)
  router.post("/unblock/:id", sudokuRateLimit(30), sudokuRequireAuth, async (req, res) => {
    const other = sudokuParseUuid(req.params.id);
    if (!other) return err(res, 400, "Invalid player", 1);
    try {
      await pool.query(`DELETE FROM sudoku_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [req.sudokuUser.id, other]);
      return res.status(200).json({ resStatus: true });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // POST /report/:id { reason, note, block } -> { }. One open report per player you reported (a new one updates it).
  router.post("/report/:id", sudokuRateLimit(20), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    const reason = String(req.body?.reason || "");
    const note = String(req.body?.note ?? "").replace(/\s+/g, " ").trim();
    if (!REASONS[reason]) return err(res, 400, "Pick a reason", 4);
    if ([...note].length > NOTE_MAX) return err(res, 400, "Max 200 characters", 5);
    try {
      const other = await otherPlayer(req, res);
      if (!other) return;
      const day = await pool.query(
        `SELECT COUNT(*)::int AS n FROM sudoku_reports WHERE reporter_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
        [me]
      );
      if (day.rows[0].n >= REPORTS_PER_DAY) return err(res, 429, "Too many reports today. Try again tomorrow.", 6);
      const upd = await pool.query(
        `UPDATE sudoku_reports SET reason = $3, note = CASE WHEN $4 = '' THEN note ELSE $4 END, created_at = NOW()
         WHERE reporter_id = $1 AND reported_id = $2 AND handled_at IS NULL`,
        [me, other, reason, note]
      );
      if (!upd.rowCount) {
        await pool.query(
          `INSERT INTO sudoku_reports (reporter_id, reported_id, reason, note) VALUES ($1, $2, $3, $4)`,
          [me, other, reason, note]
        );
      }
      if (req.body?.block === true) await block(me, other);
      return res.status(200).json({ resStatus: true });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // ── ADMIN ──────────────────────────────────────────────────────────────────
  // GET /report/admin/count -> { count } reported players waiting (red count on the profile)
  router.get("/report/admin/count", sudokuRateLimit(60), sudokuRequireAuth, requireAdmin, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT COUNT(DISTINCT reported_id)::int AS n FROM sudoku_reports WHERE handled_at IS NULL`
      );
      return res.status(200).json({ resStatus: true, count: r.rows[0].n });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // GET /report/admin -> { reports (one per player, oldest first), locked (locked players without open reports) }
  router.get("/report/admin", sudokuRateLimit(60), sudokuRequireAuth, requireAdmin, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT u.id, u.username, u.avatar_path, u.is_pro, u.edit_locked,
                COUNT(*)::int AS n,
                array_agg(r.reason) AS reasons,
                (array_agg(r.note ORDER BY r.created_at DESC) FILTER (WHERE r.note <> ''))[1] AS note,
                to_char(MIN(r.created_at) AT TIME ZONE '${SUDOKU_TZ}', 'FMDD Mon') AS d
         FROM sudoku_reports r JOIN sudoku_profiles u ON u.id = r.reported_id
         WHERE r.handled_at IS NULL
         GROUP BY u.id
         ORDER BY MIN(r.created_at) ASC
         LIMIT 100`
      );
      const l = await pool.query(
        `SELECT u.id, u.username, u.avatar_path, u.is_pro
         FROM sudoku_profiles u
         WHERE u.edit_locked AND NOT EXISTS (
           SELECT 1 FROM sudoku_reports r WHERE r.reported_id = u.id AND r.handled_at IS NULL)
         ORDER BY u.username LIMIT 200`
      );
      const links = await sudokuAvatarLinks([...r.rows, ...l.rows].map(x => x.avatar_path));
      const summary = reasons => {
        const n = {};
        for (const x of reasons || []) n[x] = (n[x] || 0) + 1;
        return Object.keys(REASONS).filter(k => n[k]).map(k => REASONS[k] + (n[k] > 1 ? " ×" + n[k] : "")).join(" · ");
      };
      return res.status(200).json({
        resStatus: true,
        reports: r.rows.map(x => ({
          userId: x.id, name: x.username, avatarUrl: links[x.avatar_path] || "", pro: x.is_pro === true,
          hasPhoto: !!x.avatar_path, locked: x.edit_locked === true,
          count: x.n, reasons: summary(x.reasons), note: x.note || "", date: x.d || ""
        })),
        locked: l.rows.map(x => ({
          userId: x.id, name: x.username, avatarUrl: links[x.avatar_path] || "", pro: x.is_pro === true,
          hasPhoto: !!x.avatar_path, locked: true, count: 0, reasons: "", note: "", date: ""
        }))
      });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // POST /report/admin/:id/photo | rename | lock | unlock | dismiss -> { }
  // photo, rename and lock are noted on the open reports; dismiss closes them.
  router.post("/report/admin/:id/:action", sudokuRateLimit(30), sudokuRequireAuth, requireAdmin, async (req, res) => {
    const id = sudokuParseUuid(req.params.id);
    const action = String(req.params.action || "");
    if (!id || !["photo", "rename", "lock", "unlock", "dismiss"].includes(action)) return err(res, 400, "Invalid request", 2);
    try {
      const u = await pool.query(`SELECT avatar_path FROM sudoku_profiles WHERE id = $1`, [id]);
      if (!u.rowCount) return err(res, 404, "Player not found", 3);

      if (action === "photo") {
        await pool.query(`UPDATE sudoku_profiles SET avatar_path = NULL WHERE id = $1`, [id]);
        await sudokuRemoveAvatar(u.rows[0].avatar_path);
      } else if (action === "rename") {
        // "Player 3F9A2" (from the player id, so it's always allowed)
        await pool.query(
          `UPDATE sudoku_profiles SET username = 'Player ' || upper(substr(replace(id::text, '-', ''), 1, 5)) WHERE id = $1`,
          [id]
        );
      } else if (action === "lock" || action === "unlock") {
        await pool.query(`UPDATE sudoku_profiles SET edit_locked = $2 WHERE id = $1`, [id, action === "lock"]);
      }

      if (action === "dismiss") {
        await pool.query(
          `UPDATE sudoku_reports SET handled_at = NOW(), handled_by = $2,
                  action = COALESCE(action, 'dismiss')
           WHERE reported_id = $1 AND handled_at IS NULL`,
          [id, req.sudokuUser.id]
        );
      } else {
        await pool.query(
          `UPDATE sudoku_reports SET action = CASE WHEN action IS NULL THEN $2 ELSE action || ' ' || $2 END
           WHERE reported_id = $1 AND handled_at IS NULL`,
          [id, action]
        );
      }
      return res.status(200).json({ resStatus: true });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  return { blockState, iBlocked, blockedList };
};
