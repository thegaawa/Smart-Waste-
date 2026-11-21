import { normalizePhone } from "@smart-waste/shared";
import { z } from "zod";

/** A string field whose "missing" error names the field, e.g. "Password is required". */
export function requiredString(label: string): z.ZodString {
  return z.string({
    error: (issue) => (issue.input === undefined ? `${label} is required` : `${label} must be text`),
  });
}

export const nameSchema = requiredString("Name").trim().min(2, "Name must be at least 2 characters").max(80);

// Trim and lower-case first, then check the format, so " Name@Example.com " is accepted.
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email address is too long")
  .pipe(z.email("Enter a valid email address"));

export const phoneSchema = z
  .string()
  .trim()
  .min(7, "Enter a valid phone number")
  .max(20, "Enter a valid phone number")
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (normalized === null) {
      ctx.addIssue({ code: "custom", message: "Enter a valid phone number, e.g. 0803 123 4567" });
      return z.NEVER;
    }
    return normalized;
  });

export const passwordSchema = requiredString("Password")
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters");

/** POST /auth/register — citizens only; staff accounts are created by an admin. */
export const registerSchema = z
  .object({
    name: nameSchema,
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema,
  })
  .superRefine((data, ctx) => {
    if (!data.email && !data.phone) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "Enter an email address or a phone number" });
    }
  });

export type RegisterInput = z.infer<typeof registerSchema>;

/** POST /auth/login — identifier is an email address or a phone number. */
export const loginSchema = z.object({
  identifier: requiredString("Email or phone").trim().min(3, "Enter your email or phone number").max(254),
  password: requiredString("Password").min(1, "Enter your password").max(72),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: requiredString("Refresh token").min(20, "Refresh token is invalid"),
});

export type RefreshInput = z.infer<typeof refreshSchema>;
