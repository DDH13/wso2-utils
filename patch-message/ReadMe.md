# Patch Message Instructions

## Patch Message Bookmarklet Setup

Use this guide to trigger your `patch-message` extraction script directly from your browser's address bar using a simple keyboard shortcut.

---

## 1. The Javascript Code

Copy the `patch-message.bookmarklet.txt` snippet to use as your search engine URL:

## 2. Setup Instructions (Chrome / Edge)

1. Open your browser settings and navigate to:
   * **Chrome:** `chrome://settings/searchEngines`
   * **Edge:** `edge://settings/searchEngines`
2. Scroll down to the **Site search** section and click **Add**.
3. Fill out the fields as follows:
   * **Name:** `Patch Message`
   * **Shortcut:** `pm` *(or your preferred short trigger)*
   * **URL:** Paste the content of `patch-message.bookmarklet.txt` into it.
4. Click **Save**.

---

## 3. How to Use

When you are on the UMT view update page:

1. Press **`Cmd + L`** (Mac) or **`Ctrl + L`** (Windows) to highlight the address bar.
2. Type **`pm`** and press **`Enter`**.
3. The Update description will be copied to your clipboard and also logged in the browser console (in case of clipboard permission issues)
  e.g 
  ```
  U2: 19763
Internal Issue: <issue link>
Public Issue: https://github.com/wso2/api-manager/issues/<issue-no>
Deliverables:
Modified:
  - repository/components/plugins/org.wso2.carbon.apimgt.impl_9.27.188.jar
Most Likely ETA: 2026-09-24
Staging build status: SUCCESS
Manual Testing: PENDING
Applicable components: AIO, ACP, TM, UGW
  ```
