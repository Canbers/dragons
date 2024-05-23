require('dotenv').config();
const project = process.env.DRAGONS_PROJECT;
const { OpenAI } = require("openai");

const openai = new OpenAI({ project: project });

const prompt = (engine, message) => {
    return new Promise(async (resolve, reject) => {
        try {
            const completion = await openai.chat.completions.create({
                model: engine,
                messages: [
                    { role: "system", content: "You are a game master for a Tabletop RPG style web-app game." },
                    { role: "user", content: message }
                ],
                response_format: { type: "json_object" }
            });
            resolve(completion.choices[0].message);
        } catch (error) {
            reject(error.message);
        }
    });
}

const toolPrompt = (engine, message, tools) => {
    return new Promise(async (resolve, reject) => {
        try {
            const completion = await openai.chat.completions.create({
                model: engine,
                messages: [
                    { role: "system", content: "You are a game master for a Tabletop RPG style web-app game." },
                    { role: "user", content: message }
                ],
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

const summarizeLogs = (logs) => {
    return new Promise(async (resolve, reject) => {
        try {
            const summaryPrompt = "Summarize the following game logs in a concise manner: " + logs.map(log => log.content).join(' ');
            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "You are a game master taking notes for a Tabletop RPG style web-app game." },
                    { role: "user", content: summaryPrompt }
                ]
            });
            resolve(completion.choices[0].message.content);
        } catch (error) {
            reject(error.message);
        }
    });
}

/* Images not implemented yet
const createImage = (config) => {
    return new Promise(async (resolve, reject) => {
        let result = await openai.createImage(config);
        resolve(result.data);
    });
}
*/

module.exports = {
    prompt,
    toolPrompt,
    summarizeLogs
}


