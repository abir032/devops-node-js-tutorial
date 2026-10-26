import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as TutorialService from "../services/tutorialService.js";

export default function TutorialsList() {
  const [tutorials, setTutorials] = useState([]);
  const [current, setCurrent] = useState(null);
  const [searchTitle, setSearchTitle] = useState("");
  const [publishedOnly, setPublishedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async (title = searchTitle, onlyPublished = publishedOnly) => {
    setLoading(true);
    setError("");
    setCurrent(null);
    try {
      const data = onlyPublished
        ? await TutorialService.getPublished()
        : await TutorialService.getAll(title);
      setTutorials(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
      setTutorials([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setPublishedOnly(false);
    load(searchTitle, false);
  };

  const togglePublishedOnly = () => {
    const next = !publishedOnly;
    setPublishedOnly(next);
    load(searchTitle, next);
  };

  const removeAll = async () => {
    if (!window.confirm("Delete ALL tutorials? This cannot be undone.")) return;
    setError("");
    try {
      const res = await TutorialService.removeAll();
      setMessage(res?.message || "All tutorials deleted.");
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="list-page">
      <form className="search" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Search by title"
          value={searchTitle}
          onChange={(e) => setSearchTitle(e.target.value)}
        />
        <button type="submit">Search</button>
      </form>

      <label className="checkbox">
        <input type="checkbox" checked={publishedOnly} onChange={togglePublishedOnly} />
        Show published only
      </label>

      {error && <p className="alert error">{error}</p>}
      {message && <p className="alert success">{message}</p>}

      <div className="columns">
        <section>
          <h2>Tutorials list</h2>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : tutorials.length === 0 ? (
            <p className="muted">No tutorials found.</p>
          ) : (
            <ul className="list">
              {tutorials.map((t) => (
                <li
                  key={t.id}
                  className={current?.id === t.id ? "active" : ""}
                  onClick={() => setCurrent(t)}
                >
                  <span>{t.title}</span>
                  {!!t.published && <span className="badge">Published</span>}
                </li>
              ))}
            </ul>
          )}
          <button className="danger" onClick={removeAll} disabled={tutorials.length === 0}>
            Remove all
          </button>
        </section>

        <section>
          {current ? (
            <div className="card">
              <h2>Tutorial</h2>
              <p><strong>Title:</strong> {current.title}</p>
              <p><strong>Description:</strong> {current.description || <em className="muted">none</em>}</p>
              <p><strong>Status:</strong> {current.published ? "Published" : "Pending"}</p>
              <Link className="button" to={`/tutorials/${current.id}`}>Edit</Link>
            </div>
          ) : (
            <p className="muted">Click a tutorial to see its details.</p>
          )}
        </section>
      </div>
    </div>
  );
}
