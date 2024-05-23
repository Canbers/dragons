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
            type: String,
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
