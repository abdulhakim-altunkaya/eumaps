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
      new Error('Not allowed by CORS')
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

app.set('trust proxy', 1);

//we need this as we use req.body to send data from frontend to backend
app.use(express.json());

//Then go to server.js file and make sure you serve static files from build directory:
app.use(express.static(path.join(__dirname, 'client/build')));
//For serving from build directory, you need to install path package and initiate it:

app.options('*', cors())
//import and then mount masters master routes
//Mounting routes must come after cors and other imports
const mastersLTRoutes = require("./routes/masters_LT");
app.use("/api/master-lithuania", mastersLTRoutes);
const filebeefRoutes = require("./routes/filebeef");
app.use("/", filebeefRoutes);