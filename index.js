// index.js

const { GoogleAuth } = require("google-auth-library");
const { google } = require("googleapis");
const { VertexAI } = require("@google-cloud/vertexai");
const readlineSync = require("readline-sync");
const path = require("path");
const fs = require("fs");

// --- Configuration ---
const SERVICE_ACCOUNT_FILE = path.join(__dirname, "credentials.json");
const SPREADSHEET_ID = "1uyWTJ6sWMcoSu7o4bAiJ0eXWauJKC0car3yyWbEk3Vc"; // <--- IMPORTANT: REPLACE THIS!
const WORKSHEET_NAME = "Sheet1"; // The exact name of your sheet within the spreadsheet

// --- Vertex AI / Gemini Configuration ---
const PROJECT_ID = "sheet-gemini-poc"; // <--- IMPORTANT: REPLACE WITH YOUR GCP PROJECT ID
const LOCATION = "asia-south1"; // Or your preferred region for Vertex AI
const MODEL_NAME = "gemini-1.5-flash"; // Or 'gemini-1.5-pro-001'
const API_VERSION = "v1beta"; // Keep this as v1beta for now

// Scopes for Google Sheets API (read/write access)
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
      // First, get all values to find the row index
      const allValuesResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.worksheetName}!A:D`, // Get enough columns to find item name and quantity
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
        return "Error: Missing expected column (Item Name, Quantity, or Last Updated) in your sheet headers. Please ensure the sheet has these exact headers.";
      }

      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        // Start from 1 to skip headers
        if (rows[i][itemColIndex]?.toLowerCase() === itemName.toLowerCase()) {
          rowIndex = i;
          break;
        }
      }

      if (rowIndex === -1) {
        return `Item '${itemName}' not found in inventory.`;
      }

      const currentRowNumber = rowIndex + 1; // Google Sheets is 1-indexed

      // Batch update for Quantity and Last Updated timestamp
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

// --- Main Application Logic ---
async function main() {
  // --- Authenticate Google Sheets API ---
  let authClient;
  try {
    const auth = new GoogleAuth({
      keyFile: SERVICE_ACCOUNT_FILE,
      scopes: SHEETS_SCOPES,
    });
    authClient = await auth.getClient();
    console.log("Sheets API Authentication successful!");
  } catch (err) {
    console.error("Sheets API Authentication failed:", err);
    console.error(
      "Please ensure the service account has appropriate roles (e.g., Editor) and credentials.json is valid."
    );
    process.exit(1);
  }

  const sheetsService = new SheetsService(authClient);
  await sheetsService.getSheetInstance(); // Verify connection to spreadsheet

  // --- Initialize Vertex AI for Gemini ---
  const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  const model = vertexAI.getGenerativeModel({ model: MODEL_NAME });
  console.log("Vertex AI Authentication successful!");

  console.log(`\n--- Gemini as Sheets Interface (${MODEL_NAME}) ---`);
  console.log(
    "You can now tell me what to do with your 'Inventory PoC' spreadsheet."
  );
  console.log("Try commands like:");
  console.log("- 'Read the inventory'");
  console.log("- 'Add a new item called Laptop, quantity 5, price 1200'");
  console.log("- 'Update the quantity of Mouse to 55'");
  console.log("- 'Exit' to quit.\n");

  // --- Define Tools for Gemini ---
  const tools = [
    {
      functionDeclarations: [
        {
          name: "readInventory",
          description:
            "Reads and lists all items currently in the inventory spreadsheet.",
          parameters: {
            type: "object",
            properties: {}, // No parameters needed
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

  const chat = model.startChat({ tools: tools });

  // --- Function to handle tool calls ---
  async function callTool(functionCall) {
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
          response: { content: `Error: Function ${name} is not implemented.` },
        },
      };
    }
  }

  // --- Conversational Loop ---
  while (true) {
    const prompt = readlineSync.question("You: ");

    if (prompt.toLowerCase() === "exit") {
      console.log("Exiting chat.");
      break;
    }

    try {
      const result = await chat.sendMessage(prompt);
      const response = result.response;

      if (
        response.candidates &&
        response.candidates[0] &&
        response.candidates[0].content &&
        response.candidates[0].content.parts &&
        response.candidates[0].content.parts[0] &&
        response.candidates[0].content.parts[0].functionCall
      ) {
        // Gemini wants to call a tool
        const functionCall =
          response.candidates[0].content.parts[0].functionCall;

        // Call the tool and get its response
        const toolResponse = await callTool(functionCall);

        // Send the tool's result back to Gemini to get the final human-readable answer
        const apiResponse = await chat.sendMessage([toolResponse]);
        // Access the text from the final API response
        if (
          apiResponse.response.candidates &&
          apiResponse.response.candidates[0] &&
          apiResponse.response.candidates[0].content &&
          apiResponse.response.candidates[0].content.parts &&
          apiResponse.response.candidates[0].content.parts[0] &&
          apiResponse.response.candidates[0].content.parts[0].text
        ) {
          console.log(
            "Gemini:",
            apiResponse?.response?.candidates?.[0]?.content?.parts?.[0].text
          );
        } else {
          console.log(
            "Gemini: (after tool call) No final text response or unexpected format."
          );
          console.log(
            "Gemini API Response Structure (after tool call):",
            JSON.stringify(apiResponse.response, null, 2)
          );
        }
      } else if (
        response.candidates &&
        response.candidates[0] &&
        response.candidates[0].content &&
        response.candidates[0].content.parts &&
        response.candidates[0].content.parts[0] &&
        response.candidates[0].content.parts[0].text
      ) {
        console.log("---- No Function Calls ----");
        console.log("Gemini:", response.candidates[0].content.parts[0].text);
      } else {
        console.log(
          "Gemini: No specific response or tool call generated, or text content is not in the expected format."
        );
        console.log(
          "Gemini Raw Response (first call - no tool):",
          JSON.stringify(response, null, 2)
        );
      }
    } catch (error) {
      console.error("Error communicating with Gemini:", error);
      console.log(
        "Gemini: I encountered an error. Please try rephrasing your request."
      );
    }
  }
}

main().catch(console.error);
