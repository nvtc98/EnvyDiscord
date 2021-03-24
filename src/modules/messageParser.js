const { channel } = require('../constants/discord.json');
const _ = require('lodash');

const { test, area51, general } = channel;

let memeCount = 0;

module.exports = (bot, msg) => {
    if (_.get(msg,'member.id','') == bot.user.id) { return; }

    countMeme(msg);

    checkCommonSentences(msg);
}

const countMeme = (msg) => {
    if (msg.attachments && !msg.content && memeCount < 11) {
        const data = Array.from(msg.attachments);
        if (data.length === 1) {
            ++memeCount;
            if (memeCount < 10) {
                msg.channel.send('Tổng số meme đã gửi hôm nay là ' + memeCount);
                msg.channel.send('Cố gắng đạt 10 meme mỗi ngày nhé các mêm lỏd ^^');
                return;
            }
            // msg.channel.send('KPI hoàn thành: Đã đạt đủ 10 meme trong ngày ^^', { files: ["https://i.pinimg.com/474x/c6/73/75/c673752c8ddb995b795111a63174263f.jpg"] });
            msg.channel.send('KPI hoàn thành: Đã đạt đủ 10 meme trong ngày ^^');
            msg.channel.send('https://imgur.com/a/lfHWSr4');
            return;
        }
    }
}

const checkCommonSentences = (msg) => {
    if(!msg.content) {
        return;
    }
    const message = msg.content.toLowerCase();

    switch (message) {
        case 'ngon':
            return msg.channel.send('Ngon ^^');
        case 'envy':
            return msg.channel.send('Chủ nhân gọi tôi');
        case 'lmao':
            return msg.channel.send('ler mao', { tts: true });
    }

    if (message === 'ngon') {
        msg.channel.send('Ngon ^^');
    }
    // if (m)

}