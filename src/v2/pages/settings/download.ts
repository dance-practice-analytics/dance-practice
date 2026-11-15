// Saving something the page built as a file: a Blob behind a temporary <a download>.
// Nothing is sent anywhere; the browser writes it to the downloads folder.

export function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // The download reads the URL after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function saveText(name: string, text: string, type: string): void {
  saveBlob(name, new Blob([text], { type }))
}

/** Local calendar day for a file name: 2026-11-15. */
export function fileDay(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
