import { Capacitor, registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'
import { LocalNotifications } from '@capacitor/local-notifications'

/** Eine Standortmeldung vom Gerät. */
export interface Ortung {
  lon: number
  lat: number
  /** Höhe laut GPS in Metern (kann fehlen und weicht von der Kartenhöhe ab) */
  hoehe: number | null
  /** Genauigkeit in Metern – je kleiner, desto besser */
  genau: number
  /** Geschwindigkeit in m/s, falls das Gerät sie meldet */
  tempo: number | null
  /** Zeitpunkt in Millisekunden */
  zeit: number
}

/** true = läuft als installierte Handy-App, false = im Browser */
export const istApp = Capacitor.isNativePlatform()

const Hintergrund = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

/**
 * Standort laufend melden lassen. In der Handy-App läuft das als Android-Dienst
 * mit Benachrichtigung weiter, auch wenn der Bildschirm aus ist. Im Browser
 * klappt es nur, solange die Seite sichtbar ist.
 * Gibt eine Funktion zurück, die die Ortung wieder beendet.
 */
export async function starteOrtung(
  melde: (o: Ortung) => void,
  fehler: (text: string) => void,
): Promise<() => void> {
  if (istApp) {
    try {
      // Ab Android 13 braucht die Dauer-Benachrichtigung eine eigene Erlaubnis.
      await LocalNotifications.requestPermissions()
    } catch {
      // Ohne Erlaubnis läuft die Ortung trotzdem, nur ohne sichtbare Benachrichtigung.
    }
    const id = await Hintergrund.addWatcher(
      {
        backgroundTitle: 'Wander-App zeichnet auf',
        backgroundMessage: 'Deine Tour wird aufgezeichnet.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 0,
      },
      (ort, err) => {
        if (err) {
          if (err.code === 'NOT_AUTHORIZED') {
            fehler('Die App darf den Standort nicht verwenden. Bitte in den Einstellungen erlauben.')
            Hintergrund.openSettings()
          } else {
            fehler('Der Standort kann gerade nicht bestimmt werden.')
          }
          return
        }
        if (!ort) return
        melde({
          lon: ort.longitude,
          lat: ort.latitude,
          hoehe: ort.altitude,
          genau: ort.accuracy,
          tempo: ort.speed,
          zeit: ort.time ?? Date.now(),
        })
      },
    )
    return () => {
      Hintergrund.removeWatcher({ id })
    }
  }

  if (!('geolocation' in navigator)) {
    fehler('Dieses Gerät meldet keinen Standort.')
    return () => {}
  }
  const id = navigator.geolocation.watchPosition(
    (p) =>
      melde({
        lon: p.coords.longitude,
        lat: p.coords.latitude,
        hoehe: p.coords.altitude,
        genau: p.coords.accuracy,
        tempo: p.coords.speed,
        zeit: p.timestamp,
      }),
    (e) =>
      fehler(
        e.code === e.PERMISSION_DENIED
          ? 'Der Standort ist nicht freigegeben. Bitte im Browser erlauben.'
          : 'Der Standort kann gerade nicht bestimmt werden.',
      ),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
  )
  return () => navigator.geolocation.clearWatch(id)
}
