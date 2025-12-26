import { useState, useMemo } from 'react';
import { bibleData, BibleBook } from '../data/bibleData';

const BookIcon = () => (
  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
    <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z" />
    <path d="M3 4a2 2 0 012-2h14a2 2 0 012 2v16a2 2 0 01-2 2H5a2 2 0 01-2-2V4zm4 0v16h10V4H7z" />
  </svg>
);

const SearchIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

interface SearchResult {
  bookName: string;
  chapter: number;
  verse: number;
  text: string;
}

export default function BibleReader() {
  const [selectedBook, setSelectedBook] = useState<BibleBook | null>(bibleData[0]);
  const [selectedChapter, setSelectedChapter] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showBookList, setShowBookList] = useState(false);

  // Handle search
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.trim().length === 0) {
      setSearchResults([]);
      return;
    }

    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    bibleData.forEach((book) => {
      book.chapters.forEach((chapter) => {
        chapter.verses.forEach((verse) => {
          if (verse.text.toLowerCase().includes(lowerQuery)) {
            results.push({
              bookName: book.name,
              chapter: chapter.chapter,
              verse: verse.verse,
              text: verse.text,
            });
          }
        });
      });
    });

    setSearchResults(results);
  };

  // Handle search result click
  const handleSearchResultClick = (result: SearchResult) => {
    const book = bibleData.find((b) => b.name === result.bookName);
    if (book) {
      setSelectedBook(book);
      setSelectedChapter(result.chapter);
      setShowSearch(false);
      setSearchQuery('');
      setSearchResults([]);
    }
  };

  // Get current chapter content
  const currentChapter = useMemo(() => {
    if (!selectedBook) return null;
    return selectedBook.chapters.find((ch) => ch.chapter === selectedChapter);
  }, [selectedBook, selectedChapter]);

  if (!selectedBook) {
    return <div className="text-text-primary">No book selected</div>;
  }

  return (
    <div className="w-full h-full bg-surface-secondary flex flex-col">
      {/* Header */}
      <div className="bg-surface-tertiary border-b border-dark-900 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookIcon />
          <div>
            <h1 className="text-xl font-bold text-text-primary">{selectedBook.name}</h1>
            {currentChapter && (
              <p className="text-sm text-text-muted">Chapter {currentChapter.chapter}</p>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowSearch(!showSearch)}
          className="p-2 hover:bg-surface-elevated rounded text-text-muted hover:text-text-primary transition-colors"
          title="Search Bible"
        >
          <SearchIcon />
        </button>
      </div>

      {/* Search Bar */}
      {showSearch && (
        <div className="bg-surface-secondary border-b border-dark-900 p-4">
          <input
            type="text"
            placeholder="Search Bible text..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            autoFocus
            className="w-full px-4 py-2 bg-surface-elevated text-text-primary placeholder-text-muted rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-64 overflow-y-auto bg-surface-elevated rounded">
              {searchResults.map((result, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSearchResultClick(result)}
                  className="w-full text-left px-4 py-2 hover:bg-surface-tertiary border-b border-dark-700 last:border-b-0"
                >
                  <div className="text-sm font-semibold text-text-primary">
                    {result.bookName} {result.chapter}:{result.verse}
                  </div>
                  <div className="text-xs text-text-secondary line-clamp-2">
                    {result.text}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Book/Chapter Selector */}
        <div className="w-56 bg-surface-primary border-r border-dark-900 flex flex-col">
          {/* Book Selector */}
          <div className="border-b border-dark-900 p-4">
            <button
              onClick={() => setShowBookList(!showBookList)}
              className="w-full px-3 py-2 bg-primary-500 text-white rounded hover:bg-primary-600 transition-colors text-sm font-semibold"
            >
              {showBookList ? 'Hide Books' : 'Select Book'}
            </button>

            {showBookList && (
              <div className="mt-2 max-h-96 overflow-y-auto space-y-1">
                {bibleData.map((book) => {
                  // New Testament books start from Matthew (bookNumber 47)
                  const isNewTestament = book.bookNumber >= 47;
                  
                  return (
                    <button
                      key={book.id}
                      onClick={() => {
                        setSelectedBook(book);
                        setShowBookList(false);
                        if (book.chapters.length > 0) {
                          setSelectedChapter(book.chapters[0].chapter);
                        }
                      }}
                      className={`w-full text-left px-3 py-1 text-sm rounded transition-colors ${
                        selectedBook.id === book.id
                          ? 'bg-primary-500 text-white'
                          : isNewTestament
                          ? 'text-red-400 hover:bg-surface-secondary hover:text-red-300'
                          : 'text-gray-300 hover:bg-surface-secondary hover:text-gray-200'
                      } ${book.chapters.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                      disabled={book.chapters.length === 0}
                    >
                      {book.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Chapter Selector */}
          <div className="flex-1 overflow-y-auto p-4 space-y-1">
            <h3 className="text-xs font-semibold uppercase text-text-muted mb-2">Chapters</h3>
            {selectedBook.chapters.length === 0 ? (
              <p className="text-xs text-text-muted italic">No chapters available</p>
            ) : (
              selectedBook.chapters.map((chapter) => (
                <button
                  key={chapter.chapter}
                  onClick={() => setSelectedChapter(chapter.chapter)}
                  className={`w-full px-3 py-1.5 text-sm rounded transition-colors ${
                    selectedChapter === chapter.chapter
                      ? 'bg-primary-500 text-white'
                      : 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
                  }`}
                >
                  Chapter {chapter.chapter}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Bible Text Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {currentChapter ? (
            <div>
              {/* Chapter Title */}
              {currentChapter.title && (
                <h2 className="text-2xl font-bold text-text-primary mb-6">
                  {currentChapter.title}
                </h2>
              )}

              {/* Verses */}
              <div className="space-y-4">
                {currentChapter.verses.map((verse) => (
                  <div key={verse.verse} className="text-text-primary">
                    <div className="flex gap-3">
                      <span className="inline-block font-semibold text-primary-400 min-w-fit">
                        {verse.verse}
                      </span>
                      <div className="flex-1">
                        <p className="leading-relaxed">{verse.text}</p>
                        {verse.footnotes && verse.footnotes.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {verse.footnotes.map((footnote, idx) => (
                              <div
                                key={idx}
                                className="text-xs text-text-muted bg-surface-elevated p-2 rounded italic border-l-2 border-primary-500"
                              >
                                {footnote}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted">
              <p>No content available for this chapter</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
