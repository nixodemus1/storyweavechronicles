import React, { useState, useEffect, useContext } from "react";
import { useParams } from "react-router-dom";
import { stepColor } from "../utils/colorUtils";
import { ThemeContext } from "../themeContext";
import { SteppedContainer } from "../components/ContainerDepthContext.jsx";
// Removed CommentsProvider import; using memoized CommentsSection only
import { CommentsProvider } from "../components/commentsContext.jsx";
import CommentsSection from "../components/CommentsSection";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;
const CACHE_LIMIT = 3; // Max number of books to cache

// Utility: Print localStorage usage and breakdown
function printLocalStorageUsage() {
  let totalBytes = 0;
  let breakdown = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = localStorage.getItem(key);
    const bytes = key.length + (value ? value.length : 0);
    totalBytes += bytes;
    // Try to classify
    let label = key;
    if (key === 'swc_cover_cache') {
      label = 'Cover Cache';
    } else if (key.startsWith('storyweave_book_')) {
      label = 'Book Cache: ' + key.replace('storyweave_book_', '');
    } else if (key === 'swc_session_id') {
      label = 'Session ID';
    }
    breakdown.push({ label, bytes });
  }
  // Print summary
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  console.warn(`LocalStorage quota exceeded! Total storage: ${totalMB} MB`);
  breakdown.sort((a, b) => b.bytes - a.bytes);
  breakdown.forEach(item => {
    console.warn(`${item.label}: ${item.bytes} bytes (${(item.bytes / 1024).toFixed(2)} KB)`);
  });
}

function getBookCacheKey(id) {
  return `storyweave_book_${id}`;
}

function getCachedBooksList() {
  const raw = localStorage.getItem('storyweave_book_cache_list');
  return raw ? JSON.parse(raw) : [];
}

function setCachedBooksList(list) {
  localStorage.setItem('storyweave_book_cache_list', JSON.stringify(list));
}

function addBookToCache(id, data) {
  try {
    // Only cache text and page number, not images
    let cacheData;
    if (Array.isArray(data)) {
      cacheData = data.map(page => ({ text: page.text, page: page.page }));
    } else if (typeof data === 'object' && data !== null) {
      cacheData = { text: data.text, page: data.page };
    } else {
      cacheData = data;
    }
    localStorage.setItem(getBookCacheKey(id), JSON.stringify(cacheData));
    let list = getCachedBooksList();
    // Remove if already present
    list = list.filter(bid => bid !== id);
    list.push(id);
    // Evict oldest if over limit
    while (list.length > CACHE_LIMIT) {
      const oldest = list.shift();
      localStorage.removeItem(getBookCacheKey(oldest));
    }
    setCachedBooksList(list);
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      console.warn('LocalStorage quota exceeded, cannot cache more books/pages.');
      if (typeof printLocalStorageUsage === 'function') {
        printLocalStorageUsage();
      }
    } else {
      throw e;
    }
  }
}

function removeBookFromCache(id) {
  localStorage.removeItem(getBookCacheKey(id));
  let list = getCachedBooksList().filter(bid => bid !== id);
  setCachedBooksList(list);
}

// Purge all book cache keys except the current one
function purgeUnusedBookCache(currentBookId) {
  const list = getCachedBooksList();
  list.forEach(bid => {
    if (bid !== currentBookId) {
      localStorage.removeItem(getBookCacheKey(bid));
    }
  });
  setCachedBooksList([currentBookId]);
}

export default function PDFReader() {
  // Utility: Print localStorage usage and breakdown
  function printLocalStorageUsage() {
    let totalBytes = 0;
    let breakdown = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      const bytes = key.length + (value ? value.length : 0);
      totalBytes += bytes;
      // Try to classify
      let label = key;
      if (key === 'swc_cover_cache') label = 'covers';
      else if (key.startsWith('storyweave_book_')) label = `text for ${key.replace('storyweave_book_', '')}`;
      else if (key === 'swc_session_id') label = 'user session';
      else if (key === 'storyweave_book_cache_list') label = 'book cache list';
      else if (key.startsWith('user_')) label = 'user data';
      breakdown.push({ label, bytes });
    }
    // Print summary
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
    console.warn(`LocalStorage quota exceeded! Total storage: ${totalMB} MB`);
    breakdown.sort((a, b) => b.bytes - a.bytes);
    breakdown.forEach(item => {
      const mb = (item.bytes / (1024 * 1024)).toFixed(2);
      console.warn(`L ${item.label}: ${mb} MB`);
    });
  }
  // Ensure a session ID exists in localStorage
    useEffect(() => {
      let sessionId = localStorage.getItem('swc_session_id');
      if (!sessionId) {
        // Generate a random session ID
        sessionId = 'swc_' + Math.random().toString(36).substr(2, 16) + '_' + Date.now();
        localStorage.setItem('swc_session_id', sessionId);
      }
    }, []);
  const { id } = useParams();
  // Parse query params for comment deep-linking
  const [commentToScroll, setCommentToScroll] = useState(null);
  const [commentsPageFromQuery, setCommentsPageFromQuery] = useState(null);
  useEffect(() => {
    const search = window.location.search;
    const params = new URLSearchParams(search);
    const commentId = params.get('comment');
    const commentsPage = params.get('commentsPage');
    if (commentId) setCommentToScroll(commentId);
    if (commentsPage) setCommentsPageFromQuery(parseInt(commentsPage));
  }, [id]);
  const [pages, setPages] = useState([]);
  // Removed unused loadingBook state
  const [pageCount, setPageCount] = useState(0); // Track total pages as they arrive
  const [bookMeta, setBookMeta] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const { theme, textColor, backgroundColor, user, setUser } = useContext(ThemeContext);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [bookmarkMsg, setBookmarkMsg] = useState("");
  const [userVote, setUserVote] = useState(null);
  const [voteStats, setVoteStats] = useState({ average: 0, count: 0 });
  // Used to trigger comments refresh ONLY on user actions
  // Now handled by CommentsContext

  // Color logic for containers and buttons
  const baseBg = stepColor(backgroundColor, theme, 0);
  const navButtonBg = stepColor(backgroundColor, theme, 1);
  const navButtonText = textColor;
  const pdfPageBg = stepColor(backgroundColor, theme, 1);
  const bookMetaBg = stepColor(backgroundColor, theme, 2);
  const commentsOuterBg = stepColor(backgroundColor, theme, 3);

  // Fetch all pages sequentially and store in localStorage
  const [pdfError, setPdfError] = useState(null);
  useEffect(() => {
    setPdfError(null);
    setPages([]);
    setPageCount(0);
    let sessionId = (user && user.sessionId) || localStorage.getItem('swc_session_id');
    if (!sessionId) {
      sessionId = 'swc_' + Math.random().toString(36).substr(2, 16) + '_' + Date.now();
      localStorage.setItem('swc_session_id', sessionId);
    }

    // Purge all other book cache keys except the current one
    if (id) {
      purgeUnusedBookCache(id);
    }

    let fetchedPages = [];
    let pageNum = 1;
    let stopped = false;
    let totalPagesFromBackend = null;
    const requestedPages = new Set();
    async function fetchAllPages() {
        while (!stopped) {
          if (stopped) return;
          // If we know totalPagesFromBackend, only fetch while pageNum <= totalPagesFromBackend
          if (totalPagesFromBackend !== null && pageNum > totalPagesFromBackend) {
            stopped = true;
            break;
          }
          if (requestedPages.has(pageNum)) {
            pageNum++;
            continue;
          }
          requestedPages.add(pageNum);
          // Prevent requesting beyond last page BEFORE fetch
          if (totalPagesFromBackend !== null && pageNum > totalPagesFromBackend) {
            stopped = true;
            break;
          }
          const params = new URLSearchParams();
          params.set('page', pageNum);
          if (sessionId) params.set('session_id', sessionId);
          try {
            if (stopped) break;
            const res = await fetch(`${API_BASE_URL}/api/pdf-text/${id}?${params.toString()}`);
            if (stopped) break;
            const data = await res.json();
            if (stopped) break;
            if (data.success === true) {
              if (data.total_pages && totalPagesFromBackend === null) {
                totalPagesFromBackend = data.total_pages;
                setPageCount(data.total_pages);
              }
              // If we just learned totalPagesFromBackend, and pageNum >= totalPagesFromBackend, stop immediately
              if (totalPagesFromBackend !== null && pageNum >= totalPagesFromBackend) {
                stopped = true;
              }
              fetchedPages.push({
                page: data.page,
                text: data.text || '',
                images: data.images || []
              });
              setPages(pgs => {
                const arr = [...pgs];
                arr[data.page - 1] = {
                  page: data.page,
                  text: data.text || '',
                  images: data.images || []
                };
                return arr;
              });
              pageNum++;
            } else {
              // If backend signals out-of-range, stop fetching
              if (data.error && data.error.toLowerCase().includes('out of range')) {
                if (data.total_pages) {
                  totalPagesFromBackend = data.total_pages;
                  setPageCount(data.total_pages);
                }
                stopped = true;
                break;
              }
              setPdfError(data.error || 'Failed to load book pages.');
              break;
            }
          } catch {
            setPdfError('Failed to load book pages.');
            break;
          }
        }
      if (stopped) return;
      if (fetchedPages.length > 0) {
        try {
          addBookToCache(id, fetchedPages);
        } catch (e) {
          if (e.name === 'QuotaExceededError') {
            printLocalStorageUsage();
            console.warn('LocalStorage quota exceeded, cannot cache more books/pages.');
            setPdfError('LocalStorage quota exceeded. Cannot cache more pages. Loading stopped.');
            stopped = true;
            return;
          }
        }
      } else {
        setPdfError('No pages found in this book.');
      }
    }
    fetchAllPages();
    return () => { stopped = true; };
  }, [id, user]);

  // Remove book from cache when user reaches last page
  useEffect(() => {
    if (pages.length > 0 && currentPage === pages.length) {
      removeBookFromCache(id);
    }
  }, [pages, currentPage, id]);

  // Fetch book metadata
  useEffect(() => {
    const folderId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) return;
    fetch(`${API_BASE_URL}/list-pdfs/${folderId}`)
      .then(res => res.json())
      .then(data => {
        if (data.pdfs && Array.isArray(data.pdfs)) {
          const found = data.pdfs.find(b => b.id === id);
          if (found) setBookMeta(found);
        }
      });
  }, [id]);

  // Check if this book is bookmarked by the user
  useEffect(() => {
    if (user && user.username) {
      fetch(`${API_BASE_URL}/api/get-bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.bookmarks)) {
            const bm = data.bookmarks.find(b => b.id === id);
            setIsBookmarked(!!bm);
          } else {
            setIsBookmarked(false);
          }
        })
        .catch(() => setIsBookmarked(false));
    }
  }, [user, id]);

  // Track last page update only if book is bookmarked
  useEffect(() => {
    if (user && user.username && id && currentPage && isBookmarked) {
      fetch(`${API_BASE_URL}/api/update-bookmark-meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, book_id: id, last_page: currentPage })
      });
    }
  }, [user, id, currentPage, isBookmarked]);

  // Fetch user's vote for this book
  useEffect(() => {
    if (user && user.username && id) {
      fetch(`${API_BASE_URL}/api/user-voted-books?username=${user.username}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.voted_books)) {
            const v = data.voted_books.find(b => b.book_id === id);
            if (v) setUserVote(v.value);
          }
        });
    }
  }, [user, id]);

  // Fetch vote stats for this book
  useEffect(() => {
    if (id) {
      fetch(`${API_BASE_URL}/api/book-votes?book_id=${id}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) setVoteStats({ average: data.average, count: data.count });
        });
    }
  }, [id, userVote]);

  // Voting handler
  const handleVote = async (value) => {
    if (!user || !user.username) return;
    const res = await fetch(`${API_BASE_URL}/api/vote-book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, book_id: id, value })
    });
    const data = await res.json();
    if (data.success) {
      setUserVote(value);
  // Comment refresh now handled by context
    }
  };

  // Bookmark handlers
  const handleBookmark = async () => {
    if (!user || !user.username) {
      setBookmarkMsg("Please log in to bookmark.");
      return;
    }
    const res = await fetch(`${API_BASE_URL}/api/add-bookmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, book_id: id })
    });
    const data = await res.json();
    if (data.success) {
      setIsBookmarked(true);
      setBookmarkMsg("Bookmarked!");
      setUser && setUser(u => u ? { ...u, bookmarks: data.bookmarks } : u);
  // Comment refresh now handled by context
    } else {
      setBookmarkMsg(data.message || "Failed to bookmark.");
    }
  };
  const handleUnbookmark = async () => {
    if (!user || !user.username) {
      setBookmarkMsg("Please log in to remove bookmark.");
      return;
    }
    const res = await fetch(`${API_BASE_URL}/api/remove-bookmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, book_id: id })
    });
    const data = await res.json();
    if (data.success) {
      setIsBookmarked(false);
      setBookmarkMsg("Bookmark removed.");
      setUser && setUser(u => u ? { ...u, bookmarks: data.bookmarks } : u);
  // Comment refresh now handled by context
    } else {
      setBookmarkMsg(data.message || "Failed to remove bookmark.");
    }
  };


  // Only render the current page
  // Instead of blocking, show loading for not-yet-loaded pages
  const pageObj = pages && pages.length >= currentPage ? pages[currentPage - 1] : null;

  // Helper to render page text: cover page is rendered as a single block, others use paragraph splitting
  function renderPageText(pageObj) {
    if (!pageObj.text) return null;
    // If cover page (page 1), render as single block and ensure only one newline at the end
    if (pageObj.page === 1) {
      // Remove all trailing newlines, then add one
      const trimmedText = pageObj.text.replace(/\n+$/g, '') + '\n';
      return <div style={{ margin: '0 0 1em 0' }}>{trimmedText}</div>;
    }
    // Otherwise, split into paragraphs
    const lines = pageObj.text.split(/\n+/);
    const paras = [];
    let current = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // If line ends with punctuation or is long, treat as paragraph end
      if (/([.!?])$/.test(line) || line.length > 80) {
        current += (current ? ' ' : '') + line;
        paras.push(current);
        current = '';
      } else {
        current += (current ? ' ' : '') + line;
      }
    }
    if (current) paras.push(current);
    return paras.map((para, idx) => (
      <p key={idx} style={{ margin: '0 0 1em 0' }}>{para}</p>
    ));
  }
  // Error and loading states
  // Instead of blocking, show error between text and comments, but keep loaded pages and comments usable
  const [errorDismissed, setErrorDismissed] = useState(false);
  let errorBanner = null;
  if (pdfError && !errorDismissed) {
    // Show loaded vs total pages in error
    const loadedPages = pages.length;
    const totalPages = pageCount || (pages.length > 0 ? pages.length : null);
    let loadedSummary = '';
    if (totalPages) {
      loadedSummary = `Loaded ${loadedPages}/${totalPages} pages.`;
    } else {
      loadedSummary = `Loaded ${loadedPages} pages.`;
    }
    errorBanner = (
      <div className="pdf-reader-error-banner" style={{
        background: '#fff0f0',
        color: '#c00',
        border: '1px solid #c00',
        borderRadius: 8,
        padding: '16px 24px',
        margin: '24px auto',
        maxWidth: 900,
        textAlign: 'center',
        fontWeight: 600,
        fontSize: 18,
        boxShadow: '0 2px 8px rgba(200,0,0,0.04)'
      }}>
        <div style={{ marginBottom: 8 }}>⚠️ Error: {pdfError}</div>
        <div style={{ fontWeight: 400, fontSize: 15, color: '#a00', marginBottom: 8 }}>
          Some pages could not be loaded due to quota or backend error.<br />
          You can still read the pages <b>above</b> and use comments.
        </div>
        <div style={{ fontWeight: 500, fontSize: 15, color: '#222', marginBottom: 8 }}>{loadedSummary}</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
          <button style={{ marginTop: 0, padding: '8px 20px', borderRadius: 6, border: '1px solid #bbb', background: '#fff', color: '#333', fontWeight: 600, cursor: 'pointer' }} onClick={() => window.location.reload()}>Retry</button>
          <button style={{ marginTop: 0, padding: '8px 20px', borderRadius: 6, border: '1px solid #bbb', background: '#fff', color: '#333', fontWeight: 600, cursor: 'pointer' }} onClick={() => setErrorDismissed(true)}>Dismiss</button>
        </div>
      </div>
    );
  }
  // Remove loadingBook check here, always allow navigation

  return (
    <SteppedContainer step={0} style={{ minHeight: '100vh', background: baseBg, color: textColor }} className={`pdf-reader-container ${theme}-mode`}>
      <header className="pdf-reader-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {/* Logo/title can be added here if needed for PDFReader */}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {/* Theme toggle or other header actions if needed */}
        </div>
      </header>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
        <button
          className="pdf-reader-btn"
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
          disabled={currentPage === 1}
          style={{ background: navButtonBg, color: navButtonText, border: `1px solid ${navButtonText}`, borderRadius: 6, padding: '6px 16px', fontWeight: 600, cursor: currentPage === 1 ? 'not-allowed' : 'pointer', marginRight: 8 }}
        >
          ◀ Prev
        </button>
        <span className="pdf-reader-page-indicator" style={{ fontWeight: 600, fontSize: 18 }}>
          Page {currentPage} / {
            // Show live loaded count until all pages loaded or error
            (pdfError || (pageCount > 0 && pages.length === pageCount))
              ? pageCount
              : pages.length
          }
        </span>
        <button
          className="pdf-reader-btn"
          onClick={() => setCurrentPage(p => {
            const maxPage = (pdfError || (pageCount > 0 && pages.length === pageCount)) ? pageCount : pages.length;
            return Math.min(maxPage, p + 1);
          })}
          disabled={currentPage === ((pdfError || (pageCount > 0 && pages.length === pageCount)) ? pageCount : pages.length)}
          style={{ background: navButtonBg, color: navButtonText, border: `1px solid ${navButtonText}`, borderRadius: 6, padding: '6px 16px', fontWeight: 600, cursor: currentPage === ((pdfError || (pageCount > 0 && pages.length === pageCount)) ? pageCount : pages.length) ? 'not-allowed' : 'pointer', marginLeft: 8 }}
        >
          Next ▶
        </button>
      </div>

      <SteppedContainer step={1} style={{ borderRadius: 8, padding: 32, margin: 16, background: pdfPageBg, maxWidth: 1100, marginLeft: 'auto', marginRight: 'auto' }} className="pdf-reader-page">
        {/* Show loading or page content */}
        {pageObj ? (
          <div key={pageObj.page}>
            {pageObj.images && pageObj.images.length > 0 && (
              <div className="pdf-reader-images" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                {pageObj.images.map((img, idx) => {
                  let src, ext;
                  if (typeof img === 'string') {
                    src = img.startsWith('/pdf-cover/') ? `${API_BASE_URL}${img}` : img;
                    ext = 'png';
                  } else {
                    ext = img.ext || 'png';
                    src = `data:image/${ext};base64,${img.base64}`;
                  }
                  const isCover = pageObj.page === 1 && idx === 0;
                  return (
                    <img
                      key={idx}
                      src={src}
                      alt={`Page ${pageObj.page} Image ${idx + 1}`}
                      loading="lazy"
                      style={isCover ? {
                        width: '100%',
                        height: 'auto',
                        objectFit: 'cover',
                        borderRadius: 16,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
                        margin: '0 auto',
                        display: 'block'
                      } : {
                        maxWidth: '100%',
                        maxHeight: '400px',
                        width: 'auto',
                        height: 'auto',
                        objectFit: 'contain',
                        borderRadius: 8,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
                      }}
                    />
                  );
                })}
              </div>
            )}
            {pageObj.text && (
              <div className="pdf-reader-text" style={{ width: '100%', wordBreak: 'break-word', whiteSpace: 'pre-line' }}>
                {renderPageText(pageObj)}
              </div>
            )}
          </div>
        ) : (
          <div style={{
            width: '100%',
            minHeight: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#e0ffe0',
            color: '#080',
            borderRadius: 16,
            fontSize: 22,
            fontStyle: 'italic',
            boxShadow: '0 2px 16px rgba(0,0,0,0.10)'
          }}>
            Loading page {currentPage}...
          </div>
        )}
      </SteppedContainer>

      {/* Show error banner between text and comments if error occurs */}
      {errorBanner}

      <SteppedContainer step={2} style={{ margin: '0 auto', maxWidth: 900, borderRadius: 8, padding: 20, marginBottom: 32, marginTop: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', background: bookMetaBg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 22 }}>{bookMeta?.title || `Book ${id}`}</span>
          {isBookmarked ? (
            <button
              onClick={handleUnbookmark}
              style={{ background: '#ffe0e0', color: '#c00', border: '1px solid #c00', borderRadius: 6, padding: '6px 16px', fontWeight: 600, cursor: 'pointer' }}
            >★ Unfavorite</button>
          ) : (
            <button
              onClick={handleBookmark}
              style={{ background: '#e0f7ff', color: '#0070f3', border: '1px solid #0070f3', borderRadius: 6, padding: '6px 16px', fontWeight: 600, cursor: 'pointer' }}
            >☆ Favorite</button>
          )}
          {bookmarkMsg && <span style={{ marginLeft: 10, color: bookmarkMsg.includes('Bookmarked') ? 'green' : '#c00', fontSize: 14 }}>{bookmarkMsg}</span>}
        </div>
        <div style={{ marginBottom: 10 }}>
          <span style={{ fontWeight: 500, marginRight: 8 }}>Your Rating:</span>
          {[1,2,3,4,5].map(star => (
            <span
              key={star}
              style={{
                fontSize: 22,
                color: star <= userVote ? '#f5c518' : '#ccc',
                cursor: user ? 'pointer' : 'not-allowed',
                opacity: user ? 1 : 0.5,
                marginRight: 2
              }}
              title={user ? `Rate ${star} star${star > 1 ? 's' : ''}` : "Log in to vote"}
              onClick={() => user && handleVote(star)}
            >★</span>
          ))}
          <span style={{ marginLeft: 8, color: '#888', fontSize: 13 }}>
            {voteStats.count > 0
              ? `Avg: ${voteStats.average} (${voteStats.count} vote${voteStats.count > 1 ? 's' : ''})`
              : "(No votes yet)"}
          </span>
        </div>
        <SteppedContainer step={3} style={{ marginTop: 18, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', padding: 18, background: commentsOuterBg }}>
          <CommentsProvider bookId={id}>
            <CommentsSection commentToScroll={commentToScroll} commentsPageFromQuery={commentsPageFromQuery} />
          </CommentsProvider>
        </SteppedContainer>
      </SteppedContainer>
    </SteppedContainer>
  );
}