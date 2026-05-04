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
  enforceEmailActionCooldown,
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


router.post("/api/post/grills-latvia/save-visitor", checkLogCooldown(3 * 60 * 1000), async (req, res) => {
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
    console.error("Visitor log error:", err);
    return res.status(200).json({
      resStatus: false,
      resMessage: "Apmeklētāja reģistrācija neizdevās – iekšēja kļūda",
      resErrorCode: 2
    });
  } finally {
    if (client) client.release();
  }
});
router.post("/api/post/grills-latvia/ads", blockMaliciousIPs, enforceAdPostingCooldown, applyWriteRateLimit,
  upload.array("images", 5), async (req, res) => {
  const MIN_IMAGE_SIZE = 2 * 1024;
  const MAX_IMAGE_SIZE = 3 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp"
  ];

  const ipVisitor = req.headers["x-forwarded-for"]
    ? req.headers["x-forwarded-for"].split(",")[0]
    : req.socket.remoteAddress || req.ip;
  console.log("[grills-latvia/ads] POST request from IP:", ipVisitor);
  let client;
  let formData;
  /* -------------------------------------------
     PARSE JSON FORM DATA
  ------------------------------------------- */
  try {
    formData = JSON.parse(req.body.formData);
  } catch (err) {
    console.log("[grills-latvia/ads] Failed to parse formData:", err.message);
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nederīgi formas dati",
      resErrorCode: 1
    });
  }
  const {
    inputName,
    inputPrice,
    inputDescription,
    inputRegions,
    latitude,
    longitude
  } = formData;

  function sanitizeInput(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  const cleanInputDescription = sanitizeInput(inputDescription);
  const cleanInputPrice = sanitizeInput(inputPrice);
  const cleanInputName = sanitizeInput(inputName);

  if (!inputName || !inputPrice || !inputDescription) {
    console.log("[grills-latvia/ads] Missing required fields");
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nav aizpildīti obligātie lauki",
      resErrorCode: 2
    });
  }

  // ✅ LAT/LNG VALIDATION
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.log("[grills-latvia/ads] Invalid coordinates:", latitude, longitude);
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nederīgas koordinātas",
      resErrorCode: 10
    });
  }
  // latitude: -90 to 90
  if (lat < -90 || lat > 90) {
    console.log("[grills-latvia/ads] Latitude out of range:", lat);
    return res.status(400).json({
      resStatus: false,
      resMessage: "Latitude ārpus diapazona",
      resErrorCode: 11
    });
  }
  // longitude: -180 to 180
  if (lng < -180 || lng > 180) {
    console.log("[grills-latvia/ads] Longitude out of range:", lng);
    return res.status(400).json({
      resStatus: false,
      resMessage: "Longitude ārpus diapazona",
      resErrorCode: 12
    });
  }
  // optional: round (clean DB) 6 decimals is 0.11 cm precision
  const latRounded = Number(lat.toFixed(6));
  const lngRounded = Number(lng.toFixed(6));
  const locationArray = [latRounded, lngRounded];
  console.log("[grills-latvia/ads] Location:", locationArray);


  if (!Array.isArray(inputRegions) || inputRegions.length === 0) {
    console.log("[grills-latvia/ads] No regions selected");
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nav izvēlēti reģioni",
      resErrorCode: 9
    });
  }
  if (inputName.length < 5 || inputName.length > 120) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Virsraksts ir pārāk garš vai pārāk īss",
      resErrorCode: 10
    });
  }
  if (inputPrice.length < 1 || inputPrice.length > 40) {
    console.log("[grills-latvia/ads] inputPrice length invalid:", inputPrice.length);
    return res.status(400).json({
      resStatus: false,
      resMessage: "Cena ir pārāk gara vai pārāk īsa",
      resErrorCode: 11
    });
  }
  if (inputDescription.length < 50 || inputDescription.length > 1000) {
    console.log("[grills-latvia/ads] inputDescription length invalid:", inputDescription.length);
    return res.status(400).json({
      resStatus: false,
      resMessage: "Apraksts ir pārāk garš vai pārāk īss",
      resErrorCode: 12
    });
  }
  /* -------------------------------------------
     SESSION VALIDATION
  ------------------------------------------- */
  try {
    const auth = req.headers.authorization || "";
    const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    const sessionId = req.cookies?.session_id || bearerSid;
    if (!sessionId) {
      console.log("[grills-latvia/ads] No session ID provided");
      return res.status(401).json({
        resStatus: false,
        resMessage: "Piesakieties, lai turpinātu",
        resErrorCode: 13
      });
    }
    const userRes = await pool.query(
      `SELECT google_id FROM grills_lv_sessions WHERE session_id = $1 LIMIT 1`,
      [sessionId]
    );
    if (!userRes.rowCount) {
      console.log("[grills-latvia/ads] Invalid session ID");
      return res.status(401).json({
        resStatus: false,
        resMessage: "Nederīga sesija",
        resErrorCode: 14
      });
    }
    const googleId = userRes.rows[0].google_id;
    console.log("[grills-latvia/ads] Authenticated google_id:", googleId);
    /* -------------------------------------------
        max 50 ads per user
    ------------------------------------------- */
    try {
      client = await pool.connect();
      const userAdNumberCheck = await client.query(
        "SELECT number_ads FROM grills_lv_users WHERE google_id = $1",
        [googleId]
      );

      if (userAdNumberCheck.rows[0]?.number_ads >= 50) {
        console.log("[grills-latvia/ads] Ad limit reached for google_id:", googleId);
        return res.status(403).json({
          resStatus: false,
          resMessage: "Sasniegts limits (maksimums 50)",
          resErrorCode: 15
        });
      }
    } catch (err) {
      console.log("[grills-latvia/ads] Error checking ad count:", err.message);
      return res.status(500).json({
        resStatus: false,
        resMessage: "Sistēmas kļūda. Mēģiniet vēlreiz vēlāk",
        resErrorCode: 23
      });
    } finally {
      if (client) {
        client.release();
        client = null;
      }
    }

    /* -------------------------------------------
       IMAGE VALIDATION
    ------------------------------------------- */
    const files = req.files;

    if (!files || files.length < 1 || files.length > 5) {
      console.log("[grills-latvia/ads] Invalid file count:", files?.length);
      return res.status(400).json({
        resStatus: false,
        resMessage: "Nepieciešami 1–5 attēli",
        resErrorCode: 17
      });
    }

    let uploadedImages = [];
    for (const f of files) {
      if (!ALLOWED_IMAGE_TYPES.includes(f.mimetype)) {
        console.log("[grills-latvia/ads] Invalid file type:", f.mimetype);
        return res.status(400).json({
          resStatus: false,
          resMessage: "Nederīgs faila formāts",
          resErrorCode: 18
        });
      }

      if (f.size < MIN_IMAGE_SIZE) {
        console.log("[grills-latvia/ads] File too small:", f.size);
        return res.status(400).json({
          resStatus: false,
          resMessage: "Attēla fails ir bojāts vai tukšs",
          resErrorCode: 19
        });
      }

      if (f.size > MAX_IMAGE_SIZE) {
        console.log("[grills-latvia/ads] File too large:", f.size);
        return res.status(400).json({
          resStatus: false,
          resMessage: "Attēls ir pārāk liels (maks. 1,8 MB)",
          resErrorCode: 20
        });
      }

      const fileName = makeSafeName();
      console.log("[grills-latvia/ads] Uploading image:", fileName);
      const { error } = await supabase.storage
        .from("masters_latvia_storage")
        .upload(fileName, f.buffer, { contentType: f.mimetype });

      if (error) {
        console.log("[grills-latvia/ads] Supabase upload error:", error.message);
        return res.status(503).json({
          resStatus: false,
          resMessage: "Attēla augšupielāde neizdevās",
          resErrorCode: 21
        });
      }

      uploadedImages.push(
        `${process.env.SUPABASE_URL}/storage/v1/object/public/masters_latvia_storage/${fileName}`
      );
    }
    console.log("[grills-latvia/ads] Images uploaded:", uploadedImages.length);
    /* -------------------------------------------
       DATABASE INSERT
    ------------------------------------------- */
    try {
      client = await pool.connect();

      const insertQuery = `
        INSERT INTO grills_lv_ads
        (name, description, price, city, 
        location, image_url, ip, google_id,
        date, update_date, created_at, 
        is_active)
        VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12)
        RETURNING id
      `;

      const values = [
        cleanInputName,                          // $1
        cleanInputDescription,                   // $2
        cleanInputPrice,                         // $3
        JSON.stringify(inputRegions),            // $4 (city)
        JSON.stringify(locationArray),           // $5 (jsonb)
        JSON.stringify(uploadedImages),          // $6
        ipVisitor,                                // $7
        googleId,                                 // $8
        new Date().toISOString().slice(0, 10),    // $9
        new Date(),                               // $10
        new Date(),                               // $11
        true                                      // $12
      ];
      console.log("[grills-latvia/ads] city value:", JSON.stringify(inputRegions));
console.log("[grills-latvia/ads] location value:", locationArray);
console.log("[grills-latvia/ads] image_url value:", JSON.stringify(uploadedImages));
console.log("[grills-latvia/ads] all values types:", values.map((v, i) => `$${i+1}: ${typeof v} = ${JSON.stringify(v)}`));
console.log("[grills-latvia/ads] price raw:", inputPrice, "| cleaned:", cleanInputPrice, "| type:", typeof cleanInputPrice);
      const result = await client.query(insertQuery, values);
      if (!result.rowCount) {
        console.log("[grills-latvia/ads] DB insert returned no rows");
        return res.status(503).json({
          resStatus: false,
          resMessage: "Datu saglabāšana neizdevās",
          resErrorCode: 22
        });
      }
      await client.query(
        "UPDATE grills_lv_users SET number_ads = COALESCE(number_ads, 0) + 1 WHERE google_id = $1",
        [googleId]
      );
      console.log("[grills-latvia/ads] Ad inserted, id:", result.rows[0].id);
      return res.status(201).json({
        resStatus: true,
        resMessage: "Vieta saglabāta",
        resOkCode: 1
      });

    } catch (err) {
      console.log("[grills-latvia/ads] DB insert error:", err.message);
      return res.status(503).json({
        resStatus: false,
        resMessage: "Servera kļūda",
        resErrorCode: 23
      });

    } finally {
      if (client) client.release();
    }

  } catch (err) {
    console.log("[grills-latvia/ads] Unhandled error:", err.message);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Servera kļūda",
      resErrorCode: 24
    });
  }
});
router.put("/api/put/grills-latvia/update-ad/:id", blockMaliciousIPs, enforceAdPostingCooldown, applyWriteRateLimit, 
  upload.array("images", 5), async (req, res) => {
  const adId = req.params.id;
  const MIN_IMAGE_SIZE = 2 * 1024;           // 2 KB
  const MAX_IMAGE_SIZE = 3 * 1024 * 1024;  // 3 MB. Normally I should say 1.8 but just give some
  //error room to the frontend here I am saying 3
  const ALLOWED_IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp"
  ];

  /* -------------------------------
     CHECK LOGIN SESSION
  --------------------------------*/
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  if (!sessionId) {
    return res.status(401).json({
      resStatus: false,
      resMessage: "Lūdzu, piesakieties",
      resErrorCode: 1
    });
  }
  try {
    const userQ = await pool.query(
      `SELECT google_id 
       FROM grills_lv_sessions 
       WHERE session_id = $1 
       LIMIT 1`,
      [sessionId]
    );
    if (!userQ.rowCount) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Nederīga sesija",
        resErrorCode: 2
      });
    }
    const googleId = userQ.rows[0].google_id;
    /* -------------------------------
       CHECK IF AD BELONGS TO USER
    --------------------------------*/
    const adQ = await pool.query(
      `SELECT image_url, google_id 
       FROM grills_lv_ads 
       WHERE id = $1 
       LIMIT 1`,
      [adId]
    );
    if (!adQ.rowCount) {
      return res.json({
        resStatus: false,
        resMessage: "Vieta neeksistē",
        resErrorCode: 3
      });
    }

    if (adQ.rows[0].google_id !== googleId) {
      return res.status(403).json({
        resStatus: false,
        resMessage: "Reikalingas prisijungimas",
        resErrorCode: 4
      });
    }
    /* -------------------------------
       PARSE JSON FORM DATA
    --------------------------------*/
    let formData;
    try {
      formData = JSON.parse(req.body.formData);
    } catch (err) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Nederīgi formas dati",
        resErrorCode: 5
      });
    }
    const {
      inputName,
      inputPrice,
      inputDescription,
      inputRegions,
      existingImages,
      latitude,
      longitude
    } = formData;

    function sanitizeInput(str) {
      if (typeof str !== 'string') return '';
      return str
        // 1. Convert < and > into safe text versions so they don't execute
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        // 2. Remove invisible control characters (keep Newlines and Tabs if you want)
    }
    const cleanInputDescription = sanitizeInput(inputDescription);
    const cleanInputPrice = sanitizeInput(inputPrice);
    const cleanInputName = sanitizeInput(inputName);

  if ( !inputName || !inputPrice || !inputDescription ) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Lūdzu, aizpildiet obligātos laukus",
      resErrorCode: 6
    });
  }
  // ✅ LAT/LNG VALIDATION
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nederīgas koordinātas",
      resErrorCode: 10
    });
  }
  // latitude: -90 to 90
  if (lat < -90 || lat > 90) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Latitude ārpus diapazona",
      resErrorCode: 11
    });
  }
  // longitude: -180 to 180
  if (lng < -180 || lng > 180) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Longitude ārpus diapazona",
      resErrorCode: 12
    });
  }
  // optional: round (clean DB) 6 decimals is 0.11 cm precision
  const latRounded = Number(lat.toFixed(6));
  const lngRounded = Number(lng.toFixed(6));
  const locationArray = [latRounded, lngRounded];//JSONB ARRAY


  //OTHER VALIDATIONS
  if (!Array.isArray(inputRegions) || inputRegions.length === 0) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Reģioni nav izvēlēti",
      resErrorCode: 11
    });
  }
  if (inputName.length < 5 || inputName.length > 120) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Vārds ir pārāk garš vai pārāk īss",
      resErrorCode: 12
    });
  }
  if (inputPrice.length < 1 || inputPrice.length > 40) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Cena ir pārāk gara vai pārāk īsa",
      resErrorCode: 15
    });
  }
  if (inputDescription.length < 50 || inputDescription.length > 1000) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Apraksts ir pārāk garš vai pārāk īss",
      resErrorCode: 16
    });
  }

    /* -------------------------------
       HANDLE NEW IMAGE UPLOADS
    --------------------------------*/
    const files = req.files;
    let finalImages = Array.isArray(existingImages) ? existingImages : [];

    // Validate new images if any
    if (files && files.length > 0) {
      //image checks before uploading
      for (const f of files) {
        if (!ALLOWED_IMAGE_TYPES.includes(f.mimetype)) {
          return res.status(400).json({
            resStatus: false,
            resMessage: "Attēla faila tips nav derīgs",
            resErrorCode: 19
          });
        }
        if (f.size < MIN_IMAGE_SIZE) {
          return res.status(400).json({
            resStatus: false,
            resMessage: "Attēla fails ir bojāts vai tukšs",
            resErrorCode: 20
          });
        }
        if (f.size > MAX_IMAGE_SIZE) {
          return res.status(400).json({
            resStatus: false,
            resMessage: "Attēls ir pārāk liels (maks. 1,8 MB)",
            resErrorCode: 21
          });
        }
      }
      // Upload to Supabase
      const uploadedImages = [];
      for (const f of files) {
        const fileName = makeSafeName();
        const { error } = await supabase.storage
          .from("masters_latvia_storage")
          .upload(fileName, f.buffer, { contentType: f.mimetype });
        if (error) {
          return res.status(503).json({
            resStatus: false,
            resMessage: "Attēla augšupielāde neizdevās",
            resErrorCode: 22
          });
        }
        uploadedImages.push(
          `${process.env.SUPABASE_URL}/storage/v1/object/public/masters_latvia_storage/${fileName}`
        );
      }
      finalImages = [...finalImages, ...uploadedImages];
    }
    /* -------------------------------
       UPDATE DATABASE
    --------------------------------*/
    const updateQ = `
      UPDATE grills_lv_ads 
      SET 
        name        = $1,
        description = $2,
        price       = $3,
        city        = $4,
        location    = $5,
        image_url   = $6,
        update_date = $7
      WHERE id = $8 AND google_id = $9
      RETURNING id
    `;
    const values = [
      cleanInputName,                          // $1
      cleanInputDescription,                   // $2
      cleanInputPrice,                         // $3
      JSON.stringify(inputRegions),            // $4
      locationArray,                           // $5 (jsonb)
      finalImages,                             // $6 (jsonb, no stringify)
      new Date(),                               // $7
      adId,                                    // $8
      googleId                                 // $9
    ];
    const result = await pool.query(updateQ, values);
    if (!result.rowCount) {
      return res.json({
        resStatus: false,
        resMessage: "Kļūda atjauninot",
        resErrorCode: 23
      });
    }
    return res.json({
      resStatus: true,
      resMessage: "Izmaiņas saglabātas",
      resOkCode: 1
    });
  } catch (err) {
    return res.status(500).json({
      resStatus: false,
      resMessage: "Servera kļūda",
      resErrorCode: 24
    });
  }
});
//this function below is for google auth login
async function createSessionForUser(dbGoogleId, isEmail) {
  const sessionId = crypto.randomUUID(); // generate inline
  await pool.query(
    `INSERT INTO grills_lv_sessions (session_id, google_id, is_email) VALUES ($1, $2, $3)`,
    [sessionId, dbGoogleId, isEmail]
  );
  return sessionId;
}
router.post("/api/post/grills-latvia/auth/google", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const ipVisitor = req.headers["x-forwarded-for"] ? req.headers["x-forwarded-for"].split(",")[0]
    : req.socket.remoteAddress || req.ip;
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Trūkst Google žetona",
      resErrorCode: 4
    });
  }
  let client;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name } = payload;
    client = await pool.connect();
    const existingByEmailQ = `
      SELECT google_id, auth_provider, email
      FROM grills_lv_users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
    `;
    const existingByEmailR = await client.query(existingByEmailQ, [email]);
    if (existingByEmailR.rowCount) {
      const existingUser = existingByEmailR.rows[0];
      if (existingUser.auth_provider === "email") {
        return res.status(409).json({
          resStatus: false,
          resMessage: "Šis e-pasts jau ir reģistrēts ar e-pastu. Lūdzu, piesakieties ar e-pastu un paroli.",
          resErrorCode: 5
        });
      }
    }
    const query = `
      INSERT INTO grills_lv_users (google_id, email, name, date, ip)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (google_id)
      DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
      RETURNING google_id;
    `;
    const values = [ googleId, email, name, new Date().toISOString().slice(0, 10), ipVisitor ];
    const result = await client.query(query, values);

    const dbGoogleId = result.rows[0].google_id;

    const sessionId = await createSessionForUser(dbGoogleId, false);
    res.cookie("session_id", sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 1000 * 60 * 60 * 24 * 365
    });
    return res.status(200).json({
      resStatus: true,
      resMessage: "Lietotājs autentificēts",
      resOkCode: 1,
      user: { google_id: dbGoogleId, email, name, session_id: sessionId }
    });

  } catch (error) {
    console.error("Google Auth Error Backend:", error);
    if (error.message?.includes("Invalid") || error.message?.includes("JWT")) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Nederīgs Google žetons",
        resErrorCode: 2
      });
    }
    return res.status(500).json({
      resStatus: false,
      resMessage: "Datu bāzes savienojuma kļūda",
      resErrorCode: 3
    });
  } finally {
    if (client) client.release();
  }
});
router.post("/api/post/grills-latvia/logout", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;

  await pool.query(`DELETE FROM grills_lv_sessions WHERE session_id=$1`, [sessionId]);

  res.clearCookie("session_id", {
    httpOnly: true,
    secure: true,
    sameSite: "none"
  });

  return res.status(200).json({
    resStatus: true,
    resMessage: "Atslēgts",
    resOkCode: 1
  });
});
router.post("/api/post/grills-latvia/toggle-activation/:id", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const adId = req.params.id;
  try {
    // Check if ad exists
    const check = await pool.query(
      "SELECT is_active FROM grills_lv_ads WHERE id = $1 LIMIT 1;",
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
    const newState = !current; // toggle true → false, false → true
    // Update activation state
    const update = await pool.query(
      "UPDATE grills_lv_ads SET is_active = $1, created_at = NOW() WHERE id = $2 RETURNING id;",
      [newState, adId]
    );
    if (!update.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Neizdevās atjaunināt vietas statusu",
        resErrorCode: 2
      });
    }
    return res.status(200).json({
      resStatus: true,
      resMessage: newState ? "Aktivizēts" : "Deaktivizēts",
      resOkCode: 1,
      is_active: newState
    });
  } catch (err) {
    console.error("Toggle error:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Servera kļūda",
      resErrorCode: 3
    });
  }
});
router.post("/api/post/grills-latvia/delete-ad/:id", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
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

    console.error("Delete ad error:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Servera kļūda",
      resErrorCode: 4
    });
  }
});
router.post("/api/post/grills-latvia/ad-view", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
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
    console.error("View save error:", err);
    return res.json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Datu bāzes kļūda"
    });
  }
});
router.post("/api/post/grills-latvia/review", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
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
router.post("/api/post/grills-latvia/reply", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
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
router.post("/api/post/grills-latvia/delete-reply", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
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
router.post("/api/post/grills-latvia/message", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const clean = (v, max) =>
    String(v || "")
      .trim()
      .slice(0, max)
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const name = clean(req.body.name, 40);
  const email = clean(req.body.email, 40);
  const message = clean(req.body.message, 500);
  // length + presence checks
  if (name.length < 2 || email.length < 5 || message.length < 5) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Nederīgi dati"
    });
  }
  // basic email sanity check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.json({
      resStatus: false,
      resErrorCode: 2,
      resMessage: "Nederīgs e-pasts"
    });
  }
  try {
    const d = new Date();
    const visitdate = `${String(d.getDate()).padStart(2, "0")}/${String(
      d.getMonth() + 1
    ).padStart(2, "0")}/${d.getFullYear()}`;
    const insertQ = `
      INSERT INTO messages_grills_lv
        (name, email, message, date)
      VALUES ($1, $2, $3, $4)
    `;
    await pool.query(insertQ, [
      name,
      email,
      message,
      visitdate
    ]);
    return res.json({
      resStatus: true,
      resOkCode: 1
    });
  } catch (err) {
    console.error("Save message error:", err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 2,
      resMessage: "Servera kļūda"
    });
  }
});
router.post("/api/post/grills-latvia/like", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
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
    console.error(err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 99,
      resMessage: "Servera kļūda"
    });
  }
});
router.get("/api/get/grills-latvia/like-status", applyReadRateLimit, async (req, res) => {
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
router.get("/api/get/grills-latvia/reviews/:ad_id", applyReadRateLimit, async (req, res) => {
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
router.get("/api/get/grills-latvia/profile-reviews-ads", applyReadRateLimit, async (req, res) => {
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Nav aktīvas sesijas",
      reviews: []
    });
  }
  try {
    /* get google id from session */
    const sessionQuery = `
      SELECT google_id
      FROM grills_lv_sessions
      WHERE session_id = $1
      LIMIT 1;
    `;
    const sessionRes = await pool.query(sessionQuery, [sessionId]);
    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Nav aktīvas sesijas",
        reviews: []
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    /* reviews + ad data (NO aliases) */
    const reviewsQuery = `
      SELECT
        grills_lv_reviews.id,
        grills_lv_reviews.review_text,
        grills_lv_reviews.rating,
        grills_lv_reviews.date,
        grills_lv_reviews.ad_id,

        grills_lv_ads.name  AS ad_owner_name,
        grills_lv_ads.image_url AS ad_image_url
      FROM grills_lv_reviews
      JOIN grills_lv_ads
        ON grills_lv_ads.id = grills_lv_reviews.ad_id
      WHERE grills_lv_reviews.reviewer_id = $1
        AND grills_lv_reviews.is_deleted = false
        AND grills_lv_reviews.parent IS NULL
      ORDER BY grills_lv_reviews.id DESC;
    `;

    const reviewsRes = await pool.query(reviewsQuery, [googleId]);

    return res.status(200).json({
      resStatus: true,
      resOkCode: 1,
      reviews: reviewsRes.rows
    });

  } catch (err) {
    console.error("Profile reviews fetch error:", err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Servera kļūda",
      reviews: []
    });
  }
});
router.get("/api/get/grills-latvia/profile-replies-ads", applyReadRateLimit, async (req, res) => {
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Nav aktīvas sesijas",
      reviews: []
    });
  }
  try {
    /* get google id from session */
    const sessionQuery = `
      SELECT google_id
      FROM grills_lv_sessions
      WHERE session_id = $1
      LIMIT 1;
    `;

    const sessionRes = await pool.query(sessionQuery, [sessionId]);

    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Nav aktīvas sesijas",
        reviews: []
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    // replies written BY the user 
    const repliesQuery = `
      SELECT
        grills_lv_reviews.id,
        grills_lv_reviews.review_text,
        grills_lv_reviews.date,
        grills_lv_reviews.ad_id,

        grills_lv_ads.name  AS ad_owner_name,
        grills_lv_ads.image_url AS ad_image_url
      FROM grills_lv_reviews
      JOIN grills_lv_ads
        ON grills_lv_ads.id = grills_lv_reviews.ad_id
      WHERE grills_lv_reviews.reviewer_id = $1
        AND grills_lv_reviews.parent IS NOT NULL
        AND grills_lv_reviews.is_deleted = false
      ORDER BY grills_lv_reviews.id DESC;
    `;

    const repliesRes = await pool.query(repliesQuery, [googleId]);

    return res.status(200).json({
      resStatus: true,
      resOkCode: 1,
      reviews: repliesRes.rows
    });

  } catch (err) {
    console.error("Profile replies fetch error:", err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Servera kļūda",
      reviews: []
    });
  }
});
//deletes both reviews of the user and replies of the user.
//reviews of user with reply of the owner is not deleted. It is made hidden.
router.delete("/api/delete/grills-latvia/review/:id", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
 // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  const reviewId = req.params.id;
  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Nav aktīvas sesijas",
      resErrorCode: 1
    });
  }
  if (!reviewId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Trūkst atsauksmes ID",
      resErrorCode: 2
    });
  }
  try {
    /* GET GOOGLE ID FROM SESSION */
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
      return res.status(200).json({
        resStatus: false,
        resMessage: "Nav aktīvas sesijas",
        resErrorCode: 3
      });
    }
    const googleId = sessionRes.rows[0].google_id;
    /* VERIFY OWNERSHIP + GET ad_id */
    const ownershipRes = await pool.query(
      `
      SELECT id, parent, ad_id
      FROM grills_lv_reviews
      WHERE id = $1
        AND reviewer_id = $2
      LIMIT 1;
      `,
      [reviewId, googleId]
    );

    if (!ownershipRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Atsauksme nav atrasta vai nav atļauta",
        resErrorCode: 4
      });
    }
    const { parent, ad_id: adId } = ownershipRes.rows[0];
    /* ---------- DELETE LOGIC ---------- */
    // Reply → hard delete
    if (parent !== null) {
      await pool.query(
        `DELETE FROM grills_lv_reviews WHERE id = $1;`,
        [reviewId]
      );
    } else {
      // Main review → check replies
      const replyRes = await pool.query(
        `
        SELECT 1
        FROM grills_lv_reviews
        WHERE parent = $1
        LIMIT 1;
        `,
        [reviewId]
      );

      if (replyRes.rowCount) {
        // Soft delete review + replies
        await pool.query(
          `
          UPDATE grills_lv_reviews
          SET is_deleted = true
          WHERE id = $1 OR parent = $1;
          `,
          [reviewId]
        );
      } else {
        // Hard delete review
        await pool.query(
          `DELETE FROM grills_lv_reviews WHERE id = $1;`,
          [reviewId]
        );
      }
    }
    /* ---------- RECALCULATE STATS ---------- */
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
    return res.status(200).json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Atsauksme dzēsta"
    });
  } catch (error) {
    console.error("Delete review error:", error);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Datu bāzes kļūda",
      resErrorCode: 5
    });
  }
});
router.get("/api/get/grills-latvia/session-user", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
   // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  // No cookie -> not logged in, but it's not an "error"
  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Nav aktīvas sesijas",
      resErrorCode: 1,
      loggedIn: false
    });
  }

  try {
    const query = `
      SELECT 
        grills_lv_users.google_id,
        grills_lv_users.email,
        grills_lv_users.name
      FROM grills_lv_sessions
      JOIN grills_lv_users
        ON grills_lv_users.google_id = grills_lv_sessions.google_id
      WHERE grills_lv_sessions.session_id = $1
      LIMIT 1;
    `;

    const result = await pool.query(query, [sessionId]);

    if (result.rowCount === 0) {
      // Cookie exists but session not found (expired/invalid)
      return res.status(200).json({
        resStatus: false,
        resMessage: "Nav aktīvas sesijas",
        resErrorCode: 2,
        loggedIn: false
      });
    }

    const user = result.rows[0];

    return res.status(200).json({
      resStatus: true,
      resMessage: "Sesija aktīva",
      resOkCode: 1,
      loggedIn: true,
      user: {
        google_id: user.google_id,
        email: user.email,
        name: user.name
      }
    });

  } catch (error) {
    console.error("Session check error:", error);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Servera kļūda",
      resErrorCode: 3,
      loggedIn: false
    });
  }
});
/*Email register only send email verification link */
router.post("/api/post/grills-latvia/auth/email-register", blockMaliciousIPs, applyWriteRateLimit, validateEmail,
   enforceEmailActionCooldown("email_register"), async (req, res) => {

  const ipVisitor = req.headers["x-forwarded-for"]
    ? req.headers["x-forwarded-for"].split(",")[0]
    : req.socket.remoteAddress || req.ip;

  const clean = (v, max) =>
    String(v || "")
      .trim()
      .slice(0, max)
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const name = clean(req.body.name, 80);
  const email = clean(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || "");
  if (name.length < 2 || email.length < 5 || password.length < 5) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Nederīgi dati"
    });
  }
  if (name.length > 40 || password.length > 40 || email.length > 40) {
    return res.json({
      resStatus: false,
      resErrorCode: 10,
      resMessage: "Nederīgi dati"
    });
  }
  try {
    const checkQ = `
      SELECT google_id
      FROM grills_lv_users
      WHERE email = $1
      LIMIT 1
    `;
    const checkR = await pool.query(checkQ, [email]);
    if (checkR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "E-pasts jau tiek izmantots"
      });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const verifyToken = jwt.sign(
      {
        name,
        email,
        passwordHash,
        ipVisitor,
        auth_provider: "email"
      },
      process.env.JWT_SECRET_GRILSLATVIJA_EMAIL_VERIFY,
      { expiresIn: "24h" }
    );

    const verifyLink = `https://grilslatvija.lv/verify-email.html?token=${encodeURIComponent(verifyToken)}`;
    const brevoResult = await sendEmailBrevo({
      site: "grilslatvija",
      to: email,
      subject: "Apstipriniet savu e-pastu",
      html: `
          <p>Sveiki${name ? `, ${name}` : ""},</p>
          <p>Lai pabeigtu reģistrāciju, lūdzu apstipriniet savu e-pastu, noklikšķinot uz zemāk esošās saites:</p>
          <p><a href="${verifyLink}">Apstiprināt e-pastu</a></p>
          <p>Saite ir derīga 24 stundas.</p>
          <p>Ja jūs to nepieprasījāt, ignorējiet šo ziņojumu.</p>
        `,
        text:
        `Sveiki${name ? `, ${name}` : ""},
          Lai pabeigtu reģistrāciju, atveriet šo saiti:
          ${verifyLink}
          Saite ir derīga 24 stundas.
          Ja jūs to nepieprasījāt, ignorējiet šo ziņojumu.`
    });
    req.emailActionCooldown.registerSuccess();
    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Apstiprinājuma e-pasts nosūtīts"
    });

  } catch (err) {

    return res.status(500).json({
      resStatus: false,
      resErrorCode: 99,
      resMessage: "Servera kļūda"
    });
  }
});
router.post("/api/post/grills-latvia/auth/email-login", blockMaliciousIPs, applyWriteRateLimit, enforceLoginProtection, 
  validateEmail, async (req, res) => {
  
  const clean = (v, max) =>
    String(v || "")
      .trim()
      .slice(0, max)
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const email = clean(req.body.email, 40).toLowerCase();
  const password = String(req.body.password || "");
  if (email.length < 5 || password.length < 6) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Nepareizi pieslēgšanās dati"
    });
  }
  try {
    const userQ = `
      SELECT google_id, email, name, password_hash, auth_provider, email_verified
      FROM grills_lv_users
      WHERE email = $1
      LIMIT 1
    `;
    const userR = await pool.query(userQ, [email]);
    if (!userR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "Nepareizs e-pasts vai parole"
      });
    }
    const user = userR.rows[0];
    if (user.auth_provider !== "email") {
      return res.json({
        resStatus: false,
        resErrorCode: 4,
        resMessage: "Šis e-pasts ir reģistrēts ar Google. Lūdzu, piesakieties ar Google."
      });
    }
    if (!user.password_hash) {
      return res.json({
        resStatus: false,
        resErrorCode: 5,
        resMessage: "Parole nav iestatīta"
      });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.json({
        resStatus: false,
        resErrorCode: 6,
        resMessage: "Nepareizs e-pasts vai parole"
      });
    }
    const sessionId = await createSessionForUser(user.google_id, true);
    res.cookie("session_id", sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 1000 * 60 * 60 * 24 * 365
    });
    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Pieslēgšanās veiksmīga",
      user: {
        google_id: user.google_id,
        email: user.email,
        name: user.name,
        session_id: sessionId
      }
    });
  } catch (err) {
    console.error("Email login error:", err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 99,
      resMessage: "Servera kļūda"
    });
  }
});
router.post("/api/post/grills-latvia/auth/email-forget", blockMaliciousIPs, applyWriteRateLimit, validateEmail, 
  enforceEmailActionCooldown("email_reset"), async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  let client;
  try {
    client = await pool.connect();
    const userQuery = `
      SELECT google_id, email, name, auth_provider
      FROM grills_lv_users
      WHERE LOWER(email) = $1
      LIMIT 1;
    `;
    const userResult = await client.query(userQuery, [email]);
    if (userResult.rows.length === 0) {
      return res.status(200).json({
        resStatus: true,
        resMessage: "Ja e-pasts eksistē, ziņojums tiks nosūtīts",
        resOkCode: 1
      });
    }
    const user = userResult.rows[0];
    //if user has google logged in before, then he cannot reset. He should go to google login.
    if (user.auth_provider !== "email") {
      return res.status(200).json({
        resStatus: false,
        resErrorCode: 6,
        resMessage: "Šis e-pasts tiek izmantots ar Google pieslēgšanos. Lūdzu, piesakieties ar Google."
      });
    }
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour
    const updateQuery = `
      UPDATE grills_lv_users
      SET password_reset_token = $1,
          password_reset_expires = $2
      WHERE google_id = $3
    `;
    await client.query(updateQuery, [resetToken, resetExpires, user.google_id]);
    const resetLink = `https://grilslatvija.lv/reset-password.html?token=${resetToken}`;
    const brevoResult = await sendEmailBrevo({
      site: "grilslatvija",
      to: user.email,
      subject: "Paroles atjaunošana",
      html: `
        <p>Sveiki${user.name ? `, ${user.name}` : ""},</p>
        <p>Lai nomainītu paroli, spiediet uz zemāk esošās saites:</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        <p>Saite ir derīga 1 stundu.</p>
        <p>Ja jūs to nepieprasījāt, ignorējiet šo e-pastu.</p>
      `,
      text:
        `Sveiki${user.name ? `, ${user.name}` : ""},
        Lai nomainītu paroli, atveriet šo saiti:
        ${resetLink}
        Saite ir derīga 1 stundu.
        Ja jūs to nepieprasījāt, ignorējiet šo e-pastu.`
    });
    req.emailActionCooldown.registerSuccess();
    return res.status(200).json({
      resStatus: true,
      resMessage: "Ja e-pasts eksistē, ziņojums tiks nosūtīts",
      resOkCode: 2
    });
  } catch (error) {
    return res.status(500).json({
      resStatus: false,
      resMessage:
        error?.response?.data?.message ||
        error?.message ||
        "Neizdevās nosūtīt e-pastu",
      resErrorCode: 2
    });
  } finally {
    if (client) client.release();
  }
});
router.post("/api/post/grills-latvia/auth/email-reset", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {

  const token = String(req.body.token || "").trim();
  const newPassword = String(req.body.newPassword || "");

  if (!token) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Trūkst atjaunošanas atslēgas",
      resErrorCode: 1
    });
  }

  if (!newPassword || newPassword.length < 6 || newPassword.length > 120) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nepareiza parole",
      resErrorCode: 2
    });
  }

  let client;

  try {
    client = await pool.connect();

    const userQuery = `
      SELECT google_id, email, password_reset_token, password_reset_expires
      FROM grills_lv_users
      WHERE password_reset_token = $1
      LIMIT 1;
    `;
    const userResult = await client.query(userQuery, [token]);

    if (userResult.rows.length === 0) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Nederīga vai nederīga atjaunošanas saite",
        resErrorCode: 3
      });
    }

    const user = userResult.rows[0];

    if (!user.password_reset_expires || new Date(user.password_reset_expires) < new Date()) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Atjaunošanas saite vairs nav derīga",
        resErrorCode: 4
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    const updateQuery = `
      UPDATE grills_lv_users
      SET password_hash = $1,
          password_reset_token = NULL,
          password_reset_expires = NULL
      WHERE google_id = $2
    `;
    await client.query(updateQuery, [newPasswordHash, user.google_id]);

    return res.status(200).json({
      resStatus: true,
      resMessage: "Parole veiksmīgi atjaunināta",
      resOkCode: 1
    });

  } catch (error) {
    console.error("[email-reset] full error:", error);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Neizdevās atjaunināt paroli",
      resErrorCode: 5
    });
  } finally {
    if (client) client.release();
  }
});
//email-verify creates the user
router.post("/api/post/grills-latvia/auth/email-verify", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {

  const token = String(req.body.token || "").trim();

  if (!token) {
    return res.status(400).json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Trūkst apstiprinājuma atslēgas."
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET_GRILSLATVIJA_EMAIL_VERIFY
    );

    const { name, email, passwordHash, ipVisitor, auth_provider } = decoded;

    const checkQ = `
      SELECT google_id
      FROM grills_lv_users
      WHERE email = $1
      LIMIT 1
    `;
    const checkR = await pool.query(checkQ, [email]);

    if (checkR.rowCount) {

      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Konts jau eksistē."
      });
    }

    const generateEmailGoogleId = () => {
      let out = "9";
      while (out.length < 21) {
        out += Math.floor(Math.random() * 10);
      }
      return out;
    };

    let googleId;
    let exists = true;
    let attempts = 0;

    while (exists) {
      attempts += 1;
      googleId = generateEmailGoogleId();

      const r = await pool.query(
        `SELECT google_id FROM grills_lv_users WHERE google_id = $1 LIMIT 1`,
        [googleId]
      );

      exists = r.rowCount > 0;

      if (attempts > 20) {
        throw new Error("Could not generate unique google_id");
      }
    }

    const today = new Date().toISOString().slice(0, 10);

    const insertQ = `
      INSERT INTO grills_lv_users
      (google_id, email, name, date, ip, auth_provider, password_hash, email_verified)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true)
      RETURNING google_id
    `;

    const insertR = await pool.query(insertQ, [
      googleId,
      email,
      name,
      today,
      ipVisitor,
      auth_provider || "email",
      passwordHash
    ]);
    const dbGoogleId = insertR.rows[0].google_id;
    const sessionId = await createSessionForUser(dbGoogleId, true);

    res.cookie("session_id", sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 1000 * 60 * 60 * 24 * 365
    });

    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "E-pasts apstiprināts.",
      user: {
        google_id: dbGoogleId,
        email,
        name,
        session_id: sessionId
      }
    });

  } catch (err) {

    if (err.name === "TokenExpiredError") {
      return res.status(400).json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "Apstiprinājuma saite vairs nav derīga."
      });
    }
    if (err.name === "JsonWebTokenError") {
      return res.status(400).json({
        resStatus: false,
        resErrorCode: 4,
        resMessage: "Nederīga apstiprinājuma atslēga."
      });
    }
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 99,
      resMessage: "Servera kļūda."
    });
  }
});

router.get("/api/get/grills-latvia/ad/:id", applyReadRateLimit, async (req, res) => {
  const adId = req.params.id;
  console.log("[grills-latvia/ad] GET request, adId:", adId);
  try {
    const q = `
      SELECT 
        id, name, description, price, city, date, views,
        image_url, google_id, location,
        average_rating, reviews_count
      FROM grills_lv_ads
      WHERE id = $1
      LIMIT 1
    `;
    const r = await pool.query(q, [adId]);
    console.log("[grills-latvia/ad] DB rowCount:", r.rowCount);
    if (!r.rowCount) {
      console.log("[grills-latvia/ad] Ad not found for id:", adId);
      return res.json({
        resStatus: false,
        resErrorCode: 1,
        resMessage: "Vieta nav atrasta"
      });
    }

    const ad = r.rows[0];
    console.log("[grills-latvia/ad] ad.city:", ad.city, "| type:", typeof ad.city, "| isArray:", Array.isArray(ad.city));
    console.log("[grills-latvia/ad] ad.image_url:", ad.image_url, "| type:", typeof ad.image_url);
    console.log("[grills-latvia/ad] ad raw:", JSON.stringify(ad));

    const cityArr = Array.isArray(ad.city)
      ? ad.city
      : typeof ad.city === "string"
        ? JSON.parse(ad.city)
        : [];
    const region = cityArr[0];
    console.log("[grills-latvia/ad] region:", region);
    let newerId = null;
    let olderId = null;

    if (region !== undefined) {
      const newerQ = `
        SELECT id FROM grills_lv_ads
        WHERE id > $1
          AND city::jsonb @> $2::jsonb
        ORDER BY id ASC
        LIMIT 1
      `;
      const olderQ = `
        SELECT id FROM grills_lv_ads
        WHERE id < $1
          AND city::jsonb @> $2::jsonb
        ORDER BY id DESC
        LIMIT 1
      `;
      const newerR = await pool.query(newerQ, [adId, JSON.stringify([region])]);
      const olderR = await pool.query(olderQ, [adId, JSON.stringify([region])]);
      newerId = newerR.rows[0]?.id || null;
      olderId = olderR.rows[0]?.id || null;
      console.log("[grills-latvia/ad] region-based newerId:", newerId, "| olderId:", olderId);
    } else {
      console.log("[grills-latvia/ad] region undefined, skipping region-based nav");
    }

    if (!newerId) {
      const r = await pool.query(
        `SELECT id FROM grills_lv_ads WHERE id > $1 ORDER BY id ASC LIMIT 1`,
        [adId]
      );
      newerId = r.rows[0]?.id || null;
      console.log("[grills-latvia/ad] fallback newerId:", newerId);
    }
    if (!olderId) {
      const r = await pool.query(
        `SELECT id FROM grills_lv_ads WHERE id < $1 ORDER BY id DESC LIMIT 1`,
        [adId]
      );
      olderId = r.rows[0]?.id || null;
      console.log("[grills-latvia/ad] fallback olderId:", olderId);
    }

    console.log("[grills-latvia/ad] sending response, newerId:", newerId, "| olderId:", olderId);
    return res.json({
      resStatus: true,
      resOkCode: 1,
      ad,
      newerId,
      olderId
    });

  } catch (err) {
    console.error("[grills-latvia/ad] error:", err.message);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 2,
      resMessage: "Servera kļūda"
    });
  }
});
router.get("/api/get/grills-latvia/user-ads", applyReadRateLimit, async (req, res) => {
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

  const sessionId = req.cookies?.session_id || bearerSid;
  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Nav aktīvas sesijas",
      resErrorCode: 1,
      ads: []
    });
  }
  try {
    // find google_id from session
    const sessionQuery = `
      SELECT google_id
      FROM grills_lv_sessions
      WHERE session_id = $1
      LIMIT 1;
    `;
    const sessionRes = await pool.query(sessionQuery, [sessionId]);
    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Nav aktīvas sesijas",
        resErrorCode: 2,
        ads: []
      });
    }
    const googleId = sessionRes.rows[0].google_id;
    // fetch ads for this user
    const adsQuery = `
      SELECT 
        id, 
        description, 
        price, 
        city, 
        image_url, 
        date,
        created_at,      
        is_active       
      FROM grills_lv_ads
      WHERE google_id = $1
      ORDER BY date DESC, id DESC;
    `;
    const adsRes = await pool.query(adsQuery, [googleId]);
    return res.status(200).json({
      resStatus: true,
      resMessage: "Ielādētas vietas",
      resOkCode: 1,
      ads: adsRes.rows
    });
  } catch (error) {
    console.error("User ads fetch error:", error);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Servera kļūda",
      resErrorCode: 3,
      ads: []
    });
  }
});
router.get("/api/get/grills-latvia/search", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
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
        AND (description ILIKE $1)
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
        AND (description ILIKE $1)
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
router.get("/api/get/grills-latvia/search-filter", applyReadRateLimit, blockMaliciousIPs, async (req, res) => {
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
    conditions.push(`a.description ILIKE $${i}`);
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
router.get("/api/get/grills-latvia/index-filter", applyReadRateLimit, blockMaliciousIPs, async (req, res) => {
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
router.get("/api/get/grills-latvia/map-postings", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
    let client;
    try {
      const ipVisitor = req.headers["x-forwarded-for"]
        ? req.headers["x-forwarded-for"].split(",")[0]
        : req.socket.remoteAddress || req.ip;
      console.log("[grills-latvia/map-postings] GET request from IP:", ipVisitor);
      client = await pool.connect();
      const query = `
        SELECT
          id,
          name,
          description,
          price,
          city,
          location,
          image_url
        FROM grills_lv_ads
        WHERE is_active = true
          AND location IS NOT NULL
        ORDER BY id DESC
        LIMIT 1000
      `;
      const result = await client.query(query);
      console.log(
        "[grills-latvia/map-postings] Postings loaded:",
        result.rowCount
      );
      return res.status(200).json({
        resStatus: true,
        postings: result.rows
      });
    } catch (err) {
      console.log(
        "[grills-latvia/map-postings] Server error:",
        err.message
      );
      return res.status(500).json({
        resStatus: false,
        resMessage: "Servera kļūda",
        resErrorCode: 1
      });
    } finally {
      if (client) client.release();
    }
  }
);
router.get("/api/get/grills-latvia/homepage/carousel", async (req, res) => {
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
    console.error("CAROUSEL FETCH ERROR:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Neizdevās ielādēt karuseli",
      resErrorCode: 2
    });
  }
});


module.exports = router;