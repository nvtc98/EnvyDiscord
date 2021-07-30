const list = [
  "Trong cái khó ló ra bể đầu",
  "Cái nade đánh chết cái đẹp",
  "Thắng làm vua, thua thì team địch hack",
  "Gần mực thì đen, gần clutch thì máy lag",
  "Trẻ trâu không nằm ở độ tuổi, trẻ trâu nằm ở trong site luôn không chịu về backup",
  "Có tiền mua gaygun cũng được",
  "Một điều nhịn là chín đứa bu vô chửi",
  "Một cây làm chẳng nên non, ba cây chụm lại nó cầm negev ra sấy thì bể đầu",
  "Còn nước còn tap",
  "Thất bại là mẹ bắn vậy mà -99 cay thế nhờ",
  "Ăn trông nồi, ngồi ngay đó nó lại chả prefire vào",
  "Tiên học smoke hậu học aim",
  "Cá không ăn muối cá luôn, nó yếu lắm rồiii",
  "Chưa thấy quan tài chưa bể đầu",
  "Trong 36 kế kế nhau ăn lửa là kẹt hết",
];

let currentIndex = 0;

module.exports = () => {
  const result = list[currentIndex];
  if (++currentIndex >= list.length) {
    currentIndex = 0;
  }
  return result;
};
