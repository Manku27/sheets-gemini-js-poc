// index.js

const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");

// --- Configuration ---
// Path to your service account key file
// Make sure 'credentials.json' is in the same directory as this script.
const SERVICE_ACCOUNT_FILE = path.join(__dirname, "credentials.json");
const SPREADSHEET_ID = "1uyWTJ6sWMcoSu7o4bAiJ0eXWauJKC0car3yyWbEk3Vc"; // <--- IMPORTANT: REPLACE THIS!
const WORKSHEET_NAME = "Sheet1"; // The exact name of your sheet within the spreadsheet

// Scopes required for Google Sheets API (read/write access)
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

async function getAuthClient() {
  // Load credentials from file
  let credentials;
  try {
    credentials = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, "utf8"));
  } catch (err) {
    console.error(
      `Error reading service account file at ${SERVICE_ACCOUNT_FILE}:`,
      err
    );
    console.error(
      "Please ensure 'credentials.json' exists and is a valid JSON file."
    );
    process.exit(1);
  }

  const auth = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    SCOPES
  );

  try {
    await auth.authorize();
    console.log("Authentication successful!");
    return auth;
  } catch (err) {
    console.error("Authentication failed:", err);
    console.error(
      "Please ensure the service account email (found in credentials.json) has 'Editor' access to your Google Sheet."
    );
    process.exit(1);
  }
}

async function readInventory(sheets, spreadsheetId, range) {
  console.log("\n--- Current Inventory ---");
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range, // e.g., 'Sheet1!A1:D' to get all data
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log("No data found.");
      return [];
    }

    const headers = rows[0];
    const data = rows.slice(1).map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = row[index] || ""; // Handle missing cells
      });
      return item;
    });

    data.forEach((item) => {
      console.log(
        `Item: ${item["Name"]}, Quantity: ${item["Quantity"]}, Price: $${item["Price"]}, Last Updated: ${item["Last Updated"]}`
      );
    });
    return data;
  } catch (err) {
    console.error("The API returned an error reading data: " + err);
    return [];
  }
}

async function addRowToSheet(sheets, spreadsheetId, range, values) {
  console.log(`\n--- Adding New Item: ${values[0]} ---`);
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range, // e.g., 'Sheet1' or 'Sheet1!A1'
      valueInputOption: "USER_ENTERED", // Raw values will be parsed as if entered by a user
      resource: {
        values: [values],
      },
    });
    console.log(`Successfully added '${values[0]}' to the inventory.`);
    return response.data;
  } catch (err) {
    console.error("The API returned an error adding row: " + err);
  }
}

async function updateItemQuantity(
  sheets,
  spreadsheetId,
  worksheetName,
  itemName,
  newQuantity
) {
  console.log(`\n--- Updating Item: ${itemName} ---`);
  try {
    // First, get all values to find the row index
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${worksheetName}!A:D`, // Get enough columns to find item name and quantity
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log(`Item '${itemName}' not found (sheet is empty).`);
      return;
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
      console.error(
        "Error: Missing expected column (Item Name, Quantity, or Last Updated) in your sheet headers."
      );
      return;
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
      console.log(`Item '${itemName}' not found in inventory.`);
      return;
    }

    const currentRowNumber = rowIndex + 1; // Google Sheets is 1-indexed

    // Update Quantity
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${worksheetName}!${String.fromCharCode(
        65 + quantityColIndex
      )}${currentRowNumber}`, // e.g., 'Sheet1!B2'
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [[newQuantity]],
      },
    });

    // Update Last Updated timestamp
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
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${worksheetName}!${String.fromCharCode(
        65 + lastUpdatedColIndex
      )}${currentRowNumber}`, // e.g., 'Sheet1!D2'
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [[currentTime]],
      },
    });

    console.log(`Updated quantity of '${itemName}' to ${newQuantity}.`);
  } catch (err) {
    console.error("The API returned an error updating item: " + err);
  }
}

async function main() {
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  // --- READ INVENTORY ---
  await readInventory(sheets, SPREADSHEET_ID, `${WORKSHEET_NAME}!A:D`);

  // --- ADD NEW ITEM ---
  const newItemName = "Cookies";
  const newQuantity = 20;
  const newPrice = 75;
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
  await addRowToSheet(sheets, SPREADSHEET_ID, WORKSHEET_NAME, [
    newItemName,
    newQuantity,
    newPrice,
    currentTime,
  ]);

  // Read again to see the added item
  await readInventory(sheets, SPREADSHEET_ID, `${WORKSHEET_NAME}!A:D`);

  // --- UPDATE EXISTING ITEM QUANTITY ---
  await updateItemQuantity(sheets, SPREADSHEET_ID, WORKSHEET_NAME, "Laptop", 8);

  // Read again to see the updated item
  await readInventory(sheets, SPREADSHEET_ID, `${WORKSHEET_NAME}!A:D`);
}

main().catch(console.error);
