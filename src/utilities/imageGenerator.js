const list = [
    'https://pbs.twimg.com/media/EglIeIxXgAELBR4.jpg',
    'https://pbs.twimg.com/media/C7b9nOjVAAQGL9T.jpg',
    'https://i.pinimg.com/originals/1d/a5/61/1da561e1bd379bcfb38e422ed0c8ed0e.png',
    'https://pbs.twimg.com/media/DbKKTVgX0AE0nxL.jpg',
    'https://i.redd.it/wa6qcugnp1h21.png',
];

let currentIndex = 0;

module.exports = () => {
    const result = list[currentIndex];
    if (++currentIndex >= list.length) {
        currentIndex = 0;
    }
    return result;
};