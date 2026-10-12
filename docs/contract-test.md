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
- Unknown paths, invalid percent-encoding, and `/v2/...` return `404`. `POST` and `DELETE` return `405`.
- For every cacheable endpoint, sending the response's `ETag` back in `If-None-Match` returns `304`, and a stale `ETag` returns `200`.
- `/random-fact` sends no `ETag`.
- `HEAD` matches `GET` without a body, and `OPTIONS` answers preflight requests.
- Following `pagination.links.next` from the first page visits every item in each collection exactly once.

### Coverage

After the requests, the test checks that every status code documented for every operation came up at least once. `429` and `500` are excluded: Netlify's rate limiter sends `429`, and `500` only happens on an unexpected exception.

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

```yaml
api:
  name: API (spec lint + contract test)
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v7
    - uses: actions/setup-node@v7
      with:
        node-version: 22
        cache: npm
    - run: npm ci
    - name: Lint the OpenAPI spec
      run: npm run lint
    - name: Run the contract test
      run: npm test
```

Netlify deploys on every push no matter what CI reports. To make a failing contract test block publishing, merge to `main` through pull requests with this check required.
