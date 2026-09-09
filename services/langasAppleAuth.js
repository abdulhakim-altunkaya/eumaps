const { createRemoteJWKSet, jwtVerify } = require('jose');
const JWKS=createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
async function verifyAppleIdentityToken(idToken){ const {payload}=await jwtVerify(idToken,JWKS,{issuer:'https://appleid.apple.com',audience:process.env.LANGAS_APPLE_CLIENT_ID}); return {id:payload.sub,email:payload.email||null,name:null,avatar:null}; }
module.exports={verifyAppleIdentityToken};
