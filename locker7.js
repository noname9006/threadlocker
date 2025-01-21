require('dotenv').config();
const { Client, Events, GatewayIntentBits } = require('discord.js');

// Log that the script is starting
console.log("Bot script starting...");

// Log the environment variables to check if they're loaded correctly
console.log('Dotenv loaded. Environment variables:');
console.log('CHANNEL_ID:', process.env.CHANNEL_ID);

// Ensure that all required intents are correctly loaded
const intents = [
  GatewayIntentBits.Guilds,            
  GatewayIntentBits.GuildMessages,      
  GatewayIntentBits.MessageContent,      
];

// Log the intents to make sure they are correctly assigned
console.log('Bot Intents:', intents);

// Create a new client instance with validation
const client = new Client({
  intents: intents,
});

// Channel ID and message content from environment variables
const CHANNEL_ID = process.env.CHANNEL_ID ? process.env.CHANNEL_ID : null;
const MESSAGE_CONTENT = process.env.MESSAGE_CONTENT;
let lastThreadId = null;

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, readyClient => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Log in the bot and check if it's successful
client.login(process.env.DISCORD_TOKEN)
  .then(() => {
    console.log('Bot logged in successfully!');
  })
  .catch((err) => {
    console.error('Failed to log in:', err);
  });

// Listen for thread creation
client.on(Events.ThreadCreate, async thread => {
  console.log('ThreadCreate event triggered');
  console.log('Thread ID:', thread.id);
  console.log('Parent ID:', thread.parentId);
  console.log('Thread Name:', thread.name);

  // Check if the thread is in the specified channel
  if (thread.parentId === CHANNEL_ID) {
    console.log(`New thread created in the correct channel: ${thread.name}`);

    try {
      const channel = await client.channels.fetch(CHANNEL_ID);
      const activeThreads = await channel.threads.fetchActive();
      const archivedThreads = await channel.threads.fetchArchived();

      // Combine and sort all threads by creation date
      const allThreads = [...activeThreads.threads.values(), ...archivedThreads.threads.values()]
        .sort((a, b) => b.createdAt - a.createdAt);

      // Filter out the threads that are not locked yet
      const unlockedThreads = allThreads.filter(t => !t.locked);

      // If we have at least 2 threads (including the new one)
      if (unlockedThreads.length >= 2) {
        // Find the second latest thread (first one in unlockedThreads after the newest one)
        const secondLatestThread = unlockedThreads.find(t => t.id !== thread.id);

        if (secondLatestThread) {
          // Unarchive if needed and send message to second latest thread
          if (secondLatestThread.archived) {
            console.log(`Unarchiving second latest thread: ${secondLatestThread.name}`);
            await secondLatestThread.setArchived(false);
          }
          
          console.log(`Sending message to second latest thread: ${secondLatestThread.name}`);
          await secondLatestThread.send(MESSAGE_CONTENT);
        }

        // Lock all unlocked threads except the newest one
        for (const threadToLock of unlockedThreads) {
          // Skip the newest thread (the one that triggered this event)
          if (threadToLock.id === thread.id) continue;

          try {
            // Unarchive if needed before locking
            if (threadToLock.archived) {
              console.log(`Unarchiving thread before locking: ${threadToLock.name}`);
              await threadToLock.setArchived(false);
            }

            console.log(`Locking thread: ${threadToLock.name}`);
            await threadToLock.setLocked(true);
          } catch (error) {
            console.error(`Error handling thread ${threadToLock.name}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Error processing threads:', error);
    }

    // Update the lastThreadId to the current thread
    lastThreadId = thread.id;
    console.log(`Updated lastThreadId to: ${lastThreadId}`);
  }
});

// Error handling for the client
client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});