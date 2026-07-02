



// ── DAILY LIMIT CHECK ──────────────────────────────────────────────────────
async function checkDailyLimit(req, res, next) {
  const user = req.filebeefUser;
  if (user.plan === "pro") return next();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await pool.query(
      `SELECT count FROM filebeef_daily_usage WHERE user_id = $1 AND date = $2`,
      [user.user_id, today]
    );
    const used = result.rows[0]?.count || 0;
    if (used >= FREE_DAILY_LIMIT) {
      return res.status(403).json({
        resStatus: false,
        resMessage: `Daily limit reached (${FREE_DAILY_LIMIT}/day on free plan). Upgrade to Pro for unlimited conversions.`,
        resErrorCode: 403
      });
    }
    next();
  } catch (err) {
    return res.status(500).json({ resStatus: false, resMessage: "Server error", resErrorCode: 99 });
  }
}

// ── LOG USAGE ──────────────────────────────────────────────────────────────
async function logUsage(userId, tool, inputFormat, outputFormat, fileSizeKb, status, ip) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO filebeef_usage (user_id, tool, input_format, output_format, file_size_kb, status, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, tool, inputFormat || null, outputFormat || null, fileSizeKb || null, status, ip]
    );
    await pool.query(
      `INSERT INTO filebeef_daily_usage (user_id, date, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (user_id, date) DO UPDATE SET count = filebeef_daily_usage.count + 1`,
      [userId, today]
    );
  } catch (_) {}
}