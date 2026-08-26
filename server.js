const express = require("express");
const app = express();
const path = require('path');
const os = require("os");
//crypto and cookieParser are for masters email and google login/register endpoints
const crypto = require("crypto");
const bcrypt = require("bcrypt");

const cookieParser = require("cookie-parser");
app.use(cookieParser());

const { pool, supabase, upload } = require("./db"); // Import configurations
const useragent = require("useragent");
// ADD THIS NEAR TOP
const axios = require('axios');
const {
    extractClientIP,
    blockMaliciousIPs,
    applyWriteRateLimit,
    applyReadRateLimit,
    enforceAdPostingCooldown,
    checkLogCooldown,
    enforceLoginProtection,
    actionCooldown,
    validateEmail
  } = require("./middleware/masters_MW");

const sendEmailBrevo = require("./utils/sendEmailBrevo");

const cors = require("cors");
//app.use(cors()); 

const allowedOrigins = [
  'https://www.eumaps.org',
  'https://eumaps.org',
  'https://www.letonyaoturum.com',
  'https://letonyaoturum.com',
  'https://www.latviaresidency.org',
  'https://latviaresidency.org',
  "https://meistarilatvija.lv",
  "http://meistarilatvija.lv",
  "https://www.meistarilatvija.lv",
  "http://www.meistarilatvija.lv",
  "https://latvia-masters.netlify.app",
  "https://www.pagalbapro.lt",
  "http://www.pagalbapro.lt",
  "https://pagalbapro.lt",
  "http://pagalbapro.lt",
  "https://masterslt.netlify.app",
  "https://eniyiusta.com.tr",
  "https://www.eniyiusta.com.tr",
  "http://eniyiusta.com.tr",
  "http://www.eniyiusta.com.tr",
  "https://salonemasters.com",
  "https://www.salonemasters.com",
  "http://salonemasters.com",
  "http://www.salonemasters.com",
  "https://stupendous-florentine-898886.netlify.app",
  "https://grilslatvija.lv",
  "https://www.grilslatvija.lv",
  "http://grilslatvija.lv",
  "http://www.grilslatvija.lv",
  "https://grilslatvija.netlify.app",
  "https://filebeef.com",
  "https://www.filebeef.com",
  "http://filebeef.com",
  "http://www.filebeef.com",
  "https://filebeef.netlify.app"
];


app.use(cors({
  origin: function (origin, callback) {

    const normalizedOrigin =
      origin?.replace(/\/$/, '');

    if (!origin) {
      return callback(null, true);
    }

    if (
      normalizedOrigin &&
      allowedOrigins.includes(normalizedOrigin)
    ) {
      return callback(null, true);
    }

    return callback(
      new Error(`Not allowed by CORS: ${origin}`)
    );
  },

  credentials: true,

  methods: [
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'OPTIONS'
  ],

  allowedHeaders: [
    'Content-Type',
    'Authorization'
  ],
}));
/*
  "http://127.0.0.1:8080",
  "http://192.168.8.103:8080",
   */

/*Google login for masters latvia*/
const { OAuth2Client } = require("google-auth-library");
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID); // FIXED

app.options('*', cors())
app.set('trust proxy', 1);
// Stripe webhook needs raw body — must come before express.json()
app.use('/api/post/filebeef/payments/webhook', express.raw({ type: 'application/json' }))
//we need this as we use req.body to send data from frontend to backend
app.use(express.json());

//Then go to server.js file and make sure you serve static files from build directory:
app.use(express.static(__dirname));
//For serving from build directory, you need to install path package and initiate it:


//import and then mount masters master routes
//Mounting routes must come after cors and other imports
const mastersLTRoutes = require("./routes/masters_LT");
app.use("/api/master-lithuania", mastersLTRoutes);
const mastersLVRoutes = require("./routes/masters_LV");
app.use("/", mastersLVRoutes);
const mastersTRRoutes = require("./routes/masters_TR");
app.use("/api/master-turkey", mastersTRRoutes);
const mastersSLRoutes = require("./routes/masters_SL");
app.use("/api/master-sierraleone", mastersSLRoutes);
const grillsLVRoutes = require("./routes/grills_LV");
app.use("/", grillsLVRoutes);
const filebeefRoutes = require("./routes/filebeef");
app.use("/", filebeefRoutes);


app.post("/serversavecomment", blockMaliciousIPs, actionCooldown("postMessage", 3 * 60 * 1000), async (req, res) => {
  let client;
  const newComment = req.body;
  const {pageId, name, text, date} = newComment;
  try {
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO eumaps_comments (sectionid, date, name, comment) values ($1, $2, $3, $4)`, [pageId, date, name, text]
    );
    res.status(201).json({message: "Yorum kaydedildi"});
  } catch (error) {
    console.log(error.message);
    res.status(500).json({message: "Error while saving comment"})
  } finally {
    if(client) client.release();
  }
});
app.post("/serversavecommentreply", blockMaliciousIPs, actionCooldown("postMessage", 3 * 60 * 1000), async (req, res) => {
  let client;
  const newComment = req.body;
  const {pageId3, name, text, date, commentId} = newComment;

  try {
    client = await pool.connect(); 
    const result = await client.query(
      `INSERT INTO eumaps_comments (sectionid, date, name, comment, parent_id) values ($1, $2, $3, $4, $5)`, 
      [pageId3, date, name, text, commentId]
    );
    res.status(201).json({message: "Cevap kaydedildi"});
  } catch (error) {
    console.log(error.message);
    res.status(500).json({message: "Error while saving reply"})
  } finally {
    if(client) client.release();
  }
});
app.get("/servergetcomments/:pageId", async (req, res) => {
  let client;
  const { pageId } = req.params;
  try {
    client = await pool.connect(); 
    const result = await client.query(
      `SELECT * FROM eumaps_comments 
      WHERE sectionid = $1
      ORDER BY id DESC`, [pageId]
    );
    const allComments = await result.rows;
    if(!allComments) {
      return res.status(404).json({ message: "No comments yet"})
    }
    res.status(200).json(allComments);
  } catch (error) {
    console.log(error.message);
    res.status(500).json({message: "Error while fetching comments"})
  } finally {
    if(client) client.release();
  }
});

app.post("/serversavevisitor/:pageIdVisitorPage", checkLogCooldown(1 * 60 * 1000), async (req, res) => {
  console.log("[visitor-log] endpoint hit, shouldLogVisit:", req.shouldLogVisit, "ip:", req.clientIp);
  if (!req.shouldLogVisit) {
    return res.status(200).end();
  }
  const ipVisitor = req.clientIp;
  const { pageIdVisitorPage } = req.params;
  let client;
  const userAgentString = req.get("User-Agent");
  console.log("[visitor-log] userAgentString:", userAgentString);
  const agent = useragent.parse(userAgentString);
  console.log("[visitor-log] parsed agent os/browser:", agent.os.toString(), agent.toAgent());
  try {
    const visitorData = {
      ip: ipVisitor,
      os: agent.os.toString(),
      browser: agent.toAgent(),
      visitDate: new Date().toLocaleDateString("en-GB"),
      sectionName: pageIdVisitorPage
    };
    console.log("[visitor-log] about to insert:", visitorData);

    client = await pool.connect();
    console.log("[visitor-log] db client connected");

    await client.query(
      `INSERT INTO eumaps_visitors (ip, op, browser, date, sectionid)
       VALUES ($1, $2, $3, $4, $5)`,
      [visitorData.ip, visitorData.os, visitorData.browser, visitorData.visitDate, visitorData.sectionName]
    );
    console.log("[visitor-log] insert succeeded");

    return res.status(200).json({ message: "Visitor IP successfully logged" });
  } catch (error) {
    console.error("[visitor-log] Error logging visit:", error);
    return res.status(500).json({ message: "Error logging visit" });
  } finally {
    if (client) client.release();
  }
});


// LOG VISITORS
app.post("/api/get-coordinates-and-log-visitor", async (req, res) => {
  const { ipInput } = req.body;

  try {
    const apiKey = process.env.IPAPI_KEY;
    const response = await axios.get(`http://api.ipapi.com/api/${ipInput}?access_key=${apiKey}`);

    const geoData = {
      latitude: response.data.latitude,
      longitude: response.data.longitude,
      country_name: response.data.country_name,
      city: response.data.city,
      connection_type: response.data.connection_type,
      type: response.data.type,
      continent_name: response.data.continent_name
    };

    return res.status(200).json({
      resStatus: true,
      resMessage: "Geo data obtained",
      resOkCode: 1,
      resData: geoData
    });
  } catch (error) {
    console.error("Error fetching geolocation data:", error.message);

    return res.status(500).json({
      resStatus: false,
      resMessage: "Failed to fetch geolocation data",
      resErrorCode: 3
    });
  }
});

//3 minutes
app.post("/api/save-visitor/letonya-oturum", checkLogCooldown(3 * 60 * 1000), async (req, res) => {
  let client;
  // silently skip if throttled
  if (!req.shouldLogVisit) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Cooldown triggered or logging skipped",
      resErrorCode: 1
    });
  }
  const userAgentString = req.get("User-Agent") || "";
  const agent = useragent.parse(userAgentString);
  try {
    //save visitor to database
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO visitors_letonya_oturum (ip, op, browser, date) 
      VALUES ($1, $2, $3, $4)`, 
      [
        req.clientIp,
        agent.os.toString(),
        agent.toAgent(),
        new Date().toLocaleDateString("en-GB")
      ]
    );
    return res.status(200).json({
      resStatus: true,
      resMessage: "Visitor logged.",
      resOkCode: 1
    });
  } catch (error) {
    console.error('Error logging visit:', error);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection error while logging visitor.",
      resErrorCode: 3
    });
  } finally {
    if(client) client.release();
  }
});
app.post("/api/save-visitor/letonya-oturum-english", checkLogCooldown(3 * 60 * 1000), async (req, res) => {
  let client;
  // silently skip if throttled
  if (!req.shouldLogVisit) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Cooldown triggered or logging skipped",
      resErrorCode: 1
    });
  }
  const userAgentString = req.get("User-Agent") || "";
  const agent = useragent.parse(userAgentString);
  try {
    //save visitor to database
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO visitors_letonya_oturum_english (ip, op, browser, date) 
      VALUES ($1, $2, $3, $4)`, 
      [
        req.clientIp,
        agent.os.toString(),
        agent.toAgent(),
        new Date().toLocaleDateString("en-GB")
      ]
    );
    return res.status(200).json({
      resStatus: true,
      resMessage: "Visitor logged.",
      resOkCode: 1
    });
  } catch (error) {
    console.error('Error logging visit:', error);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection error while logging visitor.",
      resErrorCode: 3
    });
  } finally {
    if(client) client.release();
  }
});
 

app.post("/api/post/message", blockMaliciousIPs, actionCooldown("postMessage", 3 * 60 * 1000), async (req, res) => {
  const ipVisitor = extractClientIP(req);
  let client;

  const { name, email, subject, message, source } = req.body || {};

  if (typeof name !== "string" || typeof email !== "string" || typeof subject !== "string" || typeof message !== "string" || typeof source !== "string") {
    return res.status(400).json({ resStatus: false, resErrorCode: 3 });
  }

  const cleanName = name.trim();
  const cleanEmail = email.trim();
  const cleanSubject = subject.trim();
  const cleanMessage = message.trim();
  const cleanSource = source.trim();

  if (!cleanName || !cleanEmail || !cleanSubject || !cleanMessage || !cleanSource) {
    return res.status(400).json({ resStatus: false, resErrorCode: 4 });
  }

  if (cleanName.length > 100) return res.status(400).json({ resStatus: false, resErrorCode: 5 });
  if (cleanEmail.length > 255) return res.status(400).json({ resStatus: false, resErrorCode: 6 });
  if (cleanSubject.length > 200) return res.status(400).json({ resStatus: false, resErrorCode: 7 });
  if (cleanMessage.length > 1000) return res.status(400).json({ resStatus: false, resErrorCode: 8 });
  if (cleanSource.length > 100) return res.status(400).json({ resStatus: false, resErrorCode: 9 });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return res.status(400).json({ resStatus: false, resErrorCode: 10 });
  }

  try {
    client = await pool.connect();
    await client.query(
      `INSERT INTO messages (name, email, subject, message, ip, webpage) VALUES ($1, $2, $3, $4, $5, $6)`,
      [cleanName, cleanEmail, cleanSubject, cleanMessage, ipVisitor, cleanSource]
    );

    return res.status(200).json({ resStatus: true, resOkCode: 1 });
  } catch (error) {
    console.error("Message save error:", error.message);
    return res.status(500).json({ resStatus: false, resErrorCode: 11 });
  } finally {
    if (client) client.release();
  }
});

/*kacmilyon.com data endpoints*/
app.get("/api/kac-milyon/get-provinces", async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT "provincename", "2007", "2011", "2015", "2023", "2024", "2025", "provinceid"
       FROM kacmilyon_provinces
       ORDER BY "2025" DESC`
    );
    const dbprovinces = result.rows;
    return res.status(200).json({
      resStatus: true,
      resMessage: "Homepage provinces table data fetched successfully",
      resData: dbprovinces,
      resOkCode: 1
    })
  } catch (error) {
    console.log(error.message);
    return res.status(403).json({
      resStatus: false,
      resMessage: "This IP is ignored from logging to Database",
      resErrorCode: 1
    });
  } finally {
    if(client) client.release();
  }
})
app.get("/api/kac-milyon/get-districts/:provinceId", async (req, res) => {
  let client;
  const { provinceId } = req.params;
  const provinceId2 = Number(provinceId);
  if(!provinceId2) {
    return res.status(404).json({
      resStatus: false,
      resMessage: "No province id",
      resErrorCode: 1
    });
  }
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT "provincename", "districtname", "id", "2007", "2011", "2015", "2023", "2024", "2025", "provinceid"
      FROM kacmilyon_districts
      WHERE provinceid = $1
      ORDER BY "2025" DESC`,
      [provinceId2]
    );
    const provinceDetails = result.rows;
    if(!provinceDetails || provinceDetails.length === 0) {
      return res.status(404).json({
        resStatus: false,
        resMessage: "Province id is correct but population data not found or broken",
        resErrorCode: 2
      });
    }
    return res.status(200).json({
      resStatus: true,
      resMessage: "Province population data fetched successfully",
      resData: provinceDetails,
      resOkCode: 1
    });
  } catch (error) {
    console.log(error.message);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection failed",
      resErrorCode: 3
    });
  } finally {
    if(client) client.release();
  }
});
app.get("/api/kac-milyon/get-province/:provinceId", async (req, res) => {
  const { provinceId } = req.params;
  const provinceId2 = Number(provinceId);
  let client;
  if(!provinceId2) {
    return res.status(404).json({
      resStatus: false,
      resMessage: "No city id",
      resErrorCode: 1
    });
  }
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT * FROM kacmilyon_provinces WHERE provinceid = $1`, [provinceId2]
    );
    const provinceDetails = await result.rows[0];
    if(!provinceDetails) {
      return res.status(404).json({
        resStatus: false,
        resMessage: "Province id is correct but population data not found or broken",
        resErrorCode: 2
      });
    }
    return res.status(200).json({
      resStatus: true,
      resMessage: "Province population data fetched successfully",
      resData: provinceDetails,
      resOkCode: 1
    });
  } catch (error) {
    console.log(error.message);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection failed",
      resErrorCode: 3
    });
  } finally {
    if(client) client.release();
  }
}); 
app.get("/api/kac-milyon/get-province-foreigners/:provinceId", async (req, res) => {
  let client;
  const { provinceId } = req.params;
  const provinceId2 = Number(provinceId);
  if(!provinceId2) {
    return res.status(404).json({
      resStatus: false,
      resMessage: "No province id",
      resErrorCode: 1
    });
  }
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT * FROM kacmilyon_foreigners WHERE provinceid = $1`, [provinceId2]
    );
    const provinceDetails = await result.rows[0];
    if(!provinceDetails || provinceDetails.length === 0) {
      return res.status(404).json({
        resStatus: false,
        resMessage: "Province id is correct but foreigners data not found or broken",
        resErrorCode: 2
      });
    }
    return res.status(200).json({
      resStatus: true,
      resMessage: "Province population data fetched successfully",
      resData: provinceDetails,
      resOkCode: 1
    });
  } catch (error) {
    console.log(error.message);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection failed",
      resErrorCode: 3
    });
  } finally {
    if(client) client.release();
  }
});
app.get("/api/kac-milyon/get-province-origins/:provinceId", async (req, res) => {
  let client;
  const { provinceId } = req.params;
  const provinceId2 = Number(provinceId);
  if(!provinceId2) {
    return res.status(404).json({
      resStatus: false,
      resMessage: "No province id",
      resErrorCode: 1
    });
  }
  try {
    client = await pool.connect();
    const result = await client.query(
      'SELECT * FROM kacmilyon_origins WHERE provinceid = $1', [provinceId2]
    );
    const provinceOrigins = result.rows;

    //People from a province list is unorganized. Here we are organizing it from big to small.
    //Separate keys that are containing population
    //Then sort the keys by their values from big to small.
    const provinceOrigins2 = result.rows[0];
    const { provinceid, provincename, ...rest } = provinceOrigins2;
    const basicInfo = { provinceid, provincename };
    const populationData = rest;

    // Convert object to an array of key-value pairs
    const dataArray = Object.entries(populationData);
    // Sort the array by numeric value in descending order
    dataArray.sort((a, b) => Number(b[1]) - Number(a[1]));
    // Convert back to an object
    const sortedList = Object.fromEntries(dataArray);
    //Also lets send total number of people from a region
    const totalPopulation = Object.values(sortedList).reduce((acc, value) => acc + Number(value), 0);
    //I am adding array brackets here because frontend needs it in an array
    const combinedData = [{ ...basicInfo, originPopulation: totalPopulation, ...sortedList }];

    if (!combinedData || combinedData.length === 0) {
      return res.status(404).json({
        resStatus: false,
        resMessage: "City details not found although city id is correct",
        resErrorCode: 2
      });
    }
    return res.status(200).json({
      resStatus: true,
      resMessage: "Origins population data fetched successfully",
      resData: combinedData,
      resOkCode: 1
    });
  } catch (error) {
    console.log(error.message);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection failed",
      resErrorCode: 3
    });
  } finally {
    if(client) client.release();
  }
}); 
app.get("/api/kac-milyon/get-district/:districtId", async (req, res) => {
  const { districtId } = req.params;
  let client;
  if(!districtId) {
    return res.status(404).json({
      resStatus: false,
      resMessage: "No district id",
      resErrorCode: 1
    });
  }
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT * FROM kacmilyon_districts WHERE id = $1`, [districtId]
    );
    const districtDetails = await result.rows[0];
    if(!districtDetails) {
      return res.status(404).json({
        resStatus: false,
        resMessage: "District id is correct but population data not found or broken",
        resErrorCode: 2
      });
    }
    return res.status(200).json({
      resStatus: true,
      resMessage: "District population data fetched successfully",
      resData: districtDetails,
      resOkCode: 1
    });
  } catch (error) {
    console.log(error.message);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection failed",
      resErrorCode: 3
    });
  } finally {
    if(client) client.release();
  }
});
app.get("/api/kac-milyon/get-country-population", async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT * FROM kacmilyon_country_population`
    );
    const countryDetails = await result.rows;
    if(!countryDetails || countryDetails.length === 0) {
      return res.status(404).json({
        resStatus: false,
        resMessage: "Endpoint works fine but country population data not found or broken",
        resErrorCode: 1
      });
    }
    return res.status(200).json({
      resStatus: true,
      resMessage: "Country population data fetched successfully",
      resData: countryDetails,
      resOkCode: 1
    });
  } catch (error) {
    console.log(error.message);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection failed",
      resErrorCode: 2
    });
  } finally {
    if(client) client.release();
  }
});
app.get("/api/kac-milyon/get-country-international", async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT * FROM kacmilyon_international`
    );
    const countryDetails = await result.rows;
    if(!countryDetails || countryDetails.length === 0) {
      return res.status(404).json({
        resStatus: false,
        resMessage: "Endpoint works fine but international immigration data not found or broken",
        resErrorCode: 1
      });
    }
    return res.status(200).json({
      resStatus: true,
      resMessage: "Country international immigration data fetched successfully",
      resData: countryDetails,
      resOkCode: 1
    });
  } catch (error) {
    console.log(error.message);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection failed",
      resErrorCode: 2
    });
  } finally {
    if(client) client.release();
  }
});
app.get("/api/kac-milyon/get-country-civil-status", async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT * FROM kacmilyon_medeni`
    );
    const countryDetails = await result.rows;
    if(!countryDetails || countryDetails.length === 0) {
      return res.status(404).json({
        resStatus: false,
        resMessage: "Endpoint works fine but civil status data not found or broken",
        resErrorCode: 1
      });
    }
    return res.status(200).json({
      resStatus: true,
      resMessage: "Country civil status data fetched successfully",
      resData: countryDetails,
      resOkCode: 1
    });
  } catch (error) {
    console.log(error.message);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection failed",
      resErrorCode: 2
    });
  } finally {
    if(client) client.release();
  }
});
/*kacmilyon.com comment, message, visitor log endpoints*/
app.post("/api/kac-milyon/save-comment", blockMaliciousIPs, actionCooldown("postMessage", 3 * 60 * 1000), async (req, res) => {
  let client;
  const messageObject = req.body;
  try {
    const msgLoad = {
      name1: messageObject.inputName.trim(),     // Ensure text values are trimmed
      message1: messageObject.inputMessage.trim(),     // Ensure date is trimmed (still stored as text in DB)
      pageId1: messageObject.pageId,
      visitDate1: new Date().toLocaleDateString('en-GB')
    };
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO kacmilyon_comments (name, comment, date, sectionid) 
      VALUES ($1, $2, $3, $4)`, 
      [msgLoad.name1, msgLoad.message1, msgLoad.visitDate1, Number(msgLoad.pageId1)]
    );
    return res.status(200).json({
      resStatus: true,
      resMessage: "Comment saved",
      resOkCode: 1
    });
  } catch (error) {
    console.log(error.message);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection error",
      resErrorCode: 3
    });
  }
});
app.get("/api/kac-milyon/get-comments/:pageId", async (req, res) => {
  let client;
  const { pageId } = req.params;
  if (pageId < 0 || pageId >10000) {
    return res.status(404).json({
      resStatus: false,
      resMessage: "Invalid page id",
      resErrorCode: 1
    });
  }
  try {
    client = await pool.connect(); 
    const result = await client.query(
      `SELECT * FROM kacmilyon_comments WHERE sectionid = $1`, [pageId]
    );
    const allComments = await result.rows;
    if(!allComments) {
      return res.status(404).json({
        resStatus: false,
        resMessage: "No comments yet",
        resErrorCode: 2
      });
    }
    return res.status(200).json({
      resStatus: true,
      resMessage: "Comment fetched",
      resData: allComments,
      resOkCode: 1
    });
  } catch (error) {
    console.log(error.message);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection error",
      resErrorCode: 3
    });
  } finally {
    if(client) client.release();
  }
});
app.post("/api/kac-milyon/save-reply", blockMaliciousIPs, actionCooldown("postMessage", 3 * 60 * 1000), async (req, res) => {

  let client;

  const messageObject = req.body;
  try {
    const msgLoad = {
      name1: messageObject.inputName.trim(),     // Ensure text values are trimmed
      message1: messageObject.inputMessage.trim(),     // Ensure date is trimmed (still stored as text in DB)
      pageId1: messageObject.pageId,
      commentId1: messageObject.commentId,
      visitDate1: new Date().toLocaleDateString('en-GB')
    };
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO kacmilyon_comments (name, comment, date, sectionid, parent_id) 
      VALUES ($1, $2, $3, $4, $5)`, 
      [msgLoad.name1, msgLoad.message1, msgLoad.visitDate1, Number(msgLoad.pageId1), Number(msgLoad.commentId1)]
    );
    return res.status(200).json({
      resStatus: true,
      resMessage: "Reply saved",
      resOkCode: 1
    });
  } catch (error) {
    console.log(error.message);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection error",
      resErrorCode: 3
    });
  }
});



//This piece of code must be under all routes. Otherwise you will have issues like not being able to 
//fetch comments etc. This code helps with managing routes that are not defined on react frontend.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.port || 5000;
app.listen(PORT, () => {
  console.log("Port is open on " + PORT);
});


//fix the rate limiter accross all endpoints. Make sure they are 10 minutes

//remove "build" from gitignore before production deployment
//create "build" folder-- npm run build in client folder
//You can remove cors before production
//Fix server api routes before production, remove "localhost" part
//add environment variables

