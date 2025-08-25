import React, { useState } from "react";
import { useCommentsContext } from "../commentsContext";
import { stepColor } from "../utils/colorUtils";
import { ThemeContext } from "../themeContext";

export default function CommentsSection({ commentToScroll, commentsPageFromQuery }) {
  const {
    comments,
    setComments,
    commentsLoading,
    setCommentsLoading,
    commentsPage,
    setCommentsPage,
    totalPages,
    setTotalPages,
    commentsRefresh,
    setCommentsRefresh,
    commentsPageSize,
    setCommentsPageSize,
  } = useCommentsContext();
  const { user, theme, textColor, backgroundColor } = React.useContext(ThemeContext);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState("");
  const [msg, setMsg] = useState("");
  const [banMsg, setBanMsg] = useState("");

  // Handle deep-linking to a specific comments page
  React.useEffect(() => {
    if (commentsPageFromQuery && commentsPageFromQuery !== commentsPage) {
      setCommentsPage(commentsPageFromQuery);
    }
    // Only set once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsPageFromQuery]);
  // Auto-scroll to comment if commentToScroll is present
  React.useEffect(() => {
    if (!commentToScroll) return;
    setTimeout(() => {
      const el = document.getElementById(`comment-${commentToScroll}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.boxShadow = '0 0 0 3px #0070f3';
        setTimeout(() => { el.style.boxShadow = ''; }, 2000);
      }
    }, 400);
  }, [comments]);

  // Add comment or reply
  const handleAddComment = async () => {
    if (!user || !user.username) {
      setMsg("Log in to comment.");
      return;
    }
    if (!newComment.trim()) return;
    const res = await fetch(`${import.meta.env.VITE_HOST_URL}/api/add-comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        book_id: user.bookId,
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
    const res = await fetch(`${import.meta.env.VITE_HOST_URL}/api/edit-comment`, {
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
    const res = await fetch(`${import.meta.env.VITE_HOST_URL}/api/delete-comment`, {
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
    await fetch(`${import.meta.env.VITE_HOST_URL}/api/vote-comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment_id: commentId, value })
    });
    setCommentsRefresh(r => r + 1);
  };
  // Ban user button
  function BanUserButton({ targetUsername }) {
    const [confirming, setConfirming] = useState(false);
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
              onClick={async () => { await fetch(`${import.meta.env.VITE_HOST_URL}/api/admin/ban-user`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ adminUsername: user.username, targetUsername })
              }); setConfirming(false); setBanMsg("User banned."); setCommentsRefresh(r => r + 1); }}
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
  // Pagination controls
  function renderPagination() {
    if (totalPages <= 1) return null;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <button
          onClick={() => setCommentsPage(p => Math.max(1, p - 1))}
          disabled={commentsPage === 1}
          style={{ background: '#eee', color: '#333', border: '1px solid #bbb', borderRadius: 4, padding: '4px 10px', cursor: commentsPage === 1 ? 'not-allowed' : 'pointer' }}
        >Prev</button>
        <span style={{ fontWeight: 600 }}>Page {commentsPage} / {totalPages}</span>
        <button
          onClick={() => setCommentsPage(p => Math.min(totalPages, p + 1))}
          disabled={commentsPage === totalPages}
          style={{ background: '#eee', color: '#333', border: '1px solid #bbb', borderRadius: 4, padding: '4px 10px', cursor: commentsPage === totalPages ? 'not-allowed' : 'pointer' }}
        >Next</button>
      </div>
    );
  }
  // Recursive comment rendering
  function renderComments(list, depth = 0) {
    ...existing code...
  }
  const commentsContainerBg = stepColor(backgroundColor, theme, 3);
  return (
    <div style={{ background: commentsContainerBg, color: textColor, borderRadius: 8, padding: 18, marginTop: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <h3 style={{ marginBottom: 10 }}>Comments</h3>
      {msg && <div style={{ color: '#c00', marginBottom: 8 }}>{msg}</div>}
      {renderPagination()}
      {commentsLoading ? <div>Loading comments...</div> : <>
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
      </>}
    </div>
  );
}