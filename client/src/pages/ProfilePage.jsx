// Restore FONT_OPTIONS after BookmarksTab
import React, { useContext, useState } from "react";
import { ThemeContext } from "../themeContext";
import { stepColor, getLuminance } from "../utils/colorUtils";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;

const BookmarksTab = React.memo(function BookmarksTab({ user }) {
  const [bookmarks, setBookmarks] = useState([]);
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const textColor = useContext(ThemeContext).textColor;
  // Fetch bookmarks with metadata
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
        if (data.success && Array.isArray(data.bookmarks)) {
          setBookmarks(data.bookmarks);
        } else {
          setBookmarks([]);
        }
      });
  }, [user?.username]);
  // Fetch all books
  React.useEffect(() => {
    const folderId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) return;
    fetch(`${API_BASE_URL}/list-pdfs/${folderId}`)
      .then(res => res.json())
      .then(data => {
        if (data.pdfs && Array.isArray(data.pdfs)) setBooks(data.pdfs);
        else setBooks([]);
        setLoading(false);
      });
  }, []);
  // Merge book info with bookmark metadata
  const bookmarkedBooks = bookmarks
    .map(bm => {
      const book = books.find(b => b.id === bm.id);
      return book ? { ...book, ...bm } : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      // Sort by most recent update
      return new Date(b.last_updated) - new Date(a.last_updated);
    });
  return (
    <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32 }}>
      <h3>Your Bookmarked Books</h3>
      {loading ? (
        <div style={{ color: '#888' }}>Loading bookmarks...</div>
      ) : (
        bookmarkedBooks.length === 0 ? (
          <div style={{ color: '#888' }}>No bookmarks yet.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {bookmarkedBooks.map(book => (
              <li
                key={book.id}
                style={{
                  marginBottom: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: book.unread ? '#ffe0e0' : 'transparent',
                  borderRadius: 6,
                  padding: '6px 8px',
                  boxShadow: book.unread ? '0 0 4px #c00' : 'none',
                }}
              >
                  <a href={`/read/${book.id}`} style={{ fontWeight: 600, color: textColor, textDecoration: 'underline' }}>{book.name}</a>
                <span style={{ fontSize: 13, color: '#888' }}>
                  Last updated: {book.last_updated ? book.last_updated : 'Never'}
                </span>
                <span style={{ fontSize: 13, color: '#888' }}>
                  Last page read: {book.last_page}
                </span>
                {book.unread && (
                  <span style={{ color: '#c00', fontWeight: 700, fontSize: 13 }}>Unread update!</span>
                )}
                  {/* Removed separate Read link, title is now the link */}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
});

  // --- AdminTab component ---
const AdminTab = React.memo(({ user }) => {
  // Admin Promotion/Removal State
  const [targetUsername, setTargetUsername] = useState("");
  const [adminActionMsg, setAdminActionMsg] = useState("");

  // Emergency Email State (local)
  const [adminSubject, setAdminSubject] = useState("");
  const [adminMessage, setAdminMessage] = useState("");
  const [adminRecipientType, setAdminRecipientType] = useState("all");
  const [adminRecipientValue, setAdminRecipientValue] = useState("");
  const [adminStatus, setAdminStatus] = useState("");

  // Promote user to admin
  async function handleMakeAdmin(e) {
    e.preventDefault();
    setAdminActionMsg("");
    if (!targetUsername) {
      setAdminActionMsg("Enter a username.");
      return;
    }
    const res = await fetch(`${API_BASE_URL}/api/admin/make-admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminUsername: user?.username, targetUsername })
    });
    const data = await res.json();
    setAdminActionMsg(data.message || (data.success ? "Success" : "Error"));
  }

  // Remove admin rights
  async function handleRemoveAdmin(e) {
    e.preventDefault();
    setAdminActionMsg("");
    if (!targetUsername) {
      setAdminActionMsg("Enter a username.");
      return;
    }
    const res = await fetch(`${API_BASE_URL}/api/admin/remove-admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminUsername: user?.username, targetUsername })
    });
    const data = await res.json();
    setAdminActionMsg(data.message || (data.success ? "Success" : "Error"));
  }

  // Emergency email handler (local)
  async function handleSendEmergencyEmail(e) {
    e.preventDefault();
    setAdminStatus("");
    if (!adminSubject || !adminMessage) {
      setAdminStatus("Subject and message required.");
      return;
    }
    let recipient = adminRecipientType === "all" ? "all" : adminRecipientValue;
    const res = await fetch(`${API_BASE_URL}/api/admin/send-emergency-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminUsername: user?.username,
        subject: adminSubject,
        message: adminMessage,
        recipient
      })
    });
    const data = await res.json();
    setAdminStatus(data.message || (data.success ? "Success" : "Error"));
  }

  return (
    <div style={{ maxWidth: 400 }}>
      <h3>Admin Controls</h3>
      {/* Promote/Remove Admin */}
      <form style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
        <label>
          Username to promote/remove:
          <input
            type="text"
            value={targetUsername}
            onChange={e => setTargetUsername(e.target.value)}
            style={{ marginLeft: 8, padding: "6px 12px", fontSize: 15 }}
            placeholder="Target username"
          />
        </label>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={handleMakeAdmin}
            style={{ padding: "8px 16px", borderRadius: 6, background: "#007bff", color: "#fff", border: "none", fontWeight: 600, fontSize: 15, cursor: "pointer" }}
          >Promote to Admin</button>
          <button
            type="button"
            onClick={handleRemoveAdmin}
            style={{ padding: "8px 16px", borderRadius: 6, background: "#c00", color: "#fff", border: "none", fontWeight: 600, fontSize: 15, cursor: "pointer" }}
          >Remove Admin</button>
        </div>
        {adminActionMsg && <div style={{ color: adminActionMsg.includes("Success") ? "green" : "red", marginTop: 8 }}>{adminActionMsg}</div>}
      </form>
      {/* Emergency Email Controls */}
      <form style={{ display: "flex", flexDirection: "column", gap: 12 }} onSubmit={handleSendEmergencyEmail}>
        <h4>Send Emergency Email</h4>
        <label>
          Subject:
          <input
            type="text"
            value={adminSubject}
            onChange={e => setAdminSubject(e.target.value)}
            style={{ marginLeft: 8, padding: "6px 12px", fontSize: 15 }}
            placeholder="Email subject"
          />
        </label>
        <label>
          Message:
          <textarea
            value={adminMessage}
            onChange={e => setAdminMessage(e.target.value)}
            style={{ marginLeft: 8, padding: "6px 12px", fontSize: 15, minHeight: 60 }}
            placeholder="Email message"
          />
        </label>
        <label>
          Recipient:
          <select
            value={adminRecipientType}
            onChange={e => setAdminRecipientType(e.target.value)}
            style={{ marginLeft: 8, padding: "6px 12px", fontSize: 15 }}
          >
            <option value="all">All Users</option>
            <option value="username">By Username</option>
            <option value="email">By Email</option>
          </select>
        </label>
        {(adminRecipientType === "username" || adminRecipientType === "email") && (
          <input
            type="text"
            value={adminRecipientValue}
            onChange={e => setAdminRecipientValue(e.target.value)}
            style={{ marginLeft: 8, padding: "6px 12px", fontSize: 15 }}
            placeholder={adminRecipientType === "username" ? "Recipient username" : "Recipient email"}
          />
        )}
        <button
          type="submit"
          style={{ padding: "8px 16px", borderRadius: 6, background: "#28a745", color: "#fff", border: "none", fontWeight: 600, fontSize: 15, cursor: "pointer" }}
        >Send Emergency Email</button>
        {adminStatus && <div style={{ color: adminStatus.includes("Success") ? "green" : "red", marginTop: 8 }}>{adminStatus}</div>}
      </form>
    </div>
  );
});

export default function ProfilePage({ user, setUser, onLogout, refreshNotifications }) {
  // ...existing code...
  const [emailFrequency, setEmailFrequency] = useState("immediate");
  const EMAIL_FREQUENCY_OPTIONS = [
    { value: "immediate", label: "Immediate" },
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" }
  ];
  const [activeTab, setActiveTab] = useState("settings");
  const [timezone, setTimezone] = useState(user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [sidebarManual, setSidebarManual] = useState(false); // track manual toggle
  const { backgroundColor, textColor, setBackgroundColor, setTextColor, font, setFont } = useContext(ThemeContext);
  const isAdmin = user?.is_admin == true || user?.is_admin === 1;

  // Save color changes to backend for logged-in user
  React.useEffect(() => {
    if (!user?.username) return;
    fetch(`${API_BASE_URL}/api/update-colors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, backgroundColor, textColor })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setUser(u => u ? { ...u, backgroundColor, textColor } : u);
        }
      });
  }, [backgroundColor, textColor, user?.username]);

  // Save font and timezone changes to backend for logged-in user
  React.useEffect(() => {
    if (!user?.username) return;
    fetch(`${API_BASE_URL}/api/update-profile-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, font, timezone })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setUser(u => u ? { ...u, font, timezone } : u);
        }
      });
  }, [font, timezone, user?.username]);
  // Notifications
  const [notifPrefs, setNotifPrefs] = useState(null);
  const [notifHistory, setNotifHistory] = useState([]);
  const [notifMsg, setNotifMsg] = useState("");
  // Secondary emails
  const [secondaryEmails, setSecondaryEmails] = useState(user?.secondaryEmails || []);
  const [newSecondaryEmail, setNewSecondaryEmail] = useState("");
  const [secondaryEmailMsg, setSecondaryEmailMsg] = useState("");
  // Account deletion
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteMsg, setDeleteMsg] = useState("");
  // Change password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  // Load notification prefs/history when tab is opened
  React.useEffect(() => {
    if (activeTab === "notifications" && user?.username) {
      fetch(`${API_BASE_URL}/api/notification-prefs?username=${user.username}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) setNotifPrefs(data.prefs);
        });
      fetch(`${API_BASE_URL}/api/notification-history?username=${user.username}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.history)) setNotifHistory(data.history);
          else setNotifHistory([]);
        });
    }
    // Do NOT update user or parent state here
  }, [activeTab, user?.username]);

  const UserCommentsSection = React.memo(function UserCommentsSection({ user, textColor, containerBg, containerText }) {
    const [comments, setComments] = useState([]);
    const [books, setBooks] = useState([]);
    React.useEffect(() => {
      if (!user?.username) return;
      fetch(`${API_BASE_URL}/api/user-comments?username=${user.username}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.comments)) setComments(data.comments);
          else setComments([]);
        });
    }, [user?.username]);
    React.useEffect(() => {
      const folderId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;
      if (!folderId) return;
      fetch(`${API_BASE_URL}/list-pdfs/${folderId}`)
        .then(res => res.json())
        .then(data => {
          if (data.pdfs && Array.isArray(data.pdfs)) setBooks(data.pdfs);
          else setBooks([]);
        });
    }, []);
    function getBookName(id) {
      const book = books.find(b => b.id === id);
      return book ? book.name : id;
    }
    return (
      <div style={{
        marginTop: 24,
        background: containerBg,
        color: containerText,
        borderRadius: 8,
        padding: '18px 16px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
      }}>
        <h4 style={{ color: containerText }}>Your Comments & Replies</h4>
        {comments.length === 0 ? (
          <div style={{ color: '#888' }}>No comments yet.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {comments.map(c => (
              <li key={c.id} style={{
                marginBottom: 10,
                background: stepColor(containerBg, 'dark', c.parent_id ? 1 : 0, 1),
                color: containerText,
                borderRadius: 6,
                padding: '6px 10px'
              }}>
                <div>
                  <a href={`/read/${c.book_id}`} style={{ color: containerText, fontWeight: 600 }}>
                    {getBookName(c.book_id)}
                  </a>
                  {c.parent_id && <span style={{ color: '#888', marginLeft: 8 }}>(Reply)</span>}
                </div>
                <div style={{ color: containerText }}>{c.text}</div>
                <div style={{ fontSize: 12, color: '#888' }}>
                  {new Date(c.timestamp).toLocaleString()} {c.edited && <span>(edited)</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  });

  function UserTopVotedBooks({ user, textColor, containerBg, containerText }) {
    const [votes, setVotes] = useState([]);
    const [books, setBooks] = useState([]);
    React.useEffect(() => {
      if (!user?.username) return;
      fetch(`${API_BASE_URL}/api/user-voted-books?username=${user.username}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.voted_books)) setVotes(data.voted_books.slice(0, 10));
          else setVotes([]);
        });
    }, [user?.username]);
    React.useEffect(() => {
      const folderId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;
      if (!folderId) return;
      fetch(`${API_BASE_URL}/list-pdfs/${folderId}`)
        .then(res => res.json())
        .then(data => {
          if (data.pdfs && Array.isArray(data.pdfs)) setBooks(data.pdfs);
          else setBooks([]);
        });
    }, []);
    function getBookName(id) {
      const book = books.find(b => b.id === id);
      return book ? book.name : id;
    }
    return (
      <div style={{
        marginTop: 24,
        background: containerBg,
        color: containerText,
        borderRadius: 8,
        padding: '18px 16px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
      }}>
        <h4 style={{ color: containerText }}>Top Voted Books</h4>
        {votes.length === 0 ? (
          <div style={{ color: '#888' }}>No votes yet.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {votes.map(v => (
              <li key={v.book_id} style={{
                marginBottom: 10,
                background: stepColor(containerBg, 'dark', 0, 1),
                color: containerText,
                borderRadius: 6,
                padding: '6px 10px'
              }}>
                <a href={`/read/${v.book_id}`} style={{ color: containerText, fontWeight: 600 }}>
                  {getBookName(v.book_id)}
                </a>
                <span style={{ marginLeft: 8, color: '#888' }}>Your rating: {v.value}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // --- Render ---
  function NotificationPrefsTab() {
    if (!notifPrefs) return <div>Loading...</div>;
    return (
      <div style={{ maxWidth: 400 }}>
        <h3>Notification Preferences</h3>
        {/* ...other notification preference controls... */}
        <div style={{ margin: "18px 0" }}>
          <label htmlFor="email-frequency" style={{ fontWeight: 600 }}>Email Frequency:</label>
          <select
            id="email-frequency"
            value={emailFrequency}
            onChange={e => {
              setEmailFrequency(e.target.value);
              // Save to backend
              const newPrefs = { ...notifPrefs, emailFrequency: e.target.value };
              setNotifPrefs(newPrefs);
              fetch(`${API_BASE_URL}/api/update-notification-prefs`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: user.username, prefs: newPrefs })
              })
                .then(res => res.json())
                .then(data => {
                  if (data.success) setNotifMsg("Email frequency updated.");
                  else setNotifMsg("Failed to update email frequency.");
                });
            }}
            style={{ marginLeft: 12, padding: "6px 12px", fontSize: 15 }}
          >
            {EMAIL_FREQUENCY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {notifMsg && <div style={{ color: "#c00", marginTop: 8 }}>{notifMsg}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '80vh' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: sidebarExpanded ? 180 : 56,
          background: stepColor(backgroundColor, 'sidebar', 1),
          color: textColor,
          transition: 'width 0.2s',
          display: 'flex',
          flexDirection: 'column',
          alignItems: sidebarExpanded ? 'flex-start' : 'center',
          padding: sidebarExpanded ? '24px 12px 24px 18px' : '24px 6px',
          borderRight: '1px solid #eee',
          gap: 10
        }}
        onMouseEnter={() => { if (!sidebarManual) setSidebarExpanded(true); }}
        onMouseLeave={() => { if (!sidebarManual) setSidebarExpanded(false); }}
      >
        {/* User avatar (styled div, matches header) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 18, width: '100%' }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: backgroundColor,
              color: textColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 6,
              fontWeight: 700,
              fontSize: 24,
              border: `2px solid ${textColor}`,
            }}
          >
            {user?.username ? user.username[0].toUpperCase() : "?"}
          </div>
          {sidebarExpanded && <div style={{ fontWeight: 600, fontSize: 16, color: textColor }}>{user?.username}</div>}
        </div>
        <button
          onClick={() => setActiveTab('settings')}
          style={{
            background: activeTab === 'settings' ? textColor : 'none',
            color: activeTab === 'settings' ? backgroundColor : textColor,
            border: 'none',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 15,
            padding: sidebarExpanded ? '10px 18px' : '10px 0',
            width: '100%',
            marginBottom: 4,
            cursor: 'pointer',
            textAlign: sidebarExpanded ? 'left' : 'center',
          }}
        >{sidebarExpanded ? 'Settings' : '⚙️'}</button>
        <button
          onClick={() => setActiveTab('security')}
          style={{
            background: activeTab === 'security' ? textColor : 'none',
            color: activeTab === 'security' ? backgroundColor : textColor,
            border: 'none',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 15,
            padding: sidebarExpanded ? '10px 18px' : '10px 0',
            width: '100%',
            marginBottom: 4,
            cursor: 'pointer',
            textAlign: sidebarExpanded ? 'left' : 'center',
          }}
        >{sidebarExpanded ? 'Security' : '🔒'}</button>
        <button
          onClick={() => setActiveTab('account')}
          style={{
            background: activeTab === 'account' ? textColor : 'none',
            color: activeTab === 'account' ? backgroundColor : textColor,
            border: 'none',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 15,
            padding: sidebarExpanded ? '10px 18px' : '10px 0',
            width: '100%',
            marginBottom: 4,
            cursor: 'pointer',
            textAlign: sidebarExpanded ? 'left' : 'center',
          }}
        >{sidebarExpanded ? 'Account' : '�'}</button>
        <button
          onClick={() => setActiveTab('notifications')}
          style={{
            background: activeTab === 'notifications' ? textColor : 'none',
            color: activeTab === 'notifications' ? backgroundColor : textColor,
            border: 'none',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 15,
            padding: sidebarExpanded ? '10px 18px' : '10px 0',
            width: '100%',
            marginBottom: 4,
            cursor: 'pointer',
            textAlign: sidebarExpanded ? 'left' : 'center',
          }}
        >{sidebarExpanded ? 'Notifications' : '🔔'}</button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('admin')}
            style={{
              background: activeTab === 'admin' ? textColor : 'none',
              color: activeTab === 'admin' ? backgroundColor : textColor,
              border: 'none',
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 15,
              padding: sidebarExpanded ? '10px 18px' : '10px 0',
              width: '100%',
              marginBottom: 4,
              cursor: 'pointer',
              textAlign: sidebarExpanded ? 'left' : 'center',
            }}
          >{sidebarExpanded ? 'Admin' : '🛡️'}</button>
        )}
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, padding: '32px 0 32px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', background: backgroundColor, color: textColor }}>
        {/* Bookmarks Tab */}
        {/* Account Tab: Bookmarks, comments, replies, top voted books */}
        {activeTab === "account" && (
          <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32 }}>
            <h3>Account Overview</h3>
            <div style={{ marginBottom: 12, color: '#555', fontSize: 15 }}>
              <strong>Primary Email:</strong> {user?.email || <span style={{ color: '#c00' }}>No email found</span>}
            </div>
            {/* Bookmarks */}
            <BookmarksTab user={user} />
            {/* Comments & Replies */}
            <UserCommentsSection
              user={user}
              textColor={textColor}
              containerBg={stepColor(backgroundColor, 'container', 1)}
              containerText={textColor}
            />
            {/* Top Voted Books */}
            <UserTopVotedBooks
              user={user}
              textColor={textColor}
              containerBg={stepColor(backgroundColor, 'container', 1)}
              containerText={textColor}
            />
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === "notifications" && (
          <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, display: 'flex', flexDirection: 'column', gap: 32 }}>
            <h3>Notification Preferences</h3>
            {/* Email Frequency Dropdown */}
            <div style={{ margin: "18px 0" }}>
              <label htmlFor="email-frequency" style={{ fontWeight: 600 }}>Email Frequency:</label>
              <select
                id="email-frequency"
                value={emailFrequency}
                onChange={e => {
                  setEmailFrequency(e.target.value);
                  // Save to backend
                  const newPrefs = { ...notifPrefs, emailFrequency: e.target.value };
                  setNotifPrefs(newPrefs);
                  fetch(`${API_BASE_URL}/api/update-notification-prefs`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username: user.username, prefs: newPrefs })
                  })
                    .then(res => res.json())
                    .then(data => {
                      if (data.success) setNotifMsg("Email frequency updated.");
                      else setNotifMsg("Failed to update email frequency.");
                    });
                }}
                style={{ marginLeft: 12, padding: "6px 12px", fontSize: 15 }}
              >
                {EMAIL_FREQUENCY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {notifMsg && <div style={{ color: "#c00", marginTop: 8 }}>{notifMsg}</div>}
            </div>
            {notifPrefs ? (
              <form
                onSubmit={async e => {
                  e.preventDefault();
                  setNotifMsg("");
                  const res = await fetch(`${API_BASE_URL}/api/update-notification-prefs`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: user.username, prefs: notifPrefs })
                  });
                  const data = await res.json();
                  setNotifMsg(data.message);
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
              >
                {/* ...existing notification form code... */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="checkbox" checked={notifPrefs.muteAll} onChange={e => setNotifPrefs(p => ({ ...p, muteAll: e.target.checked }))} />
                  Mute all notifications
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: notifPrefs.muteAll ? 0.5 : 1 }}>
                  <input type="checkbox" checked={notifPrefs.newBooks} disabled={notifPrefs.muteAll} onChange={e => setNotifPrefs(p => ({ ...p, newBooks: e.target.checked }))} />
                  Email me about new books
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: notifPrefs.muteAll ? 0.5 : 1 }}>
                  <input type="checkbox" checked={notifPrefs.updates} disabled={notifPrefs.muteAll} onChange={e => setNotifPrefs(p => ({ ...p, updates: e.target.checked }))} />
                  Email me about updates
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: notifPrefs.muteAll ? 0.5 : 1 }}>
                  <input type="checkbox" checked={notifPrefs.announcements} disabled={notifPrefs.muteAll} onChange={e => setNotifPrefs(p => ({ ...p, announcements: e.target.checked }))} />
                  Email me about announcements
                </label>
                <div style={{ marginTop: 8, fontWeight: 500 }}>Send notifications to:</div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={notifPrefs.channels?.includes('primary')}
                      disabled={notifPrefs.muteAll}
                      onChange={e => {
                        setNotifPrefs(p => {
                          const ch = new Set(p.channels || []);
                          if (e.target.checked) ch.add('primary'); else ch.delete('primary');
                          return { ...p, channels: Array.from(ch) };
                        });
                      }}
                    />
                    Primary ({user.email})
                  </label>
                  {user.secondaryEmails && user.secondaryEmails.map(email => (
                    <label key={email} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={notifPrefs.channels?.includes(email)}
                        disabled={notifPrefs.muteAll}
                        onChange={e => {
                          setNotifPrefs(p => {
                            const ch = new Set(p.channels || []);
                            if (e.target.checked) ch.add(email); else ch.delete(email);
                            return { ...p, channels: Array.from(ch) };
                          });
                        }}
                      />
                      {email}
                    </label>
                  ))}
                </div>
                <button type="submit" style={{ padding: '8px 20px', borderRadius: 6, background: textColor, color: backgroundColor, border: 'none', fontWeight: 600, fontSize: 15, cursor: 'pointer', marginTop: 8 }}>Save Preferences</button>
                {notifMsg && <div style={{ color: notifMsg.includes('updated') ? 'green' : 'red', marginTop: 6 }}>{notifMsg}</div>}
              </form>
            ) : <div>Loading preferences...</div>}

            <div style={{ marginTop: 32 }}>
              <h3>Notification History</h3>
              {notifHistory.length === 0 ? (
                <div style={{ color: '#888', fontSize: 15 }}>No notifications yet.</div>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 220, overflowY: 'auto' }}>
                  {notifHistory.map((n, i) => (
                    <li key={i} style={{ padding: '10px 0', borderBottom: `1px solid ${textColor}`, color: n.read ? '#888' : textColor, background: n.read ? stepColor(backgroundColor, 'sidebar', 2) : backgroundColor }}>
                      <div style={{ fontWeight: n.read ? 400 : 600 }}>{n.title || n.type}</div>
                      <div style={{ fontSize: 13 }}>{n.body}</div>
                      <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{n.timestamp}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Settings Tab: Color, Font, Timezone */}
        {activeTab === "settings" && (
          <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, display: 'flex', flexDirection: 'column', gap: 32 }}>
            <h3>Profile Settings</h3>
            {/* Color Picker */}
            <div style={{ marginBottom: 24 }}>
              <h4>Theme Colors</h4>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                Background:
                <input type="color" value={backgroundColor} onChange={e => setBackgroundColor(e.target.value)} />
                <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{backgroundColor}</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                Text:
                <input type="color" value={textColor} onChange={e => setTextColor(e.target.value)} />
                <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{textColor}</span>
              </label>
            </div>

            {/* Font Picker */}
            <div style={{ marginBottom: 24 }}>
              <h4>Font</h4>
              <select value={font} onChange={e => setFont(e.target.value)} style={{ padding: 6, borderRadius: 4, border: '1px solid #ccc', minWidth: 120 }}>
                <option value="">Default</option>
                <option value="serif">Serif</option>
                <option value="sans-serif">Sans-serif</option>
                <option value="monospace">Monospace</option>
                <option value="opendyslexic, sans-serif">OpenDyslexic</option>
              </select>
            </div>

            {/* Timezone Picker */}
            <div style={{ marginBottom: 24 }}>
              <h4>Timezone</h4>
              <select value={timezone} onChange={e => setTimezone(e.target.value)} style={{ padding: 6, borderRadius: 4, border: '1px solid #ccc', minWidth: 120 }}>
                {Intl.supportedValuesOf('timeZone').map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
            <div style={{ color: '#888', fontSize: 13, marginTop: 8 }}>
              Changes are saved automatically.
            </div>
          </div>
        )}

        {/* Security Tab: Secondary Emails, Change Password, Delete Account */}
        {activeTab === "security" && (
          <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, display: 'flex', flexDirection: 'column', gap: 32 }}>
            <h3>Security</h3>
            {/* Secondary Emails */}
            <div style={{ marginBottom: 24 }}>
              <h4>Secondary Emails</h4>
              <form
                onSubmit={async e => {
                  e.preventDefault();
                  setSecondaryEmailMsg("");
                  if (!newSecondaryEmail) return setSecondaryEmailMsg("Enter an email.");
                  // Always send both username and email
                  const payload = { username: user?.username || "", email: newSecondaryEmail };
                  const res = await fetch(`${API_BASE_URL}/api/add-secondary-email`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                  });
                  const data = await res.json();
                  setSecondaryEmailMsg(data.message);
                  if (data.success && data.secondaryEmails) {
                    setUser(u => ({ ...u, secondaryEmails: data.secondaryEmails }));
                    setNewSecondaryEmail("");
                  }
                }}
                style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}
              >
                <input
                  type="email"
                  value={newSecondaryEmail}
                  onChange={e => setNewSecondaryEmail(e.target.value)}
                  placeholder="Add secondary email"
                  style={{ flex: 1, padding: 6, borderRadius: 4, border: '1px solid #ccc' }}
                />
                <button type="submit" style={{ padding: '6px 14px', borderRadius: 5, background: textColor, color: backgroundColor, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Add</button>
              </form>
              {secondaryEmailMsg && <div style={{ color: secondaryEmailMsg.includes('added') ? 'green' : 'red', marginBottom: 8 }}>{secondaryEmailMsg}</div>}
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {user && user.secondaryEmails && user.secondaryEmails.length > 0 ? user.secondaryEmails.map(email => (
                  <li key={email} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span>{email}</span>
                    <button
                      type="button"
                      style={{ color: '#c00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}
                      onClick={async () => {
                        const res = await fetch(`${API_BASE_URL}/api/remove-secondary-email`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ username: user.username, email })
                        });
                        const data = await res.json();
                        setSecondaryEmailMsg(data.message);
                        if (data.success && data.secondaryEmails) {
                          setUser(u => ({ ...u, secondaryEmails: data.secondaryEmails }));
                        }
                      }}
                    >Remove</button>
                  </li>
                )) : <li style={{ color: '#888' }}>No secondary emails.</li>}
              </ul>
            </div>

            {/* Change Password */}
            <div style={{ marginBottom: 24 }}>
              <h4>Change Password</h4>
              <form
                onSubmit={async e => {
                  e.preventDefault();
                  setPasswordMessage("");
                  if (!currentPassword || !newPassword || !confirmPassword) {
                    setPasswordMessage("Please fill out all fields.");
                    return;
                  }
                  if (newPassword !== confirmPassword) {
                    setPasswordMessage("New passwords do not match.");
                    return;
                  }
                  const res = await fetch(`${API_BASE_URL}/api/change-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: user.username, currentPassword, newPassword })
                  });
                  const data = await res.json();
                  setPasswordMessage(data.message);
                  if (data.success) {
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                  }
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}
              >
                <input
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  style={{ padding: 6, borderRadius: 4, border: '1px solid #ccc' }}
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="New password"
                  style={{ padding: 6, borderRadius: 4, border: '1px solid #ccc' }}
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  style={{ padding: 6, borderRadius: 4, border: '1px solid #ccc' }}
                />
                <button type="submit" style={{ padding: '6px 14px', borderRadius: 5, background: textColor, color: backgroundColor, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', marginTop: 4 }}>Change Password</button>
              </form>
              {passwordMessage && <div style={{ color: passwordMessage.includes('changed') ? 'green' : 'red', marginTop: 6 }}>{passwordMessage}</div>}
            </div>

            {/* Delete Account */}
            <div style={{ marginBottom: 24 }}>
              <h4>Delete Account</h4>
              <form
                onSubmit={async e => {
                  e.preventDefault();
                  setDeleteMsg("");
                  if (!deletePassword) {
                    setDeleteMsg("Enter your password to confirm deletion.");
                    return;
                  }
                  const res = await fetch(`${API_BASE_URL}/api/delete-account`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: user.username, password: deletePassword })
                  });
                  const data = await res.json();
                  setDeleteMsg(data.message);
                  if (data.success) {
                    setTimeout(() => {
                      setUser(null);
                      window.location.href = "/";
                    }, 1200);
                  }
                }}
                style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 320 }}
              >
                <input
                  type="password"
                  value={deletePassword}
                  onChange={e => setDeletePassword(e.target.value)}
                  placeholder="Password"
                  style={{ flex: 1, padding: 6, borderRadius: 4, border: '1px solid #ccc' }}
                />
                <button type="submit" style={{ padding: '6px 14px', borderRadius: 5, background: '#c00', color: '#fff', border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Delete</button>
              </form>
              {deleteMsg && <div style={{ color: deleteMsg.includes('deleted') ? 'green' : 'red', marginTop: 6 }}>{deleteMsg}</div>}
            </div>
          </div>
        )}

        {/* --- Admin Emergency Email --- */}
        {activeTab === "admin" && isAdmin && (
          <AdminTab user={user} />
        )}

        {/* Log Out button */}
        <button
          onClick={onLogout}
          style={{
            padding: "10px 24px",
            borderRadius: 6,
            background: textColor,
            color: backgroundColor,
            border: "none",
            fontWeight: 600,
            fontSize: 16,
            cursor: "pointer",
            marginTop: 32
          }}
        >
          Log Out
        </button>
      </main>
    </div>
  );
}