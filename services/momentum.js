const { createClient } = require('@supabase/supabase-js');

// Helper to normalize the score to a 0-1000 scale using a soft sigmoid-like cap
function normalizeScore(rawScore) {
    // rawScore is expected to be roughly around 1.0 (100%) for an average user
    // A score of 1.0 = 500 momentum. 
    const capped = Math.min(Math.max(rawScore, 0), 3); // cap at 300% exceptional
    return Math.round((capped / 3) * 1000);
}

async function calculateScoresForUsers(supabaseUrl, supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log("Triggering Momentum Score Calculation...");

    // Fetch all users
    const { data: users, error: userError } = await supabase.from('users').select('id');
    if (userError) {
        console.error("Failed to fetch users", userError);
        return [];
    }

    const updates = [];

    // For MVP, we calculate manually in a loop. In production, this would be a heavy SQL aggregate view or MapReduce
    for (const user of users) {
        // Fetch last 4 weeks of sessions for this user
        const fourWeeksAgo = new Date();
        fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
        
        const { data: sessions } = await supabase
            .from('sessions')
            .select('id, started_at, total_volume_kg, hrv_at_start')
            .eq('user_id', user.id)
            .gte('started_at', fourWeeksAgo.toISOString());

        if (!sessions || sessions.length === 0) {
            // Apply 3% decay for inactive users
            const { data: userData } = await supabase.from('users').select('momentum_score').eq('id', user.id).single();
            if (userData && userData.momentum_score > 0) {
                 const decayedScore = Math.floor(userData.momentum_score * 0.97);
                 updates.push({ id: user.id, momentum_score: decayedScore });
            }
            continue;
        }

        // Split sessions into "this week" and "prior 3 weeks"
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        
        const sessionsThisWeek = sessions.filter(s => new Date(s.started_at) > oneWeekAgo);
        const sessionsPrior = sessions.filter(s => new Date(s.started_at) <= oneWeekAgo);

        // 1. Consistency Multiplier (25%) -> Cap at 1.5
        const userAvgWeeklySessions = (sessionsPrior.length / 3) || sessionsThisWeek.length; // fallback if new
        const consistencyRatio = userAvgWeeklySessions > 0 ? (sessionsThisWeek.length / userAvgWeeklySessions) : 1;
        const consistencyScore = Math.min(consistencyRatio, 1.5) * 0.25;

        // 2. Volume Delta (20%)
        const volumeThisWeek = sessionsThisWeek.reduce((acc, s) => acc + Number(s.total_volume_kg || 0), 0);
        const volumePriorAvg = (sessionsPrior.reduce((acc, s) => acc + Number(s.total_volume_kg || 0), 0) / 3) || volumeThisWeek;
        const volumeRatio = volumePriorAvg > 0 ? (volumeThisWeek / volumePriorAvg) : 1;
        // if volume drops, ratio is < 1. If increases, > 1.
        const volumeScore = volumeRatio * 0.20;

        // 3. Recovery Adaptation (10%)
        // Rough proxy: if HRV is trending up
        const avgHrvThisWeek = sessionsThisWeek.reduce((acc, s) => acc + Number(s.hrv_at_start || 0), 0) / (sessionsThisWeek.length || 1);
        const avgHrvPrior = sessionsPrior.reduce((acc, s) => acc + Number(s.hrv_at_start || 0), 0) / (sessionsPrior.length || 1);
        const hrvRatio = (avgHrvPrior > 0 && avgHrvThisWeek > avgHrvPrior) ? 1.2 : 0.8;
        const recoveryScore = hrvRatio * 0.10;

        // 4. Strength Delta (35%)
        // Needs a complex Epley diff over exercises. Hardcoding a neutral 1.0 multiplier proxy for the MVP script
        const strengthRatio = 1.05; // assuming a 5% baseline improvement proxy for testing
        const strengthScore = strengthRatio * 0.35;

        // 5. Nutrition (10%)
        // Assuming 100% adherence proxy for MVP test script
        const nutritionScore = 1.0 * 0.10;

        // Sum components
        const rawScore = consistencyScore + volumeScore + recoveryScore + strengthScore + nutritionScore;
        const finalScore = normalizeScore(rawScore);

        updates.push({ id: user.id, momentum_score: finalScore });
    }

    // Bulk update Supabase (Sequential for MVP, switch to RPC bulk for scale)
    for (const update of updates) {
        await supabase.from('users').update({ momentum_score: update.momentum_score }).eq('id', update.id);
    }
    
    return updates;
}

module.exports = { calculateScoresForUsers };
