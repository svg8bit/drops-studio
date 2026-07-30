export interface HtmlOpeningTagBoundary {
  start: number;
  end: number;
  source: string;
}

function isInsideHtmlComment(html: string, offset: number): boolean {
  const commentStart = html.lastIndexOf("<!--", offset);
  return (
    commentStart !== -1
    && commentStart > html.lastIndexOf("-->", offset)
  );
}

/** Finds an opening HTML tag without treating a quoted `>` as its boundary. */
export function findHtmlOpeningTag(
  html: string,
  tagName: string,
): HtmlOpeningTagBoundary | null {
  if (!/^[a-z][a-z0-9:-]*$/i.test(tagName)) return null;
  const pattern = new RegExp(`<${tagName}(?=[\\s/>])`, "gi");
  let opening: RegExpExecArray | null;
  do {
    opening = pattern.exec(html);
  } while (
    opening
    && opening.index !== undefined
    && isInsideHtmlComment(html, opening.index)
  );
  if (!opening || opening.index === undefined) return null;
  let quote: '"' | "'" | null = null;
  for (
    let index = opening.index + opening[0].length;
    index < html.length;
    index += 1
  ) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "<") return null;
    if (character === ">") {
      const source = html.slice(opening.index, index + 1);
      if (source.slice(0, -1).trimEnd().endsWith("/")) return null;
      return { start: opening.index, end: index + 1, source };
    }
  }
  return null;
}

/** Removes every real opening-tag attribute with this name, including duplicates. */
export function stripHtmlOpeningTagAttribute(
  openingTag: string,
  attributeName: string,
): string {
  const nameMatch = /^<[a-z][a-z0-9:-]*/i.exec(openingTag);
  if (!nameMatch || !/^[a-z][a-z0-9:-]*$/i.test(attributeName)) {
    return openingTag;
  }
  const target = attributeName.toLowerCase();
  const boundary = openingTag.length - 1;
  let cursor = nameMatch[0].length;
  let output = nameMatch[0];
  while (cursor < boundary) {
    const segmentStart = cursor;
    while (cursor < boundary && /\s/.test(openingTag[cursor])) cursor += 1;
    if (cursor >= boundary) {
      output += openingTag.slice(segmentStart, boundary);
      break;
    }
    const attributeStart = cursor;
    while (
      cursor < boundary
      && !/[\s=/>]/.test(openingTag[cursor])
    ) {
      cursor += 1;
    }
    if (cursor === attributeStart) {
      output += openingTag.slice(segmentStart, cursor + 1);
      cursor += 1;
      continue;
    }
    const name = openingTag.slice(attributeStart, cursor).toLowerCase();
    const nameEnd = cursor;
    while (cursor < boundary && /\s/.test(openingTag[cursor])) cursor += 1;
    if (openingTag[cursor] === "=") {
      cursor += 1;
      while (cursor < boundary && /\s/.test(openingTag[cursor])) cursor += 1;
      const quote = openingTag[cursor];
      if (quote === '"' || quote === "'") {
        cursor += 1;
        while (cursor < boundary && openingTag[cursor] !== quote) cursor += 1;
        if (openingTag[cursor] === quote) cursor += 1;
      } else {
        while (cursor < boundary && !/[\s>]/.test(openingTag[cursor])) cursor += 1;
      }
    } else {
      cursor = nameEnd;
    }
    if (name !== target) output += openingTag.slice(segmentStart, cursor);
  }
  return `${output}>`;
}
