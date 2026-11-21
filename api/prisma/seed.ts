/**
 * Seed data: waste categories and the first administrator.
 *
 *   npm run db:seed
 *
 * Safe to run more than once (uses upserts). In development it also creates a
 * demo citizen and a demo field officer so the whole flow can be tried at once.
 */
import { Priority, Role } from "@smart-waste/shared";

import { createPrismaClient } from "../src/db.js";
import { env } from "../src/env.js";
import { hashPassword } from "../src/lib/password.js";

const CATEGORIES: { name: string; description: string; defaultPriority: Priority }[] = [
  {
    name: "Illegal dumping",
    description: "Refuse dumped on roadsides, open land, canals or drainage channels.",
    defaultPriority: Priority.HIGH,
  },
  {
    name: "Overflowing bin",
    description: "A public bin or collection point that is full and spilling over.",
    defaultPriority: Priority.MEDIUM,
  },
  {
    name: "Missed collection",
    description: "Scheduled waste collection did not happen.",
    defaultPriority: Priority.LOW,
  },
  {
    name: "Blocked waste point",
    description: "A waste point or drain that is blocked by refuse.",
    defaultPriority: Priority.HIGH,
  },
  {
    name: "Other",
    description: "Any other waste or sanitation problem.",
    defaultPriority: Priority.MEDIUM,
  },
];

const DEFAULT_ADMIN_EMAIL = "admin@smartwaste.local";
const DEFAULT_ADMIN_PASSWORD = "Admin12345!";

interface SeedAccount {
  name: string;
  email: string;
  phone: string | null;
  password: string;
  role: Role;
}

async function main(): Promise<void> {
  const prisma = createPrismaClient(env.DATABASE_URL);
  try {
    for (const category of CATEGORIES) {
      await prisma.category.upsert({
        where: { name: category.name },
        update: { description: category.description, defaultPriority: category.defaultPriority },
        create: category,
      });
    }
    console.log(`[seed] ${CATEGORIES.length} categories ready`);

    const adminEmail = (process.env["SEED_ADMIN_EMAIL"] ?? DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
    const adminPassword = process.env["SEED_ADMIN_PASSWORD"] ?? DEFAULT_ADMIN_PASSWORD;

    if (env.NODE_ENV === "production" && adminPassword === DEFAULT_ADMIN_PASSWORD) {
      throw new Error("Refusing to seed the default administrator password in production. Set SEED_ADMIN_PASSWORD.");
    }

    const accounts: SeedAccount[] = [
      { name: "Smart-Waste Administrator", email: adminEmail, phone: null, password: adminPassword, role: Role.ADMIN },
    ];

    // Demo citizen + field accounts are for local use by default.
    // Set SEED_INCLUDE_DEMO=1 once on the hosted database for the school demo.
    const includeDemo =
      env.NODE_ENV !== "production" || process.env["SEED_INCLUDE_DEMO"] === "1";

    if (includeDemo) {
      accounts.push(
        {
          name: "Domale Gaawa",
          email: "citizen@smartwaste.local",
          phone: "+2348030000001",
          password: "Citizen123!",
          role: Role.CITIZEN,
        },
        {
          name: "Team A Field Officer",
          email: "field@smartwaste.local",
          phone: "+2348030000002",
          password: "Field12345!",
          role: Role.FIELD,
        },
      );
    }

    for (const account of accounts) {
      const passwordHash = await hashPassword(account.password);
      await prisma.user.upsert({
        where: { email: account.email },
        update: { name: account.name, role: account.role, passwordHash },
        create: {
          name: account.name,
          email: account.email,
          phone: account.phone,
          role: account.role,
          passwordHash,
        },
      });
      console.log(`[seed] ${account.role.padEnd(7)} ${account.email}`);
    }

    if (includeDemo) {
      console.log("");
      console.log("[seed] Sign-in details:");
      console.log(`[seed]   admin    ${adminEmail} / ${adminPassword}`);
      console.log("[seed]   citizen  citizen@smartwaste.local / Citizen123!");
      console.log("[seed]   field    field@smartwaste.local / Field12345!");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[seed] failed:", error);
  process.exit(1);
});
