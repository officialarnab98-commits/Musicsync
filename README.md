# MusicSync — YouTube Music Listen-Together App

A full-stack Node.js + WebSocket web app that links to your Google/YouTube Music account via **YouTube Data API v3**, plays songs using the **YouTube IFrame Player API**, and synchronizes playback in real time with your friend's phone.

## 1. Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000` in your browser.

## 2. Connect Your Google / YouTube Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Enable **YouTube Data API v3**.
3. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID** (Web application).
4. Add `http://localhost:3000` (and your deployed HTTPS URL, e.g. `https://your-app.onrender.com`) under **Authorized JavaScript origins**.
5. Copy the **Client ID**, click **Sign in** in MusicSync, paste the Client ID, and authorize with Google.

## 3. Listen Together on Two Phones

- Deploy this folder to **Render**, **Railway**, or **Fly.io** (free Node.js hosting with WebSocket support).
- Open the URL on your iPhone (Host) and tap **Share / Add to Home Screen** if you want it as a web app.
- Tap **Listen Together** → **Copy Link** and send it to your friend's mobile.
- Your friend opens the link, taps **Tap to Join & Sync**, and both phones play the same song in sync.
