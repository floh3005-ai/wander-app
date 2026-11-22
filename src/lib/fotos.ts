import { Camera } from '@capacitor/camera'
import { cloud } from './cloud'
import { istApp } from './standort'
import type { FotoInfo } from './typen'

export type { FotoInfo }


// Bilder liegen zuerst auf dem Gerät (IndexedDB) und gehen in die Cloud, sobald
// man angemeldet ist und Netz hat. So geht unterwegs ohne Empfang nichts verloren.
const DB = 'wander-fotos'
const LAGER = 'bilder'
const EIMER = 'fotos'
const MAX_KANTE = 1600

interface Eintrag {
  id: string
  bild: Blob
  hochgeladen: boolean
}

function oeffne(): Promise<IDBDatabase> {
  return new Promise((ok, fehler) => {
    const anfrage = indexedDB.open(DB, 1)
    anfrage.onupgradeneeded = () => anfrage.result.createObjectStore(LAGER, { keyPath: 'id' })
    anfrage.onsuccess = () => ok(anfrage.result)
    anfrage.onerror = () => fehler(anfrage.error)
  })
}

async function lager<T>(modus: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await oeffne()
  return new Promise((ok, fehler) => {
    const anfrage = fn(db.transaction(LAGER, modus).objectStore(LAGER))
    anfrage.onsuccess = () => ok(anfrage.result)
    anfrage.onerror = () => fehler(anfrage.error)
  })
}

/** Bild auf höchstens 1600 Pixel Kantenlänge verkleinern (spart Speicher und Datenvolumen). */
export async function verkleinere(quelle: Blob): Promise<Blob> {
  const bild = await createImageBitmap(quelle, { imageOrientation: 'from-image' })
  const faktor = Math.min(1, MAX_KANTE / Math.max(bild.width, bild.height))
  const flaeche = document.createElement('canvas')
  flaeche.width = Math.round(bild.width * faktor)
  flaeche.height = Math.round(bild.height * faktor)
  flaeche.getContext('2d')!.drawImage(bild, 0, 0, flaeche.width, flaeche.height)
  bild.close()
  return new Promise((ok, fehler) =>
    flaeche.toBlob((b) => (b ? ok(b) : fehler(new Error('Bild konnte nicht verarbeitet werden'))), 'image/jpeg', 0.82),
  )
}

/** Foto aufnehmen (Handy-App: Kamera) – gibt null zurück, wenn abgebrochen wurde. */
export async function nimmFoto(): Promise<Blob | null> {
  if (istApp) {
    try {
      const ergebnis = await Camera.takePhoto({ quality: 88, saveToGallery: false, correctOrientation: true })
      if (!ergebnis.webPath) return null
      return verkleinere(await (await fetch(ergebnis.webPath)).blob())
    } catch {
      return null // abgebrochen
    }
  }
  const dateien = await waehleDateien(false)
  return dateien[0] ?? null
}

/** Bilder aus Dateien wählen (PC und Handy-Browser). */
export function waehleDateien(mehrere: boolean): Promise<Blob[]> {
  return new Promise((ok) => {
    const feld = document.createElement('input')
    feld.type = 'file'
    feld.accept = 'image/*'
    feld.multiple = mehrere
    feld.onchange = async () => {
      const out: Blob[] = []
      for (const datei of Array.from(feld.files ?? [])) {
        try {
          out.push(await verkleinere(datei))
        } catch {
          // kein lesbares Bild – überspringen
        }
      }
      ok(out)
    }
    feld.oncancel = () => ok([])
    feld.click()
  })
}

export async function merkeBild(id: string, bild: Blob): Promise<void> {
  await lager('readwrite', (s) => s.put({ id, bild, hochgeladen: false } satisfies Eintrag))
}

async function nutzerId(): Promise<string | null> {
  if (!cloud) return null
  const { data } = await cloud.auth.getSession()
  return data.session?.user.id ?? null
}

/** Bild holen: vom Gerät, sonst aus der Cloud (und dann fürs nächste Mal merken). */
export async function holeBild(id: string): Promise<Blob | null> {
  const lokal = (await lager('readonly', (s) => s.get(id))) as Eintrag | undefined
  if (lokal) return lokal.bild
  const uid = await nutzerId()
  if (!cloud || !uid) return null
  const { data, error } = await cloud.storage.from(EIMER).download(`${uid}/${id}.jpg`)
  if (error || !data) return null
  await lager('readwrite', (s) => s.put({ id, bild: data, hochgeladen: true } satisfies Eintrag))
  return data
}

/** Alle noch nicht gesicherten Bilder in die Cloud laden. Gibt die Anzahl zurück. */
export async function ladeFotosHoch(): Promise<number> {
  const uid = await nutzerId()
  if (!cloud || !uid) return 0
  const alle = (await lager('readonly', (s) => s.getAll())) as Eintrag[]
  let anzahl = 0
  for (const e of alle) {
    if (e.hochgeladen) continue
    const { error } = await cloud.storage
      .from(EIMER)
      .upload(`${uid}/${e.id}.jpg`, e.bild, { contentType: 'image/jpeg', upsert: true })
    if (error) throw new Error(error.message)
    await lager('readwrite', (s) => s.put({ ...e, hochgeladen: true } satisfies Eintrag))
    anzahl++
  }
  return anzahl
}

/** Bild überall entfernen: auf dem Gerät und – wenn angemeldet – in der Cloud. */
export async function loescheBild(id: string): Promise<void> {
  await lager('readwrite', (s) => s.delete(id))
  const uid = await nutzerId()
  if (cloud && uid) await cloud.storage.from(EIMER).remove([`${uid}/${id}.jpg`])
}
