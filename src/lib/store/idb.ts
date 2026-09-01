/**
 * ============================================================================
 *  INDEXEDDB A PELO
 * ============================================================================
 *
 * Sin librería: son cuatro operaciones y una librería costaría más en bytes
 * descargados que lo que ahorra en código.
 *
 * Dos stores, a propósito separados:
 *   `tours`  → el JSON del recorrido (chico, se reescribe seguido)
 *   `blobs`  → las fotos (grandes, se escriben una vez y no se vuelven a tocar)
 *
 * Detalle de Safari en iOS que muerde: el almacenamiento del navegador se puede
 * BORRAR SOLO si el sistema anda corto de espacio o si el sitio pasa siete días
 * sin visitarse. Por eso el recorrido se puede exportar a un archivo, y por eso
 * pedimos `navigator.storage.persist()` (ver ./quota.ts). En modo privado
 * IndexedDB existe pero se vacía al cerrar la pestaña.
 */

const DB_NAME = 'visor-tour-360'
const DB_VERSION = 1

export const STORE_TOURS = 'tours'
export const STORE_BLOBS = 'blobs'

let dbPromise: Promise<IDBDatabase> | null = null

/** Envuelve una petición de IndexedDB en una promesa. */
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Falló la operación de IndexedDB'))
  })
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Este navegador no puede guardar recorridos (no tiene IndexedDB).'))
      return
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_TOURS)) {
        db.createObjectStore(STORE_TOURS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: 'id' })
      }
    }

    req.onsuccess = () => {
      const db = req.result
      // Si otra pestaña pide una versión nueva, hay que soltar la conexión o
      // esa pestaña se queda bloqueada para siempre.
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }

    req.onerror = () => {
      dbPromise = null
      reject(req.error ?? new Error('No se pudo abrir la base de datos del navegador'))
    }

    req.onblocked = () => {
      reject(new Error('Hay otra pestaña del visor abierta. Ciérrala y vuelve a intentar.'))
    }
  })

  return dbPromise
}

type Mode = 'readonly' | 'readwrite'

/** Corre una función dentro de una transacción y espera a que confirme. */
export async function tx<T>(
  stores: string | string[],
  mode: Mode,
  run: (t: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb()
  const transaction = db.transaction(stores, mode)

  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Transacción fallida'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Transacción cancelada'))
  })
  /* Si `run` lanza (por ejemplo al llenarse el almacenamiento), salimos sin
     llegar al `await done`, y la transacción aborta después con nadie
     escuchando: eso es un "unhandled rejection" que ensucia la consola y en
     algunos navegadores tumba la página. El error real ya viaja por `run`. */
  done.catch(() => undefined)

  const result = await run(transaction)
  // En readonly no hace falta esperar el commit, pero esperarlo siempre evita
  // devolver datos de una transacción que todavía puede abortar.
  await done
  return result
}

export const idbGet = <T>(t: IDBTransaction, store: string, key: string) =>
  request<T | undefined>(t.objectStore(store).get(key) as IDBRequest<T | undefined>)

export const idbGetAll = <T>(t: IDBTransaction, store: string) =>
  request<T[]>(t.objectStore(store).getAll() as IDBRequest<T[]>)

export const idbPut = (t: IDBTransaction, store: string, value: unknown) =>
  request(t.objectStore(store).put(value))

export const idbDelete = (t: IDBTransaction, store: string, key: string) =>
  request(t.objectStore(store).delete(key))

export const idbGetAllKeys = (t: IDBTransaction, store: string) =>
  request<IDBValidKey[]>(t.objectStore(store).getAllKeys())
