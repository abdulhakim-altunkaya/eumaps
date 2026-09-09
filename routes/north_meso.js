const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { pool, supabase, upload } = require("../db");
const useragent = require("useragent");
const axios = require("axios");
const sendEmailBrevo = require("../utils/sendEmailBrevo");
const jwt = require("jsonwebtoken");

const { OAuth2Client } = require("google-auth-library");
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const { 
  extractClientIP,
  blockMaliciousIPs,
  applyReadRateLimit, 
  applyWriteRateLimit,
  enforceAdPostingCooldown,
  checkLogCooldown,
  enforceLoginProtection,
  actionCooldown,
  validateEmail
} = require("../middleware/masters_MW");

//This object is used to prevent one IP address from increasing/bloating 
//the views count of any ad by visiting that page multiple times. We count only true views. 
//Used only by "/post/ad-view" endpoint
const visitCacheLV = {};


//This function for now will be used safely convert image file names to alphanumerical values
// example value: 30/11/2025_111aaa.jpg
function makeSafeName() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const rand = Math.random().toString(36).substring(2, 8); // 6 chars
  return `${dd}${mm}${yyyy}_${rand}`;
}

 

router.post("/api/post/north-meso/entries", blockMaliciousIPs, enforceAdPostingCooldown, applyWriteRateLimit,
  upload.single("image"), async (req, res) => {

  const MIN_IMAGE_SIZE = 2 * 1024;
  const MAX_IMAGE_SIZE = 3 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  const ALLOWED_TYPES = [
    "plants",
    "animals",
    "food-drink",
    "tools",
    "location-town",
    "location-village",
    "location-war",
    "location-palace",
    "location-market",
    "location-religious-site",
    "ethnicities",
    "languages",
    "religions",
    "socio-cultural-practices",
    "socio-cultural-clothes",
    "trading-routes"
  ];

  const ALLOWED_YEAR_TYPES = ["year", "decade", "century", "millennium"];
  const ALLOWED_ERAS = ["BC", "AD"];

  const ipVisitor = req.headers["x-forwarded-for"]
    ? req.headers["x-forwarded-for"].split(",")[0].trim()
    : req.socket.remoteAddress || req.ip;

  let client;
  let formData;

  /* -------------------------------------------
     PARSE JSON FORM DATA
  ------------------------------------------- */
  try {
    formData = JSON.parse(req.body.formData);
  } catch (err) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Invalid form data",
      resErrorCode: 1
    });
  }

  const {
    type,
    yearType,
    year,
    era,
    details,
    source,
    latitude,
    longitude
  } = formData;

  function sanitizeInput(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .trim();
  }

  const cleanDetails = sanitizeInput(details);
  const cleanSource = sanitizeInput(source);

  /* -------------------------------------------
     REQUIRED FIELDS
  ------------------------------------------- */
  if (!type || !yearType || year === undefined || year === null || year === "" || !era || !cleanDetails || !cleanSource) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Required fields are missing",
      resErrorCode: 2
    });
  }

  /* -------------------------------------------
     TYPE VALIDATION
  ------------------------------------------- */
  if (!ALLOWED_TYPES.includes(type)) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Invalid entry type",
      resErrorCode: 3
    });
  }

  /* -------------------------------------------
     DATE VALIDATION
  ------------------------------------------- */
  if (!ALLOWED_YEAR_TYPES.includes(yearType)) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Invalid date type",
      resErrorCode: 4
    });
  }

  if (!ALLOWED_ERAS.includes(era)) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Invalid era",
      resErrorCode: 5
    });
  }

  const numericYear = Number(year);

  if (!Number.isInteger(numericYear) || numericYear < 1 || numericYear > 10000) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Invalid date value",
      resErrorCode: 6
    });
  }

  /* -------------------------------------------
     TEXT VALIDATION
  ------------------------------------------- */
  if (cleanDetails.length < 20 || cleanDetails.length > 5000) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Details must contain between 20 and 5000 characters",
      resErrorCode: 7
    });
  }

  if (cleanSource.length < 5 || cleanSource.length > 2000) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Source must contain between 5 and 2000 characters",
      resErrorCode: 8
    });
  }

  /* -------------------------------------------
     LOCATION VALIDATION
  ------------------------------------------- */
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Invalid coordinates",
      resErrorCode: 9
    });
  }

  if (lat < -90 || lat > 90) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Latitude is outside the valid range",
      resErrorCode: 10
    });
  }

  if (lng < -180 || lng > 180) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Longitude is outside the valid range",
      resErrorCode: 11
    });
  }

  const latRounded = Number(lat.toFixed(6));
  const lngRounded = Number(lng.toFixed(6));
  const locationArray = [latRounded, lngRounded];

  /* -------------------------------------------
     SESSION VALIDATION
  ------------------------------------------- */
  try {
    const auth = req.headers.authorization || "";
    const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    const sessionId = req.cookies?.session_id || bearerSid;

    if (!sessionId) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Please sign in to continue",
        resErrorCode: 12
      });
    }

    const userRes = await pool.query(
      `SELECT google_id FROM north_meso_sessions WHERE session_id = $1 LIMIT 1`,
      [sessionId]
    );

    if (!userRes.rowCount) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Invalid session",
        resErrorCode: 13
      });
    }

    const googleId = userRes.rows[0].google_id;
    let imageUrl = null;

    /* -------------------------------------------
       OPTIONAL IMAGE
    ------------------------------------------- */
    if (req.file) {
      const f = req.file;

      if (!ALLOWED_IMAGE_TYPES.includes(f.mimetype)) {
        return res.status(400).json({
          resStatus: false,
          resMessage: "Invalid image format",
          resErrorCode: 14
        });
      }

      if (f.size < MIN_IMAGE_SIZE) {
        return res.status(400).json({
          resStatus: false,
          resMessage: "Image file is empty or invalid",
          resErrorCode: 15
        });
      }

      if (f.size > MAX_IMAGE_SIZE) {
        return res.status(400).json({
          resStatus: false,
          resMessage: "Image must be smaller than 3 MB",
          resErrorCode: 16
        });
      }

      const fileName = makeSafeName();

      const { error } = await supabase.storage
        .from("north_meso_storage")
        .upload(fileName, f.buffer, {
          contentType: f.mimetype
        });

      if (error) {
        return res.status(503).json({
          resStatus: false,
          resMessage: "Image upload failed",
          resErrorCode: 17
        });
      }

      imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/north_meso_storage/${fileName}`;
    }

    /* -------------------------------------------
       DATABASE INSERT
    ------------------------------------------- */
    try {
      client = await pool.connect();

      const insertQuery = `
        INSERT INTO north_meso_entries
        (
          description,
          type,
          year_type,
          year_value,
          era,
          source,
          ip,
          date,
          image_url,
          update_date,
          google_id,
          is_active,
          created_at,
          views,
          likes_count,
          reviews_count,
          location
        )
        VALUES
        (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17
        )
        RETURNING id
      `;

      const now = new Date();

      const values = [
        cleanDetails,                              // $1 description
        type,                                      // $2 type
        yearType,                                  // $3 year_type
        numericYear,                               // $4 year_value
        era,                                       // $5 era
        cleanSource,                               // $6 source
        ipVisitor,                                 // $7 ip
        now.toISOString().slice(0, 10),            // $8 date
        imageUrl ? JSON.stringify([imageUrl]) : null, // $9 image_url
        now.toISOString(),                         // $10 update_date
        googleId,                                  // $11 google_id
        true,                                      // $12 is_active
        now,                                       // $13 created_at
        0,                                         // $14 views
        0,                                         // $15 likes_count
        0,                                         // $16 reviews_count
        JSON.stringify(locationArray)              // $17 location
      ];

      const result = await client.query(insertQuery, values);

      if (!result.rowCount) {
        return res.status(503).json({
          resStatus: false,
          resMessage: "Data could not be saved",
          resErrorCode: 18
        });
      }

      return res.status(201).json({
        resStatus: true,
        resMessage: "Historical data submitted successfully",
        resData: {
          id: result.rows[0].id
        },
        resOkCode: 1
      });

    } catch (err) {
      console.error("North Meso database insert error:", err);

      return res.status(503).json({
        resStatus: false,
        resMessage: "Data could not be saved",
        resErrorCode: 19
      });

    } finally {
      if (client) {
        client.release();
        client = null;
      }
    }

  } catch (err) {
    console.error("North Meso entry error:", err);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 20
    });
  }
}); //DONE

router.post("/api/post/north-meso/save-visitor", checkLogCooldown(3 * 60 * 1000), async (req, res) => {
  // silently skip if throttled
  if (!req.shouldLogVisit) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Pagaidiet vai izlaists",
      resErrorCode: 1
    });
  }
  const userAgentString = req.get("User-Agent") || "";
  const agent = useragent.parse(userAgentString);
  let client;
  try {
    client = await pool.connect();
    await client.query(
      `
      INSERT INTO visitors_grills_lv (
        ip,
        op,
        browser,
        date
      ) VALUES ($1, $2, $3, $4)
      `,
      [
        req.clientIp,
        agent.os.toString(),
        agent.toAgent(),
        new Date().toLocaleDateString("en-GB")
      ]
    );
    return res.status(200).json({
      resStatus: true,
      resMessage: "Apmeklētāja reģistrācija veiksmīga",
      resOkCode: 1
    });
  } catch (err) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Apmeklētāja reģistrācija neizdevās – iekšēja kļūda",
      resErrorCode: 2
    });
  } finally {
    if (client) client.release();
  }
});
router.put("/api/put/north-meso/update-entry/:id", blockMaliciousIPs, enforceAdPostingCooldown, applyWriteRateLimit,
  upload.single("image"), async (req, res) => {

  const entryId = Number(req.params.id);
  const MIN_IMAGE_SIZE = 2 * 1024;
  const MAX_IMAGE_SIZE = 3 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const ALLOWED_TYPES = [
    "plants", "animals", "food-drink", "tools", "location-town", "location-village",
    "location-war", "location-palace", "location-market", "location-religious-site",
    "ethnicities", "languages", "religions", "socio-cultural-practices",
    "socio-cultural-clothes", "trading-routes"
  ];
  const ALLOWED_YEAR_TYPES = ["year", "decade", "century", "millennium"];
  const ALLOWED_ERAS = ["BC", "AD"];

  if (!Number.isInteger(entryId) || entryId < 1) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Invalid entry ID",
      resErrorCode: 1
    });
  }

  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;

  if (!sessionId) {
    return res.status(401).json({
      resStatus: false,
      resMessage: "Please sign in to continue",
      resErrorCode: 2
    });
  }

  try {
    const userQ = await pool.query(
      `SELECT google_id FROM north_meso_sessions WHERE session_id = $1 LIMIT 1`,
      [sessionId]
    );

    if (!userQ.rowCount) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Invalid session",
        resErrorCode: 3
      });
    }

    const googleId = userQ.rows[0].google_id;

    const entryQ = await pool.query(
      `SELECT image_url, google_id FROM north_meso_entries WHERE id = $1 LIMIT 1`,
      [entryId]
    );

    if (!entryQ.rowCount) {
      return res.status(404).json({
        resStatus: false,
        resMessage: "Entry does not exist",
        resErrorCode: 4
      });
    }

    if (entryQ.rows[0].google_id !== googleId) {
      return res.status(403).json({
        resStatus: false,
        resMessage: "You cannot update this entry",
        resErrorCode: 5
      });
    }

    let formData;

    try {
      formData = JSON.parse(req.body.formData);
    } catch {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Invalid form data",
        resErrorCode: 6
      });
    }

    const {
      type,
      yearType,
      year,
      era,
      details,
      source,
      latitude,
      longitude,
      existingImage
    } = formData;

    function sanitizeInput(str) {
      if (typeof str !== "string") return "";
      return str.replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();
    }

    const cleanDetails = sanitizeInput(details);
    const cleanSource = sanitizeInput(source);

    if (!type || !yearType || year === undefined || year === null || year === "" || !era || !cleanDetails || !cleanSource) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Required fields are missing",
        resErrorCode: 7
      });
    }

    if (!ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Invalid entry type",
        resErrorCode: 8
      });
    }

    if (!ALLOWED_YEAR_TYPES.includes(yearType)) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Invalid date type",
        resErrorCode: 9
      });
    }

    if (!ALLOWED_ERAS.includes(era)) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Invalid era",
        resErrorCode: 10
      });
    }

    const numericYear = Number(year);

    if (!Number.isInteger(numericYear) || numericYear < 1 || numericYear > 10000) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Invalid date value",
        resErrorCode: 11
      });
    }

    if (cleanDetails.length < 20 || cleanDetails.length > 5000) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Details must contain between 20 and 5000 characters",
        resErrorCode: 12
      });
    }

    if (cleanSource.length < 5 || cleanSource.length > 2000) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Source must contain between 5 and 2000 characters",
        resErrorCode: 13
      });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Invalid coordinates",
        resErrorCode: 14
      });
    }

    if (lat < -90 || lat > 90) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Latitude is outside the valid range",
        resErrorCode: 15
      });
    }

    if (lng < -180 || lng > 180) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Longitude is outside the valid range",
        resErrorCode: 16
      });
    }

    const locationArray = [
      Number(lat.toFixed(6)),
      Number(lng.toFixed(6))
    ];

    let finalImageUrl = null;

    if (typeof existingImage === "string" && existingImage.trim()) {
      finalImageUrl = existingImage.trim();
    }

    if (req.file) {
      const f = req.file;

      if (!ALLOWED_IMAGE_TYPES.includes(f.mimetype)) {
        return res.status(400).json({
          resStatus: false,
          resMessage: "Invalid image format",
          resErrorCode: 17
        });
      }

      if (f.size < MIN_IMAGE_SIZE) {
        return res.status(400).json({
          resStatus: false,
          resMessage: "Image file is empty or invalid",
          resErrorCode: 18
        });
      }

      if (f.size > MAX_IMAGE_SIZE) {
        return res.status(400).json({
          resStatus: false,
          resMessage: "Image must be smaller than 3 MB",
          resErrorCode: 19
        });
      }

      const fileName = makeSafeName();

      const { error } = await supabase.storage
        .from("north_meso_storage")
        .upload(fileName, f.buffer, {
          contentType: f.mimetype
        });

      if (error) {
        return res.status(503).json({
          resStatus: false,
          resMessage: "Image upload failed",
          resErrorCode: 20
        });
      }

      finalImageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/north_meso_storage/${fileName}`;
    }

    const updateQ = `
      UPDATE north_meso_entries
      SET
        description = $1,
        type = $2,
        year_type = $3,
        year_value = $4,
        era = $5,
        source = $6,
        location = $7,
        image_url = $8,
        update_date = $9
      WHERE id = $10
        AND google_id = $11
      RETURNING id
    `;

    const result = await pool.query(updateQ, [
      cleanDetails,
      type,
      yearType,
      numericYear,
      era,
      cleanSource,
      JSON.stringify(locationArray),
      finalImageUrl ? JSON.stringify([finalImageUrl]) : null,
      new Date().toISOString(),
      entryId,
      googleId
    ]);

    if (!result.rowCount) {
      return res.status(503).json({
        resStatus: false,
        resMessage: "Entry could not be updated",
        resErrorCode: 21
      });
    }

    return res.status(200).json({
      resStatus: true,
      resMessage: "Entry updated successfully",
      resOkCode: 1
    });

  } catch (err) {
    console.error("North Meso update entry error:", err);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 22
    });
  }
}); //DONE
// GOOGLE AUTH SESSION
async function createSessionForUser(dbGoogleId) {
  const sessionId = crypto.randomUUID();

  await pool.query(
    `INSERT INTO north_meso_sessions (session_id, google_id) VALUES ($1, $2)`,
    [sessionId, dbGoogleId]
  );

  return sessionId;
} //DONE
router.post("/api/post/north-meso/auth/google", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const ipVisitor = req.headers["x-forwarded-for"]
    ? req.headers["x-forwarded-for"].split(",")[0].trim()
    : req.socket.remoteAddress || req.ip;

  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Google token is missing",
      resErrorCode: 1
    });
  }

  let client;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const googleId = payload?.sub;
    const email = payload?.email;
    const name = payload?.name || "";
    const profileImg = payload?.picture || null;

    if (!googleId || !email) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Invalid Google account data",
        resErrorCode: 2
      });
    }

    client = await pool.connect();

    const query = `
      INSERT INTO north_meso_users
      (
        google_id,
        email,
        name,
        date,
        ip,
        profile_img,
        number_entries
      )
      VALUES ($1, $2, $3, $4, $5, $6, 0)

      ON CONFLICT (google_id)
      DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        profile_img = EXCLUDED.profile_img

      RETURNING
        google_id,
        email,
        name,
        profile_img,
        number_entries;
    `;

    const values = [
      googleId,
      email,
      name,
      new Date().toISOString().slice(0, 10),
      ipVisitor,
      profileImg
    ];

    const result = await client.query(query, values);
    const user = result.rows[0];

    const sessionId = await createSessionForUser(user.google_id);

    res.cookie("session_id", sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 1000 * 60 * 60 * 24 * 365
    });

    return res.status(200).json({
      resStatus: true,
      resMessage: "User authenticated",
      resOkCode: 1,
      user: {
        google_id: user.google_id,
        email: user.email,
        name: user.name,
        profile_img: user.profile_img,
        number_entries: user.number_entries ?? 0,
        session_id: sessionId
      }
    });

  } catch (error) {
    console.error("North Meso Google auth error:", error);

    if (
      error?.message?.includes("Invalid") ||
      error?.message?.includes("JWT") ||
      error?.message?.includes("Token")
    ) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Invalid Google token",
        resErrorCode: 3
      });
    }

    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 4
    });

  } finally {
    if (client) client.release();
  }
}); //DONE
router.post("/api/post/north-meso/logout", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;

  try {
    if (sessionId) {
      await pool.query(
        `DELETE FROM north_meso_sessions WHERE session_id = $1`,
        [sessionId]
      );
    }

    res.clearCookie("session_id", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/"
    });

    return res.status(200).json({
      resStatus: true,
      resMessage: "Logged out",
      resOkCode: 1
    });
  } catch (error) {
    console.error("North Meso logout error:", error);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 1
    });
  }
});//DONE
router.post("/api/post/north-meso/toggle-activation/:id", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const adId = req.params.id;
  try {
    // Check if ad exists
    const check = await pool.query(
      `SELECT is_active, google_id
       FROM grills_lv_ads
       WHERE id = $1
       LIMIT 1;`,
      [adId]
    );
    if (!check.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Vieta nav atrasta",
        resErrorCode: 1
      });
    }
    const current = check.rows[0].is_active;
    const googleId = check.rows[0].google_id;
    const newState = !current;
    // Update activation state
    const update = await pool.query(
      `UPDATE grills_lv_ads
       SET is_active = $1,
           created_at = NOW()
       WHERE id = $2
       RETURNING id;`,
      [newState, adId]
    );
    if (!update.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Neizdevās atjaunināt vietas statusu",
        resErrorCode: 2
      });
    }
    await pool.query(
      `UPDATE grills_lv_users
       SET number_ads = GREATEST(
         number_ads + $1,
         0
       )
       WHERE google_id = $2`,
      [newState ? 1 : -1, googleId]
    );
    return res.status(200).json({
      resStatus: true,
      resMessage: newState ? "Aktivizēts" : "Deaktivizēts",
      resOkCode: 1,
      is_active: newState
    });
  } catch (err) {
    return res.status(500).json({
      resStatus: false,
      resMessage: "Servera kļūda",
      resErrorCode: 3
    });
  }
});
router.post("/api/post/north-meso/delete-ad/:id", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const adId = req.params.id;
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  if (!sessionId) {
    return res.status(401).json({
      resStatus: false,
      resMessage: "Nav aktīvas sesijas",
      resErrorCode: 1
    });
  }
  try {
    /* ---------- SESSION VALIDATION ---------- */
    const sessionRes = await pool.query(
      `
      SELECT google_id
      FROM grills_lv_sessions
      WHERE session_id = $1
      LIMIT 1;
      `,
      [sessionId]
    );

    if (!sessionRes.rowCount) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Nav aktīvas sesijas",
        resErrorCode: 2
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    /* ---------- VERIFY OWNERSHIP + GET IMAGES ---------- */
    const adRes = await pool.query(
      `
      SELECT image_url
      FROM grills_lv_ads
      WHERE id = $1 AND google_id = $2
      LIMIT 1;
      `,
      [adId, googleId]
    );

    if (!adRes.rowCount) {
      return res.status(403).json({
        resStatus: false,
        resMessage: "Nav atļauts dzēst šo vietu",
        resErrorCode: 3
      });
    }
    /* ---------- PARSE IMAGES ---------- */
    let images = [];
    try {
      images = Array.isArray(adRes.rows[0].image_url)
        ? adRes.rows[0].image_url
        : JSON.parse(adRes.rows[0].image_url);
    } catch {
      images = [];
    }
    const filesToDelete = images
      .map(url => url.split("/").pop())
      .filter(Boolean);
    /* ---------- DB TRANSACTION ---------- */
    await pool.query("BEGIN");
    // Hard delete ALL reviews + replies
    await pool.query(
      `DELETE FROM grills_lv_reviews WHERE ad_id = $1;`,
      [adId]
    );
    // Hard delete ad
    await pool.query(
      `DELETE FROM grills_lv_ads WHERE id = $1;`,
      [adId]
    );
    await pool.query(
      `UPDATE grills_lv_users
      SET number_ads = GREATEST(number_ads - 1, 0)
      WHERE google_id = $1`,
      [googleId]
    );
    await pool.query("COMMIT");
    /* ---------- DELETE IMAGES (NON-BLOCKING) ---------- */
    if (filesToDelete.length > 0) {
      const { error } = await supabase.storage
        .from("masters_latvia_storage")
        .remove(filesToDelete);
      if (error) {
        console.error("Supabase delete error:", error);
      }
    }

    return res.json({
      resStatus: true,
      resMessage: "Vieta un atsauksmes dzēstas",
      resOkCode: 1
    });

  } catch (err) {
    await pool.query("ROLLBACK");
    return res.status(500).json({
      resStatus: false,
      resMessage: "Servera kļūda",
      resErrorCode: 4
    });
  }
});
router.post("/api/post/north-meso/ad-view", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const { ad_id } = req.body;

  if (!ad_id) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Trūkst vietas ID"
    });
  }

  let ipVisitor =
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket.remoteAddress ||
    req.ip;

  if (ipVisitor.startsWith("::ffff:")) ipVisitor = ipVisitor.replace("::ffff:", "");
  if (ipVisitor === "::1") ipVisitor = "127.0.0.1";

  const now = Date.now();
  const COOLDOWN = 60 * 1000;

  if (!visitCacheLV[ipVisitor]) visitCacheLV[ipVisitor] = {};
  if (!visitCacheLV[ipVisitor][ad_id]) visitCacheLV[ipVisitor][ad_id] = 0;

  const lastView = visitCacheLV[ipVisitor][ad_id];

  if (now - lastView < COOLDOWN) {
    return res.json({
      resStatus: true,
      resOkCode: 2,
      resMessage: "Skatījums ignorēts (gaidīšanas laiks)"
    });
  }

  visitCacheLV[ipVisitor][ad_id] = now;

  try {
    await pool.query(
      "UPDATE grills_lv_ads SET views = views + 1 WHERE id = $1",
      [ad_id]
    );

    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Skatījums reģistrēts"
    });

  } catch (err) {
    return res.json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Datu bāzes kļūda"
    });
  }
});
router.post("/api/post/north-meso/review", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  const reviewer_name = req.body.reviewer_name.trim();
  const review_text   = req.body.review_text.trim();
  const adId = req.body.adId;
  const rating = Number(req.body.rating);

  function sanitizeInput(str) {
    if (typeof str !== 'string') return '';
    return str
      // 1. Convert < and > into safe text versions so they don't execute
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // 2. Remove invisible control characters (keep Newlines and Tabs if you want)
  }
  const cleanReviewText = sanitizeInput(review_text);
  const cleanReviewName = sanitizeInput(reviewer_name);


  if (!sessionId || reviewer_name.length < 5 || review_text.length < 5 || !adId ) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Nederīgi vai trūkstoši lauki"
    });
  }
  if (rating < 0 || rating > 10) {
    return res.json({
      resStatus: false,
      resErrorCode: 6,
      resMessage: "Nederīga vērtējuma vērtība"
    });
  }
  try {
    /* ---------- SESSION LOOKUP ---------- */
    const sessionResult = await pool.query(
      `
      SELECT google_id
      FROM grills_lv_sessions
      WHERE session_id = $1
      LIMIT 1
      `,
      [sessionId]
    );
    if (!sessionResult.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Nederīga sesija"
      });
    }
    const reviewer_google_id = sessionResult.rows[0].google_id;

    /* ---------- BLOCK SELF-REVIEW ---------- */
    const adOwnerCheck = await pool.query(
      `SELECT google_id FROM grills_lv_ads WHERE id = $1 LIMIT 1`,
      [adId]
    );
    // If the ad exists and the owner is the same as the reviewer
    if (adOwnerCheck.rows[0]?.google_id === reviewer_google_id) {
      return res.json({
        resStatus: false,
        resErrorCode: 7, // New error code for self-review
        resMessage: "Jūs nevarat vērtēt savu vietu"
      });
    }

    /* ---------- BLOCK DUPLICATE ACTIVE REVIEW ---------- */
    const activeReviewCheck = await pool.query(
      `
      SELECT 1
      FROM grills_lv_reviews
      WHERE ad_id = $1
        AND reviewer_id = $2
        AND parent IS NULL
        AND is_deleted = false
      LIMIT 1
      `,
      [adId, reviewer_google_id]
    );
    if (activeReviewCheck.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "Jūs jau esat atstājis atsauksmi par šo vietu"
      });
    }
    /* ---------- BLOCK RE-POST AFTER SOFT DELETE ---------- */
    const deletedWithReplyCheck = await pool.query(
      `
      SELECT 1
      FROM grills_lv_reviews
      WHERE ad_id = $1
        AND reviewer_id = $2
        AND parent IS NULL
        AND is_deleted = true
      LIMIT 1
      `,
      [adId, reviewer_google_id]
    );
    if (deletedWithReplyCheck.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 4,
        resMessage:
          "Jūs nevarat pievienot citu atsauksmi šai vietai pēc īpašnieka atbildes"
      });
    }
    /* ---------- DATE ---------- */
    const now = new Date();
    const dateStr =
      String(now.getDate()).padStart(2, "0") + "/" +
      String(now.getMonth() + 1).padStart(2, "0") + "/" +
      now.getFullYear();

    /* ---------- INSERT REVIEW ---------- */
    const insertReviewResult = await pool.query(
      `
      INSERT INTO grills_lv_reviews
      (reviewer_name, review_text, date, reviewer_id, ad_id, parent, rating)
      VALUES ($1, $2, $3, $4, $5, NULL, $6)
      RETURNING id
      `,
      [
        cleanReviewName,
        cleanReviewText,
        dateStr,
        reviewer_google_id,
        adId,
        rating
      ]
    );
    /* ---------- RECALCULATE AD STATS ---------- */
    await pool.query(
      `
      UPDATE grills_lv_ads
      SET
        average_rating = COALESCE(sub.avg, 0),
        reviews_count  = COALESCE(sub.cnt, 0)
      FROM (
        SELECT
          ROUND(AVG(rating), 1) AS avg,
          COUNT(*) AS cnt
        FROM grills_lv_reviews
        WHERE ad_id = $1
          AND is_deleted = false
          AND parent IS NULL
      ) sub
      WHERE id = $1;
      `,
      [adId]
    );
    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Atsauksme saglabāta",
      review_id: insertReviewResult.rows[0].id
    });
  } catch (error) {
    console.error("Post review error:", error);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 99,
      resMessage: "Servera kļūda"
    });
  }
});
router.post("/api/post/north-meso/reply", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  const { review_text, adId, parent } = req.body;
  function sanitizeInput(str) {
    if (typeof str !== 'string') return '';
    return str
      // 1. Convert < and > into safe text versions so they don't execute
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // 2. Remove invisible control characters (keep Newlines and Tabs if you want)
  }
  const cleanReviewText = sanitizeInput(review_text);
  if (!sessionId || !review_text || !adId || !parent) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Trūkst lauku"
    });
  }
  try {
    // 1️⃣ get google_id from session
    const sessionQ = `
      SELECT google_id
      FROM grills_lv_sessions
      WHERE session_id = $1
      LIMIT 1
    `;
    const sessionR = await pool.query(sessionQ, [sessionId]);
    if (!sessionR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Nederīga sesija"
      });
    }
    const ownerGoogleId = sessionR.rows[0].google_id;
    // 2️⃣ verify owner owns this ad
    const adQ = `
      SELECT google_id
      FROM grills_lv_ads
      WHERE id = $1
      LIMIT 1
    `;
    const adR = await pool.query(adQ, [adId]);
    if (!adR.rowCount || String(adR.rows[0].google_id) !== String(ownerGoogleId)) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "Nav jūsu ieraksts"
      });
    }
    // 3️⃣ format date
    const now = new Date();
    const dateStr =
      String(now.getDate()).padStart(2, "0") + "/" +
      String(now.getMonth() + 1).padStart(2, "0") + "/" +
      now.getFullYear();
    // 4️⃣ insert reply
    const insertQ = `
      INSERT INTO grills_lv_reviews
      (reviewer_name, review_text, date, reviewer_id, ad_id, parent, rating)
      VALUES ('Owner', $1, $2, $3, $4, $5, NULL)
      RETURNING id
    `;
    const r = await pool.query(insertQ, [
      cleanReviewText,
      dateStr,
      ownerGoogleId, // reviewer_id = owner google_id
      adId,
      parent
    ]);
    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Atbilde saglabāta",
      reply_id: r.rows[0].id
    });
  } catch (err) {
    console.error("Reply error:", err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 4,
      resMessage: "Servera kļūda"
    });
  }
});
router.post("/api/post/north-meso/delete-reply", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  const { replyId, adId } = req.body;

  if (!sessionId || !replyId || !adId) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Trūkst lauku"
    });
  }

  try {
    // 1️⃣ get google_id from session
    const sessionQ = `
      SELECT google_id
      FROM grills_lv_sessions
      WHERE session_id = $1
      LIMIT 1
    `;
    const sessionR = await pool.query(sessionQ, [sessionId]);
    if (!sessionR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Nederīga sesija"
      });
    }

    const ownerGoogleId = sessionR.rows[0].google_id;

    // 2️⃣ verify ad ownership
    const adQ = `
      SELECT google_id
      FROM grills_lv_ads
      WHERE id = $1
      LIMIT 1
    `;
    const adR = await pool.query(adQ, [adId]);

    if (!adR.rowCount || String(adR.rows[0].google_id) !== String(ownerGoogleId)) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "Nav jūsu ieraksts"
      });
    }

    // 3️⃣ verify reply belongs to this ad + owner + is a reply
    const replyQ = `
      SELECT id
      FROM grills_lv_reviews
      WHERE id = $1
        AND ad_id = $2
        AND parent IS NOT NULL
        AND reviewer_id = $3
      LIMIT 1
    `;
    const replyR = await pool.query(replyQ, [
      replyId,
      adId,
      ownerGoogleId
    ]);

    if (!replyR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 4,
        resMessage: "Atbilde nav atrasta vai nav atļauts"
      });
    }

    // 4️⃣ delete reply
    const deleteQ = `
      DELETE FROM grills_lv_reviews
      WHERE id = $1
    `;
    await pool.query(deleteQ, [replyId]);

    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Atbilde dzēsta"
    });

  } catch (err) {
    console.error("Delete reply error:", err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 5,
      resMessage: "Servera kļūda"
    });
  }
});

router.post("/api/post/north-meso/like", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  const { ad_id } = req.body;

  if (!sessionId || !ad_id) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Nav aktīvas sesijas"
    });
  }

  try {
    // ---------------------------------------
    // 1) GET LIKER GOOGLE ID (FROM SESSION)
    // ---------------------------------------
    const sessionQ = `
      SELECT google_id
      FROM grills_lv_sessions
      WHERE session_id = $1
      LIMIT 1
    `;
    const sessionR = await pool.query(sessionQ, [sessionId]);

    if (!sessionR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Nederīga sesija"
      });
    }
    const liker_google_id = sessionR.rows[0].google_id;
    // ---------------------------------------
    // 2) GET AD OWNER GOOGLE ID
    // ---------------------------------------
    const adQ = `
      SELECT google_id
      FROM grills_lv_ads
      WHERE id = $1
      LIMIT 1
    `;
    const adR = await pool.query(adQ, [ad_id]);

    if (!adR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "Vieta nav atrasta"
      });
    }
    const user_google_id = adR.rows[0].google_id;
    // ---------------------------------------
    // 3) CHECK EXISTING LIKE ROW
    // ---------------------------------------
    const selectQ = `
      SELECT id, likers
      FROM grills_lv_likes
      WHERE ad_id = $1
      LIMIT 1
    `;
    const selectR = await pool.query(selectQ, [ad_id]);
    // ---------------------------------------
    // CASE A: ROW EXISTS
    // ---------------------------------------
    if (selectR.rowCount) {
      const row = selectR.rows[0];
      let likers = row.likers || [];
      if (typeof likers === "string") {
        likers = JSON.parse(likers);
      }
      const alreadyLiked = likers.includes(liker_google_id);
      // REMOVE LIKE
      if (alreadyLiked) {
        likers = likers.filter(id => id !== liker_google_id);

        if (!likers.length) {
          await pool.query(
            `DELETE FROM grills_lv_likes WHERE id = $1`,
            [row.id]
          );
          return res.json({
            resStatus: true,
            resOkCode: 3,
            resMessage: "Patika dzēsta"
          });
        }
        await pool.query(
          `UPDATE grills_lv_likes SET likers = $1 WHERE id = $2`,
          [JSON.stringify(likers), row.id]
        );
        return res.json({
          resStatus: true,
          resOkCode: 4,
          resMessage: "Patika dzēsta"
        });
      }
      // ADD LIKE
      likers.push(liker_google_id);
      await pool.query(
        `UPDATE grills_lv_likes SET likers = $1 WHERE id = $2`,
        [JSON.stringify(likers), row.id]
      );

      return res.json({
        resStatus: true,
        resOkCode: 1,
        resMessage: "Patika saglabāta"
      });
    }
    // ---------------------------------------
    // CASE B: NO ROW → CREATE NEW
    // ---------------------------------------
    const insertQ = `
      INSERT INTO grills_lv_likes (ad_id, master_id, likers)
      VALUES ($1, $2, $3)
    `;
    await pool.query(insertQ, [
      ad_id,
      user_google_id,
      JSON.stringify([liker_google_id])
    ]);

    return res.json({
      resStatus: true,
      resOkCode: 2,
      resMessage: "Patika saglabāta"
    });

  } catch (err) {
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 99,
      resMessage: "Servera kļūda"
    });
  }
});
router.post("/api/post/north-meso/profile-picture", blockMaliciousIPs, applyWriteRateLimit,
  upload.single("profilePicture"), async (req, res) => {

    const MIN_IMAGE_SIZE = 2 * 1024;
    const MAX_IMAGE_SIZE = 1.5 * 1024 * 1024;

    const ALLOWED_IMAGE_TYPES = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp"
    ];
    let client;
    try {
      const ipVisitor = req.headers["x-forwarded-for"]
        ? req.headers["x-forwarded-for"].split(",")[0]
        : req.socket.remoteAddress || req.ip;
      /* -------------------------------------------
         SESSION VALIDATION
      ------------------------------------------- */
      const auth = req.headers.authorization || "";
      const bearerSid = auth.startsWith("Bearer ")
        ? auth.slice(7).trim()
        : null;
      const sessionId = req.cookies?.session_id || bearerSid;
      if (!sessionId) {
        return res.status(401).json({
          resStatus: false,
          resMessage: "Piesakieties, lai turpinātu",
          resErrorCode: 1
        });
      }
      const userRes = await pool.query(
        `SELECT google_id FROM grills_lv_sessions
         WHERE session_id = $1
         LIMIT 1`,
        [sessionId]
      );
      if (!userRes.rowCount) {
        return res.status(401).json({
          resStatus: false,
          resMessage: "Nederīga sesija",
          resErrorCode: 2
        });
      }
      const googleId = userRes.rows[0].google_id;
      /* -------------------------------------------
         IMAGE VALIDATION
      ------------------------------------------- */
      const file = req.file;
      if (!file) {
        return res.status(400).json({
          resStatus: false,
          resMessage: "Nav pievienots attēls",
          resErrorCode: 3
        });
      }
      if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
        return res.status(400).json({
          resStatus: false,
          resMessage: "Nederīgs faila formāts",
          resErrorCode: 4
        });
      }
      if (file.size < MIN_IMAGE_SIZE) {
        return res.status(400).json({
          resStatus: false,
          resMessage: "Attēls ir bojāts vai tukšs",
          resErrorCode: 5
        });
      }
      // FINAL LIMIT
      if (file.size > MAX_IMAGE_SIZE) {
        return res.status(400).json({
          resStatus: false,
          resMessage: "Attēls ir pārāk liels",
          resErrorCode: 7
        });
      }
      /* -------------------------------------------
         GET OLD PROFILE IMAGE
      ------------------------------------------- */
      client = await pool.connect();
      const oldImageRes = await client.query(
        `SELECT profile_img
         FROM grills_lv_users
         WHERE google_id = $1
         LIMIT 1`,
        [googleId]
      );
      const oldImageUrl =
        oldImageRes.rows[0]?.profile_img || null;
      /* -------------------------------------------
         DELETE OLD SUPABASE IMAGE
      ------------------------------------------- */
      if (oldImageUrl) {
        try {
          const oldPath = oldImageUrl.split(
            "/masters_latvia_storage/"
          )[1];
          if (oldPath) {
            const { error: deleteError } =
              await supabase.storage
                .from("masters_latvia_storage")
                .remove([oldPath]);
            if (deleteError) {
              console.log("Failed deleting old image:", deleteError.message);
            }
          }
        } catch (err) {
          console.log("Old image cleanup error:", err.message);
        }
      }
      /* -------------------------------------------
         UPLOAD NEW IMAGE
      ------------------------------------------- */
      const fileName = makeSafeName();
      const { error: uploadError } =
        await supabase.storage
          .from("masters_latvia_storage")
          .upload(fileName, file.buffer, {
            contentType: file.mimetype
          });
      if (uploadError) {
        return res.status(503).json({
          resStatus: false,
          resMessage: "Attēla augšupielāde neizdevās",
          resErrorCode: 8
        });
      }
      const imageUrl =
        `${process.env.SUPABASE_URL}` +
        `/storage/v1/object/public/masters_latvia_storage/${fileName}`;
      /* -------------------------------------------
         UPDATE USER
      ------------------------------------------- */
      await client.query(
        `UPDATE grills_lv_users
         SET profile_img = $1
         WHERE google_id = $2`,
        [imageUrl, googleId]
      );
      return res.status(201).json({
        resStatus: true,
        resMessage: "Profila attēls saglabāts",
        imageUrl,
        resOkCode: 1
      });
    } catch (err) {
      return res.status(500).json({
        resStatus: false,
        resMessage: "Servera kļūda",
        resErrorCode: 9
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  }
);
router.get("/api/get/north-meso/like-status", applyReadRateLimit, async (req, res) => {
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  const { ad_id } = req.query;
  if (!ad_id) {
    return res.json({
      resStatus: false,
      resMessage: "Trūkst vietas ID"
    });
  }
  try {
    // Always fetch likes first (PUBLIC)
    const q = `
      SELECT likers
      FROM grills_lv_likes
      WHERE ad_id = $1
      LIMIT 1
    `;
    const r = await pool.query(q, [ad_id]);
    const likers = r.rowCount ? (r.rows[0].likers || []) : [];
    const likersCount = likers.length;
    // Guest user → only return count
    if (!sessionId) {
      return res.json({
        resStatus: true,
        hasLiked: false,
        likersCount
      });
    }
    // Logged user → check session
    const sessionQ = `
      SELECT google_id
      FROM grills_lv_sessions
      WHERE session_id = $1
      LIMIT 1
    `;
    const sessionR = await pool.query(sessionQ, [sessionId]);
    if (!sessionR.rowCount) {
      return res.json({
        resStatus: true,
        hasLiked: false,
        likersCount
      });
    }
    const google_id = sessionR.rows[0].google_id;
    return res.json({
      resStatus: true,
      hasLiked: likers.includes(google_id),
      likersCount
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Servera kļūda"
    });
  }
});
router.get("/api/get/north-meso/reviews/:entry_id", applyReadRateLimit, async (req, res) => {
  const adId = req.params.ad_id;
  if (!adId) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Trūkst vietas ID"
    });
  }
  try {
    const q = `
      SELECT 
        id,
        reviewer_name,
        review_text,
        date,
        reviewer_id,
        parent,
        rating
      FROM grills_lv_reviews
      WHERE ad_id = $1
        AND is_deleted = false
      ORDER BY id ASC
    `;
    const r = await pool.query(q, [adId]);
    return res.json({
      resStatus: true,
      resOkCode: 1,
      reviews: r.rows
    });
  } catch (err) {
    console.error("Get reviews error:", err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 2,
      resMessage: "Servera kļūda"
    });
  }
});
//this gets reviews from reviews table and ad data from ads table (owner name, picture)
//We are using this endpoint in profile page because it allows better performance
//otherwise we will have to make two requests to the backend-database instead of one here.
// Gets reviews written by the logged-in user together with related entry/contributor data.
// Used by profile page to avoid separate backend requests.
router.get("/api/get/north-meso/profile-reviews-ads", applyReadRateLimit, async (req, res) => {
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;

  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "No active session",
      reviews: []
    });
  }

  try {
    const sessionQuery = `
      SELECT google_id
      FROM north_meso_sessions
      WHERE session_id = $1
      LIMIT 1;
    `;

    const sessionRes = await pool.query(sessionQuery, [sessionId]);

    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "No active session",
        reviews: []
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    const reviewsQuery = `
      SELECT
        r.id,
        r.review_text,
        r.rating,
        r.date,
        r.ad_id,

        e.type AS entry_type,
        e.image_url AS ad_image_url,

        u.name AS ad_owner_name,
        u.profile_img AS contributor_profile_img

      FROM north_meso_reviews r

      JOIN north_meso_entries e
        ON e.id = r.ad_id

      LEFT JOIN north_meso_users u
        ON u.google_id = e.google_id

      WHERE r.reviewer_id = $1
        AND r.is_deleted = false
        AND r.parent IS NULL

      ORDER BY r.id DESC;
    `;

    const reviewsRes = await pool.query(reviewsQuery, [googleId]);

    return res.status(200).json({
      resStatus: true,
      resOkCode: 1,
      reviews: reviewsRes.rows
    });

  } catch (err) {
    console.error("North Meso profile reviews fetch error:", err);

    return res.status(500).json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Server error",
      reviews: []
    });
  }
}); //DONE
router.get("/api/get/north-meso/profile-replies-ads", applyReadRateLimit, async (req, res) => {
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;

  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "No active session",
      reviews: []
    });
  }

  try {
    const sessionQuery = `
      SELECT google_id
      FROM north_meso_sessions
      WHERE session_id = $1
      LIMIT 1;
    `;

    const sessionRes = await pool.query(sessionQuery, [sessionId]);

    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "No active session",
        reviews: []
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    const repliesQuery = `
      SELECT
        r.id,
        r.review_text,
        r.date,
        r.ad_id,
        r.parent,

        e.type AS entry_type,
        e.image_url AS ad_image_url,

        u.name AS ad_owner_name,
        u.profile_img AS contributor_profile_img

      FROM north_meso_reviews r

      JOIN north_meso_entries e
        ON e.id = r.ad_id

      LEFT JOIN north_meso_users u
        ON u.google_id = e.google_id

      WHERE r.reviewer_id = $1
        AND r.parent IS NOT NULL
        AND r.is_deleted = false

      ORDER BY r.id DESC;
    `;

    const repliesRes = await pool.query(repliesQuery, [googleId]);

    return res.status(200).json({
      resStatus: true,
      resOkCode: 1,
      reviews: repliesRes.rows
    });

  } catch (err) {
    console.error("North Meso profile replies fetch error:", err);

    return res.status(500).json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Server error",
      reviews: []
    });
  }
}); //DONE
//deletes both reviews of the user and replies of the user.
//reviews of user with reply of the owner is not deleted. It is made hidden.
router.delete("/api/delete/north-meso/review/:id", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  const reviewId = Number(req.params.id);

  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "No active session",
      resErrorCode: 1
    });
  }

  if (!Number.isInteger(reviewId) || reviewId < 1) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Invalid review ID",
      resErrorCode: 2
    });
  }

  try {
    const sessionRes = await pool.query(
      `SELECT google_id FROM north_meso_sessions WHERE session_id = $1 LIMIT 1;`,
      [sessionId]
    );

    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "No active session",
        resErrorCode: 3
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    const ownershipRes = await pool.query(
      `
      SELECT id, parent, ad_id
      FROM north_meso_reviews
      WHERE id = $1
        AND reviewer_id = $2
      LIMIT 1;
      `,
      [reviewId, googleId]
    );

    if (!ownershipRes.rowCount) {
      return res.status(404).json({
        resStatus: false,
        resMessage: "Review not found or not permitted",
        resErrorCode: 4
      });
    }

    const { parent, ad_id: entryId } = ownershipRes.rows[0];

    if (parent !== null) {
      await pool.query(
        `DELETE FROM north_meso_reviews WHERE id = $1;`,
        [reviewId]
      );
    } else {
      const replyRes = await pool.query(
        `
        SELECT 1
        FROM north_meso_reviews
        WHERE parent = $1
        LIMIT 1;
        `,
        [reviewId]
      );

      if (replyRes.rowCount) {
        await pool.query(
          `
          UPDATE north_meso_reviews
          SET is_deleted = true
          WHERE id = $1 OR parent = $1;
          `,
          [reviewId]
        );
      } else {
        await pool.query(
          `DELETE FROM north_meso_reviews WHERE id = $1;`,
          [reviewId]
        );
      }
    }

    await pool.query(
      `
      UPDATE north_meso_entries
      SET
        average_rating = COALESCE(sub.avg, 0),
        reviews_count = COALESCE(sub.cnt, 0)
      FROM (
        SELECT
          ROUND(AVG(rating), 1) AS avg,
          COUNT(*) AS cnt
        FROM north_meso_reviews
        WHERE ad_id = $1
          AND is_deleted = false
          AND parent IS NULL
      ) sub
      WHERE id = $1;
      `,
      [entryId]
    );

    return res.status(200).json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Review deleted"
    });

  } catch (error) {
    console.error("North Meso delete review error:", error);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Database error",
      resErrorCode: 5
    });
  }
}); //DONE
router.get("/api/get/north-meso/session-user", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;

  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "No active session",
      resErrorCode: 1,
      loggedIn: false
    });
  }

  try {
    const query = `
      SELECT
        u.google_id,
        u.email,
        u.name,
        u.profile_img,
        u.number_entries
      FROM north_meso_sessions s
      JOIN north_meso_users u ON u.google_id = s.google_id
      WHERE s.session_id = $1
      LIMIT 1;
    `;

    const result = await pool.query(query, [sessionId]);

    if (result.rowCount === 0) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "No active session",
        resErrorCode: 2,
        loggedIn: false
      });
    }

    const user = result.rows[0];

    return res.status(200).json({
      resStatus: true,
      resMessage: "Session active",
      resOkCode: 1,
      loggedIn: true,
      user: {
        google_id: user.google_id,
        email: user.email,
        name: user.name,
        profile_img: user.profile_img,
        number_entries: user.number_entries ?? 0
      }
    });
  } catch (error) {
    console.error("North Meso session check error:", error);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 3,
      loggedIn: false
    });
  }
}); //DONE
router.delete("/api/delete/north-meso/profile-picture", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  let client;

  try {
    const auth = req.headers.authorization || "";
    const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    const sessionId = req.cookies?.session_id || bearerSid;

    if (!sessionId) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Please sign in to continue",
        resErrorCode: 1
      });
    }

    const sessionRes = await pool.query(
      `SELECT google_id
       FROM north_meso_sessions
       WHERE session_id = $1
       LIMIT 1`,
      [sessionId]
    );

    if (!sessionRes.rowCount) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Invalid session",
        resErrorCode: 2
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    client = await pool.connect();

    const userRes = await client.query(
      `SELECT profile_img
       FROM north_meso_users
       WHERE google_id = $1
       LIMIT 1`,
      [googleId]
    );

    if (!userRes.rowCount) {
      return res.status(404).json({
        resStatus: false,
        resMessage: "User not found",
        resErrorCode: 3
      });
    }

    const profileImg = userRes.rows[0]?.profile_img || null;

    if (!profileImg) {
      return res.status(200).json({
        resStatus: true,
        resMessage: "Profile picture is already removed",
        resOkCode: 1
      });
    }

    try {
      const filePath = profileImg.split("/north_meso_storage/")[1];

      if (filePath) {
        const { error: deleteError } = await supabase.storage
          .from("north_meso_storage")
          .remove([filePath]);

        if (deleteError) {
          return res.status(503).json({
            resStatus: false,
            resMessage: "Profile picture could not be deleted",
            resErrorCode: 4
          });
        }
      }
    } catch (err) {
      return res.status(503).json({
        resStatus: false,
        resMessage: "Profile picture could not be deleted",
        resErrorCode: 5
      });
    }

    await client.query(
      `UPDATE north_meso_users
       SET profile_img = NULL
       WHERE google_id = $1`,
      [googleId]
    );

    return res.status(200).json({
      resStatus: true,
      resMessage: "Profile picture removed",
      resOkCode: 2
    });

  } catch (err) {
    console.error("North Meso delete profile picture error:", err);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 6
    });

  } finally {
    if (client) client.release();
  }
}); //DONE
router.get("/api/get/north-meso/profile-picture", applyReadRateLimit, async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const bearerSid = auth.startsWith("Bearer ")
      ? auth.slice(7).trim()
      : null;

    const sessionId = req.cookies?.session_id || bearerSid;

    if (!sessionId) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Please sign in to continue",
        resErrorCode: 1
      });
    }

    const sessionRes = await pool.query(
      `SELECT google_id
       FROM north_meso_sessions
       WHERE session_id = $1
       LIMIT 1`,
      [sessionId]
    );

    if (!sessionRes.rowCount) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Invalid session",
        resErrorCode: 2
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    const userRes = await pool.query(
      `SELECT profile_img
       FROM north_meso_users
       WHERE google_id = $1
       LIMIT 1`,
      [googleId]
    );

    if (!userRes.rowCount) {
      return res.status(404).json({
        resStatus: false,
        resMessage: "User not found",
        resErrorCode: 3
      });
    }

    const profileImg = userRes.rows[0]?.profile_img || null;

    return res.status(200).json({
      resStatus: true,
      resOkCode: 1,
      profile_img: profileImg
    });

  } catch (err) {
    console.error("North Meso get profile picture error:", err);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 4
    });
  }
}); //DONE
router.get("/api/get/north-meso/entry/:id", applyReadRateLimit, async (req, res) => {
  const entryId = Number(req.params.id);

  if (!Number.isInteger(entryId) || entryId < 1) {
    return res.status(400).json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Invalid entry ID"
    });
  }

  try {
    const q = `
      SELECT
        e.id,
        e.description,
        e.type,
        e.year_type,
        e.year_value,
        e.era,
        e.source,
        e.date,
        e.update_date,
        e.views,
        e.likes_count,
        e.image_url,
        e.google_id,
        e.location,
        e.average_rating,
        e.reviews_count,
        e.is_active,
        u.name AS contributor_name,
        u.profile_img AS contributor_profile_img,
        u.number_entries AS contributor_entries
      FROM north_meso_entries e
      LEFT JOIN north_meso_users u
        ON u.google_id = e.google_id
      WHERE e.id = $1
      LIMIT 1
    `;

    const r = await pool.query(q, [entryId]);

    if (!r.rowCount) {
      return res.status(404).json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Entry not found"
      });
    }

    const entry = r.rows[0];

    let newerId = null;
    let olderId = null;

    const newerR = await pool.query(
      `
      SELECT id
      FROM north_meso_entries
      WHERE id > $1
        AND is_active = true
      ORDER BY id ASC
      LIMIT 1
      `,
      [entryId]
    );

    const olderR = await pool.query(
      `
      SELECT id
      FROM north_meso_entries
      WHERE id < $1
        AND is_active = true
      ORDER BY id DESC
      LIMIT 1
      `,
      [entryId]
    );

    newerId = newerR.rows[0]?.id || null;
    olderId = olderR.rows[0]?.id || null;

    return res.status(200).json({
      resStatus: true,
      resOkCode: 1,
      entry,
      newerId,
      olderId
    });

  } catch (err) {
    console.error("North Meso entry fetch error:", err);

    return res.status(500).json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Server error"
    });
  }
}); //DONE
router.get("/api/get/north-meso/user-entries", applyReadRateLimit, async (req, res) => {
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;

  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "No active session",
      resErrorCode: 1,
      entries: []
    });
  }

  try {
    const sessionQuery = `
      SELECT google_id
      FROM north_meso_sessions
      WHERE session_id = $1
      LIMIT 1;
    `;

    const sessionRes = await pool.query(sessionQuery, [sessionId]);

    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "No active session",
        resErrorCode: 2,
        entries: []
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    const entriesQuery = `
      SELECT
        id,
        description,
        type,
        year_type,
        year_value,
        era,
        source,
        image_url,
        date,
        update_date,
        location,
        created_at,
        is_active,
        views,
        likes_count,
        average_rating,
        reviews_count
      FROM north_meso_entries
      WHERE google_id = $1
      ORDER BY created_at DESC, id DESC;
    `;

    const entriesRes = await pool.query(entriesQuery, [googleId]);

    return res.status(200).json({
      resStatus: true,
      resMessage: "Entries loaded",
      resOkCode: 1,
      entries: entriesRes.rows
    });

  } catch (error) {
    console.error("North Meso user entries fetch error:", error);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 3,
      entries: []
    });
  }
}); //DONE
router.get("/api/get/north-meso/contributor-entries", applyReadRateLimit, async (req, res) => {
  const { gid } = req.query;

  if (!gid) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Contributor not specified",
      resErrorCode: 1,
      entries: []
    });
  }

  try {
    const entriesQuery = `
      SELECT
        id,
        description,
        type,
        year_type,
        year_value,
        era,
        source,
        image_url,
        date,
        update_date,
        location,
        created_at,
        views,
        likes_count,
        average_rating,
        reviews_count
      FROM north_meso_entries
      WHERE google_id = $1
        AND is_active = true
      ORDER BY created_at DESC, id DESC;
    `;

    const entriesRes = await pool.query(entriesQuery, [gid]);

    return res.status(200).json({
      resStatus: true,
      resMessage: "Entries loaded",
      resOkCode: 1,
      entries: entriesRes.rows
    });

  } catch (error) {
    console.error("North Meso contributor entries fetch error:", error);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 2,
      entries: []
    });
  }
}); //DONE
router.get("/api/get/north-meso/contributor-profile-picture/:gid", applyReadRateLimit, async (req, res) => {
  try {
    const gid = String(req.params.gid || "").trim();

    if (!gid) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Contributor ID is missing",
        resErrorCode: 1
      });
    }

    const userRes = await pool.query(
      `
      SELECT profile_img
      FROM north_meso_users
      WHERE google_id = $1
      LIMIT 1
      `,
      [gid]
    );

    if (!userRes.rowCount) {
      return res.status(200).json({
        resStatus: true,
        resOkCode: 1,
        profile_img: null
      });
    }

    const profileImg = userRes.rows[0]?.profile_img || null;

    return res.status(200).json({
      resStatus: true,
      resOkCode: 2,
      profile_img: profileImg
    });

  } catch (err) {
    console.error("North Meso contributor profile picture error:", err);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 3
    });
  }
}); //DONE
router.get("/api/get/north-meso/contributor-likes/:gid", applyReadRateLimit, async (req, res) => {
  try {
    const gid = String(req.params.gid || "").trim();

    if (!gid) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Contributor ID is missing",
        resErrorCode: 1
      });
    }

    const likesRes = await pool.query(
      `
      SELECT likers
      FROM north_meso_likes
      WHERE master_id = $1
      `,
      [gid]
    );

    let totalLikes = 0;

    for (const row of likesRes.rows) {
      let likers = row.likers;

      if (typeof likers === "string") {
        try {
          likers = JSON.parse(likers);
        } catch {
          likers = [];
        }
      }

      if (Array.isArray(likers)) {
        totalLikes += likers.length;
      }
    }

    return res.status(200).json({
      resStatus: true,
      resOkCode: 1,
      totalLikes
    });

  } catch (err) {
    console.error("North Meso contributor likes error:", err);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 2
    });
  }
}); //DONE
router.get("/api/get/north-meso/contributor-stats/:gid", applyReadRateLimit, async (req, res) => {
  try {
    const gid = String(req.params.gid || "").trim();

    if (!gid) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Contributor ID is missing",
        resErrorCode: 1
      });
    }

    const userRes = await pool.query(
      `
      SELECT number_entries, date, name
      FROM north_meso_users
      WHERE google_id = $1
      LIMIT 1
      `,
      [gid]
    );

    if (!userRes.rowCount) {
      return res.status(200).json({
        resStatus: true,
        resOkCode: 1,
        totalEntries: 0,
        memberSince: "—",
        totalReviewsLeft: 0,
        contributorName: null
      });
    }

    const totalEntries = Number(userRes.rows[0].number_entries) || 0;
    const contributorName = userRes.rows[0].name || null;
    const rawDate = userRes.rows[0].date;

    let memberSince = "—";

    if (rawDate) {
      const d = new Date(rawDate);

      if (!Number.isNaN(d.getTime())) {
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const year = d.getFullYear();
        memberSince = `${month}-${year}`;
      }
    }

    const reviewsLeftRes = await pool.query(
      `
      SELECT COUNT(*) AS total_reviews_left
      FROM north_meso_reviews
      WHERE reviewer_id = $1
        AND is_deleted IS NOT TRUE
        AND parent IS NULL
      `,
      [gid]
    );

    const totalReviewsLeft =
      Number(reviewsLeftRes.rows[0]?.total_reviews_left) || 0;

    return res.status(200).json({
      resStatus: true,
      resOkCode: 2,
      totalEntries,
      memberSince,
      totalReviewsLeft,
      contributorName
    });

  } catch (err) {
    console.error("North Meso contributor stats error:", err);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 2
    });
  }
}); //DONE
router.get("/api/get/north-meso/contributor-review-stats/:gid", applyReadRateLimit, async (req, res) => {
  try {
    const gid = String(req.params.gid || "").trim();

    if (!gid) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Contributor ID is missing",
        resErrorCode: 1
      });
    }

    const entriesRes = await pool.query(
      `
      SELECT id
      FROM north_meso_entries
      WHERE google_id = $1
        AND is_active = true
      `,
      [gid]
    );

    if (!entriesRes.rowCount) {
      return res.status(200).json({
        resStatus: true,
        resOkCode: 1,
        totalReviews: 0,
        overallRating: 0
      });
    }

    const entryIds = entriesRes.rows.map(row => row.id);

    const reviewsRes = await pool.query(
      `
      SELECT rating
      FROM north_meso_reviews
      WHERE ad_id = ANY($1)
        AND is_deleted IS NOT TRUE
        AND parent IS NULL
        AND rating IS NOT NULL
      `,
      [entryIds]
    );

    const totalReviews = reviewsRes.rowCount || 0;

    let overallRating = 0;

    if (totalReviews > 0) {
      const totalRating = reviewsRes.rows.reduce(
        (sum, row) => sum + Number(row.rating || 0),
        0
      );

      overallRating = (totalRating / totalReviews).toFixed(1);
    }

    return res.status(200).json({
      resStatus: true,
      resOkCode: 2,
      totalReviews,
      overallRating
    });

  } catch (err) {
    console.error("North Meso contributor review stats error:", err);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 2
    });
  }
}); //DONE
router.get("/api/get/north-meso/search", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
  const q = (req.query.q || "").trim();

  const PAGE_SIZE = 12;
  const HARD_CAP = 1000;

  let page = parseInt(req.query.page, 10) || 1;
  if (page < 1) page = 1;

  const limit = PAGE_SIZE;
  const offset = (page - 1) * limit;

  if (q.length < 3 || q.length > 60) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Meklējums par īsu vai garu"
    });
  }
  if (!/^[^<>]{3,60}$/.test(q)) {
    return res.json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Nederīgs meklējums"
    });
  }
  // 🚫 block deep offsets
  if (offset >= HARD_CAP) {
    return res.json({
      resStatus: true,
      resOkCode: 1,
      ads: [],
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        totalResults: HARD_CAP,
        totalPages: Math.ceil(HARD_CAP / PAGE_SIZE)
      }
    });
  }
  try {
    // 1️⃣ capped count
    const countQ = `
      SELECT COUNT(*)
      FROM grills_lv_ads
      WHERE is_active = true
      AND (
        description ILIKE $1
        OR name ILIKE $1
      )
    `;
    const countR = await pool.query(countQ, [`%${q}%`]);
    const realTotal = parseInt(countR.rows[0].count, 10);
    const totalResults = Math.min(realTotal, HARD_CAP);
    const totalPages = Math.ceil(totalResults / PAGE_SIZE);
    // 2️⃣ paged data
    const dataQ = `
      SELECT 
        id, name, description, price, city, date, views,
        image_url, google_id,
        average_rating, reviews_count
      FROM grills_lv_ads
      WHERE is_active = true
        AND (
          description ILIKE $1
          OR name ILIKE $1
        )
      ORDER BY date DESC
      LIMIT $2 OFFSET $3
    `;
    const dataR = await pool.query(dataQ, [
      `%${q}%`,
      limit,
      offset
    ]);

    return res.json({
      resStatus: true,
      resOkCode: 1,
      ads: dataR.rows,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        totalResults,
        totalPages,
        hardCap: HARD_CAP
      }
    });
  } catch (err) {
    console.error("Search error:", err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 2,
      resMessage: "Servera kļūda"
    });
  }
});
router.get("/api/get/north-meso/search-filter", applyReadRateLimit, blockMaliciousIPs, async (req, res) => {
  const q = (req.query.q || "").trim();

  if (q.length < 3 || q.length > 60) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Meklējums par īsu vai garu"
    });
  }

  if (!/^[^<>]{3,60}$/.test(q)) {
    return res.json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Nederīgs meklējums"
    });
  }

  const { city, price, minReviews, minLikes } = req.query;

  const PAGE_SIZE = 12;
  const HARD_CAP = 1000;

  let page = parseInt(req.query.page, 10) || 1;
  if (page < 1) page = 1;

  const limit = PAGE_SIZE;
  const offset = (page - 1) * limit;

  if (offset >= HARD_CAP) {
    return res.json({
      resStatus: true,
      ads: [],
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        totalResults: HARD_CAP,
        totalPages: Math.ceil(HARD_CAP / PAGE_SIZE)
      }
    });
  }

  try {
    const conditions = [];
    const values = [];
    let i = 1;

    conditions.push(`a.is_active = true`);
    conditions.push(`(
      a.description ILIKE $${i}
      OR a.name ILIKE $${i}
    )`);
    values.push(`%${q}%`);
    i++;

    if (city) {
      const cityId = Number(city);

      if (!Number.isNaN(cityId)) {
        conditions.push(`a.city::jsonb @> $${i}::jsonb`);
        values.push(JSON.stringify([cityId]));
        i++;
      }
    }

    if (price === "free") {
      conditions.push(`TRIM(a.price) = $${i}`);
      values.push("Bezmaksas");
      i++;
    }

    if (price === "paid") {
      conditions.push(`a.price IS NOT NULL AND TRIM(a.price) <> '' AND TRIM(a.price) <> $${i}`);
      values.push("Bezmaksas");
      i++;
    }

    if (minReviews) {
      const rc = Number(minReviews);

      if (!Number.isNaN(rc)) {
        conditions.push(`a.reviews_count >= $${i}`);
        values.push(rc);
        i++;
      }
    }

    if (minLikes) {
      const lc = Number(minLikes);

      if (!Number.isNaN(lc)) {
        conditions.push(`COALESCE(l.likes_count, 0) >= $${i}`);
        values.push(lc);
        i++;
      }
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const likesJoin = `
      LEFT JOIN (
        SELECT 
          ad_id,
          COALESCE(MAX(jsonb_array_length(likers)), 0) AS likes_count
        FROM grills_lv_likes
        GROUP BY ad_id
      ) l ON l.ad_id = a.id
    `;

    const countQ = `
      SELECT COUNT(*)
      FROM grills_lv_ads a
      ${likesJoin}
      ${whereClause}
    `;

    const countR = await pool.query(countQ, values);

    const realTotal = parseInt(countR.rows[0].count, 10);
    const totalResults = Math.min(realTotal, HARD_CAP);
    const totalPages = Math.ceil(totalResults / PAGE_SIZE);

    const dataQ = `
      SELECT
        a.id,
        a.name,
        a.description,
        a.price,
        a.city,
        a.date,
        a.views,
        a.image_url,
        a.google_id,
        a.average_rating,
        a.reviews_count,
        COALESCE(l.likes_count, 0) AS likes_count
      FROM grills_lv_ads a
      ${likesJoin}
      ${whereClause}
      ORDER BY a.date DESC
      LIMIT $${i} OFFSET $${i + 1}
    `;

    const dataR = await pool.query(dataQ, [...values, limit, offset]);

    return res.json({
      resStatus: true,
      ads: dataR.rows,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        totalResults,
        totalPages
      }
    });

  } catch (err) {
    console.error("Search filter error:", err);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Servera kļūda"
    });
  }
});
router.get("/api/get/north-meso/index-filter", applyReadRateLimit, blockMaliciousIPs, async (req, res) => {
  const { city, price, minReviews, minLikes } = req.query;

  const PAGE_SIZE = 12;
  const HARD_CAP = 1000;

  let page = parseInt(req.query.page, 10) || 1;
  if (page < 1) page = 1;

  const limit = PAGE_SIZE;
  const offset = (page - 1) * limit;

  try {
    const conditions = [];
    const values = [];
    let i = 1;

    conditions.push(`a.is_active = true`);

    if (city) {
      const cityId = Number(city);

      if (!Number.isNaN(cityId)) {
        conditions.push(`a.city::jsonb @> $${i}::jsonb`);
        values.push(JSON.stringify([cityId]));
        i++;
      }
    }

    if (price === "free") {
      conditions.push(`TRIM(a.price) = $${i}`);
      values.push("Bezmaksas");
      i++;
    }

    if (price === "paid") {
      conditions.push(`TRIM(a.price) <> $${i}`);
      values.push("Bezmaksas");
      i++;
    }

    if (minReviews) {
      const rc = Number(minReviews);

      if (!Number.isNaN(rc)) {
        conditions.push(`COALESCE(a.reviews_count,0) >= $${i}`);
        values.push(rc);
        i++;
      }
    }

    if (minLikes) {
      const lc = Number(minLikes);

      if (!Number.isNaN(lc)) {
        conditions.push(`COALESCE(l.likes_count,0) >= $${i}`);
        values.push(lc);
        i++;
      }
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const likesJoin = `
      LEFT JOIN (
        SELECT
          ad_id,
          jsonb_array_length(likers) AS likes_count
        FROM grills_lv_likes
      ) l ON l.ad_id = a.id
    `;

    const countQ = `
      SELECT COUNT(*)
      FROM grills_lv_ads a
      ${likesJoin}
      ${whereClause}
    `;

    const countR = await pool.query(countQ, values);

    const totalResults = Math.min(parseInt(countR.rows[0].count, 10), HARD_CAP);
    const totalPages = Math.max(1, Math.ceil(totalResults / PAGE_SIZE));

    const dataQ = `
      SELECT
        a.id,
        a.name,
        a.description,
        a.price,
        a.city,
        a.date,
        a.views,
        a.image_url,
        a.location,
        a.google_id,
        a.average_rating,
        a.reviews_count,
        COALESCE(l.likes_count,0) AS likes_count
      FROM grills_lv_ads a
      ${likesJoin}
      ${whereClause}
      ORDER BY a.date DESC
      LIMIT $${i} OFFSET $${i + 1}
    `;

    const dataR = await pool.query(dataQ, [...values, limit, offset]);

    return res.json({
      resStatus: true,
      ads: dataR.rows,
      pagination: {
        currentPage: page,
        totalPages,
        totalResults
      }
    });

  } catch (err) {
    console.error("Index filter error:", err);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Servera kļūda"
    });
  }
});
router.get("/api/get/north-meso/map-entries", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
  let client;

  try {
    const north = Number(req.query.north);
    const south = Number(req.query.south);
    const east = Number(req.query.east);
    const west = Number(req.query.west);

    if (
      !Number.isFinite(north) ||
      !Number.isFinite(south) ||
      !Number.isFinite(east) ||
      !Number.isFinite(west)
    ) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Invalid coordinates",
        resErrorCode: 3
      });
    }

    if (south > north || west > east) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Invalid map bounds",
        resErrorCode: 4
      });
    }

    client = await pool.connect();

    const query = `
      SELECT
        id,
        type,
        year_type,
        year_value,
        era,
        description,
        source,
        location,
        image_url
      FROM north_meso_entries
      WHERE is_active = true
        AND location IS NOT NULL
        AND (location->>0)::float BETWEEN $1 AND $2
        AND (location->>1)::float BETWEEN $3 AND $4
      ORDER BY id DESC
      LIMIT 100
    `;

    const result = await client.query(query, [
      south,
      north,
      west,
      east
    ]);

    return res.status(200).json({
      resStatus: true,
      entries: result.rows
    });

  } catch (err) {
    console.error("North Meso map entries error:", err);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 1
    });

  } finally {
    if (client) client.release();
  }
}); //DONE
router.get("/api/get/north-meso/homepage/carousel", async (req, res) => {
  try {
    const q = `
      SELECT
        id,
        name,
        price,
        city,
        description,
        average_rating,
        reviews_count,
        image_url ->> 0 AS image
      FROM grills_lv_carousel
      ORDER BY id DESC
    `;
    const result = await pool.query(q);
    return res.json({
      resStatus: true,
      resOkCode: 1,
      resData: result.rows
    });
  } catch (err) {
    return res.status(500).json({
      resStatus: false,
      resMessage: "Neizdevās ielādēt karuseli",
      resErrorCode: 2
    });
  }
});


module.exports = router;