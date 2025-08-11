import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import BooksViewer from "./components/BooksViewer";
import PDFReader from "./components/PDFReader";

export default function App() {
  return (
    <Router>
      <div>
        <header className="header" style={{ position: 'relative' }}>
          <h1 className="logo" style={{ marginRight: 'auto' }}>StoryWeave Chronicles</h1>
          <a
            href="/authorize"
            className="login-btn"
          >
            Log In
          </a>
        </header>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/view-pdf/:id" element={<BooksViewer />} />
          <Route path="/read/:id" element={<PDFReader />} />
        </Routes>
      </div>
    </Router>
  );
}
