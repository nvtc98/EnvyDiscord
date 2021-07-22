require("dotenv").config();
// const ceasar = require('../utilities/ceasar');
const decode = require("../utilities/decode");
const timerInterval = require("./timerInterval");
const parseMessage = require("./messageParser");
const { enterVoiceChannel } = require("./voice");
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
  enterVoiceChannel(bot);
});

bot.on("message", (msg) => {
  parseMessage(bot, msg);
});

bot.on("guildMemberAdd", (member) => {
  const channel = member.guild.channels.cache.find((ch) => ch.id === general);
  if (!channel) return;
  channel.send(`Bầu trời thì xanh biếc,`);
  channel.send(`${member} thì vào rạp xiếc!`);
  channel.send(`Hajimemashite, ${member} ^^`);
  channel.send(
    `https://i.pinimg.com/originals/27/b9/8a/27b98ad826e261e76f21009d1900baa1.png`
  );
});

bot.on("guildMemberRemove", (member) => {
  const channel = member.guild.channels.cache.find((ch) => ch.id === general);
  if (!channel) return;
  channel.send(`Chotto- ${member} rời khỏi rạp xiếc ư`);
  channel.send(
    `https://64.media.tumblr.com/6ebf792c1e396c1546a133eef46337f3/tumblr_onhjo0dDu01qa94xto1_540.gifv`
  );
  channel.send(`Ara ara, nói xấu ${member} thôi Ｏ(≧▽≦)Ｏ`);
});
