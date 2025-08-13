import React, { useEffect, useState, useContext } from "react";
import { useParams } from "react-router-dom";
import "../styles/PDFReader.css";
import { useTheme } from "../themeContext";
import { stepColor, getLuminance } from "../utils/colorUtils";
import { ThemeContext } from "../themeContext";

export default function PDFReader() {
  const { id } = useParams(); // expecting route like /read/:id
  const [pdfData, setPdfData] = useState(null);
  const [bookMeta, setBookMeta] = useState(null); // book metadata (title)
  const [currentPage, setCurrentPage] = useState(1);
  const { theme, textColor, backgroundColor } = useTheme();
  const { user, setUser } = useContext(ThemeContext);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [bookmarkMsg, setBookmarkMsg] = useState("");
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
    fetch(`/api/pdf-text/${id}`)
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
    fetch(`/list-pdfs/${folderId}`)
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
      fetch('/api/get-bookmarks', {
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
      fetch('/api/update-bookmark-meta', {
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

  // Book title (prefer metadata, fallback to pdfData or ID)
  const bookTitle = bookMeta?.name || pdfData?.title || pdfData?.name || `Book ${id}`;

  // Bookmark handlers
  const handleBookmark = async () => {
    if (!user || !user.username) {
      setBookmarkMsg("Please log in to bookmark.");
      return;
    }
    const res = await fetch('/api/add-bookmark', {
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
    const res = await fetch('/api/remove-bookmark', {
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
        {/* Voting system placeholder */}
        <div style={{ marginBottom: 10 }}>
          <span style={{ fontWeight: 500, marginRight: 8 }}>Your Rating:</span>
          {[1,2,3,4,5].map(star => (
            <span key={star} style={{ fontSize: 22, color: '#f5c518', cursor: 'pointer', opacity: 0.5 }} title="Voting coming soon">★</span>
          ))}
          <span style={{ marginLeft: 8, color: '#888', fontSize: 13 }}>(Voting coming soon)</span>
        </div>
        {/* Comments section placeholder */}
        <div style={{ marginTop: 18, color: '#888', fontStyle: 'italic', fontSize: 15 }}>
          Comments coming soon...
        </div>
      </div>
    </div>
  );
}
