/**
 * toolFormatters.js - Pure functions for human-readable tool call/result formatting.
 * Extracted from gameAgent.js.
 */

function getToolDisplay(toolName, args) {
    switch (toolName) {
        case 'get_scene': return 'Observing the scene...';
        case 'lookup_npc': return `Recalling ${args.name || 'character'}...`;
        case 'move_player': return `Moving to ${args.destination || 'location'}...`;
        case 'update_npc_relationship': return `Noting reaction from ${args.npc_name || 'NPC'}...`;
        case 'skill_check': return `Rolling for ${args.type || 'skill'} check...`;
        case 'update_quest': return `Updating quest progress...`;
        default: return 'Thinking...';
    }
}

function formatToolResult(toolName, result) {
    switch (toolName) {
        case 'get_scene': {
            const popHints = {
                crowded: 'crowded — many ambient people naturally present, new NPCs appropriate',
                populated: 'populated — staff and regulars expected, new NPCs appropriate to location OK',
                sparse: 'sparse — few people around, only introduce NPCs with a clear world-logic reason',
                isolated: 'isolated — no one here unless listed below, do NOT create or invent NPCs'
            };
            let scene = `CURRENT SCENE: ${result.location}${result.locationType ? ' (' + result.locationType + ')' : ''} in ${result.settlement || 'the wilds'}`;
            scene += `\nPOPULATION: ${popHints[result.populationLevel] || popHints.populated}`;
            scene += `\n${result.description}`;
            scene += `\nTime: ${result.timeOfDay}`;
            if (result.exits?.length > 0) {
                scene += `\nEXITS: ${result.exits.map(e => `${e.direction}: ${e.name}${e.via ? ' — ' + e.via : ''}`).join('; ')}`;
            }
            if (result.npcsPresent?.length > 0) {
                scene += `\nPEOPLE HERE: ${result.npcsPresent.map(n => {
                    let entry = n.name;
                    if (n.description) entry += ` — ${n.description}`;
                    if (n.disposition) entry += ` [disposition: ${n.disposition}]`;
                    return entry;
                }).join('; ')}`;
            }
            if (result.objects?.length > 0) {
                scene += `\nNOTABLE OBJECTS: ${result.objects.map(o => `${o.name} (${o.type})`).join('; ')}`;
            }
            return scene;
        }

        case 'lookup_npc':
            if (!result.found) return `NPC "${result.name}": Not previously encountered. This is a new character.`;
            {
                let npc = `NPC: ${result.name}`;
                npc += `\nAttitude toward player: ${result.disposition}`;
                npc += `\nLast interaction: ${result.lastInteraction}`;
                if (result.description) npc += `\nDescription: ${result.description}`;
                if (result.interactionCount > 0) npc += `\nTimes spoken to: ${result.interactionCount}`;
                return npc;
            }

        case 'move_player':
            if (!result.success) return `MOVEMENT BLOCKED: ${result.reason}`;
            return `MOVED TO: ${result.newLocation}\n${result.narration}`;

        case 'update_npc_relationship':
            return `RELATIONSHIP UPDATED: ${result.npc} is now ${result.disposition}`;

        case 'skill_check':
            if (result.result === 'fail') {
                return `SKILL CHECK FAILED (${result.type}, ${result.difficulty}: rolled ${result.roll}, needed ${result.minPass}). The action "${result.action}" FAILS. Describe a proportionate consequence — not catastrophic, but clearly unsuccessful.`;
            } else if (result.result === 'strong_success') {
                return `STRONG SUCCESS (${result.type}, ${result.difficulty}: rolled ${result.roll}, needed ${result.strongPass}+). The action "${result.action}" succeeds impressively. Describe a bonus outcome or extra benefit.`;
            } else {
                return `SKILL CHECK PASSED (${result.type}, ${result.difficulty}: rolled ${result.roll}, needed ${result.minPass}). The action "${result.action}" succeeds adequately. Nothing remarkable, just competent execution.`;
            }

        case 'update_quest':
            if (!result.success) return `QUEST UPDATE FAILED: ${result.error}`;
            return `QUEST UPDATED: "${result.quest.title}" — ${result.quest.updateType}. Status: ${result.quest.status}`;

        default:
            return JSON.stringify(result);
    }
}

module.exports = { getToolDisplay, formatToolResult };
