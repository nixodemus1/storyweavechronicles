import { stepColor } from "../utils/colorUtils";
import React, { useEffect, useState, useContext, useRef } from "react";
import { useLocation } from "react-router-dom";
import "../styles/LandingPage.css";
import Slider from "react-slick";
import { useNavigate } from "react-router-dom";
import { ThemeContext } from "../themeContext";
import { ContainerDepthProvider, SteppedContainer } from "../components/ContainerDepthContext";
import { waitForServerHealth } from "../utils/serviceHealth";
import AdBanner300x250 from "../components/AdBanner300x250";
import AdNativeBanner from "../components/AdNativeBanner";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;

// useCoverLoadState: tracks per-cover image load state
// useCoverLoadState: tracks per-cover image load and loading state
function useCoverLoadState() {
  const [loaded, setLoaded] = React.useState({});
  const [loading, setLoading] = React.useState({});
  const [errorCount, setErrorCount] = React.useState({});

  // Call when starting to load a cover
  const startLoading = (bookId) => {
    setLoading(prev => ({ ...prev, [bookId]: true }));
    setLoaded(prev => ({ ...prev, [bookId]: false }));
    setErrorCount(prev => ({ ...prev, [bookId]: 0 }));
  };
  // Call when cover loads successfully
  const handleCoverLoad = (bookId) => {
    setLoaded(prev => ({ ...prev, [bookId]: true }));
    setLoading(prev => ({ ...prev, [bookId]: false }));
    setErrorCount(prev => ({ ...prev, [bookId]: 0 }));
  };
  // Call when cover fails to load
  const handleCoverError = (bookId) => {
    setLoaded(prev => ({ ...prev, [bookId]: false }));
    setLoading(prev => ({ ...prev, [bookId]: false }));
    setErrorCount(prev => ({ ...prev, [bookId]: (prev[bookId] || 0) + 1 }));
  };
  // Reset loading state for retry
  const resetLoading = (bookId) => {
    setLoaded(prev => ({ ...prev, [bookId]: false }));
    setLoading(prev => ({ ...prev, [bookId]: false }));
    setErrorCount(prev => ({ ...prev, [bookId]: 0 }));
  };

  return { loaded, loading, errorCount, startLoading, handleCoverLoad, handleCoverError, resetLoading };
}

function SearchBar({ pdfs, navigate }) {
  const [searchInput, setSearchInput] = useState("");
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteResults, setAutocompleteResults] = useState([]);
  const containerRef = React.useRef(null);
  const { theme, backgroundColor, textColor } = useContext(ThemeContext);

  useEffect(() => {
    if (!searchInput.trim()) {
      setAutocompleteResults([]);
      return;
    }
    const q = searchInput.toLowerCase();
    const results = pdfs.filter(pdf => {
      const titleMatch = pdf.title && (
        pdf.title.toLowerCase().includes(q) ||
        pdf.title.toLowerCase().startsWith(q)
      );
      const extIdMatch = pdf.external_story_id && (
        pdf.external_story_id.toLowerCase().includes(q) ||
        pdf.external_story_id.toLowerCase().startsWith(q)
      );
      return titleMatch || extIdMatch;
    });
    setAutocompleteResults(results.slice(0, 8));
  }, [searchInput, pdfs]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!searchInput.trim()) return;
    const q = searchInput.toLowerCase();
    // Build autocomplete results (same logic as in useEffect)
    const autocompleteResults = pdfs.filter(pdf => {
      const titleMatch = pdf.title && (
        pdf.title.toLowerCase().includes(q) ||
        pdf.title.toLowerCase().startsWith(q)
      );
      const extIdMatch = pdf.external_story_id && (
        pdf.external_story_id.toLowerCase().includes(q) ||
        pdf.external_story_id.toLowerCase().startsWith(q)
      );
      return titleMatch || extIdMatch;
    });
    // If only one autocomplete result, go directly to book
    if (autocompleteResults.length === 1) {
      navigate(`/read/${autocompleteResults[0].drive_id}`);
      return;
    }
    // If multiple results, go to search page
    navigate(`/search?query=${encodeURIComponent(searchInput)}`);
  };

  const handleAutocompleteClick = (pdf) => {
    setSearchInput("");
    setShowAutocomplete(false);
    navigate(`/read/${pdf.drive_id}`);
  };

  const handleBlur = () => {
    setTimeout(() => setShowAutocomplete(false), 120);
  };

  return (
  <SteppedContainer depth={0} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: 32, marginTop: 32, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', position: 'relative', background: stepColor(backgroundColor, theme, 0) }} ref={containerRef}>
      <form onSubmit={handleSearchSubmit} autoComplete="off" style={{ width: '100%', maxWidth: 400, display: 'flex', justifyContent: 'center' }}>
          <input
            type="text"
            className="searchbar-input"
            placeholder="Search books by title..."
            value={searchInput}
            onChange={e => {
              setSearchInput(e.target.value);
              setShowAutocomplete(true);
            }}
            onFocus={() => setShowAutocomplete(true)}
            onBlur={handleBlur}
            style={{
              width: 340,
              maxWidth: '90vw',
              padding: '10px 14px',
              borderRadius: 6,
              fontSize: 18,
              border: '1.5px solid #bbb',
              background: stepColor(backgroundColor, theme, 0), // base background color
              color: textColor,
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
            }}
          />
      </form>
      {showAutocomplete && autocompleteResults.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 340,
          border: `1px solid #bbb`,
          borderRadius: 6,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          maxHeight: 320,
          overflowY: 'auto',
          marginTop: 2,
          zIndex: 20,
          background: stepColor(backgroundColor, theme, 1),
          color: textColor,
        }}>
          {autocompleteResults.map(pdf => (
            <div
              key={pdf.id}
              className="autocomplete-item"
              style={{
                padding: '10px 16px',
                cursor: 'pointer',
                borderBottom: '1px solid #eee',
                fontSize: 17
              }}
              onMouseDown={e => e.preventDefault()}
              onClick={() => handleAutocompleteClick(pdf)}
            >
              {/* Only show title, no cover icon */}
              {pdf.title}
            </div>
          ))}
        </div>
      )}
    </SteppedContainer>
  );
}

function CarouselSection({
  pdfs,
  navigate,
  settings,
  depth = 1,
  loaded,
  loading,
  startLoading,
  handleCoverLoad,
  handleCoverError
}) {
  const pdfs20 = React.useMemo(() => pdfs.slice(0, 20), [pdfs]);

  // Hybrid fix: Set width inline on .carousel-item for mobile, let Slick measure
  const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 700px)').matches;
  const itemStyle = isMobile
    ? { cursor: 'pointer', borderRadius: 8, width: 64, minWidth: 64, maxWidth: 64 }
    : { cursor: 'pointer', borderRadius: 8, width: 110, minWidth: 110, maxWidth: 110 };
  const titleStyle = { fontSize: '0.95rem', marginTop: '0.3rem', padding: '0.15em 0.3em', borderRadius: 4 };

  // Always render carousel with live progress, even while covers are downloading

  // Progress indicator: X/Y covers loaded (only count covers that are actually loaded and not failed)
  const totalCovers = pdfs20.length;
  const loadedCount = pdfs20.filter(pdf => {
    const bookId = pdf.drive_id;
    return loaded[bookId] && pdf.cover_url && pdf.cover_url !== '/no-cover.png';
  }).length;

  return (
    <SteppedContainer depth={depth} style={{ marginBottom: 32 }}>
      <div style={{ textAlign: 'center', color: '#888', marginBottom: 8, fontSize: 15 }}>
        {`Covers loaded: ${loadedCount} / ${totalCovers}`}
      </div>
      <div className="carousel-container">
        <Slider {...settings}
          beforeChange={() => { window._carouselDragged = false; }}
          afterChange={() => { window._carouselDragged = false; }}
        >
          {pdfs20
            .filter(pdf => pdf && pdf.title)
            .map((pdf) => {
              const bookId = pdf.drive_id;
              // Determine loading state for this book
              // If cover_url is '/no-cover.png', treat as still loading until backend updates cover_url
              if (pdf.cover_url === '/no-cover.png') {
                if (!loading[bookId]) startLoading(bookId);
              }
              // If errorCount >= 2, show permanent fallback
              // Actually, use errorCount from props if available
              const coverErrorCount = (typeof loaded === 'object' && loaded.errorCount && loaded.errorCount[bookId]) || 0;
              return (
                <SteppedContainer depth={depth + 1} key={bookId || Math.random()} className="carousel-item" style={itemStyle}>
                  {bookId ? (
                    pdf.missing
                      ? <div className="book-cover book-missing">Missing Book</div>
                      : pdf.cover_url === '/no-cover.png'
                        ? (coverErrorCount >= 2
                            ? (() => { console.log(`[CarouselSection] Rendering NO-COVER SVG for bookId: ${bookId}`); return <img className="book-cover book-nocover" src="/no-cover.svg" alt="No Cover" /> })()
                            : (() => { console.log(`[CarouselSection] Rendering LOADING SVG for bookId: ${bookId}`); return <img className="book-cover book-loading" src="/loading-cover.svg" alt="Loading Cover" /> })()
                          )
                        : pdf.cover_url
                          ? <div style={{ position: 'relative' }}>
                              <img
                                src={pdf.cover_url}
                                alt={pdf.title}
                                className="book-cover"
                                style={{ opacity: loaded[bookId] ? 1 : 0 }}
                                onLoad={() => handleCoverLoad(bookId)}
                                onError={e => {
                                  handleCoverError(bookId);
                                  console.error(`[LandingPage] Error loading cover image for book ${bookId}:`, e);
                                }}
                              />
                              {!loaded[bookId] && loading[bookId] && (
                                (() => { console.log(`[CarouselSection] Rendering LOADING SVG overlay for bookId: ${bookId}`); return <img className="book-cover book-loading" src="/loading-cover.svg" alt="Loading Cover" style={{ position: 'absolute', top: 0, left: 0 }} /> })()
                              )}
                            </div>
                          : (() => { console.log(`[CarouselSection] Rendering LOADING SVG (no cover_url) for bookId: ${bookId}`); return <img className="book-cover book-loading" src="/loading-cover.svg" alt="Loading Cover" /> })()
                  ) : (
                    <span style={{ color: '#c00', fontSize: 12 }}>[No valid book id]</span>
                  )}
                  <SteppedContainer depth={depth + 2} className="book-title" style={{ ...titleStyle, background: undefined }}>
                    <button
                      style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 'inherit' }}
                      onClick={() => {
                        if (!window._carouselDragged && bookId) navigate(`/read/${bookId}`);
                      }}
                      tabIndex={-1}
                      inert={false}
                    >
                      {pdf.title}
                    </button>
                  </SteppedContainer>
                </SteppedContainer>
              );
            })}
        </Slider>
      </div>
    </SteppedContainer>
  );
}

function TopListsSection({
  topNewest,
  topVoted,
  navigate,
  depth = 1,
  loadedNewest,
  loadingNewest,
  startLoadingNewest,
  handleLoadNewest,
  handleErrorNewest,
  loadedVoted,
  loadingVoted,
  startLoadingVoted,
  handleLoadVoted,
  handleErrorVoted,
  textColor
}) {
  // All state and handlers are now passed as props from parent

  // Always render top lists with live progress, even while covers are downloading

  // Progress indicator for newest and voted (only count covers that are actually loaded and not failed)
  const totalNewest = topNewest.length;
  const loadedCountNewest = topNewest.filter(pdf => {
    const bookId = pdf.drive_id;
    return loadedNewest[bookId] && pdf.cover_url && pdf.cover_url !== '/no-cover.png';
  }).length;
  const totalVoted = topVoted.length;
  const loadedCountVoted = topVoted.filter(pdf => {
    const bookId = pdf.drive_id;
    return loadedVoted[bookId] && pdf.cover_url && pdf.cover_url !== '/no-cover.png';
  }).length;

  return (
    <SteppedContainer depth={depth} className="landing-description" style={{ marginBottom: 32 }}>
      <p>Explore our collection of books and start reading today!</p>
      <div style={{ textAlign: 'center', color: '#888', marginBottom: 8, fontSize: 15 }}>
        {`Newest covers loaded: ${loadedCountNewest} / ${totalNewest} | Voted covers loaded: ${loadedCountVoted} / ${totalVoted}`}
      </div>
      <div className="top-lists-container">
        <SteppedContainer depth={depth + 1} className="top-list" style={{ marginBottom: 16 }}>
          <h3 style={{ color: textColor }}>Top 10 Newest</h3>
          <ol>
            {topNewest.map((pdf) => {
              const bookId = pdf.drive_id;
              if (pdf.cover_url === '/no-cover.png') {
                if (!loadingNewest[bookId]) startLoadingNewest(bookId);
              }
              const coverErrorCount = (typeof loadedNewest === 'object' && loadedNewest.errorCount && loadedNewest.errorCount[bookId]) || 0;
                // PATCH: Never render COVER with opacity 0. If not loaded, show spinner or fallback.
                return (
                  <li key={bookId || Math.random()} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {bookId ? (
                      pdf.cover_url === '/no-cover.png'
                        ? (coverErrorCount >= 2
                            ? (() => { console.log(`[TopListsSection] Rendering NO-COVER SVG for bookId: ${bookId}`); return <img className="book-cover book-nocover" src="/no-cover.svg" alt="No Cover" /> })()
                            : (() => { console.log(`[TopListsSection] Rendering LOADING SVG for bookId: ${bookId}`); return <img className="book-cover book-loading" src="/loading-cover.svg" alt="Loading Cover" /> })()
                          )
                        : pdf.cover_url
                          ? loadedNewest[bookId]
                            ? (() => { console.log(`[TopListsSection] Rendering COVER for bookId: ${bookId}`); return <img src={pdf.cover_url} alt={pdf.title} className="book-cover" style={{ opacity: 1 }} onLoad={() => handleLoadNewest(bookId)} onError={e => { handleErrorNewest(bookId); console.error(`[LandingPage] Error loading cover image for book ${bookId}:`, e); }} /> })()
                            : (() => {
                                // Instead of opacity 0, show spinner overlay or fallback
                                console.log(`[TopListsSection] Rendering LOADING SVG overlay for bookId: ${bookId}`);
                                return (
                                  <div style={{ position: 'relative' }}>
                                    <img src={pdf.cover_url} alt={pdf.title} className="book-cover" style={{ opacity: 0.3 }} onLoad={() => handleLoadNewest(bookId)} onError={e => { handleErrorNewest(bookId); console.error(`[LandingPage] Error loading cover image for book ${bookId}:`, e); }} />
                                    <img className="book-cover book-loading" src="/loading-cover.svg" alt="Loading Cover" style={{ position: 'absolute', top: 0, left: 0 }} />
                                  </div>
                                );
                              })()
                          : (() => { console.log(`[TopListsSection] Rendering LOADING SVG (no cover_url) for bookId: ${bookId}`); return <img className="book-cover book-loading" src="/loading-cover.svg" alt="Loading Cover" /> })()
                    ) : (
                      <span style={{ color: '#c00', fontSize: 12 }}>[No valid book id]</span>
                    )}
                    <SteppedContainer depth={depth + 2} style={{ display: 'inline-block', borderRadius: 4, background: undefined }}>
                      <button
                        className="top-list-link"
                        style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer' }}
                        onClick={() => bookId && navigate(`/read/${bookId}`)}
                      >
                        {pdf.title}
                      </button>
                    </SteppedContainer>
                  </li>
                );
            })}
          </ol>
        </SteppedContainer>
        <SteppedContainer depth={depth + 1} className="top-list">
          <h3 style={{ color: textColor }}>Top 10 by Votes</h3>
          <ol>
            {topVoted.map((pdf) => {
              const bookId = pdf.drive_id;
                  // Determine loading state for this book
                  if (pdf.cover_url === '/no-cover.png') {
                    if (!loadingVoted[bookId]) startLoadingVoted(bookId);
                  }
                  // If errorCount >= 2, show permanent fallback
                  const coverErrorCount = (typeof loadedVoted === 'object' && loadedVoted.errorCount && loadedVoted.errorCount[bookId]) || 0;
                  return (
                    <li key={bookId || Math.random()} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {bookId ? (
                        pdf.cover_url === '/no-cover.png'
                          ? (coverErrorCount >= 2
                              ? (() => { console.log(`[TopListsSection] Rendering NO-COVER SVG for bookId: ${bookId}`); return <img className="book-cover book-nocover" src="/no-cover.svg" alt="No Cover" /> })()
                              : (() => { console.log(`[TopListsSection] Rendering LOADING SVG for bookId: ${bookId}`); return <img className="book-cover book-loading" src="/loading-cover.svg" alt="Loading Cover" /> })()
                            )
                          : pdf.cover_url
                            ? <div style={{ position: 'relative' }}>
                                <img
                                  src={pdf.cover_url}
                                  alt={pdf.title}
                                  className="book-cover"
                                  style={{ opacity: loadedVoted[bookId] ? 1 : 0 }}
                                  onLoad={() => handleLoadVoted(bookId)}
                                  onError={e => {
                                    handleErrorVoted(bookId);
                                    console.error(`[LandingPage] Error loading cover image for book ${bookId}:`, e);
                                  }}
                                />
                                {!loadedVoted[bookId] && loadingVoted[bookId] && (
                                  (() => { console.log(`[TopListsSection] Rendering LOADING SVG overlay for bookId: ${bookId}`); return <img className="book-cover book-loading" src="/loading-cover.svg" alt="Loading Cover" style={{ position: 'absolute', top: 0, left: 0 }} /> })()
                                )}
                              </div>
                            : (() => { console.log(`[TopListsSection] Rendering LOADING SVG (no cover_url) for bookId: ${bookId}`); return <img className="book-cover book-loading" src="/loading-cover.svg" alt="Loading Cover" /> })()
                      ) : (
                        <span style={{ color: '#c00', fontSize: 12 }}>[No valid book id]</span>
                      )}
                      <SteppedContainer depth={depth + 2} style={{ display: 'inline-block', borderRadius: 4 }}>
                        <button
                          className="top-list-link"
                          style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer' }}
                          onClick={() => bookId && navigate(`/read/${bookId}`)}
                        >
                          {pdf.title}
                        </button>
                      </SteppedContainer>
                    </li>
                  );
            })}
          </ol>
        </SteppedContainer>
      </div>
    </SteppedContainer>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const { theme, backgroundColor: _backgroundColor, textColor, user } = useContext(ThemeContext);

  // Cancel cover queue session ONLY on route change (true navigation away)
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);
  useEffect(() => {
    prevPathRef.current = location.pathname;
    return () => {
      if (prevPathRef.current !== location.pathname) {
        const sessionId = user?.session_id || localStorage.getItem('session_id');
        if (sessionId) {
          fetch(`${API_BASE_URL}/api/cancel-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, type: 'cover' })
          });
        }
      }
    };
  }, [location.pathname, user]);


  const [pdfs, setPdfs] = useState([]);
  const [topNewest, setTopNewest] = useState([]);
  const [topVoted, setTopVoted] = useState([]);
  const [loadingPdfs] = useState(false);
  // coversReady removed: we no longer poll for cover status

  const settings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 9,
    slidesToScroll: 1,
    swipeToSlide: true,
    centerMode: true,
    variableWidth: false,
    responsive: [
      // Mobile: 1 book per slide
      { breakpoint: 700, settings: { slidesToShow: 1, slidesToScroll: 1, infinite: true, centerMode: false, variableWidth: true } },
    ],
  };

  // Centralized cover sync effect: fetch book lists and trigger backend cover downloads ONCE
  // Track covers currently waiting for backend response to avoid duplicate requests
  const coversWaitingRef = useRef(new Set());

  useEffect(() => {
    let allBookIds = [];
    let isMounted = true;
    const fetchAllBookData = async () => {
      await waitForServerHealth();
      const res = await fetch(`${API_BASE_URL}/api/all-books`);
      const dataAll = await res.json();
      if (Array.isArray(dataAll.books)) {
        const newestBooks = dataAll.books.slice(0, 20).map(b => ({ ...b, drive_id: b.drive_id || b.id }));
        if (isMounted) {
          setPdfs(newestBooks);
          setTopNewest(newestBooks.slice(0, 10));
        }
        allBookIds = newestBooks.map(b => b.drive_id);
      }
      await waitForServerHealth();
      const resVoted = await fetch(`${API_BASE_URL}/api/top-voted-books`);
      const dataVoted = await resVoted.json();
      if (dataVoted.success && Array.isArray(dataVoted.books)) {
        const votedBooks = dataVoted.books.map(b => ({ ...b, drive_id: b.drive_id || b.id })).filter(b => b.drive_id);
        if (isMounted) {
          setTopVoted(votedBooks.slice(0, 10));
        }
        const votedIds = votedBooks.map(b => b.drive_id);
        allBookIds = Array.from(new Set([...allBookIds, ...votedIds]));
      }
      // For each book, check if cover exists on disk
      if (allBookIds.length === 0) return;
      await waitForServerHealth();
      // Check each cover individually
      const missingIds = [];
      for (const bookId of allBookIds) {
        try {
          const resp = await fetch(`${API_BASE_URL}/api/cover-exists/${encodeURIComponent(bookId)}`);
          const data = await resp.json();
          if (!data.exists) {
            missingIds.push(bookId);
          }
        } catch (err) {
          // If error, assume missing
          missingIds.push(bookId);
          console.log(`[LandingPage] Assuming the cover is missing., ignore the following error:`);
          console.log(`[LandingPage] Error checking cover for book ${bookId}:`, err);
        }
      }
      // For missing covers, request backend to generate (long-poll)
      if (missingIds.length > 0) {
        const sessionId = user?.session_id || localStorage.getItem('session_id');
        for (const bookId of missingIds) {
          // Set cover_url to loading-cover.svg immediately so spinner is shown and auto-refresh works
          const loadingCoverUrl = `${API_BASE_URL}/loading-cover.svg`;
          console.log(`[LandingPage] Setting cover_url to ${loadingCoverUrl} for bookId: ${bookId}`);
          setPdfs(prev => prev.map(b => b.drive_id === bookId ? { ...b, cover_url: loadingCoverUrl } : b));
          setTopNewest(prev => prev.map(b => b.drive_id === bookId ? { ...b, cover_url: loadingCoverUrl } : b));
          setTopVoted(prev => prev.map(b => b.drive_id === bookId ? { ...b, cover_url: loadingCoverUrl } : b));
          await waitForServerHealth();
          // Prevent duplicate requests for covers already waiting
          if (coversWaitingRef.current.has(bookId)) {
            console.log(`[LandingPage] Duplicate cover request for book ${bookId} ignored: already waiting for backend response.`);
            continue;
          }
          coversWaitingRef.current.add(bookId);
          let backendPermanentFailure = false;
          try {
            const resp = await fetch(`${API_BASE_URL}/api/pdf-cover/${encodeURIComponent(bookId)}?session_id=${encodeURIComponent(sessionId)}`, {
              method: 'GET'
            });
            if (resp.ok) {
              // Cover generated, will be picked up by image load event
              coversWaitingRef.current.delete(bookId);
            } else {
              const data = await resp.json().catch(() => ({}));
              if (resp.status === 409 && data.error === 'duplicate') {
                // Backend says duplicate: keep spinner, do not set no-cover, wait for next refresh
                console.log(`[LandingPage] Backend reported duplicate cover request for book ${bookId}. Waiting for original to finish.`);
                continue;
              }
              // If backend returns a permanent failure (e.g. 500, or custom error), set permanent failure
              if (resp.status === 500 || data.error === 'permanent_failure') {
                backendPermanentFailure = true;
              } else {
                // Temporary error: keep spinner
              }
              coversWaitingRef.current.delete(bookId);
            }
          } catch (err) {
            // Network or unexpected error: treat as temporary, keep spinner
            coversWaitingRef.current.delete(bookId);
            console.error(`[LandingPage] Error requesting cover for book ${bookId}:`, err);
          }
          // After backend finishes, always re-check if cover exists and update UI
          await waitForServerHealth();
          try {
            const checkResp = await fetch(`${API_BASE_URL}/api/cover-exists/${encodeURIComponent(bookId)}`);
            const checkData = await checkResp.json();
            if (checkData.exists) {
              // Cover now exists, update cover_url to real image with cache-busting timestamp
              const timestamp = Date.now();
              const publicCoverUrl = `${API_BASE_URL}/api/covers/${bookId}.jpg?t=${timestamp}`;
              console.log(`[LandingPage] Cover for bookId: ${bookId} is now available. Updating cover_url with cache-busting: ${publicCoverUrl}`);
              setPdfs(prev => prev.map(b => b.drive_id === bookId ? { ...b, cover_url: publicCoverUrl } : b));
              setTopNewest(prev => prev.map(b => b.drive_id === bookId ? { ...b, cover_url: publicCoverUrl } : b));
              setTopVoted(prev => prev.map(b => b.drive_id === bookId ? { ...b, cover_url: publicCoverUrl } : b));
            } else {
              // Only set no-cover.svg if backendPermanentFailure is true
              if (backendPermanentFailure) {
                console.log(`[LandingPage] Final failure: Setting cover_url to /no-cover.svg for bookId: ${bookId}`);
                const noCoverUrl = `${API_BASE_URL}/no-cover.svg`;
                setPdfs(prev => prev.map(b => b.drive_id === bookId ? { ...b, cover_url: noCoverUrl } : b));
                setTopNewest(prev => prev.map(b => b.drive_id === bookId ? { ...b, cover_url: noCoverUrl } : b));
                setTopVoted(prev => prev.map(b => b.drive_id === bookId ? { ...b, cover_url: noCoverUrl } : b));
              } else {
                // Still waiting or temporary error, keep spinner (loading-cover.svg)
                console.log(`[LandingPage] Cover for bookId: ${bookId} still missing, keeping spinner.`);
              }
            }
          } catch (err) {
            // On error, keep spinner
            console.error(`[LandingPage] Error re-checking cover for book ${bookId}:`, err);
          }
        }
      }
    };
    fetchAllBookData().catch(err => {
      console.error('Error in initial book data fetch:', err);
    });
    const coversWaitingSet = coversWaitingRef.current;
    return () => { isMounted = false; coversWaitingSet.clear(); };
  }, [user]);


  // Parent-managed cover state hooks
  const carouselCoverState = useCoverLoadState();
  const newestCoverState = useCoverLoadState();
  const votedCoverState = useCoverLoadState();

  // Retry failed covers handler
  const handleRetryFailedCovers = async () => {
    // Find all books with permanent failure (no-cover.svg)
    const failedIds = [
      ...pdfs.filter(b => b.cover_url === '/no-cover.svg').map(b => b.drive_id),
      ...topNewest.filter(b => b.cover_url === '/no-cover.svg').map(b => b.drive_id),
      ...topVoted.filter(b => b.cover_url === '/no-cover.svg').map(b => b.drive_id)
    ];
    // Deduplicate
    const uniqueFailedIds = Array.from(new Set(failedIds));
    if (uniqueFailedIds.length === 0) {
      alert('No failed covers to retry.');
      return;
    }
    // Reset loading state for retried covers in all sections
    uniqueFailedIds.forEach(bookId => {
      carouselCoverState.resetLoading(bookId);
      newestCoverState.resetLoading(bookId);
      votedCoverState.resetLoading(bookId);
    });
    for (const bookId of uniqueFailedIds) {
      try {
        await waitForServerHealth();
        const sessionId = user?.session_id || localStorage.getItem('session_id');
        await fetch(`${API_BASE_URL}/api/pdf-cover/${encodeURIComponent(bookId)}?session_id=${encodeURIComponent(sessionId)}`, {
          method: 'GET'
        });
      } catch (err) {
        console.error(`[LandingPage] Error retrying cover for book ${bookId}:`, err);
      }
    }
    alert(`Retried ${uniqueFailedIds.length} failed covers.`);
  };

  return (
    <ContainerDepthProvider>
      <SteppedContainer depth={0} style={{ minHeight: '100vh', padding: 0, background: stepColor(_backgroundColor, theme, 0) }}>
        <div className={`landing-page ${theme}-mode`} style={{ background: stepColor(_backgroundColor, theme, 0), color: textColor, minHeight: '100vh' }}>
          <SearchBar pdfs={pdfs} navigate={navigate} depth={1} />
          <CarouselSection
            pdfs={pdfs}
            navigate={navigate}
            settings={settings}
            depth={1}
            loaded={carouselCoverState.loaded}
            loading={carouselCoverState.loading}
            startLoading={carouselCoverState.startLoading}
            handleCoverLoad={carouselCoverState.handleCoverLoad}
            handleCoverError={carouselCoverState.handleCoverError}
          />

          {/* Native ad banner between carousel and lists */}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '32px 0' }}>
            <AdNativeBanner style={{ width: 300, minHeight: 50, borderRadius: 8, background: stepColor(_backgroundColor, theme, 1) }} />
          </div>

          <TopListsSection
            topNewest={topNewest}
            topVoted={topVoted}
            navigate={navigate}
            depth={1}
            loadedNewest={newestCoverState.loaded}
            loadingNewest={newestCoverState.loading}
            startLoadingNewest={newestCoverState.startLoading}
            handleLoadNewest={newestCoverState.handleCoverLoad}
            handleErrorNewest={newestCoverState.handleCoverError}
            loadedVoted={votedCoverState.loaded}
            loadingVoted={votedCoverState.loading}
            startLoadingVoted={votedCoverState.startLoading}
            handleLoadVoted={votedCoverState.handleCoverLoad}
            handleErrorVoted={votedCoverState.handleCoverError}
            textColor={textColor}
          />

          <div style={{ textAlign: 'center', margin: '24px 0' }}>
            <button onClick={handleRetryFailedCovers} style={{ padding: '10px 24px', borderRadius: 8, border: '1.5px solid #333', background: '#ccc', color: '#333', fontWeight: 700, fontSize: 18, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', transition: 'background 0.15s, color 0.15s' }}>
              Retry Failed Covers
            </button>
          </div>

          {/* Regular banner ad at the very bottom */}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '32px 0' }}>
            <AdBanner300x250 />
          </div>

          {loadingPdfs && (
            <div style={{ textAlign: 'center', color: '#888', margin: 24, background: stepColor(_backgroundColor, theme, 1), borderRadius: 8 }}>Loading more books...</div>
          )}

        </div>
      </SteppedContainer>
    </ContainerDepthProvider>
  );
}