import { MongoClient, type Db } from "mongodb";
import { env } from "./env.js";

/** Port of server.py's `client = AsyncIOMotorClient(mongo_url); db = client[DB_NAME]`. */
const client = new MongoClient(env.MONGO_URL);
let dbInstance: Db | undefined;

export async function connectDb(): Promise<Db> {
  if (dbInstance) return dbInstance;
  await client.connect();
  dbInstance = client.db(env.DB_NAME);
  return dbInstance;
}

export function getDb(): Db {
  if (!dbInstance) {
    throw new Error("Database not connected yet -- call connectDb() during startup first.");
  }
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  await client.close();
}
