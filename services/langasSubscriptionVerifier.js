// Store-side verification is intentionally isolated here so credentials never enter Unity.
// Configure LANGAS_GOOGLE_PACKAGE_NAME / Google service account and Apple App Store Server API credentials.
async function verifyStoreSubscription(body){
  const {store,productId,transactionId,receipt}=body;
  if(!['google','apple'].includes(store)||!productId||!transactionId||!receipt) throw new Error('Missing receipt fields');
  // Production: replace the verifier below with Google Play Developer API / Apple App Store Server API call.
  // FAIL CLOSED until store credentials are configured. Never trust a client-only purchase flag.
  if(process.env.LANGAS_ALLOW_DEV_RECEIPTS==='true' && receipt==='LANGAS_DEV_RECEIPT') return {valid:true,store,productId,transactionId,rawReceipt:receipt,expiresAt:new Date(Date.now()+365*86400000)};
  throw new Error('Store verifier credentials not configured');
}
module.exports={verifyStoreSubscription};
