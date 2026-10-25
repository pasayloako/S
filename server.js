import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Random User Agents
const ua_list = [
    "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 12; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.82 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.71 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 11; OnePlus 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.74 Mobile Safari/537.36"
];

// Active jobs tracking
const activeJobs = new Map();

// Helper function to extract post ID from URL
function extractPostId(url) {
    // Handle different Facebook URL formats
    const patterns = [
        /\/posts\/(\d+)/,
        /\/photo\.php\?fbid=(\d+)/,
        /\/permalink\.php\?story_fbid=(\d+)/
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return url;
}

// Function to validate cookie and get token
async function validateCookie(cookie) {
    try {
        const ua = ua_list[Math.floor(Math.random() * ua_list.length)];
        
        const response = await fetch("https://business.facebook.com/business_locations", {
            headers: {
                "user-agent": ua,
                "referer": "https://www.facebook.com/",
                "cookie": cookie
            }
        });
        
        const data = await response.text();
        const tokenMatch = data.match(/(EAAG\w+)/);
        
        if (tokenMatch) {
            return { valid: true, token: tokenMatch[1] };
        } else {
            return { valid: false, error: "Token extraction failed" };
        }
    } catch (error) {
        return { valid: false, error: error.message };
    }
}

// Function to share a post
async function sharePost(cookie, postUrl, shareNumber) {
    const ua = ua_list[Math.floor(Math.random() * ua_list.length)];
    const postId = extractPostId(postUrl);
    
    try {
        // Parse cookie string to object for proper formatting
        const cookieObj = {};
        cookie.split("; ").forEach(val => {
            const [key, ...value] = val.split("=");
            if (key && value.length) cookieObj[key] = value.join("=");
        });
        
        const formattedCookie = Object.entries(cookieObj)
            .map(([key, val]) => `${key}=${val}`)
            .join("; ");
        
        // First, get the share dialog data
        const shareDialogUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(postUrl)}`;
        
        const response = await fetch(shareDialogUrl, {
            headers: {
                "user-agent": ua,
                "cookie": formattedCookie,
                "referer": "https://www.facebook.com/"
            }
        });
        
        // Alternative sharing method
        const shareResponse = await fetch("https://www.facebook.com/ajax/sharer/share.php", {
            method: "POST",
            headers: {
                "user-agent": ua,
                "cookie": formattedCookie,
                "content-type": "application/x-www-form-urlencoded",
                "x-requested-with": "XMLHttpRequest",
                "referer": postUrl
            },
            body: new URLSearchParams({
                "privacy": JSON.stringify({ value: "EVERYONE" }),
                "share_url": postUrl,
                "post_fbid": postId
            })
        });
        
        if (shareResponse.ok) {
            const result = await shareResponse.text();
            if (result.includes("success") || result.includes("share_id")) {
                return { success: true, message: `✓ Share ${shareNumber} completed` };
            }
        }
        
        // Fallback method - direct share
        const fallbackResponse = await fetch("https://www.facebook.com/manwelsoyasistayob", {
            method: "POST",
            headers: {
                "user-agent": ua,
                "cookie": formattedCookie,
                "content-type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                "share_id": postId,
                "privacy": "EVERYONE"
            })
        });
        
        if (fallbackResponse.ok) {
            return { success: true, message: `✓ Share ${shareNumber} completed` };
        }
        
        return { success: false, message: `✗ Share ${shareNumber} failed` };
        
    } catch (error) {
        return { success: false, message: `✗ Share ${shareNumber} error: ${error.message}` };
    }
}

// Main boosting function
async function runBoost(jobId, cookie, link, limit, statusCallback) {
    let sharesCompleted = 0;
    let sharesFailed = 0;
    const batchSize = 5;
    const delayBetweenShares = 3000; // 3 seconds delay between shares
    const delayBetweenBatches = 10000; // 10 seconds delay between batches
    
    try {
        // First validate the cookie
        await statusCallback("Validating cookie...");
        const validation = await validateCookie(cookie);
        
        if (!validation.valid) {
            await statusCallback(`❌ Cookie validation failed: ${validation.error}`);
            activeJobs.delete(jobId);
            return;
        }
        
        await statusCallback(`✓ Cookie validated successfully! Starting ${limit} shares...`);
        
        // Start sharing process
        for (let i = 1; i <= limit; i++) {
            // Check if job was cancelled
            if (!activeJobs.has(jobId)) {
                await statusCallback("⚠️ Job cancelled by user");
                break;
            }
            
            const result = await sharePost(cookie, link, i);
            
            if (result.success) {
                sharesCompleted++;
                await statusCallback(`${result.message} (${sharesCompleted}/${limit})`);
            } else {
                sharesFailed++;
                await statusCallback(`${result.message} (Failed: ${sharesFailed})`);
            }
            
            // Rate limiting
            if (i < limit) {
                if (i % batchSize === 0) {
                    await statusCallback(`⏳ Batch complete. Waiting ${delayBetweenBatches/1000} seconds before next batch...`);
                    await new Promise(r => setTimeout(r, delayBetweenBatches));
                } else {
                    await new Promise(r => setTimeout(r, delayBetweenShares));
                }
            }
        }
        
        // Final status
        await statusCallback(`\n✨ COMPLETED! Total: ${sharesCompleted}/${limit} successful, ${sharesFailed} failed`);
        
    } catch (error) {
        await statusCallback(`❌ Error: ${error.message}`);
    } finally {
        activeJobs.delete(jobId);
    }
}

// API endpoint to start boosting
app.post('/start', async (req, res) => {
    const { cookie, link, limit } = req.body;
    
    // Validate input
    if (!cookie || !link || !limit) {
        return res.status(400).json({ 
            status: 'error', 
            message: 'All fields are required' 
        });
    }
    
    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
        return res.status(400).json({ 
            status: 'error', 
            message: 'Shares must be between 1 and 1000' 
        });
    }
    
    // Validate URL format
    if (!link.includes('facebook.com') && !link.includes('fb.com')) {
        return res.status(400).json({ 
            status: 'error', 
            message: 'Please enter a valid Facebook post URL' 
        });
    }
    
    // Generate unique job ID
    const jobId = Date.now().toString();
    
    // Store job info
    activeJobs.set(jobId, {
        cookie,
        link,
        limit: limitNum,
        startTime: new Date()
    });
    
    // Send immediate response
    res.json({ 
        status: 'started', 
        message: `Boosting started! Processing ${limitNum} shares...`,
        jobId: jobId
    });
    
    // Create a status updater function
    const statusMessages = [];
    const updateStatus = async (message) => {
        statusMessages.push({
            time: new Date().toISOString(),
            message: message
        });
        console.log(chalk.blue(`[Job ${jobId}] ${message}`));
    };
    
    // Run boost in background
    runBoost(jobId, cookie, link, limitNum, updateStatus).catch(async (error) => {
        await updateStatus(`Fatal error: ${error.message}`);
    });
});

// API endpoint to check job status
app.get('/status/:jobId', async (req, res) => {
    const { jobId } = req.params;
    
    if (!activeJobs.has(jobId)) {
        return res.json({ 
            status: 'completed_or_not_found',
            message: 'Job completed or not found'
        });
    }
    
    const job = activeJobs.get(jobId);
    res.json({
        status: 'running',
        jobId: jobId,
        startTime: job.startTime
    });
});

// API endpoint to cancel job
app.post('/cancel/:jobId', async (req, res) => {
    const { jobId } = req.params;
    
    if (activeJobs.has(jobId)) {
        activeJobs.delete(jobId);
        res.json({ status: 'cancelled', message: 'Job cancelled successfully' });
    } else {
        res.json({ status: 'not_found', message: 'Job not found' });
    }
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        activeJobs: activeJobs.size 
    });
});

app.listen(port, () => {
    console.log(chalk.green('═══════════════════════════════════════'));
    console.log(chalk.blue(`✓ FB Share Booster Server Running`));
    console.log(chalk.blue(`✓ Port: ${port}`));
    console.log(chalk.blue(`✓ URL: http://localhost:${port}`));
    console.log(chalk.green('═══════════════════════════════════════'));
});
