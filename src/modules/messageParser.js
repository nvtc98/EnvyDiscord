const { channel, prefix } = require('../constants/discord.json');
const _ = require('lodash');

const { test, area51, general } = channel;

global.memeCount = 0;
global.rankData = {};

module.exports = (bot, msg) => {
    if (_.get(msg, 'member.id', '') == bot.user.id) { return; }

    countMeme(msg);

    track(msg);

    if (!msg.content) {
        return;
    }

    parseCommand(bot, msg);
}

const countMeme = (msg) => {
    if (msg.attachments && !msg.content) {
        const data = Array.from(msg.attachments);
        if (data.length === 1) {
            ++global.memeCount;
            if (global.memeCount < 10) {
                msg.channel.send('Tổng số meme đã gửi hôm nay là ' + global.memeCount);
                msg.channel.send('Cố gắng đạt 10 meme mỗi ngày nhé các mêm lỏd ^^');
                return;
            }
            else if (global.memeCount === 10) {
                // msg.channel.send('KPI hoàn thành: Đã đạt đủ 10 meme trong ngày ^^', { files: ["https://i.pinimg.com/474x/c6/73/75/c673752c8ddb995b795111a63174263f.jpg"] });
                msg.channel.send('KPI hoàn thành: Đã đạt đủ 10 meme trong ngày ^^');
                msg.channel.send('https://imgur.com/a/lfHWSr4');
                return;
            }
        }
    }
}

const track = (msg) => {
    const userId = _.get(msg, 'author.id', '');
    const message = msg.content.toLowerCase();

    if (!global.rankData[userId]) {
        global.rankData[userId] = { messages: 0, ngon: 0, lmao: 0, play: 0 };
    }
    ++global.rankData[userId].messages;

    parseCommonMessages(msg, message)

    if (message.search('ngon' !== -1)) {
        ++global.rankData[userId].ngon;
    }
    if (message.search('lmao') !== -1) {
        ++global.rankData[userId].lmao;
    }
    if (message.substr(0, 5) === '-play') {
        ++global.rankData[userId].play;
    }
}

const parseCommonMessages = (msg, message) => {
    switch (message) {
        case 'ngon':
            return msg.channel.send('Ngon ^^');
        case 'envy':
            return msg.channel.send('Chủ nhân gọi tôi');
        // case 'lmao':
        //     return msg.channel.send('ler mao', { tts: true });
    }
}

const parseCommand = (bot, msg) => {
    if (!prefix.includes(msg.content.substr(0, 1))) {
        return;
    }

    try {
        const messageParts = msg.content.split(' ');
        const command = messageParts[0].substr(1);
        const content = msg.content.substr(command.length + 2);
        switch (command) {
            case 'meme':
                switch (messageParts[1]) {
                    case 'set':
                        global.memeCount = messageParts[2];
                        msg.channel.send(`Đã set số meme trong ngày thành ${messageParts[2]}.`);
                        return;
                    case 'check':
                        msg.channel.send(`Tổng số meme trong ngày hôm nay là ${global.memeCount} ^^`);
                        return;
                }

            case 'say':
                const generalChannel = bot.channels.get(general);
                generalChannel.send(content);
                return;

            case 'rank':
                const { id } = msg.author;
                const user = msg.author.toString();
                if (!global.rankData[id]) {
                    return msg.channel.send('Bạn là ai, tớ chưa có thông tin');
                }
                const { messages, ngon, lmao, play } = global.rankData[id];
                msg.channel.send(`Rank của ${user}: chưa có`);
                msg.channel.send(`${user} đã cào phím ${messages} lần hôm nay`);
                msg.channel.send(`${user} đã nói từ ngon ${ngon} lần hôm nay`);
                msg.channel.send(`${user} đã nói từ lmao ${lmao} lần hôm nay`);
                msg.channel.send(`${user} đã đòi bé groovy hát hò ${play} lần hôm nay`);
        }
    } catch (error) {
        msg.channel.send(`Trời đất dung hoa, vạn vật sinh sôi, nói nhảm gì thế bạn tôi?`);
        console.log("Error in parseCommand:");
        console.error(error);
    }
}