import { createClient } from "@redis/client";

export const client = process.env.REDIS_URL
  ? await createClient({ url: process.env.REDIS_URL })
    .on("error", (err) => {})
    .connect()
  : null;
