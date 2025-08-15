import React, { useEffect, useState, useContext } from "react";
import "../styles/LandingPage.css";
import Slider from "react-slick";
import { useNavigate } from "react-router-dom";
import { ThemeContext } from "../themeContext";
import { stepColor, getLuminance } from "../utils/colorUtils";

export default function LandingPage() {
  const navigate = useNavigate();
  const { theme, backgroundColor, textColor } = useContext(ThemeContext);
  const [pdfs, setPdfs] = useState([]);
  const [topNewest, setTopNewest] = useState([]);
  const [topVoted, setTopVoted] = useState([]);
  const folderId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;
  const API_BASE_URL = import.meta.env.VITE_HOST_URL;

  // --- Search bar state and logic ---
  const [searchInput, setSearchInput] = useState("");
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteResults, setAutocompleteResults] = useState([]);

  // Update autocomplete results as user types
  useEffect(() => {
    if (!searchInput.trim()) {
      setAutocompleteResults([]);
      return;
    }
    // Partial and prefix match, case-insensitive
    const results = pdfs.filter(pdf =>
      pdf.title && (
        pdf.title.toLowerCase().includes(searchInput.toLowerCase()) ||
        pdf.title.toLowerCase().startsWith(searchInput.toLowerCase())
      )
    );
    setAutocompleteResults(results.slice(0, 8)); // limit to 8 results
  }, [searchInput, pdfs]);

  // Handle search submit (Enter key or search button)
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!searchInput.trim()) return;
    // Exact match
    const exactMatches = pdfs.filter(pdf =>
      pdf.title && pdf.title.toLowerCase() === searchInput.toLowerCase()
    );
    if (exactMatches.length === 1) {
      navigate(`/read/${exactMatches[0].id}`);
      return;
    }
    // Prefix match
    const prefixMatches = pdfs.filter(pdf =>
      pdf.title && pdf.title.toLowerCase().startsWith(searchInput.toLowerCase())
    );
    if (prefixMatches.length === 1) {
      navigate(`/read/${prefixMatches[0].id}`);
      return;
    }
    // Partial match
    const partialMatches = pdfs.filter(pdf =>
      pdf.title && pdf.title.toLowerCase().includes(searchInput.toLowerCase())
    );
    if (partialMatches.length === 1) {
      navigate(`/read/${partialMatches[0].id}`);
      return;
    }
    // Multiple matches: go to search results page
    navigate(`/search?query=${encodeURIComponent(searchInput)}`);
  };

  // Handle autocomplete click
  const handleAutocompleteClick = (pdf) => {
    setSearchInput("");
    setShowAutocomplete(false);
    navigate(`/read/${pdf.id}`);
  };

  // Hide autocomplete on blur (with delay for click)
  const handleBlur = () => {
    setTimeout(() => setShowAutocomplete(false), 120);
  };

  // Compute container background and text color variants automatically for contrast
  // Use smart stepColor utility for container backgrounds
  function getContainerBg(bg, theme, step = 1) {
    if (!bg) return theme === 'dark' ? '#232323' : '#f5f5f5';
    // Always brighten for dark backgrounds, darken for light backgrounds
    const lum = getLuminance(bg);
    const direction = lum < 0.5 ? 1 : -1;
    return stepColor(bg, theme, step, direction);
  }

  const containerBg = getContainerBg(backgroundColor, theme, 1);
  const containerText = getContainerText(containerBg, textColor);
  // Secondary container (top-10) color: one more step lighter (or darker)
  const secondaryBg = getContainerBg(backgroundColor, theme, 2);
  function getContainerText(containerBg, rootText) {
    // If containerBg is too close to rootText, invert
    // Otherwise, use rootText
    // For simplicity, just use rootText for now
    return rootText;
  }

  // Carousel settings
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
    console.log("folderId:", folderId);
    // Helper to compute a hash of the file list for change detection
    function computeHash(pdfs) {
      if (!pdfs || !Array.isArray(pdfs)) return '';
      // Use id and createdTime for hash
      return pdfs.map(pdf => `${pdf.id}:${pdf.createdTime || ''}`).sort().join('|');
    }

    // Try to load from localStorage
    const cached = localStorage.getItem('swc_pdfs_cache');
    const cachedHash = localStorage.getItem('swc_pdfs_hash');
    let usedCache = false;
    if (cached && cachedHash) {
      try {
        const parsed = JSON.parse(cached);
        setPdfs(parsed);
        setTopNewest(parsed.slice(0, 10));
        setTopVoted(parsed.slice().sort(() => 0.5 - Math.random()).slice(0, 10));
        usedCache = true;
      } catch {return}
    }

    fetch(`${API_BASE_URL}/list-pdfs/${folderId}`)
      .then(res => res.json())
      .then(data => {
        console.log('PDFs response:', data);
        if (data.pdfs) {
          // Sort newest first
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
            setTopVoted(sorted.slice().sort(() => 0.5 - Math.random()).slice(0, 10));
            localStorage.setItem('swc_pdfs_cache', JSON.stringify(sorted));
            localStorage.setItem('swc_pdfs_hash', hash);
          }
        }
      })
      .catch(err => console.error("Error fetching PDFs:", err));
  }, [folderId]);

  return (
    <div
      className={`landing-page ${theme}-mode`}
      style={{ background: backgroundColor, color: textColor, minHeight: '100vh' }}
    >
  {/* ...no container color pickers, only header pickers remain... */}
      {/* Search bar with autocomplete */}
      <div className="searchbar-container" style={{ position: 'relative', zIndex: 10 }}>
        <form onSubmit={handleSearchSubmit} autoComplete="off">
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
            style={{ width: '100%', padding: '10px 14px', borderRadius: 6, fontSize: 18, border: '1.5px solid #bbb' }}
          />
        </form>
        {showAutocomplete && autocompleteResults.length > 0 && (
          <div className="autocomplete-dropdown" style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: containerBg,
            color: containerText,
            border: `1px solid #bbb`,
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            maxHeight: 320,
            overflowY: 'auto',
            marginTop: 2,
            zIndex: 20
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
      </div>
      <div className="carousel-container">
        <Slider {...settings}
          beforeChange={() => { window._carouselDragged = false; }}
          afterChange={() => { window._carouselDragged = false; }}
        >
          {pdfs
            .slice(0, 20)
            .filter(pdf => pdf && pdf.id && pdf.title)
            .map((pdf) => (
              <div
                key={pdf.id}
                className="carousel-item"
                style={{ cursor: 'pointer', background: containerBg, color: containerText }}
                title={`Read ${pdf.title}`}
                onMouseDown={() => { window._carouselDragged = false; }}
                onMouseMove={() => { window._carouselDragged = true; }}
                onMouseUp={() => {
                  if (!window._carouselDragged) {
                    navigate(`/read/${pdf.id}`);
                  }
                }}
                onTouchStart={() => { window._carouselDragged = false; }}
                onTouchMove={() => { window._carouselDragged = true; }}
                onTouchEnd={() => {
                  if (!window._carouselDragged) {
                    navigate(`/read/${pdf.id}`);
                  }
                }}
              >
                <img
                  src={`/pdf-cover/${pdf.id}`}
                  alt={pdf.title}
                  className="book-cover"
                  onError={e => {
                    e.target.onerror = null;
                    e.target.src = '/no-cover.png';
                  }}
                />
                <div
                  className="book-title"
                  style={{
                    color: containerText,
                    background: containerBg,
                    padding: '0.25em 0.5em',
                    borderRadius: 4,
                    marginTop: 8
                  }}
                >
                  {pdf.title}
                </div>
              </div>
            ))}
        </Slider>
      </div>
  <div className="landing-description" style={{ background: containerBg, color: containerText }}>
        <p>
          Explore our collection of books and start reading today!
        </p>
        <div className="top-lists-container">
          <div className="top-list" style={{ background: secondaryBg, color: textColor }}>
            <h3 style={{ color: textColor }}>Top 10 Newest</h3>
            <ol>
              {topNewest.map((pdf) => (
                <li key={pdf.id}>
                  <button
                    className="top-list-link"
                    style={{ color: textColor }}
                    onClick={() => navigate(`/read/${pdf.id}`)}
                  >
                    {pdf.title}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="top-list" style={{ background: secondaryBg, color: textColor }}>
            <h3 style={{ color: textColor }}>Top 10 by Votes</h3>
            <ol>
              {topVoted.map((pdf) => (
                <li key={pdf.id}>
                  <button
                    className="top-list-link"
                    style={{ color: textColor }}
                    onClick={() => navigate(`/read/${pdf.id}`)}
                  >
                    {pdf.title}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
