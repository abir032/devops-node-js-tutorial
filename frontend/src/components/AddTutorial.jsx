import { useState } from "react";
import { Link } from "react-router-dom";
import * as TutorialService from "../services/tutorialService.js";

const empty = { title: "", description: "", published: false };

export default function AddTutorial() {
  const [tutorial, setTutorial] = useState(empty);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setTutorial({ ...tutorial, [name]: type === "checkbox" ? checked : value });
  };

  const save = async (e) => {
    e.preventDefault();
    if (!tutorial.title.trim()) {
      setError("Title is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      setCreated(await TutorialService.create(tutorial));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setTutorial(empty);
    setCreated(null);
  };

  if (created) {
    return (
      <div className="card narrow">
        <p className="alert success">Tutorial "{created.title}" was created (id {created.id}).</p>
        <div className="actions">
          <button onClick={reset}>Add another</button>
          <Link className="button secondary" to="/tutorials">Back to list</Link>
        </div>
      </div>
    );
  }

  return (
    <form className="card narrow" onSubmit={save}>
      <h2>Add tutorial</h2>
      {error && <p className="alert error">{error}</p>}
      <label>
        Title
        <input name="title" value={tutorial.title} onChange={handleChange} required />
      </label>
      <label>
        Description
        <textarea name="description" rows="3" value={tutorial.description} onChange={handleChange} />
      </label>
      <label className="checkbox">
        <input type="checkbox" name="published" checked={tutorial.published} onChange={handleChange} />
        Published
      </label>
      <button type="submit" disabled={saving}>{saving ? "Saving…" : "Submit"}</button>
    </form>
  );
}
