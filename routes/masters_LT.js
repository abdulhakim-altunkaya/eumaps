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

// GET /api/get/master-lithuania/homepage/carousel
router.get("/homepage/carousel", async (req, res) => {
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

// GET /api/get/master-lithuania/browse-filter
router.get("/browse-filter", blockMaliciousIPs, applyReadRateLimit, async (req, res) => {
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