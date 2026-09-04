import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import Nav from './components/Nav';
import Footer from './components/Footer';
import { ConfirmTxProvider } from './components/ConfirmTx';
import Home from './pages/Home';
import Portfolio from './pages/Portfolio';
import Activity from './pages/Activity';
import Roadmap from './pages/Roadmap';
import TokenPage from './pages/TokenPage';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Shell() {
  const [showTour, setShowTour] = useState(false);

  return (
    <div className="app-shell min-h-screen">
      <div className="mx-auto max-w-6xl px-6">
        <Nav onHowItWorks={() => setShowTour(true)} />
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Home showTour={showTour} onTourDone={() => setShowTour(false)} />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/roadmap" element={<Roadmap />} />
          <Route path="/token" element={<TokenPage />} />
          <Route path="*" element={<Home showTour={showTour} onTourDone={() => setShowTour(false)} />} />
        </Routes>
        <Footer />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ConfirmTxProvider>
        <Shell />
      </ConfirmTxProvider>
    </BrowserRouter>
  );
}
