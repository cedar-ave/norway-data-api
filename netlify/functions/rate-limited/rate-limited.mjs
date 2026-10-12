// Answers requests that went over the Norway Data API's rate limit. The main
// function's config.rateLimit rewrites them here (see its comment), so
// clients get the same problem details format as every other error, plus a
// Retry-After header, instead of Netlify's empty 429.
//
// /_rate-limited is also a public URL, so it has its own rate limit:
// without one, calling it directly would run this function without limit
// and bypass the main function's protection. Netlify answers over-limit
// requests here with its own empty 429, without running this function.

import { log, problemResponse, ProblemError } from '../norway-data/norway-data.mjs';

// The rate limit's window, in seconds. Waiting this long always clears it.
export const RETRY_AFTER_SECONDS = 60;

// After the rewrite, req.url is /_rate-limited, a path the client never
// requested, so a problem's instance would be wrong. Netlify passes the
// original URL in this header instead. It isn't documented (it was found by
// logging the header names this function receives), so the smoke test
// checks it in production.
const ORIGINAL_URL_HEADER = 'netlify-ratelimit-original-url';

// The URL the client requested. A direct request to /_rate-limited can set
// the header itself, but that only changes instance in its own uncached
// response. Only the path and query are used, on this request's origin.
// Without a usable header, this falls back to req.url.
function requestedUrl(req) {
  const url = new URL(req.url);
  const original = req.headers.get(ORIGINAL_URL_HEADER);
  if (!original) return url;
  try {
    const { pathname, search } = new URL(original, url);
    return new URL(pathname + search, url);
  } catch {
    return url;
  }
}

export default async (req, context) => {
  const started = Date.now();
  const requestId = context?.requestId ?? req.headers.get('x-nf-request-id') ?? crypto.randomUUID();
  // problemResponse and log only read url and method.
  const requested = { url: requestedUrl(req).href, method: req.method };
  const res = problemResponse(
    new ProblemError('rate-limited', `Too many requests from your IP address. Wait ${RETRY_AFTER_SECONDS} seconds, then retry.`),
    requested,
    requestId,
    { 'Retry-After': String(RETRY_AFTER_SECONDS) },
  );
  return log(requested, res, requestId, started);
};

// Must be literals - Netlify reads this at deploy time without running the code.
export const config = {
  path: '/_rate-limited',
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  },
};
