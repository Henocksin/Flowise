#!/usr/bin/env node

import { scrapeListings } from './scraper.js'
import { processListings, detectSoldListings, generateReport, formatReport } from './tracker.js'
import { sendWeeklyReport, sendTestEmail } from './mailer.js'
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
  node src/index.js report         Vis prisrapport i terminalen
  node src/index.js email          Send prisrapport pa e-post
  node src/index.js test-email     Send en test-epost for a verifisere oppsett

E-postkonfigurasjon (miljovariabler):
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_USER=deg@gmail.com
  SMTP_PASS=xxxx-xxxx-xxxx-xxxx   (Gmail: bruk App Password)
  MAIL_TO=deg@gmail.com

  Sett disse i en .env-fil eller eksporter dem i shellet.

Cron-oppsett:
  # Daglig skanning kl 08:00
  0 8 * * * cd /path/to/mac-mini-tracker && node src/index.js track

  # Ukentlig e-postrapport mandag kl 09:00
  0 9 * * 1 cd /path/to/mac-mini-tracker && node src/index.js email

Forste kjoring:
  cd packages/mac-mini-tracker
  npm install
  cp .env.example .env              # Rediger med dine SMTP-detaljer
  node src/index.js test-email      # Sjekk at e-post fungerer
  node src/index.js track           # Forste skanning
`)
}

// Load .env file if present
try {
    const { readFileSync } = await import('fs')
    const { join, dirname } = await import('path')
    const { fileURLToPath } = await import('url')
    const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env')
    const envContent = readFileSync(envPath, 'utf-8')
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx === -1) continue
        const key = trimmed.substring(0, eqIdx).trim()
        const val = trimmed.substring(eqIdx + 1).trim()
        if (!process.env[key]) process.env[key] = val
    }
} catch {
    // No .env file, that's fine
}

try {
    switch (command) {
        case 'track':
            await runTrack()
            break
        case 'report':
            runReport()
            break
        case 'email':
            await sendWeeklyReport()
            break
        case 'test-email':
            await sendTestEmail()
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
