import { useEffect, useState } from "react";
import Slider from "react-slick";

// Import carousel CSS here (Vite-compatible)
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import "../styles/LandingPage.css";

export default function LandingPage() {
  const [pdfs, setPdfs] = useState([]);
  const folderId = "1qb8-tesI1rQjNLlRuVE7fDot5xiNgeO8"; // your Drive folder

  useEffect(() => {
    fetch("/list-pdfs/1qb8-tesI1rQjNLlRuVE7fDot5xiNgeO8") // had to hardcode due to CORS issues
      .then(res => res.json())
      .then(data => {
        if (data.pdfs) {
          setPdfs(data.pdfs);
        }
      })
      .catch(err => console.error("Error fetching PDFs:", err));
  }, []);

  const settings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: Math.min(3, pdfs.length),
    slidesToScroll: 1
  };

  if (pdfs.length === 0) {
    return <div style={{ textAlign: "center", marginTop: "50px" }}>Loading...</div>;
  }

  return (
    <div className="landing-page">
      <h1>StoryWeave Chronicles</h1>
      <Slider {...settings}>
        {pdfs.map((pdf) => (
          <div key={pdf.id} className="carousel-item">
            <img
              src={`/pdf-cover/${pdf.id}`}
              alt={pdf.name}
              style={{ width: "100%", height: "auto" }}
            />
            <p>{pdf.name}</p>
          </div>
        ))}
      </Slider>
    </div>
  );
}
