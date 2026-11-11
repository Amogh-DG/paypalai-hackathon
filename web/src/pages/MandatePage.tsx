import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import type { MandateInput, MandateView } from "@leash/shared";
import { normalize } from "@leash/shared/normalize";
import { getMandateView, postMandate } from "../api";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { LoadingState } from "../components/LoadingState";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { FormField } from "../components/FormField";
import { TagInput } from "../components/TagInput";
import { ProgressBar } from "../components/ProgressBar";
import { createMandateDefaults } from "../mandateDefaults";

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "10px 12px",
  border: "1px solid var(--color-border-strong)",
  borderRadius: 8,
  background: "var(--color-surface-solid)",
  color: "var(--color-text-primary)",
  font: "inherit",
  colorScheme: "dark",
};
const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
  gap: 18,
};

function messageOf(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : "Unable to load or save the mandate. Please try again.";
}

function localDateTime(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export function MandatePage() {
  const [defaults] = useState(createMandateDefaults);
  const [form, setForm] = useState<MandateInput>(() => ({
    ...defaults,
    shippingAddress: { ...defaults.shippingAddress },
  }));
  const [expiry, setExpiry] = useState(() => localDateTime(defaults.expiresAt));
  const [view, setView] = useState<MandateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const requestId = useRef(0);
  const saving = useRef(false);

  const loadView = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setLoadError(null);
    try {
      const current = await getMandateView();
      if (id === requestId.current) setView(current);
    } catch (error: unknown) {
      if (id !== requestId.current) return;
      setView(null);
      if (!(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "no_mandate"
      ))
        setLoadError(messageOf(error));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadView();
    return () => {
      requestId.current++;
    };
  }, [loadView]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving.current) return;
    setSubmitError(null);
    const merchants = [
      ...new Set(form.allowedMerchants.map(normalize).filter(Boolean)),
    ];
    const categories = [
      ...new Set(form.allowedCategories.map(normalize).filter(Boolean)),
    ];
    const date = new Date(expiry);
    const errors: string[] = [];
    if (!form.owner.trim()) errors.push("Owner is required.");
    for (const [label, value] of [
      ["Total budget", form.totalBudget],
      ["Per-item cap", form.perItemCap],
      ["Approval threshold", form.approvalThreshold],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0)
        errors.push(`${label} must be greater than 0.`);
      else if (Math.abs(value * 100 - Math.round(value * 100)) > 0.000001)
        errors.push(`${label} must have at most two decimal places.`);
    }
    if (
      !Number.isInteger(form.maxQuantityPerItem) ||
      form.maxQuantityPerItem < 1
    )
      errors.push("Maximum quantity must be a whole number of at least 1.");
    if (!categories.length) errors.push("Select at least one category.");
    if (!merchants.length) errors.push("Add at least one merchant.");
    if (Object.values(form.shippingAddress).some((value) => !value.trim()))
      errors.push("Complete every shipping address field.");
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
      errors.push("Expiry must be in the future.");
    if (errors.length) {
      setSubmitError(errors.join(" "));
      return;
    }
    saving.current = true;
    setSubmitting(true);
    try {
      await postMandate({
        ...form,
        allowedCategories: categories,
        allowedMerchants: merchants,
        expiresAt: date.toISOString(),
      });
      window.dispatchEvent(new CustomEvent("mandate-updated"));
      await loadView();
    } catch (error: unknown) {
      setSubmitError(messageOf(error));
    } finally {
      saving.current = false;
      setSubmitting(false);
    }
  };

  const money = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  const numberFields = [
    ["totalBudget", "Total budget"],
    ["perItemCap", "Per-item cap"],
    ["approvalThreshold", "Approval threshold"],
    ["maxQuantityPerItem", "Maximum quantity per item"],
  ] as const;
  const addressFields = [
    ["name", "Name"],
    ["line1", "Street address"],
    ["city", "City"],
    ["region", "Region"],
    ["postalCode", "Postal code"],
    ["country", "Country"],
  ] as const;

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {loading ? (
        <LoadingState label="Loading mandate…" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => void loadView()} />
      ) : view ? (
        <Card>
          <h2>Saved mandate</h2>
          <p>{view.owner}</p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              gap: 12,
              margin: "16px 0",
            }}
          >
            <span>Spent {money(view.spent)}</span>
            <span>Remaining {money(view.remaining)}</span>
          </div>
          <ProgressBar value={view.spent} max={view.totalBudget} />
        </Card>
      ) : (
        <EmptyState message="No mandate is saved yet." />
      )}
      <Card>
        <h2>Mandate</h2>
        <form
          ref={formRef}
          onSubmit={(event) => void submit(event)}
          noValidate
          style={{ display: "grid", gap: 20, marginTop: 20 }}
        >
          {submitError && (
            <div
              role="alert"
              style={{
                padding: 14,
                border: "1px solid var(--color-red)",
                borderRadius: 8,
                color: "var(--color-red)",
                background: "var(--color-red-bg)",
              }}
            >
              {submitError}
            </div>
          )}
          <fieldset
            disabled={submitting}
            style={{
              border: 0,
              padding: 0,
              margin: 0,
              minWidth: 0,
              display: "grid",
              gap: 20,
            }}
          >
            <FormField label="Owner" htmlFor="mandate-owner">
              <input
                id="mandate-owner"
                value={form.owner}
                onChange={(event) =>
                  setForm({ ...form, owner: event.target.value })
                }
                style={inputStyle}
                required
              />
            </FormField>
            <div style={gridStyle}>
              {numberFields.map(([key, label]) => (
                <FormField key={key} label={label} htmlFor={`mandate-${key}`}>
                  <input
                    id={`mandate-${key}`}
                    type="number"
                    step={key === "maxQuantityPerItem" ? 1 : 0.01}
                    min={key === "maxQuantityPerItem" ? 1 : 0.01}
                    value={Number.isNaN(form[key]) ? "" : form[key]}
                    onChange={(event) =>
                      setForm({ ...form, [key]: event.target.valueAsNumber })
                    }
                    style={inputStyle}
                    required
                  />
                </FormField>
              ))}
            </div>
            <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
              <legend style={{ marginBottom: 8 }}>Allowed categories</legend>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {defaults.allowedCategories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={form.allowedCategories.includes(category)}
                    className={`button button--${form.allowedCategories.includes(category) ? "primary" : "secondary"}`}
                    onClick={() =>
                      setForm({
                        ...form,
                        allowedCategories: form.allowedCategories.includes(
                          category,
                        )
                          ? form.allowedCategories.filter(
                              (value) => value !== category,
                            )
                          : [...form.allowedCategories, normalize(category)],
                      })
                    }
                  >
                    {category}
                  </button>
                ))}
              </div>
            </fieldset>
            <FormField label="Allowed merchants" htmlFor="mandate-merchants">
              <TagInput
                id="mandate-merchants"
                value={form.allowedMerchants}
                onChange={(allowedMerchants) =>
                  setForm({ ...form, allowedMerchants })
                }
                normalize={normalize}
                placeholder="Add a merchant with Enter or comma"
              />
            </FormField>
            <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
              <legend style={{ marginBottom: 8 }}>Shipping address</legend>
              <div style={gridStyle}>
                {addressFields.map(([key, label]) => (
                  <FormField
                    key={key}
                    label={label}
                    htmlFor={`shipping-${key}`}
                  >
                    <input
                      id={`shipping-${key}`}
                      value={form.shippingAddress[key]}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          shippingAddress: {
                            ...form.shippingAddress,
                            [key]: event.target.value,
                          },
                        })
                      }
                      style={inputStyle}
                      required
                    />
                  </FormField>
                ))}
              </div>
            </fieldset>
            <FormField label="Expires at (local time)" htmlFor="mandate-expiry">
              <input
                id="mandate-expiry"
                type="datetime-local"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
                style={inputStyle}
                required
              />
            </FormField>
            <div>
              Currency: <strong>{form.currency}</strong>
            </div>
            <div>
              <Button
                disabled={submitting}
                onClick={() => formRef.current?.requestSubmit()}
              >
                Save mandate
              </Button>
            </div>
          </fieldset>
          {submitting && <LoadingState label="Saving mandate…" />}
        </form>
      </Card>
    </div>
  );
}
