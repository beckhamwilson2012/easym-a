# EasyM&A — single service: Express serves the built React app + the APIs, and the upload
# pipeline shells out to poppler (pdftotext, pdftoppm) and tesseract for PDF text/OCR.
# Those binaries are the whole reason for Docker: Render's native Node runtime has no root
# and no apt, so they can't be installed there. Here apt puts them on PATH, and the app's
# binary resolver (uploadExtract.js) finds them via its PATH fallback — no code change.

FROM node:24-bookworm-slim

# OCR toolchain. --no-install-recommends keeps the layer small; the eng language data is the
# only tessdata we need. Clean the apt lists so they don't bloat the image layer.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so this layer is cached unless package*.json changes.
COPY package.json package-lock.json ./
RUN npm ci

# App source (node_modules, build/, .git, and the sweep harness are excluded via .dockerignore),
# then build the React client into build/, which server.js serves via express.static.
COPY . .
RUN CI=false npm run build

ENV NODE_ENV=production
# Render injects PORT at runtime; server.js reads process.env.PORT (falls back to 3001 locally).
EXPOSE 10000
CMD ["node", "server.js"]
