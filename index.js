const TelegramBot = require("node-telegram-bot-api");
const { VertexAI } = require("@google-cloud/vertexai");
const { TELEGRAM_KEY } = require("./telegram.js");
const { GoogleAuth } = require("google-auth-library");
const { google } = require("googleapis");
const path = require("path");

// --- Configuration ---
const SERVICE_ACCOUNT_FILE = path.join(__dirname, "credentials.json");
const SPREADSHEET_ID = "1uyWTJ6sWMcoSu7o4bAiJ0eXWauJKC0car3yyWbEk3Vc";
const WORKSHEET_NAME = "Sheet1";
const PROJECT_ID = "sheet-gemini-poc";
const LOCATION = "asia-south1";
const MODEL_NAME = "gemini-1.5-flash";
const SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

// --- Sheets Service Class ---
class SheetsService {
  constructor(authClient) {
    this.sheets = google.sheets({ version: "v4", auth: authClient });
    this.spreadsheetId = SPREADSHEET_ID;
    this.worksheetName = WORKSHEET_NAME;
  }

  async getSheetInstance() {
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });
      console.log(
        `Connected to Spreadsheet: ${response.data.properties.title}`
      );
      return true;
    } catch (err) {
      console.error(
        `Error connecting to spreadsheet ${this.spreadsheetId}:`,
        err.message
      );
      if (err.code === 403) {
        console.error(
          "Please ensure the service account has 'Editor' access to this Google Sheet."
        );
      } else if (err.code === 404) {
        console.error("Spreadsheet not found. Check the ID.");
      }
      process.exit(1);
    }
  }

  async readInventory() {
    console.log("\n--- Reading Current Inventory ---");
    try {
      const range = `${this.worksheetName}!A:D`;
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: range,
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return "No data found in inventory.";
      }

      const headers = rows[0];
      const data = rows.slice(1).map((row) => {
        const item = {};
        headers.forEach((header, index) => {
          item[header] = row[index] || "";
        });
        return item;
      });

      let output = "Current Inventory:\n";
      data.forEach((item) => {
        output += `- Item: ${item["Name"]}, Quantity: ${item["Quantity"]}, Price: $${item["Price"]}, Last Updated: ${item["Last Updated"]}\n`;
      });
      return output;
    } catch (err) {
      console.error("The API returned an error reading data:", err.message);
      return "Failed to read inventory.";
    }
  }

  async addRow(itemName, quantity, price) {
    console.log(`\n--- Attempting to add new item: ${itemName} ---`);
    try {
      const currentTime = new Date()
        .toLocaleString("en-CA", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
        .replace(/,/, "");
      const values = [itemName, quantity, price, currentTime];
      const range = this.worksheetName;

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: range,
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [values],
        },
      });
      return `Successfully added '${itemName}' to the inventory.`;
    } catch (err) {
      console.error("The API returned an error adding row:", err.message);
      return `Failed to add '${itemName}'.`;
    }
  }

  async updateItemQuantity(itemName, newQuantity) {
    console.log(
      `\n--- Attempting to update item: ${itemName} to quantity ${newQuantity} ---`
    );
    try {
      const allValuesResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.worksheetName}!A:D`,
      });

      const rows = allValuesResponse.data.values;
      if (!rows || rows.length === 0) {
        return `Item '${itemName}' not found (sheet is empty).`;
      }

      const headers = rows[0];
      const itemColIndex = headers.indexOf("Name");
      const quantityColIndex = headers.indexOf("Quantity");
      const lastUpdatedColIndex = headers.indexOf("Last Updated");

      if (
        itemColIndex === -1 ||
        quantityColIndex === -1 ||
        lastUpdatedColIndex === -1
      ) {
        return "Error: Missing expected column (Item Name, Quantity, or Last Updated) in your sheet headers.";
      }

      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][itemColIndex]?.toLowerCase() === itemName.toLowerCase()) {
          rowIndex = i;
          break;
        }
      }

      if (rowIndex === -1) {
        return `Item '${itemName}' not found in inventory.`;
      }

      const currentRowNumber = rowIndex + 1;
      const currentTime = new Date()
        .toLocaleString("en-CA", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
        .replace(/,/, "");

      const requests = [
        {
          range: `${this.worksheetName}!${String.fromCharCode(
            65 + quantityColIndex
          )}${currentRowNumber}`,
          values: [[newQuantity]],
        },
        {
          range: `${this.worksheetName}!${String.fromCharCode(
            65 + lastUpdatedColIndex
          )}${currentRowNumber}`,
          values: [[currentTime]],
        },
      ];

      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          valueInputOption: "USER_ENTERED",
          data: requests,
        },
      });

      return `Updated quantity of '${itemName}' to ${newQuantity}.`;
    } catch (err) {
      console.error("The API returned an error updating item:", err.message);
      return `Failed to update '${itemName}'.`;
    }
  }
}

// Initialize Telegram Bot
const bot = new TelegramBot(TELEGRAM_KEY, {
  polling: true,
  filepath: false,
});

// Add error handling
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

bot.on("error", (error) => {
  console.error("Bot error:", error);
});

// Store chat sessions
const chatSessions = new Map();

// Initialize the bot
async function initializeBot() {
  try {
    // Authenticate Google Sheets API
    const auth = new GoogleAuth({
      keyFile: SERVICE_ACCOUNT_FILE,
      scopes: SHEETS_SCOPES,
    });
    const authClient = await auth.getClient();
    console.log("Sheets API Authentication successful!");

    const sheetsService = new SheetsService(authClient);
    await sheetsService.getSheetInstance();

    // Initialize Vertex AI
    const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
    const model = vertexAI.getGenerativeModel({ model: MODEL_NAME });
    console.log("Vertex AI Authentication successful!");

    // Define tools for Gemini
    const tools = [
      {
        functionDeclarations: [
          {
            name: "readInventory",
            description:
              "Reads and lists all items currently in the inventory spreadsheet.",
            parameters: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "addRow",
            description:
              "Adds a new item with its quantity and price to the inventory spreadsheet.",
            parameters: {
              type: "object",
              properties: {
                itemName: {
                  type: "string",
                  description: "The name of the item to add.",
                },
                quantity: {
                  type: "number",
                  description: "The quantity of the new item.",
                },
                price: {
                  type: "number",
                  description: "The price of a single unit of the new item.",
                },
              },
              required: ["itemName", "quantity", "price"],
            },
          },
          {
            name: "updateItemQuantity",
            description:
              "Updates the quantity of an existing item in the inventory spreadsheet.",
            parameters: {
              type: "object",
              properties: {
                itemName: {
                  type: "string",
                  description:
                    "The name of the item whose quantity needs to be updated.",
                },
                newQuantity: {
                  type: "number",
                  description: "The new quantity for the item.",
                },
              },
              required: ["itemName", "newQuantity"],
            },
          },
        ],
      },
    ];

    // Handle incoming messages
    bot.on("message", async (msg) => {
      const chatId = msg.chat.id;

      // Only process text messages
      if (!msg.text) {
        return;
      }

      console.log("message", msg.text);

      try {
        // Get or create chat session
        if (!chatSessions.has(chatId)) {
          chatSessions.set(chatId, model.startChat({ tools: tools }));
        }
        const chat = chatSessions.get(chatId);

        // Process message with Gemini
        const result = await chat.sendMessage(msg.text);
        const response = result.response;

        if (response.candidates?.[0]?.content?.parts?.[0]?.functionCall) {
          // Handle function call
          const functionCall =
            response.candidates[0].content.parts[0].functionCall;
          const toolResponse = await callTool(functionCall, sheetsService);

          // Send function result back to Gemini
          const apiResponse = await chat.sendMessage([toolResponse]);
          const finalResponse =
            apiResponse?.response?.candidates?.[0]?.content?.parts?.[0]?.text;

          if (finalResponse) {
            await bot.sendMessage(chatId, finalResponse);
          } else {
            await bot.sendMessage(
              chatId,
              "I encountered an error processing your request. Please try again."
            );
          }
        } else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
          // Direct text response
          await bot.sendMessage(
            chatId,
            response.candidates[0].content.parts[0].text
          );
        } else {
          await bot.sendMessage(
            chatId,
            "I couldn't process your request. Please try again."
          );
        }
      } catch (error) {
        console.error("Error processing message:", error);
        await bot.sendMessage(
          chatId,
          "Sorry, I encountered an error. Please try again."
        );
      }
    });

    // Function to handle tool calls
    async function callTool(functionCall, sheetsService) {
      const { name, args } = functionCall;
      console.log(
        `\nGemini requested to call function: ${name} with args:`,
        args
      );

      if (sheetsService[name] && typeof sheetsService[name] === "function") {
        try {
          const result = await sheetsService[name](...Object.values(args));
          return {
            functionResponse: {
              name: name,
              response: { content: result },
            },
          };
        } catch (error) {
          console.error(`Error executing tool ${name}:`, error);
          return {
            functionResponse: {
              name: name,
              response: {
                content: `Error: Failed to execute tool ${name}. ${error.message}`,
              },
            },
          };
        }
      } else {
        console.error(`Error: Function ${name} not found in sheetsService.`);
        return {
          functionResponse: {
            name: name,
            response: {
              content: `Error: Function ${name} is not implemented.`,
            },
          },
        };
      }
    }

    console.log("Bot is ready to receive messages!");
  } catch (error) {
    console.error("Error initializing bot:", error);
    process.exit(1);
  }
}

// Start the bot
initializeBot().catch(console.error);
