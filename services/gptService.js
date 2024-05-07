require('dotenv').config();
const project = process.env.DRAGONS_PROJECT;
const  { OpenAI } = require("openai");

const openai = new OpenAI({ project: project});

const prompt = (engine, message) => {
    return new Promise( async (resolve, reject) => {
        try{
        const completion = await openai.chat.completions.create({
            model: engine,
            messages: [
                {role: "system", content: "You are a game master for a Dungeons and Dragons style web-app game."},
                {role: "user", content: message}],
            response_format: {type: "json_object"}
          });
          resolve(completion.choices[0].message);
        } catch (error) {
            reject(error.message);
        }
    });
}

const toolPrompt = (engine, message, tools) => {
    return new Promise( async (resolve, reject) => {
        try{
        const completion = await openai.chat.completions.create({
            model: engine,
            messages: [
                {role: "system", content: "You are a game master for a Dungeons and Dragons style web-app game."},
                {role: "user", content: message}],
            tools: tools,
            tool_choice: "required"
          });
          console.log(completion);
          resolve(completion.choices[0].message);
        } catch (error) {
            reject(error.message);
        }
    });
}

/* Images not implemented yet
const createImage = (config) => {
    return new Promise( async (resolve, reject) => {
        let result = await openai.createImage(config);
        resolve(result.data);
    });
}
*/

module.exports = {
    prompt,
    toolPrompt
}

