const express = require("express");
const app = express();
const path = require('path');

//crypto and cookieParser are for masters email and google login/register endpoints
const crypto = require("crypto");
const bcrypt = require("bcrypt");

const cookieParser = require("cookie-parser");
app.use(cookieParser());

const { pool, supabase, upload } = require("./db"); // Import configurations
const useragent = require("useragent");
// ADD THIS NEAR TOP
const axios = require('axios');

const sendEmailBrevo = require("./utils/sendEmailBrevo");

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
  "https://meistarilatvija.lv",
  "http://meistarilatvija.lv",
  "https://www.meistarilatvija.lv",
  "http://www.meistarilatvija.lv",
  "https://www.pagalbapro.lt",
  "http://www.pagalbapro.lt",
  "https://pagalbapro.lt",
  "http://pagalbapro.lt",
  "https://masterslt.netlify.app"
];
app.use(cors({
  origin: function (origin, callback) {
    const normalizedOrigin = origin?.replace(/\/$/, '');  // remove trailing slash if present

    if (!origin || origin === "null" || allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

/*
  "http://127.0.0.1:8080",
  "http://192.168.8.103:8080",
  "https://latvia-masters.netlify.app",
  "https://www.latvia-masters.netlify.app",
  "https://www.latvia-masters.netlify.app/register",
  "https://www.latvia-masters.netlify.app/register.html",
  "https://latvia-masters.netlify.app/register",
  "https://latvia-masters.netlify.app/register.html",
   */

/*Google login for masters latvia*/
const { OAuth2Client } = require("google-auth-library");
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID); // FIXED

app.set('trust proxy', 1);

//we need this as we use req.body to send data from frontend to backend
app.use(express.json());

//Then go to server.js file and make sure you serve static files from build directory:
app.use(express.static(path.join(__dirname, 'client/build')));
//For serving from build directory, you need to install path package and initiate it:

//import and then mount masters LT routes
//Mounting routes must come after cors and other imports
const mastersLTRoutes = require("./routes/masters_LT");
app.use("/api/master-lithuania", mastersLTRoutes);
const mastersLVRoutes = require("./routes/masters_LV");
app.use("/", mastersLVRoutes);
//This function for now will be used safely convert image file names to alphanumerical values
//currently used by latvia masters
//can be used by any endpoint in the future
// example value: 30/11/2025_111aaa.jpgo
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

//MIDDLEWARE - VISITOR LOGGING
const visitorCache = {}; //This object array is for cooldown
//This array is for ip addresses that we dont want to save in visitors table at all.
//It is for bot ip addresses. They can visit the website but we will not save them.
const ignoredLoggingIps = new Set([ 
  "80.89.79.139",
  "84.15.219.255",
  "212.3.194.8",
  "80.89.79.47",
  "212.3.197.163"
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
