import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db.js";
import { requireCloudUser, rateLimit } from "../../auth.js";

const CategorySchema = z.enum([
  "account",
  "license",
  "payment",
  "installation",
  "trading",
  "technical",
  "education",
  "other",
]);

const CreateTicketSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  category: CategorySchema.default("other"),
  message: z.string().trim().min(2).max(5000),
}).strict();

const ReplySchema = z.object({
  message: z.string().trim().min(2).max(5000),
}).strict();

function cloudUser(request: unknown): Record<string, unknown> {
  return (request as { cloudUser: Record<string, unknown> }).cloudUser;
}

function ticketProjection() {
  return {
    _id: 0,
    customer_private_notes: 0,
    internal_notes: 0,
    provider_payload: 0,
    secret: 0,
  };
}

function safeTicket(row: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(row["messages"]) ? row["messages"] : [];
  return {
    id: String(row["id"] ?? ""),
    subject: String(row["subject"] ?? ""),
    category: String(row["category"] ?? "other"),
    priority: String(row["priority"] ?? "normal"),
    status: String(row["status"] ?? "open"),
    created_at: row["created_at"] ?? null,
    updated_at: row["updated_at"] ?? null,
    assigned_admin: row["assigned_admin"] ?? row["assigned_to"] ?? null,
    messages: messages.map((m) => {
      const msg = (m ?? {}) as Record<string, unknown>;
      return {
        id: String(msg["id"] ?? ""),
        author_type: String(msg["author_type"] ?? "support"),
        body: String(msg["body"] ?? "").slice(0, 5000),
        created_at: msg["created_at"] ?? null,
      };
    }),
  };
}

/**
 * Customer-facing Command Center support routes.
 *
 * These routes intentionally use the same `support_tickets` collection used by
 * the GPT Admin support tooling, so a ticket created by a customer is
 * immediately visible to the controlled admin assistant. No GPT credential is
 * exposed to the customer app.
 */
export async function registerCloudSupportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/cloud/support/tickets", { preHandler: requireCloudUser }, async (request) => {
    const user = cloudUser(request);
    const userId = String(user["id"] ?? "");
    const email = String(user["email"] ?? "").toLowerCase();

    const rows = await getDb()
      .collection("support_tickets")
      .find(
        { $or: [{ customer_user_id: userId }, { customer_email: email }] },
        { projection: ticketProjection() },
      )
      .sort({ updated_at: -1 })
      .limit(50)
      .toArray();

    return { tickets: rows.map((r) => safeTicket(r as Record<string, unknown>)) };
  });

  app.get("/cloud/support/tickets/:id", { preHandler: requireCloudUser }, async (request, reply) => {
    const user = cloudUser(request);
    const params = z.object({ id: z.string().min(1).max(160) }).parse(request.params);
    const userId = String(user["id"] ?? "");
    const email = String(user["email"] ?? "").toLowerCase();

    const row = await getDb().collection("support_tickets").findOne(
      {
        id: params.id,
        $or: [{ customer_user_id: userId }, { customer_email: email }],
      },
      { projection: ticketProjection() },
    );

    if (!row) return reply.code(404).send({ detail: "Support ticket not found." });
    return { ticket: safeTicket(row as Record<string, unknown>) };
  });

  app.post("/cloud/support/tickets", { preHandler: requireCloudUser }, async (request, reply) => {
    const user = cloudUser(request);
    const body = CreateTicketSchema.parse(request.body);
    const userId = String(user["id"] ?? "");
    const email = String(user["email"] ?? "").toLowerCase();
    const name = String(user["full_name"] ?? user["name"] ?? "").trim();

    rateLimit(`support_create:${userId}`, 8, 600);

    const now = new Date().toISOString();
    const ticketId = `support-${randomUUID()}`;
    const messageId = `msg-${randomUUID()}`;
    const doc = {
      id: ticketId,
      customer_user_id: userId,
      customer_name: name,
      customer_email: email,
      subject: body.subject,
      category: body.category,
      priority: "normal",
      status: "open",
      created_at: now,
      updated_at: now,
      assigned_admin: null,
      assigned_team: "support",
      source: "command_center",
      messages: [
        {
          id: messageId,
          author_type: "customer",
          body: body.message,
          created_at: now,
        },
      ],
      related_order_ids: [],
      related_license_ids: [],
      related_email_delivery_ids: [],
      metadata: {
        source: "command_center",
      },
    };

    await getDb().collection("support_tickets").insertOne(doc);
    await getDb().collection("support_ticket_events").insertOne({
      id: `support-event-${randomUUID()}`,
      ticket_id: ticketId,
      customer_user_id: userId,
      event: "ticket_created",
      at: now,
    });

    return reply.code(201).send({ ok: true, ticket: safeTicket(doc) });
  });

  app.post("/cloud/support/tickets/:id/reply", { preHandler: requireCloudUser }, async (request, reply) => {
    const user = cloudUser(request);
    const params = z.object({ id: z.string().min(1).max(160) }).parse(request.params);
    const body = ReplySchema.parse(request.body);
    const userId = String(user["id"] ?? "");
    const email = String(user["email"] ?? "").toLowerCase();

    rateLimit(`support_reply:${userId}`, 20, 600);

    const existing = await getDb().collection("support_tickets").findOne({
      id: params.id,
      $or: [{ customer_user_id: userId }, { customer_email: email }],
    });
    if (!existing) return reply.code(404).send({ detail: "Support ticket not found." });

    const now = new Date().toISOString();
    const message = {
      id: `msg-${randomUUID()}`,
      author_type: "customer",
      body: body.message,
      created_at: now,
    };

    await getDb().collection("support_tickets").updateOne(
      { id: params.id },
      {
        $set: {
          messages: [
            ...(Array.isArray(existing["messages"]) ? existing["messages"] : []),
            message,
          ],
          status: "open",
          updated_at: now,
        },
      },
    );

    await getDb().collection("support_ticket_events").insertOne({
      id: `support-event-${randomUUID()}`,
      ticket_id: params.id,
      customer_user_id: userId,
      event: "customer_reply",
      at: now,
    });

    const updated = await getDb().collection("support_tickets").findOne(
      { id: params.id },
      { projection: ticketProjection() },
    );
    return { ok: true, ticket: safeTicket((updated ?? existing) as Record<string, unknown>) };
  });
}
