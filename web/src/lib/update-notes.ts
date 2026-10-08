/** GitHub / updater notes; empty or whitespace-only bodies are omitted. */
export function updateNotes(body: string | null | undefined): string | null {
  const text = body?.trim() ?? ''
  return text.length > 0 ? text : null
}
