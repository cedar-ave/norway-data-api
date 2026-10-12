# Contributing

Issues are welcome: use the **API bug** or **Data correction** template. For an API error, include the `requestId` from the response.

Pull requests are welcome too, especially data corrections with a source.

## Before you open a pull request

```bash
npm install
npm run lint            # spec lint
npm test                # contract test
npm run check:bundle    # bundles the functions like Netlify does
```

If you change anything in `netlify/functions/` or the spec:

- Bump `info.version` in the spec and `version` in `package.json` (patch for fixes and data, minor for new features).
- Add a row to the changelog in the spec's introduction.

CI checks all of this. See [docs/maintenance.md](docs/maintenance.md) for how to make common changes.
