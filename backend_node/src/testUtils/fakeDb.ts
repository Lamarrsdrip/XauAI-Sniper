import { MongoServerError } from "mongodb";

/** Shared lightweight in-memory Mongo-collection fake for vitest, reused across this codebase's route/service tests (see journal.test.ts, xTradePosting.test.ts). Not a real Mongo -- just enough operator support for the queries this backend actually issues. */
type Doc = Record<string, unknown>;

function get(doc: Doc, path: string): unknown {
  return path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Doc)[k] : undefined), doc);
}

function matchesClause(doc: Doc, key: string, expected: unknown): boolean {
  const actual = get(doc, key);
  if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
    const ops = expected as Doc;
    if ("$ne" in ops) return actual !== ops["$ne"];
    if ("$in" in ops) return (ops["$in"] as unknown[]).includes(actual);
    if ("$exists" in ops) return ops["$exists"] ? actual !== undefined : actual === undefined;
    if ("$gt" in ops) return compareLoose(actual, ops["$gt"]) > 0;
    if ("$gte" in ops) return compareLoose(actual, ops["$gte"]) >= 0;
    if ("$lt" in ops) return compareLoose(actual, ops["$lt"]) < 0;
    if ("$lte" in ops) return compareLoose(actual, ops["$lte"]) <= 0;
  }
  return actual === expected;
}

function compareLoose(a: unknown, b: unknown): number {
  const an = typeof a === "string" ? a : Number(a);
  const bn = typeof b === "string" ? b : Number(b);
  return an < bn ? -1 : an > bn ? 1 : 0;
}

function matches(doc: Doc, query: Doc): boolean {
  const { $or, ...rest } = query as { $or?: Doc[] } & Doc;
  if (!Object.entries(rest).every(([k, v]) => matchesClause(doc, k, v))) return false;
  if ($or) return $or.some((clause) => matches(doc, clause));
  return true;
}

export class FakeCollection {
  docs: Doc[] = [];
  uniqueKeys: string[] = [];

  private checkUnique(doc: Doc, excluding?: Doc): void {
    for (const key of this.uniqueKeys) {
      const value = get(doc, key);
      if (value === undefined || value === null || value === "") continue;
      if (this.docs.some((d) => d !== excluding && get(d, key) === value)) {
        throw Object.assign(new MongoServerError({ message: "duplicate key" }), { code: 11000 });
      }
    }
  }

  async findOne(query: Doc = {}, options: { sort?: Record<string, 1 | -1> } = {}): Promise<Doc | null> {
    let rows = this.docs.filter((d) => matches(d, query));
    const entry = options.sort ? Object.entries(options.sort)[0] : undefined;
    if (entry) {
      const [key, dir] = entry;
      rows = [...rows].sort((a, b) => compareLoose(get(a, key), get(b, key)) * dir);
    }
    return rows[0] ? structuredClone(rows[0]) : null;
  }

  find(query: Doc = {}) {
    let rows = this.docs.filter((d) => matches(d, query));
    const cursor = {
      sort: (spec: Record<string, 1 | -1>) => {
        const entry = Object.entries(spec)[0];
        if (entry) {
          const [key, dir] = entry;
          rows = [...rows].sort((a, b) => compareLoose(get(a, key), get(b, key)) * dir);
        }
        return cursor;
      },
      limit: (n: number) => { rows = rows.slice(0, n); return cursor; },
      toArray: async () => structuredClone(rows),
    };
    return cursor;
  }

  async insertOne(doc: Doc): Promise<{ acknowledged: true; insertedId: string }> {
    this.checkUnique(doc);
    this.docs.push(structuredClone(doc));
    return { acknowledged: true, insertedId: String(doc["id"] ?? this.docs.length) };
  }

  private applyAddToSet(target: Doc, addToSet: Doc): void {
    for (const [k, v] of Object.entries(addToSet)) {
      const arr = (target[k] as unknown[] | undefined) ?? (target[k] = []);
      if (!arr.includes(v)) arr.push(v);
    }
  }

  private applyPull(target: Doc, pull: Doc): void {
    for (const [k, v] of Object.entries(pull)) {
      if (Array.isArray(target[k])) target[k] = (target[k] as unknown[]).filter((item) => item !== v);
    }
  }

  async updateOne(query: Doc, update: { $set?: Doc; $setOnInsert?: Doc; $addToSet?: Doc; $pull?: Doc }, options: { upsert?: boolean } = {}) {
    const found = this.docs.find((d) => matches(d, query));
    if (found) {
      Object.assign(found, structuredClone(update.$set ?? {}));
      if (update.$addToSet) this.applyAddToSet(found, structuredClone(update.$addToSet));
      if (update.$pull) this.applyPull(found, structuredClone(update.$pull));
      return { matchedCount: 1, upsertedCount: 0, modifiedCount: 1 };
    }
    if (options.upsert) {
      const { $or, ...rest } = query as { $or?: Doc[] } & Doc;
      const created = { ...structuredClone(rest), ...structuredClone(update.$set ?? {}), ...structuredClone(update.$setOnInsert ?? {}) };
      if (update.$addToSet) this.applyAddToSet(created, structuredClone(update.$addToSet));
      this.checkUnique(created);
      this.docs.push(created);
      return { matchedCount: 0, upsertedCount: 1, modifiedCount: 0 };
    }
    return { matchedCount: 0, upsertedCount: 0, modifiedCount: 0 };
  }

  async findOneAndUpdate(query: Doc, update: { $set?: Doc }) {
    const found = this.docs.find((d) => matches(d, query));
    if (!found) return null;
    Object.assign(found, structuredClone(update.$set ?? {}));
    return structuredClone(found);
  }

  async countDocuments(query: Doc = {}): Promise<number> {
    return this.docs.filter((d) => matches(d, query)).length;
  }

  async createIndex(): Promise<string> { return "fake_index"; }
}

export class FakeDb {
  private map = new Map<string, FakeCollection>();
  /** Register which fields must be unique on a collection, to simulate the real unique-index duplicate-key errors this codebase's services catch by MongoServerError code 11000. */
  uniqueIndexes: Record<string, string[]> = {};

  collection(name: string): FakeCollection {
    if (!this.map.has(name)) {
      const c = new FakeCollection();
      c.uniqueKeys = this.uniqueIndexes[name] ?? [];
      this.map.set(name, c);
    }
    return this.map.get(name)!;
  }
}
