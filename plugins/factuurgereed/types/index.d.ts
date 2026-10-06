export type Organisatie = { id: string; naam: string; rol: string }

export type Factuurregel = {
  id: string
  nummer: string
  klant: string
  bedrag: number
  vervaldatum: string | null
  dagenTeLaat: number
}

export type Btw = {
  jaar: number
  kwartaal: number
  teBetalen: number
  terug: number
  deadline: string
  dagenTotDeadline: number
  ingediend: boolean
  /** Het kwartaal is nog niet voorbij. */
  loopt: boolean
}

export type Timer = {
  klant: string | null
  project: string | null
  beschrijving: string | null
  gepauzeerd: boolean
  /** Verstreken minuten op het moment van ophalen. */
  minuten: number
  /** Wanneer `minuten` gemeten is (ms sinds epoch). */
  gemetenOp: number
}

export type Overzicht = {
  organisatie: Organisatie
  bijgewerktOp: number
  maand: { naam: string; omzet: number; kosten: number; uren: number }
  openstaand: {
    bedrag: number
    aantal: number
    teLaatBedrag: number
    teLaatAantal: number
    facturen: Factuurregel[]
  }
  concepten: { aantal: number; bedrag: number; facturen: Factuurregel[] }
  btw: Btw | null
  timer: Timer | null
  /** Banktransacties die nog geen uitgave zijn; null zonder bankkoppeling. */
  bank: number | null
}

export type Laadstatus = {
  /** `geen-koppeling`: er is geen FactuurGereed-connector in deze sessie. */
  fase: 'leeg' | 'laden' | 'klaar' | 'fout' | 'geen-koppeling'
  melding: string | null
}

declare module 'claude-code' {
  interface PluginState {
    factuurgereed: {
      overzicht: Overzicht | null
      status: Laadstatus
      organisaties: Organisatie[]
      paneelOpen: boolean
    }
  }
}
