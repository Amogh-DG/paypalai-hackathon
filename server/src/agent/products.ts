import type { Product } from "@leash/shared";

export async function searchProducts(
  _query: string,
  _maxPrice?: number,
): Promise<Product[]> {
  return [];
}

export async function fetchPageText(_url: string): Promise<string> {
  return "";
}
