import type { FastifyInstance } from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "../db.js";
import { getSettings } from "../services/settings.js";
import { MARKET_EVIDENCE_COLLECTION } from "../services/marketIntelligenceConfig.js";
import { selectConnectedMt5Source, type ExistingMt5Source } from "../services/agentFamilySource.js";

const MAX_ACCOUNTS=12;
function authorized(auth: unknown): boolean {
  const token=(process.env["XAUCLOUD_AGENT_FAMILY_READ_TOKEN"]||"").trim();
  if(token.length<32||!/^Bearer [^\s]+$/.test(String(auth??"")))return false;
  return timingSafeEqual(createHash("sha256").update(String(auth).slice(7)).digest(),
    createHash("sha256").update(token).digest());
}
function approvedSources(settings: Record<string,unknown>): string[] {
  const existing=[settings["subscriber_signal_source_account"],settings["subscriber_signal_backup_source_account"]];
  const extras=String(process.env["XAUCLOUD_AGENT_FAMILY_SOURCE_ACCOUNTS"]||"").split(",");
  // Explicit owner opt-in only. Never enumerate customers' connected accounts.
  return [...new Set([...existing,...extras].map(x=>String(x||"").trim()))]
    .filter(x=>/^\d{3,20}$/.test(x)).slice(0,MAX_ACCOUNTS);
}
function positive(x:unknown):number|null{return typeof x==="number"&&Number.isFinite(x)&&x>0?x:null;}

/** Read-only provider integration. Existing VPS/EA heartbeats are the source of truth.
 * No Remote Desktop, shell, broker credentials, or trading command surface.
 */
export async function registerAgentFamilySourceRoutes(app:FastifyInstance):Promise<void>{
  app.get("/integrations/agent-family/market-snapshot",async(request,reply)=>{
    reply.header("Cache-Control","no-store");
    if(!authorized(request.headers.authorization))return reply.code(401).send({detail:"Unauthorized"});
    const db=getDb(),settings=await getSettings();
    const accounts=approvedSources(settings);
    if(!accounts.length)return reply.code(503).send({status:"UNAVAILABLE",reason:"NO_OWNER_APPROVED_MT5_SOURCES"});
    const heartbeatRows=await db.collection("cloud_bot_heartbeats").find(
      {account_number:{$in:accounts}},
      {projection:{_id:0,account_number:1,ts:1},sort:{ts:-1},limit:200}
    ).toArray();
    const latestHeartbeat=new Map<string,string>();
    for(const h of heartbeatRows){
      const id=String(h["account_number"]??"");
      if(!latestHeartbeat.has(id))latestHeartbeat.set(id,String(h["ts"]??""));
    }
    const evidence=await db.collection(MARKET_EVIDENCE_COLLECTION).find(
      {account:{$in:accounts},normalized_symbol:"XAUUSD",quote_valid:true},
      {projection:{_id:0,account:1,observed_at:1,bid:1,ask:1},
       sort:{observed_at:-1},limit:200}
    ).toArray();
    const latestQuotes=new Map<string,ExistingMt5Source>();
    for(const e of evidence){
      const account=String(e["account"]??"");
      if(latestQuotes.has(account)||!latestHeartbeat.has(account))continue;
      const bid=positive(e["bid"]),ask=positive(e["ask"]);
      if(bid===null||ask===null)continue;
      latestQuotes.set(account,{account,heartbeat_at:latestHeartbeat.get(account)!,
        quote_at:String(e["observed_at"]??""),bid,ask});
    }
    const selected=selectConnectedMt5Source([...latestQuotes.values()]);
    if(!selected)return reply.code(503).send({status:"UNAVAILABLE",reason:"NO_FRESH_APPROVED_BROKER_SOURCE"});
    // The publisher's native signals are attributed to the producing account;
    // never substitute a different terminal's signal after source failover.
    const latest=await db.collection("subscriber_signals").findOne(
      {source_account:selected.account,symbol:{$regex:"^(XAUUSD|GOLD)",$options:"i"}},
      {projection:{_id:0,source_account:1,signal_id:1,engine:1,status:1,direction:1,
        entry:1,stop:1,tp1:1,rationale:1,expires_at:1,updated_at:1},sort:{updated_at:-1}}
    );
    const age=latest?Date.now()-Date.parse(String(latest["updated_at"]??"")):Infinity;
    const signalFresh=latest&&Number.isFinite(age)&&age>=-5000&&age<=90_000?latest:null;
    const direction=String(signalFresh?.["direction"]??"").toUpperCase();
    const validLevels=positive(signalFresh?.["entry"])!==null&&positive(signalFresh?.["stop"])!==null
      && positive(signalFresh?.["tp1"])!==null;
    const actionable=signalFresh?.["status"]==="ACTIONABLE"&&["BUY","SELL"].includes(direction)
      && validLevels&&(!signalFresh["expires_at"]||Date.parse(String(signalFresh["expires_at"]))>Date.now());
    const expiresAt=new Date(Math.min(Date.now()+60_000,Date.parse(selected.quote_at)+75_000)).toISOString();
    if(Date.parse(expiresAt)<=Date.now())return reply.code(503).send({status:"UNAVAILABLE",reason:"SOURCE_EXPIRED"});
    const nativeSignal={
      status:actionable?"ACTIONABLE":"NO_TRADE",
      direction:actionable?direction:"NO_TRADE",
      engine:String(signalFresh?.["engine"]??"XauCloud"),
      signalId:String(signalFresh?.["signal_id"]??"").slice(0,90),
      entry:actionable?positive(signalFresh?.["entry"]):null,
      stop:actionable?positive(signalFresh?.["stop"]):null,
      takeProfit:actionable?positive(signalFresh?.["tp1"]):null,
      rationale:String(signalFresh?.["rationale"]??"No fresh native actionable signal").slice(0,600),
      expiresAt
    };
    // No account IDs, license PINs, customer info, or broker secrets in responses.
    return {schemaVersion:1,sourceKind:"broker",sourceFresh:true,noTradeExecution:true,
      source:"XauCloud owner-approved connected MT5 network",symbol:"XAUUSD",
      asOf:selected.quote_at,quote:{bid:selected.bid,ask:selected.ask,time:selected.quote_at},
      nativeSignal};
  });
}
