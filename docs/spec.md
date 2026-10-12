# The OpenAPI spec

`public/openapi/norway-data.yaml` (OpenAPI 3.1) is the API's contract and the content of its reference page. The reference page at https://www.marlasowards.com/api-reference is rendered by [Scalar](https://scalar.com) from this file, loaded from https://api.marlasowards.com/openapi/norway-data.yaml, so everything on the page comes from here, including the conceptual docs.

**Summary**

- The spec's `info.description` holds the conceptual docs: quick start, data model, request rules, pagination, caching, rate limits, errors, versioning, changelog, and notes on the data. Each `##` heading becomes its own section on the reference page.
- Every example in the spec is the real response to a known request. The [contract test](contract-test.md) fails if one drifts.
- Run `npm run lint` to lint the spec with Redocly.

## Spec layout

| Part | Contents |
| --- | --- |
| `info.description` | The conceptual docs (see [The introduction](#the-introduction)) |
| `info.contact` | Links to the repo's GitHub Issues, so readers know where to report a problem |
| `info.license` | MIT, the same as the repo |
| `servers` | The production base URL, `https://api.marlasowards.com/norway-data/v1`. Scalar's generated code samples use it, which is why they work as-is. |
| `security: []` | States that there's no authentication. Without it, Redocly's `security-defined` rule fails. |
| `tags` | One per resource: Index, Facts, Categories, Places |
| `paths` | One `get` per endpoint |
| `components` | Shared parameters, headers, schemas, and responses |

### Conventions in the spec

- **Response schemas use `additionalProperties: false`.** If the function starts returning a field the spec doesn't list, the contract test fails.
- **Values that can gain new options are open strings.** `CategoryId` and a place's `type` are `type: string` with the current values in the description, not an `enum`. Code generators turn an `enum` into a closed type that would reject a value added later, which would contradict the docs' promise that new values can appear within `v1`. The `category` query parameter is still an `enum`, since it's input the API validates.
- **Schemas use `examples` (an array), not `example`.** `example` inside a schema is deprecated in OpenAPI 3.1. Parameter and media type objects still use `example`, which isn't deprecated there.
- **Descriptions link to the introduction instead of repeating it.** For example, the `Limit` parameter says `See [Pagination](#description/pagination).` rather than restating the pagination rules. Each rule has one home, so they can't drift apart.
- **Parameter examples must work together.** The reference page's **Test Request** fills in every parameter's example at once, so each operation's examples have to make a request that succeeds and, for a collection, returns items. `category=history`, `place=svalbard`, and `offset=2` were each valid alone but together matched nothing. The contract test now calls every operation with all of its examples and fails if a collection comes back empty.
- **Shared responses are components.** `BadRequest`, `NotFound`, `NotModified`, `TooManyRequests`, and `InternalError` are defined once and referenced by each operation.

## The introduction

`info.description` is Markdown that Scalar shows above the endpoints. The text before the first heading is a short overview. Each `##` heading after it is its own section:

| Section | Covers |
| --- | --- |
| What you can build | Who the API is for and example uses |
| Quick start | A first request and its response |
| Authentication | None needed |
| Data model | Facts, categories, places, a diagram of how they relate, and how IDs work |
| Endpoints at a glance | Every endpoint, what it returns, and its query parameters |
| Request rules | Base URL, methods, strict parameters, unknown paths, CORS |
| Response format | JSON conventions and the collection vs. single-resource rule |
| Pagination | `limit`, `offset`, and page links |
| Caching | `ETag`, `304`, and which responses are never cached |
| Rate limits | The limit and what a `429` looks like |
| Errors | The problem details format and a table of every error `type` |
| Versioning | What can change within `v1` |
| Changelog | One row per release |
| About the data | Sources, language, license, and where to report issues |

Scalar gives each heading an anchor of `#description/` plus the heading text in lowercase, with spaces replaced by hyphens. That's how descriptions elsewhere in the spec link to sections, such as `#description/caching`. **If you rename a heading, search the spec for links to its old anchor.**

Error `type` values deliberately don't use these anchors. An earlier version did (`https://www.marlasowards.com/api-reference#description/not-found`), which meant renaming a heading would change a value clients branch on. See [Design decisions](design-decisions.md).

## Examples are real responses

Every example in the spec is the exact response to a specific request, so the docs can't show something the API wouldn't send. There are two kinds:

**Examples in the introduction.** A fenced `json` block that comes right after a fenced `bash` block containing a `curl` command is that command's response:

````markdown
```bash
curl https://api.marlasowards.com/norway-data/v1/facts/10
```

```json
{
  "id": 10,
  ...
}
```
````

**Examples on endpoints and shared responses.** A media type with an `example` also has an `x-example-request` with the path that produces it:

```yaml
content:
  application/json:
    schema:
      $ref: '#/components/schemas/Place'
    x-example-request: /places/sognefjord
    example:
      id: sognefjord
      name: Sognefjord
      ...
```

Scalar ignores `x-` extensions unless it's configured to show them, so `x-example-request` doesn't appear on the page.

The [contract test](contract-test.md) makes each request and compares the response to the example. The only examples without a request are `/random-fact` (its response is random) and `InternalError` (the API can't be made to fail on purpose). Those are still checked against their schemas.

Examples that include a `requestId` use the placeholder `01JEXAMPLE0REQUEST0ID00000`. The contract test passes that same value to the function, so error examples match exactly.

## Linting

```bash
npm run lint
```

This runs a pinned version of Redocly's CLI with its built-in `recommended` rules. The spec currently passes with no errors or warnings. The CI workflow runs the same command.
