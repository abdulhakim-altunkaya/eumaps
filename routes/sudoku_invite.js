// Sudoku Town: INVITE links (vilnius-riga.app/sudoku-town/u/<id>).
// A brand-new player who signs in from someone's link (link tapped, or the Google Play install referrer)
// gives the inviter 10 g palladium. Only accounts in their first 7 days, once per account, and at most
// 10 paid invites per inviter per day (Riga). Invites over the daily limit are recorded but not paid.
// The website invite page reads only the inviter's username (GET /invite/name/:id).
// Loaded from routes/sudoku.js: require("./sudoku_invite")({ ...helpers }).

module.exports = function sudokuInvite(h) {
  const { router, pool, sudokuRateLimit, sudokuRequireAuth, sudokuParseUuid, SUDOKU_TZ } = h;

  const INVITE_REWARD  = 10;          // grams to the inviter
  const INVITE_PER_DAY = 10;          // paid invites per inviter per day (Riga)
  const SITE_ORIGIN    = "https://vilnius-riga.app";
  const TODAY_SQL      = `(NOW() AT TIME ZONE '${SUDOKU_TZ}')::date`;

  const err = (res, code, msg, n) => res.status(code).json({ resStatus: false, resMessage: msg, resErrorCode: n });

  // GET /invite/name/:id -> { name }. Public: the website shows "Ahmad invites you".
  router.get("/invite/name/:id", sudokuRateLimit(30), async (req, res) => {
    res.set("Access-Control-Allow-Origin", SITE_ORIGIN);
    const id = sudokuParseUuid(req.params.id);
    if (!id) return err(res, 400, "Invalid id", 1);
    try {
      const r = await pool.query(`SELECT username FROM sudoku_profiles WHERE id = $1`, [id]);
      if (!r.rowCount) return err(res, 404, "Not found", 2);
      return res.status(200).json({ resStatus: true, name: r.rows[0].username });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // POST /invite/claim { inviter } -> { claimed, paid }. Called by the new player's app after sign-in.
  router.post("/invite/claim", sudokuRateLimit(20), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    const inviter = sudokuParseUuid(req.body?.inviter);
    if (!inviter) return err(res, 400, "Invalid inviter", 1);
    if (inviter === me) return res.status(200).json({ resStatus: true, claimed: false, paid: false });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const who = await client.query(
        `SELECT id FROM sudoku_profiles WHERE id = $1 FOR UPDATE`, [inviter]
      );
      const mine = await client.query(
        `SELECT invite_until, invited_by FROM sudoku_profiles WHERE id = $1 FOR UPDATE`, [me]
      );
      const m = mine.rows[0];
      const fresh = m && !m.invited_by && m.invite_until && new Date(m.invite_until) > new Date();
      if (!who.rowCount || !fresh) {
        await client.query("ROLLBACK");
        return res.status(200).json({ resStatus: true, claimed: false, paid: false });
      }

      const today = await client.query(
        `SELECT COUNT(*)::int AS n FROM sudoku_invites
         WHERE inviter_id = $1 AND paid = TRUE AND (created_at AT TIME ZONE '${SUDOKU_TZ}')::date = ${TODAY_SQL}`,
        [inviter]
      );
      const paid = today.rows[0].n < INVITE_PER_DAY;

      await client.query(
        `INSERT INTO sudoku_invites (inviter_id, invitee_id, paid) VALUES ($1, $2, $3)`,
        [inviter, me, paid]
      );
      await client.query(
        `UPDATE sudoku_profiles SET invited_by = $2, invite_until = NULL WHERE id = $1`, [me, inviter]
      );
      if (paid) {
        await client.query(
          `UPDATE sudoku_profiles SET palladium_grams = palladium_grams + $2 WHERE id = $1`, [inviter, INVITE_REWARD]
        );
        await client.query(
          `INSERT INTO sudoku_palladium_ledger (user_id, amount, source) VALUES ($1, $2, 'other')`,
          [inviter, INVITE_REWARD]
        );
      }
      await client.query("COMMIT");
      return res.status(200).json({ resStatus: true, claimed: true, paid });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      if (e.code === "23505") return res.status(200).json({ resStatus: true, claimed: false, paid: false });
      return err(res, 500, "Server error", 99);
    } finally {
      client.release();
    }
  });

  // GET /invite/results -> players who joined from my link that I haven't seen yet (oldest first).
  router.get("/invite/results", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT i.id, u.username AS name, i.paid
         FROM sudoku_invites i
         JOIN sudoku_profiles u ON u.id = i.invitee_id
         WHERE i.inviter_id = $1 AND i.inviter_seen = FALSE
         ORDER BY i.id ASC LIMIT 20`,
        [req.sudokuUser.id]
      );
      return res.status(200).json({
        resStatus: true,
        results: r.rows.map(x => ({ id: Number(x.id), name: x.name, paid: x.paid }))
      });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // POST /invite/results/seen { upTo } -> marks them as seen.
  router.post("/invite/results/seen", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
    const upTo = Number(req.body?.upTo);
    if (!Number.isInteger(upTo) || upTo <= 0) return err(res, 400, "Invalid id", 1);
    try {
      await pool.query(
        `UPDATE sudoku_invites SET inviter_seen = TRUE WHERE inviter_id = $1 AND id <= $2`,
        [req.sudokuUser.id, upTo]
      );
      return res.status(200).json({ resStatus: true });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });
};
