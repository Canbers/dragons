/**
 * npcContextService.js - Shared NPC context builder for AI prompts.
 *
 * Used by Tier 1 (fastActionService) and Tier 2/3 (gameAgent/toolFormatters)
 * to produce rich, consistent NPC context for GPT prompts.
 */

const Plot = require('../db/models/Plot');
const Poi = require('../db/models/Poi');

/**
 * Build a prompt-ready text block from a POI doc + optional reputation entry.
 * Gracefully handles null fields — omits anything missing.
 *
 * @param {Object} npc - POI document
 * @param {Object} [repNpc] - Reputation entry from plot.reputation.npcs[]
 * @returns {string}
 */
function buildNpcPromptContext(npc, repNpc) {
    const lines = [];

    lines.push(`Name: ${npc.name}`);
    if (npc.profession) lines.push(`Role: ${npc.profession}`);
    if (npc.personality) lines.push(`Personality: ${npc.personality}`);
    else if (npc.disposition) lines.push(`Disposition: ${npc.disposition}`);
    if (npc.description) lines.push(`Appearance: ${npc.description}`);
    if (npc.goal) lines.push(`Wants: ${npc.goal}`);
    if (npc.problem) lines.push(`Problem: ${npc.problem}`);

    const disposition = repNpc?.disposition || 'neutral';
    lines.push(`Attitude toward player: ${disposition}`);

    if (repNpc?.lastInteraction) {
        lines.push(`Last interaction: ${repNpc.lastInteraction}`);
    }

    const timesmet = npc.interactionCount || 0;
    if (timesmet > 0) {
        lines.push(`Times met: ${timesmet}`);
    }

    return lines.join('\n');
}

/**
 * Query POI + Plot reputation, return full context for a named NPC.
 *
 * @param {string} npcName
 * @param {string} settlementId
 * @param {string} locationId
 * @param {string} plotId
 * @returns {Promise<{npc: Object, context: string}|null>}
 */
async function getDetailedNpcContext(npcName, settlementId, locationId, plotId) {
    const npc = await Poi.findOne({
        settlement: settlementId,
        locationId,
        type: 'npc',
        name: { $regex: new RegExp(npcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
    });

    if (!npc) return null;

    const plot = await Plot.findById(plotId);
    const repNpc = (plot?.reputation?.npcs || []).find(n =>
        n.name.toLowerCase().includes(npc.name.toLowerCase())
    );

    return {
        npc,
        context: buildNpcPromptContext(npc, repNpc)
    };
}

/**
 * Format location tensions as prompt text.
 *
 * @param {Array} tensions - location.tensions[]
 * @returns {string}
 */
function formatTensions(tensions) {
    if (!tensions || tensions.length === 0) return '';

    const lines = tensions.map(t => {
        let line = `- ${t.description} [${t.severity || 'simmering'}]`;
        if (t.involvedNpcs?.length > 0) {
            line += ` (involves: ${t.involvedNpcs.join(', ')})`;
        }
        return line;
    });

    return `Location tensions:\n${lines.join('\n')}`;
}

module.exports = { buildNpcPromptContext, getDetailedNpcContext, formatTensions };
