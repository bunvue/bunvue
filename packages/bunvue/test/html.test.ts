import { describe, expect, it } from 'bun:test'
import { removeHtmlModuleScripts, spliceShell, splitShell } from '../src/html.ts'

describe('removeHtmlModuleScripts', () => {
  it('removes module scripts with flexible spacing', () => {
    const html = [
      '<div>before</div>',
      '<script type = module src="./mount.js">console.log(1)</script >',
      '<script type="application/json">{"ok":true}</script>',
      '<div>after</div>',
    ].join('\n')

    expect(removeHtmlModuleScripts(html)).toBe(
      [
        '<div>before</div>',
        '',
        '<script type="application/json">{"ok":true}</script>',
        '<div>after</div>',
      ].join('\n'),
    )
  })
})

describe('removeHtmlModuleScripts', () => {
  it('leaves markers inside non-module script bodies alone', () => {
    const html = [
      '<script>x("<!-- element -->")</script>',
      '<script TYPE="Module">y("<!-- element -->")</script>',
      '<!-- element -->',
    ].join('\n')

    expect(removeHtmlModuleScripts(html)).toBe(
      ['<script>x("<!-- element -->")</script>', '', '<!-- element -->'].join('\n'),
    )
  })
})

describe('shell splicing', () => {
  const shell = [
    '<!doctype html>',
    '<body>',
    '<div id="root"><!-- element --></div>',
    '<!-- hydration -->',
    '</body>',
  ].join('\n')

  it('splits a shell around the element marker', () => {
    const { head, tail } = splitShell(shell)
    expect(head.endsWith('<div id="root">')).toBe(true)
    expect(tail.startsWith('</div>')).toBe(true)
  })

  it('splices body and hydration into a shell', () => {
    const out = spliceShell(shell, '<p>hi</p>', '<script type="application/json">{}</script>')
    expect(out).toContain('<div id="root"><p>hi</p></div>')
    expect(out).toContain('<script type="application/json">{}</script>')
    expect(out).not.toContain('<!-- element -->')
    expect(out).not.toContain('<!-- hydration -->')
  })

  it('does not treat a hydration marker inside the body as a placeholder', () => {
    const out = spliceShell(shell, '<p><!-- hydration --></p>', '<script></script>')
    expect(out).toContain('<div id="root"><p><!-- hydration --></p></div>')
    expect(out).toContain('<script></script>')
  })

  it('leaves the shell alone when no markers are present', () => {
    expect(spliceShell('<html></html>', 'body', 'hydration')).toBe('<html></html>body')
  })
})
