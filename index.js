require('dotenv').config();
const Discord = require('discord.js');
const bot = new Discord.Client();
const TOKEN = 'ODIzODU5MDU1Nzk2OTQ0OTA3.YFm8iQ.xY_KYqU2DRiGUMFiHETyjOf1Amk';

bot.login(TOKEN);

bot.on('ready', () => {
    console.info(`Logged in as ${bot.user.tag}!`);
});

bot.on('message', msg => {
    if (msg.content === 'hey Envy') {
        msg.reply('Chủ nhân gọi tôi');
        msg.channel.send('Chủ nhân gọi tôi');

    } else if (msg.content.startsWith('!kick')) {
        if (msg.mentions.users.size) {
            const taggedUser = msg.mentions.users.first();
            msg.channel.send(`You wanted to kick: ${taggedUser.username}`);
        } else {
            msg.reply('Please tag a valid user!');
        }
    }
});
