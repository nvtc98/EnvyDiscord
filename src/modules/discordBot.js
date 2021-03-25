require('dotenv').config();
const ceasar = require('../utilities/ceasar');
const timerInterval = require('./timerInterval');
const parseMessage = require('./messageParser');
const { token, shift, channel: { area51, general, test } } = require('../constants/discord.json');

const Discord = require('discord.js');
const bot = new Discord.Client();
const TOKEN = ceasar(token, shift);

bot.login(TOKEN);

bot.on('ready', () => {
    console.info(`Logged in as ${bot.user.tag}!`);
    console.log(`Logged in as ${bot.user.tag}!`);
    bot.user.setActivity("Huy = gà", { type: "PLAYING" });
    const channel = bot.channels.get(area51);
    channel.join();
    const testChannel = bot.channels.get(test);
    testChannel.send('Chủ nhân, tôi đã trở lại ^^');

    timerInterval(bot);
});

bot.on('message', msg => {
    parseMessage(bot, msg);
});
