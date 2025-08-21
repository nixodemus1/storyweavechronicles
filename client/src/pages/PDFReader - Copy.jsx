// Placeholder for renderComments and renderPagination in CommentsSection
// These should be implemented or imported as needed
import React, { useState, useEffect, useContext, useCallback } from "react";
import { useParams } from "react-router-dom";
import { stepColor } from "../utils/colorUtils";
import { ThemeContext } from "../themeContext";
import { SteppedContainer } from "../components/ContainerDepthContext.jsx";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;
const CACHE_LIMIT = 3; // Max number of books to cache


// Utility: Print localStorage usage and breakdown
function printLocalStorageUsage() {
  let totalBytes = 0;
  let breakdown = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = localStorage.getItem(key);
    const bytes = key.length + (value ? value.length : 0);
    totalBytes += bytes;
    // Try to classify
    let label = key;
    if (key === 'swc_cover_cache') label = 'covers';
    else if (key.startsWith('storyweave_book_')) label = `text for ${key.replace('storyweave_book_', '')}`;
    else if (key === 'swc_session_id') label = 'user session';
    else if (key === 'storyweave_book_cache_list') label = 'book cache list';
    else if (key.startsWith('user_')) label = 'user data';
    breakdown.push({ label, bytes });
  // Print summary
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  console.warn(`LocalStorage quota exceeded! Total storage: ${totalMB} MB`);
  breakdown.sort((a, b) => b.bytes - a.bytes);
  breakdown.forEach(item => {
    const mb = (item.bytes / (1024 * 1024)).toFixed(2);
    console.warn(`L ${item.label}: ${mb} MB`);
  });
}
}

function getBookCacheKey(id) {
  return `storyweave_book_${id}`;
}

function getCachedBooksList() {
  const raw = localStorage.getItem('storyweave_book_cache_list');
  return raw ? JSON.parse(raw) : [];
}


export default function PDFReader() {
  // All logic, state, hooks, and JSX from PDFReader.jsx go here
  // ...existing logic and state...
  // Error banner logic
  let errorBanner = null;
  if (pdfError && !errorDismissed) {
    errorBanner = (
      <div className="pdf-reader-error-banner" style={{ background: '#fff0f0', color: '#c00', border: '1px solid #c00', borderRadius: 8, padding: '16px 24px', margin: '24px auto', maxWidth: 900, textAlign: 'center', fontWeight: 600, fontSize: 18, boxShadow: '0 2px 8px rgba(200,0,0,0.04)' }}>
        <div>
          <div style={{ fontWeight: 400, fontSize: 15, color: '#a00', marginBottom: 8 }}>
            Some pages could not be loaded due to quota or backend error.<br />
            <span>You can still read the pages above and use comments.</span>
          </div>
          <button style={{ marginTop: 0, padding: '8px 20px', borderRadius: 6, border: '1px solid #bbb', background: '#fff', color: '#333', fontWeight: 600, cursor: 'pointer' }} onClick={() => window.location.reload()}>Retry</button>
          <button style={{ marginTop: 0, padding: '8px 20px', borderRadius: 6, border: '1px solid #bbb', background: '#fff', color: '#333', fontWeight: 600, cursor: 'pointer' }} onClick={() => setErrorDismissed(true)}>Dismiss</button>
        </div>
      </div>
    );
  }
  // ...rest of PDFReader logic, hooks, and JSX...
  return (
    <SteppedContainer step={0} style={{ minHeight: '100vh', background: baseBg, color: textColor }} className={`pdf-reader-container ${theme}-mode`}>
      {/* ...all JSX from previous return block... */}
    </SteppedContainer>
  );
}
    const loadedPages = pages.length;
    const totalPages = pageCount || (pages.length > 0 ? pages.length : null);
    let loadedSummary = '';
    if (totalPages) {
      loadedSummary = `Loaded ${loadedPages}/${totalPages} pages.`;
    } else {
      loadedSummary = `Loaded ${loadedPages} pages.`;
    }
    errorBanner = (
      <div className="pdf-reader-error-banner" style={{
        background: '#fff0f0',
        color: '#c00',
        border: '1px solid #c00',
        borderRadius: 8,
        padding: '16px 24px',
        margin: '24px auto',
        maxWidth: 900,
        textAlign: 'center',
        fontWeight: 600,
        fontSize: 18,
        boxShadow: '0 2px 8px rgba(200,0,0,0.04)'
      }}>
        <div style={{ marginBottom: 8 }}>⚠️ Error: {pdfError}</div>
        <div style={{ fontWeight: 400, fontSize: 15, color: '#a00', marginBottom: 8 }}>
          Some pages could not be loaded due to quota or backend error.<br />
          <span>You can still read the pages <b>above</b> and use comments.</span>
        </div>
        <div style={{ fontWeight: 500, fontSize: 15, color: '#222', marginBottom: 8 }}>{loadedSummary}</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
          <button style={{ marginTop: 0, padding: '8px 20px', borderRadius: 6, border: '1px solid #bbb', background: '#fff', color: '#333', fontWeight: 600, cursor: 'pointer' }} onClick={() => window.location.reload()}>Retry</button>
          <button style={{ marginTop: 0, padding: '8px 20px', borderRadius: 6, border: '1px solid #bbb', background: '#fff', color: '#333', fontWeight: 600, cursor: 'pointer' }} onClick={() => setErrorDismissed(true)}>Dismiss</button>
        </div>
      </div>
    );
  // Remove loadingBook check here, always allow navigation

  return (
    <SteppedContainer step={0} style={{ minHeight: '100vh', background: baseBg, color: textColor }} className={`pdf-reader-container ${theme}-mode`}>
      {loadingBook && (
        <div style={{ width: '100%', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#888', fontWeight: 600 }}>
          Loading book...
        </div>
      )}
      <header className="pdf-reader-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {/* Logo/title can be added here if needed for PDFReader */}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {/* Theme toggle or other header actions if needed */}
        </div>
      </header>

      {/* Top navigation */}
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
          Page {currentPage} / {Math.max(pageCount, pages.length)}
        </span>
        <button
          className="pdf-reader-btn"
          onClick={() => setCurrentPage(p => Math.min(Math.max(pageCount, pages.length), p + 1))}
          disabled={currentPage === Math.max(pageCount, pages.length)}
          style={{ background: navButtonBg, color: navButtonText, border: `1px solid ${navButtonText}`, borderRadius: 6, padding: '6px 16px', fontWeight: 600, cursor: currentPage === Math.max(pageCount, pages.length) ? 'not-allowed' : 'pointer', marginLeft: 8 }}
        >
          Next ▶
        </button>
        <span style={{ marginLeft: 16, fontSize: 15, color: '#888' }}>{pages.length > 0 ? `Loaded ${pages.length} / ${pageCount}` : ''}</span>
      </div>

      <SteppedContainer step={1} style={{ borderRadius: 8, padding: 32, margin: 16, background: pdfPageBg, maxWidth: 1100, marginLeft: 'auto', marginRight: 'auto' }} className="pdf-reader-page">
        {/* Show loading or page content */}
        {pageObj ? (
          <div key={pageObj.page}>
            {pageObj.images && pageObj.images.length > 0 && (
              <div className="pdf-reader-images" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                {pageObj.images.map((img, idx) => {
                  if (typeof img !== 'string') return null;
                  return (
                    <img
                      key={idx}
                      src={img.startsWith('data:') ? img : `${API_BASE_URL}/api/image-proxy?url=${encodeURIComponent(img)}`}
                      alt={`Page ${pageObj.page} Image ${idx + 1}`}
                      style={{ maxWidth: 320, maxHeight: 320, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                    />
                  );
                })}
              </div>
            )}
            {pageObj.text && (
              <div className="pdf-reader-text" style={{ width: '100%', wordBreak: 'break-word', whiteSpace: 'pre-line' }}>
                {renderPageText(pageObj)}
              </div>
            )}
            {/* Bottom navigation (added here) */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: 16 }}>
              <button
                className="pdf-reader-btn"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{
                  background: theme === 'dark' ? '#333' : navButtonBg,
                  color: theme === 'dark' ? '#f8f8ff' : navButtonText,
                  border: `1px solid ${theme === 'dark' ? '#888' : navButtonText}`,
                  borderRadius: 6,
                  padding: '6px 16px',
                  fontWeight: 600,
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  marginRight: 8,
                  boxShadow: theme === 'dark' ? '0 2px 8px #222' : '0 2px 8px #eee'
                }}
              >
                ◀ Prev
              </button>
              <span className="pdf-reader-page-indicator" style={{ fontWeight: 600, fontSize: 18, color: textColor }}>
                Page {currentPage} / {Math.max(pageCount, pages.length)}
              </span>
              <button
                className="pdf-reader-btn"
                onClick={() => setCurrentPage(p => Math.min(Math.max(pageCount, pages.length), p + 1))}
                disabled={currentPage === Math.max(pageCount, pages.length)}
                style={{
                  background: theme === 'dark' ? '#333' : navButtonBg,
                  color: theme === 'dark' ? '#f8f8ff' : navButtonText,
                  border: `1px solid ${theme === 'dark' ? '#888' : navButtonText}`,
                  borderRadius: 6,
                  padding: '6px 16px',
                  fontWeight: 600,
                  cursor: currentPage === Math.max(pageCount, pages.length) ? 'not-allowed' : 'pointer',
                  marginLeft: 8,
                  boxShadow: theme === 'dark' ? '0 2px 8px #222' : '0 2px 8px #eee'
                }}
              >
                Next ▶
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            width: '100%',
            minHeight: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#e0ffe0',
            color: '#080',
            borderRadius: 16,
            fontSize: 22,
            fontStyle: 'italic',
            boxShadow: '0 2px 16px rgba(0,0,0,0.10)'
          }}>
            Loading page {currentPage}...
          </div>
        )}
      </SteppedContainer>

      {/* Show error banner between text and comments if error occurs */}
      {errorBanner}

      <SteppedContainer step={2} style={{ margin: '0 auto', maxWidth: 900, borderRadius: 8, padding: 20, marginBottom: 32, marginTop: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', background: bookMetaBg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 22, color: textColor }}>{bookMeta?.title || `Book ${id}`}</span>
            {isBookmarked ? (
              <button
                onClick={handleUnbookmark}
                style={{
                  background: theme === 'dark' ? '#442' : '#ffe0e0',
                  color: theme === 'dark' ? '#f8f8ff' : '#c00',
                  border: `1px solid ${theme === 'dark' ? '#888' : '#c00'}`,
                  borderRadius: 6,
                  padding: '6px 16px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: theme === 'dark' ? '0 2px 8px #222' : '0 2px 8px #eee'
                }}
              >★ Unfavorite</button>
            ) : (
              <button
                onClick={handleBookmark}
                style={{
                  background: theme === 'dark' ? '#225' : '#e0f7ff',
                  color: theme === 'dark' ? '#f8f8ff' : '#0070f3',
                  border: `1px solid ${theme === 'dark' ? '#888' : '#0070f3'}`,
                  borderRadius: 6,
                  padding: '6px 16px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: theme === 'dark' ? '0 2px 8px #222' : '0 2px 8px #eee'
                }}
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
          {/* Pass all required props explicitly to CommentsSection */}
          <CommentsSection
            bookId={id}
            commentsRefresh={commentsRefresh}
            user={user}
            commentsPageFromQuery={commentsPageFromQuery}
            setCommentsRefresh={setCommentsRefresh}
            commentToScroll={commentToScroll}
            backgroundColor={backgroundColor}
            theme={theme}
            textColor={textColor}
            API_BASE_URL={API_BASE_URL}
          />
        </SteppedContainer>
      </SteppedContainer>
    </SteppedContainer>
  );
}