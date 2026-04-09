const { createClient } = require('@supabase/supabase-js');

async function evaluateSetMedals(supabaseUrl, supabaseKey, userId, exercise, weight) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // Fetch User's current unlocked medals
        const { data: userMedals } = await supabase
            .from('user_medals')
            .select('medal_id, medals(requirement_tag)')
            .eq('user_id', userId);

        const unlockedTags = userMedals ? userMedals.map(um => um.medals.requirement_tag) : [];
        const newAwards = [];

        // Check Century Club (100+ kg lift)
        if (weight >= 100 && !unlockedTags.includes('100kg_club')) {
            const { data: medal } = await supabase.from('medals').select('id').eq('requirement_tag', '100kg_club').single();
            if (medal) {
                await supabase.from('user_medals').insert({ user_id: userId, medal_id: medal.id });
                newAwards.push('Century Club');
            }
        }

        // Check First Workout
        if (!unlockedTags.includes('first_workout')) {
            const { data: medal } = await supabase.from('medals').select('id').eq('requirement_tag', 'first_workout').single();
            if (medal) {
                await supabase.from('user_medals').insert({ user_id: userId, medal_id: medal.id });
                newAwards.push('First Blood');
            }
        }

        if (newAwards.length > 0) {
            console.log(`[Medals] User ${userId} unlocked: ${newAwards.join(', ')}`);
        }

    } catch (e) {
        console.error("Medal evaluation failed", e.message);
    }
}

module.exports = { evaluateSetMedals };
