require("dotenv").config();
const ytdl = require("ytdl-core");
// const ceasar = require('../utilities/ceasar');
const decode = require("../utilities/decode");
const timerInterval = require("./timerInterval");
const parseMessage = require("./messageParser");
const {
  token,
  shift,
  channel: { idle, general, test },
} = require("../constants/discord.json");

const Discord = require("discord.js");
const bot = new Discord.Client();
const TOKEN = decode(token);

bot.login(TOKEN);

bot.on("ready", async () => {
  console.info(`Logged in as ${bot.user.tag}!`);
  bot.user.setActivity("Gabriel Dropout", { type: "WATCHING" });
  const testChannel = bot.channels.cache.get(test);
  testChannel.send("Chủ nhân, tôi đã trở lại ^^");

  timerInterval(bot);
  voice(bot);
});

bot.on("message", (msg) => {
  parseMessage(bot, msg);
});
