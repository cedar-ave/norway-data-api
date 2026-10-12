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

The public URLs didn't change. marlasowards.com proxies `/api/norway-data/*` and `/openapi/norway-data.yaml` to this repo's Netlify site, and the reference page stays on marlasowards.com.

## Choices that stayed

- **No database.** The data is a JavaScript module, so responses are deterministic, the contract test can compare examples exactly, and there's nothing to provision.
- **Same-origin API.** The function is served from the site's own domain, so the reference page never hits CORS problems. CORS is still open for other callers.
- **Docs live in the spec.** The conceptual docs are in `info.description` rather than a separate guide, so the reference page is the one place a developer needs.
- **Facts aren't individually sourced.** Adding citations would mean inventing or researching sources for each one. The About the data section says so plainly instead.
