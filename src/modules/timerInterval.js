const moment = require("moment");
const { channel } = require("../constants/discord.json");

const { test, area51, general } = channel;

module.exports = (bot) => {
  let time = moment().utcOffset(420);

  setInterval(() => {
    let newTime = moment().utcOffset(420);
    const voiceChannel = bot.channels.cache.get(area51);
    const generalChannel = bot.channels.cache.get(general);
    const testChannel = bot.channels.cache.get(test);
    const countdownChannel = bot.channels.cache.get("892978561655394324");
    const hour = newTime.get("hour");
    const minute = newTime.get("minute");

    if (newTime.format("hhmm") !== time.format("hhmm")) {
      time = newTime;
      // console.log("current time: ", hour, minute);
      // voiceChannel.setName(`Bây giờ là ${hour}h${minute}'`).then((channel) => { console.log("updated channel name to: " + channel.name) }).catch(console.error);
      // if (hour === 17 && minute === 30) {
      //     generalChannel.send('Go homo ^^');
      //     generalChannel.send('https://media1.tenor.com/images/bb516b458a66c715aca4c7f6076813bb/tenor.gif?itemid=14806536');
      // }
      // if (hour === 12 && minute === 0) {
      //     generalChannel.send('Ăn ăn ăn ^^', { files: ["https://i.redd.it/hpelggvvfih31.png"] });
      // }
      if (hour === 0 && minute === 0) {
        global.memeCount = 0;
        global.rankData = {};
        testChannel.send("Đã reset data cho ngày mới.");
      }
      if (minute === 0) {
        const destinationTime = moment(1633096800000);
        const hours = destinationTime.diff(newTime, "hours");
        countdownChannel
          .setName(`Countdown: ${hours} giờ`)
          .catch(console.error);
      }
    }
  }, 30000);
};
