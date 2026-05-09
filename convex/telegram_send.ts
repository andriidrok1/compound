"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

/**
 * Send a Telegram message to the configured chat.
 * Used by the evening / overnight / morning agents.
 */
export const send = internalAction({
  args: { text: v.string() },
  handler: async (_ctx, { text }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      console.warn("Telegram env not set; skipping send");
      return { ok: false, reason: "env" };
    }
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: Number(chatId),
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    const json: any = await resp.json().catch(() => ({}));
    return { ok: resp.ok && json.ok === true, response: json };
  },
});
