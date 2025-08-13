import React, { useContext, useState } from "react";
import { ThemeContext } from "../themeContext";
import { stepColor, getLuminance } from "../utils/colorUtils";

// Optional: FONT_OPTIONS if needed elsewhere
// const FONT_OPTIONS = [
//   { label: "Default", value: "" },
//   { label: "Serif", value: "serif" },
//   { label: "Sans-serif", value: "sans-serif" },
//   { label: "Monospace", value: "monospace" },
//   { label: "OpenDyslexic", value: "opendyslexic, sans-serif" },
// ];

function BookmarksTab({ user }) {
  const [bookmarks, setBookmarks] = useState([]);
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const textColor = useContext(ThemeContext).textColor;
  React.useEffect(() => {
    if (!user?.username) return;
    setLoading(true);
    fetch('/api/get-bookmarks', {
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
  React.useEffect(() => {
    const folderId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) return;
    fetch(`/list-pdfs/${folderId}`)
      .then(res => res.json())
      .then(data => {
        if (data.pdfs && Array.isArray(data.pdfs)) setBooks(data.pdfs);
        else setBooks([]);
        setLoading(false);
      });
  }, []);
  const bookmarkedBooks = books.filter(b => bookmarks.includes(b.id));
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
              <li key={book.id} style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 600, color: textColor }}>{book.name}</span>
                <a href={`/read/${book.id}`} style={{ color: '#0070f3', textDecoration: 'underline', fontSize: 15 }}>Read</a>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

export default function ProfilePage({ user, setUser, onLogout }) {
  const [activeTab, setActiveTab] = useState("settings");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const { backgroundColor, textColor, setBackgroundColor, setTextColor, font, setFont } = useContext(ThemeContext);
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
      fetch('/api/notification-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username })
      })
        .then(res => res.json())
        .then(data => { if (data.success) setNotifPrefs(data.prefs); });
      fetch('/api/notification-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username })
      })
        .then(res => res.json())
        .then(data => { if (data.success) setNotifHistory(data.history); });
    }
  }, [activeTab, user?.username]);

  // --- Render ---
  return (
    <div>
      {/* Example: Bookmarks Tab */}
      {activeTab === "bookmarks" && <BookmarksTab user={user} />}

      {/* Notifications Tab (placeholder) */}
      {activeTab === "notifications" && (
        <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, display: 'flex', flexDirection: 'column', gap: 32 }}>
          <h3>Notification Preferences</h3>
          {notifPrefs ? (
            <form
              onSubmit={async e => {
                e.preventDefault();
                setNotifMsg("");
                const res = await fetch('/api/update-notification-prefs', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ username: user.username, prefs: notifPrefs })
                });
                const data = await res.json();
                setNotifMsg(data.message);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
            >
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
            {/* DEV ONLY: Remove this button before production! */}
            <button
              type="button"
              style={{ marginBottom: 12, padding: '6px 14px', borderRadius: 5, background: '#eee', color: '#c00', border: '1px solid #c00', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
              onClick={async () => {
                if (!user?.username) return;
                const res = await fetch('/api/seed-notifications', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ username: user.username })
                });
                const data = await res.json();
                if (data.success) setNotifHistory(data.history);
              }}
            >Seed Notifications (dev only)</button>
            {notifHistory.length === 0 ? (
              <div style={{ color: '#888', fontSize: 15 }}>No notifications yet.</div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 220, overflowY: 'auto' }}>
                {notifHistory.map((n, i) => (
                  <li key={i} style={{ padding: '10px 0', borderBottom: '1px solid #eee', color: n.read ? '#888' : textColor, background: n.read ? '#fafafa' : '#fff' }}>
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

      {/* Example: Log Out button */}
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
        }}
      >
        Log Out
      </button>
    </div>
  );
}
