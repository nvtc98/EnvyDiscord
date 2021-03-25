const { channel, prefix } = require('../constants/discord.json');
const _ = require('lodash');

const { test, area51, general } = channel;

let memeCount = 0;

module.exports = (bot, msg) => {
    if (_.get(msg, 'member.id', '') == bot.user.id) { return; }

    countMeme(msg);

    if (!msg.content) {
        return;
    }

    parseCommonSentences(msg);

    parseCommand(bot, msg);
}

const countMeme = (msg) => {
    if (msg.attachments && !msg.content) {
        ++memeCount;
        const data = Array.from(msg.attachments);
        if (data.length === 1) {
            if (memeCount < 10) {
                msg.channel.send('Tổng số meme đã gửi hôm nay là ' + memeCount);
                msg.channel.send('Cố gắng đạt 10 meme mỗi ngày nhé các mêm lỏd ^^');
                return;
            }
            else if (memeCount === 10) {
                // msg.channel.send('KPI hoàn thành: Đã đạt đủ 10 meme trong ngày ^^', { files: ["https://i.pinimg.com/474x/c6/73/75/c673752c8ddb995b795111a63174263f.jpg"] });
                msg.channel.send('KPI hoàn thành: Đã đạt đủ 10 meme trong ngày ^^');
                msg.channel.send('https://imgur.com/a/lfHWSr4');
                return;
            }
        }
    }
}

const parseCommonSentences = (msg) => {
    const message = msg.content.toLowerCase();

    switch (message) {
        case 'ngon':
            return msg.channel.send('Ngon ^^');
        case 'envy':
            return msg.channel.send('Chủ nhân gọi tôi');
        // case 'lmao':
        //     return msg.channel.send('ler mao', { tts: true });
    }

    if (message === 'ngon') {
        msg.channel.send('Ngon ^^');
    }
    // if (m)

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
                        memeCount = messageParts[2];
                        msg.channel.send(`Đã set số meme trong ngày thành ${messageParts[2]}.`);
                        return;
                    case 'check':
                        msg.channel.send(`Tổng số meme trong ngày hôm nay là ${memeCount} ^^`);
                        return;
                }

            case 'say':
                const generalChannel = bot.channels.get(general);
                generalChannel.send(content);
                return;
        }
    } catch (error) {
        msg.channel.send(`Trời đất dung hoa, vạn vật sinh sôi, nói nhảm gì thế bạn tôi?`);
        console.log("Error in parseCommand:");
        console.error(error);
    }
}