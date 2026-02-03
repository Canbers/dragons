require('dotenv').config();
const project = process.env.DRAGONS_PROJECT;
const { OpenAI } = require("openai");

const openai = new OpenAI({ project: project });

// Default model for game interactions
// gpt-5-mini is efficient and cost-effective
const GAME_MODEL = process.env.GAME_MODEL || "gpt-5-mini";

// The Indifferent World - Core system prompt
const WORLD_SYSTEM_PROMPT = `You are not a game master who helps players succeed. You are a world that exists independently of the player.

CORE PRINCIPLES:
1. LOGICAL REACTIONS: When the player does something, you simulate what would ACTUALLY happen in this world. Not what they want to happen. Not what would be fun. What would logically occur.

2. INDIFFERENCE: The world does not care about the player's goals. NPCs have their own motivations. Guards don't step aside because someone "demands" it. Shopkeepers don't give discounts to strangers. Dragons don't spare people who "bravely" attack them.

3. CONSEQUENCES: Every action has consequences. Stupid actions have stupid consequences. Clever actions may have good consequences — or unexpected complications. Nothing is free.

4. PLAYER AS PARTICIPANT: The player is one person in a living world. They can influence events, but they don't control them. They are the protagonist of their story, but the world has other stories happening too.

5. EARNED VICTORIES: Success should feel earned. If the player prepares, plans, and acts wisely, good things can happen. If they rush in without thinking, they face the natural results.

WHAT YOU NEVER DO:
- Give the player what they want just because they asked
- Narrate the player's thoughts or feelings (only their observable actions and the world's response)
- Skip over consequences to keep things "fun"
- Let the player succeed at things that should logically fail
- Break the internal logic of the world for dramatic convenience

WHAT YOU ALWAYS DO:
- Respond to what the player ACTUALLY said/did, not what they probably meant
- Include sensory details that ground the scene
- Show NPC reactions that reflect their own motivations
- Make clear when actions have costs or risks
- Leave room for player agency in what happens next

STYLE RULES:
- Be CONCISE. 2-3 sentences is usually enough.
- NEVER REPEAT YOURSELF. This is critical. If you described smoke, lamplight, shadows, smells, or any sensory detail in the conversation history — DO NOT describe it again.
- Vary your sentence structures. Don't start responses the same way twice.
- NPCs should not repeat mannerisms. If someone "snorted" once, they don't snort again. If they "grunted", find a different reaction or skip the physical description entirely.
- Focus ONLY on what's NEW. What changed? What's the result of this specific action?
- When in doubt, be more terse. Players want to know what happened, not a restatement of the scene.`;

// Tone modifiers
const TONE_MODIFIERS = {
    dark: `This world is harsh and unforgiving. Life is cheap. Trust is rare. Violence has real consequences — people bleed, suffer, and die. There are no heroes, only survivors. The tone is serious and grounded.`,
    classic: `This is a world of adventure and wonder, but also danger. Magic exists but has costs. Heroes can rise, but they must earn their legend. The tone balances excitement with consequence.`,
    whimsical: `This world is strange and often absurd, but its internal logic is consistent. Fairy tale rules apply — be clever or be cursed. Humor exists, but so do real stakes. Don't mistake whimsy for safety.`
};

// Difficulty modifiers
const DIFFICULTY_MODIFIERS = {
    casual: `Consequence calibration: Failures result in setbacks, complications, and lost resources — but rarely death. The player should face real consequences but have opportunities to recover. Reserve catastrophic consequences for truly egregious decisions.`,
    hardcore: `Consequence calibration: The world does not pull punches. Poor decisions can and will result in serious injury or death. The player has been warned. Survival requires thinking before acting.`
};

/**
 * Build the full system prompt with modifiers
 */
const buildSystemPrompt = (tone = 'classic', difficulty = 'casual') => {
    const toneModifier = TONE_MODIFIERS[tone] || TONE_MODIFIERS.classic;
    const difficultyModifier = DIFFICULTY_MODIFIERS[difficulty] || DIFFICULTY_MODIFIERS.casual;
    
    return `${WORLD_SYSTEM_PROMPT}

TONE: ${toneModifier}

DIFFICULTY: ${difficultyModifier}`;
};

/**
 * Main prompt function for game interactions
 * Uses the Indifferent World system prompt
 */
const prompt = (engine, message, options = {}) => {
    const { tone = 'classic', difficulty = 'casual' } = options;
    const systemPrompt = buildSystemPrompt(tone, difficulty);
    const model = engine || GAME_MODEL;
    
    return new Promise(async (resolve, reject) => {
        try {
            const completion = await openai.chat.completions.create({
                model: model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: message }
                ],
                response_format: { type: "json_object" }
            });
            resolve(completion.choices[0].message);
        } catch (error) {
            reject(error.message);
        }
    });
};

/**
 * Simple prompt without the full world system (for utility tasks)
 */
const simplePrompt = (engine, systemContent, userMessage) => {
    const model = engine || GAME_MODEL;
    
    return new Promise(async (resolve, reject) => {
        try {
            const completion = await openai.chat.completions.create({
                model: model,
                messages: [
                    { role: "system", content: systemContent },
                    { role: "user", content: userMessage }
                ],
                response_format: { type: "json_object" }
            });
            resolve(completion.choices[0].message);
        } catch (error) {
            reject(error.message);
        }
    });
};

/**
 * Streaming prompt for real-time text generation
 * Returns an async generator that yields text chunks
 */
const streamPrompt = async function* (engine, message, options = {}) {
    const { tone = 'classic', difficulty = 'casual' } = options;
    const systemPrompt = buildSystemPrompt(tone, difficulty);
    const model = engine || GAME_MODEL;
    
    try {
        const stream = await openai.chat.completions.create({
            model: model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: message }
            ],
            stream: true
        });
        
        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                yield content;
            }
        }
    } catch (error) {
        throw new Error(error.message);
    }
};

const toolPrompt = (engine, message, tools, options = {}) => {
    const { tone = 'classic', difficulty = 'casual' } = options;
    const systemPrompt = buildSystemPrompt(tone, difficulty);
    const model = engine || GAME_MODEL;
    
    return new Promise(async (resolve, reject) => {
        try {
            const completion = await openai.chat.completions.create({
                model: model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: message }
                ],
                tools: tools,
                tool_choice: "required"
            });
            console.log(completion);
            resolve(completion.choices[0].message);
        } catch (error) {
            reject(error.message);
        }
    });
};

const summarizeLogs = (logs) => {
    return new Promise(async (resolve, reject) => {
        try {
            const summaryPrompt = "Summarize the following game logs in a concise manner, preserving key events, decisions, and consequences: " + logs.map(log => log.content).join(' ');
            const completion = await openai.chat.completions.create({
                model: GAME_MODEL,
                messages: [
                    { role: "system", content: "You are summarizing game events for memory persistence. Focus on: key decisions made, consequences faced, NPC interactions, and world state changes." },
                    { role: "user", content: summaryPrompt }
                ]
            });
            resolve(completion.choices[0].message.content);
        } catch (error) {
            reject(error.message);
        }
    });
};

module.exports = {
    prompt,
    simplePrompt,
    streamPrompt,
    toolPrompt,
    summarizeLogs,
    buildSystemPrompt,
    GAME_MODEL,
    TONE_MODIFIERS,
    DIFFICULTY_MODIFIERS
};
