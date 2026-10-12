# The contract test

`scripts/contract-test.mjs` checks that the API does exactly what the spec says. It imports the function's handler and calls it with standard `Request` objects, so it needs no server, no deploy, and no network.

**Summary**

- Run it with `npm test`. It prints one pass line, or lists every failed check and exits with code 1.
- It validates each response's status code, `Content-Type`, documented headers, and body against the spec, using Ajv with JSON Schema 2020-12 (the dialect OpenAPI 3.1 uses).
- It compares every documented example with the real response to its request, so the docs can't drift from the API.
- It fails if a documented status code is never exercised, or if the data has a broken reference.
- CI runs it in `.github/workflows/ci.yml`, after `npm run lint`.

## Why it exists

The spec and the function are written by hand, so nothing ties them together on its own. Without a check, they drift: a new field never gets documented, an example shows an old value, or an error type gets renamed in one place only. The test makes every one of those a CI failure.

## What it checks

### Each response

For each request, the test finds the matching operation in the spec and checks:

- The status code is documented for that operation. `405` is the exception, because it applies to methods the spec doesn't describe, so the test checks for the `Allow` header instead.
- The `Content-Type` matches the documented media type.
- Every header the spec documents is present and matches its schema. For example, `Cache-Control` must equal `public, max-age=3600`.
- The body matches the schema. Response schemas use `additionalProperties: false`, so an undocumented field fails.
- Every error's `type` appears in the Errors table in the spec's introduction.
- CORS and `X-Content-Type-Options` headers are present.

### Behavior

The test makes requests that cover each rule in the docs:

- Filters (`category`, `place`, and both together) return only matching items.
- Invalid IDs (`abc`, `010`, `0`, `-1`, `1.5`, `Sognefjord`, `-oslo`) return `400`. Unknown IDs return `404`.
- Unknown, repeated, and out-of-range parameters return `400`, and several invalid parameters produce one error each.
- Unknown paths, `/v2/...`, and the old `/api/norway-data/...` paths return `404`. Invalid percent-encoding returns `400`. `POST` and `DELETE` return `405`.
- `/norway-data` redirects (`302`) to `/norway-data/v1`.
- `utm_*` and `_` parameters are ignored and left out of pagination links, but a parameter that only looks similar, such as `utmx`, is still rejected.
- For every cacheable endpoint, the `ETag` is weak, sending it back in `If-None-Match` (in weak or strong form) returns `304`, and a stale `ETag` returns `200`.
- `/random-fact` sends no `ETag`.
- `HEAD` matches `GET` without a body, and `OPTIONS` answers preflight requests.
- Following `pagination.links.next` from the first page visits every item in each collection exactly once.
- Links in responses use the origin of the request, whatever host was called (checked for a deploy preview's host and `localhost`).
- The `rate-limited` function's `429` matches the spec's `TooManyRequests` response: status, media type, `Retry-After`, body schema, and a documented error `type`.
- **Security:** a request that arrives as `http://` still gets `https` links; every kind of response (`200`, `302`, `304`, `204`, `400`, `404`, `405`, `429`) has the security headers; cacheable responses have the `Netlify-Vary` cache key header; and long values echoed in errors are clipped.

### Coverage

After the requests, the test checks that every status code documented for every operation came up at least once. `429` and `500` are excluded: `429` comes from the separate `rate-limited` function, which is checked on its own, and `500` only happens on an unexpected exception.

### Examples

- Every `example` in the spec must match its schema.
- Every media type example with an `x-example-request` must equal the real response to that request.
- Every `json` block in the introduction that follows a `bash` block with a `curl` command must equal the real response to that command. The test also requires at least four of these, so a formatting change can't make it quietly skip them all.

See [Examples are real responses](spec.md#examples-are-real-responses) for how to write examples the test can find.

### Data

- Every fact's `category` exists, and every ID in its `placeIds` is a real place.
- Category and place IDs match the documented ID pattern.
- Fact and place IDs are unique and in order.
- The `category` parameter's `enum` in the spec matches the categories in `data.mjs`.

## How it validates schemas

OpenAPI 3.1 schemas are JSON Schema 2020-12, so the test uses Ajv's 2020 build (`ajv/dist/2020.js`) with `ajv-formats` for `format: uri`. Only `components.schemas` is registered with Ajv, as `$defs` in a schema with the ID `spec`, because the rest of an OpenAPI document isn't JSON Schema. Each `$ref` to `#/components/schemas/X` is rewritten to `spec#/$defs/X`.

## Checking that it catches problems

A test that never fails proves nothing. When the test was written, it was checked by planting mistakes and confirming each one failed:

| Planted mistake | Failure reported |
| --- | --- |
| An extra field on one place | `body doesn't match schema: must NOT have additional properties` |
| A wrong `total` in an introduction example | `introduction example for .../facts?place=svalbard isn't the actual response` |
| A misspelled place ID in a fact's `placeIds` | `fact 5 references unknown place ...` |

Its first runs also caught three real bugs: a path matcher that treated `/v2/facts` as `/v1/facts`, a documented `404` on `/random-fact` that could never happen, and a missing test for one endpoint's `400`.

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

1. `npm run lint`: the Redocly lint of the spec.
2. `npm test`: this contract test.
3. `npm run check:bundle`: bundles the functions with Netlify's own bundler, so a config error (such as a non-literal `config.path`) fails here instead of in a deploy.
4. `npm run check:version`: if anything under `netlify/functions/` or the spec changed, the spec's `info.version` must be new, the changelog must have a row for it, and `package.json`'s version must match.

CI installs with `npm ci --ignore-scripts`, and checkouts don't keep the GitHub token.

Netlify's build command also runs the lint and this test, so a commit that fails them never deploys, whatever CI reports.

## The smoke test

The contract test calls the functions in memory, so it can't catch problems that only exist once deployed. `scripts/smoke-test.mjs` checks a deployed copy over the real network:

- The unversioned root redirects to `/v1`.
- The index and pagination links, the `Link` header, and the spec link all point at the host that was called.
- CORS headers, `Cache-Control`, a weak `ETag`, and a `304` on revalidation.
- An unknown fact returns a problem details `404` with a `requestId`.
- The spec is served, with CORS.
- Security headers on a success, an error, and the spec, and `https` links even when the request sends `X-Forwarded-Proto: http` (on a unique URL, so it never touches a cache entry real clients use).
- `--rate-limit`: a burst of uncached requests gets a problem details `429` with `Retry-After`, and a burst of direct requests to `/_rate-limited` eventually gets Netlify's empty `429` (so it has its own limit).
- `--redirects`: the old `www.marlasowards.com` URLs and the `netlify.app` domain redirect (`301`) to `api.marlasowards.com`.

`.github/workflows/smoke.yml` runs it:

- **After each push to `main`**, against production, with `--rate-limit`. It first waits until production serves a spec with the pushed version, which means Netlify finished deploying it. CI requires a version bump for every API change, so this always tests the new deploy. (Netlify doesn't report production deploys to GitHub, so the workflow can't be triggered by the deploy itself.)
- **Every hour**, against production, with `--redirects`. This is the API's uptime check: when a scheduled workflow fails, GitHub emails the repo owner.

Two bugs that reached production before the smoke test existed are exactly what it now checks: pagination links that pointed at the `netlify.app` host, and a rate limit that proxied requests skipped.
