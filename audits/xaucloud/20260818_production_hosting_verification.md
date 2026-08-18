# Production hosting verification — 18 August 2026

## Verified production path

`xaucloud.io` is served by a **Hostinger Web App**, not Emergent or Vercel.
The app is connected to GitHub repository `XauAI-Sniper`, deploys the `main`
branch from `backend_node`, and uses Fastify on Node 22.x.

## Release evidence

- Commit: `8655c346` — *Rebuild broker-backed manual trading intelligence*
- Hostinger deployment: completed successfully on 18 August 2026
- Auto-deployment: enabled
- Public health probe: `GET https://xaucloud.io/health` returned
  `{"status":"ok"}` after deployment
- Public homepage: loaded with the XauCloud production title and Command Center
  route

The running VPS EA is independent of this web deploy and was not changed: the
active binary matches the v6.27.2 release manifest byte-for-byte.
