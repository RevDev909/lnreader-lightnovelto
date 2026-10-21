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
    : (() => {
        if (data === null || typeof data !== 'object') {
          throw new Error('Chapter list response had an unexpected shape');
        }
        const chapters = (data as { chapters?: unknown }).chapters;
        if (!Array.isArray(chapters)) {
          // An error payload or a changed shape must surface as a
          // clear error — never as a novel that silently shows zero
          // chapters. A genuine empty array stays valid.
          throw new Error('Chapter list response had an unexpected shape');
        }
        return chapters;
      })();
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
 * Chapter body: the inner HTML of <div class="ln-prose">. Scripts,
 * styles and comments are removed before locating the div, so a
 * `.ln-prose` CSS rule, a JS reference to the class, or a comment
 * earlier in the page can never mislocate the content; the div is
 * then matched to its closing tag by depth scan so nested markup
 * can never truncate the content.
 */
/**
 * Strip executable content from chapter HTML before it reaches the
 * reader: scripts, frames, form elements, inline event handlers and
 * javascript:/vbscript: URLs (tested after stripping control chars
 * and lowercasing, so java<TAB>script: and mixed-case smuggling fail).
 */
/**
 * Strip executable content from chapter HTML before it reaches the
 * reader: scripts, frames, form elements, inline event handlers and
 * javascript:/vbscript:/data:text/html URLs. URL values are checked
 * regardless of quoting (double, single, or unquoted) and AFTER
 * decoding HTML entities, so 'javascript:...' and '&#106;avascript:...'
 * are caught equally; schemes are then tested after stripping control
 * characters and lowercasing, so mixed-case and control-character
 * smuggling fail too.
 */
export function sanitizeChapterHtml(html: string): string {
  return html
    .replace(
      /<(script|style|noscript|iframe|object|embed|form)\b[\s\S]*?<\/\1\s*>/gi,
      '',
    )
    .replace(
      /<(script|style|noscript|iframe|object|embed|form|link|meta|base)\b[^>]*>/gi,
      '',
    )
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/\sstyle\s*=\s*"[^"]*"/gi, '')
    .replace(/\sstyle\s*=\s*'[^']*'/gi, '')
    .replace(/\s(?:href|src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, function (m: string) {
      return isSafeUrlValue(m) ? m : '';
    });
}

// Decode HTML character references the way a browser decodes an
// attribute value: numeric (decimal and hex) plus the common named
// references, repeated so double-encoding can't smuggle a scheme past
// the check. Decoding only ever makes the check stricter, never looser.
function decodeEntities(value: string): string {
  let out = value;
  for (let i = 0; i < 3; i++) {
    const next = out
      .replace(/&#(\d+);/g, function (_m: string, code: string) {
        const n = parseInt(code, 10);
        return !isNaN(n) && n >= 0 && n <= 0x10ffff ? String.fromCharCode(n) : _m;
      })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_m: string, code: string) {
        const n = parseInt(code, 16);
        return !isNaN(n) && n >= 0 && n <= 0x10ffff ? String.fromCharCode(n) : _m;
      })
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    if (next === out) break;
    out = next;
  }
  return out;
}

function isSafeUrlValue(attr: string): boolean {
  let raw = '';
  const quoted = /"([^"]*)"|'([^']*)'/.exec(attr);
  if (quoted) {
    raw = quoted[1] !== undefined ? quoted[1] : quoted[2];
  } else {
    const unquoted = /=\s*([^\s>]+)/.exec(attr);
    if (unquoted) raw = unquoted[1];
  }
  const clean = decodeEntities(raw)
    .split('')
    .filter(function (ch: string) {
      const code = ch.charCodeAt(0);
      return code > 32 && code !== 127;
    })
    .join('')
    .toLowerCase();
  if (/^(javascript|vbscript)\s*:/.test(clean)) return false;
  if (/^data\s*:\s*text\/html/.test(clean)) return false;
  return true;
}

export function parseChapterContent(html: string): string {
  checkSize(html);
  const clean = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  // Find the real opening tag whose class list contains ln-prose —
  // never a bare indexOf('ln-prose'), which can land inside a style
  // rule, a script, or a comment and grab the wrong div (or none).
  const openRe = /<div\b[^>]*>/g;
  let m: RegExpExecArray | null;
  let tagEnd = -1;
  while ((m = openRe.exec(clean)) !== null) {
    const cls = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[0]);
    const tokens = (cls && (cls[1] !== undefined ? cls[1] : cls[2])) || '';
    if (/(^|\s)ln-prose(\s|$)/.test(tokens)) {
      tagEnd = m.index + m[0].length;
      break;
    }
  }
  if (tagEnd < 0) return '';
  let depth = 1;
  const contentStart = tagEnd;
  const divRe = /<\/?div\b[^>]*>/g;
  divRe.lastIndex = contentStart;
  let contentEnd = -1;
  while ((m = divRe.exec(clean)) !== null) {
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
  return sanitizeChapterHtml(clean.slice(contentStart, contentEnd).trim());
}
