import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import BooksViewer from "./components/BooksViewer";
import PDFReader from "./components/PDFReader";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/view-pdf/:id" element={<BooksViewer />} />
        <Route path="/read/:id" element={<PDFReader />} />
      </Routes>
    </Router>
  );
}
