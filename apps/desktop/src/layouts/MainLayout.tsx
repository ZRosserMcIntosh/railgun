import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { socketClient } from '../lib/socket';
import { getMessagingService } from '../lib/messagingService';
import { initCrypto } from '../crypto';
import Sidebar from '../components/Sidebar';
import ChatArea from '../components/ChatArea';
import UserPanel from '../components/UserPanel';
import { VoipPage } from '../components/voip';
import BibleReader from '../components/BibleReader';
import CryptoExchange from '../components/CryptoExchange';
import { useFeature, usePremiumFeature, FeatureFlags } from '../hooks';
import { useAutoSignout } from '../hooks/useAutoSignout';

export default function MainLayout() {
  const { accessToken, user, logout, isTokensLoaded } = useAuthStore();
  const { currentChannelId } = useChatStore();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [cryptoReady, setCryptoReady] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  
  // Auto-signout timer
  useAutoSignout();
  
  // Feature flags
  const isDexEnabled = useFeature(FeatureFlags.DEX_SWAP);
  const { enabled: isVoipEnabled } = usePremiumFeature(FeatureFlags.VOIP_PHONE);
  const isBibleEnabled = useFeature(FeatureFlags.BIBLE_READER);
  
  // Check if we're on specific pages
  const isPhonePage = location.pathname === '/phone';
  const isBiblePage = location.pathname === '/bible';
  const isDexPage = location.pathname === '/dex';
  
  // Redirect from disabled features
  useEffect(() => {
    if (isDexPage && !isDexEnabled) {
      navigate('/', { replace: true });
    }
    if (isPhonePage && !isVoipEnabled) {
      navigate('/', { replace: true });
    }
    if (isBiblePage && !isBibleEnabled) {
      navigate('/', { replace: true });
    }
  }, [isDexPage, isDexEnabled, isPhonePage, isVoipEnabled, isBiblePage, isBibleEnabled, navigate]);

  // Initialize crypto and messaging service
  useEffect(() => {
    if (!user?.id || !isTokensLoaded || !accessToken) return;

    const initializeCrypto = async () => {
      try {
        console.log('[MainLayout] Initializing crypto...');
        await initCrypto();
        
        console.log('[MainLayout] Initializing messaging service...');
        const messagingService = getMessagingService();
        await messagingService.initialize(user.id);
        
        setCryptoReady(true);
        console.log('[MainLayout] Crypto and messaging ready');
      } catch (error) {
        console.error('[MainLayout] Failed to initialize crypto:', error);
      }
    };

    initializeCrypto();
  }, [user?.id, isTokensLoaded, accessToken]);

  // Connect WebSocket after crypto is ready
  useEffect(() => {
    if (!accessToken || !cryptoReady) return;

    let retryTimeout: NodeJS.Timeout | null = null;

    // Connect to WebSocket
    const connect = async () => {
      try {
        setConnecting(true);
        await socketClient.connect(accessToken);
        setConnected(true);
      } catch (error) {
        console.error('Failed to connect:', error);
        // If auth fails, logout
        if (error instanceof Error && error.message.includes('token')) {
          await logout();
        } else {
          // Retry connection after 5 seconds
          retryTimeout = setTimeout(() => {
            console.log('Retrying connection...');
            connect();
          }, 5000);
        }
      } finally {
        setConnecting(false);
      }
    };

    connect();

    // Set up connection handler
    const unsubConnection = socketClient.onConnection((isConnected) => {
      setConnected(isConnected);
    });

    return () => {
      unsubConnection();
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      socketClient.disconnect();
    };
  }, [accessToken, cryptoReady, logout]);

  return (
    <div className="h-screen flex bg-surface-tertiary">
      {/* Sidebar - Communities and Channels */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-12 bg-surface-primary border-b border-dark-900 flex items-center px-4 drag-region">
          <div className="no-drag flex items-center gap-2">
            {isPhonePage ? (
              <>
                <span className="text-green-500">📞</span>
                <h1 className="font-semibold text-text-primary">Anonymous Phone</h1>
              </>
            ) : isBiblePage ? (
              <>
                <span className="text-yellow-500">📖</span>
                <h1 className="font-semibold text-text-primary">Bible Reader</h1>
              </>
            ) : isDexPage ? (
              <>
                <span className="text-blue-500">💰</span>
                <h1 className="font-semibold text-text-primary">DEX Swap</h1>
              </>
            ) : (
              <>
                <span className="text-text-secondary">#</span>
                <h1 className="font-semibold text-text-primary">
                  {currentChannelId || 'general'}
                </h1>
              </>
            )}
          </div>
          <div className="flex-1" />
          <div className="no-drag flex items-center gap-2">
            {connecting ? (
              <span className="text-xs text-text-muted">Connecting...</span>
            ) : connected ? (
              <span className="flex items-center gap-1 text-xs text-status-online">
                <span className="w-2 h-2 rounded-full bg-status-online" />
                Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-status-offline">
                <span className="w-2 h-2 rounded-full bg-status-offline" />
                Disconnected
              </span>
            )}
          </div>
        </header>

        {/* Content Area - Routes between Chat, Phone, Bible, and DEX */}
        {isPhonePage ? <VoipPage /> : isBiblePage ? <BibleReader /> : isDexPage ? <CryptoExchange /> : <ChatArea />}
      </div>

      {/* User Panel */}
      <UserPanel user={user} onLogout={logout} />
    </div>
  );
}
