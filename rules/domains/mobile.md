## Mobile Domain Rules

- [WARN] MEMORY LEAKS: All event listeners, subscriptions, and timers MUST be cleaned up on component unmount or screen blur. Use cleanup functions in useEffect returns, dispose patterns, or lifecycle callbacks.
- [WARN] MAIN THREAD: Never perform file I/O, network calls, JSON parsing of large payloads, or image processing on the main/UI thread. Use background threads, workers, or async dispatch. UI must remain responsive at 60fps.
- [WARN] PERMISSIONS: Always check permission status before accessing camera, location, contacts, or storage. Handle denied state gracefully with explanation UI. Never crash on permission denial.
- [WARN] OFFLINE FIRST: Network calls must handle timeout and offline states. Cache critical data locally. Show meaningful UI when offline, not blank screens or spinners.
- [STRICT] BATTERY OPTIMIZATION: Avoid polling patterns. Use push notifications, background fetch with minimum intervals, or event-driven updates. Location tracking uses significant-change mode, not continuous GPS.
- [STRICT] DEEP LINKING: All navigation routes must handle deep links correctly. Validate deep link parameters before navigating. Never trust URL parameters for authentication state.
- [STRICT] SECURE STORAGE: Sensitive data (tokens, PII) stored in platform secure storage (Keychain/EncryptedSharedPreferences), never in AsyncStorage/UserDefaults/plain SharedPreferences.
- [STRICT] IMAGE OPTIMIZATION: Resize images before upload (max 2048px). Cache downloaded images. Use progressive loading (thumbnail → full). Lazy load offscreen images.
- [CRITICAL] APP TRANSPORT: HTTPS required for all API calls. Certificate pinning for sensitive endpoints. No cleartext traffic exceptions without explicit security review.
- [CRITICAL] BIOMETRIC AUTH: Biometric authentication guards local access only. Never send biometric data to server. Fallback to passcode. Invalidate on biometric enrollment change.
