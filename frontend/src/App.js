import "@/App.css";
import { HashRouter, Routes, Route } from "react-router-dom";
import SwimPlanner from "@/pages/SwimPlanner";
import SharedSession from "@/pages/SharedSession";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";

function App() {
  return (
    <ErrorBoundary>
      <div className="App">
        <HashRouter>
          <Routes>
            <Route path="/" element={<SwimPlanner />} />
            {/* Hash-encoded shared session. */}
            <Route path="/s" element={<SharedSession />} />
          </Routes>
        </HashRouter>
        <Toaster position="top-center" richColors />
      </div>
    </ErrorBoundary>
  );
}

export default App;
