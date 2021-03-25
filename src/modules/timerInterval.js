const moment = require('moment');
const { channel } = require('../constants/discord.json');

const { test, area51, general } = channel;

module.exports = (bot) => {
    let time = moment();

    setInterval(() => {
        let newTime = moment();
        const voiceChannel = bot.channels.get(area51);
        const generalChannel = bot.channels.get(general);
        const hour = newTime.get('hour');
        const minute = newTime.get('minute');

        if (newTime.format('hhmm') !== time.format('hhmm')) {
            time = newTime;
            console.log('update time: ', hour, minute);
            voiceChannel.setName(`Bây giờ là ${hour}h${minute}'`).then((channel) => { console.log("updated channel name to: " + channel.name) }).catch(console.error);
            if (hour === 17 && minute === 30) {
                generalChannel.send('Go homo ^^');
                generalChannel.send('https://media1.tenor.com/images/bb516b458a66c715aca4c7f6076813bb/tenor.gif?itemid=14806536');
            }
            if (hour === 12 && minute === 0) {
                generalChannel.send('Ăn ăn ăn ^^', { files: ["https://i.redd.it/hpelggvvfih31.png"] });
            }
        }
    }, 10000);
}