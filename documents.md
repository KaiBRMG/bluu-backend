# Context

Read CLAUDE.md. 
The company wishes to pull-in documents and Notion pages into the current application. A Notion database is used to house all documents. When the user clicks on a document, a new page in the user's browser must open the document link. 

# Notion Structure
- Name 
- URL 
- Groups (CA, OFAM, SMM)
- Type 
- Status (Active, Unlisted)
- Last Edited Time

* If `URL` is populated, the link points to an external document that must be opened directly in the user's browser when the user clicks on a document. 
* If `URL` is empty, the document contents are located on the Notion page. The link of this Notion page must be opened in the user's browser when the user clicks on a document.
* Users may only access documents shared to their user group. `Groups` maps directly to user groups. Many 'groups' may be selected.
* Find `NOTION_DATABASE_ID` & `NOTION_TOKEN` in `src\.env.local`.
* See `https://developers.notion.com/` for Notion documentation.

# UI
- `src\app\(main)\applications\apps-resources\page.tsx`

- Place a wide search bar at the top using `src\components\ui\input.tsx`. Place a Search (lucide) icon with text: "Search all resources". This must by filter document `Name`.
- Place color-coded toggles below the search bar using `src\components\ui\toggle-group.tsx`. The toggle items must directly map to `Type` (Notion) and filter the documents. This component should be cached since document Types are rarely changed/created.
- Main content area:
    * Documents must be shown in a list view .
    * Create a custom component that represents a document. The document component must be used in the rows of the list. Use strong, legible typography for the title (`Name`), with a smaller timestamp below it showing when it was last updated (`Last Edited Time`). If the Notion entry has an icon, it should be displayed inline before the title. Add color-coded badges using `src\components\ui\badge.tsx` that indicates the `Type`. The same color must be used as in the toggle depending on the Type. A document may have one or many 'types'. The document component must behave like a button and shade when the user hovers over, and lift when the user clicks on it. When clicked, the `URL` or Notion page link must open on a new page in the user's browser. On the far right of the document component place a button with a Link (lucide) icon. The user may click on the document component itself which opens the link in browser, or click on the link button which must copy the link the user's clipboard. Use `src\components\ui\tooltip.tsx` on hover of the copy link button and use text: "Copy Link". Display a `src\components\ui\sonner.tsx` when clicked with text: "Link Copied!".
    * Use `src\components\ui\pagination.tsx` if more than 10 documents are displayed.
    * The search bar must actively filter documents as the user types. Ensure that the user may type any text as it appears in `Name`. 
    * The toggles must filter documents based on their `Type`. By default, all toggles should be enabled.

# Other instructions
- Use Next.js caching since documents aren't updated/created often.
- Ensure that the middle layer checks the user.groups and compares it to Notion's 'Groups'. User groups may only see their own documents.
- Use frontend-design (Skill) for the UI.

Update CLAUDE.md.