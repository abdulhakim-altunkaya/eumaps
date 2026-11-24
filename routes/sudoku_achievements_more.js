// Sudoku Town: 100 more achievements (200 in total). Added to SUDOKU_ACHIEVEMENTS in routes/sudoku.js and
// checked in sudokuAwardAchievements (after a solve, and when the player opens their own profile).
// Groups: more levels / speed / time / days, Sudoku of the Day, Town Hall, Beat me links, titles, palladium,
// friends and messages, invites, PRO and gifts, freeze, weekly race.
// Also GET /achievements/all/:id: every achievement of a player, by group, with progress (the "See all" screen).
// Loaded from routes/sudoku.js: require("./sudoku_achievements_more")({ ...helpers }).

module.exports = function sudokuAchievementsMore(h) {
  const {
    router, sudokuRateLimit, sudokuRequireAuth, sudokuParseUuid,
    pool, SUDOKU_ACHIEVEMENTS, SUDOKU_ACH_BY_CODE, SUDOKU_TITLES, SUDOKU_DIFFICULTIES,
    SUDOKU_LEVEL_NAMES, SUDOKU_LEVEL_ICONS, SUDOKU_TZ
  } = h;

  const SPEED_4 = { easy: 90, medium: 180, hard: 360, ultra_hard: 720 };   // the 4th, fastest speed step
  const plural = (n, one, many) => (n === 1 ? one : many);

  // ── the list (each one: code, title, text, icon, colour) ─────────────────
  const A = [];
  const add = (code, title, text, icon, color) => A.push({ code, title, text, icon, color });

  // levels, speed, time, days
  for (const n of [6000, 8000]) {
    add("solved_" + n, n + " puzzles", "Solve " + n + " puzzles", "trophy", "ink");
  }
  for (const n of [250, 1000, 2000]) {
    for (const d of SUDOKU_DIFFICULTIES) {
      add("level_" + d + "_" + n, SUDOKU_LEVEL_NAMES[d] + " " + n, "Solve " + n + " " + SUDOKU_LEVEL_NAMES[d] + " puzzles",
        SUDOKU_LEVEL_ICONS[d], n >= 1000 ? "ink" : "teal");
    }
  }
  for (const d of SUDOKU_DIFFICULTIES) {
    const min = SPEED_4[d] / 60;
    add("speed_" + d + "_4", SUDOKU_LEVEL_NAMES[d] + " in " + min + " min",
      "Solve " + SUDOKU_LEVEL_NAMES[d] + " in under " + min + " minutes", "bolt", "teal");
  }
  add("time_200", "200 hours", "Solve for 200 hours in total", "clock", "ink");
  add("new_year", "New Year's puzzle", "Solve a puzzle on 1 January", "star", "coral");
  for (const n of [100, 365]) {
    add("days_" + n, n + " days", "Solve puzzles on " + n + " different days", "calendar", n >= 365 ? "ink" : n >= 100 ? "coral" : "teal");
  }

  // Sudoku of the Day
  for (const n of [1, 7, 30, 100, 200, 365]) {
    add("daily_" + n, n === 1 ? "Daily debut" : n + " daily puzzles",
      n === 1 ? "Solve your first Sudoku of the Day" : "Solve " + n + " Sudokus of the Day",
      "daily_sun", n >= 200 ? "ink" : n >= 30 ? "coral" : "sun");
  }
  for (const n of [3, 7, 14, 30, 60, 100]) {
    add("daily_streak_" + n, n + " daily days", "Solve the Sudoku of the Day " + n + " days in a row",
      "flame", n >= 60 ? "ink" : n >= 14 ? "coral" : "sun");
  }
  add("daily_levels", "Full circle", "Solve a Sudoku of the Day of every level", "daily_sun", "teal");
  add("daily_ultra_10", "Ultra daily", "Solve 10 Ultra Hard Sudokus of the Day", "castle", "ink");
  add("daily_early", "First light", "Solve the Sudoku of the Day before 01:00", "hourglass", "teal");
  add("daily_last", "Just in time", "Solve the Sudoku of the Day after 23:50", "hourglass", "coral");
  add("daily_first", "First one in", "Be the first to solve a Sudoku of the Day", "bolt", "coral");
  add("daily_top5", "Top 5 of the day", "Finish a day in the top 5 of the Sudoku of the Day", "trophy", "sun");
  add("daily_fastest_1", "Fastest of the day", "Finish a day as the fastest Sudoku of the Day solver", "crown", "coral");
  add("daily_fastest_10", "Daily champion", "Be the fastest of the day 10 times", "crown", "ink");

  // Town Hall
  for (const n of [1, 10, 50, 100]) {
    add("th_play_" + n, n === 1 ? "Town visitor" : n + " town games",
      n === 1 ? "Play a Town Hall challenge" : "Play " + n + " Town Hall challenges", "church", n >= 50 ? "ink" : "mint");
  }
  for (const n of [1, 10, 25, 50]) {
    add("th_win_" + n, n === 1 ? "Town winner" : n + " town wins",
      n === 1 ? "Win a Town Hall challenge" : "Win " + n + " Town Hall challenges", "trophy", n >= 25 ? "ink" : "coral");
  }
  for (const g of [10, 50, 100]) {
    add("th_prize_" + g, g + " g in prizes", "Win " + g + " g of Town Hall prizes", "palladium", g >= 100 ? "ink" : "teal");
  }
  for (const n of [1, 10, 50]) {
    add("th_post_" + n, n === 1 ? "Town poster" : n + " posts",
      n === 1 ? "Post a challenge to the Town Hall" : "Post " + n + " Town Hall challenges", "church", n >= 50 ? "ink" : "teal");
  }
  add("th_unbeaten", "Unbeaten", "A Town Hall post nobody beat, with 5 or more players", "crown", "ink");
  add("th_generous", "Generous host", "All 5 prizes of your Town Hall post were won", "heart", "coral");

  // Beat me links
  for (const n of [1, 10, 50]) {
    add("link_" + n, n === 1 ? "Challenger" : n + " challenges sent",
      n === 1 ? "Send a Beat me link" : "Send " + n + " Beat me links", "flag", n >= 50 ? "ink" : "sun");
  }
  add("link_played_1", "Accepted!", "Someone played your Beat me link", "friends", "mint");
  add("link_played_10", "Crowd puller", "10 players played your Beat me links", "friends", "teal");
  add("link_defended_10", "Hard to beat", "Keep your time against 10 players", "crown", "coral");
  add("duel_played_10", "Duelist", "Play 10 Beat me links", "bolt", "mint");
  for (const n of [1, 10, 25]) {
    add("duel_win_" + n, n === 1 ? "Beaten!" : n + " duels won",
      n === 1 ? "Beat a friend's time with their link" : "Win " + n + " Beat me links", "bolt", n >= 25 ? "ink" : n >= 10 ? "coral" : "sun");
  }

  // titles
  for (const t of SUDOKU_TITLES) {
    add("title_" + t.code, t.name, "Earn the " + t.name + " title", t.min >= 3000 ? "crown" : "trophy",
      t.min >= 3000 ? "ink" : t.min >= 300 ? "coral" : "teal");
  }

  // palladium, friends, messages, cheers, invites
  for (const g of [1000, 2000, 5000]) {
    add("pd_" + g, g + " g palladium", "Collect " + g + " g of palladium", "palladium", "ink");
  }
  add("friend_100", "100 friends", "Have 100 friends", "friends", "ink");
  add("message_10", "Chatty", "Send 10 messages", "chat", "mint");
  add("message_500", "Pen pal", "Send 500 messages", "chat", "ink");
  add("cheer_100", "Number one fan", "Congratulate 100 achievements", "thumb", "ink");
  add("popular_100", "Superstar", "Get 100 congratulations", "heart", "ink");
  for (const n of [1, 5, 10]) {
    add("invite_" + n, n === 1 ? "Recruiter" : n + " invites",
      n === 1 ? "A new player joined with your invite" : n + " new players joined with your invites",
      "friends", n >= 10 ? "ink" : n >= 5 ? "coral" : "sun");
  }

  // PRO, gifts, freeze
  add("pro_1", "PRO player", "Become a PRO player", "crown", "sun");
  add("gift_1", "Generous", "Gift PRO to another player", "gift", "coral");
  add("gift_got", "Lucky one", "Get PRO as a gift", "gift", "sun");
  add("freeze_1", "Snowman", "Freeze a game", "hourglass", "teal");

  // weekly race
  add("top10_10", "Top 10 regular", "Finish top 10 in your weekly group 10 times", "trophy", "teal");
  add("podium_10", "Podium star", "Finish top 3 ten times", "trophy", "ink");
  add("podium_25", "Podium legend", "Finish top 3 twenty-five times", "trophy", "ink");
  add("champion_10", "Town hero", "Finish #1 ten times", "crown", "ink");
  add("racer_100", "100 races", "Finish 100 weekly races", "flag", "ink");
  add("points_50", "Big week", "Earn 50 race points in one week", "bolt", "coral");
  add("points_100", "Huge week", "Earn 100 race points in one week", "bolt", "ink");

  for (const a of A) {
    if (SUDOKU_ACH_BY_CODE[a.code]) continue;   // never twice
    SUDOKU_ACHIEVEMENTS.push(a);
    SUDOKU_ACH_BY_CODE[a.code] = a;
  }

  // ── checks ───────────────────────────────────────────────────────────────
  // st = the numbers sudokuAwardAchievements already has (per_level, best, secs, day_max, pd, friends, ...)
  async function earned(userId, st) {
    return earnedFrom(st, await extraStats(userId));
  }

  // The numbers only these 100 need
  async function extraStats(userId) {
    const r = await pool.query(
      `WITH l AS (
         SELECT s.difficulty AS d, l.solved_at AT TIME ZONE '${SUDOKU_TZ}' AS at
         FROM sudoku_solved_logs l JOIN sudoku_seeds s ON s.id = l.puzzle_id
         WHERE l.user_id = $1
       ), days AS (
         SELECT DISTINCT at::date AS day FROM l WHERE at IS NOT NULL
       ), dp AS (
         SELECT p.day, d.difficulty, p.finished_at AT TIME ZONE '${SUDOKU_TZ}' AS at
         FROM sudoku_daily_plays p JOIN sudoku_daily d ON d.day = p.day
         WHERE p.user_id = $1 AND p.on_time
       ), ranked AS (
         SELECT p.user_id, p.day,
                RANK() OVER (PARTITION BY p.day ORDER BY p.seconds) AS rk,
                ROW_NUMBER() OVER (PARTITION BY p.day ORDER BY p.finished_at) AS fin
         FROM sudoku_daily_plays p
         WHERE p.on_time AND p.day IN (SELECT day FROM dp)
       ), mine AS (
         SELECT * FROM ranked WHERE user_id = $1
       )
       SELECT
         (SELECT COUNT(*) FROM days)::int AS days,
         EXISTS (SELECT 1 FROM l WHERE EXTRACT(MONTH FROM at) = 1 AND EXTRACT(DAY FROM at) = 1) AS new_year,

         (SELECT COUNT(*) FROM dp)::int AS daily,
         (SELECT COALESCE(MAX(c), 0) FROM (
            SELECT COUNT(*) AS c FROM (SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day))::int AS grp FROM dp) z
            GROUP BY grp) y)::int AS daily_streak,
         (SELECT COUNT(DISTINCT difficulty) FROM dp)::int AS daily_levels,
         (SELECT COUNT(*) FROM dp WHERE difficulty = 'ultra_hard')::int AS daily_ultra,
         EXISTS (SELECT 1 FROM dp WHERE EXTRACT(HOUR FROM at) = 0) AS daily_early,
         EXISTS (SELECT 1 FROM dp WHERE EXTRACT(HOUR FROM at) = 23 AND EXTRACT(MINUTE FROM at) >= 50) AS daily_last,
         EXISTS (SELECT 1 FROM mine WHERE fin = 1) AS daily_first,
         EXISTS (SELECT 1 FROM mine WHERE rk <= 5 AND day < (NOW() AT TIME ZONE '${SUDOKU_TZ}')::date) AS daily_top5,
         (SELECT COUNT(*) FROM mine WHERE rk = 1 AND day < (NOW() AT TIME ZONE '${SUDOKU_TZ}')::date)::int AS daily_fastest,

         (SELECT COUNT(*) FROM sudoku_townhall_plays WHERE user_id = $1 AND finished_at IS NOT NULL)::int AS th_plays,
         (SELECT COUNT(*) FROM sudoku_townhall_plays WHERE user_id = $1 AND won)::int AS th_wins,
         (SELECT COALESCE(SUM(prize), 0) FROM sudoku_townhall_plays WHERE user_id = $1)::int AS th_prize,
         (SELECT COUNT(*) FROM sudoku_townhall_posts WHERE user_id = $1)::int AS th_posts,
         EXISTS (SELECT 1 FROM sudoku_townhall_posts t WHERE t.user_id = $1 AND t.settled AND t.winners = 0
                   AND (SELECT COUNT(*) FROM sudoku_townhall_plays p
                        WHERE p.post_id = t.id AND p.finished_at IS NOT NULL) >= 5) AS th_unbeaten,
         EXISTS (SELECT 1 FROM sudoku_townhall_posts WHERE user_id = $1 AND winners >= 5) AS th_generous,

         (SELECT COUNT(*) FROM sudoku_challenges WHERE sender_id = $1)::int AS links,
         (SELECT COUNT(*) FROM sudoku_challenge_plays p JOIN sudoku_challenges c ON c.id = p.challenge_id
          WHERE c.sender_id = $1 AND p.finished_at IS NOT NULL)::int AS link_played,
         (SELECT COUNT(*) FROM sudoku_challenge_plays p JOIN sudoku_challenges c ON c.id = p.challenge_id
          WHERE c.sender_id = $1 AND p.finished_at IS NOT NULL AND NOT p.won)::int AS link_defended,
         (SELECT COUNT(*) FROM sudoku_challenge_plays WHERE receiver_id = $1 AND finished_at IS NOT NULL)::int AS duels,
         (SELECT COUNT(*) FROM sudoku_challenge_plays WHERE receiver_id = $1 AND won)::int AS duel_wins,

         (SELECT COUNT(*) FROM sudoku_invites WHERE inviter_id = $1)::int AS invites,
         (SELECT is_pro FROM sudoku_profiles WHERE id = $1) AS pro,
         EXISTS (SELECT 1 FROM sudoku_gifts WHERE giver_id = $1) AS gave,
         EXISTS (SELECT 1 FROM sudoku_gifts WHERE receiver_id = $1) AS got,
         (SELECT COUNT(*) FROM sudoku_palladium_spends WHERE user_id = $1 AND reason = 'freeze')::int AS freezes,

         (SELECT COUNT(*) FROM sudoku_week_results WHERE user_id = $1 AND rank <= 10 AND points >= 1)::int AS top10,
         (SELECT COUNT(*) FROM sudoku_week_results WHERE user_id = $1 AND rank <= 3 AND points >= 1)::int AS podiums,
         (SELECT COUNT(*) FROM sudoku_week_results WHERE user_id = $1 AND rank = 1 AND points >= 1)::int AS champions,
         (SELECT COUNT(*) FROM sudoku_week_results WHERE user_id = $1)::int AS races,
         (SELECT COALESCE(MAX(points), 0) FROM sudoku_week_results WHERE user_id = $1)::int AS week_best`,
      [userId]
    );
    return r.rows[0] || {};
  }

  function earnedFrom(st, x) {
    const per = st.per_level || {}, best = st.best || {};
    const secs = Number(st.secs || 0);
    const out = [];
    const ok = (cond, code) => { if (cond) out.push(code); };

    for (const n of [6000, 8000]) ok((st.solved || 0) >= n, "solved_" + n);
    for (const n of [250, 1000, 2000]) for (const d of SUDOKU_DIFFICULTIES) ok((per[d] || 0) >= n, "level_" + d + "_" + n);
    for (const d of SUDOKU_DIFFICULTIES) ok(best[d] != null && best[d] < SPEED_4[d], "speed_" + d + "_4");
    ok(secs >= 200 * 3600, "time_200");
    ok(x.new_year, "new_year");
    for (const n of [100, 365]) ok(x.days >= n, "days_" + n);

    for (const n of [1, 7, 30, 100, 200, 365]) ok(x.daily >= n, "daily_" + n);
    for (const n of [3, 7, 14, 30, 60, 100]) ok(x.daily_streak >= n, "daily_streak_" + n);
    ok(x.daily_levels >= 4, "daily_levels");
    ok(x.daily_ultra >= 10, "daily_ultra_10");
    ok(x.daily_early, "daily_early");
    ok(x.daily_last, "daily_last");
    ok(x.daily_first, "daily_first");
    ok(x.daily_top5, "daily_top5");
    ok(x.daily_fastest >= 1, "daily_fastest_1");
    ok(x.daily_fastest >= 10, "daily_fastest_10");

    for (const n of [1, 10, 50, 100]) ok(x.th_plays >= n, "th_play_" + n);
    for (const n of [1, 10, 25, 50]) ok(x.th_wins >= n, "th_win_" + n);
    for (const g of [10, 50, 100]) ok(x.th_prize >= g, "th_prize_" + g);
    for (const n of [1, 10, 50]) ok(x.th_posts >= n, "th_post_" + n);
    ok(x.th_unbeaten, "th_unbeaten");
    ok(x.th_generous, "th_generous");

    for (const n of [1, 10, 50]) ok(x.links >= n, "link_" + n);
    ok(x.link_played >= 1, "link_played_1");
    ok(x.link_played >= 10, "link_played_10");
    ok(x.link_defended >= 10, "link_defended_10");
    ok(x.duels >= 10, "duel_played_10");
    for (const n of [1, 10, 25]) ok(x.duel_wins >= n, "duel_win_" + n);

    for (const t of SUDOKU_TITLES) ok((st.pd || 0) >= t.min, "title_" + t.code);

    for (const g of [1000, 2000, 5000]) ok((st.pd || 0) >= g, "pd_" + g);
    ok(st.friends >= 100, "friend_100");
    ok(st.messages >= 10, "message_10");
    ok(st.messages >= 500, "message_500");
    ok(st.cheers_given >= 100, "cheer_100");
    ok(st.cheers_got >= 100, "popular_100");
    for (const n of [1, 5, 10]) ok(x.invites >= n, "invite_" + n);

    ok(x.pro === true, "pro_1");
    ok(x.gave, "gift_1");
    ok(x.got, "gift_got");
    ok(x.freezes >= 1, "freeze_1");

    ok(x.top10 >= 10, "top10_10");
    ok(x.podiums >= 10, "podium_10");
    ok(x.podiums >= 25, "podium_25");
    ok(x.champions >= 10, "champion_10");
    ok(x.races >= 100, "racer_100");
    ok(x.week_best >= 50, "points_50");
    ok(x.week_best >= 100, "points_100");
    return out;
  }

  // ── ALL ACHIEVEMENTS SCREEN ────────────────────────────────────────────────
  // The numbers of the first 100 (same as sudokuAwardAchievements), for the progress bars
  async function baseStats(userId) {
    const r = await pool.query(
      `WITH l AS (
         SELECT s.difficulty AS d, l.solved_at AT TIME ZONE '${SUDOKU_TZ}' AS at
         FROM sudoku_solved_logs l JOIN sudoku_seeds s ON s.id = l.puzzle_id
         WHERE l.user_id = $1
       ), days AS (
         SELECT DISTINCT at::date AS day FROM l WHERE at IS NOT NULL
       ), lvl AS (
         SELECT d, COUNT(*)::int AS n FROM l GROUP BY d
       ), seeds AS (
         SELECT difficulty AS d, COUNT(*)::int AS n FROM sudoku_seeds GROUP BY difficulty
       )
       SELECT
         (SELECT COUNT(*) FROM l)::int AS solved,
         (SELECT json_object_agg(d, n) FROM lvl) AS per_level,
         (SELECT json_object_agg(d, n) FROM seeds) AS pool,
         (SELECT COALESCE(SUM(l2.time_seconds), 0) FROM sudoku_solved_logs l2 WHERE l2.user_id = $1)::bigint AS secs,
         (SELECT COALESCE(MAX(c), 0) FROM (SELECT COUNT(*) AS c FROM l GROUP BY at::date) x)::int AS day_max,
         (SELECT COALESCE(MAX(c), 0) FROM (
            SELECT COUNT(*) AS c FROM (SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day))::int AS grp FROM days) z
            GROUP BY grp) y)::int AS streak,
         (SELECT COUNT(*) FROM sudoku_friendships
          WHERE status = 'accepted' AND (user_id = $1 OR friend_id = $1))::int AS friends,
         (SELECT COUNT(*) FROM sudoku_messages WHERE sender_id = $1)::int AS messages,
         (SELECT COUNT(*) FROM sudoku_achievement_cheers WHERE user_id = $1)::int AS cheers_given,
         (SELECT COUNT(*) FROM sudoku_achievement_cheers c JOIN sudoku_achievements a ON a.id = c.achievement_id
          WHERE a.user_id = $1)::int AS cheers_got,
         (SELECT COALESCE(SUM(amount), 0) FROM sudoku_palladium_ledger
          WHERE user_id = $1 AND source IN ('solve', 'race'))::int AS pd`,
      [userId]
    );
    return r.rows[0] || {};
  }

  // [have, need] for a progress bar, or null when it isn't a count (speed, "before 08:00", ...)
  function progress(code, st, x) {
    const per = st.per_level || {}, seeds = st.pool || {};
    let m;
    const n = s => Number(s);
    if ((m = /^solved_(\d+)$/.exec(code))) return [st.solved, n(m[1])];
    if ((m = /^first_(.+)$/.exec(code))) return [per[m[1]] || 0, 1];
    if ((m = /^level_(.+)_(\d+)$/.exec(code))) return [per[m[1]] || 0, n(m[2])];
    if ((m = /^master_(.+)$/.exec(code))) return [per[m[1]] || 0, seeds[m[1]] || 0];
    if (code === "grand_master") {
      return [SUDOKU_DIFFICULTIES.filter(d => (seeds[d] || 0) > 0 && (per[d] || 0) >= seeds[d]).length, SUDOKU_DIFFICULTIES.length];
    }
    if ((m = /^streak_(\d+)$/.exec(code))) return [st.streak, n(m[1])];
    if ((m = /^time_(\d+)$/.exec(code))) return [Math.floor(Number(st.secs || 0) / 3600), n(m[1])];
    if ((m = /^day_(\d+)$/.exec(code))) return [st.day_max, n(m[1])];
    if ((m = /^days_(\d+)$/.exec(code))) return [x.days, n(m[1])];
    if ((m = /^friend_(\d+)$/.exec(code))) return [st.friends, n(m[1])];
    if ((m = /^message_(\d+)$/.exec(code))) return [st.messages, n(m[1])];
    if ((m = /^cheer_(\d+)$/.exec(code))) return [st.cheers_given, n(m[1])];
    if ((m = /^popular_(\d+)$/.exec(code))) return [st.cheers_got, n(m[1])];
    if ((m = /^pd_(\d+)$/.exec(code))) return [st.pd, n(m[1])];
    if ((m = /^title_(.+)$/.exec(code))) {
      const t = SUDOKU_TITLES.find(y => y.code === m[1]);
      return t ? [st.pd, t.min] : null;
    }
    if ((m = /^top10_(\d+)$/.exec(code))) return [x.top10, n(m[1])];
    if ((m = /^podium_(\d+)$/.exec(code))) return [x.podiums, n(m[1])];
    if ((m = /^champion_(\d+)$/.exec(code))) return [x.champions, n(m[1])];
    if ((m = /^racer_(\d+)$/.exec(code))) return [x.races, n(m[1])];
    if ((m = /^points_(\d+)$/.exec(code))) return [x.week_best, n(m[1])];
    if ((m = /^daily_streak_(\d+)$/.exec(code))) return [x.daily_streak, n(m[1])];
    if ((m = /^daily_fastest_(\d+)$/.exec(code))) return [x.daily_fastest, n(m[1])];
    if (code === "daily_levels") return [x.daily_levels, 4];
    if (code === "daily_ultra_10") return [x.daily_ultra, 10];
    if ((m = /^daily_(\d+)$/.exec(code))) return [x.daily, n(m[1])];
    if ((m = /^th_play_(\d+)$/.exec(code))) return [x.th_plays, n(m[1])];
    if ((m = /^th_win_(\d+)$/.exec(code))) return [x.th_wins, n(m[1])];
    if ((m = /^th_prize_(\d+)$/.exec(code))) return [x.th_prize, n(m[1])];
    if ((m = /^th_post_(\d+)$/.exec(code))) return [x.th_posts, n(m[1])];
    if ((m = /^link_played_(\d+)$/.exec(code))) return [x.link_played, n(m[1])];
    if (code === "link_defended_10") return [x.link_defended, 10];
    if (code === "duel_played_10") return [x.duels, 10];
    if ((m = /^duel_win_(\d+)$/.exec(code))) return [x.duel_wins, n(m[1])];
    if ((m = /^link_(\d+)$/.exec(code))) return [x.links, n(m[1])];
    if ((m = /^invite_(\d+)$/.exec(code))) return [x.invites, n(m[1])];
    if (code === "freeze_1") return [x.freezes, 1];
    return null;
  }

  // Group of an achievement (the list is shown in this order)
  const GROUPS = ["Sudoku of the Day", "Puzzles", "Speed", "Days and time", "Town Hall", "Beat me", "Titles",
    "Palladium", "Friends", "Weekly race", "PRO and extras"];
  function groupOf(code) {
    if (/^daily_/.test(code)) return "Sudoku of the Day";
    if (/^(solved_|first_|level_|master_|grand_master)/.test(code)) return "Puzzles";
    if (/^(speed_|patience)/.test(code)) return "Speed";
    if (/^(streak_|time_|day_|days_|all_rounder|early_bird|night_owl|midnight|weekend|comeback|new_year)/.test(code)) {
      return "Days and time";
    }
    if (/^th_/.test(code)) return "Town Hall";
    if (/^(link_|duel_)/.test(code)) return "Beat me";
    if (/^title_/.test(code)) return "Titles";
    if (/^pd_/.test(code)) return "Palladium";
    if (/^(friend_|message_|cheer_|popular_|photo_|name_|invite_)/.test(code)) return "Friends";
    if (/^(top10_|podium_|champion_|racer_|points_)/.test(code)) return "Weekly race";
    return "PRO and extras";
  }

  // GET /achievements/all/:id -> { name, count, total, groups: [{ name, total, earned: [...], locked: [...] }] }
  // earned: like the profile list (date, congratulations) · locked: grey, with have / need when it is a count
  router.get("/achievements/all/:id", sudokuRateLimit(30), sudokuRequireAuth, async (req, res) => {
    const me = req.sudokuUser.id;
    const id = sudokuParseUuid(req.params.id);
    if (!id) return res.status(404).json({ resStatus: false, resMessage: "Player not found", resErrorCode: 1 });
    try {
      const u = await pool.query(`SELECT username, deletion_requested FROM sudoku_profiles WHERE id = $1`, [id]);
      if (!u.rowCount || (u.rows[0].deletion_requested && id !== me)) {
        return res.status(404).json({ resStatus: false, resMessage: "Player not found", resErrorCode: 1 });
      }
      const got = await pool.query(
        `SELECT a.id, a.code, to_char(a.earned_at AT TIME ZONE '${SUDOKU_TZ}', 'FMDD Mon') AS d,
                (SELECT COUNT(*) FROM sudoku_achievement_cheers c WHERE c.achievement_id = a.id)::int AS cheers,
                EXISTS (SELECT 1 FROM sudoku_achievement_cheers c
                        WHERE c.achievement_id = a.id AND c.user_id = $2) AS cheered
         FROM sudoku_achievements a WHERE a.user_id = $1`,
        [id, me]
      );
      const have = new Map(got.rows.map(r => [r.code, r]));
      const st = await baseStats(id);
      const x = await extraStats(id);

      const groups = GROUPS.map(name => ({ name, total: 0, earned: [], locked: [] }));
      const byName = Object.fromEntries(groups.map(g => [g.name, g]));
      let count = 0;
      for (const a of SUDOKU_ACHIEVEMENTS) {
        const g = byName[groupOf(a.code)];
        g.total++;
        const base = { code: a.code, title: a.title, text: a.text, icon: a.icon, color: a.color };
        const e = have.get(a.code);
        if (e) {
          count++;
          g.earned.push({ ...base, id: Number(e.id), date: e.d || "", cheers: e.cheers, cheered: e.cheered });
        } else {
          const p = progress(a.code, st, x);
          g.locked.push({
            ...base, have: p ? Math.max(0, Math.min(Number(p[0]) || 0, p[1])) : 0, need: p ? p[1] : 0
          });
        }
      }
      return res.status(200).json({
        resStatus: true,
        name: u.rows[0].username,
        count,
        total: SUDOKU_ACHIEVEMENTS.length,
        groups: groups.filter(g => g.total > 0)
      });
    } catch (e) {
      return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
    }
  });

  return { earned, count: A.length };
};
