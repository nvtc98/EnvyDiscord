const list = [
  "https://64.media.tumblr.com/f977e9c8a86c8d5068d50204f95d534a/tumblr_oqz0sxfev21tydz8to1_540.gifv",
  "https://i.redd.it/ga8531syxd8z.jpg",
  "https://tenor.com/view/gabriel-gif-9035030",
  "https://i.redd.it/vk549tjj7pi31.png",
  "https://memestatic1.fjcdn.com/comments/Whats+quotfunquot+_6fc359ba42755c1f9afabdef810a970f.jpg",
  "https://i.pinimg.com/originals/92/1a/08/921a087d92316493aec247381d804bc9.png",
  "https://pa1.narvii.com/6668/c45fc0391e71c009dcca35e023d35221e528eaba_hq.gif",
  "https://pbs.twimg.com/media/Cplk9SDVIAAaeGb.jpg",
];

let currentIndex = 0;

module.exports = () => {
  const result = list[currentIndex];
  if (++currentIndex >= list.length) {
    return null;
  }
  return result;
};
