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

  // Preload covers and cache them in localStorage
  React.useEffect(() => {
    bookmarks.forEach(bm => {
      const bookId = bm.id;
      const { url, expired } = getCoverFromCache(bookId);
      // Retry if expired or not cached
      if (!url || expired || (url.startsWith(API_BASE_URL) && url !== '/no-cover.png')) {
        if (url !== '/no-cover.png' || expired) {
          const coverUrl = `${API_BASE_URL}/pdf-cover/${bookId}`;
          const img = new window.Image();
          img.onload = () => setCoverInCache(bookId, coverUrl);
          img.onerror = () => setCoverInCache(bookId, '/no-cover.png');
          img.src = coverUrl;
        }
      }
    });
  }, [bookmarks]);

  const bookmarkedBooks = bookmarks
    .map(bm => {
      const book = books.find(b => b.id === bm.id);
      return book ? { ...book, ...bm } : null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.last_updated) - new Date(a.last_updated));

  const containerBg = stepColor(backgroundColor, theme, 1);

  return (
    <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, background: containerBg, borderRadius: 8, padding: '18px 16px' }}>
      <h3>Your Bookmarked Books</h3>
      {loading ? (
        <div style={{ color: '#888' }}>Loading bookmarks...</div>
      ) : (
        bookmarkedBooks.length === 0 ? (
          <div style={{ color: '#888' }}>No bookmarks yet.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {bookmarkedBooks.map(book => {
              if (!book.id) {
                console.warn('[AccountTabContent] BookmarksTab: invalid book id', book);
              }
              return (
                <li
                  key={book.id || Math.random()}
                  style={{
                    marginBottom: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: book.unread ? '#ffe0e0' : 'transparent',
                    borderRadius: 6,
                    padding: '6px 8px',
                    boxShadow: book.unread ? '0 0 4px #c00' : 'none',
                  }}
                >
                  <Link to={book.id ? `/read/${book.id}` : '#'} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: textColor }}>
                    {book.id ? (
                      <img
                        src={getCoverFromCache(book.id).url}
                        alt={book.name}
                        style={{ width: 38, height: 54, objectFit: 'cover', borderRadius: 4, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
                        onError={e => {
                          if (e.target.src !== '/no-cover.png') {
                            setCoverInCache(book.id, '/no-cover.png');
                            e.target.src = '/no-cover.png';
                          }
                        }}
                        onClick={e => {
                          const { url } = getCoverFromCache(book.id);
                          if (url === '/no-cover.png') {
                            const coverUrl = `${API_BASE_URL}/pdf-cover/${book.id}`;
                            const img = new window.Image();
                            img.onload = () => setCoverInCache(book.id, coverUrl);
                            img.onerror = () => setCoverInCache(book.id, '/no-cover.png');
                            img.src = coverUrl;
                            setTimeout(() => {
                              e.target.src = getCoverFromCache(book.id).url;
                            }, 500);
                          }
                        }}
                      />
                    ) : (
                      <span style={{ color: '#c00', fontSize: 12 }}>[No valid book id]</span>
                    )}
                  </Link>
                  {/* Clickable book title next to cover */}
                  <Link to={book.id ? `/read/${book.id}` : '#'} style={{ color: textColor, textDecoration: 'underline', fontWeight: 600, fontSize: 16, marginLeft: 4 }}>
                    {book.title || book.name || book.id}
                  </Link>
                  <span style={{ fontSize: 13, color: '#888' }}>
                    Last updated: {book.last_updated ? book.last_updated : 'Never'}
                  </span>
                  <span style={{ fontSize: 13, color: '#888' }}>
                    Last page read: {book.last_page}
                  </span>
                  {book.unread && (
                    <span style={{ color: '#c00', fontWeight: 700, fontSize: 13 }}>Unread update!</span>
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

  React.useEffect(() => {
    books.forEach(book => {
      const bookId = book.id;
      const { url, expired } = getCoverFromCache(bookId);
      if (!url || expired || (url.startsWith(API_BASE_URL) && url !== '/no-cover.png')) {
        if (url !== '/no-cover.png' || expired) {
          const coverUrl = book.cover_url || `${API_BASE_URL}/pdf-cover/${bookId}`;
          const img = new window.Image();
          img.onload = () => setCoverInCache(bookId, coverUrl);
          img.onerror = () => setCoverInCache(bookId, '/no-cover.png');
          img.src = coverUrl;
        }
      }
    });
  }, [books]);

  const containerBg = stepColor(backgroundColor, theme, 1);

  return (
    <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, background: containerBg, borderRadius: 8, padding: '18px 16px' }}>
      <h3 style={{ color: textColor }}>Your Top Voted Books</h3>
      {loading ? (
        <div style={{ color: '#888' }}>Loading...</div>
      ) : books.length === 0 ? (
        <div style={{ color: '#888' }}>No top voted books yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {books.map(book => {
            if (!book.id) {
              console.warn('[AccountTabContent] UserTopVotedBooksTab: invalid book id', book);
            }
            return (
              <li key={book.id || Math.random()} style={{
                marginBottom: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: stepColor(containerBg, 'dark', 1, 1),
                borderRadius: 6,
                padding: '6px 8px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
              }}>
                <Link to={book.id ? `/read/${book.id}` : '#'} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: textColor }}>
                  {book.id ? (
                    <img
                      src={getCoverFromCache(book.id).url}
                      alt={book.name}
                      style={{ width: 38, height: 54, objectFit: 'cover', borderRadius: 4, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
                      onError={e => {
                        if (e.target.src !== '/no-cover.png') {
                          setCoverInCache(book.id, '/no-cover.png');
                          e.target.src = '/no-cover.png';
                        }
                      }}
                      onClick={e => {
                        const { url } = getCoverFromCache(book.id);
                        if (url === '/no-cover.png') {
                          const coverUrl = book.cover_url || `${API_BASE_URL}/pdf-cover/${book.id}`;
                          const img = new window.Image();
                          img.onload = () => setCoverInCache(book.id, coverUrl);
                          img.onerror = () => setCoverInCache(book.id, '/no-cover.png');
                          img.src = coverUrl;
                          setTimeout(() => {
                            e.target.src = getCoverFromCache(book.id).url;
                          }, 500);
                        }
                      }}
                    />
                  ) : (
                    <span style={{ color: '#c00', fontSize: 12 }}>[No valid book id]</span>
                  )}
                </Link>
                <span style={{ fontWeight: 600, textDecoration: 'underline', fontSize: 16 }}>{book.name}</span>
                <span style={{ fontSize: 13, color: '#888' }}>
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
          const coverUrl = `${API_BASE_URL}/pdf-cover/${bookId}`;
          const img = new window.Image();
          img.onload = () => setCoverInCache(bookId, coverUrl);
          img.onerror = () => setCoverInCache(bookId, '/no-cover.png');
          img.src = coverUrl;
        }
      }
    });
  }, [comments]);

  function getBookTitle(bookId) {
    const book = books.find(b => b.id === bookId);
    return book ? (book.title || book.name || bookId) : bookId;
  }

  const containerBg = stepColor(backgroundColor, theme, 1);

  return (
    <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, background: containerBg, borderRadius: 8, padding: '18px 16px' }}>
      <h3 style={{ color: textColor }}>Your Comments</h3>
      {loading ? (
        <div style={{ color: '#888' }}>Loading comments...</div>
      ) : comments.length === 0 ? (
        <div style={{ color: '#888' }}>No comments yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {comments.map(comment => (
            <li key={comment.id} style={{ marginBottom: 14, background: comment.deleted ? '#ffe0e0' : 'transparent', borderRadius: 6, padding: '6px 8px' }}>
              <Link to={`/read/${comment.book_id}`} style={{ color: textColor, textDecoration: 'underline', fontWeight: 600 }}>
                {getBookTitle(comment.book_id)}
              </Link>
              <div style={{ fontSize: 14, color: textColor, marginTop: 4 }}>
                {comment.deleted ? <span style={{ color: '#c00', fontStyle: 'italic' }}>Comment deleted</span> : comment.text}
              </div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                {new Date(comment.timestamp).toLocaleString()}
                {comment.edited && <span style={{ color: '#f5c518', marginLeft: 8 }}>(edited)</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

const AccountTabContent = React.memo(function AccountTabContent({ user }) {
  const { backgroundColor, theme } = useContext(ThemeContext);
  const overviewBg = stepColor(backgroundColor, theme, 1);
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
      </div>
      <BookmarksTab user={user} />
      <UserCommentsSection user={user} />
      <UserTopVotedBooksTab user={user} />
    </>
  );
});

export default AccountTabContent;
