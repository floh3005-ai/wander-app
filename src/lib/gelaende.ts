// Geländehöhen aus den frei verfügbaren „Terrarium"-Kacheln (Mapzen/AWS Open Data,
// ohne Konto und ohne Abfrage-Limit). Jede Kachel ist ein Bild, dessen Farben die
// Höhe verschlüsseln. Einmal geladen, lässt sich das Gelände beliebig oft abtasten.
const ADRESSE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const ZOOM = 10 // ca. 100 m je Bildpunkt in Mitteleuropa – reicht für die Sichtprüfung
const KANTE = 256

export interface Gelaende {
  /** Höhe über dem Meer an einer Stelle; NaN, wenn dort keine Daten geladen sind */
  hoeheBei(lon: number, lat: number): number
}

function kachelX(lon: number): number {
  return ((lon + 180) / 360) * 2 ** ZOOM
}

function kachelY(lat: number): number {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** ZOOM
}

async function ladeKachel(x: number, y: number): Promise<Uint8ClampedArray | null> {
  try {
    const antwort = await fetch(ADRESSE.replace('{z}', String(ZOOM)).replace('{x}', String(x)).replace('{y}', String(y)))
    if (!antwort.ok) return null
    const bild = await createImageBitmap(await antwort.blob(), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    })
    const flaeche = document.createElement('canvas')
    flaeche.width = KANTE
    flaeche.height = KANTE
    const z = flaeche.getContext('2d', { willReadFrequently: true })!
    z.drawImage(bild, 0, 0, KANTE, KANTE)
    bild.close()
    return z.getImageData(0, 0, KANTE, KANTE).data
  } catch {
    return null
  }
}

/** Gelände rund um einen Standort laden (Umkreis in Metern). */
export async function ladeGelaende(lon: number, lat: number, umkreis = 46_000): Promise<Gelaende> {
  const dLat = umkreis / 111_320
  const dLon = dLat / Math.cos((lat * Math.PI) / 180)
  const x0 = Math.floor(kachelX(lon - dLon))
  const x1 = Math.floor(kachelX(lon + dLon))
  const y0 = Math.floor(kachelY(lat + dLat))
  const y1 = Math.floor(kachelY(lat - dLat))

  const kacheln = new Map<string, Uint8ClampedArray>()
  const auftraege: Promise<void>[] = []
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      auftraege.push(
        ladeKachel(x, y).then((daten) => {
          if (daten) kacheln.set(`${x}/${y}`, daten)
        }),
      )
    }
  }
  await Promise.all(auftraege)
  if (kacheln.size === 0) throw new Error('Die Geländedaten konnten nicht geladen werden.')

  return {
    hoeheBei(lon2, lat2) {
      const fx = kachelX(lon2)
      const fy = kachelY(lat2)
      const daten = kacheln.get(`${Math.floor(fx)}/${Math.floor(fy)}`)
      if (!daten) return NaN
      const px = Math.min(KANTE - 1, Math.floor((fx - Math.floor(fx)) * KANTE))
      const py = Math.min(KANTE - 1, Math.floor((fy - Math.floor(fy)) * KANTE))
      const i = (py * KANTE + px) * 4
      return daten[i] * 256 + daten[i + 1] + daten[i + 2] / 256 - 32768
    },
  }
}
