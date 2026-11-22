/**
 * Lage des Handys im Raum als Drehmatrix (9 Zahlen, zeilenweise).
 * Sie rechnet Richtungen vom Handy (x = rechts, y = oben, z = zum Gesicht)
 * in die Welt um (x = Osten, y = Norden, z = oben).
 */
export type Drehung = number[]

/** Drehmatrix aus den drei Winkeln des Lage-Sensors (alpha, beta, gamma in Grad). */
export function drehungAus(alpha: number, beta: number, gamma: number): Drehung {
  const rad = Math.PI / 180
  const cA = Math.cos(alpha * rad)
  const sA = Math.sin(alpha * rad)
  const cB = Math.cos(beta * rad)
  const sB = Math.sin(beta * rad)
  const cG = Math.cos(gamma * rad)
  const sG = Math.sin(gamma * rad)
  return [
    cA * cG - sA * sB * sG,
    -cB * sA,
    cG * sA * sB + cA * sG,
    cG * sA + cA * sB * sG,
    cA * cB,
    sA * sG - cA * cG * sB,
    -cB * sG,
    sB,
    cB * cG,
  ]
}

/** Drehung für „Handy aufrecht, Kamera schaut waagerecht in diese Himmelsrichtung" (für den PC). */
export function drehungFuerBlick(grad: number, neigung = 0): Drehung {
  return drehungAus(-grad, 90 + neigung, 0)
}

/** In welche Himmelsrichtung schaut die Kamera? (0 = Norden, 90 = Osten) */
export function blickrichtung(r: Drehung): number {
  // Die Kamera schaut entgegen der z-Achse des Handys.
  return ((Math.atan2(-r[2], -r[5]) * 180) / Math.PI + 360) % 360
}

/**
 * Wo erscheint eine Richtung im Kamerabild?
 * richtung: Himmelsrichtung in Grad, hoehenwinkel: Winkel über dem Horizont in Grad,
 * f: Brennweite in Bildpunkten, cx/cy: Bildmitte. null = liegt hinter der Kamera.
 */
export function projiziere(
  r: Drehung,
  richtung: number,
  hoehenwinkel: number,
  f: number,
  cx: number,
  cy: number,
): { x: number; y: number } | null {
  const rad = Math.PI / 180
  const ost = Math.sin(richtung * rad) * Math.cos(hoehenwinkel * rad)
  const nord = Math.cos(richtung * rad) * Math.cos(hoehenwinkel * rad)
  const oben = Math.sin(hoehenwinkel * rad)
  // Welt → Handy (transponierte Matrix)
  const x = r[0] * ost + r[3] * nord + r[6] * oben
  const y = r[1] * ost + r[4] * nord + r[7] * oben
  const z = r[2] * ost + r[5] * nord + r[8] * oben
  if (z > -0.15) return null
  return { x: cx + (f * x) / -z, y: cy - (f * y) / -z }
}

/**
 * Lage laufend melden lassen. Am PC und auf Geräten ohne Sensor kommt nie eine Meldung.
 * Gibt eine Funktion zum Beenden zurück.
 */
export function starteLage(melde: (r: Drehung) => void): () => void {
  let glatt: Drehung | null = null

  const verarbeite = (ev: DeviceOrientationEvent) => {
    if (ev.beta === null || ev.gamma === null) return
    const iosWert = (ev as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
    let alpha: number | null = null
    if (typeof iosWert === 'number') alpha = 360 - iosWert
    else if (ev.absolute && ev.alpha !== null) alpha = ev.alpha
    if (alpha === null) return
    const neu = drehungAus(alpha, ev.beta, ev.gamma)
    // Zittern dämpfen
    glatt = glatt ? glatt.map((v, i) => v + 0.18 * (neu[i] - v)) : neu
    melde(glatt)
  }

  window.addEventListener('deviceorientationabsolute', verarbeite as EventListener)
  window.addEventListener('deviceorientation', verarbeite)
  return () => {
    window.removeEventListener('deviceorientationabsolute', verarbeite as EventListener)
    window.removeEventListener('deviceorientation', verarbeite)
  }
}
