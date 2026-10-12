# The Netlify Functions

The API is one Netlify Function, `netlify/functions/norway-data/norway-data.mjs`, plus a small second function, `netlify/functions/rate-limited/rate-limited.mjs`, that answers rate-limited requests. Both use the modern Functions format: a default export that takes a standard `Request` and returns a `Response`.

**Summary**

- The site's production domain is `api.marlasowards.com`. Requests go straight to it, with no proxy in between.
- Netlify's build command runs the spec lint and the contract test, so a push that fails them never deploys.
- A function's URL comes from `export const config = { path: [...] }`. **Every value in `config` must be a literal.** Netlify reads it without running the code, and a constant or template string fails the deploy.
- `config.rateLimit` allows 60 requests per 60 seconds per IP address, then rewrites requests to the `rate-limited` function, which returns a problem details `429` with `Retry-After`. That function has its own rate limit, since it's a public URL too.
- Links always use `https` (except on `localhost`), never the scheme from the request. See [Security](security.md).
- Errors are thrown as `ProblemError` and turned into RFC 9457 problem details in one place. Anything else thrown becomes a `500`.
- Every request writes one JSON log line.

## Netlify setup

This repo deploys to its own Netlify site on every push to `main`. Its domain is `api.marlasowards.com`, and a rule in `netlify.toml` redirects (`301`) the site's `norway-data-api.netlify.app` address there. All the build settings are in `netlify.toml`:

```toml
[build]
  publish = "public"
  command = "npm run lint && npm test"

[functions]
  directory = "netlify/functions"
```

- **Dependencies install from the lockfile with install scripts off** (`NPM_FLAGS = "--ignore-scripts"`), and the build tools are exact-version dev dependencies.
- **The build command is a deploy gate.** There's nothing to build, but if the spec lint or the contract test fails, the build fails and Netlify keeps serving the previous deploy.
- `public/` holds the spec, served at `/openapi/norway-data.yaml`. Its responses allow any origin, so the reference page on `www.marlasowards.com` can load it.
- A redirect sends visitors to the site's root to the reference page.

Each subfolder of `netlify/functions/` is one function, named after the folder. Netlify bundles each one and everything it imports with esbuild. `npm run check:bundle` runs the same bundler locally and in CI, so a config error shows up before a deploy.

### Why there's no proxy

The API used to be served from `www.marlasowards.com/api/norway-data` through a proxy rule on that site. That caused three problems: proxied requests skipped the rate limit entirely, the function had to rewrite its links because it saw the `netlify.app` host, and every request took an extra hop. A custom domain on this site removed all three. The old URLs now redirect (`301`) to the new ones. See [Design decisions](design-decisions.md).

## Routing

The main function claims its URLs in code:

```js
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
```

> [!WARNING]
> The first deploy of this API failed with `Function norway-data has a configuration error on 'path': Must be a string or array of strings`. The path was written as ``[BASE_PATH, `${BASE_PATH}/*`]``. Netlify reads `config` statically at deploy time, so it can't evaluate a variable or a template string. Write every value in `config` as a literal and keep it in sync with the constants by hand.

Inside the function, `route()` maps the path to a handler:

1. `/norway-data` redirects (`302`) to `/norway-data/v1`, the current major version.
2. `/norway-data/v1` returns the index.
3. Anything else must start with `/norway-data/v1/`. The rest of the path is split into segments and decoded with `decodeURIComponent`.
4. The first segment picks the resource (`facts`, `random-fact`, `categories`, `places`) and the optional second segment is an ID. A third segment, or an unknown resource, returns `404`.

`decodeURIComponent` throws a `URIError` on invalid percent-encoding such as `%E0`. The function catches that and returns a `400` (`invalid-path`), instead of crashing with a generic Netlify error page.

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

Every problem goes into one `400` response's `errors` array, so a client sees all of them in one round trip. Endpoints with no query parameters call `parseQuery(searchParams, {})`, so any other query string is rejected.

Two kinds of parameters are ignored instead of rejected (`IGNORED_PARAM`):

- `utm_*` campaign tracking parameters, which links pick up when they're shared.
- `_`, which some HTTP clients add to bypass caches.

Rejecting those would break shared links and some clients for no benefit. They're also left out of pagination links.

Path IDs are checked the same strict way:

- Fact IDs must match `^[1-9]\d*$`, so `/facts/010` is a `400`, not an alias for `/facts/10`.
- Place IDs must match `^[a-z0-9]+(-[a-z0-9]+)*$`. A well-formed ID that doesn't exist is a `404`.

The `place` query filter would list every place ID in its error message, so it uses a custom `message` that points to `/places` instead.

The `Accept` header is ignored: every response is JSON. The reference page documents this.

## Pagination

`paginate()` handles every collection, even short ones, so clients only need one code path. It returns `data` plus `pagination` with `total`, `limit`, `offset`, and `links` (`first`, `prev`, `next`, `last`). The same links go in an RFC 8288 `Link` header.

Every URL in a response is built by `originOf()` from the request's own host, so links always point at the server that was called: production, a deploy preview, or `localhost`. The scheme is always `https` (except on `localhost`), never the one in `req.url`: Netlify sets that from the `X-Forwarded-Proto` header, which any client controls, and trusting it once let a single request poison the cache with `http://` links. See [Security](security.md#links-and-the-cache).

The only fixed URL is the reference page's (`DOCS_URL`), which can be overridden with a `DOCS_URL` environment variable in Netlify.

## Caching

The data only changes when the site deploys, and Netlify clears its CDN cache on every deploy. So cacheable responses get two headers:

```js
const CACHEABLE = {
  'Cache-Control': 'public, max-age=3600',
  'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=31536000',
  'Netlify-Vary': 'query=category|place|limit|offset',
};
```

- `Cache-Control` lets browsers and other caches keep a response for an hour.
- `Netlify-CDN-Cache-Control` lets Netlify's CDN keep it until the next deploy, so repeat requests don't run the function at all.
- `Netlify-Vary` limits the CDN's cache key to the documented parameters, so ignored parameters (`utm_*`, `_`) can't create new cache entries or bypass the cache.

`jsonResponse()` also sets an `ETag`: a hash of the response body. It's a weak `ETag` (`W/"..."`), because Netlify compresses responses, and a strong `ETag` would have to differ for each compression format. If a request's `If-None-Match` header matches it (weak and strong forms both count), the function returns `304 Not Modified` with no body.

`/random-fact` and every error response use `Cache-Control: no-store`. A cached random fact would stop being random.

## Rate limiting

`config.rateLimit` counts requests per IP address and hostname in a sliding 60-second window. Request 61 within any 60 seconds isn't sent to the function. Netlify rewrites it to `/_rate-limited` instead.

The `rate-limited` function returns the same problem details format as every other error, with a `Retry-After: 60` header:

```json
{
  "type": "tag:marlasowards.com,2026:norway-data/rate-limited",
  "title": "Too many requests",
  "status": 429,
  "detail": "Too many requests from your IP address. Wait 60 seconds, then retry.",
  "instance": "/norway-data/v1/random-fact",
  "requestId": "01JEXAMPLE0REQUEST0ID00000"
}
```

After the rewrite, the function's `req.url` is `/_rate-limited`, a path the client never requested. Netlify passes the original URL in a `netlify-ratelimit-original-url` request header, so `instance` comes from that header's path and query. The header isn't in Netlify's docs: it was found by temporarily logging the names of the headers the function receives. The smoke test's rate limit check confirms it in production. Without a usable header, the function falls back to `req.url`.

Without the rewrite, Netlify would send its own `429` with an empty body and no `Retry-After`, which clients would have to handle as a special case.

`/_rate-limited` is a public URL, so the `rate-limited` function has its own `rateLimit` (60 per minute per IP, Netlify's plain `429` past that). Without it, calling `/_rate-limited` directly would run a function with no limit at all. A client that keeps sending after a `429` eventually gets Netlify's empty `429`, which the spec tells clients to handle the same way.

## Errors

Every error is thrown as a `ProblemError` with a slug and a message, and the top-level handler turns it into an RFC 9457 problem details response:

```json
{
  "type": "tag:marlasowards.com,2026:norway-data/not-found",
  "title": "Not found",
  "status": 404,
  "detail": "No fact has the ID 99.",
  "instance": "/norway-data/v1/facts/99",
  "requestId": "01JEXAMPLE0REQUEST0ID00000"
}
```

- **`type`** is a `tag:` URI (RFC 4151). It's an identifier, not a link, so renaming a docs heading or moving the reference page can't change a value clients depend on.
- **`requestId`** comes from Netlify's `context.requestId`, which is also the response's `X-Nf-Request-Id` header. A reported ID can be found in the function logs.
- Anything thrown that isn't a `ProblemError` becomes a `500` with a generic message. The real error only goes to the logs.
- Text echoed from the request (IDs, paths, parameter names, methods) is clipped by `clip()`, so a long URL can't produce a long response.

## Logging

Every request writes one JSON line to Netlify's function logs:

```json
{"requestId":"01J...","method":"GET","path":"/norway-data/v1/facts","params":{"category":"history"},"otherParams":1,"status":200,"durationMs":1}
```

Only documented parameters are logged, with clipped values. Any other parameters are only counted (`otherParams`), in case a caller puts a token or personal data in a URL. The logs never include IP addresses. A `500` also logs the error itself, with the same `requestId`.

To find a request, open the site in Netlify, go to **Logs** > **Functions**, and search for its `requestId`.

## Other headers

- `Access-Control-Allow-Origin: *` on every response, and `Access-Control-Expose-Headers: ETag, Link, Retry-After` so browser scripts can read those three.
- Security headers on every response: `Strict-Transport-Security`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Cross-Origin-Resource-Policy: cross-origin`. `netlify.toml` sets the same ones on the static spec. See [Security](security.md#response-headers).
- `Content-Type` is `application/json` for success and `application/problem+json` for errors, with no `charset`. JSON is always UTF-8.

Responses are pretty-printed on purpose so they're readable in a terminal and on the reference page.

## Testing the function locally

Run the functions with the Netlify CLI:

```bash
npm run dev
```

The API is then at `http://localhost:8888/norway-data/v1`.

Run the smoke test against deployed copies, not `localhost`. When a function returns `404`, `netlify dev` retries the path with `.html` added, so an unknown ID such as `/facts/999999` comes back as a `400` for `/facts/999999.html`. Deployed sites don't do this.

For a quick check without a server, run the [contract test](contract-test.md), which calls the handlers directly.
