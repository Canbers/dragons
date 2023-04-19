const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
    organization: process.env.GPT_ORG,
    apiKey: process.env.GPT_TOKEN,
});
const openai = new OpenAIApi(configuration);

const getEngines = () => {
    console.log(process.env.GPT_TOKEN);
    return new Promise( async (resolve, reject) => {
        const response = await openai.listModels();
        resolve(response.data);
    })
}

const prompt = (engine, message) => {
    return new Promise( async (resolve, reject) => {
        const completion = await openai.createChatCompletion({
            model: engine,
            messages: [{role: "user", content: message}],
          });
          resolve(completion.data.choices[0].message);
    });
}

const createImage = (config) => {
    return new Promise( async (resolve, reject) => {
        let result = await openai.createImage(config);
        resolve(result.data);
    });
}
 
module.exports = {
    getEngines,
    prompt,
    createImage
}