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
    exists: !!ADSGRAM_TOKEN,
    length: ADSGRAM_TOKEN?.length,
    prefix: ADSGRAM_TOKEN?.slice(0, 4),
    suffix: ADSGRAM_TOKEN?.slice(-4)
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

// Health check
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
    const url = new URL("https://api.adsgram.ai/advbot");

    url.searchParams.set("tgid", String(userId));
    url.searchParams.set("blockid", String(ADSGRAM_BLOCK_ID));
    url.searchParams.set("language", language || "en");
    url.searchParams.set("token", ADSGRAM_TOKEN);

    console.log("Requesting AdsGram ad...");

    const response = await fetch(url);

    const body = await response.text();

    if (!response.ok) {
        throw new Error(
            `AdsGram HTTP ${response.status}: ${body}`
        );
    }

    let data;

    try {
        data = JSON.parse(body);
    } catch {
        throw new Error(
            `AdsGram returned invalid JSON: ${body}`
        );
    }

    return data;
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
            "AdsGram response:",
            JSON.stringify(ad, null, 2)
        );

        // No advertisement available
        if (!ad || !ad.reward_url || !ad.click_url) {
            await ctx.reply(
                "❌ No advertisement is available right now.\n\n" +
                "Please try again later."
            );

            return;
        }

        const user = getUser(userId);

        // Create pending reward session
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

                // Continue to text fallback
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

        await ctx.reply(
            "❌ Failed to load advertisement.\n\n" +
            "Please try again later."
        );
    }
}

// ============================================================
// TELEGRAM BOT
// ============================================================

const bot = new Telegraf(BOT_TOKEN);

// ------------------------------------------------------------
// START
// ------------------------------------------------------------

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

// ------------------------------------------------------------
// /ad
// ------------------------------------------------------------

bot.command("ad", async (ctx) => {
    await showAd(ctx);
});

// ------------------------------------------------------------
// WATCH AD BUTTON
// ------------------------------------------------------------

bot.action("watch_ad", async (ctx) => {
    await ctx.answerCbQuery();

    await showAd(ctx);
});

// ------------------------------------------------------------
// BALANCE
// ------------------------------------------------------------

bot.command("balance", async (ctx) => {
    const user = getUser(ctx.from.id);

    await ctx.reply(
        `💰 Your balance\n\n` +
        `Points: ${user.points}`
    );
});

// ------------------------------------------------------------
// BALANCE BUTTON
// ------------------------------------------------------------

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

    if (!userId) {
        return res
            .status(400)
            .send("Missing userid");
    }

    // Telegram IDs are numeric
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
    // Reward links are valid for 1 hour according to AdsGram
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
// START SERVER
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
