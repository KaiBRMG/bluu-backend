### Role: Senior Full-Stack Engineer & Software Architect
### Task: Implement the system below

# Campaign Tracking System

# Firestore collection
"campaign-tracking",
Fields: description,address,CR,createdBy,createdTime,creatorID,dueDate,fanName,lastEditedBy,lastEditedTime,length,amountPaid,profileLink,socialPlatform,socialUsername,status,totalAmount,type, callType, managerComment, isArchived, priority
- creatorID must associate to a specific creator in the "creators" collection

# Interfaces

## src\app\ca-portal\custom-requests\page.tsx
This is where chat agents input new entries in "campaign-tracking",

On this page there must be a tab menu for each creator, each tab has a data table to display all entries in "campaign-tracking" for that particular creator, all existing creators can be found in the "creators" collection. Use `src\components\ui\table.tsx` for the data table.

The data table must display: CR, type, createdTime, fanName, description, amountPaid, totalAmount, createdBy. 
Character limit the description, use a `src\components\ui\hover-card.tsx` to display the full description.
Each entry in the data table must include an option button at the far right, when clicked must have an option: "View". This must open a card (`src\components\ui\card.tsx`) that displays all the relevant information for that entry. Entries with 'status'="In Progress"|"Complete" must be read-only. Entries with 'status'="Awaiting Approval" can be edited. For entries of all types, the amountPaid field must always be editable.

At the top must be a filter to set 'type'="CR"|"Call"|"Item", a switch to toggle 'status'="Completed" (default=false) with text: "Show Completed". 

Default data shown:  'type'="CR"|"Call"|"Item",  'status'="Awaiting Approval"|"In Progress"|"Rejected". 
Sort by 'status' with "Rejected" at the top, "Awaiting Approval" second, and "In Progress" last.

There must be a button at the top right called "New". This must show a pop-up for data input to create a new entry for "campaign-tracking". This dialogue must follow 3 steps: 
1.) Select 'type'= "CR"|"Call"|"Item", use corresponding text: "Custom Request"|"Call"|"Item"
2.) Based on the 'type' that was selected, add certain data input for the collection entry: 
- if CR, user must enter fanName, profileLink, description, length, totalAmount, amountPaid, creatorID. 
- If Call, user must enter fanName, profileLink, description, length, creatorID, totalAmount, amountPaid, callType="Clean Video"|"Clean Voice"|"NSFW Video"|"NSFW Voice", dueDate, socialUsername, socialPlatform. 
- If Item, user must enter fanName, profileLink, creatorID, description, totalAmount, amountPaid, address. 
- For all types, CR must automatically be added and incremented (CR is a unique code per creator e.g. CR0001), createdBy must be set according to the user (UID) who created the entry, createdTime must set the date to the time of creating the entry, lastEditedBy must be set, lastEditedTime must be set. isArchived must be set false. To assist in auto-incrementing the CR ID, use a Firestore Transaction and store lastCRID in the "creators" collection for each creator. Whenever a new entry is made into the "campaign-tracking" collection, query lastCRID, increment it, and update in "creators" and "campaign-tracking" respectively. 
3.) A confirmation of the added info. The user must be prompted to make sure the info is correct, to edit any info (which takes them back to the previous screen), to cancel, or to submit.

For the tab menu, the very first item must be "My Customs":
- On this page, instead of a data table, show a kanban style board of only entries created by the current user (createdBy). 
- Cards on the kanban board must show: CR, type, createdTime, fanName, description, amountPaid, totalAmount. When a particular card is clicked, a card must show with a detailed view of all the information for that particular entry. Entries with 'status'="In Progress"|"Complete" must be read-only. Entries with 'status'="Awaiting Approval" can be edited. For entries of all types, the amountPaid field must always be editable. 
- Only show 'status'="Awaiting Approval"|"In Progress" entries, sort entries by "Awaiting Approval" first.
- Divide the kanban board based on creator.
- When a manager sets the 'status' to "Rejected" (see below), have a dedicated section with a carousel above the kanban board to display these entries, use text "Needs Info". Only display CR, creatorID, and managerComment. Make this whole section red to attract the user's attention. If there are no entries with 'status'="Rejected", this section must not display at all - only the kanban board.
- When the user clicks on a "Rejected" entry, a card must show all the relevant information for that entry. All data on the card must be editable. If the user has made any changes, include buttons at the bottom: Cancel, Submit. When the user clicks Submit, change the 'status' to "Awaiting Approval", do not clear managerComment and append text "Resubmitted" in italics, update lastEditedBy and lastEditedTime accordingly.


## src\app\creators\custom-requests\page.tsx
This is the manager interface of "campaign-tracking". 

Duplicate the look and functionality of `src\app\ca-portal\custom-requests\page.tsx` with the following changes:
- In addition to the "View" menu item, also have a "Delete" which must show a card to confirm deletion and if confirmed deletes that particular entry, and "Mark as Complete" which must set 'status'="Completed". Entries that are already completed must instead have the option "Mark as incomplete" which must set 'status'="Awaiting Approval".
- When clicking the "View" button on a particular entry, all (relevant) data shown on the card must be editable. 
- On the "View" card show all relevant information depending on the entry 'type', include 2 buttons which sets the 'status' property: "Approve" (changes 'status' to "In Progress"), "Reject (changes 'status' to "Rejected")". Also have input to set 'priority': "Low", "Medium", "High". 'priority' can also be left unset. Include text at the bottom: "Approving a CR will send it to the creator, ensure all info is 100% correct before approving. If a CR requires more info, Reject it to send it back to the CA to resubmit". 
- If "Reject" is clicked, a new card must show with an input field for a comment on why it is rejected and is applied to managerComment and sets 'status' to "Rejected", include the following buttons on the card: Cancel, Reject.
- If a manager edits any of the properties for a particular entry, update the lastEditedTime and lastEditedBy.
- For the tab menu, instead of the very first item "My Customs", have it as "Overview". On this page, have tiles at the top showing some summary information: count of entries with 'status'="Awaiting Approval" per creator, count of entries with 'status'="In Progress" per creator, $ outstanding for all creators (totalAmount - amountPaid for all entries) with text "Outstanding Payments", aging buckets (0-24h, 1-7d, 7-30d, >30d) to convey urgency for old and unattended entries ('status'="Awaiting Approval"|"In Progress"). 
- Below the tiles, have text "Recently Completed" with a list view that only shows the creator, CRID, and lastEditedTime of entries with 'status'="Completed" and 'isArchived'=false. Each entry row must have a button with text "Dismiss". When clicked, it must set isArchived=true. Make this whole container a greenish color.
- Below "Recently Completed", have text "Outstanding Customs" with a compact data table with each creator as the columns. Only display CRID with an indicator (colored dot) to indicate 'status'="Awaiting Approval"|"In Progress". Make this whole container a reddish color.


## src\app\creator-portal\dashboard\page.tsx
This is the creator interface. Since creators are our clients, this interface must look modern and appealing, and feel snappy. Creators may open this page on a desktop browser or mobile browser, ensure the page is optimized for both.

Top bar: 
- Left: display the company logo (src\public\logo\bluu_long.svg),
- Right: Profile menu (Creator logo + creator name), when clicked show a card with menu items (only have "Sign Out" for now).

The creator's interface must associate with creatorID.

Main content:
- Have a container with text: "Outstanding Custom Requests"
- Include an 'i' icon on the right of the text with a pop-over with text: "These are high-ticket custom requests your fans make. Since they are custom-made, they are sold at a significantly higher price than regular content. It is important that we get this content to them ASAP in order to maintain a good relationship. A fan who is willing to pay for one Custom Request is likely to come back for more!"
- In this container, have 3 tiles for the 3 different 'type' entries with text for each tile: "Customs" (CR), "Calls", "Items". Next to the "Customs" text, have an 'i' icon and a popover with text: "Please upload content to your Google Drive folder using the CR code as the name. For multiple files, create a folder with the CR code as the name."
- For each tile, show a carousel with entries with 'status'="In Progress" only for each 'type'. The card must show CRID, description, dueDate, fanName, profileLink, totalAmount for all types. Show length only for CR and Call, not Item. Sort entries firstly by priority, secondly by dueDate. Indicate priority with a label, e.g. "High Priority". For "Call", also display socialPlatform and socialUsername. For "Item", also display address.
- For all entries, include a button called "Completed". When clicked, set 'status'="Completed". Update the UI so updates feel snappy.
- At the bottom, add a new container with main text: "Google Drive Upload Link", and subtext: "This is your Google Drive folder where your content is stored. Please upload content in `# Unsorted`." Each creator has a property 'driveLink' in the "creators" collection that links to a Google Drive folder. Display this link here and ensure that clicking it opens a new tab to that URL.
- At the very bottom, add a link with text "All Custom Requests". When clicked, it must open a new page. On this page have a data table that shows all entries with 'status'="In Progress"|"Completed". Only show CRID, type, fanName dueDate. Each entry must have an options button at the far right with the following menu items: "View" that shows a card with a detailed view of the entry (CRID, description, dueDate, fanName, profileLink, totalAmount, length (CR or Call), socialPlatform and socialUsername (Call), address (Item), status). For entries with 'status'="In Progress", have a menu item "Mark as Complete". For entries with 'status'="Complete" AND isArchived=false, have the menu item as "Mark as Incomplete". 


# Notifications
Notifications can be sent like this:
`const notifBatch = adminDb.batch();
    notifBatch.set(adminDb.collection('notifications').doc(), {
      userId: [uid],
      title: '',
      message: ``,
      type: '',
      read: false,
      dismissedByUser: false,
      createdAt: FieldValue.serverTimestamp(),
      actionUrl: '',
      announcement: false,
      announcementExpiry: null,
    });`

Create a new notification for the following conditions:
1. A new entry is created:
- userId: all users in the "OFAM" user group,
- title: "📷 A New CR has been Created!",
- message: "[createdBy] has added a new CR for [creatorID]. Review the details and approve ASAP!"
- type: 'action',
- actionURL: '/creators/custom-requests'

2. 'status' is set to "Rejected":
- userId: createdBy,
- title: "❗Custom Request Rejected",
- message: "[lastEditedBy] has rejected [CRID] on [creatorID]. Please review the details and resubmit ASAP!"
- type: 'alert',
- actionURL: '/ca-portal/custom-requests'

3. 'status' is set to "Completed":
- userId: all users in the "OFAM" user group,
- title: "✅ Custom Request Completed",
- message: "[CRID] has been completed on [creatorID]. Please review and send to the fan ASAP!"
- type: 'success',
- actionURL: '/creators/custom-requests'


# Important Considerations
- Lazy Load: Only fetch the data for the campaign-tracking collection when a specific creator's tab is clicked
- Use onSnapshot. Ensure that the onSnapshot listener is unsubscribed when a tab is changed or the component unmounts.
- Use Firestore Indexing where possible.
- Minimise Firestore reads and write where possible.
- Use colors for the 'status' property: orange for "Awaiting Approval", red for "Rejected", blue for "In Progress", green for "Completed".
- Only use components from `src\components\ui` as far as possible
- Ensure Firestore Rules are configured correctly to support the logic required
- Created Composite Indexes where required
- All interfaces must look modern and appealing.
- All interfaces must feel snappy.
- All dates and times must be converted and stored on firestore in UTC.
- All dates and times displayed must be converted from UTC to the user's selected time zone. See `src\lib\services\userService.ts`.





In the detailed view card of the following interfaces:
- @src/app/(main)/ca-portal/custom-requests/page.tsx 
- @src/app/(main)/ca-portal/campaigns/page.tsx  
next to the "Close" and "Save" buttons, add a new button called "Actions".

When clicked, a @src/components/ui/dropdown-menu.tsx  must display with the following items: Transfer, Archive.
These options must also show in the data table, where "View" is currently displayed.

1. Transfer:
Currently, entries shown on 'My Customs' or 'Overview' are filtered to show only entires created by the user. The goal of the Transfer function is to transfer an entry to another user so it displays on their dashboards instead of the current user. When the user clicks on Transfer, a @src/components/ui/dialog.tsx  must show with text "You are about to transfer this entry to another user. Please select a user: " and 2 buttons: Cancel, Submit. Then add a @src/components/ui/dropdown-menu.tsx  for the user to select another user. Ensure to only list users from the 'CA' user group. A user must be selected from this list before clicking "Submit". Once the user clicks submit, the createdBy field of the particular entry must be changed to the selected user. Ensure the user's interface updates immediately after making the change and invalidate cache if needed so the updates are reflected immediately. When an entry has been transferred, a notification must be sent to the user that it has been transferred to. See @CLAUDE.md  on how the notification system works. Use text: "❗{user who submitted the transfer} transferred a custom on {creator} to you. You are now responsible for following up the fan, collecting the remaining balance, and completing the request."


2. Archive:
This only applies to @src/app/(main)/ca-portal/custom-requests/page.tsx since @src/app/(main)/ca-portal/campaigns/page.tsx already has an archival mechanism in place.

An entry may go stale due to a fan not being responsive or for many other reasons. The current logic does not support entries that are incomplete and should be removed from view. Currently status has the following types: Awaiting Approval, In Progress, Completed, Rejected. Add a new type: Archived.

On @src/app/(main)/ca-portal/custom-requests/page.tsx :
When a user clicks "Archive", a @src/components/ui/dialog.tsx  must show with text "Customs may be archived if a fan goes silent or if no progress can be made to complete the custom. Customs can be unarchived if needed. Proceed?" with buttons: Cancel, Continue. If the user clicks continue, set status to 'Archived'. Total amount must be set to amount paid.

Entries with status=Archived must be filtered out of all views :
- @src/app/(main)/ca-portal/custom-requests/page.tsx > My Customs,
- @src/app/(main)/ca-portal/custom-requests/page.tsx > All data tables,
- @src\app\(main)\creators\custom-requests\page.tsx > Overview,
- @src\app\(main)\creators\custom-requests\page.tsx > All data tables.

Also do the following:
- On @src\app\(main)\creators\custom-requests\page.tsx next to the 'Recently Completed' section, add another column next to it with text 'Recently Archived'. Make this section orange. Add all entries here with status=Archived and isArchived=false. Add dismiss buttons for each entry, and a dismiss all button -- just like the 'Recently Completed' section has. When a user clicks dismiss, it must set isArchived=true.

- On @src\app\(main)\creators\custom-requests\page.tsx also add the 'Archive' buttons to the detailed view card, and data table options.

- On @src/app/(main)/ca-portal/custom-requests/page.tsx > data tables, add a new badge alongside Custom Request, Call, Item called "Archived". Make variant="destructive". When clicked, all entries with status=Archived must display. When the archived badge is enabled, the other badges must be greyed out as well as the 'Show Completed' toggle. Only when the archived badge is untoggled should all the other filters be enabled again. Do the same on the data tables of @src\app\(main)\creators\custom-requests\page.tsx . Ensure that the search boxes on both these interfaces also include archived entries in the search.

- When an entry is archived, the "Archive" button must change to "Unarchive". When clicked, show a  @src/components/ui/dialog.tsx with text "This will make the custom active again. Proceed?" with buttons: Cancel, Continue. If the user continues, set status=In Progress, and set isArchived=false.

@src/app/(main)/ca-portal/campaigns/page.tsx already has an archival mechanism. Keep this as it is now. Only make the following change:
- Currently, only entries amount paid = total amount may be archived. Remove this requirement. When the user clicks 'Archive', show the same dialog as above and then set amount paid = total amount.

# Ensure the logic described above is correct before implementing.