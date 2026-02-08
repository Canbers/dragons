/**
 * suggestionService.js - Generate categorized action suggestions after each turn.
 * Extracted from gameAgent.js.
 */

const { chatCompletion, GAME_MODEL } = require('./gptService');

/**
 * Generate categorized action suggestions. Returns { categories, flatActions } or null.
 */
async function generateCategorizedSuggestions(enrichedContext, input, fullResponse) {
    try {
        const suggestionMsg = await chatCompletion(GAME_MODEL, [
                {
                    role: "system",
                    content: `You suggest player actions for an RPG, categorized by type. Return ONLY valid JSON, no other text.
Format: {"categories": {"movement": [{"label": "Short Label", "action": "I do something"}], "social": [...], "explore": [...], "combat": [...]}}
Rules:
- 2 actions per RELEVANT category only
- Omit categories with no relevant actions (empty array or omit key)
- Labels: 2-4 words (button text)
- Actions: first-person "I ..." sentences
- movement: going to places, traveling
- social: talking, asking, interacting with people
- explore: examining, investigating, searching
- combat: fighting, attacking, defending
- Be contextually relevant`
                },
                {
                    role: "user",
                    content: `SCENE:\n${enrichedContext}\n\nPLAYER DID: "${input}"\n\nAI RESPONDED: "${fullResponse}"\n\nSuggest categorized actions. Return ONLY JSON.`
                }
            ]);

        const suggestionsText = suggestionMsg?.content;
        if (!suggestionsText) return null;

        let jsonStr = suggestionsText.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonStr = jsonMatch[1].trim();

        const parsed = JSON.parse(jsonStr);
        if (!parsed.categories) return null;

        const categories = parsed.categories;
        const flatActions = [];
        for (const cat of ['social', 'explore', 'movement', 'combat']) {
            if (categories[cat]) {
                flatActions.push(...categories[cat]);
            }
        }
        return { categories, flatActions: flatActions.slice(0, 3) };
    } catch (e) {
        console.error('[GameAgent] Suggestion generation failed (non-critical):', e.message);
        return null;
    }
}

module.exports = { generateCategorizedSuggestions };
