# Shift Management

### 1. The Personalized User Dashboard

The biggest issue with the spreadsheet in "image_46fbbd.jpg" is cognitive overload. Users have to scan a massive grid of dates, creators, and shifts just to find their own name.

* **Default "My Schedule" View:** When a user (e.g., Olu or Ayo) logs in, they should immediately see a weekly or monthly calendar showing *only* their assigned shifts and the creators they are managing.
* **Automatic Timezone Conversion:** The explainer document notes that schedules are strictly managed in SAST, which requires chatters in the Philippines to manually convert times to PHT. The web app should automatically detect the user's local timezone (or allow them to set it) and display all shifts in their local time, removing the need for third-party extensions like Savvy Time.


* **Live Balances:** Display the user's available Unpaid Time Off (UPTO) and Paid Time Off (PTO) balances directly on the dashboard so they don't have to check a separate salary sheet.



---

### 2. Streamlining Workflows (Leave & Overtime)

Currently, users have to leave comments like "OFF PAID" or "BOOK" on specific cells, which requires an admin to manually review and update the sheet. We can automate this with dedicated UI modules.

**Leave Management Module**

* **Request Modal:** Instead of typing a comment, users click a "Request Time Off" button. They select the dates and choose either Paid (if full-time) or Unpaid leave.


* **Built-in Validation:** The system should automatically block leave requests made less than 4 days in advance, enforcing your existing business rules.


* **Motivation Field:** For paid leave, include a mandatory text field for the "leave motivation" so users don't have to send a separate message in their 1-on-1 chats.



**Overtime (OT) Marketplace**

* **The "Available Shifts" Board:** Create a separate tab for Overtime. When a user is approved for leave, the system should automatically list their assigned creators as "Available" on this board.
* **One-Click Booking:** Users can browse this board and click "Claim Overtime" instead of leaving a "BOOK" comment.


* **Rule Enforcement:** The UI should dynamically prevent a user from claiming an OT shift if it pushes them over the 5-account limit during their own shift, or the 4-account limit outside their regular shift. It should also enforce the 1-day advance booking rule. Since OT is first-come, first-serve, the shift should disappear from the board the moment someone claims it.



---

### 3. The Admin/Manager View

Admins need a bird's-eye view similar to the original spreadsheet, but with better filtering.

* **The Master Roster:** A modernized version of "image_46fbbd.jpg". Instead of an endless horizontal scroll, use a clean Kanban board or a dynamic data table where admins can filter by Date, Creator, or Shift (1, 2, or 3).
* **Drag-and-Drop Reassignment:** If management needs to redistribute or cancel OT shifts, they should be able to drag a user's avatar from one creator's shift block to another.


* **Approvals Inbox:** A dedicated space for admins to review and approve/deny leave requests.

---

### 4. Tying into Your Existing Database

Since you already have `creators`, `users`, and `shifts` collections, the frontend will map to them like this:

* **Users Collection:** Will power the authentication, store the user's timezone preference, and track their PTO/UPTO balances.
* **Creators Collection:** Will populate the tags/chips in the schedule UI so users know exactly which accounts they are working on.
* **Shifts Collection:** Will act as the bridge. A shift document should link a `user_id` to a `creator_id` for a specific time block. You can add a `status` field to this collection (e.g., "scheduled", "leave_requested", "available_for_ot") to power the Overtime Marketplace.

To make sure the administrative side of this app is just as effective as the chatter side, what specific metrics or red flags (like excessive unbooked OT or frequent leave requests) would your managers need highlighted on their dashboard?