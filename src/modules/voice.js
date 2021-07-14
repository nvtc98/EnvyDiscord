const {
  channel: { idle },
} = require("../constants/discord.json");

module.exports = (bot) => {
  const voiceChannel = bot.channels.cache.get(idle);
  const connection = await voiceChannel
    .join()
    .catch(() => console.log("Không thể truy cập voice channel."));
  let dispatcher = connection.play(
    ytdl("https://www.youtube.com/watch?v=a-Nj6S74MoI", { filter: "audioonly" })
  );
  dispatcher.on("finish", () => {
    dispatcher = connection.play(
      ytdl("https://www.youtube.com/watch?v=a-Nj6S74MoI", {
        filter: "audioonly",
      })
    );
  });
};
