// Placeholder for renderComments and renderPagination in CommentsSection
// These should be implemented or imported as needed
import React, { useState, useEffect, useContext, useCallback } from "react";
import { useParams } from "react-router-dom";
import { stepColor } from "../utils/colorUtils";
import { ThemeContext } from "../themeContext";
import { SteppedContainer } from "../components/ContainerDepthContext.jsx";

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
    if (key === 'swc_cover_cache') label = 'covers';
    else if (key.startsWith('storyweave_book_')) label = `text for ${key.replace('storyweave_book_', '')}`;
    else if (key === 'swc_session_id') label = 'user session';
    else if (key === 'storyweave_book_cache_list') label = 'book cache list';
    else if (key.startsWith('user_')) label = 'user data';
    breakdown.push({ label, bytes });
  // Print summary
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  console.warn(`LocalStorage quota exceeded! Total storage: ${totalMB} MB`);
  breakdown.sort((a, b) => b.bytes - a.bytes);
  breakdown.forEach(item => {
    const mb = (item.bytes / (1024 * 1024)).toFixed(2);
    console.warn(`L ${item.label}: ${mb} MB`);
  });
}
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
      printLocalStorageUsage();
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

export default function PDFReader() {
  // Theme and context
  const theme = useContext(ThemeContext)?.theme || 'light';
  const backgroundColor = useContext(ThemeContext)?.backgroundColor || '#fff';
  const textColor = useContext(ThemeContext)?.textColor || '#222';
  // Define background colors for page and book meta containers
  const pdfPageBg = theme === 'dark' ? '#222' : '#f8f8ff';
  const bookMetaBg = theme === 'dark' ? '#232323' : '#f4f8fc';
  // Loading state for book data
  const [loadingBook, setLoadingBook] = useState(true);
  // Add missing state variables and placeholders
  const [currentPage, setCurrentPage] = useState(1);
  const [pages, setPages] = useState([]);
  const [pageCount, setPageCount] = useState(1);
  const [bookMeta, setBookMeta] = useState({});
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [userVote, setUserVote] = useState(null);
  const [voteStats, setVoteStats] = useState({ average: 0, count: 0 });
  const [bookmarkMsg, setBookmarkMsg] = useState("");
  const [commentsOuterBg, setCommentsOuterBg] = useState("#f9f9f9");
  const [pdfError, setPdfError] = useState("");
  const [baseBg, setBaseBg] = useState("#fff");
  const [navButtonBg, setNavButtonBg] = useState("#eee");
  const [navButtonText, setNavButtonText] = useState("#222");
  // Comments refresh state
  const [commentsRefresh, setCommentsRefresh] = useState(0);

  // User state (replace with your actual user context or prop)
  const [user, setUser] = useState(null);

  // Comments page from query (replace with your actual logic)
  const [commentsPageFromQuery, setCommentsPageFromQuery] = useState(null);
  // Add any other previously used states here as needed

  // Restore any missing handlers or logic here
  // (All handlers and UI blocks are already present in the file, but this ensures nothing is missing)
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


// Memoized CommentsSection as a top-level component
const CommentsSection = React.memo(function CommentsSection({
  bookId,
  commentsRefresh,
  user,
  commentsPageFromQuery,
  setCommentsRefresh,
  commentToScroll,
  backgroundColor,
  theme,
  textColor,
  API_BASE_URL,
}) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState("");
  const [msg, setMsg] = useState("");
  // Pagination state
  const commentsPageSize = user?.comments_page_size || 10;
  const [commentsPage, setCommentsPage] = useState(1); // <-- Add this line
  const [totalPages, setTotalPages] = useState(1);

  // Fetch comments only when commentsRefresh, commentsPage, or commentsPageSize changes
  const fetchComments = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('book_id', bookId);
    params.set('page', commentsPage);
    params.set('page_size', commentsPageSize);
    fetch(`${API_BASE_URL}/api/get-comments?${params.toString()}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.comments)) {
          setComments(data.comments);
          setTotalPages(data.total_pages || 1);
        }
        setLoading(false);
      });
  }, [bookId, commentsPage, commentsPageSize, API_BASE_URL]);

  // Handle deep-linking to a specific comments page
  useEffect(() => {
    if (commentsPageFromQuery && commentsPageFromQuery !== commentsPage) {
      setCommentsPage(commentsPageFromQuery);
    }
    // Only set once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsPageFromQuery]);

  useEffect(() => {
    fetchComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsRefresh, commentsPage, commentsPageSize]);
  // Auto-scroll to comment if commentToScroll is present
  useEffect(() => {
    if (!commentToScroll) return;
    // Wait for comments to render
    setTimeout(() => {
      const el = document.getElementById(`comment-${commentToScroll}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.boxShadow = '0 0 0 3px #0070f3';
        setTimeout(() => { el.style.boxShadow = ''; }, 2000);
      }
    }, 400);
  }, [comments, commentToScroll]);

  // Add comment or reply
  const handleAddComment = async () => {
    if (!user || !user.username) {
      setMsg("Log in to comment.");
      return;
    }
    if (!newComment.trim()) return;
    const res = await fetch(`${API_BASE_URL}/api/add-comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        book_id: bookId,
        username: user.username,
        text: newComment,
        parent_id: replyTo
      })
    });
    const data = await res.json();
    if (data.success) {
      setNewComment("");
      setReplyTo(null);
      setMsg("");
      setCommentsRefresh(r => r + 1);
    } else {
      setMsg(data.message || "Failed to add comment.");
    }
  };

  // Edit comment
  const handleEditComment = async (commentId) => {
    if (!editText.trim()) return;
    const res = await fetch(`${API_BASE_URL}/api/edit-comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comment_id: commentId,
        username: user.username,
        text: editText
      })
    });
    const data = await res.json();
    if (data.success) {
      setEditId(null);
      setEditText("");
      setCommentsRefresh(r => r + 1);
    } else {
      setMsg(data.message || "Failed to edit comment.");
    }
  };

  // Delete comment
  const handleDeleteComment = async (commentId) => {
    const res = await fetch(`${API_BASE_URL}/api/delete-comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comment_id: commentId,
        username: user.username
      })
    });
    const data = await res.json();
    if (data.success) {
      setCommentsRefresh(r => r + 1);
    } else {
      setMsg(data.message || "Failed to delete comment.");
    }
  };

  // Vote comment
  const handleVoteComment = async (commentId, value) => {
    await fetch(`${API_BASE_URL}/api/vote-comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment_id: commentId, value })
    });
    setCommentsRefresh(r => r + 1);
  };

  // Helper: get author avatar colors (for avatar only)
  function getAuthorAvatarBg(c) {
    return c.backgroundColor || c.background_color || '#888';
  }
  function getAuthorAvatarTextColor(c) {
    return c.textColor || c.text_color || '#fff';
  }
  function getAuthorAvatar(c) {
    if (c.avatar_url) return c.avatar_url;
    return null;
  }
  function isAdmin() {
    return user && (user.is_admin || user.role === 'admin');
  }
  function isBanned(c) {
    return c.banned;
  }
  // Button style uses viewer theme, but avatar/comment bg uses author theme
  function getButtonStyle(type) {
    const base = {
      borderRadius: 4,
      padding: '2px 10px',
      fontWeight: 500,
      cursor: 'pointer',
      marginRight: 4,
      border: '1px solid',
    };
    if (type === 'reply') return { ...base, background: stepColor(backgroundColor, theme, 1), color: '#0070f3', borderColor: '#0070f3' };
    if (type === 'edit') return { ...base, background: stepColor(backgroundColor, theme, 1), color: '#c90', borderColor: '#c90' };
    if (type === 'delete') return { ...base, background: stepColor(backgroundColor, theme, 1), color: '#c00', borderColor: '#c00' };
    if (type === 'ban') return { ...base, background: '#222', color: '#fff', borderColor: '#222' };
    if (type === 'upvote') return { ...base, background: stepColor(backgroundColor, theme, 1), color: '#080', borderColor: '#080' };
    if (type === 'downvote') return { ...base, background: stepColor(backgroundColor, theme, 1), color: '#c00', borderColor: '#c00' };
    return base;
  }
  function renderAvatar(c) {
    const avatarUrl = getAuthorAvatar(c);
    const bg = getAuthorAvatarBg(c);
    const text = getAuthorAvatarTextColor(c);
    if (avatarUrl) {
      return <img src={avatarUrl} alt={c.username} style={{ width: 32, height: 32, borderRadius: '50%', marginRight: 10, border: `2px solid ${text}` }} />;
    }
    return (
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: bg, color: text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18, marginRight: 10, border: `2px solid ${text}` }}>
        {c.username ? c.username[0].toUpperCase() : '?'}
      </div>
    );
  }
  // Admin: ban user
  async function handleBanUser(username) {
    if (!isAdmin()) return;
    await fetch(`${API_BASE_URL}/api/ban-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    setCommentsRefresh(r => r + 1);
  }
  // Admin: delete any comment
  async function handleAdminDeleteComment(commentId) {
    if (!isAdmin()) return;
    await fetch(`${API_BASE_URL}/api/admin-delete-comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment_id: commentId })
    });
    setCommentsRefresh(r => r + 1);
  }
  // Render comments with replies nested recursively
  function renderComments(comments, parentId = null, depth = 0) {
    if (!comments || comments.length === 0) return depth === 0 ? <div>No comments yet.</div> : null;
    const commentBg = stepColor(backgroundColor, theme, 2);
    const commentText = textColor;
    // Build a map of parent_id -> children
    const childrenMap = {};
    comments.forEach(c => {
      const pid = c.parent_id || null;
      if (!childrenMap[pid]) childrenMap[pid] = [];
      childrenMap[pid].push(c);
    });
    // Only render comments for this parentId
    const nodes = childrenMap[parentId] || [];
    return nodes.map(c => (
      <div key={c.id} id={`comment-${c.id}`} style={{
        background: commentBg,
        color: commentText,
        borderRadius: 8,
        padding: '14px 18px',
        marginBottom: 14,
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        position: 'relative',
        opacity: isBanned(c) ? 0.5 : 1,
        marginLeft: depth > 0 ? 32 : 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          {renderAvatar(c)}
          <span style={{ fontWeight: 600, fontSize: 16, color: commentText, marginRight: 8 }}>{c.username}</span>
          {c.edited ? <span style={{ fontSize: 12, color: '#888', marginLeft: 6 }}>(edited)</span> : null}
          {isBanned(c) && <span style={{ fontSize: 12, color: '#c00', marginLeft: 8 }}>(banned)</span>}
        </div>
        <div style={{ fontSize: 15, marginBottom: 8 }}>{c.text}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Reply button */}
          <button style={getButtonStyle('reply')} onClick={() => setReplyTo(c.id)}>Reply</button>
          {/* Edit button (only for own comments) */}
          {user && user.username === c.username && !c.deleted && (
            <button style={getButtonStyle('edit')} onClick={() => { setEditId(c.id); setEditText(c.text); }}>Edit</button>
          )}
          {/* Delete button (only for own comments) */}
          {user && user.username === c.username && !c.deleted && (
            <button style={getButtonStyle('delete')} onClick={() => handleDeleteComment(c.id)}>Delete</button>
          )}
          {/* Admin delete button (for any comment) - always visible for admins */}
          {isAdmin() && !c.deleted && (
            <button style={getButtonStyle('delete')} onClick={() => handleAdminDeleteComment(c.id)}>Admin Delete</button>
          )}
          {/* Admin ban button (for any user) - always visible for admins */}
          {isAdmin() && !isBanned(c) && (
            <button style={getButtonStyle('ban')} onClick={() => handleBanUser(c.username)}>Ban User</button>
          )}
          {/* Voting buttons */}
          <button style={getButtonStyle('upvote')} onClick={() => handleVoteComment(c.id, 1)}>▲ {c.upvotes}</button>
          <button style={getButtonStyle('downvote')} onClick={() => handleVoteComment(c.id, -1)}>▼ {c.downvotes}</button>
        </div>
        {/* Edit form */}
        {editId === c.id && (
          <div style={{ marginTop: 10 }}>
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              rows={2}
              style={{ width: '100%', borderRadius: 4 }}
            />
            <button
              onClick={() => handleEditComment(c.id)}
              style={getButtonStyle('edit')}
            >Save</button>
            <button
              onClick={() => { setEditId(null); setEditText(''); }}
              style={getButtonStyle('reply')}
            >Cancel</button>
          </div>
        )}
        {/* Render replies recursively */}
        {renderComments(comments, c.id, depth + 1)}
      </div>
    ));
  }
  // Pagination (unchanged)
  function renderPagination() {
    return null;
  }
  const commentsContainerBg = stepColor(backgroundColor, theme, 3);
  // Find the comment being replied to
  const replyComment = replyTo ? comments.find(c => c.id === replyTo) : null;
  return (
    <div style={{ background: commentsContainerBg, color: textColor, borderRadius: 8, padding: 18, marginTop: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <h3 style={{ marginBottom: 10 }}>Comments</h3>
      {msg && <div style={{ color: '#c00', marginBottom: 8 }}>{msg}</div>}
      {renderPagination()}
      {loading ? (
        <div>Loading comments...</div>
      ) : (
        <>
          <div style={{ background: commentsContainerBg, color: textColor, borderRadius: 8, padding: 18, marginTop: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            {renderComments(comments)}
            <div style={{ marginTop: 18 }}>
              {replyComment && (
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, background: commentsContainerBg, color: textColor, borderRadius: 6, padding: '8px 12px' }}>
                  {renderAvatar(replyComment)}
                  <span style={{ fontWeight: 600, fontSize: 15, marginRight: 8 }}>{replyComment.username}</span>
                  <span style={{ fontSize: 14, color: textColor }}>{replyComment.text.length > 60 ? replyComment.text.slice(0, 60) + '...' : replyComment.text}</span>
                </div>
              )}
              <textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                rows={2}
                style={{ width: '100%', borderRadius: 4 }}
                placeholder={replyTo ? "Write a reply..." : "Write a comment..."}
              />
              <button
                onClick={handleAddComment}
                style={{ background: commentsContainerBg, color: textColor, border: `1px solid ${textColor}`, borderRadius: 4, padding: '4px 10px', marginTop: 6, cursor: 'pointer' }}
              >{replyTo ? "Reply" : "Comment"}</button>
              {replyTo && (
                <button
                  onClick={() => { setReplyTo(null); setNewComment(""); }}
                  style={{ background: commentsContainerBg, color: textColor, border: `1px solid ${textColor}`, borderRadius: 4, padding: '4px 10px', marginLeft: 8, cursor: 'pointer' }}
                >Cancel Reply</button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
});
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
      // Only refresh comments if the vote affects comments (e.g., if you want to show updated vote in comments)
      // Otherwise, you can remove this line if not needed:
      // setCommentsRefresh(r => r + 1);
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
      // Only refresh comments if bookmark affects comments (e.g., if you want to show updated bookmark in comments)
      // Otherwise, you can remove this line if not needed:
      // setCommentsRefresh(r => r + 1);
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
      // Only refresh comments if unbookmark affects comments
      // setCommentsRefresh(r => r + 1);
    } else {
      setBookmarkMsg(data.message || "Failed to remove bookmark.");
    }
  };


  // ...existing code...
    // Book data fetch and caching logic (reconstructed)
    useEffect(() => {
      if (!id) return;
      let didCancel = false;
      const sessionId = localStorage.getItem('swc_session_id');
      async function loadBook() {
        // Try cache first
        let cachedPages = null;
        try {
          const raw = localStorage.getItem(getBookCacheKey(id));
          if (raw) {
            cachedPages = JSON.parse(raw);
          }
        } catch (e) {
          console.log('Cache parse error:', e);
        }
        if (cachedPages && Array.isArray(cachedPages) && cachedPages.length > 0) {
          if (!didCancel) {
            setPages(cachedPages);
            setPageCount(cachedPages.length);
          }
        } else {
          // Fetch all pages using /api/pdf-text/<file_id>?page=<n>&session_id=<session_id>
          try {
            let pagesArr = [];
            let totalPages = 1;
            let firstPageRes = await fetch(`${API_BASE_URL}/api/pdf-text/${id}?page=1&session_id=${sessionId}`);
            let firstPageData = await firstPageRes.json();
            if (firstPageData.success) {
              totalPages = firstPageData.total_pages || 1;
              pagesArr.push({
                page: firstPageData.page,
                text: firstPageData.text,
                images: firstPageData.images || []
              });
              for (let p = 2; p <= totalPages; p++) {
                if (didCancel) break;
                let res = await fetch(`${API_BASE_URL}/api/pdf-text/${id}?page=${p}&session_id=${sessionId}`);
                let data = await res.json();
                if (data.success) {
                  pagesArr.push({
                    page: data.page,
                    text: data.text,
                    images: data.images || []
                  });
                } else {
                  setPdfError(data.error || `Failed to load page ${p}`);
                  break;
                }
              }
              if (!didCancel) {
                setPages(pagesArr);
                setPageCount(totalPages);
                addBookToCache(id, pagesArr);
              }
            } else {
              setPdfError(firstPageData.error || "Failed to load book pages.");
            }
          } catch (e) {
            if (!didCancel) {
              if (e.name === 'QuotaExceededError') {
                setPdfError('LocalStorage quota exceeded.');
                printLocalStorageUsage();
              } else {
                setPdfError('Network or backend error.');
              }
            }
          }
        }
        // Fetch book meta using /api/books?ids=<file_id>
        try {
          const metaRes = await fetch(`${API_BASE_URL}/api/books?ids=${id}`);
          const metaData = await metaRes.json();
          if (!didCancel && metaData.books && metaData.books.length > 0) {
            setBookMeta(metaData.books[0]);
          }
        } catch (e) {
          console.log('Meta fetch error:', e);
        }
      }
      loadBook();
      return () => {
        didCancel = true;
        // No need to notify backend to cancel queue; backend handles cleanup via heartbeat and timeouts.
      };
    }, [id]);

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
    errorBanner = (
      <div className="pdf-reader-error-banner" style={{ background: '#fff0f0', color: '#c00', border: '1px solid #c00', borderRadius: 8, padding: '16px 24px', margin: '24px auto', maxWidth: 900, textAlign: 'center', fontWeight: 600, fontSize: 18, boxShadow: '0 2px 8px rgba(200,0,0,0.04)' }}>
        <div style={{ marginBottom: 8 }}>⚠️ Error: {pdfError}</div>
        <div style={{ fontWeight: 400, fontSize: 15, color: '#a00', marginBottom: 8 }}>
          Some pages could not be loaded due to quota or backend error.<br />
          You can still read the pages above and use comments.
        </div>
        <button style={{ marginTop: 0, padding: '8px 20px', borderRadius: 6, border: '1px solid #bbb', background: '#fff', color: '#333', fontWeight: 600, cursor: 'pointer' }} onClick={() => window.location.reload()}>Retry</button>
        <button style={{ marginTop: 0, padding: '8px 20px', borderRadius: 6, border: '1px solid #bbb', background: '#fff', color: '#333', fontWeight: 600, cursor: 'pointer' }} onClick={() => setErrorDismissed(true)}>Dismiss</button>
      </div>
    );
  }
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
  // Remove loadingBook check here, always allow navigation

  return (
    <SteppedContainer step={0} style={{ minHeight: '100vh', background: baseBg, color: textColor }} className={`pdf-reader-container ${theme}-mode`}>
      {loadingBook && (
        <div style={{ width: '100%', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#888', fontWeight: 600 }}>
          Loading book...
        </div>
      )}
      <header className="pdf-reader-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {/* Logo/title can be added here if needed for PDFReader */}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {/* Theme toggle or other header actions if needed */}
        </div>
      </header>

      {/* Top navigation */}
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
          Page {currentPage} / {Math.max(pageCount, pages.length)}
        </span>
        <button
          className="pdf-reader-btn"
          onClick={() => setCurrentPage(p => Math.min(Math.max(pageCount, pages.length), p + 1))}
          disabled={currentPage === Math.max(pageCount, pages.length)}
          style={{ background: navButtonBg, color: navButtonText, border: `1px solid ${navButtonText}`, borderRadius: 6, padding: '6px 16px', fontWeight: 600, cursor: currentPage === Math.max(pageCount, pages.length) ? 'not-allowed' : 'pointer', marginLeft: 8 }}
        >
          Next ▶
        </button>
        <span style={{ marginLeft: 16, fontSize: 15, color: '#888' }}>{pages.length > 0 ? `Loaded ${pages.length} / ${pageCount}` : ''}</span>
      </div>

      <SteppedContainer step={1} style={{ borderRadius: 8, padding: 32, margin: 16, background: pdfPageBg, maxWidth: 1100, marginLeft: 'auto', marginRight: 'auto' }} className="pdf-reader-page">
        {/* Show loading or page content */}
        {pageObj ? (
          <div key={pageObj.page}>
            {pageObj.images && pageObj.images.length > 0 && (
              <div className="pdf-reader-images" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                {pageObj.images.map((img, idx) => {
                  if (typeof img !== 'string') return null;
                  return (
                    <img
                      key={idx}
                      src={img.startsWith('data:') ? img : `${API_BASE_URL}/api/image-proxy?url=${encodeURIComponent(img)}`}
                      alt={`Page ${pageObj.page} Image ${idx + 1}`}
                      style={{ maxWidth: 320, maxHeight: 320, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
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
            {/* Bottom navigation (added here) */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: 16 }}>
              <button
                className="pdf-reader-btn"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{
                  background: theme === 'dark' ? '#333' : navButtonBg,
                  color: theme === 'dark' ? '#f8f8ff' : navButtonText,
                  border: `1px solid ${theme === 'dark' ? '#888' : navButtonText}`,
                  borderRadius: 6,
                  padding: '6px 16px',
                  fontWeight: 600,
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  marginRight: 8,
                  boxShadow: theme === 'dark' ? '0 2px 8px #222' : '0 2px 8px #eee'
                }}
              >
                ◀ Prev
              </button>
              <span className="pdf-reader-page-indicator" style={{ fontWeight: 600, fontSize: 18, color: textColor }}>
                Page {currentPage} / {Math.max(pageCount, pages.length)}
              </span>
              <button
                className="pdf-reader-btn"
                onClick={() => setCurrentPage(p => Math.min(Math.max(pageCount, pages.length), p + 1))}
                disabled={currentPage === Math.max(pageCount, pages.length)}
                style={{
                  background: theme === 'dark' ? '#333' : navButtonBg,
                  color: theme === 'dark' ? '#f8f8ff' : navButtonText,
                  border: `1px solid ${theme === 'dark' ? '#888' : navButtonText}`,
                  borderRadius: 6,
                  padding: '6px 16px',
                  fontWeight: 600,
                  cursor: currentPage === Math.max(pageCount, pages.length) ? 'not-allowed' : 'pointer',
                  marginLeft: 8,
                  boxShadow: theme === 'dark' ? '0 2px 8px #222' : '0 2px 8px #eee'
                }}
              >
                Next ▶
              </button>
            </div>
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
            <span style={{ fontWeight: 700, fontSize: 22, color: textColor }}>{bookMeta?.title || `Book ${id}`}</span>
            {isBookmarked ? (
              <button
                onClick={handleUnbookmark}
                style={{
                  background: theme === 'dark' ? '#442' : '#ffe0e0',
                  color: theme === 'dark' ? '#f8f8ff' : '#c00',
                  border: `1px solid ${theme === 'dark' ? '#888' : '#c00'}`,
                  borderRadius: 6,
                  padding: '6px 16px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: theme === 'dark' ? '0 2px 8px #222' : '0 2px 8px #eee'
                }}
              >★ Unfavorite</button>
            ) : (
              <button
                onClick={handleBookmark}
                style={{
                  background: theme === 'dark' ? '#225' : '#e0f7ff',
                  color: theme === 'dark' ? '#f8f8ff' : '#0070f3',
                  border: `1px solid ${theme === 'dark' ? '#888' : '#0070f3'}`,
                  borderRadius: 6,
                  padding: '6px 16px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: theme === 'dark' ? '0 2px 8px #222' : '0 2px 8px #eee'
                }}
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
          {/* Pass all required props explicitly to CommentsSection */}
          <CommentsSection
            bookId={id}
            commentsRefresh={commentsRefresh}
            user={user}
            commentsPageFromQuery={commentsPageFromQuery}
            setCommentsRefresh={setCommentsRefresh}
            commentToScroll={commentToScroll}
            backgroundColor={backgroundColor}
            theme={theme}
            textColor={textColor}
            API_BASE_URL={API_BASE_URL}
          />
        </SteppedContainer>
      </SteppedContainer>
    </SteppedContainer>
  );
}