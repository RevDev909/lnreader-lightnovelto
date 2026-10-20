// Live parser tests for the LightNovel.to plugin.
// Runs against the real site; every check must pass.
import {
  parseCatalogCards,
  parseChapterContent,
  parseChapterList,
  parseNovelDetails,
} from './parsers.bundle.mjs';

const SITE = 'https://lightnovel.to';
let failures = 0;

function check(label, ok, extra) {
  if (ok) {
    console.log('  PASS', label);
  } else {
    failures++;
    console.log('  FAIL', label, extra !== undefined ? '-> ' + extra : '');
  }
}

async function get(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
    },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return res.text();
}

console.log('catalog page 1 (popular):');
const page1 = parseCatalogCards(await get(SITE + '/novels?sort=popular&page=1'));
check('24 cards', page1.length === 24, page1.length);
check(
  'cards have name/path/cover',
  page1.every(c => c.name && c.path.startsWith('/novel/') && c.cover),
);
check(
  'card covers are thumbs',
  page1.every(c => !c.cover || c.cover.includes('_thumb.webp')),
);

console.log('catalog page 2 differs:');
const page2 = parseCatalogCards(await get(SITE + '/novels?sort=popular&page=2'));
check('24 cards on page 2', page2.length === 24, page2.length);
check(
  'page 2 first card != page 1 first card',
  page2.length && page1.length && page2[0].path !== page1[0].path,
);

console.log('search "mushoku":');
const search = parseCatalogCards(
  await get(SITE + '/novels?search=mushoku&page=1'),
);
check('search returns results', search.length > 0, search.length);
check(
  'search finds Mushoku Tensei',
  search.some(c => c.path === '/novel/mushoku-tensei'),
  search.map(c => c.path).join(','),
);

console.log('novel details (Mushoku Tensei):');
const details = parseNovelDetails(await get(SITE + '/novel/mushoku-tensei'));
check('name', details.name === 'Mushoku Tensei', details.name);
check('status Completed', details.statusRaw === 'Completed', details.statusRaw);
check('summary long', details.summary.length > 100, details.summary.length);
check('genres >= 5', details.genres.length >= 5, details.genres.length);
check('author present', details.author.length > 0, details.author);
check(
  'cover is full-size',
  details.cover.includes('mushoku-tensei') && !details.cover.includes('_thumb'),
  details.cover,
);

console.log('chapter list API (Mushoku Tensei):');
const chapters = parseChapterList(
  await get(SITE + '/api/novel-chapters?slug=mushoku-tensei'),
);
check('285 chapters', chapters.length === 285, chapters.length);
check(
  'ascending, first chapter-1, last chapter-285',
  chapters.length > 0 &&
    chapters[0].slug === 'chapter-1' &&
    chapters[chapters.length - 1].slug === 'chapter-285',
);
check(
  'all entries have titles and dates',
  chapters.every(c => c.title && c.createdAt),
);

console.log('chapter content (Mushoku Tensei ch.1):');
const content = parseChapterContent(
  await get(SITE + '/novel/mushoku-tensei/chapter-1'),
);
check('content long', content.length > 5000, content.length);
check('content has story text', content.includes('homeless'));
check('content is paragraphs', content.startsWith('<p>'));
check('no scripts', !content.includes('<script'));
check('no site chrome', !content.includes('ln-foot') && !content.includes('ln-top'));

console.log(
  failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED',
);
process.exit(failures === 0 ? 0 : 1);
