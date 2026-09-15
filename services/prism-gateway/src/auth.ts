import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { GatewayCaller } from "./types.js";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function resolveGatewayCaller(token: string, callers: GatewayCaller[]) {
  const candidate = digest(token);
  for (const caller of callers) {
    if (timingSafeEqual(candidate, digest(caller.token))) return caller;
  }
  return null;
}

export function gatewayAuth(callers: GatewayCaller[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const token = request.header("x-gateway-token")?.trim() || "";
    const caller = token ? resolveGatewayCaller(token, callers) : null;
    if (!caller) {
      response.status(401).json({ ok: false, error: "GATEWAY_UNAUTHORIZED" });
      return;
    }
    response.locals.gatewayCaller = caller;
    next();
  };
}

export function requireSiteCaller(_request: Request, response: Response, next: NextFunction) {
  const caller = response.locals.gatewayCaller as GatewayCaller | undefined;
  if (caller?.id !== "site") {
    response.status(403).json({ ok: false, error: "GATEWAY_ADMIN_CALLER_REQUIRED" });
    return;
  }
  next();
}

export function requireLeaseCaller(_request: Request, response: Response, next: NextFunction) {
  const caller = response.locals.gatewayCaller as GatewayCaller | undefined;
  if (caller?.kind !== "runtime" && caller?.id !== "task-runner") {
    response.status(403).json({ ok: false, error: "GATEWAY_LEASE_CALLER_REQUIRED" });
    return;
  }
  next();
}
