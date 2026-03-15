const rateLimiterStore = Object.create(null);
const adPostingCooldownStore = new Map();
const visitorLoggingCache = {};

// List of blocked IPs (spam, malicious traffic, etc.)
const blockedIPAddresses = [
  "66.249.1111168.5",
  "66.249.68.421323221"
];

// IPs to exclude from visitor logging (bots, crawlers that can visit but aren't logged)
const excludedFromLoggingIPs = new Set([ 
  "80.89.79.139",
  "84.15.219.255",
  "212.3.194.8",
  "80.89.79.47",
  "212.3.197.163"
]);

// Helper function to extract client IP address
function extractClientIP(req) {
  const xf = req.headers["x-forwarded-for"];
  let ip = xf ? xf.split(",")[0].trim() : req.socket?.remoteAddress || req.ip;
  if (ip && ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }
  return ip;
}

// Block spam/malicious IPs
function blockMaliciousIPs(req, res, next) {
  const ip = extractClientIP(req);
  if (!ip) return next();
  if (blockedIPAddresses.includes(ip)) {
    return res.status(403).json({
      resStatus: false,
      resMessage: "Access denied",
      resErrorCode: 100
    });
  }
  next();
}

// Rate limiter for write operations (20 req/min)
function applyWriteRateLimit(req, res, next) {
  const ip = extractClientIP(req);
  const now = Date.now();
  const WINDOW = 60_000; // 1 min
  const LIMIT = 20;
  if (!rateLimiterStore[ip]) {
    rateLimiterStore[ip] = { w: { count: 1, start: now } };
    return next();
  }
  const w = rateLimiterStore[ip].w || { count: 0, start: now };
  if (now - w.start > WINDOW) {
    rateLimiterStore[ip].w = { count: 1, start: now };
    return next();
  }
  w.count++;
  rateLimiterStore[ip].w = w;
  if (w.count > LIMIT) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many write requests",
      resErrorCode: 110
    });
  }
  next();
}

// Rate limiter for read operations (80 req/min)
function applyReadRateLimit(req, res, next) {
  const ip = extractClientIP(req);
  const now = Date.now();
  const WINDOW = 60_000; // 1 min
  const LIMIT = 80;
  if (!rateLimiterStore[ip]) {
    rateLimiterStore[ip] = { r: { count: 1, start: now } };
    return next();
  }
  const r = rateLimiterStore[ip].r || { count: 0, start: now };
  if (now - r.start > WINDOW) {
    rateLimiterStore[ip].r = { count: 1, start: now };
    return next();
  }
  r.count++;
  rateLimiterStore[ip].r = r;
  if (r.count > LIMIT) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many requests",
      resErrorCode: 111
    });
  }
  next();
}

// Cooldown for ad posting (1 request per 5 seconds)
function enforceAdPostingCooldown(req, res, next) {
  const ip = req.headers["x-forwarded-for"]
    ? req.headers["x-forwarded-for"].split(",")[0].trim()
    : req.socket.remoteAddress || req.ip;
  const now = Date.now();
  const COOLDOWN_MS = 5000;
  const lastUsage = adPostingCooldownStore.get(ip);
  
  if (lastUsage && now - lastUsage < COOLDOWN_MS) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Please wait 5 seconds",
      resErrorCode: 112
    });
  }
  
  adPostingCooldownStore.set(ip, now);
  
  setTimeout(() => {
    const current = adPostingCooldownStore.get(ip);
    if (current && current <= now) {
      adPostingCooldownStore.delete(ip);
    }
  }, COOLDOWN_MS);
  
  next();
}

// Visitor logging middleware
function checkLogCooldown(waitingTime) {
  return (req, res, next) => {
    const ip =
      req.headers["x-forwarded-for"]
        ? req.headers["x-forwarded-for"].split(",")[0].trim()
        : req.socket.remoteAddress || req.ip;
    req.clientIp = ip;
    
    if (excludedFromLoggingIPs.has(ip)) {
      req.shouldLogVisit = false;
      return next();
    }
    
    const lastVisit = visitorLoggingCache[ip];
    if (lastVisit && Date.now() - lastVisit < waitingTime) {
      req.shouldLogVisit = false;
    } else {
      visitorLoggingCache[ip] = Date.now();
      req.shouldLogVisit = true;
    }
    next();
  };
}
const emailActionCooldownStore = {};
//1 ip can trigger reset password and signup only once per 20 minutes.
function enforceEmailActionCooldown(actionType, cooldownMs = 20 * 60 * 1000) {
  return (req, res, next) => {
    const ip = extractClientIP(req);
    const now = Date.now();

    if (!emailActionCooldownStore[ip]) {
      emailActionCooldownStore[ip] = {};
    }

    const blockUntil = emailActionCooldownStore[ip][actionType];

    if (blockUntil && now < blockUntil) {
      return res.status(429).json({
        resStatus: false,
        resMessage: "Per daug bandymų iš šio IP. Bandykite vėliau.",
        resErrorCode: 115
      });
    }

    req.emailActionCooldown = {
      registerSuccess: () => {
        if (!emailActionCooldownStore[ip]) {
          emailActionCooldownStore[ip] = {};
        }

        emailActionCooldownStore[ip][actionType] = Date.now() + cooldownMs;
      }
    };

    next();
  };
}

const loginProtectionStore = {};
function enforceLoginProtection(req, res, next) {
  const ip = extractClientIP(req);
  const data = loginProtectionStore[ip];

  if (data && data.blockUntil && Date.now() < data.blockUntil) {
    return res.status(429).json({
      resStatus: false,
      resMessage: "Too many failed login attempts. Try again in 20 minutes.",
      resErrorCode: 114
    });
  }

  req.loginProtection = {
    registerFail: () => {
      if (!loginProtectionStore[ip]) {
        loginProtectionStore[ip] = { fails: 1, blockUntil: null };
        return;
      }

      loginProtectionStore[ip].fails++;

      if (loginProtectionStore[ip].fails >= 9) {
        loginProtectionStore[ip].blockUntil = Date.now() + 20 * 60 * 1000;
        loginProtectionStore[ip].fails = 0;
      }
    },

    registerSuccess: () => {
      delete loginProtectionStore[ip];
    }
  };

  next();
}


module.exports = {
  extractClientIP,
  blockMaliciousIPs,
  applyWriteRateLimit,
  applyReadRateLimit,
  enforceAdPostingCooldown,
  checkLogCooldown,
  enforceLoginProtection,
  enforceEmailActionCooldown
};