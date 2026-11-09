const responseCharacterLimit = 500_000;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

const entities: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
  copy: "©", reg: "®", trade: "™", cent: "¢", pound: "£", yen: "¥", euro: "€",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  hellip: "…", bull: "•", middot: "·",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
    if (!entity.startsWith("#")) return Object.hasOwn(entities, entity) ? entities[entity] : match;
    const hexadecimal = entity[1].toLowerCase() === "x";
    const point = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return "\ufffd";
    return String.fromCodePoint(point);
  });
}

export function extractPageText(html: string): string {
  const tokens = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?[a-z][a-z0-9:-]*(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  const chunks: string[] = [];
  let position = 0;
  let token: RegExpExecArray | null;
  while ((token = tokens.exec(html)) !== null) {
    chunks.push(html.slice(position, token.index));
    const markup = token[0];
    if (markup.startsWith("<!--")) {
      chunks.push(markup.slice(4, markup.endsWith("-->") ? -3 : undefined));
    } else {
      const rawElement = /^<(script|style)(?=[\s/>])/i.exec(markup);
      if (rawElement) {
        const closingTag = new RegExp(`</${rawElement[1]}\\s*>`, "gi");
        closingTag.lastIndex = tokens.lastIndex;
        const closing = closingTag.exec(html);
        tokens.lastIndex = closing ? closingTag.lastIndex : html.length;
      }
    }
    position = tokens.lastIndex;
  }
  chunks.push(html.slice(position));
  return decodeEntities(chunks.join(" ")).replace(/\s+/g, " ").trim();
}

function httpUrl(value: string, base?: URL): URL {
  const url = new URL(value, base);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Page URL must use http or https.");
  }
  return url;
}

async function readLimitedBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let length = 0;
  try {
    while (length < responseCharacterLimit) {
      const { done, value } = await reader.read();
      const text = (done ? decoder.decode() : decoder.decode(value, { stream: true }))
        .slice(0, responseCharacterLimit - length);
      chunks.push(text);
      length += text.length;
      if (done) break;
      if (length === responseCharacterLimit) await reader.cancel();
    }
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

export async function fetchPageHtml(
  value: string,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  let url = httpUrl(value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    for (let redirects = 0; ; redirects += 1) {
      const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
      if (redirectStatuses.has(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw new Error(`Page fetch failed: HTTP ${response.status} without a redirect location.`);
        if (redirects >= 10) throw new Error("Page fetch exceeded 10 redirects.");
        url = httpUrl(location, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Page fetch failed: HTTP ${response.status}.`);
      }
      return await readLimitedBody(response);
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Page fetch timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
