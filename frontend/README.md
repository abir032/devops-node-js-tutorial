# React Tutorials Client

A React UI for the [backend](https://github.com/abir032/devops-tutorials-client-app-backend) tutorials REST API. You can list, search, create, edit, publish, delete and delete-all tutorials.

## Setup

```bash
npm install
cp .env.example .env   # optional, defaults to http://localhost:8080/api
npm run dev            # http://localhost:8081
```

Start the backend first (`node server.js`, port 8080). The app has to run on port 8081 because that is the only origin the backend's CORS allows.
