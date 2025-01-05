require('dotenv').config();
const { Client, Events, GatewayIntentBits } = require('discord.js');

// Log that the script is starting
console.log("Script is running...");

// Log the environment variables to check if they're loaded correctly
console.log('Environment variables loaded:', process.env.CHANNEL_ID, process.env.MESSAGE_CONTENT, process.env.DISCORD_TOKEN);

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Channel ID and message content from environment variables
const CHANNEL_ID = process.env.CHANNEL_ID ? parseInt(process.env.CHANNEL_ID, 10) : null;
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
  try {
    console.log('Thread created:', thread.name); // Log thread creation

    // Check if the thread is in the specified channel
    if (thread.parentId === CHANNEL_ID) {
      console.log(`New thread created in the correct channel: ${thread.name}`);

      // If there was a previous thread, add a message and lock it
      if (lastThreadId) {
        try {
          const oldThread = await client.channels.fetch(lastThreadId);
          if (oldThread && !oldThread.locked) {
            // Add the message before locking the thread
            await oldThread.send(MESSAGE_CONTENT);
            await oldThread.setLocked(true);
            console.log(`Locked previous thread: ${oldThread.name}`);
          }
        } catch (error) {
          console.error('Error handling previous thread:', error);
        }
      }

      // Update the lastThreadId to the current thread
      lastThreadId = thread.id;
    }
  } catch (error) {
    console.error('Error handling new thread:', error);
  }
});

// Error handling for the client
client.on(Events.Error, error => {
  console.error('Discord client error:', error);
});