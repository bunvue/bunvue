import type { CsrfOptions } from './types.ts'

/** The trusted origins, or `false` when the check is off. */
export type CsrfCheck = false | Set<string>

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin
  } catch {
    return origin
  }
}

export function resolveCsrf(options: false | CsrfOptions | undefined): CsrfCheck {
  if (options === false) {
    return false
  }
  return new Set((options?.trustedOrigins ?? []).map(normalizeOrigin))
}

/**
 * Whether a request that reaches a page action came from another site. A
 * browser always sends `Origin` on a cross origin POST. Its host is compared
 * with the request's host and the scheme is ignored, because behind a TLS
 * terminating proxy Bun sees `http://host` while the browser sends
 * `https://host`. A proxy that rewrites the host needs `trustedOrigins`, which
 * are matched as full origins. An unparsable Origin, the literal `null`
 * included, counts as cross site. Without `Origin`, `Sec-Fetch-Site` covers
 * the rare browser that omits it, and a request with neither is a non browser
 * client, which no cookie based attack can drive, so it is allowed.
 */
export function isCrossSiteRequest(request: Request, url: URL, trusted: Set<string>): boolean {
  const origin = request.headers.get('origin')
  if (origin !== null) {
    let parsed: URL
    try {
      parsed = new URL(origin)
    } catch {
      return true
    }
    if (trusted.has(parsed.origin)) {
      return false
    }
    return parsed.host !== url.host
  }
  return request.headers.get('sec-fetch-site') === 'cross-site'
}
