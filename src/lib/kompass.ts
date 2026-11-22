/**
 * Blickrichtung des Handys (0 = Norden, 90 = Osten). Ruft `melde` bei jeder
 * Änderung auf. Gibt eine Funktion zum Beenden zurück.
 * Am PC und auf Geräten ohne Kompass kommt nie eine Meldung.
 */
export function starteKompass(melde: (grad: number) => void): () => void {
  let glatt: number | null = null

  const verarbeite = (ev: DeviceOrientationEvent) => {
    const iosWert = (ev as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
    let grad: number | null = null
    if (typeof iosWert === 'number') {
      grad = iosWert
    } else if (ev.absolute && ev.alpha !== null) {
      grad = 360 - ev.alpha
    }
    if (grad === null) return
    // Handy quer gehalten: Drehung des Bildschirms einrechnen
    grad = (grad + (screen.orientation?.angle ?? 0) + 360) % 360
    // Zittern dämpfen (über den Sprung 359° → 0° hinweg richtig rechnen)
    if (glatt === null) glatt = grad
    else glatt = (glatt + 0.25 * (((grad - glatt + 540) % 360) - 180) + 360) % 360
    melde(glatt)
  }

  window.addEventListener('deviceorientationabsolute', verarbeite as EventListener)
  window.addEventListener('deviceorientation', verarbeite)
  return () => {
    window.removeEventListener('deviceorientationabsolute', verarbeite as EventListener)
    window.removeEventListener('deviceorientation', verarbeite)
  }
}
