// --- Unified cover cache logic from LandingPage.jsx ---
function useCachedCovers(pdfs) {
  const [covers, setCovers] = React.useState({});
  React.useEffect(() => {
    let isMounted = true;
    const newCovers = {};
    const fetchQueue = [];
    pdfs.forEach(pdf => {
      if (!pdf || !pdf.id) return;
      const { url, expired } = getCoverFromCache(pdf.id);
      newCovers[pdf.id] = url;
      if (!url || expired) {
        fetchQueue.push(pdf.id);
      }
    });
    setCovers(newCovers);

    // Batch fetch covers in groups of 3 with a 300ms delay
    function batchFetchCovers(queue, batchSize = 3, delay = 300) {
      let i = 0;
      function fetchBatch() {
        const batch = queue.slice(i, i + batchSize);
        batch.forEach(bookId => {
          fetch(`${API_BASE_URL}/pdf-cover/${bookId}`)
            .then(res => res.ok ? res.blob() : null)
            .then(blob => {
              let coverUrl = null;
              if (blob && blob instanceof Blob && blob.type.startsWith('image/')) {
                coverUrl = URL.createObjectURL(blob);
                setCoverInCache(bookId, coverUrl);
                if (isMounted) setCovers(c => ({ ...c, [bookId]: coverUrl }));
              } else {
                setCoverInCache(bookId, null);
                if (isMounted) setCovers(c => ({ ...c, [bookId]: null }));
              }
            })
            .catch(() => {
              setCoverInCache(bookId, null);
              if (isMounted) setCovers(c => ({ ...c, [bookId]: null }));
            });
        });
        i += batchSize;
        if (i < queue.length) {
          setTimeout(fetchBatch, delay);
        }
      }
      fetchBatch();
    }
    if (fetchQueue.length > 0) batchFetchCovers(fetchQueue);

    return () => {
      Object.values(covers).forEach(url => {
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
      isMounted = false;
    };
    // DO NOT ADD covers TO DEPENDENCY ARRAY, IT CREATES AN INFINITE LOOP THAT WILL FREEZE YOUR BROWSER
  }, [pdfs]);
  return covers;
}
import React, { useContext, useState } from "react";
import { Link } from "react-router-dom";
import { ThemeContext } from "../themeContext";
import { stepColor } from "../utils/colorUtils";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;

function getCoverFromCache(bookId) {
  try {
    const cache = JSON.parse(localStorage.getItem('swc_cover_cache') || '{}');
    const entry = cache[bookId];
    if (!entry) return { url: `${API_BASE_URL}/pdf-cover/${bookId}`, expired: false };
    if (typeof entry === 'string') {
      return { url: entry, expired: false };
    }
    if (entry.url === '/no-cover.png') {
      const now = Date.now();
      const expired = !entry.ts || (now - entry.ts > 3600 * 1000);
      return { url: '/no-cover.png', expired };
    }
    return { url: entry.url, expired: false };
  } catch {
    return { url: `${API_BASE_URL}/pdf-cover/${bookId}`, expired: false };
  }
}
function setCoverInCache(bookId, url) {
  try {
    const cache = JSON.parse(localStorage.getItem('swc_cover_cache') || '{}');
    if (url === '/no-cover.png') {
      cache[bookId] = { url, ts: Date.now() };
    } else {
      cache[bookId] = { url };
    }
    localStorage.setItem('swc_cover_cache', JSON.stringify(cache));
  } catch {
    null;
  }
}

const BookmarksTab = React.memo(function BookmarksTab({ user }) {
  const { textColor, backgroundColor, theme } = useContext(ThemeContext);
  const [bookmarks, setBookmarks] = useState([]);
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    if (!user?.username) return;
    setLoading(true);
    fetch(`${API_BASE_URL}/api/get-bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username })
    })
      .then(res => res.json())
      .then(data => {
        setBookmarks(Array.isArray(data.bookmarks) ? data.bookmarks : []);
        setLoading(false);
      });
  }, [user?.username]);

  React.useEffect(() => {
    const folderId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) return;
    fetch(`${API_BASE_URL}/list-pdfs/${folderId}`)
      .then(res => res.json())
      .then(data => {
        setBooks(Array.isArray(data.pdfs) ? data.pdfs : []);
      });
  }, []);


    // Use unified cover cache logic from LandingPage.jsx
    const bookmarkedBooks = React.useMemo(() => {
      return bookmarks
        .map(bm => {
          const book = books.find(b => b.id === bm.id);
          return book ? { ...book, ...bm } : null;
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.last_updated) - new Date(a.last_updated));
    }, [bookmarks, books]);
    const covers = useCachedCovers(bookmarkedBooks);
  // Always use CSS variable for stepColor
  const cssBg = getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim() || backgroundColor;
  const containerBg = stepColor(cssBg, theme, 1);

    return (
      <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, background: containerBg, borderRadius: 8, padding: '18px 16px' }}>
        <h3>Your Bookmarked Books</h3>
        {loading ? (
          <div style={{ color: 'var(--meta-text, #888)' }}>Loading bookmarks...</div>
        ) : (
          bookmarkedBooks.length === 0 ? (
            <div style={{ color: 'var(--meta-text, #888)' }}>No bookmarks yet.</div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {bookmarkedBooks.map(book => {
                if (!book.id) {
                  console.warn('[AccountTabContent] BookmarksTab: invalid book id', book);
                }
                const coverUrl = covers[book.id] || '/no-cover.png';
                return (
                  <li
                    key={book.id || Math.random()}
                    style={{
                      marginBottom: 14,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      background: book.unread ? 'var(--unread-bg, #ffe0e0)' : 'transparent',
                      borderRadius: 6,
                      padding: '6px 8px',
                      boxShadow: book.unread ? '0 0 4px var(--unread-shadow, #c00)' : 'none',
                    }}
                  >
                    <Link to={book.id ? `/read/${book.id}` : '#'} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: textColor }}>
                      {book.id ? (
                        coverUrl === '/no-cover.png'
                          ? <div style={{
                              width: 38, height: 54,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: 'var(--cover-bg, #eee)', color: 'var(--cover-text, #888)', borderRadius: 4,
                              fontSize: 12, fontStyle: 'italic', boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
                            }}>No Cover</div>
                          : <img
                              src={coverUrl}
                              alt={book.name}
                              style={{ width: 38, height: 54, objectFit: 'cover', borderRadius: 4, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
                              onError={e => {
                                if (e.target.src !== '/no-cover.png') {
                                  setCoverInCache(book.id, '/no-cover.png');
                                  e.target.src = '/no-cover.png';
                                }
                              }}
                            />
                      ) : (
                        <span style={{ color: 'var(--error-text, #c00)', fontSize: 12 }}>[No valid book id]</span>
                      )}
                    </Link>
                    {/* Clickable book title next to cover */}
                    <Link to={book.id ? `/read/${book.id}` : '#'} style={{ color: textColor, textDecoration: 'underline', fontWeight: 600, fontSize: 16, marginLeft: 4 }}>
                      {book.title || book.name || book.id}
                    </Link>
                    <span style={{ fontSize: 13, color: 'var(--meta-text, #888)' }}>
                      Last updated: {book.last_updated ? book.last_updated : 'Never'}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--meta-text, #888)' }}>
                      Last page read: {book.last_page}
                    </span>
                    {book.unread && (
                      <span style={{ color: 'var(--unread-text, #c00)', fontWeight: 700, fontSize: 13 }}>Unread update!</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        )}
      </div>
    );
});

const UserTopVotedBooksTab = React.memo(function UserTopVotedBooksTab({ user }) {
  const { backgroundColor, textColor, theme } = useContext(ThemeContext);
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    if (!user?.username) return;
    setLoading(true);
    fetch(`${API_BASE_URL}/api/user-top-voted-books?username=${user.username}`)
      .then(res => res.json())
      .then(data => {
        if (data && Array.isArray(data.books)) {
          setBooks(data.books);
        } else {
          setBooks([]);
        }
        setLoading(false);
      });
  }, [user?.username]);


  // Use unified cover cache logic from LandingPage.jsx
  const covers = useCachedCovers(books);
  const cssBg = getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim() || backgroundColor;
  const containerBg = stepColor(cssBg, theme, 1);

  return (
    <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, background: containerBg, borderRadius: 8, padding: '18px 16px' }}>
      <h3 style={{ color: textColor }}>Your Top Voted Books</h3>
      {loading ? (
        <div style={{ color: 'var(--meta-text, #888)' }}>Loading...</div>
      ) : books.length === 0 ? (
        <div style={{ color: 'var(--meta-text, #888)' }}>No top voted books yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {books.map(book => {
            if (!book.id) {
              console.warn('[AccountTabContent] UserTopVotedBooksTab: invalid book id', book);
            }
            const coverUrl = covers[book.id] || '/no-cover.png';
            return (
              <li key={book.id || Math.random()} style={{
                marginBottom: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'var(--topvoted-bg, #f8f8f8)',
                borderRadius: 6,
                padding: '6px 8px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
              }}>
                <Link to={book.id ? `/read/${book.id}` : '#'} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: textColor }}>
                  {book.id ? (
                    coverUrl === '/no-cover.png'
                      ? <div style={{
                          width: 38, height: 54,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'var(--cover-bg, #eee)', color: 'var(--cover-text, #888)', borderRadius: 4,
                          fontSize: 12, fontStyle: 'italic', boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
                        }}>No Cover</div>
                      : <img
                          src={coverUrl}
                          alt={book.name}
                          style={{ width: 38, height: 54, objectFit: 'cover', borderRadius: 4, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
                          onError={e => {
                            if (e.target.src !== '/no-cover.png') {
                              setCoverInCache(book.id, '/no-cover.png');
                              e.target.src = '/no-cover.png';
                            }
                          }}
                        />
                  ) : (
                    <span style={{ color: 'var(--error-text, #c00)', fontSize: 12 }}>[No valid book id]</span>
                  )}
                </Link>
                <span style={{ fontWeight: 600, textDecoration: 'underline', fontSize: 16 }}>{book.name}</span>
                <span style={{ fontSize: 13, color: 'var(--meta-text, #888)' }}>
                  Votes: {book.votes}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});

const UserCommentsSection = React.memo(function UserCommentsSection({ user }) {
  const { backgroundColor, textColor, theme } = useContext(ThemeContext);
  const [comments, setComments] = useState([]);
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const commentsPageSize = user?.comments_page_size || 10;

  React.useEffect(() => {
    if (!user?.username) return;
    setLoading(true);
    fetch(`${API_BASE_URL}/api/user-comments?username=${user.username}`)
      .then(res => res.json())
      .then(data => {
        setComments(Array.isArray(data.comments) ? data.comments : []);
        setLoading(false);
      });
  }, [user?.username]);

  React.useEffect(() => {
    const folderId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) return;
    fetch(`${API_BASE_URL}/list-pdfs/${folderId}`)
      .then(res => res.json())
      .then(data => {
        setBooks(Array.isArray(data.pdfs) ? data.pdfs : []);
      });
  }, []);

  React.useEffect(() => {
    comments.forEach(comment => {
      const bookId = comment.book_id;
      const { url, expired } = getCoverFromCache(bookId);
      if (!url || expired || (url.startsWith(API_BASE_URL) && url !== '/no-cover.png')) {
        if (url !== '/no-cover.png' || expired) {
          // Use GET to fetch cover (backend only allows GET)
          fetch(`${API_BASE_URL}/pdf-cover/${bookId}`)
            .then(res => res.ok ? res.blob() : null)
            .then(blob => {
              let coverUrl = null;
              if (blob && blob instanceof Blob && blob.type.startsWith('image/')) {
                coverUrl = URL.createObjectURL(blob);
                setCoverInCache(bookId, coverUrl);
              } else {
                setCoverInCache(bookId, '/no-cover.png');
              }
            })
            .catch(() => {
              setCoverInCache(bookId, '/no-cover.png');
            });
        }
      }
    });
  }, [comments]);

  function getBookTitle(bookId) {
    const book = books.find(b => b.id === bookId);
    return book ? (book.title || book.name || bookId) : bookId;
  }

  // Helper: get page number for a comment in its book
  function getCommentPage(comment) {
    // Comments are sorted by timestamp ascending in backend
    const bookComments = comments.filter(c => c.book_id === comment.book_id);
    const idx = bookComments.findIndex(c => c.id === comment.id);
    if (idx === -1) return 1;
    return Math.floor(idx / commentsPageSize) + 1;
  }

  const cssBg = getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim() || backgroundColor;
  const containerBg = stepColor(cssBg, theme, 1);

  return (
    <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, background: containerBg, borderRadius: 8, padding: '18px 16px' }}>
      <h3 style={{ color: textColor }}>Your Comments</h3>
      {loading ? (
        <div style={{ color: 'var(--meta-text, #888)' }}>Loading comments...</div>
      ) : comments.length === 0 ? (
        <div style={{ color: 'var(--meta-text, #888)' }}>No comments yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {comments.map(comment => (
            <li key={comment.id} style={{ marginBottom: 14, background: comment.deleted ? 'var(--unread-bg, #ffe0e0)' : 'transparent', borderRadius: 6, padding: '6px 8px' }}>
              <Link
                to={`/read/${comment.book_id}?comment=${comment.id}&commentsPage=${getCommentPage(comment)}`}
                style={{ color: textColor, textDecoration: 'underline', fontWeight: 600 }}
              >
                {getBookTitle(comment.book_id)}
              </Link>
              <div style={{ fontSize: 14, color: textColor, marginTop: 4 }}>
                {comment.deleted ? <span style={{ color: 'var(--error-text, #c00)', fontStyle: 'italic' }}>Comment deleted</span> : comment.text}
              </div>
              <div style={{ fontSize: 12, color: 'var(--meta-text, #888)', marginTop: 2 }}>
                {new Date(comment.timestamp).toLocaleString()}
                {comment.edited && <span style={{ color: 'var(--edited-label, #f5c518)', marginLeft: 8 }}>(edited)</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

const AccountTabContent = React.memo(function AccountTabContent({ user, setUser }) {
  const { backgroundColor, theme } = useContext(ThemeContext);
  const cssBg = getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim() || backgroundColor;
  const overviewBg = stepColor(cssBg, theme, 1);
  // Comments page size state
  const [commentsPageSize, setCommentsPageSize] = useState(user?.comments_page_size || 10);
  const [savingPageSize, setSavingPageSize] = useState(false);

  // Save page size to backend
  const handlePageSizeChange = async (e) => {
    const val = parseInt(e.target.value);
    setCommentsPageSize(val);
    if (!user?.username) return;
    setSavingPageSize(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/update-profile-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, comments_page_size: val })
      });
      const data = await res.json();
      if (data.success) {
        setUser && setUser(u => u ? { ...u, comments_page_size: val } : u);
      }
    } catch (e) {
      console.error('Failed to save comments page size:', e);
      // Optionally show an error message to the user
    }
    setSavingPageSize(false);
  };

  return (
    <>
      <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, background: overviewBg, borderRadius: 8, padding: '18px 16px' }}>
        <h3 style={{ marginBottom: 10 }}>Account Overview</h3>
        <div style={{ marginBottom: 8 }}>
          <strong>Primary Email:</strong> <span>{user?.email || 'Not set'}</span>
        </div>
        <div style={{ marginBottom: 8 }}>
          <strong>Secondary Emails:</strong>
          {Array.isArray(user?.secondaryEmails) && user.secondaryEmails.length > 0 ? (
            <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
              {user.secondaryEmails.map((email) => (
                <li key={email} style={{ fontSize: 15 }}>{email}</li>
              ))}
            </ul>
          ) : (
            <span style={{ marginLeft: 8 }}>None</span>
          )}
        </div>
        <div style={{ marginBottom: 8 }}>
          <strong>Comments per page:</strong>
          <select
            value={commentsPageSize}
            onChange={handlePageSizeChange}
            style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 4 }}
            disabled={savingPageSize}
          >
            {[5, 10, 15, 20].map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          {savingPageSize && <span style={{ marginLeft: 8, color: '#888' }}>Saving...</span>}
        </div>
      </div>
      <BookmarksTab user={user} />
      <UserCommentsSection user={user} />
      <UserTopVotedBooksTab user={user} />
    </>
  );
});

export default AccountTabContent;
