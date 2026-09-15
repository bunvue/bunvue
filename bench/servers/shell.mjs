// The identical shell string used by every server variant, Bun and Node alike.
export function shellWithTitle(appHtml) {
  return `<!doctype html><html><head><!--head--><title>Bench</title></head><body><div id="root">${appHtml}</div></body></html>`
}

// Head variants omit <title> so unhead injects it at the <!--head--> marker.
export function shellForHead(appHtml) {
  return `<!doctype html><html><head><!--head--></head><body><div id="root">${appHtml}</div></body></html>`
}
