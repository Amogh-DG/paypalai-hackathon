import type {
  Address,
  Mandate,
  PolicyDecision,
  ProposalInput,
  RuleResult,
} from "@leash/shared";
import { dollarsToCents } from "@leash/shared";
import { normalize } from "@leash/shared/normalize";
import { verifyMandate } from "../mandate/signing.js";

function safeNormalize(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return normalize(value);
}

export function evaluate(
  proposal: ProposalInput,
  mandate: Mandate,
  context: { spent: number; now: Date; signingSecret: string },
): PolicyDecision {
  const results: RuleResult[] = [];

  const sigValid = verifyMandate(mandate, context.signingSecret);
  results.push({
    rule: "signature_valid",
    passed: sigValid,
    severity: "block",
    message: sigValid
      ? "Mandate signature is valid"
      : "Mandate signature is invalid",
  });

  const expiresAtTime = new Date(mandate.expiresAt).getTime();
  const notExpired =
    Number.isFinite(expiresAtTime) && context.now.getTime() < expiresAtTime;
  results.push({
    rule: "not_expired",
    passed: notExpired,
    severity: "block",
    message: notExpired ? "Mandate is active" : "Mandate has expired",
  });

  const currencyMatch = proposal.currency === mandate.currency;
  results.push({
    rule: "currency_match",
    passed: currencyMatch,
    severity: "block",
    message: currencyMatch
      ? "Currency matches mandate"
      : `Proposal currency ${proposal.currency} does not match mandate currency ${mandate.currency}`,
  });

  const allowedMerchantsNorm = (mandate.allowedMerchants ?? []).map(safeNormalize);
  const badMerchant = proposal.items.find(
    (item) =>
      typeof item.merchant !== "string" ||
      safeNormalize(item.merchant) === "" ||
      !allowedMerchantsNorm.includes(safeNormalize(item.merchant)),
  );
  const badMerchantName =
    typeof badMerchant?.merchant === "string" ? badMerchant.merchant : "";
  results.push({
    rule: "merchant_allowed",
    passed: !badMerchant,
    severity: "block",
    message: badMerchant
      ? `Merchant "${badMerchantName}" is not in the allowed merchants list`
      : "All merchants are allowed",
  });

  const allowedCategoriesNorm = (mandate.allowedCategories ?? []).map(safeNormalize);
  const badCategory = proposal.items.find(
    (item) =>
      typeof item.category !== "string" ||
      safeNormalize(item.category) === "" ||
      !allowedCategoriesNorm.includes(safeNormalize(item.category)),
  );
  const badCategoryName =
    typeof badCategory?.category === "string" ? badCategory.category : "";
  results.push({
    rule: "category_allowed",
    passed: !badCategory,
    severity: "block",
    message: badCategory
      ? `Category "${badCategoryName}" is not in the allowed categories list`
      : "All categories are allowed",
  });

  const perItemCapCents = dollarsToCents(mandate.perItemCap);
  let perItemCapPassed = true;
  let perItemCapMessage = "All unit prices are within the per-item cap";

  const invalidPriceItem = proposal.items.find(
    (item) =>
      typeof item.unitPrice !== "number" ||
      !Number.isFinite(item.unitPrice) ||
      item.unitPrice <= 0,
  );
  if (invalidPriceItem) {
    perItemCapPassed = false;
    perItemCapMessage = `Item unit price ${invalidPriceItem.unitPrice} is invalid (must be a positive amount).`;
  } else {
    const overCapItem = proposal.items.find(
      (item) => dollarsToCents(item.unitPrice) > perItemCapCents,
    );
    if (overCapItem) {
      perItemCapPassed = false;
      perItemCapMessage = `Item unit price ${overCapItem.unitPrice} exceeds per-item cap of ${mandate.perItemCap}`;
    }
  }
  results.push({
    rule: "per_item_cap",
    passed: perItemCapPassed,
    severity: "block",
    message: perItemCapMessage,
  });

  let maxQtyPassed = true;
  let qtyMessage = "All item quantities are within allowed limits";

  if (!proposal.items || proposal.items.length === 0) {
    maxQtyPassed = false;
    qtyMessage = "Proposal has no items.";
  } else {
    const nonWholeQtyItem = proposal.items.find(
      (item) =>
        typeof item.quantity !== "number" ||
        !Number.isFinite(item.quantity) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1,
    );
    if (nonWholeQtyItem) {
      maxQtyPassed = false;
      if (
        typeof nonWholeQtyItem.quantity === "number" &&
        Number.isInteger(nonWholeQtyItem.quantity) &&
        nonWholeQtyItem.quantity < 1
      ) {
        qtyMessage = `Quantity ${nonWholeQtyItem.quantity} is invalid (must be at least 1 per item).`;
      } else {
        qtyMessage = `Quantity ${nonWholeQtyItem.quantity} is invalid (must be a whole number of at least 1 per item).`;
      }
    } else {
      const overMaxItem = proposal.items.find(
        (item) => item.quantity > mandate.maxQuantityPerItem,
      );
      if (overMaxItem) {
        maxQtyPassed = false;
        qtyMessage = `Quantity ${overMaxItem.quantity} exceeds the maximum of ${mandate.maxQuantityPerItem} per item.`;
      }
    }
  }
  results.push({
    rule: "max_quantity",
    passed: maxQtyPassed,
    severity: "block",
    message: qtyMessage,
  });

  const addressFields: (keyof Address)[] = [
    "name",
    "line1",
    "city",
    "region",
    "postalCode",
    "country",
  ];
  const proposalShipTo = proposal.shipTo as unknown as
    | Record<string, unknown>
    | undefined;
  const mandateShipTo = mandate.shippingAddress as unknown as
    | Record<string, unknown>
    | undefined;

  const hasMissingProposalShipTo =
    !proposalShipTo ||
    addressFields.some(
      (f) =>
        typeof proposalShipTo[f] !== "string" ||
        proposalShipTo[f] === null ||
        proposalShipTo[f] === undefined,
    );

  const hasMissingMandateShipTo =
    !mandateShipTo ||
    addressFields.some(
      (f) =>
        typeof mandateShipTo[f] !== "string" ||
        mandateShipTo[f] === null ||
        mandateShipTo[f] === undefined,
    );

  const shipMatches =
    !hasMissingProposalShipTo &&
    !hasMissingMandateShipTo &&
    addressFields.every(
      (f) =>
        safeNormalize(proposalShipTo[f]) === safeNormalize(mandateShipTo[f]),
    );

  results.push({
    rule: "ship_to_matches",
    passed: shipMatches,
    severity: "block",
    message: shipMatches
      ? "Ship-to address matches mandate address"
      : "Ship-to address differs from the mandate address.",
  });

  const isSpentValid =
    typeof context.spent === "number" &&
    Number.isFinite(context.spent) &&
    context.spent >= 0;

  const hasInvalidItemMoney =
    !proposal.items ||
    proposal.items.some(
      (item) =>
        typeof item.unitPrice !== "number" ||
        !Number.isFinite(item.unitPrice) ||
        item.unitPrice <= 0 ||
        typeof item.quantity !== "number" ||
        !Number.isFinite(item.quantity) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1,
    );

  const canComputeTotal = isSpentValid && !hasInvalidItemMoney;

  let proposalTotalCents = 0;
  if (canComputeTotal) {
    proposalTotalCents = proposal.items.reduce((sum, item) => {
      return sum + dollarsToCents(item.unitPrice) * item.quantity;
    }, 0);
  }

  if (!canComputeTotal) {
    results.push({
      rule: "within_budget",
      passed: false,
      severity: "block",
      message: "Total could not be computed from the proposal.",
    });
    results.push({
      rule: "approval_threshold",
      passed: false,
      severity: "ask",
      message: "Total could not be computed from the proposal.",
    });
  } else {
    const spentCents = dollarsToCents(context.spent);
    const budgetCents = dollarsToCents(mandate.totalBudget);
    const withinBudget = spentCents + proposalTotalCents <= budgetCents;
    results.push({
      rule: "within_budget",
      passed: withinBudget,
      severity: "block",
      message: withinBudget
        ? "Total is within mandate budget"
        : "Total exceeds available mandate budget",
    });

    const thresholdCents = dollarsToCents(mandate.approvalThreshold);
    const underThreshold = proposalTotalCents <= thresholdCents;
    results.push({
      rule: "approval_threshold",
      passed: underThreshold,
      severity: "ask",
      message: underThreshold
        ? "Total is within approval threshold"
        : `Total exceeds approval threshold of ${mandate.approvalThreshold}`,
    });
  }

  const hasBlockFailure = results.some(
    (r) => r.severity === "block" && !r.passed,
  );
  const hasAskFailure = results.some((r) => r.severity === "ask" && !r.passed);

  let decision: "allow" | "ask" | "block" = "allow";
  if (hasBlockFailure) {
    decision = "block";
  } else if (hasAskFailure) {
    decision = "ask";
  }

  return {
    decision,
    results,
    evaluatedAt: context.now.toISOString(),
  };
}
