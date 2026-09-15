import { renderToString, renderToWebStream } from 'vue/server-renderer'
import { createHead, transformHtmlTemplate } from '@unhead/vue/server'
import { hydrationScript as buildHydrationScript, type RoutesPayload } from './serialize.ts'
import { mergeResponseHeaders, type RouteContext } from './context.ts'
import {
  HYDRATION_MARKER,
  spliceHydration,
  spliceShell,
  splitShell,
  type HtmlShells,
} from './html.ts'
import { isResponseSignal } from './signal.ts'
import type { CreateFactory, RouteContextLike, SerializedRoute, StreamWrapper } from './types.ts'

/** The server-side unhead instance, as produced by `@unhead/vue/server`. */
type ServerHead = ReturnType<typeof createHead>

export interface RenderDeps {
  create: CreateFactory
  routes: unknown[]
  routeMap: Record<string, SerializedRoute>
  /** The serialized route table, in both encodings, computed once. */
  routesPayload: RoutesPayload
  /** The app's runtime config as JSON text, validated once at startup. */
  runtimeConfig: string
  /** Per-page shells, prepared once by unhead. */
  shells: HtmlShells
  dev: boolean
}

function hydrationScript(ctx: RouteContext<unknown>, deps: RenderDeps): string {
  if (ctx.serverOnly) {
    return ''
  }
  return buildHydrationScript(ctx.toJSON(), deps.routesPayload, deps.runtimeConfig, {
    dev: deps.dev,
    id: ctx.id,
  })
}

function htmlResponse(ctx: RouteContext<unknown>, body: BodyInit): Response {
  const headers = new Headers(ctx.headers)
  if (!headers.has('content-type')) {
    headers.set('content-type', 'text/html; charset=utf-8')
  }
  if (ctx.timings && ctx.timings.length > 0) {
    headers.set(
      'server-timing',
      ctx.timings.map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`).join(', '),
    )
  }
  return new Response(body, { status: ctx.status, headers })
}

/**
 * Renders one request. Returns `ctx.response`, with `ctx.headers` merged in,
 * whenever a redirect or notFound signal was raised, which is checked after
 * context init, after the router settles and after the render resolves.
 */
export async function renderPage<S>(ctx: RouteContext<S>, deps: RenderDeps): Promise<Response> {
  const answer = (response: Response): Response => mergeResponseHeaders(response, ctx.headers)

  if (ctx.response) {
    return answer(ctx.response)
  }

  let body: string | undefined
  let stream: ReadableStream<Uint8Array> | undefined

  try {
    if (!ctx.clientOnly) {
      const timed = ctx.timings !== undefined
      const createStart = performance.now()
      const { instance, router } = await deps.create({
        routes: deps.routes,
        routeMap: deps.routeMap,
        ctxHydration: ctx as unknown as RouteContextLike,
        url: `${ctx.url.pathname}${ctx.url.search}`,
      })
      ctx.app = instance
      ctx.router = router

      await router.push(`${ctx.url.pathname}${ctx.url.search}`)
      await router.isReady()
      if (timed) {
        ctx.mark('create', createStart)
      }
      if (ctx.response) {
        return answer(ctx.response)
      }

      if (ctx.streaming) {
        stream = renderToWebStream(instance, ctx.ssrContext)
      } else {
        const renderStart = performance.now()
        body = await renderToString(instance, ctx.ssrContext)
        if (timed) {
          ctx.mark('render', renderStart)
        }
        // Vue routes setup errors through `app.config.errorHandler`, which
        // stashes anything that is not a response signal on the context.
        if (ctx.error && !ctx.response) {
          throw ctx.error
        }
      }
    }
  } catch (error) {
    if (ctx.response) {
      return answer(ctx.response)
    }
    if (isResponseSignal(error)) {
      return answer(error.response)
    }
    throw error
  }

  if (ctx.response && !stream) {
    return answer(ctx.response)
  }

  const useHead = (ctx.useHead ?? createHead()) as ServerHead
  ctx.useHead = useHead as RouteContext['useHead']
  useHead.push(ctx.head)

  if (stream) {
    // A streaming page gets a streamable head from `$app/index.ts`, which
    // hands back unhead's `wrapStream`. Without one (an app built before the
    // streaming head existed) the manual shell stream still applies.
    const wrap = ctx.wrapStream
    if (wrap) {
      return htmlResponse(
        ctx as RouteContext<unknown>,
        wrapStreamWithHydration(ctx as RouteContext<unknown>, wrap, stream, deps),
      )
    }
    const shellHtml = transformHtmlTemplate(useHead, deps.shells.universal)
    return htmlResponse(
      ctx as RouteContext<unknown>,
      shellStream(ctx as RouteContext<unknown>, shellHtml, stream, deps),
    )
  }

  const prepared = ctx.serverOnly ? deps.shells.serverOnly : deps.shells.universal
  // unhead keeps the parsed shell in a WeakMap, so only the head tags are
  // rebuilt per request. The body and hydration script are spliced in after.
  const headStart = performance.now()
  const shellHtml = transformHtmlTemplate(useHead, prepared)
  if (ctx.timings) {
    ctx.mark('head', headStart)
  }

  const hydrationStart = performance.now()
  ctx.hydration = hydrationScript(ctx as RouteContext<unknown>, deps)
  if (ctx.timings) {
    ctx.mark('hydration', hydrationStart)
  }
  return htmlResponse(
    ctx as RouteContext<unknown>,
    spliceShell(shellHtml, body ?? '', ctx.hydration),
  )
}

/**
 * Streaming shell. The head is transformed once, before the first chunk, so
 * head tags pushed later during the render are not reflected. Headers are
 * committed with the first chunk too, which is why a redirect raised
 * mid-render can only be honoured with a `location.replace` in the tail.
 */
function shellStream(
  ctx: RouteContext<unknown>,
  shellHtml: string,
  body: ReadableStream<Uint8Array>,
  deps: RenderDeps,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const { head, tail } = splitShell(shellHtml)
  const reader = body.getReader()
  let headSent = false

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headSent) {
          headSent = true
          controller.enqueue(encoder.encode(head))
          return
        }
        const { done, value } = await reader.read()
        if (!done) {
          controller.enqueue(value)
          return
        }
        ctx.hydration = hydrationScript(ctx, deps)
        let rest = spliceHydration(tail, ctx.hydration)
        const location = ctx.response?.headers.get('location')
        if (location) {
          rest += `<script>location.replace(${JSON.stringify(location)})</script>`
        }
        controller.enqueue(encoder.encode(rest))
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
    cancel(reason) {
      void reader.cancel(reason)
    },
  })
}

/**
 * Tags a stream so we know when the Vue render has finished. The transform's
 * `flush` runs before the consumer's `read()` resolves with `done`, so anything
 * `wrapStream` emits afterwards (its closing HTML) is reliably identifiable.
 */
function markCompletion(
  stream: ReadableStream<Uint8Array>,
  onDone: () => void,
): ReadableStream<Uint8Array> {
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk)
      },
      flush() {
        onDone()
      },
    }),
  )
}

/**
 * unhead's `wrapStream` owns the shell and the closing HTML, and emits the
 * `<!-- hydration -->` placeholder verbatim. This splices the hydration script
 * into that closing chunk (only chunks produced after the Vue render finished
 * are inspected) and appends the redirect fallback, since a streamed response
 * has already committed its headers.
 */
function wrapStreamWithHydration(
  ctx: RouteContext<unknown>,
  wrap: StreamWrapper,
  body: ReadableStream<Uint8Array>,
  deps: RenderDeps,
): ReadableStream<Uint8Array> {
  let bodyDone = false
  const wrapped = wrap(
    markCompletion(body, () => {
      bodyDone = true
    }),
    deps.shells.streaming,
  )

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let spliced = false

  return wrapped.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (spliced || !bodyDone) {
          controller.enqueue(chunk)
          return
        }
        const text = decoder.decode(chunk)
        if (!text.includes(HYDRATION_MARKER)) {
          controller.enqueue(chunk)
          return
        }
        spliced = true
        ctx.hydration = hydrationScript(ctx, deps)
        controller.enqueue(encoder.encode(spliceHydration(text, ctx.hydration)))
      },
      flush(controller) {
        const location = ctx.response?.headers.get('location')
        if (location) {
          controller.enqueue(
            encoder.encode(`<script>location.replace(${JSON.stringify(location)})</script>`),
          )
        }
      },
    }),
  )
}
