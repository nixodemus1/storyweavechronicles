import React, { useContext, useState } from "react";
import { ThemeContext } from "../themeContext";
import { stepColor } from "../utils/colorUtils";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;

const NotificationsTabContent = React.memo(function NotificationsTabContent({ user, setUser }) {

  const { backgroundColor, textColor, theme } = useContext(ThemeContext);
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);
  const [emailChannels, setEmailChannels] = useState([]);
  const [loading, setLoading] = useState(true);

  // Email channel setup and load notification prefs
  React.useEffect(() => {
    if (!user?.username) return;
    setLoading(true);
    const emails = [];
    if (user?.email) emails.push({ label: 'Primary', value: user.email });
    if (Array.isArray(user?.secondaryEmails)) {
      user.secondaryEmails.forEach((e, i) => emails.push({ label: `Secondary ${i+1}`, value: e }));
    }
    setEmailChannels(emails);
    // Fetch notification prefs
    fetch(`${API_BASE_URL}/api/get-notification-prefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.prefs) {
          setPrefs(data.prefs);
        }
      })
      .finally(() => setLoading(false));
  }, [user?.username, user?.email, user?.secondaryEmails]);

  const containerBg = stepColor(backgroundColor, theme, 1);

  function handleChange(e) {
    const { name, checked, value, type } = e.target;
    if (type === 'checkbox' && name.startsWith('emailChannel_')) {
      // Email channel selection
      const email = value;
      setPrefs(prev => {
        const selected = prev.emailChannels || [];
        let updated;
        if (checked) {
          updated = [...selected, email];
        } else {
          updated = selected.filter(e => e !== email);
        }
        return { ...prev, emailChannels: updated };
      });
      setSaving(true);
      fetch(`${API_BASE_URL}/api/update-notification-prefs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, prefs: { ...prefs, emailChannels: checked ? [...(prefs.emailChannels || []), email] : (prefs.emailChannels || []).filter(e => e !== email) } })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setUser(u => u ? { ...u, notificationPrefs: { ...u.notificationPrefs, emailChannels: checked ? [...(prefs.emailChannels || []), email] : (prefs.emailChannels || []).filter(e => e !== email) } } : u);
          }
        })
        .finally(() => setSaving(false));
    } else {
      setPrefs(prev => ({ ...prev, [name]: checked }));
      setSaving(true);
      fetch(`${API_BASE_URL}/api/update-notification-prefs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, prefs: { ...prefs, [name]: checked } })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setUser(u => u ? { ...u, notificationPrefs: { ...u.notificationPrefs, [name]: checked } } : u);
          }
        })
        .finally(() => setSaving(false));
    }
  }

  return (
    <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, background: containerBg, borderRadius: 8, padding: '18px 16px' }}>
      <h3 style={{ color: textColor }}>Notification Preferences</h3>
      {loading ? (
        <div style={{ color: '#888' }}>Loading preferences...</div>
      ) : (
        <form style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Email frequency dropdown */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: textColor, minWidth: 120 }}>Email frequency:</span>
            <select
              name="emailFrequency"
              value={prefs?.emailFrequency || 'immediate'}
              onChange={e => {
                const value = e.target.value;
                setPrefs(prev => ({ ...prev, emailFrequency: value }));
                setSaving(true);
                fetch(`${API_BASE_URL}/api/update-notification-prefs`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ username: user.username, prefs: { ...prefs, emailFrequency: value } })
                })
                  .then(res => res.json())
                  .then(data => {
                    if (data.success) {
                      setUser(u => u ? { ...u, notificationPrefs: { ...u.notificationPrefs, emailFrequency: value } } : u);
                    }
                  })
                  .finally(() => setSaving(false));
              }}
              style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', fontSize: 15 }}
            >
              <option value="immediate">Immediate</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          {/* Channel selection */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              name="email"
              checked={!!prefs?.email}
              onChange={handleChange}
            />
            <span style={{ color: textColor }}>Email notifications</span>
          </label>
          {prefs?.email && emailChannels.length > 0 && (
            <div style={{ marginLeft: 24, marginTop: 2, marginBottom: 8 }}>
              <div style={{ color: textColor, fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Send to:</div>
              {emailChannels.map((e, idx) => (
                <label key={e.value} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <input
                    type="checkbox"
                    name={`emailChannel_${idx}`}
                    value={e.value}
                    checked={Array.isArray(prefs?.emailChannels) ? prefs.emailChannels.includes(e.value) : false}
                    onChange={handleChange}
                  />
                  <span style={{ color: textColor }}>{e.label}: {e.value}</span>
                </label>
              ))}
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              name="push"
              checked={!!prefs?.push}
              onChange={handleChange}
            />
            <span style={{ color: textColor }}>Push notifications</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              name="newsletter"
              checked={!!prefs?.newsletter}
              onChange={handleChange}
            />
            <span style={{ color: textColor }}>Newsletter</span>
          </label>
          {/* Notification type opt-in/out */}
          <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid #ddd' }} />
          <div style={{ fontWeight: 500, color: textColor, marginBottom: 4 }}>Notification Types</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              name="siteUpdates"
              checked={!!prefs?.siteUpdates}
              onChange={handleChange}
            />
            <span style={{ color: textColor }}>Site updates (global)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              name="newBook"
              checked={!!prefs?.newBook}
              onChange={handleChange}
            />
            <span style={{ color: textColor }}>New book announcements (global)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              name="bookmarkUpdates"
              checked={!!prefs?.bookmarkUpdates}
              onChange={handleChange}
            />
            <span style={{ color: textColor }}>Book updates from bookmarks</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              name="replyNotifications"
              checked={!!prefs?.replyNotifications}
              onChange={handleChange}
            />
            <span style={{ color: textColor }}>Replies to your comments</span>
          </label>
        </form>
      )}
      <div style={{ color: '#888', fontSize: 13, marginTop: 8 }}>
        {saving ? 'Saving changes...' : 'Changes are saved instantly.'}
      </div>
    </div>
  );
});

const NotificationHistoryTab = React.memo(function NotificationHistoryTab({ user }) {
  const { backgroundColor, textColor, theme } = useContext(ThemeContext);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [filterDate, setFilterDate] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);

  React.useEffect(() => {
    if (!user?.username) return;
    setLoading(true);
    fetch(`${API_BASE_URL}/api/get-notification-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username })
    })
      .then(res => res.json())
      .then(data => {
        setNotifications(Array.isArray(data.history) ? data.history : []);
        setLoading(false);
      });
  }, [user?.username]);

  const containerBg = stepColor(backgroundColor, theme, 1);

  async function handleDismiss(id) {
    setDeleting(id);
    try {
    const res = await fetch(`${API_BASE_URL}/api/delete-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, notificationId: id })
    })
      const data = await res.json();
      if (data.success) {
        // Refetch notifications after deletion
        const updatedRes = await fetch(`${API_BASE_URL}/api/get-notification-history`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user.username })
        });
        const updatedData = await updatedRes.json();
        setNotifications(Array.isArray(updatedData.history) ? updatedData.history : []);
      }
    } catch (e) {
      console.log('Error deleting notification:', e);
    }
    setDeleting(null);
  }

  function handleMarkRead(id, read) {
    fetch(`${API_BASE_URL}/api/mark-notification-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, notificationId: id, read })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setNotifications(notifications => notifications.map(n => n.id === id ? { ...n, read } : n));
        }
      });
  }

  function handleBulkDelete() {
    setBulkLoading(true);
    fetch(`${API_BASE_URL}/api/delete-all-notification-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          // Refetch notification history to update state
          fetch(`${API_BASE_URL}/api/get-notification-history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user.username })
          })
            .then(res => res.json())
            .then(data => {
              setNotifications(Array.isArray(data.history) ? data.history : []);
            });
        }
      })
      .finally(() => setBulkLoading(false));
  }

  function handleBulkMarkRead() {
    setBulkLoading(true);
    fetch(`${API_BASE_URL}/api/mark-all-notifications-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setNotifications(notifications => notifications.map(n => ({ ...n, read: true })));
        }
      })
      .finally(() => setBulkLoading(false));
  }

  // Filtering logic
  const filteredNotifications = notifications.filter(n => {
    let typeMatch = filterType === 'all' || n.type === filterType;
    let dateMatch = true;
    if (filterDate) {
      const notifDate = new Date(n.timestamp).toISOString().slice(0, 10);
      dateMatch = notifDate === filterDate;
    }
    return typeMatch && dateMatch;
  });

  // Unique types for dropdown
  const notificationTypes = Array.from(new Set(notifications.map(n => n.type))).filter(Boolean);

  return (
    <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, background: containerBg, borderRadius: 8, padding: '18px 16px' }}>
      <h3 style={{ color: textColor }}>Notification History</h3>
      {/* Filter controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <label style={{ color: textColor, fontSize: 14 }}>
          Type:
          <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 4 }}>
            <option value="all">All</option>
            {notificationTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <label style={{ color: textColor, fontSize: 14 }}>
          Date:
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 4 }} />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleBulkDelete} disabled={bulkLoading || filteredNotifications.length === 0} style={{ background: '#eee', color: '#c00', border: 'none', borderRadius: 4, padding: '4px 10px', fontWeight: 600, cursor: 'pointer' }}>Delete All</button>
          <button onClick={handleBulkMarkRead} disabled={bulkLoading || filteredNotifications.length === 0} style={{ background: '#eee', color: '#080', border: 'none', borderRadius: 4, padding: '4px 10px', fontWeight: 600, cursor: 'pointer' }}>Mark All as Read</button>
        </div>
      </div>
      {loading ? (
        <div style={{ color: '#888' }}>Loading notifications...</div>
      ) : filteredNotifications.length === 0 ? (
        <div style={{ color: '#888' }}>No notifications yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {filteredNotifications.map(n => (
            <li key={n.id} style={{
              marginBottom: 12,
              background: stepColor(containerBg, 'dark', n.read ? 1 : 0, 1),
              color: textColor,
              borderRadius: 6,
              padding: '8px 12px',
              boxShadow: n.read ? '0 0 4px #aaa' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10
            }}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {n.link ? (
                    <a
                      href={n.link}
                      style={{ color: textColor, textDecoration: 'underline', cursor: 'pointer' }}
                      onClick={async e => {
                        e.preventDefault();
                        // Mark as read if not already
                        if (!n.read) {
                          await fetch(`${API_BASE_URL}/api/mark-notification-read`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username: user.username, notificationId: n.id, read: true })
                          });
                        }
                        // Mark as dismissed so it disappears from dropdown, but do NOT delete from history
                        await fetch(`${API_BASE_URL}/api/dismiss-notification`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ username: user.username, notificationId: n.id })
                        });
                        setNotifications(notifications => notifications.map(notif => notif.id === n.id ? { ...notif, read: true, dismissed: true } : notif));
                        window.location.href = n.link;
                      }}
                    >
                      {n.title}
                    </a>
                  ) : (
                    n.title
                  )}
                </div>
                <div style={{ fontSize: 13, color: '#888' }}>{n.body}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{new Date(n.timestamp).toLocaleString()}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => handleMarkRead(n.id, !n.read)}
                  style={{ background: n.read ? '#eee' : '#ffe0e0', color: n.read ? '#080' : '#c00', border: 'none', borderRadius: 4, padding: '4px 10px', fontWeight: 600, cursor: 'pointer' }}
                  title={n.read ? 'Mark as Unread' : 'Mark as Read'}
                >{n.read ? 'Mark Unread' : 'Mark Read'}</button>
                <button
                  onClick={() => handleDismiss(n.id)}
                  disabled={deleting === n.id}
                  style={{ background: '#eee', color: '#c00', border: 'none', borderRadius: 4, padding: '4px 10px', fontWeight: 600, cursor: 'pointer', opacity: deleting === n.id ? 0.6 : 1 }}
                  title="Delete notification from history"
                >{deleting === n.id ? 'Deleting...' : 'Delete'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

const NotificationsTab = React.memo(function NotificationsTab({ user, setUser }) {
  return (
    <>
      <NotificationsTabContent user={user} setUser={setUser} />
      <NotificationHistoryTab user={user} />
    </>
  );
});

export default NotificationsTab;
