import assert from "node:assert/strict"
import test from "node:test"

import { safeAdminReturnPath } from "./admin-return-path"

test("admin login return paths are restricted to known local workspaces", () => {
  assert.equal(safeAdminReturnPath("/admin/lab"), "/admin/lab")
  assert.equal(safeAdminReturnPath("/admin"), "/admin")
  assert.equal(safeAdminReturnPath("https://evil.example"), "/admin")
  assert.equal(safeAdminReturnPath("//evil.example"), "/admin")
  assert.equal(safeAdminReturnPath("/admin/lab/requests/1"), "/admin")
})
