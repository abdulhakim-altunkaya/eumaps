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
      resMessage: "Bekleme süresi veya kayıt atlandı",
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
      INSERT INTO visitors_masters_tr (
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
      resMessage: "Ziyaretçi kaydı yapıldı",
      resOkCode: 1
    });
  } catch (err) {
    console.error("Visitor log error (Masters TR):", err);
    return res.status(200).json({
      resStatus: false,
      resMessage: "Ziyaretçi kaydı başarısız - sunucu hatası.",
      resErrorCode: 2
    });
  } finally {
    if (client) client.release();
  }
});
router.post("/post/ads", blockMaliciousIPs, enforceAdPostingCooldown, applyWriteRateLimit,
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

  let client;
  let formData;

  try {
    formData = JSON.parse(req.body.formData);
  } catch (err) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Geçersiz form verisi",
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
    inputCity,
    inputTowns,
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

  if (!inputService || !inputName || !inputPrice || !inputDescription || !phoneNumber) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Zorunlu alanlar eksik",
      resErrorCode: 2
    });
  }

  const mainVal = Number(main_group);
  if (isNaN(mainVal) || mainVal < 1 || mainVal > 10) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Ana kategori geçersiz",
      resErrorCode: 3
    });
  }

  const subVal = Number(sub_group);
  if (isNaN(subVal) || subVal < 1 || subVal > 10) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Alt kategori geçersiz",
      resErrorCode: 4
    });
  }

  if (phoneNumber.trim().length < 7 || phoneNumber.trim().length > 15) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Telefon numarası uzunluğu geçersiz",
      resErrorCode: 8
    });
  }

  if (!Array.isArray(inputCity) || inputCity.length === 0) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "İl seçilmedi",
      resErrorCode: 9
    });
  }

  if (!Array.isArray(inputTowns) || inputTowns.length === 0) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "İlçe seçilmedi",
      resErrorCode: 10
    });
  }

  if (inputTowns.length > 5) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "En fazla 5 ilçe seçilebilir",
      resErrorCode: 11
    });
  }

  if (inputName.length < 5 || inputName.length > 25) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Ad soyad çok kısa veya çok uzun",
      resErrorCode: 12
    });
  }

  if (inputPrice.length < 1 || inputPrice.length > 25) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Fiyat çok kısa veya çok uzun",
      resErrorCode: 13
    });
  }

  if (inputDescription.length < 50 || inputDescription.length > 1000) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Açıklama çok kısa veya çok uzun",
      resErrorCode: 14
    });
  }

  try {
    const auth = req.headers.authorization || "";
    const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    const sessionId = req.cookies?.session_id || bearerSid;

    if (!sessionId) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Devam etmek için giriş yapın",
        resErrorCode: 15
      });
    }

    const userRes = await pool.query(
      `SELECT google_id FROM masters_tr_sessions WHERE session_id = $1 LIMIT 1`,
      [sessionId]
    );

    if (!userRes.rowCount) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Geçersiz oturum",
        resErrorCode: 16
      });
    }

    const googleId = userRes.rows[0].google_id;

    try {
      client = await pool.connect();

      const userAdNumberCheck = await client.query(
        "SELECT number_ads FROM masters_tr_users WHERE google_id = $1",
        [googleId]
      );

      if (userAdNumberCheck.rows[0]?.number_ads >= 5) {
        return res.status(403).json({
          resStatus: false,
          resMessage: "İlan limitine ulaşıldı (maksimum 5)",
          resErrorCode: 17
        });
      }

      const existingAdCheck = await client.query(
        `SELECT id FROM masters_tr_ads
         WHERE google_id = $1 AND main_group = $2 AND sub_group = $3
         LIMIT 1`,
        [googleId, mainVal, subVal]
      );

      if (existingAdCheck.rowCount > 0) {
        return res.status(403).json({
          resStatus: false,
          resMessage: "Bu alt kategoride zaten aktif ilanınız var",
          resErrorCode: 18
        });
      }
    } catch (err) {
      return res.status(500).json({
        resStatus: false,
        resMessage: "Sistem hatası. Lütfen daha sonra tekrar deneyin",
        resErrorCode: 19
      });
    } finally {
      if (client) {
        client.release();
        client = null;
      }
    }

    const files = req.files;

    if (!files || files.length < 1 || files.length > 5) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "1–5 fotoğraf gerekli",
        resErrorCode: 20
      });
    }

    let uploadedImages = [];

    for (const f of files) {
      if (!ALLOWED_IMAGE_TYPES.includes(f.mimetype)) {
        return res.status(400).json({
          resStatus: false,
          resMessage: "Geçersiz dosya formatı",
          resErrorCode: 21
        });
      }

      if (f.size < MIN_IMAGE_SIZE) {
        return res.status(400).json({
          resStatus: false,
          resMessage: "Fotoğraf bozuk veya boş",
          resErrorCode: 22
        });
      }

      if (f.size > MAX_IMAGE_SIZE) {
        return res.status(400).json({
          resStatus: false,
          resMessage: "Fotoğraf çok büyük",
          resErrorCode: 23
        });
      }

      const fileName = makeSafeName();
      const { error } = await supabase.storage
        .from("masters_latvia_storage")
        .upload(fileName, f.buffer, { contentType: f.mimetype });

      if (error) {
        return res.status(503).json({
          resStatus: false,
          resMessage: "Fotoğraf yükleme başarısız",
          resErrorCode: 24
        });
      }

      uploadedImages.push(
        `${process.env.SUPABASE_URL}/storage/v1/object/public/masters_latvia_storage/${fileName}`
      );
    }

    try {
      client = await pool.connect();

      const insertQuery = `
        INSERT INTO masters_tr_ads
        (name, title, description, price, city, district, telephone, image_url, ip, date,
         main_group, sub_group, google_id, update_date, created_at, is_active)
        VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16)
        RETURNING id
      `;

      const values = [
        cleanInputName,
        inputService,
        cleanInputDescription,
        cleanInputPrice,
        JSON.stringify(inputCity),
        JSON.stringify(inputTowns),
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

      const result = await client.query(insertQuery, values);

      if (!result.rowCount) {
        return res.status(503).json({
          resStatus: false,
          resMessage: "Veri kaydedilemedi",
          resErrorCode: 25
        });
      }

      await client.query(
        "UPDATE masters_tr_users SET number_ads = COALESCE(number_ads, 0) + 1 WHERE google_id = $1",
        [googleId]
      );

      return res.status(201).json({
        resStatus: true,
        resMessage: "İlan kaydedildi",
        resOkCode: 1
      });

    } catch (err) {
      return res.status(503).json({
        resStatus: false,
        resMessage: "Sunucu hatası",
        resErrorCode: 26
      });
    } finally {
      if (client) client.release();
    }

  } catch (err) {
    return res.status(500).json({
      resStatus: false,
      resMessage: "Sunucu hatası",
      resErrorCode: 27
    });
  }
});
router.put("/put/update-ad/:id", blockMaliciousIPs, enforceAdPostingCooldown, applyWriteRateLimit,
  upload.array("images", 5), async (req, res) => {
  const adId = req.params.id;
  const MIN_IMAGE_SIZE = 2 * 1024;
  const MAX_IMAGE_SIZE = 3 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp"
  ];

  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const sessionId = req.cookies?.session_id || bearerSid;

  if (!sessionId) {
    return res.status(401).json({
      resStatus: false,
      resMessage: "Lütfen giriş yapın",
      resErrorCode: 1
    });
  }

  try {
    const userQ = await pool.query(
      `SELECT google_id
       FROM masters_tr_sessions
       WHERE session_id = $1
       LIMIT 1`,
      [sessionId]
    );

    if (!userQ.rowCount) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Geçersiz oturum",
        resErrorCode: 2
      });
    }

    const googleId = userQ.rows[0].google_id;

    const adQ = await pool.query(
      `SELECT image_url, google_id
       FROM masters_tr_ads
       WHERE id = $1
       LIMIT 1`,
      [adId]
    );

    if (!adQ.rowCount) {
      return res.json({
        resStatus: false,
        resMessage: "İlan bulunamadı",
        resErrorCode: 3
      });
    }

    if (adQ.rows[0].google_id !== googleId) {
      return res.status(403).json({
        resStatus: false,
        resMessage: "Giriş gerekli",
        resErrorCode: 4
      });
    }

    let formData;
    try {
      formData = JSON.parse(req.body.formData);
    } catch (err) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Geçersiz form verisi",
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
      inputCity,
      inputTowns,
      main_group,
      sub_group,
      existingImages
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

    if (!inputService || !inputName || !inputPrice || !inputDescription || !phoneNumber) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Zorunlu alanları doldurun",
        resErrorCode: 6
      });
    }

    if (phoneNumber.trim().length < 7 || phoneNumber.trim().length > 15) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Telefon numarası çok kısa veya çok uzun",
        resErrorCode: 10
      });
    }

    if (!Array.isArray(inputCity) || inputCity.length === 0) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "İl seçilmedi",
        resErrorCode: 11
      });
    }

    if (!Array.isArray(inputTowns) || inputTowns.length === 0) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "İlçe seçilmedi",
        resErrorCode: 12
      });
    }

    if (inputTowns.length > 5) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "En fazla 5 ilçe seçilebilir",
        resErrorCode: 13
      });
    }

    if (inputName.length < 5 || inputName.length > 25) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Ad soyad çok kısa veya çok uzun",
        resErrorCode: 14
      });
    }

    const mainVal = Number(main_group);
    if (isNaN(mainVal) || mainVal < 1 || mainVal > 10) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Ana kategori izin verilen aralık dışında",
        resErrorCode: 15
      });
    }

    const subVal = Number(sub_group);
    if (isNaN(subVal) || subVal < 1 || subVal > 10) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Alt kategori izin verilen aralık dışında",
        resErrorCode: 16
      });
    }

    if (inputPrice.length < 1 || inputPrice.length > 15) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Fiyat çok kısa veya çok uzun",
        resErrorCode: 17
      });
    }

    if (inputDescription.length < 50 || inputDescription.length > 1000) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Açıklama çok kısa veya çok uzun",
        resErrorCode: 18
      });
    }

    try {
      const existingAdCheck = await pool.query(
        `SELECT id FROM masters_tr_ads
         WHERE google_id = $1 AND main_group = $2 AND sub_group = $3 AND id != $4
         LIMIT 1`,
        [googleId, mainVal, subVal, adId]
      );

      if (existingAdCheck.rowCount > 0) {
        return res.status(403).json({
          resStatus: false,
          resMessage: "Bu alt kategoride zaten aktif ilanınız var",
          resErrorCode: 19
        });
      }
    } catch (dbErr) {
      return res.status(500).json({
        resStatus: false,
        resMessage: "Kategori kısıtlamaları kontrol edilirken sistem hatası oluştu",
        resErrorCode: 20
      });
    }

    const files = req.files;
    let finalImages = Array.isArray(existingImages) ? existingImages : [];

    if (files && files.length > 0) {
      for (const f of files) {
        if (!ALLOWED_IMAGE_TYPES.includes(f.mimetype)) {
          return res.status(400).json({
            resStatus: false,
            resMessage: "Geçersiz fotoğraf formatı",
            resErrorCode: 21
          });
        }

        if (f.size < MIN_IMAGE_SIZE) {
          return res.status(400).json({
            resStatus: false,
            resMessage: "Fotoğraf bozuk veya boş",
            resErrorCode: 22
          });
        }

        if (f.size > MAX_IMAGE_SIZE) {
          return res.status(400).json({
            resStatus: false,
            resMessage: "Fotoğraf çok büyük",
            resErrorCode: 23
          });
        }
      }

      const uploadedImages = [];

      for (const f of files) {
        const fileName = makeSafeName();
        const { error } = await supabase.storage
          .from("masters_latvia_storage")
          .upload(fileName, f.buffer, { contentType: f.mimetype });

        if (error) {
          return res.status(503).json({
            resStatus: false,
            resMessage: "Fotoğraf yükleme başarısız",
            resErrorCode: 24
          });
        }
        uploadedImages.push(
          `${process.env.SUPABASE_URL}/storage/v1/object/public/masters_latvia_storage/${fileName}`
        );
      }

      const combinedImages = [...finalImages, ...uploadedImages];
      if (combinedImages.length > 5) {
        return res.status(400).json({
          resStatus: false,
          resMessage: "En fazla 5 fotoğraf olabilir",
          resErrorCode: 27
        });
      }
      finalImages = combinedImages;


    }

    const updateQ = `
      UPDATE masters_tr_ads
      SET
        name        = $1,
        title       = $2,
        description = $3,
        price       = $4,
        city        = $5,
        district    = $6,
        telephone   = $7,
        image_url   = $8,
        main_group  = $9,
        sub_group   = $10,
        update_date = $11
      WHERE id = $12 AND google_id = $13
      RETURNING id
    `;

    const values = [
      cleanInputName,
      inputService,
      cleanInputDescription,
      cleanInputPrice,
      JSON.stringify(inputCity),
      JSON.stringify(inputTowns),
      String(countryCode + phoneNumber),
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
        resMessage: "Güncelleme hatası",
        resErrorCode: 25
      });
    }

    return res.json({
      resStatus: true,
      resMessage: "Değişiklikler kaydedildi",
      resOkCode: 1
    });

  } catch (err) {
    return res.status(500).json({
      resStatus: false,
      resMessage: "Sunucu hatası",
      resErrorCode: 26
    });
  }
});
//this function below is for google auth login of latvia masters
async function createSessionForUser(dbGoogleId, isEmail) {
  const sessionId = crypto.randomUUID(); // generate inline
  await pool.query(
    `INSERT INTO masters_tr_sessions (session_id, google_id, is_email) VALUES ($1, $2, $3)`,
    [sessionId, dbGoogleId, isEmail]
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
      resMessage: "Google token eksik",
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
      FROM masters_tr_users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
    `;
    const existingByEmailR = await client.query(existingByEmailQ, [email]);
    if (existingByEmailR.rowCount) {
      const existingUser = existingByEmailR.rows[0];
      if (existingUser.auth_provider === "email") {
        return res.status(409).json({
          resStatus: false,
          resMessage: "Bu e-posta zaten kayıtlı. E-posta ve şifre ile giriş yapın",
          resErrorCode: 5
        });
      }
    }
    const query = `
      INSERT INTO masters_tr_users (google_id, email, name, date, ip)
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
      resMessage: "Kullanıcı doğrulandı.",
      resOkCode: 1,
      user: { google_id: dbGoogleId, email, name, session_id: sessionId }
    });

  } catch (error) {
    console.error("Google Auth Error Backend:", error);
    if (error.message?.includes("Invalid") || error.message?.includes("JWT")) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Google token geçersiz",
        resErrorCode: 2
      });
    }
    return res.status(500).json({
      resStatus: false,
      resMessage: "Veritabanı bağlantı hatası.",
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

  await pool.query(`DELETE FROM masters_tr_sessions WHERE session_id=$1`, [sessionId]);

  res.clearCookie("session_id", {
    httpOnly: true,
    secure: true,
    sameSite: "none"
  });

  return res.status(200).json({
    resStatus: true,
    resMessage: "Çıkış yapıldı.",
    resOkCode: 1
  });
});
router.post("/post/toggle-activation/:id", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const adId = req.params.id;
  try {
    // Check if ad exists
    const check = await pool.query(
      "SELECT is_active FROM masters_tr_ads WHERE id = $1 LIMIT 1;",
      [adId]
    );
    if (!check.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "İlan bulunamadı.",
        resErrorCode: 1
      });
    }
    const current = check.rows[0].is_active;
    const newState = !current; // toggle true → false, false → true
    // Update activation state
    const update = await pool.query(
      "UPDATE masters_tr_ads SET is_active = $1, created_at = NOW() WHERE id = $2 RETURNING id;",
      [newState, adId]
    );
    if (!update.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "İlanın aktivasyon durumu güncellenemedi",
        resErrorCode: 2
      });
    }
    return res.status(200).json({
      resStatus: true,
      resMessage: newState ? "İlan aktive edildi" : "İlan deaktive edildi",
      resOkCode: 1,
      is_active: newState
    });
  } catch (err) {
    console.error("Toggle error:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Sunucu hatası",
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
      resMessage: "Aktif oturum bulunamadı",
      resErrorCode: 1
    });
  }
  try {
    /* ---------- SESSION VALIDATION ---------- */
    const sessionRes = await pool.query(
      `
      SELECT google_id
      FROM masters_tr_sessions
      WHERE session_id = $1
      LIMIT 1;
      `,
      [sessionId]
    );

    if (!sessionRes.rowCount) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Geçersiz oturum",
        resErrorCode: 2
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    /* ---------- VERIFY OWNERSHIP + GET IMAGES ---------- */
    const adRes = await pool.query(
      `
      SELECT image_url
      FROM masters_tr_ads
      WHERE id = $1 AND google_id = $2
      LIMIT 1;
      `,
      [adId, googleId]
    );

    if (!adRes.rowCount) {
      return res.status(403).json({
        resStatus: false,
        resMessage: "İlan silinemedi",
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
      `DELETE FROM masters_tr_reviews WHERE ad_id = $1;`,
      [adId]
    );

    // Hard delete ad
    await pool.query(
      `DELETE FROM masters_tr_ads WHERE id = $1;`,
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
      resMessage: "İlan ve ilgili yorumlar silindi.",
      resOkCode: 1
    });

  } catch (err) {
    await pool.query("ROLLBACK");

    console.error("Delete ad error:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Sunucu hatası",
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
      resMessage: "İlan no eksik"
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
      resMessage: "Görüntüleme atlandı (bekleme süresi)."
    });
  }

  visitCacheLT[ipVisitor][ad_id] = now;

  try {
    await pool.query(
      "UPDATE masters_tr_ads SET views = views + 1 WHERE id = $1",
      [ad_id]
    );

    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Görünteleme sayısı güncellendi"
    });

  } catch (err) {
    console.error("View save error:", err);
    return res.json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Database hatası"
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
      resMessage: "Geçersiz veya eksik alan"
    });
  }
  if (rating < 0 || rating > 10) {
    return res.json({
      resStatus: false,
      resErrorCode: 6,
      resMessage: "Geçersiz değer"
    });
  }
  try {
    /* ---------- SESSION LOOKUP ---------- */
    const sessionResult = await pool.query(
      `
      SELECT google_id
      FROM masters_tr_sessions
      WHERE session_id = $1
      LIMIT 1
      `,
      [sessionId]
    );
    if (!sessionResult.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Kimlik doğrulanmadı."
      });
    }
    const reviewer_google_id = sessionResult.rows[0].google_id;

    /* ---------- BLOCK SELF-REVIEW ---------- */
    const adOwnerCheck = await pool.query(
      `SELECT google_id FROM masters_tr_ads WHERE id = $1 LIMIT 1`,
      [adId]
    );
    // If the ad exists and the owner is the same as the reviewer
    if (adOwnerCheck.rows[0]?.google_id === reviewer_google_id) {
      return res.json({
        resStatus: false,
        resErrorCode: 7, // New error code for self-review
        resMessage: "Kendi ilanınızı değerlendiremezsiniz."
      });
    }

    /* ---------- BLOCK DUPLICATE ACTIVE REVIEW ---------- */
    const activeReviewCheck = await pool.query(
      `
      SELECT 1
      FROM masters_tr_reviews
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
        resMessage: "Bu ilanı daha önce değerlendirdiniz."
      });
    }
    /* ---------- BLOCK RE-POST AFTER SOFT DELETE ---------- */
    const deletedWithReplyCheck = await pool.query(
      `
      SELECT 1
      FROM masters_tr_reviews
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
          "İlan sahibi değerlendirmenize cevap verdiği için tekrardan değerlendirme yapamazsınız."
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
      INSERT INTO masters_tr_reviews
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
      UPDATE masters_tr_ads
      SET
        average_rating = COALESCE(sub.avg, 0),
        reviews_count  = COALESCE(sub.cnt, 0)
      FROM (
        SELECT
          ROUND(AVG(rating), 1) AS avg,
          COUNT(*) AS cnt
        FROM masters_tr_reviews
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
      resMessage: "Yorum kaydedildi.",
      review_id: insertReviewResult.rows[0].id
    });
  } catch (error) {
    console.error("Post review error:", error);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 99,
      resMessage: "Sunucu hatası"
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
      resMessage: "Alanlar eksik."
    });
  }

  try {
    // 1️⃣ get google_id from session
    const sessionQ = `
      SELECT google_id
      FROM masters_tr_sessions
      WHERE session_id = $1
      LIMIT 1
    `;
    const sessionR = await pool.query(sessionQ, [sessionId]);

    if (!sessionR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Geçersiz oturum"
      });
    }

    const ownerGoogleId = sessionR.rows[0].google_id;

    // 2️⃣ verify owner owns this ad
    const adQ = `
      SELECT google_id
      FROM masters_tr_ads
      WHERE id = $1
      LIMIT 1
    `;
    const adR = await pool.query(adQ, [adId]);

    if (!adR.rowCount || String(adR.rows[0].google_id) !== String(ownerGoogleId)) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "İlan sahibi değilsiniz"
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
      INSERT INTO masters_tr_reviews
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
      resMessage: "Cevap kaydedildi",
      reply_id: r.rows[0].id
    });

  } catch (err) {
    console.error("Reply error:", err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 4,
      resMessage: "Sunucu hatası"
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
      resMessage: "Eksik alan"
    });
  }

  try {
    // 1️⃣ get google_id from session
    const sessionQ = `
      SELECT google_id
      FROM masters_tr_sessions
      WHERE session_id = $1
      LIMIT 1
    `;
    const sessionR = await pool.query(sessionQ, [sessionId]);

    if (!sessionR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Geçersiz oturum"
      });
    }

    const ownerGoogleId = sessionR.rows[0].google_id;

    // 2️⃣ verify ad ownership
    const adQ = `
      SELECT google_id
      FROM masters_tr_ads
      WHERE id = $1
      LIMIT 1
    `;
    const adR = await pool.query(adQ, [adId]);

    if (!adR.rowCount || String(adR.rows[0].google_id) !== String(ownerGoogleId)) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "İlan sahibi değilsiniz"
      });
    }

    // 3️⃣ verify reply belongs to this ad + owner + is a reply
    const replyQ = `
      SELECT id
      FROM masters_tr_reviews
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
        resMessage: "Cevap bulunamadı"
      });
    }

    // 4️⃣ delete reply
    const deleteQ = `
      DELETE FROM masters_tr_reviews
      WHERE id = $1
    `;
    await pool.query(deleteQ, [replyId]);

    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Cevap silindi"
    });

  } catch (err) {
    console.error("Delete reply error:", err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 5,
      resMessage: "Sunucu hatası"
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
      resMessage: "Geçersiz mesaj alanları"
    });
  }
  // basic email sanity check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.json({
      resStatus: false,
      resErrorCode: 2,
      resMessage: "Geçersiz e-mail adresi"
    });
  }
  try {
    const d = new Date();
    const visitdate = `${String(d.getDate()).padStart(2, "0")}/${String(
      d.getMonth() + 1
    ).padStart(2, "0")}/${d.getFullYear()}`;

    const insertQ = `
      INSERT INTO messages_masters_tr
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
      resMessage: "Sunucu hatası"
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
      resMessage: "İlan no yanlış veya aktif oturum yok"
    });
  }

  try {
    // ---------------------------------------
    // 1) GET LIKER GOOGLE ID (FROM SESSION)
    // ---------------------------------------
    const sessionQ = `
      SELECT google_id
      FROM masters_tr_sessions
      WHERE session_id = $1
      LIMIT 1
    `;
    const sessionR = await pool.query(sessionQ, [sessionId]);

    if (!sessionR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Geçersiz oturum"
      });
    }

    const liker_google_id = sessionR.rows[0].google_id;

    // ---------------------------------------
    // 2) GET AD OWNER GOOGLE ID (MASTER)
    // ---------------------------------------
    const adQ = `
      SELECT google_id
      FROM masters_tr_ads
      WHERE id = $1
      LIMIT 1
    `;
    const adR = await pool.query(adQ, [ad_id]);

    if (!adR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "İlan bulunamadı"
      });
    }

    const master_google_id = adR.rows[0].google_id;

    // ---------------------------------------
    // 3) CHECK EXISTING LIKE ROW
    // ---------------------------------------
    const selectQ = `
      SELECT id, likers
      FROM masters_tr_likes
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
            `DELETE FROM masters_tr_likes WHERE id = $1`,
            [row.id]
          );
          return res.json({
            resStatus: true,
            resOkCode: 3,
            resMessage: "Beğeni silindi"
          });
        }

        await pool.query(
          `UPDATE masters_tr_likes SET likers = $1 WHERE id = $2`,
          [JSON.stringify(likers), row.id]
        );

        return res.json({
          resStatus: true,
          resOkCode: 4,
          resMessage: "Beğeni silindi"
        });
      }

      // ADD LIKE
      likers.push(liker_google_id);

      await pool.query(
        `UPDATE masters_tr_likes SET likers = $1 WHERE id = $2`,
        [JSON.stringify(likers), row.id]
      );

      return res.json({
        resStatus: true,
        resOkCode: 1,
        resMessage: "Beğeni kaydedildi"
      });
    }

    // ---------------------------------------
    // CASE B: NO ROW → CREATE NEW
    // ---------------------------------------
    const insertQ = `
      INSERT INTO masters_tr_likes (ad_id, master_id, likers)
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
      resMessage: "Beğeni kaydedildi"
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 99,
      resMessage: "Sunucu hatası"
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
      resMessage: "İlan no eksik"
    });
  }

  try {
    // Always fetch likes first (PUBLIC)
    const q = `
      SELECT likers
      FROM masters_tr_likes
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
      FROM masters_tr_sessions
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
      resMessage: "Sunucu hatası"
    });
  }
});
router.get("/get/reviews/:ad_id", applyReadRateLimit, async (req, res) => {
  const adId = req.params.ad_id;

  if (!adId) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "İlan no eksik"
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
      FROM masters_tr_reviews
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
      resMessage: "Sunucu hatası"
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
      resMessage: "Aktif oturum bulunamadı",
      reviews: []
    });
  }

  try {
    /* get google id from session */
    const sessionQuery = `
      SELECT google_id
      FROM masters_tr_sessions
      WHERE session_id = $1
      LIMIT 1;
    `;

    const sessionRes = await pool.query(sessionQuery, [sessionId]);

    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Aktif oturum bulunamadı",
        reviews: []
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    /* reviews + ad data (NO aliases) */
    const reviewsQuery = `
      SELECT
        masters_tr_reviews.id,
        masters_tr_reviews.review_text,
        masters_tr_reviews.rating,
        masters_tr_reviews.date,
        masters_tr_reviews.ad_id,

        masters_tr_ads.name  AS ad_owner_name,
        masters_tr_ads.title AS ad_title,
        masters_tr_ads.image_url AS ad_image_url
        FROM masters_tr_reviews
        JOIN masters_tr_ads
          ON masters_tr_ads.id = masters_tr_reviews.ad_id
        WHERE masters_tr_reviews.reviewer_id = $1
          AND masters_tr_reviews.is_deleted = false
          AND masters_tr_reviews.parent IS NULL
        ORDER BY masters_tr_reviews.id DESC;
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
      resMessage: "Kullanıcı hatası",
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
      resMessage: "Aktif oturum bulunamadı",
      reviews: []
    });
  }

  try {
    /* get google id from session */
    const sessionQuery = `
      SELECT google_id
      FROM masters_tr_sessions
      WHERE session_id = $1
      LIMIT 1;
    `;

    const sessionRes = await pool.query(sessionQuery, [sessionId]);

    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Aktif oturum bulunamadı",
        reviews: []
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    /* replies written BY the user */
    const repliesQuery = `
      SELECT
        masters_tr_reviews.id,
        masters_tr_reviews.review_text,
        masters_tr_reviews.date,
        masters_tr_reviews.ad_id,

        masters_tr_ads.name  AS ad_owner_name,
        masters_tr_ads.title AS ad_title,
        masters_tr_ads.image_url AS ad_image_url
        FROM masters_tr_reviews
        JOIN masters_tr_ads
          ON masters_tr_ads.id = masters_tr_reviews.ad_id
        WHERE masters_tr_reviews.reviewer_id = $1
          AND masters_tr_reviews.parent IS NOT NULL
          AND masters_tr_reviews.is_deleted = false
        ORDER BY masters_tr_reviews.id DESC;
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
      resMessage: "Sunucu hatası",
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
      resMessage: "Aktif oturum bulunamadı",
      resErrorCode: 1
    });
  }

  if (!reviewId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Geçersiz değerlendirme numarası",
      resErrorCode: 2
    });
  }

  try {
    /* GET GOOGLE ID FROM SESSION */
    const sessionRes = await pool.query(
      `
      SELECT google_id
      FROM masters_tr_sessions
      WHERE session_id = $1
      LIMIT 1;
      `,
      [sessionId]
    );

    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Geçersiz oturum",
        resErrorCode: 3
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    /* VERIFY OWNERSHIP + GET ad_id */
    const ownershipRes = await pool.query(
      `
      SELECT id, parent, ad_id
      FROM masters_tr_reviews
      WHERE id = $1
        AND reviewer_id = $2
      LIMIT 1;
      `,
      [reviewId, googleId]
    );

    if (!ownershipRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Geçersiz",
        resErrorCode: 4
      });
    }

    const { parent, ad_id: adId } = ownershipRes.rows[0];

    /* ---------- DELETE LOGIC ---------- */
    // Reply → hard delete
    if (parent !== null) {
      await pool.query(
        `DELETE FROM masters_tr_reviews WHERE id = $1;`,
        [reviewId]
      );
    } else {
      // Main review → check replies
      const replyRes = await pool.query(
        `
        SELECT 1
        FROM masters_tr_reviews
        WHERE parent = $1
        LIMIT 1;
        `,
        [reviewId]
      );

      if (replyRes.rowCount) {
        // Soft delete review + replies
        await pool.query(
          `
          UPDATE masters_tr_reviews
          SET is_deleted = true
          WHERE id = $1 OR parent = $1;
          `,
          [reviewId]
        );
      } else {
        // Hard delete review
        await pool.query(
          `DELETE FROM masters_tr_reviews WHERE id = $1;`,
          [reviewId]
        );
      }
    }

    /* ---------- RECALCULATE STATS ---------- */

    await pool.query(
      `
      UPDATE masters_tr_ads
      SET
        average_rating = COALESCE(sub.avg, 0),
        reviews_count  = COALESCE(sub.cnt, 0)
      FROM (
        SELECT
          ROUND(AVG(rating), 1) AS avg,
          COUNT(*) AS cnt
        FROM masters_tr_reviews
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
      resMessage: "Değerlendirme silindi"
    });

  } catch (error) {
    console.error("Delete review error:", error);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database hatası",
      resErrorCode: 5
    });
  }
});
/*Email register only send email verification link */
router.post("/post/auth/email-register", blockMaliciousIPs, applyWriteRateLimit, validateEmail,
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


  if (name.length < 2 || email.length < 5 || password.length < 6) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Geçersiz veriler"
    });
  }

  try {

    const checkQ = `
      SELECT google_id
      FROM masters_tr_users
      WHERE email = $1
      LIMIT 1
    `;
    const checkR = await pool.query(checkQ, [email]);

    if (checkR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "Email adresi zaten kayıtlı"
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
      process.env.ENIYIUSTA_EMAIL_VERIFY_JWT_SECRET,
      { expiresIn: "24h" }
    );

    const verifyLink = `https://eniyiusta.com.tr/verify-email.html?token=${encodeURIComponent(verifyToken)}`;

    const brevoResult = await sendEmailBrevo({
      site: "eniyiusta",
      to: email,
      subject: "E-posta adresinizi doğrulayın",
      html: `
        <p>Merhaba${name ? `, ${name}` : ""},</p>
        <p>Kaydınızı tamamlamak için aşağıdaki bağlantıya tıklayarak e-posta adresinizi doğrulayın:</p>
        <p><a href="${verifyLink}">E-postayı doğrula</a></p>
        <p>Bu bağlantı 24 saat geçerlidir.</p>
        <p>Eğer bu işlemi siz yapmadıysanız, bu e-postayı yok sayabilirsiniz.</p>
      `,
      text:
        `Merhaba${name ? `, ${name}` : ""},

    Kaydınızı tamamlamak için aşağıdaki bağlantıyı açın:

    ${verifyLink}

    Bu bağlantı 24 saat geçerlidir.

    Eğer bu işlemi siz yapmadıysanız, bu e-postayı yok sayabilirsiniz.`
    });
    req.emailActionCooldown.registerSuccess();
    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Doğrulama e-postası gönderildi"
    });

  } catch (err) {

    return res.status(500).json({
      resStatus: false,
      resErrorCode: 99,
      resMessage: "Sunucu hatası"
    });
  }
});
router.post("/post/auth/email-login", blockMaliciousIPs, applyWriteRateLimit, enforceLoginProtection, validateEmail,
  async (req, res) => {
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
        resMessage: "Şifre veya e-mail çok kısa"
      });
    }

    try {
      const userQ = `
        SELECT
          masters_tr_users.google_id,
          masters_tr_users.email,
          masters_tr_users.name,
          masters_tr_users.password_hash,
          masters_tr_users.auth_provider,
          masters_tr_users.email_verified
        FROM masters_tr_users
        WHERE masters_tr_users.email = $1
        LIMIT 1
      `;
      const userR = await pool.query(userQ, [email]);

      if (!userR.rowCount) {
        return res.json({
          resStatus: false,
          resErrorCode: 3,
          resMessage: "Geçersiz e-posta veya şifre"
        });
      }

      const user = userR.rows[0];

      if (user.auth_provider !== "email") {
        return res.json({
          resStatus: false,
          resErrorCode: 4,
          resMessage: "Bu e-posta ile Google üzerinden giriş yapılmış. Lütfen Google girişi kullanın."
        });
      }

      if (!user.password_hash) {
        return res.json({
          resStatus: false,
          resErrorCode: 5,
          resMessage: "Bu e-posta ile Google üzerinden giriş yapılmış. Lütfen Google girişi kullanın."
        });
      }

      if (!user.email_verified) {
        return res.json({
          resStatus: false,
          resErrorCode: 7,
          resMessage: "E-posta adresinizi doğrulayın"
        });
      }

      const ok = await bcrypt.compare(password, user.password_hash);

      if (!ok) {
        return res.json({
          resStatus: false,
          resErrorCode: 6,
          resMessage: "Hatalı e-mail veya şifre"
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
        resMessage: "Giriş başarılı",
        user: {
          google_id: user.google_id,
          email: user.email,
          name: user.name
        }
      });

    } catch (err) {
      console.error("Email login error:", err);
      return res.status(500).json({
        resStatus: false,
        resErrorCode: 99,
        resMessage: "Sunucu hatası"
      });
    }
  });
router.get("/get/session-user", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
  // Desktop can use cookies but some mobiles will use headers for login system
  const auth = req.headers.authorization || "";
  const bearerSid = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

  const sessionId = bearerSid || req.cookies?.session_id;

  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Aktif oturum bulunmadı",
      resErrorCode: 1,
      loggedIn: false
    });
  }

  try {
    const query = `
      SELECT 
        masters_tr_users.google_id,
        masters_tr_users.email,
        masters_tr_users.name
      FROM masters_tr_sessions
      JOIN masters_tr_users
        ON masters_tr_users.google_id = masters_tr_sessions.google_id
      WHERE masters_tr_sessions.session_id = $1
      LIMIT 1;
    `;

    const result = await pool.query(query, [sessionId]);

    if (result.rowCount === 0) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Aktif oturum bulunamadı",
        resErrorCode: 2,
        loggedIn: false
      });
    }

    const user = result.rows[0];

    return res.status(200).json({
      resStatus: true,
      resMessage: "Kullanıcı oturumu aktif",
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
      resMessage: "Database/Sunucu hatası",
      resErrorCode: 3,
      loggedIn: false
    });
  }
});
router.post("/post/auth/email-forget", blockMaliciousIPs, applyWriteRateLimit, validateEmail,
  enforceEmailActionCooldown("email_reset"), async (req, res) => {

  const email = String(req.body.email || "").trim().toLowerCase();
  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const userQuery = `
      SELECT masters_tr_users.google_id, masters_tr_users.email, masters_tr_users.name, masters_tr_users.auth_provider
      FROM masters_tr_users
      WHERE LOWER(masters_tr_users.email) = $1
      LIMIT 1;
    `;
    const userResult = await client.query(userQuery, [email]);

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(200).json({
        resStatus: true,
        resMessage: "Eğer e-posta adresi kayıtlıysa, bir e-posta gönderilecektir",
        resOkCode: 1
      });
    }

    const user = userResult.rows[0];

    if (user.auth_provider !== "email") {
      await client.query("ROLLBACK");
      return res.status(200).json({
        resStatus: false,
        resErrorCode: 6,
        resMessage: "Bu e-posta ile Google üzerinden giriş yapılmış. Lütfen Google girişi kullanın."
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpires = new Date(Date.now() + 1000 * 60 * 60);

    const updateQuery = `
      UPDATE masters_tr_users
      SET password_reset_token = $1,
          password_reset_expires = $2
      WHERE masters_tr_users.google_id = $3
    `;
    await client.query(updateQuery, [resetToken, resetExpires, user.google_id]);

    const resetLink = `https://eniyiusta.com.tr/reset-password.html?token=${resetToken}`;

    await sendEmailBrevo({
      site: "eniyiusta",
      to: user.email,
      subject: "Şifre sıfırlama",
      html: `
        <p>Merhaba${user.name ? `, ${user.name}` : ""},</p>
        <p>Şifrenizi sıfırlamak için aşağıdaki bağlantıya tıklayın:</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        <p>Bu bağlantı 1 saat geçerlidir.</p>
        <p>Eğer bu işlemi siz yapmadıysanız, bu e-postayı yok sayabilirsiniz.</p>
      `,
      text:
        `Merhaba${user.name ? `, ${user.name}` : ""},

Şifrenizi sıfırlamak için aşağıdaki bağlantıyı açın:
${resetLink}

Bu bağlantı 1 saat geçerlidir.

Eğer bu işlemi siz yapmadıysanız, bu e-postayı yok sayabilirsiniz.`
    });

    await client.query("COMMIT");

    req.emailActionCooldown.registerSuccess();

    return res.status(200).json({
      resStatus: true,
      resMessage: "Eğer e-posta adresi kayıtlıysa, bir e-posta gönderilecektir",
      resOkCode: 2
    });

  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {}
    }

    return res.status(500).json({
      resStatus: false,
      resMessage:
        error?.response?.data?.message ||
        error?.message ||
        "E-posta gönderilemedi",
      resErrorCode: 2
    });
  } finally {
    if (client) client.release();
  }
});
router.post("/post/auth/email-reset", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {

  const token = String(req.body.token || "").trim();
  const newPassword = String(req.body.newPassword || "");

  if (!token) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Token yok",
      resErrorCode: 1
    });
  }

  if (!newPassword || newPassword.length < 6 || newPassword.length > 120) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Geçersiz şifre, şifrenizi değiştirin",
      resErrorCode: 2
    });
  }

  let client;

  try {
    client = await pool.connect();

    const userQuery = `
      SELECT google_id, email, password_reset_token, password_reset_expires
      FROM masters_tr_users
      WHERE password_reset_token = $1
      LIMIT 1;
    `;
    const userResult = await client.query(userQuery, [token]);

    if (userResult.rows.length === 0) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Geçersiz veya süresi dolmuş sıfırlama bağlantısı",
        resErrorCode: 3
      });
    }

    const user = userResult.rows[0];

    if (!user.password_reset_expires || new Date(user.password_reset_expires) < new Date()) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Sıfırlama bağlantısı süresi doldu, yeni sıfırlama maili alın",
        resErrorCode: 4
      });
    }
    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    const updateQuery = `
      UPDATE masters_tr_users
      SET password_hash = $1,
          password_reset_token = NULL,
          password_reset_expires = NULL
      WHERE google_id = $2
    `;
    await client.query(updateQuery, [newPasswordHash, user.google_id]);
    return res.status(200).json({
      resStatus: true,
      resMessage: "Şifre güncellendi",
      resOkCode: 1
    });
  } catch (error) {
    console.error("[email-reset] full error:", error);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Şifre güncellenemedi",
      resErrorCode: 5
    });
  } finally {
    if (client) client.release();
  }
});
//email-verify creates the user
router.post("/post/auth/email-verify", blockMaliciousIPs, applyWriteRateLimit, async (req, res) => {
  const token = String(req.body.token || "").trim();

  if (!token) {
    return res.status(400).json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Token eksik"
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.ENIYIUSTA_EMAIL_VERIFY_JWT_SECRET
    );

    const name = String(decoded.name || "").trim().slice(0, 80);
    const email = String(decoded.email || "").trim().toLowerCase().slice(0, 120);
    const passwordHash = String(decoded.passwordHash || "");
    const ipVisitor = String(decoded.ipVisitor || "").trim().slice(0, 100);

    const checkQ = `
      SELECT masters_tr_users.google_id
      FROM masters_tr_users
      WHERE masters_tr_users.email = $1
      LIMIT 1
    `;
    const checkR = await pool.query(checkQ, [email]);

    if (checkR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Hesap zaten mevcut"
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
        `SELECT masters_tr_users.google_id
         FROM masters_tr_users
         WHERE masters_tr_users.google_id = $1
         LIMIT 1`,
        [googleId]
      );

      exists = r.rowCount > 0;

      if (attempts > 20) {
        throw new Error("Could not generate unique google_id");
      }
    }

    const today = new Date().toISOString().slice(0, 10);

    const insertQ = `
      INSERT INTO masters_tr_users
      (google_id, email, name, date, ip, auth_provider, password_hash, email_verified)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true)
      RETURNING masters_tr_users.google_id
    `;

    const insertR = await pool.query(insertQ, [
      googleId,
      email,
      name,
      today,
      ipVisitor,
      "email",
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
      resMessage: "E-posta adresi doğrulandı",
      user: {
        google_id: dbGoogleId,
        email,
        name
      }
    });

  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(400).json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "Doğrulama bağlantısı geçerli değil"
      });
    }

    if (err.name === "JsonWebTokenError") {
      return res.status(400).json({
        resStatus: false,
        resErrorCode: 4,
        resMessage: "Geçersiz doğrulama işlemi"
      });
    }

    if (err.code === "23505") {
      return res.status(400).json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Hesap zaten mevcut"
      });
    }

    console.error("Email verify error:", err);

    return res.status(500).json({
      resStatus: false,
      resErrorCode: 99,
      resMessage: "Sunucu hatası"
    });
  }
});
router.get("/get/ad/:id", applyReadRateLimit, async (req, res) => {
  const adId = req.params.id;

  try {
    const q = `
      SELECT 
        id, name, title, description, price, city, district, date, views,
        telephone, image_url, google_id, main_group, sub_group,
        average_rating, reviews_count
      FROM masters_tr_ads
      WHERE masters_tr_ads.id = $1
        AND masters_tr_ads.is_active = true
      LIMIT 1
    `;
    const r = await pool.query(q, [adId]);

    if (!r.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 1,
        resMessage: "İlan bulunamadı"
      });
    }

    const ad = r.rows[0];
    const { main_group, sub_group } = ad;

    let newerId = null;
    let olderId = null;

    if (sub_group) {
      const newerQ = `
        SELECT id FROM masters_tr_ads
        WHERE main_group = $2
          AND sub_group = $3
          AND id > $1
        ORDER BY id ASC
        LIMIT 1
      `;
      const olderQ = `
        SELECT id FROM masters_tr_ads
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
        SELECT id FROM masters_tr_ads
        WHERE main_group = $2
          AND id > $1
        ORDER BY id ASC
        LIMIT 1
      `;
      const olderQ = `
        SELECT id FROM masters_tr_ads
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
      resMessage: "Sunucu hatası"
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
      resMessage: "Aktif oturum bulunamadı",
      resErrorCode: 1,
      ads: []
    });
  }
  try {
    // find google_id from session
    const sessionQuery = `
      SELECT google_id
      FROM masters_tr_sessions
      WHERE session_id = $1
      LIMIT 1;
    `;
    const sessionRes = await pool.query(sessionQuery, [sessionId]);
    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Aktif oturum bulunamadı",
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
        district, 
        image_url, 
        date,
        created_at,      
        is_active       
      FROM masters_tr_ads
      WHERE masters_tr_ads.google_id = $1
      ORDER BY masters_tr_ads.created_at DESC, masters_tr_ads.id DESC;
    `;
    const adsRes = await pool.query(adsQuery, [googleId]);
    return res.status(200).json({
      resStatus: true,
      resMessage: "Kullanıcı ilanları başarıyla yüklendi",
      resOkCode: 1,
      ads: adsRes.rows
    });
  } catch (error) {
    console.error("User ads fetch error:", error);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Sunucu hatası",
      resErrorCode: 3,
      ads: []
    });
  }
});



router.get("/get/search", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
  const q = String(req.query.q || "").trim();

  const PAGE_SIZE = 12;
  const HARD_CAP = 1000;

  let page = parseInt(req.query.page, 10) || 1;
  if (page < 1) page = 1;

  const limit = PAGE_SIZE;
  const offset = (page - 1) * limit;

  // validation
  if (q.length < 3 || q.length > 60) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Aranan kelime çok kısa veya çok uzun"
    });
  }

  if (!/^[^<>]{3,60}$/.test(q) || /[\p{Cc}\p{Cf}]/gu.test(q)) {
    return res.json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Aranan kelime geçersiz"
    });
  }

  // hard cap protection
  if (offset >= HARD_CAP) {
    return res.json({
      resStatus: true,
      resOkCode: 1,
      ads: [],
      pagination: {
        currentPage: page,
        pageSize: PAGE_SIZE,
        totalResults: HARD_CAP,
        totalPages: Math.ceil(HARD_CAP / PAGE_SIZE),
        hardCap: HARD_CAP
      }
    });
  }

  try {
    // count query
    const countQ = `
      SELECT COUNT(*)
      FROM masters_tr_ads
      WHERE is_active = true
        AND (title ILIKE $1 OR description ILIKE $1)
    `;

    const countR = await pool.query(countQ, [`%${q}%`]);

    const realTotal = parseInt(countR.rows[0].count, 10) || 0;
    const totalResults = Math.min(realTotal, HARD_CAP);
    const totalPages = Math.max(1, Math.ceil(totalResults / PAGE_SIZE));

    // data query
    const dataQ = `
      SELECT 
        id,
        name,
        title,
        description,
        price,
        city,
        district,
        date,
        created_at,
        views,
        telephone,
        image_url,
        google_id,
        main_group,
        sub_group,
        average_rating,
        reviews_count
      FROM masters_tr_ads
      WHERE is_active = true
        AND (title ILIKE $1 OR description ILIKE $1)
      ORDER BY created_at DESC
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
        currentPage: page,
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
      resMessage: "Sunucu hatası"
    });
  }
});
router.get("/get/search-filter", applyReadRateLimit, blockMaliciousIPs, async (req, res) => {
  const q = String(req.query.q || "").trim();

  if (q.length < 3 || q.length > 60) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Aranan kelime çok uzun veya çok kısa"
    });
  }

  if (!/^[^<>]{3,60}$/.test(q)) {
    return res.json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Aranan kelime geçersiz"
    });
  }

  const {
    title,      // actually sub_group id from dropdown
    city,       // province id
    town,       // district id
    minRating,
    minReviews
  } = req.query;

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
        currentPage: page,
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

    // profession dropdown = sub_group id
    if (title) {
      const subGroupId = Number(title);
      if (!Number.isNaN(subGroupId)) {
        conditions.push(`sub_group = $${i}`);
        values.push(subGroupId);
        i++;
      }
    }

    // province filter
    if (city) {
      const cityId = Number(city);
      if (!Number.isNaN(cityId)) {
        conditions.push(`city::jsonb @> $${i}::jsonb`);
        values.push(JSON.stringify([cityId]));
        i++;
      }
    }

    // district filter
    if (town) {
      const townId = Number(town);
      if (!Number.isNaN(townId)) {
        conditions.push(`district::jsonb @> $${i}::jsonb`);
        values.push(JSON.stringify([townId]));
        i++;
      }
    }

    // rating filter
    if (minRating !== undefined && minRating !== "") {
      const r = Number(minRating);
      if (!Number.isNaN(r)) {
        conditions.push(`average_rating >= $${i}`);
        values.push(r);
        i++;
      }
    }

    // reviews filter
    if (minReviews !== undefined && minReviews !== "") {
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
      FROM masters_tr_ads
      ${whereClause}
    `;

    const countR = await pool.query(countQ, values);

    const realTotal = parseInt(countR.rows[0].count, 10) || 0;
    const totalResults = Math.min(realTotal, HARD_CAP);
    const totalPages = Math.max(1, Math.ceil(totalResults / PAGE_SIZE));

    const dataQ = `
      SELECT
        id,
        name,
        title,
        description,
        price,
        city,
        district,
        date,
        created_at,
        views,
        telephone,
        image_url,
        google_id,
        main_group,
        sub_group,
        average_rating,
        reviews_count
      FROM masters_tr_ads
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
    `;

    const dataR = await pool.query(dataQ, [...values, limit, offset]);

    return res.json({
      resStatus: true,
      ads: dataR.rows,
      pagination: {
        currentPage: page,
        pageSize: PAGE_SIZE,
        totalResults,
        totalPages
      }
    });

  } catch (err) {
    console.error("Search filter error:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Sunucu hatası"
    });
  }
});
router.get("/get/browse", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
  const { main, sub, cursor } = req.query;
  const limit = 12;

  try {
    let query = `
      SELECT 
        id, name, title, description, price, city, district, date, views,
        telephone, image_url, google_id, main_group, sub_group,
        average_rating, created_at, reviews_count
      FROM masters_tr_ads
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
      resMessage: "Sunucu hatası"
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
        district,
        description,
        average_rating,
        reviews_count,
        image_url ->> 0 AS image
      FROM masters_tr_carousel
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
      resMessage: "Sunucu hatası",
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
    town,        
    minRating,
    minReviews,
    cursor
  } = req.query;

  const limit = 12;

  try {
    const conditions = [`is_active = true`];
    const values = [];
    let i = 1;

    // browse page scope from URL
    if (main) {
      const mainNum = Number(main);
      if (!Number.isNaN(mainNum)) {
        conditions.push(`main_group = $${i}`);
        values.push(mainNum);
        i++;
      }
    }

    if (sub) {
      const subNum = Number(sub);
      if (!Number.isNaN(subNum)) {
        conditions.push(`sub_group = $${i}`);
        values.push(subNum);
        i++;
      }
    }

    // filter dropdown "title" is actually sub_group id
    // only apply if browse scope sub is not already set
    if (title && !sub) {
      const titleNum = Number(title);
      if (!Number.isNaN(titleNum)) {
        conditions.push(`sub_group = $${i}`);
        values.push(titleNum);
        i++;
      }
    }

    // province filter
    if (city) {
      const cityId = Number(city);
      if (!Number.isNaN(cityId)) {
        conditions.push(`city::jsonb @> $${i}::jsonb`);
        values.push(JSON.stringify([cityId]));
        i++;
      }
    }

    // district filter (frontend sends "town")
    if (town) {
      const townId = Number(town);
      if (!Number.isNaN(townId)) {
        conditions.push(`district::jsonb @> $${i}::jsonb`);
        values.push(JSON.stringify([townId]));
        i++;
      }
    }

    if (minRating !== undefined && minRating !== "") {
      const ratingNum = Number(minRating);
      if (!Number.isNaN(ratingNum)) {
        conditions.push(`average_rating >= $${i}`);
        values.push(ratingNum);
        i++;
      }
    }

    if (minReviews !== undefined && minReviews !== "") {
      const reviewsNum = Number(minReviews);
      if (!Number.isNaN(reviewsNum)) {
        conditions.push(`reviews_count >= $${i}`);
        values.push(reviewsNum);
        i++;
      }
    }

    if (cursor) {
      conditions.push(`created_at < $${i}`);
      values.push(cursor);
      i++;
    }

    const query = `
      SELECT
        id, name, title, description, price, city, district,
        date, created_at, views, telephone, image_url, google_id,
        main_group, sub_group, average_rating, reviews_count
      FROM masters_tr_ads
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${i}
    `;

    values.push(limit);

    const { rows } = await pool.query(query, values);

    return res.json({
      resStatus: true,
      ads: rows,
      nextCursor: rows.length ? rows[rows.length - 1].created_at : null
    });

  } catch (err) {
    console.error("Browse filter error:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Sunucu hatası"
    });
  }
});

module.exports = router;