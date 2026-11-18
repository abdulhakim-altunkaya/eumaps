// Sudoku Town: CONTACT form (Question / Report a bug / Payments / Other). Signed-in players only.
// Saved in sudoku_contact_messages with app version, phone model and Android version. 5 messages a day per player (Riga).
// Loaded from routes/sudoku.js: require("./sudoku_contact")({ ...helpers }).

module.exports = function sudokuContact(h) {
  const { router, pool, sudokuRateLimit, sudokuRequireAuth, SUDOKU_TZ } = h;

  const TOPICS      = ["question", "bug", "payments", "other"];
  const PER_DAY     = 5;
  const MAX_MESSAGE = 1000;
  const EMAIL_RE    = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  const err = (res, code, msg, n) => res.status(code).json({ resStatus: false, resMessage: msg, resErrorCode: n });
  const clip = (v, n) => String(v ?? "").trim().slice(0, n);

  // POST /contact { topic, message, email, appVersion, device, os } -> { }
  router.post("/contact", sudokuRateLimit(10), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    const topic = String(req.body?.topic || "");
    const message = String(req.body?.message ?? "").trim();
    const email = clip(req.body?.email, 120);

    if (!TOPICS.includes(topic)) return err(res, 400, "Choose what it is about.", 1);
    if (message.length < 5) return err(res, 400, "Please write a little more.", 2);
    if (message.length > MAX_MESSAGE) return err(res, 400, "Message is too long.", 3);
    if (!email) return err(res, 400, "Please write your email.", 4);
    if (!EMAIL_RE.test(email)) return err(res, 400, "That email doesn't look right.", 4);

    try {
      const today = await pool.query(
        `SELECT COUNT(*)::int AS n FROM sudoku_contact_messages
         WHERE user_id = $1 AND (created_at AT TIME ZONE '${SUDOKU_TZ}')::date = (NOW() AT TIME ZONE '${SUDOKU_TZ}')::date`,
        [me]
      );
      if (today.rows[0].n >= PER_DAY) return err(res, 429, "You can send 5 messages a day. Try again tomorrow.", 5);

      await pool.query(
        `INSERT INTO sudoku_contact_messages (user_id, topic, message, email, app_version, device, os)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [me, topic, message, email || null, clip(req.body?.appVersion, 30), clip(req.body?.device, 120), clip(req.body?.os, 160)]
      );
      return res.status(200).json({ resStatus: true });
    } catch (e) {
      return err(res, 500, "Couldn't send. Try again.", 99);
    }
  });
};
