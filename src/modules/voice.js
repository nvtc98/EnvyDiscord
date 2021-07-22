const {
  channel: { idle },
} = require("../constants/discord.json");
const ytdl = require("ytdl-core");

let connection = null;
let dispatcher = null;

const enterVoiceChannel = async (bot) => {
  const voiceChannel = bot.channels.cache.get(idle);
  connection = await voiceChannel
    .join()
    .catch(() => console.log("Không thể truy cập voice channel."));
};

const playYoutube = (url) => {
  try {
    if (!connection) {
      return;
    }
    dispatcher = connection.play(ytdl(url, { filter: "audioonly" }));
    // const restart = () => {
    //   console.log("restart");
    //   dispatcher = connection.play(
    //     ytdl("https://www.youtube.com/watch?v=a-Nj6S74MoI", {
    //       filter: "audioonly",
    //     })
    //   );
    //   dispatcher.on("finish", restart);
    // };
    // dispatcher.on("finish", restart);
  } catch (e) {
    console.log(e);
    throw true;
  }
};

const setVolume = (value) => {
  dispatcher.setVolume(value);
};

const stopVoice = () => {
  dispatcher.destroy();
};

module.exports = { enterVoiceChannel, playYoutube, setVolume, stopVoice };
