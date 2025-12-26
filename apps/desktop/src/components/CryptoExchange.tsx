import { useState, useMemo } from 'react';

interface Coin {
  id: string;
  symbol: string;
  name: string;
  price: number; // Price in USD
  change24h: number; // Percentage change
  volume: number;
  marketCap: number;
  icon: string; // Emoji or color
}

interface SwapQuote {
  fromAmount: number;
  toAmount: number;
  rate: number;
  priceImpact: number;
  fee: number;
}

// Mock cryptocurrency data
const COINS: Coin[] = [
  {
    id: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    price: 42500,
    change24h: 2.5,
    volume: 28500000000,
    marketCap: 835000000000,
    icon: '₿',
  },
  {
    id: 'ethereum',
    symbol: 'ETH',
    name: 'Ethereum',
    price: 2280,
    change24h: 1.8,
    volume: 15200000000,
    marketCap: 275000000000,
    icon: 'Ξ',
  },
  {
    id: 'ripple',
    symbol: 'XRP',
    name: 'Ripple',
    price: 2.15,
    change24h: 3.2,
    volume: 2500000000,
    marketCap: 115000000000,
    icon: '✕',
  },
  {
    id: 'cardano',
    symbol: 'ADA',
    name: 'Cardano',
    price: 1.05,
    change24h: 0.5,
    volume: 850000000,
    marketCap: 37000000000,
    icon: '◆',
  },
  {
    id: 'solana',
    symbol: 'SOL',
    name: 'Solana',
    price: 195,
    change24h: 4.2,
    volume: 3200000000,
    marketCap: 87000000000,
    icon: '◎',
  },
  {
    id: 'polygon',
    symbol: 'MATIC',
    name: 'Polygon',
    price: 0.95,
    change24h: 2.1,
    volume: 680000000,
    marketCap: 10500000000,
    icon: '⬡',
  },
  {
    id: 'chainlink',
    symbol: 'LINK',
    name: 'Chainlink',
    price: 28.50,
    change24h: 1.3,
    volume: 1850000000,
    marketCap: 13500000000,
    icon: '🔗',
  },
  {
    id: 'uniswap',
    symbol: 'UNI',
    name: 'Uniswap',
    price: 8.75,
    change24h: 2.9,
    volume: 420000000,
    marketCap: 6800000000,
    icon: '◈',
  },
  {
    id: 'monero',
    symbol: 'XMR',
    name: 'Monero',
    price: 185.50,
    change24h: 3.5,
    volume: 95000000,
    marketCap: 3250000000,
    icon: '₥',
  },
  {
    id: 'zcash',
    symbol: 'ZEC',
    name: 'Zcash',
    price: 28.75,
    change24h: 1.2,
    volume: 42000000,
    marketCap: 1200000000,
    icon: '⊙',
  },
  {
    id: 'dash',
    symbol: 'DASH',
    name: 'Dash',
    price: 32.10,
    change24h: 2.4,
    volume: 58000000,
    marketCap: 360000000,
    icon: '◎',
  },
  {
    id: 'firo',
    symbol: 'FIRO',
    name: 'Firo',
    price: 0.85,
    change24h: 1.8,
    volume: 12000000,
    marketCap: 95000000,
    icon: '◇',
  },
];

const DollarIcon = () => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
  </svg>
);

const ArrowsIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
  </svg>
);

export default function CryptoExchange() {
  const [fromCoin, setFromCoin] = useState<Coin>(COINS[0]);
  const [toCoin, setToCoin] = useState<Coin>(COINS[1]);
  const [fromAmount, setFromAmount] = useState<string>('1');
  const [showFromList, setShowFromList] = useState(false);
  const [showToList, setShowToList] = useState(false);
  const [searchFrom, setSearchFrom] = useState('');
  const [searchTo, setSearchTo] = useState('');

  // Calculate swap quote
  const quote: SwapQuote = useMemo(() => {
    const amount = parseFloat(fromAmount) || 0;
    const rate = fromCoin.price / toCoin.price;
    const toAmount = amount * rate;
    const priceImpact = 0.3; // 0.3% impact for smaller swaps
    const fee = toAmount * 0.003; // 0.3% fee

    return {
      fromAmount: amount,
      toAmount: toAmount - fee,
      rate,
      priceImpact,
      fee,
    };
  }, [fromAmount, fromCoin, toCoin]);

  // Filter coins based on search
  const filteredFromCoins = COINS.filter(
    (coin) =>
      coin.name.toLowerCase().includes(searchFrom.toLowerCase()) ||
      coin.symbol.toLowerCase().includes(searchFrom.toLowerCase())
  );

  const filteredToCoins = COINS.filter(
    (coin) =>
      coin !== fromCoin &&
      (coin.name.toLowerCase().includes(searchTo.toLowerCase()) ||
        coin.symbol.toLowerCase().includes(searchTo.toLowerCase()))
  );

  const handleSwap = () => {
    setFromCoin(toCoin);
    setToCoin(fromCoin);
    setFromAmount('1');
    setSearchFrom('');
    setSearchTo('');
    setShowFromList(false);
    setShowToList(false);
  };

  return (
    <div className="w-full h-full bg-surface-secondary flex flex-col">
      {/* Header */}
      <div className="bg-surface-tertiary border-b border-dark-900 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DollarIcon />
          <h1 className="text-xl font-bold text-text-primary">DEX Swap</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Main Content */}
        <div className="max-w-2xl mx-auto p-6 space-y-6">
          {/* Swap Card */}
          <div className="bg-surface-primary rounded-lg border border-dark-700 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-text-primary">Swap Tokens</h2>

            {/* From Section */}
            <div className="space-y-2">
              <label className="text-sm text-text-muted">From</label>
              <div className="bg-surface-elevated rounded-lg p-4 space-y-3">
                <input
                  type="number"
                  value={fromAmount}
                  onChange={(e) => setFromAmount(e.target.value)}
                  placeholder="0.0"
                  className="w-full text-3xl font-bold bg-transparent text-text-primary placeholder-text-muted focus:outline-none"
                />
                <button
                  onClick={() => setShowFromList(!showFromList)}
                  className="w-full flex items-center justify-between px-4 py-2 bg-surface-secondary rounded hover:bg-surface-tertiary transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{fromCoin.icon}</span>
                    <div className="text-left">
                      <div className="font-semibold text-text-primary">{fromCoin.symbol}</div>
                      <div className="text-xs text-text-muted">{fromCoin.name}</div>
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </button>

                {/* From Coin Dropdown */}
                {showFromList && (
                  <div className="mt-2 bg-surface-secondary rounded border border-dark-700 max-h-64 overflow-y-auto">
                    <div className="sticky top-0 bg-surface-secondary p-2">
                      <input
                        type="text"
                        placeholder="Search tokens..."
                        value={searchFrom}
                        onChange={(e) => setSearchFrom(e.target.value)}
                        className="w-full px-3 py-2 bg-surface-elevated rounded text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                      />
                    </div>
                    {filteredFromCoins.map((coin) => (
                      <button
                        key={coin.id}
                        onClick={() => {
                          setFromCoin(coin);
                          setShowFromList(false);
                          setSearchFrom('');
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-tertiary border-b border-dark-700 last:border-b-0"
                      >
                        <span className="text-2xl">{coin.icon}</span>
                        <div className="text-left flex-1">
                          <div className="font-semibold text-text-primary">{coin.symbol}</div>
                          <div className="text-xs text-text-muted">{coin.name}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-text-primary">
                            ${coin.price.toFixed(2)}
                          </div>
                          <div
                            className={`text-xs ${
                              coin.change24h >= 0 ? 'text-status-online' : 'text-status-error'
                            }`}
                          >
                            {coin.change24h >= 0 ? '+' : ''}{coin.change24h.toFixed(1)}%
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Swap Button */}
            <div className="flex justify-center">
              <button
                onClick={handleSwap}
                className="p-2 bg-primary-500 hover:bg-primary-600 rounded-full text-white transition-colors"
                title="Swap tokens"
              >
                <ArrowsIcon />
              </button>
            </div>

            {/* To Section */}
            <div className="space-y-2">
              <label className="text-sm text-text-muted">To</label>
              <div className="bg-surface-elevated rounded-lg p-4 space-y-3">
                <div className="text-3xl font-bold text-text-primary">
                  {quote.toAmount.toFixed(8)}
                </div>
                <button
                  onClick={() => setShowToList(!showToList)}
                  className="w-full flex items-center justify-between px-4 py-2 bg-surface-secondary rounded hover:bg-surface-tertiary transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{toCoin.icon}</span>
                    <div className="text-left">
                      <div className="font-semibold text-text-primary">{toCoin.symbol}</div>
                      <div className="text-xs text-text-muted">{toCoin.name}</div>
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </button>

                {/* To Coin Dropdown */}
                {showToList && (
                  <div className="mt-2 bg-surface-secondary rounded border border-dark-700 max-h-64 overflow-y-auto">
                    <div className="sticky top-0 bg-surface-secondary p-2">
                      <input
                        type="text"
                        placeholder="Search tokens..."
                        value={searchTo}
                        onChange={(e) => setSearchTo(e.target.value)}
                        className="w-full px-3 py-2 bg-surface-elevated rounded text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                      />
                    </div>
                    {filteredToCoins.map((coin) => (
                      <button
                        key={coin.id}
                        onClick={() => {
                          setToCoin(coin);
                          setShowToList(false);
                          setSearchTo('');
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-tertiary border-b border-dark-700 last:border-b-0"
                      >
                        <span className="text-2xl">{coin.icon}</span>
                        <div className="text-left flex-1">
                          <div className="font-semibold text-text-primary">{coin.symbol}</div>
                          <div className="text-xs text-text-muted">{coin.name}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-text-primary">
                            ${coin.price.toFixed(2)}
                          </div>
                          <div
                            className={`text-xs ${
                              coin.change24h >= 0 ? 'text-status-online' : 'text-status-error'
                            }`}
                          >
                            {coin.change24h >= 0 ? '+' : ''}{coin.change24h.toFixed(1)}%
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Swap Details */}
            <div className="bg-surface-secondary rounded p-4 space-y-2 text-sm">
              <div className="flex justify-between text-text-muted">
                <span>Exchange Rate</span>
                <span className="text-text-primary font-semibold">
                  1 {fromCoin.symbol} = {quote.rate.toFixed(8)} {toCoin.symbol}
                </span>
              </div>
              <div className="flex justify-between text-text-muted">
                <span>Price Impact</span>
                <span className="text-status-warning">{quote.priceImpact.toFixed(2)}%</span>
              </div>
              <div className="flex justify-between text-text-muted">
                <span>Exchange Fee</span>
                <span className="text-text-primary font-semibold">
                  {quote.fee.toFixed(8)} {toCoin.symbol}
                </span>
              </div>
            </div>

            {/* Execute Swap Button */}
            <button className="w-full py-3 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors">
              Swap Now
            </button>
          </div>

          {/* Market Overview */}
          <div className="bg-surface-primary rounded-lg border border-dark-700 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-text-primary">Market Overview</h2>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {COINS.map((coin) => (
                <div key={coin.id} className="flex items-center justify-between p-3 bg-surface-elevated rounded hover:bg-surface-secondary transition-colors">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-2xl">{coin.icon}</span>
                    <div>
                      <div className="font-semibold text-text-primary">{coin.symbol}</div>
                      <div className="text-xs text-text-muted">{coin.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-text-primary">
                      ${coin.price.toFixed(coin.price < 10 ? 4 : 2)}
                    </div>
                    <div
                      className={`text-sm font-semibold ${
                        coin.change24h >= 0 ? 'text-status-online' : 'text-status-error'
                      }`}
                    >
                      {coin.change24h >= 0 ? '+' : ''}{coin.change24h.toFixed(1)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
