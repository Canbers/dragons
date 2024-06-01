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
        ]
    }
);

module.exports = mongoose.model('Plot', Plot);
