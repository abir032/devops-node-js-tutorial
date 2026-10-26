# CLAUDE.md

This file guides Claude Code (claude.ai/code) when working in this repository.

## Project

A React UI for the tutorials REST API in the separate backend repo [devops-tutorials-client-app-backend](https://github.com/abir032/devops-tutorials-client-app-backend) (Express + MySQL), checked out locally at `../nodejs-express-mysql`. It is built with React 19, Vite and React Router 7, and has no other runtime dependencies.

## Commands

- Install: `npm install`
- Dev server: `npm run dev`, which runs on http://localhost:8081 (`strictPort`)
- Production build: `npm run build` writes to `dist/`. Preview it with `npm run preview`, also on port 8081.
- There are no tests or linter.

You need the backend running (`node server.js` in `../nodejs-express-mysql`, port 8080) to use the app.

## Architecture

- `src/services/tutorialService.js` is the only module that talks to the API, using `fetch`. The base URL comes from `VITE_API_URL` (see `.env.example`) and defaults to `http://localhost:8080/api`. It maps each backend endpoint to a function: `getAll(title)`, `getPublished`, `get`, `create`, `update`, `remove`, `removeAll`.
- `src/App.jsx` defines the navbar and the routes: `/tutorials` (list), `/tutorials/:id` (edit), `/add` (create).
- `src/components/` has one component per page: `TutorialsList.jsx` (search, published-only filter, detail panel, "Remove all"), `AddTutorial.jsx` and `Tutorial.jsx` (update, publish/unpublish, delete).
- All styles are in `src/index.css`, using CSS variables and no UI library.

## Constraints from the backend

- **Port 8081 is required:** the backend's CORS allows only `http://localhost:8081`. If you change the port, update `corsOptions` in the backend's `server.js` too.
- **Updates must send every field:** PUT overwrites all columns and sets missing ones to NULL, so `update()` always sends `title`, `description` and `published` together.
- **`published` is 0 or 1:** MySQL returns it as a number, so convert it with `!!` before using it as a boolean.
- **DB errors can come back as a 200:** some backend model methods do this, and `request()` treats a response body with `code` and `sqlMessage` as an error.

## Conventions

Use function components with hooks, ES modules, double quotes and 2-space indent. Keep API calls inside `tutorialService.js`.
