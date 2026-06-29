/** Read-only extraction of page metadata from an HTML document. Never mutates the body. */

export interface HtmlMeta {
  title: string | null;
  description: string | null;
  /** Raw `<meta name="pubmd:expires">` content, e.g. "true", "never", "7d". */
  expires: string | null;
}

/** Pulls the `<title>`, description and pubmd directives out of an HTML string. */
export function extractHtmlMeta(html: string): HtmlMeta {
  return {
    title: extractTitle(html),
    description: extractDescription(html),
    expires: extractMetaContent(html, "pubmd:expires"),
  };
}

function extractMetaContent(html: string, name: string): string | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tagName = matchAttr(tag[0], "name");

    if (tagName?.toLowerCase() !== name.toLowerCase()) {
      continue;
    }

    const content = matchAttr(tag[0], "content");

    return content === undefined
      ? null
      : nonEmpty(decodeBasicEntities(collapseWhitespace(content)));
  }

  return null;
}

function matchAttr(tag: string, attribute: string): string | undefined {
  const match = new RegExp(
    `\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);

  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  if (match?.[1] === undefined) {
    return null;
  }

  return nonEmpty(decodeBasicEntities(collapseWhitespace(match[1])));
}

function extractDescription(html: string): string | null {
  const metaTag = html.match(
    /<meta\b[^>]*\bname\s*=\s*(["'])description\1[^>]*>/i,
  );

  if (metaTag?.[0] === undefined) {
    return null;
  }

  const content = metaTag[0].match(
    /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
  );
  const value = content?.[1] ?? content?.[2] ?? content?.[3];

  if (value === undefined) {
    return null;
  }

  return nonEmpty(decodeBasicEntities(collapseWhitespace(value)));
}

function collapseWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function decodeBasicEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
}

function nonEmpty(value: string): string | null {
  return value.length > 0 ? value : null;
}
