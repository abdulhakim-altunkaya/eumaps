const express = require("express");
const router = express.Router();

const { pool } = require("../db");
const { 
  extractClientIP,
  blockMaliciousIPs,
  applyReadRateLimit, 
  applyWriteRateLimit,
  enforceAdPostingCooldown,
  checkLogCooldown
} = require("../middleware/masters_MW");


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
      FROM masters_LT_reviews
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
      FROM masters_LT_sessions
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
        masters_LT_reviews.id,
        masters_LT_reviews.review_text,
        masters_LT_reviews.rating,
        masters_LT_reviews.date,
        masters_LT_reviews.ad_id,

        masters_LT_ads.name  AS ad_owner_name,
        masters_LT_ads.title AS ad_title,
        masters_LT_ads.image_url AS ad_image_url
      FROM masters_LT_reviews
      JOIN masters_LT_ads
        ON masters_LT_ads.id = masters_LT_reviews.ad_id
      WHERE masters_LT_reviews.reviewer_id = $1
        AND masters_LT_reviews.is_deleted = false
        AND masters_LT_reviews.parent IS NULL
      ORDER BY masters_LT_reviews.id DESC;
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
      FROM masters_LT_sessions
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
        masters_LT_reviews.id,
        masters_LT_reviews.review_text,
        masters_LT_reviews.date,
        masters_LT_reviews.ad_id,

        masters_LT_ads.name  AS ad_owner_name,
        masters_LT_ads.title AS ad_title,
        masters_LT_ads.image_url AS ad_image_url
      FROM masters_LT_reviews
      JOIN masters_LT_ads
        ON masters_LT_ads.id = masters_LT_reviews.ad_id
      WHERE masters_LT_reviews.reviewer_id = $1
        AND masters_LT_reviews.parent IS NOT NULL
        AND masters_LT_reviews.is_deleted = false
      ORDER BY masters_LT_reviews.id DESC;
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
      FROM masters_LT_sessions
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
      FROM masters_LT_reviews
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
        `DELETE FROM masters_LT_reviews WHERE id = $1;`,
        [reviewId]
      );
    } else {
      // Main review → check replies
      const replyRes = await pool.query(
        `
        SELECT 1
        FROM masters_LT_reviews
        WHERE parent = $1
        LIMIT 1;
        `,
        [reviewId]
      );

      if (replyRes.rowCount) {
        // Soft delete review + replies
        await pool.query(
          `
          UPDATE masters_LT_reviews
          SET is_deleted = true
          WHERE id = $1 OR parent = $1;
          `,
          [reviewId]
        );
      } else {
        // Hard delete review
        await pool.query(
          `DELETE FROM masters_LT_reviews WHERE id = $1;`,
          [reviewId]
        );
      }
    }

    /* ---------- RECALCULATE STATS ---------- */

    await pool.query(
      `
      UPDATE masters_LT_ads
      SET
        average_rating = COALESCE(sub.avg, 0),
        reviews_count  = COALESCE(sub.cnt, 0)
      FROM (
        SELECT
          ROUND(AVG(rating), 1) AS avg,
          COUNT(*) AS cnt
        FROM masters_LT_reviews
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
        masters_LT_users.google_id,
        masters_LT_users.email,
        masters_LT_users.name
      FROM masters_LT_sessions
      JOIN masters_LT_users
        ON masters_LT_users.google_id = masters_LT_sessions.google_id
      WHERE masters_LT_sessions.session_id = $1
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

router.get("/get/ad/:id", applyReadRateLimit, async (req, res) => {
  const adId = req.params.id;

  try {
    const q = `
      SELECT 
        id, name, title, description, price, city, date, views,
        telephone, image_url, google_id, main_group, sub_group,
        average_rating, reviews_count
      FROM masters_LT_ads
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
        SELECT id FROM masters_LT_ads
        WHERE main_group = $2
          AND sub_group = $3
          AND id > $1
        ORDER BY id ASC
        LIMIT 1
      `;
      const olderQ = `
        SELECT id FROM masters_LT_ads
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
        SELECT id FROM masters_LT_ads
        WHERE main_group = $2
          AND id > $1
        ORDER BY id ASC
        LIMIT 1
      `;
      const olderQ = `
        SELECT id FROM masters_LT_ads
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
      FROM masters_LT_sessions
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
      FROM masters_LT_ads
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
      FROM masters_LT_ads
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
      FROM masters_LT_ads
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
      FROM masters_LT_ads
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
      FROM masters_LT_ads
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
      FROM masters_LT_ads
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
      FROM masters_LT_carousel
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
      FROM masters_LT_ads
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