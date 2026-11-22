import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Feature } from 'geojson'
import type { FotoInfo, Ort, Punkt, Wegpunkt } from '../lib/typen'
import { holeBild } from '../lib/fotos'
import { PROTOKOLL, richteOfflineKartenEin } from '../lib/offline'
import { zeichenFuer } from '../lib/orte'
import { strecken, stufe } from '../lib/schwierigkeit'
import { ladeAnsicht, speichereAnsicht } from '../lib/speicher'

export interface Flug {
  nr: number
  /** [west, süd, ost, nord] */
  rahmen?: [number, number, number, number]
  mitte?: [number, number]
  zoom?: number
}

interface Props {
  wegpunkte: Wegpunkt[]
  abschnitte: (Punkt[] | null)[]
  hover: Punkt | null
  flug: Flug | null
  basis: 'topo' | 'osm'
  wanderwege: boolean
  /** Sehenswertes am Weg (schon nach Kategorie gefiltert) */
  orte: Ort[]
  /** Ort, dessen Info-Fenster geöffnet werden soll */
  gewaehlterOrt: { nr: number; ort: Ort } | null
  /** Wanderroute als blaue Vorschau */
  vorschau: [number, number][] | null
  onAusschnitt: (rahmen: [number, number, number, number], zoom: number) => void
  /** Wegpunkte lassen sich nicht ziehen (Unterwegs-Ansicht, aufgezeichnete Wanderungen) */
  fest?: boolean
  /** Aufgezeichnete Spur der laufenden Wanderung */
  spur?: [number, number][]
  /** Eigener Standort */
  position?: { lon: number; lat: number } | null
  /** Karte bleibt auf dem eigenen Standort */
  folgen?: boolean
  onVonHandBewegt?: () => void
  /** Fotos mit Standort – erscheinen als Kamera-Zeichen */
  fotos?: FotoInfo[]
  onFoto?: (id: string) => void
  /** Ein Ort am Weg wurde angetippt */
  onOrt?: (ort: Ort) => void
  /** Über die Ortssuche gewählter Ort – wird mit Fähnchen und Pfeil markiert */
  gesucht?: { lon: number; lat: number; name: string } | null
  onGesuchtWeg?: () => void
  onKarteKlick: (lon: number, lat: number) => void
  onLinieKlick: (abschnitt: number, lon: number, lat: number) => void
  onVerschoben: (index: number, lon: number, lat: number) => void
  onEntfernen: (index: number) => void
}

maplibregl.setWorkerUrl(workerUrl)
richteOfflineKartenEin()

const STIL: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    topo: {
      type: 'raster',
      // über den Gerätespeicher – so bleibt die Karte auch ohne Netz sichtbar (siehe offline.ts)
      tiles: [`${PROTOKOLL}://{z}/{x}/{y}`],
      tileSize: 256,
      maxzoom: 17,
      attribution:
        'Karte: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · Daten: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM',
    },
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    },
    wanderwege: {
      type: 'raster',
      tiles: ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Wanderwege: © <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>',
    },
    route: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    offen: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    vorschau: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    stufen: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    spur: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  },
  layers: [
    { id: 'topo', type: 'raster', source: 'topo' },
    { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
    { id: 'wanderwege', type: 'raster', source: 'wanderwege', layout: { visibility: 'none' } },
    {
      id: 'vorschau',
      type: 'line',
      source: 'vorschau',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#1f8fe0', 'line-width': 5, 'line-opacity': 0.75 },
    },
    {
      id: 'offen',
      type: 'line',
      source: 'offen',
      paint: { 'line-color': '#c2189b', 'line-width': 3, 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.7 },
    },
    {
      id: 'route-rand',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 },
    },
    {
      id: 'route',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#c2189b', 'line-width': 4.5 },
    },
    {
      id: 'stufen',
      type: 'line',
      source: 'stufen',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'farbe'], 'line-width': 2.6 },
    },
    {
      id: 'spur-rand',
      type: 'line',
      source: 'spur',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 8 },
    },
    {
      id: 'spur',
      type: 'line',
      source: 'spur',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#1f8fe0', 'line-width': 5 },
    },
    {
      id: 'route-treffer',
      type: 'line',
      source: 'route',
      paint: { 'line-color': '#000000', 'line-width': 18, 'line-opacity': 0 },
    },
  ],
}

export default function Karte(props: Props) {
  const behaelter = useRef<HTMLDivElement>(null)
  const karte = useRef<maplibregl.Map | null>(null)
  const marker = useRef<maplibregl.Marker[]>([])
  const hoverMarker = useRef<maplibregl.Marker | null>(null)
  const ortMarker = useRef(new Map<string, maplibregl.Marker>())
  const ichMarker = useRef<maplibregl.Marker | null>(null)
  const fotoMarker = useRef<maplibregl.Marker[]>([])
  const aktuell = useRef(props)
  aktuell.current = props
  const [bereit, setBereit] = useState(false)

  // Karte einmal anlegen
  useEffect(() => {
    const start = ladeAnsicht()
    const map = new maplibregl.Map({
      container: behaelter.current!,
      style: STIL,
      center: [start.lon, start.lat],
      zoom: start.zoom,
      maxZoom: 18,
      dragRotate: false,
      attributionControl: { compact: true },
      pitchWithRotate: false,
    })
    karte.current = map
    map.touchZoomRotate.disableRotation()
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')
    map.addControl(
      new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }),
      'top-right',
    )

    const melde = () => {
      const b = map.getBounds()
      aktuell.current.onAusschnitt([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], map.getZoom())
    }
    // Die Quellenangabe muss laut Lizenz erreichbar bleiben – sie steckt hinter dem „i".
    const einklappen = () => {
      const angabe = map.getContainer().querySelector('.maplibregl-ctrl-attrib')
      angabe?.classList.remove('maplibregl-compact-show')
      angabe?.removeAttribute('open')
    }
    map.once('load', einklappen)
    map.once('style.load', () => {
      einklappen()
      setBereit(true)
      melde()
    })
    map.on('moveend', melde)
    map.on('dragstart', () => aktuell.current.onVonHandBewegt?.())

    map.on('click', (e) => {
      const p = e.point
      const treffer = map.queryRenderedFeatures(
        [
          [p.x - 6, p.y - 6],
          [p.x + 6, p.y + 6],
        ],
        { layers: ['route-treffer'] },
      )
      if (treffer.length > 0) {
        const nr = Number(treffer[0].properties?.nr)
        aktuell.current.onLinieKlick(nr, e.lngLat.lng, e.lngLat.lat)
      } else {
        aktuell.current.onKarteKlick(e.lngLat.lng, e.lngLat.lat)
      }
    })
    map.on('mouseenter', 'route-treffer', () => (map.getCanvas().style.cursor = 'copy'))
    map.on('mouseleave', 'route-treffer', () => (map.getCanvas().style.cursor = ''))

    map.on('moveend', () => {
      const c = map.getCenter()
      speichereAnsicht({
        lon: c.lng,
        lat: c.lat,
        zoom: map.getZoom(),
        basis: aktuell.current.basis,
        wanderwege: aktuell.current.wanderwege,
      })
    })

    return () => {
      map.remove()
      karte.current = null
    }
  }, [])

  // Linien
  useEffect(() => {
    const map = karte.current
    if (!map || !bereit) return
    const fertig: Feature[] = []
    const schwer: Feature[] = []
    const offen: Feature[] = []
    props.abschnitte.forEach((a, nr) => {
      if (a) {
        fertig.push({
          type: 'Feature',
          properties: { nr },
          geometry: { type: 'LineString', coordinates: a.map((p) => [p[0], p[1]]) },
        })
        // Schwierige Stücke als farbige Linie in der Mitte der Route
        for (const s of strecken(a)) {
          const art = stufe(s.code)
          if (!art) continue
          schwer.push({
            type: 'Feature',
            properties: { farbe: art.farbe },
            geometry: {
              type: 'LineString',
              coordinates: a.slice(s.von, s.bis + 1).map((p) => [p[0], p[1]]),
            },
          })
        }
      } else {
        const von = props.wegpunkte[nr]
        const bis = props.wegpunkte[nr + 1]
        if (von && bis) {
          offen.push({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [von.lon, von.lat],
                [bis.lon, bis.lat],
              ],
            },
          })
        }
      }
    })
    ;(map.getSource('route') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: fertig,
    })
    ;(map.getSource('stufen') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: schwer,
    })
    ;(map.getSource('offen') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: offen,
    })
  }, [props.abschnitte, props.wegpunkte, bereit])

  // Wegpunkt-Marker
  useEffect(() => {
    const map = karte.current
    if (!map || !bereit) return
    marker.current.forEach((m) => m.remove())
    const letzter = props.wegpunkte.length - 1
    marker.current = props.wegpunkte.map((w, i) => {
      const el = document.createElement('div')
      el.className = 'wp' + (i === 0 ? ' wp-start' : i === letzter ? ' wp-ziel' : '')
      el.textContent = i === 0 ? 'S' : i === letzter ? 'Z' : String(i)
      if (!props.fest) el.title = 'Ziehen = verschieben · Rechtsklick = entfernen'
      el.addEventListener('click', (ev) => ev.stopPropagation())
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        aktuell.current.onEntfernen(i)
      })
      const m = new maplibregl.Marker({ element: el, draggable: !props.fest })
        .setLngLat([w.lon, w.lat])
        .addTo(map)
      m.on('dragend', () => {
        const pos = m.getLngLat()
        aktuell.current.onVerschoben(i, pos.lng, pos.lat)
      })
      return m
    })
  }, [props.wegpunkte, props.fest, bereit])

  // Punkt aus dem Höhenprofil
  useEffect(() => {
    const map = karte.current
    if (!map || !bereit) return
    if (!props.hover) {
      hoverMarker.current?.remove()
      hoverMarker.current = null
      return
    }
    if (!hoverMarker.current) {
      const el = document.createElement('div')
      el.className = 'hover-punkt'
      hoverMarker.current = new maplibregl.Marker({ element: el })
        .setLngLat([props.hover[0], props.hover[1]])
        .addTo(map)
    } else {
      hoverMarker.current.setLngLat([props.hover[0], props.hover[1]])
    }
  }, [props.hover, bereit])

  // Sehenswertes am Weg
  useEffect(() => {
    const map = karte.current
    if (!map || !bereit) return
    ortMarker.current.forEach((m) => m.remove())
    ortMarker.current.clear()
    for (const o of props.orte) {
      const el = document.createElement('div')
      el.className = 'ort-marke'
      el.textContent = zeichenFuer(o.kat)
      el.title = o.name
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        aktuell.current.onOrt?.(o)
      })
      const inhalt = document.createElement('div')
      inhalt.className = 'ort-info'
      const titel = document.createElement('strong')
      titel.textContent = o.name
      const zeile = document.createElement('span')
      zeile.textContent = [
        o.name !== o.art ? o.art : '',
        o.hoehe ? Math.round(o.hoehe) + ' m' : '',
        'km ' + (o.km / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        o.abstand > 60 ? Math.round(o.abstand / 10) * 10 + ' m neben dem Weg' : '',
      ]
        .filter(Boolean)
        .join(' · ')
      inhalt.append(titel, zeile)
      const m = new maplibregl.Marker({ element: el })
        .setLngLat([o.lon, o.lat])
        .setPopup(new maplibregl.Popup({ offset: 16, closeButton: false }).setDOMContent(inhalt))
        .addTo(map)
      ortMarker.current.set(o.id, m)
    }
  }, [props.orte, bereit])

  // Ort aus der Liste: Info-Fenster öffnen
  useEffect(() => {
    const g = props.gewaehlterOrt
    if (!g || !bereit) return
    for (const [id, m] of ortMarker.current) {
      const offen = m.getPopup()?.isOpen()
      if (id === g.ort.id ? !offen : offen) m.togglePopup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.gewaehlterOrt?.nr, bereit])

  // Vorschau einer Wanderroute
  useEffect(() => {
    const map = karte.current
    if (!map || !bereit) return
    ;(map.getSource('vorschau') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: props.vorschau
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: props.vorschau } }]
        : [],
    })
  }, [props.vorschau, bereit])

  // Fotos
  useEffect(() => {
    const map = karte.current
    if (!map || !bereit) return
    fotoMarker.current.forEach((m) => m.remove())
    // Aufploppendes Bild beim Darüberfahren
    let plopp: maplibregl.Popup | null = null
    const adressen = new Map<string, string>()
    const zeige = async (id: string, lon: number, lat: number) => {
      let adresse = adressen.get(id)
      if (!adresse) {
        const bild = await holeBild(id).catch(() => null)
        if (!bild) return
        adresse = URL.createObjectURL(bild)
        adressen.set(id, adresse)
      }
      const img = document.createElement('img')
      img.src = adresse
      img.alt = 'Foto von der Tour'
      plopp?.remove()
      plopp = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'foto-plopp' })
        .setLngLat([lon, lat])
        .setDOMContent(img)
        .addTo(map)
    }
    fotoMarker.current = (props.fotos ?? [])
      .filter((f) => f.lon !== undefined && f.lat !== undefined)
      .map((f) => {
        const el = document.createElement('div')
        el.className = 'foto-punkt'
        el.setAttribute('aria-label', 'Foto ansehen')
        el.addEventListener('mouseenter', () => zeige(f.id, f.lon!, f.lat!))
        el.addEventListener('mouseleave', () => {
          plopp?.remove()
          plopp = null
        })
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          plopp?.remove()
          plopp = null
          aktuell.current.onFoto?.(f.id)
        })
        return new maplibregl.Marker({ element: el }).setLngLat([f.lon!, f.lat!]).addTo(map)
      })
    return () => {
      plopp?.remove()
      adressen.forEach((a) => URL.revokeObjectURL(a))
    }
  }, [props.fotos, bereit])

  // Gesuchter Ort: Fähnchen mit Namen und Pfeil auf die Stelle
  useEffect(() => {
    const map = karte.current
    const g = props.gesucht
    if (!map || !bereit || !g) return
    const el = document.createElement('div')
    el.className = 'such-pin'
    const schild = document.createElement('div')
    schild.className = 'such-pin-schild'
    const name = document.createElement('span')
    name.textContent = g.name
    const zu = document.createElement('button')
    zu.type = 'button'
    zu.textContent = '✕'
    zu.setAttribute('aria-label', 'Markierung entfernen')
    zu.addEventListener('click', (ev) => {
      ev.stopPropagation()
      aktuell.current.onGesuchtWeg?.()
    })
    schild.append(name, zu)
    const pfeil = document.createElement('div')
    pfeil.className = 'such-pin-pfeil'
    el.append(schild, pfeil)
    const m = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([g.lon, g.lat]).addTo(map)
    return () => {
      m.remove()
    }
  }, [props.gesucht?.lon, props.gesucht?.lat, props.gesucht?.name, bereit])

  // Aufgezeichnete Spur
  useEffect(() => {
    const map = karte.current
    if (!map || !bereit) return
    const spur = props.spur ?? []
    ;(map.getSource('spur') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features:
        spur.length > 1
          ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: spur } }]
          : [],
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.spur?.length, bereit])

  // Eigener Standort
  useEffect(() => {
    const map = karte.current
    if (!map || !bereit) return
    const p = props.position
    if (!p) {
      ichMarker.current?.remove()
      ichMarker.current = null
      return
    }
    if (!ichMarker.current) {
      const el = document.createElement('div')
      el.className = 'ich-punkt'
      ichMarker.current = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map)
    } else {
      ichMarker.current.setLngLat([p.lon, p.lat])
    }
    if (props.folgen) {
      map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 15), duration: 500 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.position?.lon, props.position?.lat, props.folgen, bereit])

  // Kartenstil umschalten
  useEffect(() => {
    const map = karte.current
    if (!map || !bereit) return
    map.setLayoutProperty('topo', 'visibility', props.basis === 'topo' ? 'visible' : 'none')
    map.setLayoutProperty('osm', 'visibility', props.basis === 'osm' ? 'visible' : 'none')
    map.setLayoutProperty('wanderwege', 'visibility', props.wanderwege ? 'visible' : 'none')
    const c = map.getCenter()
    speichereAnsicht({
      lon: c.lng,
      lat: c.lat,
      zoom: map.getZoom(),
      basis: props.basis,
      wanderwege: props.wanderwege,
    })
  }, [props.basis, props.wanderwege, bereit])

  // Zu einem Ort oder einer Tour springen
  useEffect(() => {
    const map = karte.current
    const f = props.flug
    if (!map || !bereit || !f) return
    if (f.rahmen) {
      map.fitBounds(
        [
          [f.rahmen[0], f.rahmen[1]],
          [f.rahmen[2], f.rahmen[3]],
        ],
        { padding: 60, maxZoom: 15, duration: 600 },
      )
    } else if (f.mitte) {
      map.flyTo({ center: f.mitte, zoom: f.zoom ?? 13, duration: 600 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.flug?.nr, bereit])

  // Größe anpassen, wenn sich der Platz ändert (z. B. Höhenprofil erscheint)
  useEffect(() => {
    const el = behaelter.current
    if (!el) return
    const ro = new ResizeObserver(() => karte.current?.resize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return <div ref={behaelter} className="karte" />
}
