import { parse } from "parse5";

/**
 * Read-only view of a fetched page, parsed with parse5 (security policy section 4: HTML is
 * parsed, never rendered or executed). Only what detections and contact extraction need:
 * elements in document order with their attributes, text, a CSS selector path for evidence,
 * links resolved against the page URL, meta tags and inline styles. Work is bounded: at most
 * MAX_ELEMENTS elements are indexed.
 */

interface P5Node {
  nodeName: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: P5Node[];
  value?: string;
  content?: P5Node;
}

export interface HtmlElement {
  tag: string;
  attrs: Record<string, string>;
  parent: HtmlElement | null;
  /** Child elements and text nodes in order. */
  children: Array<HtmlElement | string>;
  /** 1-based position among siblings with the same tag. */
  nth: number;
  /** Number of siblings (including itself) with the same tag. */
  sameTag: number;
}

export interface HtmlLink {
  /** Absolute URL, or null when the href does not resolve (javascript:, malformed). */
  href: string | null;
  raw: string;
  text: string;
  element: HtmlElement;
}

export const MAX_ELEMENTS = 20_000;
/** Deeper nesting is ignored (keeps recursion bounded). */
export const MAX_DEPTH = 256;
const SKIP_TEXT = new Set(["script", "style", "template", "noscript", "svg", "head"]);
const SNIPPET_MAX = 300;

export function snippet(text: string, max = SNIPPET_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export class HtmlDocument {
  readonly elements: HtmlElement[] = [];
  readonly url: URL;
  private readonly byTagIndex = new Map<string, HtmlElement[]>();
  private truncated = false;

  private constructor(url: URL) {
    this.url = url;
  }

  static parse(html: string, url: string): HtmlDocument {
    const doc = new HtmlDocument(new URL(url));
    const root = parse(html) as unknown as P5Node;
    doc.walk(root, null, 0);
    return doc;
  }

  get isTruncated(): boolean {
    return this.truncated;
  }

  private walk(node: P5Node, parent: HtmlElement | null, depth: number): void {
    if (depth > MAX_DEPTH) {
      this.truncated = true;
      return;
    }
    const counts = new Map<string, number>();
    const created: HtmlElement[] = [];
    for (const child of node.childNodes ?? []) {
      if (child.nodeName === "#text") {
        if (parent && child.value) parent.children.push(child.value);
        continue;
      }
      if (!child.tagName) continue;
      if (this.elements.length >= MAX_ELEMENTS) {
        this.truncated = true;
        return;
      }
      const tag = child.tagName.toLowerCase();
      const nth = (counts.get(tag) ?? 0) + 1;
      counts.set(tag, nth);
      const attrs: Record<string, string> = {};
      for (const a of child.attrs ?? []) attrs[a.name.toLowerCase()] = a.value;
      const el: HtmlElement = { tag, attrs, parent, children: [], nth, sameTag: 0 };
      created.push(el);
      this.elements.push(el);
      const list = this.byTagIndex.get(tag) ?? [];
      list.push(el);
      this.byTagIndex.set(tag, list);
      if (parent) parent.children.push(el);
      this.walk(tag === "template" && child.content ? child.content : child, el, depth + 1);
    }
    for (const el of created) el.sameTag = counts.get(el.tag) ?? 1;
  }

  byTag(tag: string): HtmlElement[] {
    return this.byTagIndex.get(tag) ?? [];
  }

  /** Text content of an element, skipping scripts and styles, whitespace collapsed. */
  text(el: HtmlElement, max = 5000): string {
    const out: string[] = [];
    let length = 0;
    const visit = (e: HtmlElement) => {
      for (const c of e.children) {
        if (length > max) return;
        if (typeof c === "string") {
          out.push(c);
          length += c.length;
        } else if (!SKIP_TEXT.has(c.tag)) visit(c);
      }
    };
    visit(el);
    return out.join(" ").replace(/\s+/g, " ").trim().slice(0, max);
  }

  /** Visible text of the body (scripts, styles and templates excluded). */
  bodyText(max = 200_000): string {
    const body = this.byTag("body")[0];
    return body ? this.text(body, max) : "";
  }

  /** Short selector path for evidence, e.g. `body > footer > p:nth-of-type(2) > a`. */
  selector(el: HtmlElement, depth = 6): string {
    const parts: string[] = [];
    let current: HtmlElement | null = el;
    while (current && parts.length < depth && current.tag !== "html") {
      let part = current.tag;
      const id = current.attrs.id?.trim();
      if (id && /^[A-Za-z][\w-]{0,40}$/.test(id)) {
        parts.unshift(`${part}#${id}`);
        break;
      }
      if (current.sameTag > 1) part += `:nth-of-type(${current.nth})`;
      parts.unshift(part);
      current = current.parent;
    }
    return parts.join(" > ");
  }

  title(): string | null {
    const t = this.byTag("title")[0];
    const text = t
      ? t.children
          .filter((c): c is string => typeof c === "string")
          .join("")
          .replace(/\s+/g, " ")
          .trim()
      : "";
    return text || null;
  }

  /** Content of `<meta name=...>` or `<meta property=...>` (case-insensitive), first match. */
  meta(name: string): { content: string; element: HtmlElement } | null {
    const wanted = name.toLowerCase();
    for (const m of this.byTag("meta")) {
      const key = (m.attrs.name ?? m.attrs.property ?? "").toLowerCase();
      if (key === wanted) return { content: (m.attrs.content ?? "").trim(), element: m };
    }
    return null;
  }

  links(): HtmlLink[] {
    return this.byTag("a")
      .filter((a) => a.attrs.href !== undefined)
      .map((a) => {
        const raw = (a.attrs.href ?? "").trim();
        let href: string | null = null;
        if (!/^javascript:/i.test(raw)) {
          try {
            href = new URL(raw, this.url).toString();
          } catch {
            href = null;
          }
        }
        const label = [this.text(a, 300), a.attrs["aria-label"] ?? "", a.attrs.title ?? ""]
          .filter(Boolean)
          .join(" ")
          .trim();
        return { href, raw, text: label, element: a };
      });
  }

  /** `<style>` blocks and `style` attributes, for layout and font-size hints. */
  styleText(max = 500_000): string {
    const blocks = this.byTag("style").map((s) =>
      s.children.filter((c): c is string => typeof c === "string").join(""),
    );
    const inline = this.elements.map((e) => e.attrs.style).filter((s): s is string => Boolean(s));
    return [...blocks, ...inline].join("\n").slice(0, max);
  }

  /** Absolute URLs of `src` attributes for a tag (script, iframe). */
  sources(tag: string): Array<{ url: string; element: HtmlElement }> {
    const out: Array<{ url: string; element: HtmlElement }> = [];
    for (const el of this.byTag(tag)) {
      const src = el.attrs.src?.trim();
      if (!src) continue;
      try {
        out.push({ url: new URL(src, this.url).toString(), element: el });
      } catch {
        // ignore malformed src
      }
    }
    return out;
  }

  /** Ancestor chain check. */
  static within(el: HtmlElement, tag: string): HtmlElement | null {
    let current = el.parent;
    while (current) {
      if (current.tag === tag) return current;
      current = current.parent;
    }
    return null;
  }
}
