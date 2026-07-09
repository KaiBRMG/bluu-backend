# SMM Portal

Teamspace ID: 'smm-portal'
Pages: 
- 'smm-admin'
- 'smm-dashboard'

## Context

Just as how the CA user group has their own team space (CA Portal), the SMM group will now have their own teamspace. The SMM user group deals with Social Media Management and as such the teamspace will have different pages for each social media but we will start with Twitter/X only. The dashboard page is custom page for each user that will allow them to manage their work, and the Admin page will be used by the manager to manage all SMM users. The system requires interfaces to manage different accounts, and to manage the content schedule for each account. A bonus system will also be implemented that deals with SMM's submitting posts for a bonus if applicable.

## Firestore collections
To create:

1. `twitterx-accounts`
- accountName 
- accountLink
- type 
- network
- tier
- assigned
- driveLink
- lastUpdatedTime
- lastUpdatedBy
- comments
- information
- status
* note that 'type' must be able to store many fields at once (multi-select).
* 'assigned' must map to the users collection and may only store 1 value.
* 'lastUpdatedBy' must map the users collection.
* 'lastUpdatedTime' must update automatically when the entry is updated.

2. `twitterx-content-schedule`
- {accountID}/
-- caption
-- accountName
-- postDate
-- postLink
-- postedBy
-- createdTime
-- bonusSubmission  (boolean; true once the post is submitted for a bonus — drives the calendar 💰. `mediaCode` was removed.)

* 'accountName' must map to `twitterx-accounts`.
* 'postedBy' must map to the users collection.
* 'createdTime' must update automatically when the entry is created.
* Ensure these are implemented as Subcollections, not nested arrays/maps.

3. `twitterx-bonus`
- {roundID}/
-- userTotals
-- roundDateStart
-- roundDateEnd
-- submissions
---- {submissionID}/
----- postLink
----- accountName
----- originalLink
----- originalAcc
----- submittedBy
----- screenshotLink
----- postDate
----- submissionDate
----- numLikes
----- status
----- network
----- tier
----- bonusAmount
----- sysComments
----- adminApproval

* the bonus system works periodically. A manager will set the start and end dates, and during this time SMM's will submit posts for bonus which will accumulate in 'submissions'. As their bonusses are added during this time, each user's total will be stored in 'userTotals'.
* Ensure these are implemented as Subcollections, not nested arrays/maps.


## Pages

### smm-dashboard
- This page is a personal workspace for each user.
- IMPORTANT: Filter out all entries from `twitterx-accounts` with status = inactive. No inactive accounts may be displayed to the user. Also check `twitterx-content-schedule`, inactive accounts mentioned in this collection must be filtered out. Ensure to also filter out inactive accounts from any dropdowns where input is required.
- Split the page into 2 columns where the left column takes ~75% of the width and the right column takes the remaining 25%.
#### Left Column:
- Title text: "📅 Upload Schedule"
- Create a custom calendar widget. The calendar must show a week view and link to `twitterx-content-schedule`. Only entries may display where postedBy = current user. Each entry in `twitterx-content-schedule` corresponds to a post and must display as a self-contained card on the calendar. Each card must display the following: accountName, caption (character-capped so it never overflows), plus a 💰 marker when the post has been submitted for a bonus. If the user clicks on the card, it must open a dialog with all the post information: accountName (main text), caption (sub text), postDate, postLink, postedBy. Ensure that if a user clicks on the postLink URL, it opens the link in the user's browser. Also include a button next next to postLink that copies the link if clicked. Add a button at the bottom of the dialog called "Actions". If clicked show these options: "Edit", "Delete", "💰 Submit for Bonus".
-- Edit: Make all data on the dialog editable, use a dropdown for accountName. Add a save button if any data has been changed. 
-- Delete: Show an alert dialog to prompt the user to confirm the action. If confirmed, delete this entry from the `twitterx-content-schedule` collection.
-- 💰 Submit for Bonus: see below.

 If the user clicks anywhere else on the calendar, a different dialog must show for input. postDate corresponds to the particular day that was clicked. Add further input for caption, accountName (`src\components\ui\dropdown-menu.tsx`), and postLink (required — the Submit button stays disabled until the link contains "x.com"). postedBy must automatically fill based on the current user. The accounts dropdown uses `twitterx-accounts`, filtered by assigned = current user. Above the calendar, add arrows to navigate back and forth between different weeks. Add a 'Today' button to quickly navigate to the current week. Add a button "Show All Posts", when clicked it can open a large dialog page with a table that shows all entries in `twitterx-content-schedule` where postedBy == current user. Display the following column headers: accountName, postDate, postLink (clickable + copy link button), caption. Caption may be a long field with the text overflowing, use a hover card to display the full caption. On the far right of each row, add an options buttons with the following that must do the same thing as described above: View, Edit, Delete, 💰 Submit for Bonus. 'View' opens the same card as when clicking on a post in the calendar.



#### Right Column:
- Title text: "👤 My Accounts"
- Create a kanban board that shows all the user's assigned accounts in `twitterx-accounts`. Only show accounts where 'assigned' = current user. For each card in the kanban board, display the following: accountName (main text), type (highlighted label),  driveLink, comments. Ensure all fields are wrapped and do not overflow. If the user clicks on the driveLink URL, it must open the link in the user's browser. Include a copy link button next to the field. If the user clicks on the accountName, the accountLink URL must open the user's browser. Note that some fields may be empty, so for example if driveLink is empty, it should not display on the card. If the user clicks anywhere on the card, a dialog must show with all the account information: accountName (main text), accountLink (clickable with copy link button), type (highlight labels), network (highlight labels), assigned (use `src\components\ui\avatar.tsx`), driveLink (clickable with copy link button), comments, lastUpdatedTime. This dialog must be large to accommodate all the information. Then create a dedicated section using `src\components\ui\tabs.tsx` with the following headers: Information, Content. The information section will display the 'information' field. The Content section must use a table to display all content for that account from `twitterx-content-schedule`. The column headers for the table: caption, postDate, postLink. All fields must be read-only, except the Content section -- allow the user to edit any of the information here.

#### Beneath the columns, create a new section with main text: "💰 Bonus System"
Sub text: "Current Round: {roundStartDate} - {roundEndDate}" -- formatted as '26 April'.
sub sub text: "Your current payout for this round: {userTotals for current user for current round}"
Then add a table that shows the user's submissions in `twitterx-bonus` for the current round.
-- Column headers: accountName, submissionDate, bonusAmount, sysComments, adminApproval
- Add a button somewhere here called "Show Previous Rounds"
-- When clicked, open a large dialog with a table. Group by round. Display all submissions for the current user and at the end of each sub-group, display payout (userTotals) for that round. 
-- Use pagination.

#### Bonus system:
- "💰 Submit for Bonus" button:This requires a multi-step wizard with many dialogs. When this button is clicked, show a dialog with main text: "Did you copy another viral post?", and 2 fields: 
-- label: "Please paste the original post link", with an input field for the link, 
-- label: "Please enter the account on which this is posted", with a dropdown of all accounts (`twitterx-accounts`)
-- buttons: "No" and "Next". 'Next' must initially be disabled. When they paste the link here and select an account, the 'Next' button can be enabled. Clicking No will skip this next dialog.
-- Next: After clicking Next, search through the all entries in `twitterx-content-schedule` where the link they pasted = postLink; and also `twitterx-bonus` where the link they pasted = originalLink. Note that a link could have '/photo/1' or '/video/1' appended on the back or not, ensure your search will find entries even if they do not have those appended texts. On the next dialog, show details of the entries that was found in `twitterx-content-schedule` (postLink, postedBy, postDate) or `twitterx-bonus` (originalLink, submittedBy, submissionDate). Calculate the difference in days between today and postDate/submissionDate and display this. In cases where there are more than 1 entry found, use the most recent one (postDate/submissionDate). If the difference is more than 14 days, add indicator text: "✅ Eligible". If the difference is less than 14 days, add indicator text: "⚠️ This post has already been used recently". Add 2 buttons at the bottom of the dialog: Back, Next. If the post is not eligible, Next must be disabled. Only if the post has been used more than 2 weeks or not used at all, should the Next button be enabled. Back takes them to the previous dialog. After clicking Next, a new dialog must show. Note that this next dialog is also the dialog that must show if they clicked 'No' previously.

On the next dialog use main text: "Submit your post information". Pull in the following information from the current entry of `twitterx-content-schedule` and display it at the top: postLink, postDate, and the link they pasted in the previous dialog if they pasted one (use label = "Original Link"). Below, add input for the following: Likes Generated (number), Screenshot Link (text). Add 2 buttons at the bottom: Back, Submit. Back must take them to the previous screen. 

If they click Submit, show a confirmation dialog with a button: "Done'. 
After clicking Submit, take all the information and create a new submission in the most recent entry in `twitterx-bonus` by checking roundDateStart and roundDateEnd:
- postLink: set to the postLink from the entry in `twitterx-content-schedule` which they are applying for the bonus,
- postDate: set to the postDate from the entry in `twitterx-content-schedule` which they are applying for the bonus,
- network: set to the network of the account in `twitterx-accounts` which they are applying for the bonus,
- tier: set to the tier of the account in `twitterx-accounts` which they are applying for the bonus,
- accountName: set to the accountName from the entry in `twitterx-content-schedule` which they are applying for the bonus,
- originalLink: if the user pasted a link on the previous dialog ("Did you copy another viral post?"), otherwise leave empty if they did not paste a link,
- originalAcc: if the user selected an account on the previous dialog ("Did you copy another viral post?"), otherwise leave empty,
- submittedBy: the user who is submitting,
- submissionDate: the date and time they clicked Submit,
- screenshotLink: the screenshot link they pasted in the last dialog,
- numLikes: the number they entered in the last dialog,
- adminApproval: false (default),
- bonusAmount, status: use the following logic:
-- if tier == 1 AND numLikes >= 10000 AND submissionDate-postDate<=(3 days + 12 hours): set bonusAmount=5, sysComments="1️⃣ Target Bonus: $5"
-- else if tier == 1 AND numLikes >= 20000 AND submissionDate-postDate<=(5 days + 12 hours): set bonusAmount=10, sysComments="1️⃣ Target Bonus: $10"
-- else if tier == 1 AND numLikes >= 35000 AND submissionDate-postDate<=(7 days + 12 hours): set bonusAmount=25, sysComments="1️⃣ Target Bonus: $25"
-- else if tier == 2 AND numLikes >= 10000 AND submissionDate-postDate<=(3 days + 12 hours): set bonusAmount=3, sysComments="1️⃣ Target Bonus: $5"
-- else if tier == 2 AND numLikes >= 20000 AND submissionDate-postDate<=(5 days + 12 hours): set bonusAmount=7, sysComments="1️⃣ Target Bonus: $10"
-- else if tier == 2 AND numLikes >= 35000 AND submissionDate-postDate<=(7 days + 12 hours): set bonusAmount=15, sysComments="1️⃣ Target Bonus: $25"
-- if any of the above pass, set status='✅ Qualified', else set status='❌ Late submission'. 
-- Next Step: if originalLink != NULL AND bonusAmount!=0, set bonusAmount=bonusAmount/2, append to sysComments="\n6️⃣ Viral Post copied, bonus halved"; then find who is the 'assigned' of originalAcc in `twitterx-accounts`, then create a new submission for them with the following data:
--- postLink: this postLink
--- postDate: this postDate
--- network: this network
--- tier: this tier
--- accountName: this accountName
--- originalAcc: this originalAcc
--- submittedBy: the 'assigned' of originalAcc in `twitterx-accounts` 
--- sysComments: "6️⃣ Viral Post residual from {user who submitted initially}
--- bonusAmount = this bonusAmount
--- adminApproval = false
--- status = '✅ Qualified'
-- Next Step: if network = 'Inhouse', set bonusAmount = bonusAmount+3, append to sysComments="\n2️⃣ Network Bonus: $3",
-- else if network = 'X Managed', set bonusAmount = bonusAmount+1, append to sysComments="\n2️⃣ Network Bonus: $1",
-- else if network = 'Twink' AND originalLink = NULL, set bonusAmount = bonusAmount/2, append to sysComments="\n2️⃣ Network Bonus: half 1️⃣ Target Bonus",
Once this process is finished, take the final value of bonusAmount, and add it to the user's total in userTotals. Ensure not to replace/wipe the value, it must be added to it. If the user does not exist in userTotals, add them.


### smm-admin
- Admin does not imply admin-only access to the page, read CLAUDE.md to understand how permissions and sharing works in this codebase.

I am not sure on how to structure this page yet given all the data required, so for now just create 2 pages on this page:
- Account Database
- Bonus Management

1. Account Database
- Main text at the top: "Account Database"
- Create a dashboard for `twitterx-accounts`. This page is used by an admin to manage all data related to accounts. 
- Use a table to display all accounts. Column headers: accountName, accountLink, type, tier, assigned, status. All these fields must be editable, for type, assigned, and status use a dropdown. Type = {Twink, Twunk, Hunk/Jock, Couple, Daddy, Artist, Animator, SFS, Upload, Bonus} -- recall that type is a multi-select property and can have more than 1 value. Assigned = {only users with SMM user group}. tier = {1,2}. Status = {Active, Inactive} -- when a user edits this property, first show an alert dialog to confirm the action. Group the table by network.
- Add a search box at the top of the table to easily search and filter accounts in the table, search for: accountName, accountLink, type, tier, network, assigned, status.
- For each field in the database, include an options button on the far right. When clicked, display the following: Edit, Delete. 
-- 'Edit': a large dialog must open. The dialog must be large so that all information can be seen for the account just like on the `smm-dashboard` page. Display: accountName (main text), type (label), network (label), tier (label), assigned, driveLink, lastUpdatedTime, lastUpdatedBy, comments, status. network must also make use of a dropdown, network = {Inhouse, X Managed, Twink, Other}. All fields must be editable (except lastUpdatedTime, lastUpdatedBy), use dropdowns or text input where relevant. Beneath this create a tab menu with: Information, Content -- just like on smm-dashboard. The information section must also be editable. 
-- 'Delete': show an alert dialog prompting the user to confirm the action. If confirmed, delete this entry from the `twitterx-accounts` collection.


2. Bonus Management
- Main text at the top: "Bonus Management"
- Subtext: "Current Round: {roundStartDate} - {roundEndDate}" -- formatted as '26 April'.
- Add a button near here with text: "Start New Round". When clicked, show a dialog that warns the user that starting a new round will end the current round, and add date pickers to input roundDateStart and roundDateEnd. If the user proceeds, this must create a new entry in `twitterx-bonus`. 
- Divide the page into 2 columns with the left taking 75% of the screen width and the right taking 25%
- Left column:
-- main text: "Submissions"
-- Add a table in this section:
--- group the table by submittedBy
--- Column headers: submissionDate, accountName, network, postLink, status, adminApproval.
--- For each row, include an options button on the far right with the following options: View, Delete. Delete must delete that particular submission, show an alert dialog first so the user can confirm the action. 
--- Clicking view must show a more detailed card of the submission. Display the following information: postLink, accountName, originalLink, submittedBy, screenshotLink, postDate, submissionDate, numLikes, status, network, bonusAmount, sysComments, adminApproval. Only numLikes, status, bonusAmount, sysComments, and adminApproval (Approve/Reject) may be editable here.

- Right Column:
-- main text: "Earnings"
-- use a table to display all users in `twitterx-bonus`>'userTotals', column headers: User, Payout
-- Ensure the Payout column is editable.
-- Ensure the data is only taken from the current round (should always be the most recent entry in `twitterx-bonus`), and not previous rounds.


- Add a button somewhere: "Show Previous Rounds".
-- When clicked, open a new page with a table. Group by round. Sub-group by user (submittedBy). Display all submissions for each user and at the end of each sub-group, display payout (userTotals) for that round and for that user. 
-- Use pagination.


## Other Instructions
- Firestore reads/writes must always be minimised.
- Use lazy load where applicable.
- Ensure all interfaces, cards, and components are stylish; use the frontend-design skill for UI/UX.
- Use the simplify skill after you have finished implementing your solution.
- Remember to use shadcn components only.
- Read CLAUDE.md first and make sure to make any updates to the documentation repo.
- For any fields where the data may be long and overflow its container, use a hover card to display the full data field.'
- Wherever a user is displayed, always use `src\components\ui\avatar.tsx`.
- Identify similar components and whether they can be shared across interfaces.
- Identify gaps in the logic and make your own assumptions if obvious and safe to do so. For major gaps, ask the user first.
- If you identify a way of doing something more optimally than described above, ask the user for permission to implement it instead and explain how it differs and impacts the requirements described above.
- Ensure bonusAmount and userTotals can handle decimals, they should display in the format: "$X.XX".
