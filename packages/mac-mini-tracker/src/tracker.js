import db from './db.js'

const LISTING_MAX_AGE_DAYS = 60

/**
 * Process scraped listings: insert new, update existing, detect price changes.
 * Returns summary stats.
 */
export function processListings(scrapedListings) {
    const now = new Date().toISOString()
    let newCount = 0
    let priceChanges = 0

    const insertListing = db.prepare(`
        INSERT INTO listings (finn_id, title, price, model, ram, storage, condition, location, listing_url, first_seen, last_seen, listing_date, status, openclaw_status, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `)

    const updateListing = db.prepare(`
        UPDATE listings SET title = ?, price = ?, last_seen = ?, status = 'active',
        model = COALESCE(?, model), ram = COALESCE(?, ram), storage = COALESCE(?, storage),
        location = COALESCE(?, location),
        openclaw_status = CASE WHEN ? IN ('preinstalled','mentioned') AND openclaw_status = 'none' THEN ? ELSE openclaw_status END,
        description = COALESCE(NULLIF(?, ''), description)
        WHERE finn_id = ?
    `)

    const insertPrice = db.prepare(`
        INSERT INTO price_history (finn_id, price, observed_at) VALUES (?, ?, ?)
    `)

    const getExisting = db.prepare(`SELECT * FROM listings WHERE finn_id = ?`)

    const processAll = db.transaction(() => {
        for (const listing of scrapedListings) {
            const existing = getExisting.get(listing.finnId)

            if (!existing) {
                // New listing
                insertListing.run(
                    listing.finnId, listing.title, listing.price,
                    listing.model, listing.ram, listing.storage,
                    null, listing.location, listing.url,
                    now, now, now,
                    listing.openclawStatus || 'none',
                    listing.description || ''
                )
                if (listing.price) {
                    insertPrice.run(listing.finnId, listing.price, now)
                }
                newCount++
            } else {
                // Update existing (openclaw_status only upgrades, never downgrades)
                const ocs = listing.openclawStatus || 'none'
                updateListing.run(
                    listing.title, listing.price, now,
                    listing.model, listing.ram, listing.storage,
                    listing.location,
                    ocs, ocs,
                    listing.description || '',
                    listing.finnId
                )

                // Track price change
                if (listing.price && existing.price && listing.price !== existing.price) {
                    insertPrice.run(listing.finnId, listing.price, now)
                    priceChanges++
                    console.log(`  💰 Prisendring: "${listing.title}" ${existing.price} → ${listing.price} kr`)
                }
            }
        }
    })

    processAll()
    return { newCount, priceChanges }
}

/**
 * Detect listings that have disappeared (likely sold).
 * A listing is considered sold if:
 * - It was active in previous scans
 * - It's no longer in the current scan
 * - It hasn't exceeded the 60-day listing period
 */
export function detectSoldListings(currentFinnIds) {
    const now = new Date()
    const nowStr = now.toISOString()
    let soldCount = 0

    const activeListings = db.prepare(`
        SELECT * FROM listings WHERE status = 'active'
    `).all()

    const markSold = db.prepare(`
        UPDATE listings SET status = 'sold', estimated_sold_date = ?, sold_price = ?
        WHERE finn_id = ?
    `)

    const markExpired = db.prepare(`
        UPDATE listings SET status = 'expired' WHERE finn_id = ?
    `)

    const currentIds = new Set(currentFinnIds)

    for (const listing of activeListings) {
        if (currentIds.has(listing.finn_id)) continue

        // Listing has disappeared
        const firstSeen = new Date(listing.first_seen)
        const daysSinceFirstSeen = (now - firstSeen) / (1000 * 60 * 60 * 24)

        if (daysSinceFirstSeen >= LISTING_MAX_AGE_DAYS) {
            // Listing expired naturally - likely not sold
            markExpired.run(listing.finn_id)
            console.log(`  ⏰ Utløpt: "${listing.title}" (${Math.round(daysSinceFirstSeen)} dager)`)
        } else {
            // Disappeared before expiry - likely sold!
            markSold.run(nowStr, listing.price, listing.finn_id)
            soldCount++
            console.log(`  ✅ Antatt solgt: "${listing.title}" for ${listing.price} kr (etter ${Math.round(daysSinceFirstSeen)} dager)`)
        }
    }

    return soldCount
}

/**
 * Generate price statistics report.
 */
export function generateReport() {
    const report = {}

    // Overall stats
    report.totals = db.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold,
            SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired
        FROM listings
    `).get()

    // OpenClaw-specific stats (the main thing we care about)
    report.openclawTotals = db.prepare(`
        SELECT
            openclaw_status,
            COUNT(*) as total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold,
            SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired
        FROM listings
        WHERE openclaw_status != 'none'
        GROUP BY openclaw_status
    `).all()

    // OpenClaw preinstalled - sold prices (THE key data point)
    report.openclawPreinstalledSold = db.prepare(`
        SELECT finn_id, title, model, ram, storage, sold_price, estimated_sold_date, location,
               first_seen, listing_url
        FROM listings
        WHERE status = 'sold' AND openclaw_status = 'preinstalled' AND sold_price IS NOT NULL
        ORDER BY estimated_sold_date DESC
    `).all()

    // OpenClaw preinstalled - active listings (competitors)
    report.openclawPreinstalledActive = db.prepare(`
        SELECT finn_id, title, model, ram, storage, price, location, first_seen, listing_url
        FROM listings
        WHERE status = 'active' AND openclaw_status = 'preinstalled'
        ORDER BY price ASC
    `).all()

    // OpenClaw mentioned (just use case) - sold prices for comparison
    report.openclawMentionedSold = db.prepare(`
        SELECT finn_id, title, model, ram, storage, sold_price, estimated_sold_date, location
        FROM listings
        WHERE status = 'sold' AND openclaw_status = 'mentioned' AND sold_price IS NOT NULL
        ORDER BY estimated_sold_date DESC
        LIMIT 10
    `).all()

    // Plain Mac Mini sold prices (baseline for comparison)
    report.plainSoldByModel = db.prepare(`
        SELECT
            model,
            COUNT(*) as count,
            MIN(sold_price) as min_price,
            MAX(sold_price) as max_price,
            ROUND(AVG(sold_price)) as avg_price
        FROM listings
        WHERE status = 'sold' AND sold_price IS NOT NULL AND openclaw_status = 'none'
        GROUP BY model
        ORDER BY avg_price DESC
    `).all()

    // Active listings by model (all, for market context)
    report.activeByModel = db.prepare(`
        SELECT
            model,
            COUNT(*) as count,
            MIN(price) as min_price,
            MAX(price) as max_price,
            ROUND(AVG(price)) as avg_price
        FROM listings
        WHERE status = 'active' AND price IS NOT NULL
        GROUP BY model
        ORDER BY avg_price DESC
    `).all()

    // Scan history
    report.scanHistory = db.prepare(`
        SELECT * FROM scan_log ORDER BY scanned_at DESC LIMIT 10
    `).all()

    return report
}

/**
 * Format report as readable text.
 */
export function formatReport(report) {
    const lines = []
    const hr = '─'.repeat(60)

    lines.push('')
    lines.push('╔══════════════════════════════════════════════════════════╗')
    lines.push('║   MAC MINI + OPENCLAW PRISRAPPORT - FINN.NO            ║')
    lines.push('╚══════════════════════════════════════════════════════════╝')
    lines.push('')

    // === OPENCLAW PREINSTALLED - SOLD (the main data point) ===
    if (report.openclawPreinstalledSold.length > 0) {
        lines.push('💰 SOLGT MED OPENCLAW FERDIG INSTALLERT')
        lines.push(hr)
        for (const item of report.openclawPreinstalledSold) {
            const date = item.estimated_sold_date?.split('T')[0] || '?'
            const specs = [item.model, item.ram, item.storage].filter(Boolean).join(' / ')
            lines.push(`  ${date} | ${item.sold_price} kr | ${specs} | ${item.location || ''}`)
            lines.push(`    ${item.title}`)
        }
        const prices = report.openclawPreinstalledSold.map(i => i.sold_price).filter(Boolean)
        if (prices.length > 0) {
            const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
            const min = Math.min(...prices)
            const max = Math.max(...prices)
            lines.push(`  ${hr.substring(0, 40)}`)
            lines.push(`  Snitt: ${avg} kr | Min: ${min} kr | Maks: ${max} kr (${prices.length} stk)`)
        }
        lines.push('')
    } else {
        lines.push('💰 SOLGT MED OPENCLAW FERDIG INSTALLERT')
        lines.push(hr)
        lines.push('  Ingen data ennå. Trackeren trenger tid til å se annonser forsvinne.')
        lines.push('')
    }

    // === OPENCLAW PREINSTALLED - ACTIVE (your competitors) ===
    if (report.openclawPreinstalledActive.length > 0) {
        lines.push('🏷️  AKTIVE KONKURRENTER (OpenClaw installert)')
        lines.push(hr)
        for (const item of report.openclawPreinstalledActive) {
            const specs = [item.model, item.ram, item.storage].filter(Boolean).join(' / ')
            lines.push(`  ${item.price} kr | ${specs} | ${item.location || ''}`)
            lines.push(`    ${item.title}`)
        }
        lines.push('')
    }

    // === OPENCLAW MENTIONED - SOLD (comparison) ===
    if (report.openclawMentionedSold.length > 0) {
        lines.push('📌 SOLGT MED OPENCLAW BARE NEVNT (ikke installert)')
        lines.push(hr)
        for (const item of report.openclawMentionedSold) {
            const date = item.estimated_sold_date?.split('T')[0] || '?'
            const specs = [item.model, item.ram, item.storage].filter(Boolean).join(' / ')
            lines.push(`  ${date} | ${item.sold_price} kr | ${specs}`)
            lines.push(`    ${item.title}`)
        }
        lines.push('')
    }

    // === PLAIN MAC MINI BASELINE ===
    if (report.plainSoldByModel.length > 0) {
        lines.push('📊 BASELINE: Vanlig Mac Mini (uten OpenClaw) - solgt')
        lines.push(hr)
        for (const row of report.plainSoldByModel) {
            lines.push(`  ${row.model}: ${row.count} solgt, snitt ${row.avg_price} kr (${row.min_price}–${row.max_price} kr)`)
        }
        lines.push('')

        // Calculate premium if we have both data points
        if (report.openclawPreinstalledSold.length > 0) {
            lines.push('💡 OPENCLAW-PREMIE')
            lines.push(hr)
            const ocPrices = report.openclawPreinstalledSold.map(i => i.sold_price).filter(Boolean)
            const ocAvg = Math.round(ocPrices.reduce((a, b) => a + b, 0) / ocPrices.length)
            for (const baseline of report.plainSoldByModel) {
                const premium = ocAvg - baseline.avg_price
                const pct = Math.round((premium / baseline.avg_price) * 100)
                lines.push(`  vs. ${baseline.model} vanlig: +${premium} kr (+${pct}%)`)
            }
            lines.push('')
        }
    }

    // === OVERALL STATS ===
    const t = report.totals
    lines.push('📈 TOTALOVERSIKT')
    lines.push(hr)
    lines.push(`  Sporede annonser: ${t.total} | Aktive: ${t.active} | Solgt: ${t.sold} | Utløpt: ${t.expired}`)
    for (const oc of report.openclawTotals) {
        const label = oc.openclaw_status === 'preinstalled' ? 'OpenClaw installert' : 'OpenClaw nevnt'
        lines.push(`  ${label}: ${oc.total} totalt (${oc.active} aktive, ${oc.sold} solgt)`)
    }
    lines.push('')

    // Scan history
    if (report.scanHistory.length > 0) {
        lines.push('🔍 SISTE SKANNINGER')
        lines.push(hr)
        for (const scan of report.scanHistory) {
            const date = scan.scanned_at?.split('T')[0] || '?'
            const time = scan.scanned_at?.split('T')[1]?.substring(0, 5) || ''
            lines.push(`  ${date} ${time} | ${scan.listings_found} funnet | ${scan.new_listings} nye | ${scan.price_changes} prisendringer | ${scan.newly_sold} solgt`)
        }
    }

    lines.push('')
    return lines.join('\n')
}
