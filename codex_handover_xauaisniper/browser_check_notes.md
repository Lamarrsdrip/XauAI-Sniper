# Browser Check Notes

- Local backend: isolated uvicorn on `127.0.0.1:8001` with local Mongo and explicit credentialed CORS origin.
- Local frontend: CRA development server on `127.0.0.1:3001`.
- Homepage desktop: loaded; first-party empty performance showed zero/insufficient; unavailable gold quote did not render a fake price.
- Customer signup: succeeded after correct CORS configuration. Dashboard truthfully showed Offline/No heartbeat/empty metrics.
- Customer auth proof: `localStorageKeys=[]`, `document.cookie=''` (HttpOnly session), dashboard authorized.
- Admin login: succeeded. Dashboard, Licenses, Bot Ops, Notifications, Settings, EA Config and Payments inspected.
- Admin auth proof: `localStorageKeys=[]`, `document.cookie=''`.
- Notifications: truthfully showed OneSignal NOT_CONFIGURED, zero devices and no deliverability.
- Mobile homepage 390x844: initial overflow 396px vs 384px; responsive metric/clipping repair rechecked at 384px/384px with no overflow.
- Mobile Command Center landing: 384px/384px with no overflow; illustrative preview label present; fake balance, fake bonus and fake online status absent.
- Console: base service-worker registration failed when the optional OneSignal worker import failed. `try/catch importScripts` repair staged; rerun pending.
- Marketing defects found and staged: fake live preview account/confidence, unverified bonus/official-partner/universal funded claims, fictional admin weekly-target configurator.
- Not yet inspected end-to-end: customer Trading/Analytics/Activity/Settings/Outlook/Download, admin MFA, remote command lifecycle, real push receipt.
