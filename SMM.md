# SMM Portal

Teamspace ID: 'smm-portal'
Pages: 
- 'smm-admin'
- 'smm-dashboard'
- 'smm-twitterx'

## Context

Just as how the CA user group has their own team space (CA Portal), the SMM group will now have their own teamspace. The SMM user group deals with Social Media Management and as such the teamspace will have different pages for each social media but we will start with Twitter/X only. The dashboard page is custom page for each user that will allow them to manage their work, and the Admin page will be used by the manager to manage all SMM users.

## Firestore collections
To create:

1. `twitterx-accounts`
- accountName 
- accLink
- type 
- network
- assigned
- driveLink
- lastUpdatedTime
- lastUpdatedBy
- comments
- information
- posts
* note that 'type' must be able to store many fields at once (multi-select).
* 'assigned' must map to the users collection and may store more than 1 value.
* 'lastUpdatedBy' must map the users collection.
* 'lastUpdatedTime' must update automatically when the entry is updated.

2. `twitterx-content-schedule`
- caption
- accountName
- postDate
- postLink
- postedBy
- createdTime
- mediaCode
* 'accountName' must map to `twitterx-accounts`.
* 'postedBy' must map to the users collection.
* 'createdTime' must update automatically when the entry is created.


## Pages

### smm-dashboard
- This page is a personal workspace for each user.
- Split the page into 2 columns where the left column takes ~75% of the width and the right column takes the remaining 25%.
Left Column:
- Title text: "📅 Upload Schedule"
- Create a custom calendar widget. The calendar must show a week view and link to `twitterx-content-schedule`. Only entries may display where postedBy = current user. Each entry in `twitterx-content-schedule` corresponds to a post and must display as a self-contained card on the calendar. Each card must display the following: accountName, mediaCode. If the user clicks on the card, it must open a `src\components\ui\dialog.tsx` with all the post information: accountName (main text), caption (sub text), postDate, postLink, postedBy (use `src\components\ui\avatar.tsx`), mediaCode. Ensure that if a user clicks on the postLink URL, it opens the link in the user's browser. Also include a button next next to postLink that copies the link if clicked. If the user clicks anywhere else on the calendar, a different dialog must show for input. postDate corresponds to the particular day that was clicked. Add further input for caption, accountName (`src\components\ui\dropdown-menu.tsx`), postLink, and mediaCode. postedBy must automatically fill based on the current user. The accounts dropdown uses `twitterx-accounts`, filtered by assigned = current user. Above the calendar, add arrows to navigate back and forth between different weeks. Add a 'Today' button to quickly navigate to the current week. 

Right Column:
- Title text: "👤 My Accounts"
- Create a kanban board that shows all the user's assigned accounts in `twitterx-accounts`. Only show accounts where 'assigned' = current user. For each card in the kanban board, display the following: accountName (main text), type (highlighted label),  driveLink, comments. Ensure all fields are wrapped and do not overflow. If the user clicks on the driveLink URL, it must open the link in the user's browser. Include a copy link button next to the field. If the user clicks on the accountName, the accLink URL must open the user's browser. Note that some fields may be empty, so for example if driveLink is empty, it should not display on the card. If the user clicks anywhere on the card, a dialog must show with all the account information: accountName (main text), accLink (clickable with copy link button), type (highlight labels), network (highlight labels), assigned (use `src\components\ui\avatar.tsx`), driveLink (clickable with copy link button), comments, lastUpdatedTime. This dialog must be large to accommodate all the information. Then create a dedicated section using `src\components\ui\tabs.tsx` with the following headers: Information, Content. The information section will display the 'information' field. The Content section must use a `src\components\ui\table.tsx` to display all content for that account in `twitterx-content-schedule`. The column headers for the table: mediaCode, caption, postDate, postLink.


### smm-admin



### smm-twitterx
- You will see in definitions.ts, the icon parameter for this page is empty. Use a custom icon: `src\public\Icons\icons8-x.svg`. Ensure the sizing is consistent with all other icons in the sidebar.


## Other Instructions
- Firestore reads/writes must always be minimised.
- Use lazy load where applicable.
- Ensure all interfaces, card, and components are stylish; use the frontend-design skill for UI/UX.
- Use the simplify skill after you have finished implementing your solution.