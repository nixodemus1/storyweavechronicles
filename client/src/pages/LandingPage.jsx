import "../styles/LandingPage.css";
import React, { useEffect, useState } from "react";
import Slider from "react-slick";
import { useNavigate } from "react-router-dom";

export default function LandingPage() {
  const [pdfs, setPdfs] = useState([]);
  const navigate = useNavigate();

  const folderId = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;

  useEffect(() => {
    if (!folderId) return;
    fetch(`/list-pdfs/${folderId}`)
      .then(res => res.json())
      .then(data => {
        if (data.pdfs) {
          // Sort newest first
          const sorted = data.pdfs.slice().sort((a, b) => {
            if (a.createdTime && b.createdTime) {
              return new Date(b.createdTime) - new Date(a.createdTime);
            }
            return 0;
          });
          setPdfs(sorted);
        }
      })
      .catch(err => console.error("Error fetching PDFs:", err));
  }, [folderId]);

  const settings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 10,
    slidesToScroll: 1,
    arrows: true,
    adaptiveHeight: false,
  };

  if (pdfs.length === 0) {
    return <div style={{ textAlign: "center", marginTop: "50px" }}>Loading...</div>;
  }

  return (
    <div className="landing-page">
      <header className="header" style={{ position: 'relative' }}>
        <h1 className="logo" style={{ marginRight: 'auto' }}>StoryWeave Chronicles</h1>
        <a
          href="/authorize"
          style={{
            position: 'absolute',
            right: 32,
            top: '50%',
            transform: 'translateY(-50%)',
            background: '#0070f3',
            color: '#fff',
            padding: '0.5rem 1.2rem',
            borderRadius: 6,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: '1rem',
            letterSpacing: 1,
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            transition: 'background 0.2s',
            zIndex: 10,
          }}
          onMouseOver={e => (e.currentTarget.style.background = '#005bb5')}
          onMouseOut={e => (e.currentTarget.style.background = '#0070f3')}
        >
          Log In
        </a>
      </header>
      <div className="carousel-container">
        <Slider {...settings}>
          {pdfs
            .filter(pdf => pdf && pdf.id && pdf.name)
            .map((pdf) => (
              <div
                key={pdf.id}
                className="carousel-item"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/read/${pdf.id}`)}
                title={`Read ${pdf.name}`}
              >
                <img
                  src={`/pdf-cover/${pdf.id}`}
                  alt={pdf.name}
                  className="book-cover"
                  onError={e => {
                    e.target.onerror = null;
                    e.target.src = 'https://via.placeholder.com/180x260?text=No+Cover';
                  }}
                />
                <div className="book-title">{pdf.name}</div>
              </div>
            ))}
        </Slider>
      </div>
    </div>
  );
}
