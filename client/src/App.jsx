import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage"; // ✅ fixed to relative import
import BooksViewer from "./components/BooksViewer"; // ✅ fixed to relative import

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/read" element={<BooksViewer />} />
      </Routes>
    </Router>
  );
}

export default App;
