// Loaded only in the isolated static exporter process, never the actual app.
// A new accidental provider fetch must fail the demo build instead of contacting a live service.
globalThis.fetch = async () => { throw new Error('Network access is disabled while rendering the static demo.'); };
