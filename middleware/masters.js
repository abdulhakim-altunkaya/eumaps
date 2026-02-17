const rateLimit = require("express-rate-limit"); // or however you create them

const rateLimitRead = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  // ... your config
});

const rateLimitWrite = rateLimit({
  // ... your config
});

module.exports = { rateLimitRead, rateLimitWrite };