import { createRequire } from 'node:module';
import { chromium } from 'playwright';

// Resolve in the runtime process, before a job changes HOME or its working directory.
const runtimeRequire = createRequire(import.meta.url);
export const browserToolEnvironment = {
  PRISM_PLAYWRIGHT_MODULE: runtimeRequire.resolve('playwright'),
  PRISM_CHROMIUM_EXECUTABLE: chromium.executablePath(),
};

export const browserToolInstructions = [
  'Browser automation is supplied by this runtime independently of repository dependencies.',
  'From any workspace, use Node CommonJS: const { chromium } = require(process.env.PRISM_PLAYWRIGHT_MODULE);',
  'Launch with chromium.launch({ executablePath: process.env.PRISM_CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox"] }).',
  'Do not infer browser unavailability from a missing repository-local Playwright package or the job HOME cache. Try these runtime paths first and record the actual launch error if they fail.',
].join('\n');
