# Aks (अक्स) — Frontend Web Application

React 19 + Vite literary reading sanctuary, personal journal workspace, and PDF viewer.

## Features

- **Reading Sanctuary**: Two-page desktop book spread, single-page responsive mobile layout, custom cover selection, and page-turn soundscapes.
- **Personal Journal & Notes**: Multi-pane literary workspace with TipTap ProseMirror rich text engine, custom notebooks, typography controls, and honest debounced autosave.
- **Multilingual Search Drawer**: In-reader search across native and OCR-indexed text with transient bounding-box highlights and Devanagari normalizations.

## Environment Variables

Copy `.env.example` to `.env`:

```bash
VITE_API_URL=http://localhost:5050
```

## Running Locally

```bash
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

## Building for Production

```bash
npm run build
npm run preview
```

## Running via Docker

```bash
docker build -t aks-frontend .
docker run -p 80:80 aks-frontend
```
