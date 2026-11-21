import { describe, expect, it } from "vitest";

import { classifyIdentifier, normalizeEmail, normalizePhone } from "./phone.js";

describe("normalizePhone", () => {
  it("converts local Nigerian numbers to E.164", () => {
    expect(normalizePhone("08031234567")).toBe("+2348031234567");
    expect(normalizePhone("0803 123 4567")).toBe("+2348031234567");
    expect(normalizePhone("0703-123-4567")).toBe("+2347031234567");
    expect(normalizePhone("09012345678")).toBe("+2349012345678");
  });

  it("accepts numbers that already carry the country code", () => {
    expect(normalizePhone("2348031234567")).toBe("+2348031234567");
    expect(normalizePhone("+234 803 123 4567")).toBe("+2348031234567");
    expect(normalizePhone("00234 803 123 4567")).toBe("+2348031234567");
  });

  it("accepts other international numbers in E.164 form", () => {
    expect(normalizePhone("+447700900123")).toBe("+447700900123");
  });

  it("rejects numbers that are too short, too long or not Nigerian mobile", () => {
    expect(normalizePhone("0803123")).toBeNull();
    expect(normalizePhone("080312345678")).toBeNull();
    expect(normalizePhone("01234567890")).toBeNull(); // Lagos landline prefix, not mobile
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("+0123456789")).toBeNull();
  });
});

describe("classifyIdentifier", () => {
  it("detects and normalises emails", () => {
    expect(classifyIdentifier("  Gaawadomale@Gmail.com ")).toEqual({
      kind: "email",
      value: "gaawadomale@gmail.com",
    });
  });

  it("detects and normalises phones", () => {
    expect(classifyIdentifier("0803 123 4567")).toEqual({ kind: "phone", value: "+2348031234567" });
  });

  it("returns null for junk", () => {
    expect(classifyIdentifier("not-an-identifier")).toBeNull();
    expect(classifyIdentifier("a@b")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lower-cases and trims", () => {
    expect(normalizeEmail(" Person@Example.COM ")).toBe("person@example.com");
  });
});
