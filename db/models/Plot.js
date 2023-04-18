const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ObjectId = Schema.ObjectId;

const Plot = new Schema(
    {
        world: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'World',
            required: true
        },
        current_state: {
            type: String,
        },
        quests: {
            type: Array
        },
        milestones: {
            type: Array
        }
    }
);
Plot.index({
    world: 1
},
{
    unique: true
}
)
module.exports = mongoose.model('Plot', Plot);