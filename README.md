# XauAI Sniper

The active EA version is NOT hardcoded here — it's derived live from the EA
source header by `backend/server.py::_get_ea_meta()` and served at
`/api/download/info` (this file going stale on every release was itself an
audit finding; don't hardcode a version number back into this section).

The platform download endpoints serve `backend/ea_code/XAUUSD_AI_Sniper_EA.mq5`,
which must always be kept byte-identical to the current root-level
`XAUUSD_AI_Sniper_EA_vX.X.X.mq5` (see `RELEASE_CHECKLIST.md` for the release
process — every version bump copies the new source into `backend/ea_code/`).

- Customer download: `/api/download/ea`
- Admin master download: `/api/admin/download/ea-master`
- Live version/edition/filename: `GET /api/download/info`
