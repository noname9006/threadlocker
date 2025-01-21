require('dotenv').config();
const { Client, Events, GatewayIntentBits, performance } = require('discord.js');

// Constants and Cache Configuration
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX_OPS = 5;
const RATE_LIMIT_WINDOW = 10000;
const RETRY_MAX_ATTEMPTS = 2;
const BATCH_SIZE = 5;

// Utility Classes
class RateLimit {
  constructor(maxOperations = RATE_LIMIT_MAX_OPS, timeWindow = RATE_LIMIT_WINDOW) {
    this.operations = new Map();
    this.maxOperations = maxOperations;
    this.timeWindow = timeWindow;
  }

  async canProceed(threadId) {
    const now = Date.now();
    const recentOps = this.operations.get(threadId) || [];
    const validOps = recentOps.filter(time => now - time < this.timeWindow);
    
    if (validOps.length >= this.maxOperations) {
      return false;
    }
    
    validOps.push(now);
    this.operations.set(threadId, validOps);
    return true;
  }
}

class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
  }

  start(operation) {
    this.metrics.set(operation, performance.now());
  }

  end(operation) {
    const startTime = this.metrics.get(operation);
    if (startTime) {
      const duration = performance.now() - startTime;
      console.log(`Operation "${operation}" took ${duration.toFixed(2)}ms`);
      this.metrics.delete(operation);
    }
  }
}

// Cache and Utility Instances
let threadCache = {
  timestamp: 0,
  threads: []
};

const rateLimit = new RateLimit();
const perfMonitor = new PerformanceMonitor();

// Utility Functions
function validateConfig() {
  const requiredEnvVars = ['DISCORD_TOKEN', 'CHANNEL_ID', 'MESSAGE_CONTENT'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
}

async function withRetry(operation, maxRetries = RETRY_MAX_ATTEMPTS) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      console.log(`Retry attempt ${attempt} of ${maxRetries}`);
    }
  }
}

async function getThreadsWithCache(channel) {
  const now = Date.now();
  if (now - threadCache.timestamp < CACHE_DURATION) {
    return threadCache.threads;
  }

  const activeThreads = await channel.threads.fetchActive();
  const archivedThreads = await channel.threads.fetchArchived();
  const allThreads = [...activeThreads.threads.values(), ...archivedThreads.threads.values()];
  
  threadCache = {
    timestamp: now,
    threads: allThreads
  };
  
  return allThreads;
}

async function processThread(thread, isSecondLatest = false) {
  if (thread.archived) {
    console.log(`Unarchiving thread: ${thread.name}`);
    await thread.setArchived(false);
  }

  if (isSecondLatest) {
    console.log(`Sending message to second latest thread: ${thread.name}`);
    await thread.send(process.env.MESSAGE_CONTENT);
  }

  if (!thread.locked) {
    console.log(`Locking thread: ${thread.name}`);
    await thread.setLocked(true);
  }
}

async function processThreadsBatch(threads, newThreadId) {
  const batches = [];
  for (let i = 0; i < threads.length; i += BATCH_SIZE) {
    batches.push(threads.slice(i, i + BATCH_SIZE));
  }

  let secondLatestProcessed = false;

  for (const batch of batches) {
    await Promise.all(batch.map(async thread => {
      if (thread.id === newThreadId) return; // Skip the newest thread
      
      if (await rateLimit.canProceed(thread.id)) {
        const isSecondLatest = !secondLatestProcessed && thread.id !== newThreadId;
        if (isSecondLatest) secondLatestProcessed = true;
        
        await processThread(thread, isSecondLatest);
      }
    }));
  }
}

// Bot Configuration
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
];

// Create client instance
const client = new Client({ intents });

// Environment Variables
const CHANNEL_ID = process.env.CHANNEL_ID;
let lastThreadId = null;

// Initialization
try {
  validateConfig();
} catch (error) {
  console.error('Configuration error:', error.message);
  process.exit(1);
}

// Bot Event Handlers
client.once(Events.ClientReady, readyClient => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.ThreadCreate, async thread => {
  perfMonitor.start('threadProcessing');
  console.log('ThreadCreate event triggered');
  console.log('Thread ID:', thread.id);
  console.log('Parent ID:', thread.parentId);
  console.log('Thread Name:', thread.name);

  if (thread.parentId !== CHANNEL_ID) {
    perfMonitor.end('threadProcessing');
    return;
  }

  try {
    await withRetry(async () => {
      const channel = await client.channels.fetch(CHANNEL_ID);
      const allThreads = await getThreadsWithCache(channel);
      
      // Filter and sort threads
      const unlockedThreads = allThreads
        .filter(t => !t.locked)
        .sort((a, b) => b.createdAt - a.createdAt);

      if (unlockedThreads.length >= 2) {
        await processThreadsBatch(unlockedThreads, thread.id);
      }
    });

    lastThreadId = thread.id;
    console.log(`Updated lastThreadId to: ${lastThreadId}`);
  } catch (error) {
    console.error('Error in thread processing:', error);
  } finally {
    perfMonitor.end('threadProcessing');
  }
});

client.on(Events.Error, error => {
  console.error('Discord client error:', error);
});

// Bot Login
client.login(process.env.DISCORD_TOKEN)
  .then(() => {
    console.log('Bot logged in successfully!');
  })
  .catch((err) => {
    console.error('Failed to log in:', err);
    process.exit(1);
  });

// Graceful Shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT. Cleaning up...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Cleaning up...');
  client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});