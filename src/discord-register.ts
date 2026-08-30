// One-off script: registers/updates the bot's slash commands with Discord.
// Run manually after deploying (`node dist/src/discord-register.js`), not on server start.
import 'dotenv/config'
import axios from "axios"

const { DISCORD_TOKEN, DISCORD_APPLICATION_ID } = process.env
if (!DISCORD_TOKEN || !DISCORD_APPLICATION_ID) {
  console.error("DISCORD_TOKEN and DISCORD_APPLICATION_ID are required")
  process.exit(1)
}

const commands = [
  {
    name: "scrape_url",
    description: "Scrape a scene URL via scrape-ci.",
    options: [
      { name: "url", description: "The URL to scrape.", type: 3, required: true },
    ],
  },
  {
    name: "update_scrapers",
    description: "Update all scrapers and run database migration.",
    options: [],
  },
]

axios.put(`https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`, commands, {
  headers: { Authorization: `Bot ${DISCORD_TOKEN}` },
})
  .then(() => console.log("Slash commands registered successfully."))
  .catch(err => {
    console.error(`Failed to register commands: ${err.response?.status} ${JSON.stringify(err.response?.data)}`)
    process.exit(1)
  })
