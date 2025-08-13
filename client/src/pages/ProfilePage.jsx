// Restore FONT_OPTIONS after BookmarksTab
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
  const [timezone, setTimezone] = useState(user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const { backgroundColor, textColor, setBackgroundColor, setTextColor, font, setFont } = useContext(ThemeContext);
  // Save color changes to backend for logged-in user
  React.useEffect(() => {
    if (!user?.username) return;
    fetch('/api/update-colors', {
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
    fetch('/api/update-profile-settings', {
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
    <div style={{ display: 'flex', minHeight: '80vh' }}>
      {/* Sidebar */}
      <aside style={{
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
      }}>
        {/* User avatar */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 18, width: '100%' }}>
          <img
            src={user?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.username || 'U')}&background=fff&color=23272f&size=64`}
            alt="User avatar"
            style={{ width: 48, height: 48, borderRadius: '50%', marginBottom: 6, border: `2px solid ${textColor}` }}
          />
          {sidebarExpanded && <div style={{ fontWeight: 600, fontSize: 16, color: textColor }}>{user?.username}</div>}
        </div>
        <button
          onClick={() => setSidebarExpanded(e => !e)}
          style={{ background: 'none', border: 'none', color: textColor, fontSize: 22, marginBottom: 18, cursor: 'pointer', alignSelf: sidebarExpanded ? 'flex-end' : 'center' }}
          title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >{sidebarExpanded ? '«' : '»'}</button>
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
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, padding: '32px 0 32px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', background: backgroundColor, color: textColor }}>
        {/* Bookmarks Tab */}
        {/* Account Tab: Bookmarks, comments, replies, top voted books */}
        {activeTab === "account" && (
          <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32 }}>
            <h3>Account Overview</h3>
            {/* Bookmarks */}
            <BookmarksTab user={user} />
            {/* TODO: Comments, replies, top voted books */}
            <div style={{ marginTop: 32, color: '#888', fontStyle: 'italic', fontSize: 15 }}>
              Comments, replies, and top voted books coming soon...
            </div>
          </div>
        )}

        {/* Notifications Tab */}
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
              {/* DEV ONLY: Remove this button before production! */}
              <button
                type="button"
                style={{ marginBottom: 12, padding: '6px 14px', borderRadius: 5, background: textColor, color: backgroundColor, border: `1px solid ${textColor}`, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
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
                  const res = await fetch('/api/add-secondary-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: user.username, email: newSecondaryEmail })
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
                        const res = await fetch('/api/remove-secondary-email', {
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
                  const res = await fetch('/api/change-password', {
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
                  const res = await fetch('/api/delete-account', {
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
