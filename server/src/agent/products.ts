import type { Product } from "@leash/shared";
import { normalize } from "@leash/shared/normalize";
import { catalog } from "./catalog.js";
import { extractPageText, fetchPageHtml } from "./pageText.js";

export async function searchProducts(
  query: string,
  maxPrice?: number,
): Promise<Product[]> {
  const words = normalize(query).split(" ").filter(Boolean);
  return catalog
    .filter((product) => {
      const fields = [product.title, product.merchant, product.category].map(normalize);
      return (maxPrice === undefined || product.price <= maxPrice)
        && words.every((word) => fields.some((field) => field.includes(word)));
    })
    .sort((left, right) => left.price - right.price)
    .slice(0, 10)
    .map((product) => ({ ...product }));
}

export async function fetchPageText(url: string): Promise<string> {
  return extractPageText(await fetchPageHtml(url));
}
