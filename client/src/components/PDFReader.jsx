import React, { useEffect, useState, useContext } from "react";
import { useParams } from "react-router-dom";
import "../styles/PDFReader.css";
import { useTheme } from "../themeContext";
import { stepColor, getLuminance } from "../utils/colorUtils";
import { ThemeContext } from "../themeContext";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;

export default function PDFReader() {
  const { id } = useParams(); // expecting route like /read/:id
  const [pdfData, setPdfData] = useState(null);
  const [bookMeta, setBookMeta] = useState(null); // book metadata (title)
  const [currentPage, setCurrentPage] = useState(1);
  const { theme, textColor, backgroundColor } = useTheme();
  const { user, setUser } = useContext(ThemeContext);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [bookmarkMsg, setBookmarkMsg] = useState("");
  const [userVote, setUserVote] = useState(null);
  const [voteStats, setVoteStats] = useState({ average: 0, count: 0 });

  // Stepped container color logic (same as LandingPage)
  function getContainerBg(bg, step = 1) {
    if (!bg) return theme === 'dark' ? '#232323' : '#f5f5f5';
    const lum = getLuminance(bg);
    const direction = lum < 0.5 ? 1 : -1;
    return stepColor(bg, theme, step, direction);
  }
  const containerBg = getContainerBg(backgroundColor, 1);
  const containerText = textColor;

  // Fetch PDF data with error handling for non-JSON responses
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/pdf-text/${id}`)
      .then(res => {
        if (!res.ok) {
          throw new Error(`Failed to fetch PDF: ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        if (!data.error) {
          setPdfData(data);
        } else {
          console.error("Error loading PDF:", data.error);
        }
      })
      .catch(err => console.error(err));
  }, [id]);

  // Fetch book metadata (title) from /list-pdfs (using env folder id)
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
            // Find bookmark meta for this book
            const bm = data.bookmarks.find(b => b.id === id);
            setIsBookmarked(!!bm);
            if (bm && bm.last_page) setCurrentPage(bm.last_page);
          } else {
            // No bookmarks or error, just continue
            setIsBookmarked(false);
          }
        })
        .catch(() => {
          // Network or server error, just continue
          setIsBookmarked(false);
        });
    }
  }, [user, id]);

  // Track last page update only if book is bookmarked
  useEffect(() => {
    if (user && user.username && id && currentPage && isBookmarked) {
      fetch(`${API_BASE_URL}/api/update-bookmark-meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, book_id: id, last_page: currentPage })
      })
        .then(res => res.json())
        .then(data => {
          // Only update if success, otherwise ignore
        })
        .catch(() => {
          // Ignore errors for new accounts with no bookmarks
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
    if (data.success) setUserVote(value);
  };

  // Book title (prefer metadata, fallback to pdfData or ID)
  const bookTitle = bookMeta?.name || pdfData?.title || pdfData?.name || `Book ${id}`;

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
      // Optionally update user in context
      setUser && setUser(u => u ? { ...u, bookmarks: data.bookmarks } : u);
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
    } else {
      setBookmarkMsg(data.message || "Failed to remove bookmark.");
    }
  };

  // Comments section
  function CommentsSection({ bookId, user, containerBg, containerText }) {
    const [comments, setComments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newComment, setNewComment] = useState("");
    const [replyTo, setReplyTo] = useState(null); // comment id
    const [editId, setEditId] = useState(null);
    const [editText, setEditText] = useState("");
    const [msg, setMsg] = useState("");

    // Add state to cache user color info
    const [userColors, setUserColors] = useState({});

    // Fetch comments (only on mount or bookId change)
    useEffect(() => {
      setLoading(true);
      fetch(`${API_BASE_URL}/api/get-comments?book_id=${bookId}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.comments)) {
            setComments(data.comments);
          }
          setLoading(false);
        });
    }, [bookId]);

    // Helper to refresh comments (used after add/edit/delete)
    const refreshComments = () => {
      setLoading(true);
      fetch(`${API_BASE_URL}/api/get-comments?book_id=${bookId}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.comments)) {
            setComments(data.comments);
          }
          setLoading(false);
        });
    };

    // Fetch color info for all unique usernames in comments
    useEffect(() => {
      if (!comments.length) return;
      const uniqueUsernames = [...new Set(comments.flatMap(function collectUsers(c) {
        return [c.username, ...(c.replies ? c.replies.flatMap(collectUsers) : [])];
      }))];
      // Only fetch for usernames not already cached
      const toFetch = uniqueUsernames.filter(u => !userColors[u]);
      if (!toFetch.length) return;
      Promise.all(
        toFetch.map(username =>
          fetch(`${API_BASE_URL}/api/get-user-meta?username=${encodeURIComponent(username)}`)
            .then(res => res.json())
            .then(data => ({
              username,
              backgroundColor: data.success ? data.background_color : undefined,
              textColor: data.success ? data.text_color : undefined
            }))
        )
      ).then(results => {
        setUserColors(prev => {
          const updated = { ...prev };
          results.forEach(({ username, backgroundColor, textColor }) => {
            updated[username] = { backgroundColor, textColor };
          });
          return updated;
        });
      });
    }, [comments, userColors]);

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
        refreshComments();
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
        refreshComments();
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
        refreshComments();
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
      refreshComments();
    };

    // Avatar component
    function UserAvatar({ username }) {
      const colors = userColors[username] || {};
      const bg = colors.backgroundColor || "#232323";
      const txt = colors.textColor || "#fff";
      return (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: bg,
            color: txt,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 15,
            border: '1.5px solid #888',
            marginRight: 8,
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
          }}
          title={username}
        >
          {username ? username[0].toUpperCase() : "?"}
        </div>
      );
    }

    // Render comments recursively
    function renderComments(list, depth = 0) {
      return list.map(comment => (
        <div key={comment.id} style={{
          background: depth === 0 ? containerBg : stepColor(containerBg, 'dark', depth, 1),
          color: containerText,
          borderRadius: 6,
          margin: '12px 0 0 0',
          padding: '12px 16px',
          marginLeft: depth * 24,
          boxShadow: depth === 0 ? '0 1px 4px rgba(0,0,0,0.06)' : 'none'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserAvatar username={comment.username} />
            <span style={{ fontWeight: 600 }}>{comment.username}</span>
            <span style={{ fontSize: 12, color: '#888' }}>{new Date(comment.timestamp).toLocaleString()}</span>
            {comment.edited && <span style={{ fontSize: 11, color: '#f5c518', marginLeft: 6 }}>(edited)</span>}
          </div>
          {editId === comment.id ? (
            <div>
              <textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                rows={2}
                style={{ width: '100%', marginTop: 6, borderRadius: 4 }}
              />
              <button
                onClick={() => handleEditComment(comment.id)}
                style={{
                  background: containerBg,
                  color: containerText,
                  border: `1px solid ${containerText}`,
                  borderRadius: 4,
                  padding: '4px 10px',
                  marginRight: 8,
                  cursor: 'pointer'
                }}
              >Save</button>
              <button
                onClick={() => { setEditId(null); setEditText(""); }}
                style={{
                  background: containerBg,
                  color: containerText,
                  border: `1px solid ${containerText}`,
                  borderRadius: 4,
                  padding: '4px 10px',
                  cursor: 'pointer'
                }}
              >Cancel</button>
            </div>
          ) : (
            <div style={{ margin: '8px 0' }}>{comment.text}</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => handleVoteComment(comment.id, 1)}
              style={{
                background: containerBg,
                color: containerText,
                border: '1px solid #0070f3',
                borderRadius: 4,
                padding: '4px 10px',
                cursor: 'pointer',
                textDecoration: 'underline',
                textDecorationColor: '#0070f3'
              }}
            >▲ {comment.upvotes}</button>
            <button
              onClick={() => handleVoteComment(comment.id, -1)}
              style={{
                background: containerBg,
                color: containerText,
                border: '1px solid #c00',
                borderRadius: 4,
                padding: '4px 10px',
                cursor: 'pointer',
                textDecoration: 'underline',
                textDecorationColor: '#c00'
              }}
            >▼ {comment.downvotes}</button>
            <button
              onClick={() => setReplyTo(comment.id)}
              style={{
                background: containerBg,
                color: containerText,
                border: `1px solid ${containerText}`,
                borderRadius: 4,
                padding: '4px 10px',
                cursor: 'pointer'
              }}
            >Reply</button>
            {user && user.username === comment.username && (
              <>
                <button
                  onClick={() => { setEditId(comment.id); setEditText(comment.text); }}
                  style={{
                    background: containerBg,
                    color: containerText,
                    border: `1px solid ${containerText}`,
                    borderRadius: 4,
                    padding: '4px 10px',
                    marginRight: 8,
                    cursor: 'pointer'
                  }}
                >Edit</button>
                <button
                  onClick={() => handleDeleteComment(comment.id)}
                  style={{
                    background: containerBg,
                    color: containerText,
                    border: '1px solid #c00',
                    borderRadius: 4,
                    padding: '4px 10px',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    textDecorationColor: '#c00'
                  }}
                >Delete</button>
              </>
            )}
          </div>
          {/* Render replies */}
          {comment.replies && comment.replies.length > 0 && renderComments(comment.replies, depth + 1)}
        </div>
      ));
    }

    return (
      <div style={{
        background: containerBg,
        color: containerText,
        borderRadius: 8,
        padding: 18,
        marginTop: 18,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
      }}>
        <h3 style={{ marginBottom: 10 }}>Comments</h3>
        {msg && <div style={{ color: '#c00', marginBottom: 8 }}>{msg}</div>}
        {loading ? (
          <div>Loading comments...</div>
        ) : (
          <>
            {renderComments(comments)}
            <div style={{ marginTop: 18 }}>
              <textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                rows={2}
                style={{ width: '100%', borderRadius: 4 }}
                placeholder={replyTo ? "Write a reply..." : "Write a comment..."}
              />
              <button
                onClick={handleAddComment}
                style={{
                  background: containerBg,
                  color: containerText,
                  border: `1px solid ${containerText}`,
                  borderRadius: 4,
                  padding: '4px 10px',
                  marginTop: 6,
                  cursor: 'pointer'
                }}
              >
                {replyTo ? "Reply" : "Comment"}
              </button>
              {replyTo && (
                <button
                  onClick={() => { setReplyTo(null); setNewComment(""); }}
                  style={{
                    background: containerBg,
                    color: containerText,
                    border: `1px solid ${containerText}`,
                    borderRadius: 4,
                    padding: '4px 10px',
                    marginLeft: 8,
                    cursor: 'pointer'
                  }}
                >
                  Cancel Reply
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  if (!pdfData) {
    return <div className={`pdf-reader-loading ${theme}-mode`} style={{ background: backgroundColor, color: textColor, minHeight: '100vh' }}>Loading PDF...</div>;
  }

  const page = pdfData.pages.find(p => p.page === currentPage);

  return (
    <div
      className={`pdf-reader-container ${theme}-mode`}
      style={{ background: backgroundColor, color: textColor, minHeight: '100vh' }}
    >
      <header className="pdf-reader-header">
        <button
          className="pdf-reader-btn"
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
          disabled={currentPage === 1}
        >
          ◀ Prev
        </button>
        <span className="pdf-reader-page-indicator">
          Page {currentPage} / {pdfData.totalPages || pdfData.pages.length}
        </span>
        <button
          className="pdf-reader-btn"
          onClick={() => setCurrentPage(p => Math.min((pdfData.totalPages || pdfData.pages.length), p + 1))}
          disabled={currentPage === (pdfData.totalPages || pdfData.pages.length)}
        >
          Next ▶
        </button>
      </header>

      <div className="pdf-reader-page" style={{ background: containerBg, color: containerText, borderRadius: 8, padding: 16, margin: 16 }}>
        {page.images && page.images.length > 0 && (
          <div className="pdf-reader-images">
            {page.images.map((src, idx) => (
              <img key={idx} src={src} alt={`Page ${page.page} Image ${idx + 1}`} />
            ))}
          </div>
        )}

        {page.text && (
          <div className="pdf-reader-text">
            {page.text.split("\n").map((line, idx) => (
              <p key={idx}>{line}</p>
            ))}
          </div>
        )}
      </div>

      {/* Book info, favorite, voting, comments */}
      <div style={{
        margin: '0 auto',
        maxWidth: 900,
        background: containerBg,
        color: containerText,
        borderRadius: 8,
        padding: 20,
        marginBottom: 32,
        marginTop: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 22 }}>{bookTitle}</span>
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
        {/* Voting system */}
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
        {/* Comments section */}
        <CommentsSection
          bookId={id}
          user={user}
          containerBg={containerBg}
          containerText={containerText}
        />
      </div>
    </div>
  );
}
