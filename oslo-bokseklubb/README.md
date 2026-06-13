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

Basert på skjermdumper av klubbens nåværende nettside:

- **Partier:** Bokseskole (10–18 år, 200 kr/mnd), Mosjonisten (over 18, 369 kr/mnd),
  Fitnessboksing for damer, Konkurransepartiet, Junior Elite og Rock Steady Boxing
  (for personer med Parkinson)
- **Klippekort damer:** «Damer Total» 11 klipp kr 900,- · «Damer» 11 klipp kr 700,-
- **Treningstider:** full ukeplan (man–søn) gjengitt i `#timeplan`
- **Mer:** privattimer, utdrikningslag, kick-off, grasrotandel (Støtt oss)
- **Kontakt:** Max Mankowitz (max@oslobokseklubb.no, mob 413 18 818) og
  Johnny Carlsen (johnny@oslobokseklubb.no)
- **Innmelding/prøvetime:** via minidrett.no / direkte kontakt

## Gjenstår å tilpasse (krever input fra klubben)

1. **Logo** – `assets/logo.svg` er en plassholder utformet etter klubbens røde
   boksehanske-logo. Legg inn den ekte logofila (samme filnavn, eller oppdater
   `<img src>` i `index.html` og `link rel="icon"`).
2. **Bilder** – legg gjerne inn ekte treningsbilder i hero- og om-seksjonen.
3. **Adresse** – `Jordalgata 12, 0657 Oslo` er hentet fra offentlige kilder; verifiser.
4. **Treningstider** – dobbeltsjekk tidene mot klubbens egen plan (særlig fredag).
5. **Konkurranse/Junior Elite/Rock Steady-priser** – står som «etter avtale»; fyll inn
   dersom det finnes faste satser.

> Merk: Den nåværende nettsiden blokkerer automatisk innhenting, så innholdet ble
> rekonstruert fra skjermdumper og offentlige kilder. Dobbeltsjekk mot klubbens data.
