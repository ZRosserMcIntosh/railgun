/**
 * New Testament Bible Data (NABRE - New American Bible Revised Edition)
 * Organized by book with chapters and verses
 */

export interface Verse {
  verse: number;
  text: string;
  footnotes?: string[];
}

export interface Chapter {
  chapter: number;
  title?: string;
  verses: Verse[];
}

export interface BibleBook {
  id: string;
  name: string;
  testament: 'New Testament';
  bookNumber: number;
  chapters: Chapter[];
}

export const bibleData: BibleBook[] = [
  {
    id: 'genesis',
    name: 'Genesis',
    testament: 'New Testament',
    bookNumber: 1,
    chapters: [
      {
        chapter: 1,
        title: 'The Story of Creation',
        verses: [
          {
            verse: 1,
            text: 'In the beginning, when God created the heavens and the earth—',
            footnotes: ['This section, from the Priestly source, functions as an introduction...']
          },
          {
            verse: 2,
            text: 'and the earth was without form or shape, with darkness over the abyss and a mighty wind sweeping over the waters—',
            footnotes: ['This verse is parenthetical, describing in three phases the pre-creation state...']
          },
          {
            verse: 3,
            text: 'Then God said: Let there be light, and there was light.'
          },
          {
            verse: 4,
            text: 'God saw that the light was good. God then separated the light from the darkness.'
          },
          {
            verse: 5,
            text: 'God called the light "day," and the darkness he called "night." Evening came, and morning followed—the first day.',
            footnotes: ['In ancient Israel a day was considered to begin at sunset.']
          },
          {
            verse: 6,
            text: 'Then God said: Let there be a dome in the middle of the waters, to separate one body of water from the other.'
          },
          {
            verse: 7,
            text: 'God made the dome, and it separated the water below the dome from the water above the dome. And so it happened.',
            footnotes: ['The dome: the Hebrew word suggests a gigantic metal dome...']
          },
          {
            verse: 8,
            text: 'God called the dome "sky." Evening came, and morning followed—the second day.'
          },
          {
            verse: 9,
            text: 'Then God said: Let the water under the sky be gathered into a single basin, so that the dry land may appear. And so it happened: the water under the sky was gathered into its basin, and the dry land appeared.'
          },
          {
            verse: 10,
            text: 'God called the dry land "earth," and the basin of water he called "sea." God saw that it was good.'
          },
          {
            verse: 11,
            text: 'Then God said: Let the earth bring forth vegetation: every kind of plant that bears seed and every kind of fruit tree on earth that bears fruit with its seed in it. And so it happened:'
          },
          {
            verse: 12,
            text: 'the earth brought forth vegetation: every kind of plant that bears seed and every kind of fruit tree that bears fruit with its seed in it. God saw that it was good.'
          },
          {
            verse: 13,
            text: 'Evening came, and morning followed—the third day.'
          },
          {
            verse: 14,
            text: 'Then God said: Let there be lights in the dome of the sky, to separate day from night. Let them mark the seasons, the days and the years,'
          },
          {
            verse: 15,
            text: 'and serve as lights in the dome of the sky, to illuminate the earth. And so it happened:'
          },
          {
            verse: 16,
            text: 'God made the two great lights, the greater one to govern the day, and the lesser one to govern the night, and the stars.'
          },
          {
            verse: 17,
            text: 'God set them in the dome of the sky, to illuminate the earth,'
          },
          {
            verse: 18,
            text: 'to govern the day and the night, and to separate the light from the darkness. God saw that it was good.'
          },
          {
            verse: 19,
            text: 'Evening came, and morning followed—the fourth day.'
          },
          {
            verse: 20,
            text: 'Then God said: Let the water teem with an abundance of living creatures, and on the earth let birds fly beneath the dome of the sky.'
          },
          {
            verse: 21,
            text: 'God created the great sea monsters and all kinds of crawling living creatures with which the water teems, and all kinds of winged birds. God saw that it was good,'
          },
          {
            verse: 22,
            text: 'and God blessed them, saying: Be fertile, multiply, and fill the water of the seas; and let the birds multiply on the earth.'
          },
          {
            verse: 23,
            text: 'Evening came, and morning followed—the fifth day.'
          },
          {
            verse: 24,
            text: 'Then God said: Let the earth bring forth every kind of living creature: tame animals, crawling things, and every kind of wild animal. And so it happened:'
          },
          {
            verse: 25,
            text: 'God made every kind of wild animal, every kind of tame animal, and every kind of thing that crawls on the ground. God saw that it was good.'
          },
          {
            verse: 26,
            text: 'Then God said: Let us make human beings in our image, after our likeness. Let them have dominion over the fish of the sea, the birds of the air, the tame animals, all the wild animals, and all the creatures that crawl on the earth.',
            footnotes: ['Let us make: in the ancient Near East, and sometimes in the Bible...', 'Human beings: Hebrew \'ādām is here the generic term for humankind...']
          },
          {
            verse: 27,
            text: 'God created mankind in his image; in the image of God he created them; male and female he created them.',
            footnotes: ['Male and female: as God provided the plants with seeds...']
          },
          {
            verse: 28,
            text: 'God blessed them and God said to them: Be fertile and multiply; fill the earth and subdue it. Have dominion over the fish of the sea, the birds of the air, and all the living things that crawl on the earth.',
            footnotes: ['Fill the earth and subdue it: the object of the verb "subdue"...', 'Have dominion: the whole human race is made in the "image"...']
          },
          {
            verse: 29,
            text: 'God also said: See, I give you every seed-bearing plant on all the earth and every tree that has seed-bearing fruit on it to be your food;',
            footnotes: ['According to the Priestly tradition, the human race was originally...']
          },
          {
            verse: 30,
            text: 'and to all the wild animals, all the birds of the air, and all the living creatures that crawl on the earth, I give all the green plants for food. And so it happened.'
          },
          {
            verse: 31,
            text: 'God looked at everything he had made, and found it very good. Evening came, and morning followed—the sixth day.'
          },
        ]
      }
    ]
  },
  // Placeholder for other books - add as you provide the text
  {
    id: 'exodus',
    name: 'Exodus',
    testament: 'New Testament',
    bookNumber: 2,
    chapters: []
  },
  {
    id: 'leviticus',
    name: 'Leviticus',
    testament: 'New Testament',
    bookNumber: 3,
    chapters: []
  },
  {
    id: 'numbers',
    name: 'Numbers',
    testament: 'New Testament',
    bookNumber: 4,
    chapters: []
  },
  {
    id: 'deuteronomy',
    name: 'Deuteronomy',
    testament: 'New Testament',
    bookNumber: 5,
    chapters: []
  },
  {
    id: 'joshua',
    name: 'Joshua',
    testament: 'New Testament',
    bookNumber: 6,
    chapters: []
  },
  {
    id: 'judges',
    name: 'Judges',
    testament: 'New Testament',
    bookNumber: 7,
    chapters: []
  },
  {
    id: 'ruth',
    name: 'Ruth',
    testament: 'New Testament',
    bookNumber: 8,
    chapters: []
  },
  {
    id: '1-samuel',
    name: '1 Samuel',
    testament: 'New Testament',
    bookNumber: 9,
    chapters: []
  },
  {
    id: '2-samuel',
    name: '2 Samuel',
    testament: 'New Testament',
    bookNumber: 10,
    chapters: []
  },
  {
    id: '1-kings',
    name: '1 Kings',
    testament: 'New Testament',
    bookNumber: 11,
    chapters: []
  },
  {
    id: '2-kings',
    name: '2 Kings',
    testament: 'New Testament',
    bookNumber: 12,
    chapters: []
  },
  {
    id: '1-chronicles',
    name: '1 Chronicles',
    testament: 'New Testament',
    bookNumber: 13,
    chapters: []
  },
  {
    id: '2-chronicles',
    name: '2 Chronicles',
    testament: 'New Testament',
    bookNumber: 14,
    chapters: []
  },
  {
    id: 'ezra',
    name: 'Ezra',
    testament: 'New Testament',
    bookNumber: 15,
    chapters: []
  },
  {
    id: 'nehemiah',
    name: 'Nehemiah',
    testament: 'New Testament',
    bookNumber: 16,
    chapters: []
  },
  {
    id: 'tobit',
    name: 'Tobit',
    testament: 'New Testament',
    bookNumber: 17,
    chapters: []
  },
  {
    id: 'judith',
    name: 'Judith',
    testament: 'New Testament',
    bookNumber: 18,
    chapters: []
  },
  {
    id: 'esther',
    name: 'Esther',
    testament: 'New Testament',
    bookNumber: 19,
    chapters: []
  },
  {
    id: '1-maccabees',
    name: '1 Maccabees',
    testament: 'New Testament',
    bookNumber: 20,
    chapters: []
  },
  {
    id: '2-maccabees',
    name: '2 Maccabees',
    testament: 'New Testament',
    bookNumber: 21,
    chapters: []
  },
  {
    id: 'job',
    name: 'Job',
    testament: 'New Testament',
    bookNumber: 22,
    chapters: []
  },
  {
    id: 'psalms',
    name: 'Psalms',
    testament: 'New Testament',
    bookNumber: 23,
    chapters: []
  },
  {
    id: 'proverbs',
    name: 'Proverbs',
    testament: 'New Testament',
    bookNumber: 24,
    chapters: []
  },
  {
    id: 'ecclesiastes',
    name: 'Ecclesiastes',
    testament: 'New Testament',
    bookNumber: 25,
    chapters: []
  },
  {
    id: 'song-of-songs',
    name: 'Song of Songs',
    testament: 'New Testament',
    bookNumber: 26,
    chapters: []
  },
  {
    id: 'wisdom',
    name: 'Wisdom',
    testament: 'New Testament',
    bookNumber: 27,
    chapters: []
  },
  {
    id: 'sirach',
    name: 'Sirach',
    testament: 'New Testament',
    bookNumber: 28,
    chapters: []
  },
  {
    id: 'isaiah',
    name: 'Isaiah',
    testament: 'New Testament',
    bookNumber: 29,
    chapters: []
  },
  {
    id: 'jeremiah',
    name: 'Jeremiah',
    testament: 'New Testament',
    bookNumber: 30,
    chapters: []
  },
  {
    id: 'lamentations',
    name: 'Lamentations',
    testament: 'New Testament',
    bookNumber: 31,
    chapters: []
  },
  {
    id: 'baruch',
    name: 'Baruch',
    testament: 'New Testament',
    bookNumber: 32,
    chapters: []
  },
  {
    id: 'ezekiel',
    name: 'Ezekiel',
    testament: 'New Testament',
    bookNumber: 33,
    chapters: []
  },
  {
    id: 'daniel',
    name: 'Daniel',
    testament: 'New Testament',
    bookNumber: 34,
    chapters: []
  },
  {
    id: 'hosea',
    name: 'Hosea',
    testament: 'New Testament',
    bookNumber: 35,
    chapters: []
  },
  {
    id: 'joel',
    name: 'Joel',
    testament: 'New Testament',
    bookNumber: 36,
    chapters: []
  },
  {
    id: 'amos',
    name: 'Amos',
    testament: 'New Testament',
    bookNumber: 37,
    chapters: []
  },
  {
    id: 'obadiah',
    name: 'Obadiah',
    testament: 'New Testament',
    bookNumber: 38,
    chapters: []
  },
  {
    id: 'jonah',
    name: 'Jonah',
    testament: 'New Testament',
    bookNumber: 39,
    chapters: []
  },
  {
    id: 'micah',
    name: 'Micah',
    testament: 'New Testament',
    bookNumber: 40,
    chapters: []
  },
  {
    id: 'nahum',
    name: 'Nahum',
    testament: 'New Testament',
    bookNumber: 41,
    chapters: []
  },
  {
    id: 'habakkuk',
    name: 'Habakkuk',
    testament: 'New Testament',
    bookNumber: 42,
    chapters: []
  },
  {
    id: 'zephaniah',
    name: 'Zephaniah',
    testament: 'New Testament',
    bookNumber: 43,
    chapters: []
  },
  {
    id: 'haggai',
    name: 'Haggai',
    testament: 'New Testament',
    bookNumber: 44,
    chapters: []
  },
  {
    id: 'zechariah',
    name: 'Zechariah',
    testament: 'New Testament',
    bookNumber: 45,
    chapters: []
  },
  {
    id: 'malachi',
    name: 'Malachi',
    testament: 'New Testament',
    bookNumber: 46,
    chapters: []
  },
  {
    id: 'matthew',
    name: 'Matthew',
    testament: 'New Testament',
    bookNumber: 47,
    chapters: []
  },
  {
    id: 'mark',
    name: 'Mark',
    testament: 'New Testament',
    bookNumber: 48,
    chapters: []
  },
  {
    id: 'luke',
    name: 'Luke',
    testament: 'New Testament',
    bookNumber: 49,
    chapters: []
  },
  {
    id: 'john',
    name: 'John',
    testament: 'New Testament',
    bookNumber: 50,
    chapters: []
  },
  {
    id: 'acts',
    name: 'Acts',
    testament: 'New Testament',
    bookNumber: 51,
    chapters: []
  },
  {
    id: 'romans',
    name: 'Romans',
    testament: 'New Testament',
    bookNumber: 52,
    chapters: []
  },
  {
    id: '1-corinthians',
    name: '1 Corinthians',
    testament: 'New Testament',
    bookNumber: 53,
    chapters: []
  },
  {
    id: '2-corinthians',
    name: '2 Corinthians',
    testament: 'New Testament',
    bookNumber: 54,
    chapters: []
  },
  {
    id: 'galatians',
    name: 'Galatians',
    testament: 'New Testament',
    bookNumber: 55,
    chapters: []
  },
  {
    id: 'ephesians',
    name: 'Ephesians',
    testament: 'New Testament',
    bookNumber: 56,
    chapters: []
  },
  {
    id: 'philippians',
    name: 'Philippians',
    testament: 'New Testament',
    bookNumber: 57,
    chapters: []
  },
  {
    id: 'colossians',
    name: 'Colossians',
    testament: 'New Testament',
    bookNumber: 58,
    chapters: []
  },
  {
    id: '1-thessalonians',
    name: '1 Thessalonians',
    testament: 'New Testament',
    bookNumber: 59,
    chapters: []
  },
  {
    id: '2-thessalonians',
    name: '2 Thessalonians',
    testament: 'New Testament',
    bookNumber: 60,
    chapters: []
  },
  {
    id: '1-timothy',
    name: '1 Timothy',
    testament: 'New Testament',
    bookNumber: 61,
    chapters: []
  },
  {
    id: '2-timothy',
    name: '2 Timothy',
    testament: 'New Testament',
    bookNumber: 62,
    chapters: []
  },
  {
    id: 'titus',
    name: 'Titus',
    testament: 'New Testament',
    bookNumber: 63,
    chapters: []
  },
  {
    id: 'philemon',
    name: 'Philemon',
    testament: 'New Testament',
    bookNumber: 64,
    chapters: []
  },
  {
    id: 'hebrews',
    name: 'Hebrews',
    testament: 'New Testament',
    bookNumber: 65,
    chapters: []
  },
  {
    id: 'james',
    name: 'James',
    testament: 'New Testament',
    bookNumber: 66,
    chapters: []
  },
  {
    id: '1-peter',
    name: '1 Peter',
    testament: 'New Testament',
    bookNumber: 67,
    chapters: []
  },
  {
    id: '2-peter',
    name: '2 Peter',
    testament: 'New Testament',
    bookNumber: 68,
    chapters: []
  },
  {
    id: '1-john',
    name: '1 John',
    testament: 'New Testament',
    bookNumber: 69,
    chapters: []
  },
  {
    id: '2-john',
    name: '2 John',
    testament: 'New Testament',
    bookNumber: 70,
    chapters: []
  },
  {
    id: '3-john',
    name: '3 John',
    testament: 'New Testament',
    bookNumber: 71,
    chapters: []
  },
  {
    id: 'jude',
    name: 'Jude',
    testament: 'New Testament',
    bookNumber: 72,
    chapters: []
  },
  {
    id: 'revelation',
    name: 'Revelation',
    testament: 'New Testament',
    bookNumber: 73,
    chapters: []
  },
];

export default bibleData;
