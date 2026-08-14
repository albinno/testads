require("dotenv").config();

const express = require("express");
const { Telegraf, Markup } = require("telegraf");

// ============================================================
// CONFIG
// ============================================================

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADSGRAM_TOKEN = process.env.ADSGRAM_TOKEN;
const ADSGRAM_BLOCK_ID = process.env.ADSGRAM_BLOCK_ID;

const REWARD_POINTS = Number(process.env.REWARD_POINTS || 100);

console.log("AdsGram token loaded:", {
    exists: Boolean(ADSGRAM_TOKEN),
    length: ADSGRAM_TOKEN?.length || 0,
    prefix: ADSGRAM_TOKEN?.slice(0, 4) || "",
    suffix: ADSGRAM_TOKEN?.slice(-4) || ""
});

if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN is missing");
}

if (!ADSGRAM_TOKEN) {
    throw new Error("ADSGRAM_TOKEN is missing");
}

if (!ADSGRAM_BLOCK_ID) {
    throw new Error("ADSGRAM_BLOCK_ID is missing");
}

// ============================================================
// EXPRESS SERVER
// ============================================================

const app = express();

app.use(express.json());

const PORT = Number(process.env.PORT || 10000);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/", (req, res) => {
    res.status(200).json({
        ok: true,
        service: "AdsGram Telegram Bot",
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// TEMPORARY TEST DATABASE
// ============================================================

const users = new Map();

/*
    users:

    Telegram ID -> {
        points: Number,
        pendingAd: {
            createdAt: Number,
            rewardUrl: String,
            rewarded: Boolean
        }
    }
*/

function getUser(userId) {
    const id = String(userId);

    if (!users.has(id)) {
        users.set(id, {
            points: 0,
            pendingAd: null
        });
    }

    return users.get(id);
}

// ============================================================
// ADSGRAM API
// ============================================================

async function getAdsGramAd(userId, language) {
    /*
        IMPORTANT:
        This intentionally uses the FULL RAW URL.

        Example:

        https://api.adsgram.ai/advbot?tgid=123456789&blockid=42870&language=en&token=YOUR_TOKEN
    */

    const selectedLanguage = language || "en";

    const rawUrl =
        "https://api.adsgram.ai/advbot" +
        "?tgid=" + encodeURIComponent(String(userId)) +
        "&blockid=" + encodeURIComponent(String(ADSGRAM_BLOCK_ID)) +
        "&language=" + encodeURIComponent(selectedLanguage) +
        "&token=" + encodeURIComponent(ADSGRAM_TOKEN);

    // Never print the actual token.
    const safeUrl =
        "https://api.adsgram.ai/advbot" +
        "?tgid=" + encodeURIComponent(String(userId)) +
        "&blockid=" + encodeURIComponent(String(ADSGRAM_BLOCK_ID)) +
        "&language=" + encodeURIComponent(selectedLanguage) +
        "&token=***HIDDEN***";

    console.log("========== ADSGRAM REQUEST ==========");
    console.log("Method: GET");
    console.log("URL:", safeUrl);
    console.log("Block ID:", ADSGRAM_BLOCK_ID);
    console.log("Language:", selectedLanguage);
    console.log("Token exists:", Boolean(ADSGRAM_TOKEN));
    console.log("Token length:", ADSGRAM_TOKEN?.length || 0);
    console.log("Token prefix:", ADSGRAM_TOKEN?.slice(0, 4) || "");
    console.log("Token suffix:", ADSGRAM_TOKEN?.slice(-4) || "");

    let response;

    try {
        response = await fetch(rawUrl, {
            method: "GET"
        });
    } catch (networkError) {
        console.error(
            "AdsGram network error:",
            networkError
        );

        throw new Error(
            "NETWORK_ERROR\n" +
            `Message: ${networkError.message}\n\n` +
            `Request URL: ${safeUrl}\n` +
            `Method: GET`
        );
    }

    const body = await response.text();

    console.log("AdsGram HTTP status:", response.status);
    console.log("AdsGram response:", body);
    console.log("====================================");

    if (!response.ok) {
        const error = new Error(
            `AdsGram HTTP ${response.status}: ${body}`
        );

        // Extra information for Telegram debugging.
        error.debug = {
            status: response.status,
            response: body,
            method: "GET",
            url: safeUrl,
            blockId: String(ADSGRAM_BLOCK_ID),
            language: selectedLanguage,
            tokenExists: Boolean(ADSGRAM_TOKEN),
            tokenLength: ADSGRAM_TOKEN?.length || 0,
            tokenPrefix: ADSGRAM_TOKEN?.slice(0, 4) || "",
            tokenSuffix: ADSGRAM_TOKEN?.slice(-4) || ""
        };

        throw error;
    }

    let data;

    try {
        data = JSON.parse(body);
    } catch (parseError) {
        const error = new Error(
            "AdsGram returned invalid JSON."
        );

        error.debug = {
            status: response.status,
            response: body,
            method: "GET",
            url: safeUrl,
            blockId: String(ADSGRAM_BLOCK_ID),
            language: selectedLanguage,
            tokenExists: Boolean(ADSGRAM_TOKEN),
            tokenLength: ADSGRAM_TOKEN?.length || 0
        };

        throw error;
    }

    return data;
}

// ============================================================
// FORMAT ADSGRAM DEBUG INFORMATION
// ============================================================

function formatAdsGramError(error) {
    const debug = error.debug || {};

    let message =
        "❌ ADSGRAM ERROR\n\n" +
        `Message: ${error.message || "Unknown error"}\n\n`;

    if (debug.status !== undefined) {
        message +=
            `HTTP Status: ${debug.status}\n`;
    }

    if (debug.response !== undefined) {
        message +=
            `AdsGram Response:\n${debug.response}\n\n`;
    }

    message +=
        `Method: ${debug.method || "GET"}\n` +
        `Endpoint: https://api.adsgram.ai/advbot\n` +
        `Block ID: ${debug.blockId || ADSGRAM_BLOCK_ID}\n` +
        `Language: ${debug.language || "en"}\n` +
        `Token exists: ${debug.tokenExists ?? Boolean(ADSGRAM_TOKEN)}\n` +
        `Token length: ${debug.tokenLength ?? ADSGRAM_TOKEN?.length ?? 0}\n` +
        `Token prefix: ${debug.tokenPrefix ?? ADSGRAM_TOKEN?.slice(0, 4) ?? ""}\n` +
        `Token suffix: ${debug.tokenSuffix ?? ADSGRAM_TOKEN?.slice(-4) ?? ""}`;

    return message;
}

// ============================================================
// SEND ADSGRAM AD
// ============================================================

async function showAd(ctx) {
    const telegramUser = ctx.from;

    if (!telegramUser) {
        return;
    }

    const userId = String(telegramUser.id);

    try {
        const ad = await getAdsGramAd(
            userId,
            telegramUser.language_code || "en"
        );

        console.log(
            "AdsGram parsed response:",
            JSON.stringify(ad, null, 2)
        );

        // ----------------------------------------------------
        // Validate advertisement
        // ----------------------------------------------------

        if (!ad || !ad.reward_url || !ad.click_url) {
            const debugMessage =
                "❌ ADSGRAM ERROR\n\n" +
                "AdsGram returned a response, but it does not " +
                "contain the required advertisement fields.\n\n" +
                "Received response:\n" +
                JSON.stringify(ad, null, 2);

            await ctx.reply(debugMessage);

            return;
        }

        const user = getUser(userId);

        // ----------------------------------------------------
        // Create pending reward session
        // ----------------------------------------------------

        user.pendingAd = {
            createdAt: Date.now(),
            rewardUrl: ad.reward_url,
            rewarded: false
        };

        // ----------------------------------------------------
        // Buttons
        // ----------------------------------------------------

        const buttons = [];

        if (ad.button_name && ad.click_url) {
            buttons.push([
                Markup.button.url(
                    ad.button_name,
                    ad.click_url
                )
            ]);
        }

        if (ad.button_reward_name && ad.reward_url) {
            buttons.push([
                Markup.button.url(
                    ad.button_reward_name,
                    ad.reward_url
                )
            ]);
        }

        const replyMarkup = Markup.inlineKeyboard(
            buttons
        );

        // ----------------------------------------------------
        // Send image if available
        // ----------------------------------------------------

        if (ad.image_url) {
            try {
                await ctx.telegram.sendPhoto(
                    userId,
                    ad.image_url,
                    {
                        caption:
                            ad.text_html ||
                            "Sponsored message",

                        parse_mode: "HTML",

                        protect_content: true,

                        reply_markup:
                            replyMarkup.reply_markup
                    }
                );

                return;
            } catch (error) {
                console.error(
                    "sendPhoto failed:",
                    error.message
                );

                // Continue to text fallback.
            }
        }

        // ----------------------------------------------------
        // Text fallback
        // ----------------------------------------------------

        await ctx.telegram.sendMessage(
            userId,
            ad.text_html || "Sponsored message",
            {
                parse_mode: "HTML",
                protect_content: true,
                reply_markup:
                    replyMarkup.reply_markup
            }
        );

    } catch (error) {
        console.error(
            "AdsGram error:",
            error
        );

        // Send full useful debug information to Telegram.
        const debugMessage = formatAdsGramError(error);

        try {
            await ctx.reply(debugMessage);
        } catch (telegramError) {
            console.error(
                "Failed to send AdsGram debug information:",
                telegramError
            );
        }
    }
}

// ============================================================
// TELEGRAM BOT
// ============================================================

const bot = new Telegraf(BOT_TOKEN);

// ============================================================
// START
// ============================================================

bot.start(async (ctx) => {
    const user = getUser(ctx.from.id);

    await ctx.reply(
        `👋 Hello ${ctx.from.first_name || "there"}!\n\n` +
        `This is an AdsGram test bot.\n\n` +
        `💰 Points: ${user.points}`,
        Markup.inlineKeyboard([
            [
                Markup.button.callback(
                    "🎬 Watch Ad",
                    "watch_ad"
                )
            ],
            [
                Markup.button.callback(
                    "💰 Balance",
                    "balance"
                )
            ]
        ])
    );
});

// ============================================================
// /ad
// ============================================================

bot.command("ad", async (ctx) => {
    await showAd(ctx);
});

// ============================================================
// WATCH AD BUTTON
// ============================================================

bot.action("watch_ad", async (ctx) => {
    await ctx.answerCbQuery();

    await showAd(ctx);
});

// ============================================================
// /balance
// ============================================================

bot.command("balance", async (ctx) => {
    const user = getUser(ctx.from.id);

    await ctx.reply(
        `💰 Your balance\n\n` +
        `Points: ${user.points}`
    );
});

// ============================================================
// BALANCE BUTTON
// ============================================================

bot.action("balance", async (ctx) => {
    await ctx.answerCbQuery();

    const user = getUser(ctx.from.id);

    await ctx.reply(
        `💰 Your balance\n\n` +
        `Points: ${user.points}`
    );
});

// ============================================================
// ADSGRAM REWARD ENDPOINT
// ============================================================

app.get("/adsgram/reward", async (req, res) => {
    console.log(
        "AdsGram reward request:",
        req.query
    );

    const userId = req.query.userid;

    // --------------------------------------------------------
    // Validate user ID
    // --------------------------------------------------------

    if (!userId) {
        return res
            .status(400)
            .send("Missing userid");
    }

    if (!/^\d+$/.test(String(userId))) {
        return res
            .status(400)
            .send("Invalid userid");
    }

    const user = getUser(userId);

    // --------------------------------------------------------
    // Check pending advertisement
    // --------------------------------------------------------

    if (!user.pendingAd) {
        return res
            .status(403)
            .send("No pending advertisement.");
    }

    // --------------------------------------------------------
    // Reward links are valid for 1 hour
    // --------------------------------------------------------

    const ONE_HOUR = 60 * 60 * 1000;

    if (
        Date.now() - user.pendingAd.createdAt >
        ONE_HOUR
    ) {
        user.pendingAd = null;

        return res
            .status(410)
            .send("Advertisement expired.");
    }

    // --------------------------------------------------------
    // Prevent duplicate rewards
    // --------------------------------------------------------

    if (user.pendingAd.rewarded) {
        return res
            .status(200)
            .send("Reward already processed.");
    }

    // --------------------------------------------------------
    // GIVE REWARD
    // --------------------------------------------------------

    user.points += REWARD_POINTS;

    user.pendingAd.rewarded = true;

    console.log(
        `User ${userId} received ${REWARD_POINTS} points`
    );

    // --------------------------------------------------------
    // Notify user
    // --------------------------------------------------------

    try {
        await bot.telegram.sendMessage(
            userId,
            `🎉 Advertisement completed!\n\n` +
            `+${REWARD_POINTS} points\n` +
            `💰 Balance: ${user.points}`
        );
    } catch (error) {
        console.error(
            "Reward notification failed:",
            error.message
        );
    }

    return res
        .status(200)
        .send("Reward processed.");
});

// ============================================================
// START HTTP SERVER
// ============================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `HTTP server running on port ${PORT}`
        );
    }
);

// ============================================================
// START TELEGRAM BOT
// ============================================================

bot.launch()
    .then(() => {
        console.log(
            "Telegram bot started successfully."
        );
    })
    .catch((error) => {
        console.error(
            "Telegram bot failed to start:",
            error
        );

        process.exit(1);
    });

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

process.once("SIGINT", () => {
    bot.stop("SIGINT");
});

process.once("SIGTERM", () => {
    bot.stop("SIGTERM");
});
