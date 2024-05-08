const express = require('express');
const path = require('path');
const app = express();
const Plot = require('./db/models/Plot.js'); 
const Quest = require('./db/models/Quest.js');
const actionInterpreter = require('./agents/actionInterpreter'); 
const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/dragons', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));


// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

// Fetch Game Info
app.get('/api/game-info', async (req, res) => {
    try {
        const worldId = req.query.worldId;
        if (!mongoose.Types.ObjectId.isValid(worldId)) {
            return res.status(400).send('Invalid worldId format');
        }
        else {
            console.log("Validated worldId: " + worldId);
        }
        const plot = await Plot.findOne({ world: new mongoose.Types.ObjectId(worldId) }).populate({
            path: 'quests',
            model: 'Quest'
            //Should I be adding Milestones here as well as quests?
        });
        if (!plot) {
            console.log("No plot found for worldId:", worldId);
            return res.status(404).send('Plot not found');
        }

        res.json(plot);

    } catch (error) {
        console.error('Error fetching plot:', error);
        res.status(500).send(error.message);
    }
});

// Fetch Quest Details
app.get('/api/quest-details', async (req, res) => {
    try {
        const questId = req.query.questId;
        if (!mongoose.Types.ObjectId.isValid(questId)) {
            return res.status(400).send('Invalid questId format');
        }
        // Find the specific quest in the plot using $elemMatch
        const plot = await Plot.findOne({ "quests._id": questId }, { 'quests.$': 1 }).populate({
            path: 'quests.quest',
            model: 'Quest'
        });
        if (!plot || !plot.quests.length) {
            return res.status(404).send('Quest not found');
        }
        // Since $elemMatch is used, quests array will have only one element
        const quest = plot.quests[0];
        res.json(quest);
    } catch (error) {
        console.error('Error fetching quest details:', error);
        res.status(500).send(error.message);
    }
});

// Interpret User Input
app.post('/api/input', async (req, res) => {
    try {
        const { input } = req.body;
        console.log("input: " + input);
        const response = await actionInterpreter.interpret(input);
        res.json(response);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.put('/api/plots/:plotId', async (req, res) => {
    const { plotId } = req.params;
    const { activeQuest } = req.body;
    try {
      await Plot.updateOne({ _id: plotId }, { activeQuest });
      res.sendStatus(200);
    } catch (error) {
      console.error(error);
      res.sendStatus(500);
    }
  });