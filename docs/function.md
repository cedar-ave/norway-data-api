# The Netlify Function

The whole API is one Netlify Function, `netlify/functions/norway-data/norway-data.mjs`, written in the modern Functions format: a default export that takes a standard `Request` and returns a `Response`.

**Summary**

- `netlify.toml` sets the functions folder (`netlify/functions/`) and publishes `public/`, which holds the spec. There's no build step.
- The function's URL comes from `export const config = { path: [...] }`, not from a redirect. **Every value in `config` must be a literal.** Netlify reads it without running the code, and a constant or template string fails the deploy.
- `config.rateLimit` turns on Netlify's rate limiter: 60 requests per 60 seconds per IP address.
- Errors are thrown as `ProblemError` and turned into RFC 9457 problem details in one place. Anything else thrown becomes a `500`.
- Cacheable responses get an `ETag` and support `If-None-Match` (`304`). `/random-fact` is never cached.

## Netlify setup

This repo deploys to its own Netlify site, `norway-data-api.netlify.app`, on every push to `main`. All the settings are in `netlify.toml`, so nothing needs to be set in the Netlify UI:

```toml
[build]
  publish = "public"

[functions]
  directory = "netlify/functions"
```

- There's no build command. Netlify publishes `public/` (the spec) as-is.
- A redirect sends visitors to the site's root to the reference page.
- `/openapi/*` responses allow any origin, so a local dev server on another domain can load the spec.

marlasowards.com proxies `/api/norway-data/*` and `/openapi/norway-data.yaml` to this site, so callers use `www.marlasowards.com` URLs. A proxy rule with status `200` is a rewrite: the caller never sees the `netlify.app` domain.

Each subfolder of `netlify/functions/` is one function, named after the folder. Netlify bundles `norway-data.mjs` and everything it imports (`data.mjs`) with esbuild.

## Routing

The function claims its URLs in code:

```js
export const config = {
  path: ['/api/norway-data', '/api/norway-data/*'],
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  },
};
```

> [!WARNING]
> The first deploy of this API failed with `Function norway-data has a configuration error on 'path': Must be a string or array of strings`. The path was written as ``[BASE_PATH, `${BASE_PATH}/*`]``. Netlify reads `config` statically at deploy time, so it can't evaluate a variable or a template string. Write every value in `config` as a literal and keep it in sync with the constants by hand.

Inside the function, `route()` maps the path to a handler:

1. `/api/norway-data` and `/api/norway-data/v1` go to the index.
2. Anything else must start with `/api/norway-data/v1/`. The rest of the path is split into segments and decoded with `decodeURIComponent`.
3. The first segment picks the resource (`facts`, `random-fact`, `categories`, `places`) and the optional second segment is an ID. A third segment, or an unknown resource, returns `404`.

`decodeURIComponent` throws a `URIError` on invalid percent-encoding such as `%E0`. The function catches that and returns a `404`, instead of crashing with a generic Netlify error page.

## Methods

| Method | Behavior |
| --- | --- |
| `GET` | Runs the handler |
| `HEAD` | Runs the handler, then returns its status and headers with no body |
| `OPTIONS` | Returns `204` with CORS preflight headers, for known paths only |
| Anything else | `405` with an `Allow: GET, HEAD, OPTIONS` header |

## Validation

Every handler starts by calling `parseQuery(searchParams, rules)` with the parameters that endpoint accepts. It rejects, all at once:

- Parameters the endpoint doesn't accept, including misspellings.
- Parameters given more than once.
- Values that aren't allowed: an enum value that isn't in the list, or an integer that isn't canonical (`010`) or is out of range.

Every problem goes into one `400` response's `errors` array, so a client sees all of them in one round trip. Endpoints with no query parameters call `parseQuery(searchParams, {})`, so any query string at all is rejected.

Path IDs are checked the same strict way:

- Fact IDs must match `^[1-9]\d*$`, so `/facts/010` is a `400`, not an alias for `/facts/10`.
- Place IDs must match `^[a-z0-9]+(-[a-z0-9]+)*$`. A well-formed ID that doesn't exist is a `404`.

The `place` query filter would list every place ID in its error message, so it uses a custom `message` that points to `/places` instead.

## Pagination

`paginate()` handles every collection, even short ones, so clients only need one code path. It returns `data` plus `pagination` with `total`, `limit`, `offset`, and `links` (`first`, `prev`, `next`, `last`). The same links go in an RFC 8288 `Link` header.

The links are built from the request's own URL (`new URL(req.url)`), so they keep the request's filters and stay on whatever host was called. A deploy preview's links point at the deploy preview, not production.

## Caching

The data only changes when the site deploys, and Netlify clears its CDN cache on every deploy. So cacheable responses get two headers:

```js
const CACHEABLE = {
  'Cache-Control': 'public, max-age=3600',
  'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=31536000',
};
```

- `Cache-Control` lets browsers and other caches keep a response for an hour.
- `Netlify-CDN-Cache-Control` lets Netlify's CDN keep it until the next deploy, so repeat requests don't run the function at all.

`jsonResponse()` also sets an `ETag`: a SHA-256 hash of the response body. If a request's `If-None-Match` header matches it, the function returns `304 Not Modified` with no body.

`/random-fact` and every error response use `Cache-Control: no-store`. A cached random fact would stop being random.

## Errors

Every error is thrown as a `ProblemError` with a slug and a message, and the top-level handler turns it into an RFC 9457 problem details response:

```json
{
  "type": "tag:marlasowards.com,2026:norway-data/not-found",
  "title": "Not found",
  "status": 404,
  "detail": "No fact has the ID 99.",
  "instance": "/api/norway-data/v1/facts/99",
  "requestId": "01JEXAMPLE0REQUEST0ID00000"
}
```

- **`type`** is a `tag:` URI (RFC 4151). It's an identifier, not a link, so renaming a docs heading or moving the reference page can't change a value clients depend on.
- **`requestId`** comes from Netlify's `context.requestId`. The same ID is logged with `console.error` for `500`s, so a reported ID can be found in the function logs.
- Anything thrown that isn't a `ProblemError` becomes a `500` with a generic message. The real error only goes to the logs.

The rate limiter's `429` is the one error that doesn't come from the function, so it isn't in problem details format.

## Other headers

- `Access-Control-Allow-Origin: *` on every response, and `Access-Control-Expose-Headers: ETag, Link` so browser scripts can read those two.
- `X-Content-Type-Options: nosniff`.
- `Content-Type` is `application/json` for success and `application/problem+json` for errors, with no `charset`. JSON is always UTF-8.

Responses are pretty-printed on purpose so they're readable in a terminal and on the reference page.

## Testing the function locally

Run the function with the Netlify CLI:

```bash
npm run dev
```

The API is then at `http://localhost:8888/api/norway-data/v1`.

For a quick check without a server, run the [contract test](contract-test.md), which calls the handler directly.
