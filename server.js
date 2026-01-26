const express = require("express");
const app = express();
const path = require('path');

//crypto and cookieParser are for latvia masters google login endpoint
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
app.use(cookieParser());

const { pool, supabase, upload } = require("./db"); // Import configurations
const useragent = require("useragent");
// ADD THIS NEAR TOP
const axios = require('axios');

const cors = require("cors");
//app.use(cors()); 

const allowedOrigins = [
  'https://www.einsteincalculators.com',
  'https://einsteincalculators.com',
  'https://visacalculator.org',
  'https://www.visacalculator.org',
  'https://www.ipradar.org',
  'https://ipradar.org',
  'https://www.eumaps.org',
  'https://eumaps.org',
  'https://www.unitzap.space',
  'https://unitzap.space',
  'https://www.letonyaoturum.com',
  'https://letonyaoturum.com',
  'https://www.latviaresidency.org',
  'https://latviaresidency.org',
  'https://www.kacmilyon.com',
  'https://kacmilyon.com',
  'https://www.litvanyayatirim.com',
  'https://litvanyayatirim.com',
  "http://127.0.0.1:8080",
  "http://192.168.8.103:8080",
  "https://latvia-masters.netlify.app",
  "https://www.latvia-masters.netlify.app",
  "https://www.latvia-masters.netlify.app/register",
  "https://www.latvia-masters.netlify.app/register.html",
  "https://latvia-masters.netlify.app/register",
  "https://latvia-masters.netlify.app/register.html"
];
app.use(cors({
  origin: function (origin, callback) {
    const normalizedOrigin = origin?.replace(/\/$/, '');  // remove trailing slash if present

    if (!origin || allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

/*Google login for masters latvia*/
const { OAuth2Client } = require("google-auth-library");
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID); // FIXED

app.set('trust proxy', true);

//we need this as we use req.body to send data from frontend to backend
app.use(express.json());

//Then go to server.js file and make sure you serve static files from build directory:
app.use(express.static(path.join(__dirname, 'client/build')));
//For serving from build directory, you need to install path package and initiate it:

//This function for now will be used safely convert image file names to alphanumerical values
//currently used by latvia masters
//can be used by any endpoint in the future
// example value: 30/11/2025_111aaa.jpg
function makeSafeName() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const rand = Math.random().toString(36).substring(2, 8); // 6 chars
  return `${dd}${mm}${yyyy}_${rand}`;
}

//MIDDLEWARE TO BLOCK SPAM IP ADDRESSES
// List of IPs to ignore (server centers, ad bots, my ip etc)
//The list is updated to let web crawlers to pass and visit website
//block ip list currently has 2 decoy ip to prevent error on middleware code.
// List of blocked IPs
const ignoredIPs = [
  "66.249.1111168.5",
  "66.249.68.421323221"
];
function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  let ip = xf ? xf.split(",")[0].trim() : req.socket?.remoteAddress || req.ip;
  if (ip && ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }
  return ip;
}
function blockSpamIPs(req, res, next) {
  const ip = getClientIp(req);
  if (!ip) return next();
  if (ignoredIPs.includes(ip)) {
    return res.status(403).json({
      resStatus: false,
      resMessage: "Access denied",
      resErrorCode: 100
    });
  }
  next();
}

//MIDDLEAWARE RATE LIMITER
//Write: 20 requests per minute
//Read: 80 requests per minute
//Currently used only by Latvijas meistari
const rateStore = Object.create(null);
function rateLimitWrite(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const WINDOW = 60_000; // 1 min
  const LIMIT = 20;
  if (!rateStore[ip]) {
    rateStore[ip] = { w: { count: 1, start: now } };
    return next();
  }
  const w = rateStore[ip].w || { count: 0, start: now };
  if (now - w.start > WINDOW) {
    rateStore[ip].w = { count: 1, start: now };
    return next();
  }
  w.count++;
  rateStore[ip].w = w;
  if (w.count > LIMIT) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many write requests",
      resErrorCode: 110
    });
  }
  next();
}
function rateLimitRead(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const WINDOW = 60_000; // 1 min
  const LIMIT = 80;
  if (!rateStore[ip]) {
    rateStore[ip] = { r: { count: 1, start: now } };
    return next();
  }
  const r = rateStore[ip].r || { count: 0, start: now };
  if (now - r.start > WINDOW) {
    rateStore[ip].r = { count: 1, start: now };
    return next();
  }
  r.count++;
  rateStore[ip].r = r;
  if (r.count > LIMIT) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many requests",
      resErrorCode: 111
    });
  }
  next();
}
//This middleware is specifically for upload and update endpoints of LM.
//To prevent reentrancy spamming (race condition), we limit each ip to 1 request per 5 seconds for these endpoints.
const adCooldownStore = new Map();
function postAdCooldown(req, res, next) {
  const ip = req.headers["x-forwarded-for"]
    ? req.headers["x-forwarded-for"].split(",")[0].trim()
    : req.socket.remoteAddress || req.ip;
  const now = Date.now();
  const COOLDOWN_MS = 5000;
  const lastUsage = adCooldownStore.get(ip);
  // Check BEFORE setting to avoid unnecessary updates on blocked requests
  if (lastUsage && now - lastUsage < COOLDOWN_MS) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Lūdzu, uzgaidiet 5 sekundes.",
      resErrorCode: 112
    });
  }
  // Set timestamp only for requests that pass
  adCooldownStore.set(ip, now);
  // Improved cleanup: always delete after cooldown period
  setTimeout(() => {
    const current = adCooldownStore.get(ip);
    // Only delete if no newer request has updated it
    if (current && current <= now) {
      adCooldownStore.delete(ip);
    }
  }, COOLDOWN_MS);
  next();
}
//MIDDLEWARE REQ.BODY AND REQ.QUERY SANITIZER
//Currently used only by Latvijas meistari
function sanitizeInputs(req, res, next) {
  function sanitize(value) {
    if (typeof value !== "string") return value;
    return value
      .trim()
      .replace(/[\u0000-\u001F\u007F]/g, "") // control chars
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function walk(obj) {
    if (!obj || typeof obj !== "object") return;
    for (const key in obj) {
      if (typeof obj[key] === "string") {
        obj[key] = sanitize(obj[key]);
      } else if (typeof obj[key] === "object") {
        walk(obj[key]);
      }
    }
  }
  walk(req.body);
  walk(req.query);
  next();
}

//MIDDLEWARE - VISITOR LOGGING
const visitorCache = {}; //This object array is for cooldown
//This array is for ip addresses that we dont want to save in visitors table at all.
//It is for bot ip addresses. They can visit the website but we will not save them.
const ignoredLoggingIps = new Set([ 
  "127.0.0.1xxxx",
  "::1xxxx"
]);
function visitLoggingMiddleware(waitingTime) {
  return (req, res, next) => {
    const ip =
      req.headers["x-forwarded-for"]
        ? req.headers["x-forwarded-for"].split(",")[0].trim()
        : req.socket.remoteAddress || req.ip;
    req.clientIp = ip;
    //Some ip addresses, we can ignore them at all. No need to check cooldowns
    if (ignoredLoggingIps.has(ip)) {
      req.shouldLogVisit = false;
      return next();
    }
    const lastVisit = visitorCache[ip];
    if (lastVisit && Date.now() - lastVisit < waitingTime) {
      req.shouldLogVisit = false; // silently skip
    } else {
      visitorCache[ip] = Date.now();
      req.shouldLogVisit = true;
    }
    next();
  };
}


//A temporary cache to save ip addresses and it will prevent spam comments and replies for 1 minute.
//I can do that by checking each ip with database ip addresses but then it will be too many requests to db
const ipCache2 = {}
app.post("/serversavecomment", async (req, res) => {
  //preventing spam comments
  const ipVisitor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress || req.ip;
  // Check if IP exists in cache and if last comment was less than 1 minute ago
  
  if (ipCache2[ipVisitor] && Date.now() - ipCache2[ipVisitor] < 60000) {
    return res.status(429).json({message: 'Too many comments'});
  }
 
  ipCache2[ipVisitor] = Date.now();//save visitor ip to ipCache2

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
app.post("/serversavecommentreply", async (req, res) => {
  
  //preventing spam replies
  const ipVisitor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress || req.ip;
  // Check if IP exists in cache and if last reply was less than 1 minute ago
  if (ipCache2[ipVisitor] && Date.now() - ipCache2[ipVisitor] < 60000) {
    return res.status(429).json({message: 'Too many comments'});
  }
  ipCache2[ipVisitor] = Date.now();//save visitor ip to ipCache2


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
      `SELECT * FROM eumaps_comments WHERE sectionid = $1`, [pageId]
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

//A temporary cache to save ip addresses and it will prevent saving same ip addresses for 1 hour.
//I can do that by checking each ip with database ip addresses but then it will be too many requests to db
//We will save each visitor data to database. 
const ipCache = {}

app.post("/serversavevisitor/:pageIdVisitorPage", async (req, res) => {
  //Here we could basically say "const ipVisitor = req.ip" but my app is running on Render platform
  //and Render is using proxies or load balancers. Because of that I will see "::1" as ip data if I not use
  //this line below
  const ipVisitor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress || req.ip;
  let client;
  const { pageIdVisitorPage } = req.params;
  // Check if the IP is in the ignored list
  if (ignoredIPs.includes(ipVisitor)) {
    return; // Simply exit the function, doing nothing for this IP
  }
  // Check if IP exists in cache and if last visit was less than 1 minute ago
  if (ipCache[ipVisitor] && Date.now() - ipCache[ipVisitor] < 60000) {
    return res.status(429).json({ message: 'Too many requests from this IP.' });
  } 
    
  ipCache[ipVisitor] = Date.now();//save visitor ip to ipCache
  const userAgentString = req.get('User-Agent');
  const agent = useragent.parse(userAgentString);
  
  try {
    const visitorData = {
      ip: ipVisitor,
      os: agent.os.toString(), // operating system
      browser: agent.toAgent(), // browser
      visitDate: new Date().toLocaleDateString('en-GB'),
      sectionName: pageIdVisitorPage,
    };
    //save visitor to database
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO eumaps_visitors (ip, op, browser, date, sectionid) 
      VALUES ($1, $2, $3, $4, $5)`, 
      [visitorData.ip, visitorData.os, visitorData.browser, visitorData.visitDate, visitorData.sectionName]
    );
    res.status(200).json({message: "Visitor IP successfully logged"});
  } catch (error) {
    console.error('Error logging visit:', error);
    res.status(500).json({message: 'Error logging visit'});
  } finally {
    if(client) client.release();
  }
})

const ipCache5 = {}
// LOG VISITORS
app.post("/api/get-coordinates-and-log-visitor", async (req, res) => {
    //Here we could basically say "const ipVisitor = req.ip" but my app is running on Render platform
  //and Render is using proxies or load balancers. Because of that I will see "::1" as ip data if I not use
  //this line below
  const ipVisitor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress || req.ip;
  let client;
  // Check if the IP is in the ignored list
  if (ignoredIPs.includes(ipVisitor)) {
    return res.status(403).json({
      resStatus: false,
      resMessage: "This IP is ignored from logging to Database",
      resErrorCode: 1
    });
  }
  // Check if IP exists in cache and if last visit was less than 9 seconds ago (90000 ms)
  if (ipCache5[ipVisitor] && Date.now() - ipCache5[ipVisitor] < 9000) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many requests from this IP.",
      resErrorCode: 2
    });
  }

  const { ipInput } = req.body; // Get IP address from the request body
  ipCache5[ipVisitor] = Date.now();//save visitor ip to ipCache5
  const userAgentString = req.get('User-Agent') || '';
  const agent = useragent.parse(userAgentString);

  try {
    const visitorData = {
      ip: ipVisitor,
      os: agent.os.toString(), // operating system
      browser: agent.toAgent(), // browser
      visitDate: new Date().toLocaleDateString('en-GB')
    };
    // OPERATION 1: save visitor to database
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO visitors_ipradar (ip, op, browser, date) 
      VALUES ($1, $2, $3, $4)`, [visitorData.ip, visitorData.os, visitorData.browser, visitorData.visitDate]
    );

    const apiKey = process.env.IPAPI_KEY; // Load API key from .env file
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
  } finally {
    if(client) client.release();
  }
});
const ipCache3 = {}
app.post("/api/save-visitor/schengen", async (req, res) => {
  //Here we could basically say "const ipVisitor = req.ip" but my app is running on Render platform
  //and Render is using proxies or load balancers. Because of that I will see "::1" as ip data if I not use
  //this line below
  const ipVisitor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress || req.ip;
  let client;
  // Check if the IP is in the ignored list
  if (ignoredIPs.includes(ipVisitor)) {
    return res.status(403).json({
      resStatus: false,
      resMessage: "This IP is ignored from logging to Database",
      resErrorCode: 1
    });
  }
  // Check if IP exists in cache and if last visit was less than 16.67 minutes ago
  if (ipCache3[ipVisitor] && Date.now() - ipCache3[ipVisitor] < 1000000) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many requests from this IP.",
      resErrorCode: 2
    });
  }

  ipCache3[ipVisitor] = Date.now();//save visitor ip to ipCache3
  const userAgentString = req.get('User-Agent') || '';
  const agent = useragent.parse(userAgentString);

  try {
    const visitorData = {
      ip: ipVisitor,
      os: agent.os.toString(), // operating system
      browser: agent.toAgent(), // browser
      visitDate: new Date().toLocaleDateString('en-GB')
    };
    //save visitor to database
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO visitors_schengen (ip, op, browser, date) 
      VALUES ($1, $2, $3, $4)`, [visitorData.ip, visitorData.os, visitorData.browser, visitorData.visitDate]
    );
    return res.status(200).json({
      resStatus: true,
      resMessage: "Visitor successfully logged.",
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
const ipCache4 = {}
app.post("/api/save-visitor/einstein", async (req, res) => {
  //Here we could basically say "const ipVisitor = req.ip" but my app is running on Render platform
  //and Render is using proxies or load balancers. Because of that I will see "::1" as ip data if I not use
  //this line below
  const ipVisitor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress || req.ip;
  let client;
  const { sectionName } = req.query;
  
  // Check if the IP is in the ignored list
  if (ignoredIPs.includes(ipVisitor)) {
    return res.status(403).json({
      resStatus: false,
      resMessage: "This IP is ignored from logging to Database",
      resErrorCode: 1
    });
  }
  // Check if IP exists in cache and if last visit was less than 16.67 minutes ago
  if (ipCache4[ipVisitor] && Date.now() - ipCache4[ipVisitor] < 1000000) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many requests from this IP.",
      resErrorCode: 2
    });
  }

  ipCache4[ipVisitor] = Date.now();//save visitor ip to ipCache4
  const userAgentString = req.get('User-Agent') || '';
  const agent = useragent.parse(userAgentString);

  try {
    const visitorData = {
      ip: ipVisitor,
      os: agent.os.toString(), // operating system
      browser: agent.toAgent(), // browser
      visitDate: new Date().toLocaleDateString('en-GB')
    };
    //save visitor to database
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO visitors_einstein (ip, op, browser, date, section) 
      VALUES ($1, $2, $3, $4, $5)`, 
      [visitorData.ip, visitorData.os, visitorData.browser, visitorData.visitDate, sectionName]
    );
    return res.status(200).json({
      resStatus: true,
      resMessage: "Visitor successfully logged.",
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
const ipCache6 = {}
app.post("/api/save-visitor/units", async (req, res) => {
  //Here we could basically say "const ipVisitor = req.ip" but my app is running on Render platform
  //and Render is using proxies or load balancers. Because of that I will see "::1" as ip data if I not use
  //this line below
  const ipVisitor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress || req.ip;
  let client;
  const { sectionName } = req.query;
  
  // Check if the IP is in the ignored list
  if (ignoredIPs.includes(ipVisitor)) {
    return res.status(403).json({
      resStatus: false,
      resMessage: "This IP is ignored from logging to Database",
      resErrorCode: 1
    });
  }
  // Check if IP exists in cache and if last visit was less than approximately 16.67 minutes ago
  if (ipCache6[ipVisitor] && Date.now() - ipCache6[ipVisitor] < 1000000) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many requests from this IP.",
      resErrorCode: 2
    });
  }

  ipCache6[ipVisitor] = Date.now();//save visitor ip to ipCache6
  const userAgentString = req.get('User-Agent') || '';
  const agent = useragent.parse(userAgentString);

  try {
    const visitorData = {
      ip: ipVisitor,
      os: agent.os.toString(), // operating system
      browser: agent.toAgent(), // browser
      visitDate: new Date().toLocaleDateString('en-GB')
    };
    //save visitor to database
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO visitors_units (ip, op, browser, date, section) 
      VALUES ($1, $2, $3, $4, $5)`, 
      [visitorData.ip, visitorData.os, visitorData.browser, visitorData.visitDate, sectionName]
    );
    return res.status(200).json({
      resStatus: true,
      resMessage: "Visitor successfully logged.",
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
//3 minutes
app.post("/api/save-visitor/letonya-oturum", visitLoggingMiddleware(3 * 60 * 1000), async (req, res) => {
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
app.post("/api/save-visitor/letonya-oturum-english", visitLoggingMiddleware(3 * 60 * 1000), async (req, res) => {
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
app.post("/api/kac-milyon/save-visitor", visitLoggingMiddleware(3 * 60 * 1000), async (req, res) => {
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
      `INSERT INTO visitors_kac_milyon (ip, op, browser, date) 
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
app.post("/api/litvanya-yatirim/save-visitor", visitLoggingMiddleware(3 * 60 * 1000), async (req, res) => {
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
      `INSERT INTO visitors_litvanyayatirim (ip, op, browser, date) 
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
app.post("/api/post/master-latvia/save-visitor",  visitLoggingMiddleware(3 * 60 * 1000), async (req, res) => {
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
    let client;
    try {
      client = await pool.connect();
      await client.query(
        `
        INSERT INTO visitors_masters_latvia (
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
        resMessage: "Visitor logging succeeded",
        resOkCode: 1
      });
    } catch (err) {
      console.error("Visitor log error (Masters Latvia):", err);
      return res.status(200).json({
        resStatus: false,
        resMessage: "Visitor logging failed - internal error",
        resErrorCode: 2
      });
    } finally {
      if (client) client.release();
    }
  }
);


/* SAVE MESSAGE FORMS */
const ipCache10 = {}
app.post("/api/save-message/letonya-oturum-english", async (req, res) => {
  //Here we could basically say "const ipVisitor = req.ip" but my app is running on Render platform
  //and Render is using proxies or load balancers. Because of that I will see "::1" as ip data if I not use
  //this line below
  const ipVisitor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress || req.ip;
  let client;
  
  // Check if the IP is in the ignored list
  if (ignoredIPs.includes(ipVisitor)) {
    return res.status(403).json({
      resStatus: false,
      resMessage: "This IP is ignored from logging to Database",
      resErrorCode: 1
    });
  }
  // Check if IP exists in cache and if last visit was less than approximately 16.67 minutes ago
  if (ipCache10[ipVisitor] && Date.now() - ipCache10[ipVisitor] < 1000000) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many requests from this IP.",
      resErrorCode: 2
    });
  }
  ipCache10[ipVisitor] = Date.now();//save visitor ip to ipCache10

  const messageObject = req.body;
  try {
    const msgLoad = {
      name1: messageObject.inputName.trim(),
      email1: messageObject.inputMail.trim(),     // Ensure text values are trimmed
      message1: messageObject.inputMessage.trim(),     // Ensure date is trimmed (still stored as text in DB)
      visitDate1: new Date().toLocaleDateString('en-GB')
    };
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO messages_letonyaoturum_english (name, email, message, visitdate) 
      VALUES ($1, $2, $3, $4)`, 
      [msgLoad.name1, msgLoad.email1, msgLoad.message1, msgLoad.visitDate1]
    );
    return res.status(200).json({
      resStatus: true,
      resMessage: "Message sent",
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
const ipCache8 = {}
app.post("/api/save-message/letonya-oturum", async (req, res) => {
  //Here we could basically say "const ipVisitor = req.ip" but my app is running on Render platform
  //and Render is using proxies or load balancers. Because of that I will see "::1" as ip data if I not use
  //this line below
  const ipVisitor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress || req.ip;
  let client;
  
  // Check if the IP is in the ignored list
  if (ignoredIPs.includes(ipVisitor)) {
    return res.status(403).json({
      resStatus: false,
      resMessage: "This IP is ignored from logging to Database",
      resErrorCode: 1
    });
  }
  // Check if IP exists in cache and if last visit was less than approximately 16.67 minutes ago
  if (ipCache8[ipVisitor] && Date.now() - ipCache8[ipVisitor] < 1000000) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many requests from this IP.",
      resErrorCode: 2
    });
  }
  ipCache8[ipVisitor] = Date.now();//save visitor ip to ipCache8

  const messageObject = req.body;
  try {
    const msgLoad = {
      name1: messageObject.inputName.trim(),
      email1: messageObject.inputMail.trim(),     // Ensure text values are trimmed
      message1: messageObject.inputMessage.trim(),     // Ensure date is trimmed (still stored as text in DB)
      visitDate1: new Date().toLocaleDateString('en-GB')
    };
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO messages_letonyaoturum (name, email, message, visitdate) 
      VALUES ($1, $2, $3, $4)`, 
      [msgLoad.name1, msgLoad.email1, msgLoad.message1, msgLoad.visitDate1]
    );
    return res.status(200).json({
      resStatus: true,
      resMessage: "Mesaj gönderildi",
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
const ipCache13 = {}
app.post("/api/save-message/litvanya-yatirim", async (req, res) => {
  //Here we could basically say "const ipVisitor = req.ip" but my app is running on Render platform
  //and Render is using proxies or load balancers. Because of that I will see "::1" as ip data if I not use
  //this line below
  const ipVisitor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress || req.ip;
  let client;
  
  // Check if the IP is in the ignored list
  if (ignoredIPs.includes(ipVisitor)) {
    return res.status(403).json({
      resStatus: false,
      resMessage: "This IP is ignored from logging to Database",
      resErrorCode: 1
    });
  }
  // Check if IP exists in cache and if last visit was less than approximately 16.67 minutes ago
  if (ipCache13[ipVisitor] && Date.now() - ipCache13[ipVisitor] < 1000000) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many requests from this IP.",
      resErrorCode: 2
    });
  }
  ipCache13[ipVisitor] = Date.now();//save visitor ip to ipCache13

  const messageObject = req.body;
  try {
    const msgLoad = {
      name1: messageObject.inputName.trim(),
      email1: messageObject.inputMail.trim(),     // Ensure text values are trimmed
      message1: messageObject.inputMessage.trim(),     // Ensure date is trimmed (still stored as text in DB)
      visitDate1: new Date().toLocaleDateString('en-GB')
    };
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO messages_litvanyayatirim (name, email, message, visitdate) 
      VALUES ($1, $2, $3, $4)`, 
      [msgLoad.name1, msgLoad.email1, msgLoad.message1, msgLoad.visitDate1]
    );
    return res.status(200).json({
      resStatus: true,
      resMessage: "Mesaj gönderildi",
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

/*kacmilyon.com data endpoints*/
app.get("/api/kac-milyon/get-provinces", async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT "provincename", "2007", "2011", "2015", "2022", "2023", "2024", "provinceid"
       FROM kacmilyon_provinces
       ORDER BY "2024" DESC`
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
      `SELECT "provincename", "districtname", "id", "2007", "2011", "2015", "2022", "2023", "2024", "provinceid"
      FROM kacmilyon_districts
      WHERE provinceid = $1
      ORDER BY "2024" DESC`,
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
app.post("/api/kac-milyon/save-comment", async (req, res) => {
  //Here we could basically say "const ipVisitor = req.ip" but my app is running on Render platform
  //and Render is using proxies or load balancers. Because of that I will see "::1" as ip data if I not use
  //this line below
  const ipVisitor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress || req.ip;
  let client;
  
  // Check if the IP is in the ignored list
  if (ignoredIPs.includes(ipVisitor)) {
    return res.status(403).json({
      resStatus: false,
      resMessage: "This IP is ignored from logging to Database",
      resErrorCode: 1
    });
  }
  // Check if IP exists in cache and if last visit was less than approximately 16.67 minutes ago
  if (ipCache11[ipVisitor] && Date.now() - ipCache11[ipVisitor] < 1000) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many requests from this IP.",
      resErrorCode: 2
    });
  }
  ipCache11[ipVisitor] = Date.now();//save visitor ip to ipCache11

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
app.post("/api/kac-milyon/save-reply", async (req, res) => {
  //Here we could basically say "const ipVisitor = req.ip" but my app is running on Render platform
  //and Render is using proxies or load balancers. Because of that I will see "::1" as ip data if I not use
  //this line below
  const ipVisitor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress || req.ip;
  let client;
  
  // Check if the IP is in the ignored list
  if (ignoredIPs.includes(ipVisitor)) {
    return res.status(403).json({
      resStatus: false,
      resMessage: "This IP is ignored from logging to Database",
      resErrorCode: 1
    });
  }
  // Check if IP exists in cache and if last visit was less than approximately 16.67 minutes ago
  if (ipCache11[ipVisitor] && Date.now() - ipCache11[ipVisitor] < 1000) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many requests from this IP.",
      resErrorCode: 2
    });
  }
  ipCache11[ipVisitor] = Date.now();//save visitor ip to ipCache11

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

/*MASTERS-LATVIA ENDPOINTS */
app.post("/api/post/master-latvia/ads", blockSpamIPs, postAdCooldown, rateLimitWrite, 
  sanitizeInputs, upload.array("images", 5), async (req, res) => {
  const MIN_IMAGE_SIZE = 2 * 1024;           // 2 KB
  const MAX_IMAGE_SIZE = 1.9 * 1024 * 1024;  // 1.8 MB. Normally I should say 1.8 but just give some
  //error room to the frontend here I am saying 1.9
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
  /* -------------------------------------------
     PARSE JSON FORM DATA
  ------------------------------------------- */
  try {
    formData = JSON.parse(req.body.formData);
  } catch (err) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nederīgi veidlapas dati",
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
  if (!inputService || !inputName || !inputPrice || !inputDescription || !phoneNumber) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nav aizpildīti obligātie lauki",
      resErrorCode: 2
    });
  }
  const mainVal = Number(main_group);
  if (isNaN(mainVal) || mainVal < 1 || mainVal > 10) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Galvenā kategorija ir ārpus atļautā diapazona.",
      resErrorCode: 3
    });
  }
  const subVal = Number(sub_group);
  if (isNaN(subVal) || subVal < 1 || subVal > 10) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Apakškategorija ir ārpus atļautā diapazona.",
      resErrorCode: 4
    });
  }
  if (!/^\p{L}+(\s\p{L}+)+$/u.test(inputName)) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nepareizs vārda formāts",
      resErrorCode: 5
    });
  }
  if (/<[^>]+>/.test(inputPrice) || /[\p{Cc}]/u.test(inputPrice)) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nepareiza cenas vērtība",
      resErrorCode: 6
    });
  }
  if (/<[^>]+>/.test(inputDescription) || /[\p{Cc}]/u.test(inputDescription)) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nepareizs apraksts",
      resErrorCode: 7
    });
  }
  if (phoneNumber.trim().length < 7 || phoneNumber.trim().length > 12) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nepareizs tālruņa numura garums",
      resErrorCode: 8
    });
  }
  if (!Array.isArray(inputRegions) || inputRegions.length === 0) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nav atlasītu reģionu",
      resErrorCode: 9
    });
  }
  if (inputName.length < 5 || inputName.length > 19) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Vārds ir par garu vai par īsu",
      resErrorCode: 10
    });
  }
  if (inputPrice.length < 1 || inputPrice.length > 15) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Cena ir par garu vai par īsu",
      resErrorCode: 11
    });
  }
  if (inputDescription.length < 50 || inputDescription.length > 1000) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Apraksts ir par garu vai par īsu",
      resErrorCode: 12
    });
  }
  /* -------------------------------------------
     SESSION VALIDATION
  ------------------------------------------- */
  const sessionId = req.cookies?.session_id;
  if (!sessionId) {
    return res.status(401).json({
      resStatus: false,
      resMessage: "Pierakstieties, lai turpinātu",
      resErrorCode: 13
    });
  }
  const userRes = await pool.query(
    `SELECT google_id FROM masters_latvia_sessions WHERE session_id = $1 LIMIT 1`,
    [sessionId]
  );
  if (!userRes.rowCount) {
    return res.status(401).json({
      resStatus: false,
      resMessage: "Nederīga sesija",
      resErrorCode: 14
    });
  }

  const googleId = userRes.rows[0].google_id;

/* -------------------------------------------
    1 ad per subsection
    5 ads total 
  ------------------------------------------- */

  try {
    client = await pool.connect();
    // 1. Check total ad limit
    const userAdNumberCheck = await client.query(
      "SELECT number_ads FROM masters_latvia_users WHERE google_id = $1",
      [googleId]
    );
    if (userAdNumberCheck.rows[0]?.number_ads >= 5) {
      return res.status(403).json({
        resStatus: false,
        resMessage: "Sludinājumu skaits ir sasniegts (maksimums 5).",
        resErrorCode: 15
      });
    }
    // 2. NEW: Check if ad already exists in this specific subsection
    const existingAdCheck = await client.query(
      `SELECT id FROM masters_latvia_ads 
      WHERE google_id = $1 AND main_group = $2 AND sub_group = $3 
      LIMIT 1`,
      [googleId, mainVal, subVal]
    );
    if (existingAdCheck.rowCount > 0) {
      return res.status(403).json({
        resStatus: false,
        resMessage: "Šajā apakškategorijā Jums jau ir aktīvs sludinājums.",
        resErrorCode: 16 // New error code for sub-section limit
      });
    }
  } catch (err) {
      console.error(err);
      return res.status(500).json({ 
        resStatus: false, 
        resMessage: "Sistēmas kļūda. Lūdzu, mēģiniet vēlreiz vēlāk.",
        resErrorCode: 23 // New error code for sub-section limit
      })
  } finally {
    if (client) client.release();
  }




  /* -------------------------------------------
     IMAGE VALIDATION
  ------------------------------------------- */
  const files = req.files;

  if (!files || files.length < 1 || files.length > 5) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nepieciešami 1–5 attēli",
      resErrorCode: 17
    });
  }
  // Upload images
  let uploadedImages = [];
  for (const f of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(f.mimetype)) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Nederīgs faila formāts",
        resErrorCode: 18
      });
    }
    if (f.size < MIN_IMAGE_SIZE) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Attēla fails ir bojāts vai tukšs",
        resErrorCode: 19
      });
    }
    if (f.size > MAX_IMAGE_SIZE) {
      return res.status(400).json({
        resStatus: false,
        resMessage: "Attēls ir pārāk liels (maks. 1,8 MB)",
        resErrorCode: 20
      });
    }
    const fileName = makeSafeName();
    const { error } = await supabase.storage
      .from("masters_latvia_storage")
      .upload(fileName, f.buffer, { contentType: f.mimetype });

    if (error) {
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

  /* -------------------------------------------
     DATABASE INSERT
  ------------------------------------------- */
  try {
    client = await pool.connect();
    const insertQuery = `
      INSERT INTO masters_latvia_ads 
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
      inputName,
      inputService,
      inputDescription,
      inputPrice,
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

    const result = await client.query(insertQuery, values);
    if (!result.rowCount) {
      return res.status(503).json({
        resStatus: false,
        resMessage: "Datu saglabāšana neizdevās",
        resErrorCode: 22
      });
    }

    await client.query(
      "UPDATE masters_latvia_users SET number_ads = number_ads + 1 WHERE google_id = $1",
      [googleId]
    );

    return res.status(201).json({
      resStatus: true,
      resMessage: "Sludinājums saglabāts",
      resOkCode: 1
    });

  } catch (err) {
    return res.status(503).json({
      resStatus: false,
      resMessage: "Servera kļūda",
      resErrorCode: 23
    });

  } finally {
    if (client) client.release();
  }
});
app.put("/api/put/master-latvia/update-ad/:id", blockSpamIPs, postAdCooldown, rateLimitWrite, 
  sanitizeInputs,  upload.array("images", 5), async (req, res) => {
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
  const sessionId = req.cookies?.session_id;
  if (!sessionId) {
    return res.status(401).json({
      resStatus: false,
      resMessage: "Lūdzu, pieslēdzieties",
      resErrorCode: 1
    });
  }
  try {
    const userQ = await pool.query(
      `SELECT google_id 
       FROM masters_latvia_sessions 
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
       FROM masters_latvia_ads 
       WHERE id = $1 
       LIMIT 1`,
      [adId]
    );
    if (!adQ.rowCount) {
      return res.json({
        resStatus: false,
        resMessage: "Sludinājums neeksistē",
        resErrorCode: 3
      });
    }

    if (adQ.rows[0].google_id !== googleId) {
      return res.status(403).json({
        resStatus: false,
        resMessage: "Nepieciešama pieslēgšanās",
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
     if (!inputService || !inputName || !inputPrice || !inputDescription || !phoneNumber) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Aizpildiet obligātos laukus",
      resErrorCode: 6
    });
  }
  if (!/^\p{L}+(\s\p{L}+)+$/u.test(inputName)) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nederīgs vārds",
      resErrorCode: 7
    });
  }
  if (/<[^>]+>/.test(inputPrice) || /[\p{Cc}]/u.test(inputPrice)) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nederīga cenas vērtība",
      resErrorCode: 8
    });
  }
  if (/<[^>]+>/.test(inputDescription) || /[\p{Cc}]/u.test(inputDescription)) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Nederīgs apraksts",
      resErrorCode: 9
    });
  }
  if (phoneNumber.trim().length < 7 || phoneNumber.trim().length > 12) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Tālruņa numurs ir pārāk garš vai pārāk īss",
      resErrorCode: 10
    });
  }
  if (!Array.isArray(inputRegions) || inputRegions.length === 0) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Reģioni nav izvēlēti",
      resErrorCode: 11
    });
  }
  if (inputName.length < 5 || inputName.length > 19) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Vārds ir pārāk garš vai pārāk īss",
      resErrorCode: 12
    });
  }
  const mainVal = Number(main_group);
  if (isNaN(mainVal) || mainVal < 1 || mainVal > 10) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Galvenā kategorija ir ārpus atļautā diapazona.",
      resErrorCode: 13
    });
  }
  const subVal = Number(sub_group);
  if (isNaN(subVal) || subVal < 1 || subVal > 10) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Apakškategorija ir ārpus atļautā diapazona.",
      resErrorCode: 14
    });
  }
  if (inputPrice.length < 1 || inputPrice.length > 15) {
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
      CHECK SUBSECTION LIMIT (1 AD PER SUB)
  --------------------------------*/
  try {
    // We look for any OTHER ad (id != adId) in this same category
    const existingAdCheck = await pool.query(
      `SELECT id FROM masters_latvia_ads 
        WHERE google_id = $1 AND main_group = $2 AND sub_group = $3 AND id != $4
        LIMIT 1`,
      [googleId, mainVal, subVal, adId]
    );

    if (existingAdCheck.rowCount > 0) {
      return res.status(403).json({
        resStatus: false,
        resMessage: "Šajā apakškategorijā Jums jau ir aktīvs sludinājums.",
        resErrorCode: 17
      });
    }
  } catch (dbErr) {
    console.error("SUBSECTION CHECK ERROR:", dbErr);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Sistēmas kļūda, pārbaudot kategoriju ierobežojumus.",
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
            resMessage: "Pārāk liels attēls (maks. 1,8 MB)",
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
      UPDATE masters_latvia_ads 
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
      inputName,
      inputService,
      inputDescription,
      inputPrice,
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
    console.error("UPDATE ERROR:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Servera kļūda",
      resErrorCode: 24
    });
  }
});
//this function below is for google auth login of latvia masters
async function createSessionForUser(dbGoogleId) {
  const sessionId = crypto.randomUUID(); // generate inline
  await pool.query(
    `INSERT INTO masters_latvia_sessions (session_id, google_id) VALUES ($1, $2)`,
    [sessionId, dbGoogleId]
  );
  return sessionId;
}
app.post("/api/post/master-latvia/auth/google", blockSpamIPs, rateLimitWrite, async (req, res) => {
  const ipVisitor = req.headers["x-forwarded-for"] ? req.headers["x-forwarded-for"].split(",")[0]
    : req.socket.remoteAddress || req.ip;
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "Missing Google token",
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
      INSERT INTO masters_latvia_users (google_id, email, name, date, ip)
      VALUES ($1, $2, $3, $4, $5, $6)
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
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 1000 * 60 * 60 * 24 * 7
    });
    return res.status(200).json({
      resStatus: true,
      resMessage: "User authenticated",
      resOkCode: 1,
      user: { google_id: dbGoogleId, email, name, session_id: sessionId }
    });

  } catch (error) {
    console.error("Google Auth Error Backend:", error);
    if (error.message?.includes("Invalid") || error.message?.includes("JWT")) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Invalid Google token",
        resErrorCode: 2
      });
    }
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection error",
      resErrorCode: 3
    });
  } finally {
    if (client) client.release();
  }
});
app.post("/api/post/master-latvia/logout", blockSpamIPs, rateLimitWrite, async (req, res) => {
  const sessionId = req.cookies.session_id;
  await pool.query(`DELETE FROM masters_latvia_sessions WHERE session_id=$1`, [sessionId]);

  res.clearCookie("session_id", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "none"
  });

  return res.status(200).json({
    resStatus: true,
    resMessage: "Logged out",
    resOkCode: 1
  });
});
app.post("/api/post/master-latvia/toggle-activation/:id", blockSpamIPs, rateLimitWrite, async (req, res) => {
  const adId = req.params.id;
  try {
    // Check if ad exists
    const check = await pool.query(
      "SELECT is_active FROM masters_latvia_ads WHERE id = $1 LIMIT 1;",
      [adId]
    );
    if (!check.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Ad not found",
        resErrorCode: 1
      });
    }
    const current = check.rows[0].is_active;
    const newState = !current; // toggle true → false, false → true
    // Update activation state
    const update = await pool.query(
      "UPDATE masters_latvia_ads SET is_active = $1, created_at = NOW() WHERE id = $2 RETURNING id;",
      [newState, adId]
    );
    if (!update.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Failed to update ad activation state",
        resErrorCode: 2
      });
    }
    return res.status(200).json({
      resStatus: true,
      resMessage: newState ? "Ad activated" : "Ad deactivated",
      resOkCode: 1,
      is_active: newState
    });
  } catch (err) {
    console.error("Toggle error:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 3
    });
  }
});
app.post("/api/post/master-latvia/delete-ad/:id", blockSpamIPs, rateLimitWrite, async (req, res) => {
  const adId = req.params.id;
  const sessionId = req.cookies?.session_id;
  if (!sessionId) {
    return res.status(401).json({
      resStatus: false,
      resMessage: "No active session",
      resErrorCode: 1
    });
  }
  try {
    /* ---------- SESSION VALIDATION ---------- */
    const sessionRes = await pool.query(
      `
      SELECT google_id
      FROM masters_latvia_sessions
      WHERE session_id = $1
      LIMIT 1;
      `,
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

    /* ---------- VERIFY OWNERSHIP + GET IMAGES ---------- */
    const adRes = await pool.query(
      `
      SELECT image_url
      FROM masters_latvia_ads
      WHERE id = $1 AND google_id = $2
      LIMIT 1;
      `,
      [adId, googleId]
    );

    if (!adRes.rowCount) {
      return res.status(403).json({
        resStatus: false,
        resMessage: "Not allowed to delete this ad",
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
      `DELETE FROM masters_latvia_reviews WHERE ad_id = $1;`,
      [adId]
    );

    // Hard delete ad
    await pool.query(
      `DELETE FROM masters_latvia_ads WHERE id = $1;`,
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
      resMessage: "Ad and related reviews deleted",
      resOkCode: 1
    });

  } catch (err) {
    await pool.query("ROLLBACK");

    console.error("Delete ad error:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 4
    });
  }
});
const visitCacheLM = {};
app.post("/api/post/master-latvia/ad-view", blockSpamIPs, rateLimitWrite, async (req, res) => {
  const { ad_id } = req.body;

  if (!ad_id) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Missing ad_id"
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

  if (!visitCacheLM[ipVisitor]) visitCacheLM[ipVisitor] = {};
  if (!visitCacheLM[ipVisitor][ad_id]) visitCacheLM[ipVisitor][ad_id] = 0;

  const lastView = visitCacheLM[ipVisitor][ad_id];

  if (now - lastView < COOLDOWN) {
    return res.json({
      resStatus: true,
      resOkCode: 2,
      resMessage: "View ignored (cooldown)"
    });
  }

  visitCacheLM[ipVisitor][ad_id] = now;

  try {
    await pool.query(
      "UPDATE masters_latvia_ads SET views = views + 1 WHERE id = $1",
      [ad_id]
    );

    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "View recorded"
    });

  } catch (err) {
    console.error("View save error:", err);
    return res.json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Database error"
    });
  }
});
app.post("/api/post/master-latvia/review", blockSpamIPs, rateLimitWrite, sanitizeInputs, async (req, res) => {
  const sessionId = req.cookies?.session_id;
  const reviewer_name = req.body.reviewer_name.trim();
  const review_text   = req.body.review_text.trim();
  const adId = req.body.adId;
  const rating = Number(req.body.rating);

  if (!sessionId || reviewer_name.length < 5 || review_text.length < 5 || !adId ) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Invalid or missing fields"
    });
  }
  if (rating < 0 || rating > 10) {
    return res.json({
      resStatus: false,
      resErrorCode: 6,
      resMessage: "Invalid rating value"
    });
  }
  try {
    /* ---------- SESSION LOOKUP ---------- */
    const sessionResult = await pool.query(
      `
      SELECT google_id
      FROM masters_latvia_sessions
      WHERE session_id = $1
      LIMIT 1
      `,
      [sessionId]
    );
    if (!sessionResult.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Not authenticated"
      });
    }
    const reviewer_google_id = sessionResult.rows[0].google_id;

    /* ---------- BLOCK SELF-REVIEW ---------- */
    const adOwnerCheck = await pool.query(
      `SELECT google_id FROM masters_latvia_ads WHERE id = $1 LIMIT 1`,
      [adId]
    );
    // If the ad exists and the owner is the same as the reviewer
    if (adOwnerCheck.rows[0]?.google_id === reviewer_google_id) {
      return res.json({
        resStatus: false,
        resErrorCode: 7, // New error code for self-review
        resMessage: "You cannot review your own ad"
      });
    }

    /* ---------- BLOCK DUPLICATE ACTIVE REVIEW ---------- */
    const activeReviewCheck = await pool.query(
      `
      SELECT 1
      FROM masters_latvia_reviews
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
        resMessage: "You have already posted a review for this ad"
      });
    }
    /* ---------- BLOCK RE-POST AFTER SOFT DELETE ---------- */
    const deletedWithReplyCheck = await pool.query(
      `
      SELECT 1
      FROM masters_latvia_reviews
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
          "You cannot post another review for this ad after the owner replied to your previous one"
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
      INSERT INTO masters_latvia_reviews
      (reviewer_name, review_text, date, reviewer_id, ad_id, parent, rating)
      VALUES ($1, $2, $3, $4, $5, NULL, $6)
      RETURNING id
      `,
      [
        reviewer_name,
        review_text,
        dateStr,
        reviewer_google_id,
        adId,
        rating
      ]
    );
    /* ---------- RECALCULATE AD STATS ---------- */
    await pool.query(
      `
      UPDATE masters_latvia_ads
      SET
        average_rating = COALESCE(sub.avg, 0),
        reviews_count  = COALESCE(sub.cnt, 0)
      FROM (
        SELECT
          ROUND(AVG(rating), 1) AS avg,
          COUNT(*) AS cnt
        FROM masters_latvia_reviews
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
      resMessage: "Review saved",
      review_id: insertReviewResult.rows[0].id
    });
  } catch (error) {
    console.error("Post review error:", error);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 99,
      resMessage: "Server error"
    });
  }
});
app.post("/api/post/master-latvia/reply", blockSpamIPs, rateLimitWrite, sanitizeInputs, async (req, res) => {
  const sessionId = req.cookies?.session_id;
  const { review_text, adId, parent } = req.body;

  if (!sessionId || !review_text || !adId || !parent) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Missing fields"
    });
  }

  try {
    // 1️⃣ get google_id from session
    const sessionQ = `
      SELECT google_id
      FROM masters_latvia_sessions
      WHERE session_id = $1
      LIMIT 1
    `;
    const sessionR = await pool.query(sessionQ, [sessionId]);

    if (!sessionR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Invalid session"
      });
    }

    const ownerGoogleId = sessionR.rows[0].google_id;

    // 2️⃣ verify owner owns this ad
    const adQ = `
      SELECT google_id
      FROM masters_latvia_ads
      WHERE id = $1
      LIMIT 1
    `;
    const adR = await pool.query(adQ, [adId]);

    if (!adR.rowCount || String(adR.rows[0].google_id) !== String(ownerGoogleId)) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "Not ad owner"
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
      INSERT INTO masters_latvia_reviews
      (reviewer_name, review_text, date, reviewer_id, ad_id, parent, rating)
      VALUES ('Owner', $1, $2, $3, $4, $5, NULL)
      RETURNING id
    `;

    const r = await pool.query(insertQ, [
      review_text,
      dateStr,
      ownerGoogleId, // reviewer_id = owner google_id
      adId,
      parent
    ]);

    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Reply saved",
      reply_id: r.rows[0].id
    });

  } catch (err) {
    console.error("Reply error:", err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 4,
      resMessage: "Server error"
    });
  }
});
app.post("/api/post/master-latvia/delete-reply", blockSpamIPs, rateLimitWrite, async (req, res) => {
  const sessionId = req.cookies?.session_id;
  const { replyId, adId } = req.body;

  if (!sessionId || !replyId || !adId) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Missing fields"
    });
  }

  try {
    // 1️⃣ get google_id from session
    const sessionQ = `
      SELECT google_id
      FROM masters_latvia_sessions
      WHERE session_id = $1
      LIMIT 1
    `;
    const sessionR = await pool.query(sessionQ, [sessionId]);

    if (!sessionR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Invalid session"
      });
    }

    const ownerGoogleId = sessionR.rows[0].google_id;

    // 2️⃣ verify ad ownership
    const adQ = `
      SELECT google_id
      FROM masters_latvia_ads
      WHERE id = $1
      LIMIT 1
    `;
    const adR = await pool.query(adQ, [adId]);

    if (!adR.rowCount || String(adR.rows[0].google_id) !== String(ownerGoogleId)) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "Not ad owner"
      });
    }

    // 3️⃣ verify reply belongs to this ad + owner + is a reply
    const replyQ = `
      SELECT id
      FROM masters_latvia_reviews
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
        resMessage: "Reply not found or not allowed"
      });
    }

    // 4️⃣ delete reply
    const deleteQ = `
      DELETE FROM masters_latvia_reviews
      WHERE id = $1
    `;
    await pool.query(deleteQ, [replyId]);

    return res.json({
      resStatus: true,
      resOkCode: 1,
      resMessage: "Reply deleted"
    });

  } catch (err) {
    console.error("Delete reply error:", err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 5,
      resMessage: "Server error"
    });
  }
});
app.post("/api/post/master-latvia/message", blockSpamIPs, rateLimitWrite, sanitizeInputs, async (req, res) => {
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
      resMessage: "Invalid input"
    });
  }
  // basic email sanity check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.json({
      resStatus: false,
      resErrorCode: 2,
      resMessage: "Invalid email"
    });
  }
  try {
    const d = new Date();
    const visitdate = `${String(d.getDate()).padStart(2, "0")}/${String(
      d.getMonth() + 1
    ).padStart(2, "0")}/${d.getFullYear()}`;

    const insertQ = `
      INSERT INTO messages_masters_latvia
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
      resMessage: "Server error"
    });
  }
});
app.post("/api/post/master-latvia/like", blockSpamIPs, rateLimitWrite, async (req, res) => {
  const sessionId = req.cookies?.session_id;
  const { ad_id } = req.body;

  if (!sessionId || !ad_id) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Missing fields"
    });
  }

  try {
    // ---------------------------------------
    // 1) GET LIKER GOOGLE ID (FROM SESSION)
    // ---------------------------------------
    const sessionQ = `
      SELECT google_id
      FROM masters_latvia_sessions
      WHERE session_id = $1
      LIMIT 1
    `;
    const sessionR = await pool.query(sessionQ, [sessionId]);

    if (!sessionR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Invalid session"
      });
    }

    const liker_google_id = sessionR.rows[0].google_id;

    // ---------------------------------------
    // 2) GET AD OWNER GOOGLE ID (MASTER)
    // ---------------------------------------
    const adQ = `
      SELECT google_id
      FROM masters_latvia_ads
      WHERE id = $1
      LIMIT 1
    `;
    const adR = await pool.query(adQ, [ad_id]);

    if (!adR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 3,
        resMessage: "Ad not found"
      });
    }

    const master_google_id = adR.rows[0].google_id;

    // ---------------------------------------
    // 3) CHECK EXISTING LIKE ROW
    // ---------------------------------------
    const selectQ = `
      SELECT id, likers
      FROM masters_latvia_likes
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
            `DELETE FROM masters_latvia_likes WHERE id = $1`,
            [row.id]
          );
          return res.json({
            resStatus: true,
            resOkCode: 3,
            resMessage: "Like removed (row deleted)"
          });
        }

        await pool.query(
          `UPDATE masters_latvia_likes SET likers = $1 WHERE id = $2`,
          [JSON.stringify(likers), row.id]
        );

        return res.json({
          resStatus: true,
          resOkCode: 4,
          resMessage: "Like removed"
        });
      }

      // ADD LIKE
      likers.push(liker_google_id);

      await pool.query(
        `UPDATE masters_latvia_likes SET likers = $1 WHERE id = $2`,
        [JSON.stringify(likers), row.id]
      );

      return res.json({
        resStatus: true,
        resOkCode: 1,
        resMessage: "Like saved"
      });
    }

    // ---------------------------------------
    // CASE B: NO ROW → CREATE NEW
    // ---------------------------------------
    const insertQ = `
      INSERT INTO masters_latvia_likes (ad_id, master_id, likers)
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
      resMessage: "Like saved (new row created)"
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 99,
      resMessage: "Server error"
    });
  }
});
app.get("/api/get/master-latvia/like-status", rateLimitRead, async (req, res) => {
  const sessionId = req.cookies?.session_id;
  const { ad_id } = req.query;

  if (!sessionId || !ad_id) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Missing fields"
    });
  }

  try {
    // get google_id from session
    const sessionQ = `
      SELECT google_id
      FROM masters_latvia_sessions
      WHERE session_id = $1
      LIMIT 1
    `;
    const sessionR = await pool.query(sessionQ, [sessionId]);

    if (!sessionR.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 2,
        resMessage: "Invalid session"
      });
    }

    const google_id = sessionR.rows[0].google_id;

    const q = `
      SELECT likers
      FROM masters_latvia_likes
      WHERE ad_id = $1
      LIMIT 1
    `;
    const r = await pool.query(q, [ad_id]);

    // No row → no likes yet
    if (!r.rowCount) {
      return res.json({
        resStatus: true,
        resOkCode: 1,
        hasLiked: false,
        likersCount: 0
      });
    }

    const likers = r.rows[0].likers || [];

    return res.json({
      resStatus: true,
      resOkCode: 2,
      hasLiked: likers.includes(google_id),
      likersCount: likers.length
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Server error"
    });
  }
});
app.get("/api/get/master-latvia/reviews/:ad_id", rateLimitRead, async (req, res) => {
  const adId = req.params.ad_id;

  if (!adId) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Missing ad_id"
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
      FROM masters_latvia_reviews
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
      resMessage: "Server error"
    });
  }
});
//this gets reviews from reviews table and ad data from ads table (owner name, title, picture)
//We are using this endpoint in profile page because it allows better performance
//otherwise we will have to make two requests to the backend-database instead of one here.
app.get("/api/get/master-latvia/profile-reviews-ads", rateLimitRead, async (req, res) => {
  const sessionId = req.cookies?.session_id;

  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "No active session",
      reviews: []
    });
  }

  try {
    /* get google id from session */
    const sessionQuery = `
      SELECT google_id
      FROM masters_latvia_sessions
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

    /* reviews + ad data (NO aliases) */
    const reviewsQuery = `
      SELECT
        masters_latvia_reviews.id,
        masters_latvia_reviews.review_text,
        masters_latvia_reviews.rating,
        masters_latvia_reviews.date,
        masters_latvia_reviews.ad_id,

        masters_latvia_ads.name  AS ad_owner_name,
        masters_latvia_ads.title AS ad_title,
        masters_latvia_ads.image_url AS ad_image_url
      FROM masters_latvia_reviews
      JOIN masters_latvia_ads
        ON masters_latvia_ads.id = masters_latvia_reviews.ad_id
      WHERE masters_latvia_reviews.reviewer_id = $1
        AND masters_latvia_reviews.is_deleted = false
        AND masters_latvia_reviews.parent IS NULL
      ORDER BY masters_latvia_reviews.id DESC;
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
      resMessage: "Server error",
      reviews: []
    });
  }
});
app.get("/api/get/master-latvia/profile-replies-ads", rateLimitRead, async (req, res) => {
  const sessionId = req.cookies?.session_id;

  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "No active session",
      reviews: []
    });
  }

  try {
    /* get google id from session */
    const sessionQuery = `
      SELECT google_id
      FROM masters_latvia_sessions
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

    /* replies written BY the user */
    const repliesQuery = `
      SELECT
        masters_latvia_reviews.id,
        masters_latvia_reviews.review_text,
        masters_latvia_reviews.date,
        masters_latvia_reviews.ad_id,

        masters_latvia_ads.name  AS ad_owner_name,
        masters_latvia_ads.title AS ad_title,
        masters_latvia_ads.image_url AS ad_image_url
      FROM masters_latvia_reviews
      JOIN masters_latvia_ads
        ON masters_latvia_ads.id = masters_latvia_reviews.ad_id
      WHERE masters_latvia_reviews.reviewer_id = $1
        AND masters_latvia_reviews.parent IS NOT NULL
        AND masters_latvia_reviews.is_deleted = false
      ORDER BY masters_latvia_reviews.id DESC;
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
      resMessage: "Server error",
      reviews: []
    });
  }
});
//deletes both reviews of the user and replies of the user.
//reviews of user with reply of the owner is not deleted. It is made hidden.
app.delete("/api/delete/master-latvia/review/:id", blockSpamIPs, rateLimitWrite, async (req, res) => {
  const sessionId = req.cookies?.session_id;
  const reviewId = req.params.id;

  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "No active session",
      resErrorCode: 1
    });
  }

  if (!reviewId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Missing review id",
      resErrorCode: 2
    });
  }

  try {
    /* GET GOOGLE ID FROM SESSION */
    const sessionRes = await pool.query(
      `
      SELECT google_id
      FROM masters_latvia_sessions
      WHERE session_id = $1
      LIMIT 1;
      `,
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

    /* VERIFY OWNERSHIP + GET ad_id */
    const ownershipRes = await pool.query(
      `
      SELECT id, parent, ad_id
      FROM masters_latvia_reviews
      WHERE id = $1
        AND reviewer_id = $2
      LIMIT 1;
      `,
      [reviewId, googleId]
    );

    if (!ownershipRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "Review not found or not allowed",
        resErrorCode: 4
      });
    }

    const { parent, ad_id: adId } = ownershipRes.rows[0];

    /* ---------- DELETE LOGIC ---------- */

    // Reply → hard delete
    if (parent !== null) {
      await pool.query(
        `DELETE FROM masters_latvia_reviews WHERE id = $1;`,
        [reviewId]
      );
    } else {
      // Main review → check replies
      const replyRes = await pool.query(
        `
        SELECT 1
        FROM masters_latvia_reviews
        WHERE parent = $1
        LIMIT 1;
        `,
        [reviewId]
      );

      if (replyRes.rowCount) {
        // Soft delete review + replies
        await pool.query(
          `
          UPDATE masters_latvia_reviews
          SET is_deleted = true
          WHERE id = $1 OR parent = $1;
          `,
          [reviewId]
        );
      } else {
        // Hard delete review
        await pool.query(
          `DELETE FROM masters_latvia_reviews WHERE id = $1;`,
          [reviewId]
        );
      }
    }

    /* ---------- RECALCULATE STATS ---------- */

    await pool.query(
      `
      UPDATE masters_latvia_ads
      SET
        average_rating = COALESCE(sub.avg, 0),
        reviews_count  = COALESCE(sub.cnt, 0)
      FROM (
        SELECT
          ROUND(AVG(rating), 1) AS avg,
          COUNT(*) AS cnt
        FROM masters_latvia_reviews
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
      resMessage: "Review deleted"
    });

  } catch (error) {
    console.error("Delete review error:", error);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection error",
      resErrorCode: 5
    });
  }
});
app.get("/api/get/master-latvia/session-user", blockSpamIPs, rateLimitRead, async (req, res) => {
  const sessionId = req.cookies?.session_id;

  // No cookie -> not logged in, but it's not an "error"
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
        masters_latvia_users.google_id,
        masters_latvia_users.email,
        masters_latvia_users.name
      FROM masters_latvia_sessions
      JOIN masters_latvia_users
        ON masters_latvia_users.google_id = masters_latvia_sessions.google_id
      WHERE masters_latvia_sessions.session_id = $1
      LIMIT 1;
    `;

    const result = await pool.query(query, [sessionId]);

    if (result.rowCount === 0) {
      // Cookie exists but session not found (expired/invalid)
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
      resMessage: "User session active",
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
      resMessage: "Database connection error",
      resErrorCode: 3,
      loggedIn: false
    });
  }
});
app.get("/api/get/master-latvia/ad/:id", rateLimitRead, async (req, res) => {
  const adId = req.params.id;

  try {
    const q = `
      SELECT 
        id, name, title, description, price, city, date, views,
        telephone, image_url, google_id, main_group, sub_group,
        average_rating, reviews_count
      FROM masters_latvia_ads
      WHERE id = $1
      LIMIT 1
    `;
    const r = await pool.query(q, [adId]);

    if (!r.rowCount) {
      return res.json({
        resStatus: false,
        resErrorCode: 1,
        resMessage: "Ad not found"
      });
    }

    const ad = r.rows[0];
    const { main_group, sub_group } = ad;

    let newerId = null;
    let olderId = null;

    if (sub_group) {
      const newerQ = `
        SELECT id FROM masters_latvia_ads
        WHERE main_group = $2
          AND sub_group = $3
          AND id > $1
        ORDER BY id ASC
        LIMIT 1
      `;
      const olderQ = `
        SELECT id FROM masters_latvia_ads
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
        SELECT id FROM masters_latvia_ads
        WHERE main_group = $2
          AND id > $1
        ORDER BY id ASC
        LIMIT 1
      `;
      const olderQ = `
        SELECT id FROM masters_latvia_ads
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
      resMessage: "Server error"
    });
  }
});
app.get("/api/get/master-latvia/user-ads", rateLimitRead, async (req, res) => {
  const sessionId = req.cookies?.session_id;
  if (!sessionId) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "No active session",
      resErrorCode: 1,
      ads: []
    });
  }
  try {
    // find google_id from session
    const sessionQuery = `
      SELECT google_id
      FROM masters_latvia_sessions
      WHERE session_id = $1
      LIMIT 1;
    `;
    const sessionRes = await pool.query(sessionQuery, [sessionId]);
    if (!sessionRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "No active session",
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
      FROM masters_latvia_ads
      WHERE google_id = $1
      ORDER BY date DESC, id DESC;
    `;
    const adsRes = await pool.query(adsQuery, [googleId]);
    return res.status(200).json({
      resStatus: true,
      resMessage: "User ads loaded",
      resOkCode: 1,
      ads: adsRes.rows
    });
  } catch (error) {
    console.error("User ads fetch error:", error);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Database connection error",
      resErrorCode: 3,
      ads: []
    });
  }
});
app.get("/api/get/master-latvia/search", blockSpamIPs, rateLimitRead, async (req, res) => {
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
      resMessage: "Search query too short or long"
    });
  }
  if (!/^[^<>]{3,60}$/.test(q)) {
    return res.json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Invalid search query"
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
      FROM masters_latvia_ads
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
      FROM masters_latvia_ads
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
      resMessage: "Server error"
    });
  }
});
app.get("/api/get/master-latvia/search-filter", rateLimitRead, blockSpamIPs, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 3 || q.length > 60) {
    return res.json({
      resStatus: false,
      resErrorCode: 1,
      resMessage: "Search query too short or long"
    });
  }
  if (!/^[^<>]{3,60}$/.test(q)) {
    return res.json({
      resStatus: false,
      resErrorCode: 3,
      resMessage: "Invalid search query"
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
      FROM masters_latvia_ads
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
      FROM masters_latvia_ads
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
      resMessage: "Server error"
    });
  }
});
app.get("/api/get/master-latvia/browse", blockSpamIPs, rateLimitRead, async (req, res) => {
  const { main, sub, cursor } = req.query;
  const limit = 12;

  try {
    let query = `
      SELECT 
        id, name, title, description, price, city, date, views,
        telephone, image_url, google_id, main_group, sub_group,
        average_rating, reviews_count
      FROM masters_latvia_ads
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
      resMessage: "Server error"
    });
  }
});
app.get("/api/get/master-latvia/browse-filter", blockSpamIPs, rateLimitRead, async (req, res) => {
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
      FROM masters_latvia_ads
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
      resMessage: "Server error"
    });
  }
});
app.get("/api/get/master-latvia/homepage/carousel", async (req, res) => {
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
      FROM masters_latvia_carousel
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
      resMessage: "Failed to fetch carousel ads",
      resErrorCode: 2
    });
  }
});


//This piece of code must be under all routes. Otherwise you will have issues like not being able to 
//fetch comments etc. This code helps with managing routes that are not defined on react frontend.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
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
/*Also add this otherwise only index route will be visible when you deploy app to production

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

*/
