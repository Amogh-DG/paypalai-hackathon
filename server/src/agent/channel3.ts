import { hasAtMostTwoDecimals, type Product } from "@leash/shared";
import { normalize } from "@leash/shared/normalize";

export class Channel3UnavailableError extends Error {
  readonly code = "unavailable";

  constructor() {
    super("Channel3 is unavailable.");
    this.name = "Channel3UnavailableError";
  }
}

export type Channel3SearchOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
};

const categoryKeywords = {
  hiking: [
    "hiking",
    "camping",
    "backpack",
    "backpacks",
    "trekking",
    "outdoor",
    "tent",
    "tents",
  ],
  books: ["book", "books", "novel", "novels", "paperback", "hardcover"],
  kitchen: ["kitchen", "cookware", "cutlery", "bakeware", "coffee maker"],
  electronics: [
    "electronics",
    "headphones",
    "speaker",
    "speakers",
    "charger",
    "chargers",
    "camera",
    "cameras",
  ],
} as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function mapCategory(value: unknown): Product["category"] | undefined {
  const category = record(value);
  if (!category) return undefined;
  const pathTitles = Array.isArray(category.path)
    ? category.path.map((entry) => string(record(entry)?.title) ?? "")
    : [];
  const text = normalize(
    [
      string(category.slug) ?? "",
      string(category.title) ?? "",
      ...pathTitles,
    ].join(" "),
  );
  const matches = (
    Object.keys(categoryKeywords) as (keyof typeof categoryKeywords)[]
  ).filter((key) =>
    categoryKeywords[key].some((keyword) => {
      const phrase = normalize(keyword)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s+");
      return new RegExp(`(?:^|\\s)${phrase}(?:\\s|$)`).test(text);
    }),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function mapProduct(value: unknown): Product | undefined {
  const source = record(value);
  if (!source) return undefined;
  const id = string(source.id)?.trim();
  const title = string(source.title)?.trim();
  const category = mapCategory(source.category);
  const offers = Array.isArray(source.offers) ? source.offers : [];
  const eligible = offers
    .flatMap((candidate) => {
      const offer = record(candidate);
      const price = record(offer?.price);
      const url = httpsUrl(offer?.url);
      const domain = string(offer?.domain)
        ?.trim()
        .toLowerCase()
        .replace(/^www\./, "");
      if (
        offer?.availability !== "InStock" ||
        price?.currency !== "USD" ||
        typeof price.price !== "number" ||
        !Number.isFinite(price.price) ||
        price.price <= 0 ||
        !url ||
        !domain
      )
        return [];
      const rounded = Number(price.price.toFixed(2));
      if (rounded <= 0 || !hasAtMostTwoDecimals(rounded)) return [];
      return [{ url, domain, price: rounded }];
    })
    .sort((left, right) => left.price - right.price);
  const selected = eligible[0];
  if (!id || !title || !category || !selected) return undefined;

  const images = Array.isArray(source.images) ? source.images : [];
  const mainImage = images
    .map(record)
    .find((entry) => entry?.is_main_image === true);
  const firstImage = record(images[0]);
  const imageUrl = httpsUrl(
    string(mainImage?.cleaned_url)?.trim() ||
      string(mainImage?.url)?.trim() ||
      string(firstImage?.cleaned_url)?.trim() ||
      string(firstImage?.url)?.trim(),
  );
  return {
    productId: `c3-${id}`,
    title,
    merchant: selected.domain,
    category,
    price: selected.price,
    url: selected.url,
    ...(imageUrl ? { imageUrl } : {}),
  };
}

export async function searchChannel3(
  query: string,
  maxPrice?: number,
  options: Channel3SearchOptions = {},
): Promise<Product[]> {
  const apiKey = process.env.CHANNEL3_API_KEY;
  if (!apiKey?.trim()) throw new Channel3UnavailableError();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 8000,
  );
  try {
    const response = await (options.fetch ?? fetch)(
      "https://api.trychannel3.com/v1/search",
      {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          limit: 30,
          ...(maxPrice === undefined
            ? {}
            : { filters: { price: { max_price: maxPrice } } }),
          config: { country: "US", currency: "USD" },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok)
      throw new Error(
        `Channel3 request failed with status ${response.status}.`,
      );
    const payload: unknown = await response.json();
    const products = record(payload)?.products;
    if (!Array.isArray(products))
      throw new Error("Channel3 returned an invalid response.");
    return products
      .map(mapProduct)
      .filter((product): product is Product => product !== undefined)
      .filter((product) => maxPrice === undefined || product.price <= maxPrice)
      .sort((left, right) => left.price - right.price)
      .slice(0, 10);
  } catch {
    throw new Error("Channel3 search failed.");
  } finally {
    clearTimeout(timeout);
  }
}
