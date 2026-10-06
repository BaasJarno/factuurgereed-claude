import type { Btw, Factuurregel, Organisatie, Overzicht, Timer } from '../types'

/** Eén FactuurGereed-tool aanroepen; geeft de JSON van het antwoord of gooit de foutmelding. */
export type Roep = (tool: string, args?: Record<string, unknown>) => Promise<unknown>

export const APP_URL = 'https://www.factuurgereed.nl'

const MAANDEN = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
]
const MAANDEN_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

// ---------------------------------------------------------------- tijd

/** Laatste zondag van een maand om 01:00 UTC: het moment van de zomer-/wintertijdwissel. */
function wissel(jaar: number, maand: number): number {
  const laatste = new Date(Date.UTC(jaar, maand + 1, 0, 1))
  return laatste.getTime() - laatste.getUTCDay() * 86_400_000
}

/** Kalenderdatum en kloktijd in Nederland, los van de tijdzone van de omgeving. */
export function nlTijd(ms: number) {
  const jaar = new Date(ms).getUTCFullYear()
  const zomer = ms >= wissel(jaar, 2) && ms < wissel(jaar, 9)
  const d = new Date(ms + (zomer ? 2 : 1) * 3_600_000)
  return {
    jaar: d.getUTCFullYear(),
    maand: d.getUTCMonth() + 1,
    dag: d.getUTCDate(),
    uur: d.getUTCHours(),
    minuut: d.getUTCMinutes(),
  }
}

const twee = (n: number) => String(n).padStart(2, '0')

export function isoDatum(t: { jaar: number; maand: number; dag: number }): string {
  return `${t.jaar}-${twee(t.maand)}-${twee(t.dag)}`
}

/** "2026-10-31" → "31 okt" */
export function korteDatum(iso: string | null): string {
  if (!iso) return ''
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MAANDEN_KORT[(m ?? 1) - 1] ?? ''}`
}

export function klokTijd(ms: number): string {
  const t = nlTijd(ms)
  return `${twee(t.uur)}:${twee(t.minuut)}`
}

/** Minuten als "1:05". */
export function duur(minuten: number): string {
  const m = Math.max(0, Math.floor(minuten))
  return `${Math.floor(m / 60)}:${twee(m % 60)}`
}

export function timerMinuten(timer: Timer, nu: number): number {
  return timer.gepauzeerd ? timer.minuten : timer.minuten + (nu - timer.gemetenOp) / 60_000
}

// ---------------------------------------------------------------- getallen

/** 6028.01 → "€ 6.028" (of "€ 6.028,01" met centen). */
export function euro(bedrag: number, centen = false): string {
  const totaalCenten = Math.round(Math.abs(bedrag) * 100)
  const heel = centen ? Math.floor(totaalCenten / 100) : Math.round(totaalCenten / 100)
  const groepen = String(heel).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const rest = centen ? `,${twee(totaalCenten % 100)}` : ''
  return `${bedrag < 0 ? '-' : ''}€ ${groepen}${rest}`
}

/** 22.5 → "22,5" */
export function getal(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',')
}

export function meervoud(n: number, een: string, meer: string): string {
  return `${n} ${n === 1 ? een : meer}`
}

// ---------------------------------------------------------------- ophalen

type Ruw = Record<string, unknown>

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const lijst = (v: unknown): Ruw[] => (Array.isArray(v) ? (v as Ruw[]) : [])

export function leesOrganisaties(data: unknown): Organisatie[] {
  return lijst((data as Ruw | null)?.organisaties)
    .filter(o => o.status === undefined || o.status === 'actief')
    .map(o => ({ id: String(o.id), naam: String(o.naam ?? 'Organisatie'), rol: String(o.rol ?? '') }))
}

/** Bewaarde keuze, anders de eerste waar de gebruiker eigenaar is, anders de eerste. */
export function kiesOrganisatie(organisaties: Organisatie[], bewaard: unknown): Organisatie | null {
  return (
    organisaties.find(o => o.id === bewaard) ??
    organisaties.find(o => o.rol === 'owner') ??
    organisaties[0] ??
    null
  )
}

function factuurregel(f: Ruw): Factuurregel {
  return {
    id: String(f.id),
    nummer: str(f.factuurnummer) ?? 'Concept',
    klant: str(f.klant) ?? 'Onbekende klant',
    bedrag: num(f.totaal_incl_btw),
    vervaldatum: str(f.vervaldatum),
    dagenTeLaat: num(f.dagen_te_laat),
  }
}

function btw(data: unknown): Btw | null {
  const b = data as Ruw | null
  if (!b || typeof b.kwartaal !== 'number') return null
  return {
    jaar: num(b.jaar),
    kwartaal: num(b.kwartaal),
    teBetalen: num(b.te_betalen),
    terug: num(b.terug_te_ontvangen),
    deadline: str(b.deadline_aangifte) ?? '',
    dagenTotDeadline: num(b.dagen_tot_deadline),
    ingediend: b.ingediend === true,
    loopt: false,
  }
}

function timer(data: unknown, nu: number): Timer | null {
  const t = data as Ruw | null
  if (!t || (t.loopt !== true && t.gepauzeerd !== true)) return null
  return {
    klant: str(t.klant),
    project: str(t.project),
    beschrijving: str(t.beschrijving),
    gepauzeerd: t.gepauzeerd === true,
    minuten: num(t.verstreken_minuten),
    gemetenOp: nu,
  }
}

/** Mislukt deze ene vraag, dan is het onderdeel leeg in plaats van het hele paneel kapot. */
async function ofNull<T>(werk: Promise<T>): Promise<T | null> {
  try {
    return await werk
  } catch {
    return null
  }
}

/** Alles voor het paneel in één keer, zeven vragen tegelijk. */
export async function haalOverzicht(roep: Roep, organisatie: Organisatie, nu: number): Promise<Overzicht> {
  const org = { organisatie_id: organisatie.id }
  const t = nlTijd(nu)
  const kwartaal = Math.ceil(t.maand / 3)
  const vorig = kwartaal === 1 ? { jaar: t.jaar - 1, kwartaal: 4 } : { jaar: t.jaar, kwartaal: kwartaal - 1 }

  const [periode, open, concepten, btwVorig, btwNu, timerData, bank] = await Promise.all([
    roep('overzicht_periode', { ...org, van: isoDatum({ ...t, dag: 1 }), tot: isoDatum(t) }),
    ofNull(roep('facturen_zoeken', { ...org, openstaand: true, limiet: 25 })),
    ofNull(roep('facturen_zoeken', { ...org, status: 'concept', limiet: 10 })),
    ofNull(roep('btw_kwartaal', { ...org, ...vorig })),
    ofNull(roep('btw_kwartaal', { ...org, jaar: t.jaar, kwartaal })),
    ofNull(roep('timer_bekijken', org)),
    ofNull(roep('banktransacties_te_verwerken', { ...org, limiet: 100 })),
  ])

  const p = periode as Ruw
  const totalen = (p.totalen ?? {}) as Ruw
  const openstaand = (p.openstaand ?? {}) as Ruw

  const openFacturen = lijst((open as Ruw | null)?.facturen)
    .map(factuurregel)
    .sort((a, b) => b.dagenTeLaat - a.dagenTeLaat || (a.vervaldatum ?? '').localeCompare(b.vervaldatum ?? ''))
  const conceptFacturen = lijst((concepten as Ruw | null)?.facturen).map(factuurregel)

  // De vorige aangifte telt zolang hij niet als ingediend staat; daarna het lopende kwartaal.
  const vorige = btw(btwVorig)
  const huidige = btw(btwNu)
  const btwKeuze = vorige && !vorige.ingediend ? { ...vorige, loopt: false } : huidige ? { ...huidige, loopt: true } : null

  const bankData = bank as Ruw | null

  return {
    organisatie,
    bijgewerktOp: nu,
    maand: {
      naam: MAANDEN[t.maand - 1] ?? '',
      omzet: num(totalen.omzet_excl),
      kosten: num(totalen.kosten_excl),
      uren: num(totalen.uren),
    },
    openstaand: {
      bedrag: num(openstaand.bedrag),
      aantal: num(openstaand.aantal),
      teLaatBedrag: num(openstaand.vervallen_bedrag),
      teLaatAantal: num(openstaand.vervallen_aantal),
      facturen: openFacturen,
    },
    concepten: {
      aantal: num((concepten as Ruw | null)?.totaal_gevonden) || conceptFacturen.length,
      bedrag: conceptFacturen.reduce((som, f) => som + f.bedrag, 0),
      facturen: conceptFacturen,
    },
    btw: btwKeuze,
    timer: timer(timerData, nu),
    bank: bankData ? num(bankData.aantal) : null,
  }
}

// ---------------------------------------------------------------- vragen

export type Vraag = { key: string; label: string; prompt: string }

/** De snelle vragen onder "Vraag Claude", met de cijfers van nu erin. */
export function vragen(o: Overzicht | null, nu: number): Vraag[] {
  const naam = o?.organisatie.naam ?? 'mijn administratie'
  const t = nlTijd(nu)
  const btwLabel = o?.btw ? `Btw-aangifte Q${o.btw.kwartaal}` : 'Btw-aangifte'
  const btwPeriode = o?.btw ? `Q${o.btw.kwartaal} ${o.btw.jaar}` : 'het vorige kwartaal'

  return [
    {
      key: 'vraag-stand',
      label: 'Stand van zaken',
      prompt: `Geef me de stand van zaken in FactuurGereed voor ${naam}: wat staat er open, wat is te laat, wat staat er nog als concept en wat moet ik deze week regelen?`,
    },
    {
      key: 'vraag-te-laat',
      label: 'Te late facturen',
      prompt: `Welke facturen van ${naam} zijn te laat? Zet per factuur op een rij hoeveel dagen te laat en voor welk bedrag, en stel voor wat ik doe. Verstuur nog niets.`,
    },
    {
      key: 'vraag-uren',
      label: 'Uren factureren',
      prompt: `Welke uren van ${naam} uit ${MAANDEN[t.maand - 1]} en de maand ervoor zijn nog niet gefactureerd? Laat per klant zien wat erop kan en zet het pas klaar als conceptfactuur als ik dat zeg.`,
    },
    {
      key: 'vraag-btw',
      label: btwLabel,
      prompt: `Zet de btw-aangifte van ${btwPeriode} voor ${naam} voor me klaar: welke bedragen vul ik in bij welke rubriek, en zie je iets dat niet klopt?`,
    },
    {
      key: 'vraag-bank',
      label: 'Bank verwerken',
      prompt: `Loop de banktransacties van ${naam} langs die nog geen uitgave zijn. Stel per transactie voor wat het is (uitgave, negeren of navragen) en leg nog niets vast.`,
    },
    {
      key: 'vraag-jaar',
      label: `Hoe staat ${t.jaar} ervoor`,
      prompt: `Hoe staat ${t.jaar} ervoor bij ${naam}: omzet, kosten en resultaat per maand, vergeleken met ${t.jaar - 1} over dezelfde periode, en een schatting van de inkomstenbelasting.`,
    },
  ]
}
