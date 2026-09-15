import { LockKeyhole } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function LoginCard({ error, returnTo = "/admin" }: { error?: string; returnTo?: "/admin" | "/admin/lab" }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-16">
      <Card className="w-full border-border/60 bg-card/95 backdrop-blur">
        <CardHeader className="space-y-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <CardTitle className="text-2xl">Admin Access</CardTitle>
          <CardDescription>
            Use your email and password, or leave email blank to use the shared admin password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/admin/login" method="post" className="space-y-4">
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="Optional for shared admin password" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" placeholder="Password" required />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button className="w-full" type="submit">
              {returnTo === "/admin/lab" ? "Enter Prism Lab" : "Enter board"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
