# VIT Vellore AutoFill & AutoLogin (Brave & Chrome Extension)

A lightweight, secure browser extension designed specifically for **VIT Vellore** students to automate logins on **VTOP** and **VIT Wi-Fi (Hostel/Campus)**, and track **Digital Assignment due dates**.

---

## 🚀 Key Features

### 1. 🎓 VTOP Portal Full Auto-Login
- **Auto-select "Student"**: Automatically detects the VTOP landing page with *Student / Employee / Parent / Alumni* and clicks **Student** for you.
- **Auto-fill Credentials**: Instantly fills your Registration Number (automatically uppercased) and Password.
- **Embedded AI Captcha Solver**:
  - Automatically extracts and decodes the 6-character VTOP captcha in milliseconds using an embedded, 100% offline CRNN neural network.
  - Automatically fills the solved captcha into the captcha field with validation events.
- **Auto-submit Login**: Automatically submits the login form via page validation, taking you directly inside VTOP without requiring manual clicks!
- **Google reCAPTCHA Awareness**: Intelligently detects Google reCAPTCHA challenges (e.g. 9-image grids), pauses auto-submit without loops, and automatically submits once verified.

### 2. 📋 Digital Assignments Due Tracker
- **Smart Upcoming Dues Column**:
  - Enhances VTOP's **Academics > Digital Assignment Upload** page with an `Upcoming Dues` column.
  - Automatically scans each registered course's assignments and identifies the next pending deadline.
  - Computes remaining days in real time (`30-Oct-2026 [3 days left]`).
  - Displays `[All Submitted]` when all assignments for a course are submitted.
  - When an assignment is uploaded, it automatically rolls over to the next un-uploaded assignment deadline!
- **Clean ERP Status UI**: Crisp, professional date and urgency tags that blend seamlessly with VTOP's table rows (no emojis, no bloated pills).
- **Click-to-Sort Deadlines**: Click the `Upcoming Dues ⇅` table header to sort courses by deadline urgency.
- **Navbar Quick Shortcut**: Elegant, translucent pill shortcut matching VTOP's native *Campus Etiquette* button for instant 1-click navigation to Assignment Upload.
- **Assignment Details Page Highlight**: In course assignment detail views, automatically highlights rows pending upload (`Pending Upload`).
- **Popup Due Dates Dashboard**: Open the extension popup anytime to view your upcoming deadlines without even logging into VTOP!

### 3. 📊 Examinations > Marks Live Aggregate (Numbers Only)
- **Automatic Aggregate Row**: Enhances every course mark subtable on **Examinations > Marks** with a live `Total / Aggregate` row pinned in `<tfoot>`.
- **Pure Numbers Only**: Sums Max Marks, Weightage, Scored Marks, and Weightage Marks without cluttering percentages.
- **Under-Table Summary Card**: Renders a sleek, responsive course summary card directly below each marks table highlighting Weightage Marks and Raw Scored Marks.
- **Non-blocking & Fast**: Signature caching and debouncing ensures zero page freezing, zero mutation loops, and zero network conflicts.
- **Dynamic Semester Switch Support**: Automatically recalculates in real-time when switching semesters via AJAX.

### 4. 📶 VIT Wi-Fi Auto-Login
- Supports the official captive portal (`phc.prontonetworks.com` and campus gateways).
- Automatically fills your Wi-Fi username and password (which can be different from your VTOP password).
- Automatically clicks **Login / Submit** to connect you to the internet immediately.

### 5. 🔒 100% Privacy & Security
- Credentials and the neural network solver operate strictly in your local browser using `chrome.storage.local`.
- No external APIs, no tracking, no servers, and zero data transmission.

---

## 🛠️ How to Install or Reload in Brave / Chrome

1. Open **Brave** (or Chrome) and navigate to:
   ```
   brave://extensions
   ```
   *(or chrome://extensions)*

2. Toggle **Developer mode** **ON** in the top-right corner.

3. If already loaded:
   - Click the **Reload** (circular arrow) icon on the **VIT Vellore AutoFill & AutoLogin** card.
   - If loading for the first time, click **Load unpacked** and select `C:\Password-AutoFill`.

4. **Pin the extension** to your toolbar:
   - Click the puzzle icon 🧩 next to the address bar.
   - Click the pin 📌 icon next to **VIT Vellore AutoFill & AutoLogin**.

---

## ⚙️ Configuration

1. Click on the extension icon ⚡ in your browser.
2. Under the **VTOP** tab:
   - Enter your Student Registration Number (e.g. `23BCE1000`).
   - Enter your VTOP Password.
   - Ensure **Auto-choose "Student"**, **Auto-solve Captcha (AI)**, and **Auto-submit VTOP Login** are toggled ON.
3. Under the **Assignments** tab:
   - View your synced digital assignment deadlines and countdowns.
4. Under the **Wi-Fi** tab:
   - Enter your Wi-Fi Username / ID and Password.
   - Ensure "Auto-submit Wi-Fi Login" is enabled.
5. Click **Save Settings**.
