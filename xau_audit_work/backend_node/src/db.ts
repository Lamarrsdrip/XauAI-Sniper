import { MongoClient, type Db } from "mongodb";
import { env } from "./env.js";

/** Port of server.py's `client = AsyncIOMotorClient(mongo_url); db = client[DB_NAME]`. */
const client = new MongoClient(env.MONGO_URL, {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 20000,
});
// MongoDB's Db handle is safe to create before the network connection is
// established. Keeping it available synchronously lets Fastify register all
// routes and start its health-check listener before slow remote startup work.
const dbInstance: Db = client.db(env.DB_NAME);

export async function connectDb(): Promise<Db> {
  await client.connect();
  return dbInstance;
}

export function getDb(): Db {
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  await client.close();
}
