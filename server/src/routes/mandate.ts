import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  ERROR_CODES,
  type Mandate,
  type MandateView,
  centsToDollars,
  dollarsToCents,
  hasAtMostTwoDecimals,
} from "@leash/shared";
import { normalize } from "@leash/shared/normalize";
import { newId } from "../ids.js";
import { signMandate } from "../mandate/signing.js";
import { getMandate, saveMandate } from "../mandate/storage.js";
import { getSpent } from "../proposals/spent.js";
import { AppError } from "../http/errors.js";

const ALLOWED_CATEGORIES = new Set([
  "hiking",
  "books",
  "kitchen",
  "electronics",
]);

const addressSchema = z.object({
  name: z
    .string({ required_error: 'Field "shippingAddress.name" is required' })
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, {
      message: 'Field "shippingAddress.name" must not be empty',
    }),
  line1: z
    .string({ required_error: 'Field "shippingAddress.line1" is required' })
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, {
      message: 'Field "shippingAddress.line1" must not be empty',
    }),
  city: z
    .string({ required_error: 'Field "shippingAddress.city" is required' })
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, {
      message: 'Field "shippingAddress.city" must not be empty',
    }),
  region: z
    .string({ required_error: 'Field "shippingAddress.region" is required' })
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, {
      message: 'Field "shippingAddress.region" must not be empty',
    }),
  postalCode: z
    .string({ required_error: 'Field "shippingAddress.postalCode" is required' })
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, {
      message: 'Field "shippingAddress.postalCode" must not be empty',
    }),
  country: z
    .string({ required_error: 'Field "shippingAddress.country" is required' })
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, {
      message: 'Field "shippingAddress.country" must not be empty',
    }),
});

const mandateInputSchema = z.object({
  owner: z
    .string({ required_error: 'Field "owner" is required' })
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, {
      message: 'Field "owner" must not be empty',
    }),
  currency: z.literal("USD", {
    errorMap: () => ({ message: 'Field "currency" must be USD' }),
  }),
  totalBudget: z
    .number({ required_error: 'Field "totalBudget" is required' })
    .refine((n) => Number.isFinite(n) && n > 0 && hasAtMostTwoDecimals(n), {
      message:
        'Field "totalBudget" must be a positive number with at most 2 decimal places',
    }),
  perItemCap: z
    .number({ required_error: 'Field "perItemCap" is required' })
    .refine((n) => Number.isFinite(n) && n > 0 && hasAtMostTwoDecimals(n), {
      message:
        'Field "perItemCap" must be a positive number with at most 2 decimal places',
    }),
  approvalThreshold: z
    .number({ required_error: 'Field "approvalThreshold" is required' })
    .refine((n) => Number.isFinite(n) && n >= 0 && hasAtMostTwoDecimals(n), {
      message:
        'Field "approvalThreshold" must be zero or more with at most 2 decimal places',
    }),
  allowedCategories: z
    .array(z.string(), {
      required_error: 'Field "allowedCategories" is required',
    })
    .min(1, 'Field "allowedCategories" must not be empty')
    .transform((cats) => cats.map((c) => normalize(c)))
    .refine((cats) => cats.every((c) => ALLOWED_CATEGORIES.has(c)), {
      message:
        'Field "allowedCategories" must only contain allowed categories: hiking, books, kitchen, electronics',
    }),
  allowedMerchants: z
    .array(z.string(), {
      required_error: 'Field "allowedMerchants" is required',
    })
    .min(1, 'Field "allowedMerchants" must not be empty')
    .transform((merchants) => merchants.map((m) => m.trim()))
    .refine((merchants) => merchants.every((m) => m.length > 0), {
      message:
        'Field "allowedMerchants" must be an array of non-empty strings',
    }),
  maxQuantityPerItem: z
    .number({ required_error: 'Field "maxQuantityPerItem" is required' })
    .refine((n) => Number.isInteger(n) && n >= 1, {
      message:
        'Field "maxQuantityPerItem" must be a whole number of at least 1',
    }),
  shippingAddress: addressSchema,
  expiresAt: z
    .string({ required_error: 'Field "expiresAt" is required' })
    .refine(
      (s) => {
        const time = new Date(s).getTime();
        return Number.isFinite(time) && time > Date.now();
      },
      {
        message: 'Field "expiresAt" must be a valid future ISO 8601 string',
      },
    ),
});

export function createMandateRouter(
  db: DatabaseType,
  signingSecret?: string,
): Router {
  const router = Router();

  router.post(
    "/api/mandate",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const validated = mandateInputSchema.parse(req.body);

        if (!signingSecret) {
          throw new AppError(
            ERROR_CODES.INTERNAL_ERROR,
            "MANDATE_SIGNING_SECRET is not configured",
          );
        }

        const id = newId("mand_");
        const createdAt = new Date().toISOString();

        const unsignedMandate = {
          ...validated,
          id,
          createdAt,
        };

        const signature = signMandate(unsignedMandate, signingSecret);

        const mandate: Mandate = {
          ...unsignedMandate,
          signature,
        };

        saveMandate(db, mandate);

        res.status(201).json(mandate);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    "/api/mandate",
    (_req: Request, res: Response, next: NextFunction) => {
      try {
        const mandate = getMandate(db);
        if (!mandate) {
          throw new AppError(ERROR_CODES.NO_MANDATE, "No mandate found");
        }

        const spent = getSpent(db);
        const remaining = centsToDollars(
          dollarsToCents(mandate.totalBudget) - dollarsToCents(spent),
        );

        const { signature: _sig, ...mandateWithoutSig } = mandate;
        const view: MandateView = {
          ...mandateWithoutSig,
          spent,
          remaining,
        };

        res.json(view);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

export const mandateRouter = Router();
mandateRouter.post("/api/mandate", (_req: Request, res: Response) => {
  res.status(501).json({
    error: {
      code: "not_implemented",
      message: "Not implemented",
    },
  });
});

mandateRouter.get("/api/mandate", (_req: Request, res: Response) => {
  res.status(501).json({
    error: {
      code: "not_implemented",
      message: "Not implemented",
    },
  });
});
