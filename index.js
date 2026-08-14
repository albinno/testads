require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();

const PORT = Number(process.env.PORT || 10000);
const REWARD_POINTS = Number(process.env.REWARD_POINTS || 100);


app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ============================================================
// TEST DATABASE
// ============================================================
//
// This is intentionally in-memory for the first test.
//
// IMPORTANT:
// Render restarts/redeploys will erase this.
//
// Production -> MongoDB/PostgreSQL/etc.
// ============================================================

const users = new Map();
const adSessions = new Map();

/*
users:

telegramUserId -> {
    id,
    points
}

adSessions:

ymid -> {
    ymid,
    telegramId,
    createdAt,
    rewarded,
    rewardPoints,
    monetagEvent,
    monetagData
}
*/

// ============================================================
// SERVE MINI APP
// ============================================================

app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// HEALTH
// ============================================================

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        service: "Monetag Telegram Mini App Test",
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// USER
// ============================================================

function getUser(telegramId) {
    const id = String(telegramId);

    if (!users.has(id)) {
        users.set(id, {
            id,
            points: 0
        });
    }

    return users.get(id);
}

// ============================================================
// CREATE AD SESSION
// ============================================================
//
// Frontend calls this BEFORE showing an ad.
//
// We create a unique ymid.
//
// That same ymid is passed to Monetag.
// Monetag later sends it back to /monetag/postback.
// ============================================================

app.post("/api/ad-session", (req, res) => {
    try {
        const telegramId =
            req.body?.telegramId
                ? String(req.body.telegramId)
                : null;

        if (!telegramId) {
            return res.status(400).json({
                ok: false,
                error: "telegramId is required"
            });
        }

        const ymid =
            `ad_${Date.now()}_${crypto.randomUUID()}`;

        const session = {
            ymid,
            telegramId,
            createdAt: Date.now(),
            rewarded: false,
            rewardPoints: REWARD_POINTS,
            monetagEvent: null,
            monetagData: null
        };

        adSessions.set(ymid, session);

        console.log(
            "[AD SESSION CREATED]",
            {
                ymid,
                telegramId,
                rewardPoints: REWARD_POINTS
            }
        );

        return res.json({
            ok: true,
            ymid
        });

    } catch (error) {
        console.error(
            "[AD SESSION ERROR]",
            error
        );

        return res.status(500).json({
            ok: false,
            error: "Internal server error"
        });
    }
});

// ============================================================
// MONETAG POSTBACK
// ============================================================
//
// Monetag sends GET requests here.
//
// Example:
//
// /monetag/postback
//   ?ymid=ad_xxx
//   &event=impression
//   &value=valued
//   &zone=123456
//   ...
//
// The exact macros are configured in Monetag.
// ============================================================

app.get("/monetag/postback", async (req, res) => {
    try {
        console.log("");
        console.log("========================================");
        console.log("       MONETAG POSTBACK RECEIVED");
        console.log("========================================");
        console.log(
            JSON.stringify(req.query, null, 2)
        );


        // ----------------------------------------------------
        // Read Monetag parameters
        // ----------------------------------------------------

        const ymid =
            req.query.ymid
                ? String(req.query.ymid)
                : "";

        const eventType =
            req.query.event
                ? String(req.query.event)
                : String(
                    req.query.event_type || ""
                );

        const rewardEventType =
            req.query.value
                ? String(req.query.value)
                : String(
                    req.query.reward_event_type || ""
                );

        const zoneId =
            req.query.zone
                ? String(req.query.zone)
                : String(
                    req.query.zone_id || ""
                );

        const subZoneId =
            req.query.sub
                ? String(req.query.sub)
                : String(
                    req.query.sub_zone_id || ""
                );

        const estimatedPrice =
            req.query.price
                ? String(req.query.price)
                : String(
                    req.query.estimated_price || ""
                );

        const requestVar =
            req.query.request
                ? String(req.query.request)
                : String(
                    req.query.request_var || ""
                );

        const telegramId =
            req.query.telegram_id
                ? String(req.query.telegram_id)
                : "";

        // ----------------------------------------------------
        // Validate ymid
        // ----------------------------------------------------

        if (!ymid) {
            console.warn(
                "[POSTBACK] Missing ymid"
            );

            return res.sendStatus(400);
        }

        // ----------------------------------------------------
        // Find our ad session
        // ----------------------------------------------------

        const session = adSessions.get(ymid);

        if (!session) {
            console.warn(
                "[POSTBACK] Unknown ymid:",
                ymid
            );

            // Return 200 so Monetag doesn't repeatedly retry
            // an event that we cannot associate.
            return res.sendStatus(200);
        }

        // ----------------------------------------------------
        // Store Monetag event
        // ----------------------------------------------------

        session.monetagEvent = eventType;

        session.monetagData = {
            eventType,
            rewardEventType,
            zoneId,
            subZoneId,
            estimatedPrice,
            requestVar,
            telegramId,
            receivedAt: Date.now()
        };

        console.log(
            "[POSTBACK MATCHED]",
            session.monetagData
        );

        // ----------------------------------------------------
        // Already rewarded?
        // ----------------------------------------------------

        if (session.rewarded) {
            console.log(
                "[POSTBACK] Already rewarded:",
                ymid
            );

            return res.sendStatus(200);
        }

        // ----------------------------------------------------
        // TEST REWARD POLICY
        // ----------------------------------------------------
        //
        // For this first test:
        //
        // reward only when Monetag says:
        //
        // reward_event_type = valued
        //
        // We accept the impression event.
        //
        // Monetag currently documents impression as the event
        // that fires when the creative starts rendering.
        //
        // This is suitable for testing the monetized event
        // pipeline, but production reward rules should be
        // designed carefully.
        // ----------------------------------------------------

        if (
            eventType === "impression" &&
            rewardEventType === "valued"
        ) {
            const user =
                getUser(session.telegramId);

            user.points += session.rewardPoints;

            session.rewarded = true;

            console.log(
                "[REWARD GIVEN]",
                {
                    telegramId: session.telegramId,
                    ymid,
                    points: session.rewardPoints,
                    newBalance: user.points,
                    estimatedPrice
                }
            );

            return res.sendStatus(200);
        }

        // ----------------------------------------------------
        // Non-valued event
        // ----------------------------------------------------

        if (rewardEventType === "non_valued") {
            console.log(
                "[NO REWARD] Non-valued event:",
                {
                    ymid,
                    eventType
                }
            );

            return res.sendStatus(200);
        }

        // ----------------------------------------------------
        // Other event
        // ----------------------------------------------------

        console.log(
            "[POSTBACK] Event logged but no reward:",
            {
                ymid,
                eventType,
                rewardEventType
            }
        );

        return res.sendStatus(200);

    } catch (error) {
        console.error(
            "[MONETAG POSTBACK ERROR]",
            error
        );

        return res.sendStatus(500);
    }
});

// ============================================================
// BALANCE
// ============================================================

app.get("/api/balance", (req, res) => {
    const telegramId =
        req.query.telegramId
            ? String(req.query.telegramId)
            : "";

    if (!telegramId) {
        return res.status(400).json({
            ok: false,
            error: "telegramId is required"
        });
    }

    const user = getUser(telegramId);

    return res.json({
        ok: true,
        telegramId,
        points: user.points
    });
});

// ============================================================
// DEBUG: SESSION
// ============================================================

app.get("/api/debug/session", (req, res) => {
    const ymid =
        req.query.ymid
            ? String(req.query.ymid)
            : "";

    if (!ymid) {
        return res.status(400).json({
            ok: false,
            error: "ymid is required"
        });
    }

    const session = adSessions.get(ymid);

    if (!session) {
        return res.status(404).json({
            ok: false,
            error: "Session not found"
        });
    }

    return res.json({
        ok: true,
        session
    });
});

// ============================================================
// START
// ============================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `Monetag test server running on port ${PORT}`
        );

        console.log(
            `Reward points: ${REWARD_POINTS}`
        );
    }
);
