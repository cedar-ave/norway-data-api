# Norway Data API

A small, public, read-only REST API with short facts about Norway and the places they're about.

- **API reference:** https://www.marlasowards.com/api-reference
- **Base URL:** `https://api.marlasowards.com/norway-data/v1`
- **OpenAPI spec:** https://api.marlasowards.com/openapi/norway-data.yaml (source: [`public/openapi/norway-data.yaml`](public/openapi/norway-data.yaml), OpenAPI 3.1)

```bash
curl https://api.marlasowards.com/norway-data/v1/facts/10
```

No key or account is needed. The reference page covers authentication, pagination, caching, rate limits, errors, and versioning.

## How it's built

| Part | Where |
| --- | --- |
| The API: routing, validation, pagination, caching, errors | [`netlify/functions/norway-data/norway-data.mjs`](netlify/functions/norway-data/norway-data.mjs), a Netlify Function |
| The rate limit's `429` response | [`netlify/functions/rate-limited/rate-limited.mjs`](netlify/functions/rate-limited/rate-limited.mjs) |
| The data: facts, categories, places | [`netlify/functions/norway-data/data.mjs`](netlify/functions/norway-data/data.mjs) |
| The contract, and the reference page's content | [`public/openapi/norway-data.yaml`](public/openapi/norway-data.yaml) |
| The contract test, smoke test, and version check | [`scripts/`](scripts/) |
| CI and smoke tests | [`.github/workflows/`](.github/workflows/) |

This repo deploys to its own Netlify site, whose primary domain is `api.marlasowards.com`. Netlify serves the function, publishes `public/` (the spec), and redirects visitors to the site's root to the reference page. The reference page itself is a page on [marlasowards.com](https://www.marlasowards.com), rendered by [Scalar](https://scalar.com) from the spec.

### Safety checks

| Check | When | What it catches |
| --- | --- | --- |
| Spec lint and contract test | Netlify's build command, on every deploy | A failing deploy never goes live. |
| Lint, contract test, function bundling, version check | CI, on every push and pull request | Also catches Netlify config errors, and API changes without a new version and changelog entry. |
| Smoke test with rate limit check | After each successful deploy | Problems that only exist once deployed: routing, CDN caching, CORS, the rate limiter, wrong-host links. |
| Smoke test with redirect checks | Every hour, against production | The API being down. A failed run emails the repo owner. |

## Docs

- [The Netlify Functions](docs/function.md): routing, validation, pagination, caching, rate limiting, errors, logging, and headers
- [The OpenAPI spec](docs/spec.md): layout, conventions, the introduction, and how examples are tied to real responses
- [The contract test](docs/contract-test.md): what it checks and how, plus the smoke test and version check
- [Maintaining the API](docs/maintenance.md): adding facts, places, categories, and endpoints, releasing, and troubleshooting
- [Design decisions](docs/design-decisions.md): how the API got its current shape, and why

## Develop

Requires Node.js 20 or later.

```bash
npm install
npm test                 # contract test: every response checked against the spec
npm run lint             # Redocly lint of the spec
npm run check:bundle     # bundles the functions like Netlify does
npm run dev              # runs the functions locally with the Netlify CLI
npm run smoke -- <url>   # smoke test a deployed copy, such as a deploy preview's URL
```

With `npm run dev` running, the API is at `http://localhost:8888/norway-data/v1`.

## Common changes

- **Add a fact:** append to `facts` in `data.mjs` with the next unused ID. IDs never change and are never reused.
- **Add a place:** add to `places` in `data.mjs`, sorted by ID. The ID is the name as a lowercase ASCII slug (`Mjøsa` → `mjosa`). If its `type` is new, add it to the current values in the `Place` schema's `type` description.
- **Add a category:** add it to `categories` in `data.mjs`, to the `Category` parameter's `enum`, and to the current values in `CategoryId`'s description.

Then run `npm test`. If a change in counts makes an example out of date, the test names it. Replace it with the actual response.

**Every change to the API or its data needs a new version.** Bump `info.version` in the spec and `version` in `package.json`, and add a changelog row in the spec's introduction. CI fails without them. Use a patch version for fixes and data, and a minor version for new features.

Within `v1`, changes must be additive: new endpoints, optional parameters, fields, or enum-like values. Anything that could break a client needs a `v2`.

### Netlify function config

Every value in a function's `export const config` must be a literal. Netlify reads it at deploy time without running the code, so a constant or template string fails the deploy with `configuration error on 'path'`. `npm run check:bundle` catches this locally.

## Report an issue

Open an issue in this repository with the **API bug** or **Data correction** template. For an API error, include the `requestId` from the error response. For security problems, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE), for both the code and the data. The facts are general-knowledge summaries and aren't individually sourced. This API isn't affiliated with the Norwegian government, Statistics Norway, or any other official source of Norwegian data.
