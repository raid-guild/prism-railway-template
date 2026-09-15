# Runtime browser tooling

The Codex runtime image installs its pinned Playwright package and Chromium.
Repository workspaces need not add Playwright as a dependency. Native skill
isolation changes each job's HOME, so the default browser cache lookup is not
reliable inside a job.

Full-authority jobs receive two non-secret paths resolved by the parent runtime:

- `PRISM_PLAYWRIGHT_MODULE`: absolute CommonJS entrypoint for the installed package.
- `PRISM_CHROMIUM_EXECUTABLE`: absolute executable for that package's Chromium build.

From any workspace, use a CommonJS Node script:

```js
const { chromium } = require(process.env.PRISM_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({
  executablePath: process.env.PRISM_CHROMIUM_EXECUTABLE,
  headless: true,
  args: ['--no-sandbox'],
});
```

Wrap the example in an async function when using CommonJS. Close the browser
after verification. The paths are discovery hints, not proof that checks passed:
record launch errors and actual browser evidence. Read-only utility jobs do not
receive this configuration or execution guidance. Other runtime adapters may
provide their own browser mechanism; workflows should require evidence rather
than these adapter-specific environment variables.

Regression tests cover repository-independent package loading with an isolated
HOME, stable executable selection, and the read-only utility boundary. A deployed
smoke test should additionally launch Chromium and open a public page.
