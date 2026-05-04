require("dotenv").config();
const { Pool } = require("pg");
const { createClient } = require("@supabase/supabase-js");
const multer = require("multer");

// ---- PostgreSQL (Supabase Postgres) ----
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for Supabase-hosted Postgres
});

// ---- Supabase Storage (server-side secret key) ----
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY // MUST be the service_role or anon key with storage permissions
);

// ---- Multer Configuration (upload up to 5 images, 3MB max each) ----
const storage = multer.memoryStorage(); // keeps images in RAM before upload
const upload = multer({
  storage,
  limits: {
    fileSize: 3 * 1024 * 1024, // 3MB max per file
    files: 5 // max 5 images
  }
});

module.exports = { pool, supabase, upload };
