import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import config from '../cloud.config.json'
import type { Ablage, Kopf, Zeile } from './abgleich'
import type { Tour } from './typen'

// Adresse und öffentlicher Schlüssel des Supabase-Projekts stehen in
// src/cloud.config.json. Der Schlüssel dort ist der ÖFFENTLICHE („publishable" /
// „anon") – er darf im Programmcode stehen. Geschützt sind die Daten durch den
// Login und die Regeln in supabase/schema.sql. Niemals den geheimen
// „service_role"-/„secret"-Schlüssel eintragen.
export const cloud: SupabaseClient | null =
  config.url && config.key ? createClient(config.url, config.key) : null

const TABELLE = 'touren'

export const cloudAblage: Ablage = {
  async koepfe() {
    const { data, error } = await cloud!.from(TABELLE).select('id, geaendert, geloescht')
    if (error) throw new Error(error.message)
    return (data ?? []) as Kopf[]
  },

  async hole(ids) {
    const out: { id: string; daten: Tour | null }[] = []
    for (let i = 0; i < ids.length; i += 20) {
      const { data, error } = await cloud!
        .from(TABELLE)
        .select('id, daten')
        .in('id', ids.slice(i, i + 20))
      if (error) throw new Error(error.message)
      out.push(...((data ?? []) as { id: string; daten: Tour | null }[]))
    }
    return out
  },

  async schreibe(zeilen: Zeile[]) {
    for (let i = 0; i < zeilen.length; i += 10) {
      const { error } = await cloud!.from(TABELLE).upsert(zeilen.slice(i, i + 10))
      if (error) throw new Error(error.message)
    }
  },
}

export function fehlerText(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  if (/Invalid login credentials/i.test(text)) return 'E-Mail oder Passwort stimmt nicht.'
  if (/Failed to fetch|NetworkError|network/i.test(text)) return 'Keine Verbindung zur Cloud.'
  if (/Email not confirmed/i.test(text)) return 'Die E-Mail-Adresse ist noch nicht bestätigt.'
  return text
}
