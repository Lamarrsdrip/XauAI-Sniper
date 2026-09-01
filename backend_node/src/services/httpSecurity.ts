import type { FastifyReply } from "fastify";

const SENSITIVE_API_PREFIXES = ["/api/admin", "/api/auth", "/api/cloud"];

export function applySecurityHeaders(reply: Pick<FastifyReply, "header">, pathName: string, production: boolean): void {
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "strict-origin-when-cross-origin");
  reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
  reply.header("content-security-policy", "base-uri 'self'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests");
  if (production) reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  if (SENSITIVE_API_PREFIXES.some((prefix) => pathName === prefix || pathName.startsWith(`${prefix}/`))) {
    reply.header("cache-control", "no-store");
  }
}
