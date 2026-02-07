/**
 * Quest Service — Organic, player-driven quest system
 *
 * Quests emerge from player behavior:
 *   seed → discovered → active → completed/failed/expired
 *
 * Seeds are generated in the background based on probability.
 * Hooks are woven into narration. Discovery happens when the AI mentions quest elements.
 * Activation is player-initiated ("Track Quest" button).
 */

const Plot = require('../db/models/Plot');
const Quest = require('../db/models/Quest');
const GameLog = require('../db/models/GameLog');
const { simplePrompt } = require('./gptService');

// ============ SEED GENERATION ============

/**
 * Determine whether to generate new quest seeds this turn.
 * Returns true with a probability based on game state.
 */
async function shouldGenerateSeeds(plotId) {
    try {
        const plot = await Plot.findById(plotId);
        if (!plot) return false;

        // Hard skip: combat
        if (plot.current_state?.current_activity === 'in combat') return false;

        const qs = plot.current_state?.questState || {};
        const settlementId = plot.current_state?.current_location?.settlement;
        if (!settlementId) return false;

        // Count existing quests
        const seedsAtSettlement = await Quest.countDocuments({
            world: plot.world,
            settlement: settlementId,
            status: 'seed'
        });
        const activeQuests = await Quest.countDocuments({
            world: plot.world,
            status: 'active'
        });

        // Calculate turns since last seed generation
        const turnCount = plot.current_state?.sceneContext?.turnCount || 0;
        const lastSeedTurn = qs.lastSeedGeneration
            ? Math.max(0, turnCount - 3) // approximate
            : turnCount; // never generated = max boost

        // Base chance: 15%
        let probability = 0.15;

        // Boosters
        probability += Math.min(0.50, lastSeedTurn * 0.10); // +10% per turn since last, cap +50%
        if (activeQuests === 0) probability += 0.15;

        // Check if player just moved (turnCount === 0 or 1 means fresh location)
        if (turnCount <= 1) probability += 0.10;

        // Dampeners
        probability -= seedsAtSettlement * 0.10;
        probability -= activeQuests * 0.15;
        if (qs.lastSeedGeneration) {
            const msSinceLast = Date.now() - new Date(qs.lastSeedGeneration).getTime();
            if (msSinceLast < 60000) probability -= 0.20; // < 1 min ago (roughly 3 turns)
        }

        // Clamp
        probability = Math.max(0.05, Math.min(0.85, probability));

        const roll = Math.random();
        console.log(`[Quest] shouldGenerateSeeds: prob=${(probability * 100).toFixed(0)}%, roll=${(roll * 100).toFixed(0)}%, seeds@settlement=${seedsAtSettlement}, active=${activeQuests}`);
        return roll < probability;
    } catch (e) {
        console.error('[Quest] shouldGenerateSeeds error:', e.message);
        return false;
    }
}

/**
 * Generate 1-2 quest seeds via GPT, save to DB, link to Plot.
 */
async function generateQuestSeeds(plotId) {
    const plot = await Plot.findById(plotId)
        .populate('current_state.current_location.region')
        .populate('current_state.current_location.settlement');

    if (!plot) return [];

    const settlement = plot.current_state?.current_location?.settlement;
    const region = plot.current_state?.current_location?.region;
    if (!settlement) return [];

    // Get recent messages for context
    const logs = await GameLog.find({ plotId }).sort({ _id: -1 }).limit(2);
    const recentMessages = [];
    for (const log of logs) {
        for (const msg of log.messages) {
            recentMessages.push(`${msg.author}: ${msg.content.substring(0, 200)}`);
        }
    }
    const recentContext = recentMessages.slice(-10).join('\n');

    // Get existing quest titles to avoid duplicates
    const existingQuests = await Quest.find({ world: plot.world }).select('questTitle');
    const existingTitles = existingQuests.map(q => q.questTitle).filter(Boolean);

    const prompt = `You are creating quest seeds for an RPG with an "Indifferent World" philosophy — the world doesn't revolve around the player. Quests emerge from the world's own problems.

SETTLEMENT: ${settlement.name} — ${settlement.description?.substring(0, 300) || 'a settlement'}
REGION: ${region?.name || 'Unknown'} — ${region?.description?.substring(0, 200) || ''}
RECENT PLAYER ACTIVITY:
${recentContext || 'Player just arrived.'}

EXISTING QUESTS (avoid duplicates): ${existingTitles.join(', ') || 'none'}

Generate 1-2 quest seeds. Each quest should:
- Emerge from the settlement's own problems or conflicts (NOT from the player)
- Have 2-3 hook variants (ways the narrator can subtly hint at the quest)
- Have 2-3 objectives (steps to complete the quest)
- Be completable through multiple approaches (combat, diplomacy, cunning)
- Feel grounded and logical — no "chosen one" tropes

Hook types: rumor (overheard gossip), observation (something the player notices), npc_mention (an NPC brings it up), environmental (something in the environment hints at it)

Return JSON:
{
    "quests": [
        {
            "title": "The Missing Shipments",
            "description": "Trade goods bound for the settlement have been disappearing along the northern road.",
            "hooks": [
                { "text": "A merchant grumbles about another missing wagon, the third this month.", "type": "rumor" },
                { "text": "You notice the market stalls are sparse — fewer goods than you'd expect for a settlement this size.", "type": "observation" }
            ],
            "objectives": [
                { "description": "Learn about the missing shipments from locals", "status": "unknown" },
                { "description": "Investigate the northern road", "status": "unknown" },
                { "description": "Deal with the cause of the disappearances", "status": "unknown" }
            ],
            "keyActors": [{ "name": "Merchant Harlow", "role": "Quest giver" }]
        }
    ]
}`;

    try {
        const result = await simplePrompt('gpt-5-mini',
            'You create RPG quest seeds as JSON. Return valid JSON only.',
            prompt
        );

        let jsonContent = result.content;
        const jsonMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonContent = jsonMatch[1].trim();

        const parsed = JSON.parse(jsonContent);
        const quests = parsed.quests || [];
        if (!Array.isArray(quests) || quests.length === 0) return [];

        const created = [];
        for (const q of quests.slice(0, 2)) {
            const quest = new Quest({
                world: plot.world,
                settlement: settlement._id,
                questTitle: q.title,
                description: q.description,
                status: 'seed',
                hooks: (q.hooks || []).map(h => ({
                    text: h.text,
                    type: ['rumor', 'observation', 'npc_mention', 'environmental'].includes(h.type) ? h.type : 'rumor',
                    delivered: false
                })),
                objectives: (q.objectives || []).map((obj, i) => ({
                    id: `obj_${i}`,
                    description: obj.description,
                    status: 'unknown',
                    isCurrent: i === 0
                })),
                keyActors: {
                    primary: (q.keyActors || []).map(a => ({ name: a.name, role: a.role })),
                    secondary: []
                },
                currentSummary: q.description
            });

            await quest.save();

            // Link to plot
            plot.quests.push({
                quest: quest._id,
                questTitle: quest.questTitle,
                questStatus: 'seed',
                notes: []
            });

            created.push(quest);
            console.log(`[Quest] Seed created: "${quest.questTitle}" at ${settlement.name}`);
        }

        // Update quest state
        if (!plot.current_state.questState) {
            plot.current_state.questState = {};
        }
        plot.current_state.questState.lastSeedGeneration = new Date();
        plot.current_state.questState.seedSettlement = settlement._id;
        await plot.save();

        return created;
    } catch (e) {
        console.error('[Quest] generateQuestSeeds failed:', e.message);
        return [];
    }
}

// ============ HOOK DELIVERY ============

/**
 * Get a hook snippet for the narrator to weave into the current response.
 * Returns null if no hook is appropriate right now.
 */
async function getHooksForNarrative(plotId) {
    try {
        const plot = await Plot.findById(plotId);
        if (!plot) return null;

        const qs = plot.current_state?.questState || {};
        const turnsSinceHook = qs.turnsSinceLastHook || 0;

        // Rate limit: at least 3 turns between hooks
        if (turnsSinceHook < 3) {
            // Increment counter
            if (!plot.current_state.questState) plot.current_state.questState = {};
            plot.current_state.questState.turnsSinceLastHook = turnsSinceHook + 1;
            await plot.save();
            return null;
        }

        const settlementId = plot.current_state?.current_location?.settlement;
        if (!settlementId) return null;

        // Find seed quests at current settlement with undelivered hooks
        const seedQuests = await Quest.find({
            world: plot.world,
            settlement: settlementId,
            status: 'seed',
            'hooks.delivered': false
        });

        if (seedQuests.length === 0) return null;

        // Pick a random quest and its first undelivered hook
        const quest = seedQuests[Math.floor(Math.random() * seedQuests.length)];
        const hook = quest.hooks.find(h => !h.delivered);
        if (!hook) return null;

        // Reset counter (will be set back to 0 when hook is delivered)
        if (!plot.current_state.questState) plot.current_state.questState = {};
        plot.current_state.questState.turnsSinceLastHook = 0;
        await plot.save();

        return hook.text;
    } catch (e) {
        console.error('[Quest] getHooksForNarrative error:', e.message);
        return null;
    }
}

// ============ QUEST DISCOVERY ============

/**
 * Check if the AI's narrative response mentions elements from seed quests.
 * If so, transition seed → discovered and return newly discovered quests.
 */
async function detectQuestDiscovery(plotId, aiResponse) {
    try {
        const plot = await Plot.findById(plotId);
        if (!plot) return [];

        const settlementId = plot.current_state?.current_location?.settlement;
        if (!settlementId) return [];

        const seedQuests = await Quest.find({
            world: plot.world,
            settlement: settlementId,
            status: 'seed'
        });

        if (seedQuests.length === 0) return [];

        const responseLower = aiResponse.toLowerCase();
        const discovered = [];

        for (const quest of seedQuests) {
            let matched = false;

            // Check if any key actor names appear in the response
            const actorNames = [
                ...(quest.keyActors?.primary || []).map(a => a.name),
                ...(quest.keyActors?.secondary || []).map(a => a.name)
            ].filter(Boolean);

            for (const name of actorNames) {
                if (name && responseLower.includes(name.toLowerCase())) {
                    matched = true;
                    break;
                }
            }

            // Check if hook text appears (fuzzy: check key words)
            if (!matched) {
                for (const hook of (quest.hooks || [])) {
                    if (!hook.text) continue;
                    // Extract meaningful words (>4 chars) from hook
                    const words = hook.text.toLowerCase().split(/\s+/).filter(w => w.length > 4);
                    const matchCount = words.filter(w => responseLower.includes(w)).length;
                    if (matchCount >= 3) {
                        matched = true;
                        // Mark hook as delivered
                        hook.delivered = true;
                        hook.deliveredAt = new Date();
                        break;
                    }
                }
            }

            // Check quest title keywords
            if (!matched && quest.questTitle) {
                const titleWords = quest.questTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                const titleMatchCount = titleWords.filter(w => responseLower.includes(w)).length;
                if (titleMatchCount >= 2 || (titleWords.length === 1 && titleMatchCount === 1)) {
                    matched = true;
                }
            }

            if (matched) {
                quest.status = 'discovered';
                // Set first objective to known
                if (quest.objectives.length > 0) {
                    quest.objectives[0].status = 'known';
                    quest.objectives[0].isCurrent = true;
                }
                await quest.save();

                // Sync status in plot
                const plotQuest = plot.quests.find(q => q.quest?.toString() === quest._id.toString());
                if (plotQuest) {
                    plotQuest.questStatus = 'discovered';
                }

                discovered.push({
                    id: quest._id.toString(),
                    title: quest.questTitle,
                    description: quest.description,
                    status: 'discovered'
                });

                console.log(`[Quest] Discovered: "${quest.questTitle}"`);
            }
        }

        if (discovered.length > 0) {
            await plot.save();
        }

        return discovered;
    } catch (e) {
        console.error('[Quest] detectQuestDiscovery error:', e.message);
        return [];
    }
}

// ============ QUEST ACTIVATION ============

/**
 * Player clicked "Track Quest" — transition discovered → active.
 */
async function activateQuest(plotId, questId) {
    const plot = await Plot.findById(plotId);
    if (!plot) return { success: false, error: 'Plot not found' };

    const quest = await Quest.findById(questId);
    if (!quest) return { success: false, error: 'Quest not found' };

    if (quest.status !== 'discovered') {
        return { success: false, error: `Quest is ${quest.status}, not discovered` };
    }

    quest.status = 'active';
    // Set first unknown objective to in_progress
    for (const obj of quest.objectives) {
        if (obj.isCurrent && (obj.status === 'unknown' || obj.status === 'known')) {
            obj.status = 'in_progress';
            break;
        }
    }
    await quest.save();

    // Update plot
    plot.activeQuest = quest._id;
    const plotQuest = plot.quests.find(q => q.quest?.toString() === questId);
    if (plotQuest) {
        plotQuest.questStatus = 'active';
    }
    await plot.save();

    console.log(`[Quest] Activated: "${quest.questTitle}"`);
    return { success: true, quest: { id: quest._id, title: quest.questTitle, status: 'active' } };
}

// ============ QUEST PROGRESS (AI tool) ============

/**
 * Called by the AI's update_quest tool during gameplay.
 */
async function updateQuestProgress(plotId, questTitle, updateType, summary) {
    const plot = await Plot.findById(plotId);
    if (!plot) return { success: false, error: 'Plot not found' };

    // Fuzzy title match across plot's quests
    const titleLower = questTitle.toLowerCase();
    const plotQuest = plot.quests.find(q => {
        if (!q.questTitle) return false;
        const qt = q.questTitle.toLowerCase();
        return qt === titleLower || qt.includes(titleLower) || titleLower.includes(qt);
    });

    if (!plotQuest) return { success: false, error: `Quest "${questTitle}" not found` };

    const quest = await Quest.findById(plotQuest.quest);
    if (!quest) return { success: false, error: 'Quest document not found' };

    // Append progression
    quest.progression.push({ summary, timestamp: new Date() });
    quest.currentSummary = summary;

    switch (updateType) {
        case 'objective_complete': {
            // Mark current objective as completed, advance to next
            const current = quest.objectives.find(o => o.isCurrent);
            if (current) {
                current.status = 'completed';
                current.isCurrent = false;
            }
            // Find next unknown/known objective
            const next = quest.objectives.find(o => o.status === 'unknown' || o.status === 'known');
            if (next) {
                next.status = 'in_progress';
                next.isCurrent = true;
            }
            break;
        }
        case 'quest_complete':
            quest.status = 'completed';
            plotQuest.questStatus = 'completed';
            // Mark all remaining objectives complete
            quest.objectives.forEach(o => {
                if (o.status !== 'failed') o.status = 'completed';
                o.isCurrent = false;
            });
            break;
        case 'quest_failed':
            quest.status = 'failed';
            plotQuest.questStatus = 'failed';
            quest.objectives.forEach(o => {
                o.isCurrent = false;
            });
            break;
        case 'new_info':
            // Just the progression append is sufficient
            break;
    }

    await quest.save();
    await plot.save();

    console.log(`[Quest] Updated "${quest.questTitle}": ${updateType} — ${summary}`);
    return {
        success: true,
        quest: {
            id: quest._id.toString(),
            title: quest.questTitle,
            status: quest.status,
            updateType
        }
    };
}

// ============ CONTEXT FOR NARRATIVE PROMPT ============

/**
 * Build a text block of quest context to inject into the narrative prompt.
 */
async function getQuestContext(plotId) {
    const plot = await Plot.findById(plotId);
    if (!plot) return '';

    const questIds = plot.quests
        .filter(q => q.questStatus === 'active' || q.questStatus === 'discovered')
        .map(q => q.quest);

    if (questIds.length === 0) return '';

    const quests = await Quest.find({ _id: { $in: questIds } });
    if (quests.length === 0) return '';

    const parts = [];
    for (const quest of quests) {
        if (quest.status === 'active') {
            const currentObj = quest.objectives.find(o => o.isCurrent);
            const lastProg = quest.progression.length > 0
                ? quest.progression[quest.progression.length - 1].summary
                : null;
            let line = `ACTIVE QUEST: "${quest.questTitle}"`;
            if (currentObj) line += ` — Current objective: ${currentObj.description}`;
            if (lastProg) line += ` — Last update: ${lastProg}`;
            parts.push(line);
        } else if (quest.status === 'discovered') {
            parts.push(`KNOWN LEAD: "${quest.questTitle}" — ${quest.description?.substring(0, 150) || ''}`);
        }
    }

    return parts.length > 0 ? '\nQUEST CONTEXT:\n' + parts.join('\n') + '\n' : '';
}

// ============ JOURNAL ENDPOINT ============

/**
 * Return all quests visible to the player (status !== 'seed').
 */
async function getJournalQuests(plotId) {
    const plot = await Plot.findById(plotId);
    if (!plot) return [];

    const questIds = plot.quests.map(q => q.quest);
    if (questIds.length === 0) return [];

    const quests = await Quest.find({
        _id: { $in: questIds },
        status: { $ne: 'seed' }
    }).sort({ updatedAt: -1 });

    return quests.map(q => ({
        id: q._id.toString(),
        title: q.questTitle,
        description: q.description,
        status: q.status,
        currentSummary: q.currentSummary,
        objectives: q.objectives,
        progression: q.progression.slice(-5), // last 5 entries
        keyActors: q.keyActors
    }));
}

// ============ EXPIRATION ============

/**
 * Expire stale quests. Called on area transitions.
 */
async function expireStaleQuests(plotId) {
    try {
        const plot = await Plot.findById(plotId);
        if (!plot) return;

        const turnCount = plot.current_state?.sceneContext?.turnCount || 0;

        // Find old seeds (linked to this plot's world)
        const staleSeeds = await Quest.find({
            world: plot.world,
            status: 'seed',
            createdAt: { $lt: new Date(Date.now() - 1000 * 60 * 60 * 24) } // >24h old
        });

        for (const quest of staleSeeds) {
            quest.status = 'expired';
            await quest.save();

            const plotQuest = plot.quests.find(q => q.quest?.toString() === quest._id.toString());
            if (plotQuest) plotQuest.questStatus = 'expired';

            console.log(`[Quest] Expired stale seed: "${quest.questTitle}"`);
        }

        if (staleSeeds.length > 0) {
            await plot.save();
        }
    } catch (e) {
        console.error('[Quest] expireStaleQuests error:', e.message);
    }
}

module.exports = {
    shouldGenerateSeeds,
    generateQuestSeeds,
    getHooksForNarrative,
    detectQuestDiscovery,
    activateQuest,
    updateQuestProgress,
    getQuestContext,
    getJournalQuests,
    expireStaleQuests
};
