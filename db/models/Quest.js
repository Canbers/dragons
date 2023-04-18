const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ObjectId = Schema.ObjectId;

const Quest = new Schema(
    {
        world: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'World',
            required: true
        },
        questTitle: {
            type: String,
        },
        description: {
            type: String
        },
        objectives: {
            type: Array
        },
        currentObjective: {
            type: String
        }
    }
);
Quest.index({
    world: 1
},
{
    unique: true
}
)
module.exports = mongoose.model('Quest', Quest);