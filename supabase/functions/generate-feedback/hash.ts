// input_hash of a feedback row (FR-3.7.6): SHA-256 over the metrics payload, the prompt
// version and the model. The same input gives the same hash, so a stored note can be
// returned without calling the model again. Web Crypto only (Deno, browsers, Node 20+).

/** JSON with object keys sorted, so key order never changes the hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    const parts = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    return `{${parts.join(',')}}`
  }
  return JSON.stringify(value)
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function inputHash(payload: unknown, promptVersion: string, model: string): Promise<string> {
  return sha256Hex(canonicalJson({ model, payload, prompt_version: promptVersion }))
}
