const list = [
  "https://i.redd.it/zvltw5q5fp3z.jpg",
  "https://a0.anyrgb.com/pngimg/1276/1958/dropout-gabriel-dropout-9-th-gabriel-atx-blond-eyelash-cg-artwork-angel-hime-cut.png",
  "https://pbs.twimg.com/media/C7b9nOjVAAQGL9T.jpg",
  "https://i.pinimg.com/originals/27/b9/8a/27b98ad826e261e76f21009d1900baa1.png",
  "https://pbs.twimg.com/media/EglIeIxXgAELBR4.jpg",
  "https://i.redd.it/wa6qcugnp1h21.png",
  "https://i.ytimg.com/vi/nAQ6gYRo86U/maxresdefault.jpg",
  "https://andrearitsu.files.wordpress.com/2017/01/horriblesubs-gabriel-dropout-01-1080p-mkv_snapshot_07-40_2017-01-09_20-02-26.jpg?w=1200",
];

let currentIndex = 0;

module.exports = () => {
  const result = list[currentIndex];
  if (++currentIndex >= list.length) {
    currentIndex = 0;
  }
  return result;
};
