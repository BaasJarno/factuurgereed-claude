import { describe, expect, mock, test } from 'claude-code/testing'
import type { McpToolResult, On } from 'claude-code'

const fout = (text: string): { value: McpToolResult } => ({ value: { isError: true, content: [{ type: 'text', text }] } })

import { euro, getal, korteDatum, nlTijd } from '../hooks/data'

const EIGENAAR = '11111111-2222-4333-8444-555555555555'
// Dinsdag 6 oktober 2026, 11:00 Nederlandse tijd.
const NU = Date.UTC(2026, 9, 6, 9, 0)

const ANTWOORDEN: Record<string, unknown> = {
  organisaties_lijst: {
    organisaties: [
      { id: '99999999-8888-4777-8666-555555555555', naam: 'Bijbaan', rol: 'member', status: 'actief' },
      { id: EIGENAAR, naam: 'Studio Voorbeeld', rol: 'owner', status: 'actief' },
    ],
  },
  overzicht_periode: {
    totalen: { omzet_excl: 2931.83, kosten_excl: 21.8, uren: 22.5 },
    openstaand: { bedrag: 6028.01, aantal: 2, vervallen_bedrag: 2480.5, vervallen_aantal: 1 },
  },
  facturen_zoeken: {
    totaal_gevonden: 2,
    facturen: [
      { id: 'a', factuurnummer: '2026-031', klant: 'Bakker', vervaldatum: '2026-10-31', totaal_incl_btw: 3547.51 },
      { id: 'b', factuurnummer: '2026-027', klant: 'Bakker', vervaldatum: '2026-10-01', totaal_incl_btw: 2480.5, dagen_te_laat: 5 },
    ],
  },
  btw_kwartaal: {
    jaar: 2026, kwartaal: 3, te_betalen: 722.33, terug_te_ontvangen: 0,
    deadline_aangifte: '2026-10-31', dagen_tot_deadline: 25, ingediend: false,
  },
  timer_bekijken: { loopt: true, klant: 'Bakker', project: 'Website', verstreken_minuten: 42 },
  banktransacties_te_verwerken: { aantal: 3, transacties: [] },
}

type Aanroep = { tool: string; args: Record<string, unknown> }

/** De FactuurGereed-connector onder de plugin, met vaste antwoorden. */
function connector(on: On): Aanroep[] {
  const aanroepen: Aanroep[] = []
  on('tool.list', () => ({
    value: ['organisaties_lijst', 'btw_kwartaal'].map(t => ({ name: `mcp__fg__${t}`, description: '', mcp: true })),
  }))
  on('mcp.call', ($, e) => {
    if (e.server !== 'fg') return fout('onbekende server')
    aanroepen.push({ tool: e.tool, args: e.args })
    // Concepten leeg houden, zodat de open facturen het lijstje vullen.
    const data = e.tool === 'facturen_zoeken' && e.args.status === 'concept' ? { facturen: [] } : ANTWOORDEN[e.tool]
    return { value: { isError: false, content: [{ type: 'text', text: JSON.stringify(data ?? {}) }] } }
  })
  return aanroepen
}

const PANE_PROPS = { title: 'FactuurGereed', isFocused: false, placement: 'dock', bodyColumns: 60 } as const

describe('getallen en datums', () => {
  test('euro en uren op zijn Nederlands', () => {
    expect(euro(6028.01)).toBe('€ 6.028')
    expect(euro(2480.5, true)).toBe('€ 2.480,50')
    expect(euro(-12.3, true)).toBe('-€ 12,30')
    expect(getal(22.5)).toBe('22,5')
    expect(korteDatum('2026-10-31')).toBe('31 okt')
  })

  test('Nederlandse tijd rond de wintertijd', () => {
    // 25 oktober 2026 01:00 UTC gaat de klok terug.
    expect(nlTijd(Date.UTC(2026, 9, 25, 0, 30)).uur).toBe(2)
    expect(nlTijd(Date.UTC(2026, 9, 25, 1, 30)).uur).toBe(2)
    expect(nlTijd(Date.UTC(2026, 11, 31, 23, 30))).toMatchObject({ jaar: 2027, maand: 1, dag: 1 })
  })
})

describe('paneel', () => {
  test('toont openstaand, te laat, btw en timer na vernieuwen', async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: NU })
    const aanroepen = connector(on)
    on('prompt.submit', ($, e) => ({ text: e.text }))

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'factuurgereed',
        surface,
        component: 'Pane',
        requestId: 'factuurgereed',
        props: PANE_PROPS as never,
      })
      await ui.press({ key: 'vernieuwen' })

      expect(await ui.find({ type: 'Text', text: 'Studio Voorbeeld' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '€ 6.028' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '5 d te laat' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Nog 25 dagen/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '0:42' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /3 banktransacties/ })).toBeDefined()
      expect(await ui.find({ key: 'vraag-stand' })).toBeDefined()
      expect(await ui.find({ key: 'org-99999999-8888-4777-8666-555555555555' })).toBeDefined()
      await ui.unmount()
    }

    // De eigenaar-organisatie is de standaard; elke vraag gaat met haar id.
    const metOrg = aanroepen.filter(a => a.tool !== 'organisaties_lijst')
    expect(metOrg.length).toBeGreaterThan(0)
    expect(metOrg.every(a => a.args.organisatie_id === EIGENAAR)).toBe(true)
  })

  test('een snelle vraag gaat als prompt naar Claude', async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: NU })
    connector(on)
    const verstuurd: string[] = []
    on('prompt.submit', ($, e) => {
      verstuurd.push(e.text)
      return { text: e.text }
    })

    const ui = await $.ui.mount({
      plugin: 'factuurgereed',
      surface: 'desktop',
      component: 'Pane',
      requestId: 'factuurgereed',
      props: PANE_PROPS as never,
    })
    await ui.press({ key: 'vernieuwen' })
    await ui.press({ key: 'vraag-te-laat' })

    expect(verstuurd).toHaveLength(1)
    expect(verstuurd[0]).toMatch(/te laat/)
    expect(verstuurd[0]).toMatch(/Studio Voorbeeld/)
  })

  test('zonder connector uitleg hoe je koppelt, geen foutmelding', async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: NU })
    on('tool.list', () => ({ value: [] }))
    on('mcp.call', () => fout('onbekende server'))

    const ui = await $.ui.mount({
      plugin: 'factuurgereed',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'factuurgereed',
      props: PANE_PROPS as never,
    })
    await ui.press({ key: 'vernieuwen' })
    expect(await ui.find({ type: 'Text', text: /nog niet gekoppeld/ })).toBeDefined()
    expect(await ui.find({ type: 'Link', text: 'Koppeling instellen' })).toBeDefined()

    const band = await $.ui.mount({
      plugin: 'factuurgereed',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 140 } as never,
    })
    expect(await band.find({ type: 'Text', text: /nog niet gekoppeld/ })).toBeDefined()
  })

  test('een connector die faalt geeft zijn eigen melding', async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: NU })
    on('tool.list', () => ({
      value: ['organisaties_lijst', 'btw_kwartaal'].map(t => ({ name: `mcp__fg__${t}`, description: '', mcp: true })),
    }))
    on('mcp.call', () => fout('Sessie verlopen.'))

    const ui = await $.ui.mount({
      plugin: 'factuurgereed',
      surface: 'desktop',
      component: 'Pane',
      requestId: 'factuurgereed',
      props: PANE_PROPS as never,
    })
    await ui.press({ key: 'vernieuwen' })
    expect(await ui.find({ type: 'Text', text: /Sessie verlopen\. Log zo nodig opnieuw in/ })).toBeDefined()
  })
})

describe('band', () => {
  test('vat de stand samen boven de prompt', async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: NU })
    connector(on)

    const pane = await $.ui.mount({
      plugin: 'factuurgereed',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'factuurgereed',
      props: PANE_PROPS as never,
    })
    await pane.press({ key: 'vernieuwen' })

    const band = await $.ui.mount({
      plugin: 'factuurgereed',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 140 } as never,
    })
    expect(await band.find({ type: 'Text', text: /1 te laat/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /€ 6\.028 open/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /btw Q3 nog 25 d/ })).toBeDefined()
    expect(await band.find({ key: 'paneel' })).toBeDefined()
  })
})
