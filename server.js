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
// List of IPs to ignore (server centers, ad bots, my ip etc)
//The list is updated to let web crawlers to pass and visit website
//block ip list currently has 2 decoy ip to prevent error on middleware code.
const ignoredIPs = ["66.249.1111168.5", "66.249.68.421323221"];

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
const ipCache7 = {}
app.post("/api/save-visitor/letonya-oturum", async (req, res) => {
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
  if (ipCache7[ipVisitor] && Date.now() - ipCache7[ipVisitor] < 1000000) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many requests from this IP.",
      resErrorCode: 2
    });
  }

  ipCache7[ipVisitor] = Date.now();//save visitor ip to ipCache7
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
      `INSERT INTO visitors_letonya_oturum (ip, op, browser, date) 
      VALUES ($1, $2, $3, $4)`, 
      [visitorData.ip, visitorData.os, visitorData.browser, visitorData.visitDate]
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
const ipCache9 = {}
app.post("/api/save-visitor/letonya-oturum-english", async (req, res) => {
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
  if (ipCache9[ipVisitor] && Date.now() - ipCache9[ipVisitor] < 1000000) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many requests from this IP.",
      resErrorCode: 2
    });
  }

  ipCache9[ipVisitor] = Date.now();//save visitor ip to ipCache9
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
      `INSERT INTO visitors_letonya_oturum_english (ip, op, browser, date) 
      VALUES ($1, $2, $3, $4)`, 
      [visitorData.ip, visitorData.os, visitorData.browser, visitorData.visitDate]
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
const ipCache11 = {}
app.post("/api/kac-milyon/save-visitor", async (req, res) => {
  //Here we could basically say "const ipVisitor = req.ip" but my app is running on Render platform
  //and Render is using proxies or load balancers. Because of that I will see "::1" as ip data if I not use
  //this line below
  const ipVisitor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress || req.ip;
  let client;
  
  // Check if the IP is in the ignored list
  if (ignoredIPs.includes(ipVisitor)) {
    return res.status(403).json({
      resStatus: false,
      resMessage: "This IP is ignored from logging",
      resErrorCode: 1
    });
  }
  // Check if IP exists in cache and if last visit was less than approximately 4 minutes ago
  if (ipCache11[ipVisitor] && Date.now() - ipCache11[ipVisitor] < 250000) {
    return res.status(200).json({
      resStatus: false,
      resMessage: "Too many requests from this IP.",
      resOkCode: 2
    });
  }

  ipCache11[ipVisitor] = Date.now();//save visitor ip to ipCache11
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
      `INSERT INTO visitors_kac_milyon (ip, op, browser, date) 
      VALUES ($1, $2, $3, $4)`, 
      [visitorData.ip, visitorData.os, visitorData.browser, visitorData.visitDate]
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
const ipCache12 = {}
app.post("/api/litvanya-yatirim/save-visitor", async (req, res) => {
  //Here we could basically say "const ipVisitor = req.ip" but my app is running on Render platform
  //and Render is using proxies or load balancers. Because of that I will see "::1" as ip data if I not use
  //this line below
  const ipVisitor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress || req.ip;
  let client;
  
  // Check if the IP is in the ignored list
  if (ignoredIPs.includes(ipVisitor)) {
    return res.status(403).json({
      resStatus: false,
      resMessage: "This IP is ignored from logging",
      resErrorCode: 1
    });
  }
  // Check if IP exists in cache and if last visit was less than approximately 4 minutes ago
  if (ipCache12[ipVisitor] && Date.now() - ipCache12[ipVisitor] < 250000) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many requests from this IP.",
      resErrorCode: 2
    });
  }

  ipCache12[ipVisitor] = Date.now();//save visitor ip to ipCache12
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
      `INSERT INTO visitors_litvanyayatirim (ip, op, browser, date) 
      VALUES ($1, $2, $3, $4)`, 
      [visitorData.ip, visitorData.os, visitorData.browser, visitorData.visitDate]
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
app.post("/api/post/master-latvia/ads", upload.array("images", 5), async (req, res) => {
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
      resMessage: "Invalid form data",
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
  /* -------------------------------------------
     SESSION VALIDATION
  ------------------------------------------- */
  const sessionId = req.cookies?.session_id;
  if (!sessionId) {
    return res.status(401).json({
      resStatus: false,
      resMessage: "Not logged in",
      resErrorCode: 13
    });
  }
  const userRes = await pool.query(
    `SELECT google_id, user_id FROM masters_latvia_sessions WHERE session_id = $1 LIMIT 1`,
    [sessionId]
  );
  if (!userRes.rowCount) {
    return res.status(401).json({
      resStatus: false,
      resMessage: "Invalid session",
      resErrorCode: 14
    });
  }

  const googleId = userRes.rows[0].google_id;
  const dbUserId = userRes.rows[0].user_id;

  /* -------------------------------------------
     IMAGE VALIDATION
  ------------------------------------------- */
  const files = req.files;

  if (!files || files.length < 1 || files.length > 5) {
    return res.status(400).json({
      resStatus: false,
      resMessage: "1–5 images required",
      resErrorCode: 8
    });
  }

  // Upload images
  let uploadedImages = [];
  for (const f of files) {
    const fileName = makeSafeName();
    const { error } = await supabase.storage
      .from("masters_latvia_storage")
      .upload(fileName, f.buffer, { contentType: f.mimetype });

    if (error) {
      return res.status(503).json({
        resStatus: false,
        resMessage: "Image upload failed",
        resErrorCode: 10
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
    console.log({
      inputName,
      inputService,
      inputDescription,
      inputPrice,
      inputRegions,
      phone: Number(countryCode + phoneNumber),
      uploadedImages,
      main_group,
      sub_group,
      dbUserId,
      googleId
    });

    const insertQuery = `
      INSERT INTO masters_latvia_ads 
      (name, title, description, price, city, telephone, image_url, ip, date,
       main_group, sub_group, user_id, google_id, update_date,
       created_at, is_active)
      VALUES 
      ($1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14,
       $15, $16)
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
      dbUserId,   // <-- THIS MUST NOT BE NULL
      googleId,
      new Date().toISOString().slice(0, 10),
      new Date(),
      true
    ];

    const result = await client.query(insertQuery, values);
    if (!result.rowCount) {
      return res.status(503).json({
        resStatus: false,
        resMessage: "Database insert failed",
        resErrorCode: 11
      });
    }

    return res.status(201).json({
      resStatus: true,
      resMessage: "Master ad saved",
      resOkCode: 1
    });

  } catch (err) {
    return res.status(503).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 12
    });

  } finally {
    if (client) client.release();
  }
});

//this function below is for google auth login of latvia masters
async function createSessionForUser(dbGoogleId, dbUserId) {
  const sessionId = crypto.randomUUID(); // generate inline
  await pool.query(
    `INSERT INTO masters_latvia_sessions (session_id, google_id, user_id) VALUES ($1, $2, $3)`,
    [sessionId, dbGoogleId, dbUserId]
  );
  return sessionId;
}
app.post("/api/post/master-latvia/auth/google", async (req, res) => {
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
      INSERT INTO masters_latvia_users (google_id, email, name, date, number_ads, ip)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (google_id)
      DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
      RETURNING id, google_id;
    `;
    const values = [ googleId, email, name, new Date().toISOString().slice(0, 10), 0, ipVisitor ];
    const result = await client.query(query, values);

    const dbUserId = result.rows[0].id;
    const dbGoogleId = result.rows[0].google_id;

    const sessionId = await createSessionForUser(dbGoogleId, dbUserId);
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
app.post("/api/post/master-latvia/logout", async (req, res) => {
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
app.post("/api/post/master-latvia/toggle-activation/:id", async (req, res) => {
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
app.post("/api/post/master-latvia/delete-ad/:id", async (req, res) => {
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
    // Validate session
    const sessionQuery = `
      SELECT google_id
      FROM masters_latvia_sessions
      WHERE session_id = $1
      LIMIT 1;
    `;
    const sessionRes = await pool.query(sessionQuery, [sessionId]);
    if (!sessionRes.rowCount) {
      return res.status(401).json({
        resStatus: false,
        resMessage: "Invalid session",
        resErrorCode: 2
      });
    }

    const googleId = sessionRes.rows[0].google_id;

    // Fetch ad + images (IMPORTANT)
    const adQuery = `
      SELECT image_url
      FROM masters_latvia_ads
      WHERE id = $1 AND google_id = $2
      LIMIT 1;
    `;
    const adRes = await pool.query(adQuery, [adId, googleId]);

    if (!adRes.rowCount) {
      return res.status(403).json({
        resStatus: false,
        resMessage: "Not allowed to delete this ad",
        resErrorCode: 3
      });
    }

    // Parse image list
    let images = [];
    try {
      images = Array.isArray(adRes.rows[0].image_url)
        ? adRes.rows[0].image_url
        : JSON.parse(adRes.rows[0].image_url);
    } catch {
      images = [];
    }

    // Extract filenames from full URLs
    const filesToDelete = images
      .map(url => url.split("/").pop()) // take last part of URL
      .filter(Boolean); // remove empty

    // Delete from Supabase storage
    if (filesToDelete.length > 0) {
      const { error } = await supabase.storage
        .from("masters_latvia_storage")
        .remove(filesToDelete);

      if (error) {
        console.error("Supabase delete error:", error);
        // NOT failing the whole request — image deletion shouldn't block ad deletion
      }
    }

    // Delete database record
    await pool.query(`DELETE FROM masters_latvia_ads WHERE id = $1`, [adId]);

    return res.json({
      resStatus: true,
      resMessage: "Ad deleted successfully",
      resOkCode: 1
    });

  } catch (err) {
    console.error("Delete ad error:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 4
    });
  }
});
app.post("/api/save/master-latvia/like", async (req, res) => {
  let { liker_id, ad_id, master_id } = req.body;

  if (!liker_id || !ad_id || !master_id) {
    return res.json({ resStatus: false, resMessage: "Missing fields" });
  }

  // convert to numbers
  const liker = Number(liker_id);
  const ad = Number(ad_id);
  const master = Number(master_id);

  try {
    const selectQ = `
      SELECT id, likers
      FROM masters_latvia_likes
      WHERE ad_id = $1 AND master_id = $2
      LIMIT 1
    `;
    const selectR = await pool.query(selectQ, [ad, master]);

    let likers = [];
    let likeRowId = null;

    if (selectR.rowCount) {
      likeRowId = selectR.rows[0].id;
      likers = (selectR.rows[0].likers || []).map(n => Number(n));
    }

    // add liker if missing
    if (!likers.includes(liker)) {
      likers.push(liker);
    }

    if (!selectR.rowCount) {
      const insertQ = `
        INSERT INTO masters_latvia_likes (master_id, ad_id, likers)
        VALUES ($1, $2, $3)
      `;
      await pool.query(insertQ, [master, ad, likers]);
    } else {
      const updateQ = `
        UPDATE masters_latvia_likes
        SET likers = $1
        WHERE id = $2
      `;
      await pool.query(updateQ, [likers, likeRowId]);
    }

    return res.json({ resStatus: true, likersCount: likers.length });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error"
    });
  }
});
app.get("/api/get/master-latvia/session-user", async (req, res) => {
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
      SELECT masters_latvia_users.google_id,
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
app.get("/api/get/master-latvia/ad/:id", async (req, res) => {
  const adId = req.params.id;

  try {
    const q = `
      SELECT 
        id, name, title, description, price, city,
        telephone, image_url, google_id, main_group, sub_group
      FROM masters_latvia_ads
      WHERE id = $1
      LIMIT 1
    `;
    const r = await pool.query(q, [adId]);

    if (!r.rowCount) {
      return res.json({
        resStatus: false,
        resMessage: "Ad not found"
      });
    }

    return res.json({
      resStatus: true,
      ad: r.rows[0]
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error"
    });
  }
});
app.get("/api/get/master-latvia/user-ads", async (req, res) => {
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
app.get("/api/get/master-latvia/browse", async (req, res) => {
  const { main, sub } = req.query;

  try {
    let query = `
      SELECT *
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

    query += ` ORDER BY created_at DESC`;

    const adsRes = await pool.query(query, params);

    if (!adsRes.rowCount) {
      return res.status(200).json({
        resStatus: false,
        resMessage: "No ads found",
        resErrorCode: 1,
        ads: []
      });
    }

    return res.status(200).json({
      resStatus: true,
      resMessage: "Ads loaded successfully",
      resOkCode: 1,
      count: adsRes.rowCount,
      ads: adsRes.rows
    });

  } catch (err) {
    console.error("Browse error:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 2
    });
  }
});
app.put("/api/put/master-latvia/update-ad/:id", upload.array("images", 5), async (req, res) => {
  const adId = req.params.id;

  /* -------------------------------
     CHECK LOGIN SESSION
  --------------------------------*/
  const sessionId = req.cookies?.session_id;
  if (!sessionId) {
    return res.status(401).json({
      resStatus: false,
      resMessage: "Not logged in",
      resErrorCode: 13
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
        resMessage: "Invalid session",
        resErrorCode: 14
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
        resMessage: "Ad not found",
        resErrorCode: 20
      });
    }

    if (adQ.rows[0].google_id !== googleId) {
      return res.status(403).json({
        resStatus: false,
        resMessage: "Unauthorized",
        resErrorCode: 21
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
        resMessage: "Invalid form data",
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
      existingImages
    } = formData;

    /* -------------------------------
       HANDLE NEW IMAGE UPLOADS
    --------------------------------*/
    const files = req.files;
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    let finalImages = Array.isArray(existingImages) ? existingImages : [];

    // Validate new images if any
    if (files && files.length > 0) {
      for (const f of files) {
        if (!allowed.includes(f.mimetype)) {
          return res.status(400).json({
            resStatus: false,
            resMessage: "Unsupported file type",
            resErrorCode: 9
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
            resMessage: "Image upload failed",
            resErrorCode: 10
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
        update_date = $8
      WHERE id = $9 AND google_id = $10
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
      new Date().toISOString().slice(0, 10),
      adId,
      googleId
    ];

    const result = await pool.query(updateQ, values);

    if (!result.rowCount) {
      return res.json({
        resStatus: false,
        resMessage: "Update failed",
        resErrorCode: 22
      });
    }

    return res.json({
      resStatus: true,
      resMessage: "Ad updated successfully",
      resOkCode: 1
    });

  } catch (err) {
    console.error("UPDATE ERROR:", err);
    return res.status(500).json({
      resStatus: false,
      resMessage: "Server error",
      resErrorCode: 23
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
