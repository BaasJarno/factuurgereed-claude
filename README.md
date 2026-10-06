# FactuurGereed voor Claude Code

Met deze plugin staat je FactuurGereed-administratie naast het gesprek in Claude Code, in de desktop-app en in de terminal.

## Wat je krijgt

- **Een paneel** met:
  - wat er openstaat en wat te laat is
  - de btw van het kwartaal met de deadline
  - je concepten
  - de omzet en uren van deze maand
  - de timer, met een knop om hem te stoppen en de tijd te boeken
  - de banktransacties die je nog moet verwerken

  Factuurnummers zijn links naar de factuur in FactuurGereed.
- **Een regel boven de invoer**: de stand in één oogopslag, met een knop om het paneel aan of uit te zetten.
- **Snelle vragen voor Claude**: stand van zaken, te late facturen, uren factureren, btw-aangifte, bank verwerken en hoe het jaar ervoor staat. Een klik stelt de vraag.
- **`/factuurgereed`**: opent het paneel en haalt de cijfers opnieuw op.
- **Meer administraties?** Kies er een in het paneel. Claude gebruikt die dan ook bij je vragen.

Het paneel werkt zichzelf elke vijf minuten bij, en ook meteen nadat Claude iets in FactuurGereed heeft aangemaakt of gewijzigd.

## Wat je nodig hebt

1. Een account bij [FactuurGereed](https://www.factuurgereed.nl).
2. De FactuurGereed-connector in Claude. In FactuurGereed staat onder **Instellingen, Koppelingen** hoe je die toevoegt.
3. Claude Code: de Code-tab in de Claude desktop-app, of `claude` in de terminal.

## Installeren

Typ in een terminal:

```bash
claude plugin marketplace add BaasJarno/factuurgereed-claude
```

```bash
claude plugin install factuurgereed@factuurgereed
```

Start daarna een nieuwe sessie. In de desktop-app vind je de plugin ook terug onder **+**, **Plugins**.

## Bijwerken

```bash
claude plugin update factuurgereed@factuurgereed
```

Je kunt ook automatisch bijwerken aanzetten: typ `/plugin` in een sessie, ga naar **Marketplaces**, kies **factuurgereed** en zet **Enable auto-update** aan.

## Wat de plugin wel en niet doet

- De plugin leest je administratie via je eigen FactuurGereed-connector, met je eigen login. Hij praat met geen enkele andere dienst.
- Hij verstuurt nooit zelf een factuur, offerte of herinnering. In de snelle vragen staat dat Claude niets mag versturen of vastleggen voordat jij dat zegt.
- Er is één knop die iets verandert: **Stop en boek** bij een lopende timer. Die stopt de timer en zet de tijd bij je uren, net als in de app.
- Wat je in het paneel kiest (de administratie, paneel aan of uit) blijft op je eigen computer bewaard.

## Vragen

Kijk op [FactuurGereed koppelen aan Claude](https://www.factuurgereed.nl/support/claude) of mail naar contact@websitegereed.nl.
