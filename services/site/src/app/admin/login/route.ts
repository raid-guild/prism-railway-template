import bcrypt from "bcryptjs"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { loadConfig } from "@/lib/app-core"
import { bootstrapAdminAccount } from "@/lib/app-core/bootstrap"
import { getPasswordLoginUserByEmail, getSessionSummary, getUserByEmail, updateUserLastSeen } from "@/lib/app-core/repository"
import {
  adminSessionCookieName,
  adminSessionMaxAgeSeconds,
  createAdminSessionCookieValue,
  legacyAdminPasswordCookieName,
} from "@/lib/admin-auth"
import { safeAdminReturnPath } from "@/lib/admin-return-path"

const { compare } = bcrypt

export async function POST(request: Request) {
  const config = loadConfig()
  const formData = await request.formData()
  const email = typeof formData.get("email") === "string" ? String(formData.get("email")).trim().toLowerCase() : ""
  const password = typeof formData.get("password") === "string" ? String(formData.get("password")).trim() : ""
  const returnTo = safeAdminReturnPath(formData.get("returnTo"))

  if (!password) {
    redirect(`${returnTo}?error=missing-password`)
  }

  let sessionUser: ReturnType<typeof getSessionSummary> = null
  if (email) {
    const loginUser = getPasswordLoginUserByEmail(email)
    if (!loginUser?.passwordHash || loginUser.isBanned || !(await compare(password, loginUser.passwordHash))) {
      redirect(`${returnTo}?error=unauthorized`)
    }
    sessionUser = getSessionSummary(loginUser.id)
  } else {
    if (password !== config.adminPassword) {
      redirect(`${returnTo}?error=unauthorized`)
    }
    let adminSeedUser = getUserByEmail(config.adminEmail)
    sessionUser = adminSeedUser ? getSessionSummary(adminSeedUser.id) : null
  }

  if (!sessionUser?.roleSlugs?.length && !email) {
    await bootstrapAdminAccount()
    const adminSeedUser = getUserByEmail(config.adminEmail)
    sessionUser = adminSeedUser ? getSessionSummary(adminSeedUser.id) : null
  }

  const cookieStore = await cookies()
  cookieStore.delete(legacyAdminPasswordCookieName)
  cookieStore.set(adminSessionCookieName, createAdminSessionCookieValue({
    userId: sessionUser?.id ?? null,
    roleSlugs: sessionUser?.roleSlugs?.length ? sessionUser.roleSlugs : ["admin"],
  }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: adminSessionMaxAgeSeconds(),
  })

  if (sessionUser?.id) {
    updateUserLastSeen(sessionUser.id)
  }

  redirect(returnTo)
}
