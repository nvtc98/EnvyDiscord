const list = [
  "https://i.redd.it/zvltw5q5fp3z.jpg",
  "https://preview.redd.it/q5wc3ttk18341.jpg?width=960&crop=smart&auto=webp&s=0735a02df43d4a9d9d701387691f61287a3e65ee",
  "https://pbs.twimg.com/media/C7b9nOjVAAQGL9T.jpg",
  "https://i.pinimg.com/originals/27/b9/8a/27b98ad826e261e76f21009d1900baa1.png",
  "https://i.ytimg.com/vi/nAQ6gYRo86U/maxresdefault.jpg",
  "https://andrearitsu.files.wordpress.com/2017/01/horriblesubs-gabriel-dropout-01-1080p-mkv_snapshot_07-40_2017-01-09_20-02-26.jpg?w=1200",
  "https://i.redd.it/wa6qcugnp1h21.png",
  "https://pbs.twimg.com/media/EglIeIxXgAELBR4.jpg",
];

let currentIndex = 0;

module.exports = () => {
  const result = list[currentIndex];
  if (++currentIndex >= list.length) {
    currentIndex = 0;
  }
  return result;
};
