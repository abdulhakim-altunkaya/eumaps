const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { pool, supabase, upload } = require("../db");
const useragent = require("useragent");
const axios = require("axios");
const sendEmailBrevo = require("../utils/sendEmailBrevo");

const { OAuth2Client } = require("google-auth-library");
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const { 
  extractClientIP,
  blockMaliciousIPs,
  applyReadRateLimit, 
  applyWriteRateLimit,
  enforceAdPostingCooldown,
  checkLogCooldown
} = require("../middleware/masters_MW");

//This object is used to prevent one IP address from increasing/bloating 
//the views count of any ad by visiting that page multiple times. We count only true views. 
//Used only by "/post/ad-view" endpoint
const visitCacheLT = {};


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


router.post("/post/save-visitor", checkLogCooldown(3 * 60 * 1000), async (req, res) => {
  // silently skip if throttled
  if (!req.shouldLogVisit) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Laukimo laikas suaktyvintas arba registravimas praleistas",
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
      INSERT INTO visitors_masters_lt (
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
      resMessage: "Lankytojo registravimas sėkmingas",
      resOkCode: 1
    });
  } catch (err) {
    console.error("Visitor log error (Masters LT):", err);
    return res.status(200).json({
      resStatus: false,
      resMessage: "Lankytojo registravimas nepavyko - vidinė klaida",
      resErrorCode: 2
    });
  } finally {
    if (client) client.release();
  }
});
router.post("/post/ads", blockMaliciousIPs, enforceAdPostingCooldown, applyWriteRateLimit,
  upload.array("images", 5), async (req, res) => {
  console.log("[post-ads] route reached");

  const MIN_IMAGE_SIZE = 2 * 1024;
  const MAX_IMAGE_SIZE = 1.9 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp"
  ];

  const ipVisitor = req.headers["x-forwarded-for"]
    ? req.headers["x-forwarded-for"].split(",")[0]
    : req.socket.remoteAddress || req.ip;

  console.log("[post-ads] ipVisitor:", ipVisitor);

  let client;
  let formData;

  /* -------------------------------------------
     PARSE JSON FORM DATA
  ------------------------------------------- */
  try {
    console.log("[post-ads] req.body keys:", Object.keys(req.body || {}));
    console.log("[post-ads] req.files length before parse:", req.files?.length || 0);

    formData = JSON.parse(req.body.formData);
    console.log("[post-ads] formData parsed successfully:", formData);
  } catch (err) {
    console.error("[post-ads] formData parse error:", err);
    return res.status(400).json({
      resStatus: false,
      resMessage: "Netinkami formos duomenys",
      resErrorCode: 1
    });
  }

  const {
    inputService,
    inputName,
    inputPrice,
    inputDescription,
    countryCode,
    phoneNumber,
    inputRegions,
    main_group,
    sub_group
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

  console.log("[post-ads] validation values:", {
    inputService,
    inputNameLength: inputName?.length,
    inputPriceLength: inputPrice?.length,
    inputDescriptionLength: inputDescription?.length,
    countryCode,
    phoneNumber,
    inputRegionsLength: Array.isArray(inputRegions) ? inputRegions.length : "not-array",
    main_group,
    sub_group
  });

  if (!inputService || !inputName || !inputPrice || !inputDescription || !phoneNumber) {
    console.log("[post-ads] validation failed: missing required fields");
    return res.status(400).json({
      resStatus: false,
      resMessage: "Neužpildyti privalomi laukai",
      resErrorCode: 2
    });
  }

  const mainVal = Number(main_group);
  if (isNaN(mainVal) || mainVal < 1 || mainVal > 10) {
    console.log("[post-ads] validation failed: invalid main_group", main_group);
    return res.status(400).json({
      resStatus: false,
      resMessage: "Pagrindinė kategorija už leidžiamo diapazono ribų",
      resErrorCode: 3
    });
  }

  const subVal = Number(sub_group);
  if (isNaN(subVal) || subVal < 1 || subVal > 10) {
    console.log("[post-ads] validation failed: invalid sub_group", sub_group);
    return res.status(400).json({
      resStatus: false,
      resMessage: "Pokategoris už leidžiamo diapazono ribų",
      resErrorCode: 4
    });
  }

  if (phoneNumber.trim().length < 7 || phoneNumber.trim().length > 12) {
    console.log("[post-ads] validation failed: invalid phone length", phoneNumber?.trim()?.length);
    return res.status(400).json({
      resStatus: false,
      resMessage: "Neteisingas telefono numerio ilgis",
      resErrorCode: 8
    });
  }

  if (!Array.isArray(inputRegions) || inputRegions.length === 0) {
    console.log("[post-ads] validation failed: no regions");
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nepasirinkta regionų",
      resErrorCode: 9
    });
  }

  if (inputName.length < 5 || inputName.length > 19) {
    console.log("[post-ads] validation failed: inputName length", inputName.length);
    return res.status(400).json({
      resStatus: false,
      resMessage: "Vardas per ilgas arba per trumpas",
      resErrorCode: 10
    });
  }

  if (inputPrice.length < 1 || inputPrice.length > 15) {
    console.log("[post-ads] validation failed: inputPrice length", inputPrice.length);
    return res.status(400).json({
      resStatus: false,
      resMessage: "Kaina per ilga arba per trumpa",
      resErrorCode: 11
    });
  }

  if (inputDescription.length < 50 || inputDescription.length > 1000) {
    console.log("[post-ads] validation failed: inputDescription length", inputDescription.length);
    return res.status(400).json({
      resStatus: false,
      resMessage: "Aprašymas per ilgas arba per trumpas",
      resErrorCode: 12
    });
  }

  /* -------------------------------------------
     SESSION VALIDATION
  ------------------------------------------- */
  try {
    console.log("[post-ads] session validation start");
    console.log("[post-ads] cookies:", req.cookies);
    console.log("[post-ads] auth header:", req.headers.authorization);

    const auth = req.headers.authorization || "";
    const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    const sessionId = req.cookies?.session_id || bearerSid;

    console.log("[post-ads] resolved sessionId:", sessionId);

    if (!sessionId) {
      console.log("[post-ads] no sessionId found");
      return res.status(401).json({
        resStatus: false,
        resMessage: "Prisijunkite, kad tęstumėte",
        resErrorCode: 13
      });
    }

    const userRes = await pool.query(
      `SELECT google_id FROM masters_lt_sessions WHERE session_id = $1 LIMIT 1`,
      [sessionId]
    );

    console.log("[post-ads] session query rowCount:", userRes.rowCount);
    console.log("[post-ads] session query rows:", userRes.rows);

    if (!userRes.rowCount) {
      console.log("[post-ads] invalid session");
      return res.status(401).json({
        resStatus: false,
        resMessage: "Netinkama sesija",
        resErrorCode: 14
      });
    }

    const googleId = userRes.rows[0].google_id;
    console.log("[post-ads] resolved googleId:", googleId);

    /* -------------------------------------------
        1 ad per subsection
        5 ads total 
    ------------------------------------------- */
    try {
      console.log("[post-ads] ad-limit checks start");
      client = await pool.connect();

      const userAdNumberCheck = await client.query(
        "SELECT number_ads FROM masters_lt_users WHERE google_id = $1",
        [googleId]
      );

      console.log("[post-ads] userAdNumberCheck rows:", userAdNumberCheck.rows);

      if (userAdNumberCheck.rows[0]?.number_ads >= 5) {
        console.log("[post-ads] total ad limit reached");
        return res.status(403).json({
          resStatus: false,
          resMessage: "Pasiektas skelbimų skaičius (maksimalus 5)",
          resErrorCode: 15
        });
      }

      const existingAdCheck = await client.query(
        `SELECT id FROM masters_lt_ads 
        WHERE google_id = $1 AND main_group = $2 AND sub_group = $3 
        LIMIT 1`,
        [googleId, mainVal, subVal]
      );

      console.log("[post-ads] existingAdCheck rowCount:", existingAdCheck.rowCount);
      console.log("[post-ads] existingAdCheck rows:", existingAdCheck.rows);

      if (existingAdCheck.rowCount > 0) {
        console.log("[post-ads] subsection ad already exists");
        return res.status(403).json({
          resStatus: false,
          resMessage: "Šiame pokategoryje jau turite aktyvų skelbimą",
          resErrorCode: 16
        });
      }
    } catch (err) {
      console.error("[post-ads] ad-limit check ERROR object:", err);
      console.error("[post-ads] ad-limit check ERROR message:", err?.message);
      console.error("[post-ads] ad-limit check ERROR stack:", err?.stack);
      return res.status(500).json({
        resStatus: false,
        resMessage: "Sistemos klaida. Bandykite dar kartą vėliau",
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
    console.log("[post-ads] files received:", files?.length || 0);

    if (!files || files.length < 1 || files.length > 5) {
      console.log("[post-ads] image validation failed: files count invalid");
      return res.status(400).json({
        resStatus: false,
        resMessage: "Reikalingi 1–5 vaizdai",
        resErrorCode: 17
      });
    }

    let uploadedImages = [];
    for (const f of files) {
      console.log("[post-ads] checking file:", {
        mimetype: f.mimetype,
        size: f.size,
        originalname: f.originalname
      });

      if (!ALLOWED_IMAGE_TYPES.includes(f.mimetype)) {
        console.log("[post-ads] invalid image type:", f.mimetype);
        return res.status(400).json({
          resStatus: false,
          resMessage: "Netinkamas failo formatas",
          resErrorCode: 18
        });
      }

      if (f.size < MIN_IMAGE_SIZE) {
        console.log("[post-ads] image too small:", f.size);
        return res.status(400).json({
          resStatus: false,
          resMessage: "Vaizdo failas sugadintas arba tuščias",
          resErrorCode: 19
        });
      }

      if (f.size > MAX_IMAGE_SIZE) {
        console.log("[post-ads] image too large:", f.size);
        return res.status(400).json({
          resStatus: false,
          resMessage: "Vaizdas per didelis (maks. 1,8 MB)",
          resErrorCode: 20
        });
      }

      const fileName = makeSafeName();
      console.log("[post-ads] uploading file to supabase:", fileName);

      const { error } = await supabase.storage
        .from("masters_latvia_storage")
        .upload(fileName, f.buffer, { contentType: f.mimetype });

      if (error) {
        console.error("[post-ads] supabase upload error:", error);
        return res.status(503).json({
          resStatus: false,
          resMessage: "Vaizdo įkėlimas nepavyko",
          resErrorCode: 21
        });
      }

      uploadedImages.push(
        `${process.env.SUPABASE_URL}/storage/v1/object/public/masters_latvia_storage/${fileName}`
      );
    }

    console.log("[post-ads] uploadedImages:", uploadedImages);

    /* -------------------------------------------
       DATABASE INSERT
    ------------------------------------------- */
    try {
      console.log("[post-ads] final DB insert start");
      client = await pool.connect();

      const insertQuery = `
        INSERT INTO masters_lt_ads 
        (name, title, description, price, city, telephone, image_url, ip, date,
         main_group, sub_group, google_id, update_date,
         created_at, is_active)
        VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, $13, $14,
         $15)
        RETURNING id
      `;

      const values = [
        cleanInputName,
        inputService,
        cleanInputDescription,
        cleanInputPrice,
        JSON.stringify(inputRegions),
        Number(countryCode + phoneNumber),
        JSON.stringify(uploadedImages),
        ipVisitor,
        new Date().toISOString().slice(0, 10),
        main_group,
        sub_group,
        googleId,
        new Date().toISOString().slice(0, 10),
        new Date(),
        true
      ];

      console.log("[post-ads] insert values preview:", {
        cleanInputName,
        inputService,
        cleanInputDescriptionLength: cleanInputDescription?.length,
        cleanInputPrice,
        inputRegions,
        telephone: Number(countryCode + phoneNumber),
        uploadedImagesLength: uploadedImages.length,
        ipVisitor,
        main_group,
        sub_group,
        googleId
      });

      const result = await client.query(insertQuery, values);
      console.log("[post-ads] insert result rowCount:", result.rowCount);
      console.log("[post-ads] insert result rows:", result.rows);

      if (!result.rowCount) {
        console.log("[post-ads] insert returned no rows");
        return res.status(503).json({
          resStatus: false,
          resMessage: "Duomenų išsaugojimas nepavyko",
          resErrorCode: 22
        });
      }

      console.log("[post-ads] updating masters_lt_users.number_ads");

      await client.query(
        "UPDATE masters_lt_users SET number_ads = COALESCE(number_ads, 0) + 1 WHERE google_id = $1",
        [googleId]
      );

      console.log("[post-ads] ad saved successfully");

      return res.status(201).json({
        resStatus: true,
        resMessage: "Skelbimas išsaugotas",
        resOkCode: 1
      });

    } catch (err) {
      console.error("[post-ads] final insert ERROR object:", err);
      console.error("[post-ads] final insert ERROR message:", err?.message);
      console.error("[post-ads] final insert ERROR stack:", err?.stack);
      return res.status(503).json({
        resStatus: false,
        resMessage: "Serverio klaida",
        resErrorCode: 23
      });

    } finally {
      if (client) client.release();
    }

  } catch (err) {
    console.error("[post-ads] outer ERROR object:", err);
    console.error("[post-ads] outer ERROR message:", err?.message);
    console.error("[post-ads] outer ERROR stack:", err?.stack);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Serverio klaida",
      resErrorCode: 24
    });
  }
});
router.put("/put/update-ad/:id", blockMaliciousIPs, enforceAdPostingCooldown, applyWriteRateLimit, 
  upload.array("images", 5), async (req, res) => {
  const adId = req.params.id;
  const MIN_IMAGE_SIZE = 2 * 1024;           // 2 KB
  const MAX_IMAGE_SIZE = 1.9 * 1024 * 1024;  // 1.8 MB. Normally I should say 1.8 but just give some
  //error room to the frontend here I am saying 1.9
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
      resMessage: "Prašome prisijungti",
      resErrorCode: 1
    });
  }
  try {
    const userQ = await pool.query(
      `SELECT google_id 
       FROM masters_lt_sessions 
       WHERE session_id = $1 
       LIMIT 1`,
      [sessionId]
    );
    if (!userQ.rowCount) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Netinkama sesija",
        resErrorCode: 2
      });
    }
    const googleId = userQ.rows[0].google_id;
    /* -------------------------------
       CHECK IF AD BELONGS TO USER
    --------------------------------*/
    const adQ = await pool.query(
      `SELECT image_url, google_id 
       FROM masters_lt_ads 
       WHERE id = $1 
       LIMIT 1`,
      [adId]
    );
    if (!adQ.rowCount) {
      return res.json({
        resStatus: false,
        resMessage: "Skelbimas neegzistuoja",
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
        resMessage: "Netinkami formos duomenys",
        resErrorCode: 5
      });
    }

    const {
      inputService,
      inputName,
      inputPrice,
      inputDescription,
      countryCode,
      phoneNumber,
      inputRegions,
      main_group,
      sub_group,
      existingImages
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

  if (!inputService || !inputName || !inputPrice || !inputDescription || !phoneNumber) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Užpildykite privalomus laukus",
      resErrorCode: 6
    });
  }
  if (phoneNumber.trim().length < 7 || phoneNumber.trim().length > 12) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Telefono numeris per ilgas arba per trumpas",
      resErrorCode: 10
    });
  }
  if (!Array.isArray(inputRegions) || inputRegions.length === 0) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Regionai nepasirinkti",
      resErrorCode: 11
    });
  }
  if (inputName.length < 5 || inputName.length > 19) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Vardas per ilgas arba per trumpas",
      resErrorCode: 12
    });
  }
  const mainVal = Number(main_group);
  if (isNaN(mainVal) || mainVal < 1 || mainVal > 10) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Pagrindinė kategorija už leidžiamo diapazono ribų",
      resErrorCode: 13
    });
  }
  const subVal = Number(sub_group);
  if (isNaN(subVal) || subVal < 1 || subVal > 10) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Pokategoris už leidžiamo diapazono ribų",
      resErrorCode: 14
    });
  }
  if (inputPrice.length < 1 || inputPrice.length > 15) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Kaina per ilga arba per trumpa",
      resErrorCode: 15
    });
  }
  if (inputDescription.length < 50 || inputDescription.length > 1000) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Aprašymas per ilgas arba per trumpas",
      resErrorCode: 16
    });
  }
  /* -------------------------------
      CHECK SUBSECTION LIMIT (1 AD PER SUB)
  --------------------------------*/
  try {
    // We look for any OTHER ad (id != adId) in this same category
    const existingAdCheck = await pool.query(
      `SELECT id FROM masters_lt_ads 
        WHERE google_id = $1 AND main_group = $2 AND sub_group = $3 AND id != $4
        LIMIT 1`,
      [googleId, mainVal, subVal, adId]
    );

    if (existingAdCheck.rowCount > 0) {
      return res.status(403).json({
        resStatus: false,
        resMessage: "Šiame pokategoryje jau turite aktyvų skelbimą",
        resErrorCode: 17
      });
    }
  } catch (dbErr) {
    console.error("SUBSECTION CHECK ERROR:", dbErr);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Sistemos klaida tikrinant kategorijų apribojimus",
      resErrorCode: 18
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
            resMessage: "Vaizdo failo tipas netinkamas",
            resErrorCode: 19
          });
        }
        if (f.size < MIN_IMAGE_SIZE) {
          return res.status(400).json({
            resStatus: false,
            resMessage: "Vaizdo failas sugadintas arba tuščias",
            resErrorCode: 20
          });
        }
        if (f.size > MAX_IMAGE_SIZE) {
          return res.status(400).json({
            resStatus: false,
            resMessage: "Per didelis vaizdas (maks. 1,8 MB)",
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
            resMessage: "Vaizdo įkėlimas nepavyko",
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
      UPDATE masters_lt_ads 
      SET 
        name        = $1,
        title       = $2,
        description = $3,
        price       = $4,
        city        = $5,
        telephone   = $6,
        image_url   = $7,
        main_group  = $8,
        sub_group   = $9,
        update_date = $10
      WHERE id = $11 AND google_id = $12
      RETURNING id
    `;

    const values = [
      cleanInputName,
      inputService,
      cleanInputDescription,
      cleanInputPrice,
      JSON.stringify(inputRegions),
      Number(countryCode + phoneNumber),
      JSON.stringify(finalImages),
      main_group,
      sub_group,
      new Date().toISOString().slice(0, 10),
      adId,
      googleId
    ];

    const result = await pool.query(updateQ, values);

    if (!result.rowCount) {
      return res.json({
        resStatus: false,
        resMessage: "Klaida atnaujinant",
        resErrorCode: 23
      });
    }

    return res.json({
      resStatus: true,
      resMessage: "Pakeitimai išsaugoti",
      resOkCode: 1
    });

  } catch (err) {
    console.error("UPDATE ERROR:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Serverio klaida",
      resErrorCode: 24
    });
  }
});
//this function below is for google auth login of latvia masters
async function createSessionForUser(dbGoogleId) {
  const sessionId = crypto.randomUUID(); // generate inline
  await pool.query(
    `INSERT INTO masters_lt_sessions (session_id, google_id) VALUES ($1, $2)`,
    [sessionId, dbGoogleId]
  );
  return sessionId;
}
router.post("/post/auth/google", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const ipVisitor = req.headers["x-forwarded-for"] ? req.headers["x-forwarded-for"].split(",")[0]
    : req.socket.remoteAddress || req.ip;
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Trūksta Google žetono",
      resErrorCode: 4
    });
  }
  let client;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name } = payload;
    client = await pool.connect();
    const query = `
      INSERT INTO masters_lt_users (google_id, email, name, date, ip)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (google_id)
      DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
      RETURNING google_id;
    `;
    const values = [ googleId, email, name, new Date().toISOString().slice(0, 10), ipVisitor ];
    const result = await client.query(query, values);

    const dbGoogleId = result.rows[0].google_id;

    const sessionId = await createSessionForUser(dbGoogleId);
    res.cookie("session_id", sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 1000 * 60 * 60 * 24 * 7
    });
    return res.status(200).json({
      resStatus: true,
      resMessage: "Vartotojas autentifikuotas",
      resOkCode: 1,
      user: { google_id: dbGoogleId, email, name, session_id: sessionId }
    });

  } catch (error) {
    console.error("Google Auth Error Backend:", error);
    if (error.message?.includes("Invalid") || error.message?.includes("JWT")) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Netinkamas Google žetonas",
        resErrorCode: 2
      });
    }
    return res.status(500).json({
      resStatus: false,
      resMessage: "Duomenų bazės ryšio klaida",
      resErrorCode: 3
    });
  } finally {
    if (client) client.release();
  }
});
router.post("/post/logout", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;

  await pool.query(`DELETE FROM masters_lt_sessions WHERE session_id=$1`, [sessionId]);

  res.clearCookie("session_id", {
    httpOnly: true,
    secure: true,
    sameSite: "none"
  });

  return res.status(200).json({
    resStatus: true,
    resMessage: "Atsijungta",
    resOkCode: 1
  });
});
router.post("/post/toggle-activation/:id", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const adId = req.params.id;
  try {
    // Check if ad exists
    const check = await pool.query(
      "SELECT is_active FROM masters_lt_ads WHERE id = $1 LIMIT 1;",
      [adId]
    );
    if (!check.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Skelbimas nerastas",
        resErrorCode: 1
      });
    }
    const current = check.rows[0].is_active;
    const newState = !current; // toggle true → false, false → true
    // Update activation state
    const update = await pool.query(
      "UPDATE masters_lt_ads SET is_active = $1, created_at = NOW() WHERE id = $2 RETURNING id;",
      [newState, adId]
    );
    if (!update.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Nepavyko atnaujinti skelbimo aktyvavimo būsenos",
        resErrorCode: 2
      });
    }
    return res.status(200).json({
      resStatus: true,
      resMessage: newState ? "Skelbimas aktyvuotas" : "Skelbimas deaktyvuotas",
      resOkCode: 1,
      is_active: newState
    });
  } catch (err) {
    console.error("Toggle error:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Serverio klaida",
      resErrorCode: 3
    });
  }
});





router.post("/post/delete-ad/:id", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const adId = req.params.id;
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  if (!sessionId) {
    return res.status(401).json({
      resStatus: false,
      resMessage: "Nėra aktyvios sesijos",
      resErrorCode: 1
    });
  }
  try {
    /* ---------- SESSION VALIDATION ---------- */
    const sessionRes = await pool.query(
      `
      SELECT google_id
      FROM masters_lt_sessions
      WHERE session_id = $1
      LIMIT 1;
      `,
      [sessionId]
    );

    if (!sessionRes.rowCount) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Netinkama sesija",
        resErrorCode: 2
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    /* ---------- VERIFY OWNERSHIP + GET IMAGES ---------- */
    const adRes = await pool.query(
      `
      SELECT image_url
      FROM masters_lt_ads
      WHERE id = $1 AND google_id = $2
      LIMIT 1;
      `,
      [adId, googleId]
    );

    if (!adRes.rowCount) {
      return res.status(403).json({
        resStatus: false,
        resMessage: "Neleidžiama ištrinti šio skelbimo",
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
      `DELETE FROM masters_lt_reviews WHERE ad_id = $1;`,
      [adId]
    );

    // Hard delete ad
    await pool.query(
      `DELETE FROM masters_lt_ads WHERE id = $1;`,
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
      resMessage: "Skelbimas ir susiję atsiliepimai ištrinti",
      resOkCode: 1
    });

  } catch (err) {
    await pool.query("ROLLBACK");

    console.error("Delete ad error:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Serverio klaida",
      resErrorCode: 4
    });
  }
});
router.post("/post/ad-view", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const { ad_id } = req.body;

  if (!ad_id) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Trūksta ad_id"
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

  if (!visitCacheLT[ipVisitor]) visitCacheLT[ipVisitor] = {};
  if (!visitCacheLT[ipVisitor][ad_id]) visitCacheLT[ipVisitor][ad_id] = 0;

  const lastView = visitCacheLT[ipVisitor][ad_id];

  if (now - lastView < COOLDOWN) {
    return res.json({
      resStatus: true,
      resOkCode: 2,
      resMessage: "Peržiūra ignoruota (laukimo laikas)"
    });
  }

  visitCacheLT[ipVisitor][ad_id] = now;

  try {
    await pool.query(
      "UPDATE masters_lt_ads SET views = views + 1 WHERE id = $1",
      [ad_id]
    );

    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Peržiūra įrašyta"
    });

  } catch (err) {
    console.error("View save error:", err);
    return res.json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Duomenų bazės klaida"
    });
  }
});
router.post("/post/review", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
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
      resMessage: "Netinkami arba trūkstami laukai"
    });
  }
  if (rating < 0 || rating > 10) {
    return res.json({
      resStatus: false,
      resErrorCode: 6,
      resMessage: "Netinkama įvertinimo vertė"
    });
  }
  try {
    /* ---------- SESSION LOOKUP ---------- */
    const sessionResult = await pool.query(
      `
      SELECT google_id
      FROM masters_lt_sessions
      WHERE session_id = $1
      LIMIT 1
      `,
      [sessionId]
    );
    if (!sessionResult.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Neautentifikuotas"
      });
    }
    const reviewer_google_id = sessionResult.rows[0].google_id;

    /* ---------- BLOCK SELF-REVIEW ---------- */
    const adOwnerCheck = await pool.query(
      `SELECT google_id FROM masters_lt_ads WHERE id = $1 LIMIT 1`,
      [adId]
    );
    // If the ad exists and the owner is the same as the reviewer
    if (adOwnerCheck.rows[0]?.google_id === reviewer_google_id) {
      return res.json({
        resStatus: false,
        resErrorCode: 7, // New error code for self-review
        resMessage: "Negalite vertinti savo skelbimo"
      });
    }

    /* ---------- BLOCK DUPLICATE ACTIVE REVIEW ---------- */
    const activeReviewCheck = await pool.query(
      `
      SELECT 1
      FROM masters_lt_reviews
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
        resMessage: "Jau paskelbėte atsiliepimą šiam skelbimui"
      });
    }
    /* ---------- BLOCK RE-POST AFTER SOFT DELETE ---------- */
    const deletedWithReplyCheck = await pool.query(
      `
      SELECT 1
      FROM masters_lt_reviews
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
          "Negalite skelbti kito atsiliepimo šiam skelbimui po to, kai savininkas atsakė į jūsų ankstesnį"
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
      INSERT INTO masters_lt_reviews
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
      UPDATE masters_lt_ads
      SET
        average_rating = COALESCE(sub.avg, 0),
        reviews_count  = COALESCE(sub.cnt, 0)
      FROM (
        SELECT
          ROUND(AVG(rating), 1) AS avg,
          COUNT(*) AS cnt
        FROM masters_lt_reviews
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
      resMessage: "Atsiliepimas išsaugotas",
      review_id: insertReviewResult.rows[0].id
    });
  } catch (error) {
    console.error("Post review error:", error);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 99,
      resMessage: "Serverio klaida"
    });
  }
});
router.post("/post/reply", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
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
      resMessage: "Trūksta laukų"
    });
  }

  try {
    // 1️⃣ get google_id from session
    const sessionQ = `
      SELECT google_id
      FROM masters_lt_sessions
      WHERE session_id = $1
      LIMIT 1
    `;
    const sessionR = await pool.query(sessionQ, [sessionId]);

    if (!sessionR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Netinkama sesija"
      });
    }

    const ownerGoogleId = sessionR.rows[0].google_id;

    // 2️⃣ verify owner owns this ad
    const adQ = `
      SELECT google_id
      FROM masters_lt_ads
      WHERE id = $1
      LIMIT 1
    `;
    const adR = await pool.query(adQ, [adId]);

    if (!adR.rowCount || String(adR.rows[0].google_id) !== String(ownerGoogleId)) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "Ne skelbimo savininkas"
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
      INSERT INTO masters_lt_reviews
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
      resMessage: "Atsakymas išsaugotas",
      reply_id: r.rows[0].id
    });

  } catch (err) {
    console.error("Reply error:", err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 4,
      resMessage: "Serverio klaida"
    });
  }
});
router.post("/post/delete-reply", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  const { replyId, adId } = req.body;

  if (!sessionId || !replyId || !adId) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Trūksta laukų"
    });
  }

  try {
    // 1️⃣ get google_id from session
    const sessionQ = `
      SELECT google_id
      FROM masters_lt_sessions
      WHERE session_id = $1
      LIMIT 1
    `;
    const sessionR = await pool.query(sessionQ, [sessionId]);

    if (!sessionR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Netinkama sesija"
      });
    }

    const ownerGoogleId = sessionR.rows[0].google_id;

    // 2️⃣ verify ad ownership
    const adQ = `
      SELECT google_id
      FROM masters_lt_ads
      WHERE id = $1
      LIMIT 1
    `;
    const adR = await pool.query(adQ, [adId]);

    if (!adR.rowCount || String(adR.rows[0].google_id) !== String(ownerGoogleId)) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "Ne skelbimo savininkas"
      });
    }

    // 3️⃣ verify reply belongs to this ad + owner + is a reply
    const replyQ = `
      SELECT id
      FROM masters_lt_reviews
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
        resMessage: "Atsakymas nerastas arba neleidžiama"
      });
    }

    // 4️⃣ delete reply
    const deleteQ = `
      DELETE FROM masters_lt_reviews
      WHERE id = $1
    `;
    await pool.query(deleteQ, [replyId]);

    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Atsakymas ištrintas"
    });

  } catch (err) {
    console.error("Delete reply error:", err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 5,
      resMessage: "Serverio klaida"
    });
  }
});
router.post("/post/message", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
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
      resMessage: "Netinkami duomenys"
    });
  }
  // basic email sanity check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.json({
      resStatus: false,
      resErrorCode: 2,
      resMessage: "Netinkamas el. paštas"
    });
  }
  try {
    const d = new Date();
    const visitdate = `${String(d.getDate()).padStart(2, "0")}/${String(
      d.getMonth() + 1
    ).padStart(2, "0")}/${d.getFullYear()}`;

    const insertQ = `
      INSERT INTO messages_masters_lt
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
      resMessage: "Serverio klaida"
    });
  }
});
router.post("/post/like", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  const { ad_id } = req.body;

  if (!sessionId || !ad_id) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Trūksta laukų"
    });
  }

  try {
    // ---------------------------------------
    // 1) GET LIKER GOOGLE ID (FROM SESSION)
    // ---------------------------------------
    const sessionQ = `
      SELECT google_id
      FROM masters_lt_sessions
      WHERE session_id = $1
      LIMIT 1
    `;
    const sessionR = await pool.query(sessionQ, [sessionId]);

    if (!sessionR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Netinkama sesija"
      });
    }

    const liker_google_id = sessionR.rows[0].google_id;

    // ---------------------------------------
    // 2) GET AD OWNER GOOGLE ID (MASTER)
    // ---------------------------------------
    const adQ = `
      SELECT google_id
      FROM masters_lt_ads
      WHERE id = $1
      LIMIT 1
    `;
    const adR = await pool.query(adQ, [ad_id]);

    if (!adR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "Skelbimas nerastas"
      });
    }

    const master_google_id = adR.rows[0].google_id;

    // ---------------------------------------
    // 3) CHECK EXISTING LIKE ROW
    // ---------------------------------------
    const selectQ = `
      SELECT id, likers
      FROM masters_lt_likes
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
            `DELETE FROM masters_lt_likes WHERE id = $1`,
            [row.id]
          );
          return res.json({
            resStatus: true,
            resOkCode: 3,
            resMessage: "Patinka pašalintas (eilutė ištrinta)"
          });
        }

        await pool.query(
          `UPDATE masters_lt_likes SET likers = $1 WHERE id = $2`,
          [JSON.stringify(likers), row.id]
        );

        return res.json({
          resStatus: true,
          resOkCode: 4,
          resMessage: "Patinka pašalintas"
        });
      }

      // ADD LIKE
      likers.push(liker_google_id);

      await pool.query(
        `UPDATE masters_lt_likes SET likers = $1 WHERE id = $2`,
        [JSON.stringify(likers), row.id]
      );

      return res.json({
        resStatus: true,
        resOkCode: 1,
        resMessage: "Patinka išsaugotas"
      });
    }

    // ---------------------------------------
    // CASE B: NO ROW → CREATE NEW
    // ---------------------------------------
    const insertQ = `
      INSERT INTO masters_lt_likes (ad_id, master_id, likers)
      VALUES ($1, $2, $3)
    `;
    await pool.query(insertQ, [
      ad_id,
      master_google_id,
      JSON.stringify([liker_google_id])
    ]);

    return res.json({
      resStatus: true,
      resOkCode: 2,
      resMessage: "Patinka išsaugotas (nauja eilutė sukurta)"
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 99,
      resMessage: "Serverio klaida"
    });
  }
});
router.get("/get/like-status", applyReadRateLimit, async (req, res) => {

  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;

  const { ad_id } = req.query;

  if (!ad_id) {
    return res.json({
      resStatus: false,
      resMessage: "Trūksta ad_id"
    });
  }

  try {
    // Always fetch likes first (PUBLIC)
    const q = `
      SELECT likers
      FROM masters_lt_likes
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
      FROM masters_lt_sessions
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
      resMessage: "Serverio klaida"
    });
  }
});
router.get("/get/reviews/:ad_id", applyReadRateLimit, async (req, res) => {
  const adId = req.params.ad_id;

  if (!adId) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Trūksta ad_id"
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
      FROM masters_lt_reviews
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
      resMessage: "Serverio klaida"
    });
  }
});
//this gets reviews from reviews table and ad data from ads table (owner name, title, picture)
//We are using this endpoint in profile page because it allows better performance
//otherwise we will have to make two requests to the backend-database instead of one here.
router.get("/get/profile-reviews-ads", applyReadRateLimit, async (req, res) => {
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;

  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Nėra aktyvios sesijos",
      reviews: []
    });
  }

  try {
    /* get google id from session */
    const sessionQuery = `
      SELECT google_id
      FROM masters_lt_sessions
      WHERE session_id = $1
      LIMIT 1;
    `;

    const sessionRes = await pool.query(sessionQuery, [sessionId]);

    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Nėra aktyvios sesijos",
        reviews: []
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    /* reviews + ad data (NO aliases) */
    const reviewsQuery = `
      SELECT
        masters_lt_reviews.id,
        masters_lt_reviews.review_text,
        masters_lt_reviews.rating,
        masters_lt_reviews.date,
        masters_lt_reviews.ad_id,

        masters_lt_ads.name  AS ad_owner_name,
        masters_lt_ads.title AS ad_title,
        masters_lt_ads.image_url AS ad_image_url
      FROM masters_lt_reviews
      JOIN masters_lt_ads
        ON masters_lt_ads.id = masters_lt_reviews.ad_id
      WHERE masters_lt_reviews.reviewer_id = $1
        AND masters_lt_reviews.is_deleted = false
        AND masters_lt_reviews.parent IS NULL
      ORDER BY masters_lt_reviews.id DESC;
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
      resMessage: "Serverio klaida",
      reviews: []
    });
  }
});
router.get("/get/profile-replies-ads", applyReadRateLimit, async (req, res) => {
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;

  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Nėra aktyvios sesijos",
      reviews: []
    });
  }

  try {
    /* get google id from session */
    const sessionQuery = `
      SELECT google_id
      FROM masters_lt_sessions
      WHERE session_id = $1
      LIMIT 1;
    `;

    const sessionRes = await pool.query(sessionQuery, [sessionId]);

    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Nėra aktyvios sesijos",
        reviews: []
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    /* replies written BY the user */
    const repliesQuery = `
      SELECT
        masters_lt_reviews.id,
        masters_lt_reviews.review_text,
        masters_lt_reviews.date,
        masters_lt_reviews.ad_id,

        masters_lt_ads.name  AS ad_owner_name,
        masters_lt_ads.title AS ad_title,
        masters_lt_ads.image_url AS ad_image_url
      FROM masters_lt_reviews
      JOIN masters_lt_ads
        ON masters_lt_ads.id = masters_lt_reviews.ad_id
      WHERE masters_lt_reviews.reviewer_id = $1
        AND masters_lt_reviews.parent IS NOT NULL
        AND masters_lt_reviews.is_deleted = false
      ORDER BY masters_lt_reviews.id DESC;
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
      resMessage: "Serverio klaida",
      reviews: []
    });
  }
});
//deletes both reviews of the user and replies of the user.
//reviews of user with reply of the owner is not deleted. It is made hidden.
router.delete("/delete/review/:id", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;
  const reviewId = req.params.id;

  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Nėra aktyvios sesijos",
      resErrorCode: 1
    });
  }

  if (!reviewId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Trūksta atsiliepimo id",
      resErrorCode: 2
    });
  }

  try {
    /* GET GOOGLE ID FROM SESSION */
    const sessionRes = await pool.query(
      `
      SELECT google_id
      FROM masters_lt_sessions
      WHERE session_id = $1
      LIMIT 1;
      `,
      [sessionId]
    );

    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Nėra aktyvios sesijos",
        resErrorCode: 3
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    /* VERIFY OWNERSHIP + GET ad_id */
    const ownershipRes = await pool.query(
      `
      SELECT id, parent, ad_id
      FROM masters_lt_reviews
      WHERE id = $1
        AND reviewer_id = $2
      LIMIT 1;
      `,
      [reviewId, googleId]
    );

    if (!ownershipRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Atsiliepimas nerastas arba neleidžiama",
        resErrorCode: 4
      });
    }

    const { parent, ad_id: adId } = ownershipRes.rows[0];

    /* ---------- DELETE LOGIC ---------- */

    // Reply → hard delete
    if (parent !== null) {
      await pool.query(
        `DELETE FROM masters_lt_reviews WHERE id = $1;`,
        [reviewId]
      );
    } else {
      // Main review → check replies
      const replyRes = await pool.query(
        `
        SELECT 1
        FROM masters_lt_reviews
        WHERE parent = $1
        LIMIT 1;
        `,
        [reviewId]
      );

      if (replyRes.rowCount) {
        // Soft delete review + replies
        await pool.query(
          `
          UPDATE masters_lt_reviews
          SET is_deleted = true
          WHERE id = $1 OR parent = $1;
          `,
          [reviewId]
        );
      } else {
        // Hard delete review
        await pool.query(
          `DELETE FROM masters_lt_reviews WHERE id = $1;`,
          [reviewId]
        );
      }
    }

    /* ---------- RECALCULATE STATS ---------- */

    await pool.query(
      `
      UPDATE masters_lt_ads
      SET
        average_rating = COALESCE(sub.avg, 0),
        reviews_count  = COALESCE(sub.cnt, 0)
      FROM (
        SELECT
          ROUND(AVG(rating), 1) AS avg,
          COUNT(*) AS cnt
        FROM masters_lt_reviews
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
      resMessage: "Atsiliepimas ištrintas"
    });

  } catch (error) {
    console.error("Delete review error:", error);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Duomenų bazės ryšio klaida",
      resErrorCode: 5
    });
  }
});


router.post("/post/auth/email-register", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  console.log("[email-register] route reached");

  const ipVisitor = req.headers["x-forwarded-for"]
    ? req.headers["x-forwarded-for"].split(",")[0]
    : req.socket.remoteAddress || req.ip;

  const clean = (v, max) =>
    String(v || "")
      .trim()
      .slice(0, max)
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  const generateEmailGoogleId = () => {
    let out = "9";
    while (out.length < 21) {
      out += Math.floor(Math.random() * 10);
    }
    return out;
  };

  const name = clean(req.body.name, 80);
  const email = clean(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || "");

  console.log("[email-register] incoming:", {
    nameLength: name.length,
    email,
    passwordLength: password.length,
    ipVisitor
  });

  if (name.length < 2 || email.length < 5 || password.length < 6) {
    console.log("[email-register] validation failed: bad lengths");
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Netinkami duomenys"
    });
  }

  try {
    console.log("[email-register] checking existing email");

    const checkQ = `
      SELECT google_id
      FROM masters_lt_users
      WHERE email = $1
      LIMIT 1
    `;
    const checkR = await pool.query(checkQ, [email]);

    console.log("[email-register] email check rowCount:", checkR.rowCount);

    if (checkR.rowCount) {
      console.log("[email-register] email already exists:", email);
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "El. paštas jau naudojamas"
      });
    }

    console.log("[email-register] hashing password");
    const passwordHash = await bcrypt.hash(password, 12);
    console.log("[email-register] password hashed");

    let googleId;
    let exists = true;
    let attempts = 0;

    console.log("[email-register] generating google_id-like value");

    while (exists) {
      attempts += 1;
      googleId = generateEmailGoogleId();

      console.log("[email-register] generated candidate googleId:", googleId, "attempt:", attempts);

      const r = await pool.query(
        `SELECT google_id FROM masters_lt_users WHERE google_id = $1 LIMIT 1`,
        [googleId]
      );

      exists = r.rowCount > 0;
      console.log("[email-register] googleId exists?:", exists);

      if (attempts > 20) {
        throw new Error("Could not generate unique google_id after 20 attempts");
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    console.log("[email-register] today:", today);

    const insertQ = `
      INSERT INTO masters_lt_users
      (google_id, email, name, date, ip, auth_provider, password_hash, email_verified)
      VALUES ($1, $2, $3, $4, $5, 'email', $6, false)
      RETURNING google_id
    `;

    console.log("[email-register] inserting user into masters_lt_users");

    const insertR = await pool.query(insertQ, [
      googleId,
      email,
      name,
      today,
      ipVisitor,
      passwordHash
    ]);

    console.log("[email-register] insert success:", insertR.rows);

    const dbGoogleId = insertR.rows[0].google_id;

    console.log("[email-register] creating session for google_id:", dbGoogleId);
    const sessionId = await createSessionForUser(dbGoogleId);
    console.log("[email-register] session created:", sessionId);

    res.cookie("session_id", sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 1000 * 60 * 60 * 24 * 365
    });

    console.log("[email-register] cookie set, sending success response");

    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Registracija sėkminga",
      user: {
        google_id: dbGoogleId,
        email,
        name,
        session_id: sessionId
      }
    });

  } catch (err) {
    console.error("[email-register] ERROR object:", err);
    console.error("[email-register] ERROR message:", err?.message);
    console.error("[email-register] ERROR stack:", err?.stack);
    console.error("[email-register] ERROR name/email:", { name, email });

    return res.status(500).json({
      resStatus: false,
      resErrorCode: 99,
      resMessage: "Serverio klaida"
    });
  }
});
router.post("/post/auth/email-login", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const clean = (v, max) =>
    String(v || "")
      .trim()
      .slice(0, max)
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  const email = clean(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || "");

  if (email.length < 5 || password.length < 6) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Netinkami prisijungimo duomenys"
    });
  }

/*   if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.json({
      resStatus: false,
      resErrorCode: 2,
      resMessage: "Netinkamas el. paštas"
    });
  } */

  try {
    const userQ = `
      SELECT google_id, email, name, password_hash, auth_provider, email_verified
      FROM masters_lt_users
      WHERE email = $1
      LIMIT 1
    `;
    const userR = await pool.query(userQ, [email]);

    if (!userR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "Neteisingas el. paštas arba slaptažodis"
      });
    }

    const user = userR.rows[0];

    if (user.auth_provider !== "email") {
      return res.json({
        resStatus: false,
        resErrorCode: 4,
        resMessage: "Šis el. paštas naudojamas su kitu prisijungimo būdu"
      });
    }

    if (!user.password_hash) {
      return res.json({
        resStatus: false,
        resErrorCode: 5,
        resMessage: "Slaptažodis nenustatytas"
      });
    }

    const ok = await bcrypt.compare(password, user.password_hash);

    if (!ok) {
      return res.json({
        resStatus: false,
        resErrorCode: 6,
        resMessage: "Neteisingas el. paštas arba slaptažodis"
      });
    }

    const sessionId = await createSessionForUser(user.google_id);

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
      resMessage: "Prisijungimas sėkmingas",
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
      resMessage: "Serverio klaida"
    });
  }
});
router.get("/get/session-user", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

  const sessionId = req.cookies?.session_id || bearerSid;

  // No cookie -> not logged in, but it's not an "error"
  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Nėra aktyvios sesijos",
      resErrorCode: 1,
      loggedIn: false
    });
  }

  try {
    const query = `
      SELECT 
        masters_lt_users.google_id,
        masters_lt_users.email,
        masters_lt_users.name
      FROM masters_lt_sessions
      JOIN masters_lt_users
        ON masters_lt_users.google_id = masters_lt_sessions.google_id
      WHERE masters_lt_sessions.session_id = $1
      LIMIT 1;
    `;

    const result = await pool.query(query, [sessionId]);

    if (result.rowCount === 0) {
      // Cookie exists but session not found (expired/invalid)
      return res.status(200).json({
        resStatus: false,
        resMessage: "Nėra aktyvios sesijos",
        resErrorCode: 2,
        loggedIn: false
      });
    }

    const user = result.rows[0];

    return res.status(200).json({
      resStatus: true,
      resMessage: "Vartotojo sesija aktyvi",
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
      resMessage: "Duomenų bazės ryšio klaida",
      resErrorCode: 3,
      loggedIn: false
    });
  }
});
router.post("/post/auth/email-forget", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  console.log("[email-forget] route reached");
  console.log("[email-forget] body:", req.body);

  const email = String(req.body.email || "").trim().toLowerCase();

  if (!email || email.length > 120) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Netinkamas el. paštas",
      resErrorCode: 1
    });
  }

  let client;

  try {
    client = await pool.connect();

    const userQuery = `
      SELECT google_id, email, name
      FROM masters_lt_users
      WHERE LOWER(email) = $1
      LIMIT 1;
    `;
    const userResult = await client.query(userQuery, [email]);

    if (userResult.rows.length === 0) {
      return res.status(200).json({
        resStatus: true,
        resMessage: "Jei el. paštas egzistuoja, laiškas bus išsiųstas",
        resOkCode: 1
      });
    }

    const user = userResult.rows[0];

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    const updateQuery = `
      UPDATE masters_lt_users
      SET password_reset_token = $1,
          password_reset_expires = $2
      WHERE google_id = $3
    `;
    await client.query(updateQuery, [resetToken, resetExpires, user.google_id]);

    const resetLink = `https://pagalbapro.lt/reset-password.html?token=${resetToken}`;

    const brevoResult = await sendEmailBrevo({
      site: "pagalbapro",
      to: user.email,
      subject: "Slaptažodžio atkūrimas",
      html: `
        <p>Sveiki${user.name ? `, ${user.name}` : ""},</p>
        <p>Norėdami pakeisti slaptažodį, spauskite žemiau esančią nuorodą:</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        <p>Nuoroda galioja 1 valandą.</p>
        <p>Jei to neprašėte, ignoruokite šį laišką.</p>
      `,
      text:
        `Sveiki${user.name ? `, ${user.name}` : ""},

        Norėdami pakeisti slaptažodį, atidarykite šią nuorodą:
        ${resetLink}

        Nuoroda galioja 1 valandą.

        Jei to neprašėte, ignoruokite šį laišką.`
      });

    console.log("[email-forget] token saved for:", user.email);
    console.log("[email-forget] brevo success:", brevoResult);

    return res.status(200).json({
      resStatus: true,
      resMessage: "Jei el. paštas egzistuoja, laiškas bus išsiųstas",
      resOkCode: 2
    });

  } catch (error) {
    console.error("[email-forget] full error:", error);
    console.error("[email-forget] response data:", error?.response?.data);
    console.error("[email-forget] response status:", error?.response?.status);

    return res.status(500).json({
      resStatus: false,
      resMessage:
        error?.response?.data?.message ||
        error?.message ||
        "Nepavyko išsiųsti el. laiško",
      resErrorCode: 2
    });
  } finally {
    if (client) client.release();
  }
});
router.post("/post/auth/email-reset", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  console.log("[email-reset] route reached");
  console.log("[email-reset] body:", {
    tokenLength: String(req.body.token || "").length,
    newPasswordLength: String(req.body.newPassword || "").length
  });

  const token = String(req.body.token || "").trim();
  const newPassword = String(req.body.newPassword || "");

  if (!token) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Trūksta atkūrimo rakto",
      resErrorCode: 1
    });
  }

  if (!newPassword || newPassword.length < 6 || newPassword.length > 120) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Netinkamas slaptažodis",
      resErrorCode: 2
    });
  }

  let client;

  try {
    client = await pool.connect();

    const userQuery = `
      SELECT google_id, email, password_reset_token, password_reset_expires
      FROM masters_lt_users
      WHERE password_reset_token = $1
      LIMIT 1;
    `;
    const userResult = await client.query(userQuery, [token]);

    if (userResult.rows.length === 0) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Netinkama arba negaliojanti atkūrimo nuoroda",
        resErrorCode: 3
      });
    }

    const user = userResult.rows[0];

    if (!user.password_reset_expires || new Date(user.password_reset_expires) < new Date()) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Atkūrimo nuoroda nebegalioja",
        resErrorCode: 4
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    const updateQuery = `
      UPDATE masters_lt_users
      SET password_hash = $1,
          password_reset_token = NULL,
          password_reset_expires = NULL
      WHERE google_id = $2
    `;
    await client.query(updateQuery, [newPasswordHash, user.google_id]);

    console.log("[email-reset] password updated for:", user.email);

    return res.status(200).json({
      resStatus: true,
      resMessage: "Slaptažodis sėkmingai atnaujintas",
      resOkCode: 1
    });

  } catch (error) {
    console.error("[email-reset] full error:", error);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Nepavyko atnaujinti slaptažodžio",
      resErrorCode: 5
    });
  } finally {
    if (client) client.release();
  }
});

router.get("/get/ad/:id", applyReadRateLimit, async (req, res) => {
  const adId = req.params.id;

  try {
    const q = `
      SELECT 
        id, name, title, description, price, city, date, views,
        telephone, image_url, google_id, main_group, sub_group,
        average_rating, reviews_count
      FROM masters_lt_ads
      WHERE id = $1
      LIMIT 1
    `;
    const r = await pool.query(q, [adId]);

    if (!r.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 1,
        resMessage: "Skelbimas nerastas"
      });
    }

    const ad = r.rows[0];
    const { main_group, sub_group } = ad;

    let newerId = null;
    let olderId = null;

    if (sub_group) {
      const newerQ = `
        SELECT id FROM masters_lt_ads
        WHERE main_group = $2
          AND sub_group = $3
          AND id > $1
        ORDER BY id ASC
        LIMIT 1
      `;
      const olderQ = `
        SELECT id FROM masters_lt_ads
        WHERE main_group = $2
          AND sub_group = $3
          AND id < $1
        ORDER BY id DESC
        LIMIT 1
      `;

      const newerR = await pool.query(newerQ, [adId, main_group, sub_group]);
      const olderR = await pool.query(olderQ, [adId, main_group, sub_group]);

      newerId = newerR.rows[0]?.id || null;
      olderId = olderR.rows[0]?.id || null;
    } else {
      const newerQ = `
        SELECT id FROM masters_lt_ads
        WHERE main_group = $2
          AND id > $1
        ORDER BY id ASC
        LIMIT 1
      `;
      const olderQ = `
        SELECT id FROM masters_lt_ads
        WHERE main_group = $2
          AND id < $1
        ORDER BY id DESC
        LIMIT 1
      `;

      const newerR = await pool.query(newerQ, [adId, main_group]);
      const olderR = await pool.query(olderQ, [adId, main_group]);

      newerId = newerR.rows[0]?.id || null;
      olderId = olderR.rows[0]?.id || null;
    }

    return res.json({
      resStatus: true,
      resOkCode: 1,
      ad,
      newerId,
      olderId
    });

  } catch (err) {
    console.error("GET ad error:", err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 2,
      resMessage: "Serverio klaida"
    });
  }
});
router.get("/get/user-ads", applyReadRateLimit, async (req, res) => {
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

  const sessionId = req.cookies?.session_id || bearerSid;
  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Nėra aktyvios sesijos",
      resErrorCode: 1,
      ads: []
    });
  }
  try {
    // find google_id from session
    const sessionQuery = `
      SELECT google_id
      FROM masters_lt_sessions
      WHERE session_id = $1
      LIMIT 1;
    `;
    const sessionRes = await pool.query(sessionQuery, [sessionId]);
    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Nėra aktyvios sesijos",
        resErrorCode: 2,
        ads: []
      });
    }
    const googleId = sessionRes.rows[0].google_id;
    // fetch ads for this user
    const adsQuery = `
      SELECT 
        id, 
        title, 
        description, 
        price, 
        city, 
        image_url, 
        date,
        created_at,      
        is_active       
      FROM masters_lt_ads
      WHERE google_id = $1
      ORDER BY date DESC, id DESC;
    `;
    const adsRes = await pool.query(adsQuery, [googleId]);
    return res.status(200).json({
      resStatus: true,
      resMessage: "Vartotojo skelbimai užkrauti",
      resOkCode: 1,
      ads: adsRes.rows
    });
  } catch (error) {
    console.error("User ads fetch error:", error);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Duomenų bazės ryšio klaida",
      resErrorCode: 3,
      ads: []
    });
  }
});
router.get("/get/search", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
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
      resMessage: "Paieškos užklausa per trumpa arba per ilga"
    });
  }
  if (!/^[^<>]{3,60}$/.test(q)) {
    return res.json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Netinkama paieškos užklausa"
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
      FROM masters_lt_ads
      WHERE is_active = true
        AND (title ILIKE $1 OR description ILIKE $1)
    `;
    const countR = await pool.query(countQ, [`%${q}%`]);

    const realTotal = parseInt(countR.rows[0].count, 10);
    const totalResults = Math.min(realTotal, HARD_CAP);
    const totalPages = Math.ceil(totalResults / PAGE_SIZE);

    // 2️⃣ paged data
    const dataQ = `
      SELECT 
        id, name, title, description, price, city, date, views,
        telephone, image_url, google_id, main_group, sub_group,
        average_rating, reviews_count
      FROM masters_lt_ads
      WHERE is_active = true
        AND (title ILIKE $1 OR description ILIKE $1)
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
      resMessage: "Serverio klaida"
    });
  }
});
router.get("/get/search-filter", applyReadRateLimit, blockMaliciousIPs, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 3 || q.length > 60) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Paieškos užklausa per trumpa arba per ilga"
    });
  }
  if (!/^[^<>]{3,60}$/.test(q)) {
    return res.json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Netinkama paieškos užklausa"
    });
  }
  const { title, city, minRating, minReviews } = req.query;
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

    // base search
    conditions.push(`is_active = true`);
    conditions.push(`(title ILIKE $${i} OR description ILIKE $${i})`);
    values.push(`%${q}%`);
    i++;

    // profession filter
    if (title) {
      conditions.push(`title = $${i}`);
      values.push(title);
      i++;
    }

    // city filter
    if (city) {
      const cityId = Number(city);
      if (!Number.isNaN(cityId)) {
        conditions.push(`city::jsonb @> $${i}::jsonb`);
        values.push(JSON.stringify([cityId]));
        i++;
      }
    }

    // rating filter
    if (minRating) {
      const r = Number(minRating);
      if (!Number.isNaN(r)) {
        conditions.push(`average_rating >= $${i}`);
        values.push(r);
        i++;
      }
    }

    // reviews filter
    if (minReviews) {
      const rc = Number(minReviews);
      if (!Number.isNaN(rc)) {
        conditions.push(`reviews_count >= $${i}`);
        values.push(rc);
        i++;
      }
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countQ = `
      SELECT COUNT(*)
      FROM masters_lt_ads
      ${whereClause}
    `;
    const countR = await pool.query(countQ, values);

    const realTotal = parseInt(countR.rows[0].count, 10);
    const totalResults = Math.min(realTotal, HARD_CAP);
    const totalPages = Math.ceil(totalResults / PAGE_SIZE);

    const dataQ = `
      SELECT 
        id, name, title, description, price, city, date, views,
        telephone, image_url, google_id, main_group, sub_group,
        average_rating, reviews_count
      FROM masters_lt_ads
      ${whereClause}
      ORDER BY date DESC
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
      resMessage: "Serverio klaida"
    });
  }
});
router.get("/get/browse", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
  const { main, sub, cursor } = req.query;
  const limit = 12;

  try {
    let query = `
      SELECT 
        id, name, title, description, price, city, date, views,
        telephone, image_url, google_id, main_group, sub_group,
        average_rating, reviews_count
      FROM masters_lt_ads
      WHERE is_active = true
    `;
    const params = [];

    if (main) {
      params.push(main);
      query += ` AND main_group = $${params.length}`;
    }

    if (sub) {
      params.push(sub);
      query += ` AND sub_group = $${params.length}`;
    }

    if (cursor) {
      params.push(cursor);
      query += ` AND created_at < $${params.length}`;
    }

    query += ` ORDER BY created_at DESC`;
    params.push(limit);
    query += ` LIMIT $${params.length}`;

    const adsRes = await pool.query(query, params);

    if (!adsRes.rowCount) {
      return res.status(200).json({
        resStatus: true,
        ads: [],
        nextCursor: null
      });
    }

    return res.status(200).json({
      resStatus: true,
      ads: adsRes.rows,
      nextCursor: adsRes.rows[adsRes.rows.length - 1].created_at
    });

  } catch (err) {
    console.error("Browse error:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Serverio klaida"
    });
  }
});
router.get("/get/homepage/carousel", async (req, res) => {
  try {
    const q = `
      SELECT
        id,
        title,
        name,
        price,
        city,
        description,
        average_rating,
        reviews_count,
        image_url ->> 0 AS image
      FROM masters_lt_carousel
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
      resMessage: "Nepavyko gauti karuselės skelbimų",
      resErrorCode: 2
    });
  }
});
router.get("/get/browse-filter", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
  const {
    main,
    sub,
    title,
    city,
    minRating,
    minReviews,
    cursor
  } = req.query;

  const limit = 12;

  try {
    const conditions = [`is_active = true`];
    const values = [];
    let i = 1;

    // BROWSE SCOPE
    if (main) {
      conditions.push(`main_group = $${i}`);
      values.push(main);
      i++;
    }

    if (sub) {
      conditions.push(`sub_group = $${i}`);
      values.push(sub);
      i++;
    }

    // FILTERS
    if (title) {
      conditions.push(`title ILIKE $${i}`);
      values.push(`%${title.trim()}%`);
      i++;
    }

    if (city) {
      const cityId = Number(city);
      if (!Number.isNaN(cityId)) {
        conditions.push(`city::jsonb @> $${i}::jsonb`);
        values.push(JSON.stringify([cityId]));
        i++;
      }
    }

    if (minRating) {
      const r = Number(minRating);
      if (!Number.isNaN(r)) {
        conditions.push(`average_rating >= $${i}`);
        values.push(r);
        i++;
      }
    }

    if (minReviews) {
      const rc = Number(minReviews);
      if (!Number.isNaN(rc)) {
        conditions.push(`reviews_count >= $${i}`);
        values.push(rc);
        i++;
      }
    }

    // CURSOR (show more)
    if (cursor) {
      conditions.push(`created_at < $${i}`);
      values.push(cursor);
      i++;
    }

    const query = `
      SELECT 
        id, name, title, description, price, city, date, views,
        telephone, image_url, google_id, main_group, sub_group,
        average_rating, reviews_count
      FROM masters_lt_ads
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${i}
    `;

    values.push(limit);

    const { rows } = await pool.query(query, values);

    return res.json({
      resStatus: true,
      ads: rows,
      nextCursor: rows.length
        ? rows[rows.length - 1].created_at
        : null
    });

  } catch (err) {
    console.error("Browse filter error:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Serverio klaida"
    });
  }
});

module.exports = router;