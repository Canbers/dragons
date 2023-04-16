const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ObjectId = Schema.ObjectId;

const Ecosystem = new Schema(
    {
        name: {
            type: String,
            required: true,
        },
        world: {
            type: ObjectId,
            required: true
    }
}
);
Ecosystem.index({
    name: 1,
    world: 1
},
{
    unique: true
}
)
module.exports = mongoose.model('Ecosystem', Ecosystem);