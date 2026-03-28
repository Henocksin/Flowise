import { createTransport } from 'nodemailer'
import { generateReport, formatReport } from './tracker.js'

/**
 * Load email config from environment variables.
 * Supports any SMTP provider (Gmail, Outlook, Fastmail, self-hosted, etc.)
 *
 * Required env vars:
 *   SMTP_HOST     - e.g. smtp.gmail.com
 *   SMTP_PORT     - e.g. 587
 *   SMTP_USER     - your email address
 *   SMTP_PASS     - app password (not your regular password)
 *   MAIL_TO       - recipient email address
 *
 * Optional:
 *   SMTP_SECURE   - "true" for port 465, default "false" (uses STARTTLS)
 *   MAIL_FROM     - sender address, defaults to SMTP_USER
 */
function getConfig() {
    const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_TO']
    const missing = required.filter(k => !process.env[k])

    if (missing.length > 0) {
        throw new Error(
            `Mangler e-postkonfigurasjon. Sett disse miljovariablene:\n` +
            missing.map(k => `  ${k}`).join('\n') +
            `\n\nEksempel (.env fil):\n` +
            `  SMTP_HOST=smtp.gmail.com\n` +
            `  SMTP_PORT=587\n` +
            `  SMTP_USER=deg@gmail.com\n` +
            `  SMTP_PASS=xxxx-xxxx-xxxx-xxxx\n` +
            `  MAIL_TO=deg@gmail.com\n` +
            `\nFor Gmail: bruk et "App Password" (https://myaccount.google.com/apppasswords)`
        )
    }

    return {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT),
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: process.env.MAIL_TO
    }
}

/**
 * Convert the plain text report to a simple HTML email.
 */
function reportToHtml(textReport) {
    const escaped = textReport
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: monospace; font-size: 14px; background: #f5f5f5; padding: 20px;">
  <div style="max-width: 700px; margin: 0 auto; background: white; padding: 24px; border-radius: 8px; border: 1px solid #ddd;">
    <pre style="white-space: pre-wrap; word-wrap: break-word; margin: 0;">${escaped}</pre>
  </div>
  <p style="text-align: center; color: #999; font-size: 12px; margin-top: 16px;">
    Mac Mini OpenClaw Pristracker - automatisk ukentlig rapport
  </p>
</body>
</html>`
}

/**
 * Send the weekly price report via email.
 */
export async function sendWeeklyReport() {
    const config = getConfig()

    const report = generateReport()
    const textReport = formatReport(report)
    const html = reportToHtml(textReport)

    const date = new Date().toISOString().split('T')[0]

    const transporter = createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.pass
        }
    })

    const info = await transporter.sendMail({
        from: `"Mac Mini Tracker" <${config.from}>`,
        to: config.to,
        subject: `Mac Mini OpenClaw prisrapport - ${date}`,
        text: textReport,
        html: html
    })

    console.log(`E-post sendt til ${config.to} (${info.messageId})`)
    return info
}

/**
 * Send a test email to verify SMTP config.
 */
export async function sendTestEmail() {
    const config = getConfig()

    const transporter = createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.pass
        }
    })

    const info = await transporter.sendMail({
        from: `"Mac Mini Tracker" <${config.from}>`,
        to: config.to,
        subject: 'Mac Mini Tracker - Test',
        text: 'E-post fungerer! Du vil motta ukentlige prisrapporter her.'
    })

    console.log(`Test-epost sendt til ${config.to} (${info.messageId})`)
    return info
}
