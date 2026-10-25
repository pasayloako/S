import axios from "axios";
import fs from "fs-extra";
import chalk from "chalk";
import readline from "readline-sync";

// ============================================================
// CONFIG
// ============================================================
const UA_LIST = [
    "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 12; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.82 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.71 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 11; OnePlus 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.74 Mobile Safari/537.36",
];

const TOKENS_FILE = "tokens.json";
const COOKIES_FILE = "cookies.json";
const DELAY_BETWEEN_SHARES = 3000;      // 3s
const DELAY_BETWEEN_BATCHES = 10000;    // 10s
const BATCH_SIZE = 5;

axios.defaults.timeout = 20000;
axios.defaults.validateStatus = () => true; // we handle status manually

// ============================================================
// HELPERS
// ============================================================
function randomUA() {
    return UA_LIST[Math.floor(Math.random() * UA_LIST.length)];
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function parseCookieString(str) {
    const out = {};
    for (const part of str.split(";")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const idx = trimmed.indexOf("=");
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (key) out[key] = val;
    }
    return out;
}

function cookieObjectToString(obj) {
    return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join("; ");
}

function extractPostId(url) {
    const patterns = [
        /\/posts\/(\d+)/,
        /\/photo\.php\?fbid=(\d+)/,
        /\/permalink\.php\?story_fbid=(\d+)/,
        /\/videos\/(\d+)/,
        /fbid=(\d+)/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

// ============================================================
// BANNER
// ============================================================
function banner() {
    console.clear();
    console.log(chalk.blue("====================================="));
    console.log(chalk.blue.bold("       FB SHARE BOOSTER v2.0"));
    console.log(chalk.blue("====================================="));
    console.log(chalk.gray("WARNING: This tool may violate Facebook's"));
    console.log(chalk.gray("Terms of Service. Use at your own risk."));
    console.log(chalk.gray("-------------------------------------"));
}

// ============================================================
// STEP 1 — Validate cookie & extract token
// ============================================================
async function validateCookieAndGetToken(rawCookie) {
    const cookieObj = parseCookieString(rawCookie);

    if (!cookieObj.c_user || !cookieObj.xs) {
        return { ok: false, error: "Missing c_user or xs cookie" };
    }

    try {
        const res = await axios.get(
            "https://business.facebook.com/business_locations",
            {
                headers: {
                    "user-agent": randomUA(),
                    referer: "https://www.facebook.com/",
                    cookie: cookieObjectToString(cookieObj),
                },
            }
        );

        const html = typeof res.data === "string" ? res.data : "";
        const match = html.match(/(EAAG\w+)/);

        if (!match) {
            return {
                ok: false,
                error: "Token extraction failed (cookie may be expired)",
            };
        }

        return { ok: true, token: match[1], cookieObj };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// ============================================================
// STEP 2 — Fetch fb_dtsg + jazoest from post page
// ============================================================
async function fetchDtsgAndJazoest(cookieStr, postUrl) {
    try {
        const res = await axios.get(postUrl, {
            headers: {
                "user-agent": randomUA(),
                cookie: cookieStr,
                accept:
                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        });

        const html = typeof res.data === "string" ? res.data : "";

        const dtsgMatch =
            html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/) ||
            html.match(/"DTSGInitData",\[\],\{"token":"([^"]+)"/) ||
            html.match(/name="fb_dtsg"\s+value="([^"]+)"/);

        const jazoestMatch = html.match(/name="jazoest"\s+value="(\d+)"/);

        if (!dtsgMatch) {
            return { ok: false, error: "fb_dtsg not found on page" };
        }

        return {
            ok: true,
            fb_dtsg: dtsgMatch[1],
            jazoest: jazoestMatch ? jazoestMatch[1] : "",
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// ============================================================
// STEP 3 — Attempt real share via GraphQL mutation
// ============================================================
async function attemptShare(cookieStr, postUrl, postId, fbDtsg, jazoest) {
    const params = new URLSearchParams();
    params.append("fb_dtsg", fbDtsg);
    if (jazoest) params.append("jazoest", jazoest);
    params.append("privacy", JSON.stringify({ value: "EVERYONE" }));
    params.append("share_id", postId);
    params.append("share_url", postUrl);

    try {
        const res = await axios.post(
            "https://www.facebook.com/api/graphql/",
            params.toString(),
            {
                headers: {
                    "user-agent": randomUA(),
                    cookie: cookieStr,
                    "content-type": "application/x-www-form-urlencoded",
                    "x-fb-friendly-name": "ComposerShareMutation",
                    referer: postUrl,
                    origin: "https://www.facebook.com",
                },
            }
        );

        const body =
            typeof res.data === "string" ? res.data : JSON.stringify(res.data);

        if (res.status !== 200) {
            return { ok: false, reason: `HTTP ${res.status}` };
        }

        if (/"error"\s*:\s*\{/.test(body)) {
            return { ok: false, reason: "GraphQL error in response" };
        }

        if (/checkpoint|login|not_logged_in/i.test(body)) {
            return { ok: false, reason: "Session invalid / checkpoint" };
        }

        return { ok: true };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

// ============================================================
// LOGIN FLOW — interactive, saves cookies + tokens
// ============================================================
async function login() {
    banner();
    console.log(chalk.yellow("Paste your Facebook cookie (format:"));
    console.log(chalk.yellow("  c_user=...; xs=...; datr=...; fr=...)"));
    console.log(chalk.gray("Do NOT commit this cookie to git.\n"));

    const rawCookie = readline.question(chalk.green("cookie: ")).trim();

    if (!rawCookie) {
        console.log(chalk.red("Empty cookie. Abort."));
        return;
    }

    console.log(chalk.yellow("\nValidating cookie..."));
    const result = await validateCookieAndGetToken(rawCookie);

    if (!result.ok) {
        console.log(chalk.red(`Validation failed: ${result.error}`));
        return;
    }

    console.log(chalk.green(`✓ Token found: ${result.token.slice(0, 20)}...`));

    fs.writeFileSync(
        TOKENS_FILE,
        JSON.stringify([result.token], null, 2)
    );
    fs.writeFileSync(
        COOKIES_FILE,
        JSON.stringify([rawCookie], null, 2)
    );

    console.log(chalk.green(`Saved ${TOKENS_FILE} and ${COOKIES_FILE}`));
    console.log(chalk.gray("Both files are gitignored — do not remove them."));
}

// ============================================================
// BOT FLOW — read saved session, run shares
// ============================================================
async function bot() {
    banner();

    if (!fs.existsSync(COOKIES_FILE) || !fs.existsSync(TOKENS_FILE)) {
        console.log(chalk.red("No session found. Run login first."));
        return;
    }

    const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8"));
    const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));

    if (!cookies.length || !tokens.length) {
        console.log(chalk.red("Saved session is empty. Run login again."));
        return;
    }

    const link = readline.question(chalk.cyan("Post URL: ")).trim();
    if (!/facebook\.com|fb\.com/i.test(link)) {
        console.log(chalk.red("Invalid Facebook URL."));
        return;
    }

    const postId = extractPostId(link);
    if (!postId) {
        console.log(
            chalk.red(
                "Could not extract post ID from URL. Try a /posts/<id> or /photo.php?fbid=<id> link."
            )
        );
        return;
    }

    const limitRaw = readline.question(chalk.cyan("Number of shares: ")).trim();
    const limit = parseInt(limitRaw, 10);

    if (isNaN(limit) || limit < 1 || limit > 1000) {
        console.log(chalk.red("Shares must be between 1 and 1000."));
        return;
    }

    const cookieStr = cookies[0]; // single-cookie mode for now
    console.log(chalk.yellow("\nFetching fb_dtsg / jazoest from post page..."));

    const dtsg = await fetchDtsgAndJazoest(cookieStr, link);
    if (!dtsg.ok) {
        console.log(chalk.red(`Cannot fetch tokens: ${dtsg.error}`));
        console.log(
            chalk.yellow(
                "The cookie may be logged out, or the post is not public."
            )
        );
        return;
    }

    console.log(chalk.green("✓ Got fb_dtsg. Starting share loop...\n"));

    let success = 0;
    let failed = 0;
    const start = Date.now();

    for (let i = 1; i <= limit; i++) {
        const result = await attemptShare(
            cookieStr,
            link,
            postId,
            dtsg.fb_dtsg,
            dtsg.jazoest
        );

        const elapsed = Math.floor((Date.now() - start) / 1000);

        if (result.ok) {
            success++;
            console.log(
                chalk.green(`✓ ${i}/${limit} — shared (${elapsed}s)`)
            );
        } else {
            failed++;
            console.log(
                chalk.red(`✗ ${i}/${limit} — ${result.reason} (${elapsed}s)`)
            );

            // Stop early if session is dead
            if (/checkpoint|session/i.test(result.reason)) {
                console.log(
                    chalk.red(
                        "\nSession appears invalid. Stopping to avoid account lock."
                    )
                );
                break;
            }
        }

        if (i < limit) {
            if (i % BATCH_SIZE === 0) {
                console.log(
                    chalk.yellow(
                        `Cooldown ${DELAY_BETWEEN_BATCHES / 1000}s...`
                    )
                );
                await sleep(DELAY_BETWEEN_BATCHES);
            } else {
                await sleep(DELAY_BETWEEN_SHARES);
            }
        }
    }

    console.log(
        chalk.blue(
            `\nDone. Success: ${success}, Failed: ${failed}, Total attempted: ${
                success + failed
            }`
        )
    );
    console.log(
        chalk.gray(
            "Note: even 'success' here only means Facebook returned a non-error response."
        )
    );
    console.log(
        chalk.gray(
            "Verify actual share count on the post before assuming it worked."
        )
    );
}

// ============================================================
// ENTRYPOINT
// ============================================================
async function main() {
    banner();
    console.log(chalk.cyan("[1] Login (save cookie)"));
    console.log(chalk.cyan("[2] Run bot (use saved cookie)"));

    const choice = readline.question(chalk.green("\nchoice (1/2): ")).trim();

    if (choice === "1") return login();
    if (choice === "2") return bot();

    console.log(chalk.red("Invalid choice."));
}

main().catch((err) => {
    console.error(chalk.red(`Fatal: ${err.message}`));
    process.exit(1);
});
