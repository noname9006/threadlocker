require('dotenv').config();
const { Client, Events, GatewayIntentBits } = require('discord.js');

// Log that the script is starting
console.log("Bot script starting...");

// Log the environment variables to check if they're loaded correctly
console.log('Dotenv loaded. Environment variables:');
console.log('CHANNEL_ID:', process.env.CHANNEL_ID);
console.log('MESSAGE_CONTENT:', process.env.MESSAGE_CONTENT);
console.log('DISCORD_TOKEN:', process.env.DISCORD_TOKEN);

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
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

    // Lock previous thread if there was one
    if (lastThreadId) {
      try {
        console.log(`Attempting to lock the previous thread with ID: ${lastThreadId}`);

        const oldThread = await client.channels.fetch(lastThreadId);
        if (oldThread && !oldThread.locked) {
          console.log(`Sending message and locking previous thread: ${oldThread.name}`);
          await oldThread.send(MESSAGE_CONTENT);
          await oldThread.setLocked(true);
          console.log(`Locked previous thread: ${oldThread.name}`);
        } else {
          console.log(`Thread ${lastThreadId} is already locked or not found.`);
        }
      } catch (error) {
        console.error('Error handling previous thread:', error);
      }
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