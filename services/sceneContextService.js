/**
 * sceneContextService.js - Background scene context updates after each turn.
 * Extracted from gameAgent.js (updateSceneContextBackground + NPC reactive movement).
 */

const Plot = require('../db/models/Plot');
const Poi = require('../db/models/Poi');
const { simplePrompt, UTILITY_MODEL } = require('./gptService');
const sceneGridService = require('./sceneGridService');
const spatialService = require('./spatialService');

/**
 * Update scene context in the background. Fire-and-forget — does not block the player response.
 */
async function updateSceneContextBackground(plotId, prevContext, enrichedContext, input, fullResponse) {
    try {
        const sceneUpdatePrompt = `You are tracking scene state for an RPG. Analyze what just happened and return updated scene context as JSON.

PREVIOUS SCENE CONTEXT:
${JSON.stringify(prevContext)}

TOOL RESULTS (what the game world knows):
${enrichedContext}

PLAYER INPUT: "${input}"

AI NARRATIVE RESPONSE:
${fullResponse}

Return a JSON object with these fields:
{
  "summary": "1-2 sentence factual summary of the current scene situation",
  "tension": one of "calm", "cautious", "tense", "hostile", "critical",
  "npcsPresent": [{"name": "string", "status": one of "engaged"/"observing"/"leaving"/"hostile"/"unconscious"/"fled"/"dead", "attitude": one of "friendly"/"neutral"/"wary"/"hostile"/"terrified", "intent": "brief description of what they want to do next"}],
  "activeEvents": ["ongoing situations like 'bar fight' or 'guard patrol'"],
  "playerGoal": "what the player seems to be trying to do",
  "recentOutcomes": ["last 1-3 notable outcomes, include skill check results"]
}

Rules:
- Only include NPCs actually present in the scene (not fled/dead ones)
- recentOutcomes max 3 entries, newest first. Include skill check results verbatim (e.g. "Intimidation check: rolled 19, strong success")
- Be factual, not dramatic. "Player succeeded intimidation, guard is terrified" not "a bone-chilling display of power"
- Tension should reflect the actual mood: successful intimidation of a hostile NPC = tension might DROP (threat neutralized), failed attack = tension RISES
- playerGoal: infer from context, keep brief`;

        const sceneResult = await simplePrompt(UTILITY_MODEL,
            'You track RPG scene state. Return valid JSON only.',
            sceneUpdatePrompt
        );

        let sceneJson = sceneResult.content;
        const jsonMatch = sceneJson.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) sceneJson = jsonMatch[1].trim();

        const parsed = JSON.parse(sceneJson);

        const validTensions = ['calm', 'cautious', 'tense', 'hostile', 'critical'];
        const validStatuses = ['engaged', 'observing', 'leaving', 'hostile', 'unconscious', 'fled', 'dead'];
        const validAttitudes = ['friendly', 'neutral', 'wary', 'hostile', 'terrified'];

        const sanitized = {
            summary: (parsed.summary || '').substring(0, 500),
            tension: validTensions.includes(parsed.tension) ? parsed.tension : 'calm',
            npcsPresent: (parsed.npcsPresent || [])
                .filter(n => n.name && !['fled', 'dead'].includes(n.status))
                .slice(0, 10)
                .map(n => ({
                    name: (n.name || '').substring(0, 100),
                    status: validStatuses.includes(n.status) ? n.status : 'observing',
                    attitude: validAttitudes.includes(n.attitude) ? n.attitude : 'neutral',
                    intent: (n.intent || '').substring(0, 200)
                })),
            activeEvents: (parsed.activeEvents || []).slice(0, 5).map(e => (e || '').substring(0, 200)),
            playerGoal: (parsed.playerGoal || '').substring(0, 300),
            recentOutcomes: (parsed.recentOutcomes || []).slice(0, 3).map(o => (o || '').substring(0, 300)),
            turnCount: (prevContext.turnCount || 0) + 1
        };

        // Use atomic $set to avoid overwriting gridPosition (this runs fire-and-forget,
        // concurrent with updateGridPositions which also saves to the same Plot)
        await Plot.findByIdAndUpdate(plotId, {
            $set: { 'current_state.sceneContext': sanitized }
        });
        const scPlot = await Plot.findById(plotId)
            .populate('current_state.current_location.settlement');

        console.log(`[GameAgent] Scene context updated: tension=${sanitized.tension}, ${sanitized.npcsPresent.length} NPCs, turn ${sanitized.turnCount}`);

        // ---- NPC reactive grid movement based on scene context changes ----
        await updateNpcGridMovement(scPlot, prevContext, sanitized);

    } catch (sceneError) {
        console.error('[GameAgent] Scene context update failed (non-critical):', sceneError.message);
    }
}

/**
 * NPC reactive grid movement based on scene context changes (arrivals, departures, leaving).
 */
async function updateNpcGridMovement(scPlot, prevContext, sanitized) {
    try {
        const scSettlement = scPlot.current_state?.current_location?.settlement;
        const scLocId = scPlot.current_state?.current_location?.locationId;
        if (!scSettlement || !scLocId) return;

        const scLoc = scSettlement.locations?.find(l => l._id.toString() === scLocId.toString());
        if (!scLoc?.gridGenerated || !scLoc.interiorGrid) return;

        const prevNames = new Set((prevContext.npcsPresent || []).map(n => n.name.toLowerCase()));
        const currNames = new Set(sanitized.npcsPresent.map(n => n.name.toLowerCase()));

        // NPCs that left: clear their grid position
        const departed = [...prevNames].filter(n => !currNames.has(n));
        if (departed.length > 0) {
            for (const name of departed) {
                await Poi.updateMany(
                    { settlement: scSettlement._id, locationId: scLoc._id, type: 'npc',
                      name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
                    { $unset: { 'gridPosition.x': '', 'gridPosition.y': '' } }
                );
            }
            console.log(`[GridMovement] NPCs departed: ${departed.join(', ')}`);
        }

        // NPCs that arrived: ensure they have a grid position (from ambient or door)
        const arrived = [...currNames].filter(n => !prevNames.has(n));
        if (arrived.length > 0) {
            for (const name of arrived) {
                const poi = await Poi.findOne({
                    settlement: scSettlement._id, locationId: scLoc._id,
                    name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
                });
                if (poi && poi.gridPosition?.x == null) {
                    if (scLoc.ambientNpcs?.length > 0) {
                        const amb = scLoc.ambientNpcs[0];
                        poi.gridPosition = { x: amb.x, y: amb.y };
                        await poi.save();
                        scLoc.ambientNpcs.pull(amb._id);
                        await scSettlement.save();
                        console.log(`[GridMovement] NPC arrived (from ambient): ${poi.name} at (${amb.x},${amb.y})`);
                    } else {
                        const doors = sceneGridService.findDoors(scLoc.interiorGrid);
                        if (doors.length > 0) {
                            poi.gridPosition = { x: doors[0].x, y: doors[0].y };
                            await poi.save();
                            console.log(`[GridMovement] NPC arrived (at door): ${poi.name} at (${doors[0].x},${doors[0].y})`);
                        }
                    }
                }
            }
        }

        // NPCs with "leaving" status: move them toward nearest door
        for (const npc of sanitized.npcsPresent) {
            if (npc.status !== 'leaving') continue;
            const poi = await Poi.findOne({
                settlement: scSettlement._id, locationId: scLoc._id, type: 'npc',
                name: { $regex: new RegExp(`^${npc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
                'gridPosition.x': { $ne: null }
            });
            if (!poi) continue;

            const doors = sceneGridService.findDoors(scLoc.interiorGrid);
            if (doors.length === 0) continue;

            doors.sort((a, b) => {
                const da = spatialService.manhattanDistance(poi.gridPosition.x, poi.gridPosition.y, a.x, a.y);
                const db = spatialService.manhattanDistance(poi.gridPosition.x, poi.gridPosition.y, b.x, b.y);
                return da - db;
            });

            const occupied = new Set();
            const allPois = await Poi.find({ settlement: scSettlement._id, locationId: scLoc._id, 'gridPosition.x': { $ne: null } });
            for (const p of allPois) occupied.add(`${p.gridPosition.x},${p.gridPosition.y}`);

            occupied.delete(`${poi.gridPosition.x},${poi.gridPosition.y}`);
            let pos = { ...poi.gridPosition };
            for (let i = 0; i < 3; i++) {
                const step = sceneGridService.stepToward(scLoc.interiorGrid, pos, doors[0], occupied);
                if (!step) break;
                occupied.delete(`${pos.x},${pos.y}`);
                pos = step;
                occupied.add(`${pos.x},${pos.y}`);
            }
            if (pos.x !== poi.gridPosition.x || pos.y !== poi.gridPosition.y) {
                poi.gridPosition = { x: pos.x, y: pos.y };
                await poi.save();
                console.log(`[GridMovement] NPC leaving: ${poi.name} moved toward door → (${pos.x},${pos.y})`);
            }
        }
    } catch (gridErr) {
        console.error('[GridMovement] NPC reactive movement failed (non-critical):', gridErr.message);
    }
}

module.exports = { updateSceneContextBackground };
