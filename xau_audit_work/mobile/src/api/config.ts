// Live XauCloud backend (backend_node, Fastify) — routes are mounted under /api.
// See backend_node/src/index.ts:247 (`{ prefix: "/api" }`).
export const API_BASE_URL = 'https://xaucloud.io/api';

// FALSE = real production XauCloud API (https://xaucloud.io/api). The auth
// token-in-response patch is committed, deployed, and verified end-to-end
// against a real test account (mobile-qa-test@xaucloud.io) — see the QA
// report for the exact curl transcript. Every screen still falls back to
// realistic fixture data (src/state/mockData.ts) ONLY when this is flipped
// true for local design-review work; that is not the shipped state.
export const USE_MOCK_DATA = false;
