/**
 * INSTRUCTIONS FOR ADDING BOOKS TO THE BIBLE DATA
 * 
 * 1. Find the book you want to add in bibleData.ts (e.g., 'exodus', 'matthew', 'revelation')
 * 2. Replace the empty `chapters: []` array with the chapter data
 * 3. Follow the structure below for each chapter
 * 
 * TEMPLATE STRUCTURE:
 * 
 * {
 *   id: 'book-id',
 *   name: 'Book Name',
 *   testament: 'New Testament',
 *   bookNumber: N,
 *   chapters: [
 *     {
 *       chapter: 1,
 *       title: 'Chapter Title (optional)', 
 *       verses: [
 *         {
 *           verse: 1,
 *           text: 'The verse text here...'
 *           footnotes: ['Optional footnote text'] // optional
 *         },
 *         {
 *           verse: 2,
 *           text: 'Another verse...'
 *         },
 *         // ... more verses
 *       ]
 *     },
 *     // ... more chapters
 *   ]
 * }
 * 
 * EXAMPLE - Genesis Chapter 1 (already included):
 * 
 * {
 *   chapter: 1,
 *   title: 'The Story of Creation',
 *   verses: [
 *     {
 *       verse: 1,
 *       text: 'In the beginning, when God created the heavens and the earth—',
 *       footnotes: ['This section, from the Priestly source, functions as an introduction...']
 *     },
 *     {
 *       verse: 2,
 *       text: 'and the earth was without form or shape, with darkness over the abyss...',
 *       footnotes: ['This verse is parenthetical, describing in three phases...']
 *     },
 *     // ... more verses
 *   ]
 * }
 * 
 * TIPS:
 * - Copy and paste the text directly from your source
 * - Make sure to include verse numbers in the data structure, not in the text
 * - Optional footnotes can be omitted if they don't exist
 * - Keep chapter titles minimal (they're optional)
 * - Each verse should be a separate object in the verses array
 */

// This file is just documentation - the actual data is in bibleData.ts
export {};
