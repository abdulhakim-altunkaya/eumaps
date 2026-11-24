// Sudoku Town: SUDOKU OF THE DAY. One puzzle for everyone per Riga day (00:00–24:00), made automatically by the
// first request of the day. Levels go round: Easy → Medium → Hard → Ultra Hard → Easy …
// Solved the same day: Easy 5 g · Medium 6 · Hard 8 · Ultra Hard 12 (over the normal time limit: 2 · 3 · 4 · 6),
// also when the player solved this puzzle before. Solved after midnight: the normal reward.
// One attempt per day; the clock runs from the first start. Paid in /solve ("DAY:<YYYY-MM-DD>").
// Loaded from routes/sudoku.js: require("./sudoku_daily")({ ...helpers }).

module.exports = function sudokuDaily(h) {
  const {
    router, pool, sudokuRateLimit, sudokuRequireAuth, sudokuAvatarLinks, sudokuSolveReward,
    SUDOKU_SLOW_AFTER_SEC, SUDOKU_MAX_SOLVE_SEC, SUDOKU_TZ
  } = h;

  const LEVELS = ["easy", "medium", "hard", "ultra_hard"];
  const FIRST_DAY = Date.UTC(2026, 0, 1);   // the level order counts days from here
  const REWARD = { easy: 5, medium: 6, hard: 8, ultra_hard: 12 };
  const SLOW_REWARD = { easy: 2, medium: 3, hard: 4, ultra_hard: 6 };
  const TOP = 5;
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const err = (res, code, msg, n) => res.status(code).json({ resStatus: false, resMessage: msg, resErrorCode: n });

  const dailyReward = (difficulty, seconds) =>
    seconds <= (SUDOKU_SLOW_AFTER_SEC[difficulty] || Infinity) ? REWARD[difficulty] || 0 : SLOW_REWARD[difficulty] || 0;

  function levelOf(day) {
    const [y, m, d] = day.split("-").map(Number);
    const n = Math.round((Date.UTC(y, m - 1, d) - FIRST_DAY) / 86400000);
    return LEVELS[((n % 4) + 4) % 4];
  }

  // Today's puzzle (made on the first call of the day) + seconds until midnight in Riga
  async function today() {
    const t = (await pool.query(
      `SELECT to_char((NOW() AT TIME ZONE '${SUDOKU_TZ}')::date, 'YYYY-MM-DD') AS day,
              GREATEST(0, EXTRACT(EPOCH FROM (
                (date_trunc('day', NOW() AT TIME ZONE '${SUDOKU_TZ}') + INTERVAL '1 day') AT TIME ZONE '${SUDOKU_TZ}' - NOW()
              )))::int AS ends`
    )).rows[0];
    let d = await pool.query(
      `SELECT d.puzzle_id, d.difficulty, s.initial_board, s.solution_board,
              to_char(d.day, 'FMDy FMDD Mon') AS label, to_char(d.day, 'FMDay FMDD FMMonth') AS full_label
       FROM sudoku_daily d JOIN sudoku_seeds s ON s.id = d.puzzle_id WHERE d.day = $1`,
      [t.day]
    );
    if (!d.rowCount) {
      const level = levelOf(t.day);
      // a puzzle that wasn't a Sudoku of the Day before (any one when all were)
      let p = await pool.query(
        `SELECT id FROM sudoku_seeds s WHERE s.difficulty = $1
           AND NOT EXISTS (SELECT 1 FROM sudoku_daily d WHERE d.puzzle_id = s.id)
         ORDER BY random() LIMIT 1`,
        [level]
      );
      if (!p.rowCount) p = await pool.query(`SELECT id FROM sudoku_seeds WHERE difficulty = $1 ORDER BY random() LIMIT 1`, [level]);
      if (!p.rowCount) return null;
      await pool.query(
        `INSERT INTO sudoku_daily (day, puzzle_id, difficulty) VALUES ($1, $2, $3) ON CONFLICT (day) DO NOTHING`,
        [t.day, p.rows[0].id, level]
      );
      d = await pool.query(
        `SELECT d.puzzle_id, d.difficulty, s.initial_board, s.solution_board,
                to_char(d.day, 'FMDy FMDD Mon') AS label, to_char(d.day, 'FMDay FMDD FMMonth') AS full_label
         FROM sudoku_daily d JOIN sudoku_seeds s ON s.id = d.puzzle_id WHERE d.day = $1`,
        [t.day]
      );
    }
    return { day: t.day, endsIn: t.ends, ...d.rows[0] };
  }

  // GET /daily -> today's Sudoku of the Day for the Town Hall card and popup
  router.get("/daily", sudokuRateLimit(60), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    try {
      const d = await today();
      if (!d) return err(res, 404, "No Sudoku of the Day today", 1);
      const stats = await pool.query(
        `SELECT COUNT(*)::int AS n, MIN(seconds) AS best FROM sudoku_daily_plays WHERE day = $1 AND on_time`,
        [d.day]
      );
      const top = await pool.query(
        `SELECT p.user_id, p.seconds, u.username, u.avatar_path, u.is_pro
         FROM sudoku_daily_plays p JOIN sudoku_profiles u ON u.id = p.user_id
         WHERE p.day = $1 AND p.on_time AND NOT u.deletion_requested
         ORDER BY p.seconds ASC, p.finished_at ASC LIMIT ${TOP}`,
        [d.day]
      );
      const mine = await pool.query(
        `SELECT p.finished_at IS NOT NULL AS done, p.on_time, p.seconds, p.reward,
                (SELECT COUNT(*) FROM sudoku_daily_plays q
                 WHERE q.day = p.day AND q.on_time AND (q.seconds < p.seconds
                   OR (q.seconds = p.seconds AND q.finished_at < p.finished_at)))::int + 1 AS rank
         FROM sudoku_daily_plays p WHERE p.day = $1 AND p.user_id = $2`,
        [d.day, me]
      );
      const m = mine.rows[0];
      const links = await sudokuAvatarLinks(top.rows.map(x => x.avatar_path));
      return res.status(200).json({
        resStatus: true,
        day: d.day,
        label: d.label,
        fullLabel: d.full_label,
        difficulty: d.difficulty,
        reward: REWARD[d.difficulty] || 0,
        slowReward: SLOW_REWARD[d.difficulty] || 0,
        slowAfter: SUDOKU_SLOW_AFTER_SEC[d.difficulty] || 0,
        endsIn: d.endsIn,
        solved: stats.rows[0].n,
        best: stats.rows[0].best || 0,
        started: !!m,
        done: !!(m && m.done),
        mySeconds: m && m.done ? m.seconds : 0,
        myReward: m && m.done ? m.reward : 0,
        myRank: m && m.done && m.on_time ? m.rank : 0,
        players: top.rows.map(x => ({
          name: x.username, avatarUrl: links[x.avatar_path] || "", pro: x.is_pro === true,
          seconds: x.seconds, me: x.user_id === me
        }))
      });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // POST /daily/start -> { day, puzzle, startedAgo, endsIn }. One attempt: going back in keeps the clock running.
  router.post("/daily/start", sudokuRateLimit(30), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    try {
      const d = await today();
      if (!d) return err(res, 404, "No Sudoku of the Day today", 1);
      const play = await pool.query(
        `SELECT finished_at IS NOT NULL AS done, EXTRACT(EPOCH FROM (NOW() - started_at))::int AS ago
         FROM sudoku_daily_plays WHERE day = $1 AND user_id = $2`,
        [d.day, me]
      );
      if (play.rowCount && play.rows[0].done) return err(res, 409, "You already solved today's Sudoku of the Day.", 2);
      let startedAgo = 0;
      if (play.rowCount) {
        startedAgo = play.rows[0].ago;
      } else {
        await pool.query(
          `INSERT INTO sudoku_daily_plays (day, user_id, puzzle_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [d.day, me, d.puzzle_id]
        );
        await pool.query(
          `INSERT INTO sudoku_puzzle_issues (user_id, puzzle_id, issued_at) VALUES ($1, $2, NOW())
           ON CONFLICT (user_id, puzzle_id) DO UPDATE SET issued_at = NOW()`,
          [me, d.puzzle_id]
        );
      }
      return res.status(200).json({
        resStatus: true,
        day: d.day,
        startedAgo: Math.min(startedAgo, SUDOKU_MAX_SOLVE_SEC),
        endsIn: d.endsIn,
        puzzle: { id: d.puzzle_id, difficulty: d.difficulty, initial: d.initial_board, solution: d.solution_board }
      });
    } catch (e) {
      return err(res, 500, "Server error", 99);
    }
  });

  // Called by /solve inside its transaction. null = not an unfinished Sudoku of the Day game, else { reward, onTime }.
  // Pays the reward (ledger 'solve': counts for titles and the weekly race).
  async function solve(client, me, puzzleId, seconds, difficulty, first, day) {
    if (!DAY_RE.test(day || "")) return null;
    const p = await client.query(
      `SELECT p.day, (NOW() AT TIME ZONE '${SUDOKU_TZ}')::date = p.day AS on_time
       FROM sudoku_daily_plays p
       WHERE p.day = $1 AND p.user_id = $2 AND p.puzzle_id = $3 AND p.finished_at IS NULL
       FOR UPDATE`,
      [day, me, puzzleId]
    );
    if (!p.rowCount) return null;
    const onTime = p.rows[0].on_time === true;
    const reward = onTime ? dailyReward(difficulty, seconds) : sudokuSolveReward(difficulty, seconds);
    await client.query(
      `UPDATE sudoku_daily_plays SET finished_at = NOW(), seconds = $3, reward = $4, on_time = $5
       WHERE day = $1 AND user_id = $2`,
      [day, me, seconds, reward, onTime]
    );
    if (reward > 0) {
      await client.query(`UPDATE sudoku_profiles SET palladium_grams = palladium_grams + $2 WHERE id = $1`, [me, reward]);
      await client.query(
        `INSERT INTO sudoku_palladium_ledger (user_id, amount, source, puzzle_id) VALUES ($1, $2, 'solve', $3)`,
        [me, reward, puzzleId]
      );
    }
    if (first) {
      await client.query(
        `UPDATE sudoku_solved_logs SET reward_claimed = TRUE WHERE user_id = $1 AND puzzle_id = $2`, [me, puzzleId]
      );
    }
    return { reward, onTime };
  }

  return { solve };
};
