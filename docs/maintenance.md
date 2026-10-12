# Maintaining the API

How to make common changes, and what to check afterward. In every case, run both checks before you push:

```bash
npm test
npm run lint
```

**Summary**

- **Adding a fact or place:** edit `data.mjs`. IDs must never change or be reused.
- **Changing data used in an example:** the contract test reports which examples no longer match. Update them in the spec.
- **Adding a category:** update `data.mjs`, the `category` parameter's `enum`, and the current values listed in `CategoryId`'s description.
- **Adding an endpoint:** add a handler and a route in the function, then the path, examples, and a changelog row in the spec, then test cases.
- **Breaking changes** need a `v2`. Within `v1`, changes must be additive.

## Add a fact

Add an entry to the end of `facts` in `netlify/functions/norway-data/data.mjs`, with the next unused integer ID:

```js
{ id: 28, category: 'culture', title: 'A short headline', text: 'One or two sentences.', placeIds: [] },
```

- Never reuse or renumber an ID. The docs promise IDs are stable.
- `category` must be an existing category ID.
- Every ID in `placeIds` must be an existing place. Add the place first if it's new.

Adding a fact changes `pagination.total`, so examples with that total might no longer match. Run `npm test`. It names each example that's out of date. Update those examples in the spec.

## Add a place

Add an entry to `places` in `data.mjs`, keeping the array sorted by ID:

```js
{ id: 'lofoten', name: 'Lofoten', type: 'archipelago', description: 'One sentence about the place.' },
```

- The ID is the name in lowercase ASCII, with spaces turned into hyphens and letters such as `ø` replaced (`Mjøsa` becomes `mjosa`).
- If `type` is a new value, add it to the list of current values in the `Place` schema's `type` description in the spec.

## Add a category

1. Add it to `categories` in `data.mjs`.
2. Add its ID to the `category` parameter's `enum` in `components.parameters.Category`. The contract test fails if the two lists differ.
3. Add its ID to the current values listed in `components.schemas.CategoryId`'s description.
4. Add a changelog row. A new category is an additive change, so it stays in `v1`.

## Change the docs

The conceptual docs are in `info.description` in `public/openapi/norway-data.yaml`.

- **Renaming a `##` heading changes its anchor.** Search the spec for `#description/` plus the old heading's anchor, and update each link.
- **Adding a curl example:** put a `bash` block with the `curl` command directly before a `json` block with the exact response. The contract test checks the pair. To get the exact response, run the contract test with your best guess and copy the actual output, or call the function with `npm run dev` running.
- **Adding an endpoint example:** add `x-example-request` with the request path next to the `example`.
- Don't put an example in the docs that the test can't check, unless the response is random or can't be produced on purpose.

## Add an endpoint

1. **Function:** write a handler that starts with `parseQuery()` (pass `{}` if it takes no query parameters), and add its route in `route()`. Use `paginate()` for a collection and `jsonResponse()` for a single resource.
2. **Spec:** add the path with its parameters, every response it can return (`200`, `304` if it's cacheable, `400`, `404` if it has an ID, `429`, `500`), and an example with `x-example-request`.
3. **Index:** if it's a new collection, add it to the index handler's `links` and to the `ApiIndex` schema.
4. **Contract test:** add requests for each status code. The coverage check lists any you missed.
5. **Changelog:** add a row and bump `info.version`. A new endpoint is a minor version.

## Breaking changes

Within `v1`, only additive changes are allowed: new endpoints, new optional parameters, new fields, and new values for category IDs and place types. Removing or renaming a field, changing a type, or making a parameter required needs a `v2` at a new base URL, with `v1` left running. The function's `ROOT_PATH` and `VERSION` constants and the spec's `servers` URL are the places to start.

## Change the rate limit

Edit `rateLimit` in the function's `config`, and update the Rate limits section of the introduction to match. Remember that `config` values must be literals.

## Troubleshooting

### The deploy fails during "Functions bundling"

If the deploy log shows `Function norway-data has a configuration error`, a value in `export const config` isn't a literal. Netlify reads `config` without running the code. Replace any constant, template string, or expression with a literal value.

### Test Request shows "Failed to fetch"

The browser got a response it couldn't read, which almost always means the request didn't reach the function. Netlify's 404 page has no CORS headers, so a browser reports it as a network error.

1. Check that the latest deploy succeeded and that the function shows up in Netlify under **Logs** > **Functions**.
2. Run `curl -i https://norway-data-api.netlify.app/api/norway-data/v1/facts/10`. A JSON response means the function is up.
3. Run the same request against `https://www.marlasowards.com`. If step 2 works but this doesn't, the proxy rules in marlasowards.com's `netlify.toml` are the problem.

### The API isn't running locally

Use `npm run dev`, which runs the function with the Netlify CLI at `http://localhost:8888`.

### The contract test says an example isn't the actual response

The data or the API changed, and an example in the spec is out of date. The failure names the request. Run it, and replace the example with the actual response.
