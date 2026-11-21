import { describe, expect, it } from "vitest";

import {
  ALL_REPORT_STATUSES,
  canTransition,
  isTerminalStatus,
  nextStatusesFor,
  REPORT_TRANSITIONS,
  ReportStatus,
} from "./reports.js";
import { Role } from "./roles.js";

describe("report status transitions", () => {
  it("lets an admin validate or reject a new report", () => {
    expect(canTransition("NEW", "VALIDATED", Role.ADMIN)).toBe(true);
    expect(canTransition("NEW", "REJECTED", Role.ADMIN)).toBe(true);
  });

  it("never lets a citizen change a status", () => {
    for (const from of ALL_REPORT_STATUSES) {
      for (const to of ALL_REPORT_STATUSES) {
        expect(canTransition(from, to, Role.CITIZEN)).toBe(false);
      }
    }
  });

  it("only lets a field officer move assigned work forward", () => {
    expect(nextStatusesFor("ASSIGNED", Role.FIELD)).toEqual(["IN_PROGRESS"]);
    expect(nextStatusesFor("IN_PROGRESS", Role.FIELD)).toEqual(["RESOLVED"]);
    expect(nextStatusesFor("NEW", Role.FIELD)).toEqual([]);
    expect(nextStatusesFor("RESOLVED", Role.FIELD)).toEqual([]);
  });

  it("does not allow skipping validation before assignment", () => {
    expect(canTransition("NEW", "ASSIGNED", Role.ADMIN)).toBe(false);
  });

  it("lets only an admin close or reopen a resolved report", () => {
    expect(nextStatusesFor("RESOLVED", Role.ADMIN).sort()).toEqual(["CLOSED", "IN_PROGRESS"]);
  });

  it("has no way out of terminal statuses", () => {
    for (const status of [ReportStatus.CLOSED, ReportStatus.REJECTED]) {
      expect(isTerminalStatus(status)).toBe(true);
      expect(Object.keys(REPORT_TRANSITIONS[status])).toEqual([]);
    }
    expect(isTerminalStatus(ReportStatus.RESOLVED)).toBe(false);
  });

  it("defines a row for every status", () => {
    expect(Object.keys(REPORT_TRANSITIONS).sort()).toEqual([...ALL_REPORT_STATUSES].sort());
  });
});
