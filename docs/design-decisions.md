# Design decisions

The API and its docs went through three rounds. The first version worked but was naive. It was then reviewed from two points of view, as a principal API developer and as a principal API technical writer, and every finding was fixed. This page records what changed and why, so the reasons aren't lost.

**Summary**

- **API review:** added a version to the URL, fixed a crash and a status code, made all collections paginated, added caching and conditional requests, made parameters strict, improved errors, added rate limiting, and added the contract test.
- **Docs review:** made error types independent of the docs, fixed inaccurate claims about rate limiting, made every example a real response, split the introduction into sections, added a data model, and replaced counties with places so every resource relates to the others.

## Version 1: the first pass

The first version, then called the Norway Facts API, had facts, categories, and Norway's 15 counties at unversioned URLs such as `/api/norway-facts/facts`, with a `/facts/random` endpoint and a bare-bones spec. Its first deploy failed because the function's `config.path` used a constant (see [Routing](function.md#routing)).

## API developer review

| Finding | Change |
| --- | --- |
| Invalid percent-encoding such as `/facts/%E0` crashed the function and returned Netlify's generic 500 page | Top-level error handling. A malformed path now returns a JSON `404`, and anything unexpected returns a JSON `500`. |
| `/facts/abc` returned `404`, but the spec says IDs are integers. `/facts/010` returned fact 10, so one fact had many URLs. | Non-integer IDs return `400`, and only canonical IDs are accepted. |
| No version in the URL. Adding one later would break every published code sample. | Moved everything under `/v1`. |
| `/facts/random` sat where an ID belongs, which some clients and code generators handle badly | Renamed to `/random-fact`. |
| No caching, so every request ran the function | `ETag`, `If-None-Match`/`304`, `Cache-Control`, and a long CDN cache. `/random-fact` is `no-store`. |
| `/facts` was paginated but `/categories` wasn't, and single resources were bare | One rule: every collection is paginated, and single resources are bare. |
| Error titles were custom with `type: about:blank`, there was no `instance`, and bad parameters were only described in prose | Distinct problem types, `instance`, `requestId`, and an `errors` array that lists every bad parameter. |
| Misspelled or repeated parameters were silently ignored | Strict parameters: each one returns a `400`. |
| `HEAD` returned `405` | `HEAD` is supported on every endpoint. |
| The API root (`/api/norway-facts`) was a dead end | Returns an index with links to everything. |
| The spec and code were synced by hand, and the spec wasn't linted | The contract test, plus a spec lint in CI. |
| The spec left out `304`, `429`, and `500` and response headers, and used the deprecated `example` keyword in schemas | Documented all of them, and switched to `examples`. |
| A public, pay-per-call function had no rate limit | Netlify `rateLimit` config: 60 requests per 60 seconds per IP. |
| Minor: `charset` on JSON, no `nosniff`, an empty-category edge case, unnecessary CORS headers | All fixed. An empty category is treated as a data bug (`500`), not a client error. |

## API technical writer review

| Finding | Change |
| --- | --- |
| Error `type` URIs pointed at heading anchors, so renaming a heading would change a value clients branch on | `type` is now a `tag:` URI, independent of any page. The docs say it's an identifier, not a link. |
| The rate limit was described as resetting, but Netlify uses a sliding window. "Cached responses don't count" was never verified. | Describes the sliding window accurately. The unverified claim was removed. |
| "`v1` keeps working" was a promise a sample site can't back up | Softer wording, plus a changelog. |
| The docs said new categories could appear, but the schema was a closed `enum`, so generated clients would reject them | Response fields that can gain values are open strings. |
| The quick start used the random endpoint, so its example never matched. A real production request ID was reused. The pagination example wasn't valid JSON. | The quick start uses `/facts/10`, and examples use a placeholder ID and full, real JSON. All examples are now checked by the contract test. |
| Undocumented behavior: the `404` on invalid encoding and the `Netlify-CDN-Cache-Control` header | Both documented. |
| One long introduction held every topic | A short overview, then one `##` section per topic. |
| The page spoke to a hiring manager and a developer at the same time | The reference speaks only to developers. The "why this exists" framing moved to the portfolio page on marlasowards.com. |
| Counties weren't related to facts or categories | Replaced with places (see below). |
| Many endpoints had no examples, so Scalar showed placeholder values. Parameters had no examples. | Every endpoint and parameter has a real example. |
| The same rules were repeated in several places | Each rule lives in one introduction section, and other descriptions link to it. |
| No data model, ID stability, sources, language, license, or way to report issues | Added a Data model section and an About the data section. |
| Inconsistent terms ("item", "resource", "representation"), undefined jargon, and a "we" voice in one error message | Consistent terms, "collection" defined, jargon removed. |

## Why places replaced counties

Counties were reference data with no link to the facts. A reader couldn't do anything with them that involved the rest of the API, and the writer's review asked why they were there.

Places are the locations facts are about: Sognefjord, Galdhøpiggen, Svalbard, and so on. Each fact lists its places in `placeIds`, `GET /facts?place={id}` returns the facts about a place, and `GET /places/{id}` describes one. All three resources now connect: a fact has a category and places, and both can filter facts.

Place IDs are lowercase ASCII slugs of the name (`galdhopiggen` for Galdhøpiggen), so they're safe in URLs without percent-encoding.

## Renamed to Norway Data API

The API started as the Norway Facts API, with URLs under `/api/norway-facts`. It was renamed in October 2026, and everything changed with it: the URLs (now `/api/norway-data`), the function and spec file names, the error `type` identifiers, and these docs. Nothing outside this site used the old URLs, so no redirect was added.

Because "Norway Data" could sound like an official government source, the About the data section of the spec says the API isn't affiliated with any official source of Norwegian data.

## Moved to its own repo

The API started inside the repo for marlasowards.com, next to the site that hosts its reference page. It moved to this repo so the API, its spec, its tests, and its CI form one standalone project, and so issue links on the reference page point at the API rather than at a portfolio site.

At first, the public URLs didn't change: marlasowards.com proxied `/api/norway-data/*` and `/openapi/norway-data.yaml` to this repo's Netlify site, and the reference page stayed on marlasowards.com. The proxy was later replaced by a custom domain (see [Production readiness review](#production-readiness-review)).

## Production readiness review

A third review looked at how the API is deployed, verified, and protected. Two of its findings were bugs that only existed in production, and both came from the proxy that served the API from `www.marlasowards.com`.

| Finding | Change |
| --- | --- |
| Requests through the proxy skipped the rate limit entirely: 70 quick requests all returned `200`, while the same burst sent directly to the API's site got a `429` | Moved the API to its own domain, `api.marlasowards.com`, with no proxy. The old URLs redirect (`301`) to the new ones. Released as 1.1.0. |
| Behind the proxy, the function saw its `netlify.app` host, so pagination and index links pointed there. A workaround hardcoded both hostnames into the function. | With no proxy, links use the request's own origin. No hostnames are hardcoded except the reference page's URL, which an environment variable can override. |
| Every request made an extra network hop through the proxy | Removed with the proxy. |
| A failing contract test didn't stop a deploy | Netlify's build command runs the lint and contract test. |
| Nothing tested the deployed API, and Netlify config errors only showed up in a deploy | A smoke test runs after each deploy and every hour, and CI bundles the functions with Netlify's bundler. |
| Strict parameters rejected `utm_*` tracking parameters and `_` cache-busters | Those two are ignored. Everything else stays strict. |
| Hostnames were spread across five files in two repos | One `DOCS_URL` constant; everything else comes from the request. |
| Actions pinned to tags, a floating `netlify-cli` version, no Dependabot, no `SECURITY.md` | Actions pinned to commit SHAs, exact tool versions, Dependabot for npm and Actions, a security policy, issue templates, and `CODEOWNERS`. |
| No request logging or uptime check | A JSON log line per request (no personal data), and the hourly smoke test as an uptime alert. |
| The changelog missed two client-visible changes | Back-filled as 1.0.1. CI now fails if the API changes without a new version and changelog row. |
| Netlify's `429` had an empty body and no `Retry-After` | The rate limit rewrites to a function that returns a problem details `429` with `Retry-After`. |
| A malformed path returned `404` | Now `400`, with its own `invalid-path` type. |
| Strong `ETag`s didn't change with compression | Weak `ETag`s. |
| The `Accept` header was ignored without saying so | Documented. |
| `/norway-data` returned the v1 index, which would be ambiguous once a v2 exists | It redirects to the current major version. |

Agent-focused changes from the same review, such as an MCP server, `llms.txt`, compact responses, sources on each fact, search, and a higher rate limit, were deliberately left for later.

## Security review

A security review the same day found two exploitable problems in production, both now fixed, plus gaps in the surrounding settings.

| Finding | Change |
| --- | --- |
| **Cache poisoning (proven).** Links took their scheme from `req.url`, which Netlify builds from the client-controlled `X-Forwarded-Proto` header. One request with `X-Forwarded-Proto: http` got `http://` links cached for everyone who requested the same URL. | Links always use `https` (except on `localhost`), and `Netlify-Vary` limits the cache key to documented parameters. Contract and smoke tests check both. Released as 1.1.1. |
| **Rate limit bypass (proven).** `/_rate-limited` was a public URL with no limit: 155 direct requests all ran the function. | The `rate-limited` function has its own rate limit. The smoke test checks it. |
| **Build supply chain.** Netlify's build command downloaded Redocly with `npx --yes`, without the lockfile's integrity checks, before bundling the deployed functions. | Build tools are exact-version dev dependencies, and Netlify and CI install with `--ignore-scripts`. |
| **Third-party viewer.** Scalar's defaults sent every **Test Request** through `proxy.scalar.com`, turned on telemetry and an "Ask AI" agent, and loaded fonts from `fonts.scalar.com`. | The reference page turns all four off (in the marlasowards.com repo). |
| No security headers on API responses | CSP, `Referrer-Policy`, `Cross-Origin-Resource-Policy`, and HSTS with `includeSubDomains` on every response and on the spec. |
| Private vulnerability reporting was off, although `SECURITY.md` told reporters to use it | Turned on, along with Dependabot security updates and CodeQL. A ruleset blocks force-pushes and deletion of `main`. |
| Logs kept full query strings, and errors echoed client input at any length | Only documented parameters are logged, and echoed values are clipped. |
| No CAA record, no usage alerts, deploy previews possibly building outsiders' code, account 2FA unverified | Documented as required settings in [Security](security.md#settings-outside-the-code). |

## Docs and browser review

A fourth review, on 12 October 2026, measured the docs against common API documentation practice and tested the API from a real browser. It also added a tutorial and how-to guides on marlasowards.com.

| Finding | Change |
| --- | --- |
| Endpoint descriptions said what each endpoint returns, not what it's for | Each one says what it's for and how it connects to the others. Released as 1.1.3. |
| Undocumented behavior: with both filters, a fact must match both, and an unknown `place` returns `400` | Both documented in 1.1.3. |
| **Test Request** returned something different from the documented examples | Parameter and response examples now match. Released as 1.1.3. |
| No advice on staying under the rate limit, and no mention that there's no remaining-requests header | Documented in 1.1.3. |
| A rate-limited `429` reported `/_rate-limited`, the internal rewrite target, as its `instance` | `instance` comes from Netlify's undocumented `netlify-ratelimit-original-url` header. Released as 1.1.6. A first attempt in 1.1.4 used `context.url`, which the smoke test showed is the internal path too. A temporary diagnostic in 1.1.5 logged the names of the headers Netlify passes, which found the header. |
| The reference had no tutorials or task-based guides | A tutorial and four how-to guides on marlasowards.com, with tested JavaScript and Python. Linked from the spec in 1.1.5. |
| In a browser, a `304` from the CDN has no CORS headers, so code that sets `If-None-Match` itself gets a network error | Documented as a known limitation in 1.1.6 (see below). |
| Preflights allow only `If-None-Match`, but the docs said any website can call the API without mentioning that limit | Documented in 1.1.6. |

### Known limitation: CDN `304`s without CORS headers

Netlify's CDN answers a matching `If-None-Match` itself, from its cached copy, and that `304` leaves out `Access-Control-Allow-Origin`. Browsers' own revalidation isn't affected, because the browser applies the `304` to a cached response that has the header. Only browser code that sends `If-None-Match` itself fails, and it fails closed: the browser blocks the response, and nothing is exposed.

Two fixes were considered and not taken:

- An edge function that adds CORS headers to every response, including the CDN's `304`s. It would add a moving part to every request, for a problem the docs can steer clients around.
- Turning off the long CDN cache, so the function answers every request. That would reverse the caching decision in the [API developer review](#api-developer-review).

## Choices that stayed

- **No database.** The data is a JavaScript module, so responses are deterministic, the contract test can compare examples exactly, and there's nothing to provision.
- **Open CORS.** The API has always allowed every origin. Since it moved to its own domain, the reference page on `www.marlasowards.com` relies on that too. The data is public and the API takes no credentials, so `*` is safe.
- **Reference docs live in the spec.** The conceptual docs are in `info.description`, so the reference page is the one place a developer needs to learn how the API works. Tutorials and how-to guides need room for step-by-step code in two languages, so they're separate pages on marlasowards.com, linked from the spec.
- **Facts aren't individually sourced.** Adding citations would mean inventing or researching sources for each one. The About the data section says so plainly instead.
