const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const Quest = new Schema(
    {
        world: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'World',
            required: true
        },
        settlement: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Settlement'
        },
        questTitle: {
            type: String,
        },
        description: {
            type: String
        },
        status: {
            type: String,
            enum: ['seed', 'discovered', 'active', 'completed', 'failed', 'expired'],
            default: 'seed',
        },
        objectives: [{
            id: { type: String },
            description: { type: String },
            status: {
                type: String,
                enum: ['unknown', 'known', 'in_progress', 'completed', 'failed'],
                default: 'unknown'
            },
            isCurrent: { type: Boolean, default: false }
        }],
        hooks: [{
            text: { type: String },
            type: {
                type: String,
                enum: ['rumor', 'observation', 'npc_mention', 'environmental'],
                default: 'rumor'
            },
            delivered: { type: Boolean, default: false },
            deliveredAt: { type: Date }
        }],
        progression: [{
            summary: { type: String },
            timestamp: { type: Date, default: Date.now }
        }],
        currentSummary: {
            type: String,
            default: ''
        },
        keyActors: {
            primary: [
                {
                    name: { type: String },
                    role: { type: String }
                }
            ],
            secondary: [
                {
                    name: { type: String },
                    role: { type: String }
                }
            ]
        },
        locations: {
            primary: {
                name: { type: String },
                coordinates: {
                    type: [[Number]]
                }
            },
            secondary: [
                {
                    name: { type: String },
                    coordinates: {
                        type: [[Number]]
                    }
                }
            ]
        },
        outcomes: [
            {
                type: { type: String },
                description: { type: String }
            }
        ],
        consequences: {
            immediate: { type: String },
            longTerm: { type: String }
        }
    },
    { timestamps: true }
);

Quest.index({ world: 1, settlement: 1, status: 1 });

module.exports = mongoose.model('Quest', Quest);
