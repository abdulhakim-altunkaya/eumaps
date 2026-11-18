// Sudoku Town: FREE vs PRO + Google Play purchases.
// Free: 10 puzzles per level, Town Hall play for the first 30 days, 1 Beat me link sent + 1 accepted a day,
// 10 friends, read messages only, no freeze. PRO (€4, one-time): everything, 100 friends.
// Palladium pack: 20 g for €8, 1 a day (the app blocks a 2nd one). A free player who buys it also becomes PRO.
// Purchases are checked with Google (service account) before anything is granted. Refunds arrive from Google
// (Real-time developer notifications → Pub/Sub push → POST /shop/rtdn) and are taken back right away.
// Loaded from routes/sudoku.js: const sudokuProApi = require("./sudoku_pro")({ ...helpers }).

const https = require("https");
const crypto = require("crypto");

module.exports = function sudokuPro(h) {
  const { router, pool, sudokuRateLimit, sudokuRequireAuth, SUDOKU_TZ } = h;

  const PACKAGE           = "com.sudokutown.app";
  const PRO_PRODUCT       = "pro_unlock";
  const PALLADIUM_PRODUCT = "palladium_20";
  const PALLADIUM_GRAMS   = 20;
  const FREE_PUZZLES      = 10;      // per level: the 10 lowest puzzle ids
  const FREE_TOWNHALL_DAYS = 30;     // free players can play Town Hall posts this long after first sign-in
  const FREE_FRIENDS      = 10;
  const PRO_FRIENDS       = 100;
  const PRO_CODE          = 77;      // resErrorCode: the app shows the "Get PRO" popup
  const DIFFS             = ["easy", "medium", "hard", "ultra_hard"];
  const TODAY_SQL         = `(NOW() AT TIME ZONE '${SUDOKU_TZ}')::date`;

  const err = (res, code, msg, n) => res.status(code).json({ resStatus: false, resMessage: msg, resErrorCode: n });
  const proError = (res, msg) => err(res, 403, msg, PRO_CODE);

  // Friend limit as a column expression (u = sudoku_profiles alias, or no alias)
  const CAPACITY_SQL = (alias) => {
    const p = alias ? alias + "." : "";
    return `(CASE WHEN ${p}is_pro THEN ${PRO_FRIENDS} ELSE ${FREE_FRIENDS} END)`;
  };

  // The free puzzles of one difficulty ($n = difficulty parameter)
  const FREE_IDS_SQL = (param) =>
    `(SELECT id FROM sudoku_seeds WHERE difficulty = ${param} ORDER BY id LIMIT ${FREE_PUZZLES})`;

  async function isPro(userId) {
    const r = await pool.query(`SELECT is_pro FROM sudoku_profiles WHERE id = $1`, [userId]);
    return r.rowCount > 0 && r.rows[0].is_pro === true;
  }

  // Free puzzles left per level: [easy, medium, hard, ultra_hard]
  async function freeLeft(userId) {
    const r = await pool.query(
      `SELECT s.difficulty, COUNT(l.puzzle_id)::int AS solved
       FROM (SELECT id, difficulty, ROW_NUMBER() OVER (PARTITION BY difficulty ORDER BY id) AS rn
             FROM sudoku_seeds) s
       LEFT JOIN sudoku_solved_logs l ON l.puzzle_id = s.id AND l.user_id = $1
       WHERE s.rn <= ${FREE_PUZZLES}
       GROUP BY s.difficulty`,
      [userId]
    );
    const solved = {};
    for (const row of r.rows) solved[row.difficulty] = row.solved;
    return DIFFS.map(d => Math.max(0, FREE_PUZZLES - (solved[d] || 0)));
  }

  async function canBuyPalladium(userId) {
    const r = await pool.query(
      `SELECT 1 FROM sudoku_purchases
       WHERE user_id = $1 AND product_id = $2 AND (created_at AT TIME ZONE '${SUDOKU_TZ}')::date = ${TODAY_SQL}`,
      [userId, PALLADIUM_PRODUCT]
    );
    return r.rowCount === 0;
  }

  // Free player: still inside the first 30 days?
  async function townHallOpen(userId) {
    const r = await pool.query(
      `SELECT is_pro OR created_at > NOW() - INTERVAL '${FREE_TOWNHALL_DAYS} days' AS ok
       FROM sudoku_profiles WHERE id = $1`, [userId]
    );
    return r.rowCount > 0 && r.rows[0].ok === true;
  }

  // ---------- Google Play Developer API (service account, no extra packages) ----------
  function request(method, url, headers, body) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = https.request(
        { method, hostname: u.hostname, path: u.pathname + u.search, headers },
        res => {
          let data = "";
          res.on("data", c => (data += c));
          res.on("end", () => {
            let json = null;
            try { json = JSON.parse(data); } catch (e) { /* not JSON */ }
            resolve({ status: res.statusCode, json });
          });
        }
      );
      req.on("error", reject);
      req.setTimeout(15000, () => req.destroy(new Error("timeout")));
      if (body) req.write(body);
      req.end();
    });
  }

  const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  let tokenCache = { value: null, exp: 0 };

  async function accessToken() {
    const now = Math.floor(Date.now() / 1000);
    if (tokenCache.value && tokenCache.exp > now + 60) return tokenCache.value;
    const email = process.env.GOOGLE_PLAY_CLIENT_EMAIL;
    const key = (process.env.GOOGLE_PLAY_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    if (!email || !key) throw new Error("Google Play service account is not set");
    const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    }));
    const sig = b64url(crypto.createSign("RSA-SHA256").update(head + "." + claims).sign(key));
    const body = "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") +
                 "&assertion=" + head + "." + claims + "." + sig;
    const r = await request("POST", "https://oauth2.googleapis.com/token",
      { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) }, body);
    if (r.status !== 200 || !r.json?.access_token) throw new Error("Google sign-in failed");
    tokenCache = { value: r.json.access_token, exp: now + (r.json.expires_in || 3600) };
    return tokenCache.value;
  }

  // -> Google's purchase record (purchaseState 0 = purchased) or null
  async function googlePurchase(productId, token) {
    const t = await accessToken();
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}` +
                `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`;
    const r = await request("GET", url, { Authorization: "Bearer " + t });
    return r.status === 200 ? r.json : null;
  }

  // Unity receipt → { token, productId }. Unity wraps Google's purchase JSON in "Payload" → "json".
  function readReceipt(receipt, fallbackToken) {
    let token = null, productId = null;
    try {
      const r = JSON.parse(receipt);
      const payload = typeof r.Payload === "string" ? JSON.parse(r.Payload) : r.Payload;
      const inner = payload && (typeof payload.json === "string" ? JSON.parse(payload.json) : payload.json);
      token = inner?.purchaseToken || r.TransactionID || null;
      productId = inner?.productId || null;
    } catch (e) { /* not a Unity receipt */ }
    return { token: token || fallbackToken || null, productId };
  }

  async function shopState(userId) {
    const r = await pool.query(`SELECT is_pro, palladium_grams FROM sudoku_profiles WHERE id = $1`, [userId]);
    const p = r.rows[0] || {};
    return { pro: p.is_pro === true, palladium: p.palladium_grams || 0, canBuyPalladium: await canBuyPalladium(userId) };
  }

  // GET /shop -> { pro, palladium, canBuyPalladium }
  router.get("/shop", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
    try {
      return res.status(200).json({ resStatus: true, ...(await shopState(req.sudokuUser.id)) });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // POST /shop/verify { productId, receipt, transactionId } -> { pro, palladium, canBuyPalladium }.
  // Checked with Google first. The same purchase twice = granted once (the app retries until it's confirmed).
  router.post("/shop/verify", sudokuRateLimit(20), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    const asked = String(req.body?.productId || "");
    const { token, productId: fromReceipt } = readReceipt(String(req.body?.receipt || ""), String(req.body?.transactionId || ""));
    const productId = fromReceipt || asked;
    if (!token || (productId !== PRO_PRODUCT && productId !== PALLADIUM_PRODUCT)) {
      return err(res, 400, "Invalid purchase", 1);
    }

    let g;
    try {
      g = await googlePurchase(productId, token);
    } catch (e) {
      return err(res, 503, "Couldn't check the purchase with Google. Try again later.", 2);
    }
    if (!g) return err(res, 400, "Google doesn't know this purchase.", 3);
    if (g.purchaseState !== 0) return err(res, 409, "This payment isn't finished yet.", 4);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ins = await client.query(
        `INSERT INTO sudoku_purchases (user_id, product_id, purchase_token, order_id, grams, made_pro)
         VALUES ($1, $2, $3, $4, $5, FALSE)
         ON CONFLICT (purchase_token) DO NOTHING RETURNING id`,
        [me, productId, token, g.orderId || null, productId === PALLADIUM_PRODUCT ? PALLADIUM_GRAMS : 0]
      );
      if (!ins.rowCount) {
        // Already granted: fine for the same player (a retry), refused for anyone else
        const old = await client.query(`SELECT user_id FROM sudoku_purchases WHERE purchase_token = $1`, [token]);
        await client.query("ROLLBACK");
        if (old.rows[0]?.user_id !== me) return err(res, 409, "This purchase belongs to another player.", 5);
        return res.status(200).json({ resStatus: true, ...(await shopState(me)) });
      }

      const was = (await client.query(`SELECT is_pro FROM sudoku_profiles WHERE id = $1 FOR UPDATE`, [me])).rows[0];
      const makesPro = !was.is_pro;   // PRO itself, or a free player's palladium pack ("sweet mistake")
      if (makesPro) {
        await client.query(`UPDATE sudoku_profiles SET is_pro = TRUE WHERE id = $1`, [me]);
        await client.query(`UPDATE sudoku_purchases SET made_pro = TRUE WHERE id = $1`, [ins.rows[0].id]);
      }
      if (productId === PALLADIUM_PRODUCT) {
        await client.query(
          `UPDATE sudoku_profiles SET palladium_grams = palladium_grams + $2 WHERE id = $1`, [me, PALLADIUM_GRAMS]
        );
        await client.query(
          `INSERT INTO sudoku_palladium_ledger (user_id, amount, source) VALUES ($1, $2, 'purchase')`,
          [me, PALLADIUM_GRAMS]
        );
      }
      await client.query("COMMIT");
      return res.status(200).json({ resStatus: true, ...(await shopState(me)) });
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (e2) { /* closed */ }
      return err(res, 500, "Server error", 99);
    } finally {
      client.release();
    }
  });

  // Refund → take it back: palladium (not below 0) and PRO if this purchase gave it (and no other one did).
  async function refund(token) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `UPDATE sudoku_purchases SET refunded_at = NOW()
         WHERE purchase_token = $1 AND refunded_at IS NULL
         RETURNING user_id, product_id, grams, made_pro`, [token]
      );
      if (!r.rowCount) { await client.query("ROLLBACK"); return; }
      const p = r.rows[0];
      if (p.grams > 0) {
        await client.query(
          `UPDATE sudoku_profiles SET palladium_grams = GREATEST(0, palladium_grams - $2) WHERE id = $1`,
          [p.user_id, p.grams]
        );
      }
      if (p.made_pro) {
        const other = await client.query(
          `SELECT 1 FROM sudoku_purchases WHERE user_id = $1 AND made_pro AND refunded_at IS NULL`, [p.user_id]
        );
        if (!other.rowCount) await client.query(`UPDATE sudoku_profiles SET is_pro = FALSE WHERE id = $1`, [p.user_id]);
      } else if (p.product_id === PRO_PRODUCT) {
        // PRO bought while already PRO through a palladium pack: refund of that one changes nothing
      }
      await client.query("COMMIT");
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (e2) { /* closed */ }
    } finally {
      client.release();
    }
  }

  // POST /shop/rtdn?token=SECRET  (Google Cloud Pub/Sub push). Always answers 200 so Google doesn't resend.
  router.post("/shop/rtdn", async (req, res) => {
    const secret = process.env.SUDOKU_RTDN_TOKEN;
    if (!secret || req.query.token !== secret) return res.status(403).end();
    try {
      const data = req.body?.message?.data;
      const msg = data ? JSON.parse(Buffer.from(data, "base64").toString("utf8")) : null;
      if (msg && msg.packageName === PACKAGE && msg.voidedPurchaseNotification?.purchaseToken) {
        await refund(msg.voidedPurchaseNotification.purchaseToken);
      }
    } catch (e) { /* bad message: ignore */ }
    return res.status(200).end();
  });

  return { isPro, freeLeft, canBuyPalladium, townHallOpen, proError, CAPACITY_SQL, FREE_IDS_SQL, FREE_PUZZLES };
};
