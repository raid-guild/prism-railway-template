export type RequestReviewScope = {
  requestId: string
  generation: number
  latestLoad: number
}

export type RequestReviewScopeToken = Pick<RequestReviewScope, "requestId" | "generation">

export type RequestReviewLoadToken = RequestReviewScopeToken & {
  load: number
}

export function createRequestReviewScope(requestId: string): RequestReviewScope {
  return { requestId, generation: 0, latestLoad: 0 }
}

export function selectRequestReviewScope(scope: RequestReviewScope, requestId: string): RequestReviewScope {
  if (scope.requestId === requestId) return scope
  return {
    requestId,
    generation: scope.generation + 1,
    latestLoad: 0,
  }
}

export function captureRequestReviewScope(scope: RequestReviewScope): RequestReviewScopeToken {
  return { requestId: scope.requestId, generation: scope.generation }
}

export function beginRequestReviewLoad(scope: RequestReviewScope): {
  scope: RequestReviewScope
  token: RequestReviewLoadToken
} {
  const next = { ...scope, latestLoad: scope.latestLoad + 1 }
  return {
    scope: next,
    token: {
      requestId: next.requestId,
      generation: next.generation,
      load: next.latestLoad,
    },
  }
}

export function isCurrentRequestReviewScope(scope: RequestReviewScope, token: RequestReviewScopeToken) {
  return scope.requestId === token.requestId && scope.generation === token.generation
}

export function isCurrentRequestReviewLoad(scope: RequestReviewScope, token: RequestReviewLoadToken) {
  return isCurrentRequestReviewScope(scope, token) && scope.latestLoad === token.load
}
