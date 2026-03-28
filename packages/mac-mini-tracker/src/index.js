#!/usr/bin/env node

import { scrapeListings } from './scraper.js'
import { processListings, detectSoldListings, generateReport, formatReport } from './tracker.js'
import db from './db.js'

const command = process.argv[2] || 'help'
const flags = new Set(process.argv.slice(3))

async function runTrack() {
    const deepScan = !flags.has('--quick')

    console.log('🔄 Starter skanning av Finn.no...')
    console.log(`   Modus: ${deepScan ? 'dyp (sjekker hver annonse for OpenClaw)' : 'rask (bare søkeresultater)'}`)
    console.log('')

    const listings = await scrapeListings({ deepScan })

    console.log('\n📝 Lagrer data...')
    const { newCount, priceChanges } = processListings(listings)

    console.log('\n🔎 Sjekker for solgte annonser...')
    const currentIds = listings.map(l => l.finnId)
    const soldCount = detectSoldListings(currentIds)

    // Log this scan
    db.prepare(`
        INSERT INTO scan_log (scanned_at, listings_found, new_listings, price_changes, newly_sold)
        VALUES (?, ?, ?, ?, ?)
    `).run(new Date().toISOString(), listings.length, newCount, priceChanges, soldCount)

    console.log('\n✅ Skanning fullført!')
    console.log(`   ${listings.length} annonser funnet`)
    console.log(`   ${newCount} nye annonser`)
    console.log(`   ${priceChanges} prisendringer`)
    console.log(`   ${soldCount} antatt solgt siden sist`)

    const preinstalled = listings.filter(l => l.openclawStatus === 'preinstalled').length
    const mentioned = listings.filter(l => l.openclawStatus === 'mentioned').length
    console.log(`   ${preinstalled} med OpenClaw installert`)
    console.log(`   ${mentioned} nevner OpenClaw som bruksomrade`)
}

function runReport() {
    const report = generateReport()
    console.log(formatReport(report))
}

function showHelp() {
    console.log(`
Mac Mini OpenClaw Pristracker - Finn.no
========================================

Sporer Mac Mini-annonser pa Finn.no for a finne ut hva
Mac Mini med ferdig installert OpenClaw faktisk selges for.

Kommandoer:
  node src/index.js track          Skann Finn.no og oppdater database
  node src/index.js track --quick  Rask skanning (uten dyp OpenClaw-sjekk)
  node src/index.js report         Vis prisrapport

Hvordan det fungerer:
  1. Kjor 'track' daglig (via cron). Den henter alle Mac Mini-annonser
     fra Finn.no og sjekker om de nevner OpenClaw.
  2. Annonser som forsvinner for 60 dager registreres som "antatt solgt"
     med siste kjente pris.
  3. Kjor 'report' nar som helst for a se salgspriser, fordelt pa:
     - Mac Mini med OpenClaw installert (dine konkurrenter)
     - Mac Mini som bare nevner OpenClaw
     - Vanlig Mac Mini (baseline for sammenligning)

Cron-eksempel (daglig kl 08:00):
  0 8 * * * cd /path/to/mac-mini-tracker && node src/index.js track

Forste kjoring:
  cd packages/mac-mini-tracker
  npm install
  node src/index.js track
`)
}

try {
    switch (command) {
        case 'track':
            await runTrack()
            break
        case 'report':
            runReport()
            break
        case 'help':
        default:
            showHelp()
            break
    }
} catch (err) {
    console.error('Feil:', err.message)
    process.exit(1)
}
