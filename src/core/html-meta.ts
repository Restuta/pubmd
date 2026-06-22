/** Read-only extraction of page metadata from an HTML document. Never mutates the body. */

export interface HtmlMeta {
  title: string | null;
  description: string | null;
}

/** Pulls the `<title>` and `<meta name="description">` out of an HTML string. */
export function extractHtmlMeta(html: string): HtmlMeta {
  return {
    title: extractTitle(html),
    description: extractDescription(html),
  };
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
