# Audibit - AI QA Assistant Extension

A Chrome extension that provides proactive QA assistance by analyzing web pages for UI/UX and security improvements using AI.

## Features

- 🔐 Google Authentication via Firebase
- 🤖 AI-powered UI/UX audits using Gemini 2.0 Flash
- 🔒 Security scanning and vulnerability detection
- 💳 Credit-based payment system with Arc Network (USDC)
- 📊 Audit history and payment tracking
- 🎯 Proactive detection with local heuristics

## Setup

### Prerequisites

- Node.js 20+
- Chrome browser
- Firebase project with Authentication and Firestore enabled
- Gemini API key

### Installation

1. **Clone and install dependencies:**

   ```bash
   cd extension
   npm install
   ```

2. **Configure environment variables:**

   Copy `.env.example` to `.env` and fill in your Firebase configuration:

   ```env
   VITE_FIREBASE_API_KEY=your_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   VITE_FIREBASE_APP_ID=your_app_id
   VITE_ARC_NETWORK_RPC_URL=https://rpc.arc.network
   VITE_FUNCTIONS_BASE_URL=http://localhost:5001/your_project/us-central1
   ```

3. **Firebase Console Setup:**
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Select your project
   - Navigate to **Authentication** → **Sign-in method**
   - Enable **Google** provider
   - Add authorized domain: `chrome-extension://YOUR_EXTENSION_ID`
   - For local development, also add `localhost`

4. **Build the extension:**

   ```bash
   npm run build
   ```

5. **Load in Chrome:**
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `extension/dist` folder

### Development

Run the development server with hot reload:

```bash
npm run dev
```

## Firebase Auth Configuration

The extension uses Firebase Auth with the web extension SDK (`firebase/auth/web-extension`) which is specifically designed for Chrome extensions. Key points:

- **Popup authentication:** Uses `signInWithPopup()` for Google OAuth
- **Session persistence:** Auth state is synced to `chrome.storage.local`
- **Background worker:** Service worker listens to auth state changes
- **Token management:** ID tokens are automatically refreshed and used for API calls

### Troubleshooting Auth Issues

If you encounter "auth/unauthorized-domain" errors:

1. Verify your extension ID in `chrome://extensions/`
2. Add `chrome-extension://YOUR_EXTENSION_ID` to Firebase authorized domains
3. Ensure the Firebase config in `.env` matches your Firebase Console
4. Check that `identity` permission is in `manifest.json`

## Architecture

```
extension/
├── src/
│   ├── background/       # Service worker for auth & messaging
│   ├── content/          # DOM monitoring & overlay injection
│   ├── popup/            # Extension popup UI
│   ├── devtools/         # DevTools panel for detailed audits
│   └── lib/              # Shared utilities (Firebase, API client)
├── manifest.json         # Extension manifest (MV3)
└── vite.config.ts        # Build configuration
```

## Testing

### Manual Testing Checklist

- [ ] Extension loads without errors
- [ ] Google Sign-in popup opens and completes
- [ ] Auth state persists after closing popup
- [ ] Credits display correctly
- [ ] Audit triggers and shows results
- [ ] Payment flow completes

### Automated Tests

```bash
npm run test
```

## License

MIT
