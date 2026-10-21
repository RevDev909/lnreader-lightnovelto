"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = function(cb, mod) {
  return function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
};

// .tsc-build/parsers.js
var require_parsers = __commonJS({
  ".tsc-build/parsers.js": function(exports2) {
    "use strict";
    var __values = exports2 && exports2.__values || function(o) {
      var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
      if (m) return m.call(o);
      if (o && typeof o.length === "number") return {
        next: function() {
          if (o && i >= o.length) o = void 0;
          return { value: o && o[i++], done: !o };
        }
      };
      throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.MAX_PAGE_CHARS = void 0;
    exports2.decodeHtmlEntities = decodeHtmlEntities;
    exports2.parseCatalogCards = parseCatalogCards;
    exports2.parseNovelDetails = parseNovelDetails;
    exports2.parseChapterList = parseChapterList;
    exports2.sanitizeChapterHtml = sanitizeChapterHtml;
    exports2.parseChapterContent = parseChapterContent;
    exports2.MAX_PAGE_CHARS = 1e7;
    var HTML_ENTITY_CHARS = {
      amp: "&",
      quot: '"',
      "#39": "'",
      apos: "'",
      lt: "<",
      gt: ">",
      nbsp: " ",
      ndash: "\u2013",
      mdash: "\u2014",
      hellip: "\u2026",
      lsquo: "\u2018",
      rsquo: "\u2019",
      ldquo: "\u201C",
      rdquo: "\u201D"
    };
    function codePointToString(cp) {
      if (cp < 65536)
        return String.fromCharCode(cp);
      var v = cp - 65536;
      return String.fromCharCode(55296 + (v >> 10), 56320 + (v & 1023));
    }
    function decodeHtmlEntities(s) {
      return s.replace(/&(amp|quot|#39|apos|lt|gt|nbsp|ndash|mdash|hellip|lsquo|rsquo|ldquo|rdquo);/g, function(m, e) {
        var _a;
        return (_a = HTML_ENTITY_CHARS[e]) !== null && _a !== void 0 ? _a : m;
      }).replace(/&#(\d+);/g, function(m, d) {
        var cp = parseInt(d, 10);
        return cp > 0 && cp <= 1114111 ? codePointToString(cp) : m;
      }).replace(/&#x([0-9a-fA-F]+);/g, function(m, h) {
        var cp = parseInt(h, 16);
        return cp > 0 && cp <= 1114111 ? codePointToString(cp) : m;
      });
    }
    function stripTags(s) {
      return s.replace(/<[^>]*>/g, "");
    }
    function cleanText(s) {
      return decodeHtmlEntities(stripTags(s)).replace(/\s+/g, " ").trim();
    }
    function checkSize(html) {
      if (html.length > exports2.MAX_PAGE_CHARS)
        throw new Error("Page too large to parse");
    }
    function parseCatalogCards(html) {
      checkSize(html);
      var cards = [];
      var seen = /* @__PURE__ */ new Set();
      var anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
      var m;
      while ((m = anchorRe.exec(html)) !== null) {
        var attrs = m[1];
        if (!/\bln-ncard\b/.test(attrs))
          continue;
        var href = /\bhref="([^"]+)"/.exec(attrs);
        if (!href || !href[1].startsWith("/novel/"))
          continue;
        var path = href[1];
        if (seen.has(path))
          continue;
        seen.add(path);
        var body = m[2];
        var name_1 = "";
        var h3 = /<h3\b[^>]*>([\s\S]*?)<\/h3>/.exec(body);
        if (h3)
          name_1 = cleanText(h3[1]);
        var cover = void 0;
        var img = /<img\b([^>]*)>/.exec(body);
        if (img) {
          var src = /\bsrc="([^"]+)"/.exec(img[1]);
          if (src)
            cover = src[1];
          if (!name_1) {
            var alt = /\balt="([^"]*)"/.exec(img[1]);
            if (alt)
              name_1 = cleanText(alt[1]);
          }
        }
        if (!name_1)
          continue;
        cards.push({ name: name_1, path: path, cover: cover });
      }
      return cards;
    }
    function findLdBook(html) {
      var e_1, _a;
      var re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
      var m;
      while ((m = re.exec(html)) !== null) {
        try {
          var data = JSON.parse(m[1]);
          var graph = Array.isArray(data["@graph"]) ? data["@graph"] : [data];
          try {
            for (var graph_1 = (e_1 = void 0, __values(graph)), graph_1_1 = graph_1.next(); !graph_1_1.done; graph_1_1 = graph_1.next()) {
              var node = graph_1_1.value;
              var n = node;
              if (n && n["@type"] === "Book")
                return n;
            }
          } catch (e_1_1) {
            e_1 = { error: e_1_1 };
          } finally {
            try {
              if (graph_1_1 && !graph_1_1.done && (_a = graph_1.return)) _a.call(graph_1);
            } finally {
              if (e_1) throw e_1.error;
            }
          }
        } catch (e) {
        }
      }
      return null;
    }
    function parseNovelDetails(html) {
      var e_2, _a;
      checkSize(html);
      var book = findLdBook(html);
      var name = book && book.name ? cleanText(book.name) : "";
      if (!name) {
        var h1 = /<h1\b[^>]*class="[^"]*ln-dtitle[^"]*"[^>]*>([\s\S]*?)<\/h1>/.exec(html);
        if (h1)
          name = cleanText(h1[1]);
      }
      var cover = book && book.image ? book.image : "";
      if (!cover) {
        var dc = /<div\b[^>]*class="[^"]*ln-dcv[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html);
        if (dc) {
          var img = /\bsrc="([^"]+)"/.exec(dc[1]);
          if (img)
            cover = img[1];
        }
      }
      var authorNames = [];
      if (book && Array.isArray(book.author)) {
        try {
          for (var _b = __values(book.author), _c = _b.next(); !_c.done; _c = _b.next()) {
            var a = _c.value;
            if (a && a.name)
              authorNames.push(cleanText(a.name));
          }
        } catch (e_2_1) {
          e_2 = { error: e_2_1 };
        } finally {
          try {
            if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
          } finally {
            if (e_2) throw e_2.error;
          }
        }
      }
      return {
        name: name,
        cover: cover,
        summary: book && book.description ? cleanText(book.description) : "",
        author: authorNames.join(", "),
        genres: book && Array.isArray(book.genre) ? book.genre.map(function(g) {
          return cleanText(String(g));
        }).filter(function(g) {
          return g.length > 0;
        }) : [],
        statusRaw: book && book.creativeWorkStatus ? book.creativeWorkStatus : ""
      };
    }
    function parseChapterList(text) {
      var e_3, _a;
      checkSize(text);
      var data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error("Chapter list response was not valid JSON");
      }
      var raw = Array.isArray(data) ? data : (function() {
        if (data === null || typeof data !== "object") {
          throw new Error("Chapter list response had an unexpected shape");
        }
        var chapters = data.chapters;
        if (!Array.isArray(chapters)) {
          throw new Error("Chapter list response had an unexpected shape");
        }
        return chapters;
      })();
      var entries = [];
      try {
        for (var raw_1 = __values(raw), raw_1_1 = raw_1.next(); !raw_1_1.done; raw_1_1 = raw_1.next()) {
          var item = raw_1_1.value;
          var it = item;
          if (!it || typeof it.slug !== "string" || !it.slug)
            continue;
          var number = typeof it.number === "number" ? it.number : parseInt(String(it.slug).replace(/\D+/g, ""), 10) || entries.length + 1;
          entries.push({
            slug: it.slug,
            title: it.title ? cleanText(it.title) : "Chapter " + number,
            number: number,
            createdAt: it.createdAt
          });
        }
      } catch (e_3_1) {
        e_3 = { error: e_3_1 };
      } finally {
        try {
          if (raw_1_1 && !raw_1_1.done && (_a = raw_1.return)) _a.call(raw_1);
        } finally {
          if (e_3) throw e_3.error;
        }
      }
      entries.sort(function(a, b) {
        return a.number - b.number;
      });
      return entries;
    }
    function sanitizeChapterHtml(html) {
      var noExecutable = html.replace(/<(script|style|noscript|iframe|object|embed|form)\b[\s\S]*?<\/\1\s*>/gi, "").replace(/<(script|style|noscript|iframe|object|embed|form|link|meta|base)\b[^>]*>/gi, "");
      return noExecutable.replace(/<[^>]*>/g, function(tag) {
        return tag.replace(/[\s/](on\w+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/[\s/]style\s*=\s*(?:"[^"]*"|'[^']*')/gi, "").replace(/[\s/](?:href|src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, function(m) {
          return isSafeUrlValue(m) ? m : "";
        });
      });
    }
    function decodeEntities(value) {
      var out = value;
      for (var i = 0; i < 3; i++) {
        var next = out.replace(/&#(\d+);?/g, function(_m, code) {
          var n = parseInt(code, 10);
          return !isNaN(n) && n >= 0 && n <= 1114111 ? String.fromCharCode(n) : _m;
        }).replace(/&#[xX]([0-9a-fA-F]+);?/g, function(_m, code) {
          var n = parseInt(code, 16);
          return !isNaN(n) && n >= 0 && n <= 1114111 ? String.fromCharCode(n) : _m;
        }).replace(/&colon;/g, ":").replace(/&Tab;/g, "	").replace(/&NewLine;/g, "\n").replace(/&sol;/g, "/").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp(?![a-zA-Z0-9=])/g, "&").replace(/&lt(?![a-zA-Z0-9=])/g, "<").replace(/&gt(?![a-zA-Z0-9=])/g, ">").replace(/&quot(?![a-zA-Z0-9=])/g, '"');
        if (next === out)
          break;
        out = next;
      }
      return out;
    }
    function attrValue(attr) {
      var eq = attr.indexOf("=");
      if (eq < 0)
        return "";
      var rest = attr.slice(eq + 1).replace(/^\s+/, "");
      if (rest.charAt(0) === '"') {
        var end = rest.indexOf('"', 1);
        return end < 0 ? rest.slice(1) : rest.slice(1, end);
      }
      if (rest.charAt(0) === "'") {
        var end = rest.indexOf("'", 1);
        return end < 0 ? rest.slice(1) : rest.slice(1, end);
      }
      var m = /^[^\s>]+/.exec(rest);
      return m ? m[0] : "";
    }
    function isSafeUrlValue(attr) {
      var clean = decodeEntities(attrValue(attr)).split("").filter(function(ch) {
        var code = ch.charCodeAt(0);
        return code > 32 && code !== 127;
      }).join("").toLowerCase();
      if (/^(javascript|vbscript)\s*:/.test(clean))
        return false;
      if (/^data\s*:\s*text\/html/.test(clean))
        return false;
      return true;
    }
    function parseChapterContent(html) {
      checkSize(html);
      var clean = html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
      var openRe = /<div\b[^>]*>/g;
      var m;
      var tagEnd = -1;
      while ((m = openRe.exec(clean)) !== null) {
        var cls = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[0]);
        var tokens = cls && (cls[1] !== void 0 ? cls[1] : cls[2]) || "";
        if (/(^|\s)ln-prose(\s|$)/.test(tokens)) {
          tagEnd = m.index + m[0].length;
          break;
        }
      }
      if (tagEnd < 0)
        return "";
      var depth = 1;
      var contentStart = tagEnd;
      var divRe = /<\/?div\b[^>]*>/g;
      divRe.lastIndex = contentStart;
      var contentEnd = -1;
      while ((m = divRe.exec(clean)) !== null) {
        if (m[0].startsWith("</")) {
          depth--;
          if (depth === 0) {
            contentEnd = m.index;
            break;
          }
        } else if (!m[0].endsWith("/>")) {
          depth++;
        }
      }
      if (contentEnd < 0)
        return "";
      return sanitizeChapterHtml(clean.slice(contentStart, contentEnd).trim());
    }
  }
});

// .tsc-build/plugin.js
var __awaiter = exports && exports.__awaiter || function(thisArg, _arguments, P, generator) {
  function adopt(value) {
    return value instanceof P ? value : new P(function(resolve) {
      resolve(value);
    });
  }
  return new (P || (P = Promise))(function(resolve, reject) {
    function fulfilled(value) {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    }
    function rejected(value) {
      try {
        step(generator["throw"](value));
      } catch (e) {
        reject(e);
      }
    }
    function step(result) {
      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
    }
    step((generator = generator.apply(thisArg, _arguments || [])).next());
  });
};
var __generator = exports && exports.__generator || function(thisArg, body) {
  var _ = { label: 0, sent: function() {
    if (t[0] & 1) throw t[1];
    return t[1];
  }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
  return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() {
    return this;
  }), g;
  function verb(n) {
    return function(v) {
      return step([n, v]);
    };
  }
  function step(op) {
    if (f) throw new TypeError("Generator is already executing.");
    while (g && (g = 0, op[0] && (_ = 0)), _) try {
      if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
      if (y = 0, t) op = [op[0] & 2, t.value];
      switch (op[0]) {
        case 0:
        case 1:
          t = op;
          break;
        case 4:
          _.label++;
          return { value: op[1], done: false };
        case 5:
          _.label++;
          y = op[1];
          op = [0];
          continue;
        case 7:
          op = _.ops.pop();
          _.trys.pop();
          continue;
        default:
          if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
            _ = 0;
            continue;
          }
          if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
            _.label = op[1];
            break;
          }
          if (op[0] === 6 && _.label < t[1]) {
            _.label = t[1];
            t = op;
            break;
          }
          if (t && _.label < t[2]) {
            _.label = t[2];
            _.ops.push(op);
            break;
          }
          if (t[2]) _.ops.pop();
          _.trys.pop();
          continue;
      }
      op = body.call(thisArg, _);
    } catch (e) {
      op = [6, e];
      y = 0;
    } finally {
      f = t = 0;
    }
    if (op[0] & 5) throw op[1];
    return { value: op[0] ? op[1] : void 0, done: true };
  }
};
Object.defineProperty(exports, "__esModule", { value: true });
var parsers_1 = require_parsers();
function loadFetchLib() {
  try {
    return require("@libs/fetch") || {};
  } catch (e) {
    return {};
  }
}
function loadNovelStatus() {
  try {
    var lib = require("@libs/novelStatus");
    if (lib && lib.NovelStatus)
      return lib.NovelStatus;
  } catch (e) {
  }
  return {
    Unknown: "Unknown",
    Ongoing: "Ongoing",
    Completed: "Completed",
    Licensed: "Licensed",
    PublishingFinished: "Publishing Finished",
    Cancelled: "Cancelled",
    OnHiatus: "On Hiatus"
  };
}
var fetchLib = loadFetchLib();
var NovelStatus = loadNovelStatus();
var FETCH_TIMEOUT_MS = 3e4;
var MAX_FETCH_ATTEMPTS = 3;
function sleep(ms) {
  return new Promise(function(resolve) {
    if (typeof setTimeout === "function")
      setTimeout(resolve, ms);
    else
      resolve();
  });
}
function withTimeout(p, ms) {
  var timer = void 0;
  var timeout = new Promise(function(_, reject) {
    if (typeof setTimeout === "function") {
      timer = setTimeout(function() {
        return reject(new Error("Request timed out"));
      }, ms);
    }
  });
  var clear = function() {
    if (timer !== void 0)
      clearTimeout(timer);
  };
  return Promise.race([p, timeout]).then(function(v) {
    clear();
    return v;
  }, function(e) {
    clear();
    throw e;
  });
}
function fetchRaw(url) {
  return __awaiter(this, void 0, void 0, function() {
    var res, status_1, text, _a, retryAfter, rawHeader, parsed;
    var _b;
    return __generator(this, function(_c) {
      switch (_c.label) {
        case 0:
          if (!(typeof fetchLib.fetchApi === "function")) return [3, 5];
          return [4, fetchLib.fetchApi(url)];
        case 1:
          res = _c.sent();
          status_1 = res && typeof res.status === "number" ? res.status : void 0;
          if (!(res && typeof res.text === "function")) return [3, 3];
          return [4, res.text()];
        case 2:
          _a = _c.sent();
          return [3, 4];
        case 3:
          _a = "";
          _c.label = 4;
        case 4:
          text = _a;
          retryAfter = void 0;
          rawHeader = res && res.headers && typeof res.headers.get === "function" ? res.headers.get("retry-after") : void 0;
          if (typeof rawHeader === "string") {
            parsed = parseInt(rawHeader, 10);
            if (!isNaN(parsed) && parsed >= 0)
              retryAfter = Math.min(parsed, 10);
          }
          return [2, { status: status_1, retryAfter: retryAfter, text: text }];
        case 5:
          if (!(typeof fetchLib.fetchText === "function")) return [3, 7];
          _b = {};
          return [4, fetchLib.fetchText(url)];
        case 6:
          return [2, (_b.text = _c.sent(), _b)];
        case 7:
          throw new Error("No fetch implementation provided by the host app");
      }
    });
  });
}
function statusFromError(e) {
  var m = /HTTP (\d{3})/.exec(String(e && e.message || e || ""));
  return m ? parseInt(m[1], 10) : void 0;
}
function fetchText(url) {
  return __awaiter(this, void 0, void 0, function() {
    var lastError, attempt, status_2, retryAfterSecs, res, e_1, msg, retryable, waitSecs;
    return __generator(this, function(_a) {
      switch (_a.label) {
        case 0:
          lastError = new Error("Request failed");
          attempt = 1;
          _a.label = 1;
        case 1:
          if (!(attempt <= MAX_FETCH_ATTEMPTS)) return [3, 7];
          status_2 = void 0;
          retryAfterSecs = void 0;
          _a.label = 2;
        case 2:
          _a.trys.push([2, 4, , 6]);
          return [4, withTimeout(fetchRaw(url), FETCH_TIMEOUT_MS)];
        case 3:
          res = _a.sent();
          status_2 = res.status;
          retryAfterSecs = res.retryAfter;
          if (status_2 === 429 || status_2 !== void 0 && status_2 >= 500) {
            throw new Error("Server responded with HTTP " + status_2);
          }
          return [2, res.text];
        case 4:
          e_1 = _a.sent();
          lastError = e_1;
          if (status_2 === void 0)
            status_2 = statusFromError(e_1);
          lastError.status = status_2;
          msg = String(e_1 && e_1.message || e_1 || "");
          retryable = status_2 === void 0 || status_2 === 429 || status_2 >= 500 || /timed out|timeout|Network|network|fetch failed/i.test(msg);
          if (!retryable || attempt === MAX_FETCH_ATTEMPTS)
            throw lastError;
          waitSecs = status_2 === 429 && retryAfterSecs !== void 0 ? retryAfterSecs : Math.pow(2, attempt - 1);
          return [4, sleep(1e3 * waitSecs)];
        case 5:
          _a.sent();
          return [3, 6];
        case 6:
          attempt++;
          return [3, 1];
        case 7:
          throw lastError;
      }
    });
  });
}
var LightNovelToPlugin = (
  /** @class */
  (function() {
    function LightNovelToPlugin2() {
      var _this = this;
      this.id = "lightnovelto";
      this.name = "LightNovel.to";
      this.icon = "src/en/lightnovelto/icon.png";
      this.site = "https://lightnovel.to";
      this.version = "1.0.5";
      this.resolveUrl = function(path, _isNovel) {
        if (/^https?:\/\//i.test(path))
          return path;
        if (path.indexOf("//") === 0)
          return "https:" + path;
        return _this.site + path;
      };
    }
    LightNovelToPlugin2.prototype.popularNovels = function(pageNo, options) {
      return __awaiter(this, void 0, void 0, function() {
        var sort, html;
        return __generator(this, function(_a) {
          switch (_a.label) {
            case 0:
              sort = options && options.showLatestNovels ? "latest" : "popular";
              return [4, fetchText("".concat(this.site, "/novels?sort=").concat(sort, "&page=").concat(pageNo))];
            case 1:
              html = _a.sent();
              return [2, (0, parsers_1.parseCatalogCards)(html)];
          }
        });
      });
    };
    LightNovelToPlugin2.prototype.parseNovel = function(novelPath) {
      return __awaiter(this, void 0, void 0, function() {
        var slug, html, details, listText, entries, chapters, status;
        return __generator(this, function(_a) {
          switch (_a.label) {
            case 0:
              slug = novelPath.replace(/^\/novel\//, "").replace(/\/+$/, "");
              return [4, fetchText(this.site + novelPath)];
            case 1:
              html = _a.sent();
              details = (0, parsers_1.parseNovelDetails)(html);
              if (!details.name) {
                throw new Error("Could not parse the novel page for " + novelPath);
              }
              return [4, fetchText("".concat(this.site, "/api/novel-chapters?slug=").concat(encodeURIComponent(slug)))];
            case 2:
              listText = _a.sent();
              entries = (0, parsers_1.parseChapterList)(listText);
              chapters = entries.map(function(e) {
                return {
                  name: e.title,
                  path: "/novel/".concat(slug, "/").concat(e.slug),
                  releaseTime: e.createdAt,
                  chapterNumber: e.number
                };
              });
              status = details.statusRaw === "Completed" ? NovelStatus.Completed : details.statusRaw === "Incomplete" ? NovelStatus.Ongoing : NovelStatus.Unknown;
              return [2, {
                path: novelPath,
                name: details.name,
                cover: details.cover || void 0,
                summary: details.summary || void 0,
                author: details.author || void 0,
                genres: details.genres.length ? details.genres.join(", ") : void 0,
                status: status,
                chapters: chapters
              }];
          }
        });
      });
    };
    LightNovelToPlugin2.prototype.parseChapter = function(chapterPath) {
      return __awaiter(this, void 0, void 0, function() {
        var html, content;
        return __generator(this, function(_a) {
          switch (_a.label) {
            case 0:
              return [4, fetchText(this.site + chapterPath)];
            case 1:
              html = _a.sent();
              content = (0, parsers_1.parseChapterContent)(html);
              if (!content) {
                throw new Error("Chapter content not found on the page");
              }
              return [2, content];
          }
        });
      });
    };
    LightNovelToPlugin2.prototype.searchNovels = function(searchTerm, pageNo) {
      return __awaiter(this, void 0, void 0, function() {
        var html;
        return __generator(this, function(_a) {
          switch (_a.label) {
            case 0:
              return [4, fetchText("".concat(this.site, "/novels?search=").concat(encodeURIComponent(searchTerm), "&page=").concat(pageNo))];
            case 1:
              html = _a.sent();
              return [2, (0, parsers_1.parseCatalogCards)(html)];
          }
        });
      });
    };
    return LightNovelToPlugin2;
  })()
);
exports.default = new LightNovelToPlugin();
try { if (typeof module !== "undefined" && module && module.exports) module.exports.default = plugin_default; } catch (e) {}
