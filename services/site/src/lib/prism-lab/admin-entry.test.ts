import assert from "node:assert/strict"
import test from "node:test"
import { legacyAdminHref, shouldRedirectAdminToLab } from "./admin-entry"

test("bare admin defaults to Lab unless explicitly disabled", () => {
  for (const enabled of [undefined, "", "true", "1", "yes"]) {
    assert.equal(shouldRedirectAdminToLab({}, enabled), true)
  }
  for (const disabled of ["false", " FALSE "]) {
    assert.equal(shouldRedirectAdminToLab({}, disabled), false)
  }
})

test("legacy settings, credentials, request links and form feedback never redirect", () => {
  for (const query of [
    "tab=settings&settings=gateway&connection=abc&action=credential&secretName=github",
    "tab=settings&settings=interfaces", "tab=settings&settings=runtimes",
    "tab=settings&settings=config", "tab=settings&settings=status",
    "tab=requests&request=2604", "error=request-create", "success=saved",
    "tab=", "unknown=value", legacyAdminHref.split("?")[1],
  ]) {
    assert.equal(shouldRedirectAdminToLab(Object.fromEntries(new URLSearchParams(query)), undefined), false, query)
  }
  assert.equal(shouldRedirectAdminToLab({ tab: ["settings", "requests"] }, undefined), false)
})
