require('dotenv').config();
const { Client, Events, GatewayIntentBits } = require('discord.js');

// Log that the script is starting
console.log("Bot script starting...");

// Log the environment variables to check if they're loaded correctly
console.log('Dotenv loaded. Environment variables:');
console.log('CHANNEL_ID:', process.env.CHANNEL_ID);
console.log('MESSAGE_CONTENT:', process.env.MESSAGE_CONTENT);
console.log('DISCORD_TOKEN:', process.env.DISCORD_TOKEN);

// Ensure that all required intents are correctly loaded
const intents = [
  GatewayIntentBits.Guilds,            
  GatewayIntentBits.GuildMessages,      
  GatewayIntentBits.MessageContent,  
  GatewayIntentBits.GuildThreads,     
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

    // Fetch all threads in the monitored channel
    try {
      const channel = await client.channels.fetch(CHANNEL_ID);
      const threads = await channel.threads.fetchActive(); // Fetch active threads in the channel

      // Lock all threads that were created before the new one and are not locked
      threads.threads.forEach(async (existingThread) => {
        if (existingThread.id !== thread.id && existingThread.createdAt < thread.createdAt) {
          try {
            console.log(`Attempting to lock thread: ${existingThread.name} (ID: ${existingThread.id})`);

            // Only send the message and lock the thread if it's not already locked
            if (!existingThread.locked) {
              console.log(`Thread ${existingThread.name} is not locked. Sending message and locking.`);
              await existingThread.send(MESSAGE_CONTENT);
              await existingThread.setLocked(true);
              console.log(`Locked thread: ${existingThread.name}`);
            } else {
              console.log(`Thread ${existingThread.name} is already locked.`);
            }
          } catch (error) {
            console.error('Error handling existing thread:', error);
          }
        }
      });

    } catch (error) {
      console.error('Error fetching threads:', error);
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
