import { describe, expect, it } from "vitest";
import { betaShrinkage, computeBucketedEstimator, lookupBucket } from "./globalBrainEstimator.js";

interface Item {
  bucket: string;
  success: boolean;
  r: number | null;
}

describe("betaShrinkage", () => {
  it("pulls a small-sample bucket strongly toward the global prior", () => {
    // 1 win out of 1 trade (raw rate 1.0) shrunk toward a 0.5 prior with strength 10
    const shrunk = betaShrinkage(1, 1, 0.5, 10);
    expect(shrunk).toBeCloseTo((1 + 0.5 * 10) / (1 + 10), 5);
    expect(shrunk).toBeLessThan(1.0);
    expect(shrunk).toBeGreaterThan(0.5);
  });

  it("converges to the raw rate as sample size grows large relative to prior strength", () => {
    const shrunk = betaShrinkage(800, 1000, 0.5, 10);
    expect(shrunk).toBeCloseTo(0.8, 1);
  });
});

describe("computeBucketedEstimator", () => {
  const items: Item[] = [
    { bucket: "A", success: true, r: 1.0 },
    { bucket: "A", success: true, r: 1.2 },
    { bucket: "A", success: false, r: -1.0 },
    { bucket: "B", success: false, r: -1.0 },
    { bucket: "B", success: false, r: -1.0 },
  ];

  it("computes raw rate, shrunk rate, and avg_r per bucket", () => {
    const result = computeBucketedEstimator(
      items,
      (i) => i.bucket,
      (i) => i.success,
      (i) => i.r,
      { minSample: 2, priorStrength: 10 },
    );
    expect(result.global_n).toBe(5);
    expect(result.global_prior_rate).toBeCloseTo(2 / 5, 5);

    const bucketA = result.buckets.find((b) => b.bucket_key === "A")!;
    expect(bucketA.n).toBe(3);
    expect(bucketA.successes).toBe(2);
    expect(bucketA.raw_rate).toBeCloseTo(2 / 3, 3);
    expect(bucketA.avg_r).toBeCloseTo((1.0 + 1.2 - 1.0) / 3, 5);
    expect(bucketA.sample_sufficient).toBe(true);

    const bucketB = result.buckets.find((b) => b.bucket_key === "B")!;
    expect(bucketB.raw_rate).toBe(0);
    expect(bucketB.sample_sufficient).toBe(true);
  });

  it("marks a bucket below minSample as not sufficient", () => {
    const result = computeBucketedEstimator(
      items,
      (i) => i.bucket,
      (i) => i.success,
      (i) => i.r,
      { minSample: 20 },
    );
    expect(result.buckets.every((b) => !b.sample_sufficient)).toBe(true);
  });

  it("returns an empty result for an empty item list without throwing", () => {
    const result = computeBucketedEstimator(
      [] as Item[],
      (i) => i.bucket,
      (i) => i.success,
      (i) => i.r,
    );
    expect(result.global_n).toBe(0);
    expect(result.buckets).toEqual([]);
  });
});

describe("lookupBucket", () => {
  const result = computeBucketedEstimator(
    [
      { bucket: "SEEN", success: true, r: 1 },
      { bucket: "SEEN", success: true, r: 1 },
    ] as Item[],
    (i) => i.bucket,
    (i) => i.success,
    (i) => i.r,
    { minSample: 1 },
  );

  it("returns the real bucket when it is sample-sufficient", () => {
    const found = lookupBucket(result, "SEEN");
    expect(found.bucket_key).toBe("SEEN");
    expect(found.n).toBe(2);
  });

  it("falls back to the global prior for an unseen bucket key", () => {
    const found = lookupBucket(result, "NEVER_SEEN");
    expect(found.n).toBe(0);
    expect(found.sample_sufficient).toBe(false);
    expect(found.shrunk_rate).toBe(result.global_prior_rate);
  });
});
