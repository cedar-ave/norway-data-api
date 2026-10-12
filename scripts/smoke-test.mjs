// Smoke test against a deployed copy of the API, over the real network.
// The contract test calls the function in memory, so it can't catch
// problems that only exist once deployed: routing, redirects, CDN caching,
// CORS, the rate limiter, or links that point at the wrong host.
//
// Usage: node scripts/smoke-test.mjs <base-url> [--rate-limit] [--redirects]
//
//   <base-url>     The site's origin, such as https://api.marlasowards.com
//                  or a deploy preview's URL.
//   --rate-limit   Also send bursts of requests and check for a problem
//                  details 429, and that /_rate-limited has its own limit.
//                  This uses up the rate limit for the machine running the
//                  test for about a minute.
//   --redirects    Also check the redirects to production: from the old
//                  www.marlasowards.com URLs and from the netlify.app domain.
//                  Only meaningful when <base-url> is production.

const [baseArg, ...flags] = process.argv.slice(2);
if (!baseArg) {
  console.error('Usage: node scripts/smoke-test.mjs <base-url> [--rate-limit] [--redirects]');
  process.exit(2);
}
const BASE = baseArg.replace(/\/+$/, '');
const API = `${BASE}/norway-data/v1`;
const PRODUCTION = 'https://api.marlasowards.com';

const failures = [];
let checks = 0;
function check(ok, message) {
  checks++;
  if (!ok) failures.push(message);
}

// Retries network errors (not HTTP errors) a few times: under bursts, a
// connection is occasionally reset before a response arrives.
async function fetchWithRetry(url, init, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * i));
    }
  }
}

async function get(url, init = {}) {
  const res = await fetchWithRetry(url, { redirect: 'manual', ...init });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON - the checks below report that where it matters.
  }
  return { res, text, body };
}

// The unversioned root redirects to the current version.
{
  const { res } = await get(`${BASE}/norway-data`);
  check(res.status === 302, `GET /norway-data: expected 302, got ${res.status}`);
  check(res.headers.get('location') === API, `GET /norway-data: Location is ${res.headers.get('location')}, expected ${API}`);
}

// Index: JSON, and every link points at the host that was called.
{
  const { res, body } = await get(API);
  check(res.status === 200, `GET index: expected 200, got ${res.status}`);
  check(res.headers.get('content-type') === 'application/json', `GET index: content type ${res.headers.get('content-type')}`);
  const links = Object.values(body?.links ?? {});
  check(links.length > 0 && links.every((u) => u.startsWith(API)), `GET index: links don't all start with ${API}: ${links.join(', ')}`);
  check(body?.openapi === `${BASE}/openapi/norway-data.yaml`, `GET index: openapi link is ${body?.openapi}`);
}

// A collection: pagination links, Link header, CORS, caching headers, and a 304 on revalidation.
{
  const url = `${API}/facts?limit=2&utm_source=smoke-test`;
  const { res, body } = await get(url);
  check(res.status === 200, `GET facts: expected 200, got ${res.status}`);
  const links = Object.values(body?.pagination?.links ?? {}).filter(Boolean);
  check(links.length > 0 && links.every((u) => u.startsWith(`${API}/facts?`) && !u.includes('utm_')), `GET facts: unexpected page links: ${links.join(', ')}`);
  const linkHeader = res.headers.get('link') ?? '';
  check(linkHeader.includes(`<${API}/facts?`), `GET facts: Link header doesn't point at ${API}`);
  check(res.headers.get('access-control-allow-origin') === '*', 'GET facts: missing Access-Control-Allow-Origin');
  check(res.headers.get('cache-control') === 'public, max-age=3600' || res.headers.get('cache-control') === 'public,max-age=3600', `GET facts: Cache-Control is ${res.headers.get('cache-control')}`);
  const etag = res.headers.get('etag');
  check(etag?.startsWith('W/"'), `GET facts: ETag ${etag} should be weak`);
  if (etag) {
    const again = await get(url, { headers: { 'If-None-Match': etag } });
    check(again.res.status === 304, `GET facts with If-None-Match: expected 304, got ${again.res.status}`);
  }
}

// Errors are problem details.
{
  const { res, body } = await get(`${API}/facts/999999`);
  check(res.status === 404, `GET unknown fact: expected 404, got ${res.status}`);
  check(res.headers.get('content-type') === 'application/problem+json', `GET unknown fact: content type ${res.headers.get('content-type')}`);
  check(body?.type === 'tag:marlasowards.com,2026:norway-data/not-found', `GET unknown fact: type ${body?.type}`);
  check(typeof body?.requestId === 'string' && body.requestId.length > 0, 'GET unknown fact: missing requestId');
}

// CORS preflight.
{
  const { res } = await get(`${API}/facts`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'GET' },
  });
  check(res.status === 204, `OPTIONS facts: expected 204, got ${res.status}`);
}

// The spec is served, and other sites can load it.
{
  const { res, text } = await get(`${BASE}/openapi/norway-data.yaml`);
  check(res.status === 200, `GET spec: expected 200, got ${res.status}`);
  check(text.startsWith('openapi: 3.1.0'), 'GET spec: body is not the OpenAPI document');
  check(res.headers.get('access-control-allow-origin') === '*', 'GET spec: missing Access-Control-Allow-Origin');
}

// Security: every response carries the security headers, and links never
// take their scheme from X-Forwarded-Proto (which would let one request
// poison the cache with http:// links).
{
  const expected = {
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'cross-origin',
  };
  for (const url of [`${API}/facts/10`, `${API}/facts/999999`, `${BASE}/openapi/norway-data.yaml`]) {
    const { res } = await get(url);
    for (const [name, value] of Object.entries(expected)) {
      check(res.headers.get(name) === value, `GET ${url}: ${name} is ${res.headers.get(name)}`);
    }
    check(/includeSubDomains/.test(res.headers.get('strict-transport-security') ?? ''), `GET ${url}: Strict-Transport-Security is ${res.headers.get('strict-transport-security')}`);
  }
  if (BASE.startsWith('https://')) {
    // A fresh, unique URL, so this never touches an entry real clients use.
    const probe = `${API}/facts?limit=1&utm_smoke=${Date.now()}${Math.random().toString(36).slice(2)}`;
    const { body } = await get(probe, { headers: { 'X-Forwarded-Proto': 'http' } });
    const links = Object.values(body?.pagination?.links ?? {}).filter(Boolean);
    check(links.length > 0 && links.every((u) => u.startsWith('https://')), `X-Forwarded-Proto: http changed the links: ${links.join(', ')}`);
  }
}

if (flags.includes('--redirects')) {
  for (const [from, to] of [
    ['https://www.marlasowards.com/api/norway-data/v1/facts/10', `${PRODUCTION}/norway-data/v1/facts/10`],
    ['https://www.marlasowards.com/openapi/norway-data.yaml', `${PRODUCTION}/openapi/norway-data.yaml`],
    ['https://norway-data-api.netlify.app/norway-data/v1/facts/10', `${PRODUCTION}/norway-data/v1/facts/10`],
  ]) {
    const { res } = await get(from);
    check(res.status === 301, `GET ${from}: expected 301, got ${res.status}`);
    check(res.headers.get('location') === to, `GET ${from}: Location is ${res.headers.get('location')}, expected ${to}`);
  }
}

if (flags.includes('--rate-limit')) {
  // /random-fact is never cached, so every request reaches the rate limiter.
  let limited = null;
  for (let i = 0; i < 90 && !limited; i++) {
    const r = await get(`${API}/random-fact`);
    if (r.res.status === 429) limited = r;
  }
  check(limited !== null, 'Rate limit: 90 requests in a row never got a 429');
  if (limited) {
    check(limited.res.headers.get('content-type') === 'application/problem+json', `Rate limit: 429 content type ${limited.res.headers.get('content-type')}`);
    check(limited.body?.type === 'tag:marlasowards.com,2026:norway-data/rate-limited', `Rate limit: 429 type ${limited.body?.type}`);
    check(/^\d+$/.test(limited.res.headers.get('retry-after') ?? ''), `Rate limit: Retry-After is ${limited.res.headers.get('retry-after')}`);
    // Netlify rewrites the request to /_rate-limited, but instance must be
    // the path the client requested. This relies on context.url, which
    // Netlify doesn't document, so only production can confirm it.
    const requested = new URL(`${API}/random-fact`).pathname;
    check(limited.body?.instance === requested, `Rate limit: 429 instance is ${limited.body?.instance}, expected ${requested}`);
  }
}

if (flags.includes('--rate-limit')) {
  // /_rate-limited is a public URL, so it must have its own limit: past it,
  // Netlify answers with an empty 429 instead of running the function.
  let bare = false;
  for (let i = 0; i < 90 && !bare; i++) {
    const r = await get(`${BASE}/_rate-limited`);
    if (r.res.status === 429 && r.text === '') bare = true;
  }
  check(bare, '/_rate-limited: 90 direct requests all ran the function (no rate limit of its own)');
}

if (failures.length) {
  console.error(`Smoke test against ${BASE}: ${failures.length} of ${checks} checks failed\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`Smoke test against ${BASE}: all ${checks} checks passed.`);
