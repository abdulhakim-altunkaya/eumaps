// Sudoku Town: DELETE ACCOUNT.
// Player: confirms with "DELETE"; the account is only marked (deletion_requested + deletion_requested_at)
// and signed out everywhere. While marked: sign-in is refused, and the player is hidden from search,
// friends lists, messages and the leaderboard.
// Admins (is_admin): list of marked accounts (oldest first), Reactivate or Delete at any time.
// Delete keeps as much as possible: only the name, photo and Google link are removed (deleted_at is set),
// so purchases, solves and all other records stay. The same Google account then starts a new account.
// Loaded from routes/sudoku.js: require("./sudoku_account")({ ...helpers }).

module.exports = function sudokuAccount(h) {
  const { router, pool, sudokuRateLimit, sudokuRequireAuth, sudokuParseUuid, sudokuAvatarLinks, sudokuRemoveAvatar, SUDOKU_TZ } = h;

  const RESTORE_DAYS = 7;
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

  // ── PLAYER ─────────────────────────────────────────────────────────────────
  // POST /account/delete { confirm: "DELETE" } -> { }
  router.post("/account/delete", sudokuRateLimit(5), sudokuRequireAuth, async (req, res) => {
    if (String(req.body?.confirm || "") !== "DELETE") return err(res, 400, "Type DELETE to confirm", 1);
    const me = req.sudokuUser.id;
    try {
      await pool.query(
        `UPDATE sudoku_profiles SET deletion_requested = TRUE, deletion_requested_at = NOW() WHERE id = $1`,
        [me]
      );
      await pool.query(`DELETE FROM sudoku_sessions WHERE user_id = $1`, [me]);
      return res.status(200).json({ resStatus: true });
    } catch (e) {
      return err(res, 500, "Couldn't delete. Try again.", 99);
    }
  });

  // ── ADMIN ──────────────────────────────────────────────────────────────────
  // GET /account/admin/count -> { count } accounts waiting (red count on the profile)
  router.get("/account/admin/count", sudokuRateLimit(60), sudokuRequireAuth, requireAdmin, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT COUNT(*)::int AS n FROM sudoku_profiles WHERE deletion_requested AND deleted_at IS NULL`
      );
      return res.status(200).json({ resStatus: true, count: r.rows[0].n });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // GET /account/admin -> { requests } oldest first
  router.get("/account/admin", sudokuRateLimit(60), sudokuRequireAuth, requireAdmin, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, username, avatar_path, is_pro,
                to_char(deletion_requested_at AT TIME ZONE '${SUDOKU_TZ}', 'FMDD Mon') AS d,
                GREATEST(0, ${RESTORE_DAYS} - FLOOR(EXTRACT(EPOCH FROM (NOW() - deletion_requested_at)) / 86400))::int AS left_days
         FROM sudoku_profiles
         WHERE deletion_requested AND deleted_at IS NULL
         ORDER BY deletion_requested_at ASC NULLS FIRST
         LIMIT 200`
      );
      const links = await sudokuAvatarLinks(r.rows.map(x => x.avatar_path));
      return res.status(200).json({
        resStatus: true,
        requests: r.rows.map(x => ({
          userId: x.id, name: x.username, avatarUrl: links[x.avatar_path] || "", pro: x.is_pro === true,
          date: x.d || "", daysLeft: x.left_days || 0
        }))
      });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // POST /account/admin/:id/reactivate -> the player can sign in again, nothing was lost
  router.post("/account/admin/:id/reactivate", sudokuRateLimit(30), sudokuRequireAuth, requireAdmin, async (req, res) => {
    const id = sudokuParseUuid(req.params.id);
    if (!id) return err(res, 400, "Invalid player", 2);
    try {
      const r = await pool.query(
        `UPDATE sudoku_profiles SET deletion_requested = FALSE, deletion_requested_at = NULL
         WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (!r.rowCount) return err(res, 404, "Player not found", 3);
      return res.status(200).json({ resStatus: true });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // POST /account/admin/:id/delete -> removes only the name, photo and Google link. Everything else stays.
  router.post("/account/admin/:id/delete", sudokuRateLimit(30), sudokuRequireAuth, requireAdmin, async (req, res) => {
    const id = sudokuParseUuid(req.params.id);
    if (!id) return err(res, 400, "Invalid player", 2);
    try {
      const old = await pool.query(
        `SELECT avatar_path FROM sudoku_profiles WHERE id = $1 AND deletion_requested AND deleted_at IS NULL`,
        [id]
      );
      if (!old.rowCount) return err(res, 404, "Player not found", 3);
      await pool.query(
        `UPDATE sudoku_profiles
         SET username = 'Deleted player', avatar_path = NULL, google_play_id = 'deleted:' || id::text, deleted_at = NOW()
         WHERE id = $1`,
        [id]
      );
      await pool.query(`DELETE FROM sudoku_sessions WHERE user_id = $1`, [id]);
      await sudokuRemoveAvatar(old.rows[0].avatar_path);
      return res.status(200).json({ resStatus: true });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });
};
