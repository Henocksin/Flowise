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
        INSERT INTO listings (finn_id, title, price, model, ram, storage, condition, location, listing_url, first_seen, last_seen, listing_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `)

    const updateListing = db.prepare(`
        UPDATE listings SET title = ?, price = ?, last_seen = ?, status = 'active',
        model = COALESCE(?, model), ram = COALESCE(?, ram), storage = COALESCE(?, storage),
        location = COALESCE(?, location)
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
                    now, now, now
                )
                if (listing.price) {
                    insertPrice.run(listing.finnId, listing.price, now)
                }
                newCount++
            } else {
                // Update existing
                updateListing.run(
                    listing.title, listing.price, now,
                    listing.model, listing.ram, listing.storage,
                    listing.location, listing.finnId
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

    // Sold prices by model
    report.soldByModel = db.prepare(`
        SELECT
            model,
            COUNT(*) as count,
            MIN(sold_price) as min_price,
            MAX(sold_price) as max_price,
            ROUND(AVG(sold_price)) as avg_price,
            -- Approximate median using percentile
            sold_price as median_price
        FROM listings
        WHERE status = 'sold' AND sold_price IS NOT NULL
        GROUP BY model
        ORDER BY avg_price DESC
    `).all()

    // Active listings by model
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

    // Recent sold items
    report.recentSold = db.prepare(`
        SELECT finn_id, title, model, ram, storage, sold_price, estimated_sold_date, location
        FROM listings
        WHERE status = 'sold'
        ORDER BY estimated_sold_date DESC
        LIMIT 20
    `).all()

    // Listings with price drops (potential deals)
    report.priceDrops = db.prepare(`
        SELECT l.finn_id, l.title, l.model, l.price as current_price, l.location,
            (SELECT ph.price FROM price_history ph WHERE ph.finn_id = l.finn_id ORDER BY ph.observed_at ASC LIMIT 1) as original_price
        FROM listings l
        WHERE l.status = 'active'
        AND l.price < (SELECT ph.price FROM price_history ph WHERE ph.finn_id = l.finn_id ORDER BY ph.observed_at ASC LIMIT 1)
        ORDER BY (
            (SELECT ph.price FROM price_history ph WHERE ph.finn_id = l.finn_id ORDER BY ph.observed_at ASC LIMIT 1) - l.price
        ) DESC
        LIMIT 15
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
    lines.push('║        MAC MINI PRISRAPPORT - FINN.NO                  ║')
    lines.push('╚══════════════════════════════════════════════════════════╝')
    lines.push('')

    // Totals
    const t = report.totals
    lines.push(`📊 OVERSIKT`)
    lines.push(hr)
    lines.push(`  Totalt sporet:    ${t.total} annonser`)
    lines.push(`  Aktive:           ${t.active}`)
    lines.push(`  Antatt solgt:     ${t.sold}`)
    lines.push(`  Utløpt (>60d):    ${t.expired}`)
    lines.push('')

    // Sold by model
    if (report.soldByModel.length > 0) {
        lines.push(`💰 FAKTISKE SALGSPRISER (antatt) per modell`)
        lines.push(hr)
        for (const row of report.soldByModel) {
            lines.push(`  ${row.model}:`)
            lines.push(`    Antall solgt: ${row.count}`)
            lines.push(`    Snitt:  ${row.avg_price} kr`)
            lines.push(`    Min:    ${row.min_price} kr`)
            lines.push(`    Maks:   ${row.max_price} kr`)
        }
        lines.push('')
    }

    // Active by model
    if (report.activeByModel.length > 0) {
        lines.push(`📋 AKTIVE ANNONSER per modell`)
        lines.push(hr)
        for (const row of report.activeByModel) {
            lines.push(`  ${row.model}: ${row.count} stk, snitt ${row.avg_price} kr (${row.min_price}–${row.max_price} kr)`)
        }
        lines.push('')
    }

    // Recent sold
    if (report.recentSold.length > 0) {
        lines.push(`✅ SISTE SOLGTE`)
        lines.push(hr)
        for (const item of report.recentSold) {
            const date = item.estimated_sold_date?.split('T')[0] || '?'
            const specs = [item.model, item.ram, item.storage].filter(Boolean).join(' / ')
            lines.push(`  ${date} | ${item.sold_price} kr | ${specs}`)
            lines.push(`    ${item.title}`)
        }
        lines.push('')
    }

    // Price drops
    if (report.priceDrops.length > 0) {
        lines.push(`📉 PRISNEDSETTELSER (mulige kupp)`)
        lines.push(hr)
        for (const item of report.priceDrops) {
            const drop = item.original_price - item.current_price
            const pct = Math.round((drop / item.original_price) * 100)
            lines.push(`  ${item.title}`)
            lines.push(`    ${item.original_price} → ${item.current_price} kr (-${drop} kr / -${pct}%)`)
        }
        lines.push('')
    }

    // Scan history
    if (report.scanHistory.length > 0) {
        lines.push(`🔍 SISTE SKANNINGER`)
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
