import React, { useState, useEffect, useContext } from "react";
import { useParams } from "react-router-dom";
import { stepColor } from "../utils/colorUtils";
import { ThemeContext } from "../themeContext";
import { SteppedContainer } from "../components/ContainerDepthContext.jsx";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;

export default function PDFReader() {
  const { id } = useParams();
  const [pdfData, setPdfData] = useState(null);
  const [bookMeta, setBookMeta] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const { theme, textColor, backgroundColor, user, setUser } = useContext(ThemeContext);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [bookmarkMsg, setBookmarkMsg] = useState("");
  const [userVote, setUserVote] = useState(null);
  const [voteStats, setVoteStats] = useState({ average: 0, count: 0 });
  // Used to trigger comments refresh
  const [commentsRefresh, setCommentsRefresh] = useState(0);

  // Fetch PDF data
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/pdf-text/${id}`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) setPdfData(data);
      });
  }, [id]);

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
      setCommentsRefresh(r => r + 1);
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
      setCommentsRefresh(r => r + 1);
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
      setCommentsRefresh(r => r + 1);
    } else {
      setBookmarkMsg(data.message || "Failed to remove bookmark.");
    }
  };

  // Comments section
  function CommentsSection({ bookId, currentPage, commentsRefresh }) {
    // Render comments recursively
    function renderComments(list, depth = 0) {
      return list.map(comment => {
        const commentBg = stepColor(backgroundColor, theme, 4 + depth);
        const buttonBg = stepColor(backgroundColor, theme, 5 + depth);
        const commentText = textColor;
  // Avatar uses comment's saved background and text color from backend
  const avatarBg = comment.background_color || stepColor(commentBg, theme, 1);
  const avatarTextColor = comment.text_color || textColor;
        // If comment is deleted, show placeholder text and hide actions
        const isDeleted = comment.deleted;
    const isAdmin = user?.is_admin;
          // Ban button only for admins, only for non-admin users
          const showBanButton = isAdmin && !comment.deleted && !comment.is_admin && comment.username !== user?.username;
        return (
          <div key={comment.id} style={{
            background: commentBg,
            color: commentText,
            borderRadius: 6,
            margin: '12px 0 0 0',
            padding: '12px 16px',
            marginLeft: depth * 24,
            boxShadow: depth === 0 ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12
          }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: avatarBg,
              color: avatarTextColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 18,
              marginRight: 10,
              border: `2.5px solid ${avatarTextColor}`
            }}>
              {comment.username ? comment.username[0].toUpperCase() : '?'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{isDeleted ? 'Deleted User' : comment.username}</span>
                <span style={{ fontSize: 12, color: '#888' }}>{new Date(comment.timestamp).toLocaleString()}</span>
                {comment.edited && !isDeleted && <span style={{ fontSize: 11, color: '#f5c518', marginLeft: 6 }}>(edited)</span>}
              </div>
              {isDeleted ? (
                <div style={{ margin: '8px 0', fontStyle: 'italic', color: '#888' }}>Comment not available (user deleted)</div>
              ) : editId === comment.id ? (
                <div>
                  <textarea
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    rows={2}
                    style={{ width: '100%', marginTop: 6, borderRadius: 4 }}
                  />
                  <button
                    onClick={() => handleEditComment(comment.id)}
                    style={{ background: buttonBg, color: commentText, border: `1px solid ${commentText}`, borderRadius: 4, padding: '4px 10px', marginRight: 8, cursor: 'pointer' }}
                  >Save</button>
                  <button
                    onClick={() => { setEditId(null); setEditText(""); }}
                    style={{ background: buttonBg, color: commentText, border: `1px solid ${commentText}`, borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }}
                  >Cancel</button>
                </div>
              ) : (
                <div style={{ margin: '8px 0' }}>{comment.text}</div>
              )}
              {!isDeleted && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    onClick={() => handleVoteComment(comment.id, 1)}
                    style={{ background: buttonBg, color: commentText, border: '1px solid #0070f3', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: '#0070f3' }}
                  >▲ {comment.upvotes}</button>
                  <button
                    onClick={() => handleVoteComment(comment.id, -1)}
                    style={{ background: buttonBg, color: commentText, border: '1px solid #c00', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: '#c00' }}
                  >▼ {comment.downvotes}</button>
                  <button
                    onClick={() => setReplyTo(comment.id)}
                    style={{ background: buttonBg, color: commentText, border: `1px solid ${commentText}`, borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }}
                  >Reply</button>
                  {(user && (user.username === comment.username || user.is_admin)) && (
                    <>
                      {user.username === comment.username && (
                        <button
                          onClick={() => { setEditId(comment.id); setEditText(comment.text); }}
                          style={{ background: buttonBg, color: commentText, border: `1px solid ${commentText}`, borderRadius: 4, padding: '4px 10px', marginRight: 8, cursor: 'pointer' }}
                        >Edit</button>
                      )}
                      <button
                        onClick={() => handleDeleteComment(comment.id)}
                        style={{ background: buttonBg, color: commentText, border: '1px solid #c00', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: '#c00' }}
                      >Delete</button>
                    </>
                  )}
                    {showBanButton && (
                      <BanUserButton targetUsername={comment.username} />
                    )}
                </div>
              )}
              {comment.replies && comment.replies.length > 0 && renderComments(comment.replies, depth + 1)}
            </div>
          </div>
        );
      });
    }
      // Ban user button component
      function BanUserButton({ targetUsername }) {
        const [confirming, setConfirming] = useState(false);
        const [banMsg, setBanMsg] = useState("");
        const handleBan = async () => {
          setBanMsg("");
          setConfirming(false);
          const res = await fetch(`${API_BASE_URL}/api/admin/ban-user`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adminUsername: user.username, targetUsername })
          });
          const data = await res.json();
          setBanMsg(data.message || (data.success ? "User banned." : "Failed to ban user."));
        };
        return (
          <span style={{ position: "relative" }}>
            <button
              style={{ background: "#ffe0e0", color: "#c00", border: "1px solid #c00", borderRadius: 6, padding: "4px 10px", fontWeight: 600, cursor: "pointer" }}
              onClick={() => setConfirming(true)}
              title="Ban user"
            >Ban User</button>
            {confirming && (
              <span style={{ position: "absolute", left: 0, top: 32, background: "#fff", color: "#222", border: "1px solid #c00", borderRadius: 6, padding: "10px 16px", zIndex: 10 }}>
                <div style={{ marginBottom: 8 }}>Are you sure you want to ban <b>{targetUsername}</b>?</div>
                <button
                  style={{ background: "#c00", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", fontWeight: 600, marginRight: 8, cursor: "pointer" }}
                  onClick={handleBan}
                >Yes, Ban</button>
                <button
                  style={{ background: "#eee", color: "#222", border: "none", borderRadius: 4, padding: "6px 14px", fontWeight: 600, cursor: "pointer" }}
                  onClick={() => setConfirming(false)}
                >Cancel</button>
              </span>
            )}
            {banMsg && <span style={{ color: banMsg.includes("banned") ? "#080" : "#c00", marginLeft: 8 }}>{banMsg}</span>}
          </span>
        );
      }
    const [comments, setComments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newComment, setNewComment] = useState("");
    const [replyTo, setReplyTo] = useState(null);
    const [editId, setEditId] = useState(null);
    const [editText, setEditText] = useState("");
    const [msg, setMsg] = useState("");

    // Fetch comments
    const fetchComments = () => {
      setLoading(true);
      fetch(`${API_BASE_URL}/api/get-comments?book_id=${bookId}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.comments)) {
            // Only update state if data is different
            if (JSON.stringify(data.comments) !== JSON.stringify(comments)) {
              setComments(data.comments);
            }
          }
          setLoading(false);
        });
    };
    useEffect(() => {
      fetchComments();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bookId, currentPage, commentsRefresh]);

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
        // Trigger refresh
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

    // ...existing renderComments and JSX...
    // Comments container uses the same color for both outer and inner
    const commentsContainerBg = stepColor(backgroundColor, theme, 3);
    return (
      <div style={{ background: commentsContainerBg, color: textColor, borderRadius: 8, padding: 18, marginTop: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <h3 style={{ marginBottom: 10 }}>Comments</h3>
        {msg && <div style={{ color: '#c00', marginBottom: 8 }}>{msg}</div>}
        {loading ? (
          <div>Loading comments...</div>
        ) : (
          <>
            {/* Inner container matches outer container color */}
            <div style={{ background: commentsContainerBg, color: textColor, borderRadius: 8, padding: 18, marginTop: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
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
  }

  if (!pdfData) {
    const loadingBg = stepColor(backgroundColor, theme, 0);
    return <div className={`pdf-reader-loading ${theme}-mode`} style={{ background: loadingBg, color: textColor, minHeight: '100vh' }}>Loading PDF...</div>;
  }

  const page = pdfData.pages.find(p => p.page === currentPage);
  // Use stepColor for all major containers and navigation buttons
  const baseBg = stepColor(backgroundColor, theme, 0);
  const navButtonBg = stepColor(backgroundColor, theme, 1);
  const navButtonText = textColor;
  const pdfPageBg = stepColor(backgroundColor, theme, 1);
  const bookMetaBg = stepColor(backgroundColor, theme, 2);
  const commentsOuterBg = stepColor(backgroundColor, theme, 3);
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
          Page {currentPage} / {pdfData.totalPages || pdfData.pages.length}
        </span>
        <button
          className="pdf-reader-btn"
          onClick={() => setCurrentPage(p => Math.min((pdfData.totalPages || pdfData.pages.length), p + 1))}
          disabled={currentPage === (pdfData.totalPages || pdfData.pages.length)}
          style={{ background: navButtonBg, color: navButtonText, border: `1px solid ${navButtonText}`, borderRadius: 6, padding: '6px 16px', fontWeight: 600, cursor: currentPage === (pdfData.totalPages || pdfData.pages.length) ? 'not-allowed' : 'pointer', marginLeft: 8 }}
        >
          Next ▶
        </button>
      </div>

      <SteppedContainer step={1} style={{ borderRadius: 8, padding: 32, margin: 16, background: pdfPageBg, maxWidth: 1100, marginLeft: 'auto', marginRight: 'auto' }} className="pdf-reader-page">
        {page.images && page.images.length > 0 && (
          <div className="pdf-reader-images">
            {page.images.map((src, idx) => (
              <img key={idx} src={src.startsWith('/pdf-cover/') ? `${API_BASE_URL}${src}` : src} alt={`Page ${page.page} Image ${idx + 1}`} />
            ))}
          </div>
        )}

        {page.text && (
          <div className="pdf-reader-text" style={{ width: '100%', wordBreak: 'break-word', whiteSpace: 'pre-line' }}>
            {page.text.split(/\n\n+/).map((para, idx) => (
              <p key={idx} style={{ margin: '0 0 1em 0' }}>{para.replace(/\n/g, ' ')}</p>
            ))}
          </div>
        )}
      </SteppedContainer>

      <SteppedContainer step={2} style={{ margin: '0 auto', maxWidth: 900, borderRadius: 8, padding: 20, marginBottom: 32, marginTop: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', background: bookMetaBg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 22 }}>{bookMeta?.name || pdfData?.title || pdfData?.name || `Book ${id}`}</span>
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
          <CommentsSection bookId={id} currentPage={currentPage} commentsRefresh={commentsRefresh} />
        </SteppedContainer>
      </SteppedContainer>
    </SteppedContainer>
  );
}