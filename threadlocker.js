require('dotenv').config();
const { Client, Events, GatewayIntentBits } = require('discord.js');
const { performance } = require('perf_hooks');

// Constants
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX_OPS = 5;
const RATE_LIMIT_WINDOW = 10000;
const RETRY_MAX_ATTEMPTS = 2;
const BATCH_SIZE = 5;
const OPERATION_DELAY = 100;

// Logging utility
function logWithTimestamp(message) {
    const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
    console.log(`[${timestamp}] ${message}`);
}

// Enhanced Thread Cache
class ThreadCache {
  constructor(duration = CACHE_DURATION) {
    this.cache = new Map();
    this.duration = duration;
    setInterval(() => this.cleanup(), duration);
  }

  set(channelId, threads) {
    this.cache.set(channelId, {
      timestamp: Date.now(),
      threads: threads
    });
  }

  get(channelId) {
    const data = this.cache.get(channelId);
    if (!data || Date.now() - data.timestamp > this.duration) {
      this.cache.delete(channelId);
      return null;
    }
    return data.threads;
  }

  cleanup() {
    const now = Date.now();
    for (const [channelId, data] of this.cache.entries()) {
      if (now - data.timestamp > this.duration) {
        this.cache.delete(channelId);
      }
    }
    logWithTimestamp('Cache cleanup completed');
  }
}

// Enhanced Rate Limit
class RateLimit {
  constructor(maxOperations = RATE_LIMIT_MAX_OPS, timeWindow = RATE_LIMIT_WINDOW) {
    this.operations = new Map();
    this.maxOperations = maxOperations;
    this.timeWindow = timeWindow;
    this.queue = new Map();
    
    setInterval(() => this.cleanup(), 60000);
  }

  cleanup() {
    const now = Date.now();
    for (const [threadId, ops] of this.operations.entries()) {
      const validOps = ops.filter(time => now - time < this.timeWindow);
      if (validOps.length === 0) {
        this.operations.delete(threadId);
      } else {
        this.operations.set(threadId, validOps);
      }
    }
    logWithTimestamp('Rate limit cleanup completed');
  }

  async canProceed(threadId) {
    const now = Date.now();
    const recentOps = this.operations.get(threadId) || [];
    const validOps = recentOps.filter(time => now - time < this.timeWindow);
    
    if (validOps.length >= this.maxOperations) {
      if (!this.queue.has(threadId)) {
        this.queue.set(threadId, []);
      }
      
      return new Promise(resolve => {
        this.queue.get(threadId).push(resolve);
        setTimeout(() => {
          const callbacks = this.queue.get(threadId) || [];
          const callback = callbacks.shift();
          if (callback) callback(true);
          if (callbacks.length === 0) this.queue.delete(threadId);
        }, this.timeWindow);
      });
    }
    
    validOps.push(now);
    this.operations.set(threadId, validOps);
    return true;
  }
}

// Enhanced Performance Monitor
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.history = new Map();
  }

  start(operation) {
    this.metrics.set(operation, {
      startTime: performance.now(),
      memory: process.memoryUsage()
    });
  }

  end(operation) {
    const data = this.metrics.get(operation);
    if (data) {
      const duration = performance.now() - data.startTime;
      const memoryDiff = {
        heapUsed: process.memoryUsage().heapUsed - data.memory.heapUsed
      };
      
      if (!this.history.has(operation)) {
        this.history.set(operation, []);
      }
      
      this.history.get(operation).push({ duration, memoryDiff });
      
      if (this.history.get(operation).length > 100) {
        this.history.get(operation).shift();
      }

      logWithTimestamp(`Operation "${operation}":
        Duration: ${duration.toFixed(2)}ms
        Memory Impact: ${(memoryDiff.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      
      this.metrics.delete(operation);
    }
  }

  getMetrics(operation) {
    return this.history.get(operation) || [];
  }
}

// Instances
const threadCache = new ThreadCache();
const rateLimit = new RateLimit();
const perfMonitor = new PerformanceMonitor();

// Enhanced Utility Functions
async function withRetry(operation, maxRetries = RETRY_MAX_ATTEMPTS) {
  let lastError;
  const delays = [1000, 2000, 4000];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;
      
      const delay = delays[attempt - 1] || delays[delays.length - 1];
      logWithTimestamp(`Retry attempt ${attempt} of ${maxRetries}. Waiting ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error(`Operation failed after ${maxRetries} attempts: ${lastError.message}`);
}

async function getThreadsWithCache(channel) {
  const cachedThreads = threadCache.get(channel.id);
  if (cachedThreads) {
    logWithTimestamp('Using cached threads');
    return cachedThreads;
  }

  logWithTimestamp('Fetching threads');
  const [activeThreads, archivedThreads] = await Promise.all([
    channel.threads.fetchActive(),
    channel.threads.fetchArchived()
  ]);
  
  const allThreads = [...activeThreads.threads.values(), ...archivedThreads.threads.values()];
  threadCache.set(channel.id, allThreads);
  
  return allThreads;
}

async function processThread(thread, isSecondLatest = false) {
  try {
    perfMonitor.start(`process-thread-${thread.id}`);
    logWithTimestamp(`Processing thread: ${thread.name} (ID: ${thread.id})`);

    if (!thread) {
      logWithTimestamp('Invalid thread object received');
      return;
    }

    if (thread.archived) {
      logWithTimestamp(`Unarchiving thread: ${thread.name}`);
      await thread.setArchived(false);
    }

    if (isSecondLatest) {
      logWithTimestamp(`Sending message to second latest thread: ${thread.name}`);
      await thread.send(process.env.MESSAGE_CONTENT);
    }

    if (!thread.locked) {
      logWithTimestamp(`Locking thread: ${thread.name}`);
      await thread.setLocked(true);
    }
  } catch (error) {
    logWithTimestamp(`Error processing thread ${thread?.name || 'unknown'}: ${error.message}`);
    throw error;
  } finally {
    perfMonitor.end(`process-thread-${thread.id}`);
  }
}

async function processThreadsBatch(threads, newThreadId) {
  const processedThreads = new Set();
  let secondLatestProcessed = false;

  for (let i = 0; i < threads.length; i += BATCH_SIZE) {
    const batch = threads.slice(i, i + BATCH_SIZE);
    
    for (const thread of batch) {
      if (thread.id === newThreadId || processedThreads.has(thread.id)) continue;
      
      if (await rateLimit.canProceed(thread.id)) {
        const isSecondLatest = !secondLatestProcessed && thread.id !== newThreadId;
        if (isSecondLatest) secondLatestProcessed = true;
        
        await processThread(thread, isSecondLatest);
        processedThreads.add(thread.id);
        
        await new Promise(resolve => setTimeout(resolve, OPERATION_DELAY));
      }
    }
  }
}

// Bot Configuration
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMembers
];

const client = new Client({ intents });
const CHANNEL_ID = process.env.CHANNEL_ID;

// Validation
function validateConfig() {
  const requiredEnvVars = ['DISCORD_TOKEN', 'CHANNEL_ID', 'MESSAGE_CONTENT'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
}

// Event Handlers
client.once(Events.ClientReady, readyClient => {
  logWithTimestamp(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.ThreadCreate, async thread => {
  perfMonitor.start('threadProcessing');
  logWithTimestamp('ThreadCreate event triggered');
  logWithTimestamp(`Thread ID: ${thread.id}`);
  logWithTimestamp(`Parent ID: ${thread.parentId}`);
  logWithTimestamp(`Thread Name: ${thread.name}`);

  if (thread.parentId !== CHANNEL_ID.toString()) {
    logWithTimestamp(`Thread parent ID ${thread.parentId} does not match CHANNEL_ID ${CHANNEL_ID}`);
    perfMonitor.end('threadProcessing');
    return;
  }

  try {
    await withRetry(async () => {
      const channel = await client.channels.fetch(CHANNEL_ID);
      const allThreads = await getThreadsWithCache(channel);

      const unlockedThreads = allThreads
        .filter(t => !t.locked)
        .sort((a, b) => b.createdAt - a.createdAt);

      if (unlockedThreads.length >= 2) {
        await processThreadsBatch(unlockedThreads, thread.id);
      } else {
        logWithTimestamp('Not enough unlocked threads to process');
      }
    });
  } catch (error) {
    logWithTimestamp(`Error in thread processing: ${error}`);
  } finally {
    perfMonitor.end('threadProcessing');
  }
});

client.on(Events.Error, error => {
  logWithTimestamp(`Discord client error: ${error}`);
});

// Initialization and Error Handling
try {
  validateConfig();
  client.login(process.env.DISCORD_TOKEN)
    .then(() => logWithTimestamp('Bot logged in successfully!'))
    .catch(err => {
      logWithTimestamp(`Failed to log in: ${err}`);
      process.exit(1);
    });
} catch (error) {
  logWithTimestamp(`Configuration error: ${error.message}`);
  process.exit(1);
}

// Graceful Shutdown
process.on('SIGINT', () => {
  logWithTimestamp('Received SIGINT. Cleaning up...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logWithTimestamp('Received SIGTERM. Cleaning up...');
  client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  logWithTimestamp(`Unhandled promise rejection: ${error}`);
});