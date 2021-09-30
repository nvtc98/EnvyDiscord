const { channel, prefix } = require("../constants/discord.json");
const generateImage = require("../utilities/imageGenerator");
const generateAngryImage = require("../utilities/angryImageGenerator");
const generateCsgoQuote = require("../utilities/csgoQuote");
const { playYoutube, setVolume, stopVoice } = require("./voice");
const { helpList } = require("../utilities/texts");
const _ = require("lodash");

const { test, area51, general } = channel;

global.memeCount = 0;
global.rankData = {};

module.exports = (bot, msg) => {
  if (_.get(msg, "author.bot", false)) {
    return;
  }

  countMeme(msg);

  track(msg);

  if (!msg.content) {
    return;
  }

  parseCommand(bot, msg);
};

const countMeme = (msg) => {
  if (msg.attachments && !msg.content) {
    const data = Array.from(msg.attachments);
    if (data.length === 1) {
      ++global.memeCount;
      if (global.memeCount < 10) {
        msg.channel.send("Tổng số meme đã gửi hôm nay là " + global.memeCount);
        msg.channel.send("Cố gắng đạt 10 meme mỗi ngày nhé các mêm lỏd ^^");
        return;
      } else if (global.memeCount === 10) {
        // msg.channel.send('KPI hoàn thành: Đã đạt đủ 10 meme trong ngày ^^', { files: ["https://i.pinimg.com/474x/c6/73/75/c673752c8ddb995b795111a63174263f.jpg"] });
        msg.channel.send(
          "KPI hoàn thành: Đã đạt đủ 10 meme trong ngày ^^ Cả server đã nhận được thành tích: MÊM LỎD BỦH BỦH LMAO ^^"
        );
        msg.channel.send(
          "https://steamuserimages-a.akamaihd.net/ugc/842588658443747114/A714EC406BFA22397E34737790465AAD673D0A13/?imw=5000&imh=5000&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=false"
        );
        return;
      }
    }
  }
};

const track = (msg) => {
  const userId = _.get(msg, "author.id", "");
  const message = msg.content.toLowerCase();
  const user = msg.author.toString();

  if (!global.rankData[userId]) {
    global.rankData[userId] = { messages: 0, ngon: 0, lmao: 0, play: 0 };
  }
  ++global.rankData[userId].messages;
  if (global.rankData[userId].messages === 20) {
    msg.channel.send(`${user} đã nhắn 20 tin nhắn trong ngày`);
    msg.channel.send(`${user} đã đạt thành tích: chat khỏe như thần trùng ^^`, {
      files: [generateImage()],
    });
  }
  if (global.rankData[userId].messages === 50) {
    msg.channel.send(`${user} đã nhắn 50 tin nhắn trong ngày`);
    msg.channel.send(`${user} đã đạt thành tích: tay gắn nitro ^^`, {
      files: [generateImage()],
    });
  }
  if (global.rankData[userId].messages === 100) {
    msg.channel.send(`${user} đã nhắn 100 tin nhắn trong ngày`);
    msg.channel.send(
      `${user} đã đạt thành tích: thống soái văn bản, thủ lĩnh hội thoại, kẻ hủy diệt bàn phím, vua chat, lãnh chúa chuyên văn, thống soái tay to, tổng tư lệnh cào phím ^^`,
      { files: [generateImage()] }
    );
  }
  if (global.rankData[userId].messages === 200) {
    msg.channel.send(`${user} đã nhắn 200 tin nhắn trong ngày`);
    msg.channel.send(`${user} đã đạt thành tích: còn nói còn achievement ^^`, {
      files: [generateImage()],
    });
  }

  parseCommonMessages(msg, message);

  if (message.search("ngon") !== -1) {
    ++global.rankData[userId].ngon;
    if (global.rankData[userId].ngon === 10) {
      msg.channel.send(`${user} đã nói từ ngon 10 lần hôm nay`);
      msg.channel.send(`${user} đã đạt thành tích: nói NGON mỗi ngày ^^`, {
        files: [generateImage()],
      });
    } else if (global.rankData[userId].ngon === 25) {
      msg.channel.send(`${user} đã nói từ ngon 25 lần hôm nay`);
      msg.channel.send(
        `${user} đã đạt thành tích: nói Ngon nhiều hơn số đạn của USP-S ^^`,
        { files: [generateImage()] }
      );
    }
  }
  if (message.search("lmao") !== -1) {
    ++global.rankData[userId].lmao;
    if (global.rankData[userId].lmao === 9) {
      msg.channel.send(`${user} đã nói từ lmao 9 lần hôm nay`);
      msg.channel.send(
        `${user} đã đạt thành tích: voi 9 ngà, gà 9 cựa, ngựa 9 lmao ^^`,
        { files: [generateImage()] }
      );
    }
  }
  if (message.substr(0, 5) === "-play" || message.substr(0, 2) === "-p") {
    ++global.rankData[userId].play;
    if (global.rankData[userId].play === 10) {
      msg.channel.send(`${user} đã nghe nhạc 10 lần hôm nay`);
      msg.channel.send(
        `${user} đã đạt thành tích: Trẻ trâu không nằm ở độ tuổi, trẻ trâu nằm ở nhà nghe nhạc trên discord ^^`,
        { files: [generateImage()] }
      );
    }
    if (global.rankData[userId].play === 20) {
      msg.channel.send(`${user} đã nghe nhạc 20 lần hôm nay`);
      msg.channel.send(
        `${user} đã đạt thành tích: vua loa, trùm chill, chúa tể âm nhạc, vị thần ráy tai, kẻ hủy diệt nốt nhạc ^^`,
        { files: [generateImage()] }
      );
    }
  }
};

const parseCommonMessages = (msg, message) => {
  switch (message) {
    case "ngon":
      return msg.channel.send("Ngon ^^");
    case "envy":
      return msg.channel.send("Chủ nhân gọi tôi");
    // case 'wibu':
    //     return msg.channel.send('https://tenor.com/view/gabriel-gif-9035030');
    // case 'lmao':
    //     return msg.channel.send('ler mao', { tts: true });
  }

  if (message.search("wibu") !== -1 && message.search("bot") !== -1) {
    const content = generateAngryImage();
    if (content) {
      msg.channel.send(content);
      return;
    }
    msg.channel.send(
      "Envy đã đến giới hạn của mình. Cả server đã nhận được thành tích: Những kẻ chọc chó ^^"
    );
    msg.channel.send(
      "https://remyfool.files.wordpress.com/2017/03/vlcsnap-2017-03-13-18h48m23s126.jpg?w=924"
    );
  }

  if (message.search("thua") !== -1) {
    msg.channel.send("Thắng làm vua, thuaaaaaaaa rồi ba");
  }

  if (message.search("non") !== -1) {
    msg.channel.send("https://data.whicdn.com/images/317943374/original.png");
  }
};

const parseCommand = (bot, msg) => {
  if (!prefix.includes(msg.content.substr(0, 1))) {
    return;
  }

  try {
    const messageParts = msg.content.split(" ");
    const command = messageParts[0].substr(1);
    const content = msg.content.substr(command.length + 2);
    switch (command) {
      case "meme":
        switch (messageParts[1]) {
          case "set":
            global.memeCount = messageParts[2];
            msg.channel.send(
              `Đã set số meme trong ngày thành ${messageParts[2]}.`
            );
            return;
          case "check":
            msg.channel.send(
              `Tổng số meme trong ngày hôm nay là ${global.memeCount} ^^`
            );
            return;
        }

      case "say":
        const generalChannel = bot.channels.cache.get(general);
        generalChannel.send(content);
        return;

      case "rank":
        const { id } = msg.author;
        const user = msg.author.toString();
        if (!global.rankData[id]) {
          return msg.channel.send("Bạn là ai, tớ chưa có thông tin");
        }
        const { messages, ngon, lmao, play } = global.rankData[id];
        msg.channel.send(`Rank của ${user}: chưa có`);
        msg.channel.send(`${user} đã cào phím ${messages} lần hôm nay`);
        msg.channel.send(`${user} đã nói từ ngon ${ngon} lần hôm nay`);
        msg.channel.send(`${user} đã nói từ lmao ${lmao} lần hôm nay`);
        msg.channel.send(`${user} đã đòi bé groovy hát hò ${play} lần hôm nay`);
        return;

      case "csgoquote":
        msg.channel.send(generateCsgoQuote());

      case "envyplay":
      case "ep":
        playYoutube(content);
        return;
      case "envyvolume":
      case "ev":
        setVolume(content);
        return;
      case "envystop":
      case "es":
        stopVoice();
        return;

      case "help":
      case "envyhelp":
      case "eh":
      case "envy":
        msg.channel.send(helpList);
        return;
    }
  } catch (error) {
    msg.channel.send(
      `Trời đất dung hoa, vạn vật sinh sôi, nói nhảm gì thế bạn tôi?`
    );
    console.log("Error in parseCommand:");
    console.error(error);
  }
};
