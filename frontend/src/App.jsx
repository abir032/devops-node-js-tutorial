import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import TutorialsList from "./components/TutorialsList.jsx";
import AddTutorial from "./components/AddTutorial.jsx";
import Tutorial from "./components/Tutorial.jsx";

export default function App() {
  return (
    <>
      <nav className="navbar">
        <span className="brand">Tutorials</span>
        <NavLink to="/tutorials">List</NavLink>
        <NavLink to="/add">Add</NavLink>
      </nav>
      <main className="container">
        <Routes>
          <Route path="/" element={<Navigate to="/tutorials" replace />} />
          <Route path="/tutorials" element={<TutorialsList />} />
          <Route path="/tutorials/:id" element={<Tutorial />} />
          <Route path="/add" element={<AddTutorial />} />
        </Routes>
      </main>
    </>
  );
}
