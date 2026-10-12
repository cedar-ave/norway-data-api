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

// The URL the client requested. After the rewrite, req.url is /_rate-limited,
// which would make the problem's instance a path the client never asked for.
// context.url should still be the original URL. Netlify doesn't document
// this, so the smoke test checks it in production. If context.url is missing
// or is the same as req.url, this falls back to req.url.
function requestedUrl(req, context) {
  const url = new URL(req.url);
  if (!context?.url) return url;
  const original = new URL(context.url);
  return original.pathname === url.pathname ? url : original;
}

export default async (req, context) => {
  const started = Date.now();
  const requestId = context?.requestId ?? req.headers.get('x-nf-request-id') ?? crypto.randomUUID();
  // problemResponse and log only read url and method.
  const requested = { url: requestedUrl(req, context).href, method: req.method };
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
