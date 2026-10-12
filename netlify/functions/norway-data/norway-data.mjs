// Netlify Function that serves the Norway Data API at
// https://api.marlasowards.com/norway-data. The reference page at
// https://www.marlasowards.com/api-reference renders
// public/openapi/norway-data.yaml (served by this same site) and sends its
// "Test Request" calls here, and its generated code samples point here too.
//
// The spec is the contract. scripts/contract-test.mjs calls every route
// through this handler and fails CI if a response, status code, or header
// doesn't match the spec - run it with `npm test` after any change here or
// in the spec.

import { createHash } from 'node:crypto';
import { categories, facts, places } from './data.mjs';

const ROOT_PATH = '/norway-data';
const VERSION = 'v1';
const BASE_PATH = `${ROOT_PATH}/${VERSION}`;
const SPEC_PATH = '/openapi/norway-data.yaml';
// The one URL that lives somewhere else: the reference page. Override it
// with the DOCS_URL environment variable in Netlify if it ever moves.
const DOCS_URL = process.env.DOCS_URL || 'https://www.marlasowards.com/api-reference';

// Every other URL in a response is built from the request's own origin, so
// links always point at the server that was called: production, a deploy
// preview, or localhost.

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_OFFSET = 10000;

// Query parameters that are ignored instead of rejected: campaign tracking
// parameters (utm_source and so on) that links pick up when shared, and the
// `_` cache-buster some HTTP clients add.
const IGNORED_PARAM = /^(utm_[a-z]+|_)$/;

// Data only changes when the site deploys, and every deploy purges
// Netlify's CDN cache. So the CDN may keep responses indefinitely, while
// browsers and other shared caches revalidate hourly using the ETag.
const CACHEABLE = {
  'Cache-Control': 'public, max-age=3600',
  'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=31536000',
};
const UNCACHEABLE = { 'Cache-Control': 'no-store' };

// Read-only public data, so any origin may call it. This also lets the
// reference page's "Test Request" panel work from deploy previews and
// localhost.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'ETag, Link, Retry-After',
};
const ALLOWED_METHODS = 'GET, HEAD, OPTIONS';

// Problem types. The type URI is a stable identifier clients branch on, so
// it's a tag URI (RFC 4151) that doesn't depend on any page's headings or
// URL - renaming docs can't change it. The spec's Errors section lists them.
const PROBLEM_TYPE_PREFIX = 'tag:marlasowards.com,2026:norway-data/';
export const PROBLEMS = {
  'invalid-parameter': { status: 400, title: 'Invalid parameter' },
  'invalid-path': { status: 400, title: 'Invalid path' },
  'not-found': { status: 404, title: 'Not found' },
  'method-not-allowed': { status: 405, title: 'Method not allowed' },
  'rate-limited': { status: 429, title: 'Too many requests' },
  'internal-error': { status: 500, title: 'Internal error' },
};

export class ProblemError extends Error {
  constructor(slug, detail, extensions = {}) {
    super(detail);
    this.slug = slug;
    this.extensions = extensions;
  }
}

// Responses are pretty-printed on purpose: this is a learning sample, and
// the output is easier to read in a terminal or the reference page.
const serialize = (body) => JSON.stringify(body, null, 2);

const baseHeaders = (contentType) => ({
  'Content-Type': contentType,
  'X-Content-Type-Options': 'nosniff',
  ...CORS_HEADERS,
});

export function problemResponse(err, req, requestId, extraHeaders = {}) {
  const { status, title } = PROBLEMS[err.slug];
  const url = new URL(req.url);
  const body = {
    type: `${PROBLEM_TYPE_PREFIX}${err.slug}`,
    title,
    status,
    detail: err.message,
    instance: url.pathname + url.search,
    requestId,
    ...err.extensions,
  };
  const headers = { ...baseHeaders('application/problem+json'), ...UNCACHEABLE, ...extraHeaders };
  if (status === 405) headers.Allow = ALLOWED_METHODS;
  return new Response(serialize(body), { status, headers });
}

// Sends a 200 with an ETag, or a 304 when the client already has this
// representation. The ETag is weak (W/) because Netlify compresses
// responses, and a strong ETag would have to differ for each compression.
function jsonResponse(req, body, { cacheable = true, extraHeaders = {} } = {}) {
  const text = serialize(body);
  const headers = { ...baseHeaders('application/json'), ...extraHeaders };
  if (!cacheable) return new Response(text, { status: 200, headers: { ...headers, ...UNCACHEABLE } });

  const etag = `W/"${createHash('sha256').update(text).digest('base64url').slice(0, 27)}"`;
  Object.assign(headers, CACHEABLE, { ETag: etag });
  const ifNoneMatch = req.headers.get('If-None-Match');
  // If-None-Match uses weak comparison: W/"x" and "x" match.
  const opaque = (tag) => tag.trim().replace(/^W\//, '');
  if (ifNoneMatch && ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || opaque(tag) === opaque(etag))) {
    delete headers['Content-Type'];
    return new Response(null, { status: 304, headers });
  }
  return new Response(text, { status: 200, headers });
}

// ---- Query parameters ------------------------------------------------------

// Validates the query string against the parameters an endpoint accepts.
// Unknown, repeated, and invalid parameters are all rejected (except the
// IGNORED_PARAM ones), and every problem is reported at once in `errors`.
function parseQuery(searchParams, spec) {
  const errors = [];
  const values = {};
  const names = [...new Set(searchParams.keys())].filter((name) => !IGNORED_PARAM.test(name));

  for (const name of names) {
    if (!(name in spec)) {
      errors.push({ parameter: name, detail: `Unknown parameter. Allowed: ${Object.keys(spec).join(', ') || 'none'}.` });
    } else if (searchParams.getAll(name).length > 1) {
      errors.push({ parameter: name, detail: 'Specify this parameter only once.' });
    }
  }

  for (const [name, rule] of Object.entries(spec)) {
    const raw = searchParams.get(name);
    if (raw === null || errors.some((e) => e.parameter === name)) {
      values[name] = rule.default;
      continue;
    }
    if (rule.enum) {
      if (rule.enum.includes(raw)) values[name] = raw;
      else errors.push({ parameter: name, detail: rule.message ?? `Must be one of: ${rule.enum.join(', ')}.` });
    } else {
      const value = Number(raw);
      if (/^(0|[1-9]\d*)$/.test(raw) && value >= rule.min && value <= rule.max) values[name] = value;
      else errors.push({ parameter: name, detail: `Must be an integer from ${rule.min} to ${rule.max}.` });
    }
  }

  if (errors.length) {
    const summary = errors.length === 1 ? 'A query parameter is invalid.' : `${errors.length} query parameters are invalid.`;
    throw new ProblemError('invalid-parameter', `${summary} See errors for details.`, { errors });
  }
  return values;
}

const categoryIds = categories.map((c) => c.id);
const CATEGORY_PARAM = { enum: categoryIds };
// Too many places to list in an error message, so point to the list instead.
const PLACE_PARAM = { enum: places.map((p) => p.id), message: 'No place has this ID. Get place IDs from /places.' };
const PLACE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PAGING_PARAMS = {
  limit: { min: 1, max: MAX_LIMIT, default: DEFAULT_LIMIT },
  offset: { min: 0, max: MAX_OFFSET, default: 0 },
};

function invalidPathParameter(name, detail) {
  return new ProblemError('invalid-parameter', `The ${name} path parameter is invalid.`, {
    errors: [{ parameter: name, detail }],
  });
}

// ---- Pagination ------------------------------------------------------------

// Every collection is paginated the same way, even short ones, so clients
// need only one code path and a list can grow without a breaking change.
// Page links keep the request's filters but drop ignored parameters.
function paginate(req, items, query) {
  const { limit, offset } = query;
  const total = items.length;
  const url = new URL(req.url);
  for (const name of [...url.searchParams.keys()]) if (IGNORED_PARAM.test(name)) url.searchParams.delete(name);
  const pageUrl = (newOffset) => {
    const next = new URL(url);
    next.searchParams.set('limit', String(limit));
    next.searchParams.set('offset', String(newOffset));
    return next.href;
  };

  const lastOffset = total === 0 ? 0 : Math.floor((total - 1) / limit) * limit;
  const links = {
    first: pageUrl(0),
    prev: offset > 0 ? pageUrl(Math.max(0, offset - limit)) : null,
    next: offset + limit < total ? pageUrl(offset + limit) : null,
    last: pageUrl(lastOffset),
  };
  const linkHeader = Object.entries(links)
    .filter(([, href]) => href)
    .map(([rel, href]) => `<${href}>; rel="${rel}"`)
    .join(', ');

  return jsonResponse(
    req,
    { data: items.slice(offset, offset + limit), pagination: { total, limit, offset, links } },
    { extraHeaders: { Link: linkHeader } },
  );
}

// ---- Routes ----------------------------------------------------------------

function index(req) {
  const { origin, searchParams } = new URL(req.url);
  parseQuery(searchParams, {});
  return jsonResponse(req, {
    name: 'Norway Data API',
    version: VERSION,
    documentation: DOCS_URL,
    openapi: `${origin}${SPEC_PATH}`,
    links: {
      facts: `${origin}${BASE_PATH}/facts`,
      randomFact: `${origin}${BASE_PATH}/random-fact`,
      categories: `${origin}${BASE_PATH}/categories`,
      places: `${origin}${BASE_PATH}/places`,
    },
  });
}

function listFacts(req) {
  const query = parseQuery(new URL(req.url).searchParams, { category: CATEGORY_PARAM, place: PLACE_PARAM, ...PAGING_PARAMS });
  const matches = facts.filter(
    (f) => (!query.category || f.category === query.category) && (!query.place || f.placeIds.includes(query.place)),
  );
  return paginate(req, matches, query);
}

function getFact(req, rawId) {
  parseQuery(new URL(req.url).searchParams, {});
  // Only canonical positive integers, so each fact has exactly one URL
  // (/facts/010 is rejected rather than treated as /facts/10).
  if (!/^[1-9]\d*$/.test(rawId)) throw invalidPathParameter('id', 'Must be a positive integer with no leading zeros.');
  const fact = facts.find((f) => f.id === Number(rawId));
  if (!fact) throw new ProblemError('not-found', `No fact has the ID ${rawId}.`);
  return jsonResponse(req, fact);
}

function randomFact(req) {
  const { category } = parseQuery(new URL(req.url).searchParams, { category: CATEGORY_PARAM });
  const pool = category ? facts.filter((f) => f.category === category) : facts;
  // Every category has facts, so an empty pool is a data bug - a 500, not
  // something the client did wrong.
  if (pool.length === 0) throw new Error(`Category ${category} has no facts.`);
  return jsonResponse(req, pool[Math.floor(Math.random() * pool.length)], { cacheable: false });
}

function listCategories(req) {
  return paginate(req, categories, parseQuery(new URL(req.url).searchParams, PAGING_PARAMS));
}

function listPlaces(req) {
  return paginate(req, places, parseQuery(new URL(req.url).searchParams, PAGING_PARAMS));
}

function getPlace(req, id) {
  parseQuery(new URL(req.url).searchParams, {});
  if (!PLACE_ID.test(id)) throw invalidPathParameter('id', 'Must be lowercase letters, digits, and single hyphens, such as sognefjord.');
  const place = places.find((p) => p.id === id);
  if (!place) throw new ProblemError('not-found', `No place has the ID ${id}.`);
  return jsonResponse(req, place);
}

// The unversioned root redirects to the current major version, so a client
// that starts there always lands on a version it can rely on.
function currentVersion(req) {
  const { origin } = new URL(req.url);
  return new Response(null, {
    status: 302,
    headers: { Location: `${origin}${BASE_PATH}`, 'Cache-Control': 'no-store', ...CORS_HEADERS },
  });
}

// Returns the handler for a path, or null when no endpoint matches.
function route(pathname) {
  const trimmed = pathname.replace(/\/+$/, '');
  if (trimmed === ROOT_PATH) return currentVersion;
  if (trimmed === BASE_PATH) return index;
  if (!trimmed.startsWith(`${BASE_PATH}/`)) return null;

  const segments = trimmed.slice(BASE_PATH.length + 1).split('/').map(decodeURIComponent);
  const [resource, id, ...rest] = segments;
  if (rest.length) return null;

  switch (resource) {
    case 'facts':
      return id === undefined ? listFacts : (req) => getFact(req, id);
    case 'random-fact':
      return id === undefined ? randomFact : null;
    case 'categories':
      return id === undefined ? listCategories : null;
    case 'places':
      return id === undefined ? listPlaces : (req) => getPlace(req, id);
    default:
      return null;
  }
}

// One structured log line per request, for Netlify's function logs. No IP
// addresses or other personal data.
export function log(req, res, requestId, started) {
  const url = new URL(req.url);
  console.log(JSON.stringify({
    requestId,
    method: req.method,
    path: url.pathname,
    query: url.search,
    status: res.status,
    durationMs: Date.now() - started,
  }));
  return res;
}

export default async (req, context) => {
  const started = Date.now();
  const requestId = context?.requestId ?? req.headers.get('x-nf-request-id') ?? crypto.randomUUID();
  return log(req, handle(req, requestId), requestId, started);
};

function handle(req, requestId) {
  try {
    const url = new URL(req.url);
    let handler;
    try {
      handler = route(url.pathname);
    } catch (err) {
      // decodeURIComponent throws on malformed percent-encoding (/facts/%E0).
      if (err instanceof URIError) throw new ProblemError('invalid-path', 'The request path contains malformed percent-encoding.');
      throw err;
    }
    if (!handler) throw new ProblemError('not-found', `No endpoint matches ${url.pathname}.`);

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...CORS_HEADERS,
          Allow: ALLOWED_METHODS,
          'Access-Control-Allow-Methods': ALLOWED_METHODS,
          'Access-Control-Allow-Headers': 'If-None-Match',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new ProblemError('method-not-allowed', `${req.method} isn't supported. This API is read-only.`);
    }

    const res = handler(req);
    // HEAD gets exactly what GET would, minus the body.
    return req.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
  } catch (err) {
    if (err instanceof ProblemError) return problemResponse(err, req, requestId);
    console.error(`[${requestId}]`, err);
    return problemResponse(new ProblemError('internal-error', 'The server hit an unexpected error. Try again later.'), req, requestId);
  }
}

// Netlify reads this statically at deploy time, so every value must be a
// literal - not ROOT_PATH or a template string. Keep them in sync by hand.
//
// rateLimit: once one IP address sends more than 60 requests to one
// hostname within a sliding 60-second window, Netlify rewrites the request
// to /_rate-limited (netlify/functions/rate-limited/), which answers with a
// problem details 429. The spec's Rate limits section describes this -
// update both together.
export const config = {
  path: ['/norway-data', '/norway-data/*'],
  rateLimit: {
    action: 'rewrite',
    to: '/_rate-limited',
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  },
};
