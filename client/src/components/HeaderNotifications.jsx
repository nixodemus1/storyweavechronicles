import React, { useState, useEffect, useRef } from "react";
import { stepColor } from "../utils/colorUtils";
import { ThemeContext } from "../themeContext";
const API_BASE_URL = import.meta.env.VITE_HOST_URL;

export default function HeaderNotifications({ user }) {
  const { theme, headerButtonColor, headerButtonTextColor } = React.useContext(ThemeContext);
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const prevNotifications = useRef([]);

  useEffect(() => {
    if (!user?.username) return;
    fetch(`${API_BASE_URL}/api/header-notifications?username=${user.username}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.notifications)) {
          if (JSON.stringify(data.notifications) !== JSON.stringify(prevNotifications.current)) {
            setNotifications(data.notifications);
            prevNotifications.current = data.notifications;
          }
        } else {
          if (notifications.length !== 0) setNotifications([]);
        }
      });
  }, [user?.username, notifications]);

  return (
    <div style={{ position: "relative" }}>
      <button
        style={{
          background: headerButtonColor,
          color: headerButtonTextColor,
          border: "none",
          borderRadius: "50%",
          width: 40,
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 600,
          fontSize: 22,
          cursor: "pointer",
          boxShadow: "0 1px 4px rgba(0,0,0,0.10)",
        }}
        onClick={() => setOpen(o => !o)}
        title="Notifications"
        aria-label="Notifications"
      >
        🔔
        {notifications.length > 0 && (
          <span style={{ position: "absolute", top: 4, right: 4, background: "red", color: "#fff", borderRadius: "50%", width: 16, height: 16, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{notifications.length}</span>
        )}
      </button>
      {open && (
        <div style={{ position: "absolute", top: 48, right: 0, background: headerButtonColor, color: headerButtonTextColor, minWidth: 240, boxShadow: "0 2px 8px rgba(0,0,0,0.15)", borderRadius: 8, zIndex: 100 }}>
          <div style={{ padding: 12, fontWeight: 700 }}>Notifications</div>
          {notifications.length === 0 ? (
            <div style={{ padding: 12, color: "#888" }}>No notifications</div>
          ) : (
            notifications.map((notif, idx) => (
              <div key={idx} style={{ padding: 12, borderBottom: "1px solid #eee" }}>
                {notif.message}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
