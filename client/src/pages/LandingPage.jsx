// Custom hook to cache covers for a list of pdfs
// In-memory cache for cover URLs
const coverCache = {};

function useCachedCovers(pdfs) {
  const [covers, setCovers] = React.useState({});

  React.useEffect(() => {
    let isMounted = true;
    // Revoke previous blob URLs before setting new covers
    const prevBlobUrls = Object.values(covers).filter(url => url && url.startsWith('blob:'));
    prevBlobUrls.forEach(url => {
      try { URL.revokeObjectURL(url); } catch {console.log("Error revoking blob URL:", url);}
    });

    const fetchCovers = async () => {
      const newCovers = {};
      console.log('[useCachedCovers] Fetching covers for pdfs:', pdfs.map(p => p.id));
      await Promise.all(
        pdfs.map(async (pdf) => {
          if (!pdf.id) return;
          if (coverCache[pdf.id]) {
            newCovers[pdf.id] = coverCache[pdf.id];
            return;
          }
          try {
            const res = await fetch(`${import.meta.env.VITE_HOST_URL}/pdf-cover/${pdf.id}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            coverCache[pdf.id] = url;
            newCovers[pdf.id] = url;
          } catch {
            coverCache[pdf.id] = '/no-cover.png';
            newCovers[pdf.id] = '/no-cover.png';
          }
        })
      );
      if (isMounted) {
        console.log('[useCachedCovers] Setting covers:', Object.keys(newCovers));
        setCovers(newCovers);
      }
    };
    fetchCovers();
    return () => {
      isMounted = false;
      // Revoke blob URLs on unmount
      const blobUrls = Object.values(covers).filter(url => url && url.startsWith('blob:'));
      blobUrls.forEach(url => {
        try { URL.revokeObjectURL(url); } catch {console.log("Error revoking blob URL:", url);}
      });
    };
  }, [pdfs]);
  return covers;
}
import React, { useEffect, useState, useContext } from "react";
import "../styles/LandingPage.css";
import Slider from "react-slick";
import { useNavigate } from "react-router-dom";
import { ThemeContext } from "../themeContext";
import { ContainerDepthProvider, SteppedContainer } from "../components/ContainerDepthContext";


function SearchBar({ pdfs, navigate }) {
  const [searchInput, setSearchInput] = useState("");
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteResults, setAutocompleteResults] = useState([]);
  const containerRef = React.useRef(null);
  const { backgroundColor } = useContext(ThemeContext);

  useEffect(() => {
    if (!searchInput.trim()) {
      setAutocompleteResults([]);
      return;
    }
    const results = pdfs.filter(pdf =>
      pdf.title && (
        pdf.title.toLowerCase().includes(searchInput.toLowerCase()) ||
        pdf.title.toLowerCase().startsWith(searchInput.toLowerCase())
      )
    );
    setAutocompleteResults(results.slice(0, 8));
  }, [searchInput, pdfs]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!searchInput.trim()) return;
    const exactMatches = pdfs.filter(pdf =>
      pdf.title && pdf.title.toLowerCase() === searchInput.toLowerCase()
    );
    if (exactMatches.length === 1) {
      navigate(`/read/${exactMatches[0].id}`);
      return;
    }
    const prefixMatches = pdfs.filter(pdf =>
      pdf.title && pdf.title.toLowerCase().startsWith(searchInput.toLowerCase())
    );
    if (prefixMatches.length === 1) {
      navigate(`/read/${prefixMatches[0].id}`);
      return;
    }
    const partialMatches = pdfs.filter(pdf =>
      pdf.title && pdf.title.toLowerCase().includes(searchInput.toLowerCase())
    );
    if (partialMatches.length === 1) {
      navigate(`/read/${partialMatches[0].id}`);
      return;
    }
    navigate(`/search?query=${encodeURIComponent(searchInput)}`);
  };

  const handleAutocompleteClick = (pdf) => {
    setSearchInput("");
    setShowAutocomplete(false);
    navigate(`/read/${pdf.id}`);
  };

  const handleBlur = () => {
    setTimeout(() => setShowAutocomplete(false), 120);
  };

  return (
  <SteppedContainer depth={0} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: 32, marginTop: 32, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', position: 'relative', background: backgroundColor }} ref={containerRef}>
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
              color: 'inherit',
              background: backgroundColor, // base background color
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
          background: 'inherit'
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
              {pdf.title}
            </div>
          ))}
        </div>
      )}
    </SteppedContainer>
  );
}

function CarouselSection({ pdfs, navigate, settings, depth = 1 }) {
  const pdfs20 = React.useMemo(() => pdfs.slice(0, 20), [pdfs]);
  const covers = useCachedCovers(pdfs20);
  console.log('[CarouselSection] Rendering with covers:', covers);
  return (
    <SteppedContainer depth={depth} style={{ marginBottom: 32 }}>
      <div className="carousel-container">
        <Slider {...settings}
          beforeChange={() => { window._carouselDragged = false; }}
          afterChange={() => { window._carouselDragged = false; }}
        >
          {pdfs20
            .filter(pdf => pdf && pdf.id && pdf.title)
            .map((pdf) => (
              <SteppedContainer depth={depth + 1} key={pdf.id} className="carousel-item" style={{ cursor: 'pointer' }}>
                <img
                  src={covers[pdf.id] || `${import.meta.env.VITE_HOST_URL}/pdf-cover/${pdf.id}`}
                  alt={pdf.title}
                  className="book-cover"
                  onError={e => {
                    e.target.onerror = null;
                    e.target.src = '/no-cover.png';
                  }}
                />
                <SteppedContainer depth={depth + 2} className="book-title" style={{ padding: '0.25em 0.5em', borderRadius: 4, marginTop: 8 }}>
                  <button
                    style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 'inherit' }}
                    onClick={() => navigate(`/read/${pdf.id}`)}
                    tabIndex={-1}
                    inert={false}
                  >
                    {pdf.title}
                  </button>
                </SteppedContainer>
              </SteppedContainer>
            ))}
        </Slider>
      </div>
    </SteppedContainer>
  );
}

function TopListsSection({ topNewest, topVoted, navigate, depth = 1 }) {
  const coversNewest = useCachedCovers(topNewest);
  const coversVoted = useCachedCovers(topVoted);
  return (
    <SteppedContainer depth={depth} className="landing-description" style={{ marginBottom: 32 }}>
      <p>
        Explore our collection of books and start reading today!
      </p>
      <div className="top-lists-container">
        <SteppedContainer depth={depth + 1} className="top-list" style={{ marginBottom: 16 }}>
          <h3>Top 10 Newest</h3>
          <ol>
            {topNewest.map((pdf) => (
              <li key={pdf.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src={coversNewest[pdf.id] || `${import.meta.env.VITE_HOST_URL}/pdf-cover/${pdf.id}`}
                  alt={pdf.title}
                  style={{ width: 32, height: 48, objectFit: 'cover', borderRadius: 4 }} />
                <SteppedContainer depth={depth + 2} style={{ display: 'inline-block', borderRadius: 4 }}>
                  <button
                    className="top-list-link"
                    style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer' }}
                    onClick={() => navigate(`/read/${pdf.id}`)}
                  >
                    {pdf.title}
                  </button>
                </SteppedContainer>
              </li>
            ))}
          </ol>
        </SteppedContainer>
        <SteppedContainer depth={depth + 1} className="top-list">
          <h3>Top 10 by Votes</h3>
          <ol>
            {topVoted.map((pdf) => (
              <li key={pdf.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src={coversVoted[pdf.id] || `${import.meta.env.VITE_HOST_URL}/pdf-cover/${pdf.id}`}
                  alt={pdf.title}
                  style={{ width: 32, height: 48, objectFit: 'cover', borderRadius: 4 }} />
                <SteppedContainer depth={depth + 2} style={{ display: 'inline-block', borderRadius: 4 }}>
                  <button
                    className="top-list-link"
                    style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer' }}
                    onClick={() => navigate(`/read/${pdf.id}`)}
                  >
                    {pdf.title}
                  </button>
                </SteppedContainer>
              </li>
            ))}
          </ol>
        </SteppedContainer>
      </div>
    </SteppedContainer>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const { theme, backgroundColor: _backgroundColor, textColor } = useContext(ThemeContext);
  const [pdfs, setPdfs] = useState([]);
  const [topNewest, setTopNewest] = useState([]);
  const [topVoted, setTopVoted] = useState([]);
  const folderId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;
  const API_BASE_URL = import.meta.env.VITE_HOST_URL;

  const settings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 10,
    slidesToScroll: 1,
    centerMode: true,
    centerPadding: '40px',
    swipeToSlide: true,
    responsive: [
      { breakpoint: 900, settings: { slidesToShow: 2 } },
      { breakpoint: 600, settings: { slidesToShow: 1 } },
    ],
  };

  useEffect(() => {
    if (!folderId) return;
    function computeHash(pdfs) {
      if (!pdfs || !Array.isArray(pdfs)) return '';
      return pdfs.map(pdf => `${pdf.id}:${pdf.createdTime || ''}`).sort().join('|');
    }
    const cached = localStorage.getItem('swc_pdfs_cache');
    const cachedHash = localStorage.getItem('swc_pdfs_hash');
    let usedCache = false;
    if (cached && cachedHash) {
      try {
        const parsed = JSON.parse(cached);
        setPdfs(parsed);
        setTopNewest(parsed.slice(0, 10));
        usedCache = true;
      } catch {return}
    }
    fetch(`${API_BASE_URL}/list-pdfs/${folderId}`)
      .then(res => res.json())
      .then(data => {
        if (data.pdfs) {
          const sorted = data.pdfs.slice().sort((a, b) => {
            if (a.createdTime && b.createdTime) {
              return new Date(b.createdTime) - new Date(a.createdTime);
            }
            return 0;
          });
          const hash = computeHash(sorted);
          if (!usedCache || hash !== cachedHash) {
            setPdfs(sorted);
            setTopNewest(sorted.slice(0, 10));
            localStorage.setItem('swc_pdfs_cache', JSON.stringify(sorted));
            localStorage.setItem('swc_pdfs_hash', hash);
          }
        }
      })
      .catch(err => console.error("Error fetching PDFs:", err));
  }, [folderId, API_BASE_URL]);

  // Fetch top voted books from backend and match with pdfs
  useEffect(() => {
    if (!pdfs || pdfs.length === 0) return;
    fetch(`${API_BASE_URL}/api/top-voted-books`)
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.books)) {
          // Match returned book IDs to pdfs
          const topVotedBooks = data.books
            .map(b => pdfs.find(pdf => pdf.id === b.id || pdf.id === b.book_id))
            .filter(Boolean)
            .slice(0, 10);
          setTopVoted(topVotedBooks);
        }
      })
      .catch(err => console.error("Error fetching top voted books:", err));
  }, [pdfs, API_BASE_URL]);

  return (
    <ContainerDepthProvider>
      <SteppedContainer depth={0} style={{ minHeight: '100vh', padding: 0 }}>
        <div className={`landing-page ${theme}-mode`} style={{ background: 'transparent', color: textColor, minHeight: '100vh' }}>
          <SearchBar pdfs={pdfs} navigate={navigate} depth={1} />
          <CarouselSection pdfs={pdfs} navigate={navigate} settings={settings} depth={1} />
          <TopListsSection topNewest={topNewest} topVoted={topVoted} navigate={navigate} depth={1} />
        </div>
      </SteppedContainer>
    </ContainerDepthProvider>
  );
}
