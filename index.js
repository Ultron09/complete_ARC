const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Anthropic } = require('@anthropic-ai/sdk');
const Redis = require('ioredis');
const cron = require('node-cron');
const multer = require('multer');
const { calculateScoresForUsers } = require('./services/momentum');
const { evaluateSetMedals } = require('./services/medals');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Set up temporary memory storage for incoming audio chunks
const upload = multer({ storage: multer.memoryStorage() });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl, { retryStrategy: () => null }); // Don't strictly retry if no redis setup yet

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'ARC Backend' });
});

const ARC_SYSTEM_PROMPT = `You are A.R.C., an elite AI performance coach.
Expertise: hypertrophy science, strength periodization, nutrition timing, HRV-based recovery, real-time adjustments.

Rules:
- Give EXACT numbers only. Never say 'it depends' without resolving it.
- Epley 1RM = weight × (1 + reps / 30)
- HRV < 45ms = reduce volume 20%. 45-60ms = maintain. > 60ms = push.
- Keep responses extremely punchy and concise. Maximum 3 short bullet points.
- Formatting must be flat text with bullet points (-), no markdown bolding (**).`;

// POST /api/claude/set-analysis
app.post('/api/claude/set-analysis', async (req, res) => {
    try {
        const { exercise, weight, reps, feel, prior_sets, epley1RM, userId } = req.body;
        
        // Trigger Background Medal Evaluation asynchronously (don't await so UI doesn't hang)
        if (userId) {
            evaluateSetMedals(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, userId, exercise, weight);
        }

        const dynamicContext = `
USER DATA EXTRACT:
- Just Completed: ${exercise} @ ${weight}kg for ${reps} reps
- Estimated 1RM of current set: ${epley1RM}kg
- User Feel: ${feel || 'Not specified'}
- Prior sets logged this session: ${prior_sets}
        `;

        const response = await anthropic.messages.create({
            model: "claude-3-5-haiku-latest",
            max_tokens: 150,
            temperature: 0.2, // Low temp for highly specific, numbers-driven feedback
            system: ARC_SYSTEM_PROMPT,
            messages: [
                {
                    role: "user",
                    content: `${dynamicContext}\nProvide post-set analysis. Give a quick estimation of RPE, a recommendation for the next set (exact weight/reps), and one quick form cue or note based on the exercise.`
                }
            ]
        });

        const analysisText = response.content[0].text;
        res.json({ analysis: analysisText });
        
    } catch (error) {
        console.error("Claude API Error:", error.message);
        res.status(500).json({ error: error.message, analysis: "- Error fetching A.R.C. response. Please check backend connection." });
    }
});

// POST /api/claude/food-estimate
app.post('/api/claude/food-estimate', async (req, res) => {
    try {
        const { description } = req.body;
        
        const systemPrompt = `You are an expert sports nutritionist AI. The user will give you a natural language description of food. 
Your ONLY job is to output a raw JSON object containing the best estimation of the macros based on standard USDA serving sizes.
DO NOT wrap the JSON in markdown code blocks. OUTPUT ONLY JSON.
Schema: { "name": string, "protein": number, "carbs": number, "fats": number, "calories": number }`;

        const response = await anthropic.messages.create({
            model: "claude-3-5-haiku-latest",
            max_tokens: 200,
            temperature: 0.1,
            system: systemPrompt,
            messages: [{ role: "user", content: description }]
        });

        // The model was strictly instructed to output pure JSON
        const rawJson = response.content[0].text.trim();
        const parsed = JSON.parse(rawJson);
        res.json({ result: parsed });

    } catch (error) {
        console.error("Food parsing error:", error.message);
        res.status(500).json({ error: "Failed to parse macro estimation." });
    }
});

// POST /api/claude/brief
app.post('/api/claude/brief', async (req, res) => {
    try {
        const { hrv, lastSession, totalCalories } = req.body;
        
        const dynamicContext = `
USER STATUS:
- Morning HRV: ${hrv || 'Not provided'}
- Yesterday's session volume: ${lastSession?.volume || 0}kg over ${lastSession?.sets || 0} sets
- Nutrition intake: ${totalCalories || 0} kcals
        `;

        const response = await anthropic.messages.create({
            model: "claude-3-5-sonnet-latest",
            max_tokens: 200,
            temperature: 0.3,
            system: ARC_SYSTEM_PROMPT,
            messages: [
                {
                    role: "user",
                    content: `${dynamicContext}\nGenerate a 3-line daily brief. Line 1: Recovery status. Line 2: Session recommendation. Line 3: Nutrition priority.`
                }
            ]
        });

        res.json({ brief: response.content[0].text });
    } catch (error) {
        res.status(500).json({ brief: "- AI command offline. Awaiting telemetry..." });
    }
});

// POST /api/claude/voice-parse
// Takes FormData containing an audio file. Simulates Whisper mapping, genuinely hits Claude.
app.post('/api/claude/voice-parse', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No audio file provided." });
        }

        // --- Simulated Whisper API Step ---
        // In a true environment, we'd send req.file.buffer to `openai.audio.transcriptions.create()`
        // For the purpose of establishing the architecture, we bypass to a mock transcript.
        // E.g., The user said: "I did an 80kg bench press for 6 reps". 
        // We will hardcode proxy the transcript to test the Anthropic extraction engine identically.

        const mockTranscript = "Yeah so I just hit 6 reps on the barbell bench press, the weight was 80 kg and it felt pretty rough honestly but I got it.";
        
        // --- Anthropic JSON Extraction Step ---
        const extractionPrompt = `You are an expert NLP extraction engine. The user has transcribed an audio log of their workout set. 
Extract the data strictly into the following JSON format.
DO NOT wrap the JSON in markdown code blocks. OUTPUT ONLY JSON.
Schema: { "exercise": string, "weight_kg": number, "reps": number, "feel": string }`;

        const response = await anthropic.messages.create({
            model: "claude-3-5-haiku-latest",
            max_tokens: 200,
            temperature: 0.1,
            system: extractionPrompt,
            messages: [{ role: "user", content: mockTranscript }]
        });

        const rawJson = response.content[0].text.trim();
        const parsedContext = JSON.parse(rawJson);

        res.json({ success: true, payload: parsedContext, debugTranscript: mockTranscript });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/leaderboard/global
app.get('/api/leaderboard/global', async (req, res) => {
    try {
        if (redis.status !== 'ready') {
            return res.status(503).json({ error: "Redis not connected. Leaderboard offline."});
        }
        
        // ZREVRANGE fetches highest scores first
        const topRanks = await redis.zrevrange('global:momentum', 0, 99, 'WITHSCORES');
        const userIds = [];
        const scoreTracker = {};

        for (let i = 0; i < topRanks.length; i += 2) {
            userIds.push(topRanks[i]);
            scoreTracker[topRanks[i]] = Math.round(Number(topRanks[i+1]) / 100);
        }

        // Fetch user metadata from Supabase
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        
        let leaderboard = [];
        if (userIds.length > 0) {
           const { data: usersData, error } = await supabase.from('users').select('id, username').in('id', userIds);
           if (!error && usersData) {
              leaderboard = userIds.map((id, index) => {
                 const userMeta = usersData.find(u => u.id === id);
                 return {
                    rank: index + 1,
                    userId: id,
                    username: userMeta ? userMeta.username : 'Unknown Agent',
                    score: scoreTracker[id] || 0
                 }
              });
           }
        }
        
        res.json({ leaderboard });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/test/trigger-momentum
// Hidden manual trigger to run the weekly math score algorithm off-schedule
app.post('/api/test/trigger-momentum', async (req, res) => {
    try {
        const updates = await calculateScoresForUsers(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        
        // Update Redis cache for fast querying
        if (redis.status === 'ready') {
            const pipeline = redis.pipeline();
            for (const u of updates) {
                // Redis expects integer scores, we multiply by 100 just in case we wanted decimals
                pipeline.zadd('global:momentum', u.momentum_score * 100, u.id);
            }
            await pipeline.exec();
        }

        res.json({ success: true, updatedUsers: updates.length, updates });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Weekly Cron Job - runs every Monday at 00:00 UTC
cron.schedule('0 0 * * 1', async () => {
    console.log("CRON RUN: Weekly Momentum Score Calculation");
    try {
        const updates = await calculateScoresForUsers(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        if (redis.status === 'ready') {
            const pipeline = redis.pipeline();
            for (const u of updates) {
                pipeline.zadd('global:momentum', u.momentum_score * 100, u.id);
            }
            await pipeline.exec();
        }
    } catch(e) {
        console.error("Cron Job Failed:", e.message);
    }
});

app.listen(PORT, () => {
    console.log(`ARC Backend running on http://localhost:${PORT}`);
});
