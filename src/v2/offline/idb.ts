// Tiny promise wrapper over one IndexedDB object store (idb-keyval style), so the
// offline upload queue needs no dependency. `indexedDB` is looked up on each call, so
// tests can install fake-indexeddb before the first use.

const DB_NAME = 'dpa-offline'
const DB_VERSION = 1
export const UPLOADS_STORE = 'uploads'

let opening: Promise<IDBDatabase> | null = null

function idbFactory(): IDBFactory {
  const f = (globalThis as { indexedDB?: IDBFactory }).indexedDB
  if (!f) throw new Error('IndexedDB is not available')
  return f
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function open(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const req = idbFactory().open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(UPLOADS_STORE)) req.result.createObjectStore(UPLOADS_STORE, { keyPath: 'attemptId' })
      }
      req.onsuccess = () => {
        const db = req.result
        // Another tab upgrading the schema: let it, and reopen on the next call.
        db.onversionchange = () => {
          db.close()
          opening = null
        }
        resolve(db)
      }
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('IndexedDB open blocked'))
    }).catch((e) => {
      opening = null
      throw e
    })
  }
  return opening
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  const t = db.transaction(UPLOADS_STORE, mode)
  const result = request(run(t.objectStore(UPLOADS_STORE)))
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'))
  })
  return result
}

export const idbPut = <T>(value: T): Promise<IDBValidKey> => tx('readwrite', (s) => s.put(value))
export const idbGetAll = <T>(): Promise<T[]> => tx('readonly', (s) => s.getAll() as IDBRequest<T[]>)
export const idbDelete = (key: string): Promise<undefined> => tx('readwrite', (s) => s.delete(key))
export const idbClear = (): Promise<undefined> => tx('readwrite', (s) => s.clear())

/** For tests: forget the open connection (e.g. after replacing the fake factory). */
export function idbResetConnection(): void {
  void opening?.then((db) => db.close()).catch(() => undefined)
  opening = null
}
