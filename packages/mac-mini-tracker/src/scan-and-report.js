#!/usr/bin/env node

/**
 * Automated weekly scanner for Mac Mini + OpenClaw listings on Finn.no.
 * Runs in GitHub Actions - uses Google Custom Search API to find listings
 * and posts results as a PR comment via GitHub API.
 *
 * Fallback: If no Google API key, uses Puppeteer headless scraping.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HISTORY_FILE = join(__dirname, '..', 'data', 'price-history.json')

// --- Config ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const PR_NUMBER = process.env.PR_NUMBER || '1'
const REPO_OWNER = process.env.REPO_OWNER || 'henocksin'
const REPO_NAME = process.env.REPO_NAME || 'flowise'

// --- History management ---

function loadHistory() {
    if (existsSync(HISTORY_FILE)) {
        return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'))
    }
    return { listings: {}, reports: [], lastScan: null }
}

function saveHistory(history) {
    writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8')
}

// --- Finn.no scraping via Puppeteer ---

async function scrapeFinn() {
    let puppeteer
    try {
        puppeteer = await import('puppeteer')
    } catch {
        console.log('Puppeteer ikke tilgjengelig, bruker enkel HTTP-fallback')
        return scrapeFinnSimple()
    }

    const browser = await puppeteer.default.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    })

    const allListings = []

    try {
        const page = await browser.newPage()
        await page.setUserAgent(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        )

        const searches = [
            'mac mini openclaw',
            'mac mini clawdbot',
            'mac mini',
        ]

        for (const query of searches) {
            for (let pageNum = 1; pageNum <= 5; pageNum++) {
                const url = `https://www.finn.no/recommerce/forsale/search?q=${encodeURIComponent(query)}&page=${pageNum}`
                console.log(`Henter: ${url}`)

                try {
                    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
                    await page.waitForSelector('article, [data-testid="ad-list-item"]', { timeout: 8000 })
                } catch {
                    break
                }

                const listings = await page.evaluate(() => {
                    const results = []
                    const articles = document.querySelectorAll('article, [data-testid="ad-list-item"], .ads__unit')

                    for (const article of articles) {
                        const link = article.querySelector('a[href*="/item/"]')
                        if (!link) continue

                        const href = link.href || ''
                        const idMatch = href.match(/\/item\/(\d+)/)
                        if (!idMatch) continue

                        const titleEl = article.querySelector('h2, h3, [class*="heading"], [class*="title"]')
                        const priceEl = article.querySelector('[class*="price"], [data-testid*="price"]')
                        const locationEl = article.querySelector('[class*="location"], [class*="detail"]')

                        results.push({
                            finnId: idMatch[1],
                            title: titleEl?.textContent?.trim() || '',
                            priceText: priceEl?.textContent?.trim() || '',
                            location: locationEl?.textContent?.trim() || '',
                            fullText: article.textContent || '',
                            url: href
                        })
                    }
                    return results
                })

                if (listings.length === 0) break
                allListings.push(...listings)

                await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000))
            }
        }

        // Deep scan: check each listing for OpenClaw in description
        const seen = new Map()
        for (const l of allListings) {
            if (!seen.has(l.finnId)) seen.set(l.finnId, l)
        }
        const unique = [...seen.values()]

        console.log(`${unique.length} unike annonser. Sjekker beskrivelser...`)

        for (let i = 0; i < unique.length; i++) {
            const listing = unique[i]
            try {
                await page.goto(listing.url, { waitUntil: 'networkidle2', timeout: 15000 })
                listing.description = await page.evaluate(() => document.body?.innerText?.substring(0, 3000) || '')
            } catch {
                listing.description = ''
            }
            if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${unique.length}...`)
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000))
        }

        return unique

    } finally {
        await browser.close()
    }
}

// Simple HTTP fallback (may get 403)
async function scrapeFinnSimple() {
    console.log('Enkel HTTP-modus (kan bli blokkert av Finn.no)')
    const results = []
    const queries = ['mac+mini+openclaw', 'mac+mini+clawdbot', 'mac+mini']

    for (const q of queries) {
        try {
            const res = await fetch(`https://www.finn.no/recommerce/forsale/search?q=${q}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                }
            })
            if (res.ok) {
                const html = await res.text()
                // Basic regex extraction of listing IDs and titles
                const matches = html.matchAll(/\/item\/(\d+).*?<[^>]*>([^<]+)</g)
                for (const m of matches) {
                    results.push({ finnId: m[1], title: m[2].trim(), priceText: '', location: '', fullText: '', description: '', url: `https://www.finn.no/recommerce/forsale/item/${m[1]}` })
                }
            }
        } catch (e) {
            console.log(`Feil ved henting av ${q}: ${e.message}`)
        }
    }
    return results
}

// --- Classification ---

const OPENCLAW_KEYWORDS = ['openclaw', 'open claw', 'clawdbot', 'moltbot']

const INSTALLED_PATTERNS = [
    /openclaw\s*(er\s*)?(ferdig\s*)?(installert|konfigurert|satt opp|oppsatt|kjører|klar)/i,
    /installert\s*(med\s*)?openclaw/i,
    /med\s*openclaw\s*(installert|konfigurert|oppsatt)/i,
    /openclaw\s*(pre[- ]?)?install/i,
    /openclaw\s*ready/i,
    /clawdbot\s*(er\s*)?(ferdig\s*)?(installert|konfigurert|satt opp)/i,
]

const USECASE_PATTERNS = [
    /perfekt\s*(for|til)\s*(openclaw|clawdbot)/i,
    /ideell?\s*(for|til)\s*(openclaw|clawdbot)/i,
    /kan\s*kjøre\s*(openclaw|clawdbot)/i,
    /passer?\s*(for|til)\s*(openclaw|clawdbot)/i,
]

function classifyOpenClaw(text) {
    for (const p of INSTALLED_PATTERNS) {
        if (p.test(text)) return 'preinstalled'
    }
    for (const p of USECASE_PATTERNS) {
        if (p.test(text)) return 'mentioned'
    }
    const lower = text.toLowerCase()
    if (OPENCLAW_KEYWORDS.some(kw => lower.includes(kw))) return 'mentioned'
    return 'none'
}

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

function parsePrice(text) {
    if (!text) return null
    const cleaned = text.replace(/[^0-9]/g, '')
    const num = parseInt(cleaned)
    if (isNaN(num) || num < 100 || num > 200000) return null
    return num
}

function parseRam(text) {
    const match = text.match(/(\d+)\s*gb\s*(ram|minne|unified|felles)/i) || text.match(/(\d+)\s*gb/i)
    if (match) {
        const gb = parseInt(match[1])
        if ([8, 16, 24, 32, 48, 64, 96, 128].includes(gb)) return `${gb}GB`
    }
    return null
}

function parseStorage(text) {
    const tb = text.match(/(\d+)\s*tb/i)
    if (tb) return `${tb[1]}TB`
    const gb = text.match(/(\d+)\s*gb\s*ssd/i) || text.match(/(256|512|1024)\s*gb/i)
    if (gb) return `${gb[1]}GB`
    return null
}

// --- Report generation ---

function generateReport(listings, history) {
    const now = new Date()
    const dateStr = now.toISOString().split('T')[0]
    const reportNum = (history.reports?.length || 0) + 1

    // Process listings
    const processed = listings.map(l => {
        const combined = `${l.title} ${l.fullText || ''} ${l.description || ''}`
        return {
            finnId: l.finnId,
            title: l.title,
            price: parsePrice(l.priceText),
            model: parseModel(combined),
            ram: parseRam(combined),
            storage: parseStorage(combined),
            location: l.location,
            url: l.url,
            openclawStatus: classifyOpenClaw(combined),
            firstSeen: history.listings[l.finnId]?.firstSeen || dateStr,
            lastSeen: dateStr
        }
    })

    // Detect disappeared listings (likely sold)
    const currentIds = new Set(processed.map(l => l.finnId))
    const disappeared = []
    for (const [finnId, prev] of Object.entries(history.listings)) {
        if (prev.status === 'active' && !currentIds.has(finnId)) {
            const firstSeen = new Date(prev.firstSeen)
            const daysSince = (now - firstSeen) / (1000 * 60 * 60 * 24)
            if (daysSince < 60) {
                disappeared.push({ ...prev, status: 'sold', soldDate: dateStr })
            } else {
                disappeared.push({ ...prev, status: 'expired' })
            }
        }
    }

    // Update history
    for (const l of processed) {
        history.listings[l.finnId] = { ...l, status: 'active' }
    }
    for (const d of disappeared) {
        history.listings[d.finnId] = d
    }

    // Build report
    const preinstalled = processed.filter(l => l.openclawStatus === 'preinstalled')
    const mentioned = processed.filter(l => l.openclawStatus === 'mentioned')
    const soldOpenClaw = disappeared.filter(d => d.status === 'sold' && d.openclawStatus !== 'none')
    const soldPlain = disappeared.filter(d => d.status === 'sold' && d.openclawStatus === 'none')

    // New since last scan
    const prevIds = new Set(Object.keys(history.listings).filter(id => {
        const entry = history.listings[id]
        return entry.firstSeen !== dateStr
    }))
    const newListings = processed.filter(l => !prevIds.has(l.finnId))

    // Price by model
    const modelPrices = {}
    for (const l of processed) {
        if (!l.price) continue
        if (!modelPrices[l.model]) modelPrices[l.model] = []
        modelPrices[l.model].push(l.price)
    }

    // All-time sold with OpenClaw
    const allSoldOC = Object.values(history.listings).filter(
        l => l.status === 'sold' && l.openclawStatus !== 'none' && l.price
    )

    // Format next monday
    const nextMonday = new Date(now)
    nextMonday.setDate(now.getDate() + (8 - now.getDay()) % 7 || 7)
    const nextDate = nextMonday.toISOString().split('T')[0]

    let md = `## 📊 Prisrapport #${reportNum} - ${dateStr}\n\n`

    md += `### OpenClaw-annonser\n`
    md += `| Status | Antall |\n|---|---|\n`
    md += `| 🟢 OpenClaw installert | **${preinstalled.length}** |\n`
    md += `| 🟡 OpenClaw nevnt | **${mentioned.length}** |\n`
    md += `| ⚪ Vanlig Mac Mini | **${processed.length - preinstalled.length - mentioned.length}** |\n\n`

    if (preinstalled.length > 0) {
        md += `#### 🟢 Annonser med OpenClaw installert\n`
        md += `| Tittel | Pris | Modell | Sted |\n|---|---|---|---|\n`
        for (const l of preinstalled) {
            md += `| ${l.title} | ${l.price ? l.price + ' kr' : '?'} | ${l.model} | ${l.location || '?'} |\n`
        }
        md += '\n'
    }

    if (mentioned.length > 0) {
        md += `#### 🟡 Annonser som nevner OpenClaw\n`
        md += `| Tittel | Pris | Modell | Sted |\n|---|---|---|---|\n`
        for (const l of mentioned) {
            md += `| ${l.title} | ${l.price ? l.price + ' kr' : '?'} | ${l.model} | ${l.location || '?'} |\n`
        }
        md += '\n'
    }

    if (soldOpenClaw.length > 0) {
        md += `#### ✅ Antatt solgt denne uken (OpenClaw-relatert)\n`
        md += `| Tittel | Siste pris | Modell |\n|---|---|---|\n`
        for (const l of soldOpenClaw) {
            md += `| ${l.title} | ${l.price ? l.price + ' kr' : '?'} | ${l.model} |\n`
        }
        md += '\n'
    }

    if (allSoldOC.length > 0) {
        const prices = allSoldOC.map(l => l.price)
        const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
        md += `#### 💰 Historiske salgspriser (OpenClaw)\n`
        md += `Totalt ${allSoldOC.length} solgt | Snitt: ${avg} kr | Min: ${Math.min(...prices)} kr | Maks: ${Math.max(...prices)} kr\n\n`
    }

    md += `### Prisoversikt per modell (alle aktive)\n`
    md += `| Modell | Antall | Snitt | Min | Maks |\n|---|---|---|---|---|\n`
    for (const [model, prices] of Object.entries(modelPrices).sort((a, b) => b[1].length - a[1].length)) {
        const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
        md += `| ${model} | ${prices.length} | ${avg} kr | ${Math.min(...prices)} kr | ${Math.max(...prices)} kr |\n`
    }
    md += '\n'

    if (soldPlain.length > 0) {
        md += `### Antatt solgt denne uken (vanlig Mac Mini)\n`
        md += `${soldPlain.length} annonser forsvunnet\n\n`
    }

    if (newListings.length > 0 && newListings.length <= 20) {
        md += `### Nye annonser siden sist\n`
        md += `${newListings.length} nye annonser registrert\n\n`
    }

    md += `---\n`
    md += `*Totalt ${processed.length} aktive annonser | ${Object.values(history.listings).filter(l => l.status === 'sold').length} antatt solgt totalt*\n`
    md += `*Neste rapport: mandag ${nextDate}*\n`

    return { markdown: md, history }
}

// --- GitHub API ---

async function postComment(markdown) {
    if (!GITHUB_TOKEN) {
        console.log('Ingen GITHUB_TOKEN - skriver rapport til stdout:')
        console.log(markdown)
        return
    }

    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${PR_NUMBER}/comments`
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ body: markdown })
    })

    if (!res.ok) {
        throw new Error(`GitHub API feil: ${res.status} ${await res.text()}`)
    }

    const data = await res.json()
    console.log(`Kommentar postet: ${data.html_url}`)
}

// --- Main ---

async function main() {
    console.log('🔄 Starter ukentlig prisskanning...\n')

    const history = loadHistory()

    console.log('📡 Henter annonser fra Finn.no...')
    const listings = await scrapeFinn()
    console.log(`\n${listings.length} annonser hentet`)

    console.log('\n📊 Genererer rapport...')
    const { markdown, history: updatedHistory } = generateReport(listings, history)

    console.log('\n💾 Lagrer historikk...')
    updatedHistory.lastScan = new Date().toISOString()
    updatedHistory.reports.push({ date: new Date().toISOString().split('T')[0], listingsFound: listings.length })
    saveHistory(updatedHistory)

    console.log('\n📮 Poster til GitHub...')
    await postComment(markdown)

    console.log('\n✅ Ferdig!')
}

main().catch(err => {
    console.error('Feil:', err)
    process.exit(1)
})
