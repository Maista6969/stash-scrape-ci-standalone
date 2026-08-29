import { webcrypto } from "crypto"
import axios from "axios"
import { getScrapeResult } from "./scrape.js"
import { jobResult } from "../types/jobResult.js"

// comma-separated Discord role IDs allowed to run commands; fails closed if unset
const ALLOWED_ROLES = (process.env.DISCORD_ALLOWED_ROLES || "")
  .split(",")
  .map(role => role.trim())
  .filter(Boolean)

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export const verifyDiscordSignature = async (publicKeyHex: string, timestamp: string, body: string, signatureHex: string): Promise<boolean> => {
  const key = await webcrypto.subtle.importKey('raw', hexToBytes(publicKeyHex), { name: 'ed25519' }, false, ['verify'])
  return webcrypto.subtle.verify('ed25519', key, hexToBytes(signatureHex), new TextEncoder().encode(timestamp + body))
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

  if (body.data?.name !== "scrape_url") return { status: 404 }

  const url = body.data.options?.find((opt: any) => opt.name === "url")?.value
  if (!url) return { status: 400 }

  // defer immediately (scraping can take well over Discord's 3s response window),
  // then follow up once the scrape actually finishes
  runScrapeUrlCommand(url, body.application_id, body.token)
    .catch(err => console.error("Discord scrape command failed:", err))
  return { status: 200, json: { type: 5 } }
}
