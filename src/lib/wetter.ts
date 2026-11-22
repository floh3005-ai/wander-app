// Wettervorhersage von Open-Meteo (kostenlos, ohne Konto).
const DIENST = 'https://api.open-meteo.com/v1/forecast'
export const VORHERSAGE_TAGE = 16

export interface WetterOrt {
  lon: number
  lat: number
  hoehe?: number
}

export interface Stunde {
  /** Ortszeit, z. B. 2026-11-23T09:00 */
  zeit: string
  temp: number
  /** Regenwahrscheinlichkeit in %, bei weit entfernten Tagen manchmal unbekannt */
  regenChance: number | null
  /** Niederschlag in mm */
  regen: number
  code: number
  wind: number
  boeen: number
}

export interface Vorhersage {
  stunden: Map<string, Stunde>
  sonnenaufgang: Map<string, string>
  sonnenuntergang: Map<string, string>
}

const zwischenspeicher = new Map<string, { zeit: number; daten: Vorhersage[] }>()

/** Vorhersage für einen oder mehrere Orte (z. B. Start und höchster Punkt). */
export async function ladeWetter(orte: WetterOrt[]): Promise<Vorhersage[]> {
  const schluessel = orte.map((o) => `${o.lat.toFixed(2)},${o.lon.toFixed(2)},${Math.round(o.hoehe ?? -1)}`).join('|')
  const gemerkt = zwischenspeicher.get(schluessel)
  if (gemerkt && Date.now() - gemerkt.zeit < 30 * 60 * 1000) return gemerkt.daten

  const teile = [
    `latitude=${orte.map((o) => o.lat.toFixed(4)).join(',')}`,
    `longitude=${orte.map((o) => o.lon.toFixed(4)).join(',')}`,
    'hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
    'daily=sunrise,sunset',
    'timezone=auto',
    `forecast_days=${VORHERSAGE_TAGE}`,
  ]
  if (orte.every((o) => o.hoehe !== undefined && Number.isFinite(o.hoehe))) {
    teile.push(`elevation=${orte.map((o) => Math.round(o.hoehe!)).join(',')}`)
  }
  const antwort = await fetch(`${DIENST}?${teile.join('&')}`)
  if (!antwort.ok) throw new Error('Der Wetterdienst ist gerade nicht erreichbar.')
  const roh = await antwort.json()
  const liste: any[] = Array.isArray(roh) ? roh : [roh]

  const daten = liste.map((r) => {
    const stunden = new Map<string, Stunde>()
    const h = r.hourly
    for (let i = 0; i < h.time.length; i++) {
      if (h.temperature_2m[i] === null) continue
      stunden.set(h.time[i], {
        zeit: h.time[i],
        temp: h.temperature_2m[i],
        regenChance: h.precipitation_probability?.[i] ?? null,
        regen: h.precipitation[i] ?? 0,
        code: h.weather_code[i] ?? 0,
        wind: h.wind_speed_10m[i] ?? 0,
        boeen: h.wind_gusts_10m[i] ?? 0,
      })
    }
    const sonnenaufgang = new Map<string, string>()
    const sonnenuntergang = new Map<string, string>()
    r.daily.time.forEach((tag: string, i: number) => {
      sonnenaufgang.set(tag, r.daily.sunrise[i])
      sonnenuntergang.set(tag, r.daily.sunset[i])
    })
    return { stunden, sonnenaufgang, sonnenuntergang }
  })
  zwischenspeicher.set(schluessel, { zeit: Date.now(), daten })
  return daten
}

/** Wetter-Kennzahl (WMO) in Worte und Zeichen übersetzen. */
export function wetterText(code: number): { text: string; zeichen: string } {
  if (code === 0) return { text: 'Klar', zeichen: '☀️' }
  if (code === 1) return { text: 'Meist klar', zeichen: '🌤️' }
  if (code === 2) return { text: 'Teils bewölkt', zeichen: '⛅' }
  if (code === 3) return { text: 'Bedeckt', zeichen: '☁️' }
  if (code === 45 || code === 48) return { text: 'Nebel', zeichen: '🌫️' }
  if (code >= 51 && code <= 55) return { text: 'Nieselregen', zeichen: '🌦️' }
  if (code === 56 || code === 57) return { text: 'Gefrierender Niesel', zeichen: '🌧️' }
  if (code === 61) return { text: 'Leichter Regen', zeichen: '🌧️' }
  if (code === 63) return { text: 'Regen', zeichen: '🌧️' }
  if (code === 65) return { text: 'Starker Regen', zeichen: '🌧️' }
  if (code === 66 || code === 67) return { text: 'Gefrierender Regen', zeichen: '🌧️' }
  if (code === 71) return { text: 'Leichter Schneefall', zeichen: '🌨️' }
  if (code === 73) return { text: 'Schneefall', zeichen: '🌨️' }
  if (code === 75) return { text: 'Starker Schneefall', zeichen: '❄️' }
  if (code === 77) return { text: 'Schneegriesel', zeichen: '🌨️' }
  if (code >= 80 && code <= 82) return { text: 'Regenschauer', zeichen: '🌦️' }
  if (code === 85 || code === 86) return { text: 'Schneeschauer', zeichen: '🌨️' }
  if (code === 95) return { text: 'Gewitter', zeichen: '⛈️' }
  if (code === 96 || code === 99) return { text: 'Gewitter mit Hagel', zeichen: '⛈️' }
  return { text: 'Unbekannt', zeichen: '❔' }
}

export function istGewitter(code: number): boolean {
  return code >= 95
}

/** Zu einer Ortszeit (ohne Zeitzone) Minuten dazurechnen. */
export function plusMinuten(zeit: string, minuten: number): string {
  const d = new Date(`${zeit}:00Z`)
  d.setUTCMinutes(d.getUTCMinutes() + minuten)
  return d.toISOString().slice(0, 16)
}

export function heute(): string {
  const d = new Date()
  const monat = String(d.getMonth() + 1).padStart(2, '0')
  const tag = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${monat}-${tag}`
}
