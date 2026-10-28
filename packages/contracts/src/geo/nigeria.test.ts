import { describe, expect, it } from "vitest";
import { NIGERIAN_STATE_CODES, NIGERIAN_STATES, nigerianStateKey } from "./nigeria.js";

describe("Nigerian states", () => {
  it("lists the 36 states and the FCT once each, with an ISO 3166-2 code each", () => {
    expect(NIGERIAN_STATES).toHaveLength(37);
    expect(new Set(NIGERIAN_STATES).size).toBe(37);
    const codes = NIGERIAN_STATES.map((s) => NIGERIAN_STATE_CODES[s]);
    expect(codes.every((c) => /^NG-[A-Z]{2}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBe(37);
    expect(Object.keys(NIGERIAN_STATE_CODES).sort()).toEqual([...NIGERIAN_STATES].sort());
    expect(NIGERIAN_STATE_CODES.Lagos).toBe("NG-LA");
    expect(NIGERIAN_STATE_CODES["Federal Capital Territory"]).toBe("NG-FC");
    expect(nigerianStateKey("Akwa Ibom")).toBe("akwa ibom");
  });
});
