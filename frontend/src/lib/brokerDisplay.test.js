import { brokerBrand } from "./brokerDisplay";

describe("customer broker brand normalization", () => {
  test.each([
    ["Exness-MT5Trial9", "Exness"],
    ["Exness-MT5Real12", "Exness"],
    ["Exness-MT5Demo", "Exness"],
    ["Exness-Live03", "Exness"],
    ["ICMarkets-Live03", "ICMarkets"],
    ["Pepperstone-Demo", "Pepperstone"],
    ["Broker_Practice2", "Broker"],
    ["Broker-MT4", "Broker"],
  ])("%s -> %s", (server, expected) => {
    expect(brokerBrand(server)).toBe(expected);
  });
});
