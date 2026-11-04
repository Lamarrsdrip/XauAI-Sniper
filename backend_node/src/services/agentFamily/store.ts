import { getDb } from "../../db.js";
import type { CommerceOrder } from "./orderEngine.js";

const COLLECTION = "agent_family_orders";

export async function ensureAgentFamilyOrderIndexes(): Promise<void> {
  const col = getDb().collection(COLLECTION);
  await col.createIndex({ marketplaceOrderId: 1 }, { unique: true });
  await col.createIndex({ status: 1, updatedAt: -1 });
  await col.createIndex({ mode: 1, status: 1 });
}

export async function findOrder(marketplaceOrderId: string): Promise<CommerceOrder | null> {
  const doc = await getDb().collection(COLLECTION).findOne({ marketplaceOrderId }, { projection: { _id: 0 } });
  return doc ? doc as unknown as CommerceOrder : null;
}

export async function listOrders(limit = 200): Promise<CommerceOrder[]> {
  const rows = await getDb().collection(COLLECTION).find({}, { projection: { _id: 0 }, sort: { updatedAt: -1 }, limit }).toArray();
  return rows as unknown as CommerceOrder[];
}

/** Insert-or-compare. A repeated marketplace id returns the stored row and does not reset it. */
export async function insertOrderIfAbsent(order: CommerceOrder): Promise<CommerceOrder> {
  try {
    await getDb().collection(COLLECTION).insertOne({ ...order });
    return order;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: number }).code === 11000) {
      const existing = await findOrder(order.marketplaceOrderId);
      if (existing) return existing;
    }
    throw error;
  }
}

export async function saveOrder(previousVersion: number, order: CommerceOrder): Promise<boolean> {
  const next = { ...order, version: previousVersion + 1 };
  const result = await getDb().collection(COLLECTION).updateOne(
    { marketplaceOrderId: order.marketplaceOrderId, version: previousVersion },
    { $set: next },
  );
  return result.matchedCount === 1;
}
