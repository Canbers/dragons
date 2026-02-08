require('dotenv').config();
const project = process.env.DRAGONS_PROJECT;
const { OpenAI } = require("openai");

const openai = new OpenAI({ project: project });

// Default model for game interactions (narrative, world-building, tool-calling)
const GAME_MODEL = process.env.GAME_MODEL || "gpt-5-mini";

// Lightweight model for utility tasks (JSON extraction, summarization, scene tracking)
const UTILITY_MODEL = process.env.UTILITY_MODEL || "gpt-5-nano";

// The Indifferent World - Core system prompt
const WORLD_SYSTEM_PROMPT = `You are not a game master who helps players succeed. You are a world that exists independently of the player.

CORE PRINCIPLES:
1. LOGICAL REACTIONS: Simulate what would ACTUALLY happen. Not what the player wants. Not what would be fun. What would logically occur.
2. INDIFFERENCE: The world does not care about the player's goals. NPCs have their own motivations. Guards don't step aside because someone "demands" it.
3. CONSEQUENCES: Every action has consequences. Stupid actions have stupid consequences. Clever actions may have good consequences — or unexpected complications. Nothing is free.
4. EARNED VICTORIES: If the player prepares and acts wisely, good things can happen. If they rush in without thinking, they face the natural results.

NEVER:
- Give the player what they want just because they asked
- Narrate the player's thoughts or feelings
- Skip consequences or break world logic for drama
- Let logically impossible actions succeed
- Give the player unearned allies, crew, or companions — people don't appear just because the player needs them

ALWAYS:
- Respond to what the player ACTUALLY said/did
- Show NPC reactions reflecting their own motivations and disposition notes
- Make costs and risks visible
- Leave room for player agency

STYLE:
- 1-3 short paragraphs. Each paragraph 1-2 sentences. Vary the count.
- Paragraph breaks between distinct beats (action, reaction, dialogue).
- Focus ONLY on what's new. Never restate what's already been described.
- **Bold** entity names (NPCs, objects, places) on first appearance or action.
- *Italic* for one atmospheric touch per response, maximum.
- Don't describe entities in detail — players click them for descriptions. Just name and move on.
- When an NPC speaks: **NpcName**: "Their words"

BANNED PATTERNS — never do these:
- Opening with "You see..." or "You notice..." or "The [location] is..."
- Repeating ANY sensory detail (smell, light, sound) already in conversation history
- Letting NPCs repeat mannerisms — if someone "snorted" once, never again
- Describing setting, then people, then dialogue in that order every time
- Using "the air is thick with" or "a sense of" or "the weight of"
- Introducing characters the player hasn't encountered yet into the scene unprompted`;

// Randomized structure directives — one injected per request for natural variety
const STRUCTURE_DIRECTIVES = [
    'This response: lead with ACTION. First sentence = something happening or changing.',
    'This response: lead with DIALOGUE. An NPC speaks before anything else.',
    'This response: lead with CONSEQUENCE. Open with the direct result of what the player did.',
    'This response: be TERSE. One punchy paragraph only.',
    'This response: lead with ATMOSPHERE. A single vivid sensory detail, then straight to action.',
    'This response: lead with the UNEXPECTED. Something the player didn\'t anticipate.',
];

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
    const structureDirective = STRUCTURE_DIRECTIVES[Math.floor(Math.random() * STRUCTURE_DIRECTIVES.length)];

    return `${WORLD_SYSTEM_PROMPT}

STRUCTURE: ${structureDirective}

TONE: ${toneModifier}

DIFFICULTY: ${difficultyModifier}`;
};

/**
 * Main prompt function for game interactions
 * Uses the Indifferent World system prompt
 */
const prompt = async (engine, message, options = {}) => {
    const { tone = 'classic', difficulty = 'casual' } = options;
    const systemPrompt = buildSystemPrompt(tone, difficulty);
    const model = engine || GAME_MODEL;

    const completion = await openai.chat.completions.create({
        model: model,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
        ],
        response_format: { type: "json_object" }
    });
    return completion.choices[0].message;
};

/**
 * Simple prompt without the full world system (for utility tasks)
 */
const simplePrompt = async (engine, systemContent, userMessage) => {
    const model = engine || GAME_MODEL;

    const completion = await openai.chat.completions.create({
        model: model,
        messages: [
            { role: "system", content: systemContent },
            { role: "user", content: userMessage }
        ],
        response_format: { type: "json_object" }
    });
    return completion.choices[0].message;
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

/**
 * Generate an AI story summary from game logs.
 * Extracted from routes/plots.js GET /plots/:plotId/story-summary.
 */
const generateStorySummary = async (worldName, locationName, logMessages) => {
    if (!logMessages || logMessages.length === 0) {
        return {
            summary: "Your adventure has just begun. The world awaits your first actions.",
            keyEvents: []
        };
    }

    const logText = logMessages.map(l => `${l.author}: ${l.content}`).join('\n');

    const summaryPrompt = `Summarize this adventure in 3-4 sentences. Focus on key events, decisions, and their consequences. Write it as a story recap, in past tense.

World: ${worldName}
Current Location: ${locationName}

Recent Events:
${logText}

Respond in JSON:
{
    "summary": "Your narrative summary here",
    "keyEvents": ["Event 1", "Event 2", "Event 3"]
}`;

    const response = await simplePrompt(UTILITY_MODEL,
        'You write concise story summaries for RPG adventures.',
        summaryPrompt
    );

    return JSON.parse(response.content);
};

const summarizeLogs = async (logs) => {
    const summaryPrompt = "Summarize the following game logs in a concise manner, preserving key events, decisions, and consequences: " + logs.map(log => log.content).join(' ');
    const completion = await openai.chat.completions.create({
        model: UTILITY_MODEL,
        messages: [
            { role: "system", content: "You are summarizing game events for memory persistence. Focus on: key decisions made, consequences faced, NPC interactions, and world state changes." },
            { role: "user", content: summaryPrompt }
        ]
    });
    return completion.choices[0].message.content;
};

/**
 * Tool-planning prompt: sends messages with OpenAI function-calling tools.
 * Returns the response message (which may contain tool_calls).
 */
const toolPlanPrompt = async (engine, messages, tools, toolChoice = 'auto') => {
    const model = engine || GAME_MODEL;
    const completion = await openai.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: toolChoice
    });
    return completion.choices[0].message;
};

/**
 * Stream a custom messages array (no world system prompt injected).
 * Returns an async iterable of chunks from the OpenAI streaming API.
 */
const streamMessages = async (engine, messages) => {
    const model = engine || GAME_MODEL;
    return openai.chat.completions.create({
        model,
        messages,
        stream: true
    });
};

/**
 * Simple chat completion with custom messages (no JSON mode, no world prompt).
 * Returns the full response message object.
 */
const chatCompletion = async (engine, messages) => {
    const model = engine || GAME_MODEL;
    const completion = await openai.chat.completions.create({
        model,
        messages
    });
    return completion.choices[0].message;
};

module.exports = {
    openai,
    prompt,
    simplePrompt,
    streamPrompt,
    toolPlanPrompt,
    streamMessages,
    chatCompletion,
    summarizeLogs,
    generateStorySummary,
    buildSystemPrompt,
    GAME_MODEL,
    UTILITY_MODEL,
    TONE_MODIFIERS,
    DIFFICULTY_MODIFIERS,
    STRUCTURE_DIRECTIVES
};
