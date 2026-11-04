/** Source selection uses the existing XauCloud MT5 heartbeat/evidence network. */
export interface ExistingMt5Source {
  account: string;
  heartbeat_at: string;
  quote_at: string;
  bid: number;
  ask: number;
}
export function selectConnectedMt5Source(
  candidates: ExistingMt5Source[], now = Date.now(),
  limits = {heartbeatMs:90_000,quoteMs:75_000},
): ExistingMt5Source | null {
  const fresh=candidates.filter(x=>{
    const hb=Date.parse(x.heartbeat_at), qt=Date.parse(x.quote_at);
    return /^\d{3,20}$/.test(x.account) && Number.isFinite(hb) && Number.isFinite(qt)
      && hb<=now+5000 && qt<=now+5000 && now-hb>=-5000 && now-qt>=-5000
      && now-hb<=limits.heartbeatMs && now-qt<=limits.quoteMs
      && Number.isFinite(x.bid) && Number.isFinite(x.ask)
      && x.bid>0 && x.ask>=x.bid && x.ask-x.bid<30;
  });
  fresh.sort((a,b)=>Date.parse(b.quote_at)-Date.parse(a.quote_at));
  return fresh[0]??null;
}
