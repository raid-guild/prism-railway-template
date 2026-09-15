#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const path = process.argv[2];
if (!path) {
  console.error('Usage: validate-verification.mjs <verification.json>');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(await readFile(path, 'utf8'));
} catch (error) {
  console.error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const errors = [];
const statuses = new Set(['passed', 'failed', 'inconclusive']);
const checkStatuses = new Set(['passed', 'failed', 'skipped']);
if (report?.version !== 1) errors.push('version must be 1');
if (!statuses.has(report?.status)) errors.push('status must be passed, failed, or inconclusive');
for (const key of ['baseSha', 'headSha', 'summary']) {
  if (typeof report?.[key] !== 'string' || !report[key].trim()) errors.push(`${key} must be a non-empty string`);
}
if (!Array.isArray(report?.checks)) errors.push('checks must be an array');
for (const [index, check] of (report?.checks ?? []).entries()) {
  if (!check || typeof check !== 'object') {
    errors.push(`checks[${index}] must be an object`);
    continue;
  }
  if (typeof check.key !== 'string' || !check.key.trim()) errors.push(`checks[${index}].key must be a non-empty string`);
  if (typeof check.name !== 'string' || !check.name.trim()) errors.push(`checks[${index}].name must be a non-empty string`);
  if (!checkStatuses.has(check.status)) errors.push(`checks[${index}].status must be passed, failed, or skipped`);
  if (typeof check.evidence !== 'string' || !check.evidence.trim()) errors.push(`checks[${index}].evidence must be a non-empty string`);
}
if (!Array.isArray(report?.browserJourneys)) errors.push('browserJourneys must be an array');
for (const [index, journey] of (report?.browserJourneys ?? []).entries()) {
  if (!journey || typeof journey !== 'object') {
    errors.push(`browserJourneys[${index}] must be an object`);
    continue;
  }
  if (typeof journey.name !== 'string' || !journey.name.trim()) errors.push(`browserJourneys[${index}].name must be a non-empty string`);
  if (!checkStatuses.has(journey.status)) errors.push(`browserJourneys[${index}].status must be passed, failed, or skipped`);
}
if (!Array.isArray(report?.unexpectedTrackedChanges)) errors.push('unexpectedTrackedChanges must be an array');
if (!Array.isArray(report?.limitations)) errors.push('limitations must be an array');

if (report?.status === 'passed') {
  const failed = [...(report?.checks ?? []), ...(report?.browserJourneys ?? [])]
    .some((entry) => entry?.status === 'failed');
  if (failed) errors.push('a passed report cannot contain failed checks or browser journeys');
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('verification.json is valid');
