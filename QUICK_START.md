# Audibit Extension - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### 1. Install Dependencies

```bash
cd extension
npm install
```

### 2. Environment Setup

The `.env` file is already configured with Firebase credentials. No changes needed unless you're using a different Firebase project.

### 3. Build Extension

```bash
npm run build
```

### 4. Load in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `extension/dist` folder
5. Copy your **Extension ID** (looks like: `abcdefghijklmnopqrstuvwxyz123456`)

### 5. Configure Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select project: **w3bn3xt**
3. Navigate to **Authentication** → **Sign-in method**
4. Enable **Google** provider (if not already enabled)
5. Scroll to **Authorized domains**
6. Add: `chrome-extension://YOUR_EXTENSION_ID` (use the ID from step 4)
7. Save changes

### 6. Test Authentication

1. Click the Audibit extension icon in Chrome
2. Click **Sign in with Google**
3. Complete the Google OAuth flow
4. You should see your email in the popup ✓

## 🔧 Development Mode

For development with hot reload:

```bash
npm run dev
```

Then load the extension from `extension/dist` as described above.

## 📋 Quick Troubleshooting

### "auth/unauthorized-domain" Error

→ Add your extension ID to Firebase authorized domains (see step 5 above)

### Popup Blocked

→ Disable popup blockers for the extension

### Auth Not Persisting

→ Check service worker is running: `chrome://extensions/` → **Inspect service worker**

### Build Errors

→ Ensure Node.js 20+ is installed: `node --version`

## 📚 Documentation

- **Detailed Setup:** See `FIREBASE_SETUP.md`
- **All Changes:** See `CHANGES_SUMMARY.md`
- **Full README:** See `extension/README.md`
- **Tasks Status:** See `tasks.md`

## 🎯 What's Working

✅ Firebase Authentication with Google Sign-in  
✅ Auth state persistence across sessions  
✅ Service worker auth management  
✅ Credit balance display  
✅ Audit history tracking  
✅ Payment history tracking

## 🚧 What's Next

- [ ] Arc Network wallet connection
- [ ] Credit purchase flow
- [ ] Live audit triggering
- [ ] DevTools panel integration

## 🆘 Need Help?

1. Check browser console: `F12` → Console
2. Check service worker console: `chrome://extensions/` → **Inspect service worker**
3. Review `FIREBASE_SETUP.md` for detailed troubleshooting
4. Verify all environment variables in `.env`

## 🔑 Key Files

- `extension/src/popup/Popup.tsx` - Main UI
- `extension/src/background/service-worker.ts` - Auth management
- `extension/src/lib/firebase.ts` - Firebase config
- `extension/manifest.json` - Extension manifest
- `extension/.env` - Environment variables

## 💡 Pro Tips

- Use `chrome://extensions/` to reload the extension after changes
- Check service worker console for background errors
- Use React DevTools for debugging UI components
- Firebase emulators are configured for local development

---

**Ready to build?** Run `npm run build` and load the extension! 🎉
