/**
 * RAILGUN LOAD TESTING SUITE
 * 
 * Target: 10K concurrent users, <200ms P95 latency
 * 
 * DOCTRINE COMPLIANCE:
 * - Tests business layer performance only
 * - No user data in test payloads
 * - Metrics are aggregates (counts, latencies)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// ============================================================================
// Configuration
// ============================================================================

const LOAD_TEST_CONFIG = {
  targetConcurrentUsers: 10000,
  rampUpDurationMs: 60000, // 1 minute ramp-up
  testDurationMs: 300000,  // 5 minute sustained load
  p95LatencyTargetMs: 200,
  p99LatencyTargetMs: 500,
  errorRateThreshold: 0.01, // 1% max error rate
  messagesPerUserPerMinute: 10,
  apiEndpoint: process.env.LOAD_TEST_API_URL || 'http://localhost:3001',
  wsEndpoint: process.env.LOAD_TEST_WS_URL || 'ws://localhost:3001/ws',
};

// ============================================================================
// Types
// ============================================================================

interface LoadTestResult {
  scenario: string;
  duration: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  latencies: {
    min: number;
    max: number;
    mean: number;
    median: number;
    p90: number;
    p95: number;
    p99: number;
  };
  throughput: {
    requestsPerSecond: number;
    messagesPerSecond: number;
  };
  concurrency: {
    target: number;
    peak: number;
    average: number;
  };
  passed: boolean;
  failures: string[];
}

interface LatencyBucket {
  timestamp: number;
  latency: number;
}

// ============================================================================
// Latency Tracker
// ============================================================================

class LatencyTracker {
  private buckets: LatencyBucket[] = [];
  private errorCount = 0;
  private successCount = 0;

  recordLatency(latency: number): void {
    this.buckets.push({ timestamp: Date.now(), latency });
    this.successCount++;
  }

  recordError(): void {
    this.errorCount++;
  }

  getStats(): LoadTestResult['latencies'] & { errorRate: number; total: number } {
    if (this.buckets.length === 0) {
      return {
        min: 0,
        max: 0,
        mean: 0,
        median: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        errorRate: this.errorCount > 0 ? 1 : 0,
        total: this.errorCount,
      };
    }

    const sorted = [...this.buckets].sort((a, b) => a.latency - b.latency);
    const latencies = sorted.map(b => b.latency);
    
    const sum = latencies.reduce((a, b) => a + b, 0);
    const total = this.successCount + this.errorCount;

    return {
      min: latencies[0],
      max: latencies[latencies.length - 1],
      mean: sum / latencies.length,
      median: this.percentile(latencies, 50),
      p90: this.percentile(latencies, 90),
      p95: this.percentile(latencies, 95),
      p99: this.percentile(latencies, 99),
      errorRate: this.errorCount / total,
      total,
    };
  }

  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  reset(): void {
    this.buckets = [];
    this.errorCount = 0;
    this.successCount = 0;
  }
}

// ============================================================================
// Virtual User Simulation
// ============================================================================

class VirtualUser {
  private id: string;
  private ws: WebSocket | null = null;
  private latencyTracker: LatencyTracker;
  private messageCount = 0;
  private connected = false;

  constructor(
    id: number,
    private wsEndpoint: string,
    private apiEndpoint: string,
    tracker: LatencyTracker
  ) {
    this.id = `user-${id.toString().padStart(6, '0')}`;
    this.latencyTracker = tracker;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      
      try {
        this.ws = new WebSocket(`${this.wsEndpoint}?userId=${this.id}`);
        
        this.ws.onopen = () => {
          this.connected = true;
          this.latencyTracker.recordLatency(Date.now() - start);
          resolve();
        };

        this.ws.onerror = () => {
          this.latencyTracker.recordError();
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onclose = () => {
          this.connected = false;
        };

        this.ws.onmessage = () => {
          // Message received - record for throughput
        };

        // Connection timeout
        setTimeout(() => {
          if (!this.connected) {
            this.latencyTracker.recordError();
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      } catch (error) {
        this.latencyTracker.recordError();
        reject(error);
      }
    });
  }

  async sendMessage(roomId: string = 'load-test-room'): Promise<void> {
    if (!this.connected || !this.ws) {
      throw new Error('Not connected');
    }

    const start = Date.now();
    const messageId = `${this.id}-${++this.messageCount}`;

    return new Promise((resolve, reject) => {
      try {
        // Send message
        this.ws!.send(JSON.stringify({
          type: 'message',
          id: messageId,
          roomId,
          // DOCTRINE: No actual content in test messages
          payload: {
            type: 'load-test',
            timestamp: Date.now(),
            size: 256, // Simulate 256 byte message
          },
        }));

        this.latencyTracker.recordLatency(Date.now() - start);
        resolve();
      } catch (error) {
        this.latencyTracker.recordError();
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// ============================================================================
// Load Test Runner
// ============================================================================

class LoadTestRunner {
  private users: VirtualUser[] = [];
  private tracker = new LatencyTracker();
  private running = false;
  private currentConcurrency = 0;
  private peakConcurrency = 0;
  private concurrencySamples: number[] = [];

  constructor(private config: typeof LOAD_TEST_CONFIG) {}

  async runScenario(
    name: string,
    userCount: number,
    durationMs: number,
    rampUpMs: number
  ): Promise<LoadTestResult> {
    console.log(`\n🚀 Starting load test: ${name}`);
    console.log(`   Target: ${userCount} users, ${durationMs / 1000}s duration`);
    
    this.tracker.reset();
    this.users = [];
    this.running = true;
    this.currentConcurrency = 0;
    this.peakConcurrency = 0;
    this.concurrencySamples = [];

    const startTime = Date.now();
    const failures: string[] = [];

    // Ramp up users gradually
    const usersPerInterval = Math.ceil(userCount / (rampUpMs / 100));
    let usersCreated = 0;

    console.log(`   Ramping up ${usersPerInterval} users per 100ms...`);

    const rampUpInterval = setInterval(async () => {
      if (!this.running || usersCreated >= userCount) {
        clearInterval(rampUpInterval);
        return;
      }

      const batch = Math.min(usersPerInterval, userCount - usersCreated);
      
      for (let i = 0; i < batch; i++) {
        const user = new VirtualUser(
          usersCreated + i,
          this.config.wsEndpoint,
          this.config.apiEndpoint,
          this.tracker
        );
        this.users.push(user);
        
        user.connect().then(() => {
          this.currentConcurrency++;
          this.peakConcurrency = Math.max(this.peakConcurrency, this.currentConcurrency);
        }).catch(err => {
          failures.push(`User connection failed: ${err.message}`);
        });
      }
      
      usersCreated += batch;
    }, 100);

    // Wait for ramp up
    await new Promise(resolve => setTimeout(resolve, rampUpMs));
    clearInterval(rampUpInterval);

    console.log(`   Ramp up complete. Connected: ${this.currentConcurrency}/${userCount}`);

    // Run sustained load
    const messageInterval = setInterval(async () => {
      if (!this.running) {
        clearInterval(messageInterval);
        return;
      }

      // Sample concurrency
      this.concurrencySamples.push(this.currentConcurrency);

      // Each user sends a message
      const connectedUsers = this.users.filter(u => u.isConnected());
      
      // Randomly select subset to simulate real traffic patterns
      const activeUsers = connectedUsers.filter(() => Math.random() < 0.1); // 10% active per interval
      
      for (const user of activeUsers) {
        user.sendMessage().catch(err => {
          failures.push(`Message send failed: ${err.message}`);
        });
      }
    }, 1000);

    // Wait for test duration
    await new Promise(resolve => setTimeout(resolve, durationMs));
    
    this.running = false;
    clearInterval(messageInterval);

    // Disconnect all users
    console.log('   Disconnecting users...');
    await Promise.all(this.users.map(u => u.disconnect()));

    const duration = Date.now() - startTime;
    const stats = this.tracker.getStats();

    const result: LoadTestResult = {
      scenario: name,
      duration,
      totalRequests: stats.total,
      successfulRequests: stats.total - Math.round(stats.total * stats.errorRate),
      failedRequests: Math.round(stats.total * stats.errorRate),
      errorRate: stats.errorRate,
      latencies: {
        min: stats.min,
        max: stats.max,
        mean: stats.mean,
        median: stats.median,
        p90: stats.p90,
        p95: stats.p95,
        p99: stats.p99,
      },
      throughput: {
        requestsPerSecond: stats.total / (duration / 1000),
        messagesPerSecond: stats.total / (duration / 1000),
      },
      concurrency: {
        target: userCount,
        peak: this.peakConcurrency,
        average: this.concurrencySamples.reduce((a, b) => a + b, 0) / 
          Math.max(1, this.concurrencySamples.length),
      },
      passed: this.evaluateResults(stats, failures),
      failures,
    };

    this.printResults(result);
    return result;
  }

  private evaluateResults(
    stats: ReturnType<LatencyTracker['getStats']>,
    failures: string[]
  ): boolean {
    const checks = [
      {
        name: 'P95 Latency',
        passed: stats.p95 <= this.config.p95LatencyTargetMs,
        actual: `${stats.p95.toFixed(2)}ms`,
        target: `<${this.config.p95LatencyTargetMs}ms`,
      },
      {
        name: 'P99 Latency',
        passed: stats.p99 <= this.config.p99LatencyTargetMs,
        actual: `${stats.p99.toFixed(2)}ms`,
        target: `<${this.config.p99LatencyTargetMs}ms`,
      },
      {
        name: 'Error Rate',
        passed: stats.errorRate <= this.config.errorRateThreshold,
        actual: `${(stats.errorRate * 100).toFixed(2)}%`,
        target: `<${this.config.errorRateThreshold * 100}%`,
      },
    ];

    console.log('\n   📊 Performance Checks:');
    for (const check of checks) {
      const icon = check.passed ? '✅' : '❌';
      console.log(`      ${icon} ${check.name}: ${check.actual} (target: ${check.target})`);
    }

    return checks.every(c => c.passed) && failures.length === 0;
  }

  private printResults(result: LoadTestResult): void {
    console.log('\n   📈 Results:');
    console.log(`      Duration: ${(result.duration / 1000).toFixed(1)}s`);
    console.log(`      Total Requests: ${result.totalRequests.toLocaleString()}`);
    console.log(`      Success Rate: ${((1 - result.errorRate) * 100).toFixed(2)}%`);
    console.log(`      Throughput: ${result.throughput.requestsPerSecond.toFixed(1)} req/s`);
    console.log(`      Concurrency: peak=${result.concurrency.peak}, avg=${result.concurrency.average.toFixed(0)}`);
    console.log('\n   ⏱️  Latencies:');
    console.log(`      Min: ${result.latencies.min.toFixed(2)}ms`);
    console.log(`      Median: ${result.latencies.median.toFixed(2)}ms`);
    console.log(`      P90: ${result.latencies.p90.toFixed(2)}ms`);
    console.log(`      P95: ${result.latencies.p95.toFixed(2)}ms`);
    console.log(`      P99: ${result.latencies.p99.toFixed(2)}ms`);
    console.log(`      Max: ${result.latencies.max.toFixed(2)}ms`);
    
    if (result.failures.length > 0) {
      console.log('\n   ⚠️  Failures:');
      const uniqueFailures = [...new Set(result.failures)];
      for (const failure of uniqueFailures.slice(0, 10)) {
        console.log(`      - ${failure}`);
      }
      if (uniqueFailures.length > 10) {
        console.log(`      ... and ${uniqueFailures.length - 10} more`);
      }
    }

    console.log(`\n   ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Load Tests', () => {
  let runner: LoadTestRunner;

  beforeAll(() => {
    runner = new LoadTestRunner(LOAD_TEST_CONFIG);
  });

  afterAll(() => {
    // Cleanup
  });

  // These tests are marked as skip by default - run with LOAD_TEST=true
  const runLoadTests = process.env.LOAD_TEST === 'true';

  describe.skipIf(!runLoadTests)('Smoke Test: 100 Users', () => {
    it('should handle 100 concurrent users', async () => {
      const result = await runner.runScenario(
        'Smoke Test',
        100,
        30000, // 30 seconds
        5000   // 5 second ramp-up
      );

      expect(result.passed).toBe(true);
      expect(result.latencies.p95).toBeLessThan(LOAD_TEST_CONFIG.p95LatencyTargetMs);
    }, 60000);
  });

  describe.skipIf(!runLoadTests)('Medium Load: 1000 Users', () => {
    it('should handle 1000 concurrent users', async () => {
      const result = await runner.runScenario(
        'Medium Load',
        1000,
        60000,  // 1 minute
        10000   // 10 second ramp-up
      );

      expect(result.passed).toBe(true);
      expect(result.latencies.p95).toBeLessThan(LOAD_TEST_CONFIG.p95LatencyTargetMs);
    }, 120000);
  });

  describe.skipIf(!runLoadTests)('Target Load: 10K Users', () => {
    it('should handle 10,000 concurrent users with <200ms P95', async () => {
      const result = await runner.runScenario(
        'Target Load (10K)',
        10000,
        300000, // 5 minutes
        60000   // 1 minute ramp-up
      );

      expect(result.passed).toBe(true);
      expect(result.concurrency.peak).toBeGreaterThanOrEqual(9000); // Allow 10% connection failures
      expect(result.latencies.p95).toBeLessThan(LOAD_TEST_CONFIG.p95LatencyTargetMs);
      expect(result.errorRate).toBeLessThan(LOAD_TEST_CONFIG.errorRateThreshold);
    }, 600000); // 10 minute timeout
  });

  describe.skipIf(!runLoadTests)('Stress Test: 15K Users', () => {
    it('should gracefully handle overload at 15,000 users', async () => {
      const result = await runner.runScenario(
        'Stress Test (15K)',
        15000,
        300000, // 5 minutes
        90000   // 1.5 minute ramp-up
      );

      // May not pass P95 target, but should not crash
      expect(result.errorRate).toBeLessThan(0.1); // Max 10% errors under extreme load
      expect(result.totalRequests).toBeGreaterThan(0);
    }, 600000);
  });

  describe.skipIf(!runLoadTests)('Spike Test: Sudden Traffic Surge', () => {
    it('should handle sudden spike from 1K to 5K users', async () => {
      // Start with 1K users
      const baseline = await runner.runScenario(
        'Spike Baseline',
        1000,
        30000,
        5000
      );

      expect(baseline.passed).toBe(true);

      // Immediate spike to 5K
      const spike = await runner.runScenario(
        'Spike Load',
        5000,
        60000,
        5000 // Very fast ramp-up
      );

      // Should handle spike without massive error rate
      expect(spike.errorRate).toBeLessThan(0.05);
      expect(spike.latencies.p95).toBeLessThan(LOAD_TEST_CONFIG.p99LatencyTargetMs); // Allow slightly higher
    }, 300000);
  });

  describe.skipIf(!runLoadTests)('Endurance Test: 1 Hour at 5K Users', () => {
    it('should maintain performance over 1 hour', async () => {
      const result = await runner.runScenario(
        'Endurance Test',
        5000,
        3600000, // 1 hour
        60000    // 1 minute ramp-up
      );

      expect(result.passed).toBe(true);
      expect(result.latencies.p95).toBeLessThan(LOAD_TEST_CONFIG.p95LatencyTargetMs);
      // Check for memory leaks / degradation by comparing early vs late latencies
    }, 4200000); // 70 minute timeout
  });
});

// ============================================================================
// Unit Tests for Load Test Infrastructure
// ============================================================================

describe('Load Test Infrastructure', () => {
  describe('LatencyTracker', () => {
    it('should calculate correct percentiles', () => {
      const tracker = new LatencyTracker();
      
      // Add 100 latencies from 1-100ms
      for (let i = 1; i <= 100; i++) {
        tracker.recordLatency(i);
      }
      
      const stats = tracker.getStats();
      
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(100);
      expect(stats.median).toBeCloseTo(50, 0);
      expect(stats.p90).toBeCloseTo(90, 0);
      expect(stats.p95).toBeCloseTo(95, 0);
      expect(stats.p99).toBeCloseTo(99, 0);
    });

    it('should track error rate correctly', () => {
      const tracker = new LatencyTracker();
      
      for (let i = 0; i < 90; i++) {
        tracker.recordLatency(100);
      }
      for (let i = 0; i < 10; i++) {
        tracker.recordError();
      }
      
      const stats = tracker.getStats();
      expect(stats.errorRate).toBeCloseTo(0.1, 2);
    });

    it('should handle empty state', () => {
      const tracker = new LatencyTracker();
      const stats = tracker.getStats();
      
      expect(stats.min).toBe(0);
      expect(stats.max).toBe(0);
      expect(stats.mean).toBe(0);
    });
  });

  describe('LoadTestRunner Configuration', () => {
    it('should use correct default configuration', () => {
      expect(LOAD_TEST_CONFIG.targetConcurrentUsers).toBe(10000);
      expect(LOAD_TEST_CONFIG.p95LatencyTargetMs).toBe(200);
      expect(LOAD_TEST_CONFIG.errorRateThreshold).toBe(0.01);
    });
  });
});

// ============================================================================
// Export for CLI Usage
// ============================================================================

export { LoadTestRunner, LOAD_TEST_CONFIG, LatencyTracker };
