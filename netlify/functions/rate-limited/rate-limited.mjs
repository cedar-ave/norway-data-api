// Answers requests that went over the Norway Data API's rate limit. The main
// function's config.rateLimit rewrites them here (see its comment), so
// clients get the same problem details format as every other error, plus a
// Retry-After header, instead of Netlify's empty 429.
//
// This function has no rate limit of its own, and it does almost no work.

import { log, problemResponse, ProblemError } from '../norway-data/norway-data.mjs';

// The rate limit's window, in seconds. Waiting this long always clears it.
export const RETRY_AFTER_SECONDS = 60;

export default async (req, context) => {
  const started = Date.now();
  const requestId = context?.requestId ?? req.headers.get('x-nf-request-id') ?? crypto.randomUUID();
  const res = problemResponse(
    new ProblemError('rate-limited', `Too many requests from your IP address. Wait ${RETRY_AFTER_SECONDS} seconds, then retry.`),
    req,
    requestId,
    { 'Retry-After': String(RETRY_AFTER_SECONDS) },
  );
  return log(req, res, requestId, started);
};

// Must be a literal - Netlify reads it at deploy time without running the code.
export const config = {
  path: '/_rate-limited',
};
