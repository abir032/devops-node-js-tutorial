import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as TutorialService from "../services/tutorialService.js";

export default function Tutorial() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tutorial, setTutorial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    TutorialService.get(id)
      .then((data) => setTutorial({ ...data, published: !!data.published }))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setTutorial({ ...tutorial, [name]: value });
  };

  // The backend PUT overwrites every column, so always send the full object.
  const save = async (changes = {}) => {
    const next = { ...tutorial, ...changes };
    setError("");
    setMessage("");
    try {
      const data = await TutorialService.update(id, {
        title: next.title,
        description: next.description,
        published: next.published
      });
      setTutorial({ ...next, ...data, published: !!data.published });
      setMessage("The tutorial was updated successfully!");
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete this tutorial?")) return;
    try {
      await TutorialService.remove(id);
      navigate("/tutorials");
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) return <p className="muted">Loading…</p>;

  if (!tutorial) {
    return (
      <div className="card narrow">
        <p className="alert error">{error || "Tutorial not found."}</p>
        <Link to="/tutorials">Back to list</Link>
      </div>
    );
  }

  return (
    <form
      className="card narrow"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h2>Edit tutorial #{tutorial.id}</h2>
      {error && <p className="alert error">{error}</p>}
      {message && <p className="alert success">{message}</p>}
      <label>
        Title
        <input name="title" value={tutorial.title || ""} onChange={handleChange} required />
      </label>
      <label>
        Description
        <textarea name="description" rows="3" value={tutorial.description || ""} onChange={handleChange} />
      </label>
      <p><strong>Status:</strong> {tutorial.published ? "Published" : "Pending"}</p>

      <div className="actions">
        <button type="button" className="secondary" onClick={() => save({ published: !tutorial.published })}>
          {tutorial.published ? "Unpublish" : "Publish"}
        </button>
        <button type="submit">Update</button>
        <button type="button" className="danger" onClick={remove}>Delete</button>
        <Link to="/tutorials" className="button secondary">Back</Link>
      </div>
    </form>
  );
}
