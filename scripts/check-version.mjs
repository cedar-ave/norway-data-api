// Fails if the API changed without a new version and changelog entry.
//
// Usage: node scripts/check-version.mjs <base-ref>
//
// Compares HEAD with <base-ref> (in CI: the commit before a push, or a pull
// request's base). If anything under netlify/functions/ or the spec changed,
// the spec's info.version must differ from the base's, the changelog in the
// spec must have a row for the new version, and package.json's version must
// match the spec's.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';

const SPEC = 'public/openapi/norway-data.yaml';
const API_PATHS = ['netlify/functions/', SPEC];

const base = process.argv[2];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const versionOf = (text) => loadYaml(text).info.version;

const failures = [];
const head = readFileSync(SPEC, 'utf8');
const headVersion = versionOf(head);
const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;

if (pkgVersion !== headVersion) failures.push(`package.json version ${pkgVersion} doesn't match the spec's ${headVersion}.`);
if (!new RegExp(`^\\s*\\| ${headVersion.replaceAll('.', '\\.')} \\|`, 'm').test(head)) {
  failures.push(`The spec's changelog has no row for version ${headVersion}.`);
}

// A new branch or the first push has no usable base: only the checks above apply.
if (base && !/^0+$/.test(base)) {
  const changed = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
  const apiChanged = changed.filter((file) => API_PATHS.some((path) => file.startsWith(path)));
  if (apiChanged.length) {
    let baseVersion = null;
    try {
      baseVersion = versionOf(git('show', `${base}:${SPEC}`));
    } catch {
      // The spec didn't exist at the base, so any version counts as new.
    }
    if (baseVersion === headVersion) {
      failures.push(`These files changed, but the spec's info.version is still ${headVersion}:\n    ${apiChanged.join('\n    ')}`);
    }
  }
}

if (failures.length) {
  console.error('Version check failed:\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\nBump info.version in the spec and version in package.json, and add a changelog row.');
  process.exit(1);
}
console.log(`Version check passed (${headVersion}).`);
