import puppeteer from 'puppeteer'

const FINN_SEARCH_URL = 'https://www.finn.no/recommerce/forsale/search'
const MAX_PAGES = 10

// We run two searches: one broad for all Mac Minis, one targeted for OpenClaw.
// This ensures we catch OpenClaw listings even if they don't say "Mac Mini" in the title.
const SEARCHES = [
    { query: 'mac mini', label: 'Mac Mini (alle)' },
    { query: 'mac mini openclaw', label: 'Mac Mini + OpenClaw' },
    { query: 'mac mini clawdbot', label: 'Mac Mini + Clawdbot' },
    { query: 'openclaw', label: 'OpenClaw (alle)' },
]

const OPENCLAW_KEYWORDS = ['openclaw', 'open claw', 'clawdbot', 'moltbot', 'claw bot']

// Phrases that indicate OpenClaw is actually installed/configured on the machine
const OPENCLAW_INSTALLED_PATTERNS = [
    /openclaw\s*(er\s*)?(ferdig\s*)?(installert|konfigurert|satt opp|oppsatt|kjører|klar)/i,
    /installert\s*(med\s*)?openclaw/i,
    /konfigurert\s*(med\s*)?openclaw/i,
    /openclaw\s*(pre[- ]?)?install/i,
    /openclaw\s*ready/i,
    /med\s*openclaw/i,
    /openclaw\s*inkludert/i,
    /clawdbot\s*(er\s*)?(ferdig\s*)?(installert|konfigurert|satt opp|oppsatt)/i,
    /installert\s*(med\s*)?clawdbot/i,
]

// Phrases that indicate OpenClaw is just mentioned as a use case
const OPENCLAW_USECASE_PATTERNS = [
    /perfekt\s*(for|til)\s*(openclaw|clawdbot)/i,
    /ideell?\s*(for|til)\s*(openclaw|clawdbot)/i,
    /egnet\s*(for|til)\s*(openclaw|clawdbot)/i,
    /kan\s*kjøre\s*(openclaw|clawdbot)/i,
    /passer?\s*(for|til)\s*(openclaw|clawdbot)/i,
    /bruk(es?)?\s*(til|for|med)\s*(openclaw|clawdbot)/i,
]

/**
 * Parse Mac Mini model from title/description text.
 * Returns e.g. "M4", "M2", "M1", "Intel i3", etc.
 */
function parseModel(text) {
    const lower = text.toLowerCase()
    if (lower.includes('m4 pro')) return 'M4 Pro'
    if (lower.includes('m4')) return 'M4'
    if (lower.includes('m2 pro')) return 'M2 Pro'
    if (lower.includes('m2')) return 'M2'
    if (lower.includes('m1')) return 'M1'
    if (lower.includes('i7')) return 'Intel i7'
    if (lower.includes('i5')) return 'Intel i5'
    if (lower.includes('i3')) return 'Intel i3'
    return 'Ukjent'
}

/**
 * Parse RAM from text. Returns e.g. "16GB", "8GB", etc.
 */
function parseRam(text) {
    const match = text.match(/(\d+)\s*gb\s*(ram|minne|unified|felles)/i)
        || text.match(/(ram|minne|unified|felles)\s*(\d+)\s*gb/i)
        || text.match(/(\d+)\s*gb/i)
    if (match) {
        const gb = parseInt(match[1] || match[2])
        if ([8, 16, 24, 32, 36, 48, 64, 96, 128].includes(gb)) return `${gb}GB`
    }
    return null
}

/**
 * Parse storage from text. Returns e.g. "256GB", "1TB", etc.
 */
function parseStorage(text) {
    const tbMatch = text.match(/(\d+)\s*tb\s*(ssd)?/i)
    if (tbMatch) return `${tbMatch[1]}TB`

    const gbMatch = text.match(/(\d+)\s*gb\s*ssd/i)
    if (gbMatch) return `${gbMatch[1]}GB`

    // Try standalone common SSD sizes
    const sizes = text.match(/(256|512|1024)\s*gb/i)
    if (sizes) return `${sizes[1]}GB`

    return null
}

/**
 * Parse price from price text. Returns integer or null.
 */
function parsePrice(priceText) {
    if (!priceText) return null
    const cleaned = priceText.replace(/[^0-9]/g, '')
    const num = parseInt(cleaned)
    if (isNaN(num) || num < 100 || num > 200000) return null
    return num
}

/**
 * Classify how OpenClaw is mentioned in listing text.
 * Returns: 'preinstalled' | 'mentioned' | 'none'
 *
 * 'preinstalled' = the ad says OpenClaw is installed/configured on the machine
 * 'mentioned'    = OpenClaw is named but only as a use case / selling point
 * 'none'         = no mention of OpenClaw
 */
function classifyOpenClaw(text) {
    // Check for installed/configured first (strongest signal)
    for (const pattern of OPENCLAW_INSTALLED_PATTERNS) {
        if (pattern.test(text)) return 'preinstalled'
    }

    // Check for use-case mentions
    for (const pattern of OPENCLAW_USECASE_PATTERNS) {
        if (pattern.test(text)) return 'mentioned'
    }

    // Fallback: any keyword mention at all = 'mentioned'
    const lower = text.toLowerCase()
    if (OPENCLAW_KEYWORDS.some(kw => lower.includes(kw))) return 'mentioned'

    return 'none'
}

/**
 * Scrape a single search results page and return raw listing data.
 */
async function scrapeSearchPage(page, url) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

    try {
        await page.waitForSelector('article, [data-testid="ad-list-item"], .ads__unit', { timeout: 10000 })
    } catch {
        return []
    }

    return page.evaluate(() => {
        const results = []
        const articles = document.querySelectorAll(
            'article, [data-testid="ad-list-item"], .ads__unit'
        )

        for (const article of articles) {
            const link = article.querySelector('a[href*="/item/"], a[href*="/ad.html"]')
            if (!link) continue

            const href = link.href || ''
            const finnIdMatch = href.match(/\/item\/(\d+)/) || href.match(/finnkode=(\d+)/)
            if (!finnIdMatch) continue

            const titleEl = article.querySelector('h2, h3, [class*="heading"], [class*="title"]')
            const priceEl = article.querySelector('[class*="price"], [data-testid*="price"]')
            const locationEl = article.querySelector('[class*="location"], [class*="detail"]')

            results.push({
                finnId: finnIdMatch[1],
                title: titleEl?.textContent?.trim() || '',
                priceText: priceEl?.textContent?.trim() || '',
                location: locationEl?.textContent?.trim() || '',
                fullText: article.textContent || '',
                url: href
            })
        }
        return results
    })
}

/**
 * Fetch individual listing page to get full description (for OpenClaw detection).
 */
async function scrapeListingDetail(page, url) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 })
        return page.evaluate(() => document.body?.innerText || '')
    } catch {
        return ''
    }
}

/**
 * Scrape all Mac Mini listings from Finn.no.
 * Runs multiple searches to catch OpenClaw-specific listings.
 * Then visits each listing page to check description for OpenClaw mentions.
 */
export async function scrapeListings({ deepScan = true } = {}) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    })

    const allRaw = []

    try {
        const page = await browser.newPage()
        await page.setUserAgent(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        )

        // Run all search queries
        for (const search of SEARCHES) {
            console.log(`\n🔍 Søker: "${search.label}"`)

            for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
                const url = `${FINN_SEARCH_URL}?q=${encodeURIComponent(search.query)}&page=${pageNum}`
                console.log(`  Side ${pageNum}...`)

                const listings = await scrapeSearchPage(page, url)

                if (listings.length === 0) {
                    console.log(`  Ingen flere resultater`)
                    break
                }

                allRaw.push(...listings)
                console.log(`  ${listings.length} annonser`)

                if (pageNum < MAX_PAGES) {
                    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500))
                }
            }
        }

        // Deduplicate by finnId
        const seen = new Map()
        for (const raw of allRaw) {
            if (!seen.has(raw.finnId)) {
                seen.set(raw.finnId, raw)
            }
        }
        const uniqueRaw = [...seen.values()]
        console.log(`\n📊 ${uniqueRaw.length} unike annonser funnet totalt`)

        // Parse listings
        const listings = uniqueRaw.map(raw => {
            const combined = `${raw.title} ${raw.fullText}`
            return {
                finnId: raw.finnId,
                title: raw.title,
                price: parsePrice(raw.priceText),
                model: parseModel(combined),
                ram: parseRam(combined),
                storage: parseStorage(combined),
                location: raw.location,
                url: raw.url,
                openclawStatus: classifyOpenClaw(combined),
                description: ''
            }
        })

        // Deep scan: visit each listing page to get full description
        // Only check listings where we haven't already found OpenClaw in the summary
        if (deepScan) {
            const needsScan = listings.filter(l => l.openclawStatus === 'none')
            console.log(`\n🔎 Dyp-skanner ${needsScan.length} annonser for OpenClaw-omtale i beskrivelsen...`)

            for (let i = 0; i < needsScan.length; i++) {
                const listing = needsScan[i]
                if ((i + 1) % 10 === 0) {
                    console.log(`  ${i + 1}/${needsScan.length}...`)
                }

                const bodyText = await scrapeListingDetail(page, listing.url)
                listing.description = bodyText.substring(0, 2000)

                const status = classifyOpenClaw(bodyText)
                if (status !== 'none') {
                    listing.openclawStatus = status
                    const label = status === 'preinstalled' ? 'INSTALLERT' : 'nevnt'
                    console.log(`  ✅ OpenClaw ${label}: "${listing.title}"`)
                }

                await new Promise(r => setTimeout(r, 800 + Math.random() * 1200))
            }
        }

        const preinstalled = listings.filter(l => l.openclawStatus === 'preinstalled').length
        const mentioned = listings.filter(l => l.openclawStatus === 'mentioned').length
        console.log(`\n📋 Resultat: ${listings.length} annonser`)
        console.log(`   ${preinstalled} med OpenClaw installert, ${mentioned} nevner OpenClaw som bruksområde`)

        return listings

    } finally {
        await browser.close()
    }
}
