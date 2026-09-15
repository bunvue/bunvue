/**
 * Stands in for a real data source. The counter makes every call visible, so a
 * page can show whether the value came from the server payload or from a fetch
 * that ran again.
 */
let fetches = 0

export interface DemoData {
  fetches: number
  at: number
}

export async function fetchDemoData(): Promise<DemoData> {
  await new Promise((resolve) => setTimeout(resolve, 1))
  fetches += 1
  return { fetches, at: Date.now() }
}
