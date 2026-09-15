// Page actions. Imported by the SSR entry only, so none of it reaches the client.
export default import.meta.glob('/pages/**/*.server.{ts,js}')
