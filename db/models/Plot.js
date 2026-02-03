const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const Plot = new Schema(
    {
        world: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'World',
            required: true
        },
        players: [
            {
                user: {
                    type: String,
                },
                character: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'Character',
                },
                name: {
                    type: String,
                },
            },
        ],
        current_state: {
            current_activity: {
                type: String,
                enum: ['conversation', 'exploring', 'in combat', 'resting', 'traveling'],
                default: 'exploring'
            },
            current_location: {
                region: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'Region'
                },
                settlement: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'Settlement'
                },
                coordinates: {
                    type: [Number], // [x, y] coordinates
                    default: [0, 0]
                },
                locationName: {
                    type: String,
                    default: ''
                },
                locationDescription: {
                    type: String,
                    default: ''
                },
                description: {
                    type: String, // e.g., "traveling between settlements", "exploring ruins"
                }
            },
            current_time: {
                type: String, // e.g., "morning", "evening", "night"
            },
            environment_conditions: {
                type: String, // e.g., "raining", "sunny", "hot", "cold"
            },
            mood_tone: {
                type: String, // e.g., "tense", "relaxed"
            }
        },
        quests: [
            {
                quest: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'Quest',
                },
                questTitle: {
                    type: String,
                },
                questStatus: {
                    type: String
                },
                notes: {
                    type: Array
                }
            },
        ],
        activeQuest: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Quest'
        },
        milestones: {
            type: Array
        },
        gameLogs: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'GameLog'
            }
        ],
        settings: {
            tone: {
                type: String,
                enum: ['dark', 'classic', 'whimsical'],
                default: 'classic'
            },
            difficulty: {
                type: String,
                enum: ['casual', 'hardcore'],
                default: 'casual'
            }
        },
        // Reputation system - tracks how NPCs/factions view the player
        reputation: {
            // Named NPCs the player has interacted with
            npcs: [{
                name: String,
                disposition: {
                    type: String,
                    enum: ['hostile', 'unfriendly', 'neutral', 'friendly', 'allied'],
                    default: 'neutral'
                },
                lastInteraction: String, // Brief note of what happened
                location: String // Where they met
            }],
            // Faction standings
            factions: [{
                name: String,
                standing: {
                    type: Number,
                    default: 0, // -100 to 100 scale
                    min: -100,
                    max: 100
                },
                reason: String // Why they feel this way
            }],
            // General reputation in locations
            locations: [{
                name: String,
                reputation: {
                    type: String,
                    enum: ['notorious', 'disliked', 'unknown', 'known', 'respected', 'legendary'],
                    default: 'unknown'
                },
                knownFor: String // What are they known for here
            }]
        },
        // World state changes caused by player actions
        worldChanges: [{
            description: String,
            causedBy: String, // What action caused this
            timestamp: { type: Date, default: Date.now }
        }]
    }
);

module.exports = mongoose.model('Plot', Plot);
