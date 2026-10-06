import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, McpToolResult, Register, RenderElement } from 'claude-code'

import type { Factuurregel, Laadstatus, Organisatie, Overzicht } from '../types'
import {
  APP_URL,
  duur,
  euro,
  getal,
  haalOverzicht,
  kiesOrganisatie,
  klokTijd,
  korteDatum,
  leesOrganisaties,
  meervoud,
  timerMinuten,
  vragen,
} from './data'
import type { Roep } from './data'

type Motor = EngineInterface

const PANE = 'factuurgereed'
const GROEN = '#008255'
const ROOD = '#d32f2f'
const ORANJE = '#c77700'

const overzicht = atom({ plugin: 'factuurgereed', key: 'overzicht' } as const, null)
const status = atom({ plugin: 'factuurgereed', key: 'status' } as const, { fase: 'leeg', melding: null })
const organisaties = atom({ plugin: 'factuurgereed', key: 'organisaties' } as const, [])
const paneelOpen = atom({ plugin: 'factuurgereed', key: 'paneelOpen' } as const, false)

/** Namen waaronder de connector kan heten; de echte naam komt uit de toollijst. */
const KANDIDATEN = ['FactuurGereed', 'claude.ai FactuurGereed']

/** Tools die iets in FactuurGereed veranderen: na zo'n beurt halen we de cijfers opnieuw op. */
const SCHRIJVEND =
  /__(conceptfactuur_maken|conceptofferte_maken|factuur_(bewerken|status_wijzigen|versturen|verwijderen|herinnering_versturen)|offerte_\w+|timer_(starten|stoppen|annuleren)|uren_registreren|uur_\w+|uitgave_\w+|banktransacties_(als_uitgave_vastleggen|negeren)|aangifte_als_ingediend_markeren|herhaling_wijzigen)$/

// ---------------------------------------------------------------- verbinding

function tekst(r: McpToolResult): string {
  return r.content.map(b => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('')
}

function roepVia($: Motor, server: string): Roep {
  return async (tool, args = {}) => {
    const r = await $.mcp.call(server, tool, args)
    const t = tekst(r)
    if (r.isError) throw new Error(t || `${tool} mislukte`)
    return t ? JSON.parse(t) : null
  }
}

/** Er is in deze sessie geen FactuurGereed-connector: geen fout, wel iets om uit te leggen. */
class GeenKoppeling extends Error {}

/**
 * Servers met de tools van FactuurGereed. Iedereen noemt de connector anders
 * ("FactuurGereed", "factuurgereed", een id), dus we herkennen hem aan zijn tools.
 */
async function fgServers($: Motor): Promise<string[]> {
  let namen: Set<string>
  try {
    namen = new Set((await $.tool.list()).map(t => t.name))
  } catch {
    return []
  }
  const servers: string[] = []
  for (const naam of namen) {
    const m = /^mcp__(.+)__organisaties_lijst$/.exec(naam)
    if (m?.[1] && namen.has(`mcp__${m[1]}__btw_kwartaal`)) servers.push(m[1])
  }
  return servers
}

/** Zoekt de FactuurGereed-connector en onthoudt onder welke naam hij antwoordt. */
async function verbind($: Motor): Promise<{ roep: Roep; organisaties: Organisatie[] }> {
  const gevonden = await fgServers($)
  const bewaard = await $.store.get('server')
  const namen = [...new Set([...(typeof bewaard === 'string' ? [bewaard] : []), ...gevonden, ...KANDIDATEN])]

  let fout: string | null = null
  for (const server of namen) {
    try {
      const roep = roepVia($, server)
      const lijst = leesOrganisaties(await roep('organisaties_lijst'))
      if (server !== bewaard) await $.store.set('server', server)
      return { roep, organisaties: lijst }
    } catch (e) {
      // Een gok die niet bestaat zegt niets; een echte connector die faalt wel.
      if (gevonden.includes(server)) fout ??= e instanceof Error ? e.message : String(e)
    }
  }
  if (fout !== null) {
    throw new Error(`De FactuurGereed-connector gaf een fout: ${fout} Log zo nodig opnieuw in bij de connector en kies Vernieuwen.`)
  }
  throw new GeenKoppeling()
}

let bezig: Promise<void> | null = null
let moetVernieuwen = false
/** Het paneel gaat bij de start pas open als de cijfers er zijn, en maar één keer. */
let paneelBijStart = false

/** Haalt alles opnieuw op; de oude cijfers blijven staan tot de nieuwe binnen zijn. */
function vernieuw($: Motor): Promise<void> {
  bezig ??= (async () => {
    try {
      await update($, status, () => ({ fase: 'laden', melding: null }) satisfies Laadstatus)
      const verbinding = await verbind($)
      await update($, organisaties, () => verbinding.organisaties)
      const org = kiesOrganisatie(verbinding.organisaties, await $.store.get('organisatie'))
      if (!org) throw new Error('Dit account hoort nog bij geen enkele organisatie in FactuurGereed.')
      const data = await haalOverzicht(verbinding.roep, org, await $.clock.now())
      await update($, overzicht, () => data)
      await update($, status, () => ({ fase: 'klaar', melding: null }) satisfies Laadstatus)
      if (paneelBijStart) {
        paneelBijStart = false
        if ((await $.store.get('paneel')) !== false) await openPaneel($)
      }
    } catch (fout) {
      if (fout instanceof GeenKoppeling) {
        await update($, overzicht, () => null)
        await update($, status, () => ({ fase: 'geen-koppeling', melding: null }) satisfies Laadstatus)
      } else {
        const melding = fout instanceof Error ? fout.message : String(fout)
        await update($, status, () => ({ fase: 'fout', melding }) satisfies Laadstatus)
      }
    } finally {
      bezig = null
    }
  })()
  return bezig
}

async function kiesOrg($: Motor, id: string): Promise<void> {
  await $.store.set('organisatie', id)
  await update($, overzicht, o => (o && o.organisatie.id !== id ? null : o))
  await vernieuw($)
}

async function openPaneel($: Motor): Promise<void> {
  await $.ui.open({ id: PANE, title: 'FactuurGereed' })
  await update($, paneelOpen, () => true)
  await $.store.set('paneel', true)
}

async function sluitPaneel($: Motor): Promise<void> {
  await $.ui.close({ id: PANE })
  await update($, paneelOpen, () => false)
  await $.store.set('paneel', false)
}

async function stopTimer($: Motor): Promise<void> {
  const server = await $.store.get('server')
  const o = await read($, overzicht)
  if (typeof server !== 'string' || !o) return
  const r = await $.mcp.call(server, 'timer_stoppen', { organisatie_id: o.organisatie.id })
  $.ui.toast(r.isError ? `Timer stoppen lukte niet: ${tekst(r)}` : 'Timer gestopt, de tijd staat bij je uren.')
  await vernieuw($)
}

function vraag($: Motor, prompt: string): void {
  void $.prompt.submit({ text: prompt })
}

// ---------------------------------------------------------------- tekenen

type El = ElementTable

function tegel(el: El, titel: string, waarde: string, sub: string, kleur?: string): RenderElement {
  const { Box, Text } = el
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderDimColor paddingX={1}>
      <Text dimColor>{titel}</Text>
      <Text bold color={kleur}>{waarde}</Text>
      <Text dimColor wrap="truncate-end">{sub}</Text>
    </Box>
  )
}

function btwTegel(el: El, o: Overzicht): RenderElement {
  const b = o.btw
  if (!b) return tegel(el, 'Btw', 'Onbekend', 'Kwartaal niet op te halen')

  const titel = `Btw Q${b.kwartaal} ${b.jaar}`
  const waarde = b.teBetalen > 0 ? euro(b.teBetalen) : b.terug > 0 ? `${euro(b.terug)} terug` : euro(0)
  if (b.ingediend) return tegel(el, titel, waarde, 'Aangifte ingediend', GROEN)
  if (b.loopt) return tegel(el, titel, waarde, `Loopt nog, aangifte vóór ${korteDatum(b.deadline)}`)
  if (b.dagenTotDeadline < 0) {
    return tegel(el, titel, waarde, `${meervoud(-b.dagenTotDeadline, 'dag', 'dagen')} over de deadline`, ROOD)
  }
  return tegel(
    el,
    titel,
    waarde,
    `Nog ${meervoud(b.dagenTotDeadline, 'dag', 'dagen')}, vóór ${korteDatum(b.deadline)}`,
    b.dagenTotDeadline <= 14 ? ORANJE : undefined,
  )
}

function factuurRij(el: El, f: Factuurregel, rechts: string, kleur?: string): RenderElement {
  const { Box, Text, Link } = el
  return (
    <Box flexDirection="row" gap={1}>
      <Link href={`${APP_URL}/facturen/${f.id}`} label={f.nummer} />
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">{f.klant}</Text>
      </Box>
      <Text>{euro(f.bedrag, true)}</Text>
      <Text color={kleur} dimColor={!kleur}>{rechts}</Text>
    </Box>
  )
}

function kopje(el: El, titel: string, aantal?: number): RenderElement {
  const { Box, Text } = el
  return (
    <Box flexDirection="row" gap={1}>
      <Text bold>{titel}</Text>
      {aantal !== undefined && <Text dimColor>{String(aantal)}</Text>}
    </Box>
  )
}

function paneel(
  $: Motor,
  el: El,
  terminal: boolean,
  breed: number,
  o: Overzicht | null,
  s: Laadstatus,
  orgs: Organisatie[],
  nu: number,
): RenderElement {
  const { Box, Text, Button, Link } = el

  const kop = o && (
    terminal ? (
      <Box flexDirection="column">
        <Text bold color={GROEN}>{o.organisatie.naam}</Text>
        <Text dimColor>{`${o.maand.naam}: ${euro(o.maand.omzet)} omzet · ${euro(o.maand.kosten)} kosten · ${getal(o.maand.uren)} uur`}</Text>
      </Box>
    ) : (
      <Box flexDirection="column" backgroundColor="#0b3b2c" paddingX={1} paddingY={1}>
        <Text bold color="#ffffff">{o.organisatie.naam}</Text>
        <Text color="#cfe9df">{`${o.maand.naam}: ${euro(o.maand.omzet)} omzet · ${euro(o.maand.kosten)} kosten · ${getal(o.maand.uren)} uur`}</Text>
      </Box>
    )
  )

  const wissel = orgs.length > 1 && (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      <Text dimColor>Administratie</Text>
      {orgs.map(org => (
        <Button
          key={`org-${org.id}`}
          label={org.id === o?.organisatie.id ? `● ${org.naam}` : org.naam}
          plain
          dimColor={org.id !== o?.organisatie.id}
          onPress={() => kiesOrg($, org.id)}
        />
      ))}
    </Box>
  )

  if (!o) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color={GROEN}>FactuurGereed</Text>
        {wissel}
        {s.fase === 'geen-koppeling' ? (
          <Box flexDirection="column" gap={1}>
            <Text>Claude is nog niet gekoppeld aan FactuurGereed.</Text>
            <Text dimColor>
              Voeg de FactuurGereed-connector toe, dan zie je hier je openstaande facturen, de btw, je uren en de
              timer. Hoe dat gaat staat in FactuurGereed onder Instellingen, Koppelingen.
            </Text>
            <Box flexDirection="row" gap={2} flexWrap="wrap">
              <Link href={`${APP_URL}/instellingen/koppelingen`} label="Koppeling instellen" />
              <Button key="vernieuwen" label="Opnieuw zoeken" plain dimColor onPress={() => vernieuw($)} />
            </Box>
          </Box>
        ) : s.fase === 'fout' ? (
          <Box flexDirection="column" gap={1}>
            <Text color={ROOD}>{s.melding ?? 'Ophalen mislukte.'}</Text>
            <Button key="vernieuwen" label="Opnieuw" onPress={() => vernieuw($)} />
          </Box>
        ) : (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>{s.fase === 'laden' ? 'Cijfers ophalen uit FactuurGereed…' : 'Nog geen cijfers.'}</Text>
            <Button key="vernieuwen" label="Vernieuwen" plain dimColor onPress={() => vernieuw($)} />
          </Box>
        )}
      </Box>
    )
  }

  const rij = breed >= 44 ? 'row' : 'column'
  const open = o.openstaand
  const timer = o.timer

  return (
    <Box flexDirection="column" gap={1}>
      {kop}
      {wissel}
      {s.fase === 'fout' && <Text color={ROOD}>{s.melding ?? 'Bijwerken mislukte.'}</Text>}

      <Box flexDirection="column">
        <Box flexDirection={rij} gap={1}>
          {tegel(el, 'Openstaand', euro(open.bedrag), meervoud(open.aantal, 'factuur', 'facturen'))}
          {tegel(
            el,
            'Te laat',
            euro(open.teLaatBedrag),
            open.teLaatAantal > 0 ? meervoud(open.teLaatAantal, 'factuur', 'facturen') : 'Niets te laat',
            open.teLaatAantal > 0 ? ROOD : GROEN,
          )}
        </Box>
        <Box flexDirection={rij} gap={1}>
          {btwTegel(el, o)}
          {tegel(el, 'Concepten', euro(o.concepten.bedrag), meervoud(o.concepten.aantal, 'factuur', 'facturen'))}
        </Box>
      </Box>

      <Box flexDirection="column">
        {kopje(el, 'Timer')}
        {timer ? (
          <Box flexDirection="row" gap={1}>
            <Text bold color={timer.gepauzeerd ? ORANJE : GROEN}>{duur(timerMinuten(timer, nu))}</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end">
                {[timer.klant, timer.project].filter(Boolean).join(' · ') + (timer.gepauzeerd ? ' (gepauzeerd)' : '')}
              </Text>
            </Box>
            <Button key="timer-stop" label="Stop en boek" onPress={() => stopTimer($)} />
          </Box>
        ) : (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>Er loopt geen timer.</Text>
            <Button
              key="timer-start"
              label="› Start timer"
              plain
              dimColor
              onPress={() =>
                vraag($, `Start de timer in FactuurGereed voor ${o.organisatie.naam}. Vraag me voor welke klant en welk project als dat niet duidelijk is.`)
              }
            />
          </Box>
        )}
        {timer?.beschrijving && <Text dimColor wrap="truncate-end">{timer.beschrijving}</Text>}
      </Box>

      <Box flexDirection="column">
        {kopje(el, 'Openstaande facturen', open.aantal)}
        {open.facturen.length === 0 && <Text dimColor>Alles is betaald.</Text>}
        {open.facturen.slice(0, 6).map(f =>
          f.dagenTeLaat > 0
            ? factuurRij(el, f, `${f.dagenTeLaat} d te laat`, ROOD)
            : factuurRij(el, f, korteDatum(f.vervaldatum)),
        )}
      </Box>

      {o.concepten.aantal > 0 && (
        <Box flexDirection="column">
          {kopje(el, 'Concepten', o.concepten.aantal)}
          {o.concepten.facturen.slice(0, 4).map(f => factuurRij(el, f, 'concept'))}
        </Box>
      )}

      {o.bank !== null && o.bank > 0 && (
        <Box flexDirection="row" gap={1}>
          <Text>{`${meervoud(o.bank, 'banktransactie', 'banktransacties')} te verwerken`}</Text>
          <Link href={`${APP_URL}/te-verwerken`} label="Bekijk" />
        </Box>
      )}

      <Box flexDirection="column">
        {kopje(el, 'Vraag Claude')}
        {vragen(o, nu).map(v => (
          <Button key={v.key} label={`› ${v.label}`} plain onPress={() => vraag($, v.prompt)} />
        ))}
      </Box>

      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text dimColor>{s.fase === 'laden' ? 'Bijwerken…' : `Bijgewerkt ${klokTijd(o.bijgewerktOp)}`}</Text>
        <Button key="vernieuwen" label="Vernieuwen" plain dimColor onPress={() => vernieuw($)} />
        <Link href={`${APP_URL}/dashboard`} label="Open FactuurGereed" />
      </Box>
    </Box>
  )
}

/** De korte regel in de band, onderdelen in volgorde van belang tot de breedte op is. */
function bandDelen(o: Overzicht, nu: number): { tekst: string; kleur?: string }[] {
  const delen: { tekst: string; kleur?: string }[] = []
  const timer = o.timer
  if (timer) {
    delen.push({ tekst: `timer ${duur(timerMinuten(timer, nu))}${timer.project ? ` ${timer.project}` : ''}`, kleur: GROEN })
  }
  if (o.openstaand.teLaatAantal > 0) {
    delen.push({ tekst: `${o.openstaand.teLaatAantal} te laat`, kleur: ROOD })
  }
  delen.push({ tekst: `${euro(o.openstaand.bedrag)} open` })
  const b = o.btw
  if (b && !b.loopt && !b.ingediend) {
    delen.push({
      tekst: b.dagenTotDeadline >= 0 ? `btw Q${b.kwartaal} nog ${b.dagenTotDeadline} d` : `btw Q${b.kwartaal} te laat`,
      kleur: b.dagenTotDeadline <= 14 ? ORANJE : undefined,
    })
  }
  if (o.concepten.aantal > 0) delen.push({ tekst: meervoud(o.concepten.aantal, 'concept', 'concepten') })
  return delen
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'factuurgereed',
      description: 'Open het FactuurGereed-paneel en haal de cijfers opnieuw op',
    })
    $.clock.after(0, () => void vernieuw($))
    $.clock.every(5 * 60_000, () => void vernieuw($))
    // Een lopende timer telt zichtbaar door.
    $.clock.every(30_000, () => {
      void read($, overzicht).then(o => {
        if (o?.timer && !o.timer.gepauzeerd) $.ui.invalidate('ui.render')
      })
    })
    paneelBijStart = true

    return next(e)
  })

  on('command.run', { command: 'factuurgereed' }, async $ => {
    await openPaneel($)
    $.clock.after(0, () => void vernieuw($))

    return { text: 'FactuurGereed-paneel geopend; de cijfers worden opnieuw opgehaald.' }
  })

  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    if (e.id === PANE) {
      await update($, paneelOpen, () => false)
      if (e.origin.kind === 'person') await $.store.set('paneel', false)
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (SCHRIJVEND.test(e.tool)) moetVernieuwen = true
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (moetVernieuwen) {
      moetVernieuwen = false
      $.clock.after(0, () => void vernieuw($))
    }
    return r
  })

  // Claude weet welke administratie in het paneel gekozen is, zodat hij niet elke keer hoeft te vragen.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const o = await read($, overzicht)
    const orgs = await read($, organisaties)
    if (!o || orgs.length < 2) return r
    return {
      sections: [
        ...r.sections,
        {
          id: 'factuurgereed:organisatie',
          scope: 'session',
          text: `In het FactuurGereed-paneel heeft de gebruiker de organisatie "${o.organisatie.naam}" gekozen (organisatie_id ${o.organisatie.id}). Gebruik die bij de FactuurGereed-tools, tenzij de gebruiker een andere organisatie noemt.`,
        },
      ],
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const [o, s, orgs, nu] = await Promise.all([
      read($, overzicht),
      read($, status),
      read($, organisaties),
      $.clock.now(),
    ])
    return paneel($, el, e.surface === 'terminal', e.props.bodyColumns, o, s, orgs, nu)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const [o, s, open, nu] = await Promise.all([
      read($, overzicht),
      read($, status),
      read($, paneelOpen),
      $.clock.now(),
    ])
    if (!o && s.fase !== 'fout' && s.fase !== 'geen-koppeling') return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const ruimte = e.props.bodyColumns - 34 - (o?.organisatie.naam.length ?? 0)
    const delen: { tekst: string; kleur?: string }[] = []
    let lengte = 0
    const zonderCijfers =
      s.fase === 'geen-koppeling' ? [{ tekst: 'nog niet gekoppeld met Claude' }] : [{ tekst: 'niet bereikbaar', kleur: ROOD }]
    for (const deel of o ? bandDelen(o, nu) : zonderCijfers) {
      if (lengte + deel.tekst.length + 3 > ruimte && delen.length > 0) break
      delen.push(deel)
      lengte += deel.tekst.length + 3
    }

    return (
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Box flexDirection="row" gap={1} flexShrink={1}>
          <Text bold color="#ffffff" backgroundColor={GROEN}>{' FactuurGereed '}</Text>
          {o && <Text bold>{o.organisatie.naam}</Text>}
          {delen.map((deel, i) => (
            <Text color={deel.kleur} dimColor={!deel.kleur} wrap="truncate-end">
              {`${i > 0 ? '· ' : ''}${deel.tekst}`}
            </Text>
          ))}
        </Box>
        <Button
          key="paneel"
          label={open ? 'Paneel uit' : 'Paneel aan'}
          plain
          dimColor
          onPress={() => (open ? sluitPaneel($) : openPaneel($))}
        />
      </Box>
    )
  })
}
