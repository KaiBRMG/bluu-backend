### Role: Senior Full-Stack Engineer & Software Architect
### Task: Implement the system below

# Content Planning System

# Firestore collection
"content-planning",
Fields: contentType, contentSummary, createdAt, dueDate, description, comment, status, creatorID, isArchived
- creatorID must associate to a specific creator in the "creators" collection

# Interfaces

## src\app\(main)\creators\content-planning
Use the style and formatting on `src\app\(main)\creators\custom-requests\page.tsx` as reference so this interface feels consistent. 

Add a tab menu on the left for each creator in the "creators" collection.
Make the first tab item: "Overview".

On each of the creator tabs, do the following:
- Display a data table displaying the contentType, contentSummary, dueDate, status for each entry, filtered by the creatorID depending on the creator tab.
- For each entry, have a menu button on the far right with the following options: "View", "Delete", "Mark as Complete". 
1. For View, open a detailed view card of all the information for that entry, including the description. All fields must be writable. Include 3 buttons at the bottom: Delete, Mark as Complete, Cancel, Update. If no information was edited, the Update button must be greyed out. 
2. For Delete, the entry must be deleted from the firestore collection after showing a confirmation dialogue to the user to confirm the action. 
3. For Mark as Complete, set 'status'="Completed" after showing a confirmation dialogue to the user to confirm the action.
- Have a switch above the data table on the far right with text "Show Completed" (default false/off). This must filter the 'status' property. On default show only 'status'="Outstanding", if the switch is toggled show 'status'="Outstanding"|"Completed". 
- On the right of the switch, add a button called "New". When clicked, a 2-step wizard must display to create a new entry. 
- The first page of the wizard must display input for contentSummary (label="Summary of the required content", placeholder text="Instagram Content"), contentType (dropbox with SFW, NSFW), dueDate, description, comment (placeholder="Additional instruction, e.g. wear sunglasses and smile.), creatorID (dropdown). createdAt must be set automatically, status must be set to "Outstanding", isArchived=false. The description type must be an array and input must work like this: have 2 columns (Qty. & Content) and have 2 text boxes in the next row. Between the text boxes, have an 'x' symbol. Have only 1 row of input with placeholder text: Qty. - "5"; Content - "Selfies". On the right of the text boxes, have a '+' icon which must add a row of text boxes. At the very bottom have 2 buttons: Cancel, Next.
- When Next is clicked, show the second page which must include a summary of all the entered information. Include 2 buttons at the bottom: Back, Submit. When Submit is clicked, add the entry to the firestore collection. Also include text: "Please notify the creator of a new content request."
- Include `src\components\ui\pagination.tsx` at the bottom of all data tables.

On the Overview tab, do the following:
- Display 2 containers beneath each other: Completed Content, Pending Content.
- Completed Content container: display a list of all entries with 'status'="Completed" and 'isArchived'=false. Display the creatorID and contentSummary. When clicking on an entry, open the detailed card view (described above). For each entry, show a "Dismiss" button and when clicked must change isArchived=true. Also include a "Dismiss All" button at the top.
- Pending Content container: using a kanban board for each creator, display only 'status'="Outstanding" entries. On the card, display only contentSummary, dueDate. If dueDate is in the past, make this text red with text "Overdue". When clicking on a card, open the detailed card view (described above).

## src\app\creator-portal\dashboard
This is the creator-facing interface. It is important that design and styling is done professional here, and is consistent with the current theme.

Add a new section after the "Custom Requests" section. 
Main text: "Content Planning"
'i' icon popover text: "This is the content we need to maintain your page. Please try sticking to your due dates as we follow a strict content upload schedule!"
Have the main container stretch the full page, and use a carousel inside roughly twice the width of the carousels used above. 
Display all entries with status=Outstanding. Sort by dueDate. 
Display on the card:
- contentSummary (title)
- contentType (as a tag next to title)
- comment
- description
- dueDate (show red text is date is in past)
- a button at the bottom with text: "Completed". If clicked, set status=Completed.

Below the "All Custom Requests" container, duplicate the container and change it to "All Content Requests". When clicked, open a new page, duplicated from the Custom Requests one, but with all the fields described above. Also include an action menu on the far right with menu items: "View", "Mark as Complete" (if status=outstanding)/

# Notifications
See `CLAUDE.md` on how notifications work in this system.

Create a new notification for the following conditions:
1. 'status' is set to "Completed":
- userId:  all users in the "OFAM" user group,
- title: "✅ Content Request Completed",
- message: "[creatorID] has completed [contentSummary]!"
- type: 'success',
- actionURL: '/creators/content-planning'


# Important Considerations
- Lazy Load: Only fetch the required data from the collection when a specific tab is clicked
- Use onSnapshot. Ensure that the onSnapshot listener is unsubscribed when a tab is changed or the component unmounts.
- Use Firestore Indexing where possible.
- Minimise Firestore reads and write where possible.
- Use colors for the 'status' property: red for "Outstanding", green for "Completed".
- Only use components from `src\components\ui`. DO NOT OVERLOOK THIS!
- Ensure Firestore Rules are configured correctly to support the logic required
- Created Composite Indexes where required
- All interfaces must look modern and appealing.
- All interfaces must feel snappy.
- All dates and times must be converted and stored on firestore in UTC.
- All dates and times displayed must be converted from UTC to the user's selected time zone. See `src\lib\services\userService.ts`.





