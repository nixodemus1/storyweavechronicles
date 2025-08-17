import React, { useContext, useState } from "react";
import { ThemeContext } from "../themeContext";
import { stepColor } from "../utils/colorUtils";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;

const NotificationsTabContent = React.memo(function NotificationsTabContent({ user, setUser }) {
  const { backgroundColor, textColor, theme } = useContext(ThemeContext);
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    if (!user?.username) return;
    setLoading(true);
    fetch(`${API_BASE_URL}/api/get-notification-prefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username })
    })
      .then(res => res.json())
      .then(data => {
        setPrefs(data.prefs || {});
        setLoading(false);
      });
  }, [user?.username]);

  const containerBg = stepColor(backgroundColor, theme, 1);

  function handleChange(e) {
    const { name, checked } = e.target;
    setPrefs(prev => ({ ...prev, [name]: checked }));
    setSaving(true);
    fetch(`${API_BASE_URL}/api/update-notification-prefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, [name]: checked })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setUser(u => u ? { ...u, notificationPrefs: { ...u.notificationPrefs, [name]: checked } } : u);
        }
      })
      .finally(() => setSaving(false));
  }

  return (
    <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, background: containerBg, borderRadius: 8, padding: '18px 16px' }}>
      <h3 style={{ color: textColor }}>Notification Preferences</h3>
      {loading ? (
        <div style={{ color: '#888' }}>Loading preferences...</div>
      ) : (
        <form style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              name="email"
              checked={!!prefs?.email}
              onChange={handleChange}
            />
            <span style={{ color: textColor }}>Email notifications</span>
          </label>
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
        setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
        setLoading(false);
      });
  }, [user?.username]);

  const containerBg = stepColor(backgroundColor, theme, 1);

  function handleDismiss(id) {
    setDeleting(id);
    fetch(`${API_BASE_URL}/api/delete-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, notificationId: id })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setNotifications(notifications => notifications.filter(n => n.id !== id));
        }
      })
      .finally(() => setDeleting(null));
  }

  return (
    <div style={{ width: 400, maxWidth: '95vw', marginBottom: 32, background: containerBg, borderRadius: 8, padding: '18px 16px' }}>
      <h3 style={{ color: textColor }}>Notification History</h3>
      {loading ? (
        <div style={{ color: '#888' }}>Loading notifications...</div>
      ) : notifications.length === 0 ? (
        <div style={{ color: '#888' }}>No notifications yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {notifications.map(n => (
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
                <div style={{ fontWeight: 600 }}>{n.title}</div>
                <div style={{ fontSize: 13, color: '#888' }}>{n.body}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{new Date(n.timestamp).toLocaleString()}</div>
              </div>
              <button
                onClick={() => handleDismiss(n.id)}
                disabled={deleting === n.id}
                style={{
                  background: '#eee',
                  color: '#c00',
                  border: 'none',
                  borderRadius: 4,
                  padding: '4px 10px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: deleting === n.id ? 0.6 : 1
                }}
                title="Delete notification from history"
              >
                {deleting === n.id ? 'Deleting...' : 'Delete'}
              </button>
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
