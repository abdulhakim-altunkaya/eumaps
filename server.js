const express = require("express");
const app = express();
const path = require('path');

const { pool } = require("./db");
const useragent = require('useragent');

const cors = require("cors");
app.use(cors());

// ADD THIS NEAR TOP
const axios = require('axios');

app.set('trust proxy', true);

//we need this as we use req.body to send data from frontend to backend
app.use(express.json());

//Then go to server.js file and make sure you serve static files from build directory:
app.use(express.static(path.join(__dirname, 'client/build')));
//For serving from build directory, you need to install path package and initiate it:

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

const ipCache3 = {}
app.post("/api/save-visitor/ipradar/:ipInput", async (req, res) => {
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
  // Check if IP exists in cache and if last visit was less than 1 minute ago (60000 ms)
  if (ipCache3[ipVisitor] && Date.now() - ipCache3[ipVisitor] < 10000) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many requests from this IP.",
      resErrorCode: 2
    });
  }

  ipCache3[ipVisitor] = Date.now();//save visitor ip to ipCache3
  const userAgentString = req.get('User-Agent') || '';
  const agent = useragent.parse(userAgentString);

  const {ipInput} = req.params;

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

    // OPERATION 2: Fetch geolocation from IPAPI
    const ipapiKey = process.env.IPAPI_ACCESS_KEY;
    const ipapiUrl = `https://ipapi.co/${ipInput}/json/?key=${ipapiKey}`;
console.log("IPAPI Key:", ipapiKey ? "[OK]" : "[MISSING]");
console.log("ipInput:", ipInput);
console.log("IPAPI URL:", ipapiUrl);
    const geoRes = await axios.get(ipapiUrl);
console.log("IPAPI Response Status:", geoRes.status);
console.log("IPAPI Response Data:", geoRes.data);
    const data = geoRes.data;
    
    const geoData = {
      continent: data.continent_name,
      country: data.country_name,
      city: data.city,
      latitude: data.latitude,
      longitude: data.longitude,
      connectionType: data.connection_type,
      ipType: data.version
    };

    //SEND OK MESSAGE AND LOCATION DATA AFTER OPERATION 1 (SAVING USER TO DB)
    //AND OPERATION 2 (SENDING USER IP INPUT TO IPAPI ENDPOINT AND GETTING LOCATION DATA FROM IT)
    return res.status(200).json({
      resStatus: true,
      resMessage: "Visitor logged and geolocation fetched.",
      resOkCode: 1,
      resData: geoData
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

//This piece of code must be under all routes. Otherwise you will have issues like not being able to 
//fetch comments etc. This code helps with managing routes that are not defined on react frontend.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

// IP-based geolocation endpoint
app.post("/api/get-coordinates", async (req, res) => {
  const { ipInput } = req.body; // Get IP address from the request body
  console.log(ipInput);
  try {
     const apiKey = process.env.IPAPI_KEY; // Load API key from .env file
     const response = await axios.get(`http://api.ipapi.com/api/${ipInput}?access_key=${apiKey}`);
      const { latitude, longitude, country_name, city, connection_type, type, continent_name } = response.data;
      // Send latitude and longitude in the response
      console.log(response.data);
      res.json({ latitude, longitude, country_name, city, connection_type, type, continent_name });
  } catch (error) {
      console.error("Error fetching geolocation data:", error.message);
      res.status(500).json({ error: "Failed to fetch geolocation data" });
  }
});

const PORT = process.env.port || 5000;
app.listen(PORT, () => {
  console.log("Port is open on " + PORT);
});

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
