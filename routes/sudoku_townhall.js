// Sudoku Town: TOWN HALL + Beat me link payments.
// Town Hall: a Pro player posts the puzzle they just solved (solved in 50 min or less) with a prize of 5–25 g.
// The post costs prize + 1 g fee (taken right away, the fee is never returned). Up to 20 players, once each,
// against the poster's time. The first 5 who beat the time each win prize ÷ 5, on top of the normal reward.
// A post ends after 7 days or when all 20 players have finished: the unpaid prize goes back to the poster.
// Beat me link: 1 player, costs the sender 2 g (free 1 link a day, PRO 3). Receiver beats the time = gets those 2 g;
// otherwise (or nobody finishes in 30 days) the sender gets it back.
// Loaded from routes/sudoku.js: require("./sudoku_townhall")({ ...helpers }).

module.exports = function sudokuTownHall(h) {
  const {
    router, pool, sudokuRateLimit, sudokuRequireAuth, sudokuChallengeReward, sudokuChallengeCode,
    sudokuAvatarLinks, sudokuTitleInfo, SUDOKU_EARNED_SQL, SUDOKU_TZ, SUDOKU_MAX_SOLVE_SEC, SUDOKU_CHALLENGE_DAYS,
    sudokuProApi
  } = h;

  const TH_AMOUNTS     = [5, 10, 15, 20, 25];
  const TH_WINNERS     = 5;                 // prizes for the first 5 who beat the time
  const TH_DAYS        = 7;
  const TH_MAX_SECONDS = 50 * 60;           // only puzzles solved in 50 min or less
  const TH_FEE         = 1;                 // posting fee, never returned
  const TH_PER_DAY     = 3;                 // posts per day (Riga)
  const TH_MAX_PLAYERS = 20;
  const LINK_STAKE     = 2;                 // Beat me link: 2 g from the sender
  const LINK_PER_DAY_PRO  = 3;
  const LINK_PER_DAY_FREE = 1;
  const TH_TODAY_SQL   = `(NOW() AT TIME ZONE '${SUDOKU_TZ}')::date`;

  const err = (res, code, msg, n) => res.status(code).json({ resStatus: false, resMessage: msg, resErrorCode: n });

  async function isPro(userId) {
    const r = await pool.query(`SELECT is_pro FROM sudoku_profiles WHERE id = $1`, [userId]);
    return r.rowCount > 0 && r.rows[0].is_pro === true;
  }

  // One post as the app gets it.
  const POST_SELECT = `
    SELECT t.id, t.user_id, t.puzzle_id, t.poster_seconds, t.prize_total, t.winners,
           GREATEST(0, EXTRACT(EPOCH FROM (t.expires_at - NOW())))::int AS ends,
           u.username, u.avatar_path, ${SUDOKU_EARNED_SQL("u.id")} AS earned, s.difficulty,
           (SELECT COUNT(*) FROM sudoku_townhall_plays p WHERE p.post_id = t.id)::int AS plays
    FROM sudoku_townhall_posts t
    JOIN sudoku_profiles u ON u.id = t.user_id
    JOIN sudoku_seeds s ON s.id = t.puzzle_id`;

  function postDto(x, me, links) {
    const t = sudokuTitleInfo(x.earned);
    return {
      id: Number(x.id),
      userId: x.user_id,
      name: x.username,
      avatarUrl: links[x.avatar_path] || "",
      title: t.title,
      titleShort: t.titleShort,
      difficulty: x.difficulty,
      seconds: x.poster_seconds,
      prize: x.prize_total,
      prizeEach: x.prize_total / TH_WINNERS,
      prizesLeft: Math.max(0, TH_WINNERS - x.winners),
      plays: x.plays,
      maxPlayers: TH_MAX_PLAYERS,
      endsIn: x.ends,
      mine: x.user_id === me
    };
  }

  // POST /townhall { puzzleId, seconds, amount } -> { postId, palladium }. Pro only, once a day (Riga), once per puzzle.
  router.post("/townhall", sudokuRateLimit(10), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    const puzzleId = Number(req.body?.puzzleId);
    const seconds = Number(req.body?.seconds);
    const amount = Number(req.body?.amount);
    if (!Number.isInteger(puzzleId) || puzzleId <= 0 || !Number.isInteger(seconds) || seconds <= 0) {
      return err(res, 400, "Invalid post", 1);
    }
    if (!TH_AMOUNTS.includes(amount)) return err(res, 400, "Choose 5, 10, 15, 20 or 25 g", 2);
    const client = await pool.connect();
    try {
      if (!(await isPro(me))) return sudokuProApi.proError(res, "Posting to the Town Hall is for PRO players.");
      const solved = await client.query(
        `SELECT time_seconds FROM sudoku_solved_logs WHERE user_id = $1 AND puzzle_id = $2`, [me, puzzleId]
      );
      if (!solved.rowCount) return err(res, 400, "Solve this puzzle first", 4);
      const time = Math.max(seconds, solved.rows[0].time_seconds);
      if (time > TH_MAX_SECONDS) return err(res, 400, "Only puzzles solved in 50 minutes or less can be posted.", 5);

      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(7301)"); // one post at a time (daily limit)
      const today = await client.query(
        `SELECT COUNT(*)::int AS n FROM sudoku_townhall_posts
         WHERE user_id = $1 AND (created_at AT TIME ZONE '${SUDOKU_TZ}')::date = ${TH_TODAY_SQL}`, [me]
      );
      if (today.rows[0].n >= TH_PER_DAY) {
        await client.query("ROLLBACK");
        return err(res, 429, "You can post " + TH_PER_DAY + " times a day. Come back tomorrow!", 6);
      }
      const dup = await client.query(
        `SELECT 1 FROM sudoku_townhall_posts WHERE user_id = $1 AND puzzle_id = $2`, [me, puzzleId]
      );
      if (dup.rowCount) {
        await client.query("ROLLBACK");
        return err(res, 409, "This puzzle is already in the Town Hall.", 7);
      }
      const cost = amount + TH_FEE;
      const paid = await client.query(
        `UPDATE sudoku_profiles SET palladium_grams = palladium_grams - $2
         WHERE id = $1 AND palladium_grams >= $2 RETURNING palladium_grams`, [me, cost]
      );
      if (!paid.rowCount) {
        await client.query("ROLLBACK");
        return err(res, 402, "You need " + cost + " g palladium (" + amount + " g prize + " + TH_FEE + " g fee).", 8);
      }
      await client.query(
        `INSERT INTO sudoku_palladium_spends (user_id, amount, reason, puzzle_id) VALUES ($1, $2, 'townhall', $3)`,
        [me, cost, puzzleId]
      );
      const post = await client.query(
        `INSERT INTO sudoku_townhall_posts (user_id, puzzle_id, poster_seconds, prize_total, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '${TH_DAYS} days') RETURNING id`,
        [me, puzzleId, time, amount]
      );
      await client.query("COMMIT");
      return res.status(200).json({ resStatus: true, postId: Number(post.rows[0].id), palladium: paid.rows[0].palladium_grams });
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (e2) { /* not in a transaction */ }
      return err(res, 500, "Server error", 99);
    } finally {
      client.release();
    }
  });

  // GET /townhall?tab=open|mine -> { posts }. Open: others' live posts you haven't played, random order.
  router.get("/townhall", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    const mine = req.query.tab === "mine";
    try {
      const r = await pool.query(
        mine
          ? `${POST_SELECT} WHERE t.user_id = $1 AND t.expires_at > NOW() AND t.settled = FALSE
             ORDER BY t.created_at DESC LIMIT 30`
          : `${POST_SELECT} WHERE t.user_id <> $1 AND t.expires_at > NOW() AND t.settled = FALSE
               AND NOT EXISTS (SELECT 1 FROM sudoku_townhall_plays p WHERE p.post_id = t.id AND p.user_id = $1)
               AND (SELECT COUNT(*) FROM sudoku_townhall_plays p WHERE p.post_id = t.id) < ${TH_MAX_PLAYERS}
             ORDER BY random() LIMIT 30`,
        [me]
      );
      if (!mine) await pool.query(`UPDATE sudoku_profiles SET townhall_seen_at = NOW() WHERE id = $1`, [me]);
      const links = await sudokuAvatarLinks(r.rows.map(x => x.avatar_path));
      return res.status(200).json({ resStatus: true, posts: r.rows.map(x => postDto(x, me, links)) });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // GET /townhall/new -> { count } posts you could play that appeared since you last opened the Town Hall.
  router.get("/townhall/new", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    try {
      const r = await pool.query(
        `SELECT COUNT(*)::int AS n FROM sudoku_townhall_posts t
         WHERE t.user_id <> $1 AND t.expires_at > NOW() AND t.settled = FALSE
           AND (SELECT COUNT(*) FROM sudoku_townhall_plays p WHERE p.post_id = t.id) < ${TH_MAX_PLAYERS}
           AND t.created_at > COALESCE((SELECT townhall_seen_at FROM sudoku_profiles WHERE id = $1), 'epoch')
           AND NOT EXISTS (SELECT 1 FROM sudoku_townhall_plays p WHERE p.post_id = t.id AND p.user_id = $1)`,
        [me]
      );
      return res.status(200).json({ resStatus: true, count: r.rows[0].n });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // GET /townhall/post/:id -> { post, players, played, alreadySolved, reward }
  router.get("/townhall/post/:id", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return err(res, 404, "This challenge has ended.", 2);
    try {
      const r = await pool.query(`${POST_SELECT} WHERE t.id = $1`, [id]);
      if (!r.rowCount) return err(res, 404, "This challenge has ended.", 2);
      const x = r.rows[0];
      const pl = await pool.query(
        `SELECT p.user_id, u.username AS name, p.seconds, p.won, p.prize, p.finished_at IS NOT NULL AS done
         FROM sudoku_townhall_plays p JOIN sudoku_profiles u ON u.id = p.user_id
         WHERE p.post_id = $1 ORDER BY p.finished_at ASC NULLS LAST, p.accepted_at ASC LIMIT 50`,
        [id]
      );
      const solved = await pool.query(
        `SELECT 1 FROM sudoku_solved_logs WHERE user_id = $1 AND puzzle_id = $2`, [me, x.puzzle_id]
      );
      const links = await sudokuAvatarLinks([x.avatar_path]);
      return res.status(200).json({
        resStatus: true,
        post: postDto(x, me, links),
        players: pl.rows.map(p => ({
          name: p.name, seconds: p.seconds || 0, won: !!p.won, prize: p.prize || 0, playing: !p.done, me: p.user_id === me
        })),
        played: pl.rows.some(p => p.user_id === me),
        alreadySolved: solved.rowCount > 0,
        reward: sudokuChallengeReward(x.difficulty, solved.rowCount > 0)
      });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // POST /townhall/post/:id/accept -> { puzzle, seconds, startedAgo, ... }. Once per player; going back into an
  // unfinished game keeps the clock from the first accept.
  router.post("/townhall/post/:id/accept", sudokuRateLimit(30), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return err(res, 404, "This challenge has ended.", 2);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT t.id, t.user_id, t.puzzle_id, t.poster_seconds, t.prize_total, t.winners, u.username, t.settled,
                GREATEST(0, EXTRACT(EPOCH FROM (t.expires_at - NOW())))::int AS ends,
                (SELECT COUNT(*) FROM sudoku_townhall_plays p WHERE p.post_id = t.id)::int AS plays,
                s.difficulty, s.initial_board, s.solution_board
         FROM sudoku_townhall_posts t
         JOIN sudoku_profiles u ON u.id = t.user_id
         JOIN sudoku_seeds s ON s.id = t.puzzle_id
         WHERE t.id = $1 FOR UPDATE OF t`, [id]
      );
      if (!r.rowCount || r.rows[0].ends <= 0 || r.rows[0].settled) {
        await client.query("ROLLBACK");
        return err(res, 404, "This challenge has ended.", 2);
      }
      const x = r.rows[0];
      if (x.user_id === me) {
        await client.query("ROLLBACK");
        return err(res, 409, "This is your own challenge.", 3);
      }
      const blocked = await client.query(
        `SELECT 1 FROM sudoku_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
        [x.user_id, me]
      );
      if (blocked.rowCount) {
        await client.query("ROLLBACK");
        return err(res, 403, "You can't play this challenge.", 8);
      }
      // Free players: Town Hall for the first 30 days after their first sign-in (sudoku_pro.js)
      if (!(await sudokuProApi.townHallOpen(me))) {
        await client.query("ROLLBACK");
        return sudokuProApi.proError(res, "Free players can play the Town Hall for their first 30 days. PRO players can always play.");
      }
      const play = await client.query(
        `SELECT finished_at IS NOT NULL AS done, EXTRACT(EPOCH FROM (NOW() - accepted_at))::int AS ago
         FROM sudoku_townhall_plays WHERE post_id = $1 AND user_id = $2`, [id, me]
      );
      if (play.rowCount && play.rows[0].done) {
        await client.query("ROLLBACK");
        return err(res, 409, "You already played this challenge.", 4);
      }
      if (!play.rowCount && x.plays >= TH_MAX_PLAYERS) {
        await client.query("ROLLBACK");
        return err(res, 409, "This challenge is full (" + TH_MAX_PLAYERS + " players).", 5);
      }
      let startedAgo = 0;
      if (play.rowCount) {
        startedAgo = play.rows[0].ago;
      } else {
        await client.query(
          `INSERT INTO sudoku_townhall_plays (post_id, user_id, puzzle_id) VALUES ($1, $2, $3)`, [id, me, x.puzzle_id]
        );
        await client.query(
          `INSERT INTO sudoku_puzzle_issues (user_id, puzzle_id, issued_at) VALUES ($1, $2, NOW())
           ON CONFLICT (user_id, puzzle_id) DO UPDATE SET issued_at = NOW()`, [me, x.puzzle_id]
        );
      }
      const solved = await client.query(
        `SELECT 1 FROM sudoku_solved_logs WHERE user_id = $1 AND puzzle_id = $2`, [me, x.puzzle_id]
      );
      await client.query("COMMIT");
      return res.status(200).json({
        resStatus: true,
        postId: Number(x.id),
        senderName: x.username,
        seconds: x.poster_seconds,
        startedAgo: Math.min(startedAgo, SUDOKU_MAX_SOLVE_SEC),
        alreadySolved: solved.rowCount > 0,
        reward: sudokuChallengeReward(x.difficulty, solved.rowCount > 0),
        prizeEach: x.prize_total / TH_WINNERS,
        prizesLeft: Math.max(0, TH_WINNERS - x.winners),
        endsIn: x.ends,
        puzzle: { id: x.puzzle_id, difficulty: x.difficulty, initial: x.initial_board, solution: x.solution_board }
      });
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (e2) { /* not in a transaction */ }
      return err(res, 500, "Server error", 99);
    } finally {
      client.release();
    }
  });

  // Called by /solve inside its transaction. Returns null when this is not an unfinished Town Hall game,
  // else { reward, prize, won }. reward = normal puzzle reward (half when solved before), prize = poster's share.
  async function solve(client, me, puzzleId, seconds, difficulty, first, postId) {
    const p = await client.query(
      `SELECT p.id, t.id AS post_id, t.poster_seconds, t.prize_total, t.winners,
              t.expires_at > NOW() AND t.settled = FALSE AS live
       FROM sudoku_townhall_plays p JOIN sudoku_townhall_posts t ON t.id = p.post_id
       WHERE p.post_id = $1 AND p.user_id = $2 AND p.puzzle_id = $3 AND p.finished_at IS NULL
       FOR UPDATE OF p, t`,
      [postId, me, puzzleId]
    );
    if (!p.rowCount) return null;
    const x = p.rows[0];
    const won = seconds <= x.poster_seconds;
    const reward = sudokuChallengeReward(difficulty, !first);
    let prize = 0;
    if (won && x.live && x.winners < TH_WINNERS) {
      prize = x.prize_total / TH_WINNERS;
      await client.query(
        `UPDATE sudoku_townhall_posts SET winners = winners + 1, prize_paid = prize_paid + $2 WHERE id = $1`,
        [x.post_id, prize]
      );
    }
    await client.query(
      `UPDATE sudoku_townhall_plays SET finished_at = NOW(), seconds = $2, won = $3, reward = $4, prize = $5 WHERE id = $1`,
      [x.id, seconds, won, reward, prize]
    );
    const total = reward + prize;
    await client.query(`UPDATE sudoku_profiles SET palladium_grams = palladium_grams + $2 WHERE id = $1`, [me, total]);
    if (reward > 0) {
      await client.query(
        `INSERT INTO sudoku_palladium_ledger (user_id, amount, source, puzzle_id) VALUES ($1, $2, 'solve', $3)`,
        [me, reward, puzzleId]
      );
    }
    if (prize > 0) {
      await client.query(
        `INSERT INTO sudoku_palladium_ledger (user_id, amount, source, puzzle_id) VALUES ($1, $2, 'solve', $3)`,
        [me, prize, puzzleId]
      );
    }
    if (first) {
      await client.query(
        `UPDATE sudoku_solved_logs SET reward_claimed = TRUE WHERE user_id = $1 AND puzzle_id = $2`, [me, puzzleId]
      );
    }
    return { reward, prize, won };
  }

  // GET /townhall/results -> finished games on my posts + my ended posts (refund), not seen yet.
  router.get("/townhall/results", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    try {
      const plays = await pool.query(
        `SELECT p.id, u.username AS name, p.seconds, p.won, p.prize, t.poster_seconds
         FROM sudoku_townhall_plays p
         JOIN sudoku_townhall_posts t ON t.id = p.post_id
         JOIN sudoku_profiles u ON u.id = p.user_id
         WHERE t.user_id = $1 AND p.finished_at IS NOT NULL AND p.poster_seen = FALSE
         ORDER BY p.finished_at ASC LIMIT 20`, [me]
      );
      const ended = await pool.query(
        `SELECT id, refund, prize_paid, winners FROM sudoku_townhall_posts
         WHERE user_id = $1 AND settled = TRUE AND end_seen = FALSE ORDER BY expires_at ASC LIMIT 10`, [me]
      );
      return res.status(200).json({
        resStatus: true,
        results: plays.rows.map(x => ({
          id: Number(x.id), name: x.name, seconds: x.seconds, senderSeconds: x.poster_seconds, won: x.won, prize: x.prize
        })),
        ended: ended.rows.map(x => ({ id: Number(x.id), refund: x.refund, paid: x.prize_paid, winners: x.winners }))
      });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // POST /townhall/results/seen { upTo, endedUpTo }
  router.post("/townhall/results/seen", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    const upTo = Number(req.body?.upTo) || 0;
    const endedUpTo = Number(req.body?.endedUpTo) || 0;
    try {
      if (upTo > 0) {
        await pool.query(
          `UPDATE sudoku_townhall_plays p SET poster_seen = TRUE FROM sudoku_townhall_posts t
           WHERE t.id = p.post_id AND t.user_id = $1 AND p.id <= $2 AND p.finished_at IS NOT NULL`, [me, upTo]
        );
      }
      if (endedUpTo > 0) {
        await pool.query(
          `UPDATE sudoku_townhall_posts SET end_seen = TRUE WHERE user_id = $1 AND settled = TRUE AND id <= $2`,
          [me, endedUpTo]
        );
      }
      return res.status(200).json({ resStatus: true });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // Ended posts (7 days, or all 20 players finished): unpaid prize back to the poster. Expired Beat me links:
  // the sender's 1 g back. Every 10 minutes.
  async function settle() {
    const client = await pool.connect();
    const touched = [];
    try {
      await client.query("BEGIN");
      const due = await client.query(
        `SELECT t.id, t.user_id, t.prize_total, t.prize_paid, t.winners FROM sudoku_townhall_posts t
         WHERE t.settled = FALSE AND (t.expires_at <= NOW() OR (
           (SELECT COUNT(*) FROM sudoku_townhall_plays p WHERE p.post_id = t.id AND p.finished_at IS NOT NULL) >= ${TH_MAX_PLAYERS}))
         ORDER BY t.id LIMIT 200 FOR UPDATE SKIP LOCKED`
      );
      for (const p of due.rows) {
        const refund = Math.max(0, p.prize_total - p.prize_paid);
        if (refund > 0) {
          await client.query(`UPDATE sudoku_profiles SET palladium_grams = palladium_grams + $2 WHERE id = $1`, [p.user_id, refund]);
          await client.query(
            `INSERT INTO sudoku_palladium_ledger (user_id, amount, source) VALUES ($1, $2, 'other')`, [p.user_id, refund]
          );
        }
        await client.query(`UPDATE sudoku_townhall_posts SET settled = TRUE, refund = $2 WHERE id = $1`, [p.id, refund]);
        touched.push(p.id);
      }
      const links = await client.query(
        `UPDATE sudoku_challenges SET settled = TRUE
         WHERE settled = FALSE AND stake > 0 AND expires_at <= NOW() RETURNING sender_id, stake`
      );
      for (const l of links.rows) await refundLink(client, l.sender_id, l.stake);
      await client.query("COMMIT");
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (e2) { /* ignore */ }
      console.error("Sudoku town hall settle error:", e.message);
    } finally {
      client.release();
    }
    return touched;
  }
  setTimeout(settle, 120 * 1000);
  setInterval(settle, 10 * 60 * 1000);

  // ---------- Beat me link payments ----------
  async function refundLink(client, senderId, stake) {
    await client.query(`UPDATE sudoku_profiles SET palladium_grams = palladium_grams + $2 WHERE id = $1`, [senderId, stake]);
    await client.query(
      `INSERT INTO sudoku_palladium_ledger (user_id, amount, source) VALUES ($1, $2, 'other')`, [senderId, stake]
    );
  }

  // New link: 2 g from the sender; free 1 a day, PRO 3 a day (Riga). -> { linkCode, palladium } or { error, status, code }
  async function createLink(me, puzzleId, seconds) {
    const pro = await isPro(me);
    const LINK_PER_DAY = pro ? LINK_PER_DAY_PRO : LINK_PER_DAY_FREE;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(7302)");
      const today = await client.query(
        `SELECT COUNT(*)::int AS n FROM sudoku_challenges
         WHERE sender_id = $1 AND (created_at AT TIME ZONE '${SUDOKU_TZ}')::date = ${TH_TODAY_SQL}`, [me]
      );
      if (today.rows[0].n >= LINK_PER_DAY) {
        await client.query("ROLLBACK");
        if (!pro) {
          return { error: "Free players can send 1 challenge link a day. PRO players can send 3.", status: 403, code: 77 };
        }
        return { error: "You can send " + LINK_PER_DAY + " challenge links a day. Come back tomorrow!", status: 429, code: 6 };
      }
      const paid = await client.query(
        `UPDATE sudoku_profiles SET palladium_grams = palladium_grams - $2
         WHERE id = $1 AND palladium_grams >= $2 RETURNING palladium_grams`, [me, LINK_STAKE]
      );
      if (!paid.rowCount) {
        await client.query("ROLLBACK");
        return { error: "You need " + LINK_STAKE + " g palladium to send a challenge link.", status: 402, code: 8 };
      }
      await client.query(
        `INSERT INTO sudoku_palladium_spends (user_id, amount, reason, puzzle_id) VALUES ($1, $2, 'beatme', $3)`,
        [me, LINK_STAKE, puzzleId]
      );
      for (let tries = 0; tries < 5; tries++) {
        const linkCode = sudokuChallengeCode();
        const ins = await client.query(
          `INSERT INTO sudoku_challenges (code, sender_id, puzzle_id, sender_seconds, stake, expires_at)
           VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '${SUDOKU_CHALLENGE_DAYS} days')
           ON CONFLICT (code) DO NOTHING RETURNING code`,
          [linkCode, me, puzzleId, seconds, LINK_STAKE]
        );
        if (ins.rowCount) {
          await client.query("COMMIT");
          return { linkCode, palladium: paid.rows[0].palladium_grams };
        }
      }
      await client.query("ROLLBACK");
      return { error: "Server error", status: 500, code: 99 };
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (e2) { /* not in a transaction */ }
      return { error: "Server error", status: 500, code: 99 };
    } finally {
      client.release();
    }
  }

  // Link finished (inside /solve). row = { cid, sender_id, stake, settled }.
  // Won: the stake goes to the receiver (returned, added to their reward). Lost: back to the sender (returns 0).
  async function settleLink(client, row, won) {
    if (row.settled || !row.stake) return 0;
    await client.query(`UPDATE sudoku_challenges SET settled = TRUE WHERE id = $1`, [row.cid]);
    if (won) return row.stake;
    await refundLink(client, row.sender_id, row.stake);
    return 0;
  }

  return { solve, isPro, settle, createLink, settleLink };
};
