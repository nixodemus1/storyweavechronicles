
import React, { useState, useEffect, useContext } from "react";
import { useCommentsContext } from "./commentsContextUtils";
import { stepColor } from "../utils/colorUtils";
import { ThemeContext } from "../themeContext";
import { waitForServerHealth } from "../utils/serviceHealth";

export default function CommentsSection({ commentToScroll, commentsPageFromQuery, bookId }) {
  const {
    comments,
    commentsLoading,
    commentsPage,
    setCommentsPage,
    totalPages,
    setCommentsRefresh,
  } = useCommentsContext();
  const { user, theme, textColor, backgroundColor } = useContext(ThemeContext);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState("");
  const [msg, setMsg] = useState("");
  const [banMsg, setBanMsg] = useState("");

  // Handle deep-linking to a specific comments page
  useEffect(() => {
    if (commentsPageFromQuery && commentsPageFromQuery !== commentsPage) {
      setCommentsPage(commentsPageFromQuery);
    }
    // Only set once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsPageFromQuery]);

  // Auto-scroll to comment if commentToScroll is present
  useEffect(() => {
    if (!commentToScroll) return;
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
    // Use bookId from props, fallback to user.bookId if needed
    const actualBookId = bookId || (user && user.bookId);
    if (!actualBookId) {
      setMsg("Book ID missing. Cannot add comment.");
      return;
    }
    await waitForServerHealth();
    const res = await fetch(`${import.meta.env.VITE_HOST_URL}/api/add-comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        book_id: actualBookId,
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
    await waitForServerHealth();
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
    await waitForServerHealth();
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
    await waitForServerHealth();
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
          <span style={{ position: "absolute", left: 0, top: 32, background: "#fff", color: 'var(--text-color)', border: "1px solid #c00", borderRadius: 6, padding: "10px 16px", zIndex: 10 }}>
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
              style={{ background: "#eee", color: 'var(--text-color)', border: "none", borderRadius: 4, padding: "6px 14px", fontWeight: 600, cursor: "pointer" }}
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
            style={{ background: 'var(--button-bg, #eee)', color: 'var(--button-text, #333)', border: '1px solid var(--button-border, #bbb)', borderRadius: 4, padding: '4px 10px', cursor: commentsPage === 1 ? 'not-allowed' : 'pointer' }}
        >Prev</button>
        <span style={{ fontWeight: 600 }}>Page {commentsPage} / {totalPages}</span>
        <button
          onClick={() => setCommentsPage(p => Math.min(totalPages, p + 1))}
          disabled={commentsPage === totalPages}
            style={{ background: 'var(--button-bg, #eee)', color: 'var(--button-text, #333)', border: '1px solid var(--button-border, #bbb)', borderRadius: 4, padding: '4px 10px', cursor: commentsPage === totalPages ? 'not-allowed' : 'pointer' }}
        >Next</button>
      </div>
    );
  }

  // Recursive comment rendering (copied and adapted from original)
  function renderComments(list, depth = 0) {
    return list.map(comment => {
      const cssBg = getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim() || backgroundColor;
      const commentBg = stepColor(cssBg, theme, 4 + depth);
      const buttonBg = stepColor(cssBg, theme, 5 + depth);
      const commentText = textColor;
      // Patch: For own comments, use current theme colors for avatar
      const isOwnComment = user && comment.username === user.username;
      const avatarBg = isOwnComment ? backgroundColor : (comment.background_color || stepColor(commentBg, theme, 1));
      const avatarTextColor = isOwnComment ? textColor : (comment.text_color || textColor);
      const isDeleted = comment.deleted;
      const isAdmin = user?.is_admin;
      const showBanButton = isAdmin && !comment.deleted && !comment.is_admin && comment.username !== user?.username;
      // Responsive margin for replies: reduce on mobile
      const isMobile = window.innerWidth < 600;
      const replyMargin = isMobile ? depth * 8 : depth * 24;
      const avatarSize = isMobile ? 28 : 36;
      const fontSize = isMobile ? 14 : 18;
      return (
        <div key={comment.id} id={`comment-${comment.id}`} style={{
          background: commentBg,
          color: commentText,
          borderRadius: 6,
          margin: isMobile ? '8px 0 0 0' : '12px 0 0 0',
          padding: isMobile ? '8px 8px' : '12px 16px',
          marginLeft: replyMargin,
          boxShadow: depth === 0 ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
          display: isMobile ? 'block' : 'flex',
          alignItems: isMobile ? 'stretch' : 'flex-start',
          gap: isMobile ? 6 : 12,
          textAlign: 'left',
          fontSize: fontSize
        }}>
          <div style={{
            width: avatarSize,
            height: avatarSize,
            borderRadius: '50%',
            background: avatarBg,
            color: avatarTextColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: fontSize,
            marginRight: isMobile ? 6 : 10,
            border: `2.5px solid ${avatarTextColor}`
          }}>
            {comment.username ? comment.username[0].toUpperCase() : '?'}
          </div>
            <div style={{ flex: 1, textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 8 }}>
              <span style={{ fontWeight: 600, fontSize: fontSize }}>{isDeleted ? 'Deleted User' : comment.username}</span>
                <span style={{ fontSize: isMobile ? 10 : 12, color: 'var(--meta-text, #888)' }}>{new Date(comment.timestamp).toLocaleString()}</span>
                {comment.edited && !isDeleted && <span style={{ fontSize: isMobile ? 9 : 11, color: 'var(--edited-label, #f5c518)', marginLeft: 6 }}>(edited)</span>}
            </div>
              {isDeleted ? (
                <div style={{ margin: isMobile ? '6px 0' : '8px 0', fontStyle: 'italic', color: 'var(--deleted-text, #888)', fontSize: isMobile ? 12 : undefined }}>Comment not available (user deleted)</div>
            ) : editId === comment.id ? (
              <div>
                <textarea
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  rows={2}
                  style={{ width: '100%', marginTop: 6, borderRadius: 4, fontSize: fontSize }}
                />
                <button
                  onClick={() => handleEditComment(comment.id)}
                  style={{ background: buttonBg, color: commentText, border: `1px solid ${commentText}`, borderRadius: 4, padding: isMobile ? '4px 6px' : '4px 10px', marginRight: 8, cursor: 'pointer', fontSize: fontSize }}
                >Save</button>
                <button
                  onClick={() => { setEditId(null); setEditText(""); }}
                  style={{ background: buttonBg, color: commentText, border: `1px solid ${commentText}`, borderRadius: 4, padding: isMobile ? '4px 6px' : '4px 10px', cursor: 'pointer', fontSize: fontSize }}
                >Cancel</button>
              </div>
            ) : (
              <div style={{ margin: isMobile ? '6px 0' : '8px 0', textAlign: 'left', fontSize: fontSize }}>{comment.text}</div>
            )}
            {!isDeleted && (
              <div style={{ display: 'flex', flexWrap: isMobile ? 'wrap' : 'nowrap', alignItems: isMobile ? 'center' : 'center', gap: isMobile ? 8 : 10, justifyContent: 'flex-start', marginTop: isMobile ? 4 : 0 }}>
                <button
                  onClick={() => handleVoteComment(comment.id, 1)}
                    style={{ background: buttonBg, color: commentText, border: '1px solid var(--upvote-border, #0070f3)', borderRadius: 4, padding: isMobile ? '6px 10px' : '4px 10px', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--upvote-border, #0070f3)', fontSize: fontSize, minWidth: 60 }}
                >▲ {comment.upvotes}</button>
                <button
                  onClick={() => handleVoteComment(comment.id, -1)}
                    style={{ background: buttonBg, color: commentText, border: '1px solid var(--downvote-border, #c00)', borderRadius: 4, padding: isMobile ? '6px 10px' : '4px 10px', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--downvote-border, #c00)', fontSize: fontSize, minWidth: 60 }}
                >▼ {comment.downvotes}</button>
                <button
                  onClick={() => setReplyTo(comment.id)}
                  style={{ background: buttonBg, color: commentText, border: `1px solid ${commentText}`, borderRadius: 4, padding: isMobile ? '6px 10px' : '4px 10px', cursor: 'pointer', fontSize: fontSize, minWidth: 60 }}
                >Reply</button>
                {(user && (user.username === comment.username || user.is_admin)) && (
                  <>
                    {user.username === comment.username && (
                      <button
                        onClick={() => { setEditId(comment.id); setEditText(comment.text); }}
                        style={{ background: buttonBg, color: commentText, border: `1px solid ${commentText}`, borderRadius: 4, padding: isMobile ? '6px 10px' : '4px 10px', marginRight: 8, cursor: 'pointer', fontSize: fontSize, minWidth: 60 }}
                      >Edit</button>
                    )}
                    <button
                      onClick={() => handleDeleteComment(comment.id)}
                        style={{ background: buttonBg, color: commentText, border: '1px solid var(--delete-border, #c00)', borderRadius: 4, padding: isMobile ? '6px 10px' : '4px 10px', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--delete-border, #c00)', fontSize: fontSize, minWidth: 60 }}
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

  const cssBg = getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim() || backgroundColor;
  const commentsContainerBg = stepColor(cssBg, theme, 3);
  return (
    <div style={{ background: commentsContainerBg, color: textColor, borderRadius: 8, padding: 18, marginTop: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      <h3 style={{ marginBottom: 10 }}>Comments</h3>
      {msg && <div style={{ color: 'var(--error-text, #c00)', marginBottom: 8 }}>{msg}</div>}
      {renderPagination()}
      {commentsLoading ? <div>Loading comments...</div> : <>
        <div style={{ background: commentsContainerBg, color: textColor, borderRadius: 8, padding: 18, marginTop: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          {/* Writing box above comments */}
          <div style={{ marginBottom: 18, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
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
          {/* Comments list below writing box */}
          {renderComments(comments)}
        </div>
      </>}
    </div>
  );
}