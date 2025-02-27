import http from "http";
import url from "url";
import Queue from "p-queue";
import { toMarkdown } from "./to-markdown";
import { SELECTORS_TO_REMOVE, shouldSkipDomain } from "./utils";
import { loadConfig } from "./config";
import { getReadabilityScript } from "./macro" with { type: "macro" };
import { getSearchPageLinks, getSearXNGPageLinks } from "./extract";
import { launchBrowser, type BrowserMethods } from "./browser";

async function visitLink(browser: BrowserMethods, url: string) {
  const readabilityScript = await getReadabilityScript();
  const result = await browser.withPage(async (page) => {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
    });
    return await page.evaluate(
      ([readabilityScript, selectorsToRemove]) => {
        const Readability = new Function(
          "module",
          `${readabilityScript}\nreturn module.exports`
        )({});

        const document = window.document;

        document
          .querySelectorAll(selectorsToRemove.join(","))
          .forEach((el) => el.remove());

        const article = new Readability(document).parse();

        const content = article?.content || "";
        const title = document.title;

        return { content, title: article?.title || title };
      },
      [readabilityScript, SELECTORS_TO_REMOVE] as const
    );
  });

  if (!result) return null;

  const content = toMarkdown(result.content);

  return { ...result, url, content: content };
}

function getSearchUrl(options: {
  query: string;
  maxResults?: number;
  excludeDomains: string[];
}) {
  const searchParams = new URLSearchParams({
    q: `${options.excludeDomains.length > 0
      ? `${options.excludeDomains.map((domain) => `-site:${domain}`).join(" ")} `
      : ""
      }${options.query}`,
    num: `${options.maxResults || 10}`,
  });

  // web tab
  searchParams.set("udm", "14");

  // return `https://www.google.com/search?${searchParams.toString()}`;
  return `https://priv.au/search?q=?${searchParams.toString()}`;
}

async function search(
  browser: BrowserMethods,
  options: {
    query: string;
    maxResults?: number;
    excludeDomains: string[];
    truncate?: number;
    concurrency?: number;
  }
) {
  const queue = new Queue({ concurrency: options.concurrency || 15 });
  const visitedUrls = new Set<string>();
  const searchUrl = getSearchUrl(options);

  let links = await browser.withPage(async (page) => {
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
    });
    // const result = await page.evaluate(getSearchPageLinks);
    const result = await page.evaluate(getSearXNGPageLinks);

    return result;
  });

  links =
    links?.filter((link) => {
      if (visitedUrls.has(link.url)) return false;

      visitedUrls.add(link.url);
      return !shouldSkipDomain(link.url);
    }) || null;

  if (!links || links.length === 0) return { query: options.query, results: [] };

  // Full results with content
  const finalResultsSettled = await Promise.allSettled(
    links.map((item) => queue.add(() => visitLink(browser, item.url)))
  );

  const finalResults = {
    query: options.query,
    results: finalResultsSettled
      .map((item) => {
        if (item.status === "rejected" || !item.value) return null;

        return {
          ...item.value,
          content: options.truncate
            ? item.value.content.slice(0, options.truncate)
            : item.value.content,
        };
      })
      .filter((v) => v?.content),
  };

  return finalResults;
}

// Fetch URLs directly
async function fetchUrls(
  browser: BrowserMethods,
  urls: string[],
  truncate?: number
) {
  const queue = new Queue({ concurrency: 5 });

  const results = await Promise.allSettled(
    urls.map((url) => queue.add(() => visitLink(browser, url)))
  );

  return {
    results: results
      .map((result, index) => {
        if (result.status === "rejected") {
          return {
            url: urls[index],
            error: result.reason instanceof Error ? result.reason.message : "Failed to fetch URL"
          };
        }

        if (!result.value) {
          return {
            url: urls[index],
            error: "No content found"
          };
        }

        return {
          ...result.value,
          content: truncate
            ? result.value.content.slice(0, truncate)
            : result.value.content,
        };
      }),
  };
}

// URL validation function
function isValidUrl(urlString: string): boolean {
  try {
    const parsedUrl = new URL(urlString);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch (error) {
    return false;
  }
}

const startServer = async () => {
  const config = loadConfig();
  const browser = await launchBrowser({
    show: false,
    browser: config.browser,
    proxy: config.proxy,
    executablePath: config.executablePath,
    profilePath: config.profilePath,
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    await browser.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Shutting down server...');
    await browser.close();
    process.exit(0);
  });

  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url || "", true);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Handle GET requests to /fetch endpoint
    if (req.method === 'GET' && parsedUrl.pathname === '/fetch') {
      try {
        const urlParam = parsedUrl.query.url;
        const truncate = parsedUrl.query.truncate
          ? parseInt(parsedUrl.query.truncate as string, 10)
          : config.truncate;

        if (!urlParam) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: "Missing url parameter" }));
          return;
        }

        // Handle multiple URLs
        const urls = Array.isArray(urlParam) ? urlParam : [urlParam];

        // Validate URLs
        const invalidUrls = urls.filter(url => !isValidUrl(url));
        if (invalidUrls.length > 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: "Invalid URLs provided",
            invalidUrls
          }));
          return;
        }

        // Fetch URLs content
        const results = await fetchUrls(browser, urls, truncate);

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=7200', // 2 hours browser cache
        });
        res.end(JSON.stringify(results));
      } catch (error) {
        console.error('Error processing fetch request:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: error instanceof Error ? error.message : 'Internal server error'
        }));
      }
    }
    // Handle GET requests to /search endpoint
    else if (req.method === 'GET' && parsedUrl.pathname === '/search') {
      try {
        const queryParam = parsedUrl.query.query;
        const maxResults = parsedUrl.query.maxResults
          ? parseInt(parsedUrl.query.maxResults as string, 10)
          : config.maxResults || 10;
        const truncate = parsedUrl.query.truncate
          ? parseInt(parsedUrl.query.truncate as string, 10)
          : config.truncate;
        const concurrency = parsedUrl.query.concurrency
          ? parseInt(parsedUrl.query.concurrency as string, 10)
          : config.concurrency || 15;

        // Default exclude domains from config
        let excludeDomains = config.excludeDomain
          ? Array.isArray(config.excludeDomain)
            ? config.excludeDomain
            : [config.excludeDomain]
          : [];

        // Add exclude domains from query params if provided
        if (parsedUrl.query.excludeDomain) {
          const queryExcludeDomains = Array.isArray(parsedUrl.query.excludeDomain)
            ? parsedUrl.query.excludeDomain
            : [parsedUrl.query.excludeDomain as string];
          excludeDomains = [...excludeDomains, ...queryExcludeDomains];
        }

        if (!queryParam) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: "Missing query parameter" }));
          return;
        }

        const query = Array.isArray(queryParam) ? queryParam[0] : queryParam;

        // Perform search
        const results = await search(browser, {
          query,
          maxResults,
          truncate,
          concurrency,
          excludeDomains,
        });

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=7200', // 2 hours browser cache
        });
        res.end(JSON.stringify(results));
      } catch (error) {
        console.error('Error processing request:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: error instanceof Error ? error.message : 'Internal server error'
        }));
      }
    } else {
      // Handle 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    }
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
};

startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
