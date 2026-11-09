import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasAtMostTwoDecimals } from "@leash/shared";
import { catalog } from "../src/agent/catalog.js";
import { fetchPageText, searchProducts } from "../src/agent/products.js";
import { extractPageText, fetchPageHtml } from "../src/agent/pageText.js";

const realFetch = globalThis.fetch;
let server: Server;
let baseUrl: string;

const page = `<!doctype html>
<html><head><title>Trail gifts</title>
<style>.secret { content: "style-secret"; }</style></head>
<body><h1>Visible gift</h1>
<div style="display:none">Display hidden text</div>
<div style="visibility:hidden">Visibility hidden text</div>
<span hidden>Hidden attribute text</span>
<p style="color:white;background:white">White on white text</p>
<span style="font-size:1px">Tiny font text</span>
<!-- Comment message &amp; details -->
<script>throw new Error("script-secret");</script>
<p>Trail &amp; camp&nbsp;gear &#35;1 &#x1F392;</p>
</body></html>`;

beforeAll(async () => {
  server = createServer((request, response) => {
    switch (request.url) {
      case "/page":
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(page);
        return;
      case "/long":
        response.end(`<p>${"x".repeat(7000)}</p>`);
        return;
      case "/redirect":
        response.writeHead(302, { Location: "/page" });
        response.end();
        return;
      case "/bad-redirect":
        response.writeHead(302, { Location: "file:///unreadable-test.html" });
        response.end();
        return;
      case "/loop":
        response.writeHead(302, { Location: "/loop" });
        response.end();
        return;
      case "/hang":
        return;
      case "/hang-body":
        response.writeHead(200, { "Content-Type": "text/html" });
        response.write("<p>Unfinished");
        return;
      default:
        response.writeHead(404);
        response.end("Missing page");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== baseUrl) throw new Error("External network calls are forbidden in tests");
    return realFetch(input, init);
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("local product catalog", () => {
  it("has 30 stable unique ids, fictional HTTPS URLs, four categories and valid prices", () => {
    expect(catalog).toHaveLength(30);
    expect(new Set(catalog.map((product) => product.productId)).size).toBe(30);
    expect(catalog.map((product) => product.productId)).toEqual(
      Array.from({ length: 30 }, (_, index) => `cat-${String(index + 1).padStart(3, "0")}`),
    );
    expect(new Set(catalog.map((product) => product.category))).toEqual(new Set(["hiking", "books", "kitchen", "electronics"]));
    const merchantDomains = new Map<string, string>();
    for (const product of catalog) {
      expect(hasAtMostTwoDecimals(product.price)).toBe(true);
      expect(product.price).toBeGreaterThan(0);
      const url = new URL(product.url);
      expect(url.protocol).toBe("https:");
      expect(url.hostname.endsWith(".example")).toBe(true);
      const domain = merchantDomains.get(product.merchant);
      if (domain) expect(url.hostname).toBe(domain);
      merchantDomains.set(product.merchant, url.hostname);
    }
    expect(new Set(merchantDomains.values()).size).toBe(merchantDomains.size);
  });

  it("provides Trailhead's category counts and allow, ask and cap price bands", () => {
    const products = catalog.filter((product) => product.merchant === "Trailhead Supply");
    expect(products).toHaveLength(9);
    expect(products.filter((product) => product.category === "hiking")).toHaveLength(6);
    expect(products.filter((product) => product.category === "kitchen")).toHaveLength(2);
    expect(products.filter((product) => product.category === "electronics")).toHaveLength(1);
    expect(products.filter((product) => product.price >= 12 && product.price <= 49.99).length).toBeGreaterThanOrEqual(5);
    expect(products.filter((product) => product.price >= 50.01 && product.price <= 59.99).length).toBeGreaterThanOrEqual(2);
    expect(products.some((product) => product.price > 60)).toBe(true);
    expect(products.some((product) => product.category === "hiking" && product.price < 50)).toBe(true);
  });

  it("has six Page Turner books including five regular prices and the $54.50 book", () => {
    const books = catalog.filter((product) => product.merchant === "Page Turner Books");
    expect(books).toHaveLength(6);
    expect(books.every((product) => product.category === "books")).toBe(true);
    expect(books.filter((product) => product.price >= 9.99 && product.price <= 39.99)).toHaveLength(5);
    expect(books.filter((product) => product.price === 54.50)).toHaveLength(1);
  });

  it("has 15 non-allowlisted products across four categories, expensive options and a cheap backpack", () => {
    const products = catalog.filter((product) => !["Trailhead Supply", "Page Turner Books"].includes(product.merchant));
    expect(products).toHaveLength(15);
    expect(new Set(products.map((product) => product.category))).toEqual(new Set(["hiking", "books", "kitchen", "electronics"]));
    expect(products.filter((product) => product.price > 60).length).toBeGreaterThanOrEqual(3);
    expect(products.some((product) => product.category === "hiking" && /backpack/i.test(product.title) && product.price < 40)).toBe(true);
  });
});

describe("product search", () => {
  it("finds hiking products at or under the cap in ascending price order", async () => {
    const products = await searchProducts("hiking", 50);
    expect(products.length).toBeGreaterThan(0);
    expect(products.length).toBeLessThanOrEqual(10);
    expect(products.every((product) => product.category === "hiking" && product.price <= 50)).toBe(true);
    expect(products.map((product) => product.price)).toEqual(products.map((product) => product.price).sort((a, b) => a - b));
  });

  it("returns the ten cheapest products for an empty query and applies an inclusive cap", async () => {
    const cheapest = [...catalog].sort((a, b) => a.price - b.price).slice(0, 10);
    expect(await searchProducts("")).toEqual(cheapest);
    const filtered = await searchProducts("  \n ", 12);
    expect(filtered).toEqual(cheapest.filter((product) => product.price <= 12));
    expect(filtered.some((product) => product.price === 12)).toBe(true);
    expect(await searchProducts("", 0)).toEqual([]);
  });

  it("normalizes whitespace and case and requires all words across the three fields", async () => {
    const products = await searchProducts("  tRAiLHEAD \n HIKING\tCloudpine  ");
    expect(products.map((product) => product.productId)).toEqual(["cat-004"]);
    expect(products).toEqual(await searchProducts("trailhead hiking cloudpine"));
    expect(await searchProducts("trailhead hiking nonexistent")).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns fresh copies without sorting or mutating the catalog", async () => {
    const original = structuredClone(catalog);
    const products = await searchProducts("hiking");
    const firstId = products[0].productId;
    products[0].title = "Changed";
    products[0].price = -10;
    expect(catalog).toEqual(original);
    expect((await searchProducts("hiking")).find((product) => product.productId === firstId)).toEqual(original.find((product) => product.productId === firstId));
  });
});

describe("page text fetching", () => {
  it("retains visible, hidden and comment text, decodes entities and removes scripts and styles", async () => {
    const text = await fetchPageText(`${baseUrl}/page`);
    for (const expected of ["Visible gift", "Display hidden text", "Visibility hidden text", "Hidden attribute text", "White on white text", "Tiny font text", "Comment message & details", "Trail & camp gear #1 🎒"]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain("script-secret");
    expect(text).not.toContain("style-secret");
    expect(text).not.toMatch(/<[^>]+>/);
    expect(text).toBe(text.trim());
    expect(text).not.toMatch(/\s{2,}/);
  });

  it("leaves the 6000-character tool limit to the agent", async () => {
    expect(await fetchPageText(`${baseUrl}/long`)).toBe("x".repeat(7000));
  });

  it("includes the status code for a non-success response", async () => {
    await expect(fetchPageText(`${baseUrl}/missing`)).rejects.toThrow("404");
  });

  it.each(["file:///unreadable-test.html", "ftp://example.test/page", "data:text/html,test", "javascript:void(0)"])("rejects %s before fetching", async (url) => {
    await expect(fetchPageText(url)).rejects.toThrow("http or https");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("follows relative HTTP redirects and rejects non-HTTP destinations", async () => {
    expect(await fetchPageText(`${baseUrl}/redirect`)).toContain("Visible gift");
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.mocked(fetch).mockClear();
    await expect(fetchPageText(`${baseUrl}/bad-redirect`)).rejects.toThrow("http or https");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("bounds redirect loops", async () => {
    await expect(fetchPageText(`${baseUrl}/loop`)).rejects.toThrow("exceeded 10 redirects");
    expect(fetch).toHaveBeenCalledTimes(11);
  });

  it.each(["/hang", "/hang-body"])("times out while fetching %s with an injected short timeout", async (path) => {
    await expect(fetchPageHtml(`${baseUrl}${path}`, { timeoutMs: 75 })).rejects.toThrow("timed out");
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("uses a 10-second timeout by default", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    }));
    const pending = fetchPageText(`${baseUrl}/hang`);
    const assertion = expect(pending).rejects.toThrow("timed out");
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    await vi.advanceTimersByTimeAsync(9999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the body at 500000 characters without including later content", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(500_000) + "beyond-limit"));
      },
      cancel,
    });
    vi.mocked(fetch).mockResolvedValue(new Response(stream));
    const text = await fetchPageText(`${baseUrl}/bounded`);
    expect(text).toBe("x".repeat(500_000));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("decodes UTF-8 characters split across streamed chunks", async () => {
    const bytes = new TextEncoder().encode("<p>Café 🎒</p>");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    vi.mocked(fetch).mockResolvedValue(new Response(stream));
    expect(await fetchPageText(`${baseUrl}/utf8`)).toBe("Café 🎒");
  });
});

describe("bounded HTML extraction", () => {
  it("handles quoted tag delimiters, mixed-case raw elements and comments containing markup", () => {
    expect(extractPageText(`<p title="a > b">Before</p><ScRiPt data-x=">">discarded</sCrIpT><STYLE>discarded too</STYLE><!-- Keep <b>literal</b> &amp; text --><p>After</p>`)).toBe("Before Keep <b>literal</b> & text After");
  });

  it("decodes common named and numeric entities once while preserving unknown and unterminated ones", () => {
    expect(extractPageText("&lt;gift&gt; &quot;yes&quot; &apos;ok&apos; &copy; &reg; &trade; &pound; &euro; &ndash; &mdash; &hellip; &#65; &#x1F392; &amp;lt; &unknown; &amp")).toBe('<gift> "yes" \'ok\' © ® ™ £ € – — … A 🎒 &lt; &unknown; &amp');
    expect(extractPageText("&#0; &#xD800; &#x110000;")).toBe("� � �");
  });

  it("keeps literal comparisons and drops an unclosed script or style through end of input", () => {
    expect(extractPageText("2 < 3 and 5 > 4")).toBe("2 < 3 and 5 > 4");
    expect(extractPageText("Before<script>discarded until EOF")).toBe("Before");
    expect(extractPageText("Before<style>discarded until EOF")).toBe("Before");
    expect(extractPageText("Before<!-- open comment")).toBe("Before open comment");
  });
});
