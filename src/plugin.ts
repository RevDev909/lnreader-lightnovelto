// LightNovel.to plugin for LNReader.
// Site: https://lightnovel.to — Next.js, server-rendered pages.
// Catalog/search: /novels?sort=...&page=N (24 cards/page).
// Novel details: schema.org JSON-LD block on the novel page.
// Chapter list: /api/novel-chapters?slug=<slug> (JSON).
// Chapter text: <div class="ln-prose"> on the chapter page.
//
// Rules that keep it working on old app versions (learned the hard way):
// - The bundle is compiled to ES5, but SOURCE must also avoid ES2015+
//   runtime APIs (no polyfills in the host): no String.fromCodePoint
//   (use a fromCharCode surrogate-pair helper), no Array.prototype.at,
//   no Object.hasOwn, no Promise.prototype.finally. Promise, Map, Set,
//   String.prototype.includes/startsWith are fine.
// - No native `fetch` — the host injects @libs/fetch via require.
import {
  parseCatalogCards,
  parseChapterContent,
  parseChapterList,
  parseNovelDetails,
} from './parsers';
import type { Plugin } from './lnreader-api';

// The host app injects these via `require`, but their exact shape has varied
// across app versions, so resolve them defensively at load with fallbacks.
declare function require(name: string): any;

function loadFetchLib(): {
  fetchText?: (url: string) => Promise<string>;
  fetchApi?: (url: string) => Promise<{ text: () => Promise<string> }>;
} {
  try {
    return require('@libs/fetch') || {};
  } catch (e) {
    return {};
  }
}

function loadNovelStatus(): Record<string, string> {
  try {
    const lib = require('@libs/novelStatus');
    if (lib && lib.NovelStatus) return lib.NovelStatus;
  } catch (e) {
    // fall through to the built-in copy below
  }
  // Built-in copy of the NovelStatus string enum, so the plugin keeps
  // working even if the host does not provide @libs/novelStatus.
  return {
    Unknown: 'Unknown',
    Ongoing: 'Ongoing',
    Completed: 'Completed',
    Licensed: 'Licensed',
    PublishingFinished: 'Publishing Finished',
    Cancelled: 'Cancelled',
    OnHiatus: 'On Hiatus',
  };
}

const fetchLib = loadFetchLib();
const NovelStatus = loadNovelStatus();

// --- Resilient fetching -------------------------------------------------
// Chapter downloads are one HTTP request per chapter, so a single flaky
// request used to fail the whole chapter. This wrapper adds a timeout and
// retries transient failures with exponential backoff. It never fires
// parallel requests and never retries definite client errors, so the site
// is treated respectfully.
const FETCH_TIMEOUT_MS = 30000;
const MAX_FETCH_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    if (typeof setTimeout === 'function') setTimeout(resolve, ms);
    else resolve();
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: any = undefined;
  const timeout = new Promise<T>((_, reject) => {
    if (typeof setTimeout === 'function') {
      timer = setTimeout(() => reject(new Error('Request timed out')), ms);
    }
  });
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
  };
  return Promise.race([p, timeout]).then(
    v => {
      clear();
      return v;
    },
    e => {
      clear();
      throw e;
    },
  );
}

interface RawFetchResult {
  status?: number;
  retryAfter?: number;
  text: string;
}

async function fetchRaw(url: string): Promise<RawFetchResult> {
  if (typeof fetchLib.fetchApi === 'function') {
    const res: any = await fetchLib.fetchApi(url);
    const status =
      res && typeof res.status === 'number' ? res.status : undefined;
    const text =
      res && typeof res.text === 'function' ? await res.text() : '';
    // Retry-After only matters on 429; parse it defensively and cap it
    // at 10s so a hostile header can't stall the retry loop.
    let retryAfter: number | undefined;
    const rawHeader =
      res && res.headers && typeof res.headers.get === 'function'
        ? res.headers.get('retry-after')
        : undefined;
    if (typeof rawHeader === 'string') {
      const parsed = parseInt(rawHeader, 10);
      if (!isNaN(parsed) && parsed >= 0) retryAfter = Math.min(parsed, 10);
    }
    return { status, retryAfter, text };
  }
  if (typeof fetchLib.fetchText === 'function') {
    return { text: await fetchLib.fetchText(url) };
  }
  throw new Error('No fetch implementation provided by the host app');
}

/** Pull an HTTP status out of errors like "HTTP 503". */
function statusFromError(e: any): number | undefined {
  const m = /HTTP (\d{3})/.exec(String((e && e.message) || e || ''));
  return m ? parseInt(m[1], 10) : undefined;
}

async function fetchText(url: string): Promise<string> {
  let lastError: any = new Error('Request failed');
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    let status: number | undefined;
    let retryAfterSecs: number | undefined;
    try {
      const res = await withTimeout(fetchRaw(url), FETCH_TIMEOUT_MS);
      status = res.status;
      retryAfterSecs = res.retryAfter;
      if (status === 429 || (status !== undefined && status >= 500)) {
        throw new Error('Server responded with HTTP ' + status);
      }
      return res.text;
    } catch (e) {
      lastError = e;
      if (status === undefined) status = statusFromError(e);
      // Attach the status so callers (and the app) can tell a site
      // block or outage apart from a plugin bug.
      (lastError as any).status = status;
      const msg = String((e && (e as Error).message) || e || '');
      const retryable =
        status === undefined ||
        status === 429 ||
        status >= 500 ||
        /timed out|timeout|Network|network|fetch failed/i.test(msg);
      if (!retryable || attempt === MAX_FETCH_ATTEMPTS) throw lastError;
      const waitSecs =
        status === 429 && retryAfterSecs !== undefined
          ? retryAfterSecs
          : Math.pow(2, attempt - 1);
      await sleep(1000 * waitSecs); // 1s, then 2s, or Retry-After on 429
    }
  }
  throw lastError;
}

// --- Plugin -------------------------------------------------------------

class LightNovelToPlugin implements Plugin.PluginBase {
  id = 'lightnovelto';
  name = 'LightNovel.to';
  icon = 'src/en/lightnovelto/icon.png';
  site = 'https://lightnovel.to';
  version = '1.0.3';

  async popularNovels(
    pageNo: number,
    options: Plugin.PopularNovelsOptions,
  ): Promise<Plugin.NovelItem[]> {
    const sort =
      options && options.showLatestNovels ? 'latest' : 'popular';
    const html = await fetchText(
      `${this.site}/novels?sort=${sort}&page=${pageNo}`,
    );
    return parseCatalogCards(html);
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const slug = novelPath
      .replace(/^\/novel\//, '')
      .replace(/\/+$/, '');
    const html = await fetchText(this.site + novelPath);
    const details = parseNovelDetails(html);
    if (!details.name) {
      throw new Error('Could not parse the novel page for ' + novelPath);
    }
    const listText = await fetchText(
      `${this.site}/api/novel-chapters?slug=${encodeURIComponent(slug)}`,
    );
    const entries = parseChapterList(listText);
    const chapters: Plugin.ChapterItem[] = entries.map(e => ({
      name: e.title,
      path: `/novel/${slug}/${e.slug}`,
      releaseTime: e.createdAt,
      chapterNumber: e.number,
    }));
    // schema.org creativeWorkStatus: "Completed" | "Incomplete" (ongoing).
    const status =
      details.statusRaw === 'Completed'
        ? NovelStatus.Completed
        : details.statusRaw === 'Incomplete'
          ? NovelStatus.Ongoing
          : NovelStatus.Unknown;
    return {
      path: novelPath,
      name: details.name,
      cover: details.cover || undefined,
      summary: details.summary || undefined,
      author: details.author || undefined,
      genres: details.genres.length ? details.genres.join(', ') : undefined,
      status,
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const html = await fetchText(this.site + chapterPath);
    const content = parseChapterContent(html);
    if (!content) {
      throw new Error('Chapter content not found on the page');
    }
    return content;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const html = await fetchText(
      `${this.site}/novels?search=${encodeURIComponent(searchTerm)}&page=${pageNo}`,
    );
    return parseCatalogCards(html);
  }

  resolveUrl = (path: string, _isNovel?: boolean) => {
    if (/^https?:\/\//i.test(path)) return path;
    if (path.indexOf('//') === 0) return 'https:' + path;
    return this.site + path;
  };
}

export default new LightNovelToPlugin();
