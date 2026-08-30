import { webcrypto } from "crypto"
import axios from "axios"
import { getScrapeResult } from "./scrape.js"
import { StashApp } from "./stash-app.js"
import { jobResult } from "../types/jobResult.js"
import { installedPackage } from "../types/stashapp.js"

// comma-separated Discord role IDs allowed to run commands; fails closed if unset
const ALLOWED_ROLES = (process.env.DISCORD_ALLOWED_ROLES || "")
  .split(",")
  .map(role => role.trim())
  .filter(Boolean)

export const verifyDiscordSignature = async (publicKeyHex: string, timestamp: string, body: string, signatureHex: string): Promise<boolean> => {
  const key = await webcrypto.subtle.importKey('raw', Buffer.from(publicKeyHex, 'hex'), { name: 'ed25519' }, false, ['verify'])
  return webcrypto.subtle.verify('ed25519', key, Buffer.from(signatureHex, 'hex'), Buffer.from(timestamp + body, 'utf-8'))
}

const followUpDeferred = (applicationId: string, token: string, body: object) =>
  axios.patch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`, body)

// getScrapeResult's body is a jobResult on success, or just { error } if it
// never got far enough to generate a jobId (no/multiple scrapers matched)
type ScrapeResultBody = Partial<jobResult> & { error?: string }

const sceneEmbed = (body: ScrapeResultBody) => {
  const publicUrl = process.env.PUBLIC_URL || "https://scrape-ci.maista.no"
  const resultLink = body.jobId ? ` [Logs/Results](${publicUrl}/scene?id=${body.jobId})` : ""
  if (body.error || !body.result) {
    return { content: `Error scraping: ${body.error ?? "unknown error"}${resultLink}` }
  }
  const scene = body.result
  return {
    content: `Results:${resultLink}`,
    embeds: [{
      author: { name: scene.studio?.name ?? "Unknown Studio" },
      title: scene.title,
      description: scene.details || "No description available.",
      fields: [
        { name: "Performers", value: scene.performers?.length ? scene.performers.map(p => p.name).join(", ") : "N/A", inline: false },
        { name: "Date", value: scene.date || "N/A" },
        { name: "URL", value: scene.urls?.length ? scene.urls.join(", ") : "N/A", inline: false },
      ],
      timestamp: body.runnerInfo?.date,
      footer: { text: `stash ${body.stashInfo?.version.version}` },
      color: 9499119,
    }],
  }
}

// kicked off after the deferred response is sent; not awaited by the caller
const runScrapeUrlCommand = async (url: string, applicationId: string, token: string) => {
  const { body } = await getScrapeResult("scene", url)
  const embed = sceneEmbed(body as ScrapeResultBody)
  await followUpDeferred(applicationId, token, embed)
    .catch(err => console.error("Discord followup failed:", err))
}

const updateScrapersEmbed = (before: installedPackage[], after: installedPackage[]) => {
  const beforeVersions = new Map(before.map((pkg): [string, string] => [pkg.package_id, pkg.version]))
  const changed = after
    .filter(pkg => beforeVersions.get(pkg.package_id) !== pkg.version)
    .map(pkg => `**${pkg.package_id}**: \`${beforeVersions.get(pkg.package_id) ?? "new"}\` → \`${pkg.version}\``)

  if (!changed.length) {
    return { content: "Scrapers updated and database migrated successfully. No version changes." }
  }
  // Discord messages cap at 2000 chars; cap the list well before that
  const shown = changed.slice(0, 30)
  const lines = [
    `Scrapers updated and database migrated successfully — ${changed.length} changed:`,
    ...shown,
  ]
  if (changed.length > shown.length) lines.push(`…and ${changed.length - shown.length} more.`)
  return { content: lines.join("\n") }
}

// kicked off after the deferred response is sent; not awaited by the caller
const runUpdateScrapersCommand = async (applicationId: string, token: string) => {
  const stash = new StashApp()
  try {
    const before = await stash.getInstalledScrapers()
    await stash.migrateDatabase()
    await stash.checkUpdatePackages(true)
    const after = await stash.getInstalledScrapers()
    await followUpDeferred(applicationId, token, updateScrapersEmbed(before, after))
      .catch(err => console.error("Discord followup failed:", err))
  } catch (err) {
    console.error("Discord update_scrapers command failed:", err)
    await followUpDeferred(applicationId, token, { content: `Failed to update scrapers: ${(err as Error).message}` })
      .catch(followUpErr => console.error("Discord followup failed:", followUpErr))
  }
}

export interface InteractionResponse {
  status: number
  json?: object
}

export const handleInteraction = async (body: any): Promise<InteractionResponse> => {
  // PING
  if (body.type === 1) return { status: 200, json: { type: 1 } }
  // only slash commands beyond this point
  if (body.type !== 2) return { status: 501 }

  const memberRoles: string[] = body.member?.roles || []
  if (!ALLOWED_ROLES.length || !memberRoles.some(role => ALLOWED_ROLES.includes(role))) {
    return {
      status: 200,
      json: { type: 4, data: { content: "This command is restricted to certain roles.", flags: 64 } },
    }
  }

  // defer immediately (both commands can run well over Discord's 3s response
  // window), then follow up once the real work finishes
  if (body.data?.name === "scrape_url") {
    const url = body.data.options?.find((opt: any) => opt.name === "url")?.value
    if (!url) return { status: 400 }
    runScrapeUrlCommand(url, body.application_id, body.token)
      .catch(err => console.error("Discord scrape command failed:", err))
    return { status: 200, json: { type: 5 } }
  }

  if (body.data?.name === "update_scrapers") {
    runUpdateScrapersCommand(body.application_id, body.token)
      .catch(err => console.error("Discord update_scrapers command failed:", err))
    return { status: 200, json: { type: 5 } }
  }

  return { status: 404 }
}
