# CLAUDE.md

This file guides Claude Code (claude.ai/code) when working in this repository.

## Project

A small REST CRUD API for "tutorials" built with Node.js, Express 4 and the `mysql` driver (raw SQL, no ORM). It is based on the bezkoder tutorial and is meant to serve a separate frontend (see the Frontend section) running on `http://localhost:8081`.

## Commands

- Install: `npm install`
- Run: `npm start`, which runs `node --env-file-if-exists=.env server.js` and listens on `PORT` (default `8080`). Plain `node server.js` does not load `.env`.
- There are no tests, linter or build step. `npm test` only prints an error.

## Architecture

The code is plain CommonJS with a route → controller → model layout:

- `server.js` is the entry point. It sets up CORS (only `http://localhost:8081` is allowed), JSON and urlencoded body parsing, and `GET /`, then mounts the tutorial routes.
- `app/routes/tutorial.routes.js` exports `(app) => {...}`, which builds an `express.Router` and mounts it at `/api/tutorials`.
- `app/controllers/tutorial.controller.js` holds the request handlers. They validate input, call the model and map errors to HTTP status codes.
- `app/models/tutorial.model.js` is a constructor function with static methods (`create`, `findById`, `getAll`, `getAllPublished`, `updateById`, `remove`, `removeAll`). These use Node-style callbacks `result(err, data)`. A missing row is reported as `result({ kind: "not_found" }, null)`, which the controller turns into a 404.
- `app/models/db.js` exports one shared `mysql.createPool` built from `app/config/db.config.js`.

### Endpoints (`/api/tutorials`)

| Method | Path         | Handler            |
|--------|--------------|--------------------|
| POST   | `/`          | `create`           |
| GET    | `/`          | `findAll` (`?title=` filters with LIKE) |
| GET    | `/published` | `findAllPublished` |
| GET    | `/:id`       | `findOne`          |
| PUT    | `/:id`       | `update`           |
| DELETE | `/:id`       | `delete`           |
| DELETE | `/`          | `deleteAll`        |

The `/published` route must stay registered before `/:id`, or `:id` will catch it.

### Database

The repo has no schema or migration file. The model expects a `tutorials` table with these columns:

```sql
CREATE TABLE IF NOT EXISTS `tutorials` (
  id int(11) NOT NULL PRIMARY KEY AUTO_INCREMENT,
  title varchar(255) NOT NULL,
  description varchar(255),
  published BOOLEAN DEFAULT false
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

Connection settings come from environment variables (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`), which `app/config/db.config.js` reads. Put them in a local `.env` file (copy `.env.example`). `.env` is gitignored, so never commit real credentials.

## Frontend

The React frontend lives in its own repository at `../react-tutorials-client`. It runs on http://localhost:8081, which is the only origin the CORS setting in `server.js` allows. If you change routes, response shapes or CORS here, update that project to match.

## Known quirks (pre-existing; fix only when asked)

- **SQL injection:** `findById` and `getAll` put `id` and `title` straight into the SQL string. Other queries use `?` placeholders, and new queries should too.
- **Errors that look like success:** `getAll`, `getAllPublished`, `updateById`, `remove` and `removeAll` call `result(null, err)` when the DB fails. The controller therefore sends the error object back with a 200 instead of a 500.
- **Missing return after 400:** in `create` and `update`, the 400 for an empty body has no `return`, so the handler keeps running after it.
- **Partial PUT nulls fields:** `update` builds `new Tutorial(req.body)` and writes all three columns, so any field left out of the request becomes `NULL`.

## Conventions

- Use CommonJS (`require` / `module.exports`), double quotes, 2-space indent and callbacks rather than async/await, to match the existing code.
- Keep the route → controller → model split. Put SQL only in models and HTTP handling only in controllers.
