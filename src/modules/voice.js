const {
  channel: { idle },
} = require("../constants/discord.json");
const ytdl = require("ytdl-core");

module.exports = async (bot) => {
  const voiceChannel = bot.channels.cache.get(idle);
  const connection = await voiceChannel
    .join()
    .catch(() => console.log("Không thể truy cập voice channel."));
  if (!connection) {
    return;
  }
  let dispatcher = connection.play(
    ytdl("https://www.youtube.com/watch?v=a-Nj6S74MoI", { filter: "audioonly" })
  );
  const restart = () => {
    dispatcher = connection.play(
      ytdl("https://www.youtube.com/watch?v=a-Nj6S74MoI", {
        filter: "audioonly",
      })
    );
  };
  dispatcher.on("finish", restart);
};
