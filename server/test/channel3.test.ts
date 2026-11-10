import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchChannel3 } from "../src/agent/channel3.js";
import { searchProducts } from "../src/agent/products.js";

type ApiProduct = {
  id: string;
  title: string;
  images: Array<{ url: string; cleaned_url: string; is_main_image: boolean }>;
  category: {
    slug: string;
    title: string;
    path: Array<{ slug: string; title: string }>;
    has_children: boolean;
  } | null;
  offers: Array<{
    url: string;
    domain: string;
    price: { price: number; currency: string };
    availability: "InStock" | "OutOfStock";
  }>;
};

function apiProduct(
  id: string,
  price: number,
  overrides: Partial<ApiProduct> = {},
): ApiProduct {
  return {
    id,
    title: `Trail Backpack ${id}`,
    images: [
      {
        url: `https://images.example/${id}.jpg`,
        cleaned_url: `https://images.example/clean-${id}.jpg`,
        is_main_image: true,
      },
    ],
    category: {
      slug: "hiking-backpacks",
      title: "Backpacks",
      path: [{ slug: "outdoor", title: "Outdoor Gear" }],
      has_children: false,
    },
    offers: [
      {
        url: `https://shop.example/${id}`,
        domain: "www.SHOP.EXAMPLE",
        price: { price, currency: "USD" },
        availability: "InStock",
      },
    ],
    ...overrides,
  };
}

function response(products: unknown, status = 200): Response {
  return new Response(JSON.stringify({ products, next_page_token: null }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubGlobalFetch(implementation: typeof fetch): void {
  vi.stubGlobal("fetch", vi.fn(implementation));
}

beforeEach(() => {
  vi.stubEnv("CHANNEL3_API_KEY", "test-channel3-key");
  stubGlobalFetch(async () => {
    throw new Error("Unexpected global fetch call");
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Channel3 mapping", () => {
  it("maps a valid result to a shared Product", async () => {
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response([apiProduct("one", 19.999)]));
    const products = await searchChannel3("backpack", undefined, {
      fetch: fetchStub,
    });

    expect(products).toEqual([
      {
        productId: "c3-one",
        title: "Trail Backpack one",
        merchant: "shop.example",
        category: "hiking",
        price: 20,
        url: "https://shop.example/one",
        imageUrl: "https://images.example/clean-one.jpg",
      },
    ]);
  });

  it("chooses the cheapest qualifying in-stock USD offer", async () => {
    const product = apiProduct("offers", 25, {
      offers: [
        {
          url: "https://shop.example/out",
          domain: "shop.example",
          price: { price: 1, currency: "USD" },
          availability: "OutOfStock",
        },
        {
          url: "https://shop.example/euro",
          domain: "shop.example",
          price: { price: 2, currency: "EUR" },
          availability: "InStock",
        },
        {
          url: "https://www.low.example/item",
          domain: "WWW.LOW.EXAMPLE",
          price: { price: 17.25, currency: "USD" },
          availability: "InStock",
        },
      ],
    });
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response([product]));

    const [result] = await searchChannel3("item", undefined, {
      fetch: fetchStub,
    });

    expect(result.merchant).toBe("low.example");
    expect(result.price).toBe(17.25);
    expect(result.url).toBe("https://www.low.example/item");
  });

  it("drops products with invalid required fields or no unique category", async () => {
    const noOffer = apiProduct("no-offer", 1, { offers: [] });
    const zero = apiProduct("zero", 0);
    const negative = apiProduct("negative", -1);
    const emptyTitle = apiProduct("empty-title", 1, { title: "  " });
    const nonHttps = apiProduct("non-https", 1, {
      offers: [
        {
          url: "http://shop.example/non-https",
          domain: "shop.example",
          price: { price: 1, currency: "USD" },
          availability: "InStock",
        },
      ],
    });
    const unknownCategory = apiProduct("unknown", 1, {
      category: {
        slug: "toys",
        title: "Toys",
        path: [],
        has_children: false,
      },
    });
    const ambiguousCategory = apiProduct("ambiguous", 1, {
      category: {
        slug: "books-and-kitchen",
        title: "Books and Kitchen",
        path: [],
        has_children: false,
      },
    });
    const nullCategory = apiProduct("null-category", 1, { category: null });
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response([
          noOffer,
          zero,
          negative,
          emptyTitle,
          nonHttps,
          unknownCategory,
          ambiguousCategory,
          nullCategory,
        ]),
      );

    expect(
      await searchChannel3("item", undefined, { fetch: fetchStub }),
    ).toEqual([]);
  });

  it.each([
    ["hiking", "hiking backpack", "hiking"],
    ["books", "paperback fiction", "books"],
    ["kitchen", "coffee maker", "kitchen"],
    ["electronics", "wireless headphones", "electronics"],
  ])("maps %s category", async (_name, title, expected) => {
    const item = apiProduct(String(expected), 9, {
      category: {
        slug: "miscellaneous",
        title,
        path: [],
        has_children: false,
      },
    });
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(response([item]));

    const [result] = await searchChannel3("item", undefined, {
      fetch: fetchStub,
    });

    expect(result.category).toBe(expected);
  });

  it("rejects toy and null categories", async () => {
    const toy = apiProduct("toy", 9, {
      category: {
        slug: "toy",
        title: "Toy",
        path: [],
        has_children: false,
      },
    });
    const noCategory = apiProduct("null", 9, { category: null });
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response([toy, noCategory]));

    expect(
      await searchChannel3("item", undefined, { fetch: fetchStub }),
    ).toEqual([]);
  });

  it("applies an inclusive max price, sorts ascending, and caps at ten", async () => {
    const items = Array.from({ length: 12 }, (_, index) =>
      apiProduct(String(index), 12 - index),
    );
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(response(items));

    const products = await searchChannel3("item", 10, { fetch: fetchStub });

    expect(products).toHaveLength(10);
    expect(products.map((product) => product.price)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(products[9].price).toBe(10);
  });

  it("sends only documented request fields to the documented endpoint", async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(response([]));

    await searchChannel3("gear", 40.5, { fetch: fetchStub });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe("https://api.trychannel3.com/v1/search");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "x-api-key": "test-channel3-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "gear",
      limit: 30,
      filters: { price: { max_price: 40.5 } },
      config: { country: "US", currency: "USD" },
    });
    expect(String(init?.body)).not.toContain("test-channel3-key");
  });

  it("rejects missing API keys before calling fetch", async () => {
    vi.stubEnv("CHANNEL3_API_KEY", "");
    const fetchStub = vi.fn<typeof fetch>();

    await expect(
      searchChannel3("gear", undefined, { fetch: fetchStub }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("does not include API keys or response bodies in failed request errors", async () => {
    const apiKey = "sensitive-channel3-key";
    vi.stubEnv("CHANNEL3_API_KEY", apiKey);
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("private response details", { status: 500 }),
      );

    let message = "";
    try {
      await searchChannel3("gear", undefined, { fetch: fetchStub });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toContain(apiKey);
    expect(message).not.toContain("private response details");
    expect(message).toBe("Channel3 search failed.");
  });
});

describe("searchProducts Channel3 fallback", () => {
  it("uses the fake catalog without a key and never calls fetch", async () => {
    vi.stubEnv("CHANNEL3_API_KEY", "");

    const products = await searchProducts("hiking", 50);

    expect(products.length).toBeGreaterThan(0);
    expect(products.every((product) => product.category === "hiking")).toBe(
      true,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["401", () => new Response("secret body", { status: 401 })],
    ["402", () => new Response("secret body", { status: 402 })],
    ["500", () => new Response("secret body", { status: 500 })],
    ["invalid JSON", () => new Response("not-json", { status: 200 })],
    ["empty mapping", () => response([])],
  ])("falls back for %s", async (_name, createResponse) => {
    stubGlobalFetch(async () => createResponse());

    const products = await searchProducts("hiking", 50);

    expect(products.length).toBeGreaterThan(0);
    expect(products.every((product) => product.category === "hiking")).toBe(
      true,
    );
  });

  it("falls back when the request times out", async () => {
    vi.useFakeTimers();
    stubGlobalFetch(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );

    const pending = searchProducts("hiking", 50);
    await vi.advanceTimersByTimeAsync(8000);

    const products = await pending;
    expect(products.length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
