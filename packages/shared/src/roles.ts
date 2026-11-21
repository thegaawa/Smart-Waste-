/**
 * User roles (Chapter 3.3 of the project document).
 *
 * - CITIZEN: reports waste problems and tracks them.
 * - FIELD:   collection / field officer who receives tasks and updates progress.
 * - ADMIN:   validates, prioritises, assigns and closes reports; manages users and categories.
 */
export const Role = {
  CITIZEN: "CITIZEN",
  FIELD: "FIELD",
  ADMIN: "ADMIN",
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const ALL_ROLES: readonly Role[] = [Role.CITIZEN, Role.FIELD, Role.ADMIN];

export const ROLE_LABELS: Record<Role, string> = {
  CITIZEN: "Citizen",
  FIELD: "Field officer",
  ADMIN: "Administrator",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ALL_ROLES as readonly string[]).includes(value);
}

/** Account status (Users.status in Table 3.3). */
export const UserStatus = {
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
} as const;

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
