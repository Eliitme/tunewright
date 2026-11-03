import { describe, expect, it } from "vitest";
import { computeBiquad } from "../biquad-coefficients.ts";
import { chainResponseDb, maxBoostDb } from "../frequency-response.ts";
import { quantizeQ30, decodeQ30 } from "../q30-fixed-point.ts";
import { roundHalfAwayFromZero, toScaledInt } from "../wire-rounding.ts";
import { parseBandResponse, parseFilterModeResponse, parseVersionResponse } from "../walkplay-response-parsers.ts";
import { buildBandWritePacket, buildPreampWritePacket } from "../walkplay-packet-builders.ts";
import { BAND_PACKET_LENGTH } from "../walkplay-wire-constants.ts";

describe("wire rounding", () => {
  it("rounds ties away from zero", () => {
    expect([2.5, -2.5, -0.5, 1.49].map(roundHalfAwayFromZero)).toEqual([3, -3, -1, 1]);
  });
  it("rejects non-finite and out-of-range values", () => {
    expect(() => roundHalfAwayFromZero(NaN)).toThrow(RangeError);
    expect(() => toScaledInt(200, 1, -128, 127, "Preamp")).toThrow(/Preamp/);
  });
});

describe("Q30", () => {
  it("round-trips and rejects ±2.0", () => {
    expect(decodeQ30(quantizeQ30(1.5))).toBeCloseTo(1.5, 9);
    expect(() => quantizeQ30(2)).toThrow(RangeError);
    expect(() => quantizeQ30(-2)).toThrow(RangeError);
  });
});

describe("biquad", () => {
  it("a 0 dB peak is the identity filter", () => {
    const c = computeBiquad({ type: "PK", freq: 1000, q: 1, gain: 0 }, 96000);
    expect(c.b0).toBeCloseTo(1, 12);
    expect(c.b1).toBeCloseTo(c.a1, 12);
    expect(c.b2).toBeCloseTo(c.a2, 12);
  });
  it.each(["PK", "LSQ", "HSQ"] as const)("%s reaches its gain where expected", (type) => {
    const freq = type === "PK" ? 1000 : type === "LSQ" ? 30 : 18000;
    const [db] = chainResponseDb([{ type, freq: type === "PK" ? 1000 : type === "LSQ" ? 200 : 4000, q: 0.71, gain: 6 }], 0, 96000, [freq]);
    expect(db).toBeCloseTo(6, 0);
  });
  it("LP/HP attenuate the stop band", () => {
    expect(chainResponseDb([{ type: "LP", freq: 1000, q: 0.71, gain: 0 }], 0, 96000, [10000])[0]).toBeLessThan(-30);
    expect(chainResponseDb([{ type: "HP", freq: 1000, q: 0.71, gain: 0 }], 0, 96000, [100])[0]).toBeLessThan(-30);
  });
  it("rejects invalid frequency and Q", () => {
    expect(() => computeBiquad({ type: "PK", freq: 0, q: 1, gain: 0 }, 96000)).toThrow();
    expect(() => computeBiquad({ type: "PK", freq: 100, q: -1, gain: 0 }, 96000)).toThrow();
  });
  it("max boost stacks overlapping bands", () => {
    const boost = maxBoostDb(
      [{ type: "LSQ", freq: 100, q: 0.7, gain: 10 }, { type: "PK", freq: 50, q: 0.7, gain: 10 }],
      96000,
    );
    expect(boost).toBeGreaterThan(15);
  });
});

describe("packets and parsers", () => {
  it("unencodable coefficients fall back to identity while metadata is kept", () => {
    const p = buildBandWritePacket(0, { type: "HSQ", freq: 1000, q: 0.7, gain: 3 }, 96000);
    const flat = buildBandWritePacket(0, { type: "PK", freq: 1000, q: 1, gain: 0 }, 96000);
    expect([...p.subarray(7, 27)]).toEqual([...flat.subarray(7, 27)]);
    expect(p[33]).toBe(3);
    expect(new DataView(p.buffer).getInt16(31, true)).toBe(3 * 256);
  });
  it("band packets are 37 bytes and preamp is signed", () => {
    expect(buildBandWritePacket(0, { type: "PK", freq: 1000, q: 1, gain: 1 }, 96000)).toHaveLength(BAND_PACKET_LENGTH);
    expect([...buildPreampWritePacket(-7)]).toEqual([1, 3, 2, 0, 249]);
  });
  it("erased slots fall back to a flat default instead of garbage", () => {
    const erased = new Uint8Array(63);
    erased.set([0x80, 0x09, 0, 0, 4]);
    expect(parseBandResponse(erased)).toMatchObject({ index: 4, valid: false, gain: 0, type: "PK", freq: 500 });
  });
  it("ignores unrelated responses", () => {
    expect(parseBandResponse(Uint8Array.of(0x80, 0x03, 0))).toBeNull();
    expect(parseVersionResponse(Uint8Array.of(0x80, 0x09, 0))).toBeNull();
    expect(parseFilterModeResponse(Uint8Array.of(0x80, 0x11, 1, 5))).toBe("NON-OS");
  });
});
