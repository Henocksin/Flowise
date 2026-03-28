import puppeteer from 'puppeteer'

const FINN_SEARCH_URL = 'https://www.finn.no/recommerce/forsale/search'
const SEARCH_QUERY = 'mac mini'
const MAX_PAGES = 10

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
 * Scrape all Mac Mini listings from Finn.no.
 * Uses Puppeteer to bypass anti-bot protection.
 */
export async function scrapeListings() {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    })

    const allListings = []

    try {
        const page = await browser.newPage()
        await page.setUserAgent(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        )

        for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
            const url = `${FINN_SEARCH_URL}?q=${encodeURIComponent(SEARCH_QUERY)}&page=${pageNum}`
            console.log(`  Henter side ${pageNum}: ${url}`)

            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

            // Wait for listings to appear
            try {
                await page.waitForSelector('article, [data-testid="ad-list-item"], .ads__unit', { timeout: 10000 })
            } catch {
                console.log(`  Ingen flere resultater på side ${pageNum}`)
                break
            }

            // Extract listing data from the page
            const listings = await page.evaluate(() => {
                const results = []

                // Try multiple selectors - Finn.no changes their markup
                const articles = document.querySelectorAll(
                    'article, [data-testid="ad-list-item"], .ads__unit'
                )

                for (const article of articles) {
                    // Find the link
                    const link = article.querySelector('a[href*="/item/"], a[href*="/ad.html"]')
                    if (!link) continue

                    const href = link.href || ''
                    const finnIdMatch = href.match(/\/item\/(\d+)/) || href.match(/finnkode=(\d+)/)
                    if (!finnIdMatch) continue

                    // Title
                    const titleEl = article.querySelector('h2, h3, [class*="heading"], [class*="title"]')
                    const title = titleEl?.textContent?.trim() || ''

                    // Price
                    const priceEl = article.querySelector('[class*="price"], [data-testid*="price"]')
                    const priceText = priceEl?.textContent?.trim() || ''

                    // Location
                    const locationEl = article.querySelector('[class*="location"], [class*="detail"]')
                    const location = locationEl?.textContent?.trim() || ''

                    // All text for parsing specs
                    const fullText = article.textContent || ''

                    results.push({
                        finnId: finnIdMatch[1],
                        title,
                        priceText,
                        location,
                        fullText,
                        url: href
                    })
                }
                return results
            })

            if (listings.length === 0) {
                console.log(`  Ingen annonser funnet på side ${pageNum}, stopper`)
                break
            }

            // Parse and enrich listings
            for (const raw of listings) {
                const combined = `${raw.title} ${raw.fullText}`
                allListings.push({
                    finnId: raw.finnId,
                    title: raw.title,
                    price: parsePrice(raw.priceText),
                    model: parseModel(combined),
                    ram: parseRam(combined),
                    storage: parseStorage(combined),
                    location: raw.location,
                    url: raw.url
                })
            }

            console.log(`  Fant ${listings.length} annonser på side ${pageNum}`)

            // Small delay between pages
            if (pageNum < MAX_PAGES) {
                await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000))
            }
        }
    } finally {
        await browser.close()
    }

    // Deduplicate by finnId
    const seen = new Set()
    const unique = []
    for (const listing of allListings) {
        if (!seen.has(listing.finnId)) {
            seen.add(listing.finnId)
            unique.push(listing)
        }
    }

    console.log(`\nTotalt ${unique.length} unike annonser funnet`)
    return unique
}
