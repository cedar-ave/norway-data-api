// Contract test for the Norway Data API sample: calls the Netlify Function
// handler directly (no server or deploy needed) and checks every response
// against public/openapi/norway-data.yaml - status code documented for the
// operation, media type, body schema, and documented headers. It also
// checks that:
// - every documented status code is exercised
// - every example in the spec matches its schema, and every example with a
//   known request (x-example-request, or a curl block right before a json
//   block in the introduction) is the exact response to that request
// - every error type the API returns is listed in the Errors section
// - pagination links walk each whole collection
// - the dataset's cross-references (category and place IDs) resolve
//
// Run with `npm test`. CI runs it in .github/workflows/ci.yml.

import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';
import handler from '../netlify/functions/norway-data/norway-data.mjs';
import rateLimitedHandler from '../netlify/functions/rate-limited/rate-limited.mjs';
import { categories, facts, places } from '../netlify/functions/norway-data/data.mjs';

console.log = () => {};
const print = (...args) => process.stdout.write(`${args.join(' ')}\n`);

const spec = yaml.load(readFileSync(new URL('../public/openapi/norway-data.yaml', import.meta.url), 'utf8'));
const serverUrl = new URL(spec.servers[0].url);
const basePath = serverUrl.pathname;
// The placeholder request ID used in every documented example.
const EXAMPLE_REQUEST_ID = '01JEXAMPLE0REQUEST0ID00000';
// Error types listed in the Errors table of the introduction.
const DOCUMENTED_TYPES = new Set(spec.info.description.match(/tag:[^`\s]+/g));

// Statuses the main handler can't produce on its own: 429 comes from the
// rate-limited function (checked separately below), and 500 only happens on
// an unexpected exception.
const NOT_EXERCISABLE = new Set(['429', '500']);
// 405 applies to methods the spec doesn't describe, so no GET operation
// documents it. It's covered in the spec's introduction instead.
const GLOBAL_STATUSES = new Set(['405']);

// ---- Schema setup ----------------------------------------------------------

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
// OpenAPI keywords that are valid in a 3.1 schema but unknown to Ajv.
ajv.addKeyword('example');
// Register only components.schemas (as $defs) - the rest of the spec isn't
// JSON Schema. Refs are rewritten to point into it.
const toAjvRefs = (schema) => JSON.parse(JSON.stringify(schema).replaceAll('#/components/schemas/', 'spec#/$defs/'));
ajv.addSchema({ $id: 'spec', $defs: toAjvRefs(spec.components.schemas) });

const resolve = (obj) => {
  if (!obj?.$ref) return obj;
  const [, section, name] = obj.$ref.split('/').slice(1);
  return spec.components[section][name];
};
const validatorFor = (schema) => ajv.compile(toAjvRefs(schema));

// ---- Helpers ---------------------------------------------------------------

const failures = [];
const exampleChecks = [];
const exercised = new Set();
let checks = 0;

function check(ok, message) {
  checks++;
  if (!ok) failures.push(message);
}

function findOperation(pathname) {
  const trimmed = pathname.replace(/\/+$/, '');
  if (trimmed !== basePath && !trimmed.startsWith(`${basePath}/`)) return null;
  const rel = trimmed.slice(basePath.length) || '/';
  for (const [template, item] of Object.entries(spec.paths)) {
    const pattern = new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`);
    if (pattern.test(rel)) return { template, operation: item.get };
  }
  return null;
}

async function call(path, { method = 'GET', headers = {} } = {}) {
  const url = new URL(path, serverUrl.origin);
  const res = await handler(new Request(url, { method, headers }), { requestId: EXAMPLE_REQUEST_ID });
  const text = await res.text();
  return { url, res, text };
}

// Calls the handler and checks the response against the spec. Returns the
// parsed body (or null).
async function request(path, expectedStatus, options = {}) {
  const label = `${options.method ?? 'GET'} ${path}`;
  const { url, res, text } = await call(path, options);
  check(res.status === expectedStatus, `${label}: expected ${expectedStatus}, got ${res.status}`);

  const match = findOperation(url.pathname);
  const status = String(res.status);
  if (GLOBAL_STATUSES.has(status)) {
    check(res.headers.get('allow') === 'GET, HEAD, OPTIONS', `${label}: 405 is missing the Allow header`);
    exercised.add(`* ${status}`);
  } else if (!match) {
    check(status === '404', `${label}: path matches no operation, so expected 404, got ${status}`);
  } else {
    exercised.add(`${match.template} ${status}`);
    const response = resolve(match.operation.responses[status]);
    check(response, `${label}: status ${status} isn't documented for ${match.template}`);
    if (!response) return null;

    for (const [name, header] of Object.entries(response.headers ?? {})) {
      const value = res.headers.get(name);
      check(value !== null, `${label}: missing documented header ${name}`);
      const schema = resolve(header).schema;
      if (value !== null && schema && !validatorFor(schema)(value)) {
        failures.push(`${label}: header ${name}="${value}" doesn't match its schema`);
      }
    }

    const [mediaType, media] = Object.entries(response.content ?? {})[0] ?? [];
    if (!mediaType) {
      check(text === '', `${label}: expected no body for ${status}`);
      return null;
    }
    check(res.headers.get('content-type') === mediaType, `${label}: content type ${res.headers.get('content-type')}, expected ${mediaType}`);
    check(res.headers.get('x-content-type-options') === 'nosniff', `${label}: missing X-Content-Type-Options`);
    check(res.headers.get('access-control-allow-origin') === '*', `${label}: missing CORS header`);

    const body = JSON.parse(text);
    if (mediaType === 'application/problem+json') check(DOCUMENTED_TYPES.has(body.type), `${label}: error type ${body.type} isn't in the Errors table`);
    const validate = validatorFor(media.schema);
    if (!validate(body)) failures.push(`${label}: body doesn't match schema: ${ajv.errorsText(validate.errors)}`);
    return body;
  }
  const body = text ? JSON.parse(text) : null;
  if (res.headers.get('content-type') === 'application/problem+json') check(DOCUMENTED_TYPES.has(body.type), `${label}: error type ${body.type} isn't in the Errors table`);
  return body;
}

// ---- Cases -----------------------------------------------------------------

const v = (p) => `${basePath}${p}`;

// Index (versioned and unversioned roots)
await request(v(''), 200);
await request(v('/'), 200);
// The unversioned root redirects to the current version.
{
  const { res } = await call('/norway-data');
  check(res.status === 302, `GET /norway-data: expected 302, got ${res.status}`);
  check(res.headers.get('location') === `${serverUrl.origin}${basePath}`, `GET /norway-data redirects to ${res.headers.get('location')}`);
}
await request(v('/?verbose=1'), 400);

// Facts
const page = await request(v('/facts?category=geography&limit=2&offset=2'), 200);
check(page?.data.every((f) => f.category === 'geography'), 'category filter returned other categories');
check(page?.pagination.links.next?.includes('category=geography'), 'pagination links dropped the category filter');
await request(v('/facts?offset=10000'), 200);
await request(v('/facts/10'), 200);
await request(v('/facts/99'), 404);
for (const bad of ['abc', '010', '0', '-1', '1.5']) await request(v(`/facts/${bad}`), 400);
const multi = await request(v('/facts?limit=0&limt=5&category=food'), 400);
check(multi?.errors?.length === 3, `expected 3 parameter errors, got ${multi?.errors?.length}`);
await request(v('/facts?limit=5&limit=6'), 400);
await request(v('/facts?offset=10001'), 400);
await request(v('/facts/10?x=1'), 400);

// Random fact
const random = await request(v('/random-fact?category=nature'), 200);
check(random?.category === 'nature', 'random-fact ignored the category filter');
await request(v('/random-fact?category=food'), 400);
await request(v('/random-fact?limit=1'), 400);

// Place filter on facts
const svalbard = await request(v('/facts?place=svalbard'), 200);
check(svalbard?.data.length > 0 && svalbard.data.every((f) => f.placeIds.includes('svalbard')), 'place filter returned wrong facts');
const both = await request(v('/facts?place=svalbard&category=nature'), 200);
check(both?.data.every((f) => f.category === 'nature' && f.placeIds.includes('svalbard')), 'combined filters returned wrong facts');
await request(v('/facts?place=bergen'), 400);
await request(v('/facts?place=Svalbard'), 400);

// Categories and places
await request(v('/categories'), 200);
await request(v('/categories?limit=51'), 400);
await request(v('/places'), 200);
await request(v('/places?limit=0'), 400);
await request(v('/places/sognefjord'), 200);
await request(v('/places/bergen'), 404);
for (const bad of ['Sognefjord', 'sogne_fjord', '-oslo', 'oslo-']) await request(v(`/places/${bad}`), 400);

// Unknown paths, malformed encoding, unsupported methods
await request(v('/nope'), 404);
await request(v('/facts/10/extra'), 404);
await request(v('/facts/%E0'), 400);
await request('/norway-data/v2/facts', 404);
await request('/api/norway-data/v1/facts', 404);

// Tracking and cache-busting parameters are ignored, and dropped from links.
{
  const tracked = await request(v('/facts?category=history&utm_source=newsletter&utm_medium=email&_=1739000000'), 200);
  const links = Object.values(tracked?.pagination.links ?? {}).filter(Boolean);
  check(links.length > 0 && links.every((u) => !/utm_|[?&]_=/.test(u)), 'pagination links kept ignored parameters');
  await request(v('/facts/10?utm_campaign=launch'), 200);
  await request(v('/facts?utmx=1'), 400);
}
await request(v('/facts'), 405, { method: 'POST' });
await request(v('/facts/10'), 405, { method: 'DELETE' });

// Conditional requests: every cacheable 200 must support a 304.
for (const path of ['', '/facts', '/facts/10', '/categories', '/places', '/places/sognefjord']) {
  const { res } = await call(v(path));
  const etag = res.headers.get('etag');
  check(etag?.startsWith('W/"'), `GET ${path}: ETag ${etag} should be weak`);
  await request(v(path), 304, { headers: { 'If-None-Match': etag } });
  await request(v(path), 304, { headers: { 'If-None-Match': etag.replace(/^W\//, '') } });
  await request(v(path), 200, { headers: { 'If-None-Match': '"stale"' } });
}
const { res: randomRes } = await call(v('/random-fact'));
check(randomRes.headers.get('etag') === null, 'random-fact must not send an ETag');

// HEAD matches GET without a body; OPTIONS answers CORS preflight.
{
  const get = await call(v('/facts'));
  const head = await call(v('/facts'), { method: 'HEAD' });
  check(head.res.status === 200 && head.text === '', 'HEAD /facts should be 200 with no body');
  check(head.res.headers.get('etag') === get.res.headers.get('etag'), 'HEAD and GET ETags differ');
  const options = await call(v('/facts'), { method: 'OPTIONS' });
  check(options.res.status === 204, `OPTIONS /facts: expected 204, got ${options.res.status}`);
  check(options.res.headers.get('access-control-allow-methods') === 'GET, HEAD, OPTIONS', 'OPTIONS is missing Allow-Methods');
  const missing = await call(v('/nope'), { method: 'OPTIONS' });
  check(missing.res.status === 404, 'OPTIONS on an unknown path should be 404');
}

// Following pagination links visits every item exactly once.
for (const collection of ['/facts', '/categories', '/places']) {
  const seen = [];
  let next = `${serverUrl.origin}${v(collection)}?limit=4`;
  let total;
  while (next) {
    const body = await request(new URL(next).pathname + new URL(next).search, 200);
    total = body.pagination.total;
    seen.push(...body.data);
    next = body.pagination.links.next;
  }
  check(seen.length === total, `${collection}: walked ${seen.length} items via links, total is ${total}`);
}

// Links use the origin of the request, whatever host was called.
for (const host of ['https://deploy-preview-1--norway-data-api.netlify.app', 'http://localhost:8888']) {
  const res = await handler(new Request(`${host}${v('/places?limit=2')}`), { requestId: EXAMPLE_REQUEST_ID });
  const body = await res.json();
  const urls = [...Object.values(body.pagination.links).filter(Boolean), res.headers.get('link')];
  check(urls.every((u) => u.includes(host)), `links for requests to ${host} should use ${host}`);
  const indexBody = await (await handler(new Request(`${host}${v('/')}`), {})).json();
  check(Object.values(indexBody.links).every((u) => u.startsWith(host)), `index links for ${host} should use ${host}`);
  check(indexBody.openapi === `${host}/openapi/norway-data.yaml`, `index openapi link for ${host} is ${indexBody.openapi}`);
}

// The rate-limited function's 429 matches the documented TooManyRequests
// response.
{
  const res = await rateLimitedHandler(new Request(`${serverUrl.origin}/_rate-limited`), { requestId: EXAMPLE_REQUEST_ID });
  const doc = spec.components.responses.TooManyRequests;
  const [mediaType, media] = Object.entries(doc.content)[0];
  check(res.status === 429, `rate-limited: expected 429, got ${res.status}`);
  check(res.headers.get('content-type') === mediaType, `rate-limited: content type ${res.headers.get('content-type')}`);
  check(res.headers.get('cache-control') === 'no-store', 'rate-limited: must not be cached');
  check(res.headers.get('access-control-allow-origin') === '*', 'rate-limited: missing CORS header');
  const retryAfter = res.headers.get('retry-after');
  check(retryAfter !== null && validatorFor(doc.headers['Retry-After'].schema)(retryAfter), `rate-limited: Retry-After is ${retryAfter}`);
  const body = await res.json();
  const validate = validatorFor(media.schema);
  if (!validate(body)) failures.push(`rate-limited: body doesn't match schema: ${ajv.errorsText(validate.errors)}`);
  check(DOCUMENTED_TYPES.has(body.type), `rate-limited: error type ${body.type} isn't in the Errors table`);
  check(body.detail.includes(`${retryAfter} seconds`), 'rate-limited: detail and Retry-After disagree');
}

// ---- Coverage and spec self-checks -----------------------------------------

for (const [template, item] of Object.entries(spec.paths)) {
  for (const status of Object.keys(item.get.responses)) {
    if (NOT_EXERCISABLE.has(status)) continue;
    check(exercised.has(`${template} ${status}`), `never exercised: GET ${template} -> ${status}`);
  }
}

// Every example in the spec must match its schema, so the docs can't show
// a response the API would never send.
for (const [template, item] of Object.entries(spec.paths)) {
  for (const [status, ref] of Object.entries(item.get.responses)) {
    for (const media of Object.values(resolve(ref).content ?? {})) {
      if (media.example === undefined) continue;
      const validate = validatorFor(media.schema);
      if (!validate(media.example)) failures.push(`spec example for GET ${template} ${status} is invalid: ${ajv.errorsText(validate.errors)}`);
      checks++;
    }
  }
}

// Examples tied to a request must be that request's exact response, so the
// docs can't drift from the data.
for (const [template, item] of Object.entries(spec.paths)) {
  for (const [status, ref] of Object.entries(item.get.responses)) {
    for (const media of Object.values(resolve(ref).content ?? {})) {
      const path = media['x-example-request'];
      if (!path) continue;
      const { text } = await call(v(path === '/' ? '' : path));
      check(isDeepStrictEqual(JSON.parse(text), media.example), `example for GET ${template} ${status} isn't the actual response to ${path}`);
    }
  }
}
{
  // In the introduction, a json block right after a curl block is that
  // request's response.
  const blocks = [...spec.info.description.matchAll(/```(\w+)\n([\s\S]*?)```/g)].map(([, lang, body]) => ({ lang, body }));
  let verified = 0;
  blocks.forEach((block, i) => {
    const prev = blocks[i - 1];
    if (block.lang !== 'json' || prev?.lang !== 'bash') return;
    const url = prev.body.match(/curl "?([^"\s]+)"?/)?.[1];
    if (!url) return;
    verified++;
    exampleChecks.push(
      call(new URL(url).pathname + new URL(url).search).then(({ text }) =>
        check(isDeepStrictEqual(JSON.parse(text), JSON.parse(block.body)), `introduction example for ${url} isn't the actual response`),
      ),
    );
  });
  check(verified >= 4, `expected at least 4 verified introduction examples, found ${verified}`);
}
await Promise.all(exampleChecks);

// The dataset's cross-references resolve, and IDs follow the documented
// formats.
{
  const placeIds = new Set(places.map((p) => p.id));
  const categoryIds = new Set(categories.map((c) => c.id));
  const slug = new RegExp(spec.components.schemas.PlaceId.pattern);
  for (const f of facts) {
    check(categoryIds.has(f.category), `fact ${f.id} has unknown category ${f.category}`);
    for (const id of f.placeIds) check(placeIds.has(id), `fact ${f.id} references unknown place ${id}`);
  }
  for (const p of places) check(slug.test(p.id), `place ID ${p.id} isn't a valid slug`);
  for (const c of categories) check(slug.test(c.id), `category ID ${c.id} isn't a valid slug`);
  check(new Set(facts.map((f) => f.id)).size === facts.length, 'fact IDs are not unique');
  check(placeIds.size === places.length, 'place IDs are not unique');
  const sorted = (ids) => ids.every((id, i) => i === 0 || ids[i - 1] < id);
  check(sorted(facts.map((f) => f.id)), 'facts are not in ID order');
  check(sorted(places.map((p) => p.id)), 'places are not in ID order');
  const categoryEnum = spec.components.parameters.Category.schema.enum;
  check(isDeepStrictEqual(categoryEnum, categories.map((c) => c.id)), 'category parameter enum differs from the data');
}

if (failures.length) {
  console.error(`API contract test: ${failures.length} of ${checks} checks failed\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
print(`API contract test: all ${checks} checks passed.`);
