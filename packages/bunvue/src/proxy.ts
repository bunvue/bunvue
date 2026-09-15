import type { RequestIPProvider, UserRoute } from './types.ts'

/**
 * Connection-scoped headers that must not be forwarded, plus the two
 * content-* headers that describe a body `fetch` has already decoded for us.
 */
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
]

const RESPONSE_STRIP = [...HOP_BY_HOP, 'content-encoding', 'content-length']

/** Statuses that must not carry a body. */
const NULL_BODY = new Set([101, 204, 205, 304])

/** Methods whose body is streamed upstream. */
const BODYLESS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Copies headers and drops the named ones. Copying through the `Headers`
 * constructor keeps repeated headers such as `set-cookie` intact, which a
 * `forEach` copy would fold into a single comma-joined value.
 */
function stripHeaders(source: Headers, strip: string[]): Headers {
  const headers = new Headers(source)
  for (const name of strip) {
    headers.delete(name)
  }
  return headers
}

export interface ProxyRequestOptions {
  /** Absolute path to request upstream. Defaults to the incoming pathname. */
  path?: string
  /** Client address, appended to `x-forwarded-for` when known. */
  clientIp?: string
  /** Last chance to adjust the forwarded request headers. */
  headers?: (headers: Headers, request: Request) => Headers
  /** Last chance to adjust the response headers handed back to the client. */
  responseHeaders?: (headers: Headers, request: Request) => Headers
}

/** Builds the header set forwarded upstream, including the forwarded-for chain. */
function forwardedHeaders(request: Request, incoming: URL, options: ProxyRequestOptions): Headers {
  const headers = stripHeaders(request.headers, HOP_BY_HOP)
  // `fetch` derives the upstream `Host` from the target URL, and sending the
  // client's own host would make the upstream generate wrong absolute URLs.
  const host = headers.get('host')
  headers.delete('host')

  if (!headers.has('x-forwarded-host')) {
    const forwardedHost = host ?? incoming.host
    if (forwardedHost) {
      headers.set('x-forwarded-host', forwardedHost)
    }
  }
  if (!headers.has('x-forwarded-proto')) {
    headers.set('x-forwarded-proto', incoming.protocol.replace(/:$/, ''))
  }
  if (options.clientIp) {
    const chain = headers.get('x-forwarded-for')
    headers.set('x-forwarded-for', chain ? `${chain}, ${options.clientIp}` : options.clientIp)
  }

  return options.headers ? options.headers(headers, request) : headers
}

/**
 * Forwards a request to `origin`, preserving method, headers, query string and
 * body. Hop-by-hop headers are dropped in both directions, everything else
 * passes through untouched so custom upstream headers survive.
 */
export async function proxyRequest(
  request: Request,
  origin: string,
  options: ProxyRequestOptions = {},
): Promise<Response> {
  const incoming = new URL(request.url)
  const path = options.path ?? incoming.pathname
  const target = new URL(`${path}${incoming.search}`, origin)
  const body = BODYLESS.has(request.method) ? undefined : request.body

  const upstream = await fetch(target, {
    method: request.method,
    headers: forwardedHeaders(request, incoming, options),
    body,
    redirect: 'manual',
    // Required by the fetch spec whenever a stream is used as the body.
    ...(body ? { duplex: 'half' } : {}),
  } as RequestInit)

  let headers = stripHeaders(upstream.headers, RESPONSE_STRIP)
  if (options.responseHeaders) {
    headers = options.responseHeaders(headers, request)
  }

  return new Response(NULL_BODY.has(upstream.status) ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}

export interface ProxyOptions {
  /**
   * Path prefix used upstream in place of `prefix`. Defaults to `prefix`, so
   * the path is forwarded unchanged.
   */
  rewritePrefix?: string
  /** Adjust the headers forwarded upstream. */
  headers?: (headers: Headers, request: Request) => Headers
  /** Adjust the headers of the response handed back to the client. */
  responseHeaders?: (headers: Headers) => Headers
  /** Methods to accept. Defaults to every common method. */
  method?: UserRoute['method']
}

const ALL_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] as const

/** Strips a trailing slash and a trailing `/*` from a route prefix. */
function normalizePrefix(prefix: string): string {
  return prefix.replace(/\/\*$/, '').replace(/\/$/, '')
}

/**
 * Route helper mirroring `@fastify/http-proxy`:
 * `proxy('/api', process.env.API_URL, { rewritePrefix: '/api' })` forwards
 * everything under `/api` to the upstream origin.
 */
export function proxy<S = unknown>(
  prefix: string,
  upstream: string,
  options: ProxyOptions = {},
): UserRoute<S> {
  const base = normalizePrefix(prefix)
  const rewrite = normalizePrefix(options.rewritePrefix ?? base)
  const path = `${base}/*`

  return {
    path,
    method: (options.method ?? [...ALL_METHODS]) as UserRoute['method'],
    handler: (request: Request, _server: S, bunServer?: RequestIPProvider) => {
      const pathname = new URL(request.url).pathname
      const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname
      return proxyRequest(request, upstream, {
        path: `${rewrite}${rest}` || '/',
        clientIp: bunServer?.requestIP(request)?.address,
        headers: options.headers,
        responseHeaders: options.responseHeaders
          ? (headers: Headers): Headers => options.responseHeaders!(headers)
          : undefined,
      })
    },
  }
}
