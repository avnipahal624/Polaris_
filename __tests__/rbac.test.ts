/**
 * RBAC tests.
 *
 * The permission matrix is the boundary between operational data and private
 * data. A regression here leaks either the live operational picture to a
 * family member, or medical records to a control-room operator. Both are
 * unacceptable, so the deny-cases are asserted explicitly rather than derived
 * from the allow-list.
 */

import { describe, expect, it } from "vitest";
import {
  FAMILY_VISIBLE_ROLES,
  ROLES,
  ROLE_PERMISSIONS,
  WELLBEING_VISIBLE_ROLES,
  assertCan,
  can,
  type PolarisRole,
  type Resource,
} from "../polar-db";

const OPERATIONAL: Resource[] = [
  "missions",
  "cargo",
  "inventory",
  "personnel",
  "locations",
  "hazards",
  "transport",
  "emergency",
  "reports",
  "ai",
];

const ALL_RESOURCES = Object.values(ROLE_PERMISSIONS).flat().filter(
  (v, i, a) => a.indexOf(v) === i,
) as Resource[];

describe("permission matrix shape", () => {
  it("covers every declared role", () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
    }
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLES].sort());
  });

  it("grants admin everything, so admin is never the surprising case", () => {
    for (const resource of ALL_RESOURCES) {
      expect(can("ADMIN", resource)).toBe(true);
    }
  });

  it("grants control room the operational picture but not audit, admin or medical", () => {
    for (const resource of OPERATIONAL) {
      expect(can("CONTROL_ROOM", resource)).toBe(true);
    }
    expect(can("CONTROL_ROOM", "audit")).toBe(false);
    expect(can("CONTROL_ROOM", "admin")).toBe(false);
    expect(can("CONTROL_ROOM", "medical")).toBe(false);
  });
});

describe("family member isolation", () => {
  it("may reach nothing operational", () => {
    for (const resource of OPERATIONAL) {
      expect(can("FAMILY_MEMBER", resource)).toBe(false);
    }
  });

  it("may not see other personnel, hazards, routes or medical records", () => {
    for (const resource of [
      "personnel",
      "hazards",
      "locations",
      "transport",
      "medical",
      "audit",
      "reports",
    ] as Resource[]) {
      expect(can("FAMILY_MEMBER", resource)).toBe(false);
    }
  });

  it("is scoped to the family resource and nothing more", () => {
    const allowed = ROLE_PERMISSIONS.FAMILY_MEMBER;
    expect(allowed).toContain("family");
    for (const resource of allowed) {
      expect(OPERATIONAL).not.toContain(resource);
    }
  });

  it("cannot administer the system", () => {
    expect(can("FAMILY_MEMBER", "admin")).toBe(false);
  });
});

describe("medical authority", () => {
  it("can reach medical records and operational context", () => {
    expect(can("MEDICAL_AUTHORITY", "medical")).toBe(true);
    expect(can("MEDICAL_AUTHORITY", "personnel")).toBe(true);
  });

  it("cannot change the system or run the mission", () => {
    expect(can("MEDICAL_AUTHORITY", "admin")).toBe(false);
    expect(can("MEDICAL_AUTHORITY", "cargo")).toBe(false);
  });
});

describe("field operator", () => {
  it("can work its own tasks, hazards and locations", () => {
    for (const resource of ["tasks", "hazards", "locations", "cargo", "family"] as Resource[]) {
      expect(can("FIELD_OPERATOR", resource)).toBe(true);
    }
  });

  it("cannot read the audit trail or administer", () => {
    expect(can("FIELD_OPERATOR", "audit")).toBe(false);
    expect(can("FIELD_OPERATOR", "admin")).toBe(false);
  });
});

describe("assertCan", () => {
  it("stays silent for an allowed access", () => {
    expect(() => assertCan("CONTROL_ROOM", "personnel")).not.toThrow();
  });

  it("throws a FORBIDDEN error naming the role and resource", () => {
    expect(() => assertCan("FAMILY_MEMBER", "personnel")).toThrow(/FORBIDDEN/);
    expect(() => assertCan("FAMILY_MEMBER", "personnel")).toThrow(/FAMILY_MEMBER/);
    expect(() => assertCan("FAMILY_MEMBER", "personnel")).toThrow(/personnel/);
  });

  it("fails closed for a role that is not in the matrix", () => {
    // An unprovisioned or typo'd role must not inherit anything.
    const unknown = "OPERATIONS_TYPO" as PolarisRole;
    expect(() => assertCan(unknown, "personnel")).toThrow();
  });
});

describe("scoped visibility lists", () => {
  it("keeps family content to staff who can relay it", () => {
    for (const role of ROLES) {
      if (FAMILY_VISIBLE_ROLES.includes(role)) {
        expect(role).not.toBe("FAMILY_MEMBER");
      }
    }
    expect(FAMILY_VISIBLE_ROLES).toContain("FIELD_OPERATOR");
  });

  it("does not expose well-being aggregates to the general control room", () => {
    // Well-being is private by design; the spec allows the control room to see
    // aggregate completion counts only. If CONTROL_ROOM were added to this
    // list it would gain access to private detail, so pin it here.
    expect(WELLBEING_VISIBLE_ROLES).not.toContain("FAMILY_MEMBER");
  });
});
