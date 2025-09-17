import { stepColor } from "../utils/colorUtils";
import React, { useEffect, useState, useContext, useRef } from "react";
import { useLocation } from "react-router-dom";
import "../styles/LandingPage.css";
import Slider from "react-slick";
import { useNavigate } from "react-router-dom";
import { ThemeContext } from "../themeContext";
import { ContainerDepthProvider, SteppedContainer } from "../components/ContainerDepthContext";

const API_BASE_URL = import.meta.env.VITE_HOST_URL;

// LocalStorage cover cache utilities
function getCoverFromCache(bookId) {
  try {
    const cacheRaw = localStorage.getItem('swc_cover_cache');
    const cache = JSON.parse(cacheRaw || '{}');
    const entry = cache[bookId];
    const diskUrl = `${API_BASE_URL}/covers/${bookId}.jpg`;
    if (!entry) {
      console.log(`[getCoverFromCache] MISS for ${bookId}: no entry, using diskUrl`, diskUrl);
      return { url: diskUrl, expired: false };
    }
    if (typeof entry === 'string') {
      if (entry.startsWith('blob:')) {
        console.log(`[getCoverFromCache] MISS for ${bookId}: legacy blob, using diskUrl`, diskUrl);
        return { url: diskUrl, expired: false };
      }
      console.log(`[getCoverFromCache] HIT for ${bookId}: legacy url`, entry);
      return { url: entry, expired: false };
    }
    if (entry.url === '/no-cover.png') {
      const now = Date.now();
      const expired = !entry.ts || (now - entry.ts > 3600 * 1000);
      console.log(`[getCoverFromCache] HIT for ${bookId}: no-cover.png, expired=${expired}`);
      return { url: '/no-cover.png', expired };
    }
    if (entry.url && entry.url.startsWith('blob:')) {
      console.log(`[getCoverFromCache] MISS for ${bookId}: blob url, using diskUrl`, diskUrl);
      return { url: diskUrl, expired: false };
    }
    console.log(`[getCoverFromCache] HIT for ${bookId}: url`, entry.url);
    return { url: entry.url, expired: false };
  } catch (e) {
    console.warn('[getCoverFromCache] Cover cache corrupted, clearing:', e);
    localStorage.removeItem('swc_cover_cache');
    return { url: `${API_BASE_URL}/covers/${bookId}.jpg`, expired: false };
  }
}
function setCoverInCache(bookId, url) {
  try {
    if (url && url.startsWith('blob:')) {
      console.log(`[setCoverInCache] SKIP for ${bookId}: not caching blob url`, url);
      return;
    }
    const cacheRaw = localStorage.getItem('swc_cover_cache');
    let cache = {};
    try {
      cache = JSON.parse(cacheRaw || '{}');
    } catch (e) {
      console.warn('[setCoverInCache] Cover cache corrupted, clearing:', e);
      localStorage.removeItem('swc_cover_cache');
      cache = {};
    }
    if (url === '/no-cover.png') {
      cache[bookId] = { url, ts: Date.now() };
      console.log(`[setCoverInCache] SET for ${bookId}: no-cover.png`);
    } else {
      cache[bookId] = { url };
      console.log(`[setCoverInCache] SET for ${bookId}: url`, url);
    }
    localStorage.setItem('swc_cover_cache', JSON.stringify(cache));
  } catch (e) {
    console.warn('[setCoverInCache] Failed to set cover in cache:', e);
  }
}

function useCachedCovers(pdfs) {
  const [covers, setCovers] = React.useState({});
  const [loadingCovers, setLoadingCovers] = React.useState({});
  const { user } = React.useContext(ThemeContext);

  React.useEffect(() => {
    let isMounted = true;
    const newCovers = {};
    const newLoading = {};

    async function processCovers(missingIdsFromParent) {
      const bookIds = pdfs.map(pdf => pdf.drive_id || pdf.id).filter(Boolean);
      bookIds.forEach(bookId => { newLoading[bookId] = true; });
      console.log('[LandingPage] Requested bookIds:', bookIds);

      // Check status for all covers
      const statusResults = await Promise.all(bookIds.map(async bookId => {
        const { url, expired } = getCoverFromCache(bookId);
        console.log(`[LandingPage] getCoverFromCache(${bookId}):`, { url, expired });
        // If we already have /no-cover.png and it's not expired, do NOT retry automatically
        if (url === '/no-cover.png' && !expired) {
          newCovers[bookId] = '/no-cover.png';
          newLoading[bookId] = false;
          return { bookId, status: { status: 'error' }, url };
        }
        // If expired, allow one retry
        if (url === '/no-cover.png' && expired) {
          console.log(`[LandingPage] Evicting expired no-cover for ${bookId}`);
          setCoverInCache(bookId, undefined);
        }
        let status = { status: 'error' };
        let coverImageUrl = null;
        try {
          const res = await fetch(`${API_BASE_URL}/covers/${bookId}.jpg?status=1`);
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            status = await res.json();
            console.log(`[LandingPage] /covers/${bookId}.jpg?status=1 response:`, status);
            if (status.status === 'error') {
              console.warn(`[LandingPage] Disk fetch failed for ${bookId}, will call /pdf-cover next.`);
            }
          } else if (contentType && contentType.startsWith('image/')) {
            const blob = await res.blob();
            coverImageUrl = URL.createObjectURL(blob);
            setCoverInCache(bookId, coverImageUrl);
            newCovers[bookId] = coverImageUrl;
            newLoading[bookId] = false;
            status = { status: 'valid' };
            console.log(`[LandingPage] Used streamed image for ${bookId} as cover:`, coverImageUrl);
          } else {
            console.warn(`[LandingPage] Non-JSON/non-image response for status of ${bookId}:`, contentType);
            status = { status: 'error' };
            console.warn(`[LandingPage] Disk fetch failed for ${bookId} (unexpected content-type), will call /pdf-cover next.`);
          }
        } catch (err) {
          console.warn(`[LandingPage] Error fetching status for ${bookId}:`, err);
          status = { status: 'error' };
          console.warn(`[LandingPage] Disk fetch failed for ${bookId} (exception), will call /pdf-cover next.`);
        }
        return { bookId, status, url };
      }));

      const idsToFetch = Array.isArray(missingIdsFromParent) ? missingIdsFromParent : [];
      console.log('[LandingPage] idsToFetch (missing from parent):', idsToFetch);

      if (idsToFetch.length > 0) {
        for (let i = 0; i < idsToFetch.length; i++) {
          const bookId = idsToFetch[i];
          const sessionId = user?.session_id || localStorage.getItem('session_id');
          const coverUrl = `${API_BASE_URL}/pdf-cover/${bookId}?session_id=${encodeURIComponent(sessionId || '')}`;
          console.log(`[LandingPage] About to call /pdf-cover for ${bookId}:`, coverUrl);
          try {
            const resp = await fetch(coverUrl);
            console.log(`[LandingPage] /pdf-cover/${bookId} response status:`, resp.status);
            if (resp.status === 429) {
              console.warn(`[LandingPage] /pdf-cover returned 429 Too Many Requests for ${bookId}`);
              setCoverInCache(bookId, '/no-cover.png');
              newCovers[bookId] = '/no-cover.png';
              newLoading[bookId] = false;
            } else {
              const contentType = resp.headers.get('content-type');
              if (contentType && contentType.startsWith('image/')) {
                const blob = await resp.blob();
                const objectUrl = URL.createObjectURL(blob);
                newCovers[bookId] = objectUrl;
                newLoading[bookId] = false;
                console.log(`[LandingPage] Cover loaded for ${bookId}:`, objectUrl);
                const diskUrl = `${API_BASE_URL}/covers/${bookId}.jpg`;
                setCoverInCache(bookId, diskUrl);
              } else {
                setCoverInCache(bookId, '/no-cover.png');
                newCovers[bookId] = '/no-cover.png';
                newLoading[bookId] = false;
                console.warn(`[LandingPage] /pdf-cover returned unexpected content-type for ${bookId}:`, contentType);
              }
            }
          } catch (err) {
            setCoverInCache(bookId, '/no-cover.png');
            newCovers[bookId] = '/no-cover.png';
            newLoading[bookId] = false;
            console.error(`[LandingPage] Error calling /pdf-cover for ${bookId}:`, err);
          }
          if (isMounted) {
            console.log(`[LandingPage] Fallback setCovers for ${bookId}:`, newCovers[bookId]);
            setCovers({ ...newCovers });
          }
          if (isMounted) {
            setLoadingCovers({ ...newLoading });
          }
        }
      }
      // For covers not missing, use disk or cache
      statusResults.forEach(({ bookId, status, url }) => {
        if (!idsToFetch.includes(bookId)) {
          if (status.valid === true) {
            const coverUrl = `${API_BASE_URL}/covers/${bookId}.jpg`;
            setCoverInCache(bookId, coverUrl);
            newCovers[bookId] = coverUrl;
            newLoading[bookId] = false;
            console.log(`[LandingPage] Valid cover for ${bookId}:`, coverUrl);
          } else if (url && url.startsWith('blob:')) {
            newCovers[bookId] = url;
            newLoading[bookId] = false;
            console.log(`[LandingPage] Using blob fallback for ${bookId}:`, url);
          } else {
            setCoverInCache(bookId, '/no-cover.png');
            newCovers[bookId] = '/no-cover.png';
            newLoading[bookId] = false;
            console.log(`[LandingPage] No cover for ${bookId}`);
          }
        }
      });

      if (isMounted) {
        console.log('[LandingPage] Final covers:', newCovers);
        setCovers(newCovers);
      }
      if (isMounted) {
        console.log('[LandingPage] Final loadingCovers:', newLoading);
        setLoadingCovers(newLoading);
      }
    }

    // Wait for missingIdsFromParent from props
    if (typeof window !== 'undefined' && window._landingPageMissingCoverIds) {
      console.log('[LandingPage] Using window._landingPageMissingCoverIds:', window._landingPageMissingCoverIds);
      processCovers(window._landingPageMissingCoverIds);
    } else {
      processCovers([]);
    }
    return () => { isMounted = false; };
  }, [pdfs, user]);

  // --- Top-level effect: call /api/rebuild-cover-cache once on mount ---
  useEffect(() => {
    async function fetchMissingCoverIds() {
      const allBookIds = pdfs.map(pdf => pdf.drive_id || pdf.id).filter(Boolean);
      if (allBookIds.length === 0) return;
      try {
        const resp = await fetch(`${API_BASE_URL}/api/rebuild-cover-cache`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ book_ids: allBookIds })
        });
        let data = {};
        try {
          data = await resp.json();
        } catch (e) {
          console.error('Error parsing /api/rebuild-cover-cache response:', e);
        }
        // Store missing IDs globally for useCachedCovers
        window._landingPageMissingCoverIds = Array.isArray(data.missing_ids) ? data.missing_ids : [];
      } catch (err) {
        window._landingPageMissingCoverIds = [];
        console.error('Error rebuilding cover cache:', err);
      }
    }
    fetchMissingCoverIds();
  }, [pdfs]);

  return { covers, loadingCovers };
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

function CarouselSection({ pdfs, navigate, settings, depth = 1 }) {
  // Always show a maximum of 20 covers in the carousel
  const pdfs20 = React.useMemo(() => {
    const arr = pdfs.slice(0, 20);
    return arr;
  }, [pdfs]);
  const { covers, loadingCovers } = useCachedCovers(pdfs20);

  // Hybrid fix: Set width inline on .carousel-item for mobile, let Slick measure
  const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 700px)').matches;
  // Restore: set width inline to 64px for mobile, matching .book-cover
  // Desktop: set width, minWidth, maxWidth to 110px to match .book-cover
  const itemStyle = isMobile
    ? { cursor: 'pointer', borderRadius: 8, width: 64, minWidth: 64, maxWidth: 64 }
    : { cursor: 'pointer', borderRadius: 8, width: 110, minWidth: 110, maxWidth: 110 };
  const titleStyle = { fontSize: '0.95rem', marginTop: '0.3rem', padding: '0.15em 0.3em', borderRadius: 4 };

  return (
    <SteppedContainer depth={depth} style={{ marginBottom: 32 }}>
      <div className="carousel-container">
        <Slider {...settings}
          beforeChange={() => { window._carouselDragged = false; }}
          afterChange={() => { window._carouselDragged = false; }}
        >
          {pdfs20
            .filter(pdf => pdf && pdf.title)
            .map((pdf) => {
              const bookId = pdf.drive_id;
              const coverUrl = covers[bookId];
              const isLoading = loadingCovers[bookId];
              return (
                <SteppedContainer depth={depth + 1} key={bookId || Math.random()} className="carousel-item" style={itemStyle}>
                  {bookId ? (
                    pdf.missing
                      ? <div className="book-cover book-missing">Missing Book</div>
                      : isLoading
                        ? <div className="book-cover book-loading">Loading Cover...</div>
                        : coverUrl === '/no-cover.png'
                          ? <div className="book-cover book-nocover">No Cover</div>
                          : <img
                              src={coverUrl}
                              alt={pdf.title}
                              className="book-cover"
                              onError={e => {
                                if (e.target.src !== '/no-cover.png') {
                                  setCoverInCache(bookId, '/no-cover.png');
                                  e.target.src = '/no-cover.png';
                                }
                              }}
                              onClick={e => {
                                // Only allow manual retry if cover is missing
                                const { url } = getCoverFromCache(bookId);
                                if (url === '/no-cover.png') {
                                  // Manual retry: fetch cover again
                                  const coverUrl = `${API_BASE_URL}/pdf-cover/${bookId}`;
                                  const img = new window.Image();
                                  img.onload = () => setCoverInCache(bookId, coverUrl);
                                  img.onerror = () => setCoverInCache(bookId, '/no-cover.png');
                                  img.src = coverUrl;
                                  setTimeout(() => {
                                    e.target.src = getCoverFromCache(bookId).url;
                                  }, 500);
                                }
                              }}
                            />
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

function TopListsSection({ topNewest, topVoted, navigate, depth = 1 }) {
  const { covers: coversNewest, loadingCovers: loadingNewest } = useCachedCovers(topNewest);
  const { covers: coversVoted, loadingCovers: loadingVoted } = useCachedCovers(topVoted);
  return (
    <SteppedContainer depth={depth} className="landing-description" style={{ marginBottom: 32 }}>
      <p>Explore our collection of books and start reading today!</p>
      <div className="top-lists-container">
        <SteppedContainer depth={depth + 1} className="top-list" style={{ marginBottom: 16 }}>
          <h3>Top 10 Newest</h3>
          <ol>
            {topNewest.map((pdf) => {
              const bookId = pdf.drive_id;
              const coverUrl = coversNewest[bookId];
              const isLoading = loadingNewest[bookId];
              return (
                <li key={bookId || Math.random()} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {bookId ? (
                    isLoading ? (
                      <div className="book-cover book-loading">Loading Cover...</div>
                    ) : coverUrl === '/no-cover.png' ? (
                      <div className="book-cover book-nocover">No Cover</div>
                    ) : (
                      <img src={coverUrl}
                        alt={pdf.title}
                        className="book-cover"
                        onError={e => {
                          if (e.target.src !== '/no-cover.png') {
                            setCoverInCache(bookId, '/no-cover.png');
                            e.target.src = '/no-cover.png';
                          }
                        }}
                        onClick={e => {
                          // Only allow manual retry if cover is missing
                          const { url } = getCoverFromCache(bookId);
                          if (url === '/no-cover.png') {
                            // Manual retry: fetch cover again
                            const coverUrl = `${API_BASE_URL}/pdf-cover/${bookId}`;
                            const img = new window.Image();
                            img.onload = () => setCoverInCache(bookId, coverUrl);
                            img.onerror = () => setCoverInCache(bookId, '/no-cover.png');
                            img.src = coverUrl;
                            setTimeout(() => {
                              e.target.src = getCoverFromCache(bookId).url;
                            }, 500);
                          }
                        }} />
                    )
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
          <h3>Top 10 by Votes</h3>
          <ol>
            {topVoted.map((pdf) => {
              const bookId = pdf.drive_id;
              const coverUrl = coversVoted[bookId];
              const isLoading = loadingVoted[bookId];
              return (
                <li key={bookId || Math.random()} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {bookId ? (
                    isLoading ? (
                      <div className="book-cover book-loading">Loading Cover...</div>
                    ) : coverUrl === '/no-cover.png' ? (
                      <div className="book-cover book-nocover">No Cover</div>
                    ) : (
                      <img src={coverUrl}
                        alt={pdf.title}
                        className="book-cover"
                        onError={e => {
                          if (e.target.src !== '/no-cover.png') {
                            setCoverInCache(bookId, '/no-cover.png');
                            e.target.src = '/no-cover.png';
                          }
                        }}
                        onClick={e => {
                          const { url } = getCoverFromCache(bookId);
                          if (url === '/no-cover.png') {
                            const coverUrl = `${API_BASE_URL}/pdf-cover/${bookId}`;
                            const img = new window.Image();
                            img.onload = () => setCoverInCache(bookId, coverUrl);
                            img.onerror = () => setCoverInCache(bookId, '/no-cover.png');
                            img.src = coverUrl;
                            setTimeout(() => {
                              e.target.src = getCoverFromCache(bookId).url;
                            }, 500);
                          }
                        }} />
                    )
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
  const [loadingPdfs, setLoadingPdfs] = useState(false);

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

  // Fetch top 20 newest book IDs from /api/all-books
  useEffect(() => {
    setLoadingPdfs(true);
    fetch(`${API_BASE_URL}/api/all-books`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.books)) {
          const newestIds = data.books.slice(0, 20).map(b => b.drive_id);
          if (newestIds.length > 0) {
            fetch(`${API_BASE_URL}/api/books?ids=${newestIds.join(',')}`)
              .then(res2 => res2.json())
              .then (data2 => {
                if (Array.isArray(data2.books)) {
                  // Patch: ensure every book has drive_id
                  const patchedBooks = data2.books.map(b => ({ ...b, drive_id: b.drive_id || b.id}));
                  setPdfs(patchedBooks);
                  setTopNewest(patchedBooks.slice(0, 10));
                  // --- POST ALL 20 book IDs to backend for cover/atlas sync ---
                  fetch(`${API_BASE_URL}/api/rebuild-cover-cache`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ book_ids: newestIds })
                  })
                    .then(res => res.json())
                    .then(data => {
                      console.log('[LandingPage] Posted ALL 20 book IDs to backend:', newestIds, data);
                    })
                    .catch(err => {
                      console.error('[LandingPage] Error posting ALL book IDs to backend:', err);
                    });
                }
                setLoadingPdfs(false);
                console.log("[LandingPage] Fetched all landing page books:", data2.books);
              })
              .catch(err => {
                console.error("Error fetching books by ids:", err);
                setLoadingPdfs(false);
              });
          } else {
            setLoadingPdfs(false);
          }
        } else {
          setLoadingPdfs(false);
        }
      })
      .catch(err => {
        console.error("Error fetching all books:", err);
        setLoadingPdfs(false);
      });
  }, []);

  // --- Remove duplicate POST effect, now handled above for all 20 books ---

  // Fetch top voted book IDs and then fetch their details
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/top-voted-books`)
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.books)) {
          const votedIds = data.books.map(b => b.id || b.book_id).filter(Boolean);
          if (votedIds.length > 0) {
            fetch(`${API_BASE_URL}/api/books?ids=${votedIds.join(',')}`)
              .then(res2 => res2.json())
              .then(data2 => {
                if (Array.isArray(data2.books)) {
                  // Patch: ensure every book has drive_id
                  // Only use drive_id, never fallback to id
                  const patchedBooks = data2.books.map(b => ({ ...b, drive_id: b.drive_id }));
                  setTopVoted(patchedBooks.slice(0, 10));
                }
              })
              .catch(err => {
                console.error("Error fetching voted books by ids:", err);
              });
          }
        }
      })
      .catch(err => {
        console.error("Error fetching top voted books:", err);
      });
  }, []);

  // Helper to clear all cover cache and trigger re-fetch
  function retryAllCovers() {
    try {
      localStorage.removeItem('swc_cover_cache');
      // Optionally, force a re-render by updating state
      setPdfs(pdfs => [...pdfs]);
      setTopNewest(topNewest => [...topNewest]);
      setTopVoted(topVoted => [...topVoted]);
    } catch (e) {
      console.log("Error clearing cover cache:", e);
    }
  }

  return (
    <ContainerDepthProvider>
      <SteppedContainer depth={0} style={{ minHeight: '100vh', padding: 0, background: stepColor(_backgroundColor, theme, 0) }}>
        <div className={`landing-page ${theme}-mode`} style={{ background: stepColor(_backgroundColor, theme, 0), color: textColor, minHeight: '100vh' }}>
          <SearchBar pdfs={pdfs} navigate={navigate} depth={1} />
          <CarouselSection pdfs={pdfs} navigate={navigate} settings={settings} depth={1} />
          <TopListsSection topNewest={topNewest} topVoted={topVoted} navigate={navigate} depth={1} />
          {loadingPdfs && (
            <div style={{ textAlign: 'center', color: '#888', margin: 24, background: stepColor(_backgroundColor, theme, 1), borderRadius: 8 }}>Loading more books...</div>
          )}
          {/* Retry covers button at the very bottom */}
          <SteppedContainer depth={1} style={{ width: '100%', display: 'flex', justifyContent: 'center', marginTop: 40, marginBottom: 24, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', background: stepColor(_backgroundColor, theme, 1) }}>
            <button
              onClick={retryAllCovers}
              style={{
                padding: '10px 28px',
                borderRadius: 8,
                border: `1.5px solid ${textColor}`,
                background: stepColor(_backgroundColor, theme, 2),
                color: textColor,
                fontWeight: 700,
                fontSize: 18,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
              }}
            >Retry All Covers</button>
          </SteppedContainer>
        </div>
      </SteppedContainer>
    </ContainerDepthProvider>
  );
}
