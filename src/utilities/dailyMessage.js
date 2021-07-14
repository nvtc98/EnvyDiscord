const list = [
  {
    message:
      "Thứ hai là ngày đầu tuần, nào anh em ta quây quần. Ghem ghem thôi các cậu ≧◡≦",
    image: "https://data.whicdn.com/images/285968285/original.jpg",
  },
  {
    message: "Thứ ba chết cha chưa chơi ghem. Ghem ghem thôi các cậu ≧◡≦",
    image: "https://data.whicdn.com/images/285968285/original.jpg",
  },
  {
    message:
      "Cuối tuần đang đến gần, sao Kalibi lại bần thần? Ghem ghem thôi các cậu ≧◡≦",
    image:
      "https://64.media.tumblr.com/3ccd1612ec3dadc0a99d4a24d9d22b10/0f45f5734d5756c7-76/s500x750/5542bf5b75c935e9a8e49901b1a9bb618fffa9a5.png",
  },
  {
    message: "Thứ bảy máu chảy về ghem. Ghem ghem thôi các cậu ≧◡≦",
    image: "https://miro.medium.com/max/1400/1*LWfN3zd27BGOszyDOG95Tw.png",
  },
];

let currentIndex = 0;

module.exports = () => {
  const result = list[currentIndex];
  if (++currentIndex >= list.length) {
    currentIndex = 0;
  }
  return result;
};
