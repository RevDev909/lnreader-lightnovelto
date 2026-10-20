// Pure parsing helpers for the LightNovel.to LNReader plugin.
// These functions take raw HTML / JSON and have no dependencies,
// so they can be unit-tested in plain Node.
//
// Site notes (verified live 2026-10-20):
// - Next.js site; catalog, novel and chapter pages are server-rendered,
//   so everything parses straight out of the HTML.
// - Catalog: GET /novels?sort=popular|latest|newest|rating|chapters
//   &page=N, 24 cards per page, empty grid past the last page.
//   Search is the same page with &search=<term>.
// - Novel metadata lives in the page's schema.org JSON-LD block
//   (name, description, image, genre[], author[], creativeWorkStatus
//   "Completed" | "Incomplete").
// - The full chapter list is NOT in the novel page (only the first few
//   and latest few chapters are); the site's own UI fetches it from
//   GET /api/novel-chapters?slug=<novel slug>, which returns
//   { chapters: [{ slug: "chapter-N", number, title, createdAt }] }.
// - Chapter text sits in a single <div class="ln-prose"> of <p> tags.

export interface NovelCard {
  name: string;
  path: string;
  cover?: string;
}

export interface ChapterEntry {
  slug: string;
  title: string;
  number: number;
  createdAt?: string;
}

export interface NovelDetails {
  name: string;
  cover: string;
  summary: string;
  author: string;
  genres: string[];
  /** Raw schema.org creativeWorkStatus, e.g. "Completed" / "Incomplete". */
  statusRaw: string;
}

/**
 * Upper bound on a page this plugin will parse. Site pages are orders
 * of magnitude smaller; anything bigger is a broken or hostile
 * response, and regex-scanning it would bill the reader's phone, not
 * the site. Enforced before any parsing happens.
 */
export const MAX_PAGE_CHARS = 10000000;

const HTML_ENTITY_CHARS: Record<string, string> = {
  amp: '&',
  quot: '"',
  '#39': "'",
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

/** Encode one Unicode code point without String.fromCodePoint (ES5-safe). */
function codePointToString(cp: number): string {
  if (cp < 0x10000) return String.fromCharCode(cp);
  const v = cp - 0x10000;
  return String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
}

export function decodeHtmlEntities(s: string): string {
  // Named entities first (single pass so "&amp;lt;" stays literal),
  // then numeric entities (&#8217; / &#x2019;).
  return s
    .replace(
      /&(amp|quot|#39|apos|lt|gt|nbsp|ndash|mdash|hellip|lsquo|rsquo|ldquo|rdquo);/g,
      (m, e: string) => HTML_ENTITY_CHARS[e] ?? m,
    )
    .replace(/&#(\d+);/g, (m, d: string) => {
      const cp = parseInt(d, 10);
      return cp > 0 && cp <= 0x10ffff ? codePointToString(cp) : m;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h: string) => {
      const cp = parseInt(h, 16);
      return cp > 0 && cp <= 0x10ffff ? codePointToString(cp) : m;
    });
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

function cleanText(s: string): string {
  return decodeHtmlEntities(stripTags(s)).replace(/\s+/g, ' ').trim();
}

function checkSize(html: string): void {
  if (html.length > MAX_PAGE_CHARS) throw new Error('Page too large to parse');
}

/**
 * Catalog / search cards: <a class="ln-ncard" href="/novel/<slug>">
 * wrapping a cover <img> and an <h3> title.
 */
export function parseCatalogCards(html: string): NovelCard[] {
  checkSize(html);
  const cards: NovelCard[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const attrs = m[1];
    if (!/\bln-ncard\b/.test(attrs)) continue;
    const href = /\bhref="([^"]+)"/.exec(attrs);
    if (!href || !href[1].startsWith('/novel/')) continue;
    const path = href[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const body = m[2];
    let name = '';
    const h3 = /<h3\b[^>]*>([\s\S]*?)<\/h3>/.exec(body);
    if (h3) name = cleanText(h3[1]);
    let cover: string | undefined;
    const img = /<img\b([^>]*)>/.exec(body);
    if (img) {
      const src = /\bsrc="([^"]+)"/.exec(img[1]);
      if (src) cover = src[1];
      if (!name) {
        const alt = /\balt="([^"]*)"/.exec(img[1]);
        if (alt) name = cleanText(alt[1]);
      }
    }
    if (!name) continue;
    cards.push({ name, path, cover });
  }
  return cards;
}

interface LdBook {
  name?: string;
  description?: string;
  image?: string;
  genre?: string[];
  author?: { name?: string }[];
  creativeWorkStatus?: string;
}

function findLdBook(html: string): LdBook | null {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      const graph: unknown[] = Array.isArray(data['@graph'])
        ? data['@graph']
        : [data];
      for (const node of graph) {
        const n = node as { '@type'?: string };
        if (n && n['@type'] === 'Book') return n as LdBook;
      }
    } catch (e) {
      // Not valid JSON — keep looking at the next block.
    }
  }
  return null;
}

/** Novel details from the novel page (JSON-LD, with DOM fallbacks). */
export function parseNovelDetails(html: string): NovelDetails {
  checkSize(html);
  const book = findLdBook(html);
  let name = book && book.name ? cleanText(book.name) : '';
  if (!name) {
    const h1 = /<h1\b[^>]*class="[^"]*ln-dtitle[^"]*"[^>]*>([\s\S]*?)<\/h1>/.exec(
      html,
    );
    if (h1) name = cleanText(h1[1]);
  }
  let cover = book && book.image ? book.image : '';
  if (!cover) {
    const dc = /<div\b[^>]*class="[^"]*ln-dcv[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(
      html,
    );
    if (dc) {
      const img = /\bsrc="([^"]+)"/.exec(dc[1]);
      if (img) cover = img[1];
    }
  }
  const authorNames: string[] = [];
  if (book && Array.isArray(book.author)) {
    for (const a of book.author) {
      if (a && a.name) authorNames.push(cleanText(a.name));
    }
  }
  return {
    name,
    cover,
    summary: book && book.description ? cleanText(book.description) : '',
    author: authorNames.join(', '),
    genres:
      book && Array.isArray(book.genre)
        ? book.genre.map(g => cleanText(String(g))).filter(g => g.length > 0)
        : [],
    statusRaw: book && book.creativeWorkStatus ? book.creativeWorkStatus : '',
  };
}

/**
 * Chapter list from GET /api/novel-chapters?slug=<slug>.
 * Returns entries sorted ascending by chapter number; the chapter's
 * site path is /novel/<novel slug>/<entry slug>.
 */
export function parseChapterList(text: string): ChapterEntry[] {
  checkSize(text);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('Chapter list response was not valid JSON');
  }
  const raw: unknown[] = Array.isArray(data)
    ? data
    : (data as { chapters?: unknown[] }).chapters || [];
  const entries: ChapterEntry[] = [];
  for (const item of raw) {
    const it = item as {
      slug?: string;
      title?: string;
      number?: number;
      createdAt?: string;
    };
    if (!it || typeof it.slug !== 'string' || !it.slug) continue;
    const number =
      typeof it.number === 'number'
        ? it.number
        : parseInt(String(it.slug).replace(/\D+/g, ''), 10) || entries.length + 1;
    entries.push({
      slug: it.slug,
      title: it.title ? cleanText(it.title) : 'Chapter ' + number,
      number,
      createdAt: it.createdAt,
    });
  }
  entries.sort((a, b) => a.number - b.number);
  return entries;
}

/**
 * Chapter body: the inner HTML of <div class="ln-prose">. The div is
 * located by class, then matched to its closing tag by depth scan so
 * nested markup can never truncate the content.
 */
export function parseChapterContent(html: string): string {
  checkSize(html);
  const marker = html.indexOf('ln-prose');
  if (marker < 0) return '';
  const tagStart = html.lastIndexOf('<div', marker);
  if (tagStart < 0) return '';
  const tagEnd = html.indexOf('>', marker);
  if (tagEnd < 0) return '';
  let depth = 1;
  let i = tagEnd + 1;
  const contentStart = i;
  const divRe = /<\/?div\b[^>]*>/g;
  divRe.lastIndex = i;
  let m: RegExpExecArray | null;
  let contentEnd = -1;
  while ((m = divRe.exec(html)) !== null) {
    if (m[0].startsWith('</')) {
      depth--;
      if (depth === 0) {
        contentEnd = m.index;
        break;
      }
    } else if (!m[0].endsWith('/>')) {
      depth++;
    }
  }
  if (contentEnd < 0) return '';
  let content = html.slice(contentStart, contentEnd);
  content = content
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  return content;
}
