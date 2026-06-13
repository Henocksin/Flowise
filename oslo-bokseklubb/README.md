# Oslo Bokseklubb – ny nettside

Fornyet, moderne nettside for **Oslo Bokseklubb (OBK)** på Jordal. Bygget helt
uten rammeverk – ren HTML, CSS og litt vanilla JavaScript. Ingen byggesteg, ingen
avhengigheter: åpne `index.html` i en nettleser, så fungerer alt.

## Innhold

| Fil | Beskrivelse |
|-----|-------------|
| `index.html` | All struktur og innhold (hero, om, partier, timeplan, priser, innmelding, kontakt) |
| `styles.css` | Design og responsivt oppsett (mørkt tema med rød boksaksent) |
| `script.js` | Mobilmeny, scroll-animasjoner, årstall i footer |
| `assets/logo.svg` | **Plassholder-logo** – bytt ut med klubbens ekte logo |

## Forhåndsvisning lokalt

```bash
cd oslo-bokseklubb
python3 -m http.server 8000
# Åpne http://localhost:8000 i nettleseren
```

## Innhold som er brukt

Hentet fra offentlig tilgjengelig informasjon om klubben:

- **Adresse:** Jordalgata 12, 0657 Oslo (Jordal Idrettspark)
- **E-post:** max@oslobokseklubb.no · **Tlf:** 41 31 88 18
- **Partier:** Bokseskolen (under 18, 150 kr/mnd), Mosjonisten (over 18, 329 kr/mnd),
  Fitnessboksing for kvinner
- **Innmelding:** via minidrett.no

## Gjenstår å tilpasse (krever input fra klubben)

Disse er satt med fornuftige standardverdier og bør verifiseres mot klubbens
faktiske merkevare og informasjon:

1. **Logo** – `assets/logo.svg` er en plassholder. Legg inn ekte logo (samme filnavn,
   eller oppdater `<img src>` i `index.html` og `link rel="icon"`).
2. **Farger** – juster `--accent` og `--accent-2` øverst i `styles.css` til klubbens
   profilfarger.
3. **Bilder** – legg gjerne inn ekte treningsbilder i hero og om-seksjonen.
4. **Fitnessboksing-pris** – står som «Ta kontakt»; fyll inn dersom prisen er fast.
5. **Åpningstider / kontaktperson** – verifiser at tidene og e-post/telefon stemmer.

> Merk: Den nåværende nettsiden blokkerer automatisk innhenting, så innholdet over
> er rekonstruert fra offentlige kilder og bør dobbeltsjekkes mot klubbens egne data.
