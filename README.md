# Norway Data API

A small, public, read-only REST API with short facts about Norway and the places they're about.

- **API reference:** https://www.marlasowards.com/api-reference
- **Base URL:** `https://www.marlasowards.com/api/norway-data/v1`
- **OpenAPI spec:** [`public/openapi/norway-data.yaml`](public/openapi/norway-data.yaml) (OpenAPI 3.1)

```bash
curl https://www.marlasowards.com/api/norway-data/v1/facts/10
```

No key or account is needed. The reference page covers authentication, pagination, caching, rate limits, errors, and versioning.

## How it's built

| Part | Where |
| --- | --- |
| The API: routing, validation, pagination, caching, errors | [`netlify/functions/norway-data/norway-data.mjs`](netlify/functions/norway-data/norway-data.mjs), a Netlify Function |
| The data: facts, categories, places | [`netlify/functions/norway-data/data.mjs`](netlify/functions/norway-data/data.mjs) |
| The contract, and the reference page's content | [`public/openapi/norway-data.yaml`](public/openapi/norway-data.yaml) |
| The contract test | [`scripts/contract-test.mjs`](scripts/contract-test.mjs) |
| CI | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |

This repo deploys to its own Netlify site. The site has no build step: Netlify publishes `public/` (the spec) and bundles the function. Visitors to the site's root are redirected to the reference page.

[marlasowards.com](https://www.marlasowards.com) proxies two paths to this site, so the API and the spec are served from the same domain as the reference page:

| Public URL | Served from this repo |
| --- | --- |
| `/api/norway-data/*` | The function |
| `/openapi/norway-data.yaml` | `public/openapi/norway-data.yaml` |

The reference page itself is a Docusaurus page on marlasowards.com, rendered by [Scalar](https://scalar.com) from the spec at that URL.

## Docs

- [The Netlify Function](docs/function.md): routing, validation, pagination, caching, errors, and headers
- [The OpenAPI spec](docs/spec.md): layout, conventions, the introduction, and how examples are tied to real responses
- [The contract test](docs/contract-test.md): what it checks and how
- [Maintaining the API](docs/maintenance.md): adding facts, places, categories, and endpoints, and troubleshooting
- [Design decisions](docs/design-decisions.md): how the API got its current shape, and why

## Develop

Requires Node.js 20 or later.

```bash
npm install
npm test        # contract test: every response checked against the spec
npm run lint    # Redocly lint of the spec
npm run dev     # runs the function locally with the Netlify CLI
```

With `npm run dev` running, the API is at `http://localhost:8888/api/norway-data/v1`.

### The contract test

The spec and the function are both written by hand, so `npm test` keeps them in sync. It calls the function's handler directly (no server needed) and fails if:

- A response's status code, `Content-Type`, documented headers, or body doesn't match the spec.
- A documented status code is never exercised.
- An example in the spec isn't the exact response to its request. This covers each `x-example-request` example and each `curl` + `json` pair in the spec's introduction.
- An error `type` isn't listed in the spec's Errors table.
- The data has a broken reference, such as a fact pointing at a place that doesn't exist.

CI runs the lint and the test on every push and pull request.

## Common changes

- **Add a fact:** append to `facts` in `data.mjs` with the next unused ID. IDs never change and are never reused.
- **Add a place:** add to `places` in `data.mjs`, sorted by ID. The ID is the name as a lowercase ASCII slug (`Mjøsa` → `mjosa`). If its `type` is new, add it to the current values in the `Place` schema's `type` description.
- **Add a category:** add it to `categories` in `data.mjs`, to the `Category` parameter's `enum`, and to the current values in `CategoryId`'s description.

Then run `npm test`. If a change in counts makes an example out of date, the test names it. Replace it with the actual response.

Within `v1`, changes must be additive: new endpoints, optional parameters, fields, or enum-like values. Anything that could break a client needs a `v2`.

### Netlify function config

Every value in the function's `export const config` must be a literal. Netlify reads it at deploy time without running the code, so a constant or template string fails the deploy with `configuration error on 'path'`.

## Report an issue

Open an issue in this repository. For an API error, include the `requestId` from the error response.

## License

[MIT](LICENSE), for both the code and the data. The facts are general-knowledge summaries and aren't individually sourced. This API isn't affiliated with the Norwegian government, Statistics Norway, or any other official source of Norwegian data.
