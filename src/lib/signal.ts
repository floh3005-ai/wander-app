import { Haptics } from '@capacitor/haptics'
import { LocalNotifications } from '@capacitor/local-notifications'
import { istApp } from './standort'

// Hinweise, die auch ankommen, wenn das Handy in der Tasche steckt:
// Vibration plus eine stille Benachrichtigung mit dem Text (für den Sperrbildschirm).
const KANAL = 'abbiegen'
const NUMMER = 4711
let kanalBereit: Promise<void> | null = null

function kanal(): Promise<void> {
  if (!kanalBereit) {
    kanalBereit = LocalNotifications.createChannel({
      id: KANAL,
      name: 'Abbiegehinweise',
      description: 'Zeigt unterwegs an, wo es abgeht',
      importance: 2, // still – das Vibrieren übernimmt die App selbst
      visibility: 1,
      vibration: false,
    }).catch(() => {})
  }
  return kanalBereit
}

/** Vibrieren (Dauer in Millisekunden). */
export function vibriere(ms: number): void {
  if (istApp) {
    Haptics.vibrate({ duration: ms }).catch(() => {})
  } else if ('vibrate' in navigator) {
    navigator.vibrate(ms)
  }
}

/** Kurzen Text als Benachrichtigung zeigen (ersetzt den vorigen Hinweis). */
export function zeigeHinweis(titel: string, text: string): void {
  if (!istApp) return
  kanal()
    .then(() =>
      LocalNotifications.schedule({
        notifications: [{ id: NUMMER, title: titel, body: text, channelId: KANAL }],
      }),
    )
    .catch(() => {})
}

export function entferneHinweis(): void {
  if (!istApp) return
  LocalNotifications.cancel({ notifications: [{ id: NUMMER }] }).catch(() => {})
}
