/** A typed failure from the API. `message` is safe to show to the dancer. */
export class ApiError extends Error {
  status: number
  code: string
  recovery?: string
  constructor(status: number, code: string, message: string, recovery?: string) {
    super(message)
    this.status = status
    this.code = code
    this.recovery = recovery
  }
}
