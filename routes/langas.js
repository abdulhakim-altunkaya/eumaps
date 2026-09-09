const express = require("express");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { pool, supabase } = require("../db");
const { applyReadRateLimit, applyWriteRateLimit, blockMaliciousIPs } = require("../middleware/masters_MW");
const { verifyAppleIdentityToken } = require("../services/langasAppleAuth");
const { verifyStoreSubscription } = require("../services/langasSubscriptionVerifier");
const { scorePronunciation } = require("../services/langasPronunciation");
const router = express.Router();
const googleClient = new OAuth2Client(process.env.LANGAS_GOOGLE_CLIENT_ID);
const FREE_LESSONS = 5;
function sid(){ return crypto.randomBytes(32).toString("hex"); }
async function auth(req,res,next){
  const token=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(!token) return res.status(401).json({resStatus:false,resMessage:"Authentication required"});
  const q=await pool.query(`SELECT s.user_id,u.* FROM langas_sessions s JOIN langas_users u ON u.id=s.user_id WHERE s.session_id=$1 AND s.expires_at>now() LIMIT 1`,[token]);
  if(!q.rowCount) return res.status(401).json({resStatus:false,resMessage:"Invalid session"}); req.langasUser=q.rows[0]; next();
}
router.post("/auth", blockMaliciousIPs, applyWriteRateLimit, async(req,res)=>{
  try{
    const {provider,idToken,guestProgress}=req.body||{}; let p;
    if(provider==="google") { const t=await googleClient.verifyIdToken({idToken,audience:process.env.LANGAS_GOOGLE_CLIENT_ID}); const x=t.getPayload(); p={id:x.sub,email:x.email,name:x.name||null,avatar:x.picture||null}; }
    else if(provider==="apple") p=await verifyAppleIdentityToken(idToken);
    else return res.status(400).json({resStatus:false,resMessage:"Unsupported provider"});
    const u=await pool.query(`INSERT INTO langas_users(provider,provider_user_id,email,display_name,avatar_url) VALUES($1,$2,$3,$4,$5) ON CONFLICT(provider,provider_user_id) DO UPDATE SET email=COALESCE(EXCLUDED.email,langas_users.email),display_name=COALESCE(EXCLUDED.display_name,langas_users.display_name),avatar_url=COALESCE(EXCLUDED.avatar_url,langas_users.avatar_url),updated_at=now() RETURNING *`,[provider,p.id,p.email||null,p.name||null,p.avatar||null]);
    const user=u.rows[0], session=sid(); await pool.query(`INSERT INTO langas_sessions(session_id,user_id,expires_at) VALUES($1,$2,now()+interval '90 days')`,[session,user.id]);
    if(guestProgress && typeof guestProgress==='object') await pool.query(`INSERT INTO langas_guest_migrations(migration_id,user_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[crypto.randomUUID(),user.id,guestProgress]);
    return res.json({resStatus:true,resData:{sessionId:session,user}});
  }catch(e){ console.error("Langas auth",e); return res.status(401).json({resStatus:false,resMessage:"Sign-in failed"}); }
});
router.get("/lessons/:id", blockMaliciousIPs, applyReadRateLimit, async(req,res)=>{
  const id=Number(req.params.id); if(!Number.isInteger(id)||id<1||id>120) return res.status(400).json({resStatus:false,resMessage:"Invalid lesson"});
  let user=null; const token=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(token){ const q=await pool.query(`SELECT u.* FROM langas_sessions s JOIN langas_users u ON u.id=s.user_id WHERE s.session_id=$1 AND s.expires_at>now()`,[token]); user=q.rows[0]||null; }
  if(id>FREE_LESSONS && (!user || user.subscription_status!=="active" || !user.subscription_expires_at || new Date(user.subscription_expires_at)<=new Date())) return res.status(402).json({resStatus:false,resMessage:"Subscription required",resErrorCode:4021});
  const q=await pool.query(`SELECT id,level,lesson_order,title,is_free,content,version FROM langas_lessons WHERE id=$1 AND is_active=true`,[id]);
  if(!q.rowCount) return res.status(404).json({resStatus:false,resMessage:"Lesson not found"}); return res.json({resStatus:true,resData:q.rows[0]});
});
router.post("/progress/exercise", blockMaliciousIPs, applyWriteRateLimit, auth, async(req,res)=>{
  const {lessonId,exerciseId,skill,score,xp=10}=req.body||{}; const n=Number(score); if(!Number.isFinite(n)||n<0||n>100) return res.status(400).json({resStatus:false,resMessage:"Invalid score"});
  const l=await pool.query(`SELECT content FROM langas_lessons WHERE id=$1`,[lessonId]); if(!l.rowCount) return res.status(404).json({resStatus:false,resMessage:"Lesson not found"});
  const exercise=(l.rows[0].content.exercises||[]).find(x=>x.id===exerciseId); if(!exercise) return res.status(400).json({resStatus:false,resMessage:"Exercise not found"});
  const passed=n >= Number(exercise.passRate||.8)*100; const award=passed?Math.max(0,Math.min(Number(xp)||10,50)):0; const uid=req.langasUser.user_id;
  await pool.query('BEGIN'); try{
    await pool.query(`INSERT INTO langas_exercise_attempts(user_id,lesson_id,exercise_id,skill,score,passed,xp_awarded) VALUES($1,$2,$3,$4,$5,$6,$7)`,[uid,lessonId,exerciseId,skill,n,passed,award]);
    await pool.query(`UPDATE langas_users SET xp=xp+$2,level=GREATEST(1,FLOOR((xp+$2)/500)+1),updated_at=now() WHERE id=$1`,[uid,award]);
    await pool.query(`INSERT INTO langas_daily_activity(user_id,activity_date,exercises_completed,xp_earned) VALUES($1,current_date,1,$2) ON CONFLICT(user_id,activity_date) DO UPDATE SET exercises_completed=langas_daily_activity.exercises_completed+1,xp_earned=langas_daily_activity.xp_earned+$2`,[uid,award]);
    await pool.query(`INSERT INTO langas_weekly_leaderboard(week_start,user_id,xp) VALUES(date_trunc('week',current_date)::date,$1,$2) ON CONFLICT(week_start,user_id) DO UPDATE SET xp=langas_weekly_leaderboard.xp+$2`,[uid,award]); await pool.query('COMMIT');
  }catch(e){await pool.query('ROLLBACK'); throw e;} return res.json({resStatus:true,resData:{passed,xpAwarded:award}});
});
router.post("/progress/lesson", blockMaliciousIPs, applyWriteRateLimit, auth, async(req,res)=>{
  const {lessonId,score}=req.body||{}; const uid=req.langasUser.user_id; const n=Number(score); if(!Number.isFinite(n)||n<0||n>100) return res.status(400).json({resStatus:false,resMessage:"Invalid score"});
  const l=await pool.query(`SELECT completion_pass_rate FROM langas_lessons WHERE id=$1`,[lessonId]); if(!l.rowCount) return res.status(404).json({resStatus:false,resMessage:"Lesson not found"}); const completed=n>=Number(l.rows[0].completion_pass_rate)*100;
  await pool.query(`INSERT INTO langas_lesson_progress(user_id,lesson_id,best_score,attempts,completed,completed_at,last_attempt_at) VALUES($1,$2,$3,1,$4,CASE WHEN $4 THEN now() END,now()) ON CONFLICT(user_id,lesson_id) DO UPDATE SET best_score=GREATEST(langas_lesson_progress.best_score,$3),attempts=langas_lesson_progress.attempts+1,completed=langas_lesson_progress.completed OR $4,completed_at=CASE WHEN langas_lesson_progress.completed_at IS NULL AND $4 THEN now() ELSE langas_lesson_progress.completed_at END,last_attempt_at=now()`,[uid,lessonId,n,completed]); return res.json({resStatus:true,resData:{completed}});
});
router.get("/leaderboard/:scope", blockMaliciousIPs, applyReadRateLimit, async(req,res)=>{
  const scope=req.params.scope; let q; if(scope==='weekly') q=await pool.query(`SELECT u.display_name,u.avatar_url,w.xp FROM langas_weekly_leaderboard w JOIN langas_users u ON u.id=w.user_id WHERE w.week_start=date_trunc('week',current_date)::date ORDER BY w.xp DESC LIMIT 100`); else if(scope==='all') q=await pool.query(`SELECT display_name,avatar_url,xp FROM langas_users ORDER BY xp DESC LIMIT 100`); else return res.status(400).json({resStatus:false,resMessage:"Invalid scope"}); return res.json({resStatus:true,resData:q.rows});
});
router.put("/settings", blockMaliciousIPs, applyWriteRateLimit, auth, async(req,res)=>{ const {dailyGoalExercises,reminderEnabled,reminderTime}=req.body||{}; const g=Math.max(1,Math.min(Number(dailyGoalExercises)||11,55)); await pool.query(`UPDATE langas_users SET daily_goal_exercises=$2,reminder_enabled=$3,reminder_time=$4,updated_at=now() WHERE id=$1`,[req.langasUser.user_id,g,!!reminderEnabled,reminderTime||null]); return res.json({resStatus:true}); });
router.post("/subscription/verify", blockMaliciousIPs, applyWriteRateLimit, auth, async(req,res)=>{ try{ const v=await verifyStoreSubscription(req.body||{}); if(!v.valid) return res.status(400).json({resStatus:false,resMessage:"Subscription could not be verified"}); await pool.query(`INSERT INTO langas_subscription_receipts(user_id,store,product_id,transaction_id,raw_receipt,verified,expires_at) VALUES($1,$2,$3,$4,$5,true,$6) ON CONFLICT(transaction_id) DO UPDATE SET verified=true,expires_at=EXCLUDED.expires_at`,[req.langasUser.user_id,v.store,v.productId,v.transactionId,v.rawReceipt,v.expiresAt]); await pool.query(`UPDATE langas_users SET subscription_status='active',subscription_store=$2,subscription_expires_at=$3,updated_at=now() WHERE id=$1`,[req.langasUser.user_id,v.store,v.expiresAt]); return res.json({resStatus:true,resData:{expiresAt:v.expiresAt}}); }catch(e){console.error('Langas subscription verify',e);return res.status(500).json({resStatus:false,resMessage:'Verification error'});} });
router.post("/pronunciation", blockMaliciousIPs, applyWriteRateLimit, auth, express.raw({type:'audio/*',limit:'5mb'}), async(req,res)=>{ try{ const expected=String(req.query.expected||'').slice(0,300); if(!expected||!Buffer.isBuffer(req.body)) return res.status(400).json({resStatus:false,resMessage:'Audio and expected text required'}); const result=await scorePronunciation(req.body,expected); return res.json({resStatus:true,resData:result}); }catch(e){console.error('Langas pronunciation',e);return res.status(503).json({resStatus:false,resMessage:'Pronunciation service unavailable'});} });
module.exports=router;
