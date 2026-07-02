





// ── AUDIO LIMITS ───────────────────────────────────────────────────────────
const AUDIO_LIMITS = {
  anon: { daily: 1, sizeMB: 20  },
  free: { daily: 1, sizeMB: 25  },
  pro:  { daily: 1, sizeMB: 50 }
};

function getAudioLimits(tier) { return AUDIO_LIMITS[tier] || AUDIO_LIMITS.anon; }

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AUDIO_LIMITS.pro.sizeMB * 1024 * 1024, files: 1 }
});

const audioMultiUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AUDIO_LIMITS.pro.sizeMB * 1024 * 1024, files: 10 }
});

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
  "audio/ogg", "audio/flac", "audio/x-flac", "audio/aac", "audio/mp4",
  "audio/x-m4a", "audio/webm"
];

function isAudio(file) {
  return ALLOWED_AUDIO_TYPES.includes(file.mimetype) ||
    file.originalname.match(/\.(mp3|wav|ogg|flac|aac|m4a|wma|webm)$/i);
}


// ── PDF EDITOR ─────────────────────────────────────────────────────────────
const EDITOR_LIMITS = {
  guest: {
    sizeMB: 3,
    savesPerDay: 1,
    maxAnnotations: 2,
    allowedTypes: ['highlight', 'text'],
    sigDataMaxKB: 400,
    imgMaxKB: 500,
    watermark: true
  },
  free: {
    sizeMB: 3,
    savesPerDay: 1,
    maxAnnotations: 4,
    allowedTypes: ['highlight', 'text', 'pen', 'sticky'],
    sigDataMaxKB: 400,
    imgMaxKB: 500,
    watermark: false
  },
  pro: {
    sizeMB: 20,
    savesPerDay: 5,
    maxAnnotations: 10,
    allowedTypes: ['highlight', 'text', 'pen', 'sticky', 'rectangle', 'circle', 'arrow', 'image', 'signature', 'redact'],
    sigDataMaxKB: 1000,
    imgMaxKB: 1000,
    watermark: false
  }
}

//code block for text tool of pdf editor
const MS_FONTS = '/usr/share/fonts/truetype/msttcorefonts'
const APP_FONTS = path.join(__dirname, 'fonts')
const EDITOR_FONT_FILES = {
  'dm sans':         { regular: path.join(APP_FONTS, 'DMSans-Regular.ttf'),  bold: path.join(APP_FONTS, 'DMSans-Bold.ttf') },
  'arial':           { regular: `${MS_FONTS}/Arial.ttf`,           bold: `${MS_FONTS}/Arial_Bold.ttf` },
  'times new roman': { regular: `${MS_FONTS}/Times_New_Roman.ttf`, bold: `${MS_FONTS}/Times_New_Roman_Bold.ttf` },
  'georgia':         { regular: `${MS_FONTS}/Georgia.ttf`,         bold: `${MS_FONTS}/Georgia_Bold.ttf` },
  'garamond':        { regular: '/usr/share/fonts/opentype/ebgaramond/EBGaramond12-Regular.otf', bold: '/usr/share/fonts/opentype/ebgaramond/EBGaramond12-Bold.otf' },
  'courier new':     { regular: `${MS_FONTS}/Courier_New.ttf`,     bold: `${MS_FONTS}/Courier_New_Bold.ttf` },
  'verdana':         { regular: `${MS_FONTS}/Verdana.ttf`,         bold: `${MS_FONTS}/Verdana_Bold.ttf` },
  'trebuchet ms':    { regular: `${MS_FONTS}/Trebuchet_MS.ttf`,    bold: `${MS_FONTS}/Trebuchet_MS_Bold.ttf` },
  'impact':          { regular: `${MS_FONTS}/Impact.ttf`,          bold: `${MS_FONTS}/Impact.ttf` },
  'dancing script':  { regular: path.join(APP_FONTS, 'DancingScript-Regular.ttf'), bold: path.join(APP_FONTS, 'DancingScript-Regular.ttf') },
  'great vibes':     { regular: path.join(APP_FONTS, 'GreatVibes-Regular.ttf'),    bold: path.join(APP_FONTS, 'GreatVibes-Regular.ttf') },
  'allura':          { regular: path.join(APP_FONTS, 'Allura-Regular.ttf'),        bold: path.join(APP_FONTS, 'Allura-Regular.ttf') },
  'sacramento':      { regular: path.join(APP_FONTS, 'Sacramento-Regular.ttf'),    bold: path.join(APP_FONTS, 'Sacramento-Regular.ttf') },
  'caveat brush':    { regular: path.join(APP_FONTS, 'CaveatBrush-Regular.ttf'),   bold: path.join(APP_FONTS, 'CaveatBrush-Regular.ttf') },
  'pacifico':        { regular: path.join(APP_FONTS, 'Pacifico-Regular.ttf'),      bold: path.join(APP_FONTS, 'Pacifico-Regular.ttf') },
  'zen dots':        { regular: path.join(APP_FONTS, 'ZenDots-Regular.ttf'),       bold: path.join(APP_FONTS, 'ZenDots-Regular.ttf') }
}
function editorFontKey(fontFamily) {
  if (!fontFamily) return null
  const first = String(fontFamily).split(',')[0].replace(/["']/g, '').trim().toLowerCase()
  return EDITOR_FONT_FILES[first] ? first : null
}

const EDITOR_DAILY_SAVES = {
  guest: 1,
  free: 1,
  pro: 20
}

async function checkEditorSaveLimit(userId, ip, tier) {
  const today = new Date().toISOString().slice(0, 10)
  const limit = EDITOR_DAILY_SAVES[tier]
  if (tier === 'anon' || tier === 'guest') {
    const result = await pool.query(
      `SELECT count FROM filebeef_anon_usage WHERE ip = $1 AND date = $2`,
      [ip, today]
    )
    const used = result.rows[0]?.count || 0
    return { allowed: used < limit, used, limit }
  } else {
    const result = await pool.query(
      `SELECT count FROM filebeef_editor_saves WHERE user_id = $1 AND date = $2`,
      [userId, today]
    )
    const used = result.rows[0]?.count || 0
    return { allowed: used < limit, used, limit }
  }
}

async function incrementEditorSaves(userId, ip, tier) {
  const today = new Date().toISOString().slice(0, 10)
  try {
    if (tier === 'anon' || tier === 'guest') {
      await pool.query(
        `INSERT INTO filebeef_anon_usage (ip, date, count)
         VALUES ($1, $2, 1)
         ON CONFLICT (ip, date) DO UPDATE SET count = filebeef_anon_usage.count + 1`,
        [ip, today]
      )
    } else {
      await pool.query(
        `INSERT INTO filebeef_editor_saves (user_id, date, count)
         VALUES ($1, $2, 1)
         ON CONFLICT (user_id, date) DO UPDATE SET count = filebeef_editor_saves.count + 1`,
        [userId, today]
      )
    }
  } catch (_) {}
}

const editorUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: EDITOR_LIMITS.pro.sizeMB * 1024 * 1024, files: 1 }
})


// ══════════════════════════════════════════════════════════════════════════
//  VIDEO & GIF ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════


// ── VIDEO/AUDIO LIMITS ─────────────────────────────────────────────────────
const VIDEO_LIMITS = {
  anon: { daily: 1,  sizeMB: 20  },
  free: { daily: 1,  sizeMB: 25  },
  pro:  { daily: 1,  sizeMB: 50 }
};

function getVideoLimits(tier) { return VIDEO_LIMITS[tier] || VIDEO_LIMITS.anon; }

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_LIMITS.pro.sizeMB * 1024 * 1024, files: 1 }
});

const videoMultiUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_LIMITS.pro.sizeMB * 1024 * 1024, files: 10 }
});



// ══════════════════════════════════════════════════════════════════════════
//  FONT TOOL ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════

const fontUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

// ── FONT LIMITS ────────────────────────────────────────────────────────────
const FONT_LIMITS = {
  anon: { daily: 1, sizeMB: 2 },
  free: { daily: 2, sizeMB: 2 },
  pro:  { daily: 5, sizeMB: 3 }
};

function getFontLimits(tier) {
  return FONT_LIMITS[tier] || FONT_LIMITS.anon;
}



// ══════════════════════════════════════════════════════════════════════════
//  ALL PDF ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════

// ── PDF SIZE LIMITS ────────────────────────────────────────────────────────
const PDF_LIMITS = {
  anon: { daily: 1,  sizeMB: 2 },
  free: { daily: 2,  sizeMB: 3 },
  pro:  { daily: 5,  sizeMB: 20 }
};

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PDF_LIMITS.pro.sizeMB * 1024 * 1024, files: 1 }
});

const pdfMultiUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PDF_LIMITS.pro.sizeMB * 1024 * 1024, files: 20 }
});

function isPdf(file) {
  return file.mimetype === "application/pdf" || file.originalname?.toLowerCase().endsWith(".pdf");
}

function getPdfLimits(tier) {
  return PDF_LIMITS[tier] || PDF_LIMITS.anon;
}



// ══════════════════════════════════════════════════════════════════════════
//  CONVERSION ROUTES
// ══════════════════════════════════════════════════════════════════════════

// ── LIMITS PER TIER ────────────────────────────────────────────────────────
const LIMITS = {
  anon:       { daily: 1,  sizeMB: 5  },
  free:       { daily: 2,  sizeMB: 8 },
  pro:        { daily: 6,  sizeMB: 8 }
};

// ── ALLOWED IMAGE TYPES ────────────────────────────────────────────────────
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg", "image/png", "image/webp",
  "image/avif", "image/gif", "image/heic", "image/heif"
];

// ── MULTER FOR IMAGES ──────────────────────────────────────────────────────
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.pro.sizeMB * 1024 * 1024, files: 1 }
});

// ── OPTIONAL AUTH MIDDLEWARE ───────────────────────────────────────────────
// Does not block — just attaches user if session exists
async function optionalAuth(req, res, next) {
  const token = req.cookies?.filebeef_session;
  req.filebeefUser = null;
  if (!token) return next();
  try {
    const result = await pool.query(
      `SELECT s.user_id, s.expires_at, u.email, u.plan, u.auth_provider,
              u.plan_expires_at, u.stripe_customer_id, u.stripe_sub_id
       FROM filebeef_sessions s
       JOIN filebeef_users u ON u.id = s.user_id
       WHERE s.token = $1 LIMIT 1`,
      [token]
    );
    if (!result.rowCount) return next();
    const session = result.rows[0];
    if (new Date(session.expires_at) < new Date()) return next();
    // auto-downgrade expired pro
    if (session.plan === "pro" && session.plan_expires_at && new Date(session.plan_expires_at) < new Date()) {
      await pool.query(
        `UPDATE filebeef_users SET plan = 'free', sub_status = 'expired' WHERE id = $1`,
        [session.user_id]
      );
      session.plan = "free";
    }
    req.filebeefUser = session;
  } catch (_) {}
  next();
}

// ── TIER RESOLVER ──────────────────────────────────────────────────────────
function getTier(user) {
  if (!user) return "anon";
  if (user.plan === "pro") return "pro";
  return "free";
}

// ── DAILY LIMIT CHECK (all tiers) ─────────────────────────────────────────
async function checkConversionLimit(userId, ip, tier) {
  const limit = LIMITS[tier].daily;
  const today = new Date().toISOString().slice(0, 10);

  if (tier === "anon") {
    const result = await pool.query(
      `SELECT count FROM filebeef_anon_usage WHERE ip = $1 AND date = $2`,
      [ip, today]
    );
    const used = result.rows[0]?.count || 0;
    return { allowed: used < limit, used, limit };
  } else {
    const result = await pool.query(
      `SELECT count FROM filebeef_daily_usage WHERE user_id = $1 AND date = $2`,
      [userId, today]
    );
    const used = result.rows[0]?.count || 0;
    return { allowed: used < limit, used, limit };
  }
}


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

router.post("/api/post/filebeef/image/svg-optimize", optionalAuth, async (req, res) => {
    const user = req.filebeefUser;
    const ip = getClientIp(req);
    const tier = getTier(user);

    // SVG size limits (smaller than images)
    const svgLimits = { anon: 1, free: 2, pro: 5 };
    const sizeLimitMB = svgLimits[tier];

    const svgUpload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: svgLimits.pro * 1024 * 1024, files: 1 }
    }).single("file");..............