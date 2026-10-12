# Security

How the Norway Data API is protected, what it's protected against, and what's deliberately not covered. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

**Summary**

- The API is public and read-only, with no accounts, keys, or user data. The main risks aren't data theft. They're running up the hosting bill, serving tampered responses, and attacks on the build pipeline or the accounts behind it.
- Every response sends security headers, links never trust the request's scheme, and the CDN cache key only includes documented parameters.
- Both functions are rate-limited, including the one that answers rate-limited requests.
- Build tools install from the lockfile with install scripts turned off.
- Some protections live in GitHub, Netlify, and DNS settings rather than code. They're listed under [Settings outside the code](#settings-outside-the-code).

## Threat model

| Asset | Threat | Main controls |
| --- | --- | --- |
| The Netlify bill | Floods of requests that run the function | Per-IP rate limits on both functions, CDN caching, usage alerts |
| Response integrity | Cache poisoning, so other clients get tampered responses | Scheme never taken from the request, cache key limited to documented parameters, links built from a host Netlify routed on |
| Visitors' browsers | Responses used as an attack page, or framed | `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `nosniff`, JSON only |
| The deployed code | A compromised dependency or CI step changing what's deployed | Lockfile installs with integrity hashes, no install scripts, Actions pinned to commit SHAs, deploy gate |
| The repo and the Netlify site | Account takeover, force-pushes, leaked secrets | Two-factor authentication, branch ruleset, secret scanning and push protection |
| The domain | Unauthorized certificates, subdomain takeover | CAA record, DNS hygiene when sites are removed |
| Logs | Personal data or tokens stored from URLs | Only documented parameters are logged, values clipped, no IP addresses |

Out of scope: confidentiality of the data (it's public) and authentication (there is none).

## Controls in the code

### Links and the cache

Netlify builds a function's `req.url` scheme from the `X-Forwarded-Proto` header, which any client can send. The API once built links from `req.url` directly, so one request with `X-Forwarded-Proto: http` got `http://` pagination links, and Netlify's durable cache served that response to everyone who asked for the same URL afterwards. Every deploy clears the cache, so after each deploy, the first request for a URL decided its links for everyone.

Now:

- `originOf()` always builds `https` links, except on `localhost`. The host comes from `req.url`, which is the host Netlify routed the request on, so a request can't name a different one.
- `Netlify-Vary: query=category|place|limit|offset` limits the CDN's cache key to documented parameters. Ignored parameters (`utm_*`, `_`) can't create new cache entries or bypass the cache.
- The contract test sends an `http://` request and checks that links stay `https`. The smoke test sends a real `X-Forwarded-Proto: http` request to production, using a unique URL so it never touches an entry real clients use.

### Rate limits

Both functions have `config.rateLimit`: 60 requests per IP address per hostname in a sliding 60-second window.

- **The main function** rewrites over-limit requests to `/_rate-limited`, which returns a problem details `429` with `Retry-After`.
- **`/_rate-limited`** is itself a public URL. Without its own limit, anyone could call it directly and run the function without limit. Past its limit, Netlify returns its own empty `429` without running anything.

The smoke test checks both limits in production after every push.

Per-IP limits don't stop a distributed flood (many IP addresses, or one attacker rotating through IPv6 addresses). There's deliberately no global cap in code: a global cap would let one attacker block every legitimate client. Cost is protected instead by Netlify usage alerts (see below) and by caching, since most responses never reach the function.

### Response headers

Every function response, and the static spec, sends:

| Header | Value | Why |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | HTTPS only, for a year. `api.marlasowards.com` has no subdomains, so `includeSubDomains` is safe. |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` | A JSON response is never a page: it can't load anything or be framed. |
| `X-Content-Type-Options` | `nosniff` | Browsers must not treat JSON as HTML or script. |
| `Referrer-Policy` | `no-referrer` | Links followed from a response don't leak the API URL. |
| `Cross-Origin-Resource-Policy` | `cross-origin` | Other sites may read responses (the API is public). CORS still applies. |
| `Access-Control-Allow-Origin` | `*` | Public, read-only data with no cookies or credentials, so any origin is safe. |

The contract test checks these on every kind of response: `200`, `302`, `304`, `204`, `400`, `404`, `405`, and `429`.

### Input and output

- Every query and path parameter is validated against an allowlist, and fact and place IDs against strict patterns. The patterns have no nested repetition that could cause slow regular expression matching.
- Client-supplied text echoed in errors (IDs, paths, parameter names, methods) is clipped, so a long URL can't produce a large response or log line.
- Responses are JSON with `nosniff`, so echoed text can't run as script.
- Unexpected errors return a generic `500`; details only go to the logs.

### Logging

One JSON line per request: request ID, method, clipped path, documented parameters with clipped values, a count of any other parameters, status, and duration. No IP addresses, and no unknown parameters, in case a caller puts a token or personal data in a URL. Netlify keeps function logs for a limited time.

## Controls in the pipeline

| Control | Where |
| --- | --- |
| Netlify installs dependencies from `package-lock.json` (exact versions and integrity hashes) with `--ignore-scripts`. | `netlify.toml` (`NPM_FLAGS`) |
| Build tools (Redocly, Netlify's bundler) are exact-version dev dependencies, not `npx` downloads. | `package.json` |
| The build command runs the lint and contract test before anything deploys. | `netlify.toml` |
| GitHub Actions are pinned to commit SHAs, checkouts don't keep the GitHub token (`persist-credentials: false`), CI installs with `--ignore-scripts`, and workflows only get read access. | `.github/workflows/` |
| Dependabot opens weekly update PRs for npm and Actions, and security update PRs as soon as an advisory affects a dependency. | `.github/dependabot.yml` and repo settings |
| CodeQL scans the code on every push and pull request. | Repo settings (default setup) |
| Secret scanning and push protection block committed credentials. | Repo settings |

`npm run dev` still uses `npx` to fetch the Netlify CLI. It runs only on a developer's machine, with no secrets, so it isn't part of the deployed supply chain.

## Accepted risks

| Risk | Why it's accepted |
| --- | --- |
| `npm audit` reports 4 high-severity alerts in `braces` (deeply nested glob patterns can exhaust the stack), through Netlify's bundler. | The bundler only runs at build time on this repo's own fixed patterns, never on input from anyone else. npm's only fix is a downgrade of the bundler by seven major versions. Revisit when the bundler updates its dependency. |
| No global rate limit. | It would turn a cost attack into an availability attack. Usage alerts and caching cover cost instead. |
| Platform `429` responses with an empty body. | Only clients that keep sending after a `429` see them, and the docs say to treat any `429` the same way. |
| No DNSSEC on `marlasowards.com`. | Netlify DNS doesn't offer it for this domain. The API is HTTPS-only with HSTS, so a forged DNS answer would lead browsers to a server whose certificate they reject, and the CAA record limits who can issue a valid one. Moving DNS away from Netlify to get DNSSEC isn't worth it. |
| Visitor IP addresses in Netlify's platform logs. | Netlify's standard logging, outside this code's control. The API's own logs don't include them. |

## Settings outside the code

These are configured in GitHub, Netlify, and DNS. Check them after any change to the accounts or the domain.

**GitHub (this repo):**

- Private vulnerability reporting: on.
- Dependabot alerts and security updates: on.
- Secret scanning and push protection: on.
- CodeQL default setup: on.
- Ruleset on `main`: blocks force-pushes and branch deletion. Direct pushes are still allowed.

**Netlify:**

- Two-factor authentication on every account with access to the team.
- Usage notifications for function invocations and bandwidth, so a flood shows up before the bill.
- Deploy previews: require approval for pull requests from outside contributors, so strangers' code doesn't run in the build or get published on a `netlify.app` address.

**DNS (Netlify DNS for `marlasowards.com`):**

- A CAA record that lets only Let's Encrypt (`letsencrypt.org`), which Netlify uses, issue certificates for the domain. Added 11 October 2026.
- No DNSSEC: Netlify DNS doesn't offer it for this domain (see [Accepted risks](#accepted-risks)).
- If a Netlify site that uses a subdomain is ever deleted, delete its DNS record too, so nobody else can claim the subdomain.

## Security review history

The API had a dedicated security review on 11 October 2026. Its findings and fixes are in [Design decisions](design-decisions.md#security-review).
