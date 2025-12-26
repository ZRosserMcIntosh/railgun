# Rail Gun Desktop

Electron + React desktop client for Rail Gun with end-to-end encryption.

## Features

- 🔐 End-to-end encrypted messaging (Signal protocol)
- 🖥️ Native macOS app with custom title bar
- 💬 Real-time messaging via WebSocket
- 👥 Communities and channels
- 🟢 Presence indicators
- 🔑 Secure token storage via Electron safeStorage

## Tech Stack

- **Electron** - Desktop app framework
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Fast bundler
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **Socket.io Client** - WebSocket connection

## Development

```bash
# From monorepo root
pnpm install
pnpm dev:desktop

# Or from this directory
pnpm dev
```

## Build

```bash
# Build for current platform
pnpm build

# Build macOS .app and .dmg
pnpm build:mac
```

## Structure

```
apps/desktop/
├── electron/
│   ├── main.ts          # Electron main process
│   └── preload.ts       # Preload script for IPC
├── src/
│   ├── main.tsx         # React entry point
│   ├── App.tsx          # Root component with routing
│   ├── components/
│   │   ├── ui/          # Reusable UI components
│   │   ├── Sidebar.tsx  # Communities and channels
│   │   ├── ChatArea.tsx # Message list and input
│   │   └── UserPanel.tsx# User settings panel
│   ├── layouts/
│   │   └── MainLayout.tsx # Main app layout
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   └── RegisterPage.tsx
│   ├── stores/
│   │   ├── authStore.ts # Auth state (Zustand)
│   │   └── chatStore.ts # Chat state (Zustand)
│   └── lib/
│       ├── api.ts       # REST API client
│       └── socket.ts    # WebSocket client
├── index.html
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

## Security

- Context isolation enabled
- Node integration disabled
- Sandbox mode enabled
- CSP headers configured
- Secure token storage using OS keychain
